import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

export const OFFLINE_MANIFEST_FORMAT = 1;
export const OFFLINE_MANIFEST_NAME = "offline-manifest.json";
export const SERVICE_WORKER_NAME = "service-worker.js";
// Compressed siblings, deployment hints and the control files are never part of the cached shell.
const excluded = new Set([OFFLINE_MANIFEST_NAME, SERVICE_WORKER_NAME, "404.html", "CNAME", ".nojekyll"]);

const STAMP = /const WORKER_BUILD = "[^"\n]*";/;
const UNSTAMPED = 'const WORKER_BUILD = "unstamped";';

/** Identity of the worker source independent of its own stamp, so the stamp can embed it. */
export function workerBuild(source) {
  if (!STAMP.test(source)) { throw new Error("service-worker.js has no WORKER_BUILD declaration."); }
  return createHash("sha256").update(source.replace(STAMP, UNSTAMPED).replaceAll("\r\n", "\n")).digest("hex").slice(0, 32);
}
export function stampWorker(source) { return source.replace(STAMP, `const WORKER_BUILD = "${workerBuild(source)}";`); }
export async function stampPublishedWorker(site) {
  const path = join(site, SERVICE_WORKER_NAME);
  await writeFile(path, stampWorker(await readFile(path, "utf8")));
}

export function offlineVersion(basePath, files, build) {
  const hash = createHash("sha256");
  hash.update(`slopsidian-offline-shell/${OFFLINE_MANIFEST_FORMAT}\n${basePath}\n`);
  for (const file of files) { hash.update(`${file.path}\0${file.size}\0${file.sha256}\n`); }
  hash.update(`worker\0${build}\n`);
  return hash.digest("hex").slice(0, 32);
}

async function walk(directory, prefix, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { await walk(join(directory, entry.name), path, files); continue; }
    if (!entry.isFile() || excluded.has(path) || /\.(?:br|gz)$/.test(path)) { continue; }
    const bytes = await readFile(join(directory, entry.name));
    files.push({ path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
}

/** Hash every published asset that the standalone shell needs to run without a network. */
export async function buildOfflineManifest(site, basePath) {
  const files = [];
  await walk(site, "", files);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!files.some(file => file.path === "index.html") || !files.some(file => file.path.startsWith("_framework/") && file.path.endsWith(".wasm"))) {
    throw new Error("The published site has no entry page or WebAssembly runtime to cache.");
  }
  const worker = await readFile(join(site, SERVICE_WORKER_NAME)), build = workerBuild(worker.toString("utf8"));
  if (!worker.toString("utf8").includes(`const WORKER_BUILD = "${build}";`)) { throw new Error("service-worker.js is not stamped with its build identity; publish stamps it."); }
  return {
    format: OFFLINE_MANIFEST_FORMAT, basePath, version: offlineVersion(basePath, files, build), entry: "index.html",
    serviceWorker: { path: SERVICE_WORKER_NAME, sha256: createHash("sha256").update(worker).digest("hex"), build },
    totalBytes: files.reduce((total, file) => total + file.size, 0), files,
  };
}

/** Recompute the published manifest from disk so a stale or tampered manifest fails verification. */
export async function verifyOfflineManifest(site, basePath) {
  const manifest = JSON.parse(await readFile(join(site, OFFLINE_MANIFEST_NAME), "utf8"));
  const expected = await buildOfflineManifest(site, basePath);
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) { throw new Error("The offline manifest does not match the published files."); }
  for (const file of manifest.files) { if ((await stat(join(site, ...posix.normalize(file.path).split("/")))).size !== file.size) { throw new Error("Offline manifest size mismatch: " + file.path); } }
  return manifest;
}
