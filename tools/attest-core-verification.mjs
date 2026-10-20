import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { coreVerificationInputs } from "./core-verification-inputs.mjs";
import { coreVerificationTargets } from "./core-verification-targets.mjs";

export function verifyCoreEvidence(report, contract, fingerprint, reference) {
  assert.equal(report.status, "passed", "Only a completed passing run can attest verification");
  assert.equal(report.scope, "core-verification-targets");
  assert.equal(report.artifactStability, "verified-through-scenario");
  assert.equal(report.sourceFingerprint, fingerprint, "Evidence must match the current source");
  assert.deepEqual([...report.verificationTargets].sort(), [...coreVerificationTargets].sort());
  assert.deepEqual(reference.failures, []);
  assert.equal(reference.version, contract.reference.version);
  assert.deepEqual(report.browserErrors ?? report.exceptions, [], "No uncaught runtime errors are accepted");
  assert.equal(report.errorLogAudit?.status, "passed", "A complete error-log audit is required");
  assert.deepEqual(report.errorLogAudit.unexpected, [], "Reported errors must be explicitly accounted for");
  assert.equal(report.errorLogAudit.includesFinalTeardown, true);
  assert.ok(Number.isFinite(Date.parse(report.completedAt)));
  const known = new Set(contract.plugins.flatMap(plugin => [...contract.commonCases, ...plugin.workflows].map(test => plugin.id + ":" + test.id)));
  const observed = new Map();
  for (const test of report.coreChecks) {
    assert.ok(known.has(test.id), "Unknown case: " + test.id);
    assert.ok(!observed.has(test.id), "Duplicate case: " + test.id);
    assert.equal(test.status, "passed", test.id);
    observed.set(test.id, test);
  }
  const result = {};
  for (const id of coreVerificationTargets) {
    const plugin = contract.plugins.find(plugin => plugin.id === id);
    const requiredCases = [...contract.commonCases, ...plugin.workflows].map(test => id + ":" + test.id);
    for (const key of requiredCases) assert.ok(observed.has(key), "Missing case: " + key);
    const original = reference.results.filter(item => item.id === id);
    assert.equal(original.length, 1, "Exactly one original reference observation: " + id);
    assert.equal(original[0].status, "passed");
    const candidate = report.coreSettingsAvailability.find(state => state.id === id);
    assert.equal(candidate?.implemented, true);
    assert.equal(candidate.settingsSupport, original[0].settings.present ? "implemented" : "none", "Reference settings-page availability: " + id);
    result[id] = { status: "verified-workflows", requiredCases, passedCases: [...requiredCases], checkedAt: report.completedAt };
  }
  return result;
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  assert.equal(process.argv.length, 4, "Usage: node tools/attest-core-verification.mjs <validated-candidate-root> <reference-lifecycle-settings.json>");
  const candidate = resolve(process.argv[2]);
  const referencePath = resolve(process.argv[3]);
  const fingerprint = (await coreVerificationInputs(root)).sourceFingerprint;
  assert.equal((await coreVerificationInputs(candidate)).sourceFingerprint, fingerprint, "Candidate and workspace source must match");
  const readJSON = async path => JSON.parse(await readFile(path, "utf8"));
  const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");
  const contractPath = join(root, "shared/core-plugins.json"), contract = await readJSON(contractPath);
  const reference = await readJSON(referencePath);
  const desktopPath = join(candidate, ".runtime/evidence/core-verification-smoke.json");
  const webPath = join(candidate, ".runtime/evidence/core-verification-web-smoke.json");
  const desktop = await readJSON(desktopPath), web = await readJSON(webPath);
  const hosts = { desktop: verifyCoreEvidence(desktop, contract, fingerprint, reference), web: verifyCoreEvidence(web, contract, fingerprint, reference) };
  for (const report of [desktop, web]) assert.equal(await hash(report.errorLogAudit.path), report.errorLogAudit.sha256, "Audited error logfile must match the retained evidence");
  for (const item of desktop.artifacts) assert.equal(await hash(join(candidate, item.path)), item.sha256, "Desktop evidence artifact: " + item.path);
  for (const [path, expected] of Object.entries(web.sha256)) assert.equal(await hash(join(candidate, ".runtime/web/wwwroot", path)), expected, "WASM evidence artifact: " + path);
  for (const [path, expected] of Object.entries(web.scenarioSha256)) {
    assert.equal(await hash(join(candidate, path.includes("/") ? path : "tools/" + path)), expected, "WASM scenario: " + path);
  }
  const record = {
    schemaVersion: 1, sourceFingerprint: fingerprint, hosts,
    scope: "The 27 requested implemented modules: tested workflows, lifecycle, settings availability/configuration, desktop process restart and browser reload/reconnection. This is not complete Obsidian, visual, private API, service, or physical microphone equivalence.",
    reference: { version: reference.version, scope: reference.scope, sha256: await hash(referencePath) },
    evidence: { contractSha256: await hash(contractPath), desktopReportSha256: await hash(desktopPath), webReportSha256: await hash(webPath) },
  };
  await writeFile(join(root, "shared/core-verification.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ sourceFingerprint: fingerprint, modulesPerHost: coreVerificationTargets.length, casesPerHost: Object.values(hosts.desktop).reduce((sum, entry) => sum + entry.passedCases.length, 0) }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
