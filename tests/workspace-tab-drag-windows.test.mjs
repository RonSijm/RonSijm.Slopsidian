import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./host.mjs";
import { assertTabDragResult, tabDragExpression } from "../tools/workspace-tab-drag-scenario.mjs";

let directory, Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceWindow, WorkspaceTabDrag;
const globals = ["window", "document", "crypto"], saved = {};

const fakeElement = () => new Proxy(function () {}, { get: (_target, key) => key === Symbol.toPrimitive ? () => "" : fakeElement(), apply: () => fakeElement(), set: () => true });

before(async () => {
  for (const key of globals) { saved[key] = Object.getOwnPropertyDescriptor(globalThis, key); }
  const fake = fakeElement();
  Object.defineProperty(globalThis, "window", { value: fake, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: fake, configurable: true, writable: true });
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "workspace-tab-drag-windows-tests-"));
  const output = join(directory, "bundle.cjs");
  await build({ stdin: { contents: 'export { Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceWindow } from "./client/workspace"; export { WorkspaceTabDrag } from "./client/workspace-tab-drag";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceWindow, WorkspaceTabDrag } = createRequire(import.meta.url)(output));
});
after(async () => {
  for (const key of globals) { if (saved[key]) { Object.defineProperty(globalThis, key, saved[key]); } else { delete globalThis[key]; } }
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/workspace-tab-drag-windows-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

function guardFixture() {
  const workspace = Object.create(Workspace.prototype);
  const mainRoot = {}, makeWindow = (live = true) => Object.assign(Object.create(WorkspaceWindow.prototype), { surface: { isClosed: () => !live }, releasing: false, closeRequested: false });
  const group = (rootNode, ...children) => { const node = Object.assign(Object.create(WorkspaceTabs.prototype), { workspace, children: [], getRoot: () => rootNode }); children.forEach(child => { child.parent = node; node.children.push(child); }); return node; };
  const leaf = (refusal = null) => Object.assign(Object.create(WorkspaceLeaf.prototype), { workspace, parent: null, view: { windowMoveRefusal: () => refusal }, getRoot() { return this.parent.getRoot(); } });
  const all = [];
  Object.assign(workspace, { app: { vault: { rootPath: "C:/vault" } }, restoring: false, changingLayout: false, changingFiles: false, changingViews: false, tasks: new Set(), paneResize: null, groups: () => all });
  return { workspace, mainRoot, makeWindow, group: (...args) => { const node = group(...args); all.push(node); return node; }, leaf };
}

test("canMoveLeaf allows live main<->popout and popout<->popout moves, but refuses closing/closed windows and views that cannot follow into a window", () => {
  const { workspace, mainRoot, makeWindow, group, leaf } = guardFixture();
  const a = makeWindow(), b = makeWindow(), x = leaf(), y = leaf(), z = leaf(), stuck = leaf("Wait for the clip.");
  const mainGroup = group(mainRoot, x, stuck), aGroup = group(a, y), bGroup = group(b, z);
  assert.equal(workspace.canMoveLeaf(x, aGroup, 0), true, "main -> popout");
  assert.equal(workspace.canMoveLeaf(y, mainGroup, 1), true, "popout -> main");
  assert.equal(workspace.canMoveLeaf(y, bGroup, 0), true, "popout -> popout");
  assert.equal(workspace.windowMoveBlocker(stuck, aGroup), "Wait for the clip.", "a view that refuses windows cannot enter one");
  assert.equal(workspace.canMoveLeaf(stuck, aGroup, 0), false);
  assert.equal(workspace.canMoveLeaf(stuck, mainGroup, 0), true, "moves that stay in one root never ask the view");
  b.releasing = true; assert.equal(workspace.canMoveLeaf(x, bGroup, 0), false, "a window the owner is releasing is not a target"); assert.equal(workspace.canMoveLeaf(z, mainGroup, 0), false, "nor a source");
  b.releasing = false; b.closeRequested = true; assert.equal(workspace.canMoveLeaf(x, bGroup, 0), false);
  b.closeRequested = false; b.surface = null; assert.equal(workspace.canMoveLeaf(x, bGroup, 0), false, "a detached window is not a target");
  const dead = makeWindow(false), deadGroup = group(dead, leaf()); assert.equal(workspace.canMoveLeaf(x, deadGroup, 0), false, "a closed surface is not a target");
  workspace.tasks.add(1); assert.equal(workspace.canMoveLeaf(x, aGroup, 0), false, "workspace transition guards still apply across windows");
});

function listeners() {
  const map = new Map();
  return {
    map, addEventListener: (type, callback) => { (map.get(type) ?? map.set(type, []).get(type)).push(callback); },
    fire(type, event) { for (const callback of map.get(type) ?? []) { callback(event); } },
  };
}

function dragFixture() {
  const calls = [], created = [];
  const makeWindow = name => {
    const win = { name, ...listeners(), requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
    win.document = { defaultView: win, body: { append: element => created.push([name, element]) }, createElement: () => ({ style: {}, dataset: {}, remove() { calls.push(["remove-preview", name]); }, get isConnected() { return false; } }) };
    return win;
  };
  const mainWin = makeWindow("main"), popWin = makeWindow("pop");
  Object.defineProperty(globalThis, "window", { value: mainWin, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: mainWin.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "token-1" }, configurable: true, writable: true });
  const rootSplit = {}, popRoot = {};
  const workspace = { rootSplit, app: { vault: { rootPath: "C:/vault" } }, on() {}, canMoveLeaf: () => true, canDockLeaf: () => false, rootDestination: () => null,
    moveLeaf: (leaf, group, index) => { calls.push(["move", leaf.id, group.id, index]); return true; }, dockLeaf: () => { throw new Error("must not dock in a popout"); }, moveLeafToRoot: () => true };
  const drag = new WorkspaceTabDrag(workspace);
  const node = doc => ({ ...listeners(), ownerDocument: doc, classList: { add() {}, remove() {} }, dataset: {}, setAttribute() {}, focus() {}, scrollIntoView() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), contains: () => false });
  const group = (id, doc, rootNode) => ({ id, children: [], headerEl: node(doc), containerEl: node(doc), getRoot: () => rootNode });
  const leaf = (id, parent, doc) => { const result = { id, parent, view: {}, tabHeaderEl: node(doc) }; parent.children.push(result); return result; };
  const foreignElement = { nodeType: 1, closest: () => null };
  const transfer = () => { const store = new Map(); return { types: [], effectAllowed: "", dropEffect: "", setData(type, value) { store.set(type, value); this.types.push(type); }, getData: type => store.get(type) }; };
  const event = (dataTransfer, extra = {}) => ({ dataTransfer, target: foreignElement, relatedTarget: null, clientX: 50, clientY: 50, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });
  return { calls, created, mainWin, popWin, workspace, drag, group, leaf, transfer, event, rootSplit, popRoot, foreignElement };
}

test("A tab dragged from a popout document is accepted, drops into a main group at the pointer position and moves the live leaf", () => {
  const f = dragFixture();
  const popGroup = f.group("pg", f.popWin.document, f.popRoot), mainGroup = f.group("mg", f.mainWin.document, f.rootSplit);
  const dragged = f.leaf("L", popGroup, f.popWin.document);
  f.drag.installLeaf(dragged); f.drag.installGroup(mainGroup); f.drag.installGroup(popGroup);
  const data = f.transfer(), start = f.event(data);
  dragged.tabHeaderEl.fire("dragstart", start);
  assert.equal(start.defaultPrevented, false, "a popout-document header may start a drag; the old document check is gone");
  assert.ok(data.types.length === 1);
  assert.ok(f.popWin.map.get("dragend")?.length, "the popout window ends the shared drag itself");
  const over = f.event(data); mainGroup.headerEl.fire("dragover", over);
  assert.equal(over.defaultPrevented, true);
  const drop = f.event(data); mainGroup.headerEl.fire("drop", drop);
  assert.deepEqual(f.calls.filter(call => call[0] === "move"), [["move", "L", "mg", 0]]);
});

test("A main tab dropped on a popout pane body is a realm-safe centre move whose preview is drawn in the popout document, never a dock", () => {
  const f = dragFixture();
  const popGroup = f.group("pg", f.popWin.document, f.popRoot), mainGroup = f.group("mg", f.mainWin.document, f.rootSplit);
  const dragged = f.leaf("M", mainGroup, f.mainWin.document);
  f.drag.installLeaf(dragged); f.drag.installGroup(popGroup);
  const data = f.transfer(); dragged.tabHeaderEl.fire("dragstart", f.event(data));
  popGroup.containerEl.fire("dragover", f.event(data));
  assert.equal(f.created.length, 1); assert.equal(f.created[0][0], "pop", "the drop preview lives in the target window's document");
  const drop = f.event(data); popGroup.containerEl.fire("drop", drop);
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(f.calls.filter(call => call[0] === "move"), [["move", "M", "pg", 0]]);
});

test("Popout to popout moves use the same shared drag, a stale token or refused guard drops nothing, and dragend in either window cancels", () => {
  const f = dragFixture();
  const second = { name: "pop2", ...listeners(), requestAnimationFrame: () => 1, cancelAnimationFrame() {} }; second.document = { defaultView: second, body: { append() {} }, createElement: () => ({ style: {}, dataset: {}, remove() {} }) };
  const aGroup = f.group("a", f.popWin.document, f.popRoot), bGroup = f.group("b", second.document, {});
  const dragged = f.leaf("P", aGroup, f.popWin.document);
  f.drag.installLeaf(dragged); f.drag.installGroup(bGroup);
  const data = f.transfer(); dragged.tabHeaderEl.fire("dragstart", f.event(data));
  bGroup.headerEl.fire("drop", f.event({ ...data, getData: () => "forged" }));
  assert.deepEqual(f.calls.filter(call => call[0] === "move"), [], "a drop whose token does not match the live source moves nothing");
  const again = f.transfer(); dragged.tabHeaderEl.fire("dragstart", f.event(again));
  f.workspace.canMoveLeaf = () => false;
  const refused = f.event(again); bGroup.headerEl.fire("dragover", refused);
  assert.equal(refused.defaultPrevented, false, "a refused window/transition guard is not a drop target");
  f.workspace.canMoveLeaf = () => true;
  f.popWin.fire("dragend", {});
  bGroup.headerEl.fire("drop", f.event(again));
  assert.deepEqual(f.calls.filter(call => call[0] === "move"), [], "dragend in the source window cancels the drag");
  const third = f.transfer(); dragged.tabHeaderEl.fire("dragstart", f.event(third));
  bGroup.headerEl.fire("drop", f.event(third));
  assert.deepEqual(f.calls.filter(call => call[0] === "move"), [["move", "P", "b", 0]]);
});

test("The real-host tab-drag helper compiles to a primitive-returning expression and rejects partial, recreated or non-moving results without claiming an OS drag", () => {
  assert.doesNotThrow(() => new Function(`return ${tabDragExpression({ leafId: "a", groupId: "g" })}`));
  assert.match(tabDragExpression({ leafId: "a\"b", groupId: "g" }), /"a\\"b"/);
  const good = { started: true, accepted: true, rootBefore: "main", rootAfter: "w1", parentIsTarget: true, sameLeaf: true, sameView: true, sameEditorView: true, pinned: true, dirty: true, headerConnected: true, headerInTargetDocument: true };
  const result = assertTabDragResult(JSON.stringify(good), { expectRoot: "w1" });
  assert.equal(result.osDragVerified, false);
  for (const patch of [{ sameEditorView: false }, { sameLeaf: false }, { dirty: false }, { accepted: false }, { rootAfter: "w2" }, { rootBefore: "w1" }, { headerInTargetDocument: false }]) {
    assert.throws(() => assertTabDragResult({ ...good, ...patch }, { expectRoot: "w1" }), /failed/);
  }
  assert.throws(() => assertTabDragResult({ error: "leaf or group not found" }, { expectRoot: "w1" }), /not found/);
});