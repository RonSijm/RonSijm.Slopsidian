import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./host.mjs";

// Observed capture: official Obsidian 1.12.7 (asar 2b2483b2…) run inside Windows Sandbox. See capture-result.json for provenance.
const FIXTURE_DIRECTORY = join(root, "tests", "fixtures", "original-obsidian-1.12.7");
const FIXTURE_SHA256 = "f082d04a790f104f195e849a59ba81e13547eb8a75875c3a09e81d1c4c02fdf9";
const WINDOWS = "workspace-windows";

let directory, imp, windows, startup, fixtureBytes, fixture;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "original-floating-import-tests-"));
  const output = join(directory, "bundle.cjs");
  await build({ stdin: { contents: 'export * as imp from "./client/workspace-import"; export * as windows from "./client/workspace-window"; export * as startup from "./client/workspace-startup";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ imp, windows, startup } = createRequire(import.meta.url)(output));
  fixtureBytes = await readFile(join(FIXTURE_DIRECTORY, "workspace.floating-open.json"));
  fixture = JSON.parse(fixtureBytes.toString("utf8"));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/original-floating-import-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

const fresh = () => structuredClone(fixture);
const floatingWindow = (id, tabsId, leafId, extra = {}) => ({
  id, type: "window", direction: "vertical", x: 10, y: 20, width: 640, height: 480, maximize: false, zoom: 0, ...extra,
  children: [{ id: tabsId, type: "tabs", children: [{ id: leafId, type: "leaf", state: { type: "markdown", state: { file: leafId + ".md", mode: "source", source: false } } }] }],
});
const withFloating = (...children) => { const value = fresh(); value.floating.children = children; value.active = "9feac20460dcfbe4"; return value; };

test("the retained original capture is the exact artifact-bound fixture", async () => {
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), FIXTURE_SHA256);
  assert.equal(fixtureBytes.length, 5797);
  const result = JSON.parse(await readFile(join(FIXTURE_DIRECTORY, "capture-result.json"), "utf8"));
  assert.equal(result.ok, true);
  assert.equal(result.floatingOpen.sha256, FIXTURE_SHA256);
  assert.equal(result.provenance.asarSha256, "2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712");
  assert.match(result.userAgent, /obsidian\/1\.12\.7 .*Electron\/39\.8\.3/);
  assert.equal(result.close.forced, false);
  assert.deepEqual(result.close.exit, { code: 0, signal: null });
});

test("the observed floating window imports into the independent popout model with its bounds and active leaf", () => {
  const original = fresh(), imported = imp.importObsidianWorkspace(original);
  assert.deepEqual(original, fixture, "import never mutates its input");
  assert.deepEqual(imported.original, fixture, "the complete original stays beside the layout");
  assert.ok(imported.warnings.every(message => !/Floating windows are retained/.test(message)), imported.warnings.join("|"));
  const view = imported.layout.views[WINDOWS];
  assert.equal(view.windows.length, 1);
  const [entry] = view.windows;
  assert.deepEqual(entry.bounds, { x: 160, y: 120, width: 723, height: 603 });
  assert.deepEqual({ maximize: entry.maximize, zoom: entry.zoom }, { maximize: false, zoom: 0 });
  assert.equal(entry.root.id, "c3acc59766f649ef");
  assert.equal(entry.root.type, "split");
  assert.equal(entry.root.direction, "vertical");
  const tabs = entry.root.children[0];
  assert.deepEqual({ id: tabs.id, type: tabs.type, currentTab: tabs.currentTab }, { id: "755f9d89e60a4507", type: "tabs", currentTab: 0 });
  assert.deepEqual(tabs.children[0], { id: "be5027423a6a2e59", type: "leaf", state: { type: "markdown", state: { file: "Popout note.md", mode: "source", source: false }, pinned: false } });
  assert.equal(view.active, "be5027423a6a2e59", "the original active leaf lives in the popout");
  assert.equal(imported.layout.active, "9feac20460dcfbe4", "the layout keeps a main-area active leaf for older readers");
  assert.equal(imported.leaves, 10);
  assert.equal(windows.parseWindows(view, windows.layoutIds(imported.layout.main)).windows.length, 1, "the model's own validator restores the saved entry");
});

test("export returns the original floating node deep-equal to the original and keeps unknown/opaque state", () => {
  const original = fresh(), { layout } = imp.importObsidianWorkspace(original);
  const exported = imp.exportObsidianWorkspace(layout, original);
  assert.deepEqual(exported, fixture);
  assert.equal(exported.floating.children[0].zoom, 0);
  assert.equal(exported.active, "be5027423a6a2e59");
});

test("startup preparation carries the converted window beside the startup metadata", () => {
  const prepared = startup.prepareOriginalWorkspace("C:/vault", { root: "C:/vault", id: "workspace", version: "v1", data: fresh() });
  assert.equal(prepared.source, "obsidian");
  assert.equal(prepared.layout.views[WINDOWS].windows.length, 1);
  assert.equal(prepared.layout.views[WINDOWS].active, "be5027423a6a2e59");
  assert.equal(prepared.layout.views["workspace-startup"].version, "v1");
  assert.deepEqual(prepared.layout.views["workspace-recent-files"], { paths: [] });
});

test("moving, closing and adding windows exports by stable id and never discards unknown fields", () => {
  const original = fresh();
  original.floating.children[0].futureWindow = { keep: [1] };
  const { layout } = imp.importObsidianWorkspace(original);
  const moved = structuredClone(layout);
  moved.views[WINDOWS].windows[0].bounds = { x: 5, y: 6, width: 700, height: 500 };
  moved.views[WINDOWS].windows[0].root.children[0].children[0].state.state.mode = "preview";
  moved.views[WINDOWS].windows.push({ root: { id: "newwin", type: "split", direction: "vertical", children: [{ id: "newtabs", type: "tabs", currentTab: 0, children: [{ id: "newleaf", type: "leaf", state: { type: "empty" } }] }] }, bounds: { x: 1, y: 2, width: 300, height: 300 } });
  const exported = imp.exportObsidianWorkspace(moved, original);
  const [first, second] = exported.floating.children;
  assert.deepEqual([first.x, first.y, first.width, first.height], [5, 6, 700, 500]);
  assert.deepEqual(first.futureWindow, { keep: [1] });
  assert.equal(first.children[0].children[0].state.state.mode, "preview");
  assert.equal(first.children[0].children[0].state.icon, "lucide-file", "opaque leaf fields survive");
  assert.deepEqual({ id: second.id, type: second.type, maximize: second.maximize, zoom: second.zoom, x: second.x, width: second.width }, { id: "newwin", type: "window", maximize: false, zoom: 0, x: 1, width: 300 });
  assert.equal(exported.floating.id, "5d9450d57d53229c");
  const closed = structuredClone(layout);
  delete closed.views[WINDOWS];
  assert.deepEqual(imp.exportObsidianWorkspace(closed, original).floating.children, [], "a window closed in the app is not resurrected from the template");
  assert.deepEqual(original.floating.children[0].futureWindow, { keep: [1] });
});

test("a profile without a floating container gains one only for real popouts", () => {
  const original = fresh(); delete original.floating;
  const { layout } = imp.importObsidianWorkspace({ ...original, active: "9feac20460dcfbe4" });
  assert.equal("floating" in imp.exportObsidianWorkspace(layout, original), false);
  layout.views = { [WINDOWS]: { windows: [{ root: { id: "w", type: "split", direction: "vertical", children: [{ id: "wt", type: "tabs", currentTab: 0, children: [{ id: "wl", type: "leaf", state: { type: "empty" } }] }] }, bounds: { x: 0, y: 0, width: 400, height: 300 } }], active: "wl" } };
  const exported = imp.exportObsidianWorkspace(layout, original);
  assert.equal(exported.floating.type, "floating");
  assert.equal(exported.floating.children[0].id, "w");
  assert.equal(exported.active, "wl");
});

// ---- Synthetic variants below are generated by this test, not observations of Obsidian. ----

test("synthetic: several windows with nested splits and tabs convert; a collision refuses only that window", () => {
  const nested = { id: "nw", type: "window", direction: "horizontal", x: 0, y: 0, width: 900, height: 700, maximize: false, zoom: 0, children: [
    { id: "ns", type: "split", direction: "vertical", dimension: 50, children: [{ id: "nt", type: "tabs", currentTab: 1, children: [
      { id: "l1", type: "leaf", state: { type: "markdown", state: { file: "a.md" } } }, { id: "l2", type: "leaf", state: { type: "markdown", state: { file: "b.md" } } }] }] },
    { id: "nt2", type: "tabs", dimension: 50, children: [{ id: "l3", type: "leaf", state: { type: "empty", state: {} } }] },
  ] };
  const collide = floatingWindow("cw", "9feac20460dcfbe4", "cl");
  const original = withFloating(floatingWindow("w1", "t1", "p1"), nested, collide);
  original.active = "l2";
  const imported = imp.importObsidianWorkspace(original);
  const view = imported.layout.views[WINDOWS];
  assert.deepEqual(view.windows.map(win => win.root.id), ["w1", "nw"]);
  assert.equal(view.windows[1].root.direction, "horizontal");
  assert.equal(view.windows[1].root.children[0].children[0].currentTab, 1);
  assert.equal(view.active, "l2");
  assert.ok(imported.warnings.some(message => /was not opened \(cw\): .*unique identifier/.test(message)), imported.warnings.join("|"));
  assert.equal(imported.leaves, 9 + 1 + 3, "the refused window's leaf is not counted");
  assert.deepEqual(imp.exportObsidianWorkspace(imported.layout, original), original, "the refused window stays verbatim in the export");
  const closedFirst = structuredClone(imported.layout); closedFirst.views[WINDOWS].windows.shift();
  assert.deepEqual(imp.exportObsidianWorkspace(closedFirst, original).floating.children.map(win => win.id), ["nw", "cw"]);
});

test("synthetic: malformed windows are refused individually and kept verbatim, never silently dropped", () => {
  const bad = [
    floatingWindow("m1", "mt1", "ml1", { x: "10" }),
    floatingWindow("m2", "mt2", "ml2", { direction: "diagonal" }),
    floatingWindow("m3", "mt3", "ml3", { maximize: "no" }),
    floatingWindow("m4", "mt4", "ml4", { zoom: "1" }),
    floatingWindow("m5", "mt5", "ml5", { root: {} }),
    floatingWindow("m6", "mt6", "ml6", { bounds: 1 }),
    { ...floatingWindow("m7", "mt7", "ml7"), children: [] },
    { ...floatingWindow("m8", "mt8", "ml8"), type: "popup" },
    { ...floatingWindow("m9", "mt9", "ml9"), children: [{ id: "bare", type: "leaf", state: { type: "empty" } }] },
    { ...floatingWindow("m10", "mt10", "ml10"), id: "bad id" },
    floatingWindow("w1", "t1", "p1"), floatingWindow("w1", "t2", "p2"),
  ];
  const original = withFloating(...bad);
  const input = structuredClone(original);
  const imported = imp.importObsidianWorkspace(original);
  assert.deepEqual(imported.layout.views[WINDOWS].windows.map(win => win.root.id), ["w1"]);
  assert.equal(imported.warnings.filter(message => /was not opened/.test(message)).length, bad.length - 1);
  assert.deepEqual(original, input);
  assert.deepEqual(imp.exportObsidianWorkspace(imported.layout, original), original);
  const only = imp.importObsidianWorkspace(withFloating(...bad.slice(0, 10)));
  assert.equal(only.layout.views?.[WINDOWS], undefined);
});

test("synthetic: unobserved floating shapes stay retained and unopened with an explicit warning", () => {
  for (const shape of [{ type: "floating", windows: [{ opaque: true }] }, { id: "f", type: "floating" }, { id: "f", type: "other", children: [] }, { id: "6cdcd19c4e790e94", type: "floating", children: [floatingWindow("w", "t", "l")] }, "text", []]) {
    const original = fresh(); original.floating = shape; original.active = "9feac20460dcfbe4";
    const imported = imp.importObsidianWorkspace(original);
    assert.equal(imported.layout.views?.[WINDOWS], undefined);
    assert.ok(imported.warnings.some(message => /Floating windows are retained for export and are not opened here/.test(message)));
    assert.deepEqual(imp.exportObsidianWorkspace(imported.layout, original).floating, shape);
  }
});

test("synthetic: out-of-range bounds, maximize and zoom open honestly and keep the original values", () => {
  const original = withFloating(floatingWindow("w1", "t1", "p1", { width: 10, height: 10, maximize: true, zoom: 2 }));
  const imported = imp.importObsidianWorkspace(original);
  const [entry] = imported.layout.views[WINDOWS].windows;
  assert.equal(entry.bounds, undefined);
  assert.deepEqual({ maximize: entry.maximize, zoom: entry.zoom }, { maximize: true, zoom: 2 });
  assert.ok(imported.warnings.some(message => /bounds are outside the supported range/.test(message)));
  assert.ok(imported.warnings.some(message => /maximized state is retained/.test(message)));
  assert.ok(imported.warnings.some(message => /zoom level is retained/.test(message)));
  assert.deepEqual(imp.exportObsidianWorkspace(imported.layout, original), original);
});

test("synthetic: the active item in a refused window falls back to main; unknown active ids refuse the import", () => {
  const original = withFloating(floatingWindow("w1", "t1", "p1", { x: null }));
  original.active = "p1";
  const imported = imp.importObsidianWorkspace(original);
  assert.equal(imported.layout.active, "9feac20460dcfbe4");
  assert.equal(imported.layout.views?.[WINDOWS], undefined);
  assert.ok(imported.warnings.some(message => /active item is in a floating window that was not opened/.test(message)));
  const stale = fresh(); stale.active = "does-not-exist";
  assert.throws(() => imp.importObsidianWorkspace(stale), /active workspace item/);
});

test("synthetic: reserved entry keys, window limits and group links stay honest", () => {
  const reserved = withFloating(floatingWindow("w1", "t1", "p1", { bounds: { x: 1 } }));
  assert.equal(imp.importObsidianWorkspace(reserved).layout.views?.[WINDOWS], undefined);
  const many = withFloating(...Array.from({ length: windows.MAX_POPOUTS + 2 }, (_, index) => floatingWindow("w" + index, "t" + index, "p" + index)));
  const imported = imp.importObsidianWorkspace(many);
  assert.equal(imported.layout.views[WINDOWS].windows.length, windows.MAX_POPOUTS);
  assert.equal(imported.warnings.filter(message => /Only 16 floating windows/.test(message)).length, 2);
  const linked = withFloating({ ...floatingWindow("w1", "t1", "p1") });
  linked.floating.children[0].children[0].children[0].group = "g1";
  assert.deepEqual(imp.importObsidianWorkspace(linked).layout.views["workspace-groups"], { links: { p1: "g1" } });
  const refusedLink = withFloating({ ...floatingWindow("w1", "t1", "p1", { x: "bad" }) });
  refusedLink.floating.children[0].children[0].children[0].group = "g1";
  assert.equal(imp.importObsidianWorkspace(refusedLink).layout.views?.["workspace-groups"], undefined, "a refused window leaves no dangling group link");
});

test("synthetic: duplicate ids convert and refuse by original position, so move/close never merge or drop the wrong entry", () => {
  const bad = (id, leaf) => ({ ...floatingWindow(id, "bt" + leaf, leaf), direction: "sideways" });
  const invalidFirst = withFloating(bad("w1", "badleaf"), floatingWindow("w1", "gt", "goodleaf"));
  const first = imp.importObsidianWorkspace(invalidFirst);
  assert.equal(first.layout.views[WINDOWS].windows.length, 1);
  assert.equal(first.layout.views[WINDOWS].windows[0].root.children[0].children[0].id, "goodleaf");
  assert.deepEqual(imp.exportObsidianWorkspace(first.layout, invalidFirst).floating, invalidFirst.floating, "untouched import round-trips with both same-id entries");
  const moved = structuredClone(first.layout);
  moved.views[WINDOWS].windows[0].bounds = { x: 1, y: 2, width: 333, height: 444 };
  let out = imp.exportObsidianWorkspace(moved, invalidFirst).floating.children;
  assert.deepEqual(out[0], invalidFirst.floating.children[0], "the refused first entry is never overwritten");
  assert.deepEqual([out[1].x, out[1].width, out[1].children[0].children[0].id], [1, 333, "goodleaf"]);
  const closed = structuredClone(first.layout); delete closed.views[WINDOWS];
  out = imp.exportObsidianWorkspace(closed, invalidFirst).floating.children;
  assert.deepEqual(out, [invalidFirst.floating.children[0]], "only the converted entry is dropped");

  const validFirst = withFloating(floatingWindow("w1", "t1", "l1"), floatingWindow("w1", "t2", "l2"));
  const second = imp.importObsidianWorkspace(validFirst);
  assert.equal(second.layout.views[WINDOWS].windows.length, 1);
  assert.match(second.warnings.join("\n"), /not opened \(w1\)/);
  assert.deepEqual(imp.exportObsidianWorkspace(second.layout, validFirst).floating, validFirst.floating);
  const closedSecond = structuredClone(second.layout); delete closedSecond.views[WINDOWS];
  out = imp.exportObsidianWorkspace(closedSecond, validFirst).floating.children;
  assert.deepEqual(out, [validFirst.floating.children[1]], "closing the converted window keeps the refused duplicate verbatim");
  const movedSecond = structuredClone(second.layout);
  movedSecond.views[WINDOWS].windows[0].bounds = { x: 9, y: 9, width: 400, height: 400 };
  out = imp.exportObsidianWorkspace(movedSecond, validFirst).floating.children;
  assert.deepEqual([out[0].x, out[0].width], [9, 400]);
  assert.deepEqual(out[1], validFirst.floating.children[1]);
  assert.equal(Object.keys(out[0]).includes("position"), false, "no private metadata leaks into the saved window");
  // A new popout may not reuse an id a retained refused window holds.
  const clash = structuredClone(second.layout);
  clash.views[WINDOWS].windows.push({ root: { id: "x", type: "split", direction: "vertical", children: [{ id: "xt", type: "tabs", currentTab: 0, children: [{ id: "l2", type: "leaf", state: { type: "empty" } }] }] }, bounds: { x: 0, y: 0, width: 300, height: 300 } });
  assert.throws(() => imp.exportObsidianWorkspace(clash, validFirst), /retained original floating window/);
});

test("synthetic: only a genuine leaf in a refused window may be active; container ids refuse", () => {
  const refused = { ...floatingWindow("rw", "rt", "rleaf"), direction: "sideways" };
  const base = withFloating(refused);
  assert.equal(imp.importObsidianWorkspace({ ...base, active: "rleaf" }).layout.active, "9feac20460dcfbe4");
  for (const id of ["rw", "rt", "5d9450d57d53229c", "nope"]) {
    assert.throws(() => imp.importObsidianWorkspace({ ...base, active: id }), /must identify an imported leaf/, id);
  }
  const unobserved = { ...fresh(), floating: { id: "oldfl", type: "floating", windows: [{ id: "ow", children: [{ id: "oleaf", type: "leaf", state: { type: "empty" } }] }] }, active: "ow" };
  assert.throws(() => imp.importObsidianWorkspace(unobserved), /must identify an imported leaf/);
});

test("synthetic: an unobserved floating shape plus open popouts refuses export instead of silently dropping them", () => {
  const original = { ...fresh(), floating: { id: "oldfl", type: "floating", windows: [{ marker: 1 }] }, active: "9feac20460dcfbe4" };
  const { layout } = imp.importObsidianWorkspace(original);
  assert.deepEqual(imp.exportObsidianWorkspace(layout, original).floating, original.floating, "retained verbatim without popouts");
  layout.views = { [WINDOWS]: { windows: [{ root: { id: "w", type: "split", direction: "vertical", children: [{ id: "wt", type: "tabs", currentTab: 0, children: [{ id: "wl", type: "leaf", state: { type: "empty" } }] }] }, bounds: { x: 0, y: 0, width: 400, height: 300 } }] } };
  assert.throws(() => imp.exportObsidianWorkspace(layout, original), /unrecognised shape/);
  const colliding = { ...fresh(), floating: { id: "6cdcd19c4e790e94", type: "floating", children: [] }, active: "9feac20460dcfbe4" };
  const imported = imp.importObsidianWorkspace(colliding);
  imported.layout.views = layout.views;
  assert.throws(() => imp.exportObsidianWorkspace(imported.layout, colliding), /collides/);
});