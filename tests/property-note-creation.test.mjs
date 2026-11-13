import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undoDepth } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";
import { checkPropertyNoteCreationReadOnly } from "../tools/property-note-creation-scenarios.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, api, inlinePropertyRow, TestMarkdownView, helperSource;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "property-note-creation-tests-"));
  const output = join(directory, "feature.mjs");
  await build({ stdin: { contents: 'export * from "./client/property-value-suggestions"; export {FileManager} from "./client/file-manager"; export {Editor} from "./client/editor"; export {DocumentSession} from "./client/workspace"; export {Properties,PropertiesView,MetadataEditor} from "./client/properties"; export {TFile,TFolder} from "./client/vault"; export {parseMarkdown} from "./client/markdown"; export {fileLinktext,resolveLink} from "./client/links";', resolveDir: root, loader: "ts" },
    outfile: output, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub, {
      name: "expose-real-private-pane-class",
      setup(build) {
        build.onLoad({ filter: /client[\\/]properties\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, "utf8")).replace("class PropertiesView extends ItemView", "export class PropertiesView extends ItemView"), loader: "ts" }));
        build.onLoad({ filter: /client[\\/]workspace\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, "utf8")).replace("class DocumentSession {", "export class DocumentSession {"), loader: "ts" }));
      },
    }] });
  api = await import(pathToFileURL(output).href);
  const propertiesSource = await readFile(join(root, "client/properties.ts"), "utf8"), rowFrom = propertiesSource.indexOf("function editable("), rowTo = propertiesSource.indexOf("export class MetadataEditor {");
  assert.ok(rowFrom >= 0 && rowTo > rowFrom);
  const rowOutput = join(directory, "property-row.mjs");
  await build({ stdin: { contents: 'import {sameValue,validTag} from "./client/markdown"; import {checkedMultilineText,createMultilinePropertyEditor,createStructuredPropertyInspector,hasMultilineText,multilineListSupported,preserveMultilinePropertySource,propertyTextControl as textControl,replaceMultilinePropertyValue,structuredPropertySourceSupported} from "./client/multiline-properties"; import {inferPropertyType,parsePropertyValue,propertyTypes} from "./client/property-types"; import {composingKey,numberText} from "./client/properties-lexemes"; import {MAX_COMPLETION_RESULTS} from "./client/builtin-suggestion-model"; import {PropertyValueSuggestions,propertyValueChoices,assertPropertyValueChoice,propertyNoteCreationChoice,createPropertyNote,propertyHeadingCreationChoice,createPropertyHeading,propertyWikiValue,replacePropertyListValue} from "./client/property-value-suggestions"; const icon=()=>document.createElement("svg"),reportError=error=>globalThis.propertyCreationReported.push(error),openTagSearch=()=>{}; class Notice{constructor(message){globalThis.propertyCreationNotices.push(message)}} class MarkdownView{getMode(){return this.mode}getEditingMode(){return this.editing}};\n' + propertiesSource.slice(rowFrom, rowTo) + "\nexport {inlinePropertyRow,MarkdownView};", resolveDir: root, loader: "ts" },
    outfile: rowOutput, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  ({ inlinePropertyRow, MarkdownView: TestMarkdownView } = await import(pathToFileURL(rowOutput).href));
  helperSource = await readFile(join(root, "tools/property-note-creation-scenarios.mjs"), "utf8");
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/property-note-creation-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const original = '---\r\n# Keep source comment\r\nstatus: Open # retain comment\r\nlabels: [ kept ]\r\ncount: 1.50\r\nopaque: { retain: exact }\r\n---\r\n# Property creation λ\r\n\r\nUntouched 😀 body.\r\n';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(options = {}) {
  const files = new Map(), documents = new Map(), disk = new Map(), folders = new Map(), sessions = new Map(), config = new Map(Object.entries({ newFileLocation: "root", newFileFolderPath: "Inbox", newLinkFormat: "shortest", useMarkdownLinks: false, ...options }));
  const creates = [], notices = [], reported = [], writes = [], state = { owned: true, version: 1, refreshes: 0, core: true, widget: null };
  const app = { changingVault: false, vault: { rootPath: "creation-vault", readOnly: false }, workspace: { sessions, isChangingFiles: false, isChangingLayout: false }, core: { busy: false, isEnabled: () => state.core },
    metadataTypeManager: { getAssignedWidget: () => state.widget } };
  const sourcePath = "Source folder/Source.md";
  function add(path, text = "", bom = false) {
    const file = new api.TFile(app.vault, { path, basename: path.split("/").at(-1).replace(/\.md$/i, ""), extension: "md", stat: { size: text.length, ctime: 1, mtime: 1 } });
    files.set(path, file); disk.set(path, { text, bom, version: state.version++ }); index(file, text); return file;
  }
  function index(file, text) { documents.set(file.path, { document: { file: { path: file.path }, content: text, version: disk.get(file.path)?.version }, text, cache: api.parseMarkdown(text), missing: false }); }
  const source = add(sourcePath, original, true), editor = Object.create(api.Editor.prototype), cm = { hasFocus: true, state: EditorState.create({ doc: original, extensions: [history(), EditorState.lineSeparator.of("\r\n"), EditorView.editable.of(true)] }) };
  let session;
  cm.dispatch = spec => { cm.state = (spec.startState ? spec : cm.state.update(spec)).state; if (session) { session.text = editor.getValue(); } };
  editor.cm = cm;
  const view = { editor };
  session = { originRoot: app.vault.rootPath, text: original, isReloading: false, leaves: new Set([view]), document: documents.get(source.path).document,
    async save() { await f.beforeSessionSave?.(); if (session.text !== disk.get(sourcePath).text) { writes.push(session.text); disk.set(sourcePath, { text: session.text, bom: true, version: state.version++ }); } session.document = { file: { path: sourcePath }, content: session.text, version: disk.get(sourcePath).version }; index(source, session.text); },
    async reload() { await f.beforeReload?.(); const current = disk.get(sourcePath); if (current.text !== session.text) { cm.state = EditorState.create({ doc: current.text, extensions: [history(), EditorState.lineSeparator.of("\r\n")] }); session.text = current.text; } session.document = { file: { path: sourcePath }, content: session.text, version: current.version }; index(source, session.text); } };
  sessions.set(sourcePath, session);
  for (const path of ["/", "Source folder", "Inbox", "Deep"]) { folders.set(path, new api.TFolder(app.vault, path)); }
  Object.assign(app.vault, {
    getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()], getFileByPath: path => files.get(path) ?? null,
    getAbstractFileByPath: path => files.get(path) ?? folders.get(path) ?? null,
    getAbstractFileByPathInsensitive: path => [...files.values(), ...folders.values()].find(file => file.path.toLowerCase() === path.toLowerCase()) ?? null,
    getRoot: () => folders.get("/"), getFolderByPath: path => folders.get(path || "/") ?? null, getConfig: key => config.get(key),
    assertWritable() { if (app.vault.readOnly) { throw new Error("Read-only vault"); } },
    async create(path, text) {
      await f.beforeWrite?.(path);
      if (disk.has(path)) { throw new Error("Create-only collision: " + path); }
      const file = add(path, text); creates.push(file); await f.afterWrite?.(file); return file;
    },
    async readDocument(path) { const value = disk.get(path); return { file: { path }, content: value.text, version: value.version }; },
    async writeDocument(path, text, version) { assert.equal(disk.get(path).version, version); disk.set(path, { ...disk.get(path), text, version: state.version++ }); index(files.get(path), text); writes.push(text); },
  });
  app.metadataCache = { getDocument: path => documents.get(path), getDocuments: () => [...documents.values()], getFileCache: file => documents.get(file.path)?.cache,
    resolveReference: (reference, path) => api.resolveLink([...files.values()], reference.link, path),
    fileToLinktext: (file, path, omit) => api.fileLinktext([...files.values()], file.path, path, omit, config.get("newLinkFormat")),
    async refresh() { state.refreshes++; await f.onRefresh?.(); }, async pause() {}, resume() {} };
  app.saveAll = async () => { await f.beforeSaveAll?.(); await session.save(); };
  app.workspace.withFileMutation = async action => { app.workspace.isChangingFiles = true; await f.onLock?.(); try { return await action(); } finally { app.workspace.isChangingFiles = false; await f.afterLock?.(); } };
  app.workspace.leaves = () => []; app.workspace.track = promise => promise;
  app.fileManager = new api.FileManager(app);
  const f = { app, source, editor, cm, session, state, files, documents, disk, folders, sessions, config, creates, notices, reported, writes, add };
  f.choice = (query = "[[Missing λ", widget = "text", property = "status", existing = []) => api.propertyNoteCreationChoice(app, source, property, widget, existing, query);
  f.accept = (choice = f.choice(), extra = {}) => api.createPropertyNote(app, choice, { widget: "text", existing: [], query: choice.query, current: () => state.owned,
    commit: async (value, guard) => { await app.fileManager.processFrontMatter(source, values => { values.status = value; }, undefined, guard); return true; },
    kept: path => notices.push(path), acknowledgedFailure: error => reported.push(error), ...extra });
  f.bytes = path => Buffer.from((disk.get(path).bom ? "\ufeff" : "") + disk.get(path).text);
  return f;
}

test("known-value enumeration stays noncreating and a separate explicit whole-field choice identifies its destination", () => {
  const f = fixture(); assert.deepEqual(api.propertyValueChoices(f.app, f.source, "status", "text", [], "[[Missing λ"), []);
  const choice = f.choice(); assert.equal(choice.kind, "create-note"); assert.equal(choice.path, "Missing λ.md"); assert.equal(choice.value, "[[Missing λ]]");
  assert.equal(f.choice("[[Missing λ]]").path, choice.path); assert.equal(f.creates.length, 0); assert.equal(f.editor.getValue(), original);
});
test("root/current/configured/explicit placement creates exact empty notes and commits wiki YAML with real isolated Undo", async () => {
  for (const [location, folder, query, destination] of [["root", "Inbox", "Fresh λ", "Fresh λ.md"], ["current", "Inbox", "Fresh λ", "Source folder/Fresh λ.md"], ["folder", "Inbox", "Fresh λ", "Inbox/Fresh λ.md"], ["folder", "Missing folder", "Fresh λ", "Fresh λ.md"], ["current", "Inbox", "Deep/Explicit λ", "Deep/Explicit λ.md"]]) {
    for (const format of ["shortest", "relative", "absolute"]) {
      const f = fixture({ newFileLocation: location, newFileFolderPath: folder, newLinkFormat: format, useMarkdownLinks: true }), choice = f.choice("[[" + query);
      assert.equal(choice.path, destination); assert.equal(await f.accept(choice), true); assert.equal(f.creates.length, 1); assert.deepEqual(f.bytes(destination), Buffer.alloc(0));
      const expected = "[[" + api.fileLinktext([...f.files.values()], destination, f.source.path, true, format) + "]]";
      assert.equal(f.editor.getValue(), original.replace("status: Open #", "status: " + JSON.stringify(expected) + " #"));
      assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + f.editor.getValue())); assert.equal(undoDepth(f.cm.state), 1);
      f.editor.undo(); assert.equal(f.editor.getValue(), original); assert.ok(f.files.has(destination)); f.editor.redo(); assert.equal(api.parseMarkdown(f.editor.getValue()).frontmatter.status, expected);
      assert.deepEqual(f.notices, []); assert.deepEqual(f.reported, []);
    }
  }
});
test("unsupported/incomplete/escaping queries and tag/alias/number widgets cannot offer creation", () => {
  const f = fixture();
  for (const query of ["", "[[", "[[ ", "[[Name/", "[[../../Escape", "[[photo.png", "[[https://example.test", "[[CON", "[[Missing#Heading", "[[Missing#^id", "prefix [[Missing", "[[Name]] suffix", "[[\ud800", "[[a\u0000b"]) { assert.equal(f.choice(query), null, query); }
  for (const widget of ["tags", "aliases", "number", "unknown", "date"]) { assert.equal(f.choice("[[Missing", widget), null); }
  f.app.vault.readOnly = true; assert.equal(f.choice(), null); f.app.vault.readOnly = false; f.state.core = false; assert.equal(f.choice(), null);
});
test("complete existing-note, case-insensitive alias and dirty-alias proof suppress duplicate creation", () => {
  const f = fixture(); f.add("Known.md", '---\nAliases: ["Missing λ"]\n---\n'); assert.equal(f.choice(), null);
  assert.equal(f.choice("[[missing λ"), null);
  f.sessions.set("Known.md", { originRoot: f.app.vault.rootPath, text: "---\naliases: [Other]\n---\n", isReloading: false }); assert.ok(f.choice());
  f.sessions.get("Known.md").text = "---\naliases: [Missing λ]\n---\n"; assert.equal(f.choice(), null);
  assert.equal(f.choice("[[Known"), null); assert.equal(f.choice("[[Missing λ", "text", "status", ["[[Missing λ]]"]), null);
  assert.equal(f.choice("[[Fresh.md", "multitext", "labels", ["[[Fresh]]"]), null, "adding a new spelling cannot duplicate an existing unresolved target");
});
test("unknown source/alias inventory, reloading/wrong-root sessions and oversized proof budgets decline conservatively", () => {
  for (const change of [f => f.documents.delete(f.source.path), f => { f.documents.get(f.source.path).missing = true; }, f => { f.session.isReloading = true; }, f => { f.session.originRoot = "other"; }, f => { f.app.workspace.isChangingLayout = true; }, f => { f.app.workspace.isChangingFiles = true; }]) {
    const f = fixture(); change(f); assert.equal(f.choice(), null);
  }
  const f = fixture(), target = f.add("Unknown.md"); f.documents.delete(target.path); assert.equal(f.choice(), null);
  const g = fixture(); g.add("Invalid.md", "---\naliases: [unclosed\n---\n"); assert.equal(g.choice(), null);
  const h = fixture(); h.add("Large aliases.md", "---\naliases: [" + Array.from({ length: 2050 }, () => "a").join(",") + "]\n---\n"); assert.equal(h.choice(), null);
});
test("held creation choices revalidate owner, source/session/file identity, widget and every placement/link preference before any create", async () => {
  for (const change of [f => { f.state.owned = false; }, f => { f.app.vault.rootPath = "other"; }, f => { f.source.path = "Moved.md"; }, f => f.files.set(f.source.path, { ...f.source }), f => f.sessions.set(f.source.path, { ...f.session }), f => { f.session.text += "new"; }, f => { f.state.widget = "multitext"; }, f => f.config.set("newFileLocation", "current"), f => f.config.set("newFileFolderPath", "Deep"), f => f.config.set("newLinkFormat", "absolute"), f => f.config.set("useMarkdownLinks", true), f => { f.app.vault.readOnly = true; }]) {
    const f = fixture(), choice = f.choice(); change(f); await assert.rejects(f.accept(choice), /changed/); assert.equal(f.creates.length, 0); assert.equal(f.writes.length, 0);
  }
});
test("the real FileManager rechecks a source edit after saveAll and before its create-only write", async () => {
  const f = fixture(), choice = f.choice();
  f.beforeSaveAll = () => { f.session.text = original + "new source"; };
  await assert.rejects(f.accept(choice), /changed/); assert.equal(f.creates.length, 0); assert.equal(f.disk.get(f.source.path).text, original + "new source"); assert.equal(undoDepth(f.cm.state), 0);
});
test("a physical collision absent from the inventory retains existing bytes and never inserts a property", async () => {
  const f = fixture(), choice = f.choice(); f.beforeWrite = path => f.disk.set(path, { text: "Existing physical note λ", bom: true, version: 99 });
  await assert.rejects(f.accept(choice), /collision/); assert.equal(f.creates.length, 0); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.bytes(choice.path), Buffer.from("\ufeffExisting physical note λ")); assert.deepEqual(f.notices, []);
});
test("acknowledged notes survive a stale owner or changed preference without a source edit", async () => {
  for (const change of [f => { f.state.owned = false; }, f => f.config.set("newLinkFormat", "absolute"), f => { f.session.text += "Other source"; }]) {
    const f = fixture(), choice = f.choice(); f.afterWrite = () => change(f);
    await assert.rejects(f.accept(choice), /changed/); assert.equal(f.creates.length, 1); assert.deepEqual(f.bytes(choice.path), Buffer.alloc(0)); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.notices, [choice.path]); assert.equal(f.writes.length, 0);
  }
});
test("post-create metadata cleanup failure keeps its real receipt and reports the exact original error", async () => {
  const f = fixture(), choice = f.choice(), issue = new Error("metadata cleanup after real acknowledgement");
  f.onRefresh = () => { if (f.state.refreshes === 2) { throw issue; } };
  await assert.rejects(f.accept(choice), error => error === issue); assert.equal(f.creates.length, 1); assert.deepEqual(f.notices, [choice.path]); assert.deepEqual(f.reported, [issue]); assert.equal(f.editor.getValue(), original); assert.equal(f.writes.length, 0);
});
test("a kept note without a completed metadata refresh declines creation until indexing and a fresh real input event", async () => {
  const f = fixture(), choice = f.choice(), issue = new Error("Acknowledged file not yet indexed");
  f.afterWrite = file => f.documents.delete(file.path);
  f.onRefresh = () => { if (f.state.refreshes === 2) throw issue; };
  await assert.rejects(f.accept(choice), error => error === issue); assert.equal(f.creates.length, 1); assert.ok(f.files.has(choice.path)); assert.equal(f.documents.has(choice.path), false);
  const dom = domFixture(); dom.controller.dispose();
  const controller = new api.PropertyValueSuggestions({ input: dom.input, container: dom.container, current: () => true,
    choices: query => { const value = f.choice(query); return value ? [value] : []; }, accept: async () => true, error: message => { throw new Error(message); } });
  try {
    dom.input.value = "[[Next property"; dom.input.fire("input"); assert.equal(controller.isOpen, false, "an incomplete alias inventory cannot prove a new target missing");
    f.onRefresh = () => { f.documents.set(choice.path, { document: { file: { path: choice.path }, content: "", version: f.disk.get(choice.path).version }, text: "", cache: api.parseMarkdown(""), missing: false }); };
    await f.app.metadataCache.refresh(); assert.equal(controller.isOpen, false, "background indexing does not manufacture another input event");
    dom.input.fire("input"); assert.equal(controller.isOpen, true); assert.equal(dom.container.children.at(-1).children[0].dataset.propertyCreateNote, "Next property.md");
    assert.equal(f.editor.getValue(), original); assert.equal(f.creates.length, 1);
  } finally { controller.dispose(); }
});
test("refused property commit leaves the acknowledged note and emits one kept-file notice", async () => {
  const f = fixture(), choice = f.choice(); assert.equal(await f.accept(choice, { commit: async () => false }), false);
  assert.equal(f.creates.length, 1); assert.deepEqual(f.notices, [choice.path]); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0);
});
test("the real frontmatter queue rechecks the source owner after a held prior operation", async () => {
  const f = fixture(), choice = f.choice(), held = deferred(), entered = deferred();
  f.app.fileManager.operations.set(f.app.vault.rootPath + "\0" + f.source.path, held.promise);
  const operation = f.accept(choice, { commit: async (value, guard) => { entered.resolve(); await f.app.fileManager.processFrontMatter(f.source, values => { values.status = value; }, undefined, guard); return true; } });
  await entered.promise; assert.equal(f.app.workspace.isChangingFiles, false, "frontmatter never queues inside the create lock"); f.state.owned = false; held.resolve();
  await assert.rejects(operation, /changed/); assert.equal(f.editor.getValue(), original); assert.equal(f.creates.length, 1); assert.deepEqual(f.notices, [choice.path]);
});
test("a real source reload before YAML application refuses the held property while retaining external bytes", async () => {
  const f = fixture(), choice = f.choice(), external = original + "External body λ\r\n";
  f.beforeReload = () => { f.disk.set(f.source.path, { text: external, bom: true, version: 100 }); };
  await assert.rejects(f.accept(choice), /changed/); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + external)); assert.equal(f.editor.getValue(), external); assert.equal(f.creates.length, 1); assert.deepEqual(f.notices, [choice.path]);
});

function domFixture(kind = "create-note", preserve = true) {
  const document = { defaultView: { AbortController }, createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), createTextNode: text => Object.assign(new Element("#text"), { textContent: text }) };
  class Element {
    constructor(tag) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.children.item = index => this.children[index] ?? null; this.parentElement = null; this.connected = false; this.listeners = new Map(); this.dataset = {}; this.style = {}; this.attributes = new Map(); this.classList = { toggle() {}, add() {}, remove() {} }; this.hidden = false; this.disabled = false; this.readOnly = false; this.value = ""; }
    get isConnected() { return this.connected || Boolean(this.parentElement?.isConnected); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    contains(value) { return value === this || this.children.some(child => child.contains(value)); }
    replaceChildren(...children) { for (const child of this.children) { child.parentElement = null; } this.children.splice(0); this.append(...children); }
    remove() { if (this.parentElement) { const index = this.parentElement.children.indexOf(this); if (index >= 0) this.parentElement.children.splice(index, 1); this.parentElement = null; } this.connected = false; }
    insertBefore(child, present) { child.remove(); const index = this.children.indexOf(present); child.parentElement = this; this.children.splice(index < 0 ? this.children.length : index, 0, child); }
    get lastElementChild() { return this.children.at(-1) ?? null; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, listener, options = {}) { const list = this.listeners.get(type) ?? []; list.push({ listener, capture: options.capture }); this.listeners.set(type, list); }
    fire(type, values = {}) { const event = { key: "", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values }; for (const { listener } of [...this.listeners.get(type) ?? []].sort((a, b) => Number(Boolean(b.capture)) - Number(Boolean(a.capture)))) { listener(event); if (event.stopped) break; } return event; }
    scrollIntoView() {}
    focus() { document.activeElement = this; this.fire("focus"); }
    closest(selector) { for (let node = this; node; node = node.parentElement) { if (selector === "[data-property-key]" && "propertyKey" in node.dataset) return node; } return null; }
    querySelector(selector) { const direct = selector.startsWith(":scope > "); if (direct) selector = selector.slice(9); for (const child of this.children) { if (selector.startsWith(".") && child.className === selector.slice(1)) return child; if (selector.startsWith("input") && child.tagName === "input" && (!selector.includes("aria-label") || selector.includes(child.getAttribute("aria-label")))) return child; if (selector === "[data-metadata-input]" && "metadataInput" in child.dataset) return child; if (!direct) { const nested = child.querySelector(selector); if (nested) return nested; } } return null; }
    querySelectorAll(selector) { const result = []; for (const child of this.children) { if (selector.split(",").includes(child.tagName)) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
    checkVisibility() { return this.isConnected && !this.hidden; }
  }
  const input = document.createElement("input"), container = document.createElement("div"); container.connected = true; container.append(input);
  let locked = false, finish, accepted, calls = 0;
  const choice = { kind, name: "Missing λ", path: "Missing λ.md", value: "[[Missing λ]]" }; let choices = [choice];
  const controller = new api.PropertyValueSuggestions({ input, container, current: () => true, choices: () => choices, preserveOwnedOnBlur: () => preserve && locked,
    accept: (value, query, current) => { calls++; accepted = current; return new Promise(resolve => { finish = resolve; }); }, error: () => {} });
  return { input, container, controller, document, Element, get list() { return container.children[1]; }, lock: value => { locked = value; }, choices: value => { choices = value; }, accepted: () => accepted?.(), finish: () => finish(true), calls: () => calls };
}
test("actual chooser keeps only its pending create token across the owned mutation blur", async () => {
  const f = domFixture(); f.input.value = "[[Missing λ"; f.input.fire("input"); const item = f.list.children[0];
  assert.equal(item.dataset.propertyCreateNote, "Missing λ.md"); assert.ok(item.textContent.startsWith("Create note: "));
  assert.equal(item.fire("pointerdown").defaultPrevented, true); item.fire("click"); assert.equal(f.calls(), 1); assert.equal(f.accepted(), true);
  f.lock(true); f.input.fire("blur"); assert.equal(f.accepted(), true); item.fire("click"); assert.equal(f.calls(), 1);
  f.lock(false); f.input.fire("blur"); assert.equal(f.accepted(), false); f.input.focus(); assert.equal(f.accepted(), false, "ordinary blur remains revoked after a later create refocus"); f.finish(); await Promise.resolve(); await Promise.resolve(); assert.equal(f.controller.suppressBlurCommit, true, "the revoked explicit Create still consumed its unchanged prefix");
});
test("ordinary known-value acceptance still revokes on blur even when a file mutation is locked", async () => {
  const f = domFixture("value"); f.input.value = "Com"; f.input.fire("input"); f.list.children[0].fire("click"); f.lock(true); f.input.fire("blur"); assert.equal(f.accepted(), false); f.input.focus(); assert.equal(f.accepted(), false, "refocus cannot revive a known choice already revoked by ordinary blur"); f.finish(); await Promise.resolve();
});
test("an owned create can restore its input focus after inert blur without revoking or reopening acceptance", async () => {
  const f = domFixture(); f.input.value = "[[Missing λ"; f.input.fire("input"); f.list.children[0].fire("click"); f.lock(true); f.input.fire("blur");
  assert.equal(f.accepted(), true); f.lock(false);
  try { f.input.focus(); assert.equal(f.accepted(), true); assert.equal(f.controller.isOpen, false); assert.equal(f.calls(), 1); }
  finally { f.finish(); await Promise.resolve(); }
});
test("creation needs explicit Arrow/Enter or pointer acceptance and stale input revokes the queued action", async () => {
  const f = domFixture(); f.input.value = "[[Missing λ"; f.input.fire("input"); f.input.fire("keydown", { key: "Enter" }); assert.equal(f.calls(), 0);
  f.input.fire("keydown", { key: "ArrowDown" }); assert.equal(f.input.fire("keydown", { key: "Enter" }).defaultPrevented, true); assert.equal(f.calls(), 1);
  f.input.value = "[[New query"; assert.equal(f.accepted(), false); f.finish(); await Promise.resolve();
  const cancelled = domFixture(); cancelled.input.value = "[[Missing λ"; cancelled.input.fire("input"); cancelled.input.fire("keydown", { key: "Escape" }); assert.equal(cancelled.controller.isOpen, false); assert.equal(cancelled.calls(), 0);
});
test("a consumed Create draft blocks literal blur/Enter until fresh input or cancellation and still admits an explicit known choice", async () => {
  const f = domFixture(); let literalEnter = 0;
  f.input.addEventListener("keydown", event => { if (event.key === "Enter") literalEnter++; });
  f.input.value = "[[Missing λ"; f.input.fire("input"); f.list.children[0].fire("click"); f.finish(); await Promise.resolve(); await Promise.resolve();
  f.input.fire("blur"); assert.equal(f.controller.suppressBlurCommit, true); assert.equal(f.input.fire("keydown", { key: "Enter" }).defaultPrevented, true); assert.equal(literalEnter, 0);
  assert.equal(f.input.fire("keydown", { key: "Tab" }).defaultPrevented, false, "normal focus navigation remains available");
  f.choices([{ kind: "link", value: "[[Missing λ]]", targetPath: "Missing λ.md" }]); f.input.focus(); f.input.fire("keydown", { key: "ArrowDown" }); f.input.fire("keydown", { key: "Enter" });
  assert.equal(f.calls(), 2, "consuming the creation draft does not block a deliberately selected known-note replacement"); assert.equal(literalEnter, 0); f.finish(); await Promise.resolve(); await Promise.resolve();
  f.input.value = "Fresh literal λ"; f.input.fire("input"); assert.equal(f.controller.suppressBlurCommit, false); f.input.fire("keydown", { key: "Enter" }); assert.equal(literalEnter, 1);
  for (const event of ["input", "compositionstart", "compositionend", "Escape"]) {
    const reset = domFixture(); reset.input.value = "[[Missing λ"; reset.input.fire("input"); reset.list.children[0].fire("click"); reset.finish(); await Promise.resolve(); await Promise.resolve();
    assert.equal(reset.controller.suppressBlurCommit, true);
    if (event === "Escape") { reset.input.fire("keydown", { key: "Escape" }); assert.equal(reset.controller.suppressBlurCommit, false); }
    else {
      reset.input.fire(event); assert.equal(reset.controller.suppressBlurCommit, true, event + " alone did not change the consumed draft");
      reset.input.value = "A genuinely fresh draft λ";
      if (event === "input") reset.input.fire("input"); else { reset.input.fire("input", { isComposing: true }); reset.input.fire("compositionend"); }
      assert.equal(reset.controller.suppressBlurCommit, false, event + " with a changed final draft permits ordinary saving");
    }
    reset.controller.dispose();
  }
  const known = domFixture("value"); known.input.value = "Ordinary value"; known.input.fire("input"); known.list.children[0].fire("click"); known.finish(); await Promise.resolve(); await Promise.resolve(); assert.equal(known.controller.suppressBlurCommit, false); known.controller.dispose(); f.controller.dispose();
});

async function actualRow(change, assertion) {
  const dom = domFixture(), f = fixture(), globals = Object.fromEntries(["document", "HTMLInputElement", "propertyCreationNotices", "propertyCreationReported"].map(key => [key, globalThis[key]]));
  dom.controller.dispose(); dom.container.replaceChildren();
  globalThis.document = dom.document; globalThis.HTMLInputElement = dom.Element; globalThis.propertyCreationNotices = []; globalThis.propertyCreationReported = [];
  const view = new TestMarkdownView(); view.containerEl = dom.container; view.mode = "preview"; view.editing = "live-preview";
  const owner = { id: "actual-source", view }; f.app.workspace.leaves = () => [owner]; f.app.workspace.getLeafById = id => id === owner.id ? owner : null;
  f.app.core.run = action => Promise.resolve().then(action);
  const properties = new api.Properties(f.app); let row, refreshes = 0;
  const render = () => { row?.cleanup?.(); row?.containerEl.remove(); const value = api.parseMarkdown(f.editor.getValue()).frontmatter.status; row = inlinePropertyRow(properties, f.source, "status", value, () => { refreshes++; render(); }, () => true); dom.container.append(row.containerEl); };
  try {
    render(); const input = row.valueEl.querySelector("input"), focusAtEdits = [], dispatch = f.cm.dispatch;
    f.cm.dispatch = specification => { dispatch(specification); focusAtEdits.push({ source: f.editor.getValue(), focused: dom.document.activeElement === input, connected: input.isConnected }); };
    f.onLock = () => { dom.document.activeElement = null; input.fire("blur"); };
    change?.(f, view);
    input.focus(); input.value = "[[Missing λ"; input.fire("input");
    const list = row.valueEl.children.find(child => child.dataset.propertyValueSuggestions === "true"), button = list.children.find(child => child.dataset.propertyCreateNote === "Missing λ.md");
    assert.ok(button); button.fire("pointerdown"); button.fire("click");
    for (let index = 0; index < 10 && (f.app.workspace.isChangingFiles || !refreshes && !globalThis.propertyCreationNotices.length); index++) await new Promise(resolve => setImmediate(resolve));
    await assertion({ ...f, view, owner, row: () => row, input, focusAtEdits, refreshes: () => refreshes, notices: globalThis.propertyCreationNotices, reported: globalThis.propertyCreationReported });
  } finally { row?.cleanup?.(); for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
}
test("the actual Properties row accepts one create across inert blur and consumes its draft through the ordinary YAML queue", async () => {
  await actualRow(null, async f => {
    assert.equal(f.refreshes(), 1); assert.equal(f.creates.length, 1); assert.equal(f.editor.getValue(), original.replace("status: Open #", 'status: "[[Missing λ]]" #'));
    const fresh = f.row().valueEl.querySelector("input"); assert.equal(f.input.isConnected, false); assert.equal(fresh.value, "[[Missing λ]]");
    assert.ok(f.focusAtEdits.some(value => value.source !== original)); assert.ok(f.focusAtEdits.filter(value => value.source !== original).every(value => value.focused && value.connected), "the actual property editor edit retains its owned focused field for synchronous MetadataEditor rendering");
    f.input.fire("blur"); fresh.fire("blur"); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.writes.length, 1);
    assert.equal(undoDepth(f.cm.state), 1); f.editor.undo(); assert.equal(f.editor.getValue(), original); assert.ok(f.files.has("Missing λ.md")); assert.deepEqual(f.notices, []); assert.deepEqual(f.reported, []);
  });
});
test("the actual Properties row refuses a post-acknowledgement view mode change while retaining the created note", async () => {
  for (const stage of ["before focus", "during focus"]) {
    await actualRow((f, view) => { f.afterWrite = () => {
      if (stage === "before focus") { view.mode = "source"; }
      else { view.containerEl.querySelector("input").addEventListener("focus", () => { view.mode = "source"; }); }
    }; }, async f => {
      assert.equal(f.refreshes(), 0); assert.equal(f.creates.length, 1); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0);
      assert.equal(f.notices.length, 1); assert.match(f.notices[0], /new note was kept/); assert.deepEqual(f.reported, []);
    });
  }
});
test("the actual Properties row rechecks its mode after the real queued session reload", async () => {
  await actualRow((f, view) => { f.beforeReload = () => { view.mode = "source"; }; }, async f => {
    assert.equal(f.refreshes(), 0); assert.equal(f.creates.length, 1); assert.equal(f.editor.getValue(), original); assert.equal(f.writes.length, 0); assert.equal(f.notices.length, 1);
  });
});
test("a post-editor source save failure retains the partial property edit and asks the user to review it accurately", async () => {
  let saves = 0;
  await actualRow(f => { f.beforeSessionSave = () => { if (++saves === 3) throw new Error("Source save failed after property editor change"); }; }, async f => {
    assert.equal(saves, 3); assert.equal(f.refreshes(), 0); assert.equal(f.creates.length, 1);
    assert.equal(f.editor.getValue(), original.replace("status: Open #", 'status: "[[Missing λ]]" #'), "the actual guarded YAML operation has already applied its editor edit");
    assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original), "the failed source save retains its prior physical bytes");
    assert.deepEqual(f.bytes("Missing λ.md"), Buffer.alloc(0)); assert.equal(undoDepth(f.cm.state), 1);
    assert.equal(f.notices.length, 1); assert.equal(f.notices[0].includes("no property link was inserted"), false, "a partial commit cannot be described as no insertion");
    assert.match(f.notices[0], /review the property and any unsaved changes/);
    const fieldError = f.row().containerEl.children.find(element => element.className === "metadata-property-error");
    assert.equal(fieldError.textContent, "Source save failed after property editor change");
    f.editor.undo(); assert.equal(f.editor.getValue(), original); assert.ok(f.files.has("Missing λ.md"), "Undo never deletes the acknowledged note");
  });
});
test("a failed real Create cannot reapply its literal draft after blur or Enter overtakes property Undo", async () => {
  for (const trigger of ["blur", "Enter"]) {
    let saves = 0;
    await actualRow(f => { f.beforeSessionSave = () => { if (++saves === 3) throw new Error("Source save failed after property editor change"); }; }, async f => {
      const partial = original.replace("status: Open #", 'status: "[[Missing λ]]" #');
      assert.equal(f.editor.getValue(), partial); assert.equal(f.input.value, "[[Missing λ"); assert.equal(f.creates.length, 1); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original));
      f.beforeSessionSave = undefined; f.view.mode = "source";
      if (trigger === "blur") f.input.fire("blur"); else f.input.fire("keydown", { key: "Enter" });
      f.editor.undo(); assert.equal(f.editor.getValue(), original, "trusted editor Undo removes the one property insertion before any later queue work");
      await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); await f.app.saveAll();
      assert.equal(f.editor.getValue(), original, trigger + " must not reapply the chosen incomplete query after Undo"); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original)); assert.deepEqual(f.bytes("Missing λ.md"), Buffer.alloc(0)); assert.equal(undoDepth(f.cm.state), 0); assert.equal(f.writes.length, 0);
      assert.equal(f.row().containerEl.children.find(element => element.className === "metadata-property-error").textContent, "Source save failed after property editor change");
      f.view.mode = "preview"; f.input.focus();
      const list = f.row().valueEl.children.find(child => child.dataset.propertyValueSuggestions === "true"), known = list.children.find(child => child.dataset.propertyLinkTarget === "Missing λ.md");
      assert.ok(known, "the indexed acknowledged note is still offered for deliberate known-note completion"); known.fire("click"); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.editor.getValue(), partial); assert.equal(f.creates.length, 1); assert.equal(f.writes.length, 1); assert.equal(undoDepth(f.cm.state), 1);
    });
  }
});
test("cancelled or no-op composition cannot rearm a failed real Create draft after Undo", async () => {
  const patterns = [
    ["cancelled composition", input => { input.fire("compositionstart"); input.value += "語"; input.fire("input", { isComposing: true }); input.value = "[[Missing λ"; input.fire("input", { isComposing: true }); input.fire("compositionend"); input.fire("input"); }],
    ["no-op composition", input => { input.fire("compositionstart"); input.fire("compositionend"); }],
    ["composing input ordering", input => { input.value += "語"; input.fire("input", { isComposing: true }); input.value = "[[Missing λ"; input.fire("input", { isComposing: true }); input.fire("compositionend"); input.fire("input"); }],
    ["unchanged input", input => input.fire("input")],
  ];
  for (const [name, compose] of patterns) for (const trigger of ["blur", "Enter"]) {
    let saves = 0;
    await actualRow(f => { f.beforeSessionSave = () => { if (++saves === 3) throw new Error("Source save failed after property editor change"); }; }, async f => {
      f.beforeSessionSave = undefined; compose(f.input); assert.equal(f.input.value, "[[Missing λ"); f.view.mode = "source";
      if (trigger === "blur") f.input.fire("blur"); else f.input.fire("keydown", { key: "Enter" });
      f.editor.undo(); assert.equal(f.editor.getValue(), original); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); await f.app.saveAll();
      assert.equal(f.editor.getValue(), original, name + " must not reapply the incomplete creation query through " + trigger); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original)); assert.deepEqual(f.bytes("Missing λ.md"), Buffer.alloc(0)); assert.equal(f.writes.length, 0); assert.equal(undoDepth(f.cm.state), 0);
      assert.equal(f.row().containerEl.children.find(element => element.className === "metadata-property-error").textContent, "Source save failed after property editor change");
      f.view.mode = "preview"; f.input.focus(); f.input.fire("keydown", { key: "ArrowDown" }); f.input.fire("keydown", { key: "Enter" }); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
      assert.equal(api.parseMarkdown(f.editor.getValue()).frontmatter.status, "[[Missing λ]]", "a deliberately selected indexed known note still completes after " + name); assert.equal(f.creates.length, 1); assert.equal(f.writes.length, 1); assert.equal(undoDepth(f.cm.state), 1);
    });
  }
});
test("a genuinely changed final composition remains an ordinary editable draft after failed creation Undo", async () => {
  for (const trigger of ["blur", "Enter"]) {
    let saves = 0;
    await actualRow(f => { f.beforeSessionSave = () => { if (++saves === 3) throw new Error("Source save failed after property editor change"); }; }, async f => {
      f.beforeSessionSave = undefined; f.editor.undo(); await f.app.saveAll(); assert.equal(f.editor.getValue(), original);
      const changed = "Fresh composition 語"; f.input.fire("compositionstart"); f.input.value = changed; f.input.fire("input", { isComposing: true }); f.input.fire("compositionend"); f.input.fire("input");
      if (trigger === "blur") f.input.fire("blur"); else f.input.fire("keydown", { key: "Enter" });
      await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); await f.app.saveAll();
      const expected = original.replace("status: Open #", "status: " + changed + " #");
      assert.equal(f.editor.getValue(), expected); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + expected)); assert.deepEqual(f.bytes("Missing λ.md"), Buffer.alloc(0)); assert.equal(f.creates.length, 1); assert.equal(f.writes.length, 1); assert.equal(undoDepth(f.cm.state), 1);
    });
  }
});

async function actualPane(change, assertion) {
  const dom = domFixture(), f = fixture(), globals = Object.fromEntries(["document", "HTMLInputElement", "CSS"].map(key => [key, globalThis[key]]));
  dom.controller.dispose(); dom.container.replaceChildren(); globalThis.document = dom.document; globalThis.HTMLInputElement = dom.Element; globalThis.CSS = { escape: value => value };
  const properties = new api.Properties(f.app), pane = Object.create(api.PropertiesView.prototype), owner = { id: "fixed-properties", view: pane };
  Object.assign(pane, { app: f.app, properties, leaf: owner, sourceRoot: f.app.vault.rootPath, containerEl: dom.container });
  Object.defineProperty(pane, "isLoaded", { value: true, writable: true });
  f.app.core.run = action => Promise.resolve().then(action);
  f.app.workspace.leaves = () => [owner]; f.app.workspace.getLeafById = id => id === owner.id ? owner : null;
  const metadata = new api.MetadataEditor(properties, () => f.source, { isCurrent: ownedMutation => pane.interactive(ownedMutation), entries: values => [["status", values.status]] });
  dom.container.append(metadata.contentEl); metadata.render();
  const input = metadata.contentEl.querySelector("input");
  f.onLock = () => { dom.document.activeElement = null; input.fire("blur"); metadata.render(); assert.equal(pane.interactive(), false); assert.equal(metadata.contentEl.inert, true); };
  f.afterLock = () => { metadata.render(); };
  try {
    change?.(f, pane, owner); input.focus(); input.value = "[[Missing λ"; input.fire("input");
    const list = metadata.rendered[0].valueEl.children.find(child => child.dataset.propertyValueSuggestions === "true"), button = list.children.find(child => child.dataset.propertyCreateNote === "Missing λ.md");
    assert.ok(button); button.fire("click");
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    await assertion({ ...f, pane, owner, metadata });
  } finally { for (const property of metadata.rendered) property.cleanup?.(); for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
}
test("the real fixed Properties pane and MetadataEditor admit only the owned create across their temporary file lock", async () => {
  await actualPane(null, async f => {
    assert.equal(f.creates.length, 1); assert.equal(f.editor.getValue(), original.replace("status: Open #", 'status: "[[Missing λ]]" #'));
    assert.equal(f.metadata.contentEl.inert, false); assert.equal(f.pane.interactive(), true); assert.equal(undoDepth(f.cm.state), 1); f.editor.undo(); assert.equal(f.editor.getValue(), original);
  });
});
test("the real fixed Properties pane keeps root, lifetime, core and layout guards during an owned create", async () => {
  for (const change of [(f, pane) => { pane.isLoaded = false; }, (f, pane) => { pane.sourceRoot = "elsewhere"; }, (f, _pane, owner) => { owner.view = {}; }, f => { f.app.core.busy = true; }, f => { f.app.workspace.isChangingLayout = true; }]) {
    await actualPane((f, pane, owner) => { f.beforeSaveAll = () => change(f, pane, owner); }, async f => {
      assert.equal(f.creates.length, 0); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0);
    });
  }
});

test("the helper saved-byte boundary waits for a real DocumentSession correction write after property Undo", async () => {
  const f = fixture(), first = deferred(), correcting = deferred(), started = deferred(), correctionStarted = deferred(), writes = [];
  const workspace = { app: f.app, sessions: f.sessions, trigger() {}, notifyEditor() {} };
  const session = new api.DocumentSession(workspace, f.session.document), view = { editor: f.editor, leaf: { updateHeader() {} } };
  f.sessions.set(f.source.path, session); session.leaves.add(view);
  const dispatch = f.cm.dispatch;
  f.cm.dispatch = specification => { dispatch(specification); session.edit(view); };
  f.app.vault.writeDocument = async (path, text, version) => {
    assert.equal(version, f.disk.get(path).version); writes.push(text);
    if (writes.length === 1) { started.resolve(); await first.promise; }
    else { correctionStarted.resolve(); await correcting.promise; }
    const saved = { file: { path }, content: text, version: ++f.state.version, hasBom: true };
    f.disk.set(path, { text, bom: true, version: saved.version }); return saved;
  };
  const from = original.indexOf("Open #"), partial = original.replace("status: Open #", 'status: "[[Missing λ]]" #');
  f.editor.replaceExpected(original, from, from + 4, '"[[Missing λ]]"', "input.properties");
  const operation = session.save(); let saved = false, normalSave;
  try {
    await started.promise; f.editor.undo(); assert.equal(session.text, original); assert.equal(session.dirty, false); assert.equal(session.isSaving, true);
    const line = helperSource.split("\n").find(line => line.includes(', "exact Properties source saved"'));
    const argument = line.slice(line.indexOf("wait(") + 5, line.indexOf(', "exact Properties source saved"'));
    const expression = new Function("q", "source", "expected", "path", "return (" + argument + ")")(JSON.stringify, 'app.workspace.sessions.get(' + JSON.stringify(f.source.path) + ').text', original, f.source.path);
    assert.equal(new Function("app", "return (" + expression + ")")(f.app), false, "a clean Undo buffer is not saved while the older property write is still running");
    normalSave = session.save().then(() => { saved = true; }); first.resolve(); await correctionStarted.promise;
    assert.equal(saved, false); assert.equal(session.dirty, true); assert.equal(session.isSaving, true); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + partial));
    correcting.resolve(); await Promise.all([operation, normalSave]);
    assert.equal(session.text, original); assert.equal(session.dirty, false); assert.equal(session.isSaving, false); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original));
    assert.deepEqual(writes, [partial, original]); assert.equal(undoDepth(f.cm.state), 0);
  } finally { first.resolve(); correcting.resolve(); await Promise.all([operation, normalSave]); }
});

test("the helper holds only the post-create property queue reload, delegating file-lock refresh reloads", async () => {
  const f = fixture(), choice = f.choice(), trace = {}, row = { getAttribute: () => busy ? "true" : null }; let busy = false;
  const line = helperSource.split("\n").find(line => line.includes("t.reload=t.session.reload"));
  const argument = line.slice(line.indexOf("evaluate(") + 9, line.lastIndexOf(");"));
  const expression = new Function("q", "path", "queuedPath", "host", "return (" + argument + ")")(JSON.stringify, f.source.path, choice.path, "fixture");
  new Function("app", "propertyCreationTrace", "document", expression)(f.app, trace, { querySelector: () => row });
  f.onRefresh = () => f.session.reload(false);
  const operation = f.accept(choice, { commit: async (value, guard) => { busy = true; await f.app.fileManager.processFrontMatter(f.source, values => { values.status = value; }, undefined, guard); return true; } });
  const outcome = operation.then(value => ({ value }), error => ({ error }));
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.creates.length, 1, "pre-create metadata refresh reloads must not be held by the property-queue probe");
    assert.equal(f.app.workspace.isChangingFiles, false); assert.equal(trace.waiting, true); assert.equal(busy, true);
    f.state.owned = false; trace.release(); const result = await outcome;
    assert.match(result.error?.message ?? "", /changed/); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original)); assert.deepEqual(f.bytes(choice.path), Buffer.alloc(0));
    assert.deepEqual(f.notices, [choice.path]); assert.ok(trace.reloadContexts.some(context => context.changingFiles && !context.intercepted)); assert.equal(trace.reloadContexts.filter(context => context.intercepted).length, 1);
  } finally { trace.release?.(); await outcome; f.session.reload = trace.reload; }
});

test("the actual read-only helper points at disabled inputs without the enabled-only click helper and refuses occluded targets", async () => {
  const exercise = async (hit = true) => {
    const report = { checks: [] }, commands = [], root = { dataset: {} }, source = "---\nrelated: \"\"\nlinks: [kept]\n---\nCached body λ\n";
    const fields = ["related", "links"].map((key, index) => ({ key, value: "", disabled: true, forced: 0, scrolled: 0,
      checkVisibility: () => true, scrollIntoView() { this.scrolled++; }, getBoundingClientRect: () => ({ left: 20, top: 30 + index * 50, width: 100, height: 24 }),
      dispatchEvent() { this.forced++; }, blur() {} }));
    const app = { vault: { readOnly: true, getFiles: () => [{ path: "Read only.md" }] }, editor: { getValue: () => source },
      workspace: { activeLeaf: { view: { metadataEditor: { contentEl: root }, setMode() {}, setEditingMode() {} } } } };
    const document = { querySelector: selector => fields.find(field => selector.includes('data-property-key="' + field.key + '"')),
      querySelectorAll: selector => selector === "[data-property-creation-root]" ? [root] : [],
      elementFromPoint: (x, y) => hit ? fields.find(field => { const rect = field.getBoundingClientRect(); return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height; }) : null };
    const evaluate = expression => new Function("app", "document", "InputEvent", "return (" + expression + ")")(app, document, class InputEvent {});
    const tools = { report, evaluate, wait: async expression => assert.ok(evaluate(expression)), click: () => { throw new Error("Disabled input cannot pass an enabled-only click helper"); },
      command: async (method, parameters) => { commands.push({ method, ...parameters }); }, capture: async () => {} };
    if (!hit) { await assert.rejects(checkPropertyNoteCreationReadOnly(tools), /hit|occlud|pointer/i); assert.equal(commands.length, 0); return; }
    await checkPropertyNoteCreationReadOnly(tools);
    assert.deepEqual(commands.filter(command => command.method === "Input.dispatchMouseEvent").map(command => command.type), ["mouseMoved", "mousePressed", "mouseReleased", "mouseMoved", "mousePressed", "mouseReleased"]);
    assert.equal(commands.filter(command => command.method === "Input.insertText").length, 2); assert.equal(commands.filter(command => command.method === "Input.dispatchKeyEvent" && command.key === "Enter").length, 4);
    assert.ok(fields.every(field => field.disabled && field.value === "" && field.forced === 1 && field.scrolled === 1)); assert.equal(report.propertyNoteCreation.trustedReadOnlyTypingDeclined, true); assert.equal(report.propertyNoteCreation.cachedSourceAndInventoryExact, true);
  };
  await exercise(); await exercise(false);
});
