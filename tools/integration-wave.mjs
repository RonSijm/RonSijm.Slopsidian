// Serial, resumable acceptance of the bounded local integration wave.
// --plan is read-only; --run --validate builds/tests before any real UI work.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { coreVerificationInputs } from "./core-verification-inputs.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const repository = fileURLToPath(new URL("../", import.meta.url));
const minimumChecks = {
  properties: [13, 25], docking: [8, 20], "folder-operations": [7, 19], "math-embeds": [8, 20],
  "hotkeys-secrets": [12, 24], "persistent-drafts": [15, 27], viewers: [21, 33], "viewer-proofs": [4, 16],
  "configuration-lifecycle": [9, 21], "appearance-themes": [15, 27], "groups-popouts": [13, 22],
  "outline-panes": [15, 27], "github-index-ui": [1, 13], "original-floating-import": [2, 14],
};
const shared = [
  ["core", "--verify-core", "core-verification", "core-verification-targets"],
  ["audio", "--audio", "audio", "audio-recorder-runtime"],
  ["properties", "--properties", "properties", ["properties-runtime", "properties-workspace-and-file-preferences"]],
  ["docking", "--docking", "docking", "workspace-docking"],
  ["file-explorer", "--file-explorer", "file-explorer", "file-explorer-workspace-panes"],
  ["folder-operations", "--folder-operations", "folder-operations", "folder-operations-explorer-dialogs"],
  ["math-embeds", "--math-embeds", "math-embeds", "math-embeds-runtime"],
  ["hotkeys-secrets", "--hotkeys-secrets", "hotkeys-secrets", "hotkeys-secrets-runtime"],
  ["persistent-drafts", "--persistent-drafts", "persistent-drafts", ["desktop-persistent-markdown-draft-recovery", "browser-persistent-markdown-draft-recovery"]],
  ["viewers", "--viewers", "viewers", "attachment-viewers"],
  ["viewer-proofs", "--viewer-proofs", "viewer-proofs", "attachment-viewer-proofs"],
  ["appearance-resources", "--appearance-resources", "appearance-resources", "local-appearance-resources"],
  ["configuration-lifecycle", "--configuration-lifecycle", "configuration-lifecycle", "configuration-lifecycle-runtime"],
  ["system-trash", "--system-trash", "system-trash", ["windows-system-trash-connected-app-and-shell-restore", "standalone-system-trash-refusal"]],
  ["attachments", "--attachments", "attachments", "shared-note-attachment-import"],
  ["history", "--history", "history", "workspace-history"],
  ["community-install", "--community-install", "community-install", "community-catalog-install-update-uninstall"],
  ["appearance-themes", "--appearance-themes", "appearance-themes", "reviewed-theme-management"],
  ["groups-popouts", "--groups-popouts", "groups-popouts", "workspace-groups-popouts"],
  ["outline-panes", "--outline-panes", "outline-panes", "outline-workspace-panes"],
  ["github-index-ui", "--github-index-ui", "github-index-ui", "github-cached-index-dialog"],
  ["original-floating-import", "--original-floating-import", "original-floating-import", "original-floating-workspace-import"],
  ["native-recents", "--native-recents", "native-recents", ["native-recent-vaults", "native-recent-vaults-browser-boundary"]],
  ["renderers", "--renderers", "renderers", "markdown-postprocessors-runtime"],
  ["editor-chrome", "--editor-chrome", "editor-chrome", "editor-chrome-runtime"],
  ["templater", "--templater", "templater", "actual-templater-runtime"],
];
export const integrationMatrix = Object.freeze([
  ...shared.flatMap(([name, flag, prefix, scope]) => ["desktop", "web"].map((host, index) => ({
    id: `${host}:${name}`, name, host, runner: `tools/${host === "desktop" ? "smoke" : "web-smoke"}.mjs`, args: [flag],
    report: `${prefix}${host === "web" ? "-web" : ""}-smoke`, scope: Array.isArray(scope) ? scope[index] : scope,
    kind: "shared", minimumChecks: minimumChecks[name]?.[index] ?? 1, timeoutMs: name === "core" ? 45 * 60_000 : 30 * 60_000,
  }))),
  { id: "desktop:filter-subscriptions", name: "filter-subscriptions", host: "desktop", runner: "tools/webviewer-smoke.mjs", args: ["--adblock-subscriptions"], report: "web-adblock-subscriptions-smoke", audit: "web-adblock-subscriptions-errors.jsonl", outputPrefix: "web-adblock-subscriptions", scope: "desktop-web-ad-filter-subscriptions", kind: "viewer", timeoutMs: 30 * 60_000 },
  { id: "desktop:reader-appearance", name: "reader-appearance", host: "desktop", runner: "tools/webviewer-smoke.mjs", args: ["--reader-appearance-only"], report: "web-reader-appearance-only-smoke", audit: "web-reader-appearance-only-errors.jsonl", outputPrefix: "web-reader-appearance-only", scope: "desktop-web-reader-appearance-only", kind: "viewer", timeoutMs: 30 * 60_000 },
  { id: "desktop:popout-close-recovery", name: "popout-close-recovery", host: "desktop", runner: "tools/smoke.mjs", args: ["--groups-popouts"], env: { SLOPSIDIAN_GROUPS_POPOUTS_ONLY: "forced-close" }, report: "groups-popouts-forced-close-diagnostic-smoke", scope: "workspace-groups-popouts-forced-close-diagnostic", kind: "shared", timeoutMs: 30 * 60_000 },
  { id: "desktop:os-tab-drag", name: "os-tab-drag", host: "desktop", runner: "tools/smoke.mjs", args: ["--groups-popouts"], env: { SLOPSIDIAN_GROUPS_POPOUTS_ONLY: "os-drag" }, report: "groups-popouts-os-drag-smoke", scope: "workspace-groups-popouts-native-os-drag", kind: "shared", timeoutMs: 30 * 60_000 },
  { id: "web:popup-refusal", name: "popup-refusal", host: "web", runner: "tools/web-smoke.mjs", args: ["--groups-popouts"], env: { SLOPSIDIAN_WEB_POPUP: "blocked" }, report: "groups-popouts-refusal-control-web-smoke", scope: "workspace-groups-popouts-refusal-control", kind: "shared", timeoutMs: 30 * 60_000 },
  { id: "web:offline-shell", name: "offline-shell", host: "web", runner: "tools/offline-shell-smoke.mjs", args: [], report: "offline-shell-web-smoke", kind: "offline", timeoutMs: 45 * 60_000 },
]);

export function selectCases(matrix, only = [], passed = new Set()) {
  for (const selector of only) assert.ok(matrix.some(item => item.id === selector || item.name === selector || item.host === selector), `Unknown matrix selector: ${selector}`);
  return matrix.filter(item => !passed.has(item.id) && (!only.length || only.some(selector => [item.id, item.name, item.host].includes(selector))));
}

export function auditReport(item, report, fingerprint) {
  assert.equal(report.status, "passed", `${item.id}: runner did not pass`);
  assert.equal(report.sourceFingerprint, fingerprint, `${item.id}: stale source identity`);
  if (item.kind === "offline") {
    assert.equal(report.coreVerificationInputs?.before, fingerprint);
    assert.equal(report.coreVerificationInputs?.after, fingerprint);
    assert.equal(report.coreVerificationInputs?.unchangedDuringRun, true);
    assert.equal(report.scenarios?.length, 18, "Full offline collection requires all 18 scenarios");
    const pages = report.scenarios.flatMap(scenario => scenario.pages ?? []);
    assert.equal(pages.length, 21, "Full offline collection requires 21 enforced pages");
    assert.equal(report.diagnostics?.length, pages.length);
    assert.equal(report.unexpectedPageRecords, 0);
    for (const page of [...pages, ...report.diagnostics]) {
      assert.equal(page.enforced, true);
      for (const key of ["errors", "failures", "responses", "external"]) assert.deepEqual(page.unexpected?.[key], [], `Offline ${page.page}: unexpected ${key}`);
    }
    for (const page of report.diagnostics) {
      assert.equal(page.exitCode, 0); assert.equal(page.forcedKill, false);
      assert.equal(page.quitLog?.drain?.drained, true);
      for (const key of ["committed", "acknowledged", "exited"]) assert.equal(page.quitLog?.[key], true);
      assert.equal(page.quitLog?.forced, false); assert.equal(page.quitLog?.deadlineHit, false); assert.equal(page.quitLog?.rejected, null);
    }
    return { scenarios: 18, pages: 21, unexpected: 0 };
  }
  assert.equal(report.scope, item.scope, `${item.id}: a diagnostic or different scope cannot replace the required collection`);
  assert.equal(report.artifactStability, "verified-through-scenario");
  assert.equal(report.errorLogAudit?.status, "passed");
  assert.equal(report.errorLogAudit?.includesFinalTeardown, true);
  assert.deepEqual(report.errorLogAudit?.unexpected, []);
  for (const key of ["exceptions", "browserErrors", "runtimeErrors"]) if (report[key]) assert.deepEqual(report[key], [], `${item.id}: uncaught ${key}`);
  assert.ok(report.checks?.length >= (item.minimumChecks ?? 1), `The scenario must retain its complete workflow checks (${item.minimumChecks ?? 1} minimum)`);
  if (item.name === "core") assert.equal(report.coreChecks?.length, 123, "All 123 requested core cases must run");
  if (item.host === "web") {
    const shutdown = report.browserShutdown;
    assert.equal(shutdown?.exitCode, 0); assert.equal(shutdown?.signal, null); assert.equal(shutdown?.forced, false);
    assert.equal(shutdown?.rejected, null); assert.equal(shutdown?.quit?.drain?.drained, true);
    for (const key of ["committed", "acknowledged", "exited"]) assert.equal(shutdown?.quit?.[key], true);
    assert.equal(shutdown?.quit?.forced, false); assert.equal(shutdown?.quit?.deadlineHit, false);
    assert.equal(report.rendererNodeIntegration, false); assert.equal(report.realExternalDirectoryPicker, true);
  } else if (item.kind === "shared") {
    assert.equal(report.exitCode, 0); assert.equal(report.exitSignal, null);
    assert.ok(report.processes?.length, "Native generations must be retained");
    for (const generation of report.processes) {
      if (generation.forcedTermination) {
        assert.equal(item.name, "persistent-drafts", "Only the declared recovery scenario may deliberately crash a generation");
        assert.equal(generation.exitCode, 1); assert.equal(generation.exitSignal, null);
      } else {
        assert.equal(generation.exitCode, 0); assert.equal(generation.exitSignal, null); assert.equal(generation.deadlineExpired, false);
      }
    }
    assert.notEqual(report.processes.at(-1).forcedTermination, true, "Final teardown must be clean even in crash-recovery scenarios");
  } else {
    // The dedicated viewer runner asserts each native exit and records shutdownError on failure.
    assert.equal(report.shutdownError, undefined); assert.ok(report.processes?.length);
  }
  return { checks: report.checks.length, expectedErrors: report.errorLogAudit.expected, unexpected: 0 };
}

async function hashFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
async function filesBelow(root, folder) {
  const files = [];
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Build artifact cannot be a link or special file: ${path}`);
  }
  return files;
}
export async function captureInputs(root) {
  const source = await coreVerificationInputs(root);
  return source;
}
export async function captureArtifacts(root, fingerprint) {
  const nativeCatalog = "src/RonSijm.Slopsidian/wwwroot/core-verification.json", webCatalog = ".runtime/web/wwwroot/core-verification.json";
  for (const path of [nativeCatalog, webCatalog]) {
    const catalog = JSON.parse(await readFile(join(root, path), "utf8"));
    assert.equal(catalog.sourceFingerprint, fingerprint, `${path} is stale; run --validate after source edits finish`);
  }
  const paths = ["src/RonSijm.Slopsidian/bin/Debug/net10.0/RonSijm.Slopsidian.dll",
    ...await filesBelow(root, "src/RonSijm.Slopsidian/wwwroot"), ...await filesBelow(root, ".runtime/web")];
  const artifacts = [];
  for (const path of paths.sort()) artifacts.push({ path: path.replaceAll("\\", "/"), bytes: (await stat(join(root, path))).size, sha256: await hashFile(join(root, path)) });
  return artifacts;
}

export function validationCommands(root, packageJson) {
  // Preserve the repository's real test-file list rather than maintaining a competing one.
  const match = /^npm run typecheck && node --test --test-concurrency=1 (.+)$/.exec(packageJson.scripts.test);
  assert.ok(match, "The default test command changed; update this runner explicitly");
  const tests = match[1].split(/\s+/);
  assert.ok(tests.every(path => /^tests[\\/][A-Za-z0-9_.-]+\.mjs$/.test(path)), "Unexpected default test argument");
  const sdk = process.platform === "win32" ? join(root, ".runtime", "dotnet", "dotnet.exe") : "dotnet";
  return [
    { id: "typecheck", command: process.execPath, args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
    { id: "build-ui", command: process.execPath, args: ["tools/build.mjs"] },
    { id: "build-native", command: sdk, args: ["build", "src/RonSijm.Slopsidian/RonSijm.Slopsidian.csproj", "--configuration", "Debug", "--nologo"] },
    { id: "publish-web", command: process.execPath, args: ["tools/publish-web.mjs", "--base=/"] },
    { id: "verify-web", command: process.execPath, args: ["tools/verify-web.mjs", "--base=/"] },
    { id: "default-regressions", command: process.execPath, args: ["--test", "--test-concurrency=1", ...tests] },
    { id: "github-regressions", command: process.execPath, args: ["--test", "tests/github-vault.test.mjs"] },
  ];
}

export function runChild({ root, command = process.execPath, args, env, logPath, timeoutMs }) {
  return new Promise((resolveRun, reject) => {
    const log = createWriteStream(logPath, { flags: "wx" });
    let deadlineExpired = false, spawnError = null, forcedCleanup = null;
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => log.write(bytes));
    child.on("error", error => { spawnError = String(error.stack ?? error); });
    const timer = setTimeout(() => {
      deadlineExpired = true;
      if (process.platform === "win32") {
        forcedCleanup = { pid: child.pid, method: "taskkill owned runner tree" };
        spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else { forcedCleanup = { pid: child.pid, method: "SIGKILL owned runner" }; child.kill("SIGKILL"); }
    }, timeoutMs);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      log.end(() => resolveRun({ command, args, pid: child.pid ?? null, startedAt, completedAt: new Date().toISOString(), exitCode, signal, deadlineExpired, forcedCleanup, spawnError, logPath }));
    });
    log.on("error", reject);
  });
}

function processEnvironment(root, item = {}) {
  const env = { ...process.env };
  for (const key of ["SLOPSIDIAN_GROUPS_POPOUTS_ONLY", "SLOPSIDIAN_WEB_POPUP", "SLOPSIDIAN_OUTLINE_ONLY", "SMOKE_FOCUS", "SMOKE_SOURCE_FINGERPRINT"]) delete env[key];
  const sdkRoot = join(root, ".runtime", "dotnet");
  if (process.platform === "win32") {
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
    env[pathKey] = sdkRoot + ";" + (env[pathKey] ?? ""); env.DOTNET_ROOT = sdkRoot;
  }
  return { ...env, ...item.env, DOTNET_CLI_HOME: join(root, ".runtime", "dotnet-home"), DOTNET_CLI_TELEMETRY_OPTOUT: "1" };
}
function assertChild(result) {
  assert.equal(result.exitCode, 0, `Command failed; see ${result.logPath}`);
  assert.equal(result.signal, null); assert.equal(result.deadlineExpired, false); assert.equal(result.spawnError, null);
}
export function regressionSummary(text) {
  const numbers = {};
  for (const name of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const match = new RegExp(`^(?:# |ℹ )${name} (\\d+)\\r?$`, "m").exec(text);
    assert.ok(match, `Missing Node test summary: ${name}`); numbers[name] = Number(match[1]);
  }
  assert.ok(numbers.tests > 0); assert.equal(numbers.pass, numbers.tests);
  for (const name of ["fail", "cancelled", "skipped", "todo"]) assert.equal(numbers[name], 0, `Regression suite has ${name}`);
  return numbers;
}
async function preserveOutputs(evidence, destination, item) {
  await mkdir(destination, { recursive: true });
  const prefix = item.outputPrefix ?? item.report.replace(/(?:-web)?-smoke$/, "");
  const outputs = [];
  for (const name of await readdir(evidence)) {
    if (!(name === item.report + ".json" || name === (item.audit ?? item.report + "-errors.jsonl") || name.startsWith(prefix + "-"))) continue;
    const from = join(evidence, name); if (!(await stat(from)).isFile()) continue;
    await copyFile(from, join(destination, name));
    outputs.push({ name, sha256: await hashFile(from) });
  }
  return outputs;
}
export function matrixStatus(matrix, results, validation) {
  const passed = new Set(results.filter(result => result.status === "passed").map(result => result.id));
  const pending = matrix.filter(item => !passed.has(item.id)).map(item => item.id);
  return { status: results.some(result => result.status === "failed") ? "failed" : pending.length || validation?.status !== "passed" ? "incomplete" : "passed", required: matrix.length, passed: passed.size, pending };
}

export async function runIntegration({ root = repository, only = [], resume, validate = false, execute = runChild, matrix = integrationMatrix, readInputs = captureInputs, readArtifacts = captureArtifacts, notify = console.log } = {}) {
  selectCases(matrix, only);
  const evidence = join(root, ".runtime", "evidence"); await mkdir(evidence, { recursive: true });
  const runDirectory = join(evidence, "integration-wave-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
  await mkdir(runDirectory);
  const before = await readInputs(root), fingerprint = before.sourceFingerprint;
  await writeFile(join(runDirectory, "inputs-before.json"), JSON.stringify(before, null, 2));
  const receipt = { schemaVersion: 1, status: "incomplete", startedAt: new Date().toISOString(), sourceFingerprint: fingerprint, requiredMatrix: matrix, validation: null, results: [], limits: ["This finite local runtime matrix does not establish whole application/private/visual/plugin parity, authorized Sync/Publish, physical storage quota, signing/publication/updates, or installed/portable release acceptance."] };
  const receiptPath = join(runDirectory, "receipt.json");
  const save = async () => { Object.assign(receipt, matrixStatus(matrix, receipt.results, receipt.validation)); await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n"); };
  try {
    if (resume) {
      const prior = JSON.parse(await readFile(resolve(resume), "utf8"));
      assert.equal(prior.schemaVersion, 1); assert.equal(prior.sourceFingerprint, fingerprint, "Cannot reuse acceptance after source changes");
      assert.deepEqual(prior.requiredMatrix, matrix, "Cannot shrink or change the required matrix on resume");
      assert.equal(prior.validation?.status, "passed", "Resume requires a successful retained validation");
      receipt.resumedFrom = resolve(resume); receipt.validation = prior.validation;
      for (const command of prior.validation.commands) assert.equal(await hashFile(command.logPath), command.logSha256, "A retained validation log changed");
      // Re-open and re-audit original reports rather than trusting a copied summary.
      for (const result of prior.results.filter(result => result.status === "passed")) {
        const item = matrix.find(item => item.id === result.id); assert.ok(item);
        const bytes = await readFile(result.retainedReport); assert.equal(sha256(bytes), result.reportSha256);
        auditReport(item, JSON.parse(bytes), fingerprint);
        for (const output of result.outputs) assert.equal(await hashFile(join(resolve(result.retainedReport, ".."), output.name)), output.sha256, "A retained report, screenshot or error log changed");
        assert.equal(await hashFile(result.process.logPath), result.process.logSha256, "A retained runner log changed");
        receipt.results.push(result);
      }
    }
    if (validate) {
      assert.equal(receipt.results.length, 0, "Build validation cannot be rerun while reusing earlier runtime results");
      receipt.validation = { status: "running", sourceFingerprint: fingerprint, commands: [] }; await save();
      const commands = validationCommands(root, JSON.parse(await readFile(join(root, "package.json"), "utf8")));
      for (const command of commands) {
        notify(`VALIDATE ${command.id}`);
        const result = await execute({ root, ...command, env: processEnvironment(root), logPath: join(runDirectory, command.id + ".log"), timeoutMs: 45 * 60_000 });
        result.logSha256 = await hashFile(result.logPath);
        receipt.validation.commands.push(result); await save(); assertChild(result);
        if (command.id.endsWith("regressions")) result.testSummary = regressionSummary(await readFile(result.logPath, "utf8"));
        assert.equal((await readInputs(root)).sourceFingerprint, fingerprint, "Source changed during validation; rebuild after edits finish");
      }
      receipt.validation.status = "passed";
      receipt.validation.artifacts = await readArtifacts(root, fingerprint);
    }
    assert.equal(receipt.validation?.status, "passed", "Use --validate for a new source epoch, or --resume a matching validated receipt");
    assert.deepEqual(await readArtifacts(root, fingerprint), receipt.validation.artifacts, "Compiled artifacts changed after the recorded validation");
    const selected = selectCases(matrix, only, new Set(receipt.results.map(result => result.id)));
    for (const item of selected) {
      const directory = join(runDirectory, item.id.replace(":", "-")); await mkdir(directory);
      const result = { id: item.id, status: "running", startedAt: new Date().toISOString() }; receipt.results.push(result); await save();
      try {
        const inputs = await readInputs(root); await writeFile(join(directory, "inputs-before.json"), JSON.stringify(inputs, null, 2));
        assert.equal(inputs.sourceFingerprint, fingerprint);
        assert.deepEqual(await readArtifacts(root, fingerprint), receipt.validation.artifacts);
        result.previousOutputs = await preserveOutputs(evidence, join(directory, "previous"), item);
        notify(`RUN ${item.id}`);
        result.process = await execute({ root, command: process.execPath, args: [item.runner, ...item.args], env: processEnvironment(root, item), logPath: join(directory, "runner.log"), timeoutMs: item.timeoutMs });
        result.process.logSha256 = await hashFile(result.process.logPath);
        result.outputs = await preserveOutputs(evidence, join(directory, "outputs"), item);
        const after = await readInputs(root); await writeFile(join(directory, "inputs-after.json"), JSON.stringify(after, null, 2));
        assert.equal(after.sourceFingerprint, fingerprint); assert.deepEqual(await readArtifacts(root, fingerprint), receipt.validation.artifacts);
        assertChild(result.process);
        result.retainedReport = join(directory, "outputs", item.report + ".json");
        const bytes = await readFile(result.retainedReport), report = JSON.parse(bytes);
        assert.ok(Date.parse(report.startedAt) >= Date.parse(result.startedAt), "The runner did not produce a fresh report");
        result.audit = auditReport(item, report, fingerprint); result.reportSha256 = sha256(bytes);
        if (item.kind !== "offline") {
          const errorPath = join(directory, "outputs", item.audit ?? item.report + "-errors.jsonl");
          assert.equal(await hashFile(errorPath), report.errorLogAudit.sha256, "Retained final error log differs from the audited log");
        }
        result.status = "passed"; notify(`PASS ${item.id}`);
      } catch (error) { result.status = "failed"; result.error = String(error.stack ?? error); notify(`FAIL ${item.id}: ${error.message}`); }
      result.completedAt = new Date().toISOString(); await save();
      if ((await readInputs(root)).sourceFingerprint !== fingerprint) throw new Error("Source changed: remaining scopes must await a fresh validation");
    }
    const after = await readInputs(root); await writeFile(join(runDirectory, "inputs-after.json"), JSON.stringify(after, null, 2));
    assert.equal(after.sourceFingerprint, fingerprint); assert.deepEqual(await readArtifacts(root, fingerprint), receipt.validation.artifacts);
  } catch (error) { receipt.failure = String(error.stack ?? error); if (receipt.validation?.status === "running") receipt.validation.status = "failed"; }
  receipt.completedAt = new Date().toISOString(); await save();
  if (receipt.failure) { receipt.status = "failed"; await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n"); }
  notify(`${receipt.status.toUpperCase()} ${receipt.passed}/${receipt.required}; receipt: ${receiptPath}`);
  return { receipt, receiptPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), only = [], options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--run" || arg === "--validate" || arg === "--plan") options[arg.slice(2)] = true;
    else if (arg.startsWith("--only=")) only.push(...arg.slice(7).split(","));
    else if (arg === "--only") only.push(...String(args[++index] ?? "").split(","));
    else if (arg.startsWith("--resume=")) options.resume = arg.slice(9);
    else if (arg === "--resume") options.resume = args[++index];
    else throw new Error(`Unknown integration argument: ${arg}`);
  }
  if (!options.run) {
    selectCases(integrationMatrix, only);
    console.log(JSON.stringify({ status: "plan-only", required: integrationMatrix.length, selected: selectCases(integrationMatrix, only), validation: ["typecheck", "build-ui", "build-native", "publish-web", "verify-web", "default-regressions", "github-regressions"], instructions: "Run --run --validate for a fresh epoch; --resume <receipt> continues matching passed scopes without reducing the full matrix. --only is explicitly partial. Packaging acceptance remains separate." }, null, 2));
  } else {
    const { receipt } = await runIntegration({ ...options, only });
    if (receipt.status === "failed") process.exitCode = 1;
  }
}
