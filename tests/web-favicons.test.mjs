import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { root } from "./host.mjs";
import { faviconPng, faviconIco } from "../tools/web-favicon-fixtures.mjs";
const require = createRequire(import.meta.url);
const { faviconOrigin, faviconData, pngSize } = require("../shared/web-favicon.cjs");
const { MAX_BYTES, faviconImage, fetchFavicon, captureFavicon, decodeFavicon } = require("../desktop/web-favicon.cjs");
const png = faviconPng(), data = "data:image/png;base64," + png.toString("base64");
let temporary, WebFavicons, WebViewerView, WebHistoryView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-favicon-tests-"));
  const entry = join(temporary, "favicons.mjs");
  await build({ stdin: { contents: 'export { WebFavicons } from "./client/web-favicons"; export { WebViewerView } from "./client/web-viewer"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "favicon-ui-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice {} export class Modal {}" }));
  } }] });
  ({ WebFavicons, WebViewerView, WebHistoryView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });

test("Favicon display data permits only bounded PNG data images and canonical credential-free HTTP(S) origins", () => {
  assert.equal(faviconOrigin("https://Example.com:443/private?q=secret#part"), "https://example.com");
  assert.notEqual(faviconOrigin("https://example.com"), faviconOrigin("http://example.com"));
  assert.notEqual(faviconOrigin("http://localhost:5000"), faviconOrigin("http://localhost:5001"));
  assert.equal(faviconData(data), data); assert.deepEqual(pngSize(png), { width: 32, height: 32 });
  for (const value of ["javascript:evil()", "file:///private", "data:image/png;base64,AAAA", "https://user:pass@example.com", "https://example.com/\nwrong", null, {}]) { assert.throws(() => faviconOrigin(value)); }
  for (const value of ["https://example.com/icon.png", "data:image/svg+xml,<svg/>", "data:image/png;base64,AAAA", data + "\n", "data:image/png;base64," + "A".repeat(16384), null, {}]) { assert.throws(() => faviconData(value)); }
  const large = faviconPng([0, 0, 0, 255], 33, 32); assert.throws(() => faviconData("data:image/png;base64," + large.toString("base64")));
});

function cacheFixture() {
  const values = new Map(), events = []; let writes = 0, fail = false;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, core: { busy: false, isEnabled: () => true },
    workspace: { trigger(name) { events.push(name); } },
    loadLocalStorage(key) { return structuredClone(values.get(app.vault.rootPath + "/" + key) ?? null); },
    saveLocalStorage(key, value) { if (fail) { throw new Error("Profile write failed"); } writes++; const name = app.vault.rootPath + "/" + key; if (value === null) { values.delete(name); } else { values.set(name, structuredClone(value)); } } };
  const cache = new WebFavicons(app); cache.start();
  return { app, cache, values, events, writes: () => writes, fail(value) { fail = value; } };
}
test("A vault-local cache retains at most 100 most recently captured origins, preserves opaque data, does not write on read/no-op and survives stop/start without cross-vault leakage", () => {
  const f = cacheFixture(); assert.equal(f.writes(), 0); assert.equal(f.cache.get("https://example.com"), null);
  for (let index = 0; index < 101; index++) { assert.equal(f.cache.set("https://site-" + index + ".example/page", data, f.cache.generation), true); }
  assert.equal(f.cache.count, 100); assert.equal(f.cache.get("https://site-0.example"), null); assert.equal(f.cache.get("https://site-100.example/other"), data);
  const count = f.writes(); assert.equal(f.cache.set("https://site-100.example", data, f.cache.generation), false); assert.equal(f.writes(), count);
  f.cache.stop(); f.app.vault.rootPath = "vault-b"; f.cache.start(); assert.equal(f.cache.count, 0);
  f.cache.set("https://example.com", data, f.cache.generation); f.cache.stop(); f.app.vault.rootPath = "vault-a"; f.cache.start();
  assert.equal(f.cache.count, 100); assert.equal(f.cache.get("https://example.com"), null);
  const key = "vault-a/webviewer-favicons-v1", stored = f.values.get(key); stored.future = { keep: true }; stored.entries[0].future = ["entry"];
  f.cache.stop(); f.cache.start(); const changed = "data:image/png;base64," + faviconPng([200, 10, 10, 255]).toString("base64");
  f.cache.set(stored.entries[0].origin, changed, f.cache.generation); const saved = f.values.get(key);
  assert.deepEqual(saved.future, { keep: true }); assert.deepEqual(saved.entries.at(-1).future, ["entry"]);
  assert.ok(f.events.every(name => name === "webviewer:update-favicons"));
});
test("Unsupported or malformed cache versions are retained without capture writes until explicit Clear icons, which invalidates old generations and leaves other profile keys intact", () => {
  for (const value of [{ version: 2, entries: [], future: true }, { version: 1, entries: [{ origin: "https://example.com", png: "javascript:bad" }] },
    { version: 1, entries: [{ origin: "https://example.com", png: data }, { origin: "https://example.com", png: data }] }]) {
    const f = cacheFixture(), key = "vault-a/webviewer-favicons-v1"; f.values.set(key, structuredClone(value)); f.values.set("vault-a/other", { keep: true });
    f.cache.stop(); f.cache.start(); assert.equal(f.cache.count, 0); assert.equal(f.cache.needs("https://example.com"), false); assert.equal(f.cache.canClear, true);
    assert.equal(f.cache.set("https://example.com", data, f.cache.generation), false); assert.equal(f.writes(), 0); assert.deepEqual(f.values.get(key), value);
    const generation = f.cache.generation; f.cache.clear(); assert.equal(f.values.has(key), false); assert.deepEqual(f.values.get("vault-a/other"), { keep: true });
    assert.equal(f.cache.set("https://example.com", data, generation), false); assert.equal(f.cache.set("https://example.com", data, f.cache.generation), true);
  }
});
test("Profile failures, root transitions and stopped caches cannot replace committed cache state or revive old writes", () => {
  const f = cacheFixture(); f.cache.set("https://example.com", data, f.cache.generation); const before = structuredClone([...f.values]);
  f.fail(true); assert.throws(() => f.cache.set("https://another.example", data, f.cache.generation), /Profile/); assert.equal(f.cache.count, 1); assert.deepEqual([...f.values], before);
  const generation = f.cache.generation; assert.throws(() => f.cache.clear(), /Profile/); assert.equal(f.cache.set("https://another.example", data, generation), false);
  f.fail(false); f.app.changingVault = true; assert.equal(f.cache.get("https://example.com"), data);
  assert.equal(f.cache.canClear, true); assert.throws(() => f.cache.clear(), /no longer active/);
  assert.equal(f.cache.set("https://another.example", data, f.cache.generation), false);
  f.app.changingVault = false; f.app.vault.rootPath = "vault-b"; assert.equal(f.cache.get("https://example.com"), null);
  assert.equal(f.cache.set("https://another.example", data, f.cache.generation), false); f.cache.stop(); assert.equal(f.cache.canClear, false);
});
test("Native format bounds reject oversized/malformed images before decoding and accept bounded PNG, JPEG headers and normal Windows ICO bitmaps", async () => {
  assert.deepEqual(faviconImage(png), { format: "png", width: 32, height: 32 }); assert.equal(faviconImage(faviconIco()).format, "ico");
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217]); assert.equal(faviconImage(jpeg).format, "jpeg");
  assert.deepEqual(faviconImage(readFileSync(join(root, "tools/fixtures/web-favicon.jpg"))), { format: "jpeg", width: 32, height: 32 });
  const wide = Buffer.from(png); wide.writeUInt32BE(257, 16); assert.throws(() => faviconImage(wide));
  const badIco = faviconIco(); badIco.writeInt32LE(1000000, 22 + 4); assert.throws(() => faviconImage(badIco));
  for (const bytes of [Buffer.alloc(MAX_BYTES + 1), Buffer.from("<svg/>"), Buffer.alloc(0), Buffer.from([255, 216, 255])]) { assert.throws(() => faviconImage(bytes)); }
  const native = { createFromPath(path) { assert.equal(faviconImage(readFileSync(path)).format, "ico"); return imageStub(); } };
  assert.equal(await decodeFavicon(faviconIco(), { format: "ico" }, native, temporary), data);
});
function imageStub() { return { isEmpty: () => false, getSize: () => ({ width: 32, height: 32 }), resize() { return this; }, toDataURL: () => data }; }
test("Native icon fetching uses omitted credentials and refuses redirects/bad responses, oversized streams, stale owners and unsafe decoded output", async () => {
  const controller = new AbortController(); let decode = 0;
  const fetcher = async (url, options) => { assert.equal(url, "https://example.com/icon"); assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error"); return new Response(png, { headers: { "content-type": "image/png" } }); };
  assert.equal(await fetchFavicon("https://example.com/icon", fetcher, () => { decode++; return data; }, controller.signal, () => true), data); assert.equal(decode, 1);
  for (const response of [new Response(png, { status: 404 }), new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    new Response(Buffer.alloc(MAX_BYTES + 1), { headers: { "content-type": "image/png" } }),
    new Response(png, { headers: { "content-type": "image/png", "content-length": String(MAX_BYTES + 1) } })]) {
    await assert.rejects(fetchFavicon("https://example.com/icon", async () => response, () => { throw new Error("decoder should not run"); }, controller.signal, () => true));
  }
  await assert.rejects(fetchFavicon("https://example.com/icon", fetcher, () => data, controller.signal, () => false));
  await assert.rejects(fetchFavicon("https://example.com/icon", fetcher, () => "data:image/svg+xml,<svg/>", controller.signal, () => true));
});
test("Native capture reads only bounded head icon links, checks page/navigation ownership, attempts once per navigation and aborts held work", async () => {
  const endpoint = "http://127.0.0.1:56789", url = "https://example.com/page", seen = [];
  const contents = { isDestroyed: () => false, getURL: () => url, isLoadingMainFrame: () => false, session: { fetch: async address => { seen.push(address); return new Response(png, { headers: { "content-type": "image/png" } }); } },
    async executeJavaScriptInIsolatedWorld(world, scripts) {
      assert.equal(world, 1209); const nodes = [{ tagName: "LINK", rel: "shortcut icon", href: "https://example.com/icon" }]; let index = 0;
      return runInNewContext(scripts[0].code, { NodeFilter: { SHOW_ELEMENT: 1 }, document: { head: {}, createTreeWalker: () => ({ nextNode: () => nodes[index++] ?? null }) } });
    } };
  const viewer = { navigationId: 1, committed: true, view: { webContents: contents } }, native = { createFromBuffer: () => imageStub() };
  assert.equal(await captureFavicon(viewer, endpoint, { url, navigationId: 1 }, () => true, native, temporary), data); assert.deepEqual(seen, ["https://example.com/icon"]);
  assert.equal(await captureFavicon(viewer, endpoint, { url, navigationId: 1 }, () => true, native, temporary), null);
  viewer.navigationId = 2; assert.equal(await captureFavicon(viewer, endpoint, { url, navigationId: 1 }, () => true, native, temporary), null);
  contents.executeJavaScriptInIsolatedWorld = () => new Promise(() => {});
  const pending = captureFavicon(viewer, endpoint, { url, navigationId: 2 }, () => true, native, temporary); viewer.faviconController.abort(); assert.equal(await pending, null);
});
function viewFixture() {
  const f = cacheFixture(), view = Object.create(WebViewerView.prototype), url = "https://example.com/page"; let requests = 0;
  Object.defineProperty(view, "_loaded", { value: true });
  Object.assign(view, { app: f.app, provider: { id: "webviewer", favicons: f.cache, history: { read: async () => ({ history: { recording: true, entries: [{ url }] } }) } },
    disposed: false, leaf: { view }, navigationId: 1, url, faviconNavigation: -1, faviconRoot: f.app.vault.rootPath, faviconLifetime: f.cache.lifetime, faviconTasks: 0 });
  view.request = async action => { assert.equal(action, "favicon"); requests++; return data; };
  return { ...f, view, url, requests: () => requests };
}
test("Renderer capture requires an owned recorded visit and refuses paused/missing visits, cache clearing, navigation, foreign roots and same-root reopened owners", async () => {
  const f = viewFixture(); await f.view.captureFavicon({ url: f.url, navigationId: 1 }); assert.equal(f.cache.get(f.url), data); assert.equal(f.requests(), 1);
  await f.view.captureFavicon({ url: f.url, navigationId: 1 }); assert.equal(f.requests(), 1);
  for (const history of [{ recording: false, entries: [{ url: f.url }] }, { recording: true, entries: [] }]) {
    const g = viewFixture(); g.view.provider.history.read = async () => ({ history }); await g.view.captureFavicon({ url: g.url, navigationId: 1 }); assert.equal(g.requests(), 0);
  }
  for (const change of [g => g.cache.clear(), g => { g.view.navigationId++; }, g => { g.app.vault.rootPath = "vault-b"; },
    g => { g.cache.stop(); g.cache.start(); }, g => { g.view.disposed = true; }]) {
    const g = viewFixture(); let release; g.view.request = () => new Promise(resolve => { release = resolve; });
    const pending = g.view.captureFavicon({ url: g.url, navigationId: 1 }); while (!release) { await new Promise(resolve => setTimeout(resolve, 0)); }
    change(g); release(data); await pending; assert.equal(g.cache.get(g.url), null);
  }
});
test("Decorative cache updates touch only icon holders and Clear icons state, preserving selection, menus, reviews and history ownership counters", () => {
  const view = Object.create(WebHistoryView.prototype), menu = { hide() { throw new Error("Icon updates must not dismiss menus"); } }, review = {}, archive = {}, selected = new Set(["one"]);
  const holders = [{ dataset: { webHistoryIcon: "https://example.com" } }], rendered = [];
  Object.assign(view, { disposed: false, list: { querySelectorAll: () => holders }, clearIcons: {}, provider: { favicons: { canClear: true } },
    visitMenu: menu, review, archivePreview: archive, selected, revision: 7, orderRevision: 3, copySequence: 9 });
  view.renderFavicon = (holder, url) => rendered.push([holder, url]); view.updateFavicons();
  assert.deepEqual(rendered, [[holders[0], "https://example.com"]]); assert.equal(view.clearIcons.disabled, false);
  assert.equal(view.visitMenu, menu); assert.equal(view.review, review); assert.equal(view.archivePreview, archive); assert.equal(view.selected, selected);
  assert.equal(view.revision, 7); assert.equal(view.orderRevision, 3); assert.equal(view.copySequence, 9);
});
