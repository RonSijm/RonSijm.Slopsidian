import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, WebHistory, WebHistoryView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "history-redo-tests-"));
  const entry = join(temporary, "redo.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "notice-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "notice", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice { constructor() {} } export class Modal {}" }));
  } }] });
  ({ WebHistory, WebHistoryView } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const day = new Date(2026, 0, 15, 12).getTime();
const visit = (id, title = "中文 Story", visitedAt = day) => ({ id, title, visitedAt, url: "https://example.com/same", future: { keep: [id, true] } });
const seed = () => ({ version: 1, recording: false, entries: [visit("before", "Earlier", day - 86400000), visit("one"), visit("two"), visit("keep", "Other")], future: { keep: ["中文", true] } });
function fixture() {
  let data = seed(), version = 0, writes = 0, fail = false;
  const responses = [];
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
    async write(document, next) {
      if (document.root !== app.vault.rootPath || document.version !== String(version)) { throw Error("Configuration changed on disk"); }
      if (fail) { fail = false; throw Error("Disk write denied"); }
      data = structuredClone(next); version++; writes++;
      const response = { ...document, version: String(version), data: structuredClone(data) }; responses.push(response); return response;
    },
  } };
  const store = new WebHistory(app); store.start();
  return { app, store, responses, data: () => structuredClone(data), writes: () => writes, external(next) { data = structuredClone(next); version++; }, failNext() { fail = true; } };
}
async function prepare(f) {
  await f.store.edit(await f.store.read(), "one", () => true);
  const removed = await f.store.read(); await f.store.undo(removed, f.store.getUndo(removed), () => true);
  const snapshot = await f.store.read(); return { snapshot, review: f.store.getRedo(snapshot) };
}

test("Every removal path can be undone and redone against exact versions, preserving post-removal state and offering a fresh Undo", async () => {
  const actions = [
    [1, (store, snapshot) => store.edit(snapshot, "one", () => true)],
    [2, (store, snapshot) => store.removeMatching(snapshot, "story 中文", () => true)],
    [3, (store, snapshot) => store.removeMatching(snapshot, "", () => true, { fromDate: "2026-01-15", throughDate: "2026-01-15" })],
    [2, (store, snapshot) => store.removeSelected(snapshot, ["two", "keep"], () => true)],
    [4, (store, snapshot) => store.edit(snapshot, null, () => true)],
  ];
  for (const [count, action] of actions) {
    const f = fixture(), initial = await f.store.read(); assert.equal(f.store.getRedo(initial), null);
    await action(f.store, initial); const removed = await f.store.read(), deleted = f.data();
    await f.store.undo(removed, f.store.getUndo(removed), () => true);
    const restored = await f.store.read(), redo = f.store.getRedo(restored); assert.equal(redo.count, count); assert.equal(f.store.getUndo(restored), null);
    await f.store.redo(restored, redo, () => true);
    assert.deepEqual(f.data(), deleted); const reapplied = await f.store.read();
    assert.equal(f.store.getRedo(reapplied), null); assert.equal(f.store.getUndo(reapplied).count, count);
    await f.store.undo(reapplied, f.store.getUndo(reapplied), () => true);
    assert.deepEqual(f.data(), seed()); assert.equal(f.writes(), 4); await f.store.stop();
  }
});

test("Redo uses detached response/data checkpoints and detached ID/count reviews, never a mutated caller snapshot", async () => {
  const f = fixture(), { snapshot, review } = await prepare(f);
  assert.deepEqual(Object.keys(review).sort(), ["count", "id"]);
  f.responses[0].data.entries.length = 0; f.responses[1].data.future.keep.length = 0;
  const altered = f.store.getRedo(snapshot); altered.id = "forged"; altered.count = 999;
  await assert.rejects(f.store.redo(snapshot, altered, () => true), /no longer available/);
  assert.equal(f.store.getRedo(snapshot).id, review.id);
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = f.store.redo(snapshot, review, () => true); snapshot.document.data.entries.length = 0; release(); await pending;
  const original = seed(); assert.deepEqual(f.data(), { ...original, entries: original.entries.filter(entry => entry.id !== "one") });
  await f.store.stop();
});

test("No-op actions/reads retain redo while later preference/visit/removal writes invalidate or replace it without a multi-step stack", async () => {
  const f = fixture(), first = await prepare(f);
  f.store.record("https://example.com/paused", "Paused"); await f.store.whenIdle(); await f.store.edit(await f.store.read(), "missing", () => true);
  assert.equal(f.store.getRedo(await f.store.read()).id, first.review.id);
  await f.store.setRecording(true, () => true); assert.equal(f.store.getRedo(await f.store.read()), null);
  await f.store.edit(await f.store.read(), "two", () => true); let snapshot = await f.store.read();
  await f.store.undo(snapshot, f.store.getUndo(snapshot), () => true);
  f.store.record("https://example.com/new", "New"); await f.store.whenIdle(); assert.equal(f.store.getRedo(await f.store.read()), null);
  await f.store.edit(await f.store.read(), "one", () => true); snapshot = await f.store.read(); await f.store.undo(snapshot, f.store.getUndo(snapshot), () => true);
  const old = f.store.getRedo(await f.store.read()); await f.store.edit(await f.store.read(), "keep", () => true);
  assert.equal(f.store.getRedo(await f.store.read()), null); snapshot = await f.store.read(); await f.store.undo(snapshot, f.store.getUndo(snapshot), () => true);
  snapshot = await f.store.read(); assert.notEqual(f.store.getRedo(snapshot).id, old.id);
  await assert.rejects(f.store.redo(snapshot, old, () => true), /no longer available/); await f.store.stop();
});

test("External edits hide redo for the new version; stale reapplication consumes its checkpoint and retains exact external data", async () => {
  const f = fixture(), { snapshot, review } = await prepare(f), external = { ...f.data(), external: { keep: "newer state" } };
  f.external(external); assert.equal(f.store.getRedo(await f.store.read()), null);
  await assert.rejects(f.store.redo(snapshot, review, () => true), /changed on disk/);
  assert.deepEqual(f.data(), external); assert.equal(f.writes(), 2);
  assert.equal(f.store.getRedo(snapshot), null); assert.equal(f.store.getUndo(await f.store.read()), null); await f.store.stop();
});

test("Queued redo refuses cancelled, transitioning, foreign, inactive or stopping owners and stop/start discards both checkpoints", async () => {
  for (const change of [f => { f.current = false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; }, f => { f.store.active = false; }, f => { f.stopping = f.store.stop(); }]) {
    const f = fixture(); f.current = true; const { snapshot, review } = await prepare(f), restored = f.data();
    let release; f.store.tail = new Promise(resolve => { release = resolve; });
    const pending = f.store.redo(snapshot, review, () => f.current); change(f); release();
    await assert.rejects(pending, /no longer active|no longer available/); assert.deepEqual(f.data(), restored); assert.equal(f.writes(), 2);
    if (f.stopping) { await f.stopping; }
  }
  const f = fixture(); await prepare(f); await f.store.stop(); f.store.start();
  assert.equal(f.store.getRedo(await f.store.read()), null); assert.equal(f.store.getUndo(await f.store.read()), null); await f.store.stop();
});

test("Concurrent redo writes once, old tokens cannot replay after cycling and a failed reapplication consumes redo without creating Undo", async () => {
  const f = fixture(), { snapshot, review } = await prepare(f);
  const result = await Promise.allSettled([f.store.redo(snapshot, review, () => true), f.store.redo(snapshot, review, () => true)]);
  assert.deepEqual(result.map(item => item.status), ["fulfilled", "rejected"]); assert.equal(f.writes(), 3);
  let current = await f.store.read(); await f.store.undo(current, f.store.getUndo(current), () => true);
  current = await f.store.read(); const latest = f.store.getRedo(current); assert.notEqual(latest.id, review.id);
  await assert.rejects(f.store.redo(current, review, () => true), /no longer available/);
  f.failNext(); await assert.rejects(f.store.redo(current, latest, () => true), /Disk write denied/);
  assert.deepEqual(f.data(), seed()); assert.equal(f.writes(), 4); assert.equal(f.store.getRedo(current), null); assert.equal(f.store.getUndo(current), null); await f.store.stop();
});

function viewFixture() {
  const view = Object.create(WebHistoryView.prototype), calls = [], snapshot = { document: { root: "vault-a", version: "restored", data: {} } }, redo = { id: "redo", count: 2 };
  Object.defineProperty(view, "_loaded", { value: true, writable: true });
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, core: { busy: false, isEnabled: () => true } };
  const span = {}, confirm = { focus() { calls.push("confirm-focus"); } };
  Object.assign(view, { app, leaf: { view }, provider: { id: "webviewer", history: {
    getRedo: () => ({ ...redo }), async redo(document, token, current) { assert.equal(current(), true); calls.push({ document, token }); },
  } }, snapshot, revision: 5, disposed: false, busy: false, refreshing: false, status: { textContent: "Saved visits" }, state: { future: { keep: true } },
  search: { value: "", focus() { calls.push("search-focus"); } }, rangeState: { fromDate: "", throughDate: "" }, redoButton: { focus() { calls.push("redo-focus"); } },
  confirmation: { hidden: true, querySelector: selector => selector === "span" ? span : confirm }, review: null });
  view.perform = async action => { await action(); return true; };
  return { view, app, snapshot, redo, calls, span, confirm };
}

test("The pane reviews redo before deletion, Cancel/Escape retain availability, ownership/token changes refuse and only a current successful write announces reapplication", async () => {
  const f = viewFixture(); f.view.beginRedoRemoval();
  assert.equal(f.span.textContent, "Remove the 2 visits restored by Undo again? Other visits will be kept. ");
  assert.equal(f.confirm.textContent, "Redo removal"); assert.equal(f.view.confirmation.hidden, false);
  f.view.cancelRemoval(); assert.equal(f.calls.at(-1), "redo-focus"); assert.equal(f.view.review, null);
  f.view.beginRedoRemoval(); await f.view.confirmRemoval();
  assert.deepEqual(f.calls.find(item => typeof item === "object"), { document: f.snapshot, token: f.redo }); assert.equal(f.view.status.textContent, "Removed 2 visits again.");
  assert.deepEqual(f.view.getState(), { future: { keep: true }, query: "", fromDate: "", throughDate: "" });
  for (const change of [g => { g.view.revision++; }, g => { g.view.refreshing = true; }, g => { g.view.leaf.view = {}; }, g => { g.view.disposed = true; }, g => { g.app.core.isEnabled = () => false; }, g => { g.app.vault.rootPath = "vault-b"; }, g => { g.view.provider.history.getRedo = () => ({ id: "new", count: 2 }); }]) {
    const g = viewFixture(); g.view.beginRedoRemoval(); change(g);
    await assert.rejects(g.view.confirmRemoval(), /no longer active/); assert.equal(g.calls.some(item => typeof item === "object"), false);
  }
  const g = viewFixture(); g.view.beginRedoRemoval(); g.view.perform = async () => false; await g.view.confirmRemoval(); assert.equal(g.view.status.textContent, "Saved visits");
});
