import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./host.mjs";

let directory, Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, MarkdownView, FileView, TFile, Vault, RecentFiles;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "workspace-tabs-tests-"));
  const output = join(directory, "workspace.cjs");
  await build({ stdin: { contents: 'export { Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, MarkdownView } from "./client/workspace"; export { FileView } from "./client/views"; export { TFile, Vault } from "./client/vault"; export { RecentFiles } from "./client/recent-files";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, MarkdownView, FileView, TFile, Vault, RecentFiles } = createRequire(import.meta.url)(output));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/workspace-tabs-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

function fixture(groups = [["a", "b", "c"], ["d", "e"]]) {
  const workspace = Object.create(Workspace.prototype), events = [];
  Object.assign(workspace, { app: { changingVault: false, vault: { rootPath: "test-vault", getAbstractFileByPath: () => null }, saveAll: () => { throw Error("Moving tabs must not save notes"); } },
    restoring: false, changingViews: 0, changingLayout: false, changingFiles: false, tasks: new Set(), recentLeaves: [], lastFile: null, lastNotifiedFile: null });
  const split = parent => Object.assign(Object.create(WorkspaceSplit.prototype), { workspace, parent, children: [] });
  workspace.rootSplit = split(null); workspace.leftSplit = split(null); workspace.rightSplit = split(null);
  workspace.render = () => events.push("render"); workspace.notifyEditor = () => {};
  workspace.trigger = event => events.push(event); workspace.layoutChanged = () => events.push("layout-change");
  const tabs = groups.map(ids => {
    const parent = Object.assign(Object.create(WorkspaceTabs.prototype), { workspace, parent: workspace.rootSplit, children: [], currentTab: 0, render() {}, select() {} });
    parent.children.push(...ids.map(id => Object.assign(Object.create(WorkspaceLeaf.prototype), { workspace, parent, id, pinned: id === "b", history: [{ type: "markdown", state: { file: id + ".md" } }], historyIndex: 0,
      view: { owner: id, editor: { dirty: true }, onClose: () => { throw Error("Moving must not close a view"); } } })));
    return parent;
  });
  workspace.rootSplit.children.push(...tabs); workspace.activeLeaf = tabs[0].children[0];
  return { workspace, tabs, events, split };
}
const ids = group => group.children.map(leaf => leaf.id);

test("recent files follow departed active files rather than initial loading or background tabs, and stay vault-owned", async () => {
  const { workspace } = fixture(), vault = new Vault(async () => {});
  vault.setSnapshot({ root: "test-vault", name: "Test", files: ["First.md", "Second.md", "Third.md"].map(path => ({
    path, name: path, basename: path.slice(0, -3), extension: "md", stat: { ctime: 1, mtime: 1, size: 0 },
  })) });
  Object.assign(workspace, { recentFiles: new RecentFiles(), recentFilesRoot: "test-vault", layoutReady: true, restorationFailed: false });
  workspace.app.vault = vault;
  const saved = [];
  workspace.requestSaveLayout = async () => { saved.push(workspace.recentFiles.serialize()); };
  const open = path => {
    workspace.activeLeaf.view = Object.assign(Object.create(FileView.prototype), { navigation: true, file: vault.getFileByPath(path) });
    workspace.notifyActiveFile();
  };
  open("First.md"); assert.deepEqual(workspace.getRecentFiles(), []);
  open("Second.md"); open("Third.md"); open("First.md");
  assert.deepEqual(workspace.getRecentFiles(), ["Third.md", "Second.md", "First.md"]);
  workspace.addRecentFile(vault.getFileByPath("Second.md"));
  assert.deepEqual(workspace.getLastOpenFiles(), ["Second.md", "Third.md", "First.md"]);
  assert.throws(() => workspace.addRecentFile(new TFile({}, { path: "Second.md", stat: {} })), /live file/);
  workspace.app.changingVault = true;
  assert.deepEqual(workspace.getRecentFiles(), []);
  assert.throws(() => workspace.addRecentFile(vault.getFileByPath("First.md")), /finish loading/);
  workspace.app.changingVault = false;
  workspace.recentFilesRoot = "other-vault";
  assert.deepEqual(workspace.getLastOpenFiles(), []);
  await Promise.resolve();
  assert.equal(saved.length, 4);
});

test("recent-file restoration, rename and typed limits preserve meaningful history without leaking mutable storage", () => {
  const recent = new RecentFiles();
  const extensionless = ["md", "canvas", "base", "png", ".md"];
  recent.load(["Work/First.md", "image.png", "board.canvas", "table.base", "sound.mp3", ...extensionless, "Work/First.md"]);
  assert.deepEqual(recent.getRecentFiles(), ["Work/First.md", "board.canvas", "table.base"]);
  assert.deepEqual(recent.getRecentFiles({ showImages: true, maxCount: 2 }), ["Work/First.md", "image.png"]);
  assert.deepEqual(recent.getRecentFiles({ showMarkdown: false, showNonAttachments: false, showNonImageAttachments: true }), ["sound.mp3", ...extensionless]);
  recent.rename("Work", "Moved");
  const saved = recent.serialize(), reloaded = new RecentFiles();
  reloaded.load(saved); saved[0] = "Replacement.md";
  assert.deepEqual(reloaded.getRecentFiles(), ["Moved/First.md", "board.canvas", "table.base"]);
  for (const options of [null, [], { showImages: 1 }, { maxCount: -1 }, { maxCount: 1.5 }]) { assert.throws(() => recent.getRecentFiles(options), /options|limit/); }
  const before = recent.serialize();
  for (const value of [null, {}, [1], ["../Other.md"], ["/absolute.md"], ["Work\\Other.md"]]) {
    assert.throws(() => recent.load(value), /vault-relative/);
    assert.deepEqual(recent.serialize(), before);
  }
  assert.deepEqual(recent.getRecentFiles({ maxCount: 0 }), []);
  for (let index = 0; index < 32; index++) { recent.collect(`Note ${index}.md`); }
  assert.equal(recent.getRecentFiles({ showNonAttachments: false, maxCount: 512 }).length, 26);
  for (let index = 0; index < 14; index++) { recent.collect(`Canvas ${index}.canvas`); }
  assert.equal(recent.serialize().filter(path => path.endsWith(".canvas")).length, 11);
  assert.equal(recent.getRecentFiles({ showNonAttachments: false, maxCount: 512 }).length, 25);
});

test("opening a file respects a real FileView provider accepting that extension", async () => {
  const { workspace } = fixture(), leaf = workspace.activeLeaf, file = { vault: workspace.app.vault, path: "Note.md", extension: "md" }, opened = [];
  workspace.app.vault.getAbstractFileByPath = () => file; workspace.viewTypeForExtension = () => "markdown";
  leaf.view = Object.assign(Object.create(FileView.prototype), { navigation: false, getViewType: () => "footnotes", canAcceptExtension: extension => extension === "md" });
  leaf.setViewState = async state => { opened.push(state); };
  await workspace.openInLeaf(leaf, file, false);
  assert.deepEqual(opened, [{ type: "footnotes", state: { file: "Note.md" }, active: false }]);
  leaf.view.canAcceptExtension = () => false; await workspace.openInLeaf(leaf, file);
  assert.equal(opened[1].type, "markdown");
});
test("file opening keeps existing Markdown mode behavior and refuses foreign files before provider selection", async () => {
  const { workspace } = fixture(), leaf = workspace.activeLeaf, file = { vault: workspace.app.vault, path: "Other.md", extension: "md" }, opened = [];
  workspace.app.vault.getAbstractFileByPath = () => file; workspace.viewTypeForExtension = () => "markdown";
  leaf.view = Object.assign(Object.create(MarkdownView.prototype), { leaf, getMode: () => "preview" }); Object.defineProperty(leaf.view, "isSourceMode", { value: false });
  leaf.setViewState = async state => { opened.push(state); }; await workspace.openInLeaf(leaf, file);
  assert.deepEqual(opened[0], { type: "markdown", state: { file: "Other.md", mode: "preview", source: false }, active: true });
  await assert.rejects(workspace.openInLeaf(leaf, { ...file, vault: {} }), /current vault/); assert.equal(opened.length, 1);
});

test("non-navigating FileViews retain the most recent note instead of becoming their own follow target", () => {
  const { workspace, tabs } = fixture(), note = tabs[0].children[0], pane = tabs[1].children[0];
  const file = Object.assign(Object.create(TFile.prototype), { path: "Note.md" }), other = Object.assign(Object.create(TFile.prototype), { path: "Other.md" });
  note.view = Object.assign(Object.create(FileView.prototype), { navigation: true, file });
  pane.view = Object.assign(Object.create(FileView.prototype), { navigation: false, file: other });
  workspace.app.vault.getAbstractFileByPath = path => path === file.path ? file : other;
  workspace.setActiveLeaf(note, { focus: false }); workspace.setActiveLeaf(pane, { focus: false });
  assert.equal(workspace.getActiveFileView(), note.view); assert.equal(workspace.getActiveFile(), file); assert.equal(workspace.lastFile, file.path);
  pane.view.file = file; workspace.setActiveLeaf(note, { focus: false }); note.view.file = other;
  assert.equal(workspace.getActiveFileView(), note.view); assert.equal(workspace.getActiveFile(), other);
});

test("active-file fallback ignores detached and non-navigating leaves without skipping a navigable non-file view", () => {
  const { workspace, tabs } = fixture(), pane = workspace.activeLeaf, note = tabs[1].children[0], detached = tabs[0].children[1];
  pane.view.navigation = false;
  note.view = Object.assign(Object.create(FileView.prototype), { navigation: true, file: {} });
  detached.view = Object.assign(Object.create(FileView.prototype), { navigation: true, file: {} });
  tabs[0].children.splice(1, 1); workspace.recentLeaves.push(note, detached, pane);
  assert.equal(workspace.getActiveFileView(), note.view);
  const empty = tabs[1].children[1]; empty.view.navigation = true; workspace.recentLeaves.push(empty);
  assert.equal(workspace.getActiveFileView(), null, "A newer navigable non-file view must not reveal an older FileView.");
  workspace.activeLeaf = empty; assert.equal(workspace.getActiveFileView(), null);
});

test("active embedded editor overrides retain their real owner and release only for that owner or a leaf change", () => {
  const { workspace, tabs } = fixture();
  const markdown = Object.assign(Object.create(MarkdownView.prototype), { file: {}, editor: {}, getMode: () => "source" });
  workspace.activeLeaf.view = markdown;
  const owner = { app: workspace.app, file: {}, editor: { cm: { dom: { isConnected: true } } } }, other = { ...owner };
  assert.equal(workspace.activeEditor, markdown);
  workspace.activeEditor = owner;
  assert.equal(workspace.activeEditor, owner);
  workspace.activeEditor = markdown;
  workspace.unsetActiveEditor(other);
  assert.equal(workspace.activeEditor, owner, "A different editor owner must not clear the active embedded editor.");
  workspace.unsetActiveEditor(owner);
  assert.equal(workspace.activeEditor, markdown);
  workspace.activeEditor = owner;
  workspace.setActiveLeaf(tabs[1].children[0], { focus: false });
  assert.equal(workspace.activeEditor, null, "Activating another leaf must not retain an editor from the previous view.");
});

test("a detached or fileless embedded owner cannot outlive a reused leaf's view", () => {
  const { workspace } = fixture();
  const markdown = Object.assign(Object.create(MarkdownView.prototype), { file: {}, editor: {}, getMode: () => "source" });
  workspace.activeLeaf.view = markdown;
  for (const reason of ["detached", "fileless"]) {
    const owner = { app: workspace.app, file: {}, editor: { cm: { dom: { isConnected: true } } } };
    workspace.activeEditor = owner;
    assert.equal(workspace.activeEditor, owner);
    if (reason === "detached") { owner.editor.cm.dom.isConnected = false; } else { owner.file = null; }
    assert.equal(workspace.activeEditor, markdown, "Late embedded cleanup must reveal the real current editor instead of passing an obsolete owner to commands.");
    workspace.activeEditor = owner;
    assert.equal(workspace.activeEditor, markdown, "A delayed plugin focus callback must not reinstall an obsolete owner.");
  }
  workspace.activeLeaf.view = {};
  workspace.activeEditor = { app: workspace.app, file: null, editor: { cm: { dom: { isConnected: true } } } };
  assert.equal(workspace.activeEditor, null);
});

test("pane resizing changes only adjacent proportions and retains active views, buffers, history and pins", () => {
  const { workspace, tabs, events } = fixture([["a", "b"], ["c"], ["d"]]);
  tabs.forEach((tab, index) => { tab.dimension = [20, 30, 50][index]; });
  const active = workspace.activeLeaf, view = active.view, history = active.history;
  assert.equal(workspace.resizeSplit(workspace.rootSplit, 0, .8), true);
  assert.deepEqual(tabs.map(tab => tab.dimension), [40, 10, 50]);
  assert.equal(workspace.activeLeaf, active); assert.equal(active.view, view); assert.equal(active.history, history);
  assert.equal(active.view.editor.dirty, true); assert.equal(tabs[0].children[1].pinned, true);
  assert.deepEqual(events, ["resize", "layout-change"]);
  assert.equal(workspace.resizeSplit(workspace.rootSplit, 0, .8), false);
  assert.deepEqual(events, ["resize", "layout-change"]);
});

test("resizing rejects detached, foreign, sidedock and malformed requests without changing dimensions", () => {
  const { workspace, tabs, events, split } = fixture(), other = fixture(), detached = split(null);
  detached.children.push(...tabs);
  for (const [parent, index, fraction] of [[other.workspace.rootSplit, 0, .5], [workspace.leftSplit, 0, .5], [detached, 0, .5], [workspace.rootSplit, -1, .5], [workspace.rootSplit, .5, .5], [workspace.rootSplit, 1, .5], [workspace.rootSplit, 0, 0], [workspace.rootSplit, 0, NaN]]) {
    assert.throws(() => workspace.resizeSplit(parent, index, fraction));
  }
  assert.deepEqual(tabs.map(tab => tab.dimension), [undefined, undefined]); assert.deepEqual(events, []);
});

test("a resize constrained to its existing visible position does not overwrite stored proportions", () => {
  const { workspace, tabs, events } = fixture(); tabs[0].dimension = 10; tabs[1].dimension = 90;
  workspace.paneResize = { dimensions: () => [50, 50], cancel() {}, update() { throw new Error("An unchanged boundary must not update panes"); } };
  assert.equal(workspace.resizeSplit(workspace.rootSplit, 0, .5), false);
  assert.deepEqual(tabs.map(tab => tab.dimension), [10, 90]); assert.deepEqual(events, []);
});

test("vault, file, view and layout transitions gate resizing while read-only content still permits local layout changes", () => {
  for (const state of ["restoring", "changingLayout", "changingFiles", "changingViews", "tasks", "changingVault", "root"]) {
    const { workspace, tabs, events } = fixture();
    if (state === "tasks") workspace.tasks.add(Promise.resolve());
    else if (state === "changingVault") workspace.app.changingVault = true;
    else if (state === "root") workspace.app.vault.rootPath = null;
    else workspace[state] = state === "changingViews" ? 1 : true;
    assert.equal(workspace.canResizeSplit(workspace.rootSplit, 0), false, state);
    assert.throws(() => workspace.resizeSplit(workspace.rootSplit, 0, .6));
    assert.deepEqual(tabs.map(tab => tab.dimension), [undefined, undefined]); assert.deepEqual(events, []);
  }
  const { workspace, tabs } = fixture(); workspace.app.vault.readOnly = true;
  assert.equal(workspace.resizeSplit(workspace.rootSplit, 0, .7), true);
  assert.deepEqual(tabs.map(tab => tab.dimension), [70, 30]);
});

test("compacting a removed nested pane retains its wrapper's proportion in the outer split", () => {
  const { workspace, tabs, split } = fixture([["a"], ["b"], ["c"]]);
  const nested = split(workspace.rootSplit); nested.dimension = 65;
  workspace.rootSplit.children.splice(0, 2, nested); nested.children.push(tabs[0], tabs[1]);
  tabs[0].parent = nested; tabs[1].parent = nested; tabs[0].dimension = 40; tabs[1].dimension = 60; tabs[2].dimension = 35;
  workspace.moveLeaf(tabs[0].children[0], tabs[2], 1);
  assert.deepEqual(workspace.rootSplit.children, [tabs[1], tabs[2]]);
  assert.equal(tabs[1].dimension, 65); assert.equal(tabs[2].dimension, 35);
});

test("tab insertion gaps reorder in both directions without replacing a live view, history or pin", () => {
  const { workspace, tabs, events } = fixture(), leaf = tabs[0].children[1], view = leaf.view, history = leaf.history;
  assert.equal(workspace.moveLeaf(leaf, tabs[0], 3), true);
  assert.deepEqual(ids(tabs[0]), ["a", "c", "b"]); assert.equal(tabs[0].currentTab, 2);
  assert.equal(workspace.activeLeaf, leaf); assert.equal(leaf.view, view); assert.equal(leaf.history, history); assert.equal(leaf.pinned, true);
  assert.equal(workspace.moveLeaf(leaf, tabs[0], 0), true); assert.deepEqual(ids(tabs[0]), ["b", "a", "c"]);
  assert.equal(events.filter(event => event === "layout-change").length, 2);
});

test("moving a background tab across panes retains the source's selected sibling and selects the existing destination leaf", () => {
  const { workspace, tabs } = fixture(); tabs[0].currentTab = 2; workspace.activeLeaf = tabs[0].children[2];
  const selected = workspace.activeLeaf, leaf = tabs[0].children[1];
  workspace.moveLeaf(leaf, tabs[1], 1);
  assert.deepEqual(ids(tabs[0]), ["a", "c"]); assert.equal(tabs[0].children[tabs[0].currentTab], selected);
  assert.deepEqual(ids(tabs[1]), ["d", "b", "e"]); assert.equal(leaf.parent, tabs[1]); assert.equal(tabs[1].currentTab, 1);
  assert.equal(workspace.activeLeaf, leaf); assert.equal(leaf.view.editor.dirty, true);
});

test("moving the last nested tab removes empty ancestors and preserves the main root identity", () => {
  const { workspace, tabs, split } = fixture([["a"], ["b"]]), root = workspace.rootSplit, outer = split(root), inner = split(outer);
  root.children.splice(0, 1, outer); outer.children.push(inner); inner.children.push(tabs[0]); tabs[0].parent = inner;
  workspace.moveLeaf(tabs[0].children[0], tabs[1], 1);
  assert.equal(workspace.rootSplit, root); assert.deepEqual(root.children, [tabs[1]]); assert.equal(tabs[1].parent, root);
  assert.deepEqual(ids(tabs[1]), ["b", "a"]); assert.equal(workspace.leaves().length, 2);
});

test("adjacent insertion gaps are genuine no-ops with no layout write or activation", () => {
  const { workspace, tabs, events } = fixture(), leaf = tabs[0].children[1], active = workspace.activeLeaf;
  for (const index of [1, 2]) assert.equal(workspace.moveLeaf(leaf, tabs[0], index), false);
  assert.deepEqual(ids(tabs[0]), ["a", "b", "c"]); assert.equal(workspace.activeLeaf, active); assert.deepEqual(events, []);
});

test("invalid insertion positions and detached/foreign/sidebar tabs reject without changing the live tree", () => {
  const { workspace, tabs, events } = fixture(), before = tabs.map(ids), other = fixture();
  for (const index of [-1, 0.5, 4, NaN]) assert.throws(() => workspace.moveLeaf(tabs[0].children[0], tabs[0], index), /live tab/);
  assert.throws(() => workspace.moveLeaf(tabs[0].children[0], other.tabs[0], 0), /live tab/);
  workspace.leftSplit.children.push(tabs[1]); workspace.rootSplit.children.pop(); tabs[1].parent = workspace.leftSplit;
  assert.throws(() => workspace.moveLeaf(tabs[1].children[0], tabs[0], 0), /live tab/);
  assert.deepEqual(tabs.map(ids), before); assert.deepEqual(events, []);
});

test("vault/layout/file/view transitions and pending leaf operations refuse tab movement", () => {
  for (const state of ["restoring", "changingLayout", "changingFiles", "changingViews", "tasks", "changingVault", "root"]) {
    const { workspace, tabs, events } = fixture();
    if (state === "tasks") workspace.tasks.add(Promise.resolve());
    else if (state === "changingVault") workspace.app.changingVault = true;
    else if (state === "root") workspace.app.vault.rootPath = null;
    else workspace[state] = state === "changingViews" ? 1 : true;
    assert.equal(workspace.canMoveLeaf(tabs[0].children[0], tabs[1], 0), false, state);
    assert.throws(() => workspace.moveLeaf(tabs[0].children[0], tabs[1], 0), /live tab/);
    assert.deepEqual(ids(tabs[0]), ["a", "b", "c"]); assert.deepEqual(events, []);
  }
});

test("keyboard/menu destinations respect pane and tab boundaries and remain available in a read-only vault", () => {
  const { workspace, tabs } = fixture(); workspace.app.vault.readOnly = true;
  const first = tabs[0].children[0], last = tabs[0].children.at(-1);
  assert.equal(workspace.tabDestination(first, -1), null); assert.equal(workspace.tabDestination(last, 1), null);
  assert.equal(workspace.tabDestination(first, -1, true), null);
  assert.deepEqual(workspace.tabDestination(first, 1, true), { parent: tabs[1], index: 2 });
  workspace.moveLeaf(first, tabs[1], 2); assert.deepEqual(ids(tabs[1]), ["d", "e", "a"]);
});
