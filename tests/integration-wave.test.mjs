import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { auditReport, integrationMatrix, matrixStatus, regressionSummary, runIntegration, selectCases, validationCommands } from "../tools/integration-wave.mjs";

const fingerprint = "a".repeat(64);
const digest = value => createHash("sha256").update(value).digest("hex");
const desktop = integrationMatrix.find(item => item.id === "desktop:properties");
const web = integrationMatrix.find(item => item.id === "web:properties");
function reportFor(item) {
  const report = { status: "passed", scope: item.scope, sourceFingerprint: fingerprint, startedAt: new Date().toISOString(), checks: Array.from({ length: item.minimumChecks ?? 1 }, (_, index) => `actual workflow ${index + 1}`),
    artifactStability: "verified-through-scenario", errorLogAudit: { status: "passed", includesFinalTeardown: true, unexpected: [], expected: 0, sha256: digest("") } };
  if (item.host === "desktop") Object.assign(report, { exitCode: 0, exitSignal: null, processes: [{ exitCode: 0, exitSignal: null, deadlineExpired: false }] });
  else Object.assign(report, { rendererNodeIntegration: false, realExternalDirectoryPicker: true, browserShutdown: { exitCode: 0, signal: null, forced: false, rejected: null,
    quit: { drain: { drained: true }, committed: true, acknowledged: true, exited: true, forced: false, deadlineHit: false } } });
  return report;
}

test("the integration matrix retains both hosts and separates bounded controls from full collections", () => {
  assert.equal(integrationMatrix.length, 58);
  assert.equal(new Set(integrationMatrix.map(item => item.id)).size, integrationMatrix.length);
  for (const name of ["core", "properties", "folder-operations", "math-embeds", "hotkeys-secrets", "persistent-drafts", "viewers", "viewer-proofs", "appearance-resources", "configuration-lifecycle", "system-trash", "attachments", "history", "community-install", "appearance-themes", "groups-popouts", "outline-panes", "renderers", "templater"]) {
    assert.equal(selectCases(integrationMatrix, [name]).length, 2, name);
  }
  const controls = ["desktop:popout-close-recovery", "desktop:os-tab-drag", "web:popup-refusal"];
  for (const id of controls) assert.notEqual(integrationMatrix.find(item => item.id === id).scope, "workspace-groups-popouts");
  assert.equal(selectCases(integrationMatrix, ["web:properties"])[0].id, "web:properties");
  assert.throws(() => selectCases(integrationMatrix, ["--unknown"]), /Unknown matrix selector/);
});

test("partial selections and failed results cannot reduce the complete matrix", () => {
  assert.deepEqual(matrixStatus([desktop, web], [{ id: desktop.id, status: "passed" }], { status: "passed" }), { status: "incomplete", required: 2, passed: 1, pending: [web.id] });
  assert.equal(matrixStatus([desktop], [{ id: desktop.id, status: "passed" }], null).status, "incomplete");
  assert.equal(matrixStatus([desktop], [{ id: desktop.id, status: "failed" }], { status: "passed" }).status, "failed");
  assert.deepEqual(selectCases([desktop, web], [], new Set([desktop.id])), [web]);
});

test("report acceptance rejects stale source, missing teardown audits and diagnostic substitution", () => {
  auditReport(desktop, reportFor(desktop), fingerprint);
  for (const change of [report => { report.sourceFingerprint = "b".repeat(64); }, report => { report.errorLogAudit.includesFinalTeardown = false; }, report => { report.errorLogAudit.unexpected.push({ error: "late" }); }, report => { report.artifactStability = undefined; }, report => { report.scope = "properties-diagnostic-only"; }, report => { report.browserErrors = ["late uncaught error"]; }]) {
    const report = reportFor(desktop); change(report); assert.throws(() => auditReport(desktop, report, fingerprint));
  }
});

test("native intentional crash allowance is confined to earlier persistent-draft generations", () => {
  const recovery = integrationMatrix.find(item => item.id === "desktop:persistent-drafts"), report = reportFor(recovery);
  report.processes.unshift({ forcedTermination: true, exitCode: 1, exitSignal: null });
  auditReport(recovery, report, fingerprint);
  assert.throws(() => auditReport({ ...desktop, scope: recovery.scope }, report, fingerprint), /Only the declared recovery/);
  report.processes.reverse();
  assert.throws(() => auditReport(recovery, report, fingerprint), /Final teardown/);
});

test("browser acceptance requires positive nonce acknowledgement, drain and unforced code-zero exit", () => {
  auditReport(web, reportFor(web), fingerprint);
  for (const change of [report => { delete report.browserShutdown; }, report => { report.browserShutdown.quit.acknowledged = false; }, report => { report.browserShutdown.quit.drain.drained = false; }, report => { report.browserShutdown.forced = true; }, report => { report.browserShutdown.exitCode = 1; }, report => { report.rendererNodeIntegration = true; }]) {
    const report = reportFor(web); change(report); assert.throws(() => auditReport(web, report, fingerprint));
  }
});

test("offline acceptance requires all 18 scenarios, 21 audited pages, and positive clean exits", () => {
  const item = integrationMatrix.find(item => item.kind === "offline");
  const page = { page: "owned", enforced: true, unexpected: { errors: [], failures: [], responses: [], external: [] } };
  const report = { status: "passed", sourceFingerprint: fingerprint, coreVerificationInputs: { before: fingerprint, after: fingerprint, unchangedDuringRun: true }, unexpectedPageRecords: 0,
    scenarios: Array.from({ length: 18 }, (_, index) => ({ pages: Array.from({ length: index < 3 ? 2 : 1 }, () => structuredClone(page)) })),
    diagnostics: Array.from({ length: 21 }, () => ({ ...structuredClone(page), exitCode: 0, forcedKill: false, quitLog: structuredClone(reportFor(web).browserShutdown.quit) })) };
  for (const record of report.diagnostics) record.quitLog.rejected = null;
  auditReport(item, report, fingerprint);
  const partial = structuredClone(report); partial.scenarios.pop(); assert.throws(() => auditReport(item, partial, fingerprint), /18 scenarios/);
  const unenforced = structuredClone(report); unenforced.scenarios[0].pages[0].enforced = false; assert.throws(() => auditReport(item, unenforced, fingerprint));
  const forced = structuredClone(report); forced.diagnostics[0].forcedKill = true; assert.throws(() => auditReport(item, forced, fingerprint));
});

test("validation uses the repository's complete default test list and rejects unknown shell syntax", () => {
  const commands = validationCommands("C:\\owned", { scripts: { test: "npm run typecheck && node --test --test-concurrency=1 tests\\one.test.mjs tests/two.test.mjs" } });
  assert.equal(commands.length, 7);
  assert.deepEqual(commands.find(command => command.id === "default-regressions").args, ["--test", "--test-concurrency=1", "tests\\one.test.mjs", "tests/two.test.mjs"]);
  assert.throws(() => validationCommands("owned", { scripts: { test: "npm run typecheck && node --test --test-concurrency=1 tests/good.test.mjs && exit 0" } }), /Unexpected/);
});

test("validation accepts both actual Node reporters and refuses skipped or incomplete regressions", () => {
  const stats = ["tests 20", "pass 20", "fail 0", "cancelled 0", "skipped 0", "todo 0"];
  for (const prefix of ["# ", "ℹ "]) assert.equal(regressionSummary(stats.map(line => prefix + line).join("\n")).tests, 20);
  assert.throws(() => regressionSummary("log without test totals"), /Missing Node/);
  assert.throws(() => regressionSummary(stats.map(line => "# " + line.replace("skipped 0", "skipped 1")).join("\n")), /skipped/);
});

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), "integration-wave-test-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "npm run typecheck && node --test --test-concurrency=1 tests/one.test.mjs" } }));
    const calls = [], artifacts = [{ path: "owned.dll", sha256: "b".repeat(64) }];
    const execute = async options => {
      calls.push(options); await writeFile(options.logPath, options.args[0] === "--test" ? "# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n" : "retained log\n");
      const item = [desktop, web].find(item => options.args[0] === item.runner);
      if (item) {
        const directory = join(root, ".runtime", "evidence");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, item.report + ".json"), JSON.stringify(reportFor(item)));
        await writeFile(join(directory, item.report + "-errors.jsonl"), "");
      }
      return { exitCode: 0, signal: null, deadlineExpired: false, spawnError: null, logPath: options.logPath };
    };
    await action({ root, calls, execute, options: { root, matrix: [desktop, web], execute, readInputs: async () => ({ sourceFingerprint: fingerprint, sources: [{ path: "test", sha256: fingerprint }] }), readArtifacts: async () => artifacts, notify() {} } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("a partial validated run resumes only pending scopes and keeps source-bound reports and logs", async () => fixture(async ({ calls, options }) => {
  const first = await runIntegration({ ...options, validate: true, only: [desktop.id] });
  assert.equal(first.receipt.status, "incomplete"); assert.equal(first.receipt.required, 2); assert.equal(first.receipt.passed, 1);
  assert.equal(calls.length, 8); assert.equal(first.receipt.validation.commands.length, 7);
  assert.equal(await readFile(first.receipt.results[0].process.logPath, "utf8"), "retained log\n");
  const second = await runIntegration({ ...options, resume: first.receiptPath });
  assert.equal(second.receipt.status, "passed"); assert.equal(second.receipt.passed, 2); assert.equal(calls.length, 9);
  assert.equal(second.receipt.results[0].retainedReport, first.receipt.results[0].retainedReport);
}));

test("resume refuses changed artifacts, source, and tampered retained reports", async () => fixture(async ({ options }) => {
  const first = await runIntegration({ ...options, validate: true, only: [desktop.id] });
  const changed = await runIntegration({ ...options, resume: first.receiptPath, readArtifacts: async () => [{ path: "changed.dll" }] });
  assert.equal(changed.receipt.status, "failed"); assert.match(changed.receipt.failure, /Compiled artifacts changed/);
  const changedSource = await runIntegration({ ...options, resume: first.receiptPath, readInputs: async () => ({ sourceFingerprint: "c".repeat(64), sources: [] }) });
  assert.equal(changedSource.receipt.status, "failed"); assert.match(changedSource.receipt.failure, /source changes/);
  await writeFile(first.receipt.results[0].retainedReport, "{}");
  const tampered = await runIntegration({ ...options, resume: first.receiptPath }); assert.equal(tampered.receipt.status, "failed");
}));

test("a failed scope is retained, later scopes continue, and resume retries the failed scope", async () => fixture(async ({ execute, calls, options }) => {
  const first = await runIntegration({ ...options, validate: true, execute: async input => {
    const result = await execute(input); if (input.args[0] === desktop.runner) result.exitCode = 1; return result;
  } });
  assert.equal(first.receipt.status, "failed"); assert.equal(first.receipt.results.length, 2); assert.equal(first.receipt.passed, 1);
  const count = calls.length;
  const second = await runIntegration({ ...options, resume: first.receiptPath });
  assert.equal(second.receipt.status, "passed"); assert.equal(calls.length, count + 1);
  assert.equal(calls.at(-1).args[0], desktop.runner);
}));
