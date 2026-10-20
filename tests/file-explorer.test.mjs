import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, explorerState, explorerTree, ExplorerSelection, FileExplorerView, ViewTFile, ViewTFolder, EXPLORER_NOTE_DRAG, EXPLORER_DRAG_EXPAND_DELAY, retireExplorerNoteDrag;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime/file-explorer-tests-"));
  const output = join(directory, "model.mjs");
  await build({ entryPoints: [join(root, "client/file-explorer-model.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ explorerState, explorerTree, ExplorerSelection } = await import(pathToFileURL(output).href));
  const viewOutput = join(directory, "view.mjs");
  const stubs = {
    "./views": "export class ItemView {}",
    "./dom": "export function reportError(error){globalThis.explorerScheduleErrors?.push(error)}",
    "./icons": "export function icon(){}",
    "./menu": "export class Menu {}",
    "./ui": "export class Modal {}",
    "./vault": "export class TAbstractFile{};export class TFile extends TAbstractFile{};export class TFolder extends TAbstractFile{}",
  };
  await build({ stdin: { contents: (await readFile(join(root, "client/file-explorer-view.ts"), "utf8")) + '\nexport {TFile,TFolder}; export {retireExplorerNoteDrag} from "./explorer-note-drag";', loader: "ts", resolveDir: join(root, "client") }, outfile: viewOutput, bundle: true, platform: "node", format: "esm", logLevel: "silent",
    plugins: [{ name: "isolated-view-lifecycle", setup(plugin) {
      plugin.onResolve({ filter: /^\.\/(?:views|dom|icons|menu|vault|ui)$/ }, args => ({ path: args.path, namespace: "view-lifecycle-stub" }));
      plugin.onLoad({ filter: /.*/, namespace: "view-lifecycle-stub" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  ({ FileExplorerView, TFile: ViewTFile, TFolder: ViewTFolder, EXPLORER_NOTE_DRAG, EXPLORER_DRAG_EXPAND_DELAY, retireExplorerNoteDrag } = await import(pathToFileURL(viewOutput).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/file-explorer-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const file = (path, mtime = 0, ctime = 0) => ({ path, folder: false, mtime, ctime });
const folder = path => ({ path, folder: true });
const names = tree => tree.roots.map(node => node.name);

test("original minimal Files state gains independent defaults without losing or mutating opaque input", () => {
  const input = { sortOrder: "byModifiedTime", opaque: { plugin: [1, true] }, collapsedFolders: ["Projects", "Projects", "中文/λ"] };
  const before = structuredClone(input), state = explorerState(input);
  assert.deepEqual(input, before); assert.deepEqual(state.collapsedFolders, ["Projects", "中文/λ"]);
  state.collapsedFolders.push("Extra"); assert.deepEqual(input, before);
  assert.deepEqual(explorerState({}), { sortOrder: "alphabetical", autoReveal: false, showSearch: false, searchQuery: "", collapsedFolders: [] });
});
test("malformed saved controls fail before applying state, including prototype keys and unsafe folder paths", () => {
  for (const input of [{ sortOrder: "constructor" }, { sortOrder: null }, { autoReveal: "true" }, { showSearch: 1 }, { searchQuery: "a".repeat(1025) }, { collapsedFolders: null }, { collapsedFolders: Array(4097).fill("a") }, ...["", "/a", "../a", ".obsidian", "a//b", "a\\b", "a/./b", "a\u0000b"].map(path => ({ collapsedFolders: [path] }))]) {
    assert.throws(() => explorerState(input));
  }
  assert.equal(explorerState({ searchQuery: "<img src=x onerror=alert(1)>" }).searchQuery, "<img src=x onerror=alert(1)>");
});
test("natural name ordering remains folders first in either direction and leaves the snapshot untouched", () => {
  const entries = [file("Note 10.md"), folder("Folder 10"), file("Note 2.md"), folder("Folder 2"), file("a.md")], before = structuredClone(entries);
  assert.deepEqual(names(explorerTree(entries, "alphabetical", "")), ["Folder 2", "Folder 10", "a.md", "Note 2.md", "Note 10.md"]);
  assert.deepEqual(names(explorerTree(entries, "alphabeticalReverse", "")), ["Folder 10", "Folder 2", "Note 10.md", "Note 2.md", "a.md"]);
  assert.deepEqual(entries, before);
});
test("modified and created ordering uses the right field, deterministic ties, and folders first", () => {
  const entries = [file("B.md", 20, 10), file("A.md", 20, 30), folder("Z"), file("C.md", 5, 20)];
  assert.deepEqual(names(explorerTree(entries, "byModifiedTime", "")), ["Z", "A.md", "B.md", "C.md"]);
  assert.deepEqual(names(explorerTree(entries, "byModifiedTimeReverse", "")), ["Z", "C.md", "A.md", "B.md"]);
  assert.deepEqual(names(explorerTree(entries, "byCreatedTime", "")), ["Z", "A.md", "C.md", "B.md"]);
  assert.deepEqual(names(explorerTree(entries, "byCreatedTimeReverse", "")), ["Z", "B.md", "C.md", "A.md"]);
  assert.deepEqual(names(explorerTree([file("A", NaN), file("B", Infinity), file("C", 1)], "byModifiedTime", "")), ["C", "A", "B"]);
});
test("case-insensitive path filtering retains ancestors and explicit empty folders with accurate counts", () => {
  const entries = [file("Projects/Garden/Plan.md"), file("Projects/Other.md"), folder("Empty λ"), file("Loose.md")];
  const filtered = explorerTree(entries, "alphabetical", "  GARDEN/plan  ");
  assert.equal(filtered.files, 1); assert.equal(filtered.folders, 2); assert.equal(filtered.roots.find(node => node.name === "Projects").visible, true);
  assert.equal(filtered.roots.find(node => node.name === "Loose.md").visible, false);
  const empty = explorerTree(entries, "alphabetical", "λ"); assert.equal(empty.files, 0); assert.equal(empty.folders, 1);
  assert.equal(empty.roots.find(node => node.name === "Empty λ").visible, true);
  const all = explorerTree(entries, "alphabetical", "Projects"); assert.equal(all.files, 2); assert.equal(all.folders, 2);
});
test("snapshot identity errors and path collisions are rejected in either input order", () => {
  for (const entries of [[file("A.md"), file("A.md")], [folder("A"), file("A")], [file("A/B.md"), file("A")], [file("A"), file("A/B.md")], [file("../hidden")]]) {
    assert.throws(() => explorerTree(entries, "alphabetical", ""));
  }
  assert.throws(() => explorerTree([], "future-sort", ""));
  assert.deepEqual(explorerTree([folder("/"), folder("Empty")], "alphabetical", "").roots.map(node => node.path), ["Empty"]);
});
test("deep paths build and filter iteratively rather than exhausting the JavaScript call stack", () => {
  const path = Array(1500).fill("x").join("/") + "/Target.md";
  const tree = explorerTree([file(path)], "alphabetical", "target");
  assert.equal(tree.files, 1); assert.equal(tree.folders, 1500);
  let node = tree.roots[0], depth = 0; while (node.folder) { assert.equal(node.visible, true); depth++; node = node.children[0]; }
  assert.equal(depth, 1500); assert.equal(node.path, path);
});

const notes = count => Array.from({ length: count }, (_, index) => ({ path: `Note ${index + 1}.md`, file: { identity: index + 1 } }));
test("transient note selection replaces, toggles and ranges only over the current visible ordering", () => {
  const visible = notes(5), selection = new ExplorerSelection();
  assert.equal(selection.choose(visible, visible[1]), null);
  assert.equal(selection.choose(visible, visible[3], false, true), null);
  assert.deepEqual(selection.plan(visible).items.map(item => item.path), ["Note 2.md", "Note 3.md", "Note 4.md"]);
  selection.choose(visible, visible[2], true);
  assert.deepEqual(selection.plan(visible).items.map(item => item.path), ["Note 2.md", "Note 4.md"]);
  selection.choose(visible, visible[4], true);
  selection.choose(visible, visible[0], true, true);
  assert.equal(selection.size, 5);
  selection.choose(visible, visible[1]); assert.equal(selection.size, 1);
  assert.match(selection.choose(visible.slice(1), visible[0]), /visible Markdown/);
  assert.equal(selection.size, 1);
});

test("filtered or folded notes never remain secretly selected or reappear selected on expansion", () => {
  const visible = notes(4), selection = new ExplorerSelection();
  selection.choose(visible, visible[0]); selection.choose(visible, visible[3], false, true);
  selection.reconcile([visible[1], visible[2]]); assert.equal(selection.size, 2);
  assert.deepEqual(selection.plan(visible).items.map(item => item.path), ["Note 2.md", "Note 3.md"]);
  selection.reconcile([]); assert.equal(selection.size, 0);
  assert.match(selection.plan(visible), /Choose 1–20/);
});

test("delete/recreate and rename cannot transfer a selected identity to a new path or same-byte replacement", () => {
  const visible = notes(3), selection = new ExplorerSelection(); selection.choose(visible, visible[0]); selection.choose(visible, visible[1], true);
  const replacement = { path: visible[0].path, file: { ...visible[0].file } }, renamed = { path: "Renamed.md", file: visible[1].file };
  selection.reconcile([replacement, renamed, visible[2]]);
  assert.equal(selection.size, 0); assert.equal(selection.has(replacement.path, replacement.file), false); assert.equal(selection.has(renamed.path, renamed.file), false);
  selection.choose([renamed], renamed); assert.equal(selection.size, 1);
});

test("whole-group open plans fail on reordered, hidden, reselected or replaced targets before later opens", () => {
  const visible = notes(3), selection = new ExplorerSelection(); selection.choose(visible, visible[0]); selection.choose(visible, visible[2], true);
  const plan = selection.plan(visible); assert.equal(selection.current(plan, visible), true);
  assert.equal(selection.current(plan, visible.toReversed()), false);
  assert.equal(selection.current(plan, visible.slice(1)), false);
  assert.equal(selection.current(plan, [{ ...visible[0], file: {} }, ...visible.slice(1)]), false);
  selection.choose(visible, visible[2], true); assert.equal(selection.current(plan, visible), false);
  selection.choose(visible, visible[2], true); assert.equal(selection.current(plan, visible), false, "identical re-selection still revokes the earlier intent");
});

test("an unobserved preflight removal refuses the whole group instead of silently opening its remaining subset", () => {
  const visible = notes(2), selection = new ExplorerSelection();
  selection.choose(visible, visible[0]); selection.choose(visible, visible[1], true);
  assert.match(selection.plan(visible.slice(0, 1)), /changed.*Review/);
  assert.equal(selection.size, 1, "the next render may show the reconciled group for explicit review");
  assert.equal(selection.plan(visible.slice(0, 1)).items.length, 1);
  selection.choose(visible, visible[1], true);
  assert.match(selection.plan([visible[0], { ...visible[1], file: {} }]), /changed.*Review/);
});

test("selection and opening limits refuse complete oversized intents without truncating or altering the accepted group", () => {
  const visible = notes(65), selection = new ExplorerSelection();
  selection.choose(visible, visible[0]);
  assert.match(selection.choose(visible, visible[64], false, true), /up to 64/); assert.equal(selection.size, 1);
  selection.choose(visible, visible[63], false, true); assert.equal(selection.size, 64); assert.match(selection.plan(visible), /Choose 1–20/);
  selection.choose(visible, visible[0]); selection.choose(visible, visible[19], false, true); assert.equal(selection.plan(visible).items.length, 20);
  selection.choose(visible, visible[20], true); assert.match(selection.plan(visible), /Choose 1–20/);
});

test("per-pane selection is isolated, does not mutate visible snapshots, and is not serialized in Files state", () => {
  const visible = notes(2), original = structuredClone(visible), first = new ExplorerSelection(), second = new ExplorerSelection();
  first.choose(visible, visible[0]); assert.equal(second.size, 0);
  const plan = first.plan(visible); plan.items.pop(); assert.equal(first.size, 1);
  first.clear(); assert.equal(first.size, 0); assert.equal(second.size, 0); assert.deepEqual(visible, original);
  assert.deepEqual(explorerState({}), { sortOrder: "alphabetical", autoReveal: false, showSearch: false, searchQuery: "", collapsedFolders: [] });
});

const drain = () => new Promise(resolve => setImmediate(resolve));

test("Files rendering keeps recovery and creation disabled in cached mounts while browsing remains usable", () => {
  const controls = ["new-note", "new-folder", "recover-trash", "search", "auto-reveal", "select-notes", "open-selected", "move-selected", "rename-selected", "trash-selected", "clear-selection"];
  const buttons = new Map(controls.map(action => [action, { disabled: false, setAttribute() {} }]));
  const workspace = { isChangingLayout: false, isChangingFiles: false, getActiveFile: () => null };
  const vault = { rootPath: "cached-fixture", readOnly: true, getAllLoadedFiles: () => [] };
  const app = { vault, workspace, changingVault: false, core: { isEnabled: () => true, busy: false } }, leaf = {};
  const view = Object.assign(Object.create(FileExplorerView.prototype), {
    app, leaf, isLoaded: true, sourceRoot: vault.rootPath, containerEl: { isConnected: true },
    tree: { contains: () => false, setAttribute() {}, replaceChildren() {} }, buttons,
    sort: {}, search: {}, status: {}, options: explorerState({}), fileItems: Object.create(null), selection: new ExplorerSelection(),
    selectionMode: false, renderRevision: 0, refreshing: false, openingSelection: null, mutatingSelection: null,
    noteDrag: null, noteDragHover: null, clearNoteDrag() {}, clearNoteDropTarget() {}, visibleNotes: () => [], rows: () => [], roving() {},
  });
  leaf.view = view;
  const prior = globalThis.document; globalThis.document = { activeElement: null, createDocumentFragment: () => ({}) };
  try {
    view.render();
    for (const action of ["new-note", "new-folder", "recover-trash"]) assert.equal(buttons.get(action).disabled, true, action);
    for (const action of ["search", "auto-reveal", "select-notes"]) assert.equal(buttons.get(action).disabled, false, action);
    assert.equal(view.sort.disabled, false);
    vault.readOnly = false; view.render();
    assert.equal(buttons.get("recover-trash").disabled, false, "writable local trash can be browsed without a selection");
    workspace.isChangingLayout = true; view.render();
    assert.ok([...buttons.values()].every(button => button.disabled), "all controls retain the layout guard");
  } finally { globalThis.document = prior; }
});

function transitioningFiles() {
  let release, reject, waits = 0, renders = 0;
  const idle = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  const workspace = { isChangingLayout: true, isChangingFiles: false, whenIdle: () => { waits++; return idle; } };
  const app = { vault: { rootPath: "fixture" }, workspace, changingVault: false, core: { isEnabled: () => true, busy: false } };
  const leaf = {}, view = Object.assign(Object.create(FileExplorerView.prototype), { app, leaf, isLoaded: true, sourceRoot: "fixture", containerEl: { isConnected: true }, sort: { disabled: true }, queued: false, settlingLayout: null, refreshing: false, openingSelection: null });
  leaf.view = view;
  view.render = () => { renders++; view.sort.disabled = !view.interactive(); };
  return { view, workspace, app, leaf, release, reject, waits: () => waits, renders: () => renders };
}

test("a quiet layout-ready render re-enables actual Files controls only after tracked layout settlement, with one coalesced observer", async () => {
  const f = transitioningFiles(); f.view.schedule(); f.view.schedule(); await drain();
  assert.equal(f.renders(), 1); assert.equal(f.view.sort.disabled, true); assert.equal(f.waits(), 1);
  f.view.schedule(); await drain(); assert.equal(f.waits(), 1, "another early inventory event shares the pending completion");
  f.workspace.isChangingLayout = false; f.release(); await drain();
  assert.equal(f.view.sort.disabled, false, "no later inventory/core/layout event is needed in a cache-only vault");
  assert.equal(f.renders(), 3); assert.equal(f.view.settlingLayout, null);
});

test("a rejected layout also releases a surviving owned Files view without duplicating the caller's error", async () => {
  const f = transitioningFiles(), previous = globalThis.explorerScheduleErrors; globalThis.explorerScheduleErrors = [];
  try {
    f.view.schedule(); await drain(); f.workspace.isChangingLayout = false; f.reject(new Error("The caller owns this rolled-back layout failure")); await drain();
    assert.equal(f.view.sort.disabled, false); assert.equal(f.renders(), 2); assert.deepEqual(globalThis.explorerScheduleErrors, []);
  } finally { if (previous === undefined) delete globalThis.explorerScheduleErrors; else globalThis.explorerScheduleErrors = previous; }
});

test("settled refreshes cannot revive disposed, replaced, detached or previous-root Files owners", async () => {
  for (const revoke of [f => { f.view.isLoaded = false; }, f => { f.leaf.view = {}; }, f => { f.view.containerEl.isConnected = false; }, f => { f.app.vault.rootPath = "new-root"; }]) {
    const f = transitioningFiles(); f.view.schedule(); await drain(); revoke(f); f.workspace.isChangingLayout = false; f.release(); await drain();
    assert.equal(f.renders(), 1); assert.equal(f.view.sort.disabled, true);
  }
});

test("a settled observer leaves pointer-owned rows alone when another update already restored availability", async () => {
  const f = transitioningFiles(); f.view.schedule(); await drain();
  f.workspace.isChangingLayout = false; f.view.schedule(); await drain();
  assert.equal(f.view.sort.disabled, false); assert.equal(f.renders(), 2);
  f.release(); await drain(); assert.equal(f.renders(), 2, "an unchanged completion never inserts a redraw between pointer-down and click");
});


function dragFixture(count = 2) {
  const vault = { rootPath: "drag-vault", readOnly: false }, inventory = new Map(), tree = {}, rows = [], opened = [];
  const app = { vault, workspace: { isChangingFiles: false, isChangingLayout: false, viewTypeForExtension: extension => extension === "md" ? "markdown" : null }, changingVault: false, core: { isEnabled: () => true, busy: false } }, leaf = {};
  const selection = new ExplorerSelection(), view = Object.assign(Object.create(FileExplorerView.prototype), { app, leaf, isLoaded: true, sourceRoot: vault.rootPath, containerEl: { isConnected: true }, tree, fileItems: Object.create(null), refreshing: false, openingSelection: null, mutatingSelection: null, noteDrag: null, selectionMode: true, selection }); leaf.view = view;
  const add = (path, folder = false) => {
    const file = Object.assign(new (folder ? ViewTFolder : ViewTFile)(), { path, vault, extension: folder ? "" : path.split(".").at(-1), isRoot: () => false }), classes = new Set();
    const row = { dataset: { explorerPath: path }, parentElement: tree, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } };
    rows.push(row); inventory.set(path, file); view.fileItems[path] = { file, titleEl: row }; return { file, row };
  };
  const sources = Array.from({ length: count }, (_, index) => add("From/Note " + index + ".md")), destination = add("Dest", true), other = add("Elsewhere.md"), attachment = add("Image.png");
  Object.assign(vault, { getAbstractFileByPath: path => inventory.get(path) ?? null, getFolderByPath: path => inventory.get(path) instanceof ViewTFolder ? inventory.get(path) : null });
  view.rows = () => rows; view.say = message => { view.message = message; }; view.mutateSelected = (...args) => opened.push(args);
  for (const source of sources) selection.choose(view.visibleNotes(), { path: source.file.path, file: source.file }, true);
  const data = new Map(), transfer = { types: [], setData(type, value) { data.set(type, value); if (!this.types.includes(type)) this.types.push(type); }, getData: type => data.get(type) ?? "" };
  return { app, view, vault, selection, sources, destination, other, attachment, transfer, inventory, rows, opened };
}

test("selected-note drag consumes an opaque same-pane token and opens a prefilled review without a file mutation", async () => {
  const f = dragFixture(), before = [...f.inventory.entries()];
  assert.equal(f.view.beginNoteDrag(f.sources[0].row, f.transfer), true); assert.equal(f.transfer.effectAllowed, "move");
  assert.match(f.transfer.getData(EXPLORER_NOTE_DRAG), /^[a-f0-9-]{36}$/); assert.equal(f.transfer.getData("text/plain"), ""); assert.deepEqual(f.transfer.types, [EXPLORER_NOTE_DRAG]);
  assert.equal(f.view.noteDropFolder(f.destination.row), f.destination.file);
  assert.equal(f.view.dropNotes(f.destination.row, f.transfer), true); await drain();
  assert.equal(f.opened.length, 1); assert.equal(f.opened[0][0], "move"); assert.equal(f.opened[0][1], f.destination.file);
  assert.deepEqual(f.opened[0][2].items.map(item => item.file), f.sources.map(source => source.file));
  assert.deepEqual([...f.inventory.entries()], before); assert.equal(f.selection.size, 2); assert.equal(f.view.noteDrag, null);
  assert.equal(f.view.dropNotes(f.destination.row, f.transfer), false); await drain(); assert.equal(f.opened.length, 1, "a consumed native drag cannot replay");
  for (const source of f.sources) assert.equal(source.row.classList.contains("is-note-dragging"), false);
});

test("Escape retires the app-owned drag when focus is outside either Files tree", () => {
  const f = dragFixture(), peer = peerDragPane(f), foreign = dragFixture();
  f.view.beginNoteDrag(f.sources[0].row, f.transfer);
  let prevented = 0;
  const event = { key: "Escape", target: { tagName: "BODY" }, isComposing: false, preventDefault() { prevented++; } };
  assert.equal(foreign.view.cancelNoteDragKey(event), false);
  assert.equal(f.view.noteDrag !== null, true);
  assert.equal(peer.view.cancelNoteDragKey({ ...event, isComposing: true }), false);
  assert.equal(peer.view.cancelNoteDragKey({ ...event, key: "Enter" }), false);
  assert.equal(peer.view.cancelNoteDragKey(event), true);
  assert.equal(prevented, 1); assert.equal(f.view.noteDrag, null); assert.equal(f.selection.size, 2);
  assert.equal(peer.view.cancelNoteDragKey(event), false);
  assert.equal(peer.view.dropNotes(peer.destination, f.transfer), false);
});

test("drag start refuses nonselected/attachment/folder/ordinary/read-only and oversized groups without truncation", () => {
  for (const target of ["other", "attachment", "destination"]) { const f = dragFixture(); assert.equal(f.view.beginNoteDrag(f[target].row, f.transfer), false); assert.equal(f.view.noteDrag, null); }
  for (const revoke of [f => { f.view.selectionMode = false; }, f => { f.vault.readOnly = true; }, f => { f.app.workspace.isChangingFiles = true; }, f => { f.app.core.busy = true; }]) {
    const f = dragFixture(); revoke(f); assert.equal(f.view.beginNoteDrag(f.sources[0].row, f.transfer), false); assert.equal(f.transfer.types.length, 0);
  }
  const f = dragFixture(21); assert.equal(f.view.beginNoteDrag(f.sources[0].row, f.transfer), false); assert.equal(f.selection.size, 21); assert.equal(f.view.noteDrag, null);
});

test("held note drops refuse stale selection, visible order, identities, owners and mutation availability", async () => {
  for (const revoke of [f => f.selection.clear(), f => f.selection.choose(f.view.visibleNotes(), { path: f.other.file.path, file: f.other.file }), f => f.rows.reverse(), f => f.rows.splice(0, 1), f => f.inventory.set(f.sources[0].file.path, {}), f => { f.sources[0].file.path = "Renamed.md"; }, f => { f.vault.rootPath = "Other vault"; }, f => { f.vault.readOnly = true; }, f => { f.app.workspace.isChangingFiles = true; }, f => { f.app.workspace.isChangingLayout = true; }, f => { f.app.core.busy = true; }, f => { f.view.leaf.view = {}; }, f => { f.view.isLoaded = false; }]) {
    const f = dragFixture(); assert.equal(f.view.beginNoteDrag(f.sources[0].row, f.transfer), true); revoke(f);
    assert.equal(f.view.dropNotes(f.destination.row, f.transfer), false); await drain(); assert.deepEqual(f.opened, []); assert.equal(f.view.noteDrag, null);
  }
});

test("foreign tokens, other apps and nonfolder/replaced targets cannot authorize a drop review", async () => {
  for (const target of ["other", "attachment", "source", "replaced", "foreign"]) {
    const f = dragFixture(); f.view.beginNoteDrag(f.sources[0].row, f.transfer);
    let row = target === "other" ? f.other.row : target === "attachment" ? f.attachment.row : target === "source" ? f.sources[0].row : f.destination.row;
    if (target === "replaced") f.inventory.set("Dest", {});
    if (target === "foreign") f.transfer.setData(EXPLORER_NOTE_DRAG, "unrelated token");
    assert.equal(f.view.dropNotes(row, f.transfer), false); await drain(); assert.deepEqual(f.opened, []);
  }
  const first = dragFixture(), second = dragFixture(); first.view.beginNoteDrag(first.sources[0].row, first.transfer);
  assert.equal(second.view.dropNotes(second.destination.row, first.transfer), false); await drain(); assert.deepEqual(second.opened, []);
});

function peerDragPane(f) {
  const tree = {}, leaf = {}, selection = new ExplorerSelection(), rows = [], opened = [];
  const view = Object.assign(Object.create(FileExplorerView.prototype), { app: f.app, leaf, isLoaded: true, sourceRoot: f.vault.rootPath, containerEl: { isConnected: true }, tree,
    fileItems: Object.create(null), refreshing: false, openingSelection: null, mutatingSelection: null, noteDrag: null, noteDragHover: null, renderRevision: 0, selectionMode: false, selection,
    options: explorerState({ collapsedFolders: ["Dest"] }), filteredCollapsed: new Set() });
  leaf.view = view;
  for(const source of f.rows) {
    const path = source.dataset.explorerPath, file = f.inventory.get(path), classes = new Set();
    const row = { dataset: { explorerPath: path }, parentElement: tree, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } };
    rows.push(row); view.fileItems[path] = { file, titleEl: row };
  }
  view.rows = () => rows; view.say = message => { view.message = message; }; view.mutateSelected = (...args) => opened.push(args);
  return { view, leaf, rows, selection, opened, destination: view.fileItems.Dest.titleEl, row: path => view.fileItems[path].titleEl };
}

test("a different Files pane reviews the source group and preserves its independent destination selection", async () => {
  const f = dragFixture(), peer = peerDragPane(f), before = [...f.inventory.entries()];
  peer.view.selectionMode = true; peer.selection.choose(peer.view.visibleNotes(), { path: f.other.file.path, file: f.other.file });
  assert.equal(f.view.beginNoteDrag(f.sources[0].row, f.transfer), true);
  assert.equal(peer.view.noteDropFolder(peer.destination), f.destination.file);
  assert.equal(peer.view.dropNotes(peer.destination, f.transfer), true); await drain();
  assert.equal(f.opened.length, 1); assert.deepEqual(peer.opened, [], "the receiving pane never substitutes its own selection");
  assert.deepEqual(f.opened[0][2].items.map(item => item.file), f.sources.map(item => item.file));
  assert.equal(peer.selection.size, 1); assert.equal(peer.selection.has(f.other.file.path, f.other.file), true);
  assert.equal(f.opened[0][3](), true); assert.deepEqual([...f.inventory.entries()], before);
  peer.view.isLoaded = false; assert.equal(f.opened[0][3](), false, "the held review keeps the destination owner's identity");
  assert.equal(peer.view.dropNotes(peer.destination, f.transfer), false);
});

test("a normal receiving Files pane needs no selected group, and source replacement invalidates a queued cross-pane drop", async () => {
  const normal = dragFixture(), target = peerDragPane(normal); normal.view.beginNoteDrag(normal.sources[0].row, normal.transfer);
  assert.equal(target.view.selectionMode, false); assert.equal(target.view.dropNotes(target.destination, normal.transfer), true); await drain();
  assert.equal(normal.opened.length, 1); assert.equal(target.selection.size, 0);
  for(const revoke of [f => f.selection.clear(), f => { f.view.leaf.view = {}; }, f => { f.vault.readOnly = true; }]) {
    const f = dragFixture(), peer = peerDragPane(f);
    assert.equal(peer.view.selectionMode, false); f.view.beginNoteDrag(f.sources[0].row, f.transfer);
    assert.equal(peer.view.dropNotes(peer.destination, f.transfer), true); revoke(f); await drain(); assert.deepEqual(f.opened, []);
  }
  const f = dragFixture(), peer = peerDragPane(f); f.view.beginNoteDrag(f.sources[0].row, f.transfer);
  assert.equal(peer.view.dropNotes(peer.destination, f.transfer), true); peer.view.renderRevision++; await drain(); assert.deepEqual(f.opened, []);
});

test("stale coordinator and hover cleanup cannot retire an unrelated replacement gesture", () => {
  const f = dragFixture(), peer = peerDragPane(f); f.destination.file.children = [];
  f.view.beginNoteDrag(f.sources[0].row, f.transfer); const previous = f.view.noteDrag, oldSourceCleanup = [...previous.cleanups][0];
  peer.view.hoverNoteDropFolder(peer.destination, f.destination.file); const oldHoverCleanup = peer.view.noteDragHover.cleanup;
  f.view.beginNoteDrag(f.sources[0].row, f.transfer); const replacement = f.view.noteDrag;
  peer.view.hoverNoteDropFolder(peer.destination, f.destination.file); const newHover = peer.view.noteDragHover;
  retireExplorerNoteDrag(f.app, previous); oldSourceCleanup(); oldHoverCleanup();
  assert.equal(f.view.noteDrag, replacement); assert.equal(f.view.currentNoteDrag(), true); assert.equal(peer.view.noteDragHover, newHover);
  assert.equal(peer.destination.classList.contains("is-note-drop-target"), true); f.view.clearNoteDrag();
});

test("publishing a newer drag retires all older source and receiving-pane marks without clearing selections", () => {
  const f = dragFixture(), peer = peerDragPane(f); peer.view.selectionMode = true;
  peer.selection.choose(peer.view.visibleNotes(), { path: f.other.file.path, file: f.other.file });
  f.destination.file.children = [];
  f.view.beginNoteDrag(f.sources[0].row, f.transfer); peer.view.hoverNoteDropFolder(peer.destination, f.destination.file);
  assert.equal(peer.destination.classList.contains("is-note-drop-target"), true);
  const data = new Map(), transfer = { setData: (type,value) => data.set(type,value) };
  assert.equal(peer.view.beginNoteDrag(peer.row(f.other.file.path), transfer), true);
  assert.equal(f.view.noteDrag, null); assert.equal(f.selection.size, 2); assert.equal(peer.selection.size, 1);
  assert.equal(peer.destination.classList.contains("is-note-drop-target"), false);
  for(const source of f.sources)assert.equal(source.row.classList.contains("is-note-dragging"), false);
  peer.view.clearNoteDrag();
});

test("tearing down a hovered receiving pane retires the source gesture while a simple dragleave only clears hover", () => {
  const f = dragFixture(), peer = peerDragPane(f); f.destination.file.children = [];
  f.view.beginNoteDrag(f.sources[0].row, f.transfer); peer.view.hoverNoteDropFolder(peer.destination, f.destination.file);
  peer.view.clearNoteDropTarget(); assert.equal(f.view.currentNoteDrag(), true);
  peer.view.hoverNoteDropFolder(peer.destination, f.destination.file); peer.view.clearNoteDrag();
  assert.equal(f.view.noteDrag, null); assert.equal(peer.view.dropNotes(peer.destination, f.transfer), false); assert.equal(f.selection.size, 2);
});

test("hover expansion waits 750ms, preserves the exact source gesture and cancels after leaving", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = dragFixture(), peer = peerDragPane(f); f.destination.file.children = [f.other.file];
  let renders = 0, saves = 0;
  peer.view.render = drag => { renders++; assert.equal(drag, f.view.noteDrag); assert.equal(peer.view.collapsed("Dest"), false); };
  peer.view.save = () => saves++;
  f.view.beginNoteDrag(f.sources[0].row, f.transfer); peer.view.hoverNoteDropFolder(peer.destination, f.destination.file);
  context.mock.timers.tick(EXPLORER_DRAG_EXPAND_DELAY - 1); assert.equal(renders, 0);
  peer.view.hoverNoteDropFolder(peer.destination, f.destination.file); context.mock.timers.tick(1);
  assert.equal(renders, 1); assert.equal(saves, 1); assert.equal(f.view.currentNoteDrag(), true); assert.equal(f.selection.size, 2);
  peer.view.options.collapsedFolders = ["Dest"]; peer.view.clearNoteDropTarget(); peer.view.hoverNoteDropFolder(peer.destination, f.destination.file);
  peer.view.clearNoteDropTarget(); context.mock.timers.tick(EXPLORER_DRAG_EXPAND_DELAY);
  assert.equal(renders, 1); assert.equal(peer.view.collapsed("Dest"), true); f.view.clearNoteDrag();
});

test("hover expansion rechecks source selection, receiving owner and folder identity before unfolding", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for(const revoke of [f => f.selection.clear(), (f,p) => { p.view.isLoaded = false; }, f => f.inventory.set("Dest", {}), f => { f.app.workspace.isChangingLayout = true; }]) {
    const f = dragFixture(), peer = peerDragPane(f); f.destination.file.children = [f.other.file];
    let renders = 0; peer.view.render = () => renders++; peer.view.save = () => { throw new Error("A stale hover cannot save folds"); };
    f.view.beginNoteDrag(f.sources[0].row, f.transfer); peer.view.hoverNoteDropFolder(peer.destination, f.destination.file); revoke(f, peer);
    context.mock.timers.tick(EXPLORER_DRAG_EXPAND_DELAY); assert.equal(renders, 0); assert.equal(peer.view.collapsed("Dest"), true); f.view.clearNoteDrag();
  }
});

test("clearing a drag retires its marks/token while preserving selection and a later queued change revokes review", async () => {
  const f = dragFixture(); f.view.beginNoteDrag(f.sources[0].row, f.transfer); f.destination.row.classList.add("is-note-drop-target"); f.view.clearNoteDrag();
  assert.equal(f.view.noteDrag, null); assert.equal(f.selection.size, 2); assert.equal(f.destination.row.classList.contains("is-note-drop-target"), false); assert.equal(f.view.dropNotes(f.destination.row, f.transfer), false);
  f.view.beginNoteDrag(f.sources[0].row, f.transfer); assert.equal(f.view.dropNotes(f.destination.row, f.transfer), true); f.inventory.set("Dest", {}); await drain();
  assert.deepEqual(f.opened, []); assert.match(f.view.message, /destination changed/);
});
