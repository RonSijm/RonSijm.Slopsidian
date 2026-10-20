import { execFile } from "node:child_process";
import { cpus, platform, release, totalmem, tmpdir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { repositoryRoot, sourceFingerprint } from "./lib.mjs";

const run = promisify(execFile);

export const evidenceDirectory = join(repositoryRoot, ".runtime", "package", "evidence");

export async function machineDescription() {
  const dotnet = await run("dotnet", ["--version"], { cwd: tmpdir() }).then(result => result.stdout.trim(), () => "unavailable");
  return { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? "unknown", logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version, dotnetSdk: dotnet };
}

// Every evidence file names the exact artifacts and source tree it measured and carries no implied acceptance.
export async function writeEvidence(name, body, { artifacts = {} } = {}) {
  await mkdir(evidenceDirectory, { recursive: true });
  const evidence = {
    schemaVersion: 1, kind: name, generatedUtc: new Date().toISOString(),
    acceptance: "Regression-gate evidence only; no accepted performance target exists.",
    source: await sourceFingerprint(), machine: await machineDescription(), artifacts, ...body,
  };
  const path = join(evidenceDirectory, name + ".json");
  await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
  return { path, evidence };
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) { return null; }
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

export const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
