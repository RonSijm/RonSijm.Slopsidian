import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./host.mjs";

let directory, Workspace, history;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "workspace-history-tests-"));
  const output = join(directory, "history.cjs");
  await build({ stdin: { contents: 'export { Workspace } from "./client/workspace"; export * as history from "./client/workspace-history";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ Workspace, history } = createRequire(import.meta.url)(output));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/workspace-history-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

const note = (file, eState) => ({ type: "markdown", state: { file, mode: "source" }, ...(eState ? { eState } : {}) });

test("recording seeds the outgoing location, truncates forward entries, de-duplicates and caps the list", () => {
  const list = [];
  let index = history.recordNavigation(list, -1, { type: "markdown", state: { file: "a.md" }, eState: { scroll: 9 } }, { type: "markdown", state: { file: "b.md" } });
  assert.deepEqual(list.map(entry => entry.state.file), ["a.md", "b.md"]); assert.equal(index, 1); assert.equal(list[0].eState.scroll, 9);
  index = history.recordNavigation(list, 1, note("b.md", { scroll: 4 }), note("b.md"));
  assert.equal(list.length, 2); assert.equal(list[1].eState.scroll, 4);
  index = history.recordNavigation(list, 0, note("a.md"), note("c.md"));
  assert.deepEqual(list.map(entry => entry.state.file), ["a.md", "c.md"]); assert.equal(index, 1);
  const empty = []; assert.equal(history.recordNavigation(empty, -1, { type: "empty", state: {} }, note("x.md")), 0); assert.equal(empty.length, 1);
  const big = [];
  for (let i = 0; i < history.HISTORY_LIMIT + 10; i++) { index = history.recordNavigation(big, big.length - 1, note("n" + Math.max(0, i - 1) + ".md"), note("n" + i + ".md")); }
  assert.equal(big.length, history.HISTORY_LIMIT); assert.equal(index, history.HISTORY_LIMIT - 1); assert.equal(big.at(-1).state.file, "n" + (history.HISTORY_LIMIT + 9) + ".md");
});

test("stepping skips and reports unavailable entries and prunes with a coherent remapped index", () => {
  const list = [note("a.md"), note("gone.md"), note("also-gone.md"), note("d.md")];
  const step = history.stepHistory(list, 3, -1, entry => !entry.state.file.includes("gone"));
  assert.deepEqual(step, { target: 0, dropped: [2, 1] });
  const [index, target] = history.pruneEntries(list, step.dropped, 3, step.target);
  assert.deepEqual([index, target], [1, 0]); assert.deepEqual(list.map(entry => entry.state.file), ["a.md", "d.md"]);
  assert.equal(history.stepHistory(list, 0, -1, () => true).target, -1);
  assert.deepEqual(history.stepHistory([note("a.md"), note("gone.md")], 0, 1, () => false), { target: -1, dropped: [1] });
});

test("locations round-trip, clamp to the live document and reject malformed values", () => {
  const state = history.locationState([{ anchor: { line: 1, ch: 2 }, head: { line: 3, ch: 4 } }, { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 1 } }], 1, 123.4);
  assert.deepEqual(state.cursor, { from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 } }); assert.equal(state.scroll, 123);
  const lengths = [3, 5, 2];
  const read = history.readLocation(state, 3, line => lengths[line]);
  assert.equal(read.main, 1); assert.deepEqual(read.selections[0], { anchor: { line: 1, ch: 2 }, head: { line: 2, ch: 2 } });
  assert.equal(history.readLocation({ selections: [{ anchor: { line: "x" } }] }, 3, () => 1), null);
  assert.equal(history.readLocation({ scroll: -5 }, 3, () => 1), null);
  assert.deepEqual(history.readLocation({ cursor: { from: { line: 9, ch: 9 }, to: { line: 9, ch: 9 } } }, 2, () => 4).selections[0].head, { line: 1, ch: 4 });
  assert.equal(history.readLocation(state, 0, () => 0), null);
});

test("saved histories keep unknown keys, ignore malformed leaves and never carry control characters in view types", () => {
  const raw = { version: 1, future: { kept: true }, leaves: {
    a: { index: 1, keep: "leaf", entries: [note("a.md"), { ...note("b.md", { scroll: 3 }), extra: 5 }] },
    bad: { index: 4, entries: [note("a.md")] }, worse: { index: 0, entries: [{ type: "bad\u0001" }] }, nothing: "x",
  } };
  const parsed = history.parseHistory(raw);
  assert.deepEqual([...parsed.leaves.keys()], ["a"]); assert.equal(parsed.leaves.get("a").entries[1].extra, 5);
  const out = history.serializeHistory([{ id: "a", history: parsed.leaves.get("a").entries, historyIndex: 1 }, { id: "unused", history: [], historyIndex: -1 }], parsed);
  assert.deepEqual(out.future, { kept: true }); assert.equal(out.leaves.a.keep, "leaf"); assert.equal(out.leaves.a.entries[1].extra, 5); assert.equal(out.leaves.unused, undefined);
  assert.deepEqual(history.parseHistory(null).leaves.size, 0);
});

function fixture(files, entries, index, live) {
  const events = []; const workspace = Object.create(Workspace.prototype);
  let current = live ?? structuredClone(entries[index]);
  const leaf = { id: "leaf", history: entries, historyIndex: index, run: operation => operation(), updateHeader() {}, view: { getEphemeralState: () => ({ scroll: 77 }), setEphemeralState: state => events.push(["eState", state]) },
    getViewState: () => ({ type: current.type, state: structuredClone(current.state), pinned: false }) };
  Object.assign(workspace, { app: { changingVault: false, vault: { rootPath: "vault", getFileByPath: path => files.has(path) ? { path } : null } }, changingLayout: false, changingFiles: false, paneResize: null,
    extensions: new Map(), fileViewTypes: new Set(["markdown"]), savedHistory: { extras: {}, leaves: new Map() }, restoring: false, changingViews: 0,
    leaves: () => [leaf], requestSaveLayout: async () => { events.push("save"); }, track: value => value,
    applyLeafState: async (target, state) => { assert.equal(target, leaf); events.push(["apply", state.state.file]); current = structuredClone(state); } });
  return { workspace, leaf, events, current: () => current };
}

test("Back and Forward capture the outgoing location, restore the target location and persist the new index", async () => {
  const { workspace, leaf, events } = fixture(new Set(["a.md", "b.md"]), [note("a.md", { scroll: 5 }), note("b.md")], 1);
  await workspace.navigate(leaf, -1);
  assert.equal(leaf.historyIndex, 0); assert.deepEqual(leaf.history[1].eState, { scroll: 77 });
  assert.deepEqual(events, [["apply", "a.md"], ["eState", { scroll: 5 }], "save"]);
  assert.equal(workspace.canNavigate(leaf, 1), true); assert.equal(workspace.canNavigate(leaf, -1), false);
});

test("navigation refuses entries for deleted notes without overwriting the remaining history", async () => {
  const { workspace, leaf, events } = fixture(new Set(["a.md", "c.md"]), [note("a.md"), note("gone.md"), note("c.md")], 2);
  await workspace.navigate(leaf, -1);
  assert.deepEqual(leaf.history.map(entry => entry.state.file), ["a.md", "c.md"]); assert.equal(leaf.historyIndex, 0);
  assert.deepEqual(events[0], ["apply", "a.md"]);
  const stuck = fixture(new Set(["b.md"]), [note("gone.md"), note("b.md")], 1);
  await stuck.workspace.navigate(stuck.leaf, -1);
  assert.deepEqual(stuck.leaf.history.map(entry => entry.state.file), ["b.md"]); assert.equal(stuck.leaf.historyIndex, 0);
  assert.equal(stuck.events.some(event => Array.isArray(event)), false);
});

test("navigation is fenced by vault changes and leaves a failed target's history intact", async () => {
  const changing = fixture(new Set(["a.md", "b.md"]), [note("a.md"), note("b.md")], 1);
  changing.workspace.app.changingVault = true;
  await assert.rejects(changing.workspace.navigate(changing.leaf, -1), /changing vaults/);
  const failing = fixture(new Set(["a.md", "b.md"]), [note("a.md"), note("b.md")], 1);
  failing.workspace.applyLeafState = async () => { throw new Error("view failed"); };
  await assert.rejects(failing.workspace.navigate(failing.leaf, -1), /view failed/);
  assert.equal(failing.leaf.historyIndex, 1); assert.equal(failing.leaf.history.length, 2);
});

test("layout serialization refreshes the live location, restores matching records only and keeps saved unknown keys", () => {
  const { workspace, leaf } = fixture(new Set(["a.md", "b.md"]), [note("a.md"), note("b.md", { scroll: 1 })], 1);
  workspace.savedHistory = history.parseHistory({ future: 1, leaves: { leaf: { index: 0, keep: true, entries: [note("a.md")] } } });
  const saved = workspace.serializeHistories();
  assert.equal(saved.future, 1); assert.equal(saved.leaves.leaf.keep, true); assert.deepEqual(saved.leaves.leaf.entries[1].eState, { scroll: 77 });
  const hydrated = fixture(new Set(["a.md", "b.md"]), [], -1, note("b.md"));
  hydrated.workspace.savedHistory = history.parseHistory(saved);
  hydrated.workspace.hydrateHistories();
  assert.equal(hydrated.leaf.historyIndex, 1); assert.equal(hydrated.leaf.history.length, 2);
  assert.deepEqual(hydrated.events, [["eState", { scroll: 77 }]]);
  const mismatched = fixture(new Set(["a.md", "b.md"]), [], -1, note("a.md"));
  mismatched.workspace.savedHistory = history.parseHistory(saved);
  mismatched.workspace.hydrateHistories();
  assert.equal(mismatched.leaf.historyIndex, -1); assert.equal(mismatched.leaf.history.length, 0);
  const deleted = fixture(new Set(["b.md"]), [], -1, note("b.md"));
  deleted.workspace.savedHistory = history.parseHistory(saved);
  deleted.workspace.hydrateHistories();
  assert.deepEqual(deleted.leaf.history.map(entry => entry.state.file), ["b.md"]); assert.equal(deleted.leaf.historyIndex, 0);
});

test("a 64-selection location far into a document is retained whole and oversized ones shrink instead of vanishing", () => {
  const ranges = Array.from({ length: 70 }, (_, i) => ({ anchor: { line: 100000 + i, ch: 3 }, head: { line: 100000 + i, ch: 9 } }));
  const state = history.locationState(ranges, 63, 1234);
  assert.equal(state.selections.length, 64);
  const issues = [];
  const kept = history.captureEntry("markdown", { file: "a.md" }, state, message => issues.push(message));
  assert.deepEqual(kept.eState, state); assert.deepEqual(issues, []);
  const huge = { ...state, selections: state.selections.map(range => ({ anchor: { ...range.anchor, extra: "x".repeat(300) }, head: range.head })) };
  const reduced = history.captureEntry("markdown", { file: "a.md" }, huge, message => issues.push(message));
  assert.ok(reduced.eState && reduced.eState.scroll === 1234 && reduced.eState.selections.length >= 1 && reduced.eState.selections.length < 64);
  assert.equal(reduced.eState.main, 0); assert.equal(issues.length, 1);
});

test("refreshing an entry keeps unknown entry, state and location keys while replacing the owned fields", () => {
  const list = [{ type: "markdown", futureEntry: { keep: 1 }, state: { file: "a.md", mode: "source", futureState: [1] }, eState: { scroll: 1, selections: [], futureLocation: true } }];
  history.recordNavigation(list, 0, { type: "markdown", state: { file: "a.md", mode: "preview" }, eState: { scroll: 77 } }, { type: "markdown", state: { file: "b.md" } });
  assert.deepEqual(list[0], { type: "markdown", futureEntry: { keep: 1 }, state: { file: "a.md", mode: "preview", futureState: [1] }, eState: { futureLocation: true, scroll: 77 } });
  const same = [{ type: "markdown", futureEntry: "k", state: { file: "a.md", futureState: 2 } }];
  history.recordNavigation(same, 0, { type: "markdown", state: { file: "a.md" } }, { type: "markdown", state: { file: "a.md", mode: "source" } });
  assert.equal(same[0].futureEntry, "k"); assert.equal(same[0].state.futureState, 2); assert.equal(same[0].state.mode, "source");
  const refreshed = history.refreshEntry(list[0], { type: "markdown", state: { file: "a.md" }, eState: { scroll: 5 } });
  assert.equal(refreshed.futureEntry.keep, 1); assert.equal(refreshed.eState.scroll, 5); assert.equal(list[0].eState.scroll, 77);
});

test("malformed saved records are recovered individually and reported", () => {
  const issues = [];
  const parsed = history.parseHistory({ leaves: { bad: { entries: "x" }, range: { index: 9, entries: [note("a.md")] }, ctrl: { index: 0, entries: [{ type: "bad\u0001" }] }, ok: { index: 0, entries: [note("a.md")] } } }, message => issues.push(message));
  assert.deepEqual([...parsed.leaves.keys()], ["ok"]); assert.ok(issues.length >= 3);
});
