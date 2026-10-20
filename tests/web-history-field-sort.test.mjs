import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";
let temporary, WebHistoryData, WebHistory, WebHistoryView, historyOrder, historyOrderLabel, WEB_HISTORY_ORDERS, historyOpenReview;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "history-field-sort-tests-"));
  const entry = join(temporary, "sort.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export { WebHistory } from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view"; export { historyOrderLabel, WEB_HISTORY_ORDERS } from "./client/web-history-order"; export { historyOpenReview } from "./client/web-history-open";', resolveDir: root },
    outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "field-sort-review-fixture", setup(build) {
      build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
      build.onResolve({ filter: /^\.\/web-history-(archive|open)-modal$/ }, () => ({ path: "modal", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "ui" ? "export class Notice {} export class Modal {}" :
        "class Reviewed {constructor(app,review,actions){this.review=review;this.actions=actions;this.isOpen=false;this.invalid=false;this.modalEl={focus(){}};}get available(){return this.isOpen&&!this.invalid;}open(){this.isOpen=true;}invalidate(){this.invalid=true;}forceClose(){this.isOpen=false;this.actions.closed();}}export{Reviewed as WebHistoryArchiveModal,Reviewed as WebHistoryOpenModal};" }));
    } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView, historyOrder, historyOrderLabel, WEB_HISTORY_ORDERS, historyOpenReview } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const day = new Date(2026, 0, 15, 12).getTime(), fields = ["title-asc", "title-desc", "address-asc", "address-desc"];
const seed = () => ({ version: 1, recording: false, entries: [
  { id: "bravo", title: "bravo 中文", url: "https://example.com/b", visitedAt: day + 100 },
  { id: "alpha-a", title: "Alpha", url: "https://EXAMPLE.com/Z", visitedAt: day },
  { id: "charlie", title: "CHARLIE 😀", url: "https://example.com/a", visitedAt: day - 86400000 },
  { id: "alpha-b", title: "alpha", url: "https://example.com/z", visitedAt: day },
], future: { keep: ["中文", true] } });
const ids = entries => entries.map(entry => entry.id);
const expected = { "title-asc": ["alpha-b", "alpha-a", "bravo", "charlie"], "title-desc": ["charlie", "bravo", "alpha-b", "alpha-a"],
  "address-asc": ["charlie", "bravo", "alpha-b", "alpha-a"], "address-desc": ["alpha-b", "alpha-a", "bravo", "charlie"] };

test("Six strict saved sort values and shared labels retain chronological defaults while rejecting unknown, coerced and prototype names", () => {
  assert.deepEqual(WEB_HISTORY_ORDERS.map(([value]) => value), ["newest", "oldest", ...fields]);
  for (const [value, label] of WEB_HISTORY_ORDERS) { assert.equal(historyOrder(value), value); assert.equal(historyOrderLabel(value), label); }
  assert.equal(historyOrder(), "newest"); assert.equal(historyOrderLabel(), "Newest first");
  for (const value of [null, true, 1, {}, [], "", "title", "TITLE-ASC", " title-asc ", "constructor", "__proto__"]) { assert.throws(() => historyOrder(value), /sort order/i); assert.throws(() => historyOrderLabel(value), /sort order/i); }
});
test("Title sorting is case-insensitive with newest then later-source ties in both directions, including canonically equivalent Unicode, without rewriting data", () => {
  const original = seed(), history = new WebHistoryData(original);
  for (const order of ["title-asc", "title-desc"]) { assert.deepEqual(ids(history.ordered("", {}, order)), expected[order]); }
  const unicode = new WebHistoryData({ version: 1, entries: [
    { ...original.entries[0], id: "decomposed", title: "e\u0301", visitedAt: day },
    { ...original.entries[1], id: "composed", title: "É", visitedAt: day + 1 },
  ] });
  for (const order of ["title-asc", "title-desc"]) { assert.deepEqual(ids(unicode.ordered("", {}, order)), ["composed", "decomposed"]); }
  assert.equal(unicode.entries[0].title, "e\u0301"); assert.deepEqual(history.data, original); assert.deepEqual(original, seed());
});
test("Address sorting compares full literal addresses without URL decoding and retains exact address case and deterministic repeated-address ties", () => {
  const history = new WebHistoryData(seed());
  for (const order of ["address-asc", "address-desc"]) { assert.deepEqual(ids(history.ordered("", {}, order)), expected[order]); }
  assert.equal(history.entries[1].url, "https://EXAMPLE.com/Z");
  const encoded = new WebHistoryData({ version: 1, entries: [
    { ...seed().entries[0], id: "literal", url: "https://example.com/a" }, { ...seed().entries[1], id: "encoded", url: "https://example.com/%7A" },
  ] });
  assert.deepEqual(ids(encoded.ordered("", {}, "address-asc")), ["encoded", "literal"]); assert.equal(encoded.entries[1].url, "https://example.com/%7A");
});
test("Field sorting preserves search/local-date scope, uses the address for an empty displayed title and keeps character order rather than natural numeric ranking", () => {
  const history = new WebHistoryData(seed());
  assert.deepEqual(ids(history.ordered("ALPHA", { fromDate: "2026-01-15", throughDate: "2026-01-15" }, "title-desc")), ["alpha-b", "alpha-a"]);
  assert.deepEqual(ids(history.ordered("", { fromDate: "2026-01-15", throughDate: "2026-01-15" }, "address-asc")), ["bravo", "alpha-b", "alpha-a"]);
  const fallback = new WebHistoryData({ version: 1, entries: [
    { ...seed().entries[0], id: "two", title: "Title 2" }, { ...seed().entries[1], id: "ten", title: "Title 10" }, { ...seed().entries[2], id: "empty", title: "" },
  ] });
  assert.deepEqual(ids(fallback.ordered("", {}, "title-asc")), ["empty", "ten", "two"]);
});
test("Shown/selected archives and selected-tab reviews follow the same exact field order and label, while the default newest Markdown format remains unchanged", () => {
  const history = new WebHistoryData(seed()), selected = ["alpha-a", "bravo"];
  for (const order of fields) {
    const all = history.archive("", {}, order), some = history.archiveSelected("", selected, {}, order);
    assert.ok(all.markdown.includes("Order: " + historyOrderLabel(order))); assert.ok(some.markdown.includes("Order: " + historyOrderLabel(order)));
    const review = historyOpenReview(history.data, { query: "", ids: [...selected].reverse(), order });
    assert.deepEqual(ids(review.entries), expected[order].filter(id => selected.includes(id)));
    assert.equal(review.order, order);
    const first = history.entries.find(entry => entry.id === expected[order][0]);
    assert.ok(all.markdown.indexOf(first.title) >= 0);
  }
  assert.doesNotMatch(history.archive("").markdown, /Order:/); assert.match(history.archive("", {}, "oldest").markdown, /Order: Oldest first/); assert.deepEqual(history.data, seed());
});
async function fixture() {
  let data = seed(), version = 1, writes = 0, layouts = 0; const creates = [], opens = [];
  const app = { vault: { rootPath: "vault-a", async create(path, markdown) { creates.push({ path, markdown }); } }, changingVault: false,
    core: { busy: false, isEnabled: () => true }, workspace: { trigger() {}, layoutChanged() { layouts++; } }, configuration: {
      async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
      async write(document, next) { assert.equal(document.version, String(version)); data = structuredClone(next); version++; writes++; return { ...document, version: String(version), data: structuredClone(data) }; },
    } };
  const store = new WebHistory(app); store.start(); const snapshot = await store.read(), view = Object.create(WebHistoryView.prototype);
  Object.defineProperty(view, "_loaded", { value: true });
  Object.assign(view, { app, snapshot, provider: { id: "webviewer", history: store, async openUrl(url) { opens.push(url); } }, leaf: { view }, busy: false, disposed: false, refreshing: false, revision: 1, copySequence: 0,
    sortOrder: "newest", orderRevision: 0, selected: new Set(["bravo", "alpha-a"]), search: { value: "" }, from: { value: "", validity: { badInput: false } }, through: { value: "", validity: { badInput: false } },
    rangeState: { fromDate: "", throughDate: "" }, confirmation: {}, review: {}, state: { future: { keep: ["中文", true] } }, render() {}, syncSelection() {} });
  return { app, store, view, creates, opens, writes: () => writes, layouts: () => layouts };
}
test("Each field order survives detached leaf serialization, strict invalid imports retain the live state/review, and newest remains omitted for legacy layouts", async () => {
  const f = await fixture();
  for (const sortOrder of fields) { await f.view.setState({ query: "alpha", sortOrder, future: { keep: ["中文", true] } }, {}); assert.equal(f.view.getState().sortOrder, sortOrder); }
  const before = f.view.getState(); f.view.review = { keep: true };
  await assert.rejects(f.view.setState({ query: "changed", sortOrder: "address", future: null }, {}), /sort order/); assert.deepEqual(f.view.getState(), before); assert.deepEqual(f.view.review, { keep: true });
  await f.view.setState({ query: "legacy", future: { keep: true } }, {}); assert.equal(Object.hasOwn(f.view.getState(), "sortOrder"), false); assert.deepEqual(f.view.getState().future, { keep: true }); await f.store.stop();
});
test("Field changes invalidate all owned reviews/selected IDs without changing refresh ownership, bytes or eligible inverse checkpoints", async () => {
  const f = await fixture(); await f.store.edit(await f.store.read(), "charlie", () => true); f.view.snapshot = await f.store.read(); const token = f.store.getUndo(f.view.snapshot);
  const previews = ["archivePreview", "openPreview", "limitPreview"];
  for (const field of previews) { f.view[field] = { invalidate() { this.invalid = true; } }; }
  f.view.refreshing = true; const revision = f.view.revision; f.view.changeOrder("title-asc");
  assert.equal(f.view.revision, revision); assert.equal(f.view.refreshing, true); assert.equal(f.view.selected.size, 0); assert.equal(f.view.review, null);
  for (const field of previews) { assert.equal(f.view[field].invalid, true); }
  assert.equal(f.writes(), 1); assert.equal(f.layouts(), 1); assert.equal(f.store.getUndo(f.view.snapshot).id, token.id); await f.store.stop();
});
test("Queued archive and selected-tab actions refuse field-order round trips before writing/opening, even when the final displayed order matches the old review", async () => {
  for (const opening of [false, true]) {
    const f = await fixture(); f.view.changeOrder("title-asc"); f.view.selected = new Set(["bravo", "alpha-a"]);
    if (opening) { f.view.beginOpenSelected(); } else { f.view.beginArchive(true); }
    const modal = opening ? f.view.openPreview : f.view.archivePreview; let release; f.store.tail = new Promise(resolve => { release = resolve; });
    const pending = opening ? modal.actions.open() : modal.actions.create("History/Sorted.md", modal.review.markdown);
    f.view.changeOrder("address-desc"); f.view.changeOrder("title-asc"); release(); await assert.rejects(pending, /available/);
    assert.deepEqual(f.creates, []); assert.deepEqual(f.opens, []); assert.equal(f.writes(), 0); await f.store.stop();
  }
});
