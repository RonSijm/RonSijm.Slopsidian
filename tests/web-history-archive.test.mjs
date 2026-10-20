import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { root } from "./host.mjs";

let temporary, WebHistoryData, WebHistory, WebHistoryView, WebHistoryArchiveModal;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "history-archive-tests-"));
  const entry = join(temporary, "archive.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view"; export { WebHistoryArchiveModal } from "./client/web-history-archive-modal";', resolveDir: root },
    outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "notice-fixture", setup(build) {
      build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "notice", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice {} export class Modal {}" }));
    } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView, WebHistoryArchiveModal } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const day = new Date(2026, 0, 15, 12).getTime();
const visit = (id, title = "中文 Story", visitedAt = day) => ({ id, title, visitedAt, url: "https://example.com/same?q=a&b=(x)", future: { keep: [id, true] } });
const seed = () => ({ version: 1, recording: false, entries: [visit("before", "Earlier", day - 86400000), visit("one"), visit("two"), visit("keep", "Other")], future: { keep: ["中文", true] } });
function fixture() {
  let data = seed(), version = 0, writes = 0;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
    async write(document, next) { assert.equal(document.root, app.vault.rootPath); assert.equal(document.version, String(version)); data = structuredClone(next); version++; writes++; return { ...document, version: String(version), data: structuredClone(data) }; },
  } };
  const store = new WebHistory(app); store.start();
  return { app, store, data: () => structuredClone(data), writes: () => writes, external(next) { data = structuredClone(next); version++; } };
}
test("Archive captures all or search/date-filtered visits newest first, including repeated addresses, UTC times and the literal reviewed filter scope", () => {
  const original = seed(), history = new WebHistoryData(original), all = history.archive("");
  assert.equal(all.count, 4); assert.match(all.markdown, /^# Web history\n/); assert.match(all.markdown, /Visits: 4/);
  assert.ok(all.markdown.indexOf("Other") < all.markdown.indexOf("Earlier")); assert.equal(all.markdown.split("(https").length, 1);
  const filtered = history.archive("story 中文", { fromDate: "2026-01-15", throughDate: "2026-01-15" });
  assert.equal(filtered.count, 2); assert.equal(filtered.markdown.split("](<https://").length - 1, 2);
  assert.ok(filtered.markdown.includes(new Date(day).toISOString())); assert.ok(filtered.markdown.includes("2026-01-15"));
  assert.match(filtered.markdown, /Search: story 中文/); assert.doesNotMatch(filtered.markdown, /Other|Earlier|future|recording/);
  assert.deepEqual(history.data, original); assert.deepEqual(original, seed());
});
test("Archive escapes Markdown/HTML and filter/title injection while retaining usable HTTP links, Unicode and literal addresses", () => {
  const title = '<img src=x onerror=evil()> ![[Secret]] [x](javascript:evil) **中文**\n# fake', data = seed(); data.entries[1].title = title;
  const history = new WebHistoryData(data), archive = history.archive(""), html = marked.parse(archive.markdown);
  assert.doesNotMatch(html, /<img|<script|href="javascript:|<h1[^>]*>fake|<strong>/i); assert.match(html, /&lt;img/); assert.match(html, /中文/);
  assert.equal((html.match(/<a href="https:\/\//g) ?? []).length, 4); assert.match(html, /Address: <code>https/);
  assert.ok(archive.markdown.includes("&#91;&#91;Secret&#93;&#93;"));
  const filtered = history.archive("**中文**"); assert.equal(filtered.count, 1); assert.doesNotMatch(marked.parse(filtered.markdown), /<strong>/);
});
test("Archive rejects invalid queries/dates, empty results and oversized output without changing the history or silently truncating visits", () => {
  const history = new WebHistoryData(seed());
  for (const query of [null, 3, "x".repeat(1025)]) { assert.throws(() => history.archive(query), /search/i); }
  assert.throws(() => history.archive("missing"), /no.*visits/i);
  assert.throws(() => history.archive("", { fromDate: "2026-02-30" }), /real date/);
  const huge = new WebHistoryData({ version: 1, entries: Array.from({ length: 1000 }, (_, index) => ({ ...visit("v" + index), url: "https://example.com/" + "a".repeat(7900) })) });
  assert.throws(() => huge.archive(""), /too large|narrow/i); assert.equal(huge.entries.length, 1000); assert.deepEqual(history.data, seed());
});
test("Archive verification serializes creation with owned history writes, captures its source version before queuing and retains Undo/Redo checkpoints", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), "one", () => true); let snapshot = await f.store.read(), token = f.store.getUndo(snapshot);
  let created = 0; await f.store.archive(snapshot, () => true, async () => { created++; }); assert.equal(f.store.getUndo(snapshot).id, token.id);
  await f.store.undo(snapshot, token, () => true); snapshot = await f.store.read(); token = f.store.getRedo(snapshot);
  let release; f.store.tail = new Promise(resolve => { release = resolve; }); const operation = f.store.archive(snapshot, () => true, async () => { created++; });
  snapshot.document.data.entries.length = 0; release(); await operation;
  assert.equal(created, 2); assert.equal(f.store.getRedo(await f.store.read()).id, token.id); assert.equal(f.writes(), 2); assert.deepEqual(f.data(), seed()); await f.store.stop();
});
test("Stale external history or queued root/owner/lifecycle changes refuse an archive before creation without consuming inverse actions", async () => {
  const f = fixture(), snapshot = await f.store.read(); f.external({ ...seed(), external: true }); let created = 0;
  await assert.rejects(f.store.archive(snapshot, () => true, async () => { created++; }), /changed/); assert.equal(created, 0);
  for (const change of [g => { g.current = false; }, g => { g.app.changingVault = true; }, g => { g.app.vault.rootPath = "vault-b"; }, g => { g.stop = g.store.stop(); }]) {
    const g = fixture(); g.current = true; const original = await g.store.read(); let release; g.store.tail = new Promise(resolve => { release = resolve; });
    const operation = g.store.archive(original, () => g.current, async () => { created++; }); change(g); release();
    await assert.rejects(operation, /no longer active|no longer available/); if (g.stop) { await g.stop; } assert.deepEqual(g.data(), seed());
  }
  assert.equal(created, 0); await f.store.stop();
});
test("A failed create leaves history/checkpoints intact and releases the serialized queue for a deliberate fresh archive attempt", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), "one", () => true); const snapshot = await f.store.read(), token = f.store.getUndo(snapshot);
  await assert.rejects(f.store.archive(snapshot, () => true, async () => { throw Error("Note already exists"); }), /already exists/);
  assert.equal(f.store.getUndo(await f.store.read()).id, token.id); let created = false;
  await f.store.archive(snapshot, () => true, async () => { created = true; }); assert.equal(created, true); assert.equal(f.writes(), 1); await f.store.stop();
});

function modalFixture() {
  const modal = Object.create(WebHistoryArchiveModal.prototype), creates = [], opened = [], failures = [];
  Object.assign(modal, { isOpen: true, valid: true, markdown: "# Reviewed 中文\n", busy: false, path: { value: "History/Reviewed.md" },
    preview: { value: "# Reviewed 中文\n" }, error: { hidden: true }, status: {}, save: {}, cancel: {}, actions: {
      guard() {}, async create(path, markdown) { creates.push({ path, markdown }); }, closed() {},
    }, app: { core: { async run(action) { await action(); } }, workspace: { async withFileMutation(action) { await action(); },
      getLeaf() { return { async openFile(file) { opened.push(file.path); if (failures.length) { throw failures.shift(); } } }; } },
      vault: { getFileByPath(path) { return { path }; } } } });
  modal.forceClose = () => { modal.isOpen = false; modal.onClose(); };
  return { modal, creates, opened, failures };
}
test("Archive saves one captured preview/path, ignores double activation and closes permanently before opening the new note", async () => {
  const f = modalFixture(); let release, entered; const started = new Promise(resolve => { entered = resolve; });
  f.modal.actions.create = async (path, markdown) => { entered(); await new Promise(resolve => { release = resolve; }); f.creates.push({ path, markdown }); };
  const pending = f.modal.saveNote(); await started; await f.modal.saveNote(); f.modal.path.value = "Other.md"; release(); await pending;
  assert.deepEqual(f.creates, [{ path: "History/Reviewed.md", markdown: "# Reviewed 中文\n" }]); assert.deepEqual(f.opened, ["History/Reviewed.md"]);
  assert.equal(f.modal.isOpen, false); assert.equal(f.modal.preview.value, ""); await f.modal.saveNote(); assert.equal(f.creates.length, 1);
});
test("Invalid paths, collisions and expired archive owners create nothing; a corrected collision can retry without changing the reviewed Markdown", async () => {
  const f = modalFixture(); f.modal.path.value = "../Keep.md"; await f.modal.saveNote(); assert.match(f.modal.error.textContent, /relative path/); assert.equal(f.creates.length, 0);
  f.modal.path.value = "Keep.md"; f.modal.actions.create = async () => { throw Error("Note already exists"); }; await f.modal.saveNote();
  assert.match(f.modal.error.textContent, /already exists/); assert.equal(f.modal.isOpen, true); assert.equal(f.modal.preview.value, "# Reviewed 中文\n");
  f.modal.path.value = "New.md"; f.modal.actions.create = async (path, markdown) => { f.creates.push({ path, markdown }); }; await f.modal.saveNote(); assert.equal(f.creates.length, 1);
  for (const expire of [g => g.modal.invalidate(), g => { g.modal.isOpen = false; }, g => { g.modal.actions.guard = () => { throw Error("Owner changed"); }; }]) {
    const g = modalFixture(); expire(g); await g.modal.saveNote(); assert.equal(g.creates.length, 0);
  }
});
test("The history pane refuses unavailable archive starts, invalidates previews on filter/history resets and excludes archive state from serialized leaves", () => {
  const make = () => {
    const view = Object.create(WebHistoryView.prototype), snapshot = { document: { root: "vault-a" } };
    Object.defineProperty(view, "_loaded", { value: true }); Object.assign(view, { snapshot, leaf: { view }, busy: false, disposed: false, refreshing: false, revision: 3,
      app: { vault: { rootPath: "vault-a" }, changingVault: false, core: { busy: false, isEnabled: () => true } }, provider: { id: "webviewer" },
      state: { opaque: { keep: true } }, search: { value: "story" }, rangeState: { fromDate: "", throughDate: "" }, selected: new Set(["one"]), confirmation: {}, review: {} });
    return view;
  };
  for (const change of [v => { v.busy = true; }, v => { v.snapshot = null; }, v => { v.refreshing = true; }, v => { v.disposed = true; }, v => { v.leaf.view = {}; }, v => { v.app.changingVault = true; }, v => { v.app.core.isEnabled = () => false; }]) {
    const view = make(); change(view); assert.throws(() => view.beginArchive(), /no longer available/);
  }
  const view = make(); let invalidated = 0; view.archivePreview = { invalidate() { invalidated++; } }; view.resetSelection();
  assert.equal(invalidated, 1); assert.equal(view.selected.size, 0); assert.equal(view.review, null);
  assert.deepEqual(view.getState(), { opaque: { keep: true }, query: "story", fromDate: "", throughDate: "" });
});
