import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";
let temporary, WebHistoryData, WebHistory, WebHistoryView, historyVisitLimit;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "history-limit-tests-"));
  const entry = join(temporary, "limit.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "history-limit-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
    build.onResolve({ filter: /^\.\/web-history-limit-modal$/ }, () => ({ path: "limit", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "ui" ? "export class Notice {} export class Modal {}" :
      "export class WebHistoryLimitModal { constructor(app,review,actions){this.review=review;this.actions=actions;this.valid=true;this.isOpen=false;this.modalEl={focus(){}};} get available(){return this.isOpen&&this.valid;} open(){this.isOpen=true;} invalidate(){this.valid=false;} forceClose(){this.isOpen=false;this.actions.closed();} }" }));
  } }] });
  ({ WebHistoryData, WebHistory, WebHistoryView, historyVisitLimit } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });
const DAY = 86400000, now = Date.UTC(2026, 9, 24, 12);
const visit = (id, age) => ({ id, url: "https://example.com/" + id, title: "Story 中文 " + id, visitedAt: now - age * DAY, opaque: { keep: id } });
const seed = () => ({ version: 1, recording: true, entries: [visit("future", -1), visit("ancient", 100), visit("older", 8), visit("recent", 2)], opaque: { keep: ["中文", true] } });
const ids = model => model.entries.map(entry => entry.id);

test("Visit limits default to 1000 without rewriting legacy data and accept only whole numeric values from 1 to 1000", () => {
  assert.equal(historyVisitLimit(), 1000);
  const original = seed(), model = new WebHistoryData(original); assert.equal(model.visitLimit, 1000); assert.deepEqual(model.data, original);
  for (const value of [1, 2, 13, 250, 999, 1000]) {
    assert.equal(historyVisitLimit(value), value);
    const imported = { ...seed(), visitLimit: value }; assert.deepEqual(new WebHistoryData(imported).data, imported);
  }
  for (const value of [null, true, false, "1", "", {}, [], 0, -1, 1.5, 1001, NaN, Infinity]) {
    assert.throws(() => historyVisitLimit(value), /limit|whole|1000|1,000/i);
    assert.throws(() => new WebHistoryData({ ...seed(), visitLimit: value }));
    assert.throws(() => model.setVisitLimit(value)); assert.deepEqual(model.data, original);
  }
  assert.equal(model.setVisitLimit(2), true); assert.equal(model.setVisitLimit(2), false); assert.deepEqual(model.entries, original.entries);
  assert.equal(model.setVisitLimit(1000), true); assert.equal("visitLimit" in model.data, false); assert.deepEqual(model.data, original);
});

test("An accepted new visit applies the chosen stored-arrival-order cap after age pruning while retaining exact entries and opaque data", () => {
  const original = { ...seed(), visitLimit: 2 }, model = new WebHistoryData(original);
  model.add("https://example.com/new", "New", now, "new"); assert.deepEqual(ids(model), ["recent", "new"]);
  assert.deepEqual(model.entries[0], original.entries[3]); assert.deepEqual(model.data.opaque, original.opaque);
  const combined = new WebHistoryData({ ...seed(), visitLimit: 2, retentionDays: 7 });
  combined.add("https://example.com/new", "New", now, "new"); assert.deepEqual(ids(combined), ["recent", "new"]);
  const one = new WebHistoryData({ ...seed(), visitLimit: 1 }); one.add("https://example.com/new", "New", now, "new"); assert.deepEqual(ids(one), ["new"]);
  assert.deepEqual(original.entries, seed().entries);
  const many = new WebHistoryData({ version: 1, entries: Array.from({ length: 1000 }, (_, index) => visit("v-" + index, 0)) });
  many.add("https://example.com/new", "New", now, "new"); assert.equal(many.entries.length, 1000); assert.equal(many.entries[0].id, "v-1");
});

test("Read, changed policies, paused/blank/duplicate/invalid captures never trim an existing over-limit history", () => {
  const model = new WebHistoryData(seed()); model.setVisitLimit(1); const before = structuredClone(model.data);
  assert.deepEqual(new WebHistoryData(model.data).data, before);
  model.data.recording = false; assert.equal(model.add("https://example.com/new", "Paused", now, "new"), false); model.data.recording = true;
  assert.equal(model.add("about:blank", "Blank", now, "new"), false);
  assert.equal(model.add(model.entries.at(-1).url, "Duplicate", now, "new"), false);
  assert.throws(() => model.add("file:///private", "Invalid", now, "new"));
  assert.throws(() => model.add("https://example.com/new", "Invalid", -1, "new"));
  assert.throws(() => model.add("https://example.com/new", "Duplicate ID", now, "future"));
  assert.deepEqual(model.data, before);
});

function fixture(initial = seed()) {
  let data = structuredClone(initial), version = 1, writes = 0;
  const app = { changingVault: false, vault: { rootPath: "vault-a" }, core: { busy: false, isEnabled: () => true }, workspace: { trigger() {}, layoutChanged() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, version: String(version), data: structuredClone(data) }; },
    async write(document, next) {
      if (document.root !== app.vault.rootPath || document.version !== String(version)) { throw new Error("Configuration changed on disk"); }
      data = structuredClone(next); version++; writes++; return { ...document, version: String(version), data: structuredClone(data) };
    },
  } };
  const store = new WebHistory(app); store.start();
  return { app, store, data: () => structuredClone(data), writes: () => writes, external(next) { data = structuredClone(next); version++; } };
}

test("Reviewed count-policy writes preserve entries, invalidate inverse state only when changed and refuse stale versions without retries", async () => {
  const f = fixture(); await f.store.edit(await f.store.read(), "future", () => true);
  let snapshot = await f.store.read(); const checkpoint = f.store.getUndo(snapshot), entries = f.data().entries;
  await f.store.setVisitLimit(snapshot, 1000, () => true); assert.equal(f.writes(), 1); assert.equal(f.store.getUndo(await f.store.read()).id, checkpoint.id);
  await f.store.setVisitLimit(snapshot, 1, () => true); snapshot = await f.store.read();
  assert.equal(snapshot.history.visitLimit, 1); assert.deepEqual(f.data().entries, entries); assert.equal(f.store.getUndo(snapshot), null);
  const external = { ...f.data(), visitLimit: 13, external: { keep: true } }; f.external(external);
  await assert.rejects(f.store.setVisitLimit(snapshot, 1, () => true), /changed/);
  await assert.rejects(f.store.setVisitLimit(snapshot, 2, () => true), /changed on disk/); assert.deepEqual(f.data(), external); assert.equal(f.writes(), 2); await f.store.stop();
});

test("Queued count policies capture detached data and refuse cancelled, foreign, transitioning, stopped or replaced owners before writing", async () => {
  const detached = fixture(), snapshot = await detached.store.read(); let release;
  detached.store.tail = new Promise(resolve => { release = resolve; });
  const pending = detached.store.setVisitLimit(snapshot, 2, () => true); snapshot.document.data.entries.length = 0; snapshot.document.root = "tampered"; release(); await pending;
  assert.equal(detached.data().entries.length, 4); assert.deepEqual(detached.data().opaque, seed().opaque); await detached.store.stop();
  for (const change of [f => { f.current = false; }, f => { f.app.changingVault = true; }, f => { f.app.vault.rootPath = "vault-b"; },
    f => { f.store.active = false; }, f => { f.stopping = f.store.stop(); }, f => { f.store.start(); }]) {
    const f = fixture(); f.current = true; const before = f.data(), reviewed = await f.store.read(); let unblock;
    f.store.tail = new Promise(resolve => { unblock = resolve; }); const queued = f.store.setVisitLimit(reviewed, 2, () => f.current); change(f); unblock();
    await assert.rejects(queued, /no longer active|no longer available/); assert.deepEqual(f.data(), before); assert.equal(f.writes(), 0);
    if (f.stopping) { await f.stopping; } else { await f.store.stop(); }
  }
});

test("The actual recorder loads the saved count/age policies and trims only after a new visit, retaining paused/duplicate bytes and policy across restart", async () => {
  const f = fixture({ ...seed(), visitLimit: 2, retentionDays: 7 }), realNow = Date.now;
  try {
    Date.now = () => now;
    f.store.record(seed().entries.at(-1).url, "Duplicate"); await f.store.whenIdle(); assert.equal(f.writes(), 0); assert.equal(f.data().entries.length, 4);
    f.store.record("https://example.com/new", "New"); await f.store.whenIdle();
    assert.equal(f.data().entries.length, 2); assert.equal(f.data().entries[0].id, "recent"); assert.equal(f.data().entries[1].visitedAt, now);
    await f.store.setRecording(false, () => true); const paused = f.data(), count = f.writes();
    f.store.record("https://example.com/paused", "Paused"); await f.store.whenIdle(); assert.deepEqual(f.data(), paused); assert.equal(f.writes(), count);
    await f.store.stop(); f.store.start(); assert.equal((await f.store.read()).history.visitLimit, 2); assert.deepEqual(f.data(), paused);
  } finally { Date.now = realNow; await f.store.stop(); }
});

test("The pane captures the count review and queued order changes, closed reviews and replaced owners cannot save their obsolete policy", async () => {
  const f = fixture(), view = Object.create(WebHistoryView.prototype);
  Object.defineProperty(view, "_loaded", { value: true });
  Object.assign(view, { app: f.app, provider: { id: "webviewer", history: f.store }, snapshot: await f.store.read(), revision: 1, orderRevision: 0,
    busy: false, disposed: false, refreshing: false, leaf: { view }, state: { opaque: true }, search: { value: "" }, rangeState: { fromDate: "", throughDate: "" },
    sortOrder: "newest", copySequence: 0, selected: new Set(), confirmation: { hidden: true }, archivePreview: null, limitPreview: null });
  view.render = () => {}; view.refresh = async () => {};
  view.beginLimit(); const modal = view.limitPreview; assert.equal(modal.review.limit, 1000); assert.equal(modal.review.count, 4);
  assert.equal("visitLimit" in view.getState(), false);
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = modal.actions.save(2); view.changeOrder("oldest"); release();
  await assert.rejects(pending, /no longer active|no longer available/); assert.equal(modal.available, false); assert.equal(f.writes(), 0);
  modal.forceClose(); view.beginLimit(); const next = view.limitPreview; await assert.rejects(modal.actions.save(1), /no longer active|no longer available/);
  await next.actions.save(2); assert.equal((await f.store.read()).history.visitLimit, 2); assert.equal(f.data().entries.length, 4);
  next.forceClose(); view.disposed = true; assert.throws(() => view.beginLimit(), /no longer active|no longer available/); await f.store.stop();
});
