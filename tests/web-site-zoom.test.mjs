import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";
const require = createRequire(import.meta.url);
const { siteZoomOrigin, siteZoomEntries } = require("../shared/web-site-zoom.cjs");
const { siteZoomPreferences, applySiteZoom, updateSiteZoom } = require("../desktop/web-site-zoom.cjs");
const key = "webviewer-site-zoom-v1", origin = "https://example.com";
let temporary, WebSiteZoom, WebViewerView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-site-zoom-tests-"));
  const entry = join(temporary, "site-zoom.mjs");
  await build({ stdin: { contents: 'export { WebSiteZoom } from "./client/web-site-zoom"; export { WebViewerView } from "./client/web-viewer";', resolveDir: root },
    outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "site-zoom-ui-fixture", setup(build) {
      build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice {} export class Modal {}" }));
    } }] });
  ({ WebSiteZoom, WebViewerView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });

test("Site zoom accepts only canonical credential-free HTTP(S) origins and at most 100 distinct finite 50–300% preferences", () => {
  assert.equal(siteZoomOrigin("https://EXAMPLE.com:443/private?q=secret#fragment"), origin);
  assert.notEqual(siteZoomOrigin(origin), siteZoomOrigin("http://example.com"));
  assert.notEqual(siteZoomOrigin("http://localhost:5000"), siteZoomOrigin("http://localhost:5001"));
  assert.deepEqual(siteZoomEntries([{ origin, factor: 1.25, future: true }]), [{ origin, factor: 1.25 }]);
  for (const url of ["file:///secret", "javascript:evil()", "https://user:pass@example.com", origin + "/\nwrong", null, {}, "x".repeat(8193)]) { assert.throws(() => siteZoomOrigin(url)); }
  for (const value of [null, {}, [{ origin: origin + "/", factor: 1 }], [{ origin, factor: 1 }, { origin, factor: 2 }],
    ...[0.49, 3.01, NaN, Infinity, "1.2", null].map(factor => [{ origin, factor }]),
    Array.from({ length: 101 }, (_, index) => ({ origin: "https://site-" + index + ".example", factor: 1 }))]) { assert.throws(() => siteZoomEntries(value)); }
});
function fixture() {
  const values = new Map(), events = []; let writes = 0, failed = false;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, core: { busy: false, isEnabled: () => true },
    workspace: { trigger(...args) { events.push(args); } },
    loadLocalStorage(name) { return structuredClone(values.get(app.vault.rootPath + "/" + name) ?? null); },
    saveLocalStorage(name, value) { if (failed) { throw new Error("Profile write failed"); } writes++; const path = app.vault.rootPath + "/" + name; if (value === null) { values.delete(path); } else { values.set(path, structuredClone(value)); } } };
  const preferences = new WebSiteZoom(app); preferences.start();
  return { app, values, events, preferences, writes: () => writes, fail(value) { failed = value; } };
}
test("Site zoom persists 100 most recently saved origins with opaque data, detached native maps, read/no-op preservation and restart/vault isolation", () => {
  const f = fixture(), p = f.preferences; assert.equal(f.writes(), 0);
  for (let index = 0; index < 101; index++) { p.remember("https://site-" + index + ".example/path", 1.3, p.generation); }
  assert.equal(p.count, 100); assert.equal(p.get("https://site-0.example"), null); assert.equal(p.get("https://site-100.example/other"), 1.3);
  const count = f.writes(), generation = p.generation;
  assert.equal(p.remember("https://site-100.example", 1.3, generation), false); assert.equal(p.forget(origin, generation), false);
  p.get("https://site-1.example"); assert.equal(f.writes(), count); assert.equal(p.generation, generation);
  const stored = f.values.get("vault-a/" + key); stored.future = { keep: ["中文", true] }; stored.entries[0].future = ["entry"];
  p.stop(); p.start(); p.remember(stored.entries[0].origin, 2, p.generation);
  const saved = f.values.get("vault-a/" + key); assert.deepEqual(saved.future, stored.future); assert.deepEqual(saved.entries.at(-1).future, ["entry"]);
  const native = p.native(); native.entries[0].factor = 3; assert.equal(p.get(native.entries[0].origin), 1.3);
  assert.ok(p.native().entries.every(item => Object.keys(item).join(",") === "origin,factor"));
  p.stop(); f.app.vault.rootPath = "vault-b"; p.start(); assert.equal(p.count, 0); p.remember(origin, 0.8, p.generation);
  p.stop(); f.app.vault.rootPath = "vault-a"; p.start(); assert.equal(p.get(origin), null); assert.equal(p.count, 100);
  assert.ok(f.events.every(([name]) => name === "webviewer:update-site-zoom"));
});
test("Unsupported or malformed site preferences remain untouched until explicit clear, which resets only this vault's key and invalidates old owners", () => {
  for (const value of [{ version: 2, entries: [], future: true }, { version: 1, entries: [{ origin, factor: "1.5" }] },
    { version: 1, entries: [{ origin, factor: 1 }, { origin, factor: 2 }] }, { version: 1, entries: [], future: "x".repeat(300_000) }]) {
    const f = fixture(), p = f.preferences; f.values.set("vault-a/" + key, value); f.values.set("vault-a/other", { keep: true });
    p.stop(); p.start(); assert.equal(p.available, false); assert.equal(p.canClear, true); assert.equal(p.get(origin), null);
    assert.throws(() => p.remember(origin, 1.5, p.generation), /unavailable/); assert.deepEqual(f.values.get("vault-a/" + key), value); assert.equal(f.writes(), 0);
    const generation = p.generation; p.clear(generation); assert.equal(f.values.has("vault-a/" + key), false);
    assert.deepEqual(f.values.get("vault-a/other"), { keep: true }); assert.throws(() => p.remember(origin, 1.5, generation), /no longer current/);
    p.remember(origin, 1.5, p.generation); p.forget(origin, p.generation); assert.equal(p.get(origin), null);
  }
});
test("Profile failures, stale no-ops, transitions, replaced roots and same-root lifetimes cannot mutate committed preferences", () => {
  const f = fixture(), p = f.preferences; p.remember(origin, 1.3, p.generation);
  const before = structuredClone([...f.values]), generation = p.generation, lifetime = p.lifetime;
  f.fail(true); assert.throws(() => p.remember(origin, 2, generation), /Profile/); assert.throws(() => p.clear(generation), /Profile/);
  assert.equal(p.get(origin), 1.3); assert.equal(p.generation, generation); assert.deepEqual([...f.values], before); f.fail(false);
  p.remember("https://other.example", 2, p.generation); assert.throws(() => p.remember(origin, 1.3, generation), /no longer current/);
  f.app.changingVault = true; assert.equal(p.get(origin), 1.3); assert.throws(() => p.forget(origin, p.generation), /no longer current/);
  f.app.changingVault = false; f.app.vault.rootPath = "vault-b"; assert.equal(p.get(origin), null); assert.deepEqual(p.native().entries, []);
  assert.throws(() => p.clear(p.generation), /no longer current/); f.app.vault.rootPath = "vault-a"; p.stop(); p.start();
  assert.notEqual(p.lifetime, lifetime); assert.equal(p.get(origin), 1.3); p.stop(); assert.equal(p.available, false); assert.equal(p.canClear, false);
});
function nativeFixture() {
  const calls = []; let failed = false, destroyed = false;
  const viewer = { url: origin + "/page", committed: true, loading: false, zoomFactor: 1, zoomRevision: 0, siteZoom: siteZoomPreferences({ revision: 1, entries: [{ origin, factor: 1.3 }] }),
    view: { webContents: { isDestroyed: () => destroyed, isLoadingMainFrame: () => viewer.loading, setZoomFactor(factor) { if (failed) { throw new Error("Native zoom failed"); } calls.push(factor); } } } };
  return { viewer, calls, fail() { failed = true; }, close() { destroyed = true; } };
}
test("Native site zoom applies exact-origin presets on committed documents while leaving unmatched destinations and unrelated manual zoom alone", () => {
  const f = nativeFixture(), v = f.viewer; assert.deepEqual(applySiteZoom(v), { zoomFactor: 1.3, zoomRevision: 1 });
  v.url = origin + "/different?q=one"; applySiteZoom(v); assert.equal(v.zoomRevision, 1);
  v.url = "http://example.com/page"; assert.equal(applySiteZoom(v), undefined); assert.equal(v.zoomFactor, 1.3);
  v.url = origin; v.zoomFactor = 1.1;
  updateSiteZoom(v, { revision: 2, entries: [{ origin, factor: 1.3 }, { origin: "https://other.example", factor: 2 }], applyOrigin: "https://other.example" });
  assert.equal(v.zoomFactor, 1.1);
  updateSiteZoom(v, { revision: 3, entries: [{ origin, factor: 1.5 }], applyOrigin: origin }); assert.equal(v.zoomFactor, 1.5);
  updateSiteZoom(v, { revision: 4, entries: [] }); assert.equal(v.zoomFactor, 1.5); assert.equal(applySiteZoom(v), undefined);
});
test("Native map updates validate atomically, discard old/equal revisions and never acknowledge failed or destroyed zoom surfaces", () => {
  const f = nativeFixture(), v = f.viewer, before = structuredClone(v.siteZoom);
  for (const request of [{ revision: -1, entries: [] }, { revision: 2, entries: [{ origin, factor: 4 }] },
    { revision: 2, entries: [], applyOrigin: origin + "/" }, { revision: "2", entries: [] }]) { assert.throws(() => updateSiteZoom(v, request)); assert.deepEqual(v.siteZoom, before); }
  updateSiteZoom(v, { revision: 1, entries: [], applyOrigin: origin }); updateSiteZoom(v, { revision: 0, entries: [] }); assert.deepEqual(v.siteZoom, before);
  f.fail(); assert.throws(() => applySiteZoom(v), /Native/); assert.equal(v.zoomFactor, 1); assert.equal(v.zoomRevision, 0);
  const closed = nativeFixture(); closed.close(); assert.throws(() => applySiteZoom(closed.viewer), /closed/); assert.equal(closed.viewer.zoomFactor, 1);
});
test("A newer map arriving first still applies the current origin's changed factor even when another origin triggered that update", () => {
  const f = nativeFixture(), v = f.viewer;
  updateSiteZoom(v, { revision: 3, entries: [{ origin, factor: 1.8 }, { origin: "https://other.example", factor: 2 }], applyOrigin: "https://other.example" });
  assert.equal(v.zoomFactor, 1.8);
  updateSiteZoom(v, { revision: 2, entries: [{ origin, factor: 1.8 }], applyOrigin: origin });
  assert.equal(v.zoomFactor, 1.8); assert.equal(v.siteZoom.entries.length, 2); assert.equal(v.siteZoom.revision, 3);
});
test("Updates received during provisional navigation retain the map and wait for the final committed document before changing zoom", () => {
  const f = nativeFixture(), v = f.viewer; v.url = "https://other.example/page"; v.committed = false; v.loading = true;
  updateSiteZoom(v, { revision: 2, entries: [{ origin: "https://other.example", factor: 2 }], applyOrigin: "https://other.example" });
  assert.equal(v.zoomFactor, 1); assert.equal(v.siteZoom.entries[0].factor, 2);
  v.url = "https://redirect-target.example"; v.committed = true; v.loading = false;
  applySiteZoom(v); assert.equal(v.zoomFactor, 1);
  v.url = "https://other.example/page"; v.committed = false; v.loading = true;
  updateSiteZoom(v, { revision: 3, entries: [{ origin: "https://other.example", factor: 2.5 }], applyOrigin: "https://other.example" });
  assert.equal(v.zoomFactor, 1);
  v.committed = true; v.loading = false; applySiteZoom(v); assert.equal(v.zoomFactor, 2.5);
});
function viewFixture() {
  const f = fixture(), view = Object.create(WebViewerView.prototype); Object.defineProperty(view, "_loaded", { value: true });
  Object.assign(view, { app: f.app, provider: { id: "webviewer", siteZoom: f.preferences }, created: true, disposed: false,
    siteZoomRoot: "vault-a", siteZoomLifetime: f.preferences.lifetime, siteZoomOwner: 0, navigationId: 2, zoomRevision: 4, zoomFactor: 1.4,
    url: origin + "/page", loading: false, message: { textContent: "" }, status: { textContent: "" } });
  view.leaf = { view }; return { ...f, view };
}
test("Reviewed site zoom callbacks refuse changed zoom/navigation/state/profile/root/lifetime/closed/disabled owners before even no-op writes", () => {
  for (const alter of [
    f => { f.view.zoomRevision++; }, f => { f.view.navigationId++; }, f => { f.view.siteZoomOwner++; }, f => { f.view.loading = true; },
    f => { f.view.url = "https://other.example"; }, f => { f.preferences.remember(origin, 1.4, f.preferences.generation); },
    f => { f.app.vault.rootPath = "vault-b"; }, f => { f.app.changingVault = true; }, f => { f.view.disposed = true; },
    f => { f.view.leaf.view = {}; }, f => { f.app.core.busy = true; }, f => { f.app.core.isEnabled = () => false; },
    f => { f.preferences.stop(); f.preferences.start(); },
  ]) {
    const f = viewFixture(), review = f.view.siteZoomReview(); alter(f); const before = structuredClone([...f.values]), writes = f.writes();
    assert.throws(() => f.view.saveSiteZoom(review, "remember"), /no longer current/);
    assert.equal(f.writes(), writes); assert.deepEqual([...f.values], before);
  }
  const f = viewFixture(); f.view.saveSiteZoom(f.view.siteZoomReview(), "remember"); assert.equal(f.preferences.get(origin), 1.4);
  assert.match(f.view.status.textContent, /saved/); const review = f.view.siteZoomReview(); f.view.saveSiteZoom(review, "forget"); assert.equal(f.preferences.get(origin), null);
  assert.throws(() => f.view.saveSiteZoom(review, "remember"), /no longer current/);
});
test("Late preference acknowledgements cannot revive cleared generations, closed owners or reopened same-root caches", async () => {
  for (const alter of [f => { f.preferences.clear(f.preferences.generation); }, f => { f.view.disposed = true; },
    f => { f.app.vault.rootPath = "vault-b"; }, f => { f.preferences.stop(); f.preferences.start(); }]) {
    const f = viewFixture(), accepted = []; let finish, request;
    f.view.acceptZoom = (...args) => accepted.push(args);
    f.view.request = async (action, value) => { request = { action, value }; return new Promise(resolve => { finish = resolve; }); };
    const pending = f.view.syncSiteZoom(origin); assert.equal(request.action, "site-zoom"); assert.equal(request.value.applyOrigin, origin);
    alter(f); finish({ zoomFactor: 2, zoomRevision: 5 }); await pending; assert.deepEqual(accepted, []);
  }
  const f = viewFixture(), accepted = []; f.view.acceptZoom = (...args) => accepted.push(args);
  f.view.request = async () => ({ zoomFactor: 1.4, zoomRevision: 4 }); await f.view.syncSiteZoom(); assert.deepEqual(accepted, [[1.4, 4]]);
});
