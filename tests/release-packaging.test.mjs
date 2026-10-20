import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { classifyPath, parseArguments, scanPackageTree, repositoryRoot } from "../tools/release/lib.mjs";
import { readZipEntries, sha256File, writeZip } from "../tools/release/zip.mjs";
import { transformMain } from "../tools/release/transform-main.mjs";
import { evaluate } from "../tools/check-release-budgets.mjs";
import { generateVault } from "../tools/release/vault-generator.mjs";

const run = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), "slopsidian-release-test-"));
test.after(() => rm(scratch, { recursive: true, force: true }));

test("zip writer is deterministic and verifiable", async () => {
  const source = join(scratch, "zip-source");
  await mkdir(join(source, "sub"), { recursive: true });
  await writeFile(join(source, "a.txt"), "alpha".repeat(1000));
  await writeFile(join(source, "sub", "b.bin"), Buffer.from([1, 2, 3]));
  await writeZip(source, join(scratch, "1.zip"));
  await writeZip(source, join(scratch, "2.zip"));
  assert.equal(await sha256File(join(scratch, "1.zip")), await sha256File(join(scratch, "2.zip")));
  const entries = await readZipEntries(join(scratch, "1.zip"));
  assert.deepEqual(entries.map(entry => entry.name ?? entry.path).sort(), ["a.txt", "sub/b.bin"]);
});

test("content policy rejects vaults, profiles, credentials and compatibility fixtures", () => {
  for (const path of ["resources/app/.runtime/compatibility/x.js", "resources/app/.obsidian/app.json", "Data/profile/Cookies", "resources/app/node_modules/a/b.js", "x/.env", "x/key.pem", "x/data.json", "resources/app/tests/a.mjs"]) {
    assert.ok(classifyPath(path), path);
  }
  for (const path of ["Slopsidian.exe", "resources/app/.runtime/web-adblock/engine.cjs", "resources/app/src/RonSijm.Slopsidian/wwwroot/app.css"]) {
    assert.equal(classifyPath(path), null, path);
  }
});

test("content policy excludes private reference trees and original archives", () => {
  for (const path of ["Reference/Obsidian/app.js", "resources/app/reference/manifest.json", "resources\\app\\Docs\\Private\\README.md", "resources/app/PRIVATE/findings.txt", "resources/app/obsidian.asar", "resources/app/obsidian-1.15.0.asar"]) {
    assert.ok(classifyPath(path), path);
  }
  assert.equal(classifyPath("resources\\app\\.runtime\\web-adblock\\engine.cjs"), null);
});

test("package scan flags checkout paths and credential-shaped text", async () => {
  const directory = join(scratch, "scan");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "ok.js"), "console.log(1)");
  await writeFile(join(directory, "leak.js"), "const p = 'C:\\\\Secret\\\\Checkout';");
  await writeFile(join(directory, "token.txt"), "ghp_" + "a".repeat(36));
  const { violations } = await scanPackageTree(directory, { forbiddenText: ["C:\\\\Secret\\\\Checkout"] });
  assert.deepEqual(violations.map(item => item.file).sort(), ["leak.js", "token.txt"]);
});

test("package scan checks large bundles and matches text across read boundaries", async () => {
  const directory = join(scratch, "scan-large");
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.alloc(25 * 1024 * 1024, 32);
  bytes.write("ghp_" + "a".repeat(36), 64 * 1024 - 8);
  bytes.write("C:/private/reference-checkout", bytes.length - 64);
  await writeFile(join(directory, "bundle.js"), bytes);
  const { violations } = await scanPackageTree(directory, { forbiddenText: ["C:/private/reference-checkout"] });
  assert.deepEqual(violations.map(item => item.reason).sort(), ["contains a source-checkout or user path", "contains credential-shaped content"]);
});

test("main.cjs transformation applies every runtime-path substitution to the current source", async () => {
  const source = await readFile(join(repositoryRoot, "desktop", "main.cjs"), "utf8");
  const output = transformMain(source);
  assert.notEqual(output, source);
  assert.match(output, /SLOPSIDIAN_DATA_DIR/);
  assert.match(output, /RonSijm\.Slopsidian\.exe/);
  assert.doesNotMatch(output, /spawn\("dotnet"/);
  assert.throws(() => transformMain("// unrelated"));
});

test("budget gate fails on regressions, unbound evidence and missing data", () => {
  const budgets = JSON.parse("{\"bundles\":{\"portableZipBytes\":10,\"setupBytes\":10,\"desktopTreeBytes\":10,\"uiAssetsBytes\":10},\"largeVault\":{\"notes\":5,\"clientParseAllMs\":10,\"clientSearchMaxMs\":10,\"hostReadyMs\":10,\"hostVaultCallMs\":10,\"hostMetadataCallMs\":10,\"hostWorkingSetBytes\":10},\"startup\":{}}");
  const manifest = { artifacts: { portableZip: { sha256: "h", bytes: 5 }, setup: { bytes: 5 } } };
  const vault = { artifacts: { portableZip: { sha256: "h" } }, notes: 5, client: { parseAllMs: 5, searches: { a: { maxMs: 5 } } }, host: { readyMs: 5, workingSetBytes: 5, allOk: true, calls: { vault: { ms: 5 }, metadata: { ms: 5 } } } };
  assert.equal(evaluate(budgets, { "large-vault": vault }, manifest).ok, true);
  assert.equal(evaluate(budgets, { "large-vault": { ...vault, artifacts: { portableZip: { sha256: "other" } } } }, manifest).ok, false);
  assert.equal(evaluate(budgets, { "large-vault": { ...vault, client: { parseAllMs: 50, searches: {} } } }, manifest).ok, false);
  assert.equal(evaluate(budgets, { "large-vault": { ...vault, host: { error: "x" } } }, manifest).ok, false);
  assert.equal(evaluate(budgets, {}, manifest).ok, false);
});

test("vault generator is deterministic", async () => {
  const [a, b] = [join(scratch, "va"), join(scratch, "vb")];
  const first = await generateVault(a, { notes: 20 });
  const second = await generateVault(b, { notes: 20 });
  assert.deepEqual(first, second);
  assert.equal(await readFile(join(a, "Folder 0000", "Note 000007.md"), "utf8"), await readFile(join(b, "Folder 0000", "Note 000007.md"), "utf8"));
});

test("argument parser handles flags, numbers and strings", () => {
  const parsed = parseArguments(["--notes", "7", "--skip-ui-build", "--out", "x"], { notes: "number", "skip-ui-build": "flag", out: "string" });
  assert.equal(parsed.notes, 7);
  assert.equal(parsed["skip-ui-build"], true);
  assert.equal(parsed.out, "x");
});

test("installer never registers handlers and refuses unsafe destinations", async () => {
  const install = await readFile(join(repositoryRoot, "tools", "release", "install.ps1"), "utf8");
  const uninstall = await readFile(join(repositoryRoot, "tools", "release", "uninstall.ps1"), "utf8");
  for (const text of [install, uninstall]) {
    assert.doesNotMatch(text, /Classes|URL Protocol|RegisterApplicationRestart|FileExts|HKLM/i);
  }
  const unsafe = join(scratch, "occupied");
  await mkdir(unsafe, { recursive: true });
  await writeFile(join(unsafe, "someone-elses-file.txt"), "keep");
  const fake = join(scratch, "payload.zip");
  await writeFile(fake, "not a zip");
  const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repositoryRoot, "tools", "release", "install.ps1"), "-PackageZip", fake, "-InstallDir", unsafe, "-NoShortcuts", "-NoRegistration"], { windowsHide: true }).then(() => ({ code: 0 }), error => ({ code: error.code ?? 1 }));
  assert.notEqual(result.code, 0);
  assert.equal(await readFile(join(unsafe, "someone-elses-file.txt"), "utf8"), "keep");
  const root = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repositoryRoot, "tools", "release", "install.ps1"), "-PackageZip", fake, "-InstallDir", "C:\\", "-NoShortcuts", "-NoRegistration"], { windowsHide: true }).then(() => 0, error => error.code ?? 1);
  assert.notEqual(root, 0);
});

const installer = join(repositoryRoot, "tools", "release", "install.ps1");
const uninstaller = join(repositoryRoot, "tools", "release", "uninstall.ps1");
const powershell = (file, ...args) => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args], { windowsHide: true }).then(
  result => ({ code: 0, out: result.stdout + result.stderr }), error => ({ code: error.code ?? 1, out: String(error.stdout) + String(error.stderr) }));
const exists = path => readFile(path).then(() => true, () => false);

async function fakePackage(name, version, extra = {}) {
  const source = join(scratch, name + "-src");
  await mkdir(join(source, "resources", "app"), { recursive: true });
  await writeFile(join(source, "Slopsidian.exe"), "MZ fake " + version);
  await writeFile(join(source, "resources", "app", "package.json"), JSON.stringify({ version }));
  await writeFile(join(source, "resources", "app", "main.js"), "// " + version);
  for (const [file, text] of Object.entries(extra)) { await mkdir(join(source, ...file.split("/").slice(0, -1)), { recursive: true }); await writeFile(join(source, ...file.split("/")), text); }
  const zip = join(scratch, name + ".zip");
  await writeZip(source, zip);
  return zip;
}

test("installer upgrades atomically, uninstall preserves user data and removes only owned records", async () => {
  const base = join(scratch, "inst ' apostrophe");
  const destination = join(base, "Slopsidian App");
  const shortcuts = join(base, "Start Menu", "Slopsidian");
  const registry = "HKCU:\\Software\\SlopsidianPackagingTest\\unit-" + process.pid;
  const common = ["-InstallDir", destination, "-ShortcutDir", shortcuts, "-RegistryPath", registry];
  const dataDirectory = join(base, "Data");
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(join(dataDirectory, "vault-note.md"), "precious");
  try {
    let result = await powershell(installer, "-PackageZip", await fakePackage("v1", "1.0.0"), ...common);
    assert.equal(result.code, 0, result.out);
    assert.ok(await exists(join(destination, "Slopsidian.exe")) && await exists(join(shortcuts, "Slopsidian.lnk")));
    const manifest = JSON.parse((await readFile(join(destination, "install-manifest.json"), "utf8")).replace(/^\uFEFF/, ""));
    assert.ok(manifest.files.every(file => /^[0-9a-f]{64}$/.test(file.sha256)));

    const bad = await fakePackage("bad", "2.0.0", { "x/..y/ok.txt": "fine" });
    const traversal = join(scratch, "traversal.zip");
    await writeFile(traversal, await readFile(bad));
    result = await powershell(installer, "-PackageZip", join(scratch, "payload-missing.zip"), ...common);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(join(destination, "resources", "app", "main.js"), "utf8"), "// 1.0.0");

    await writeFile(join(destination, "user-file.txt"), "mine");
    result = await powershell(installer, "-PackageZip", await fakePackage("v2", "2.0.0"), ...common);
    assert.notEqual(result.code, 0, "upgrade must refuse over unknown files");
    assert.equal(await readFile(join(destination, "user-file.txt"), "utf8"), "mine");
    await rm(join(destination, "user-file.txt"));

    result = await powershell(installer, "-PackageZip", await fakePackage("v2b", "2.0.0"), ...common);
    assert.equal(result.code, 0, result.out);
    assert.equal(await readFile(join(destination, "resources", "app", "main.js"), "utf8"), "// 2.0.0");
    assert.deepEqual((await run("powershell.exe", ["-NoProfile", "-Command", `Get-ChildItem -LiteralPath '${base.replaceAll("'", "''")}' -Name`])).stdout.split(/\r?\n/).filter(name => /staging|previous/.test(name)), []);

    await writeFile(join(destination, "resources", "app", "main.js"), "// locally edited");
    result = await powershell(join(destination, "uninstall.ps1"), "-RemoveUserData");
    assert.notEqual(result.code, 0, "no user-data deletion switch exists");
    assert.ok(await exists(join(destination, "Slopsidian.exe")));
    result = await powershell(join(destination, "uninstall.ps1"), "-Quiet");
    assert.equal(result.code, 0, result.out);
    assert.equal(await exists(join(destination, "Slopsidian.exe")), false);
    assert.equal(await readFile(join(destination, "resources", "app", "main.js"), "utf8"), "// locally edited");
    assert.equal(await exists(join(shortcuts, "Slopsidian.lnk")), false);
    assert.equal(await readFile(join(dataDirectory, "vault-note.md"), "utf8"), "precious");
    const key = await run("powershell.exe", ["-NoProfile", "-Command", `Test-Path '${registry}'`]);
    assert.equal(key.stdout.trim(), "False");
  } finally {
    await run("powershell.exe", ["-NoProfile", "-Command", `if (Test-Path '${registry}') { Remove-Item '${registry}' -Force }`]).catch(() => {});
  }
});

test("an upgrade retains its complete committed install when previous-file cleanup fails partway", async () => {
  const base = join(scratch, "cleanup-failure");
  const destination = join(base, "Slopsidian App");
  const first = await powershell(installer, "-PackageZip", await fakePackage("cleanup-v1", "1.0.0"), "-InstallDir", destination, "-NoShortcuts", "-NoRegistration");
  assert.equal(first.code, 0, first.out);
  const wrapper = join(scratch, "inject-cleanup-failure.ps1");
  await writeFile(wrapper, `param([string]$InstallerScript, [string]$Archive, [string]$Destination)
$ErrorActionPreference = 'Stop'
function Remove-Item {
  param([string]$LiteralPath, [switch]$Recurse, [switch]$Force, [string]$ErrorAction)
  if ($LiteralPath -like '*.previous-*') {
    Microsoft.PowerShell.Management\\Remove-Item -LiteralPath (Join-Path $LiteralPath 'resources\\app\\main.js') -Force
    throw 'Injected failure after removing one previous-install file.'
  }
  Microsoft.PowerShell.Management\\Remove-Item @PSBoundParameters
}
& $InstallerScript -PackageZip $Archive -InstallDir $Destination -NoShortcuts -NoRegistration
`);
  const second = await powershell(wrapper, "-InstallerScript", installer, "-Archive", await fakePackage("cleanup-v2", "2.0.0"), "-Destination", destination);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /previous-install files remain/);
  assert.match(second.out, /Injected failure after removing one/);
  assert.equal(await readFile(join(destination, "resources", "app", "main.js"), "utf8"), "// 2.0.0");
  assert.equal(await readFile(join(destination, "Slopsidian.exe"), "utf8"), "MZ fake 2.0.0");
  const manifest = JSON.parse((await readFile(join(destination, "install-manifest.json"), "utf8")).replace(/^\uFEFF/, ""));
  assert.equal(manifest.version, "2.0.0");
  for (const item of manifest.files) { assert.equal(await sha256File(join(destination, ...item.path.split("/"))), item.sha256, item.path); }
});

test("installer rejects unsafe archives and registry locations without touching an existing install", async () => {
  const destination = join(scratch, "guarded", "Slopsidian App");
  assert.equal((await powershell(installer, "-PackageZip", await fakePackage("g1", "1.0.0"), "-InstallDir", destination, "-NoShortcuts", "-NoRegistration")).code, 0);
  const evil = join(scratch, "evil-src");
  await mkdir(join(evil, "resources", "app"), { recursive: true });
  await writeFile(join(evil, "Slopsidian.exe"), "x");
  await writeFile(join(evil, "resources", "app", "package.json"), "{\"version\":\"9\"}");
  await writeFile(join(evil, "uninstall.ps1"), "collision");
  const evilZip = join(scratch, "evil.zip");
  await writeZip(evil, evilZip);
  const collision = await powershell(installer, "-PackageZip", evilZip, "-InstallDir", destination, "-NoShortcuts", "-NoRegistration");
  assert.notEqual(collision.code, 0);
  assert.equal(await readFile(join(destination, "resources", "app", "main.js"), "utf8"), "// 1.0.0");
  for (const registry of ["HKCU:\\Software", "HKCU:\\Software\\Microsoft", "HKLM:\\Software\\Slopsidian", "HKCU:\\Software\\SlopsidianPackagingTest\\a\\b"]) {
    assert.notEqual((await powershell(installer, "-PackageZip", await fakePackage("g2", "2.0.0"), "-InstallDir", join(scratch, "guarded", "Other"), "-NoShortcuts", "-RegistryPath", registry)).code, 0, registry);
  }
  assert.equal(await exists(join(scratch, "guarded", "Other", "Slopsidian.exe")), false);
});

test("uninstall refuses tampered manifests before removing anything", async () => {
  const destination = join(scratch, "tamper", "Slopsidian App");
  assert.equal((await powershell(installer, "-PackageZip", await fakePackage("t1", "1.0.0"), "-InstallDir", destination, "-NoShortcuts", "-NoRegistration")).code, 0);
  const outside = join(scratch, "tamper", "outside.txt");
  await writeFile(outside, "keep");
  const manifestPath = join(destination, "install-manifest.json");
  const original = (await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, "");
  const variants = [
    manifest => { manifest.files[0].path = "../../outside.txt"; },
    manifest => { manifest.registryPath = "HKCU:\\Software\\Microsoft"; },
    manifest => { manifest.shortcut = outside; },
    manifest => { manifest.installDir = scratch; },
  ];
  for (const mutate of variants) {
    const manifest = JSON.parse(original);
    mutate(manifest);
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await powershell(join(destination, "uninstall.ps1"), "-Quiet");
    assert.notEqual(result.code, 0);
    assert.ok(await exists(join(destination, "Slopsidian.exe")), "nothing removed after refusal");
    assert.equal(await readFile(outside, "utf8"), "keep");
  }
});

test("package output cleanup refuses roots, sources, reserved/overlapping names, unmarked and linked directories", async () => {
  const { resolveOwnedOutput, prepareOwnedOutput, outputMarker } = await import("../tools/release/lib.mjs");
  const work = join(scratch, "work");
  await mkdir(join(work, "stage"), { recursive: true });
  await writeFile(join(work, "stage", "keep.txt"), "stage");
  const unmarked = join(work, "mine");
  await mkdir(unmarked, { recursive: true });
  await writeFile(join(unmarked, "precious.txt"), "precious");
  const linkTarget = join(scratch, "link-target");
  await mkdir(linkTarget, { recursive: true });
  await writeFile(join(linkTarget, "precious.txt"), "precious");
  await run("cmd.exe", ["/c", "mklink", "/J", join(work, "linked"), linkTarget]);
  const nested = join(work, "a", "b");
  const rejected = [repositoryRoot, join(repositoryRoot, "src"), join(repositoryRoot, "tools"), work, join(work, ".."), scratch, join(work, "stage"), join(work, "host"), join(work, "evidence"), nested, join(work, "x y"), unmarked, join(work, "linked"), "C:\\"];
  for (const candidate of rejected) { await assert.rejects(() => prepareOwnedOutput(candidate, work), undefined, candidate); }
  assert.equal(await readFile(join(work, "stage", "keep.txt"), "utf8"), "stage");
  assert.equal(await readFile(join(unmarked, "precious.txt"), "utf8"), "precious");
  assert.equal(await readFile(join(linkTarget, "precious.txt"), "utf8"), "precious");
  const fresh = await prepareOwnedOutput(join(work, "out"), work);
  await writeFile(join(fresh, "artifact.zip"), "x");
  assert.ok(await exists(join(fresh, outputMarker)));
  assert.equal(await resolveOwnedOutput(fresh, work), fresh);
  await prepareOwnedOutput(fresh, work);
  assert.equal(await exists(join(fresh, "artifact.zip")), false);
});

test("uninstall retains a modified uninstall script instead of deleting it unconditionally", async () => {
  const destination = join(scratch, "retain", "Slopsidian App");
  assert.equal((await powershell(installer, "-PackageZip", await fakePackage("r1", "1.0.0"), "-InstallDir", destination, "-NoShortcuts", "-NoRegistration")).code, 0);
  const script = join(destination, "uninstall.ps1");
  await writeFile(script, (await readFile(script, "utf8")) + "\r\n# locally modified\r\n");
  const result = await powershell(script);
  assert.equal(result.code, 0, result.out);
  assert.equal(await exists(join(destination, "Slopsidian.exe")), false);
  assert.match(await readFile(script, "utf8"), /locally modified/);
  assert.match(result.out, /uninstall\.ps1/);
});

test("output resolution only treats ENOENT as absent and fails closed on other filesystem errors", async () => {
  const { resolveOwnedOutput, prepareOwnedOutput } = await import("../tools/release/lib.mjs");
  const work = join(scratch, "work-enoent");
  await mkdir(work, { recursive: true });
  const target = join(work, "fresh");
  assert.equal(await resolveOwnedOutput(target, work), target);
  const denied = Object.assign(new Error("access denied"), { code: "EACCES" });
  const { lstat } = await import("node:fs/promises");
  for (const failing of [target, work]) {
    await assert.rejects(() => resolveOwnedOutput(target, work, { inspect: async path => { if (path === failing) { throw denied; } return lstat(path); } }), /Cannot inspect.*EACCES/);
  }
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "keep.txt"), "keep");
  await assert.rejects(() => resolveOwnedOutput(target, work, { inspect: async path => { if (path.endsWith(".slopsidian-owned-output")) { throw denied; } return lstat(path); } }), /Cannot inspect/);
  assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep");
});

function fakeSocket() {
  const socket = new EventTarget();
  socket.sent = [];
  socket.send = text => { socket.sent.push(JSON.parse(text)); };
  socket.close = () => { socket.dispatchEvent(new Event("close")); };
  socket.reply = message => socket.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(message) }));
  return socket;
}
const never = new Promise(() => {});

test("Browser.close disconnect is an expected outcome measured to process exit without waiting for a command timeout", async () => {
  const { createCdpClient, closeBrowserAndMeasure } = await import("../tools/release/launch.mjs");
  const socket = fakeSocket();
  const client = createCdpClient(socket, { timeoutMs: 5000 });
  const exited = new Promise(resolve => setTimeout(() => { socket.close(); resolve(0); }, 60));
  const started = performance.now();
  const result = await closeBrowserAndMeasure(client, exited, { exitTimeoutMs: 2000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.closeCommand, "disconnected");
  assert.equal(result.exitCode, 0);
  assert.ok(result.ms >= 50 && result.ms < 1000 && performance.now() - started < 1000);
  assert.equal(socket.sent[0].method, "Browser.close");
});

test("an exit before any CDP response and an acknowledgement are both expected; a real error and a silent timeout are failures", async () => {
  const { createCdpClient, closeBrowserAndMeasure } = await import("../tools/release/launch.mjs");
  let socket = fakeSocket();
  let result = await closeBrowserAndMeasure(createCdpClient(socket, { timeoutMs: 5000 }), Promise.resolve(0), { exitTimeoutMs: 500 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.closeCommand, /process-exited-before-response|disconnected/);

  socket = fakeSocket();
  const ack = createCdpClient(socket, { timeoutMs: 5000 });
  const pending = closeBrowserAndMeasure(ack, new Promise(resolve => setTimeout(() => resolve(0), 40)), { exitTimeoutMs: 500 });
  socket.reply({ id: 1, result: {} });
  result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.closeCommand, "acknowledged");

  socket = fakeSocket();
  const failing = closeBrowserAndMeasure(createCdpClient(socket, { timeoutMs: 5000 }), never, { exitTimeoutMs: 100 });
  socket.reply({ id: 1, error: { message: "Browser.close is not allowed" } });
  result = await failing;
  assert.equal(result.ok, false);
  assert.equal(result.closeCommand, "failed");
  assert.match(result.error, /not allowed/);

  socket = fakeSocket();
  result = await closeBrowserAndMeasure(createCdpClient(socket, { timeoutMs: 30 }), never, { exitTimeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.closeCommand, "timeout");
  assert.equal(result.graceful, false);
  assert.equal(result.exitCode, null);
});

test("a close acknowledged but followed by no process exit is reported as a failure; closed clients reject new commands", async () => {
  const { createCdpClient, closeBrowserAndMeasure, CdpDisconnectedError } = await import("../tools/release/launch.mjs");
  const socket = fakeSocket();
  const client = createCdpClient(socket, { timeoutMs: 5000 });
  const pending = closeBrowserAndMeasure(client, never, { exitTimeoutMs: 80 });
  socket.reply({ id: 1, result: {} });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /did not exit/);
  await assert.rejects(() => client.send("Runtime.evaluate"), CdpDisconnectedError);
});

test("evidence text is sanitized of checkout and home paths", async () => {
  const { sanitize } = await import("../tools/release/launch.mjs");
  const { homedir } = await import("node:os");
  const text = sanitize(`failed at ${repositoryRoot}\\x and ${homedir()}\\y`);
  assert.ok(!text.includes(repositoryRoot) && !text.includes(homedir()));
});
