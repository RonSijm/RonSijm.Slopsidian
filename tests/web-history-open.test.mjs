import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";
let temporary, historyOpenReview, WebHistory, WebHistoryView, RealOpenModal;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "history-open-tests-"));
  const entry = join(temporary, "open.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-open"; export { WebHistory } from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view"; export { WebHistoryOpenModal as RealOpenModal } from "./client/web-history-open-modal";', resolveDir: root },
    outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "open-review-fixture", setup(build) {
      build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
      build.onResolve({ filter: /^\.\/web-history-open-modal$/ }, () => ({ path: "modal", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "ui" ? "export class Notice {} export class Modal {}" :
        "export class WebHistoryOpenModal { constructor(app,review,actions){this.review=review;this.actions=actions;this.isOpen=false;this.invalid=false;this.modalEl={focus(){}};} get available(){return this.isOpen&&!this.invalid;} open(){this.isOpen=true;} invalidate(){this.invalid=true;} forceClose(){this.isOpen=false;this.actions.closed();} }" }));
    } }] });
  ({ historyOpenReview, WebHistory, WebHistoryView, RealOpenModal } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const day = new Date(2026, 0, 15, 12).getTime();
const visit = (id, visitedAt = day, title = "Chosen 中文 😀") => ({ id, visitedAt, title, url: "https://EXAMPLE.com/" + id, future: { keep: true } });
const seed = () => ({ version: 1, recording: false, entries: [visit("before", day - 86400000), visit("one"), visit("two"), { ...visit("last", day + 1, '<img src=x> ![[Secret]]'), url: "https://EXAMPLE.com/one" }], future: { keep: ["中文", true] } });
const selection = (ids = ["one", "last"]) => ({ query: "", ids, dates: { fromDate: "", throughDate: "" }, order: "newest" });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture() {
  let data = seed(), version = 1, writes = 0;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
    async write(document, next) { assert.equal(document.root, app.vault.rootPath); assert.equal(document.version, String(version)); data = structuredClone(next); version++; writes++; return { ...document, version: String(version), data: structuredClone(data) }; },
  } };
  const store = new WebHistory(app); store.start();
  return { app, store, data: () => structuredClone(data), writes: () => writes, external() { data.external = true; version++; } };
}

test("Open review detaches exact checked IDs in chronological display order, retains literal titles and repeated addresses, normalizes only opened URLs and never imports opaque fields", () => {
  const data = seed(), ids = ["one", "two", "last"], review = historyOpenReview(data, selection(ids));
  assert.deepEqual(review.entries.map(entry => entry.id), ["last", "two", "one"]);
  assert.deepEqual(review.entries.map(entry => entry.url), ["https://example.com/one", "https://example.com/two", "https://example.com/one"]);
  assert.equal(review.entries[0].title, '<img src=x> ![[Secret]]'); assert.ok(!("future" in review.entries[0]));
  assert.deepEqual(historyOpenReview(data, { ...selection(ids), order: "oldest" }).entries.map(entry => entry.id), ["one", "two", "last"]);
  review.entries[0].title = "mutated"; assert.deepEqual(data, seed()); assert.deepEqual(ids, ["one", "two", "last"]);
});
test("Open review accepts 1–20 checked visits and refuses empty/duplicate/sparse/malformed/unknown/hidden/over-limit choices, invalid dates/search/order and unsafe URLs without truncation", () => {
  for (const ids of [undefined, null, "one", [], ["one", "one"], ["missing"], ["one", null], Array(1), Array.from({ length: 21 }, (_, index) => "v" + index)]) { assert.throws(() => historyOpenReview(seed(), { ...selection(), ids })); }
  const many = { version: 1, entries: Array.from({ length: 21 }, (_, index) => visit("v" + index)) };
  assert.equal(historyOpenReview(many, selection(many.entries.slice(0, 20).map(entry => entry.id))).entries.length, 20);
  assert.equal(historyOpenReview(seed(), { ...selection(["one"]), query: "Chosen", dates: { fromDate: "2026-01-15", throughDate: "2026-01-15" } }).entries.length, 1);
  for (const change of [{ query: "missing" }, { query: "x".repeat(1025) }, { order: "url" }, { dates: { fromDate: "2026-02-30" } }, { dates: { fromDate: "2026-01-16" } }]) { assert.throws(() => historyOpenReview(seed(), { ...selection(["one"]), ...change })); }
  for (const url of ["javascript:evil()", "https://user:pass@example.com", "file:///secret"]) { const data = seed(); data.entries[1].url = url; assert.throws(() => historyOpenReview(data, selection(["one"]))); }
});
test("Queued opening captures reviewed IDs/addresses before waiting and preserves eligible Undo/Redo and history bytes without writes", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), "two", () => true); let snapshot = await f.store.read(), token = f.store.getUndo(snapshot);
  const opened = []; assert.equal(await f.store.openSelected(snapshot, selection(), () => true, async url => { opened.push(url); }), 2); assert.equal(f.store.getUndo(snapshot).id, token.id);
  await f.store.undo(snapshot, token, () => true); snapshot = await f.store.read(); token = f.store.getRedo(snapshot);
  const held = deferred(); f.store.tail = held.promise; const chosen = selection(), pending = f.store.openSelected(snapshot, chosen, () => true, async url => { opened.push(url); });
  chosen.ids.length = 0; snapshot.document.data.entries.length = 0; held.resolve(); assert.equal(await pending, 2);
  assert.deepEqual(opened, Array(4).fill("https://example.com/one")); assert.equal(f.writes(), 2); assert.deepEqual(f.data(), seed()); assert.equal(f.store.getRedo(await f.store.read()).id, token.id); await f.store.stop();
});
test("External version changes refuse before the first tab and stop a partial batch before the next exact address without overwriting history", async () => {
  const f = fixture(), snapshot = await f.store.read(), opened = []; f.external();
  await assert.rejects(f.store.openSelected(snapshot, selection(), () => true, async url => { opened.push(url); }), error => error.opened === 0 && /history changed/i.test(error.message)); assert.deepEqual(opened, []);
  const current = await f.store.read(); await assert.rejects(f.store.openSelected(current, selection(), () => true, async url => { opened.push(url); f.external(); }), error => error.opened === 1 && error.total === 2 && /history changed/i.test(error.message));
  assert.equal(opened.length, 1); assert.equal(f.writes(), 0); assert.equal(f.data().external, true); await f.store.stop();
});
test("Queued owner, selected root, provider stop and changing-vault guards refuse all tabs, and a changed owner between tabs stops at its confirmed count", async () => {
  for (const alter of [f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; }, f => { f.store.accepting = false; }, f => { f.current = false; }]) {
    const f = fixture(), snapshot = await f.store.read(), held = deferred(); f.current = true; f.store.tail = held.promise;
    let opened = 0; const pending = f.store.openSelected(snapshot, selection(), () => f.current, async () => { opened++; }); alter(f); held.resolve();
    await assert.rejects(pending, /active|available/); assert.equal(opened, 0); await f.store.stop();
  }
  const f = fixture(), snapshot = await f.store.read(); let current = true;
  await assert.rejects(f.store.openSelected(snapshot, selection(), () => current, async () => { current = false; }), error => error.opened === 1 && error.total === 2); await f.store.stop();
});
test("Normal recorded navigation waits behind the bounded open operation and can update history only after all reviewed tabs have opened", async () => {
  const f = fixture(); f.store.record("https://example.com/start", "Start"); await f.store.whenIdle();
  // Enable recording through its ordinary serialized preference write.
  await f.store.setRecording(true, () => true); const snapshot = await f.store.read(), beforeWrites = f.writes(), opened = [];
  await f.store.openSelected(snapshot, selection(["one", "two"]), () => true, async url => { opened.push(url); f.store.record(url, "Opened"); assert.equal(f.writes(), beforeWrites); });
  assert.deepEqual(opened, ["https://example.com/two", "https://example.com/one"]); await f.store.whenIdle(); assert.equal(f.writes(), beforeWrites + 2); assert.equal(f.data().recording, true); await f.store.stop();
});
test("A failed tab callback reports its exact confirmed partial count, stops subsequent opens and never retries an already opened visit", async () => {
  const f = fixture(), snapshot = await f.store.read(), calls = [];
  await assert.rejects(f.store.openSelected(snapshot, selection(["one", "two", "last"]), () => true, async url => { calls.push(url); if (calls.length === 2) { throw new Error("Fixture tab creation failed"); } }),
    error => error.opened === 1 && error.total === 3 && /Opened 1 of 3.*Fixture tab creation failed/.test(error.message));
  assert.deepEqual(calls, ["https://example.com/one", "https://example.com/two"]); assert.equal(f.writes(), 0); await f.store.stop();
});
async function viewFixture() {
  const f = fixture(), snapshot = await f.store.read(), view = Object.create(WebHistoryView.prototype), opened = [];
  f.app.core = { busy: false, isEnabled: () => true }; Object.defineProperty(view, "_loaded", { value: true, configurable: true });
  Object.assign(view, { app: f.app, provider: { id: "webviewer", history: f.store, async openUrl(url, newTab) { assert.equal(newTab, true); opened.push(url); } },
    snapshot, leaf: { view, pinned: true }, busy: false, disposed: false, refreshing: false, revision: 1, orderRevision: 0, sortOrder: "oldest",
    selected: new Set(["one", "last"]), search: { value: "" }, from: { value: "", validity: { badInput: false } }, through: { value: "", validity: { badInput: false } },
    rangeState: { fromDate: "", throughDate: "" }, confirmation: {}, review: null, openPreview: null, state: { future: { keep: ["中文", true] } }, syncSelection() {} });
  return { ...f, view, snapshot, opened };
}
test("A pinned pane reviews exact selected display order, opens fresh tabs and guards changed search/dates/order/revision/owner/root/provider before opening", async () => {
  const f = await viewFixture(); f.view.beginOpenSelected(); const modal = f.view.openPreview;
  assert.equal(modal.review.order, "oldest"); assert.deepEqual(modal.review.entries.map(entry => entry.id), ["one", "last"]); assert.equal(await modal.actions.open(), 2); assert.equal(f.view.leaf.pinned, true); await f.store.stop();
  for (const alter of [f => { f.view.search.value = "changed"; }, f => { f.view.from.value = "2026-01-15"; }, f => { f.view.orderRevision++; }, f => { f.view.revision++; }, f => { f.view.selected.delete("last"); },
    f => { f.view.leaf.view = {}; }, f => { f.view.disposed = true; }, f => { f.app.core.isEnabled = () => false; }, f => { f.app.vault.rootPath = "vault-b"; }, f => { Object.defineProperty(f.view, "_loaded", { value: false }); }]) {
    const f = await viewFixture(); f.view.beginOpenSelected(); const modal = f.view.openPreview; alter(f); await assert.rejects(modal.actions.open(), /active|available/); assert.deepEqual(f.opened, []); await f.store.stop();
  }
});
test("Changing selection away and back expires the old review, reset/close discard it, and selected IDs/open batches never enter saved leaf state", async () => {
  const f = await viewFixture(); f.view.beginOpenSelected(); const modal = f.view.openPreview;
  f.view.setSelected(f.snapshot, "last", false); f.view.setSelected(f.snapshot, "last", true); assert.equal(modal.invalid, true); await assert.rejects(modal.actions.open(), /available/);
  assert.deepEqual(f.view.getState(), { future: { keep: ["中文", true] }, query: "", fromDate: "", throughDate: "", sortOrder: "oldest" });
  modal.forceClose(); assert.equal(f.view.openPreview, null); f.view.beginOpenSelected(); const next = f.view.openPreview; f.view.resetSelection(); assert.equal(next.invalid, true); assert.equal(f.view.selected.size, 0); await f.store.stop();
});
test("The real modal permits only one confirmation attempt, retains partial failure feedback and cannot retry or open after expiration/close", async () => {
  const modal = Object.create(RealOpenModal.prototype), error = { hidden: true }, status = {}, confirm = {}, cancel = {}, contentEl = { dataset: {} }; let attempts = 0;
  Object.assign(modal, { app: { core: { async run(action) { await action(); } } }, actions: { async open() { attempts++; throw new Error("Opened 1 of 2 tabs. Fixture failure"); } }, valid: true, attempted: false, busy: false, isOpen: true, error, status, confirm, cancel, contentEl });
  await modal.openVisits(); assert.equal(attempts, 1); assert.equal(contentEl.dataset.webHistoryOpen, "stopped"); assert.match(error.textContent, /Opened 1 of 2/); assert.equal(confirm.disabled, true); assert.equal(cancel.textContent, "Done");
  await modal.openVisits(); assert.equal(attempts, 1); modal.attempted = false; modal.invalidate(); await modal.openVisits(); assert.equal(attempts, 1);
});
