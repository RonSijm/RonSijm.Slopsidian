import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function summarizeCoreBenchmark(contract, smoke) {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.reference.registryCount, contract.plugins.length);
  assert.equal(new Set(contract.plugins.map(plugin => plugin.id)).size, contract.plugins.length, "Core plugin IDs must be unique");
  assert.equal(smoke.scope, "implemented-core-foundations");
  assert.equal(smoke.communityPluginsTested, false, "Community-plugin results do not establish core coverage");
  assert.ok(["passed", "failed"].includes(smoke.status));
  const plugins = contract.plugins.map(plugin => ({
    id: plugin.id,
    name: plugin.name,
    dependencies: plugin.dependencies ?? [],
    cases: [...contract.commonCases, ...plugin.workflows].map(test => ({
      id: `${plugin.id}:${test.id}`,
      description: test.description,
    })),
  }));
  const required = new Set(plugins.flatMap(plugin => plugin.cases.map(test => test.id)));
  assert.equal(required.size, plugins.reduce((count, plugin) => count + plugin.cases.length, 0), "Required case IDs must be unique");
  const observations = new Map();
  for (const observation of smoke.coreChecks) {
    assert.ok(required.has(observation.id), `Unknown core case: ${observation.id}`);
    assert.ok(!observations.has(observation.id), `Duplicate core case: ${observation.id}`);
    assert.ok(["passed", "failed"].includes(observation.status), `Invalid result for ${observation.id}`);
    observations.set(observation.id, observation);
  }
  for (const plugin of plugins) {
    for (const test of plugin.cases) {
      const observation = observations.get(test.id);
      test.status = observation?.status ?? "not-tested";
    }
    plugin.status = plugin.cases.some(test => test.status === "failed") ? "failed"
      : plugin.cases.every(test => test.status === "passed") ? "candidate-passed"
      : plugin.cases.some(test => test.status === "passed") ? "partial" : "not-tested";
  }
  const cases = plugins.flatMap(plugin => plugin.cases);
  return {
    schemaVersion: 1,
    reference: contract.reference,
    status: smoke.status === "failed" || plugins.some(plugin => plugin.status === "failed") ? "failed"
      : plugins.every(plugin => plugin.status === "candidate-passed") ? "candidate-passed" : "incomplete",
    referenceRuntimeComparison: "not-performed",
    communityPluginsTested: false,
    desktopError: smoke.error,
    summary: {
      requiredPlugins: plugins.length,
      candidateCompletePlugins: plugins.filter(plugin => plugin.status === "candidate-passed").length,
      partialPlugins: plugins.filter(plugin => plugin.status === "partial").length,
      untestedPlugins: plugins.filter(plugin => plugin.status === "not-tested").length,
      failedPlugins: plugins.filter(plugin => plugin.status === "failed").length,
      requiredCases: cases.length,
      passedCases: cases.filter(test => test.status === "passed").length,
      failedCases: cases.filter(test => test.status === "failed").length,
      untestedCases: cases.filter(test => test.status === "not-tested").length,
    },
    smokeEvidence: smoke.startupMode === "explicit-vault" ? "explicit-vault-smoke.json" : "core-smoke.json",
    candidateArtifacts: smoke.artifacts,
    plugins,
  };
}

if (import.meta.main) {
  assert.ok(!process.argv.includes("--community"), "The core benchmark does not run community plugins");
  const reportOnly = process.argv.includes("--report-only");
  const startedAt = Date.now();
  let desktopFailed = false;
  if (!reportOnly) {
    try {
      await import("./smoke.mjs");
    } catch (error) {
      desktopFailed = true;
      console.error("The core desktop scenario failed:", error);
    }
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const evidence = join(root, ".runtime", "evidence");
  const smokeEvidence = process.argv.includes("--explicit-vault") ? "explicit-vault-smoke.json" : "core-smoke.json";
  const contract = JSON.parse(await readFile(join(root, "shared", "core-plugins.json"), "utf8"));
  const smoke = JSON.parse(await readFile(join(evidence, smokeEvidence), "utf8"));
  if (!reportOnly) {
    assert.ok(Date.parse(smoke.startedAt) >= startedAt, "The desktop scenario did not produce a fresh report; refusing stale results");
  }
  if (desktopFailed) {
    assert.equal(smoke.status, "failed", "The failed desktop scenario did not record its failure");
  }
  assert.ok(smoke.status === "failed" || smoke.artifacts?.length, "Run npm run smoke before summarizing core coverage");
  for (const artifact of smoke.artifacts ?? []) {
    const hash = createHash("sha256").update(await readFile(join(root, artifact.path))).digest("hex");
    assert.equal(hash, artifact.sha256, `Stale desktop evidence: ${artifact.path}; rerun npm run smoke`);
  }
  const report = summarizeCoreBenchmark(contract, smoke);
  report.artifactBinding = smoke.artifacts?.length ? "verified-current" : "unavailable-for-failed-run";
  report.generatedAt = new Date().toISOString();
  await writeFile(join(evidence, "core-plugin-benchmark.json"), JSON.stringify(report, null, 2) + "\n");
  console.table(report.plugins.map(plugin => ({
    Plugin: plugin.name,
    Status: plugin.status,
    "Candidate checks": `${plugin.cases.filter(test => test.status === "passed").length}/${plugin.cases.length}`,
  })));
  console.log(`${report.summary.candidateCompletePlugins}/${report.summary.requiredPlugins} modules pass all required candidate cases; ${report.summary.passedCases}/${report.summary.requiredCases} cases passed. Reference runtime equivalence has not been established.`);
  process.exitCode = report.status === "candidate-passed" ? 0 : 1;
}
