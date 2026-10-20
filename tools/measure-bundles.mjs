// Measures real artifact sizes: the staged desktop package, its individual bundles (raw/gzip/brotli) and the
// WebAssembly publish output. Writes .runtime\package\evidence\bundles.json.
import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { formatBytes, parseArguments, repositoryRoot as root } from "./release/lib.mjs";
import { round, writeEvidence } from "./release/evidence.mjs";
import { listFiles } from "./release/zip.mjs";

const run = promisify(execFile);
const options = parseArguments(process.argv.slice(2), { "package-dir": "string", "web-dir": "string", "build-web": "flag", out: "string" });
const work = join(root, ".runtime", "package");
const packageDirectory = resolve(options["package-dir"] ?? join(work, "stage", "Slopsidian"));
const releaseDirectory = resolve(options.out ?? join(work, "out"));
let webDirectory = resolve(options["web-dir"] ?? join(work, "web-measure", "wwwroot"));

if (options["build-web"]) {
  const output = join(work, "web-measure");
  await rm(output, { recursive: true, force: true });
  const project = join(root, "src", "RonSijm.Slopsidian.Web", "RonSijm.Slopsidian.Web.csproj");
  const publish = ["publish", project, "--configuration", "Release", "--output", output, "--nologo", "-p:ContinuousIntegrationBuild=true"];
  // The pinned SDK may be absent locally; the second attempt runs outside the repository so global.json is not applied.
  await run("dotnet", publish, { cwd: root, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1" } })
    .catch(() => run("dotnet", publish, { cwd: tmpdir(), maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1" } }));
  webDirectory = join(output, "wwwroot");
}

async function measureFile(directory, file, compress) {
  const bytes = await readFile(join(directory, ...file.split("/")));
  const record = { file, bytes: bytes.length };
  if (compress) {
    record.gzipBytes = gzipSync(bytes, { level: 9 }).length;
    record.brotliBytes = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length;
  }
  return record;
}

const compressible = /\.(js|cjs|mjs|css|html|svg|json|txt|wasm|dat|dll)$/i;

async function describeDesktop() {
  const files = await listFiles(packageDirectory);
  const categories = {};
  const sizes = [];
  for (const file of files) {
    const bytes = (await stat(join(packageDirectory, ...file.split("/")))).size;
    sizes.push({ file, bytes });
    const category = file.startsWith("resources/app/src/") && file.includes("/wwwroot/") ? (/\.map$/.test(file) ? "ui-source-maps" : /\.(js|css|html|svg)$/.test(file) ? "ui-assets" : "ui-other")
      : file.startsWith("resources/app/src/") ? "dotnet-host"
      : file.startsWith("resources/app/") ? "desktop-bridge"
      : "electron-runtime";
    categories[category] ??= { files: 0, bytes: 0 };
    categories[category].files++; categories[category].bytes += bytes;
  }
  const ui = files.filter(file => /^resources\/app\/src\/[^/]+\/wwwroot\/(js\/[^/]+\.(js|css)|app\.css)$/.test(file));
  const uiBundles = [];
  for (const file of ui) { uiBundles.push(await measureFile(packageDirectory, file, true)); }
  const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
  return { directory: "stage/Slopsidian", files: files.length, totalBytes: total, categories, largestFiles: sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 15), uiBundles };
}

async function describeWeb() {
  if (!await stat(webDirectory).catch(() => null)) { return { measured: false, reason: "No WebAssembly publish output at " + webDirectory + "; run with --build-web." }; }
  const files = (await listFiles(webDirectory)).filter(file => !/\.(br|gz)$/.test(file));
  let total = 0, wasm = 0, wasmBr = 0, framework = 0, frameworkBr = 0, js = 0, jsBr = 0, maps = 0;
  const bundles = [];
  for (const file of files) {
    const bytes = (await stat(join(webDirectory, ...file.split("/")))).size;
    total += bytes;
    const precompressed = await stat(join(webDirectory, ...(file + ".br").split("/"))).then(item => item.size, () => null);
    if (/\.map$/.test(file)) { maps += bytes; }
    if (file.startsWith("_framework/")) { framework += bytes; frameworkBr += precompressed ?? bytes; }
    if (file.endsWith(".wasm")) { wasm += bytes; wasmBr += precompressed ?? bytes; }
    if (/^js\/[^/]+\.js$/.test(file)) { js += bytes; jsBr += precompressed ?? bytes; bundles.push({ file, bytes, brotliBytes: precompressed }); }
  }
  return { measured: true, directory: webDirectory, files: files.length, totalBytes: total, sourceMapBytes: maps, frameworkBytes: framework, frameworkBrotliBytes: frameworkBr, wasmBytes: wasm, wasmBrotliBytes: wasmBr, jsBytes: js, jsBrotliBytes: jsBr, jsBundles: bundles.sort((a, b) => b.bytes - a.bytes) };
}

const desktop = await describeDesktop();
const web = await describeWeb();
const manifest = await readFile(join(releaseDirectory, "release-manifest.json"), "utf8").then(JSON.parse, () => null);
const result = await writeEvidence("bundles", {
  method: "Direct byte counts of the staged package tree and WebAssembly publish output; gzip level 9 and brotli quality 9 computed locally (precompressed .br used for WebAssembly).",
  desktop, web, packages: manifest?.artifacts ?? null,
}, { artifacts: manifest?.artifacts ?? {} });

console.log(`BUNDLES_EVIDENCE ${result.path}`);
console.log(`  desktop tree ${formatBytes(desktop.totalBytes)} in ${desktop.files} files`);
for (const [name, value] of Object.entries(desktop.categories)) { console.log(`    ${name.padEnd(18)} ${formatBytes(value.bytes).padStart(10)} (${value.files} files)`); }
if (web.measured) { console.log(`  WebAssembly ${formatBytes(web.totalBytes)} total; framework brotli ${formatBytes(web.frameworkBrotliBytes)}; js brotli ${formatBytes(web.jsBrotliBytes)}; ${round(web.sourceMapBytes / 1048576)} MiB source maps`); }
else { console.log("  " + web.reason); }
