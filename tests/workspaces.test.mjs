import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let directory, importObsidianWorkspace, exportObsidianWorkspace, workspaceProfiles, workspaceName;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "workspaces-tests-"));
  const output = join(directory, "model.mjs");
  await build({ entryPoints: [join(root, "client", "workspace-import.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ importObsidianWorkspace, exportObsidianWorkspace, workspaceProfiles, workspaceName } = await import(pathToFileURL(output).href));
});
after(async () => { if (directory) { await rm(directory, { recursive: true }); } });

function fixture() {
  return {
    main: { id: "main", type: "split", direction: "vertical", futureSplit: [true], children: [
      { id: "tabs", type: "tabs", stacked: true, dimension: 62.5, children: [
        { id: "note", type: "leaf", pinned: true, group: "linked", futureLeaf: { value: 7 }, state: { type: "markdown", icon: "file", title: "Unicode λ", state: { file: "Folder/Unicode λ.md", mode: "source", source: false, futureView: ["kept"] } } },
        { id: "custom", type: "leaf", state: { type: "future-view", state: { file: "Unknown.bin", opaque: { retained: true } } } },
      ] },
    ] },
    left: { id: "left", type: "split", direction: "horizontal", width: 80, children: [] },
    right: { id: "right", type: "split", direction: "horizontal", width: 345, collapsed: true, children: [
      { id: "side-tabs", type: "tabs", currentTab: 0, children: [{ id: "side-note", type: "leaf", state: { type: "markdown", state: { file: "Folder/Unicode λ.md", mode: "preview" } } }] },
    ] },
    active: "note", mtime: "2026-10-21T12:00:00+02:00", "left-ribbon": { hiddenItems: { unknown: true } },
    floating: { type: "floating", windows: [{ opaque: true }] }, futureLayout: { keep: [0.25, null] },
  };
}

test("original named layouts round-trip all opaque fields, absent defaults, empty sides, pins and fitted widths without mutating input", () => {
  const original = fixture(), before = structuredClone(original);
  const result = importObsidianWorkspace(original);
  assert.equal(result.leaves, 3); assert.equal(result.layout.main.children[0].currentTab, 0);
  assert.equal(result.layout.main.children[0].children[0].state.pinned, true);
  assert.equal(result.layout.left.width, 160); assert.equal(result.layout.right.root.children[0].children[0].state.state.mode, "preview");
  assert.equal(result.warnings.length, 5);
  assert.equal(result.layout.main.children[0].children[0].state.state.source, false);
  assert.ok(result.warnings.every(warning => !warning.includes("Live Preview opens in Source")));
  assert.deepEqual(exportObsidianWorkspace(result.layout, result.original), original);
  assert.deepEqual(original, before);
});

test("round-trip overlays edited pane mode, pins, tab order and widths while preserving original unsupported data by stable ID", () => {
  const original = fixture(), { layout } = importObsidianWorkspace(original);
  const tabs = layout.main.children[0];
  tabs.children.reverse(); tabs.currentTab = 1;
  const note = tabs.children[1]; note.state.pinned = false; note.state.state.mode = "preview";
  layout.left.width = 200; layout.right.collapsed = false; layout.active = "custom";
  const output = exportObsidianWorkspace(layout, original);
  assert.deepEqual(output.main.children[0].children.map(node => node.id), ["custom", "note"]);
  assert.equal(output.main.children[0].children[1].pinned, false);
  assert.equal(output.main.children[0].children[1].state.state.mode, "preview");
  assert.deepEqual(output.main.children[0].children[1].futureLeaf, original.main.children[0].children[0].futureLeaf);
  assert.equal(output.main.children[0].dimension, 62.5); assert.equal(output.left.width, 200); assert.equal(output.right.collapsed, false);
  assert.deepEqual(output.floating, original.floating); assert.deepEqual(output["left-ribbon"], original["left-ribbon"]);
  assert.equal(output.active, "custom"); assert.equal("pinned" in output.main.children[0].children[1].state, false);
});

test("new profiles export original-shaped trees and changing a view type drops obsolete view-specific state", () => {
  const { layout } = importObsidianWorkspace(fixture());
  const node = layout.main.children[0].children[0]; node.state = { type: "empty", state: {}, pinned: false };
  const output = exportObsidianWorkspace(layout, fixture());
  assert.deepEqual(output.main.children[0].children[0].state, { type: "empty", state: {} });
  const fresh = exportObsidianWorkspace(layout);
  assert.equal(fresh.version, undefined); assert.equal(fresh.views, undefined);
  assert.equal(fresh.main.children[0].children[0].pinned, undefined);
  assert.equal(fresh.left.type, "split"); assert.deepEqual(fresh.left.children, []);
  assert.equal(new Set([fresh.main.id, fresh.left.id, fresh.right.id]).size, 3);
  assert.doesNotThrow(() => importObsidianWorkspace(fresh));
});

test("malformed or unsafe original layouts reject before import, including cross-tree duplicate IDs and invalid Markdown paths", () => {
  const cases = [
    value => { value.main.children[0].currentTab = 2; },
    value => { value.active = "missing"; },
    value => { value.left.id = "note"; },
    value => { value.right.children[0].id = "main"; },
    value => { value.main.children[0].children[0].pinned = "yes"; },
    value => { value.right.width = -1; },
    value => { value.main.children[0].children[0].state.state.file = "../Outside.md"; },
    value => { value.main.children[0].children[0].state.state.file = "C:/Outside.md"; },
    value => { value.main.children[0].children[0].state.state.mode = "html"; },
    value => { value.main.children[0].children[0].state.state.source = "false"; },
    value => { value.main.children[0].children[0].state.type = ""; },
    value => { value.main.children[0].children[0].children = []; },
    value => { value.main.children = [value.main.children[0].children[0]]; },
    value => { value.main.direction = "diagonal"; },
  ];
  for (const change of cases) { const value = fixture(); change(value); assert.throws(() => importObsidianWorkspace(value)); }
  assert.throws(() => importObsidianWorkspace([]));
  assert.throws(() => importObsidianWorkspace({}));
  const cycle = fixture(); cycle.futureLayout.self = cycle; assert.throws(() => importObsidianWorkspace(cycle), /cycles/);
});

test("workspace import bounds recursive trees and view JSON, and treats special profile names as own keys", () => {
  const tooDeep = fixture(); let container = tooDeep.main;
  for (let i = 0; i < 65; i++) { const next = { id: "split-" + i, type: "split", direction: "vertical", children: container.children }; container.children = [next]; container = next; }
  assert.throws(() => importObsidianWorkspace(tooDeep), /64 levels/);
  const tooMany = fixture(); tooMany.main.children[0].children = Array.from({ length: 4096 }, (_, i) => ({ id: "leaf-" + i, type: "leaf", state: { type: "empty", state: {} } })); tooMany.active = "leaf-0";
  assert.throws(() => importObsidianWorkspace(tooMany), /4,096/);
  let state = {}; for (let i = 0; i < 34; i++) { state = { state }; }
  const nested = fixture(); nested.main.children[0].children[0].state.state.deep = state;
  assert.throws(() => importObsidianWorkspace(nested), /32 levels/);
  assert.equal(workspaceName("  Review λ  "), "Review λ");
  for (const name of ["", "\n", "a\0b", "x".repeat(129)]) { assert.throws(() => workspaceName(name)); }
  for (const value of [[], null, true]) { assert.throws(() => workspaceProfiles({ workspaces: value })); }
  const special = JSON.parse('{"workspaces":{"__proto__":{"safe":true},"constructor":{"safe":true}}}');
  assert.equal(Object.hasOwn(workspaceProfiles(special), "__proto__"), true);
  assert.deepEqual(workspaceProfiles({}), {});
});
