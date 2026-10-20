import { EditorState } from "@codemirror/state";
import { history, isolateHistory } from "@codemirror/commands";

export const original = '---\r\n# Source comment λ\r\nopaque: { keep: true }\r\n---\r\n# Mentions\r\n\r\nBefore TARGET λ and Target λ. Keep 😀.\r\n\r\n`Target λ` and \\Target λ stay literal.\r\n[[Existing]] ![[Image.png]]\r\n';
export const targetText = '---\r\naliases: [ "Target λ", "Friendly 😀" ] # target comment\r\n---\r\n# Destination\r\n';
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

export function mentionBulkFixture(api, text = original) {
  const files = new Map(), disk = new Map(), documents = new Map(), sessions = new Map(), reads = [], transactions = [], config = new Map([["useMarkdownLinks", false], ["newLinkFormat", "shortest"]]);
  const state = { owned: true, core: true, version: 0, updates: 0, opens: 0, saves: 0 };
  const app = { changingVault: false, vault: { rootPath: "mention-vault", readOnly: false }, core: { busy: false, isEnabled: () => state.core, async run(callback) { return callback(); } }, workspace: { sessions, isChangingFiles: false, isChangingLayout: false } };
  const index = (file, content = disk.get(file.path).content) => documents.set(file.path, { text: content, document: { file: { path: file.path }, ...disk.get(file.path) }, cache: api.parseMarkdown(content), missing: false });
  const add = (path, content = "", hasBom = true) => { const file = new api.TFile(app.vault, { path, basename: path.split("/").at(-1).replace(/\.md$/i, ""), extension: path.split(".").at(-1), stat: { mtime: 1, ctime: 1, size: content.length } }); files.set(path, file); disk.set(path, { content, version: "v" + ++state.version, hasBom }); index(file); return file; };
  const source = add("Notes/Source.md", text), target = add("Targets/Destination.md", targetText); add("Existing.md"); add("Image.png");
  const editor = Object.create(api.Editor.prototype), cm = { composing: false, dom: { isConnected: true }, state: EditorState.create({ doc: text, extensions: [history(), EditorState.lineSeparator.of("\r\n")] }) };
  let session;
  cm.dispatch = spec => { const transaction = spec.startState ? spec : cm.state.update(spec); transactions.push(transaction); cm.state = transaction.state; if (session) { session.text = editor.getValue(); index(source, session.text); } };
  editor.cm = cm;
  session = { originRoot: app.vault.rootPath, text, isReloading: false, isSaving: false, document: documents.get(source.path).document };
  sessions.set(source.path, session);
  const view = Object.assign(Object.create(api.MarkdownView.prototype), { file: source, editor, session, mode: "source", editingMode: "source", leaf: {}, getMode() { return this.mode; }, getEditingMode() { return this.editingMode; } });
  Object.defineProperties(view, { isLoaded: { value: true, writable: true }, savedDocument: { get() { return this.session?.document; } } }); view.leaf.view = view; view.leaf.id = "bulk-source";
  Object.assign(app.vault, { getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"), getFileByPath: path => files.get(path) ?? null, getAbstractFileByPath: path => files.get(path) ?? null, getConfig: key => config.get(key),
    async readDocument(path) { reads.push(path); await f.onRead?.(path); return { file: { path }, ...disk.get(path) }; }, async modify() { state.saves++; throw new Error("Bulk linking must not write files"); } });
  Object.assign(app.workspace, { getLeavesOfType: () => [{ view }], getActiveViewOfType: () => view, getActiveFile: () => source, viewTypeForExtension: () => "markdown", getLeaf() { state.opens++; throw new Error("Bulk linking must not open a hidden editor"); } });
  app.metadataCache = { getDocument: path => documents.get(path) ?? null, getFileCache: file => documents.get(file.path)?.cache ?? null, resolveReference: (reference, path) => api.resolveLink([...files.values()], reference.link, path, reference.kind === "markdown" || reference.kind === "reference"), updateOpenDocuments() { state.updates++; index(source, editor.getValue()); } };
  app.fileManager = new api.FileManager(app);
  const f = { app, source, target, view, session, editor, cm, files, disk, documents, config, state, reads, transactions, add, index,
    candidate(destination = target, matches) { const environment = api.outgoingMentionEnvironment(app, source, editor.getValue(), view); const ranges = matches ?? api.outgoingMentions(editor.getValue(), api.parseMarkdown(editor.getValue()), source.path, [{ path: destination.path, basename: destination.basename, cache: documents.get(destination.path).cache }])[0]?.matches ?? []; return api.outgoingMentionBulkCandidate(environment, destination, ranges); },
    prepare(candidate = f.candidate()) { if (!candidate) throw new Error("Expected an authorable bulk candidate"); return api.prepareOutgoingMentionBulk(candidate, () => state.owned); },
    apply(review) { return api.applyOutgoingMentionBulk(review, () => state.owned); },
    replacePhysical(path, content = disk.get(path).content) { disk.set(path, { ...disk.get(path), content, version: "v" + ++state.version }); },
    dirtySuffix() { cm.dispatch({ changes: { from: cm.state.doc.length, insert: "Earlier dirty prose Ω.\r\n" }, annotations: isolateHistory.of("full"), userEvent: "input.type" }); },
  }; return f;
}

export function installMentionBulkDom() {
  const previousDocument = globalThis.document, previousElement = globalThis.HTMLElement;
  const matches = (node, selector) => selector.split(",").some(part => {
    part = part.trim(); if (part === "*" || part === "button" || part === "button:not(:disabled)") return part === "*" || node.tagName === "BUTTON" && (!part.includes(":disabled") || !node.disabled);
    const match = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(part); if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); return node.dataset[key] !== undefined && (match[2] === undefined || node.dataset[key] === match[2]);
  });
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.disabled = false; this.root = false; this.listeners = new Map(); this.classList = { add() {}, toggle() {} }; }
    get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
    append(...nodes) { for (const node of nodes) { if (typeof node === "string") continue; if (node.tagName === "#FRAGMENT") this.append(...node.children); else { node.parent = this; this.children.push(node); } } }
    appendChild(node) { this.append(node); return node; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    focus() { globalThis.document.activeElement = this; }
    querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll("*")]).filter(child => matches(child, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    addEventListener(name, listener) { const entries = this.listeners.get(name) ?? []; entries.push(listener); this.listeners.set(name, entries); }
    async fire(name, extra = {}) { for (const listener of this.listeners.get(name) ?? []) await listener({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }); await Promise.resolve(); }
  }
  globalThis.document = { activeElement: null, createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), createDocumentFragment: () => new Element("#fragment") }; globalThis.HTMLElement = Element;
  return { Element, restore() { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; if (previousElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousElement; } };
}
