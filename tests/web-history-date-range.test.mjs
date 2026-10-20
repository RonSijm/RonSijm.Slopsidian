import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, historyDateRange, WebHistoryData, WebHistory, WebHistoryView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "history-date-range-tests-"));
  const entry = join(temporary, "date-range.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-date-range"; export * from "./client/web-history-model"; export * from "./client/web-history"; export { WebHistoryView } from "./client/web-history-view";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "notice-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "notice", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice { constructor() {} } export class Modal {}" }));
  } }] });
  ({ historyDateRange, WebHistoryData, WebHistory, WebHistoryView } = await import(pathToFileURL(entry).href));
});
after(async () => {
  if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); }
});
function inZone(zone, action) {
  const previous = process.env.TZ; process.env.TZ = zone;
  try { return action(); } finally { if (previous === undefined) { delete process.env.TZ; } else { process.env.TZ = previous; } }
}
const visit = (id, visitedAt, title = "中文 Story", url = "https://example.com/" + id) => ({ id, url, title, visitedAt, future: { keep: [id, true] } });
function seed() {
  const start = new Date(2026, 0, 15).getTime(), end = new Date(2026, 0, 17).getTime();
  return { version: 1, recording: false, entries: [visit("before", start - 1), visit("start", start), visit("middle", start + 3600000, "Other"), visit("last", end - 1), visit("after", end)], future: { keep: ["中文", true] } };
}
const range = { fromDate: "2026-01-15", throughDate: "2026-01-16" };

test("History dates strictly validate real calendar days and ordered/open ranges without changing opaque state", () => {
  inZone("UTC", () => {
    const input = { ...range, future: { keep: true } }, before = structuredClone(input);
    assert.deepEqual(historyDateRange(input), { ...range, start: Date.UTC(2026, 0, 15), end: Date.UTC(2026, 0, 17) });
    assert.deepEqual(input, before); assert.deepEqual(historyDateRange(), { fromDate: "", throughDate: "", start: null, end: null });
    assert.equal(historyDateRange({ throughDate: "2024-02-29" }).end, Date.UTC(2024, 2, 1));
    assert.equal(new Date(historyDateRange({ fromDate: "0001-01-01" }).start).getUTCFullYear(), 1);
    assert.equal(new Date(historyDateRange({ throughDate: "9999-12-31" }).end).getUTCFullYear(), 10000);
    for (const invalid of [null, [], 1, { fromDate: null }, { throughDate: false }, { fromDate: "2026-02-29" }, { fromDate: "2024-02-30" }, { fromDate: "2026-13-01" }, { fromDate: "2026-01-00" }, { fromDate: "0000-01-01" }, { fromDate: "10000-01-01" }, { fromDate: "2026-1-15" }, { throughDate: "2026-01-16T00:00:00Z" }, { fromDate: "2026-01-17", throughDate: "2026-01-16" }]) {
      const original = structuredClone(invalid); assert.throws(() => historyDateRange(invalid), /date|From|Through/); assert.deepEqual(invalid, original);
    }
  });
});

test("Local calendar boundaries include midnight and the whole Through day across 23/25-hour DST days rather than assuming UTC or 24 hours", () => {
  inZone("Europe/Amsterdam", () => {
    for (const [date, hours] of [["2026-03-29", 23], ["2026-10-25", 25]]) {
      const bounds = historyDateRange({ fromDate: date, throughDate: date });
      assert.equal((bounds.end - bounds.start) / 3600000, hours);
      const history = new WebHistoryData({ version: 1, entries: [visit("before", bounds.start - 1), visit("first", bounds.start), visit("last", bounds.end - 1), visit("after", bounds.end)] });
      assert.deepEqual(history.newest("", { fromDate: date, throughDate: date }).map(entry => entry.id), ["last", "first"]);
      assert.deepEqual(history.newest("", { fromDate: date }).map(entry => entry.id), ["after", "last", "first"]);
      assert.deepEqual(history.newest("", { throughDate: date }).map(entry => entry.id), ["last", "first", "before"]);
    }
  });
});

test("Date filters combine with all-word title/address search and allow reviewed date-only removal while preserving unmatched order/opaque data", () => {
  const original = seed(), history = new WebHistoryData(original);
  assert.deepEqual(history.newest("STORY 中文", range).map(entry => entry.id), ["last", "start"]);
  assert.equal(history.removeMatching("STORY 中文", range), 2);
  assert.deepEqual(history.data, { ...original, entries: [original.entries[0], original.entries[2], original.entries[4]] });
  assert.deepEqual(original, seed());
  assert.equal(history.removeMatching("", range), 1);
  assert.deepEqual(history.data, { ...original, entries: [original.entries[0], original.entries[4]] });
  assert.equal(history.removeMatching("", range), 0);
  assert.throws(() => history.removeMatching("", {}), /nonblank/);
  assert.throws(() => history.removeMatching("x".repeat(1025), range), /1,024/);
  assert.throws(() => history.newest("", { fromDate: "invalid" }), /date/);
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

test("Date-only queued edits capture reviewed data/dates before queueing and retain exact external changes until a fresh review", async () => {
  const f = storeFixture(), snapshot = await f.store.read(), dates = { ...range };
  let release; f.store.tail = new Promise(resolve => { release = resolve; });
  const pending = f.store.removeMatching(snapshot, "", () => true, dates);
  dates.fromDate = "2027-01-01"; dates.throughDate = ""; snapshot.document.data.entries.length = 0;
  release(); await pending;
  const original = seed(), remaining = { ...original, entries: [original.entries[0], original.entries[4]] };
  assert.deepEqual(f.data(), remaining); assert.equal(f.writes(), 1);
  const reviewed = await f.store.read(), external = { ...f.data(), future: { external: "keep" } }; f.external(external);
  await assert.rejects(f.store.removeMatching(reviewed, "", () => true, { fromDate: "2026-01-17" }), /changed on disk/);
  assert.deepEqual(f.data(), external); assert.equal(f.writes(), 1);
  await f.store.removeMatching(await f.store.read(), "", () => true, { fromDate: "2026-01-17" });
  assert.deepEqual(f.data(), { ...external, entries: [original.entries[0]] });
  await assert.rejects(f.store.removeMatching(await f.store.read(), "", () => false, { throughDate: "2026-01-14" }), /no longer active/);
  await f.store.stop();
});

function viewFixture(query = "", dates = range) {
  const f = storeFixture(), view = Object.create(WebHistoryView.prototype), span = {}, confirm = { focus() {} }, calls = [];
  Object.defineProperty(view, "_loaded", { value: true, writable: true }); f.app.core = { busy: false, isEnabled: () => true };
  const snapshot = { document: { root: "vault-a", version: "0", data: seed() }, history: new WebHistoryData(seed()) };
  Object.assign(view, { app: f.app, leaf: { view }, provider: { id: "webviewer", history: {
    async removeMatching(snapshot, query, current, dates) { assert.equal(current(), true); calls.push({ snapshot, query, dates }); },
    async edit(snapshot, id, current) { assert.equal(current(), true); calls.push({ snapshot, id }); },
  } }, state: { future: { pane: true } }, rangeState: { ...dates }, disposed: false, busy: false, revision: 5, snapshot, review: null,
  search: { value: query, focus() {} }, from: { value: dates.fromDate ?? "", validity: { badInput: false } }, through: { value: dates.throughDate ?? "", validity: { badInput: false } },
  rangeError: { textContent: "" }, error: { textContent: "" }, confirmation: { hidden: true, querySelector: selector => selector === "span" ? span : confirm } });
  view.selected = new Set(); view.render = () => {}; view.perform = action => action(); return { ...f, view, snapshot, span, calls };
}

test("Pane state validates dates before mutation, preserves detached opaque/legacy query state and retains the last valid dates for incomplete drafts", async () => {
  const f = viewFixture(); await f.view.setState({ query: "story", ...range, future: { keep: [1, true] } }, {});
  const before = f.view.getState(); assert.deepEqual(before, { query: "story", ...range, future: { keep: [1, true] } });
  const review = { retained: true }; f.view.review = review;
  for (const invalid of [{ fromDate: null }, { throughDate: "2026-02-30" }, { fromDate: "2026-01-17", throughDate: "2026-01-16" }]) {
    await assert.rejects(f.view.setState({ query: "replacement", ...invalid }, {}), /date|From|Through/);
    assert.deepEqual(f.view.getState(), before); assert.equal(f.view.review, review);
  }
  f.view.from.value = ""; f.view.from.validity.badInput = true;
  assert.deepEqual(f.view.getState(), before); assert.throws(() => f.view.dateRange(), /complete dates/);
  await f.view.setState({ query: "legacy", future: { keep: true } }, {});
  assert.deepEqual(f.view.getState(), { query: "legacy", fromDate: "", throughDate: "", future: { keep: true } });
  const state = f.view.getState(); state.future.keep = false; assert.equal(f.view.getState().future.keep, true);
});

test("Date-only review shows exact inclusive dates/count and invalidates changed or incomplete bounds while Clear all retains all-visit scope", async () => {
  const f = viewFixture(); f.view.beginRemoval("");
  assert.match(f.span.textContent, /^Remove 3 matching visits from 2026-01-15 through 2026-01-16\?/);
  await f.view.confirmRemoval(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].query, ""); assert.deepEqual(f.calls[0].dates, { ...range });
  for (const change of [g => { g.view.from.value = "2026-01-16"; }, g => { g.view.through.value = "2026-01-15"; }, g => { g.view.from.validity.badInput = true; }, g => { g.app.core.isEnabled = () => false; }, g => { g.app.vault.rootPath = "vault-b"; }]) {
    const g = viewFixture(); g.view.beginRemoval(""); change(g); await assert.rejects(g.view.confirmRemoval(), /no longer active/); assert.deepEqual(g.calls, []);
  }
  const g = viewFixture(); g.view.from.value = "2026-01-17";
  g.view.beginRemoval(null); assert.match(g.span.textContent, /Clear all 5 saved visits/); await g.view.confirmRemoval(); assert.deepEqual(g.calls, [{ snapshot: g.snapshot, id: null }]);
});

test("History reviews wait for the latest refresh, including overlapping reads and recovery from a failed refresh", async () => {
  const f = viewFixture(), reads = [], renders = [];
  f.view.provider.history.read = () => new Promise(resolve => { reads.push(resolve); });
  f.view.render = () => { renders.push(f.view.refreshing); };
  f.view.beginRemoval(""); assert.ok(f.view.review);
  const first = f.view.refresh(), second = f.view.refresh(true);
  assert.equal(f.view.refreshing, true); assert.equal(f.view.review, null);
  f.view.beginRemoval(""); assert.equal(f.view.review, null);
  reads[0]({ ...f.snapshot, document: { ...f.snapshot.document, version: "first" } }); await first;
  assert.equal(f.view.refreshing, true); f.view.beginRemoval(""); assert.equal(f.view.review, null);
  const latest = { ...f.snapshot, document: { ...f.snapshot.document, version: "latest" } };
  reads[1](latest); await second;
  assert.equal(f.view.refreshing, false); assert.equal(f.view.snapshot, latest); assert.equal(renders.at(-1), false);
  f.view.beginRemoval(""); assert.equal(f.view.review.snapshot, latest);
  f.view.provider.history.read = async () => { throw Error("History refresh unavailable"); };
  await f.view.refresh(); assert.equal(f.view.refreshing, false); assert.equal(f.view.snapshot, null);
  assert.equal(f.view.review, null); assert.match(f.view.error.textContent, /History refresh unavailable/);
});
