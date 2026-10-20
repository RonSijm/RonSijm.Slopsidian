import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth, isolateHistory } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, api;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "outgoing-visible-tests-"));
  const outfile = join(directory, "feature.mjs");
  await build({ stdin: { contents: 'export * from "./client/outgoing-mention-intent"; export * from "./client/outgoing-mention-authoring"; export {OutgoingPaneView} from "./client/outgoing-pane-view"; export {OutgoingLinks} from "./client/outgoing-links"; export {MarkdownView,Workspace} from "./client/workspace"; export {MetadataCache} from "./client/metadata"; export {Editor} from "./client/editor"; export {Events} from "./client/events"; export {FileManager} from "./client/file-manager"; export {TFile} from "./client/vault"; export {parseMarkdown,outgoingMentions} from "./client/markdown"; export {resolveLink} from "./client/links";', resolveDir: root }, outfile,
    bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  api = await import(pathToFileURL(outfile).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/outgoing-visible-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
const original = '# Visible source Ω\r\n\r\nBefore TARGET λ and Target λ. Keep 😀.\r\n';
const targetText = '---\r\naliases: [ "Target λ" ] # exact comment\r\n---\r\n# Destination Ω\r\n';
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

function fixture({ reading = false, text = original } = {}) {
  const files = new Map(), disk = new Map(), documents = new Map(), sessions = new Map(), reads = [], config = new Map([["useMarkdownLinks", false], ["newLinkFormat", "shortest"]]);
  const state = { owned: true, core: true, version: 0, updates: 0, tabs: 0, saves: 0, focused: null }, leaves = [];
  const app = { changingVault: false, vault: { rootPath: "visible-vault", readOnly: false }, core: { busy: false, isEnabled: () => state.core, run: action => Promise.resolve().then(action) }, pluginsChanged: async () => {} };
  app.workspace = Object.assign(new api.Events(), { sessions, isChangingFiles: false, isChangingLayout: false, activeLeaf: null,
    getLeavesOfType: () => leaves, getActiveViewOfType: () => app.workspace.activeLeaf?.view ?? null,
    setActiveLeaf(leaf) { this.activeLeaf = leaf; this.trigger("active-leaf-change", leaf); },
    activateLeaf() { state.saves++; throw new Error("Implicit save is forbidden"); },
    layoutChanged() { this.trigger("layout-change"); }, notifyEditor() { app.metadataCache.updateOpenDocuments(); this.trigger("editor-change"); },
    requestSaveLayout: async () => {}, viewTypeForExtension: () => "markdown",
    getLeaf(kind) { assert.equal(kind, "tab"); state.tabs++; const leaf = { id: "new-source-" + state.tabs, parent: {}, view: {}, updateHeader() {} }; leaf.setViewState = async request => {
      assert.deepEqual(request, { type: "markdown", state: { file: source.path, mode: "source", source: true }, active: true });
      await f.beforeOpen?.();
      const doc = sessions.get(source.path)?.document ?? await app.vault.readDocument(source.path), view = createView(doc, "source", leaf);
      app.workspace.layoutChanged(); app.workspace.setActiveLeaf(leaf); app.workspace.notifyEditor(); app.workspace.trigger("file-open", source);
      await f.afterVisible?.(view); return view;
    }; return leaf; },
  });
  const index = (file, content = disk.get(file.path).content, document = { file: { path: file.path }, ...disk.get(file.path) }) => {
    const prior = documents.get(file.path); documents.set(file.path, { text: content, document, cache: prior?.text === content ? prior.cache : api.parseMarkdown(content), missing: false });
  };
  const add = (path, content = "", hasBom = true) => { const file = new api.TFile(app.vault, { path, basename: path.split("/").at(-1).replace(/\.md$/i, ""), extension: path.split(".").at(-1), stat: { mtime: 1, ctime: 1, size: content.length } }); files.set(path, file); disk.set(path, { content, version: "v" + ++state.version, hasBom }); index(file); return file; };
  const source = add("Notes/Source.md", text), target = add("Targets/Destination.md", targetText);
  Object.assign(app.vault, { getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"), getFileByPath: path => files.get(path) ?? null, getConfig: key => config.get(key),
    async readDocument(path) { reads.push(path); const doc = { file: { path }, ...disk.get(path) }; await f.onRead?.(path, doc); return doc; } });
  app.metadataCache = { getDocument: path => documents.get(path) ?? null, getFileCache: file => documents.get(file.path)?.cache ?? null,
    resolveReference: (reference, path) => api.resolveLink([...files.values()], reference.link, path, reference.kind === "markdown" || reference.kind === "reference"),
    updateOpenDocuments() { state.updates++; for (const [path, session] of sessions) index(files.get(path), session.text, session.document); } };
  app.fileManager = new api.FileManager(app);
  function createView(document, mode = "preview", leaf = { id: "reading-source", parent: {}, updateHeader() {} }) {
    const editable = new Compartment(), cm = { composing: false, dom: { isConnected: true }, state: EditorState.create({ doc: sessions.get(source.path)?.text ?? document.content, extensions: [history(), EditorState.lineSeparator.of("\r\n"), editable.of(EditorView.editable.of(mode === "source"))] }) };
    const editor = Object.create(api.Editor.prototype), session = sessions.get(source.path) ?? { originRoot: app.vault.rootPath, text: document.content, document, isSaving: false, isReloading: false, dirty: false, save() { state.saves++; }, acceptDocument(document) { this.document = document; this.text = document.content; this.dirty = false; } };
    sessions.set(source.path, session); editor.cm = cm;
    cm.dispatch = spec => { const transaction = spec.startState ? spec : cm.state.update(spec); cm.state = transaction.state; if (transaction.docChanged) { session.text = editor.getValue(); session.dirty = session.text !== session.document.content; app.metadataCache.updateOpenDocuments(); } };
    editor.setEditable = value => cm.dispatch({ effects: editable.reconfigure(EditorView.editable.of(value)) }); editor.bindFoldState = () => {}; editor.closeSearch = () => {}; editor.releaseReadingSelection = () => {}; editor.focus = () => { state.focused = editor; };
    const view = Object.create(api.MarkdownView.prototype); Object.assign(view, { app, leaf, file: source, editor, session, mode, sourceEditing: mode === "source", contextMenus: new Set(), reading: { closeSearch() {}, render() {} } }); Object.defineProperty(view, "isLoaded", { value: true, writable: true });
    leaf.workspace = app.workspace; leaf.view = view; leaves.push(leaf); return view;
  }
  const f = { app, source, target, leaves, files, disk, documents, sessions, reads, config, state, add, index, createView,
    get view() { return leaves[0]?.view ?? null; },
    range(word = "TARGET λ") { const from = (sessions.get(source.path)?.text ?? text).indexOf(word); return { from, to: from + word.length }; },
    authority() { return api.outgoingMentionIntentAuthority(app, source, sessions.get(source.path)?.text ?? text); },
    review() { return api.outgoingMentionIntentReview(api.outgoingMentionIntentEnvironmentFor(f.authority()), target, f.range()); },
    apply(review = f.review()) { assert.ok(review); return api.linkOutgoingMentionInSource(review, () => state.owned); },
    dirtySuffix() { const cm = f.view.editor.cm; cm.dispatch({ changes: { from: cm.state.doc.length, insert: "Earlier dirty prose Ω.\r\n" }, annotations: isolateHistory.of("full"), userEvent: "input.type" }); },
  };
  if (reading) { createView(documents.get(source.path).document); app.workspace.activeLeaf = leaves[0]; }
  return f;
}

function realMetadata(f) {
  const events = new api.Events(); Object.assign(f.app.vault, { on: events.on.bind(events), trigger() {}, setSnapshot() {}, notifyFileChanged() {}, getAllLoadedFiles: () => [...f.files.values()], getAbstractFileByPath: path => f.files.get(path) ?? null });
  f.app.workspace.acceptExternalDocuments = api.Workspace.prototype.acceptExternalDocuments;
  f.app.dotNet = { invokeMethodAsync: async () => {} }; f.app.notifyEditor = async () => f.app.metadataCache.updateOpenDocuments();
  const metadata = new api.MetadataCache(f.app); metadata.root = f.app.vault.rootPath; metadata.documents = new Map(f.documents); f.app.metadataCache = metadata;
  for (const entry of metadata.documents.values()) { entry.dirty = false; entry.outgoing = []; }
  const run = metadata.refresh.bind(metadata);
  return { metadata, async refresh() {
    const previousFetch = globalThis.fetch, payload = { root: f.app.vault.rootPath, revision: 2, documents: [...f.disk].map(([path, document]) => ({ file: { path }, ...document })), errors: [] };
    globalThis.fetch = async path => { await f.onMetadataRead?.(path); return new Response(JSON.stringify(String(path).startsWith("/api/metadata/documents") ? payload : { root: f.app.vault.rootPath, files: [], folders: [] }), { status: 200 }); };
    try { await run(); } finally { globalThis.fetch = previousFetch; }
  } };
}

test("closed notes explicitly open a visible Source owner, leave disk intact and isolate shared Undo/Redo", async () => {
  for (const markdown of [false, true]) {
    const f = fixture(); f.config.set("useMarkdownLinks", markdown); f.config.set("newLinkFormat", markdown ? "relative" : "shortest");
    const review = f.review(); assert.ok(review); assert.equal(f.state.tabs, 0); assert.deepEqual(f.reads, []); await f.apply(review);
    const view = f.view, linked = markdown ? "[TARGET λ](../Targets/Destination.md)" : "[[Destination|TARGET λ]]";
    assert.equal(view.editor.getValue(), original.replace("TARGET λ", linked)); assert.equal(view.getEditingMode(), "source"); assert.equal(f.app.workspace.activeLeaf, view.leaf); assert.equal(f.state.focused, view.editor);
    assert.equal(f.state.saves, 0); assert.equal(f.disk.get(f.source.path).content, original); assert.equal(f.disk.get(f.source.path).hasBom, true); assert.equal(undoDepth(view.editor.cm.state), 1);
    assert.equal(undo(view.editor.cm), true); assert.equal(view.editor.getValue(), original); assert.equal(redo(view.editor.cm), true); assert.ok(view.editor.getValue().includes(linked));
  }
});
test("Reading transitions keep the same actual editor/session/CM/document and earlier dirty history without saving", async () => {
  const f = fixture({ reading: true }); f.dirtySuffix(); const view = f.view, session = view.session, editor = view.editor, cm = editor.cm, document = session.document, dirty = editor.getValue();
  assert.equal(undoDepth(cm.state), 1); await f.apply(); assert.equal(f.state.tabs, 0); assert.equal(f.state.saves, 0); assert.equal(f.view, view); assert.equal(view.editor, editor); assert.equal(view.session, session); assert.equal(view.session.document, document);
  assert.equal(view.getEditingMode(), "source"); assert.equal(undoDepth(cm.state), 2); undo(cm); assert.equal(editor.getValue(), dirty); undo(cm); assert.equal(editor.getValue(), original); assert.equal(f.disk.get(f.source.path).content, original);
});
test("actual metadata unchanged-document fast path allows distinct initial metadata/session owners and keeps both leases", async () => {
  const f = fixture({ reading: true }), entry = f.documents.get(f.source.path); entry.dirty = false;
  f.view.session.document = { ...entry.document };
  // Same-version reload or a clean close/reopen can create a distinct physical
  // VaultDocument. The real cache intentionally keeps its unchanged prior entry.
  api.MetadataCache.prototype.updateOpenDocuments.call({ app: f.app, root: f.app.vault.rootPath, documents: f.documents });
  assert.equal(f.documents.get(f.source.path), entry); assert.notEqual(entry.document, f.view.session.document);
  const review = f.review(); assert.ok(review, "both valid owners must be captured independently");
  assert.equal(review.document, f.view.session.document); assert.equal(review.metadataDocument, entry.document);
  await f.apply(review); assert.equal(f.view.getEditingMode(), "source"); assert.ok(f.view.editor.getValue().includes("[[Destination|TARGET λ]]")); assert.equal(f.state.saves, 0);
  for (const change of [fresh => fresh.view.session.document = { ...fresh.view.session.document }, fresh => fresh.documents.get(fresh.source.path).document = { ...fresh.documents.get(fresh.source.path).document }]) {
    const fresh = fixture({ reading: true }); fresh.view.session.document = { ...fresh.view.session.document }; const choice = fresh.review(); assert.ok(choice); change(fresh);
    await assert.rejects(fresh.apply(choice), /changed/); assert.deepEqual(fresh.reads, []); assert.equal(fresh.view.getMode(), "preview");
  }
});
test("actual MetadataCache clean refresh keeps the same-version session owner distinct and Reading authoring available", async () => {
  const f = fixture({ reading: true }), oldSessionDocument = f.view.session.document, oldCache = f.documents.get(f.source.path).cache, host = realMetadata(f);
  await host.refresh(); const entry = host.metadata.getDocument(f.source.path);
  assert.equal(f.view.session.document, oldSessionDocument, "the real Workspace preserves its same-version saved owner"); assert.notEqual(entry.document, oldSessionDocument); assert.equal(entry.cache, oldCache);
  host.metadata.updateOpenDocuments(); assert.notEqual(host.metadata.getDocument(f.source.path).document, oldSessionDocument, "the real unchanged-entry fast path keeps both legitimate owners distinct");
  const review = f.review(); assert.ok(review); assert.equal(review.document, oldSessionDocument); assert.equal(review.metadataDocument, entry.document);
  // A queued editor notification can still owe a dirty-flag update while the
  // unchanged draft/base values are already current. The real cache then
  // projects its captured session document during the deliberate mode change.
  entry.dirty = true; let sourceReads = 0, projectedDuringTransition = false;
  f.onRead = path => { if (path === f.source.path && ++sourceReads === 2) { projectedDuringTransition = host.metadata.getDocument(f.source.path).document === review.document; assert.notEqual(review.metadataDocument, review.document); } };
  await f.apply(review); assert.equal(f.view.session.document, oldSessionDocument); assert.equal(f.view.getEditingMode(), "source"); assert.ok(f.view.editor.getValue().includes("[[Destination|TARGET λ]]")); assert.equal(f.state.saves, 0);
  assert.equal(projectedDuringTransition, true, "only the captured saved-session owner becomes metadata during the visible transition");
});
test("distinct initial saved owners reject either same-reference field mutation or differing capture values before IO", async () => {
  for (const owner of ["metadata", "session"]) for (const field of ["version", "content", "hasBom", "path"]) {
    const f = fixture({ reading: true }); f.view.session.document = { ...f.view.session.document, file: { path: f.source.path } };
    const review = f.review(); assert.ok(review); const document = owner === "metadata" ? f.documents.get(f.source.path).document : f.view.session.document;
    if (field === "path") document.file.path = "Moved.md"; else if (field === "hasBom") document.hasBom = false; else document[field] += "changed";
    assert.equal(f.review(), null, "different initial owner values cannot be captured"); await assert.rejects(f.apply(review), /changed/); assert.deepEqual(f.reads, []); assert.equal(f.view.getMode(), "preview");
  }
});
test("both captured source-document owners reject every in-place mutation during either checked-read boundary", async () => {
  for (const phase of [1, 2]) for (const owner of ["metadata", "session"]) for (const field of ["version", "content", "hasBom", "path"]) {
    const f = fixture({ reading: true }); f.view.session.document = { ...f.view.session.document, file: { path: f.source.path } }; const review = f.review(); assert.ok(review);
    const gate = deferred(), seen = deferred(); let count = 0; f.onRead = path => { if (path === f.target.path && ++count === phase) { seen.resolve(); return gate.promise; } };
    const pending = f.apply(review); await seen.promise; const document = owner === "metadata" ? review.metadataDocument : review.document;
    if (field === "path") document.file.path = "Moved.md"; else if (field === "hasBom") document.hasBom = false; else document[field] += "changed";
    gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(f.view.editor.getValue(), original); assert.equal(f.state.saves, 0); assert.equal(undoDepth(f.view.editor.cm.state), 0);
  }
});
test("readonly/malformed/oversize/stale closed metadata and busy Source owners offer no visible-open action or IO", () => {
  for (const change of [f => f.app.vault.readOnly = true, f => f.app.changingVault = true, f => f.app.core.busy = true, f => f.state.core = false, f => f.config.set("newLinkFormat", "invalid"), f => f.config.set("useMarkdownLinks", "true"), f => f.documents.get(f.source.path).text += "dirty closed metadata", f => f.documents.get(f.source.path).missing = true]) {
    const f = fixture(); change(f); assert.equal(f.review(), null); assert.deepEqual(f.reads, []); assert.equal(f.state.tabs, 0);
  }
  const large = fixture({ text: "TARGET λ " + "x".repeat(1_000_000) }); assert.equal(large.review(), null); assert.deepEqual(large.reads, []);
  const source = fixture({ reading: true }); source.view.setEditingMode("source"); source.view.editor.cm.composing = true; assert.equal(source.review(), null); assert.deepEqual(source.reads, []);
});
test("physical source/target mismatches refuse before allocating a Source tab and preserve exact bytes", async () => {
  for (const change of [f => f.disk.get(f.source.path).version += "new", f => f.disk.get(f.source.path).content += "new", f => f.disk.get(f.source.path).hasBom = false, f => f.disk.get(f.target.path).version += "new", f => f.disk.get(f.target.path).content += "new", f => f.disk.get(f.target.path).hasBom = false]) {
    const f = fixture(), review = f.review(); change(f); const bytes = structuredClone([...f.disk]); await assert.rejects(f.apply(review), /changed/); assert.equal(f.state.tabs, 0); assert.equal(f.sessions.size, 0); assert.deepEqual([...f.disk], bytes);
  }
});
test("held preflight rejects changed roots/paths/targets/preferences/pane leases and readonly before opening", async () => {
  for (const change of [f => f.app.vault.rootPath = "other", f => f.source.path = "Renamed.md", f => f.add(f.target.path, targetText), f => f.config.set("useMarkdownLinks", true), f => f.state.owned = false, f => f.app.vault.readOnly = true, f => f.documents.get(f.target.path).document = { ...f.documents.get(f.target.path).document }]) {
    const f = fixture(), review = f.review(), gate = deferred(); f.onRead = path => path === f.target.path ? gate.promise : undefined;
    const pending = f.apply(review); await Promise.resolve(); change(f); gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(f.state.tabs, 0); assert.equal(f.sessions.size, 0);
  }
});
test("deferred closed opens reject same-text CM/editor/session/document replacements after first visible owner", async () => {
  for (const change of [
    (f, view) => view.editor.cm.state = EditorState.create({ doc: view.editor.getValue(), extensions: [history(), EditorState.lineSeparator.of("\r\n")] }),
    (f, view) => view.editor = Object.assign(Object.create(api.Editor.prototype), { cm: view.editor.cm }),
    (f, view) => view.editor.cm = { ...view.editor.cm },
    (f, view) => { view.session = { ...view.session }; f.sessions.set(f.source.path, view.session); },
    (f, view) => view.session.document = { ...view.session.document },
    f => f.config.set("newLinkFormat", "relative"), f => f.state.owned = false,
  ]) {
    const f = fixture(), gate = deferred(), seen = deferred(); f.afterVisible = async view => { seen.resolve(view); await gate.promise; };
    const pending = f.apply(), view = await seen.promise; change(f, view); gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(view.editor.getValue(), original); assert.equal(f.disk.get(f.source.path).content, original); assert.equal(f.state.saves, 0);
  }
});
test("Reading owner resets during held preflight refuse without changing Reading mode, dirty prose or history", async () => {
  for (const change of [f => f.view.editor.cm.state = EditorState.create({ doc: f.view.editor.getValue(), extensions: [history()] }), f => f.view.session.document = { ...f.view.session.document }, f => f.dirtySuffix()]) {
    const f = fixture({ reading: true }), review = f.review(), gate = deferred(); f.onRead = path => path === f.target.path ? gate.promise : undefined;
    const pending = f.apply(review); await Promise.resolve(); change(f); const before = f.view.editor.getValue(), depth = undoDepth(f.view.editor.cm.state); gate.resolve(); await assert.rejects(pending, /changed/);
    assert.equal(f.view.getMode(), "preview"); assert.equal(f.view.editor.getValue(), before); assert.equal(undoDepth(f.view.editor.cm.state), depth); assert.equal(f.state.saves, 0);
  }
});
test("post-open checked reads reject target/source physical races and concurrent source edits", async () => {
  for (const change of [f => f.disk.get(f.source.path).content += "new", f => f.disk.get(f.target.path).hasBom = false]) {
    const f = fixture(); f.afterVisible = () => change(f); await assert.rejects(f.apply(), /changed/); assert.equal(f.view.editor.getValue(), original); assert.equal(f.state.saves, 0);
  }
  for (const change of [f => f.dirtySuffix(), f => f.view.setEditingMode("preview", false), f => f.state.owned = false]) {
    const f = fixture(), gate = deferred(), seen = deferred(); let count = 0; f.onRead = path => { if (path === f.target.path && ++count === 2) { seen.resolve(); return gate.promise; } };
    const pending = f.apply(); await seen.promise; change(f); const before = f.view.editor.getValue(); gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(f.view.editor.getValue(), before); assert.equal(f.state.saves, 0);
  }
});
test("a bounded intent expires during opening and cannot be reused after success or refusal", async () => {
  const f = fixture(), review = f.review(), gate = deferred(), seen = deferred(), now = Date.now; let elapsed = 0;
  Date.now = () => now() + elapsed;
  try { f.beforeOpen = async () => { seen.resolve(); await gate.promise; }; const pending = f.apply(review); await seen.promise; elapsed = 5_001; gate.resolve(); await assert.rejects(pending, /changed/); await assert.rejects(f.apply(review), /changed/); assert.equal(f.view.editor.getValue(), original); }
  finally { Date.now = now; }
  const good = fixture(), choice = good.review(); await good.apply(choice); await assert.rejects(good.apply(choice), /changed/); assert.equal(good.state.tabs, 1); assert.equal(undoDepth(good.view.editor.cm.state), 1);
});
test("a failed visible Source load never writes either physical document or replaces dirty existing peers", async () => {
  const f = fixture(); f.beforeOpen = () => { throw new Error("Failed source load"); }; await assert.rejects(f.apply(), /Failed source load/); assert.equal(f.sessions.size, 0); assert.equal(f.disk.get(f.source.path).content, original); assert.equal(f.disk.get(f.target.path).content, targetText); assert.equal(f.state.saves, 0);
});
test("one thousand intent row witnesses share source syntax and never generate links per row", () => {
  const text = Array.from({ length: 1_000 }, (_, index) => `${index}: Target λ.`).join("\r\n"), f = fixture({ text });
  let generations = 0; f.app.fileManager.generateMarkdownLink = () => { generations++; throw new Error("activation only"); };
  const authority = f.authority(), environment = api.outgoingMentionIntentEnvironmentFor(authority), matches = api.outgoingMentions(text, f.documents.get(f.source.path).cache, f.source.path, [{ path: f.target.path, basename: f.target.basename, cache: f.documents.get(f.target.path).cache }])[0].matches;
  assert.equal(matches.length, 1_000); assert.ok(matches.every(match => api.outgoingMentionIntentReview(environment, f.target, match))); assert.equal(generations, 0); assert.deepEqual(f.reads, []); assert.equal(f.state.tabs, 0);
});
test("visible intents refuse unsupported structural markers and read-only forced handlers before authoring IO", async () => {
  const text = '# Target λ\r\n\r\nText ^target\r\n', f = fixture({ text }); const target = f.add("Syntax.md", '---\naliases: ["# Target λ", "^target"]\n---\n');
  const env = api.outgoingMentionIntentEnvironmentFor(f.authority()); for (const label of ["# Target λ", "^target"]) { const from = text.indexOf(label); assert.equal(api.outgoingMentionIntentReview(env, target, { from, to: from + label.length }), null); }
  const safe = fixture(), review = safe.review(); safe.app.vault.readOnly = true; await assert.rejects(safe.apply(review), /changed/); assert.deepEqual(safe.reads, []); assert.equal(safe.state.tabs, 0);
});

function paneFixture(options) {
  const previousDocument = globalThis.document, previousElement = globalThis.HTMLElement;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.disabled = false; this.root = false; this.listeners = new Map(); this.classList = { add() {}, toggle() {} }; }
    get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
    append(...nodes) { for (const node of nodes) { if (typeof node === "string") continue; if (node.tagName === "#FRAGMENT") this.append(...node.children); else { node.parent = this; this.children.push(node); } } }
    replaceChildren(...nodes) { this.children.forEach(child => child.parent = null); this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    appendChild(node) { this.append(node); return node; }
    addEventListener(type, listener) { const listeners = this.listeners.get(type) ?? []; listeners.push(listener); this.listeners.set(type, listeners); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    focus() { globalThis.document.activeElement = this; }
    querySelectorAll(selector) { const all = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]); return selector === "*" ? all : all.filter(child => child.tagName === "BUTTON" && (!selector.includes(":disabled") || !child.disabled)); }
  }
  globalThis.document = { activeElement: null, createElement: tag => new Element(tag), createElementNS: (ns, tag) => new Element(tag), createDocumentFragment: () => new Element("#fragment") }; globalThis.HTMLElement = Element;
  const f = fixture(options), pane = Object.create(api.OutgoingPaneView.prototype), container = new Element("div"); container.root = true;
  Object.assign(pane, { app: f.app, leaf: { parent: {} }, sourceRoot: f.app.vault.rootPath, containerEl: container, contentEl: container, options: { file: f.source.path, followActiveFile: false, linksCollapsed: false, unlinkedCollapsed: false },
    snapshot: null, signature: "", revision: 0, request: 0, navigationToken: 0, queued: false, opening: false, message: "", mentionActions: new Map(), authoringAuthority: null, intentAuthority: null, mentionTargets: [], authoringWatch: null,
    follow: new Element("input"), caption: new Element("p"), status: new Element("p"), results: new Element("div") });
  container.append(pane.results); pane.leaf.view = pane; Object.defineProperty(pane, "isLoaded", { value: true, writable: true });
  f.app.workspace.on("layout-change", () => pane.schedule()); f.app.workspace.on("editor-change", () => pane.schedule());
  f.pane = pane; f.button = () => pane.results.querySelectorAll("button").find(button => button.dataset.outgoingMentionLink === f.target.path);
  f.cleanup = async () => { pane.isLoaded = false; pane.cancelAuthoringWatch(); await Promise.resolve(); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; if (previousElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousElement; };
  return f;
}
test("actual pane render offers Link in Source and survives its intentional rerender without renewing old buttons", async () => {
  for (const reading of [false, true]) {
    const f = paneFixture({ reading });
    try {
      await f.pane.refresh(); const button = f.button(), revision = f.pane.snapshot.id; assert.equal(button.textContent, "Link in Source"); assert.equal(button.disabled, false);
      await f.pane.linkMention(button); await Promise.resolve(); await f.pane.refresh(); assert.ok(f.pane.snapshot.id > revision); assert.equal(button.isConnected, false); assert.equal(f.view.getEditingMode(), "source"); assert.ok(f.view.editor.getValue().includes("[[Destination|TARGET λ]]"));
      undo(f.view.editor.cm); await f.pane.refresh(); const fresh = f.button(); assert.equal(fresh.textContent, "Link mention"); const reads = f.reads.length;
      await f.pane.linkMention(button); assert.equal(f.reads.length, reads); assert.equal(f.view.editor.getValue(), original);
    } finally { await f.cleanup(); }
  }
});
test("actual pane cancels a visible-open intent when state, parent, source CM or read-only authority changes", async () => {
  for (const change of [f => f.pane.options = { ...f.pane.options }, f => f.pane.options.linksCollapsed = true, f => f.pane.leaf.parent = {}, f => f.pane.navigationToken++, f => f.app.vault.readOnly = true, f => f.view.editor.cm.state = EditorState.create({ doc: original, extensions: [history(), EditorState.lineSeparator.of("\r\n")] })]) {
    const f = paneFixture(), seen = deferred(), gate = deferred();
    try { await f.pane.refresh(); f.afterVisible = async () => { seen.resolve(); await gate.promise; }; const pending = f.pane.linkMention(f.button()); await seen.promise; change(f); gate.resolve(); await pending; assert.equal(f.view.editor.getValue(), original); assert.match(f.pane.message, /changed/); assert.equal(f.state.saves, 0); }
    finally { gate.resolve(); await f.cleanup(); }
  }
});
test("actual pane refresh retires same-text Reading CM lifetimes before a deferred click can open Source", async () => {
  const f = paneFixture({ reading: true });
  try { await f.pane.refresh(); const button = f.button(); f.view.editor.cm.state = EditorState.create({ doc: original, extensions: [history()] }); await f.pane.refresh(); assert.equal(button.isConnected, false); await f.pane.linkMention(button); assert.equal(f.view.getMode(), "preview"); assert.deepEqual(f.reads, []); assert.equal(f.state.tabs, 0); }
  finally { await f.cleanup(); }
});
test("actual clean metadata refresh retires old Reading rows while rebinding distinct current document owners", async () => {
  const f = paneFixture({ reading: true });
  try {
    const host = realMetadata(f); await f.pane.refresh(); const button = f.button(), old = f.pane.mentionActions.get(button.dataset.outgoingKey), revision = f.pane.snapshot.id;
    await host.refresh(); await f.pane.refresh(); const current = f.pane.mentionActions.get(f.button().dataset.outgoingKey);
    assert.ok(current); assert.ok(f.pane.snapshot.id > revision); assert.equal(button.isConnected, false); assert.notEqual(current.metadataDocument, old.metadataDocument); assert.equal(current.document, old.document);
    await assert.rejects(api.linkOutgoingMentionInSource(old, () => true), /changed/); await f.pane.linkMention(button); assert.deepEqual(f.reads, []); assert.equal(f.view.getMode(), "preview");
    await f.pane.linkMention(f.button()); assert.equal(f.view.getEditingMode(), "source"); assert.ok(f.view.editor.getValue().includes("[[Destination|TARGET λ]]")); assert.equal(f.state.saves, 0);
  } finally { await f.cleanup(); }
});
test("Reading save/reload settlement wakes current intent without text reads or permanent Reading polling", async () => {
  for (const field of ["isSaving", "isReloading"]) {
    const f = paneFixture({ reading: true }), oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout, timers = new Map(); let serial = 0;
    globalThis.setTimeout = callback => { const id = ++serial; timers.set(id, callback); return id; }; globalThis.clearTimeout = id => timers.delete(id);
    try {
      f.view.session[field] = true; await f.pane.refresh(); assert.equal(f.button().disabled, true); assert.equal(timers.size, 1);
      let reads = 0; const get = f.view.editor.getValue.bind(f.view.editor); f.view.editor.getValue = () => { reads++; return get(); };
      const tick = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); };
      tick(); assert.equal(reads, 0, "the Reading busy-owner settlement timer checks identities and flags only"); assert.equal(timers.size, 1);
      f.view.session[field] = false; f.view.session.document = { ...f.view.session.document }; tick(); await Promise.resolve(); await Promise.resolve();
      assert.equal(f.button().disabled, false); assert.equal(f.button().textContent, "Link in Source"); assert.equal(timers.size, 0); assert.deepEqual(f.reads, []);
      f.app.vault.readOnly = true; await f.pane.refresh(); assert.equal(timers.size, 0); assert.equal(f.pane.authoringWatch, null);
    } finally { await f.cleanup(); globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
  }
});
test("legacy Reading save/reload settlement rebinds current intent and refuses retired actions without permanent polling", async () => {
  for (const field of ["isSaving", "isReloading"]) {
    const f = paneFixture({ reading: true }), oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout, timers = new Map(); let serial = 0;
    globalThis.setTimeout = callback => { const id = ++serial; timers.set(id, callback); return id; }; globalThis.clearTimeout = id => timers.delete(id);
    const legacy = new api.OutgoingLinks(f.app); legacy.panel = globalThis.document.createElement("section"); legacy.panel.root = true; legacy.pinnedFile = f.source.path; legacy.unlinkedCollapsed = false;
    f.app.vault.getAbstractFileByPath = path => f.files.get(path) ?? null; f.app.workspace.getActiveFile = () => f.source;
    const button = () => legacy.panel.querySelectorAll("button").find(node => node.dataset.outgoingMentionLink === f.target.path);
    try {
      legacy.render(); const old = button(); assert.equal(old.textContent, "Link in Source");
      f.view.session[field] = true; legacy.render(); assert.equal(button().disabled, true); assert.equal(timers.size, 1);
      let reads = 0; const get = f.view.editor.getValue.bind(f.view.editor); f.view.editor.getValue = () => { reads++; return get(); };
      const tick = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); };
      tick(); assert.equal(reads, 0); assert.equal(timers.size, 1);
      f.view.session[field] = false; f.view.session.document = { ...f.view.session.document }; tick(); await Promise.resolve(); await Promise.resolve();
      assert.equal(button().disabled, false); assert.equal(button().textContent, "Link in Source"); assert.equal(timers.size, 0); assert.equal(old.isConnected, false);
      old.listeners.get("click")[0](); for (let index = 0; index < 6; index++) await Promise.resolve(); assert.deepEqual(f.reads, []); assert.equal(f.view.getMode(), "preview");
      const view = f.view;
      for (const change of [() => f.app.vault.readOnly = true, () => view.isLoaded = false, () => view.leaf.view = {}, () => view.editor.cm.dom.isConnected = false]) {
        change(); view.session[field] = true; legacy.render(); assert.equal(timers.size, 0); assert.equal(legacy.authoringWatch, null);
        f.app.vault.readOnly = false; view.isLoaded = true; view.leaf.view = view; view.editor.cm.dom.isConnected = true; view.session[field] = false;
      }
    } finally { legacy.cancelAuthoringWatch(); await f.cleanup(); globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
  }
});

function navigationFixture({ reading = false, follow = false } = {}) {
  const text = "# Source\r\n\r\n[[Destination#Place]] and [[Destination#^block]].\r\n", f = paneFixture({ reading, text });
  const destinationText = targetText + "\r\n## Place\r\n\r\nBlock paragraph ^block\r\n";
  f.disk.get(f.target.path).content = destinationText; f.index(f.target); f.pane.options.followActiveFile = follow;
  const host = realMetadata(f); host.metadata.refresh = () => host.refresh(); host.metadata.on("finished", () => f.pane.schedule());
  const targetEditor = Object.assign(Object.create(api.Editor.prototype), { cm: { state: EditorState.create({ doc: destinationText, extensions: [EditorState.lineSeparator.of("\r\n")] }) } });
  const targetView = Object.assign(Object.create(api.MarkdownView.prototype), { file: f.target, editor: targetEditor, mode: "source", sourceEditing: true,
    setMode(mode) { this.mode = mode; }, revealLine(line) { f.state.revealed = line; } });
  const leaf = { id: "navigation-target", view: targetView, async openFile(file) {
    f.state.opens++; assert.equal(file, f.target); f.app.workspace.activeLeaf = leaf; f.app.workspace.trigger("active-leaf-change", leaf); f.pane.syncTarget();
  } }; targetView.leaf = leaf; f.state.opens = 0;
  f.app.workspace.getLeaf = mode => { assert.equal(mode, false); return leaf; };
  f.app.workspace.getActiveFile = () => f.app.workspace.activeLeaf?.view.file ?? f.source;
  f.navButton = (reference = "Destination#Place") => f.pane.results.querySelectorAll("button").find(button => button.dataset.outgoingReference === reference);
  Object.defineProperty(f.app, "markdownView", { get: () => targetView });
  f.host = host;
  return f;
}

test("real metadata refresh can retire authoring-only rows without cancelling following-heading or fixed closed-source block navigation", async () => {
  for (const follow of [true, false]) {
    const f = navigationFixture({ follow });
    try {
      await f.host.refresh(); await f.pane.refresh(); const snapshot = f.pane.snapshot, button = f.navButton(follow ? "Destination#Place" : "Destination#^block");
      assert.equal(f.pane.navigationWitness(snapshot, button)(), true, "initial navigation lease is valid");
      await f.pane.navigate(button, false);
      assert.equal(f.state.opens, 1); assert.ok(f.pane.snapshot.id > snapshot.id); assert.equal(button.isConnected, false, "the real metadata refresh rebuilt authoring controls while navigation retained its own witness");
      const cache = f.host.metadata.getFileCache(f.target), expected = follow ? cache.headings.find(heading => heading.heading === "Place").position.start.line : cache.blocks.block.position.start.line;
      assert.equal(f.state.revealed, expected); assert.equal(f.pane.options.file, follow ? f.target.path : f.source.path); assert.equal(f.pane.opening, false);
    } finally { await f.cleanup(); }
  }
});
test("navigation's separate metadata lease still refuses changed CM/session/destination/options/preferences/root owners", async () => {
  for (const change of [
    f => f.view.editor.cm.state = EditorState.create({ doc: f.view.editor.getValue(), extensions: [history(), EditorState.lineSeparator.of("\r\n")] }),
    f => f.view.session.document = { ...f.view.session.document },
    f => f.view.session.document.version += "changed", f => f.view.session.document.content += "changed", f => f.view.session.document.hasBom = false,
    f => f.view.session.document.file.path = "Moved.md", f => f.dirtySuffix(),
    f => { f.view.session = { ...f.view.session }; f.sessions.set(f.source.path, f.view.session); },
    f => f.add(f.target.path, f.disk.get(f.target.path).content),
    f => f.pane.options.linksCollapsed = true, f => f.pane.options = { ...f.pane.options },
    f => f.config.set("useMarkdownLinks", true), f => f.app.vault.rootPath = "changed-root",
  ]) {
    const f = navigationFixture({ reading: true }), gate = deferred(), seen = deferred();
    try {
      await f.host.refresh(); await f.pane.refresh(); f.onMetadataRead = path => { if (String(path).startsWith("/api/metadata/documents")) { seen.resolve(); return gate.promise; } };
      const pending = f.pane.navigate(f.navButton(), false); await seen.promise; change(f); gate.resolve(); await pending; assert.equal(f.state.opens, 0); assert.equal(f.state.revealed, undefined);
    } finally { gate.resolve(); await f.cleanup(); }
  }
});
test("legacy heading/block navigation tolerates its own metadata-only authoring rerender without changing follow behavior", async () => {
  for (const reference of ["Destination#Place", "Destination#^block"]) {
    const f = navigationFixture(), legacy = new api.OutgoingLinks(f.app); legacy.panel = globalThis.document.createElement("section"); legacy.panel.root = true; legacy.pinnedFile = f.source.path;
    try {
      await f.host.refresh(); await f.pane.refresh(); legacy.render(); const revision = legacy.revision;
      f.host.metadata.on("finished", () => legacy.requestUpdate());
      const link = f.pane.snapshot.links.find(link => link.reference.link === reference); await legacy.follow(link, f.source.path, false);
      assert.equal(f.state.opens, 1); assert.ok(legacy.revision > revision); const cache = f.host.metadata.getFileCache(f.target);
      assert.equal(f.state.revealed, reference.includes("^block") ? cache.blocks.block.position.start.line : cache.headings.find(heading => heading.heading === "Place").position.start.line);
    } finally { legacy.cancelAuthoringWatch(); await f.cleanup(); }
  }
});
