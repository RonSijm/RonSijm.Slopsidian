import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { writeFileSync, existsSync } from "node:fs";
import { checkWorkspaceOsTabDrag } from "../tools/workspace-os-tab-drag-scenario.mjs";
import { arrangeOwnedWindows as realArrange, assertArrangement, planWindowLayout, physicalMinima, prepareOwnedZOrder, restoreOwnedZOrder, MAIN_MIN, POPOUT_MIN } from "../tools/native-window-layout.mjs";
const dpi96 = async ({ titles }) => titles.map(title => ({ title, dpi: 96 }));
const arrangeOwnedWindows = (a, o) => realArrange(a, { diagnose: dpi96, ...o });

// A small model of the Workspace surface the scenario touches, evaluated through vm so the REAL page expressions run against it.
function fakeHost(directory) {
  const inner = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 };
  const mainWin = { ...inner };
  const mainDoc = { title: "orig", defaultView: mainWin, activeElement: null };
  const mainRoot = { id: "mroot", surface: null, doc: mainDoc, groups: [] };
  const windows = [];
  const leaves = new Map(), links = new Map();
  let counter = 0, focused = null, autosave = true, changing = false;
  const state = { drops: [], keys: [] };
  const docOf = root => root.doc;
  function makeLeaf(id, file, pinned) {
    const leaf = { id, pinned, file, parent: null, text: null, saved: null, undo: [], redo: [] };
    const cm = {
      state: { doc: { get length() { return leaf.text.length; }, toString: () => leaf.text } },
      dispatch(spec) { leaf.undo.push(leaf.text); leaf.redo = []; leaf.text += spec.changes.insert; },
      focus() { focused = leaf; },
      contentDOM: { get ownerDocument() { return { get activeElement() { return focused === leaf ? cm.contentDOM : null; } }; } },
    };
    leaf.view = { editor: { cm, getValue: () => leaf.text }, get isDirty() { return leaf.text !== leaf.saved; }, get hasUnsavedChanges() { return this.isDirty; } };
    leaf.getRoot = () => leaf.parent.root;
    leaf.tabHeaderEl = { isConnected: true, get ownerDocument() { return docOf(leaf.getRoot()); }, getBoundingClientRect: () => ({ left: 10, top: 5, width: 80, height: 30 }) };
    return leaf;
  }
  const mk = (root, id, children, currentTab = 0) => { const g = { id, root, children, currentTab, headerEl: null, getRoot: () => root }; g.headerEl = { get ownerDocument() { return docOf(root); }, getBoundingClientRect: () => ({ left: 100, top: 5, width: 300, height: 30 }) }; for (const c of children) { c.parent = g; } root.groups.push(g); return g; };
  const ws = {
    isChangingLayout: false, isChangingFiles: false, rootSplit: mainRoot, windows,
    whenIdle: async () => true,
    getLayout: () => ({ main: null }),
    async changeLayout(layout) {
      for (const root of [mainRoot, ...windows]) { root.groups = []; }
      windows.length = 0; leaves.clear(); links.clear();
      if (!layout.main) { return; }
      for (const node of layout.main.children) {
        const kids = node.children.map(entry => { const l = makeLeaf(entry.id, entry.state.state.file, Boolean(entry.state.pinned)); l.text = readTextSync(entry.state.state.file); l.saved = l.text; leaves.set(l.id, l); return l; });
        mk(mainRoot, node.id, kids, node.currentTab);
      }
    },
    getLeafById: id => leaves.get(id) ?? null,
    linkLeaves(list) { for (const l of list) { links.set(l.id, "grp-1"); } },
    getGroup: l => links.get(l.id) ?? null,
    groups: () => [mainRoot, ...windows].flatMap(root => root.groups),
    popoutLeaf(leaf) {
      const win = { id: "wroot" + (++counter), groups: [], doc: { title: "", defaultView: { ...inner } } };
      win.surface = { window: win.doc.defaultView, document: win.doc, isClosed: () => false };
      move(leaf, null, win);
      windows.push(win);
      state.targets.push({ id: "t" + counter, type: "page", url: "about:blank", ref: win });
      return win;
    },
    returnWindow(win) { for (const g of [...win.groups]) { for (const c of [...g.children]) { move(c, mainRoot.groups[0], mainRoot); } } windows.splice(windows.indexOf(win), 1); },
  };
  function readTextSync(file) { return state.files.get(file); }
  function move(leaf, group, root) {
    const old = leaf.parent;
    old.children.splice(old.children.indexOf(leaf), 1);
    old.currentTab = Math.min(old.currentTab, Math.max(0, old.children.length - 1));
    if (!old.children.length && old.root !== mainRoot) { old.root.groups.splice(old.root.groups.indexOf(old), 1); }
    const dest = group ?? mk(root, "g" + (++counter), []);
    dest.children.push(leaf); leaf.parent = dest; dest.currentTab = dest.children.length - 1;
  }
  state.files = new Map(); state.targets = [];
  const app = { workspace: ws, vault: { getAbstractFileByPath: p => (state.hideInventory || !existsSync(join(directory, p)) ? null : { path: p }) }, markdownAutosave: { get enabled() { return autosave; }, async setEnabled(v) { if (state.failAutosaveRestore && v === true) { throw new Error("autosave restore refused"); } autosave = v; } } };
  const context = vm.createContext({ app, window: mainWin, document: mainDoc, JSON, Boolean, Number });
  Object.defineProperty(mainWin, "document", { value: mainDoc });
  const evaluate = async expr => vm.runInContext(expr, context);
  const wait = async (expr, label) => { for (let i = 0; i < 6; i += 1) { if (await evaluate(expr)) { return; } } throw new Error("wait timed out: " + label); };
  const until = async (fn, label) => { for (let i = 0; i < 6; i += 1) { if (await fn()) { return; } } throw new Error("until timed out: " + label); };
  const keyHandler = async params => {
    if (params.type !== "keyUp") { return; }
    state.keys.push(params.code);
    const leaf = focused;
    if (params.code === "KeyZ") { leaf.redo.push(leaf.text); leaf.text = leaf.undo.pop(); }
    if (params.code === "KeyY") { leaf.undo.push(leaf.text); leaf.text = leaf.redo.pop(); }
    if (params.code === "KeyS") { leaf.saved = leaf.text; writeFileSync(join(directory, leaf.file), leaf.text); }
  };
  const command = async (name, params) => { if (name === "Input.dispatchKeyEvent") { await keyHandler(params); } };
  const connect = async target => ({
    command, socket: { close() { state.closed = (state.closed ?? 0) + 1; } },
    evaluate: async expr => { const m = /document\.title=("(?:[^"\\]|\\.)*")/.exec(expr); if (m) { target.ref.doc.title = JSON.parse(m[1]); } },
  });
  const targets = async () => state.targets;
  return { app, ws, mainRoot, windows, state, evaluate, wait, until, command, connect, targets, mainDoc,
    seed(files) { for (const [k, v] of Object.entries(files)) { state.files.set(k, v); } },
    titleOf: root => root.doc.title };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "osdrag-"));
  const host = fakeHost(directory);
  const { mkdir } = await import("node:fs/promises");
  const origWrite = host.state.files;
  // the scenario creates the files itself; mirror them into the model's reader
  const realFs = await import("node:fs");
  const read = realFs.readFileSync;
  host.state.files = { get: file => read(join(directory, file), "utf8") };
  return { directory, host };
}

function moveOnDrag(host) {
  return async ({ sourceTitle, targetTitle, pid }) => {
    const roots = [host.mainRoot, ...host.windows];
    const src = roots.filter(r => r.doc.title === sourceTitle), dst = roots.filter(r => r.doc.title === targetTitle);
    if (src.length !== 1 || dst.length !== 1) { throw new Error("ambiguous native window title"); }
    const leaf = host.ws.getLeafById("osd-drag");
    const group = dst[0].groups[0];
    leaf.parent.children.splice(leaf.parent.children.indexOf(leaf), 1);
    if (!leaf.parent.children.length && leaf.parent.root !== host.mainRoot) { leaf.parent.root.groups.splice(leaf.parent.root.groups.indexOf(leaf.parent), 1); }
    leaf.parent.currentTab = Math.min(leaf.parent.currentTab, Math.max(0, leaf.parent.children.length - 1));
    group.children.push(leaf); leaf.parent = group; group.currentTab = group.children.length - 1;
    host.state.drops.push({ pid, sourceTitle, targetTitle });
    return { dropped: true };
  };
}

const arrangeOk = async ({ pid, titles }) => { assert.equal(pid, 77); assert.equal(titles.length, 3); return { workArea: { x: 0, y: 0, width: 1900, height: 1000 }, placed: titles }; };

test("layout planner tiles inside the work area and refuses insufficient or malformed geometry", () => {
  const wa = { x: 0, y: 40, width: 1900, height: 1000 };
  const rects = planWindowLayout(wa, 3);
  assert.equal(rects.length, 3);
  assertArrangement(rects.map((rect, i) => ({ title: "w" + i, rect })), wa);
  assert.throws(() => planWindowLayout({ x: 0, y: 0, width: 700, height: 500 }, 3), /cannot fit/);
  assert.throws(() => planWindowLayout({ x: 0, y: 0, width: Infinity, height: 500 }, 3), /finite/);
  assert.throws(() => planWindowLayout(wa, 1), /two and four/);
  const grid = planWindowLayout({ x: 0, y: 0, width: 1100, height: 900 }, 3);
  assert.ok(grid.some(r => r.y > 0), "falls back to a grid when one row does not fit");
});

test("constrained layout honors main 940x650 and popout 320x240 minima", async () => {
  const mins = [MAIN_MIN, POPOUT_MIN, POPOUT_MIN];
  const fits = (rects, wa) => { rects.forEach((r, i) => { assert.ok(r.width >= mins[i].width && r.height >= mins[i].height, `window ${i} ${r.width}x${r.height} below its minimum`); }); assertArrangement(rects.map((rect, i) => ({ title: "w" + i, rect })), wa); };
  const wide = { x: 0, y: 0, width: 1920, height: 1000 };
  fits(planWindowLayout(wide, 3, { mins }), wide);
  const narrow = { x: 0, y: 0, width: 1400, height: 1000 };
  const stacked = planWindowLayout(narrow, 3, { mins });
  fits(stacked, narrow);
  assert.ok(stacked[0].x < stacked[1].x && stacked[1].x === stacked[2].x && stacked[2].y > stacked[1].y, "main left, popouts stacked right");
  assert.throws(() => planWindowLayout({ x: 0, y: 0, width: 1200, height: 1000 }, 3, { mins }), /cannot fit.*940x650/);
  assert.throws(() => planWindowLayout({ x: 0, y: 0, width: 1920, height: 600 }, 3, { mins }), /cannot fit/);
  const seen = [];
  await arrangeOwnedWindows({ pid: 5, titles: ["m", "p1", "p2"] }, { query: async () => narrow, place: async plan => { seen.push(plan); return plan.placements.map(p => ({ title: p.title, rect: p })); } });
  assert.ok(seen[0].placements[0].width >= 940 && seen[0].placements[0].height >= 650);
});

test("layout failures retain structured diagnostics and minima scale by measured DPI", async () => {
  const wa = { x: 0, y: 0, width: 3000, height: 1600 };
  const titles = ["m", "p1", "p2"];
  const before = [{ title: "m", dpi: 144 }, { title: "p1", dpi: 144 }, { title: "p2", dpi: 144 }];
  const overlapping = async plan => plan.placements.map((p, i) => ({ title: p.title, rect: { x: i * 100, y: 0, width: 500, height: 400 } }));
  const error = await arrangeOwnedWindows({ pid: 5, titles }, { query: async () => wa, place: overlapping, diagnose: async () => before }).then(() => null, e => e);
  assert.match(error.message, /overlap/);
  assert.equal(error.diagnostics.workArea.width, 3000);
  assert.equal(error.diagnostics.minima[0].width, 1410);
  assert.equal(error.diagnostics.minima[1].height, 360);
  assert.equal(error.diagnostics.requested.length, 3);
  assert.equal(error.diagnostics.placed.length, 3);
  assert.deepEqual(error.diagnostics.before, before);
  // 150% DPI makes main need 1410 physical px, so 1920x1000 at that scale is refused rather than shrunk
  const tight = await arrangeOwnedWindows({ pid: 5, titles }, { query: async () => ({ x: 0, y: 0, width: 1920, height: 1000 }), place: overlapping, diagnose: async () => before }).then(() => null, e => e);
  assert.match(tight.message, /cannot fit/);
  assert.ok(tight.diagnostics.minima && !tight.diagnostics.placed);
  const src = await readFile(new URL("../tools/native-window-layout.mjs", import.meta.url), "utf8");
  assert.match(src, /GetDpiForWindow/);
  assert.match(src, /DwmGetWindowAttribute/);
  assert.match(src, /op -eq 'diagnose'/);
});

test("missing, duplicate or invalid measured DPI refuses before placement with diagnostics", async () => {
  const titles = ["m", "p1", "p2"], wa = { x: 0, y: 0, width: 3000, height: 1600 };
  let placed = false;
  const place = async () => { placed = true; return []; };
  const cases = {
    "missing record": [{ title: "m", dpi: 96 }, { title: "p1", dpi: 96 }],
    "duplicate record": [{ title: "m", dpi: 96 }, { title: "m", dpi: 96 }, { title: "p1", dpi: 96 }, { title: "p2", dpi: 96 }],
    "zero dpi": [{ title: "m", dpi: 0 }, { title: "p1", dpi: 96 }, { title: "p2", dpi: 96 }],
    "non-finite dpi": [{ title: "m", dpi: 96 }, { title: "p1", dpi: Infinity }, { title: "p2", dpi: 96 }],
    "absent dpi": [{ title: "m", dpi: 96 }, { title: "p1" }, { title: "p2", dpi: 96 }],
  };
  for (const [name, before] of Object.entries(cases)) {
    const error = await realArrange({ pid: 5, titles }, { query: async () => wa, place, diagnose: async () => before }).then(() => null, e => e);
    assert.ok(error, name);
    assert.match(error.message, /measured/, name);
    assert.deepEqual(error.diagnostics.before, before, name);
  }
  assert.equal(placed, false);
  assert.throws(() => physicalMinima(["m"], null), /exactly one measured/);
  const injected = await realArrange({ pid: 5, titles }, { query: async () => wa, place: async plan => plan.placements.map(p => ({ title: p.title, rect: p })) }).then(() => null, e => e);
  assert.ok(injected, "no injected diagnose and no real windows must not guess 96");
  const src = await readFile(new URL("../tools/native-window-layout.mjs", import.meta.url), "utf8");
  assert.match(src, /GetWindowRect failed/);
});

test("z-order preparation raises only exact owned windows, records prior state and restores, including on failure", async () => {
  const titles = ["m", "p1", "p2"];
  // stateful fake of the Win32 side: tracks the real topmost flag of each window and can inject faults
  const make = (topmost = { m: false, p1: false, p2: true }, faults = {}) => {
    const state = { ...topmost }, ops = [];
    const hw = { m: 11, p1: 12, p2: 13 };
    const run1 = async plan => {
      ops.push(plan.op);
      if (faults.exec?.(plan, state)) { throw new Error(faults.message ?? "exec failed"); }
      if (plan.op === "zstate") { return plan.titles.map(t => ({ title: t, hwnd: hw[t], wasTopmost: state[t] })); }
      if (plan.op === "raise") {
        const out = [];
        for (const e of plan.entries) { if (!e.wasTopmost) { state[e.title] = true; } out.push({ title: e.title, hwnd: hw[e.title], wasTopmost: e.wasTopmost, nowTopmost: state[e.title] }); }
        return faults.malformed ? faults.malformed(out) : out;
      }
      const errors = [];
      const out = [];
      for (const e of plan.entries) {
        if (faults.restoreFail === e.title) { errors.push(`restore failed for '${e.title}'`); continue; }
        if (!e.wasTopmost) { state[e.title] = false; }
        out.push({ title: e.title, hwnd: hw[e.title], topmost: state[e.title] });
      }
      if (errors.length) { throw new Error(errors.join(" | ")); }
      return faults.restoreOut ? faults.restoreOut(out) : out;
    };
    return { state, ops, run1 };
  };
  let h = make();
  const prepared = await prepareOwnedZOrder({ pid: 5, titles }, h.run1);
  assert.deepEqual(h.state, { m: true, p1: true, p2: true });
  assert.deepEqual(h.ops, ["zstate", "raise"]);
  await restoreOwnedZOrder(prepared, h.run1);
  assert.deepEqual(h.state, { m: false, p1: false, p2: true }, "only windows we changed are restored; the pre-topmost one stays topmost");
  // malformed raise output after mutation: prior state captured first, rolled back, and exposed on the error
  for (const [name, malformed] of Object.entries({ missing: out => out.slice(1), duplicate: out => [out[0], out[0], out[2]], notTopmost: out => out.map(e => ({ ...e, nowTopmost: false })), badBool: out => out.map(e => ({ ...e, wasTopmost: "no" })) })) {
    h = make(undefined, { malformed });
    const error = await prepareOwnedZOrder({ pid: 5, titles }, h.run1).then(() => null, e => e);
    assert.ok(error, name);
    assert.deepEqual(h.state, { m: false, p1: false, p2: true }, `${name}: rolled back`);
    assert.ok(error.prepared?.entries.length === 3, `${name}: prior state preserved on the error`);
    assert.equal(h.ops.at(-1), "restoreZ");
  }
  // exec failure during raise after a partial mutation
  h = make(undefined, { exec: (plan, state) => { if (plan.op === "raise") { state.m = true; return true; } return false; } });
  await assert.rejects(prepareOwnedZOrder({ pid: 5, titles }, h.run1), /exec failed/);
  assert.equal(h.state.m, false, "partial mutation rolled back");
  // malformed state capture: no mutation attempted
  h = make(undefined);
  await assert.rejects(prepareOwnedZOrder({ pid: 5, titles }, async plan => { h.ops.push(plan.op); return [{ title: "m", hwnd: 1, wasTopmost: false }]; }), /state capture/);
  assert.deepEqual(h.ops, ["zstate"]);
  // rollback failure is aggregated, and every window is still attempted
  h = make(undefined, { malformed: out => out.slice(1), restoreFail: "m" });
  const both = await prepareOwnedZOrder({ pid: 5, titles }, h.run1).then(() => null, e => e);
  assert.ok(both instanceof AggregateError);
  assert.match(both.message, /rollback also failed.*restore failed for 'm'/);
  assert.equal(both.errors.length, 2);
  // restore verifies records and prior state
  const good = await prepareOwnedZOrder({ pid: 5, titles }, make().run1);
  for (const [name, restoreOut] of Object.entries({ count: out => out.slice(1), hwnd: out => out.map(e => ({ ...e, hwnd: 99 })), state: out => out.map(e => ({ ...e, topmost: true })) })) {
    await assert.rejects(restoreOwnedZOrder(good, make(undefined, { restoreOut }).run1), /restore|changed handle|not restored/, name);
  }
  await assert.rejects(restoreOwnedZOrder(good, make(undefined, { restoreFail: "p1" }).run1), /restore failed for 'p1'/);
  assert.deepEqual(await restoreOwnedZOrder(null, make().run1), []);

  // scenario: prepared once before any drag; restored in cleanup after success and after a drag failure; preparation failure is explicit
  for (const mode of ["ok", "dragFails", "prepareFails"]) {
    const { directory, host } = await setup();
    const events = [];
    const zorder = { prepare: async args => { events.push("prepare"); assert.equal(args.titles.length, 3); if (mode === "prepareFails") { throw new Error("cannot raise"); } return { pid: 77, entries: [{ title: "x", hwnd: 1, wasTopmost: false }] }; }, restore: async () => { events.push("restore"); return []; } };
    const dragFn = mode === "dragFails" ? async () => { events.push("drag"); throw new Error("refused"); } : async plan => { events.push("drag"); return moveOnDrag(host)(plan); };
    const report = { checks: [] };
    const error = await checkWorkspaceOsTabDrag({ directory, evaluate: host.evaluate, command: host.command, wait: host.wait, targets: host.targets, connect: host.connect, until: host.until, pid: 77, report,
      os: { drag: dragFn, arrange: arrangeOk, zorder } }).then(() => null, e => e);
    if (mode === "ok") { assert.equal(error, null); assert.deepEqual(events.filter(e => e !== "drag"), ["prepare", "restore"]); assert.ok(events.indexOf("prepare") < events.indexOf("drag")); }
    if (mode === "dragFails") { assert.match(error.message, /refused/); assert.deepEqual(events, ["prepare", "drag", "restore"]); }
    if (mode === "prepareFails") { assert.match(error.message, /cannot raise/); assert.deepEqual(events, ["prepare"]); }
  }
  const src = await readFile(new URL("../tools/native-window-layout.mjs", import.meta.url), "utf8");
  assert.match(src, /plan\.op -eq 'raise'/);
  assert.match(src, /Window '\$\(\$e\.title\)' changed handle/);
});

test("the arrangement is verified against the OS-reported rectangles", async () => {
  const wa = { x: 0, y: 0, width: 1900, height: 1000 };
  const good = async () => planWindowLayout(wa, 3).map((rect, i) => ({ title: "t" + i, rect, hwnd: i }));
  const out = await arrangeOwnedWindows({ pid: 5, titles: ["t0", "t1", "t2"] }, { query: async () => wa, place: good });
  assert.equal(out.placed.length, 3);
  const overlapping = async () => [{ title: "t0", rect: { x: 0, y: 0, width: 600, height: 500 } }, { title: "t1", rect: { x: 300, y: 0, width: 600, height: 500 } }, { title: "t2", rect: { x: 1000, y: 0, width: 600, height: 500 } }];
  await assert.rejects(arrangeOwnedWindows({ pid: 5, titles: ["t0", "t1", "t2"] }, { query: async () => wa, place: overlapping }), /overlap/);
  const outside = async () => [{ title: "t0", rect: { x: -50, y: 0, width: 600, height: 500 } }, { title: "t1", rect: { x: 700, y: 0, width: 600, height: 500 } }, { title: "t2", rect: { x: 1400, y: 0, width: 400, height: 500 } }];
  await assert.rejects(arrangeOwnedWindows({ pid: 5, titles: ["t0", "t1", "t2"] }, { query: async () => wa, place: outside }), /not inside/);
  await assert.rejects(arrangeOwnedWindows({ pid: 5, titles: ["t0", "t0", "t2"] }, { query: async () => wa, place: good }), /distinct/);
  await assert.rejects(arrangeOwnedWindows({ pid: 5, titles: ["t0", "t1", "t2"] }, { query: async () => ({ x: 0, y: 0, width: 600, height: 400 }), place: good }), /cannot fit/);
  await assert.rejects(arrangeOwnedWindows({ pid: 0, titles: ["a", "b"] }), /process id/);
});

test("the scenario runs main->popout1->popout2->main with identity, pin, link, siblings, real Undo/Redo/Save and full cleanup (mock driver is never OS-verified)", async () => {
  const { directory, host } = await setup();
  const report = { checks: [] };
  const result = await checkWorkspaceOsTabDrag({ directory, evaluate: host.evaluate, command: host.command, wait: host.wait, targets: host.targets, connect: host.connect, until: host.until, pid: 77, report,
    os: { drag: moveOnDrag(host), arrange: arrangeOk } });
  assert.equal(result.osDragVerified, false);
  assert.equal(report.osDragVerified, false);
  assert.equal(report.osDrag.mockDriver, true);
  assert.deepEqual(host.state.drops.map(d => d.pid), [77, 77, 77]);
  assert.equal(new Set(host.state.drops.flatMap(d => [d.sourceTitle, d.targetTitle])).size, 3);
  assert.deepEqual(host.state.keys, ["KeyZ", "KeyY", "KeyS"]);
  assert.equal(report.osDrag.hops.length, 3);
  assert.equal(report.osDrag.redoRestored, true);
  // cleanup: windows returned, autosave and title restored, vault folder removed, popup sessions closed
  assert.equal(host.windows.length, 0);
  assert.equal(host.app.markdownAutosave.enabled, true);
  assert.equal(host.mainDoc.title, "orig");
  assert.equal(host.state.closed, 2);
  assert.deepEqual((await readdir(directory)).filter(name => name.startsWith("OS drag")), []);
  assert.equal(report.osDragCleanupErrors, undefined);
});

test("insufficient work-area geometry fails before any drag and still cleans up", async () => {
  const { directory, host } = await setup();
  const report = { checks: [] };
  let dragged = false;
  await assert.rejects(checkWorkspaceOsTabDrag({ directory, evaluate: host.evaluate, command: host.command, wait: host.wait, targets: host.targets, connect: host.connect, until: host.until, pid: 77, report,
    os: { drag: async () => { dragged = true; return { dropped: true }; }, arrange: async () => planWindowLayout({ x: 0, y: 0, width: 500, height: 400 }, 3) } }), /cannot fit/);
  assert.equal(dragged, false);
  assert.equal(host.windows.length, 0);
  assert.equal(host.app.markdownAutosave.enabled, true);
  assert.equal(host.mainDoc.title, "orig");
});

test("a drag that breaks the link group or loses the selected sibling is reported and cleanup still runs", async () => {
  const { directory, host } = await setup();
  const base = moveOnDrag(host);
  const breaking = async plan => { const out = await base(plan); host.ws.linkLeaves([]); host.app.workspace.getGroup = () => "other"; return out; };
  const report = { checks: [] };
  await assert.rejects(checkWorkspaceOsTabDrag({ directory, evaluate: host.evaluate, command: host.command, wait: host.wait, targets: host.targets, connect: host.connect, until: host.until, pid: 77, report,
    os: { drag: breaking, arrange: arrangeOk } }), /link group/);
  assert.equal(host.windows.length, 0);
  assert.equal(host.app.markdownAutosave.enabled, true);
});

test("cleanup failures reject and aggregate with the scenario failure", async () => {
  const run = async (arrange) => {
    const { directory, host } = await setup();
    host.state.failAutosaveRestore = true;
    const report = { checks: [] };
    const error = await checkWorkspaceOsTabDrag({ directory, evaluate: host.evaluate, command: host.command, wait: host.wait, targets: host.targets, connect: host.connect, until: host.until, pid: 77, report,
      os: { drag: moveOnDrag(host), arrange } }).then(() => null, e => e);
    return { error, report };
  };
  const ok = await run(arrangeOk);
  assert.ok(ok.error, "a successful scenario must still reject when cleanup fails");
  assert.match(ok.error.message, /cleanup failed.*restore autosave/);
  assert.equal(ok.report.osDragCleanupErrors.length, 1);
  const both = await run(async () => { throw new Error("cannot fit three windows"); });
  assert.ok(both.error instanceof AggregateError);
  assert.match(both.error.message, /cannot fit.*cleanup failed/);
  assert.equal(both.error.errors.length, 2);
});

test("the scenario waits for the live vault inventory and fails boundedly without it", async () => {
  const { directory, host } = await setup();
  host.state.hideInventory = true;
  const report = { checks: [] };
  await assert.rejects(checkWorkspaceOsTabDrag({ directory, evaluate: host.evaluate, command: host.command, wait: host.wait, targets: host.targets, connect: host.connect, until: host.until, pid: 77, report,
    os: { drag: moveOnDrag(host), arrange: arrangeOk } }), /live vault inventory/);
  assert.equal(host.windows.length, 0);
});

test("ambiguous windows and invalid native DPI/rectangle measurements are fatal and not retried", async () => {
  for (const message of [
    "Ambiguous window match: 2 visible windows titled 'x' owned by process 77.",
    "Expected exactly one measured window record for 'x', found 0.",
    "The measured DPI for 'x' is not a positive finite number (0).",
    "GetWindowRect failed for window 123.",
  ]) {
    const { directory, host } = await setup();
    let calls = 0;
    const report = { checks: [] };
    await assert.rejects(checkWorkspaceOsTabDrag({ directory, evaluate: host.evaluate, command: host.command, wait: host.wait, targets: host.targets, connect: host.connect, until: host.until, pid: 77, report,
      os: { drag: moveOnDrag(host), arrange: async () => { calls += 1; throw new Error(message); } } }), error => error.message === message);
    assert.equal(calls, 1, message);
  }
  const layout = await readFile(new URL("../tools/native-window-layout.mjs", import.meta.url), "utf8");
  assert.match(layout, /Ambiguous window match/);
});

test("source contract: real driver by default, no DOM event dispatch, exact pid/title use", async () => {
  const src = await readFile(new URL("../tools/workspace-os-tab-drag-scenario.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /dispatchEvent|new DragEvent|DataTransfer/);
  assert.match(src, /os\.drag/);
  assert.match(src, /osDragVerified must reflect/);
  const layout = await readFile(new URL("../tools/native-window-layout.mjs", import.meta.url), "utf8");
  assert.match(layout, /Expected exactly one visible window titled/);
  assert.match(layout, /Two titles resolved to the same window/);
});
