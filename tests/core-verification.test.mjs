import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { corePluginDescriptions } from "../client/core-plugin-descriptions.ts";
import { verifiedCoreWorkflows } from "../client/core-verification.ts";
import { buildCoreVerificationCatalog, coreVerificationInputs } from "../tools/core-verification-inputs.mjs";
import { verifyCoreEvidence } from "../tools/attest-core-verification.mjs";
import { coreVerificationTargets } from "../tools/core-verification-targets.mjs";

const contract = JSON.parse(await readFile(new URL("../shared/core-plugins.json", import.meta.url), "utf8"));
const requirements = Object.fromEntries(contract.plugins.map(plugin => [plugin.id, [...contract.commonCases, ...plugin.workflows].map(test => plugin.id + ":" + test.id)]));
const entry = id => ({ status: "verified-workflows", checkedAt: "2026-10-27T12:00:00.000Z", requiredCases: [...requirements[id]], passedCases: [...requirements[id]] });
const catalog = () => ({ schemaVersion: 1, sourceFingerprint: "current", hosts: { desktop: { outline: entry("outline") }, web: {} } });

test("every fixed core module has a distinct, useful feature description", () => {
  assert.deepEqual(Object.keys(corePluginDescriptions).sort(), contract.plugins.map(plugin => plugin.id).sort());
  assert.equal(new Set(Object.values(corePluginDescriptions)).size, 31);
  for (const text of Object.values(corePluginDescriptions)) assert.ok(text.length > 20 && !/being verified/.test(text));
});

test("verification requires current source, host and the full fixed module contract", () => {
  const good = catalog();
  assert.equal(verifiedCoreWorkflows(good, "current", "desktop", "outline", requirements)?.status, "verified-workflows");
  assert.equal(verifiedCoreWorkflows(good, "stale", "desktop", "outline", requirements), null);
  assert.equal(verifiedCoreWorkflows(good, "current", "web", "outline", requirements), null);
  for (const change of [value => value.hosts.desktop.outline.passedCases.pop(), value => value.hosts.desktop.outline.requiredCases.pop(),
    value => value.hosts.desktop.outline.passedCases.push(requirements.outline[0]), value => value.hosts.desktop.outline.requiredCases.push(requirements.outline[0]),
    value => value.hosts.desktop.outline.passedCases[0] = "outline:invented", value => value.hosts.desktop.outline.status = "failed",
    value => value.hosts.desktop.outline.checkedAt = "invalid", value => value.schemaVersion = 2,
    value => { value.hosts.desktop.outline.requiredCases = []; value.hosts.desktop.outline.passedCases = []; }]) {
    const value = catalog(); change(value); assert.equal(verifiedCoreWorkflows(value, "current", "desktop", "outline", requirements), null);
  }
  assert.equal(verifiedCoreWorkflows(good, "current", "desktop", "toString", requirements), null);
  const inherited = catalog(); inherited.hosts.desktop = Object.create({ outline: entry("outline") });
  assert.equal(verifiedCoreWorkflows(inherited, "current", "desktop", "outline", requirements), null);
});

test("source identity normalizes line endings, changes with code, and excludes generated attestation", async () => {
  const root = await mkdtemp(new URL("../.runtime/core-verification-unit-", import.meta.url));
  for (const dir of ["client", "desktop", "shared", "tools", "tests", "src/RonSijm.Slopsidian/wwwroot", "plugins"]) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, "package.json"), "{}\n"); await writeFile(join(root, "package-lock.json"), "{}\n");
  await writeFile(join(root, "client/test.ts"), "first\r\nsecond\r\n");
  const first = await coreVerificationInputs(root);
  await writeFile(join(root, "client/test.ts"), "first\nsecond\n");
  assert.equal((await coreVerificationInputs(root)).sourceFingerprint, first.sourceFingerprint);
  assert.deepEqual((await buildCoreVerificationCatalog(root, first.sourceFingerprint)).hosts, { desktop: {}, web: {} });
  await writeFile(join(root, "shared/core-verification.json"), JSON.stringify(catalog()));
  await writeFile(join(root, "src/RonSijm.Slopsidian/wwwroot/core-verification.json"), "generated metadata");
  assert.equal((await coreVerificationInputs(root)).sourceFingerprint, first.sourceFingerprint);
  assert.deepEqual((await buildCoreVerificationCatalog(root, "new-source")).hosts, { desktop: {}, web: {} });
  await writeFile(join(root, "shared/core-plugins.json"), JSON.stringify(contract));
  const accepted = catalog(); accepted.sourceFingerprint = "matching";
  await writeFile(join(root, "shared/core-verification.json"), JSON.stringify(accepted));
  assert.deepEqual((await buildCoreVerificationCatalog(root, "matching")).hosts, accepted.hosts);
  accepted.hosts.desktop.outline.passedCases.pop();
  await writeFile(join(root, "shared/core-verification.json"), JSON.stringify(accepted));
  await assert.rejects(buildCoreVerificationCatalog(root, "matching"), /Incomplete/);
  await writeFile(join(root, "client/test.ts"), "changed\n");
  assert.notEqual((await coreVerificationInputs(root)).sourceFingerprint, first.sourceFingerprint);
});

test("attestation rejects failed, stale, duplicate, missing and invented observations", () => {
  const reference = { version: contract.reference.version, failures: [], results: coreVerificationTargets.map(id => ({ id, status: "passed", settings: { present: false } })) };
  const report = { status: "passed", scope: "core-verification-targets", artifactStability: "verified-through-scenario", sourceFingerprint: "current", verificationTargets: [...coreVerificationTargets], completedAt: "2026-10-27T12:00:00Z", exceptions: [], errorLogAudit: { status: "passed", unexpected: [], includesFinalTeardown: true },
    coreSettingsAvailability: coreVerificationTargets.map(id => ({ id, implemented: true, settingsSupport: "none" })),
    coreChecks: coreVerificationTargets.flatMap(id => requirements[id].map(key => ({ id: key, status: "passed" }))) };
  assert.equal(Object.keys(verifyCoreEvidence(report, contract, "current", reference)).length, 27);
  for (const change of [r => r.errorLogAudit.status = "failed", r => r.errorLogAudit.unexpected.push("caught"), r => r.status = "failed", r => r.sourceFingerprint = "old", r => r.coreChecks.pop(),
    r => r.coreChecks.push(r.coreChecks[0]), r => r.coreChecks[0].status = "failed", r => r.coreChecks[0].id = "outline:imaginary", r => r.exceptions.push("uncaught"),
    r => r.coreSettingsAvailability[0].settingsSupport = "implemented"]) {
    const bad = structuredClone(report); change(bad); assert.throws(() => verifyCoreEvidence(bad, contract, "current", reference));
  }
});
