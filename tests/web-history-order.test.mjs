import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";
let temporary, WebHistoryData, WebHistory, WebHistoryView, historyOrder;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "history-order-tests-"));
  const entry = join(temporary, "order.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "history-order-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
    build.onResolve({ filter: /^\.\/web-history-archive-modal$/ }, () => ({ path: "modal", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "ui" ? "export class Notice {} export class Modal {}" :
      "export class WebHistoryArchiveModal { constructor(app,review,actions){this.review=review;this.actions=actions;this.isOpen=false;this.invalid=false;this.modalEl={focus(){}};} get available(){return this.isOpen&&!this.invalid;} open(){this.isOpen=true;} invalidate(){this.invalid=true;} forceClose(){this.isOpen=false;this.actions.closed();} }" }));
  } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView, historyOrder } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const day = new Date(2026, 0, 15, 12).getTime();
const visit = (id, visitedAt, title = "中文 Story") => ({ id, visitedAt, title, url: "https://example.com/same", future: { keep: [id, true] } });
const seed = () => ({ version: 1, recording: false, entries: [visit("late", day + 100), visit("tie-a", day), visit("early", day - 86400000, "Earlier"), visit("tie-b", day)], future: { keep: ["中文", true] } });
const ids = entries => entries.map(entry => entry.id);
test("History ordering retains its strict newest-first legacy default and chronological keys while refusing unsupported values", () => {
  assert.equal(historyOrder(), "newest"); assert.equal(historyOrder("newest"), "newest"); assert.equal(historyOrder("oldest"), "oldest");
  for (const value of [null, true, 0, {}, [], "", "NEWEST", "title", " oldest "]) { assert.throws(() => historyOrder(value), /history.*order|sort/i); }
});
test("Chronological ordering uses actual timestamps, deterministic source-order ties and current search/date scope without changing history data", () => {
  const original = seed(), history = new WebHistoryData(original);
  assert.deepEqual(ids(history.ordered()), ["late", "tie-b", "tie-a", "early"]);
  assert.deepEqual(ids(history.ordered("", {}, "oldest")), ["early", "tie-a", "tie-b", "late"]);
  assert.deepEqual(ids(history.ordered("STORY 中文", { fromDate: "2026-01-15", throughDate: "2026-01-15" }, "oldest")), ["tie-a", "tie-b", "late"]);
  const shown = history.ordered(); shown.reverse(); assert.deepEqual(history.data, original); assert.deepEqual(original, seed());
  assert.throws(() => history.ordered("", {}, "title"), /order|sort/);
});
test("Shown and selected Markdown archives follow the chosen chronology, retain their scopes and identify oldest-first output", () => {
  const history = new WebHistoryData(seed()), oldest = history.archive("", {}, "oldest"), newest = history.archive("");
  assert.ok(oldest.markdown.indexOf("Earlier") < oldest.markdown.indexOf("中文 Story")); assert.match(oldest.markdown, /Order: Oldest first/);
  assert.ok(newest.markdown.indexOf("中文 Story") < newest.markdown.indexOf("Earlier"));
  const selected = history.archiveSelected("", ["late", "early"], {}, "oldest");
  assert.equal(selected.count, 2); assert.match(selected.markdown, /Selection: 2 checked visits/); assert.match(selected.markdown, /Order: Oldest first/);
  assert.ok(selected.markdown.indexOf("Earlier") < selected.markdown.indexOf("中文 Story")); assert.deepEqual(history.data, seed());
});
async function fixture() {
  let data = seed(), version = 1, writes = 0, layouts = 0; const creates = [];
  const app = { vault: { rootPath: "vault-a", async create(path, markdown) { creates.push({ path, markdown }); } }, changingVault: false,
    core: { busy: false, isEnabled: () => true }, workspace: { trigger() {}, layoutChanged() { layouts++; } }, configuration: {
      async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
      async write(document, next) { assert.equal(document.version, String(version)); data = structuredClone(next); version++; writes++; return { ...document, version: String(version), data: structuredClone(data) }; },
    } };
  const store = new WebHistory(app); store.start(); const snapshot = await store.read(), view = Object.create(WebHistoryView.prototype), span = {}, button = { focus() {} };
  Object.defineProperty(view, "_loaded", { value: true });
  Object.assign(view, { app, snapshot, provider: { id: "webviewer", history: store }, leaf: { view }, busy: false, disposed: false, refreshing: false, revision: 1, copySequence: 0,
    sortOrder: "newest", orderRevision: 0, archivePreview: null, selected: new Set(["late"]), search: { value: "" },
    from: { value: "", validity: { badInput: false } }, through: { value: "", validity: { badInput: false } }, rangeState: { fromDate: "", throughDate: "" },
    confirmation: { hidden: false, querySelector: selector => selector === "span" ? span : button }, review: {}, status: {}, state: { future: { keep: ["中文", true] } } });
  view.render = () => {}; view.syncSelection = () => {}; view.perform = async action => { await action(); return true; };
  return { app, store, view, creates, data: () => structuredClone(data), writes: () => writes, layouts: () => layouts };
}
test("Saved pane order validates before mutation, preserves detached opaque state and omits the newest default for older layouts", async () => {
  const f = await fixture(); await f.view.setState({ query: "story", sortOrder: "oldest", future: { keep: true } }, {});
  assert.equal(f.view.getState().sortOrder, "oldest"); const before = f.view.getState(), review = { retained: true }; f.view.review = review;
  for (const sortOrder of [null, "", "title", false, 3]) {
    await assert.rejects(f.view.setState({ query: "wrong", sortOrder }, {}), /order|sort/);
    assert.deepEqual(f.view.getState(), before); assert.equal(f.view.review, review);
  }
  f.view.changeOrder("newest"); assert.equal("sortOrder" in f.view.getState(), false); assert.deepEqual(f.view.getState().future, { keep: true });
  await f.view.setState({ query: "legacy", future: { keep: true } }, {}); assert.equal("sortOrder" in f.view.getState(), false);
  assert.deepEqual(f.view.getState(), { query: "legacy", fromDate: "", throughDate: "", future: { keep: true } }); await f.store.stop();
});
test("Changing order expires selection/removal/archive reviews without writing history or altering an in-flight refresh counter or inverse checkpoint", async () => {
  const f = await fixture(); await f.store.edit(await f.store.read(), "late", () => true); f.view.snapshot = await f.store.read();
  const token = f.store.getUndo(f.view.snapshot), original = f.data(); f.view.archivePreview = { invalidate() { this.invalid = true; } };
  f.view.refreshing = true; const revision = f.view.revision; f.view.changeOrder("oldest");
  assert.equal(f.view.revision, revision); assert.equal(f.view.refreshing, true); assert.equal(f.view.selected.size, 0); assert.equal(f.view.review, null);
  assert.equal(f.view.archivePreview.invalid, true); assert.equal(f.layouts(), 1); assert.equal(f.writes(), 1); assert.deepEqual(f.data(), original);
  assert.equal(f.store.getUndo(f.view.snapshot).id, token.id); await f.store.stop();
});
test("Queued Undo and Redo refuse after an oldest/newest round trip before consuming their still-current checkpoint", async () => {
  for (const redo of [false, true]) {
    const f = await fixture(); await f.store.edit(await f.store.read(), "late", () => true); let snapshot = await f.store.read();
    if (redo) { await f.store.undo(snapshot, f.store.getUndo(snapshot), () => true); snapshot = await f.store.read(); }
    f.view.snapshot = snapshot; const original = f.data(), writes = f.writes();
    let release; f.store.tail = new Promise(resolve => { release = resolve; });
    if (redo) { f.view.beginRedoRemoval(); }
    const pending = redo ? f.view.confirmRemoval() : f.view.undoRemoval(); f.view.changeOrder("oldest"); f.view.changeOrder("newest"); release();
    await assert.rejects(pending, /no longer available/); assert.equal(f.writes(), writes); assert.deepEqual(f.data(), original);
    assert.ok(redo ? f.store.getRedo(snapshot) : f.store.getUndo(snapshot)); await f.store.stop();
  }
});
test("Archive reviews capture the displayed order and queued sort changes cannot save their obsolete preview", async () => {
  const f = await fixture(); f.view.changeOrder("oldest"); f.view.beginArchive(); const modal = f.view.archivePreview;
  assert.equal(modal.review.order, "oldest"); assert.match(modal.review.markdown, /Order: Oldest first/);
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = modal.actions.create("History/Oldest.md", modal.review.markdown); f.view.changeOrder("newest"); release();
  await assert.rejects(pending, /no longer available/); assert.equal(f.creates.length, 0); assert.equal(f.writes(), 0); await f.store.stop();
});
