import assert from "node:assert/strict";
import {Compartment,EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {history,isolateHistory} from "@codemirror/commands";
export const original = '# Visible source Ω\r\n\r\nBefore TARGET λ and Target λ. Keep 😀.\r\n';
export const targetText = '---\r\naliases: [ "Target λ" ] # exact comment\r\n---\r\n# Destination Ω\r\n';
export const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

export function bulkSourceFixture(api, { reading = false, text = original } = {}) {
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
  Object.assign(app.vault, { getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"), getFileByPath: path => files.get(path) ?? null, getAbstractFileByPath: path => files.get(path) ?? null, getConfig: key => config.get(key),
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
