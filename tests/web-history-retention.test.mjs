import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, WebHistoryData, WebHistory, WebHistoryView, historyRetentionDays;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "history-retention-tests-"));
  const entry = join(temporary, "retention.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "retention-notice-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice {} export class Modal {}" }));
  } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView, historyRetentionDays } = await import(pathToFileURL(entry).href));
});
after(async () => {
  if (temporary) {
    const path = relative(join(root, ".runtime"), temporary);
    assert.ok(path && !isAbsolute(path) && !path.startsWith(".."));
    await rm(temporary, { recursive: true });
  }
});
const DAY = 86400000, now = Date.UTC(2026, 9, 24, 12), cutoff = now - 7 * DAY;
const visit = (id, visitedAt, url = "https://example.com/" + id) => ({ id, visitedAt, url, title: "中文 Story " + id, opaque: { keep: [id, true] } });
const seed = () => ({ version: 1, recording: true, entries: [visit("future", now + DAY), visit("old", cutoff - 1), visit("boundary", cutoff), visit("recent", now - 1)], opaque: { keep: ["中文", true] } });
const ids = history => history.entries.map(entry => entry.id);

test("History retention defaults without rewriting old data and strictly validates the four numeric choices before mutation", () => {
  assert.equal(historyRetentionDays(), 0);
  const original = seed(), legacy = new WebHistoryData(original);
  assert.equal(legacy.retentionDays, 0); assert.deepEqual(legacy.data, original);
  for (const value of [0, 7, 30, 90]) {
    assert.equal(historyRetentionDays(value), value);
    const data = { ...seed(), retentionDays: value }, model = new WebHistoryData(data);
    assert.equal(model.retentionDays, value); assert.deepEqual(model.data, data);
  }
  for (const value of [null, true, false, "7", "0", "", {}, [], -1, 1, 7.5, 365, NaN, Infinity]) {
    assert.throws(() => historyRetentionDays(value), /retention|days/i);
    assert.throws(() => new WebHistoryData({ ...seed(), retentionDays: value }));
    assert.throws(() => legacy.setRetentionDays(value));
    assert.deepEqual(legacy.data, original);
  }
  assert.equal(legacy.setRetentionDays(7), true); assert.equal(legacy.setRetentionDays(7), false);
  assert.deepEqual(legacy.entries, original.entries);
  assert.equal(legacy.setRetentionDays(0), true); assert.equal("retentionDays" in legacy.data, false);
  assert.deepEqual(legacy.data, original); assert.deepEqual(original, seed());
});

test("A recorded visit applies rolling age retention by timestamp while keeping the exact boundary, future dates, physical order and opaque data", () => {
  for (const days of [7, 30, 90]) {
    const threshold = now - days * DAY, original = { ...seed(), retentionDays: days,
      entries: [visit("future", now + DAY), visit("expired", threshold - 1), visit("boundary", threshold), visit("recent", now - 1), visit("very-old", 0)] };
    const model = new WebHistoryData(original);
    assert.equal(model.add("https://example.com/new", "New", now, "new"), true);
    assert.deepEqual(ids(model), ["future", "boundary", "recent", "new"]);
    assert.deepEqual(model.entries.slice(0, 3), [original.entries[0], original.entries[2], original.entries[3]]);
    assert.deepEqual(model.data.opaque, original.opaque); assert.equal(model.retentionDays, days);
    assert.equal(original.entries.length, 5); assert.equal(model.recording, true);
  }
  const ancient = new WebHistoryData({ version: 1, retentionDays: 7, entries: [visit("epoch", 0)] });
  ancient.add("https://example.com/early", "Early", 1, "early"); assert.deepEqual(ids(ancient), ["epoch", "early"]);
  const unlimited = new WebHistoryData(seed()); unlimited.add("https://example.com/new", "New", now, "new");
  assert.deepEqual(ids(unlimited), ["future", "old", "boundary", "recent", "new"]);
});

test("Read, policy changes, paused/blank/duplicate captures and invalid new visits never prune or partially change existing history", () => {
  const model = new WebHistoryData(seed()); model.setRetentionDays(7);
  const before = structuredClone(model.data);
  assert.deepEqual(new WebHistoryData(model.data).data, before);
  model.data.recording = false; assert.equal(model.add("https://example.com/new", "Paused", now, "new"), false);
  model.data.recording = true;
  assert.equal(model.add("about:blank", "Blank", now, "new"), false);
  assert.equal(model.add(model.entries.at(-1).url, "Duplicate", now, "new"), false);
  for (const timestamp of [-1, NaN, Infinity, 8640000000000001]) { assert.throws(() => model.add("https://example.com/new", "Invalid", timestamp, "new")); }
  assert.throws(() => model.add("https://example.com/new", "Duplicate ID", now, "old"));
  assert.throws(() => model.add("file:///private", "Invalid URL", now, "new"));
  assert.deepEqual(model.data, before);
});

test("Age pruning precedes the existing 1000-visit cap without sorting retained entries or dropping extra recent visits", () => {
  const entries = Array.from({ length: 1000 }, (_, index) => visit("visit-" + index, index % 10 === 0 ? cutoff - 1 : now - index));
  const model = new WebHistoryData({ version: 1, retentionDays: 7, entries });
  model.add("https://example.com/new", "New", now, "new");
  assert.equal(model.entries.length, 901);
  assert.deepEqual(ids(model), [...entries.filter(entry => entry.visitedAt >= cutoff).map(entry => entry.id), "new"]);
  const full = new WebHistoryData({ version: 1, retentionDays: 7, entries: entries.map(entry => ({ ...entry, visitedAt: now })) });
  full.add("https://example.com/new", "New", now, "new");
  assert.equal(full.entries.length, 1000); assert.equal(full.entries[0].id, "visit-1"); assert.equal(full.entries.at(-1).id, "new");
});

function fixture(initial = seed()) {
  let data = structuredClone(initial), version = 1, writes = 0;
  const app = { changingVault: false, vault: { rootPath: "vault-a" }, core: { busy: false, isEnabled: () => true },
    workspace: { trigger() {} }, configuration: {
      async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
      async write(document, next) {
        if (document.root !== app.vault.rootPath || document.version !== String(version)) { throw new Error("Configuration changed on disk"); }
        data = structuredClone(next); writes++; version++;
        return { ...document, version: String(version), data: structuredClone(data) };
      },
    } };
  const store = new WebHistory(app); store.start();
  return { app, store, data: () => structuredClone(data), writes: () => writes,
    external(next) { data = structuredClone(next); version++; } };
}

test("Policy changes write the reviewed version without pruning, retain inverse eligibility on no-op and invalidate it only after a successful changed policy", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), "future", () => true);
  let snapshot = await f.store.read(); const checkpoint = f.store.getUndo(snapshot), afterRemoval = f.data();
  await f.store.setRetention(snapshot, 0, () => true);
  assert.equal(f.writes(), 1); assert.equal(f.store.getUndo(await f.store.read()).id, checkpoint.id);
  await f.store.setRetention(snapshot, 7, () => true); snapshot = await f.store.read();
  assert.equal(snapshot.history.retentionDays, 7); assert.deepEqual(f.data().entries, afterRemoval.entries);
  assert.deepEqual(f.data().opaque, seed().opaque); assert.equal(f.store.getUndo(snapshot), null);
  const external = { ...f.data(), retentionDays: 30, external: ["preserve", true] }; f.external(external);
  await assert.rejects(f.store.setRetention(snapshot, 90, () => true), /changed on disk/);
  assert.deepEqual(f.data(), external); assert.equal(f.writes(), 2); await f.store.stop();
});

test("Queued policy changes capture detached data and refuse cancelled, transitioning, foreign, stopped or replaced owners before any write", async () => {
  const detached = fixture(), snapshot = await detached.store.read();
  let release; detached.store.tail = new Promise(resolve => { release = resolve; });
  const pending = detached.store.setRetention(snapshot, 30, () => true);
  snapshot.document.root = "tampered"; snapshot.document.data.entries.length = 0; snapshot.history.data.opaque.keep.length = 0;
  release(); await pending; assert.equal(detached.data().entries.length, 4); assert.deepEqual(detached.data().opaque, seed().opaque);
  await detached.store.stop();
  for (const change of [f => { f.current = false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; },
    f => { f.store.active = false; }, f => { f.stopping = f.store.stop(); }, f => { f.store.start(); }]) {
    const f = fixture(); f.current = true; const before = f.data(), reviewed = await f.store.read();
    let unblock; f.store.tail = new Promise(resolve => { unblock = resolve; });
    const queued = f.store.setRetention(reviewed, 7, () => f.current); change(f); unblock();
    await assert.rejects(queued, /no longer active|no longer available/);
    assert.deepEqual(f.data(), before); assert.equal(f.writes(), 0);
    if (f.stopping) { await f.stopping; } else { await f.store.stop(); }
  }
});

test("The real recorder prunes only on a successful new visit, reloads persisted policy, retains paused/no-op bytes and invalidates inverse state on the later write", async () => {
  const f = fixture({ ...seed(), retentionDays: 7 }), realNow = Date.now;
  try {
    Date.now = () => now;
    await f.store.edit(await f.store.read(), "future", () => true);
    const checkpoint = f.store.getUndo(await f.store.read()), before = f.data();
    f.store.record(before.entries.at(-1).url, "Duplicate"); await f.store.whenIdle();
    assert.deepEqual(f.data(), before); assert.equal(f.store.getUndo(await f.store.read()).id, checkpoint.id);
    f.store.record("https://example.com/new", "New"); await f.store.whenIdle();
    assert.deepEqual(f.data().entries.slice(0, -1).map(entry => entry.id), ["boundary", "recent"]);
    assert.equal(f.data().entries.at(-1).visitedAt, now); assert.equal(f.store.getUndo(await f.store.read()), null);
    await f.store.setRecording(false, () => true); const paused = f.data(), count = f.writes();
    f.store.record("https://example.com/paused", "Paused"); await f.store.whenIdle(); assert.deepEqual(f.data(), paused); assert.equal(f.writes(), count);
    await f.store.stop(); f.store.start(); assert.equal((await f.store.read()).history.retentionDays, 7);
    assert.deepEqual(f.data(), paused);
  } finally { Date.now = realNow; await f.store.stop(); }
});

test("The pane captures policy ownership/version and refuses a queued refresh or closed owner while retention stays vault-wide and out of leaf state", async () => {
  const f = fixture(), view = Object.create(WebHistoryView.prototype), snapshot = await f.store.read();
  Object.defineProperty(view, "_loaded", { value: true });
  Object.assign(view, { app: f.app, provider: { id: "webviewer", history: f.store }, snapshot, revision: 1, busy: false, disposed: false, refreshing: false, leaf: { view },
    state: { opaque: true }, search: { value: "Story" }, rangeState: { fromDate: "", throughDate: "" }, sortOrder: "oldest" });
  view.perform = async action => { await action(); return true; };
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = view.changeRetention(7); view.revision++; release();
  await assert.rejects(pending, /no longer active|no longer available/); assert.equal(f.writes(), 0);
  assert.equal("retentionDays" in view.getState(), false); assert.equal(view.getState().sortOrder, "oldest");
  view.disposed = true; await assert.rejects(view.changeRetention(7), /no longer active|no longer available/);
  view.disposed = false; view.snapshot = await f.store.read(); await view.changeRetention(90);
  assert.equal((await f.store.read()).history.retentionDays, 90); assert.deepEqual(f.data().entries, seed().entries);
  await f.store.stop();
});
