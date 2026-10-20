// Disposable real-Chromium check of durable draft storage: IndexedDB survives page reload, renderer destruction and a full process restart.
// Windows are never shown or focused. Usage: node tools/persistent-drafts-electron.mjs [--keep]
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const electron = createRequire(import.meta.url)("electron");
const runtime = join(root, ".runtime");
await mkdir(runtime, { recursive: true });
const directory = await mkdtemp(join(runtime, "persistent-drafts-electron-"));
const free = await new Promise(resolve => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });

await build({
  stdin: { contents: 'import * as model from "./client/persistent-draft-model.ts"; import * as capture from "./client/persistent-drafts.ts"; window.harness = { ...model, ...capture };', resolveDir: root, loader: "ts" },
  bundle: true, platform: "browser", format: "iife", outfile: join(directory, "web", "harness.js"), logLevel: "silent", external: ["electron"],
});
await writeFile(join(directory, "web", "index.html"), '<!doctype html><meta charset="utf-8"><title>harness</title><script src="harness.js"></script>');
const userData = join(directory, "profile");

function run(phase) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [join(root, "tools", "persistent-drafts-electron-main.cjs"), `--phase=${phase}`, `--port=${free}`, `--web=${join(directory, "web")}`, `--user-data=${userData}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += chunk; }); child.stderr.on("data", chunk => { err += chunk; });
    child.on("exit", code => {
      const line = out.split(/\r?\n/).find(item => item.startsWith("RESULT "));
      if (code !== 0 || !line) { reject(new Error(`phase ${phase} failed (${code}): ${out}\n${err}`)); } else { resolve(JSON.parse(line.slice(7))); }
    });
  });
}

const results = {};
try {
  results.write = await run("write");
  await new Promise(resolve => setTimeout(resolve, 11000));
  results.restart = await run("read");
  results.recover = await run("recover");
  results.afterRecover = await run("verify-empty");
  results.fence = await run("fence");
  const sha = value => createHash("sha256").update(value).digest("hex");
  results.sources = { harness: sha(await readFile(join(directory, "web", "harness.js"))) };
  console.log(JSON.stringify(results, null, 2));
  if (!results.write.ok || !results.restart.ok || !results.recover.ok || !results.afterRecover.ok || !results.fence.ok) { process.exitCode = 1; }
} finally {
  if (!process.argv.includes("--keep")) {
    const child = relative(runtime, directory);
    if (child && !isAbsolute(child) && !child.startsWith("..")) { await rm(directory, { recursive: true, force: true }); }
  }
}
