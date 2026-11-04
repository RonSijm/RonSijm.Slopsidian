// Serves the one adopted offline shell set. It never writes caches, never touches cross-origin requests (GitHub
// API/raw, native endpoints) and never intercepts anything outside its own scope.
// Publishing stamps WORKER_BUILD with the hash of this source; the adopted set records the build it was prepared for.
const WORKER_BUILD = "e451f8777f5506e1b346038b3e3f4e2b";
const PREFIX = "slopsidian-shell:";
const META = "slopsidian-shell-meta";
const VERSION = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const manifests = new Map();

function scopeUrl() { return new URL(self.registration.scope); }
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
// No adoption record means "never prepared" (null); a record that exists but cannot be trusted throws.
async function pointer() {
  if (!await caches.has(META)) { return null; }
  const meta = await caches.open(META);
  const response = await meta.match(new URL("__slopsidian-shell-active", self.registration.scope).href);
  if (!response) { return null; }
  const value = await response.json();
  if (value?.format !== 1 || !VERSION.test(value.version) || !VERSION.test(value.workerBuild) || value.basePath !== scopeUrl().pathname) { throw new Error("The adoption record is damaged."); }
  return value;
}
async function files(active) {
  // The stored manifest is mutable CacheStorage data: it is re-read on every request, and only the validation of identical bytes is reused.
  const cache = await caches.open(PREFIX + scopeUrl().pathname + ":" + active.version);
  const response = await cache.match(new URL("offline-manifest.json", self.registration.scope).href);
  if (!response) { throw new Error("The adopted manifest is missing."); }
  const text = await response.text();
  const memo = manifests.get(active.version);
  if (memo && memo.text === text) { return memo.known; }
  {
    const manifest = JSON.parse(text);
    if (manifest.version !== active.version || manifest.serviceWorker?.build !== active.workerBuild || !Array.isArray(manifest.files)) { throw new Error("The adopted manifest does not match its record."); }
    const lines = [`slopsidian-offline-shell/${manifest.format}\n${manifest.basePath}\n`, ...manifest.files.map(file => `${file.path}\0${file.size}\0${file.sha256}\n`), `worker\0${manifest.serviceWorker.build}\n`];
    if (manifest.basePath !== scopeUrl().pathname || hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lines.join("")))).slice(0, 32) !== manifest.version) { throw new Error("The adopted manifest is damaged."); }
    if (!manifest.files.every(file => typeof file.path === "string" && SHA256.test(file.sha256) && Number.isSafeInteger(file.size))) { throw new Error("The adopted manifest has an invalid entry."); }
    const known = new Map(manifest.files.map(file => [file.path, file]));
    manifests.clear(); manifests.set(active.version, { text, known });
    return known;
  }
}
function unavailable(message) {
  return new Response(message, { status: 503, statusText: "Offline app file unavailable", headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
async function respond(request) {
  const url = new URL(request.url), scope = scopeUrl();
  let active;
  try { active = await pointer(); }
  catch { return unavailable("The offline adoption record is damaged, so the offline app is not served. Reconnect and prepare the offline app again."); }
  if (!active) { return fetch(request); }
  if (active.workerBuild !== WORKER_BUILD) {
    // This control code was not the one the set was prepared for; never serve it, and say so when the network is gone.
    try { return await fetch(request); } catch { return unavailable("The offline app was prepared for a different service worker build. Reconnect and prepare the offline app again."); }
  }
  let known;
  try { known = await files(active); }
  catch { return unavailable("The adopted offline manifest is missing or damaged, so the offline app is not served. Reconnect and prepare the offline app again."); }
  let path;
  try { path = decodeURIComponent(url.pathname.slice(scope.pathname.length)); } catch { return fetch(request); }
  const route = path === "" || path === "index.html" || path.startsWith("remote-vault/");
  if (route && (request.mode === "navigate" || path === "" || path === "index.html")) { path = "index.html"; }
  else if (!known.has(path)) { return fetch(request); }
  const entry = known.get(path);
  try {
    const cache = await caches.open(PREFIX + scope.pathname + ":" + active.version);
    const hit = await cache.match(new URL(path, scope).href);
    // An evicted file is never mixed with the network's possibly newer version while this version is active.
    if (!hit) { return unavailable(`The offline copy of ${path} was removed by the browser. Reconnect and prepare the offline app again.`); }
    const bytes = await hit.arrayBuffer();
    if (bytes.byteLength !== entry.size || hex(await crypto.subtle.digest("SHA-256", bytes)) !== entry.sha256) {
      return unavailable(`The offline copy of ${path} is corrupt and was not executed. Reconnect and prepare the offline app again.`);
    }
    return new Response(bytes, { status: 200, headers: hit.headers });
  } catch { return unavailable(`The offline copy of ${path} could not be read. Reconnect and prepare the offline app again.`); }
}
// A worker is admitted only while the adoption record names its own build. The page writes that record before registering, and rolls it back when
// registration fails, so a late-installing rolled-back worker rejects its own install (and becomes redundant) instead of replacing the previous one.
async function admit() {
  const active = await pointer();
  if (!active || active.workerBuild !== WORKER_BUILD) { throw new Error("The adoption record does not name this service worker build, so it was not installed."); }
  self.skipWaiting();
}
self.addEventListener("install", event => { event.waitUntil(admit()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url), scope = scopeUrl();
  if (request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) { return; }
  const path = url.pathname.slice(scope.pathname.length);
  if (path === "offline-manifest.json" || path === "service-worker.js") { return; }
  // Preparation downloads must reach the network (and be hash-verified by the page); otherwise repair and update would be answered from the old set.
  if (request.headers?.get("X-Slopsidian-Shell-Prepare") === "1") { return; }
  event.respondWith(respond(request));
});
