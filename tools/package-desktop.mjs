// Builds the unsigned Windows desktop packages: a portable ZIP and an IExpress self-extracting per-user installer.
// Everything is staged from an explicit allow-list under .runtime\package; nothing is copied from vaults,
// profiles, .runtime fixtures or node_modules except the pinned Electron runtime and the generated filter engine.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile, readdir, rm, writeFile, copyFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { promisify } from "node:util";
import { formatBytes, parseArguments, prepareOwnedOutput, resolveOwnedOutput, repositoryRoot as root, scanPackageTree, sourceFingerprint } from "./release/lib.mjs";
import { listFiles, readZipEntries, sha256File, writeZip } from "./release/zip.mjs";
import { transformMain } from "./release/transform-main.mjs";

const exec = promisify(execFile);
const options = parseArguments(process.argv.slice(2), { out: "string", "skip-ui-build": "flag", "skip-publish": "flag", "no-installer": "flag", "include-source-maps": "flag", typecheck: "flag" });
const work = join(root, ".runtime", "package");
const out = await resolveOwnedOutput(options.out ?? join(work, "out"));
const stage = join(work, "stage", "Slopsidian");
const hostOutput = join(work, "host");
const manifest = { schemaVersion: 1, product: "Slopsidian", unsigned: true, startedUtc: new Date().toISOString() };

async function run(command, args, { cwd = root, env = {}, quiet = false } = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: command.endsWith(".cmd") });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) { stream.setEncoding("utf8"); stream.on("data", text => { log += text; if (!quiet) { process.stdout.write(text); } }); }
  const [code] = await once(child, "exit");
  return { code, log };
}

const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const electronPackage = JSON.parse(await readFile(join(root, "node_modules", "electron", "package.json"), "utf8"));
const electronDist = join(root, "node_modules", "electron", "dist");
if ((await readFile(join(electronDist, "version"), "utf8")).trim() !== electronPackage.version) { throw new Error("Installed Electron does not match package.json. Run npm run setup:runtime."); }
manifest.version = rootPackage.version;
manifest.electron = electronPackage.version;
manifest.node = process.version;
manifest.source = await sourceFingerprint();

if (options.typecheck) {
  const result = await run("npx.cmd", ["tsc", "--noEmit"]);
  if (result.code !== 0) { throw new Error("Typecheck failed."); }
}
if (!options["skip-ui-build"]) {
  const result = await run(process.execPath, [join(root, "tools", "build.mjs")]);
  if (result.code !== 0) { throw new Error("UI build failed."); }
}

if (!options["skip-publish"]) {
  await rm(hostOutput, { recursive: true, force: true });
  const project = join(root, "src", "RonSijm.Slopsidian", "RonSijm.Slopsidian.csproj");
  const publish = ["publish", project, "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true", "--output", hostOutput, "--nologo",
    "-p:DebugType=none", "-p:DebugSymbols=false", "-p:ContinuousIntegrationBuild=true", "-p:Deterministic=true"];
  let result = await run("dotnet", publish);
  manifest.sdkResolution = "repository global.json";
  if (result.code !== 0) {
    throw new Error(/compatible \.NET SDK was not found/i.test(result.log)
      ? "The SDK pinned in global.json is not available. Install it, or set DOTNET_ROOT and PATH to a directory containing that SDK (for example .runtime\\dotnet), then retry. global.json is never bypassed."
      : "dotnet publish failed.");
  }
}
manifest.dotnetSdk = (await exec("dotnet", ["--version"], { cwd: root })).stdout.trim();

// Stage the application.
await rm(join(work, "stage"), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(electronDist, stage, { recursive: true, filter: source => !/[\\/]resources[\\/]default_app\.asar$/i.test(source) });
await cp(join(stage, "electron.exe"), join(stage, "Slopsidian.exe"));
await rm(join(stage, "electron.exe"));
const app = join(stage, "resources", "app");
await mkdir(join(app, "desktop"), { recursive: true });
for (const file of await readdir(join(root, "desktop"))) {
  if (!file.endsWith(".cjs")) { continue; }
  if (file === "main.cjs") { await writeFile(join(app, "desktop", file), transformMain(await readFile(join(root, "desktop", file), "utf8"))); }
  else { await copyFile(join(root, "desktop", file), join(app, "desktop", file)); }
}
await mkdir(join(app, "shared"), { recursive: true });
for (const file of await readdir(join(root, "shared"))) {
  if (file.endsWith(".cjs")) { await copyFile(join(root, "shared", file), join(app, "shared", file)); }
}
await copyFile(join(root, "tools", "release", "packaged-main.cjs"), join(app, "packaged-main.cjs"));
await writeFile(join(app, "package.json"), JSON.stringify({ name: "slopsidian", productName: "Slopsidian", version: rootPackage.version, main: "packaged-main.cjs", description: rootPackage.description }, null, 2) + "\n");
await mkdir(join(app, "vendor", "easylist"), { recursive: true });
for (const file of ["easylist.txt", "provenance.json", "LICENSE-CC-BY-SA-3.0.txt"]) { await copyFile(join(root, "vendor", "easylist", file), join(app, "vendor", "easylist", file)); }
await mkdir(join(app, ".runtime", "web-adblock"), { recursive: true });
for (const file of await readdir(join(root, ".runtime", "web-adblock"))) {
  if (/^engine\.cjs(\.LEGAL\.txt)?$/.test(file) || /^engine.*\.txt$/.test(file) || /license|notice/i.test(file)) { await copyFile(join(root, ".runtime", "web-adblock", file), join(app, ".runtime", "web-adblock", file)); }
}
await cp(hostOutput, join(app, "src", "RonSijm.Slopsidian"), { recursive: true });
let sourceMapsRemoved = 0;
if (!options["include-source-maps"]) {
  for (const file of await listFiles(join(app, "src", "RonSijm.Slopsidian", "wwwroot"))) {
    if (file.endsWith(".map")) { await rm(join(app, "src", "RonSijm.Slopsidian", "wwwroot", ...file.split("/"))); sourceMapsRemoved++; }
  }
}
manifest.sourceMapsRemoved = sourceMapsRemoved;
await writeFile(join(stage, "portable.txt"), "Portable mode: user data is stored in the Data folder beside Slopsidian.exe. The installer ignores this file.\r\n");
await writeFile(join(stage, "PACKAGE-INFO.txt"), [
  `Slopsidian ${rootPackage.version} (win-x64) - UNSIGNED development package`,
  `Electron ${electronPackage.version}; self-contained .NET host (no machine-wide .NET required).`,
  `Source fingerprint: ${manifest.source.sha256} (HEAD ${manifest.source.head}).`,
  "This package is not code-signed and has no update channel. Windows SmartScreen may warn.",
  "No original vaults, profiles, credentials or compatibility fixtures are included.",
  "Third-party notices: LICENSE, LICENSES.chromium.html, resources\\app\\src\\RonSijm.Slopsidian\\wwwroot\\*LICENSE*.txt and *.LEGAL.txt.",
  "",
].join("\r\n"));

const required = ["Slopsidian.exe", "resources/app/package.json", "resources/app/packaged-main.cjs", "resources/app/desktop/main.cjs", "resources/app/desktop/web-viewer.cjs",
  "resources/app/.runtime/web-adblock/engine.cjs", "resources/app/vendor/easylist/easylist.txt", "resources/app/src/RonSijm.Slopsidian/RonSijm.Slopsidian.exe",
  "resources/app/src/RonSijm.Slopsidian/RonSijm.Slopsidian.dll", "resources/app/src/RonSijm.Slopsidian/wwwroot/js/web-reader-extract.js", "resources/app/src/RonSijm.Slopsidian/wwwroot/app.css", "LICENSE"];
const staged = new Set(await listFiles(stage));
const missing = required.filter(file => !staged.has(file));
// Every relative require() in the staged main-process scripts must resolve inside the package.
for (const file of [...staged].filter(name => /^resources\/app\/(desktop\/|packaged-main\.cjs$)/.test(name) && name.endsWith(".cjs"))) {
  const text = await readFile(join(stage, ...file.split("/")), "utf8");
  for (const match of text.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const target = posix.normalize(posix.join(posix.dirname(file), match[1]));
    if (![target, target + ".cjs", target + ".js", target + ".json"].some(candidate => staged.has(candidate))) { missing.push(`${target} (required by ${file})`); }
  }
}
if (missing.length) { throw new Error("Package is missing required files: " + missing.join(", ")); }
const scan = await scanPackageTree(stage, { forbiddenText: [root, root.replaceAll("\\", "/"), homedir(), homedir().replaceAll("\\", "/")].map(value => value.replace(/[\\/]$/, "")) });
if (scan.violations.length) { throw new Error("Package content policy violations:\n" + scan.violations.map(item => `  ${item.file}: ${item.reason}`).join("\n")); }
manifest.contentScan = { files: scan.files, violations: 0 };

await prepareOwnedOutput(out);
const base = `Slopsidian-${rootPackage.version}-win-x64`;
const zipPath = join(out, base + "-portable.zip");
const zip = await writeZip(stage, zipPath);
manifest.artifacts = { portableZip: { file: base + "-portable.zip", bytes: zip.bytes, entries: zip.entries, sha256: await sha256File(zipPath) } };
await readZipEntries(zipPath);

if (!options["no-installer"]) {
  const installerWork = join(work, "installer");
  await rm(installerWork, { recursive: true, force: true });
  await mkdir(installerWork, { recursive: true });
  for (const file of ["install.ps1", "uninstall.ps1", "setup.cmd"]) { await copyFile(join(root, "tools", "release", file), join(installerWork, file)); }
  await copyFile(zipPath, join(installerWork, "payload.zip"));
  const target = join(out, base + "-setup.exe");
  const sed = join(installerWork, "setup.sed");
  const files = ["setup.cmd", "install.ps1", "uninstall.ps1", "payload.zip"];
  await writeFile(sed, [
    "[Version]", "Class=IEXPRESS", "SEDVersion=3", "[Options]", "PackagePurpose=InstallApp", "ShowInstallProgramWindow=0", "HideExtractAnimation=0", "UseLongFileName=1",
    "InsideCompressed=0", "CAB_FixedSize=0", "CAB_ResvCodeSigning=0", "RebootMode=N", "InstallPrompt=", "DisplayLicense=", "FinishMessage=", `TargetName=${target}`,
    "FriendlyName=Slopsidian setup (unsigned)", "AppLaunched=cmd /d /c setup.cmd", "PostInstallCmd=<None>", "AdminQuietInstCmd=cmd /d /c setup.cmd", "UserQuietInstCmd=cmd /d /c setup.cmd",
    "SourceFiles=SourceFiles", "[SourceFiles]", `SourceFiles0=${installerWork}\\`, "[SourceFiles0]", ...files.map(file => `%FILE${files.indexOf(file)}%=`),
    "[Strings]", ...files.map((file, index) => `FILE${index}="${file}"`), "",
  ].join("\r\n"));
  const iexpress = await run(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "iexpress.exe"), ["/N", "/Q", sed], { quiet: true });
  if (iexpress.code !== 0 || !(await stat(target).catch(() => null))) { throw new Error("IExpress failed to create the installer:\n" + iexpress.log); }
  manifest.artifacts.setup = { file: base + "-setup.exe", bytes: (await stat(target)).size, sha256: await sha256File(target), tool: "IExpress (Windows built-in)", signed: false };
}

const sourceAfter = await sourceFingerprint();
if (sourceAfter.sha256 !== manifest.source.sha256) { throw new Error("Source changed while packaging. The outputs are unaccepted; rebuild after edits finish."); }
manifest.sourceUnchangedDuringBuild = true;
manifest.completedUtc = new Date().toISOString();
manifest.stagedUncompressedBytes = (await Promise.all([...staged].map(async file => (await stat(join(stage, ...file.split("/")))).size))).reduce((sum, size) => sum + size, 0);
await writeFile(join(out, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(out, "SHA256SUMS.txt"), Object.values(manifest.artifacts).map(artifact => `${artifact.sha256}  ${artifact.file}`).join("\n") + "\n");
console.log(`PACKAGE_READY ${out}`);
for (const artifact of Object.values(manifest.artifacts)) { console.log(`  ${artifact.file}  ${formatBytes(artifact.bytes)}  sha256 ${artifact.sha256}`); }
console.log(`  staged tree ${formatBytes(manifest.stagedUncompressedBytes)}; source fingerprint ${manifest.source.sha256}`);
