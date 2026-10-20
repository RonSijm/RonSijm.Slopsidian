import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script, createContext } from "node:vm";
import { root } from "./host.mjs";
import { buildOfflineManifest, stampPublishedWorker, stampWorker, verifyOfflineManifest } from "../tools/offline-manifest.mjs";

const wwwroot = join(root, "src", "RonSijm.Slopsidian.Web", "wwwroot");
const { OfflineShell, ShellError, SHELL_META_CACHE, cacheName, cachePrefix } = await import(pathToFileURL(join(wwwroot, "offline-shell.js")).href);
const { auditPage, exactUrl, isClean, withinBoundary, panelProbeExpression, settlePage, selectRuntimeWasm, sdkBootCacheName, clearSdkBootCache } = await import(pathToFileURL(join(root, "tools", "offline-smoke-audit.mjs")).href);

const fakeCacheStorage = (initial, { failDelete = false, stickyDelete = false } = {}) => {
  const store = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))])), deleted = [];
  return {
    store, deleted,
    keys: async () => [...store.keys()],
    open: async name => ({ keys: async () => [...store.get(name).keys()].map(url => ({ url })), match: async request => new Response(store.get(name).get(request.url)) }),
    delete: async name => { deleted.push(name); if (failDelete) { return false; } if (!store.has(name)) { return false; } if (!stickyDelete) { store.delete(name); } return true; }
  };
};

test("the runtime WASM is the required dotnet.native file, never an arbitrary first assembly", () => {
  assert.equal(selectRuntimeWasm(["_framework/System.Runtime.abc.wasm", "_framework/dotnet.native.2qba9g5fwn.wasm", "_framework/dotnet.native.2qba9g5fwn.wasm.br"]), "_framework/dotnet.native.2qba9g5fwn.wasm");
  assert.throws(() => selectRuntimeWasm(["_framework/System.Runtime.abc.wasm"]), /found 0/);
  assert.throws(() => selectRuntimeWasm(["_framework/dotnet.native.a.wasm", "_framework/dotnet.native.b.wasm"]), /found 2/);
});

test("the serialized page expression compiles and runs against a cache storage", async () => {
  const caches = fakeCacheStorage({ "dotnet-resources/a/": { "http://h/a/_framework/d.wasm": "x" }, keep: {} });
  const expression = `(${clearSdkBootCache.toString()})(caches, (${sdkBootCacheName.toString()})(base, origin), "d.wasm")`;
  const record = await new Function("caches", "base", "origin", "return " + expression)(caches, "http://h/a/", "http://h");
  assert.equal(record.existsAfter, false); assert.equal(record.matchingBefore.length, 1);
  assert.deepEqual([...caches.store.keys()], ["keep"]);
});

test("the SDK boot cache is cleared only for the exact app base, recording matching copies, and failures are explicit", async () => {
  assert.equal(sdkBootCacheName("http://h:1/app/", "http://h:1"), "dotnet-resources/app/");
  assert.equal(sdkBootCacheName("http://h:1/", "http://h:1"), "dotnet-resources/");
  const target = "dotnet.native.x.wasm", name = "dotnet-resources/app/";
  const caches = fakeCacheStorage({ [name]: { "http://h:1/app/_framework/dotnet.native.x.wasm": "wasm-bytes", "http://h:1/app/_framework/other.dll": "dll" }, "dotnet-resources/other/": { "http://h:1/other/_framework/dotnet.native.x.wasm": "b" }, "dotnet-resources/": { "http://h:1/_framework/dotnet.native.x.wasm": "c" }, "slopsidian-shell:v1": { a: "1" }, "slopsidian-shell-meta": { m: "2" } });
  const record = await clearSdkBootCache(caches, name, target);
  assert.equal(record.existedBefore, true); assert.equal(record.deleted, true); assert.equal(record.existsAfter, false);
  assert.equal(record.matchingBefore.length, 1); assert.match(record.matchingBefore[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(caches.deleted, [name]);
  assert.deepEqual([...caches.store.keys()].sort(), ["dotnet-resources/", "dotnet-resources/other/", "slopsidian-shell-meta", "slopsidian-shell:v1"].sort());
  const absent = await clearSdkBootCache(fakeCacheStorage({ "slopsidian-shell-meta": {} }), name, target);
  assert.equal(absent.existedBefore, false); assert.equal(absent.deleted, false);
  const entries = { [name]: { "http://h:1/app/_framework/dotnet.native.x.wasm": "w" } };
  await assert.rejects(clearSdkBootCache(fakeCacheStorage(entries, { failDelete: true }), name, target), /could not be deleted/);
  await assert.rejects(clearSdkBootCache(fakeCacheStorage(entries, { stickyDelete: true }), name, target), /still present true/);
});

test("the smoke harness imports every audit helper it uses", async () => {
  const source = await readFile(join(root, "tools", "offline-shell-smoke.mjs"), "utf8");
  const imported = /import \{([^}]*)\} from "\.\/offline-smoke-audit\.mjs"/.exec(source)[1].split(",").map(name => name.trim());
  for (const name of ["auditPage", "exactUrl", "isClean", "withinBoundary", "panelProbeExpression", "settlePage"]) {
    if (new RegExp("\\b" + name + "\\(").test(source)) { assert.ok(imported.includes(name), name + " is used but not imported"); }
  }
  assert.match(source, /const panelSettled = `\$\{appReady\} && document\.getElementById\("offline-shell"\)\.hidden === false && document\.querySelectorAll\("dialog\[open\]"\)\.length > 0`;/);
  const gates = source.match(/page\.wait\(panelSettled, SETTLED_LABEL, 60000\)/g) ?? [];
  assert.equal(gates.length, 9, "every no-vault first panel click shares the panelSettled gate");
  const direct = source.match(/panelSettled, SETTLED_LABEL, 60000\);\r?\n\s*await page\.click\("(prepare|check|remove)"/g) ?? [];
  assert.equal(direct.length, 8, "eight gates sit immediately before their first click; the eviction gate precedes its verify click");
  assert.doesNotMatch(source, /page\.wait\(panelSettled, "/, "gates use the shared label");
  assert.match(source, /const wasm = selectRuntimeWasm\(manifestPaths\);/);
  assert.doesNotMatch(source, /manifestPaths\.find\(path => \/\\\.wasm\$\/\.test\(path\)\)/, "no arbitrary first-wasm fallback");
  assert.match(source, /clearSdkBootCache\.toString\(\)/);
  assert.match(source, /panelProbeExpression/);
  assert.match(source, /before-summary-click/);
  assert.match(source, /summary-open-timeout/);
});

test("page settling waits for in-flight requests, app readiness and a quiet interval, and reports what is pending", async () => {
  const urls = new Map([["a", "http://x/slow.js"]]), active = new Set(["a"]); let started = 1, ready = false, done = false;
  const run = settlePage({ started: () => started, active: () => active, urls: id => urls.get(id), ready: () => ready, quietMs: 40, timeout: 2000, poll: 10 }).then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(done, false, "a request pending beyond the quiet interval must keep it waiting");
  active.delete("a");
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(done, false, "an app that is not ready must keep it waiting");
  ready = true;
  await run;
  assert.equal(done, true);
  const failing = new Set(["b"]);
  const failed = settlePage({ started: () => 1, active: () => failing, urls: () => "http://x/late.svg", ready: () => true, quietMs: 20, timeout: 150, poll: 10 });
  await assert.rejects(failed, /1 request\(s\) in flight: http:\/\/x\/late\.svg/);
  const drain = settlePage({ started: () => 1, active: () => failing, urls: () => "", ready: () => true, quietMs: 20, timeout: 1000, poll: 10 });
  setTimeout(() => failing.delete("b"), 100);
  await drain;
});

test("the panel probe records open, inert, dialog, hit target and status for each state, and tolerates a missing panel", () => {
  const run = dom => JSON.parse(JSON.stringify(new Script(panelProbeExpression).runInContext(createContext(dom))));
  assert.deepEqual(run({ document: { getElementById: () => null } }), { present: false });
  const summary = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), contains: () => false };
  const panel = open => ({ open, hidden: false, closest: () => null, dataset: { offlineState: "incomplete" }, querySelector: selector => selector === "summary" ? summary : { textContent: "removed" } });
  const document = (open, hit, dialogs = 0) => ({ getElementById: () => panel(open), querySelectorAll: () => ({ length: dialogs }), elementFromPoint: () => hit });
  assert.deepEqual(run({ document: document(true, summary) }), { present: true, open: true, hidden: false, inert: false, openDialogs: 0, summaryHit: "summary", state: "incomplete", error: "", status: "removed" });
  const blocked = run({ document: document(false, { tagName: "DIALOG", className: "modal" }, 1) });
  assert.equal(blocked.open, false); assert.equal(blocked.summaryHit, "DIALOG.modal"); assert.equal(blocked.openDialogs, 1);
});
const BASE = "http://127.0.0.1:5173/app/";

async function site(files = {}, workerSource = '// sw\nconst WORKER_BUILD = "unstamped";\n') {
  const directory = await mkdtemp(join(root, ".runtime", "offline-shell-test-"));
  const content = { "index.html": '<base href="/app/" />index', "_framework/blazor.webassembly.js": "boot", "_framework/app.1.wasm": "\0asm-one", "js/a.js": "a", "app.css": "css", ...files };
  for (const [name, text] of Object.entries(content)) {
    await mkdir(join(directory, name.split("/").slice(0, -1).join("/")), { recursive: true });
    await writeFile(join(directory, ...name.split("/")), text);
  }
  await writeFile(join(directory, "service-worker.js"), workerSource);
  await stampPublishedWorker(directory);
  await writeFile(join(directory, "index.html.br"), "ignored");
  await writeFile(join(directory, "CNAME"), "ignored");
  const manifest = await buildOfflineManifest(directory, "/app/");
  await writeFile(join(directory, "offline-manifest.json"), JSON.stringify(manifest));
  return { directory, manifest, content };
}

class FakeCache {
  constructor(storage) { this.entries = new Map(); this.storage = storage; }
  async match(url) { const entry = this.entries.get(String(url)); return entry ? new Response(entry.bytes.slice(), { status: 200, headers: entry.headers }) : undefined; }
  async put(url, response) {
    if (this.storage.quota !== undefined && this.storage.bytes() + (await response.clone().arrayBuffer()).byteLength > this.storage.quota) { throw new DOMException("Quota exceeded", "QuotaExceededError"); }
    this.entries.set(String(url), { bytes: new Uint8Array(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) });
  }
  async delete(url) { return this.entries.delete(String(url)); }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
}
class FakeStorage {
  constructor() { this.caches = new Map(); this.quota = undefined; }
  bytes() { let total = 0; for (const cache of this.caches.values()) for (const entry of cache.entries.values()) total += entry.bytes.length; return total; }
  async open(name) { if (!this.caches.has(name)) this.caches.set(name, new FakeCache(this)); return this.caches.get(name); }
  async delete(name) { return this.caches.delete(name); }
  async has(name) { return this.caches.has(name); }
  async keys() { return [...this.caches.keys()]; }
}
function server(directory, hooks = {}) {
  const requests = [];
  const fetcher = async (url, options = {}) => {
    const pathname = new URL(url).pathname.slice("/app/".length);
    requests.push(pathname);
    if (hooks.offline) throw new TypeError("network down");
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    await hooks.before?.(pathname);
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (hooks.status?.[pathname]) return new Response("no", { status: hooks.status[pathname] });
    const bytes = hooks.replace?.[pathname] ?? await readFile(join(directory, ...pathname.split("/")));
    return new Response(bytes, { status: 200 });
  };
  return { fetcher, requests };
}
class FakeLocks {
  constructor() { this.held = new Set(); }
  async request(name, options, callback) {
    if (this.held.has(name)) { if (options?.ifAvailable) { return callback(null); } throw new Error("Test locks only support ifAvailable."); }
    this.held.add(name);
    try { return await callback({ name }); } finally { this.held.delete(name); }
  }
}
function shell(storage, fetcher, extra = {}) {
  const registrations = [];
  const registration = { active: Object.assign(new EventTarget(), { state: "activated" }), update: async () => {} };
  const serviceWorker = { register: async (url, options) => { registrations.push({ url, options }); return registration; }, ready: Promise.resolve(registration), getRegistration: async () => ({ scope: BASE, unregister: async () => { registrations.push("unregister"); return true; } }) };
  return Object.assign(new OfflineShell({ base: BASE, caches: storage, fetch: fetcher, serviceWorker, subtle: globalThis.crypto.subtle, locks: new FakeLocks(), ...extra }), { registrations });
}

test("manifest is deterministic, excludes control files and detects a changed artifact", async () => {
  const first = await site(), second = await site();
  try {
    assert.equal(first.manifest.version, second.manifest.version);
    assert.deepEqual(first.manifest.files.map(file => file.path), ["_framework/app.1.wasm", "_framework/blazor.webassembly.js", "app.css", "index.html", "js/a.js"]);
    assert.equal((await verifyOfflineManifest(first.directory, "/app/")).version, first.manifest.version);
    await writeFile(join(first.directory, "js", "a.js"), "changed");
    await assert.rejects(() => verifyOfflineManifest(first.directory, "/app/"), /does not match/);
    assert.notEqual((await buildOfflineManifest(first.directory, "/app/")).version, first.manifest.version);
    assert.notEqual((await buildOfflineManifest(second.directory, "/other/")).version, second.manifest.version, "The base path is part of the version.");
  } finally { await rm(first.directory, { recursive: true, force: true }); await rm(second.directory, { recursive: true, force: true }); }
});

test("prepare caches and atomically adopts one complete verified set, then reports ready", async () => {
  const { directory, manifest } = await site();
  try {
    const storage = new FakeStorage(), { fetcher, requests } = server(directory), offline = shell(storage, fetcher);
    assert.equal((await offline.status()).state, "not-prepared");
    const progress = [];
    const result = await offline.prepare({ onProgress: update => progress.push(update) });
    assert.equal(result.state, "adopted"); assert.equal(result.version, manifest.version);
    assert.equal(progress.at(-1).phase, "complete"); assert.equal(progress.at(-1).completedFiles, manifest.files.length);
    assert.equal(offline.registrations.length, 1);
    assert.equal(offline.registrations[0].options.scope, "/app/", "The worker scope is the published base path only.");
    const status = await offline.status();
    assert.equal(status.state, "ready"); assert.equal(status.files, manifest.files.length);
    assert.equal(requests.filter(path => path === "offline-manifest.json").length, 1);
    assert.ok((await (await storage.open(cacheName(BASE, manifest.version))).match(BASE + "_framework/app.1.wasm")).headers.get("content-type") === "application/wasm");
    assert.deepEqual((await offline.verify()).ok, true);
    assert.ok(requests.every(path => path === "offline-manifest.json" || path === "service-worker.js" || manifest.files.some(file => file.path === path)), "Only manifest files are fetched.");
    const check = await offline.check();
    assert.equal(check.upToDate, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a corrupt download or manifest never replaces the adopted version and is reported honestly", async () => {
  const one = await site(), two = await site({ "js/a.js": "second version" });
  try {
    const storage = new FakeStorage(), offline = shell(storage, server(one.directory).fetcher);
    await offline.prepare();
    const bad = shell(storage, server(two.directory, { replace: { "js/a.js": "tampered by a proxy" } }).fetcher);
    await assert.rejects(() => bad.prepare(), error => error.code === "corrupt" && /does not match the published offline manifest/.test(error.message));
    const status = await bad.status();
    assert.equal(status.version, one.manifest.version, "The old complete set is still adopted.");
    assert.equal(status.state, "ready");
    const tamperedManifest = shell(storage, async () => new Response(JSON.stringify({ ...two.manifest, version: "0".repeat(32) })));
    await assert.rejects(() => tamperedManifest.prepare(), error => error.code === "corrupt");
    const otherBase = shell(storage, async () => new Response(JSON.stringify({ ...two.manifest, basePath: "/x/" })));
    await assert.rejects(() => otherBase.prepare(), error => error.code === "manifest");
    assert.deepEqual((await storage.keys()).filter(name => name.startsWith(cachePrefix(BASE))).sort(), [cacheName(BASE, one.manifest.version), cacheName(BASE, two.manifest.version)].sort());
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("update adopts the new set only after it is complete and then removes the old set", async () => {
  const one = await site(), two = await site({ "js/a.js": "second version" });
  try {
    const storage = new FakeStorage();
    await shell(storage, server(one.directory).fetcher).prepare();
    let observed;
    const updater = shell(storage, server(two.directory, { before: async path => { if (path === "js/a.js") observed = await updater.status(); } }).fetcher, { controlled: true });
    updater.bootVersion = one.manifest.version;
    const check = await updater.check();
    assert.deepEqual([check.upToDate, check.available, check.active], [false, two.manifest.version, one.manifest.version]);
    const result = await updater.prepare();
    assert.equal(observed.version, one.manifest.version, "While downloading, the previous complete set stays active.");
    assert.equal(result.previousVersion, one.manifest.version); assert.equal(result.reloadRequired, true);
    assert.deepEqual((await storage.keys()).filter(name => name.startsWith(cachePrefix(BASE))), [cacheName(BASE, two.manifest.version)]);
    const status = await updater.status();
    assert.equal(status.version, two.manifest.version); assert.equal(status.reloadRequired, true);
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("cancel and network failure keep verified files for resume without adopting", async () => {
  const { directory, manifest } = await site();
  try {
    const storage = new FakeStorage(), controller = new AbortController();
    let count = 0;
    const cancelling = shell(storage, server(directory, { before: async path => { if (path !== "offline-manifest.json" && ++count === 2) controller.abort(); } }).fetcher, { concurrency: 1 });
    await assert.rejects(() => cancelling.prepare({ signal: controller.signal }), error => error.code === "cancelled");
    assert.equal((await cancelling.status()).state, "not-prepared");
    const partial = await storage.open(cacheName(BASE, manifest.version));
    assert.ok(partial.entries.size >= 1 && partial.entries.size < manifest.files.length + 1);
    const flaky = server(directory, { before: async path => { if (path === "js/a.js") throw new TypeError("connection reset"); } });
    await assert.rejects(() => shell(storage, flaky.fetcher, { concurrency: 1 }).prepare(), error => error.code === "network" && /retry to resume/.test(error.message));
    assert.equal((await shell(storage, flaky.fetcher).status()).state, "not-prepared");
    const resumed = server(directory), progress = [];
    await shell(storage, resumed.fetcher).prepare({ onProgress: update => progress.push(update) });
    assert.ok(progress.at(-1).reusedFiles >= 1, "Verified bytes from the interrupted run are reused.");
    assert.ok(resumed.requests.length < manifest.files.length + 1);
    const offlineOnly = shell(storage, server(directory, { offline: true }).fetcher);
    await assert.rejects(() => offlineOnly.check(), error => error.code === "network");
    assert.equal((await offlineOnly.status()).state, "ready", "Status never needs the network.");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("storage quota failure is explicit, discards the new partial set and keeps the old one", async () => {
  const one = await site(), two = await site({ "js/a.js": "x".repeat(500) });
  try {
    const storage = new FakeStorage();
    await shell(storage, server(one.directory).fetcher).prepare();
    storage.quota = storage.bytes() + 100;
    await assert.rejects(() => shell(storage, server(two.directory).fetcher).prepare(), error => error.code === "quota" && /storage is full/.test(error.message) && /previous offline copy was kept/.test(error.message));
    assert.deepEqual((await storage.keys()).filter(name => name.startsWith(cachePrefix(BASE))), [cacheName(BASE, one.manifest.version)]);
    assert.equal((await shell(storage, server(one.directory).fetcher).status()).state, "ready");
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("a cache put failure, including a duplicate entry, is never swallowed and names the file being saved", async () => {
  const one = await site();
  try {
    for (const message of ["Failed to execute 'put' on 'Cache': Entry already exists.", "disk on fire"]) {
      const storage = new FakeStorage();
      const cache = await storage.open(cacheName(BASE, one.manifest.version));
      cache.put = async () => { throw new TypeError(message); };
      await assert.rejects(() => shell(storage, server(one.directory).fetcher).prepare(), error => error.code === "storage" && error.message.includes(message) && /while saving /.test(error.message));
      assert.equal((await shell(storage, server(one.directory).fetcher).status()).state === "ready", false);
    }
  } finally { await rm(one.directory, { recursive: true, force: true }); }
});

test("eviction and byte corruption are detected, and repair rehashes in place", async () => {
  const { directory, manifest } = await site();
  try {
    const storage = new FakeStorage(), offline = shell(storage, server(directory).fetcher);
    await offline.prepare();
    const cache = await storage.open(cacheName(BASE, manifest.version));
    await cache.delete(BASE + "js/a.js");
    let status = await offline.status();
    assert.equal(status.state, "incomplete"); assert.equal(status.missing, 1);
    cache.entries.get(BASE + "app.css").bytes[0] ^= 1;
    const verify = await offline.verify();
    assert.deepEqual([verify.ok, verify.missing, verify.corrupt], [false, ["js/a.js"], ["app.css"]]);
    const repair = server(directory);
    await shell(storage, repair.fetcher).prepare();
    assert.deepEqual(repair.requests.sort(), ["app.css", "js/a.js", "offline-manifest.json", "service-worker.js"]);
    assert.equal((await offline.verify()).ok, true);
    await storage.delete(cacheName(BASE, manifest.version));
    assert.equal((await offline.status()).state, "incomplete");
    await assert.rejects(() => offline.verify(), error => error.code === "evicted");
    const meta = await storage.open(SHELL_META_CACHE);
    await meta.put(BASE + "__slopsidian-shell-active", new Response("{broken"));
    assert.equal((await offline.status()).state, "corrupt");
    await offline.remove();
    assert.deepEqual(await storage.keys(), [SHELL_META_CACHE], "Remove deletes the versioned caches; only the shared pointer container may remain.");
    assert.equal((await (await storage.open(SHELL_META_CACHE)).keys()).length, 0, "Remove deletes this base's pointer.");
    assert.ok(offline.registrations.includes("unregister"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the smoke audit rejects a late unexpected error, an unrelated failed URL and an unrelated failed response, and matches only exact declared URLs", () => {
  const origin = "http://127.0.0.1:9000", css = exactUrl(origin, "browser.css");
  const page = { errors: [], failures: [], badResponses: [], requests: [origin + "/browser.css"], origin };
  const policy = { errors: [error => /browser\.css/.test(error.url ?? "")], failures: [css], responses: [css], aborted: [exactUrl(origin, "js/editor-host.js")] };
  assert.equal(isClean(auditPage(page, policy)), true);
  // The expected negative records are allowed and stay visible on the page.
  const expected = { ...page, errors: [{ text: "Failed to load resource", url: origin + "/browser.css" }], failures: [{ url: origin + "/browser.css?x=1", error: "net::ERR_FAILED" }, { url: origin + "/js/editor-host.js", error: "net::ERR_ABORTED" }], badResponses: [{ url: origin + "/browser.css", status: 503 }] };
  assert.equal(isClean(auditPage(expected, policy)), true);
  // A late error recorded after the case body (for example during teardown) is rejected.
  const late = { ...expected, errors: [...expected.errors, { text: "Uncaught TypeError during teardown" }] };
  assert.deepEqual(auditPage(late, policy).errors.map(error => error.text), ["Uncaught TypeError during teardown"]);
  // An unrelated failed URL, an aborted request outside the declared URL, and an unrelated failed response are rejected.
  assert.equal(auditPage({ ...page, failures: [{ url: origin + "/js/other.js", error: "net::ERR_FAILED" }] }, policy).failures.length, 1);
  assert.equal(auditPage({ ...page, failures: [{ url: origin + "/js/other.js", error: "net::ERR_ABORTED" }] }, policy).failures.length, 1);
  assert.equal(auditPage({ ...page, badResponses: [{ url: origin + "/app.css", status: 404 }] }, policy).responses.length, 1);
  assert.equal(auditPage({ ...page, requests: ["https://api.github.com/repos"] }, policy).external.length, 1);
  assert.equal(css.test(origin + "/nested/browser.css"), false);
  assert.equal(css.test("http://127.0.0.1:9001/browser.css"), false);
  assert.equal(css.test(origin + "/browser.css.map"), false);
  // The same allowed URL aborting outside the action boundary is rejected; inside it, it is allowed.
  const editor = exactUrl(origin, "js/editor-host.js"), marks = [{ name: "cancel", at: 1000 }];
  const bounded = { aborted: [item => editor.test(item.url) && withinBoundary(marks, item.at, ["cancel", "reload"])] };
  const abort = at => ({ ...page, failures: [{ url: origin + "/js/editor-host.js", error: "net::ERR_ABORTED", at }] });
  assert.equal(isClean(auditPage(abort(1500), bounded)), true);
  assert.equal(auditPage(abort(9000), bounded).failures.length, 1, "Outside the boundary window the same URL is unexpected.");
  assert.equal(auditPage(abort(500), bounded).failures.length, 1, "Before any action it is unexpected.");
  assert.equal(auditPage(abort(undefined), bounded).failures.length, 1);
  assert.equal(isClean(auditPage(late, {})), false, "A page without a policy tolerates nothing.");
});

test("remove preserves other bases, nested ':' bases and unrelated caches, and reports a failed worker unregister", async () => {
  const { directory, manifest } = await site();
  try {
    const storage = new FakeStorage(), offline = shell(storage, server(directory).fetcher);
    const nested = "slopsidian-shell:/app/:x/:" + "a".repeat(32), other = "slopsidian-shell:/other/:" + "b".repeat(32);
    for (const name of [nested, other, "unrelated-cache"]) { await (await storage.open(name)).put("http://x/y", new Response("k")); }
    const meta = await storage.open(SHELL_META_CACHE);
    await meta.put("http://127.0.0.1:5173/other/__slopsidian-shell-active", new Response("{}"));
    await offline.prepare();
    assert.ok(await storage.has(nested), "Post-adopt cleanup must retain a nested ':' base's cache.");
    assert.ok(await storage.has(other), "Post-adopt cleanup must retain another base's cache.");
    assert.ok(await meta.match("http://127.0.0.1:5173/other/__slopsidian-shell-active"), "Post-adopt cleanup must retain another base's pointer.");
    await offline.remove();
    assert.deepEqual((await storage.keys()).sort(), [SHELL_META_CACHE, nested, other, "unrelated-cache"].sort());
    assert.equal((await meta.keys()).length, 1, "Only this base's pointer is removed.");
    assert.equal(await storage.has(cacheName(BASE, manifest.version)), false);
    offline.serviceWorker.getRegistration = async () => ({ scope: BASE, unregister: async () => { throw new Error("denied"); } });
    await assert.rejects(() => offline.remove(), error => error.code === "partial-remove" && /denied/.test(error.message));
    offline.serviceWorker.getRegistration = async () => { throw new Error("lookup down"); };
    await assert.rejects(() => offline.remove(), error => error.code === "partial-remove" && /lookup down/.test(error.message));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("removing a nested app preserves the ancestor worker returned by scope lookup", async () => {
  const storage = new FakeStorage(), offline = shell(storage, async () => { throw new Error("Removal must not fetch"); });
  const parentCache = cacheName(new URL("/", BASE), "a".repeat(32));
  await storage.open(parentCache);
  let unregistered = false;
  offline.serviceWorker.getRegistration = async scope => {
    assert.equal(scope, new URL(BASE).pathname);
    return { scope: new URL("/", BASE).href, unregister: async () => { unregistered = true; return true; } };
  };
  await offline.remove();
  assert.equal(unregistered, false, "An ancestor registration is a different application");
  assert.equal(await storage.has(parentCache), true);
  offline.serviceWorker.getRegistration = async () => undefined;
  await offline.remove();
});

test("offline removal refuses retained records, retained files and unconfirmed worker removal", async () => {
  const { directory, manifest } = await site();
  try {
    const storage = new FakeStorage(), offline = shell(storage, server(directory).fetcher);
    await offline.prepare();
    const meta = await storage.open(SHELL_META_CACHE), originalDelete = meta.delete.bind(meta);
    meta.delete = async () => false;
    await assert.rejects(() => offline.remove(), error => error.code === "partial-remove" && /adoption record/.test(error.message));
    assert.equal((await offline.readPointer()).version, manifest.version);
    assert.ok(!offline.registrations.includes("unregister"));
    meta.delete = originalDelete;
    const deleteCache = storage.delete.bind(storage);
    storage.delete = async () => false;
    await assert.rejects(() => offline.remove(), error => error.code === "partial-remove" && /offline files/.test(error.message));
    assert.equal(await storage.has(cacheName(BASE, manifest.version)), true);
    assert.ok(!offline.registrations.includes("unregister"));
    storage.delete = deleteCache;
    offline.serviceWorker.getRegistration = async () => ({ scope: BASE, unregister: async () => false });
    await assert.rejects(() => offline.remove(), error => error.code === "partial-remove" && /did not confirm/.test(error.message));
    assert.equal(await storage.has(cacheName(BASE, manifest.version)), false);
    offline.serviceWorker.getRegistration = async () => ({ unregister: async () => true });
    await assert.rejects(() => offline.remove(), error => error.code === "partial-remove", "A registration without scope cannot establish ownership");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("two pages sharing one cache cannot prepare different versions or remove during a prepare; the pointer always names a complete retained cache", async () => {
  const one = await site(), two = await site({ "js/a.js": "second version" });
  try {
    const storage = new FakeStorage(), locks = new FakeLocks();
    let reached, release;
    const held = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const pageA = shell(storage, server(one.directory, { before: async path => { if (path === "js/a.js") { reached(); await gate; } } }).fetcher, { locks });
    const pageB = shell(storage, server(two.directory).fetcher, { locks });
    const first = pageA.prepare();
    await held;
    await assert.rejects(() => pageB.prepare(), error => error.code === "busy", "A second page must be refused while the first owns the shared cache.");
    await assert.rejects(() => pageB.remove(), error => error.code === "busy", "Remove must not delete a cache another page is adopting.");
    release();
    const adopted = await first;
    const pointer = await pageB.readPointer();
    assert.equal(pointer.version, one.manifest.version); assert.equal(adopted.version, one.manifest.version);
    assert.equal((await pageB.verify()).ok, true, "The pointer names a complete retained cache.");
    assert.ok(await storage.has(cacheName(BASE, one.manifest.version)));
    const second = await pageB.prepare();
    assert.equal(second.version, two.manifest.version);
    assert.deepEqual((await storage.keys()).filter(key => key.startsWith("slopsidian-shell:")), [cacheName(BASE, two.manifest.version)], "Only the newly adopted cache remains.");
    assert.equal((await pageA.verify()).ok, true);
    await pageA.remove();
    assert.equal(await pageB.readPointer(), null);
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("without Web Locks the offline copy is refused rather than mutated unprotected", async () => {
  const { directory } = await site();
  try {
    const offline = shell(new FakeStorage(), server(directory).fetcher, { locks: null });
    assert.equal((await offline.status()).state, "unsupported");
    await assert.rejects(() => offline.prepare(), error => error.code === "unsupported" && /Web Locks/.test(error.message));
    await assert.rejects(() => offline.remove(), error => error.code === "unsupported");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unsupported contexts and server failures are explicit", async () => {
  const unsupported = new OfflineShell({ base: BASE, caches: null, fetch: async () => new Response(""), serviceWorker: null, subtle: globalThis.crypto.subtle });
  assert.equal((await unsupported.status()).state, "unsupported");
  await assert.rejects(() => unsupported.prepare(), error => error instanceof ShellError && error.code === "unsupported");
  const missing = shell(new FakeStorage(), async () => new Response("x", { status: 404 }));
  await assert.rejects(() => missing.prepare(), error => error.code === "network" && /404/.test(error.message));
  const busy = shell(new FakeStorage(), () => new Promise(() => {}));
  void busy.prepare().catch(() => {});
  assert.throws(() => busy.prepare(), error => error.code === "busy");
});

async function serviceWorkerHarness(storage, source) {
  const listeners = {};
  const fetched = [];
  const self = { registration: { scope: BASE }, location: new URL(BASE + "service-worker.js"), skipWaiting() { listeners.skipped = true; }, clients: { claim: async () => { listeners.claimed = true; } }, addEventListener: (type, handler) => { listeners[type] = handler; }, caches: storage };
  const context = createContext({ self, caches: storage, URL, Response, TextEncoder, crypto: globalThis.crypto, fetch: async request => { fetched.push(request.url); if (context.networkDown) throw new TypeError("network down"); return new Response("network"); }, decodeURIComponent });
  new Script(stampWorker(source)).runInContext(context);
  const dispatch = async (url, { method = "GET", mode = "cors", headers = {} } = {}) => {
    let handled = null;
    listeners.fetch({ request: { url, method, mode, headers: new Map(Object.entries(headers)) }, respondWith: promise => { handled = promise; } });
    return handled ? await handled : null;
  };
  return { dispatch, fetched, listeners, context };
}
const realWorker = () => readFile(join(wwwroot, "service-worker.js"), "utf8");

test("service worker serves only the adopted manifest set inside its own scope and never mixes the network in", async () => {
  const worker = await realWorker(), { directory, manifest } = await site({}, worker);
  try {
    const storage = new FakeStorage(), offline = shell(storage, server(directory).fetcher);
    const harness = await serviceWorkerHarness(storage, worker);
    await harness.listeners.activate({ waitUntil: promise => promise });
    assert.equal(harness.listeners.claimed, true);
    assert.equal(await harness.dispatch("https://api.github.com/repos/a/b"), null, "Cross-origin GitHub traffic is never intercepted.");
    assert.equal(await harness.dispatch("http://127.0.0.1:5173/other/file.js"), null, "Outside the scope is never intercepted.");
    assert.equal(await harness.dispatch(BASE + "index.html", { method: "POST" }), null);
    assert.equal(await harness.dispatch(BASE + "offline-manifest.json"), null, "The manifest check always uses the network.");
    assert.equal(await harness.dispatch(BASE + "service-worker.js"), null);
    assert.equal(await (await harness.dispatch(BASE + "js/a.js")).text(), "network", "Without an adopted set the worker is a pass-through.");
    await offline.prepare();
    let admitted = null;
    harness.listeners.install({ waitUntil: promise => { admitted = promise; } });
    await admitted;
    assert.equal(harness.listeners.skipped, true, "A worker whose build the adoption record names is admitted.");
    assert.equal(await (await harness.dispatch(BASE + "js/a.js")).text(), "a");
    assert.equal(await (await harness.dispatch(BASE + "_framework/app.1.wasm")).headers.get("content-type"), "application/wasm");
    assert.equal(await (await harness.dispatch(BASE)).text(), '<base href="/app/" />index');
    assert.equal(await (await harness.dispatch(BASE + "remote-vault/github.com/o/r/tree/main/Example", { mode: "navigate" })).text(), '<base href="/app/" />index');
    harness.fetched.length = 0;
    assert.equal(await (await harness.dispatch(BASE + "api/token?secret=1")).text(), "network", "Non-shell paths are not cached or rewritten.");
    assert.deepEqual(harness.fetched, [BASE + "api/token?secret=1"]);
    await (await storage.open(cacheName(BASE, manifest.version))).delete(BASE + "js/a.js");
    const evicted = await harness.dispatch(BASE + "js/a.js");
    assert.equal(evicted.status, 503); assert.match(await evicted.text(), /removed by the browser/);
    assert.deepEqual(harness.fetched, [BASE + "api/token?secret=1"], "An evicted file never falls through to a different network version.");
    assert.equal(await harness.dispatch(BASE + "js/a.js", { headers: { "X-Slopsidian-Shell-Prepare": "1" } }), null, "Preparation downloads bypass the adopted set so repair and update reach the network.");
    for (const cache of storage.caches.values()) for (const url of cache.entries.keys()) assert.ok(!/token|api\.github|raw\.githubusercontent/.test(url), "No vault or API traffic is stored: " + url);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a tampered or unreadable adopted set is refused, never executed and never mixed with the network", async () => {
  const worker = await realWorker(), { directory, manifest } = await site({}, worker);
  try {
    const storage = new FakeStorage(), offline = shell(storage, server(directory).fetcher);
    const harness = await serviceWorkerHarness(storage, worker);
    await offline.prepare();
    const cache = await storage.open(cacheName(BASE, manifest.version));
    harness.fetched.length = 0;
    cache.entries.get(BASE + "_framework/app.1.wasm").bytes[0] ^= 1;
    const wasm = await harness.dispatch(BASE + "_framework/app.1.wasm");
    assert.equal(wasm.status, 503); assert.match(await wasm.text(), /corrupt and was not executed/);
    cache.entries.get(BASE + "js/a.js").bytes = new TextEncoder().encode("evil");
    assert.equal((await harness.dispatch(BASE + "js/a.js")).status, 503, "A same-or-different length rewrite is caught by size/SHA.");
    cache.entries.get(BASE + "index.html").bytes[0] ^= 1;
    assert.equal((await harness.dispatch(BASE, { mode: "navigate" })).status, 503, "A tampered entry page is not served as the ready shell.");
    assert.deepEqual(harness.fetched, [], "No tampered file falls back to the network.");
    assert.equal((await offline.verify()).ok, false);
    const manifestEntry = cache.entries.get(BASE + "offline-manifest.json");
    const stored = JSON.parse(new TextDecoder().decode(manifestEntry.bytes)); stored.files[0].sha256 = "0".repeat(64);
    manifestEntry.bytes = new TextEncoder().encode(JSON.stringify(stored));
    const damaged = await (await serviceWorkerHarness(storage, worker)).dispatch(BASE + "app.css");
    assert.equal(damaged.status, 503); assert.match(await damaged.text(), /manifest is missing or damaged/);
    await cache.delete(BASE + "offline-manifest.json");
    const fresh = await serviceWorkerHarness(storage, worker);
    assert.equal((await fresh.dispatch(BASE + "app.css")).status, 503, "A missing manifest of an adopted version is an error, not 'never prepared'.");
    const meta = await storage.open(SHELL_META_CACHE);
    await meta.put(BASE + "__slopsidian-shell-active", new Response("{broken"));
    const broken = await serviceWorkerHarness(storage, worker), refused = await broken.dispatch(BASE + "app.css");
    assert.equal(refused.status, 503); assert.match(await refused.text(), /adoption record is damaged/);
    assert.deepEqual(broken.fetched, []);
    await meta.delete(BASE + "__slopsidian-shell-active");
    assert.equal(await (await (await serviceWorkerHarness(storage, worker)).dispatch(BASE + "app.css")).text(), "network", "No record at all is genuinely not prepared.");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

    test("a warm worker re-validates the stored manifest on every request instead of trusting a memoized copy", async () => {
      const worker = await realWorker(), { directory, manifest } = await site({}, worker);
      try {
        const storage = new FakeStorage(), offline = shell(storage, server(directory).fetcher);
        const harness = await serviceWorkerHarness(storage, worker);
        await offline.prepare();
        harness.fetched.length = 0;
        assert.equal((await harness.dispatch(BASE + "app.css")).status, 200);
        const cache = await storage.open(cacheName(BASE, manifest.version)), entry = cache.entries.get(BASE + "offline-manifest.json");
        const stored = JSON.parse(new TextDecoder().decode(entry.bytes)); stored.files[0].sha256 = "0".repeat(64);
        entry.bytes = new TextEncoder().encode(JSON.stringify(stored, null, 2));
        const refused = await harness.dispatch(BASE + "app.css");
        assert.equal(refused.status, 503); assert.match(await refused.text(), /manifest is missing or damaged/);
        assert.equal((await harness.dispatch(BASE, { mode: "navigate" })).status, 503);
        assert.deepEqual(harness.fetched, [], "No network fallback after the stored manifest is damaged.");
      } finally { await rm(directory, { recursive: true, force: true }); }
    });

test("the service worker build is part of the shell version, so a worker-only update is never silently complete", async () => {
  const worker = await realWorker(), one = await site({}, worker), two = await site({}, worker + "\n// worker-only change\n");
  try {
    assert.deepEqual(one.manifest.files, two.manifest.files, "Only the worker differs.");
    assert.notEqual(one.manifest.version, two.manifest.version);
    assert.notEqual(one.manifest.serviceWorker.build, two.manifest.serviceWorker.build);
    const storage = new FakeStorage(), offline = shell(storage, server(one.directory).fetcher);
    const harness = await serviceWorkerHarness(storage, worker);
    await offline.prepare();
    assert.equal(await (await harness.dispatch(BASE + "js/a.js")).text(), "a");
    const updated = await serviceWorkerHarness(storage, worker + "\n// worker-only change\n");
    updated.context.networkDown = true;
    const mismatch = await updated.dispatch(BASE + "js/a.js");
    assert.equal(mismatch.status, 503); assert.match(await mismatch.text(), /different service worker build/);
    updated.context.networkDown = false;
    assert.equal(await (await updated.dispatch(BASE + "js/a.js")).text(), "network", "Online it is a plain network load, not a mixed cached shell.");
    assert.equal((await shell(storage, server(two.directory).fetcher).check()).upToDate, false);
    await shell(storage, server(two.directory).fetcher).prepare();
    assert.equal(await (await updated.dispatch(BASE + "js/a.js")).text(), "a", "Adopting the matching set re-binds the new worker.");
    const lying = server(two.directory, { replace: { "service-worker.js": worker } });
    await assert.rejects(() => shell(new FakeStorage(), lying.fetcher).prepare(), error => error.code === "corrupt" && /service worker does not match/.test(error.message));
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("a failed pointer write during a worker-changing update leaves the previous worker and adopted shell runnable offline", async () => {
  const worker = await realWorker(), one = await site({}, worker), two = await site({ "js/a.js": "b" }, worker + "\n// worker B\n");
  try {
    const storage = new FakeStorage(), pageA = shell(storage, server(one.directory).fetcher);
    await pageA.prepare();
    const workerA = await serviceWorkerHarness(storage, worker);
    // Storage fails exactly at the adoption pointer write.
    const open = storage.open.bind(storage);
    storage.open = async name => {
      const cache = await open(name);
      if (name === "slopsidian-shell-meta") { return { match: url => cache.match(url), delete: url => cache.delete(url), put: async () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } }; }
      return cache;
    };
    const pageB = shell(storage, server(two.directory).fetcher);
    await assert.rejects(() => pageB.prepare(), error => error.code === "quota");
    assert.deepEqual(pageB.registrations, [], "The new worker is never installed when adoption cannot be recorded.");
    storage.open = open;
    assert.equal((await pageA.readPointer()).version, one.manifest.version);
    workerA.context.networkDown = true;
    const served = await workerA.dispatch(BASE + "js/a.js");
    assert.equal(served.status, 200); assert.equal(await served.text(), "a", "The previous worker still serves the retained shell with the network off.");
    assert.equal(workerA.fetched.length, 0);
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("a failed worker registration restores the previous adoption record", async () => {
  const worker = await realWorker(), one = await site({}, worker), two = await site({ "js/a.js": "b" }, worker + "\n// worker B\n");
  try {
    const storage = new FakeStorage();
    await shell(storage, server(one.directory).fetcher).prepare();
    const failing = shell(storage, server(two.directory).fetcher, {});
    failing.serviceWorker.register = async () => { throw new Error("install blocked"); };
    await assert.rejects(() => failing.prepare(), error => error.code === "registration" && /not activated/.test(error.message));
    assert.equal((await failing.readPointer()).version, one.manifest.version, "The previous record is restored.");
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("an unusable service worker registration never reports adoption or replaces the previous record", async () => {
  const one = await site(), two = await site({ "js/a.js": "second version" });
  try {
    for (const hasPrevious of [false, true]) {
      const storage = new FakeStorage();
      if (hasPrevious) { await shell(storage, server(one.directory).fetcher).prepare(); }
      const previous = await shell(storage, server(one.directory).fetcher).readPointer();
      for (const registration of [
        undefined,
        {},
        { update: async () => {} },
        { update: async () => {}, active: { state: "activated" } },
        { update: async () => {}, active: { state: "activated", addEventListener() {} } },
      ]) {
        const offline = shell(storage, server(two.directory).fetcher);
        let readyReads = 0;
        offline.serviceWorker.register = async () => registration;
        Object.defineProperty(offline.serviceWorker, "ready", { get() { readyReads++; return Promise.resolve({}); } });
        await assert.rejects(() => offline.prepare(), error => error.code === "registration" && /no usable/.test(error.message));
        assert.equal(readyReads, 0, "A previously ready worker cannot hide an unusable registration.");
        assert.deepEqual(await offline.readPointer(), previous, "A rejected registration restores the exact earlier record.");
        if (hasPrevious) { assert.equal(await storage.has(cacheName(BASE, one.manifest.version)), true); }
      }
    }
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("a worker is admitted only while the adoption record names its build: installed, readiness-failed and late activation", async () => {
  const worker = await realWorker(), workerB = worker + "\n// worker B\n", one = await site({}, worker), two = await site({ "js/a.js": "b" }, workerB);
  const install = async harness => {
    let admitted = null;
    harness.listeners.install({ waitUntil: promise => { admitted = promise; } });
    return admitted;
  };
  try {
    const storage = new FakeStorage();
    // No record at all: nothing may install.
    const early = await serviceWorkerHarness(storage, worker);
    await assert.rejects(() => install(early), /does not name this service worker build/);
    assert.equal(early.listeners.skipped, undefined);
    await shell(storage, server(one.directory).fetcher).prepare();

    // Readiness failure: B installs and then becomes redundant (or the registration call throws); the page restores A's record.
    const failing = shell(storage, server(two.directory).fetcher);
    const listeners = new Map(), installing = { state: "installing", addEventListener: (type, handler) => listeners.set(type, handler), removeEventListener: () => {} };
    failing.serviceWorker.register = async () => { setTimeout(() => { installing.state = "redundant"; listeners.get("statechange")(); }, 0); return { installing, update: async () => {} }; };
    await assert.rejects(() => failing.prepare(), error => error.code === "registration" && /not activated/.test(error.message));
    assert.equal((await failing.readPointer()).version, one.manifest.version, "A's record is restored.");
    assert.ok(storage.caches.has(cacheName(BASE, one.manifest.version)), "A's cache set is retained.");

    // Late activation: a B worker whose install runs after the rollback rejects itself; A stays the only serving worker.
    const late = await serviceWorkerHarness(storage, workerB);
    await assert.rejects(() => install(late), /does not name this service worker build/);
    assert.equal(late.listeners.skipped, undefined, "A rolled-back worker never skips waiting.");
    const lateServing = await serviceWorkerHarness(storage, worker);
    lateServing.context.networkDown = true;
    assert.equal(await (await lateServing.dispatch(BASE + "js/a.js")).text(), "a", "A still serves its retained shell offline.");
    await install(lateServing);
    assert.equal(lateServing.listeners.skipped, true, "The previous worker still matches the record.");

    // A successful activation adopts B and admits only B.
    const good = shell(storage, server(two.directory).fetcher), activated = { state: "installing", addEventListener: (type, handler) => { setTimeout(() => { activated.state = "activated"; handler(); }, 0); }, removeEventListener: () => {} };
    good.serviceWorker.register = async () => ({ installing: activated, update: async () => {} });
    assert.equal((await good.prepare()).state, "adopted");

    // register() alone only exposes the previous active worker; the new one appears after an explicit update, and a failed update restores A.
    const raced = shell(storage, server(two.directory).fetcher), pending = { state: "installing", addEventListener: (type, handler) => { setTimeout(() => { pending.state = "activated"; handler(); }, 0); }, removeEventListener: () => {} };
    let updates = 0;
    const registration = { active: { state: "activated", addEventListener: () => {}, removeEventListener: () => {} }, installing: null, update: async () => { updates++; registration.installing = pending; } };
    raced.serviceWorker.register = async () => registration;
    assert.equal((await raced.prepare()).state, "adopted");
    assert.equal(updates, 1, "The update is requested explicitly.");
    assert.equal(pending.state, "activated", "Readiness waited for the new worker, not the previous active one.");
    const refused = shell(storage, server(two.directory).fetcher);
    refused.serviceWorker.register = async () => ({ active: { state: "activated" }, update: async () => { throw new TypeError("script rejected"); } });
    await assert.rejects(() => refused.prepare(), error => error.code === "registration" && /script rejected/.test(error.message));
    const admittedB = await serviceWorkerHarness(storage, workerB);
    await install(admittedB);
    assert.equal(admittedB.listeners.skipped, true);
    const previousWorker = await serviceWorkerHarness(storage, worker);
    await assert.rejects(() => install(previousWorker), /does not name this service worker build/, "The previous worker is no longer admitted after B is adopted.");
  } finally { await rm(one.directory, { recursive: true, force: true }); await rm(two.directory, { recursive: true, force: true }); }
});

test("publish tooling and entry page wire the offline shell without caching vault data", async () => {
  const publish = await readFile(join(root, "tools", "publish-web.mjs"), "utf8"), page = await readFile(join(wwwroot, "index.html"), "utf8");
  assert.match(publish, /buildOfflineManifest/); assert.match(page, /offline-shell-ui\.js/);
  const worker = await readFile(join(wwwroot, "service-worker.js"), "utf8");
  assert.doesNotMatch(worker, /cache\.put|caches\.delete|importScripts|api\.github\.com|raw\.githubusercontent/, "The worker is read-only and has no remote endpoints.");
});

test("fixture exit acceptance requires an actual zero exit without a signal or forced cleanup", async () => {
  const { createRequire } = await import("node:module");
  const { assertCleanExit } = createRequire(import.meta.url)("../tools/web-smoke-quit.cjs");
  assert.doesNotThrow(() => assertCleanExit({ exitCode: 0, signal: null, forced: false }));
  for (const result of [
    { exitCode: 1, signal: null, forced: false },
    { exitCode: null, signal: null, forced: false },
    { exitCode: 0, signal: "SIGTERM", forced: false },
    { exitCode: 0, signal: null, forced: true },
    { exitCode: 0, signal: null },
  ]) assert.throws(() => assertCleanExit(result, "test browser"), /test browser did not exit cleanly/);
});

test("the shared fixture drain waits for owned lifecycles and shell locks and propagates failures", async () => {
  const { createRequire } = await import("node:module"), vm = await import("node:vm");
  const { fixtureDrainScript } = createRequire(import.meta.url)("../tools/web-smoke-quit.cjs");
  const script = fixtureDrainScript();
  assert.doesNotThrow(() => new vm.Script(script));
  const calls = [];
  let queries = 0;
  const context = {
    app: { workspace: { whenIdle: async () => { calls.push("workspace"); } }, configuration: { whenIdle: async () => { calls.push("configuration"); } } },
    navigator: { locks: { query: async () => { calls.push("locks"); queries++; return { held: queries < 3 ? [{ name: "slopsidian-shell-mutation:/" }] : [], pending: [] }; } } },
    setTimeout: (callback, ms) => setTimeout(callback, ms === 5000 ? 50 : 0), clearTimeout,
  };
  const result = JSON.parse(JSON.stringify(await vm.runInNewContext(script, context)));
  assert.deepEqual(result, { app: true, lifecycle: [{ name: "workspace", idle: true }, { name: "configuration", idle: true }], polls: 2, drained: true });
  assert.deepEqual(calls, ["workspace", "configuration", "locks", "locks", "locks"]);
  const absent = JSON.parse(JSON.stringify(await vm.runInNewContext(script, { navigator: { locks: { query: async () => ({ held: [], pending: [] }) } }, setTimeout, clearTimeout })));
  assert.deepEqual(absent, { app: false, lifecycle: [], polls: 0, drained: true });
  await assert.rejects(vm.runInNewContext(script, { ...context, app: { workspace: { whenIdle: async () => { throw new Error("owned write failed"); } } } }), /owned write failed/);
  const timedOut = await vm.runInNewContext(script, { ...context, app: { workspace: { whenIdle: () => new Promise(() => {}) } } });
  assert.equal(timedOut.drained, false);
  assert.equal(timedOut.lifecycle[0].idle, false);
});

test("the acknowledged quit needs a real ack, shares one deadline and never commits after a failed drain", async () => {
  const { createRequire } = await import("node:module");
  const { acknowledgedQuit } = createRequire(import.meta.url)("../tools/web-smoke-quit.cjs");
  const never = new Promise(() => {}), sent = [], killed = [];
  const run = (overrides, deadlineMs = 60) => acknowledgedQuit({ drain: async () => ({ drained: true }), sendRequest: async () => { sent.push(1); }, acked: never, exited: never, kill: async () => { killed.push(1); }, deadlineMs, ...overrides });
  const ok = await run({ acked: Promise.resolve(true), exited: new Promise(resolve => setTimeout(resolve, 10)) });
  assert.equal(ok.acknowledged && ok.exited && !ok.forced, true);
  // Exit without an acknowledgement is not success.
  const early = await run({ exited: Promise.resolve(0) });
  assert.equal(early.acknowledged, false);
  assert.equal(early.early, true);
  const falseAck = await run({ acked: Promise.resolve(false), exited: new Promise(resolve => setTimeout(resolve, 10)) });
  assert.equal(falseAck.acknowledged, false, "A resolved false is not a nonce acknowledgement.");
  assert.equal(falseAck.early, true);
  // No ack and no exit: the single deadline expires and the process is stopped.
  const missing = await run({});
  assert.equal(missing.acknowledged, false);
  assert.equal(missing.forced, true);
  // The ack arrives late in the window and exit never follows: the total stays one deadline, not two.
  const started = Date.now();
  const slow = await run({ acked: new Promise(resolve => setTimeout(() => resolve(true), 80)) }, 100);
  assert.equal(slow.acknowledged && slow.forced, true);
  assert.ok(Date.now() - started < 170, "ack plus exit share one absolute deadline (" + (Date.now() - started) + " ms).");
  // A failed drain never sends the normal quit request.
  sent.length = 0; killed.length = 0;
  const failed = await run({ drain: async () => ({ drained: false }) });
  assert.equal(failed.committed, false);
  assert.equal(sent.length, 0);
  assert.equal(killed.length, 1);
  assert.equal(failed.cleanup, "killed-after-failed-drain");
});

test("the fixture host accepts a quit only for the exact nonce from its own main frame and origin", async () => {
  const { createRequire } = await import("node:module");
  const { acceptQuit, request, ack } = createRequire(import.meta.url)("../tools/web-smoke-quit.cjs");
  const mainFrame = {}, origin = "http://127.0.0.1:9000", good = { nonce: "n-1", message: request("n-1"), frame: mainFrame, mainFrame, frameUrl: origin + "/", origin };
  assert.deepEqual(acceptQuit(good), { ok: true });
  assert.equal(ack("n-1"), "WEB_QUIT_ACK n-1");
  assert.deepEqual(acceptQuit({ ...good, message: "ordinary console output" }), { ignore: true });
  assert.equal(acceptQuit({ ...good, message: request("n-2") }).reason, "wrong-nonce");
  assert.equal(acceptQuit({ ...good, nonce: undefined }).reason, "no-nonce-configured");
  assert.equal(acceptQuit({ ...good, frame: {} }).reason, "not-main-frame");
  assert.equal(acceptQuit({ ...good, frame: undefined }).reason, "not-main-frame");
  assert.equal(acceptQuit({ ...good, frameUrl: "http://evil.example/" }).reason, "wrong-origin");
  assert.equal(acceptQuit({ ...good, frameUrl: "not a url" }).reason, "wrong-origin");
  // An error that arrives after the acknowledgement is still audited and rejected.
  const page = { errors: [{ kind: "console", text: "late error after quit ack" }], failures: [], badResponses: [], requests: [], origin };
  assert.equal(isClean(auditPage(page, {})), false);
});
