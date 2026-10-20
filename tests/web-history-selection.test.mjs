import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, WebHistoryData, WebHistory, WebHistoryView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "history-selection-tests-"));
  const entry = join(temporary, "selection.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "notice-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "notice", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice { constructor() {} } export class Modal {}" }));
  } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const visit = (id, title = "中文 Story", url = "https://example.com/same") => ({ id, title, url, visitedAt: new Date(2026, 0, 15, 12).getTime(), future: { keep: [id, true] } });
const seed = () => ({ version: 1, recording: false, entries: [visit("one"), visit("keep", "Other"), visit("two"), visit("__proto__"), visit("constructor")], future: { keep: ["中文", true] } });

test("Selected removal uses exact distinct IDs rather than URLs, retaining unselected order/opaque fields and the caller's data", () => {
  const original = seed(), history = new WebHistoryData(original), ids = ["constructor", "one", "__proto__"];
  assert.equal(history.removeSelected(ids), 3);
  assert.deepEqual(history.data, { ...original, entries: [original.entries[1], original.entries[2]] });
  assert.deepEqual(ids, ["constructor", "one", "__proto__"]); assert.deepEqual(original, seed()); assert.equal(history.recording, false);
});

test("Empty, duplicate, missing, malformed and oversized selections refuse atomically; the complete 1000-visit selection is supported", () => {
  for (const ids of [[], ["one", "one"], ["one", "missing"], [null], [1], new Array(1), null, {}, "one", Array(1001).fill("one")]) {
    const history = new WebHistoryData(seed()), original = structuredClone(history.data);
    assert.throws(() => history.removeSelected(ids), /selected visits/); assert.deepEqual(history.data, original);
  }
  const entries = Array.from({ length: 1000 }, (_, index) => visit("visit-" + index));
  const history = new WebHistoryData({ version: 1, entries, recording: false, future: { retained: true } });
  assert.equal(history.removeSelected(entries.map(entry => entry.id)), 1000);
  assert.deepEqual(history.data, { version: 1, entries: [], recording: false, future: { retained: true } });
});

function storeFixture() {
  let data = seed(), version = 0, writes = 0;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
    async write(document, next) {
      if (document.root !== app.vault.rootPath || document.version !== String(version)) { throw Error("Configuration changed on disk"); }
      data = structuredClone(next); version++; writes++;
      return { ...document, version: String(version), data: structuredClone(data) };
    },
  } };
  const store = new WebHistory(app); store.start();
  return { app, store, data: () => structuredClone(data), writes: () => writes, external(next) { data = structuredClone(next); version++; } };
}

test("Queued selected edits capture reviewed data/version/IDs before queueing and refuse external edits until a fresh selection is reviewed", async () => {
  const f = storeFixture(), snapshot = await f.store.read(), ids = ["one", "two"];
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = f.store.removeSelected(snapshot, ids, () => true);
  ids.splice(0, ids.length, "keep"); snapshot.document.root = "other"; snapshot.document.version = "changed"; snapshot.document.data.entries.length = 0;
  release(); await pending;
  const original = seed(), remaining = { ...original, entries: original.entries.filter(entry => !["one", "two"].includes(entry.id)) };
  assert.deepEqual(f.data(), remaining); assert.equal(f.writes(), 1);
  const reviewed = await f.store.read(), external = { ...f.data(), future: { external: "keep" } }; f.external(external);
  await assert.rejects(f.store.removeSelected(reviewed, ["keep"], () => true), /changed on disk/);
  assert.deepEqual(f.data(), external); assert.equal(f.writes(), 1);
  await f.store.removeSelected(await f.store.read(), ["keep"], () => true);
  assert.deepEqual(f.data(), { ...external, entries: external.entries.filter(entry => entry.id !== "keep") });
  await f.store.stop();
});

test("Selected edits recheck queued ownership/root/transition and never write from cancelled, stopped, foreign or invalid selections", async () => {
  for (const change of [f => { f.current = false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; }, f => { f.store.active = false; }]) {
    const f = storeFixture(); f.current = true; const snapshot = await f.store.read();
    let release; f.store.tail = new Promise(resolve => { release = resolve; });
    const pending = f.store.removeSelected(snapshot, ["one"], () => f.current); change(f); release();
    await assert.rejects(pending, /no longer active/); assert.deepEqual(f.data(), seed()); assert.equal(f.writes(), 0);
  }
  const f = storeFixture(), foreign = await f.store.read(); foreign.document.root = "other";
  await assert.rejects(f.store.removeSelected(foreign, ["one"], () => true), /no longer active/);
  await assert.rejects(f.store.removeSelected(await f.store.read(), ["one", "missing"], () => true), /selected visits/);
  assert.equal(f.writes(), 0); await f.store.stop();
});

function viewFixture(query = "story", dates = { fromDate: "2026-01-15", throughDate: "2026-01-15" }) {
  const f = storeFixture(), view = Object.create(WebHistoryView.prototype), span = {}, confirm = { focus() {} }, calls = [];
  Object.defineProperty(view, "_loaded", { value: true, writable: true }); f.app.core = { busy: false, isEnabled: () => true };
  const snapshot = { document: { root: "vault-a", version: "0", data: seed() }, history: new WebHistoryData(seed()) };
  Object.assign(view, { app: f.app, leaf: { view }, provider: { id: "webviewer", history: {
    async removeSelected(snapshot, ids, current) { assert.equal(current(), true); calls.push({ snapshot, ids }); }, read: async () => snapshot,
  } }, state: { future: { keep: ["中文", true] } }, selected: new Set(), rangeState: { ...dates }, disposed: false, busy: false, refreshing: false, revision: 5, snapshot, review: null,
  search: { value: query, focus() { calls.push("search-focus"); } }, from: { value: dates.fromDate, validity: { badInput: false } }, through: { value: dates.throughDate, validity: { badInput: false } },
  removeSelected: { focus() { calls.push("selection-focus"); } }, rangeError: { textContent: "" }, error: { textContent: "" },
  confirmation: { hidden: true, querySelector: selector => selector === "span" ? span : confirm } });
  view.render = () => {}; view.syncSelection = () => {}; view.perform = action => action();
  return { ...f, view, snapshot, span, confirm, calls };
}

test("Per-pane selection is restricted to current filtered visits, reviews exact IDs/count, cancels on checkbox edits and stays out of saved state", async () => {
  const f = viewFixture(), g = viewFixture();
  f.view.setSelected(f.snapshot, "one", true); f.view.setSelected(f.snapshot, "two", true);
  assert.deepEqual([...f.view.selected], ["one", "two"]); assert.equal(g.view.selected.size, 0);
  assert.throws(() => f.view.setSelected(f.snapshot, "keep", true), /selection/);
  const state = f.view.getState(); assert.equal("selected" in state, false); assert.equal("selectedIds" in state, false);
  f.view.beginSelectedRemoval(); assert.equal(f.span.textContent, "Remove 2 selected visits? Other visits will be kept. ");
  assert.equal(f.confirm.textContent, "Remove selected visits"); assert.deepEqual(f.view.review.ids, ["two", "one"]);
  await f.view.confirmRemoval(); assert.deepEqual(f.calls, [{ snapshot: f.snapshot, ids: ["two", "one"] }]);
  f.view.cancelRemoval(); assert.equal(f.view.review, null); assert.equal(f.calls.at(-1), "selection-focus");
  f.view.selectShown(); assert.equal(f.view.selected.size, 4);
  f.view.beginSelectedRemoval(); f.view.setSelected(f.snapshot, "one", false); assert.equal(f.view.review, null);
  f.view.resetSelection(); assert.equal(f.view.selected.size, 0); assert.deepEqual(f.view.getState(), state);
});

test("Saved selected-review callbacks reject changed IDs/filters/refresh/lifecycle and valid state restoration clears selection only after validation", async () => {
  for (const change of [f => { f.view.selected.delete("one"); }, f => { f.view.search.value = "other"; }, f => { f.view.from.value = "2026-01-16"; }, f => { f.view.refreshing = true; }, f => { f.view.revision++; }, f => { f.view.leaf.view = {}; }, f => { f.view.disposed = true; }, f => { f.app.core.isEnabled = () => false; }, f => { f.app.vault.rootPath = "vault-b"; }]) {
    const f = viewFixture(); f.view.setSelected(f.snapshot, "one", true); f.view.beginSelectedRemoval(); change(f);
    await assert.rejects(f.view.confirmRemoval(), /no longer active/); assert.deepEqual(f.calls, []);
  }
  const f = viewFixture(); f.view.setSelected(f.snapshot, "one", true); f.view.beginSelectedRemoval(); const review = f.view.review;
  await assert.rejects(f.view.setState({ query: "replacement", fromDate: "2026-02-30" }, {}), /date/);
  assert.equal(f.view.review, review); assert.deepEqual([...f.view.selected], ["one"]);
  await f.view.setState({ query: "restored", future: { keep: true } }, {});
  assert.equal(f.view.review, null); assert.equal(f.view.selected.size, 0); assert.deepEqual(f.view.getState().future, { keep: true });
  f.view.search.value = "story"; f.view.setSelected(f.snapshot, "one", true); f.view.beginSelectedRemoval();
  await f.view.refresh(); assert.equal(f.view.review, null); assert.equal(f.view.selected.size, 0);
});
