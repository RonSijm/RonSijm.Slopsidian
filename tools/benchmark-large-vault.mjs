// Bounded large-vault workload: client parse/search engine plus the packaged .NET host (no Electron window, no UI lease needed).
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { build } from "esbuild";
import { parseArguments, repositoryRoot as root } from "./release/lib.mjs";
import { percentile, round, writeEvidence } from "./release/evidence.mjs";
import { generateVault } from "./release/vault-generator.mjs";
import { readdir } from "node:fs/promises";

const run = promisify(execFile);
const options = parseArguments(process.argv.slice(2), { notes: "number", timeout: "number", zip: "string" });
const notes = options.notes ?? 5000;
const deadline = Date.now() + (options.timeout ?? 300) * 1000;
const disposable = join(root, ".runtime", "package", "benchmark", new Date().toISOString().replace(/[:.]/g, "-"));
const vault = join(disposable, "vault");
await mkdir(disposable, { recursive: true });

const time = async work => { const start = performance.now(); const value = await work(); return { ms: performance.now() - start, value }; };
const generated = await time(() => generateVault(vault, { notes }));

const bundled = join(disposable, "engine.mjs");
for (const [entry, name] of [["client/markdown.ts", "markdown"], ["client/search.ts", "search"]]) {
  await build({ entryPoints: [join(root, entry)], outfile: join(disposable, name + ".mjs"), bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
}
const { parseMarkdown } = await import(pathToFileURL(join(disposable, "markdown.mjs")).href);
const { searchDocuments } = await import(pathToFileURL(join(disposable, "search.mjs")).href);

const files = [];
for (const entry of await readdir(vault, { recursive: true })) { if (entry.endsWith(".md")) { files.push(entry.replaceAll("\\", "/")); } }
const texts = await Promise.all(files.map(async path => ({ path, text: await readFile(join(vault, path), "utf8") })));
const parsing = await time(() => texts.map(doc => ({ ...doc, cache: parseMarkdown(doc.text) })));
const docs = parsing.value;
const searches = {};
for (const [name, query] of Object.entries({ word: "alpha", boolean: "(alpha OR omega) AND -draft", regex: "/value\\d+ = 4\\d\\d/", tag: "tag:#review", path: "path:\"Folder 0001\" lambda" })) {
  const samples = [];
  let hits = 0;
  for (let index = 0; index < 5; index++) { const result = await time(() => searchDocuments(docs, query)); samples.push(result.ms); hits = result.value.length; }
  searches[name] = { hits, medianMs: round(percentile(samples, 0.5)), maxMs: round(Math.max(...samples)) };
}

const body = { notes, vaultBytes: generated.value.bytes, generateMs: round(generated.ms), client: { parseAllMs: round(parsing.ms), parsePerNoteMs: round(parsing.ms / notes, 4), searches }, host: null };

const outDirectory = join(root, ".runtime", "package", "out");
const manifest = JSON.parse(await readFile(join(outDirectory, "release-manifest.json"), "utf8"));
const hostExecutable = join(disposable, "app", "resources", "app", "src", "RonSijm.Slopsidian", "RonSijm.Slopsidian.exe");
const zip = resolve(options.zip ?? join(outDirectory, manifest.artifacts.portableZip.file));
await mkdir(join(disposable, "app"), { recursive: true });
await run(join(process.env.SystemRoot, "System32", "tar.exe"), ["-xf", zip, "-C", join(disposable, "app")], { maxBuffer: 1 << 20 });

const token = randomBytes(16).toString("hex");
const started = performance.now();
const child = spawn(hostExecutable, ["--urls", "http://127.0.0.1:0"], {
  cwd: join(disposable, "app"), stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Production", SLOPSIDIAN_TOKEN: token, SLOPSIDIAN_PARENT: "1", SLOPSIDIAN_VAULT: vault },
});
const exited = once(child, "exit");
let log = "";
const ready = new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error("host did not become ready\n" + log.slice(-2000))), Math.max(5000, deadline - Date.now()));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", text => { log += text; const match = log.match(/^VAULT_READY (http:\/\/127\.0\.0\.1:\d+)/m); if (match) { clearTimeout(timer); resolveReady(match[1]); } });
  child.stderr.on("data", text => { log += text; });
  child.on("exit", code => reject(new Error("host exited early with " + code + "\n" + log.slice(-2000))));
});
try {
  const base = await ready;
  const readyMs = performance.now() - started;
  const get = async path => { const start = performance.now(); const response = await fetch(base + path, { headers: { "X-Vault-Token": token } }); const buffer = await response.arrayBuffer(); return { status: response.status, ms: round(performance.now() - start), bytes: buffer.byteLength }; };
  const vaultCall = await fetch(base + "/api/vault", { headers: { "X-Vault-Token": token } });
  const vaultJson = await vaultCall.json();
  const root_ = vaultJson.root ?? vaultJson.path ?? vault;
  const calls = { health: await get("/api/health"), vault: await get("/api/vault"), metadata: await get("/api/metadata/documents?root=" + encodeURIComponent(root_)) };
  const rss = await run("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${child.pid}).WorkingSet64`], { windowsHide: true }).then(value => Number(value.stdout.trim()));
  body.host = { readyMs: round(readyMs), calls, workingSetBytes: rss, allOk: Object.values(calls).every(call => call.status === 200) };
} catch (error) {
  body.host = { error: error.message };
} finally {
  if (child.exitCode === null) { child.stdin.write("shutdown\n"); await Promise.race([exited, new Promise(r => setTimeout(r, 10000))]); }
  if (child.exitCode === null) { await run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => {}); }
}
body.method = "Synthetic deterministic vault; client engines bundled from client/*.ts; host launched from the extracted portable package (stdin shutdown).";
const result = await writeEvidence("large-vault", body, { artifacts: { portableZip: manifest.artifacts.portableZip } });
await rm(disposable, { recursive: true, force: true });
console.log(JSON.stringify({ notes, parseAllMs: body.client.parseAllMs, searches, host: body.host }, null, 1));
console.log("LARGE_VAULT_EVIDENCE " + result.path);
if (!body.host?.allOk) { process.exitCode = 1; }
