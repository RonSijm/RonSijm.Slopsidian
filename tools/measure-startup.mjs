// Cold/warm startup of the packaged desktop app, launched from a disposable destination.
//   default      extract the portable ZIP and launch it (portable data directory beside the executable);
//   --installed  run the unsigned Setup.exe into a disposable install directory (test registry key, disposable
//                shortcut directory), launch the INSTALLED copy with user data in a separate disposable directory,
//                then run the installed uninstall.ps1 and verify the install is removed and user data is preserved.
// "Cold" = first launch with an empty profile (the OS file cache cannot be dropped without elevation, so this is
// first-run, not OS-cold). "Warm" = repeated launches reusing that profile. Launching opens a visible window.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseArguments, repositoryRoot as root, formatBytes } from "./release/lib.mjs";
import { percentile, round, writeEvidence } from "./release/evidence.mjs";
import { launchAndMeasure, sanitize } from "./release/launch.mjs";
import { listFiles, sha256File } from "./release/zip.mjs";
import { generateVault } from "./release/vault-generator.mjs";

const run = promisify(execFile);
const options = parseArguments(process.argv.slice(2), { zip: "string", "warm-runs": "number", timeout: "number", notes: "number", installed: "flag" });
const installed = Boolean(options.installed);
const outDirectory = join(root, ".runtime", "package", "out");
const manifest = JSON.parse(await readFile(join(outDirectory, "release-manifest.json"), "utf8"));
const zip = resolve(options.zip ?? join(outDirectory, manifest.artifacts.portableZip.file));
const zipHash = await sha256File(zip);
if (zipHash !== manifest.artifacts.portableZip.sha256 && !options.zip) { throw new Error("Portable ZIP does not match release-manifest.json; rebuild the package."); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const disposable = join(root, ".runtime", "package", "measure", (installed ? "installed-" : "") + stamp);
const extracted = join(disposable, "app");
const vault = join(disposable, "vault");
const userData = join(disposable, "userdata");
const shortcuts = join(disposable, "shortcuts");
const registryName = "startup-" + stamp.replace(/[^A-Za-z0-9-]/g, "");
const registryPath = "HKCU:\\Software\\SlopsidianPackagingTest\\" + registryName;
await mkdir(disposable, { recursive: true });
const vaultInfo = await generateVault(vault, { notes: options.notes ?? 25 });
const powershell = (script) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
const body = { vault: vaultInfo, mode: installed ? "installed" : "portable" };
let installEvidence = null, uninstallEvidence = null, env = {};

if (installed) {
  const setup = manifest.artifacts.setup;
  if (!setup) { throw new Error("release-manifest.json has no installer artifact."); }
  const setupPath = join(outDirectory, setup.file);
  if (await sha256File(setupPath) !== setup.sha256) { throw new Error("Setup.exe does not match release-manifest.json; rebuild the package."); }
  await mkdir(shortcuts, { recursive: true });
  const child = spawn(setupPath, [], { env: { ...process.env, SLOPSIDIAN_INSTALL_DIR: extracted, SLOPSIDIAN_SHORTCUT_DIR: shortcuts, SLOPSIDIAN_REGISTRY_PATH: registryPath }, stdio: "ignore", windowsHide: true });
  await once(child, "exit"); // the self-extractor's exit code is unreliable; the filesystem is verified below
  const manifestPath = join(extracted, "install-manifest.json");
  const installManifest = await readFile(manifestPath, "utf8").then(text => JSON.parse(text.replace(/^\uFEFF/, "")), () => null);
  if (!installManifest) { throw new Error("The installer did not produce install-manifest.json in the disposable destination."); }
  const registered = await powershell(`Test-Path -LiteralPath '${registryPath}'`).then(value => value.stdout.trim() === "True");
  installEvidence = { setup: { file: setup.file, sha256: setup.sha256 }, installedFiles: installManifest.files.length, uninstallScriptPresent: installManifest.files.some(file => file.path === "uninstall.ps1"), registryKeyCreated: registered, shortcutCreated: (await listFiles(shortcuts)).length > 0 };
  env = { SLOPSIDIAN_DATA_DIR: userData };
} else {
  await mkdir(extracted, { recursive: true });
  await run(join(process.env.SystemRoot, "System32", "tar.exe"), ["-xf", zip, "-C", extracted], { maxBuffer: 1 << 20 });
}
const executable = join(extracted, "Slopsidian.exe");
const before = await listFiles(extracted);

const launches = [];
const total = 1 + (options["warm-runs"] ?? 5);
for (let index = 0; index < total; index++) {
  const result = await launchAndMeasure(executable, { args: ["--vault=" + vault], env, cwd: disposable, timeoutMs: (options.timeout ?? 60) * 1000 });
  launches.push({ run: index + 1, kind: index === 0 ? "cold" : "warm", ...result });
  console.log(`${index === 0 ? "cold" : "warm"} #${index + 1}: ${result.ok ? `interactive ${round(result.marks.interactive)} ms, host ${round(result.marks.dotnetHostReady)} ms, memory ${formatBytes(result.workingSetBytes)}, exit ${round(result.shutdown.ms)} ms after Browser.close` : "FAILED " + result.error}`);
  if (!result.ok) { break; }
}

const after = await listFiles(extracted);
const unexpected = after.filter(file => !before.includes(file) && !file.startsWith("Data/"));
let dataOutsideInstall = null;
if (installed) {
  const dataFiles = await listFiles(userData).catch(() => []);
  dataOutsideInstall = { directoryOutsideInstall: true, profileCreated: dataFiles.some(file => file.startsWith("profile/")), installTreeUnchanged: unexpected.length === 0 && !after.some(file => file.startsWith("Data/")) };
  const script = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(extracted, "uninstall.ps1"), "-Quiet"], { windowsHide: true }).then(() => null, error => sanitize(String(error.stderr || error.message)));
  const remaining = await stat(extracted).then(() => true, () => false);
  const registryRemains = await powershell(`Test-Path -LiteralPath '${registryPath}'`).then(value => value.stdout.trim() === "True");
  uninstallEvidence = {
    error: script, installDirectoryRemoved: !remaining, registryKeyRemoved: !registryRemains, shortcutRemoved: (await listFiles(shortcuts).catch(() => [])).length === 0,
    userDataPreserved: (await listFiles(userData).catch(() => [])).some(file => file.startsWith("profile/")),
  };
  if (registryRemains) { await powershell(`Remove-Item -LiteralPath '${registryPath}'`).catch(() => {}); }
}
const metric = kind => launches.filter(item => item.ok && item.kind === kind);
const summarize = (items, selector) => ({ runs: items.length, median: items.length ? round(percentile(items.map(selector), 0.5)) : null, p95: items.length ? round(percentile(items.map(selector), 0.95)) : null, max: items.length ? round(Math.max(...items.map(selector))) : null });
const launchOk = launches.length === total && launches.every(item => item.ok);
const uninstallOk = !installed || (uninstallEvidence.error === null && uninstallEvidence.installDirectoryRemoved && uninstallEvidence.registryKeyRemoved && uninstallEvidence.shortcutRemoved && uninstallEvidence.userDataPreserved);
Object.assign(body, {
  method: installed
    ? "Run Setup.exe into a disposable directory with a test registry key and shortcut directory, launch the installed Slopsidian.exe against a generated vault with user data in a separate disposable directory and a loopback-only CDP port, then close via CDP Browser.close, measuring process exit from the instant the command is sent; finally run the installed uninstall.ps1."
    : "Extract the portable ZIP into a disposable directory, launch Slopsidian.exe (portable data dir) against a generated vault with a loopback-only CDP port, time process spawn to .NET host ready, application page navigation and an interactive workspace, then close via CDP Browser.close and measure process exit from the instant the command is sent.",
  portableZip: { file: manifest.artifacts.portableZip.file, sha256: zipHash },
  allLaunchesSucceeded: launchOk,
  installTreeWritesOutsideData: unexpected,
  cold: summarize(metric("cold"), item => item.marks.interactive),
  warmInteractiveMs: summarize(metric("warm"), item => item.marks.interactive),
  warmDotnetHostReadyMs: summarize(metric("warm"), item => item.marks.dotnetHostReady),
  coldDotnetHostReadyMs: summarize(metric("cold"), item => item.marks.dotnetHostReady),
  workingSetBytesMedian: percentile(launches.filter(item => item.ok).map(item => item.workingSetBytes), 0.5),
  closeToExitMs: summarize(launches.filter(item => item.ok), item => item.shutdown.ms),
  closeMeasurement: "Time from sending Browser.close over CDP to observed exit of the launched process (harness-observed; not a user-interaction close latency).",
  hostSurvivedShutdown: launches.some(item => item.hostSurvived !== false),
  launches: launches.map(({ processTree, ...item }) => ({ ...item, processCount: processTree?.length })),
});
if (installed) { Object.assign(body, { install: installEvidence, dataOutsideInstall, uninstall: uninstallEvidence, defaultDataDirectoryNote: "SLOPSIDIAN_DATA_DIR pointed user data at a disposable directory; the default %APPDATA%\\Slopsidian location was deliberately not exercised so the real profile is untouched.", uninstallSucceeded: uninstallOk }); }
else { body.portableDataCreated = after.some(file => file.startsWith("Data/profile/")); }
const result = await writeEvidence(installed ? "startup-installed" : "startup", body, { artifacts: { portableZip: manifest.artifacts.portableZip, ...(installed ? { setup: manifest.artifacts.setup } : {}) } });
await rm(disposable, { recursive: true, force: true });
console.log((installed ? "STARTUP_INSTALLED_EVIDENCE " : "STARTUP_EVIDENCE ") + result.path);
if (!launchOk || unexpected.length || body.hostSurvivedShutdown || !uninstallOk) { process.exitCode = 1; console.error("Startup measurement did not meet its integrity checks."); }
