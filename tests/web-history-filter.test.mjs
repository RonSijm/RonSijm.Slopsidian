import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, WebHistoryData, WebHistory, WebHistoryView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "history-filter-tests-"));
  const entry = join(temporary, "history-filter.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "notice-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "notice", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice { constructor() {} } export class Modal {}" }));
  } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView } = await import(pathToFileURL(entry).href));
});
after(async () => {
  if (temporary) {
    const path = relative(join(root, ".runtime"), temporary);
    assert.ok(path && !isAbsolute(path) && !path.startsWith(".."));
    await rm(temporary, { recursive: true });
  }
});

const visit = (id, title, url = "https://example.com/" + id) => ({ id, title, url, visitedAt: 100, future: { keep: [id, "中文"] } });
const seed = () => ({ version: 1, recording: false, entries: [
  visit("one", "中文 Story"), visit("keep", "Other page", "https://example.org/keep"),
  visit("two", "Story again", "https://example.com/中文"), visit("partial", "中文 only"),
], future: { keep: [1, true] } });
function storeFixture() {
  let data = seed(), version = 0, writes = 0;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, data: structuredClone(data), version: String(version) }; },
    async write(document, next) {
      if (document.root !== app.vault.rootPath || document.version !== String(version)) { throw Error("Configuration changed on disk"); }
      data = structuredClone(next); version++; writes++;
      return { ...document, version: String(version), data: structuredClone(data) };
    },
  } };
  const store = new WebHistory(app); store.start();
  return { store, app, data: () => structuredClone(data), writes: () => writes, external(next) { data = structuredClone(next); version++; } };
}

test("Matching removal uses the same case-insensitive all-word title/address search and retains unmatched order and opaque fields", () => {
  const original = seed(), history = new WebHistoryData(original);
  assert.deepEqual(history.newest("  STORY  中文 ").map(item => item.id), ["two", "one"]);
  assert.equal(history.removeMatching("  STORY  中文 "), 2);
  assert.deepEqual(history.data, { ...original, entries: [original.entries[1], original.entries[3]] });
  assert.deepEqual(original, seed());
  assert.equal(history.recording, false);
  assert.equal(history.removeMatching("example"), 2);
  assert.deepEqual(history.data, { ...original, entries: [] });
});

test("Empty, oversized and invalid removal queries refuse without edits; a nonmatching query makes no changes", () => {
  for (const query of ["", " \t\n ", "x".repeat(1025), null, 1, {}]) {
    const history = new WebHistoryData(seed()), before = structuredClone(history.data);
    assert.throws(() => history.removeMatching(query), /nonblank search.*1,024/);
    assert.deepEqual(history.data, before);
  }
  const history = new WebHistoryData(seed());
  assert.equal(history.removeMatching("<script>never</script>"), 0);
  assert.deepEqual(history.data, seed());
});

test("Queued matching deletion captures detached reviewed data/version and refuses external changes until explicitly reviewed again", async () => {
  const f = storeFixture(), snapshot = await f.store.read();
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = f.store.removeMatching(snapshot, "story 中文", () => true);
  snapshot.document.data.entries.length = 0; snapshot.document.version = "changed"; snapshot.document.root = "vault-b";
  release(); await pending;
  const expected = seed(); expected.entries = [expected.entries[1], expected.entries[3]];
  assert.deepEqual(f.data(), expected); assert.equal(f.writes(), 1);
  const reviewed = await f.store.read(), external = { ...f.data(), future: { external: "retained" }, entries: [...f.data().entries, visit("later", "Other later")] };
  f.external(external);
  await assert.rejects(f.store.removeMatching(reviewed, "other", () => true), /changed on disk/);
  assert.deepEqual(f.data(), external); assert.equal(f.writes(), 1);
  await f.store.removeMatching(await f.store.read(), "other", () => true);
  assert.deepEqual(f.data(), { ...external, entries: external.entries.filter(item => !["keep", "later"].includes(item.id)) });
  assert.equal(f.writes(), 2); await f.store.stop();
});

test("Matching edits recheck queued ownership/root/transition and never write for a cancelled, disabled or nonmatching review", async () => {
  for (const change of [f => { f.current = false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; }, f => { f.store.active = false; }]) {
    const f = storeFixture(); f.current = true; const snapshot = await f.store.read();
    let release; f.store.tail = new Promise(resolve => { release = resolve; });
    const pending = f.store.removeMatching(snapshot, "story", () => f.current); change(f); release();
    await assert.rejects(pending, /no longer active/); assert.deepEqual(f.data(), seed()); assert.equal(f.writes(), 0);
  }
  const f = storeFixture();
  await f.store.removeMatching(await f.store.read(), "no matches", () => true); assert.equal(f.writes(), 0);
  await assert.rejects(f.store.removeMatching(await f.store.read(), " ", () => true), /nonblank/);
  const foreign = await f.store.read(); foreign.document.root = "other";
  await assert.rejects(f.store.removeMatching(foreign, "story", () => true), /no longer active/); assert.equal(f.writes(), 0);
  await f.store.stop();
});

function viewFixture(query = "story 中文") {
  const f = storeFixture(), view = Object.create(WebHistoryView.prototype), calls = [], span = {}, confirm = { focus() { confirm.focused = true; } };
  Object.defineProperty(view, "_loaded", { value: true, writable: true });
  f.app.core = { busy: false, isEnabled: () => true };
  const snapshot = { document: { root: "vault-a", version: "0", data: seed() }, history: new WebHistoryData(seed()) };
  Object.assign(view, { app: f.app, leaf: { view }, provider: { id: "webviewer", history: {
    async removeMatching(snapshot, query, current) { assert.equal(current(), true); calls.push({ snapshot, query }); },
    async edit(snapshot, id, current) { assert.equal(current(), true); calls.push({ snapshot, id }); },
    read: async () => snapshot,
  } }, disposed: false, busy: false, revision: 5, snapshot, review: null, search: { value: query, focus() {} }, confirmation: { hidden: true, querySelector: selector => selector === "span" ? span : confirm }, error: { textContent: "" } });
  Object.assign(view, { selected: new Set(), from: { value: "", validity: { badInput: false } }, through: { value: "", validity: { badInput: false } } });
  view.render = () => {}; view.perform = action => action();
  return { ...f, view, snapshot, calls, span, confirm };
}

test("Pane confirmation reviews the exact literal query/count and document; Cancel, query change and Refresh invalidate it while Clear all retains its scope", async () => {
  const f = viewFixture(); f.view.beginRemoval(f.view.search.value);
  assert.equal(f.view.confirmation.hidden, false); assert.equal(f.confirm.focused, true);
  assert.match(f.span.textContent, /2 matching visits.*“story 中文”/); assert.equal(f.confirm.textContent, "Remove matching visits");
  await f.view.confirmRemoval(); assert.deepEqual(f.calls, [{ snapshot: f.snapshot, query: "story 中文" }]);
  f.view.cancelReview(); assert.equal(f.view.confirmation.hidden, true); assert.equal(f.view.review, null);
  f.view.beginRemoval("<b>never</b>"); assert.equal(f.view.review, null);
  f.view.beginRemoval("story 中文"); f.view.search.value = "other"; await assert.rejects(f.view.confirmRemoval(), /no longer active/); assert.equal(f.calls.length, 1);
  f.view.beginRemoval(null); assert.match(f.span.textContent, /Clear all 4 saved visits/); assert.equal(f.confirm.textContent, "Clear saved visits");
  await f.view.confirmRemoval(); assert.deepEqual(f.calls[1], { snapshot: f.snapshot, id: null });
  f.view.beginRemoval("other"); await f.view.refresh(true);
  assert.equal(f.view.review, null); assert.equal(f.view.confirmation.hidden, true);
});

test("Saved matching-review callbacks refuse replaced, unloaded, refreshed, disabled, transitioning and different-vault panes, including changes while queued", async () => {
  for (const change of [f => { f.view.disposed = true; }, f => { f.view._loaded = false; }, f => { f.view.leaf.view = {}; }, f => { f.view.revision++; }, f => { f.view.snapshot = { ...f.snapshot }; }, f => { f.app.core.busy = true; }, f => { f.app.core.isEnabled = () => false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; }]) {
    const f = viewFixture(); f.view.beginRemoval(f.view.search.value); change(f);
    await assert.rejects(f.view.confirmRemoval(), /no longer active/); assert.deepEqual(f.calls, []);
  }
  const f = viewFixture(); f.view.beginRemoval(f.view.search.value);
  f.view.provider.history.removeMatching = async (_snapshot, _query, current) => { f.view.cancelReview(); assert.equal(current(), false); throw Error("Queued review no longer active"); };
  await assert.rejects(f.view.confirmRemoval(), /no longer active/); assert.deepEqual(f.calls, []);
});
