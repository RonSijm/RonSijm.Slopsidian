import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coreVerificationInputs } from "./core-verification-inputs.mjs";
import { root, startHost } from "../tests/host.mjs";

const options = { notes: 5000, runs: 7, out: undefined };
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!["--notes", "--runs", "--out"].includes(name) || value === undefined) throw new Error("Use --notes <count>, --runs <count> and optional --out <report path>.");
  options[name.slice(2)] = name === "--out" ? value : Number(value);
}
if (!Number.isInteger(options.notes) || options.notes < 1 || options.notes > 20000
  || !Number.isInteger(options.runs) || options.runs < 1 || options.runs > 30) {
  throw new Error("The benchmark supports 1-20000 notes and 1-30 measured runs.");
}
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const round = value => Math.round(value * 10) / 10;

function note(index) {
  const lines = ["---", `title: Note ${index}`, `tags: [bench, group${index % 50}]`, "---", `# Note ${index}`, ""];
  let seed = index * 2654435761 % 4294967296;
  while (lines.join("\n").length < 2200) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    lines.push(`Line ${seed.toString(36)} links to [[Note ${seed % options.notes}]] and #tag${seed % 97} with unicode \u00e9\u4e2d.`);
  }
  return lines.join("\n") + "\n";
}

const inputsBefore = await coreVerificationInputs(root);
await mkdir(join(root, ".runtime"), { recursive: true });
const directory = await mkdtemp(join(root, ".runtime", "metadata-bench-"));
let host;
try {
  let sourceBytes = 0;
  for (let index = 0; index < options.notes; index++) {
    const folder = join(directory, `Folder ${index % 50}`);
    if (index < 50) await mkdir(folder, { recursive: true });
    const text = note(index);
    sourceBytes += Buffer.byteLength(text);
    await writeFile(join(folder, `Note ${index}.md`), text);
  }
  const dll = join(root, "src", "RonSijm.Slopsidian", "bin", "Debug", "net10.0", "RonSijm.Slopsidian.dll");
  const binaryBefore = sha(await readFile(dll));
  host = await startHost(directory);
  const samples = [];
  let coldMs, responseBytes, responseSha256;
  for (let run = 0; run <= options.runs; run++) {
    const started = performance.now();
    const response = await host.request("/api/metadata/documents?root=" + encodeURIComponent(directory));
    const body = Buffer.from(await response.arrayBuffer());
    const elapsed = performance.now() - started;
    if (response.status !== 200) throw new Error(`Unexpected metadata status ${response.status}: ${body.toString("utf8").slice(0, 200)}`);
    const payload = JSON.parse(body.toString("utf8"));
    if (payload.root !== directory || payload.documents.length !== options.notes || payload.errors.length) throw new Error("The benchmark returned an incomplete or wrong-root metadata result.");
    responseBytes = body.length;
    responseSha256 = sha(body);
    if (run === 0) coldMs = elapsed;
    else samples.push(elapsed);
  }
  const memory = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-Process -Id ${host.pid} | Select-Object WorkingSet64,PeakWorkingSet64,PrivateMemorySize64 | ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true }));
  const inputsAfter = await coreVerificationInputs(root);
  if (inputsAfter.sourceFingerprint !== inputsBefore.sourceFingerprint || sha(await readFile(dll)) !== binaryBefore) throw new Error("Source or binary changed during the benchmark; refusing to bind the report.");
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  const report = {
    generatedAt: new Date().toISOString(), notes: options.notes, sourceBytes, runs: options.runs,
    hostBinary: { path: dll, sha256: binaryBefore },
    coreVerificationInputs: { ...inputsAfter, unchangedDuringRun: true },
    limits: "Debug host build; cold timings depend on OS cache and scanner state. This is measured evidence, not an accepted product budget.",
    coldMs: round(coldMs), responseBytes, responseSha256,
    medianMs: round(percentile(0.5)), p95Ms: round(percentile(0.95)), maxMs: round(sorted.at(-1)),
    samplesMs: samples.map(round), hostMemory: memory,
  };
  if (options.out) await writeFile(options.out, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...report, coreVerificationInputs: { sourceFingerprint: inputsAfter.sourceFingerprint, unchangedDuringRun: true } }, null, 2));
} finally {
  try { if (host) await host.stop(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
