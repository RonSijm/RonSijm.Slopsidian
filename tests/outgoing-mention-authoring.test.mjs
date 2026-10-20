import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth, isolateHistory } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, api;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "outgoing-mention-tests-"));
  const outfile = join(directory, "feature.mjs");
  await build({ stdin: { contents: 'export * from "./client/outgoing-mention-authoring"; export {OutgoingPaneView} from "./client/outgoing-pane-view"; export {MarkdownView} from "./client/workspace"; export {Editor} from "./client/editor"; export {FileManager} from "./client/file-manager"; export {TFile} from "./client/vault"; export {parseMarkdown,outgoingMentions} from "./client/markdown"; export {resolveLink} from "./client/links";', resolveDir: root }, outfile,
    bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  api = await import(pathToFileURL(outfile).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/outgoing-mention-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
const original = '---\r\n# Source comment λ\r\nopaque: { keep: true }\r\n---\r\n# Mentions\r\n\r\nBefore TARGET λ and Target λ. Keep 😀.\r\n\r\n[[Existing]] ![[Image.png]]\r\n';
const targetText = '---\r\naliases: [ "Target λ", "Friendly 😀" ] # target comment\r\n---\r\n# Destination\r\n';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(text = original) {
  const files = new Map(), disk = new Map(), documents = new Map(), sessions = new Map(), reads = [], config = new Map([["useMarkdownLinks", false], ["newLinkFormat", "shortest"]]);
  const state = { owned: true, core: true, version: 0, updates: 0 };
  const app = { changingVault: false, vault: { rootPath: "mention-vault", readOnly: false }, core: { busy: false, isEnabled: () => state.core }, workspace: { sessions, isChangingFiles: false, isChangingLayout: false } };
  const index = (file, content = disk.get(file.path).content) => documents.set(file.path, { text: content, document: { file: { path: file.path }, ...disk.get(file.path) }, cache: api.parseMarkdown(content), missing: false });
  const add = (path, content = "", hasBom = true) => { const file = new api.TFile(app.vault, { path, basename: path.split("/").at(-1).replace(/\.md$/i, ""), extension: path.split(".").at(-1), stat: { mtime: 1, ctime: 1, size: content.length } }); files.set(path, file); disk.set(path, { content, version: "v" + ++state.version, hasBom }); index(file); return file; };
  const source = add("Notes/Source.md", text), target = add("Targets/Destination.md", targetText); add("Existing.md"); add("Image.png");
  const editor = Object.create(api.Editor.prototype), cm = { composing: false, dom: { isConnected: true }, state: EditorState.create({ doc: text, extensions: [history(), EditorState.lineSeparator.of("\r\n")] }) };
  let session;
  cm.dispatch = spec => { cm.state = (spec.startState ? spec : cm.state.update(spec)).state; if (session) { session.text = editor.getValue(); index(source, session.text); } };
  editor.cm = cm;
  session = { originRoot: app.vault.rootPath, text, isReloading: false, isSaving: false, document: documents.get(source.path).document };
  sessions.set(source.path, session);
  const view = { isLoaded: true, file: source, editor, session, mode: "source", editingMode: "source", leaf: {}, get savedDocument() { return session.document; }, getMode() { return this.mode; }, getEditingMode() { return this.editingMode; } };
  view.leaf.view = view;
  Object.assign(app.vault, { getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"), getFileByPath: path => files.get(path) ?? null, getConfig: key => config.get(key),
    async readDocument(path) { reads.push(path); await f.onRead?.(path); return { file: { path }, ...disk.get(path) }; } });
  app.metadataCache = { getDocument: path => documents.get(path) ?? null, resolveReference: (reference, path) => api.resolveLink([...files.values()], reference.link, path, reference.kind === "markdown" || reference.kind === "reference"), updateOpenDocuments() { state.updates++; index(source, editor.getValue()); } };
  app.fileManager = new api.FileManager(app);
  const f = { app, source, target, view, session, editor, cm, files, disk, documents, config, state, reads, add, index,
    range(word = "TARGET λ") { const from = editor.getValue().indexOf(word); return { from, to: from + word.length }; },
    choice(word = "TARGET λ", destination = target) { return api.outgoingMentionChoice(app, source, editor.getValue(), destination, f.range(word), view); },
    apply(choice = f.choice()) { assert.ok(choice); return api.linkOutgoingMention(choice, () => state.owned); },
    replacePhysical(path, content = disk.get(path).content) { disk.set(path, { ...disk.get(path), content, version: "v" + ++state.version }); },
    dirtySuffix() { cm.dispatch({ changes: { from: cm.state.doc.length, insert: "Earlier dirty prose Ω.\r\n" }, annotations: isolateHistory.of("full"), userEvent: "input.type" }); },
  };
  return f;
}

test("explicit wiki/Markdown choices follow all three naming preferences, preserving exact case and Unicode wording", async () => {
  for (const format of ["shortest", "relative", "absolute"]) for (const markdown of [false, true]) {
    const f = fixture(); f.config.set("newLinkFormat", format); f.config.set("useMarkdownLinks", markdown);
    const c = f.choice(); assert.ok(c); const prefix = original.slice(0, c.plan.from), suffix = original.slice(c.plan.to);
    assert.equal(c.plan.reference.displayText, "TARGET λ"); assert.equal(c.plan.reference.kind, markdown ? "markdown" : "wiki");
    await f.apply(c); assert.equal(f.editor.getValue(), prefix + c.plan.insert + suffix); assert.equal(f.disk.get(f.source.path).content, original);
    assert.equal(f.disk.get(f.source.path).hasBom, true); assert.equal(f.disk.get(f.target.path).content, targetText);
    assert.equal(f.app.metadataCache.resolveReference(api.parseMarkdown(c.plan.insert).links[0], f.source.path).file, f.target);
  }
});
test("one shared Undo/Redo isolates the linked occurrence from earlier dirty prose and leaves physical bytes untouched", async () => {
  const f = fixture(); f.dirtySuffix(); const dirty = f.editor.getValue(); assert.equal(undoDepth(f.cm.state), 1);
  const choice = f.choice(); await f.apply(choice); assert.equal(undoDepth(f.cm.state), 2); assert.equal(f.state.updates, 1);
  assert.equal(undo(f.cm), true); assert.equal(f.editor.getValue(), dirty); assert.equal(redo(f.cm), true); assert.equal(f.editor.getValue(), choice.plan.text);
  undo(f.cm); undo(f.cm); assert.equal(f.editor.getValue(), original); assert.equal(f.disk.get(f.source.path).content, original);
});
test("explicit destinations disambiguate shared basenames and aliases through generated unique paths", async () => {
  const f = fixture(); const second = f.add("Elsewhere/Destination.md", targetText); f.add("Targets/Twin.md", targetText);
  const first = f.choice(), other = f.choice("TARGET λ", second); assert.ok(first); assert.ok(other); assert.notEqual(first.plan.insert, other.plan.insert);
  await f.apply(other); assert.equal(f.app.metadataCache.resolveReference(api.parseMarkdown(other.plan.insert).links[0], f.source.path).file, second);
});
test("non-source views, closed/disconnected owners and genuinely read-only notes are reveal-only before any read", () => {
  for (const change of [f => f.app.vault.readOnly = true, f => f.view.mode = "preview", f => f.view.isLoaded = false, f => f.cm.dom.isConnected = false, f => f.view.leaf.view = {}, f => f.app.workspace.sessions.delete(f.source.path), f => f.session.isSaving = true, f => f.session.isReloading = true, f => f.cm.composing = true, f => f.state.core = false]) {
    const f = fixture(); change(f); assert.equal(f.choice(), null); assert.deepEqual(f.reads, []);
  }
});
test("escaped, code, existing links/embeds, comments, YAML and table lookalikes cannot become authoring actions", () => {
  for (const text of ['`Target λ`', '\\Target λ', '[[Target λ]]', '![[Target λ]]', '[Target λ](Elsewhere)', '%% Target λ %%', '<!-- Target λ -->', '---\r\nname: Target λ\r\n---\r\n', '| A | B |\r\n|---|---|\r\n| Target λ | X |\r\n']) {
    const f = fixture(text); assert.equal(f.choice("Target λ"), null, text);
  }
});
test("only complete matcher ranges are editable; overlapping alias unions remain reveal-only", () => {
  const f = fixture("Mary Jane Doe\r\n"); const target = f.add("Names.md", '---\naliases: ["Mary Jane", "Jane Doe"]\n---\n');
  assert.equal(api.outgoingMentionChoice(f.app, f.source, f.editor.getValue(), target, { from: 0, to: 13 }, f.view), null);
  const good = fixture(); assert.equal(api.outgoingMentionChoice(good.app, good.source, good.editor.getValue(), good.target, { from: good.range().from + 1, to: good.range().to }, good.view), null);
});
test("generated link proof rejects wrong-target, ambiguous, partial and source-capturing insertions", () => {
  for (const spelling of ['[[Existing|TARGET λ]]', 'prefix [[Destination|TARGET λ]]', '[[Destination|TARGET λ]] suffix', '[[Destination|WRONG]]', '![[Destination|TARGET λ]]', '[[Destination|TARGET λ]] [[Existing]]']) {
    const f = fixture(); f.app.fileManager.generateMarkdownLink = () => spelling; assert.equal(f.choice(), null, spelling);
  }
  const f = fixture(); f.app.metadataCache.resolveReference = () => ({ file: f.target, ambiguous: true, candidates: [f.target] }); assert.equal(f.choice(), null);
});
test("existing embedded/link references and untouched CRLF source positions survive the one replacement", async () => {
  const f = fixture(); const old = api.parseMarkdown(original), choice = f.choice(); await f.apply(choice); const next = api.parseMarkdown(f.editor.getValue()), delta = choice.plan.insert.length - (choice.plan.to - choice.plan.from);
  assert.equal(next.links.length, old.links.length + 1); assert.equal(next.embeds.length, old.embeds.length);
  for (const [before, after] of [[old.links[0], next.links[1]], [old.embeds[0], next.embeds[0]]]) { assert.equal(after.original, before.original); assert.equal(after.position.start.offset, before.position.start.offset + delta); }
});
test("a stale source document, same-text editor reset, or detached operation refuses before transport", async () => {
  for (const change of [f => f.dirtySuffix(), f => f.cm.state = EditorState.create({ doc: f.editor.getValue(), extensions: [history(), EditorState.lineSeparator.of("\r\n")] }), f => f.state.owned = false]) {
    const f = fixture(), choice = f.choice(); change(f); const before = f.editor.getValue(); await assert.rejects(f.apply(choice), /changed/); assert.equal(f.editor.getValue(), before); assert.deepEqual(f.reads, []);
  }
});
test("source and target TFile identity, root, mode and live session guards reject stale retained controls", async () => {
  for (const change of [f => f.add(f.source.path, original), f => f.add(f.target.path, targetText), f => f.target.path = "Moved.md", f => f.app.vault.rootPath = "other", f => f.view.mode = "preview", f => f.view.editingMode = "live-preview", f => f.session.originRoot = "other", f => f.view.session = { ...f.session }, f => f.app.vault.readOnly = true, f => f.app.workspace.isChangingFiles = true, f => f.app.workspace.isChangingLayout = true, f => f.app.core.busy = true, f => f.state.core = false]) {
    const f = fixture(), choice = f.choice(); change(f); await assert.rejects(f.apply(choice), /changed/); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.reads, []);
  }
});
test("changed link preferences reject instead of silently changing the reviewed link spelling", async () => {
  for (const change of [f => f.config.set("useMarkdownLinks", true), f => f.config.set("newLinkFormat", "relative")]) {
    const f = fixture(), choice = f.choice(); change(f); await assert.rejects(f.apply(choice), /changed/); assert.deepEqual(f.reads, []);
  }
});
test("source physical replacement unseen by metadata preserves the dirty buffer and refuses before mutation", async () => {
  const f = fixture(); f.dirtySuffix(); const choice = f.choice(), dirty = f.editor.getValue(); f.replacePhysical(f.source.path, "Newer physical source Ω.\r\n");
  await assert.rejects(f.apply(choice), /changed/); assert.equal(f.editor.getValue(), dirty); assert.equal(undoDepth(f.cm.state), 1); assert.match(f.disk.get(f.source.path).content, /Newer/);
});
test("target physical replacement or same-version wrong content/BOM refuses without touching either note", async () => {
  for (const change of [f => f.replacePhysical(f.target.path), f => f.disk.get(f.target.path).content += "New content\r\n", f => f.disk.get(f.target.path).hasBom = false, f => f.disk.get(f.source.path).content += "Newer source\r\n", f => f.disk.get(f.source.path).hasBom = false]) {
    const f = fixture(), choice = f.choice(); change(f); await assert.rejects(f.apply(choice), /changed/); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0);
  }
});
test("held source/target reads recheck owner, composition, source text and preferences at completion", async () => {
  for (const change of [f => f.state.owned = false, f => f.cm.composing = true, f => f.dirtySuffix(), f => f.session.isReloading = true, f => f.session.isSaving = true, f => f.config.set("useMarkdownLinks", true), f => f.view.leaf.view = {}, f => f.session.document = { ...f.session.document }]) {
    const f = fixture(), choice = f.choice(), gate = deferred(); f.onRead = path => path === f.target.path ? gate.promise : undefined;
    const pending = f.apply(choice); await Promise.resolve(); change(f); const before = f.editor.getValue(); gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(f.editor.getValue(), before);
  }
});
test("changed destination alias metadata refuses the previously offered match even with unchanged disk version", async () => {
  const f = fixture(), choice = f.choice(); f.index(f.target, targetText.replace('"Target λ"', '"Another alias"'));
  await assert.rejects(f.apply(choice), /changed/); assert.equal(f.editor.getValue(), original);
});
test("target/source replacement while a real read is held cannot rebase a retained action", async () => {
  for (const change of [f => f.add(f.target.path, targetText), f => f.add(f.source.path, original), f => f.target.path = "Renamed.md", f => f.app.vault.readOnly = true, f => f.app.vault.rootPath = "other"] ) {
    const f = fixture(), choice = f.choice(), gate = deferred(); f.onRead = path => path === f.source.path ? gate.promise : undefined;
    const pending = f.apply(choice); await Promise.resolve(); change(f); gate.resolve(); await assert.rejects(pending, /changed/); assert.equal(f.editor.getValue(), original);
  }
});
test("two simultaneous clicks cannot apply the same reviewed occurrence twice", async () => {
  const f = fixture(), choice = f.choice(); const results = await Promise.allSettled([f.apply(choice), f.apply(choice)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.equal(undoDepth(f.cm.state), 1); assert.equal(f.editor.getValue(), choice.plan.text);
});
test("malformed configuration, missing metadata and unsupported bounds make controls nonauthoring", () => {
  for (const change of [f => f.config.set("useMarkdownLinks", "true"), f => f.config.set("newLinkFormat", "wrong"), f => f.documents.delete(f.target.path), f => f.documents.get(f.target.path).missing = true, f => f.documents.get(f.target.path).cache.errors.push("Invalid YAML")]) {
    const f = fixture(); change(f); assert.equal(f.choice(), null);
  }
  const f = fixture("Target λ " + "x".repeat(1_000_000)); assert.equal(f.choice("Target λ"), null);
});
test("a thousand rendered witnesses share one source snapshot and perform no per-row link planning", () => {
  const text = Array.from({ length: 1_000 }, (_, index) => `${index}: Target λ.`).join("\r\n"), f = fixture(text);
  const matches = api.outgoingMentions(text, f.documents.get(f.source.path).cache, f.source.path, [{ path: f.target.path, basename: f.target.basename, cache: f.documents.get(f.target.path).cache }])[0].matches;
  assert.equal(matches.length, 1_000);
  const get = f.editor.getValue.bind(f.editor), generate = f.app.fileManager.generateMarkdownLink.bind(f.app.fileManager); let snapshots = 0, generations = 0;
  f.editor.getValue = () => { snapshots++; return get(); }; f.app.fileManager.generateMarkdownLink = (...args) => { generations++; return generate(...args); };
  const environment = api.outgoingMentionEnvironment(f.app, f.source, text, f.view);
  const reviews = matches.map(range => api.outgoingMentionReview(environment, f.target, range));
  assert.ok(reviews.every(review => review && !("plan" in review))); assert.equal(snapshots, 1); assert.equal(generations, 0);
});
test("source read-only/editability facets refuse held controls without changing document or history", async () => {
  for (const extension of [EditorState.readOnly.of(true), EditorView.editable.of(false)]) {
    const f = fixture(), choice = f.choice(), document = f.cm.state.doc;
    f.cm.state = f.cm.state.update({ effects: StateEffect.appendConfig.of(extension) }).state; assert.equal(f.cm.state.doc, document);
    assert.equal(f.choice(), null); await assert.rejects(f.apply(choice), /changed/); assert.equal(undoDepth(f.cm.state), 0); assert.deepEqual(f.reads, []);
  }
});
test("percent comment exclusions honor escaped and code-literal markers, including an unfinished comment", () => {
  for (const text of ["%%\r\nTarget λ\r\n%%", "%% unfinished Target λ"]) { const f = fixture(text); assert.equal(f.choice("Target λ"), null); }
  for (const text of ["`%%` Target λ", "\\%% Target λ"]) { const f = fixture(text); assert.ok(f.choice("Target λ")); }
});
test("a replaced editor/CM owner or mutated saved-document proof cannot reuse the same visible source text", async () => {
  for (const change of [f => f.view.editor = Object.assign(Object.create(api.Editor.prototype), { cm: f.cm }), f => f.editor.cm = { ...f.cm }, f => f.session.document.version = "changed", f => f.session.document.content += "changed", f => f.session.document.hasBom = false]) {
    const f = fixture(), choice = f.choice(); change(f); await assert.rejects(f.apply(choice), /changed/); assert.deepEqual(f.reads, []); assert.equal(f.editor.getValue(), original);
  }
});
test("syntax-looking destination aliases cannot consume list/quote/heading/ID/task/callout or inline delimiters", () => {
  const cases = [
    ["1. Target λ\r\n\r\nKeep.\r\n", "1. Target λ"], ["> Target λ\r\n\r\nKeep.\r\n", "> Target λ"],
    ["Target λ\r\n---\r\n\r\nKeep.\r\n", "---"], ["# Target λ\r\n\r\nKeep.\r\n", "# Target λ"],
    ["- [ ] Target λ\r\n\r\nKeep.\r\n", "- [ ] Target λ"], ["Text ^target\r\n\r\nKeep.\r\n", "^target"],
    ["Text ^target\r\n\r\nKeep.\r\n", "target"], ["Before.\r\n\r\n---\r\n\r\nKeep.\r\n", "---"],
    ["One *marked λ* after.\r\n", "*marked λ"], ["One _marked λ_ after.\r\n", "_marked λ"],
    ["One ~~marked λ~~ after.\r\n", "~~marked λ"], ["One ==marked λ== after.\r\n", "==marked λ"],
    ["> [!note]- Title λ\r\n> Body\r\n", "note"], ["- [x] Target λ\r\n", "x"],
    ["Before ^[Target λ] after.\r\n", "Target λ"], ["Before [^id].\r\n\r\n[^id]: Body\r\n", "id"],
  ];
  for (const markdown of [false, true]) for (const [text, label] of cases) {
    const f = fixture(text); f.config.set("useMarkdownLinks", markdown); const target = f.add("Targets/Special.md", '---\naliases: [' + JSON.stringify(label) + ']\n---\n');
    assert.equal(f.choice(label, target), null, JSON.stringify({ text, label, markdown }));
    assert.equal(api.outgoingMentionReview(api.outgoingMentionEnvironment(f.app, f.source, text, f.view), target, f.range(label)), null, "rendered syntax action must be disabled");
  }
});
test("literal mention text within headings, lists, quotes, tasks, callout titles and emphasis retains topology", async () => {
  for (const markdown of [false, true]) for (const text of ["# Target λ\r\n", "1. Target λ\r\n", "> Target λ\r\n", "- [x] Target λ\r\n", "Target λ\r\n---\r\n", "One *Target λ* after.\r\n", "One ==Target λ== after.\r\n", "> [!note]- Target λ\r\n> Body\r\n"]) {
    const f = fixture(text); f.config.set("useMarkdownLinks", markdown); const before = api.parseMarkdown(text), choice = f.choice("Target λ"); assert.ok(choice, JSON.stringify({ text, markdown }));
    await f.apply(choice); const after = api.parseMarkdown(f.editor.getValue()); assert.deepEqual(after.sections.map(section => section.type), before.sections.map(section => section.type)); assert.equal(after.listItems.length, before.listItems.length); assert.equal(after.headings.length, before.headings.length);
    assert.equal(undo(f.cm), true); assert.equal(f.editor.getValue(), text);
  }
});

function paneFixture() {
  const previousDocument = globalThis.document, previousElement = globalThis.HTMLElement;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.disabled = false; this.root = false; this.classList = { add() {}, toggle() {} }; }
    get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
    append(...nodes) { for (const node of nodes) { if (typeof node === "string") continue; if (node.tagName === "#FRAGMENT") { this.append(...node.children); } else { node.parent = this; this.children.push(node); } } }
    replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    focus() { globalThis.document.activeElement = this; }
    querySelectorAll(selector) { const all = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]); return selector === "*" ? all : all.filter(child => child.tagName === "BUTTON" && (!selector.includes(":disabled") || !child.disabled)); }
  }
  globalThis.document = { activeElement: null, createElement: tag => new Element(tag), createDocumentFragment: () => new Element("#fragment") }; globalThis.HTMLElement = Element;
  const f = fixture(); Object.setPrototypeOf(f.view, api.MarkdownView.prototype); Object.defineProperty(f.view, "savedDocument", { configurable: true, get() { return this.session?.document; } }); f.view.leaf.id = "source-leaf";
  Object.assign(f.app.workspace, { getLeavesOfType: () => [{ view: f.view }], getActiveViewOfType: () => f.view, viewTypeForExtension: () => "markdown" });
  f.app.metadataCache.getFileCache = file => f.documents.get(file.path)?.cache ?? null;
  const pane = Object.create(api.OutgoingPaneView.prototype), container = new Element("div"); container.root = true;
  Object.assign(pane, { app: f.app, leaf: {}, sourceRoot: f.app.vault.rootPath, containerEl: container, contentEl: container, options: { file: f.source.path, followActiveFile: false, linksCollapsed: false, unlinkedCollapsed: false },
    snapshot: null, signature: "", revision: 0, request: 0, navigationToken: 0, queued: false, opening: false, message: "", mentionActions: new Map(), authoringAuthority: null, mentionTargets: [], authoringWatch: null,
    follow: new Element("input"), caption: new Element("p"), status: new Element("p"), results: new Element("div") });
  container.append(pane.results); pane.leaf.view = pane; Object.defineProperty(pane, "isLoaded", { value: true, writable: true });
  f.pane = pane; f.button = () => pane.results.querySelectorAll("button").find(button => button.dataset.outgoingMentionLink === f.target.path);
  f.review = () => pane.mentionActions.get(f.button()?.dataset.outgoingKey);
  f.cleanupPane = () => { pane.cancelAuthoringWatch(); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; if (previousElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousElement; };
  return f;
}

test("actual pane refresh/render rebinds same-text CM document, editor, CM, saved-document and session lifetimes", async () => {
  for (const change of [
    f => { f.cm.state = EditorState.create({ doc: f.editor.getValue(), extensions: [history(), EditorState.lineSeparator.of("\r\n")] }); },
    f => { f.session.document = { ...f.session.document }; },
    f => { f.view.editor = Object.assign(Object.create(api.Editor.prototype), { cm: f.cm }); },
    f => { f.editor.cm = { ...f.cm }; },
    f => { f.view.session = { ...f.session }; f.app.workspace.sessions.set(f.source.path, f.view.session); },
  ]) {
    const f = paneFixture();
    try {
      await f.pane.refresh(); const old = f.review(), oldButton = f.button(), revision = f.pane.snapshot.id; assert.ok(old && !oldButton.disabled);
      change(f); await f.pane.refresh(); const current = f.review(); assert.ok(current); assert.ok(f.pane.snapshot.id > revision); assert.notEqual(current, old); assert.equal(oldButton.isConnected, false);
      assert.equal(current.editor, f.view.editor); assert.equal(current.cm, f.view.editor.cm); assert.equal(current.cmDocument, f.view.editor.cm.state.doc); assert.equal(current.document, f.view.savedDocument); assert.equal(current.session, f.view.session);
      await assert.rejects(api.linkOutgoingMention(old, () => true), /changed/); await f.pane.linkMention(oldButton); assert.equal(f.view.editor.getValue(), original); assert.deepEqual(f.reads, []);
    } finally { f.cleanupPane(); }
  }
});

test("actual pane refresh/render rebinds current target text/version and canonical target identity", async () => {
  for (const change of [f => { f.replacePhysical(f.target.path, targetText + "Newer target body Ω.\r\n"); f.index(f.target); }, f => { f.add(f.target.path, targetText); }]) {
    const f = paneFixture();
    try {
      await f.pane.refresh(); const old = f.review(), revision = f.pane.snapshot.id; change(f); await f.pane.refresh(); const current = f.review(); assert.ok(current); assert.ok(f.pane.snapshot.id > revision);
      assert.equal(current.target, f.app.vault.getFileByPath(f.target.path)); assert.equal(current.targetVersion, f.documents.get(f.target.path).document.version); assert.equal(current.targetText, f.documents.get(f.target.path).text);
      await assert.rejects(api.linkOutgoingMention(old, () => true), /changed/); assert.equal(f.editor.getValue(), original);
    } finally { f.cleanupPane(); }
  }
});

test("selection/effect-only state changes retain current buttons and valid shared-history authoring", async () => {
  const f = paneFixture();
  try {
    await f.pane.refresh(); const button = f.button(), review = f.review(), revision = f.pane.snapshot.id, document = f.cm.state.doc;
    f.cm.dispatch({ selection: { anchor: 5 }, effects: StateEffect.appendConfig.of([]) }); assert.equal(f.cm.state.doc, document); await f.pane.refresh();
    assert.equal(f.pane.snapshot.id, revision); assert.equal(f.button(), button); assert.equal(f.review(), review); await api.linkOutgoingMention(review, () => true); assert.equal(undoDepth(f.cm.state), 1); undo(f.cm); assert.equal(f.editor.getValue(), original);
  } finally { f.cleanupPane(); }
});

test("reload and editable-facet settlement wake actual pane refresh without another metadata event", async () => {
  for (const mode of ["reload", "editable"]) {
    const f = paneFixture(), oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout, timers = new Map(); let serial = 0;
    globalThis.setTimeout = callback => { const id = ++serial; timers.set(id, callback); return id; }; globalThis.clearTimeout = id => timers.delete(id);
    try {
      await f.pane.refresh(); const oldButton = f.button();
      if (mode === "reload") f.session.isReloading = true; else f.cm.state = EditorState.create({ doc: f.cm.state.doc, extensions: [history(), EditorState.lineSeparator.of("\r\n"), EditorView.editable.of(false)] });
      await f.pane.refresh(); assert.equal(f.review(), undefined); assert.equal(f.button().disabled, true); assert.equal(timers.size, 1);
      let sourceSnapshots = 0; const get = f.editor.getValue.bind(f.editor); f.editor.getValue = () => { sourceSnapshots++; return get(); };
      const tick = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); };
      tick(); assert.equal(sourceSnapshots, 0, "the light settlement watch never reads source text"); assert.equal(timers.size, 1);
      if (mode === "reload") { f.session.isReloading = false; f.session.document = { ...f.session.document }; }
      else f.cm.state = EditorState.create({ doc: f.cm.state.doc, extensions: [history(), EditorState.lineSeparator.of("\r\n"), EditorView.editable.of(true)] });
      tick(); await Promise.resolve(); await Promise.resolve(); assert.ok(f.review()); assert.equal(f.button().disabled, false); assert.equal(timers.size, 0);
      await f.pane.linkMention(oldButton); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.reads, []);
      if (mode === "reload") f.session.isReloading = true; else f.cm.state = EditorState.create({ doc: f.cm.state.doc, extensions: [history(), EditorState.lineSeparator.of("\r\n"), EditorView.editable.of(false)] });
      await f.pane.refresh(); assert.equal(timers.size, 1);
      if (mode === "editable") { const now = Date.now, elapsed = now() + 5_001; try { Date.now = () => elapsed; tick(); assert.equal(timers.size, 0, "an unowned editability lock is not polled indefinitely"); } finally { Date.now = now; } }
      f.pane.cancelAuthoringWatch(); assert.equal(timers.size, 0);
    } finally { f.cleanupPane(); globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
  }
});

test("permanent read-only, missing-session, Reading and detached owners do not retain settlement watches", async () => {
  for (const change of [f => { f.app.vault.readOnly = true; }, f => { f.view.session = null; }, f => { f.view.mode = "preview"; }, f => { f.view.isLoaded = false; }, f => { f.view.leaf.view = {}; }, f => { f.cm.dom.isConnected = false; }, f => { f.cm.state = f.cm.state.update({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }).state; }]) {
    const f = paneFixture();
    try { change(f); await f.pane.refresh(); assert.equal(f.pane.authoringWatch, null); assert.deepEqual(f.reads, []); }
    finally { f.cleanupPane(); }
  }
  const f = paneFixture(), oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout, timers = new Map(); let serial = 0;
  globalThis.setTimeout = callback => { const id = ++serial; timers.set(id, callback); return id; }; globalThis.clearTimeout = id => timers.delete(id);
  try { f.session.isReloading = true; await f.pane.refresh(); assert.equal(timers.size, 1); f.pane.isLoaded = false; const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); assert.equal(timers.size, 0); assert.equal(f.pane.authoringWatch, null); }
  finally { f.cleanupPane(); globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
});
