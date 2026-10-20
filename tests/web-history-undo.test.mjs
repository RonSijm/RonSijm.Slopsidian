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
  temporary = await mkdtemp(join(root, ".runtime", "history-undo-tests-"));
  const entry = join(temporary, "undo.mjs");
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
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
    async write(document, next) {
      if (document.root !== app.vault.rootPath || document.version !== String(version)) { throw Error("Configuration changed on disk"); }
      if (fail) { fail = false; throw Error("Disk write denied"); }
      data = structuredClone(next); version++; writes++;
      return { ...document, version: String(version), data: structuredClone(data) };
    },
  } };
  const store = new WebHistory(app); store.start();
  return { app, store, data: () => structuredClone(data), writes: () => writes, external(next) { data = structuredClone(next); version++; }, failNext() { fail = true; } };
}

test("Single, matching, date-only, selected and clear removals each support one exact-version undo with original order/opaque data/recording restored", async () => {
  const actions = [
    [1, (store, snapshot) => store.edit(snapshot, "one", () => true)],
    [2, (store, snapshot) => store.removeMatching(snapshot, "story 中文", () => true)],
    [3, (store, snapshot) => store.removeMatching(snapshot, "", () => true, { fromDate: "2026-01-15", throughDate: "2026-01-15" })],
    [2, (store, snapshot) => store.removeSelected(snapshot, ["two", "keep"], () => true)],
    [4, (store, snapshot) => store.edit(snapshot, null, () => true)],
  ];
  for (const [count, action] of actions) {
    const f = fixture(), before = await f.store.read(); assert.equal(f.store.getUndo(before), null);
    await action(f.store, before); const deleted = await f.store.read(), review = f.store.getUndo(deleted);
    assert.equal(review.count, count); assert.equal(f.store.getUndo(before), null); assert.equal(f.data().entries.length, 4 - count);
    await f.store.undo(deleted, review, () => true);
    assert.deepEqual(f.data(), seed()); assert.equal(f.writes(), 2); assert.equal(f.store.getUndo(await f.store.read()), null); await f.store.stop();
  }
});

test("Undo captures detached pre-removal data before queueing and exposes only detached ID/count reviews", async () => {
  const f = fixture(), snapshot = await f.store.read(), ids = ["one"];
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = f.store.removeSelected(snapshot, ids, () => true);
  ids[0] = "keep"; snapshot.document.root = "other"; snapshot.document.data.entries.length = 0; snapshot.document.data.future.keep.length = 0;
  release(); await pending;
  const deleted = await f.store.read(), review = f.store.getUndo(deleted), altered = f.store.getUndo(deleted);
  assert.deepEqual(Object.keys(review).sort(), ["count", "id"]); altered.id = "forged"; altered.count = 999;
  assert.equal(f.store.getUndo(deleted).count, 1);
  await assert.rejects(f.store.undo(deleted, altered, () => true), /no longer available/); assert.equal(f.writes(), 1);
  await f.store.undo(deleted, review, () => true); assert.deepEqual(f.data(), seed()); await f.store.stop();
});

test("No-op history actions retain undo, later successful writes invalidate it, and a newer deletion replaces the one-step checkpoint without a multi-step stack", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), "one", () => true);
  let snapshot = await f.store.read(), first = f.store.getUndo(snapshot);
  f.store.record("https://example.com/paused", "Paused"); await f.store.whenIdle();
  await f.store.edit(await f.store.read(), "missing", () => true);
  assert.equal(f.store.getUndo(await f.store.read()).id, first.id);
  await f.store.setRecording(true, () => true); assert.equal(f.store.getUndo(await f.store.read()), null);
  await f.store.edit(await f.store.read(), "two", () => true);
  f.store.record("https://example.com/new", "New"); await f.store.whenIdle(); assert.equal(f.store.getUndo(await f.store.read()), null);
  await f.store.edit(await f.store.read(), "keep", () => true); first = f.store.getUndo(await f.store.read());
  const newId = f.data().entries.at(-1).id; await f.store.edit(await f.store.read(), newId, () => true);
  snapshot = await f.store.read(); const latest = f.store.getUndo(snapshot); assert.notEqual(first.id, latest.id);
  await assert.rejects(f.store.undo(snapshot, first, () => true), /no longer available/);
  await f.store.undo(snapshot, latest, () => true);
  assert.equal(f.data().entries.some(entry => entry.id === "keep"), false);
  assert.equal(f.data().entries.some(entry => entry.id === newId), true);
  assert.equal(f.data().recording, true); assert.equal(f.store.getUndo(await f.store.read()), null); await f.store.stop();
});

test("External edits hide undo for the new version and an attempted stale undo consumes its checkpoint while retaining exact external state", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), null, () => true);
  const deleted = await f.store.read(), review = f.store.getUndo(deleted), external = { ...f.data(), external: { keep: "newer state" } };
  f.external(external); assert.equal(f.store.getUndo(await f.store.read()), null);
  await assert.rejects(f.store.undo(deleted, review, () => true), /changed on disk/);
  assert.deepEqual(f.data(), external); assert.equal(f.writes(), 1); assert.equal(f.store.getUndo(deleted), null); await f.store.stop();
});

test("Queued undo refuses cancelled, transitioning, foreign, inactive or stopping contexts and stop/start discards every checkpoint", async () => {
  for (const change of [f => { f.current = false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; }, f => { f.store.active = false; }, f => { f.stopping = f.store.stop(); }]) {
    const f = fixture(); f.current = true; await f.store.edit(await f.store.read(), "one", () => true);
    const snapshot = await f.store.read(), review = f.store.getUndo(snapshot), deleted = f.data();
    let release; f.store.tail = new Promise(resolve => { release = resolve; });
    const pending = f.store.undo(snapshot, review, () => f.current); change(f); release();
    await assert.rejects(pending, /no longer active|no longer available/);
    assert.deepEqual(f.data(), deleted); assert.equal(f.writes(), 1); if (f.stopping) { await f.stopping; }
  }
  const f = fixture(); await f.store.edit(await f.store.read(), "one", () => true); await f.store.stop(); f.store.start();
  assert.equal(f.store.getUndo(await f.store.read()), null); await f.store.stop();
});

test("Concurrent undo writes exactly once, old tokens cannot undo a later deletion and a failed restore consumes the checkpoint without reporting success", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), "one", () => true);
  const snapshot = await f.store.read(), review = f.store.getUndo(snapshot);
  const result = await Promise.allSettled([f.store.undo(snapshot, review, () => true), f.store.undo(snapshot, review, () => true)]);
  assert.deepEqual(result.map(item => item.status), ["fulfilled", "rejected"]); assert.equal(f.writes(), 2); assert.deepEqual(f.data(), seed());
  await f.store.edit(await f.store.read(), "one", () => true);
  const latest = await f.store.read(), checkpoint = f.store.getUndo(latest), deleted = f.data();
  assert.notEqual(checkpoint.id, review.id); await assert.rejects(f.store.undo(latest, review, () => true), /no longer available/);
  f.failNext(); await assert.rejects(f.store.undo(latest, checkpoint, () => true), /Disk write denied/);
  assert.deepEqual(f.data(), deleted); assert.equal(f.writes(), 3); assert.equal(f.store.getUndo(latest), null); await f.store.stop();
});

function viewFixture() {
  const view = Object.create(WebHistoryView.prototype), calls = [], snapshot = { document: { root: "vault-a", version: "after", data: {} } }, review = { id: "checkpoint", count: 2 };
  Object.defineProperty(view, "_loaded", { value: true, writable: true });
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, core: { busy: false, isEnabled: () => true } };
  Object.assign(view, { app, leaf: { view }, provider: { id: "webviewer", history: {
    getUndo: () => review,
    async undo(document, token, current) { assert.equal(current(), true); calls.push({ document, token }); },
  } }, snapshot, revision: 5, disposed: false, busy: false, refreshing: false, status: { textContent: "Saved visits" }, state: { future: { keep: true } }, search: { value: "" }, rangeState: { fromDate: "", throughDate: "" } });
  view.perform = async action => { await action(); return true; };
  return { view, app, snapshot, review, calls };
}

test("The pane's explicit undo action checks owner/readiness and captured revision, keeps checkpoints out of leaf state and announces only a successful current restore", async () => {
  const f = viewFixture(); await f.view.undoRemoval();
  assert.deepEqual(f.calls, [{ document: f.snapshot, token: f.review }]); assert.equal(f.view.status.textContent, "Restored 2 visits.");
  assert.deepEqual(f.view.getState(), { future: { keep: true }, query: "", fromDate: "", throughDate: "" });
  for (const change of [g => { g.view.disposed = true; }, g => { g.view._loaded = false; }, g => { g.view.busy = true; }, g => { g.view.refreshing = true; }, g => { g.view.leaf.view = {}; }, g => { g.app.core.busy = true; }, g => { g.app.core.isEnabled = () => false; }, g => { g.app.changingVault = true; }, g => { g.app.vault.rootPath = "vault-b"; }, g => { g.view.provider.history.getUndo = () => null; }]) {
    const g = viewFixture(); change(g); await assert.rejects(g.view.undoRemoval(), /no longer available/); assert.deepEqual(g.calls, []);
  }
  const g = viewFixture(); g.view.provider.history.undo = async (_snapshot, _review, current) => { g.view.revision++; assert.equal(current(), false); throw Error("Stale undo owner"); };
  await assert.rejects(g.view.undoRemoval(), /Stale undo owner/); assert.equal(g.view.status.textContent, "Saved visits");
  const h = viewFixture(); h.view.perform = async () => false; await h.view.undoRemoval(); assert.equal(h.view.status.textContent, "Saved visits");
});
