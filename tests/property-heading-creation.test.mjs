import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undoDepth } from "@codemirror/commands";

// Transform TypeScript only in this test process: no emitted build or browser host.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) { return next(specifier + ".ts", context); }
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith("/client/error-log.ts")) { return { format: "module", shortCircuit: true, source: 'export function recordError(error){return {error:{message:String(error)}}} export async function downloadErrorLog(){}' }; }
    if (!url.includes("/client/") || !url.endsWith(".ts")) { return next(url, context); }
    let source = readFileSync(fileURLToPath(url), "utf8");
    if (url.endsWith("/properties.ts")) { source += "\nexport {inlinePropertyRow};"; }
    if (url.endsWith("/ui.ts")) { source = source.replace("export class Notice {", "class OriginalNotice {") + '\nexport class Notice { constructor(message){globalThis.propertyHeadingNotices.push(message)} }'; }
    if (url.endsWith("/dom.ts")) { source = source.replace(/export function reportError\(error: unknown\): void \{[\s\S]*?\n\}/, 'export function reportError(error: unknown): void { globalThis.propertyHeadingReported.push(error); }'); }
    return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(source, { mode: "transform" }) };
  }
});
const feature = await import("../client/property-value-suggestions.ts"), { FileManager } = await import("../client/file-manager.ts"), { Editor } = await import("../client/editor.ts");
const { Properties, inlinePropertyRow } = await import("../client/properties.ts"), { MarkdownView } = await import("../client/workspace.ts");
const { TFile } = await import("../client/vault.ts"), { parseMarkdown } = await import("../client/markdown.ts"), { fileLinktext, resolveLink, resolveSubpath } = await import("../client/links.ts");
const { planHeadingCreation } = await import("../client/heading-authoring.ts");
const original = '---\r\n# Preserve comment λ\r\nstatus: Open # keep scalar comment\r\nlabels: [ kept ]\r\ncount: 1.50\r\nopaque: { keep: exact }\r\n---\r\n# Source λ\r\n\r\nUntouched 😀 body.\r\n';
const targetOriginal = '---\r\nopaque: { target: "λ 😀" }\r\n---\r\n# Parent\r\n\r\nExisting parent body Ω.\r\n\r\n# Sibling\r\n\r\nUntouched final body.\r\n';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const drain = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const files = new Map(), disk = new Map(), documents = new Map(), sessions = new Map(), writes = [], kept = [], reported = [], accepted = [];
  const state = { owned: true, version: 1, refreshes: 0, widget: null }, config = new Map(Object.entries({ newFileLocation: "root", newFileFolderPath: "", newLinkFormat: "shortest", useMarkdownLinks: true }));
  const app = { changingVault: false, vault: { rootPath: "heading-properties", readOnly: false }, workspace: { sessions, isChangingFiles: false, isChangingLayout: false }, core: { busy: false, isEnabled: () => true, run: action => Promise.resolve().then(action) }, metadataTypeManager: { getAssignedWidget: () => state.widget } };
  const index = file => { const entry = disk.get(file.path); documents.set(file.path, { document: { file: { path: file.path }, content: entry.text, version: entry.version, hasBom: true }, text: entry.text, cache: parseMarkdown(entry.text), missing: false }); };
  const add = (path, text) => { const file = new TFile(app.vault, { path, basename: path.split("/").at(-1).slice(0, -3), extension: "md", stat: { size: text.length, ctime: 1, mtime: 1 } }); files.set(path, file); disk.set(path, { text, version: state.version++ }); index(file); return file; };
  const source = add("Source folder/Source.md", original), target = add("Targets/Target.md", targetOriginal), editor = Object.create(Editor.prototype);
  const cm = { hasFocus: true, state: EditorState.create({ doc: original, extensions: [history(), EditorState.lineSeparator.of("\r\n"), EditorView.editable.of(true)] }) };
  let session;
  cm.dispatch = spec => { cm.state = (spec.startState ? spec : cm.state.update(spec)).state; if (session) session.text = editor.getValue(); };
  editor.cm = cm;
  const view = Object.assign(Object.create(MarkdownView.prototype), { editor, file: source, mode: "preview", sourceEditing: false });
  session = { originRoot: app.vault.rootPath, text: original, isReloading: false, isSaving: false, leaves: new Set([view]), document: documents.get(source.path).document,
    get dirty() { return this.text !== disk.get(source.path).text; },
    async save() { this.isSaving = true; try { await f.beforeSave?.(); if (this.text !== disk.get(source.path).text) { disk.set(source.path, { text: this.text, version: state.version++ }); writes.push({ path: source.path, text: this.text }); } index(source); this.document = documents.get(source.path).document; } finally { this.isSaving = false; } },
    async reload() { await f.beforeReload?.(); const entry = disk.get(source.path); if (entry.text !== this.text) { cm.state = EditorState.create({ doc: entry.text, extensions: [history(), EditorState.lineSeparator.of("\r\n")] }); this.text = entry.text; } index(source); this.document = documents.get(source.path).document; }
  };
  sessions.set(source.path, session);
  Object.assign(app.vault, {
    getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()], getFileByPath: path => files.get(path) ?? null,
    getAbstractFileByPath: path => files.get(path) ?? null, getConfig: key => config.get(key), assertWritable() { if (this.readOnly) throw Error("Read-only vault"); },
    async readDocument(path) { await f.beforeRead?.(path); const entry = disk.get(path); return { file: { path }, content: entry.text, version: entry.version, hasBom: true }; },
    async writeDocument(path, text, version) { await f.beforeWrite?.(path, text); if (version !== disk.get(path).version) throw Error("Physical target changed; optimistic write refused"); disk.set(path, { text, version: state.version++ }); writes.push({ path, text }); index(files.get(path)); return { file: { path }, content: text, version: disk.get(path).version, hasBom: true }; },
    notifyFileChanged() {}
  });
  app.metadataCache = { getDocument: path => documents.get(path), getDocuments: () => [...documents.values()], getFileCache: file => documents.get(file.path)?.cache,
    fileToLinktext: (file, path, omit) => fileLinktext([...files.values()], file.path, path, omit, config.get("newLinkFormat")),
    resolveReference: (reference, path) => resolveLink([...files.values()], reference.link, path),
    async refresh() { state.refreshes++; await f.onRefresh?.(); for (const file of files.values()) index(file); }, async pause() {}, resume() {}
  };
  app.saveAll = async () => { await f.beforeSaveAll?.(); await session.save(); };
  app.notifyEditor = async () => { await f.onNotify?.(); };
  app.workspace.withFileMutation = async action => { app.workspace.isChangingFiles = true; await f.onLock?.(); try { return await action(); } finally { app.workspace.isChangingFiles = false; await f.afterLock?.(); } };
  app.workspace.track = promise => promise; app.workspace.leaves = () => [];
  app.workspace.acceptExternalDocuments = (values, preserveHistory) => { accepted.push({ values, preserveHistory }); for (const document of values) { const targetSession = sessions.get(document.file.path); if (targetSession) { targetSession.text = document.content; targetSession.document = document; } } };
  app.fileManager = new FileManager(app); const properties = new Properties(app);
  const f = { app, files, disk, documents, sessions, source, target, editor, cm, session, view, state, config, writes, kept, reported, accepted, add, index };
  f.choice = (query = "[[Target#Parent#New child λ", widget = "text", property = "status", existing = []) => feature.propertyHeadingCreationChoice(app, source, property, widget, existing, query);
  f.accept = (choice = f.choice(), extra = {}) => feature.createPropertyHeading(app, choice, { widget: choice.widget, existing: choice.existing, query: choice.query, current: () => state.owned,
    commit: async (value, guard) => { assert.equal(app.workspace.isChangingFiles, false); const prior = parseMarkdown(choice.sourceText).frontmatter[choice.property], next = choice.widget === "multitext" ? [...choice.existing, value] : value; await properties.changeValue(source, choice.property, prior, next, choice.widget, guard); return true; }, kept: path => kept.push(path), acknowledgedFailure: issue => reported.push(issue), ...extra });
  f.bytes = path => Buffer.from("\ufeff" + disk.get(path).text);
  return f;
}

test("a distinct explicit heading/chain choice leaves ordinary known subpaths and missing-note enumeration noncreating", () => {
  const f = fixture(), choice = f.choice(); assert.equal(choice.kind, "create-heading"); assert.equal(choice.target, f.target); assert.equal(choice.value, "[[Target#Parent#New child λ]]");
  assert.equal(f.choice("[[Target#Parent#New chain#Terminal").heading.newHeadings.length, 2);
  assert.deepEqual(feature.propertyValueChoices(f.app, f.source, "status", "text", [], choice.query), []);
  assert.ok(feature.propertyValueChoices(f.app, f.source, "status", "text", [], "[[Target#Par").some(value => value.kind === "subpath"));
  assert.equal(f.choice("[[Target#Par"), null); assert.equal(f.choice("[[Target#Parent"), null); assert.equal(f.choice("[[Missing#Parent#Child"), null);
  assert.equal(feature.propertyNoteCreationChoice(f.app, f.source, "status", "text", [], choice.query), null); assert.deepEqual(f.writes, []);
});

test("empty/global/block/unsafe, unsupported widget and duplicate list targets decline conservatively", () => {
  const f = fixture();
  for (const query of ["[[Target#", "[[Target#^missing", "[[Target#Parent#<Unsafe>", "[[Target#Parent#Missing]] suffix", "[[Target#Parent#" + "x".repeat(257)]) assert.equal(f.choice(query), null, query);
  for (const widget of ["tags", "aliases", "number", "date", "unknown"]) assert.equal(f.choice(undefined, widget), null);
  assert.equal(f.choice(undefined, "multitext", "labels", ["[[../Targets/Target#parent#new child λ]]"]), null);
});

test("real optimistic FileManager target write precedes exact YAML insertion and isolated source Undo keeps every target heading", async () => {
  for (const format of ["shortest", "relative", "absolute"]) for (const property of ["status", "labels"]) {
    const f = fixture(); f.config.set("newLinkFormat", format); const choice = f.choice("[[Target#Parent#New chain#Terminal λ", property === "labels" ? "multitext" : "text", property, property === "labels" ? ["kept"] : []), target = planHeadingCreation(targetOriginal, choice.heading).text;
    assert.equal(await f.accept(choice), true); const expected = property === "status" ? original.replace("status: Open #", "status: " + JSON.stringify(choice.value) + " #") : original.replace("labels: [ kept ]", "labels: [ kept, " + JSON.stringify(choice.value) + " ]");
    assert.deepEqual(f.writes.map(value => value.path), [f.target.path, f.source.path]); assert.deepEqual(f.bytes(f.target.path), Buffer.from("\ufeff" + target)); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + expected)); assert.equal(undoDepth(f.cm.state), 1);
    assert.equal(f.accepted[0].preserveHistory, true); f.editor.undo(); assert.equal(f.editor.getValue(), original); await f.app.saveAll(); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original)); assert.deepEqual(f.bytes(f.target.path), Buffer.from("\ufeff" + target)); assert.deepEqual(f.kept, []); assert.deepEqual(f.reported, []);
  }
});

test("a clean open target keeps its exact session identity and acknowledged document; a replacement session during preflight refuses", async () => {
  const f = fixture(), session = { originRoot: f.app.vault.rootPath, text: targetOriginal, dirty: false, isSaving: false, isReloading: false, document: f.documents.get(f.target.path).document };
  f.sessions.set(f.target.path, session); const choice = f.choice(); assert.equal(choice.targetSession, session); assert.equal(await f.accept(choice), true);
  assert.equal(f.sessions.get(f.target.path), session); assert.equal(session.text, planHeadingCreation(targetOriginal, choice.heading).text); assert.equal(session.document.content, session.text); f.editor.undo(); assert.equal(f.editor.getValue(), original); assert.equal(session.text, f.disk.get(f.target.path).text);
  const changed = fixture(), prior = { originRoot: changed.app.vault.rootPath, text: targetOriginal, dirty: false, isSaving: false, isReloading: false }; changed.sessions.set(changed.target.path, prior); const reviewed = changed.choice();
  changed.beforeSaveAll = () => { changed.sessions.set(changed.target.path, { ...prior }); }; await assert.rejects(changed.accept(reviewed), /changed/); assert.deepEqual(changed.writes, []);
});

test("dirty, reloading, wrong-root, missing and replacement target sessions refuse before a target write", async () => {
  for (const change of [f => { f.app.vault.readOnly = true; }, f => { f.state.owned = false; }, f => { f.state.widget = "number"; }, f => { f.app.vault.rootPath = "other"; }, f => { f.config.set("useMarkdownLinks", false); }, f => { f.sessions.set(f.source.path, { ...f.session }); }, f => { f.files.set(f.target.path, { ...f.target }); }]) {
    const f = fixture(), choice = f.choice(); change(f); await assert.rejects(f.accept(choice)); assert.deepEqual(f.writes, []); assert.deepEqual(f.kept, []);
  }
  for (const change of [session => { session.dirty = true; }, session => { session.isSaving = true; }, session => { session.isReloading = true; }, session => { session.originRoot = "other"; }]) {
    const f = fixture(), session = { originRoot: f.app.vault.rootPath, dirty: false, isReloading: false, text: targetOriginal }; f.sessions.set(f.target.path, session); change(session); assert.equal(f.choice(), null);
  }
});

test("SaveAll/prewrite rechecks exact source, target, widget, preference and session identities", async () => {
  for (const change of [f => { f.state.owned = false; }, f => { f.state.widget = "number"; }, f => { f.config.set("newLinkFormat", "absolute"); }, f => { f.sessions.set(f.source.path, { ...f.session }); }, f => { f.disk.set(f.target.path, { text: targetOriginal + "Changed target", version: 99 }); }, f => { f.files.set(f.target.path, { ...f.target }); }]) {
    const f = fixture(), choice = f.choice(); f.beforeSaveAll = () => change(f); await assert.rejects(f.accept(choice)); assert.equal(f.writes.some(value => value.path === f.target.path), false); assert.equal(f.editor.getValue(), original);
  }
});

test("an unobserved physical target conflict fails the real optimistic write without overwriting external bytes or inserting YAML", async () => {
  const f = fixture(), choice = f.choice(), external = targetOriginal + "External target body Ω\r\n";
  f.beforeWrite = path => { if (path === f.target.path) f.disk.set(path, { text: external, version: 100 }); };
  await assert.rejects(f.accept(choice), /Physical target changed/); assert.deepEqual(f.bytes(f.target.path), Buffer.from("\ufeff" + external)); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original)); assert.deepEqual(f.writes, []); assert.deepEqual(f.kept, []);
});

test("a real queued YAML operation rechecks its owner after the target acknowledgement and releases only the target lock", async () => {
  const f = fixture(), choice = f.choice(), held = deferred(), entered = deferred(); f.app.fileManager.operations.set(f.app.vault.rootPath + "\0" + f.source.path, held.promise);
  const operation = f.accept(choice, { commit: async (value, guard) => { assert.equal(f.app.workspace.isChangingFiles, false); entered.resolve(); await f.app.fileManager.processFrontMatter(f.source, values => { values.status = value; }, undefined, guard); return true; } });
  await entered.promise; assert.equal(f.writes.length, 1); f.state.owned = false; held.resolve(); await assert.rejects(operation, /changed/); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.kept, [f.target.path]); assert.ok(resolveSubpath(parseMarkdown(f.disk.get(f.target.path).text), "#" + choice.heading.subpath));
});

test("acknowledged target headings survive post-write source, widget, preference or target changes with one accurate retention receipt", async () => {
  for (const change of [f => { f.state.owned = false; }, f => { f.state.widget = "number"; }, f => { f.config.set("newLinkFormat", "absolute"); }, f => { f.disk.set(f.target.path, { text: targetOriginal + "External replacement Ω\r\n", version: 99 }); f.index(f.target); }]) {
    const f = fixture(), choice = f.choice(); f.afterLock = () => change(f); await assert.rejects(f.accept(choice), /changed/); assert.equal(f.writes.filter(value => value.path === f.target.path).length, 1); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.kept, [f.target.path]); assert.deepEqual(f.reported, []);
  }
});

test("post-acknowledgement cleanup failure retains the actual target receipt and original reported error without source insertion", async () => {
  const f = fixture(), choice = f.choice(), issue = Error("Property heading cleanup failed"); f.onRefresh = () => { if (f.state.refreshes === 2) throw issue; };
  await assert.rejects(f.accept(choice), error => error === issue); assert.equal(f.writes.length, 1); assert.deepEqual(f.kept, [f.target.path]); assert.deepEqual(f.reported, [issue]); assert.equal(f.editor.getValue(), original); assert.ok(resolveSubpath(parseMarkdown(f.disk.get(f.target.path).text), "#" + choice.heading.subpath));
});

test("a target transport failure without the written receipt never infers acknowledgement from later disk/index state", async () => {
  const f = fixture(), choice = f.choice(), write = f.app.vault.writeDocument;
  f.app.vault.writeDocument = async (...args) => { await write(...args); throw Error("Target transport lost its written receipt"); };
  await assert.rejects(f.accept(choice), /lost its written receipt/); assert.equal(f.writes.length, 1); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.kept, []); assert.deepEqual(f.reported, []);
});

test("a source edit made during target preflight is retained by SaveAll and refuses the target and speculative property link", async () => {
  const f = fixture(), choice = f.choice(), extra = "New user source Ω\r\n";
  f.beforeSaveAll = () => { f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: extra } }); };
  await assert.rejects(f.accept(choice), /changed/); assert.equal(f.editor.getValue(), original + extra); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original + extra)); assert.deepEqual(f.bytes(f.target.path), Buffer.from("\ufeff" + targetOriginal)); assert.deepEqual(f.kept, []);
});

function fakeDocument() {
  const document = { defaultView: { AbortController }, activeElement: null, getElementById: () => null, createElement: tag => tag === "input" ? new Input(tag) : new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), createTextNode: text => Object.assign(new Element("#text"), { textContent: text }) };
  class Element {
    constructor(tag) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.parentElement = null; this.connected = false; this.listeners = new Map(); this.dataset = {}; this.style = {}; this.attributes = new Map(); this.classList = { toggle() {}, add() {}, remove() {} }; this.hidden = false; this.disabled = false; this.readOnly = false; this.value = ""; }
    get isConnected() { return this.connected || Boolean(this.parentElement?.isConnected); }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    appendChild(child) { this.append(child); return child; }
    contains(value) { return value === this || this.children.some(child => child.contains(value)); }
    replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
    remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } this.connected = false; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); } getAttribute(key) { return this.attributes.get(key) ?? null; } removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, listener, options = {}) { const list = this.listeners.get(type) ?? []; list.push({ listener, capture: options.capture }); this.listeners.set(type, list); }
    fire(type, values = {}) { const event = { key: "", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values }; for (const { listener } of [...this.listeners.get(type) ?? []].sort((a, b) => Number(Boolean(b.capture)) - Number(Boolean(a.capture)))) { listener(event); if (event.stopped) break; } return event; }
    focus() { document.activeElement = this; this.fire("focus"); } blur() { document.activeElement = null; this.fire("blur"); } scrollIntoView() {}
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) { const result = []; for (const child of this.children) { if (selector.split(",").includes(child.tagName) || selector.startsWith(".") && child.className === selector.slice(1)) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
    checkVisibility() { return this.isConnected && !this.hidden; }
  }
  class Input extends Element {}
  const container = new Element("div"); container.connected = true;
  return { document, container, Input, Element };
}
async function actualRow(change, assertion, property = "status") {
  const f = fixture(), dom = fakeDocument(), prior = Object.fromEntries(["document", "HTMLInputElement", "HTMLAnchorElement", "propertyHeadingNotices", "propertyHeadingReported"].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { document: dom.document, HTMLInputElement: dom.Input, HTMLAnchorElement: class {}, propertyHeadingNotices: [], propertyHeadingReported: [] });
  f.view.containerEl = dom.container; const owner = { id: "properties-heading-owner", view: f.view }; f.app.workspace.leaves = () => [owner]; f.app.workspace.getLeafById = id => id === owner.id ? owner : null;
  const properties = new Properties(f.app); let row, refreshed = 0;
  const render = () => { row?.cleanup?.(); row?.containerEl.remove(); row = inlinePropertyRow(properties, f.source, property, parseMarkdown(f.editor.getValue()).frontmatter[property], () => { refreshed++; render(); }, () => f.state.owned); dom.container.append(row.containerEl); };
  try {
    render(); const input = row.valueEl.querySelector("input"); f.onLock = () => { dom.document.activeElement = null; input.fire("blur"); }; change?.(f, input);
    input.focus(); input.value = "[[Target#Parent#Created from row λ"; input.fire("input");
    const list = row.valueEl.children.find(child => child.dataset.propertyValueSuggestions === "true"), button = list.children.find(child => child.dataset.propertyCreateHeading === f.target.path);
    assert.ok(button); assert.equal(button.dataset.propertyHeadingSubpath, "Parent#Created from row λ"); assert.equal(button.fire("pointerdown").defaultPrevented, true); button.fire("click");
    for (let index = 0; index < 12; index++) await drain();
    await assertion({ ...f, input, row: () => row, refreshed: () => refreshed, notices: globalThis.propertyHeadingNotices, reported: globalThis.propertyHeadingReported });
  } finally { row?.cleanup?.(); for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
}

test("actual text and ordinary list-add rows survive inert blur, consume the query and commit one guarded property edit", async () => {
  for (const property of ["status", "labels"]) await actualRow(null, async f => {
    assert.equal(f.refreshed(), 1); assert.equal(f.writes.filter(value => value.path === f.target.path).length, 1); assert.equal(undoDepth(f.cm.state), 1); assert.ok(parseMarkdown(f.editor.getValue()).frontmatter[property].includes("[[Target#Parent#Created from row λ]]"));
    f.input.fire("blur"); await drain(); assert.equal(f.writes.length, 2); f.editor.undo(); assert.equal(f.editor.getValue(), original); assert.ok(resolveSubpath(parseMarkdown(f.disk.get(f.target.path).text), "#Parent#Created from row λ")); assert.deepEqual(f.notices, []);
  }, property);
});

test("actual row partial source-save failure retains dirty YAML, target headings and accurate review Notice; Undo cannot reapply its literal query", async () => {
  await actualRow(f => { f.beforeSave = () => { if (f.session.text !== original) throw Error("Property heading source save failed"); }; }, async f => {
    assert.equal(f.session.dirty, true); assert.equal(f.refreshed(), 0); assert.equal(undoDepth(f.cm.state), 1); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original)); assert.equal(f.row().containerEl.querySelector(".metadata-property-error").textContent, "Property heading source save failed");
    assert.equal(f.notices.length, 1); assert.match(f.notices[0], /Heading creation.*was confirmed.*review the current target, property and any unsaved changes/); assert.equal(f.notices[0].includes("no property link was inserted"), false);
    f.beforeSave = undefined; f.input.fire("blur"); f.input.fire("keydown", { key: "Enter" }); f.editor.undo(); await drain(); await f.app.saveAll(); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + original)); assert.equal(f.writes.length, 1); assert.ok(resolveSubpath(parseMarkdown(f.disk.get(f.target.path).text), "#Parent#Created from row λ"));
  });
});

test("actual owner mode changes and acknowledged cleanup errors keep headings, decline YAML and preserve the original notification", async () => {
  await actualRow(f => { f.afterLock = () => { f.view.mode = "source"; }; }, async f => { assert.equal(f.editor.getValue(), original); assert.equal(f.writes.length, 1); assert.equal(f.notices.length, 1); assert.deepEqual(f.reported, []); });
  const issue = Error("Actual Properties heading metadata cleanup failed");
  await actualRow(f => { f.onRefresh = () => { if (f.state.refreshes === 2) throw issue; }; }, async f => { assert.equal(f.editor.getValue(), original); assert.equal(f.writes.length, 1); assert.equal(f.notices.length, 1); assert.deepEqual(f.reported, [issue]); assert.equal(f.row().containerEl.querySelector(".metadata-property-error").textContent, issue.message); });
});

test("an actual row observes a newer post-ack target without inserting an obsolete YAML link or claiming the headings still exist", async () => {
  const external = targetOriginal + "Newer external body replaces the acknowledged heading Ω\r\n";
  await actualRow(f => { f.afterLock = () => { f.disk.set(f.target.path, { text: external, version: 99 }); f.index(f.target); }; }, async f => {
    assert.equal(f.editor.getValue(), original); assert.equal(f.writes.length, 1); assert.deepEqual(f.bytes(f.target.path), Buffer.from("\ufeff" + external)); assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /creation.*was confirmed.*review the current target, property/); assert.doesNotMatch(f.notices[0], /headings were kept|headings remain|headings still exist/); assert.deepEqual(f.reported, []);
  });
});
