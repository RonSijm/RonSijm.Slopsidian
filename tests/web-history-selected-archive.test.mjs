import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { root } from "./host.mjs";
let temporary, WebHistoryData, WebHistory, WebHistoryView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "selected-archive-tests-"));
  const entry = join(temporary, "selected.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "archive-review-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
    build.onResolve({ filter: /^\.\/web-history-archive-modal$/ }, () => ({ path: "modal", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "ui" ? "export class Notice {} export class Modal {}" :
      "export class WebHistoryArchiveModal { constructor(app,review,actions){this.review=review;this.actions=actions;this.isOpen=false;this.invalid=false;this.modalEl={focus(){}};} get available(){return this.isOpen&&!this.invalid;} open(){this.isOpen=true;} invalidate(){this.invalid=true;} forceClose(){this.isOpen=false;this.actions.closed();} }" }));
  } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const day = new Date(2026, 0, 15, 12).getTime();
const visit = (id, title, visitedAt = day) => ({ id, title, visitedAt, url: "https://example.com/same?value=(x)&q=a", future: { keep: [id, true] } });
const seed = () => ({ version: 1, recording: false, entries: [visit("before", "Earlier", day - 86400000), visit("one", "中文 Story"), visit("two", "Unchecked story"), visit("keep", "Other 中文 😀")], future: { keep: ["中文", true] } });

test("Selected archives capture exact checked IDs newest first rather than every shown visit or every repeated URL", () => {
  const data = seed(), history = new WebHistoryData(data), ids = ["one", "keep"], archive = history.archiveSelected("", ids);
  assert.equal(archive.count, 2); assert.match(archive.markdown, /Selection: 2 checked visits/); assert.ok(archive.markdown.indexOf("Other") < archive.markdown.indexOf("中文 Story"));
  assert.equal(archive.markdown.split("](<https://").length - 1, 2); assert.doesNotMatch(archive.markdown, /Earlier|Unchecked|future|recording/);
  assert.ok(archive.markdown.includes(new Date(day).toISOString())); assert.deepEqual(ids, ["one", "keep"]); assert.deepEqual(history.data, data);
  assert.equal(history.archive("").count, 4); assert.doesNotMatch(history.archive("").markdown, /Selection:/);
});
test("Selected archives refuse empty, duplicate, malformed, missing, hidden or oversized ID sets atomically without broadening filtered scope", () => {
  const history = new WebHistoryData(seed());
  for (const ids of [undefined, null, "one", [], ["one", "one"], ["missing"], ["one", null], Array(1), Array.from({ length: 1001 }, (_, index) => "id" + index)]) {
    assert.throws(() => history.archiveSelected("", ids), /selected visits/i); assert.deepEqual(history.data, seed());
  }
  assert.throws(() => history.archiveSelected("Story", ["one", "keep"]), /shown|selected visits/i);
  assert.throws(() => history.archiveSelected("", ["before"], { fromDate: "2026-01-15" }), /shown|selected visits/i);
  assert.equal(history.archiveSelected("Story", ["one"], { fromDate: "2026-01-15", throughDate: "2026-01-15" }).count, 1);
  assert.throws(() => history.archiveSelected("x".repeat(1025), ["one"]), /search/i);
});
test("Selected archive titles/query syntax remain literal with safe links, special IDs and the exact reviewed local-date context", () => {
  const title = '<img src=x onerror=evil()> ![[Secret]] **中文**', history = new WebHistoryData({ version: 1, entries: [visit("__proto__", title), visit("constructor", "中文 keep")] });
  const archive = history.archiveSelected("中文", ["constructor", "__proto__"], { fromDate: "2026-01-15", throughDate: "2026-01-15" }), html = marked.parse(archive.markdown);
  assert.equal(archive.count, 2); assert.doesNotMatch(html, /<img|<script|<strong>|href="javascript:/i); assert.ok(archive.markdown.includes("&#91;&#91;Secret&#93;&#93;"));
  assert.match(archive.markdown, /Search: 中文/); assert.match(archive.markdown, /From \(local\): 2026-01-15/); assert.match(archive.markdown, /Through \(local, inclusive\): 2026-01-15/);
  assert.doesNotMatch(archive.markdown, /__proto__|constructor/);
});
test("Choosing a small subset can archive an otherwise oversized shown list, while an oversized selection refuses without silent truncation", () => {
  const history = new WebHistoryData({ version: 1, entries: Array.from({ length: 1000 }, (_, index) => ({ ...visit("v" + index, "Title " + index), url: "https://example.com/" + "a".repeat(7900) })) });
  assert.throws(() => history.archive(""), /too large/); assert.equal(history.archiveSelected("", ["v0", "v999"]).count, 2);
  assert.throws(() => history.archiveSelected("", history.entries.map(entry => entry.id)), /too large/); assert.equal(history.entries.length, 1000);
});
async function fixture() {
  const creates = [], data = seed(), document = { id: "vault-dotnet-web-history", root: "vault-a", version: "source", data };
  const app = { vault: { rootPath: "vault-a", async create(path, markdown) { creates.push({ path, markdown }); } }, changingVault: false,
    core: { busy: false, isEnabled: () => true }, workspace: { trigger() {} }, configuration: { async read() { return structuredClone(document); } } };
  const store = new WebHistory(app); store.start(); const snapshot = await store.read(), view = Object.create(WebHistoryView.prototype);
  Object.defineProperty(view, "_loaded", { value: true });
  Object.assign(view, { app, snapshot, provider: { id: "webviewer", history: store }, leaf: { view }, busy: false, disposed: false, refreshing: false, revision: 1,
    archivePreview: null, selected: new Set(["one", "keep"]), search: { value: "" }, from: { value: "", validity: { badInput: false } }, through: { value: "", validity: { badInput: false } },
    rangeState: { fromDate: "", throughDate: "" }, confirmation: {}, review: {}, state: { future: { keep: ["中文", true] } } });
  view.syncSelection = () => {};
  return { app, store, view, snapshot, creates };
}
test("The pane keeps selected and shown archive reviews distinct and a queued selection replacement refuses before creation", async () => {
  const f = await fixture(); f.view.beginArchive(true); const selected = f.view.archivePreview;
  assert.equal(selected.review.selection, true); assert.equal(selected.review.count, 2); assert.doesNotMatch(selected.review.markdown, /Unchecked/);
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = selected.actions.create("History/Selected.md", selected.review.markdown); f.view.selected = new Set(["one", "two"]); release();
  await assert.rejects(pending, /no longer available/); assert.equal(f.creates.length, 0);
  selected.forceClose(); f.view.beginArchive(); const shown = f.view.archivePreview; assert.equal(shown.review.count, 4); assert.notEqual(shown.review.selection, true);
  await shown.actions.create("History/Shown.md", shown.review.markdown); assert.equal(f.creates.length, 1); await f.store.stop();
});
test("Changing a checked visit invalidates its open archive immediately without writing history or changing persisted filter/opaque state", async () => {
  const f = await fixture(); f.view.beginArchive(); const preview = f.view.archivePreview;
  f.view.setSelected(f.snapshot, "two", true); assert.equal(preview.invalid, true); assert.equal(f.creates.length, 0);
  assert.deepEqual(f.view.getState(), { future: { keep: ["中文", true] }, query: "", fromDate: "", throughDate: "" }); await f.store.stop();
});
test("Empty or invalid current selections cannot open a selected archive, and a fresh valid review contains no transient IDs in leaf state", async () => {
  const f = await fixture(); f.view.selected.clear(); assert.throws(() => f.view.beginArchive(true), /selected visits/i); assert.equal(f.view.archivePreview, null);
  f.view.selected.add("missing"); assert.throws(() => f.view.beginArchive(true), /selected visits/i); assert.equal(f.view.archivePreview, null);
  f.view.selected = new Set(["one"]); f.view.beginArchive(true); assert.equal(f.view.archivePreview.review.count, 1);
  assert.deepEqual(f.view.getState(), { future: { keep: ["中文", true] }, query: "", fromDate: "", throughDate: "" }); await f.store.stop();
});
