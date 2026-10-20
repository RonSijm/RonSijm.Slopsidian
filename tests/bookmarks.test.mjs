import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./host.mjs";

let directory, Bookmarks, BookmarksView, GraphView, SearchView, GlobalSearch, FileExplorerView, TFolder, bookmarkGroupKeys;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "bookmarks-tests-"));
  const outfile = join(directory, "bookmarks.cjs");
  await build({
    stdin: { contents: 'export { Bookmarks, BookmarksView, bookmarkGroupKeys } from "./client/bookmarks"; export { GraphView } from "./client/graph"; export { SearchView } from "./client/search-view"; export { GlobalSearch } from "./client/discovery-views"; export { FileExplorerView } from "./client/file-explorer-view"; export { TFolder } from "./client/vault";', resolveDir: root },
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
  });
  ({ Bookmarks, BookmarksView, GraphView, SearchView, GlobalSearch, FileExplorerView, TFolder, bookmarkGroupKeys } = createRequire(import.meta.url)(outfile));
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/bookmarks-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

function fixture() {
  const app = {
    core: { isEnabled: () => true, getEnabledPluginById: () => null },
    workspace: {}, vault: { rootPath: "local-vault" },
  };
  return { app, bookmarks: new Bookmarks(app) };
}

test("graph bookmarks validate before creating a leaf, detach options and preserve native/unknown data", async () => {
  const { app, bookmarks } = fixture(), opened = [];
  app.workspace.getLeaf = mode => ({ async setViewState(state) { opened.push({ mode, state }); } });
  const item = { type: "graph", title: "Work graph", options: { search: "path:Work", showTags: true, future: { keep: [1, false] } } };
  const original = structuredClone(item);
  await bookmarks.openBookmark(item, true);
  assert.equal(opened[0].mode, "tab");
  assert.equal(opened[0].state.type, "graph");
  assert.equal(opened[0].state.state.options.search, "path:Work");
  assert.deepEqual(opened[0].state.state.options.future, item.options.future);
  opened[0].state.state.options.future.keep.push(2);
  assert.deepEqual(item, original);
  for (const options of [undefined, null, [], { nodeSizeMultiplier: -1 }]) {
    await assert.rejects(bookmarks.openBookmark({ type: "graph", options }), /options|option/);
  }
  app.core.isEnabled = () => false;
  await assert.rejects(bookmarks.openBookmark(item), /Enable Graph view/);
  assert.equal(opened.length, 1, "Invalid or disabled presets must not create even an empty tab.");
});

test("current-view and search commands capture the actual pane rather than a stale global query or Markdown file", () => {
  const { app, bookmarks } = fixture();
  const options = { search: "path:Current", showAttachments: true, colorGroups: [] };
  const graph = Object.assign(Object.create(GraphView.prototype), { pane: { options } });
  app.workspace.activeLeaf = { view: graph };
  app.workspace.getActiveFile = () => { throw new Error("A real graph/search must not fall back to the previous file."); };
  let captured;
  bookmarks.editDialog = (_path, item) => { captured = item; };
  let command = bookmarks.commands().find(command => command.id === "bookmarks:bookmark-current-view");
  assert.equal(command.checkCallback(true), true);
  assert.equal(captured, undefined);
  assert.equal(command.checkCallback(false), true);
  assert.equal(captured.type, "graph");
  assert.equal(captured.options.search, "path:Current");
  assert.notEqual(captured.options, options);
  app.workspace.activeLeaf.view = Object.assign(Object.create(SearchView.prototype), { options: { query: "file:Actual" } });
  app.core.getEnabledPluginById = () => ({ getGlobalSearchQuery: () => "file:Old-sidebar" });
  for (const id of ["bookmarks:bookmark-current-view", "bookmarks:bookmark-current-search"]) {
    command = bookmarks.commands().find(command => command.id === id);
    assert.equal(command.checkCallback(false), true);
    assert.deepEqual(captured, { type: "search", query: "file:Actual" });
  }
});

test("modified saved-search opening toggles the native query fragment while ordinary opening replaces it", async () => {
  const { app, bookmarks } = fixture();
  let current = "path:Work";
  const search = Object.assign(Object.create(GlobalSearch.prototype), {
    getGlobalSearchQuery: () => current, openGlobalSearch: value => { current = value; },
  });
  app.core.getEnabledPluginById = () => search;
  const item = { type: "search", query: "tag:#todo" };
  await bookmarks.openBookmark(item, true);
  assert.equal(current, "path:Work tag:#todo");
  await bookmarks.openBookmark(item, true);
  assert.equal(current, "path:Work");
  await bookmarks.openBookmark(item);
  assert.equal(current, "tag:#todo");
});

test("folder bookmarks reveal the actual Files view and reject a vault switch during asynchronous reveal", async () => {
  const { app, bookmarks } = fixture(), revealed = [];
  const folder = Object.assign(Object.create(TFolder.prototype), { path: "Work/Empty" });
  app.vault.getAbstractFileByPath = () => folder;
  const view = Object.assign(Object.create(FileExplorerView.prototype), { revealInFolder: file => revealed.push(file) }), leaf = { view };
  app.workspace.getLeavesOfType = () => [leaf];
  app.workspace.revealLeaf = async () => {};
  app.workspace.getLeftLeaf = () => { throw new Error("Reuse the registered Files pane."); };
  app.sidebars = { show: () => { throw new Error("Do not navigate the obsolete legacy tree."); } };
  await bookmarks.openBookmark({ type: "folder", path: folder.path });
  assert.deepEqual(revealed, [folder]);
  app.workspace.revealLeaf = async () => { app.vault.rootPath = "different-vault"; };
  await assert.rejects(bookmarks.openBookmark({ type: "folder", path: folder.path }), /selected vault/);
  assert.equal(revealed.length, 1);
});

test("bookmark group folds follow unique native creation identities through rename, reorder and moves", () => {
  const child = { type: "group", title: "Child", ctime: 2, items: [] };
  const first = { type: "group", title: "First", ctime: 1, items: [child] };
  const second = { type: "group", title: "Second", ctime: 3, items: [] };
  const initial = bookmarkGroupKeys([first, second]);
  first.title = "Renamed";
  first.items = [];
  second.items.push(child);
  const moved = bookmarkGroupKeys([second, first]);
  assert.equal(initial.get("0"), moved.get("1"));
  assert.equal(initial.get("0.0"), moved.get("0.0"));
  const ambiguous = [{ type: "group", title: "Same", ctime: 1, items: [] }, { type: "group", title: "Same", ctime: 1, items: [] }, { type: "group", title: "No time", items: [] }];
  const before = structuredClone(ambiguous), keys = [...bookmarkGroupKeys(ambiguous).values()];
  assert.equal(new Set(keys).size, ambiguous.length);
  assert.deepEqual(ambiguous, before);
});

test("nested original groups without timestamps retain distinct, storable fold keys without recursively escaping their ancestry", () => {
  const items = [], depth = 12;
  let children = items;
  for (let index = 0; index < depth; index++) {
    const group = { type: "group", title: "Untimed group", items: [] };
    children.push(group); children = group.items;
  }
  const original = structuredClone(items), keys = [...bookmarkGroupKeys(items).values()];
  assert.equal(new Set(keys).size, depth);
  assert.ok(keys.every(key => key.length < 8192), "Ordinary nested groups must fit the actual saved-fold limit.");
  assert.deepEqual(items, original);
});

test("bookmark fold state validates atomically, preserves opaque state and returns detached fold arrays", async () => {
  const view = Object.assign(Object.create(BookmarksView.prototype), {
    state: {}, filter: "", collapsed: new Set(), filteredCollapsed: new Set(),
    contentEl: { querySelector: () => null }, render() {},
  });
  await view.setState({ filter: "Work", collapsedGroups: ["ctime:1"], future: { keep: true } }, {});
  const before = view.getState();
  for (const collapsedGroups of [null, {}, [1], ["x".repeat(8193)], Array(4097).fill("a")]) {
    await assert.rejects(view.setState({ filter: "Changed", collapsedGroups }, {}), /bookmark folds/);
    assert.deepEqual(view.getState(), before);
  }
  const detached = view.getState();
  detached.collapsedGroups.push("other");
  detached.future.keep = false;
  assert.deepEqual(view.getState(), before);
});

test("keyboard focus follows unique original items after reorder and resets safely for missing or ambiguous identities", () => {
  const item = { type: "group", title: "Original", ctime: 9, items: [] };
  const view = Object.assign(Object.create(BookmarksView.prototype), { focusedItem: item, focusedCreationTime: 9, focusAddress: "0" });
  const renamed = { ...item, title: "Renamed" };
  view.syncFocus([{ item: { type: "file", path: "Other.md", ctime: 10 }, address: [0] }, { item: renamed, address: [1] }]);
  assert.equal(view.focusAddress, "1");
  assert.equal(view.focusedItem, renamed);
  view.syncFocus([{ item: { ...renamed }, address: [0] }, { item: { ...renamed }, address: [1] }]);
  assert.equal(view.focusAddress, "");
  assert.equal(view.focusedItem, null);
  assert.equal(view.focusedCreationTime, null);
  view.focusedItem = item; view.focusedCreationTime = 9;
  view.syncFocus([]);
  assert.equal(view.focusAddress, "");
  assert.equal(view.focusedItem, null);
});
