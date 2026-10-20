import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
let directory, model;
before(async () => {
  await mkdir(join(repo, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(repo, ".runtime", "reading-bulk-fold-tests-"));
  const outfile = join(directory, "bulk.mjs");
  const replacements = {
    dompurify: "export default {sanitize:value=>value};",
    "./workspace": "export class MarkdownView{};",
    "./dom": "export const reportError=error=>{throw error};",
    "./icons": "export const icon=()=>null;",
    "./callout-styles": "export const observeCalloutStyles=()=>()=>{};",
    "./mermaid-renderer": "export const mountMermaid=()=>()=>{};",
    "./note-embed": "export class NoteEmbed{};export const newEmbedScope=()=>({depth:0,chain:[],budget:{used:0}});",
    "./plugin": "export class Component{};export class MarkdownRenderChild extends Component{};",
  };
  await build({ stdin: { resolveDir: repo, contents: 'export * from "./client/reading-folding";export * from "./client/reading-list-folding";export * from "./client/reading-callout-folding";export {ReadingView} from "./client/reading";export {registerEditorFoldCommands} from "./client/editor-fold-commands";export {parseMarkdown} from "./client/markdown";' },
    outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
    plugins: [{ name: "bulk-fold-host-fixture", setup(build) {
      build.onResolve({ filter: /^(?:dompurify|\.\/(?:workspace|dom|icons|callout-styles|mermaid-renderer|note-embed|plugin))$/ }, args => ({ path: args.path, namespace: "fold-host" }));
      build.onLoad({ filter: /.*/, namespace: "fold-host" }, args => ({ contents: replacements[args.path] }));
    } }],
  });
  model = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) { assert.match(relative(repo, directory).replaceAll("\\", "/"), /^\.runtime\/reading-bulk-fold-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

function fixture(options = {}) {
  const observers = [], document = { defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  } } };
  let root;
  function element(tag, text = "", line, classes = "") {
    const names = new Set(classes.split(" ").filter(Boolean));
    return { tagName: tag.toUpperCase(), ownerDocument: document, parentElement: null, children: [], textContent: text, open: false,
      dataset: line === undefined ? {} : { sourceLine: String(line) }, attributes: {}, listeners: new Map(),
      classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) },
      get childElementCount() { return this.children.length; }, get isConnected() { return this === root || Boolean(this.parentElement?.isConnected); },
      getAttribute(name) { return this.attributes[name] ?? null; }, hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
      setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
      getClientRects() { return this.isConnected ? [{}] : []; },
      contains(node) { return this === node || this.children.some(child => child.contains(node)); },
      closest(selector) { for (let node = this; node; node = node.parentElement) if (selector.split(",").some(part => part[0] === "." ? node.classList.contains(part.slice(1)) : node.tagName === part.toUpperCase())) return node; return null; },
      append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } },
      prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); },
      remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } },
      addEventListener(name, callback) { this.listeners.set(name, [...this.listeners.get(name) ?? [], callback]); },
      removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== callback)); },
    };
  }
  document.createElement = tag => element(tag);
  document.createTreeWalker = section => { const nodes = []; const visit = node => { for (const child of node.children) { nodes.push(child); visit(child); } }; visit(section); let at = 0; return { nextNode: () => nodes[at++] ?? null }; };
  root = element("div"); const section = element("div"); root.append(section);
  const source = ["# Root λ", "", "## Child", "Body before.", "", "- [ ] Parent", "  - Child", "    - Deep needle ^deep", "  - Sibling", "- Other", "  - Last needle", "",
    "> [!note]+ Outer", "> Outer body", ">", "> > [!tip]- Nested", "> > needle callout ^inside", "", "> [!warning]- Separate", "> independent needle", "", "# End"].join("\r\n");
  const heading = element("h1", "Root λ", 0), childHeading = element("h2", "Child", 2), prose = element("p", "Body before.", 3), end = element("h1", "End", 21);
  const list = element("ul", "", 5), parent = element("li", "Parent", 5), task = element("input"), body = element("ul", "", 6), child = element("li", "Child", 6), deepBody = element("ul", "", 7), deep = element("li", "Deep needle", 7), sibling = element("li", "Sibling", 8), other = element("li", "Other", 9), otherBody = element("ul", "", 10), last = element("li", "Last needle", 10), plugin = element("span", "plugin retained");
  task.checked = false; task.type = "checkbox"; deep.append(plugin); deepBody.append(deep); child.append(deepBody); body.append(child, sibling); parent.append(task, body); otherBody.append(last); other.append(otherBody); list.append(parent, other);
  const callout = (type, line, open) => { const node = element("details", "", line, "callout is-collapsible"), summary = element("summary", "", undefined, "callout-title"), body = element("div", "", undefined, "callout-content"); node.dataset.callout = type; node.open = open; node.append(summary, body); return { node, summary, body }; };
  const outer = callout("note", 12, true), nested = callout("tip", 15, false), separate = callout("warning", 18, false), target = element("p", "needle callout", 16), raw = element("details");
  nested.body.append(target); outer.body.append(nested.node); section.append(heading, childHeading, prose, list, outer.node, separate.node, end, raw);
  const cache = model.parseMarkdown(source), inventories = { heading: model.captureReadingFolds(section, source.length, cache.headings), list: model.captureReadingListFolds(section, source, cache.listItems), callout: model.captureReadingCallouts(section, source) };
  for (const value of Object.values(inventories)) assert.equal(value.message, null);
  let current = true; const writes = { heading: [], list: [], callout: [] }, changes = [];
  const settings = kind => ({ initialCollapsed: options[kind], onUserChange: value => { if (options.deny) throw Error("profile denied"); writes[kind].push([...value]); } });
  const currentOwner = () => current;
  const headingFolds = new model.ReadingFolding(root, section, inventories.heading, currentOwner, () => changes.push("heading"), settings("heading"));
  const listFolds = new model.ReadingListFolding(root, section, inventories.list, currentOwner, () => changes.push("list"), settings("list"));
  const calloutFolds = new model.ReadingCalloutFolding(root, section, inventories.callout, currentOwner, () => changes.push("callout"), settings("callout"));
  const workspace = { activeLeaf: null, isChangingLayout: false }, leaf = { workspace }, flags = { foldHeading: true, foldIndent: true };
  workspace.activeLeaf = leaf;
  const reading = Object.assign(Object.create(model.ReadingView.prototype), { leaf, containerEl: root, app: { configuration: { get: (_scope, key) => flags[key] } }, folding: headingFolds, listFolding: listFolds, calloutFolding: calloutFolds,
    foldingContext: { ready: true, current: currentOwner, document, section, children: [...section.children], inventory: inventories.heading, lists: inventories.list, callouts: inventories.callout } });
  const controllers = { heading: headingFolds, list: listFolds, callout: calloutFolds };
  const snapshots = () => Object.fromEntries(Object.entries(controllers).map(([kind, value]) => [kind, value.snapshot()]));
  return { root, section, source, document, element, inventories, controllers, reading, flags, leaf, workspace, writes, changes, snapshots, heading, childHeading, prose, end, list, parent, body, child, deepBody, deep, sibling, otherBody, task, plugin, outer, nested, separate, target, raw, invalidate() { current = false; } };
}

test("bulk heading/list/callout choices retain nodes and emit one complete intent snapshot per kind", () => {
  const f = fixture(), nodes = [...f.section.children], listNodes = [...f.list.children];
  assert.equal(f.reading.canFoldAll(), true); assert.deepEqual(f.writes, { heading: [], list: [], callout: [] });
  assert.equal(f.reading.foldAll(), true);
  const expected = { heading: [0, 2], list: [5, 6, 9], callout: [12, 15, 18] };
  assert.deepEqual(f.snapshots(), expected);
  for (const [kind, value] of Object.entries(expected)) assert.deepEqual(f.writes[kind], [value]);
  assert.ok(f.prose.hasAttribute("hidden")); assert.ok(f.body.hasAttribute("hidden")); assert.ok(f.deepBody.hasAttribute("hidden"));
  assert.equal(f.outer.node.open, false); assert.equal(f.nested.node.open, false); assert.equal(f.separate.node.open, false); assert.equal(f.raw.open, false);
  assert.deepEqual(f.section.children, nodes); assert.deepEqual(f.list.children, listNodes); assert.equal(f.plugin.parentElement, f.deep); assert.equal(f.task.checked, false);
  assert.equal(f.reading.unfoldAll(), true); assert.deepEqual(f.snapshots(), { heading: [], list: [], callout: [] });
  assert.equal(f.prose.hasAttribute("hidden"), false); assert.equal(f.body.hasAttribute("hidden"), false); assert.equal(f.deepBody.hasAttribute("hidden"), false);
  assert.equal(f.nested.node.open, true); assert.equal(f.separate.node.open, true);
  for (const [kind, value] of Object.entries(expected)) assert.deepEqual(f.writes[kind], [value, []]);
});

test("temporary navigation reveals preserve bulk intent and another Fold all reapplies visually opened owners", () => {
  const f = fixture(); f.reading.foldAll(); const original = f.snapshots();
  f.controllers.heading.reveal(f.deep); f.controllers.list.reveal(f.plugin); f.controllers.callout.reveal(f.target);
  assert.deepEqual(f.snapshots(), original); assert.equal(f.body.hasAttribute("hidden"), false); assert.equal(f.outer.node.open, true); assert.equal(f.nested.node.open, true);
  assert.equal(f.writes.heading.length, 1); assert.equal(f.writes.list.length, 1); assert.equal(f.writes.callout.length, 1);
  f.reading.foldAll(); assert.deepEqual(f.snapshots(), original); assert.ok(f.body.hasAttribute("hidden")); assert.equal(f.outer.node.open, false);
});

test("explicit Unfold all restores Markdown-minus callouts through a detached empty saved snapshot", () => {
  const f = fixture(); f.reading.unfoldAll();
  const saved = f.snapshots(), restored = fixture(saved); assert.deepEqual(saved, { heading: [], list: [], callout: [] });
  assert.equal(restored.outer.node.open, true); assert.equal(restored.nested.node.open, true); assert.equal(restored.separate.node.open, true);
  restored.reading.foldAll(); const collapsed = restored.snapshots(), again = fixture(collapsed); assert.deepEqual(again.snapshots(), collapsed);
  assert.equal(again.outer.node.open, false); assert.ok(again.body.hasAttribute("hidden")); assert.ok(again.prose.hasAttribute("hidden"));
});

test("bulk preference failures do not prevent local folding or corrupt the view", () => {
  const f = fixture({ deny: true }); assert.doesNotThrow(() => f.reading.foldAll()); assert.deepEqual(f.snapshots().callout, [12, 15, 18]);
  assert.doesNotThrow(() => f.reading.unfoldAll()); assert.deepEqual(f.snapshots(), { heading: [], list: [], callout: [] });
  assert.equal(f.nested.node.open, true); assert.deepEqual(f.writes, { heading: [], list: [], callout: [] });
});

test("disabled heading/list controls are excluded independently while callouts remain usable", () => {
  for (const disabled of ["foldHeading", "foldIndent", "both"]) {
    const f = fixture(); if (disabled !== "foldIndent") f.flags.foldHeading = false; if (disabled !== "foldHeading") f.flags.foldIndent = false;
    assert.equal(f.reading.foldAll(), true); assert.deepEqual(f.snapshots().callout, [12, 15, 18]);
    assert.deepEqual(f.snapshots().heading, f.flags.foldHeading ? [0, 2] : []); assert.deepEqual(f.snapshots().list, f.flags.foldIndent ? [5, 6, 9] : []);
    if (!f.flags.foldHeading) assert.deepEqual(f.writes.heading, []); if (!f.flags.foldIndent) assert.deepEqual(f.writes.list, []);
  }
});

test("one stale captured owner prevents all bulk channels before any state or profile change", () => {
  for (const mutate of [f => { f.nested.node.dataset.sourceLine = "16"; }, f => f.child.remove(), f => { f.heading.dataset.sourceLine = "1"; }, f => f.section.append(f.element("p"))]) {
    const f = fixture(); mutate(f); const before = f.snapshots();
    assert.equal(f.reading.canFoldAll(), false); assert.equal(f.reading.foldAll(), false); assert.deepEqual(f.snapshots(), before); assert.deepEqual(f.writes, { heading: [], list: [], callout: [] });
  }
});

test("background, pending, hidden/stale source and static-fragment command owners cannot fold", () => {
  for (const mutate of [f => f.invalidate(), f => { f.workspace.activeLeaf = {}; }, f => { f.workspace.isChangingLayout = true; }, f => { f.reading.foldingContext.ready = false; }, f => { f.reading.leaf = null; }, f => { f.reading.foldingContext = null; }, f => { f.reading.foldingContext.document = {}; }]) {
    const f = fixture(); mutate(f); assert.equal(f.reading.canFoldAll(), false); assert.equal(f.reading.foldAll(), false); assert.equal(f.reading.unfoldAll(), false);
    assert.deepEqual(f.writes, { heading: [], list: [], callout: [] });
  }
});

test("held disposed controllers refuse bulk actions without emitting another preference", () => {
  const f = fixture(); for (const controller of Object.values(f.controllers)) { controller.dispose(); assert.equal(controller.canSetAll(), false); assert.equal(controller.setAll(true), false); }
  assert.deepEqual(f.writes, { heading: [], list: [], callout: [] }); assert.equal(f.reading.canFoldAll(), false);
});

function commandFixture(mode = "source") {
  const calls = [], commands = [], file = { path: "Note.md" };
  let availableFile = file;
  const editor = { cm: { dom: { isConnected: true, getClientRects: () => [{}] }, composing: false, compositionStarted: false }, exec: name => calls.push(["editor", name]) };
  const reading = { enabled: true, canFoldAll() { return this.enabled; }, foldAll() { calls.push(["reading", "fold"]); return true; }, unfoldAll() { calls.push(["reading", "unfold"]); return true; } };
  const view = { file, editor, reading, isLoaded: true, mode, getMode() { return this.mode; }, get currentMode() { return this.mode === "source" ? this.editor : this.reading; } };
  const leaf = { view }, app = { changingVault: false, vault: { readOnly: false, getFileByPath: () => availableFile }, workspace: { activeLeaf: leaf, isChangingFiles: false, isChangingLayout: false, getActiveViewOfType: () => app.workspace.activeLeaf?.view ?? null }, commands: { install(list) { commands.push(...list); return () => { commands.length = 0; }; } } };
  const dispose = model.registerEditorFoldCommands(app);
  return { app, view, editor, reading, calls, commands, dispose, replaceIdentity() { availableFile = { path: file.path }; }, fold: commands.find(item => item.id === "editor:fold-all"), unfold: commands.find(item => item.id === "editor:unfold-all") };
}

test("palette Source/Live Preview commands dispatch existing Editor.exec and checks do not execute", () => {
  const f = commandFixture(); assert.equal(f.fold.name, "Fold all"); assert.equal(f.unfold.name, "Unfold all");
  assert.equal(f.fold.checkCallback(true), true); assert.equal(f.unfold.checkCallback(true), true); assert.deepEqual(f.calls, []);
  assert.equal(f.fold.checkCallback(false), true); assert.equal(f.unfold.checkCallback(false), true); assert.deepEqual(f.calls, [["editor", "foldAll"], ["editor", "unfoldAll"]]);
  f.app.vault.readOnly = true; assert.equal(f.fold.checkCallback(false), true); assert.equal(f.fold.editorCallback, undefined); assert.equal(f.fold.editorCheckCallback, undefined);
});

test("Reading palette commands are available in read-only vaults and never touch the hidden editor", () => {
  const f = commandFixture("preview"); f.app.vault.readOnly = true;
  assert.equal(f.fold.checkCallback(true), true); assert.deepEqual(f.calls, []);
  assert.equal(f.fold.checkCallback(false), true); assert.equal(f.unfold.checkCallback(false), true); assert.deepEqual(f.calls, [["reading", "fold"], ["reading", "unfold"]]);
  f.reading.enabled = false; assert.equal(f.fold.checkCallback(false), false); assert.equal(f.unfold.checkCallback(true), false); assert.equal(f.calls.length, 2);
});

test("fold commands refuse file identity, transition, loading, visibility and composition changes", () => {
  for (const mutate of [f => { f.app.changingVault = true; }, f => { f.app.workspace.isChangingFiles = true; }, f => { f.app.workspace.isChangingLayout = true; }, f => { f.view.isLoaded = false; }, f => { f.view.file = null; }, f => f.replaceIdentity(), f => { f.editor.cm.dom.isConnected = false; }, f => { f.editor.cm.dom.getClientRects = () => []; }, f => { f.editor.cm.composing = true; }, f => { f.editor.cm.compositionStarted = true; }]) {
    const f = commandFixture(); assert.equal(f.fold.checkCallback(true), true); mutate(f); assert.equal(f.fold.checkCallback(false), false); assert.equal(f.unfold.checkCallback(false), false); assert.deepEqual(f.calls, []);
  }
});

test("a held global command resolves the current leaf at execution and install cleanup removes both", () => {
  const f = commandFixture("preview"), otherCalls = [], otherReading = { canFoldAll: () => true, foldAll: () => { otherCalls.push("fold"); return true; } };
  assert.equal(f.fold.checkCallback(true), true);
  const next = { ...f.view, reading: otherReading, get currentMode() { return otherReading; } }; f.app.workspace.activeLeaf = { view: next };
  assert.equal(f.fold.checkCallback(false), true); assert.deepEqual(f.calls, []); assert.deepEqual(otherCalls, ["fold"]);
  f.dispose(); assert.deepEqual(f.commands, []);
});
