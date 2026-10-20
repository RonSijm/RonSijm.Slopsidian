import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCoreBenchmark } from "../tools/core-benchmark.mjs";

const contract = {
  schemaVersion: 1,
  reference: { registryCount: 2 },
  commonCases: [{ id: "lifecycle" }, { id: "settings" }, { id: "restart" }],
  plugins: [
    { id: "first", name: "First", workflows: [{ id: "workflow" }] },
    { id: "second", name: "Second", workflows: [{ id: "workflow" }] },
  ],
};
const smoke = {
  scope: "implemented-core-foundations",
  communityPluginsTested: false,
  status: "passed",
  coreChecks: [{ id: "first:workflow", status: "passed" }],
};

test("a passing foundation leaves lifecycle/settings/restart and other core modules incomplete", () => {
  const report = summarizeCoreBenchmark(contract, smoke);
  assert.equal(report.status, "incomplete");
  assert.equal(report.summary.requiredCases, 8);
  assert.equal(report.summary.passedCases, 1);
  assert.equal(report.summary.untestedCases, 7);
  assert.equal(report.summary.candidateCompletePlugins, 0);
  assert.equal(report.plugins[0].status, "partial");
  assert.equal(report.plugins[1].status, "not-tested");
  assert.equal(report.referenceRuntimeComparison, "not-performed");
});

test("failed desktop/case results cannot produce a passing benchmark", () => {
  const desktopFailure = summarizeCoreBenchmark(contract, { ...smoke, status: "failed", error: "Renderer failed" });
  assert.equal(desktopFailure.status, "failed");
  assert.equal(desktopFailure.desktopError, "Renderer failed");
  const report = summarizeCoreBenchmark(contract, { ...smoke, coreChecks: [{ id: "first:workflow", status: "failed" }] });
  assert.equal(report.status, "failed");
  assert.equal(report.plugins[0].status, "failed");
  assert.equal(report.summary.failedCases, 1);
});

test("complete candidate coverage does not claim reference runtime equivalence", () => {
  const coreChecks = contract.plugins.flatMap(plugin => [...contract.commonCases, ...plugin.workflows]
    .map(test => ({ id: `${plugin.id}:${test.id}`, status: "passed" })));
  const report = summarizeCoreBenchmark(contract, { ...smoke, coreChecks });
  assert.equal(report.status, "candidate-passed");
  assert.equal(report.summary.candidateCompletePlugins, 2);
  assert.equal(report.referenceRuntimeComparison, "not-performed");
});

test("unknown, duplicate and community-plugin observations are rejected", () => {
  assert.throws(() => summarizeCoreBenchmark(contract, { ...smoke, coreChecks: [{ id: "unknown:workflow", status: "passed" }] }), /Unknown core case/);
  assert.throws(() => summarizeCoreBenchmark(contract, { ...smoke, coreChecks: [...smoke.coreChecks, ...smoke.coreChecks] }), /Duplicate core case/);
  assert.throws(() => summarizeCoreBenchmark(contract, { ...smoke, communityPluginsTested: true }), /Community-plugin/);
});
