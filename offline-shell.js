// Page-side controller for the explicit offline application shell. It downloads, verifies and atomically adopts one
// complete manifest-defined cache set; service-worker.js only serves the adopted set and never writes the cache.
export const SHELL_CACHE_PREFIX = "slopsidian-shell:";
export const SHELL_META_CACHE = "slopsidian-shell-meta";
const MANIFEST = "offline-manifest.json";
const WORKER = "service-worker.js";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_SHELL_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[a-f0-9]{32}$/;
const types = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json", css: "text/css; charset=utf-8", svg: "image/svg+xml", wasm: "application/wasm", txt: "text/plain; charset=utf-8" };

export class ShellError extends Error {
  constructor(code, message) { super(message); this.name = "ShellError"; this.code = code; }
}
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
export const pointerUrl = base => new URL("__slopsidian-shell-active", base).href;
export const cacheName = (base, version) => SHELL_CACHE_PREFIX + new URL(base).pathname + ":" + version;
export const cachePrefix = base => SHELL_CACHE_PREFIX + new URL(base).pathname + ":";
// A key belongs to this base only if the remainder is exactly a version, so a nested base containing ':' cannot match.
export const ownsCache = (base, key) => key.startsWith(cachePrefix(base)) && VERSION.test(key.slice(cachePrefix(base).length));

function safePath(path) {
  return typeof path === "string" && path.length > 0 && path.length < 1024 && !path.startsWith("/") && !/[\\\x00-\x1f\x7f?#]/.test(path) && path.split("/").every(part => part && part !== "." && part !== "..");
}
async function versionOf(subtle, manifest) {
  const lines = [`slopsidian-offline-shell/${manifest.format}\n${manifest.basePath}\n`, ...manifest.files.map(file => `${file.path}\0${file.size}\0${file.sha256}\n`), `worker\0${manifest.serviceWorker.build}\n`];
  return hex(await subtle.digest("SHA-256", new TextEncoder().encode(lines.join("")))).slice(0, 32);
}

export class OfflineShell {
  constructor({ base, caches, fetch, serviceWorker, subtle, locks = null, controlled = false, concurrency = 4 }) {
    this.base = new URL(base);
    this.caches = caches; this.fetcher = fetch; this.serviceWorker = serviceWorker; this.subtle = subtle; this.locks = locks; this.concurrency = concurrency;
    this.controlled = controlled; this.bootVersion = null; this.running = null;
  }
  get supported() { return Boolean(this.caches && this.serviceWorker && this.subtle && this.fetcher && this.locks); }
  unsupportedReason() {
    if (!this.caches) { return "This browser context has no Cache Storage; use HTTPS or http://localhost in a current browser."; }
    if (!this.serviceWorker) { return "This browser context cannot register a service worker; use HTTPS or http://localhost in a current browser."; }
    if (!this.subtle) { return "Web Crypto is unavailable, so offline files cannot be verified."; }
    if (!this.locks) { return "Web Locks are unavailable, so changes to the shared offline copy cannot be safely coordinated between tabs."; }
    return "";
  }
  /** Every mutation of the shared cache/pointer runs under one exclusive cross-tab lock; if it cannot be owned the operation is refused, never run unprotected. */
  async exclusive(operation) {
    return this.locks.request("slopsidian-shell-mutation:" + this.base.pathname, { ifAvailable: true }, async lock => {
      if (!lock) { throw new ShellError("busy", "Another tab is preparing or removing the offline copy. Wait for it to finish, then try again."); }
      return operation();
    });
  }
  url(path) { return new URL(path, this.base).href; }

  async readPointer() {
    if (!await this.caches.has(SHELL_META_CACHE)) { return null; }
    const meta = await this.caches.open(SHELL_META_CACHE);
    const response = await meta.match(pointerUrl(this.base));
    if (!response) { return null; }
    try {
      const pointer = await response.json();
      if (pointer?.format !== 1 || !VERSION.test(pointer.version) || pointer.basePath !== new URL(this.base).pathname || !VERSION.test(pointer.workerBuild) || !Number.isSafeInteger(pointer.files)) { throw new Error("shape"); }
      return pointer;
    } catch { throw new ShellError("corrupt", "The offline adoption record is damaged. Prepare the offline app again."); }
  }
  async readStoredManifest(version) {
    const cache = await this.caches.open(cacheName(this.base, version));
    const response = await cache.match(this.url(MANIFEST));
    if (!response) { return null; }
    return this.validateManifest(JSON.parse(await response.text()), version);
  }
  async validateManifest(manifest, expectedVersion) {
    if (manifest?.format !== 1 || manifest.basePath !== this.base.pathname || manifest.entry !== "index.html" || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 20000 || !VERSION.test(manifest.version)) {
      throw new ShellError("manifest", "The offline manifest is invalid or belongs to a different base path.");
    }
        if (manifest.serviceWorker?.path !== WORKER || !SHA256.test(manifest.serviceWorker.sha256) || !VERSION.test(manifest.serviceWorker.build)) {
          throw new ShellError("manifest", "The offline manifest does not identify its service worker build.");
        }
    const names = new Set(); let total = 0;
    for (const file of manifest.files) {
      if (!safePath(file.path) || names.has(file.path) || !SHA256.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.path === MANIFEST || file.path === WORKER) {
        throw new ShellError("manifest", "The offline manifest contains an invalid file entry.");
      }
      names.add(file.path); total += file.size;
    }
    if (total > MAX_SHELL_BYTES || !names.has("index.html")) { throw new ShellError("manifest", "The offline manifest is too large or has no entry page."); }
    if (await versionOf(this.subtle, manifest) !== manifest.version || expectedVersion !== undefined && manifest.version !== expectedVersion) {
      throw new ShellError("corrupt", "The offline manifest does not match its version. It was damaged or changed in transit.");
    }
    return manifest;
  }
  async fetchManifest(signal) {
    let response;
    try { response = await this.fetcher(this.url(MANIFEST), { cache: "no-store", credentials: "omit", redirect: "error", signal }); }
    catch (error) { if (signal?.aborted) { throw new ShellError("cancelled", "Offline preparation was cancelled. Nothing changed."); } throw new ShellError("network", "The application server could not be reached. Offline preparation needs a connection; the current offline copy was not changed."); }
    if (!response.ok) { throw new ShellError("network", `The server returned ${response.status} for the offline manifest. This site may not publish an offline app.`); }
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES) { throw new ShellError("manifest", "The offline manifest is too large."); }
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new ShellError("manifest", "The offline manifest is not valid JSON."); }
    return { manifest: await this.validateManifest(parsed), text };
  }

  /** Cheap, network-free state: does the adopted cache set still contain every manifest file? */
  async status() {
    if (!this.supported) { return { state: "unsupported", reason: this.unsupportedReason(), bootVersion: this.bootVersion }; }
    let pointer;
    try { pointer = await this.readPointer(); }
    catch (error) { return { state: "corrupt", reason: error.message, bootVersion: this.bootVersion }; }
    if (!pointer) { return { state: "not-prepared", bootVersion: this.bootVersion }; }
    let manifest;
    try { manifest = await this.readStoredManifest(pointer.version); }
    catch (error) { return { state: "corrupt", version: pointer.version, reason: error.message, bootVersion: this.bootVersion }; }
    if (!manifest) { return { state: "incomplete", version: pointer.version, missing: pointer.files, files: pointer.files, reason: "The browser removed the offline copy. Prepare it again while online.", bootVersion: this.bootVersion }; }
    const cache = await this.caches.open(cacheName(this.base, pointer.version));
    const missing = [];
    for (const file of manifest.files) { if (!await cache.match(this.url(file.path))) { missing.push(file.path); } }
    const state = missing.length ? "incomplete" : "ready";
    return { state, version: pointer.version, files: manifest.files.length, bytes: manifest.totalBytes, missing: missing.length, adoptedAt: pointer.adoptedAt, bootVersion: this.bootVersion, reloadRequired: this.bootVersion !== null && this.bootVersion !== pointer.version, reason: missing.length ? `${missing.length} offline files were removed by the browser. Prepare the offline app again while online.` : "" };
  }
  /** Rehash the adopted bytes; reports corruption or eviction without changing anything. */
  async verify({ signal } = {}) {
    const pointer = await this.readPointer().catch(error => { throw error; });
    if (!pointer) { throw new ShellError("not-prepared", "No offline app has been prepared."); }
    const manifest = await this.readStoredManifest(pointer.version);
    if (!manifest) { throw new ShellError("evicted", "The browser removed the offline copy. Prepare it again while online."); }
    const cache = await this.caches.open(cacheName(this.base, pointer.version)), missing = [], corrupt = [];
    for (const file of manifest.files) {
      if (signal?.aborted) { throw new ShellError("cancelled", "Verification was cancelled."); }
      const response = await cache.match(this.url(file.path));
      if (!response) { missing.push(file.path); continue; }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.size || hex(await this.subtle.digest("SHA-256", bytes)) !== file.sha256) { corrupt.push(file.path); }
    }
    return { version: pointer.version, files: manifest.files.length, missing, corrupt, ok: !missing.length && !corrupt.length };
  }
  /** Network check only; installs nothing. */
  async check({ signal } = {}) {
    const { manifest } = await this.fetchManifest(signal);
    const pointer = await this.readPointer().catch(() => null);
    return { available: manifest.version, active: pointer?.version ?? null, upToDate: pointer?.version === manifest.version, files: manifest.files.length, bytes: manifest.totalBytes };
  }

  prepare(options = {}) {
    if (this.running) { throw new ShellError("busy", "Offline preparation is already running."); }
    const operation = this.prepareLocked(options).finally(() => { this.running = null; });
    this.running = operation;
    return operation;
  }
  async prepareLocked(options) {
    if (!this.supported) { throw new ShellError("unsupported", this.unsupportedReason()); }
    return this.exclusive(() => this.prepareNow(options));
  }
  async prepareNow({ signal, onProgress = () => {} } = {}) {
    if (!this.supported) { throw new ShellError("unsupported", this.unsupportedReason()); }
    const { manifest, text } = await this.fetchManifest(signal);
    const name = cacheName(this.base, manifest.version);
    const previous = await this.readPointer().catch(() => null);
    const progress = { phase: "downloading", version: manifest.version, totalFiles: manifest.files.length, totalBytes: manifest.totalBytes, completedFiles: 0, completedBytes: 0, reusedFiles: 0 };
    const publish = () => onProgress({ ...progress });
    const cache = await this.caches.open(name);
    // Quota or network failures keep the previous adopted set; only a never-adopted partial set may be discarded.
    const abandon = async () => { if (previous?.version !== manifest.version) { await this.caches.delete(name).catch(() => {}); } };
    try {
      publish();
      const queue = [...manifest.files]; let failure = null;
      const worker = async () => {
        while (!failure && queue.length) {
          if (signal?.aborted) { failure = new ShellError("cancelled", "Offline preparation was cancelled. Downloaded files are kept so you can resume."); return; }
          const file = queue.shift();
          try { progress.reusedFiles += await this.ensure(cache, file, signal) ? 1 : 0; progress.completedFiles++; progress.completedBytes += file.size; publish(); }
          catch (error) { failure ??= error; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker));
      if (failure) { throw failure; }
      progress.phase = "verifying"; publish();
      for (const file of manifest.files) { if (!await cache.match(this.url(file.path))) { throw new ShellError("corrupt", "A downloaded offline file is missing from browser storage: " + file.path); } }
      await this.store(cache, this.url(MANIFEST), text, "application/json");
      progress.phase = "registering"; publish();
      await this.verifyWorker(manifest, signal);
      const meta = await this.caches.open(SHELL_META_CACHE);
      const pointer = { format: 1, version: manifest.version, workerBuild: manifest.serviceWorker.build, basePath: this.base.pathname, files: manifest.files.length, bytes: manifest.totalBytes, adoptedAt: new Date().toISOString() };
      // The pointer is written before the new worker is installed: if storage fails here the previous worker is still the only one, so the previous offline app stays runnable.
      await this.store(meta, pointerUrl(this.base), JSON.stringify(pointer), "application/json");
      try {
        const registration = await this.serviceWorker.register(this.url(WORKER), { scope: this.base.pathname, updateViaCache: "none" });
        // register() resolves the existing registration without checking for new script bytes, so the update must be requested explicitly or settle would only see the previous active worker.
        if (typeof registration?.update !== "function") { throw new Error("The browser returned no usable service worker registration."); }
        await registration.update();
        await this.settle(registration);
        await this.serviceWorker.ready;
      }
      catch (error) {
        try { if (previous) { await this.store(meta, pointerUrl(this.base), JSON.stringify(previous), "application/json"); } else { await meta.delete(pointerUrl(this.base)); } }
        catch { throw new ShellError("registration", "The offline service worker could not start and the previous offline record could not be restored. Remove the offline copy and prepare it again."); }
        throw new ShellError("registration", "The offline service worker could not start: " + (error?.message ?? error) + ". The offline copy was not activated.");
      }
      // Older versions are removed only after the pointer and worker both name the new set.
      for (const key of await this.caches.keys()) { if (ownsCache(this.base, key) && key !== name) { await this.caches.delete(key); } }
      progress.phase = "complete"; publish();
      return { state: "adopted", version: manifest.version, previousVersion: previous?.version ?? null, files: manifest.files.length, bytes: manifest.totalBytes, reloadRequired: this.bootVersion !== manifest.version };
    } catch (error) {
      const failure = error instanceof ShellError ? error : this.classify(error);
      if (failure.code === "quota") { await abandon(); }
      throw failure;
    }
  }
  /** `ready` only proves some worker is active (possibly the previous one); wait for the worker this registration installs to finish activating or fail. */
  async settle(registration) {
    const worker = registration?.installing ?? registration?.waiting ?? registration?.active;
    if (!worker || typeof worker.addEventListener !== "function" || typeof worker.removeEventListener !== "function") {
      throw new Error("The service worker registration has no usable worker.");
    }
    if (worker.state === "activated") { return; }
    await new Promise((resolve, reject) => {
      const check = () => {
        if (worker.state === "activated") { worker.removeEventListener("statechange", check); resolve(); }
        else if (worker.state === "redundant") { worker.removeEventListener("statechange", check); reject(new Error("The new service worker was rejected during installation")); }
      };
      worker.addEventListener("statechange", check); check();
    });
  }
  /** The script the browser will install must be exactly the build the manifest (and so the version) names. */
  async verifyWorker(manifest, signal) {
    let response;
    try { response = await this.fetcher(this.url(WORKER), { cache: "no-store", credentials: "omit", redirect: "error", signal }); }
    catch { throw new ShellError("network", "The service worker script could not be downloaded. The offline copy was not activated."); }
    if (!response.ok) { throw new ShellError("network", `The server returned ${response.status} for the service worker. The offline copy was not activated.`); }
    const bytes = await response.arrayBuffer();
    if (hex(await this.subtle.digest("SHA-256", bytes)) !== manifest.serviceWorker.sha256 || !new TextDecoder().decode(bytes).includes(`const WORKER_BUILD = "${manifest.serviceWorker.build}";`)) {
      throw new ShellError("corrupt", "The service worker does not match the published offline manifest (a proxy, cache or deployment mismatch). Nothing was activated; retry after the site finishes updating.");
    }
  }
  classify(error) {
    if (error?.name === "QuotaExceededError" || /quota/i.test(String(error?.message))) { return new ShellError("quota", "Browser storage is full, so the offline app could not be saved. The previous offline copy was kept; free storage and try again."); }
    return new ShellError("storage", "The offline app could not be saved: " + (error?.message ?? error));
  }
  async store(cache, url, body, contentType) {
    try { await cache.put(url, new Response(body, { status: 200, headers: { "Content-Type": contentType } })); }
    catch (error) {
      const failure = this.classify(error);
      if (failure.code === "storage") { failure.message += ` (while saving ${new URL(url).pathname.slice(this.base.pathname.length) || url})`; }
      throw failure;
    }
  }
  /** Returns true when a previously saved file was verified and reused (resume). */
  async ensure(cache, file, signal) {
    const url = this.url(file.path);
    const existing = await cache.match(url);
    if (existing) {
      const bytes = await existing.arrayBuffer();
      if (bytes.byteLength === file.size && hex(await this.subtle.digest("SHA-256", bytes)) === file.sha256) { return true; }
      await cache.delete(url);
    }
    let response;
    try { response = await this.fetcher(url, { cache: "no-store", credentials: "omit", redirect: "error", signal, headers: { "X-Slopsidian-Shell-Prepare": "1" } }); }
    catch (error) { if (signal?.aborted) { throw new ShellError("cancelled", "Offline preparation was cancelled. Downloaded files are kept so you can resume."); } throw new ShellError("network", `The connection failed while downloading ${file.path}. Downloaded files are kept; retry to resume.`); }
    if (!response.ok) { throw new ShellError("network", `The server returned ${response.status} for ${file.path}. Downloaded files are kept; retry to resume.`); }
    let bytes;
    try { bytes = await response.arrayBuffer(); }
    catch { if (signal?.aborted) { throw new ShellError("cancelled", "Offline preparation was cancelled. Downloaded files are kept so you can resume."); } throw new ShellError("network", `The connection dropped while downloading ${file.path}. Downloaded files are kept; retry to resume.`); }
    if (bytes.byteLength !== file.size || hex(await this.subtle.digest("SHA-256", bytes)) !== file.sha256) {
      throw new ShellError("corrupt", `${file.path} does not match the published offline manifest (a proxy, cache or deployment mismatch). Nothing was activated; retry after the site finishes updating.`);
    }
    const extension = file.path.split(".").at(-1).toLowerCase();
    await this.store(cache, url, bytes, types[extension] ?? response.headers.get("Content-Type") ?? "application/octet-stream");
    return false;
  }
  /** Remove the adopted offline copy and the service worker; the online app is unaffected. */
  async remove() {
    if (!this.supported) { throw new ShellError("unsupported", this.unsupportedReason()); }
    return this.exclusive(async () => {
      const meta = await this.caches.open(SHELL_META_CACHE);
      await meta.delete(pointerUrl(this.base));
      if (await meta.match(pointerUrl(this.base))) { throw new ShellError("partial-remove", "The browser retained the offline adoption record. Remove the offline copy again or clear this site's storage."); }
      for (const key of await this.caches.keys()) {
        if (ownsCache(this.base, key)) {
          await this.caches.delete(key);
          if (await this.caches.has(key)) { throw new ShellError("partial-remove", "The browser retained offline files after removal. Remove the offline copy again or clear this site's storage."); }
        }
      }
      // Other bases can adopt into the shared pointer cache concurrently, so retain its container even when empty.
      let registration;
      try { registration = await this.serviceWorker.getRegistration(this.base.pathname); } catch (error) {
        throw new ShellError("partial-remove", `Offline files were removed but the service worker lookup failed: ${error?.message ?? error}. Unregister it in the browser site settings.`);
      }
      // getRegistration(url) returns the longest matching scope, which may belong to a parent application.
      // Removing this base must never unregister that parent's worker.
      if (!registration || registration.scope && registration.scope !== this.base.href) { return; }
      try {
        if (registration.scope !== this.base.href || !await registration.unregister()) { throw new Error("The browser did not confirm removal of this application's service worker"); }
      } catch (error) {
        throw new ShellError("partial-remove", `Offline files were removed but service worker removal could not be confirmed: ${error?.message ?? error}. Check it in the browser site settings.`);
      }
    });
  }
}
