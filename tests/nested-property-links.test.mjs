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
const { FileManager } = await import("../client/file-manager.ts"), { Editor } = await import("../client/editor.ts");
const structured = await import("../client/structured-properties.ts");
const links = await import("../client/structured-property-links.ts");
const scenarios = await import("../tools/nested-property-links-scenarios.mjs");
const { MetadataEditor, Properties, inlinePropertyRow } = await import("../client/properties.ts"), { MarkdownView } = await import("../client/workspace.ts");
const { TFile } = await import("../client/vault.ts"), { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts"), { fileLinktext, resolveLink } = await import("../client/links.ts");
const original = "---\r\n# Nested fixture λ\r\nuntouched: >- # original folded\r\n  Exact first\r\n  second 😀\r\nopaque:\r\n  branch:\r\n    enabled: true # keep boolean\r\n    count: 1.50 # exact number\r\n    empty: null # retain null type\r\n    text: '<img src=x> λ 😀' # keep text\r\n    multiline: |- # keep block comment\r\n      First line λ\r\n      Second line 😀\r\n    folded: >- # keep folded comment\r\n      Folded first\r\n      wrapped Ω\r\n    mixed: [one, 2, false, { child: value }] # keep flow\r\nanchored: &shared { retained: exact }\r\naliased: *shared\r\n---\r\n# Source λ\r\n\r\nUntouched 😀 body.\r\n";
const targetOriginal = '---\r\naliases: [Friendly destination]\r\nopaque: { target: "λ 😀" }\r\n---\r\n# Parent λ\r\n\r\n## Child Ω\r\n\r\nExisting parent body 😀. ^known-block\r\n\r\n# Sibling\r\n\r\nUntouched final body.\r\n';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const drain = () => new Promise(resolve => setImmediate(resolve));

function fixture(text = original) {
  const files = new Map(), disk = new Map(), documents = new Map(), sessions = new Map(), writes = [], kept = [], reported = [], accepted = [];
  const state = { owned: true, version: 1, refreshes: 0, widget: null }, config = new Map(Object.entries({ newFileLocation: "root", newFileFolderPath: "", newLinkFormat: "shortest", useMarkdownLinks: true }));
  const app = { changingVault: false, vault: { rootPath: "heading-properties", readOnly: false }, workspace: { sessions, isChangingFiles: false, isChangingLayout: false }, core: { busy: false, isEnabled: () => true, run: action => Promise.resolve().then(action) }, metadataTypeManager: { getAssignedWidget: () => state.widget } };
  const index = file => { const entry = disk.get(file.path); documents.set(file.path, { document: { file: { path: file.path }, content: entry.text, version: entry.version, hasBom: true }, text: entry.text, cache: parseMarkdown(entry.text), missing: false }); };
  const add = (path, text) => { const file = new TFile(app.vault, { path, basename: path.split("/").at(-1).slice(0, -3), extension: "md", stat: { size: text.length, ctime: 1, mtime: 1 } }); files.set(path, file); disk.set(path, { text, version: state.version++ }); index(file); return file; };
  const source = add("Source folder/Source.md", text), target = add("Targets/Target.md", targetOriginal), editor = Object.create(Editor.prototype);
  const cm = { hasFocus: true, state: EditorState.create({ doc: text, extensions: [history(), EditorState.lineSeparator.of("\r\n"), EditorView.editable.of(true)] }) };
  let session;
  cm.dispatch = spec => { cm.state = (spec.startState ? spec : cm.state.update(spec)).state; if (session) session.text = editor.getValue(); };
  editor.cm = cm;
  const view = Object.assign(Object.create(MarkdownView.prototype), { editor, file: source, mode: "preview", sourceEditing: false });
  session = { originRoot: app.vault.rootPath, text, isReloading: false, isSaving: false, leaves: new Set([view]), document: documents.get(source.path).document,
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
    resolveReference: (reference, path) => resolveLink([...files.values()], reference.link, path, reference.kind === "markdown" || reference.kind === "reference"),
    async refresh() { state.refreshes++; await f.onRefresh?.(); for (const file of files.values()) index(file); }, async pause() {}, resume() {}
  };
  app.saveAll = async () => { await f.beforeSaveAll?.(); await session.save(); };
  app.notifyEditor = async () => { await f.onNotify?.(); };
  app.workspace.withFileMutation = async action => { app.workspace.isChangingFiles = true; await f.onLock?.(); try { return await action(); } finally { app.workspace.isChangingFiles = false; await f.afterLock?.(); } };
  app.workspace.track = promise => promise; app.workspace.leaves = () => [];
  app.workspace.acceptExternalDocuments = (values, preserveHistory) => { accepted.push({ values, preserveHistory }); for (const document of values) { const targetSession = sessions.get(document.file.path); if (targetSession) { targetSession.text = document.content; targetSession.document = document; } } };
  app.fileManager = new FileManager(app); const properties = new Properties(app);
  const f = { app, files, disk, documents, sessions, source, target, editor, cm, session, view, state, config, writes, kept, reported, accepted, add, index };
  f.bytes = path => Buffer.from("\ufeff" + disk.get(path).text);
  return f;
}

function fakeDocument() {
  const document = { defaultView: { AbortController }, activeElement: null, getElementById: () => null, createElement: tag => tag === "textarea" ? new Textarea(tag) : tag === "input" ? new Input(tag) : tag === "a" ? new Anchor(tag) : new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), createTextNode: text => Object.assign(new Element("#text"), { textContent: text }) };
  class Element {
    constructor(tag) { this.tagName = tag; this.ownerDocument = document; this.children = [];this.children.item=index=>this.children[index]??null; this.parentElement = null; this.connected = false; this.listeners = new Map(); this.dataset = {}; this.style = {}; this.attributes = new Map(); this.classList = { toggle() {}, add() {}, remove() {} }; this.hidden = false; this.disabled = false; this.readOnly = false; this.value = ""; }
    get firstElementChild(){return this.children[0]??null} get lastElementChild(){return this.children.at(-1)??null}
    get isConnected() { return this.connected || Boolean(this.parentElement?.isConnected); }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    closest(selector){for(let node=this;node;node=node.parentElement){if(selector==="[data-property-key]"&&Object.hasOwn(node.dataset,"propertyKey"))return node;}return null}
    insertBefore(child,before){child.remove();child.parentElement=this;const at=this.children.indexOf(before);this.children.splice(at<0?this.children.length:at,0,child)}
    appendChild(child) { this.append(child); return child; }
    contains(value) { return value === this || this.children.some(child => child.contains(value)); }
    replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = [];this.children.item=index=>this.children[index]??null; this.append(...children); }
    remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } this.connected = false; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); } getAttribute(key) { return this.attributes.get(key) ?? null; } removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, listener, options = {}) { const list = this.listeners.get(type) ?? []; list.push({ listener, capture: options.capture }); this.listeners.set(type, list); }
    fire(type, values = {}) { const event = { key: "", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values }; for (const { listener } of [...this.listeners.get(type) ?? []].sort((a, b) => Number(Boolean(b.capture)) - Number(Boolean(a.capture)))) { listener(event); if (event.stopped) break; } return event; }
    focus() { document.activeElement = this; this.fire("focus"); } blur() { document.activeElement = null; this.fire("blur"); } scrollIntoView() {}
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) { const result = []; for (const child of this.children) { if (selector.split(",").includes(child.tagName) || selector.startsWith(".") && child.className === selector.slice(1)) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
    checkVisibility() { return this.isConnected && !this.hidden; }
  }
  class Input extends Element { select(){this.selectionStart=0;this.selectionEnd=this.value.length;} }
  class Textarea extends Input { get value(){return this.textValue??""}set value(value){this.textValue=String(value).replace(/\r\n?/g,"\n")} }
  class Anchor extends Element {}
  const container = new Element("div"); container.connected = true;
  return { document, container, Input, Textarea, Element, Anchor };
}

const find = (root, predicate) => { for (const child of root.children) { if (predicate(child)) return child; const nested = find(child, predicate); if (nested) return nested; } return null; };
async function withRow(f, property, action) {
  const dom=fakeDocument(), keys=["document","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"], prior=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
  f.view.containerEl=dom.container; const owner={id:"property-workflow-owner",view:f.view}; f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
  const properties=new Properties(f.app);let row,refreshed=0;
  const render=()=>{row?.cleanup?.();row?.containerEl.remove();row=inlinePropertyRow(properties,f.source,property,parseMarkdown(f.editor.getValue()).frontmatter[property],()=>{refreshed++;render();},()=>f.state.owned);dom.container.append(row.containerEl);};
  const settle=async()=>{for(let index=0;index<12;index++)await drain();};
  try {render();await action({...f,dom,row:()=>row,render,settle,refreshed:()=>refreshed});}
  finally {row?.cleanup?.();for(const[key,value]of Object.entries(prior)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}

const control=(f,key)=>find(f.row().valueEl,node=>Object.hasOwn(node.dataset,key));
const errorText=f=>find(f.row().containerEl,node=>node.className==="metadata-property-error").textContent;
const values=f=>parseMarkdown(f.editor.getValue()).frontmatter;

const leafPath = (...path) => ["branch", ...path];
function openNested(f, path) {
 const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(path));assert.ok(button,JSON.stringify(path));button.fire("click");
 const input=control(f,"propertyStructuredInput");assert.ok(input,errorText(f));return input;
}
const applyNested=f=>control(f,"propertyStructuredApply").fire("click");
function modelChange(source,path,next){
 const prior=parseMarkdown(source).frontmatter.opaque, model=structured.structuredPropertyModel(prior,source,"opaque");assert.ok(model);
 const leaf=model.leaves.find(leaf=>JSON.stringify(leaf.path)===JSON.stringify(path));assert.ok(leaf);
 const expected=structured.replaceStructuredPropertyValue(prior,path,leaf.value,next);
 const updated=updateFrontmatter(source,values=>{values.opaque=expected;});
 const result=structured.preserveStructuredPropertySource(updated,source,"opaque",path);
 assert.deepEqual(parseMarkdown(result).frontmatter,{...parseMarkdown(source).frontmatter,opaque:expected});return result;
}

const textToken = "'<img src=x> λ 😀'";
const withText = value => original.replace(textToken, JSON.stringify(value));
const context = (f, path = leafPath("text")) => ({ file: f.source, property: "opaque", value: values(f).opaque, path, sourceText: f.editor.getValue() });
const choice = (f, value) => find(f.row().valueEl, node => node.dataset.propertyValueChoice === value);
const queryLink = (f, query) => { const input = control(f, "propertyStructuredLinkQuery"); assert.ok(input); input.value = query; input.focus(); input.fire("input"); return input; };
const chooseLink = async (f, query, value, method = "pointer") => {
  const input = queryLink(f, query), item = choice(f, value); assert.ok(item, query + " → " + value);
  if (method === "pointer") item.fire("click");
  else { input.fire("keydown", { key: "ArrowDown" }); input.fire("keydown", { key: method }); }
  await f.settle(); assert.equal(control(f, "propertyStructuredInput").value, value); return input;
};

test("the real-host cached fixture proves its exact link widgets and nested Text handoff path", () => {
  const source = scenarios.nestedPropertyLinksReadOnlyFixture.source, f = fixture(source);
  const [name, target] = scenarios.nestedPropertyLinksReadOnlyFixture.files[0]; f.add("Source folder/" + name, target);
  const value = values(f).nestedLinks, model = structured.structuredPropertyModel(value, source, "nestedLinks"); assert.ok(model); assert.ok(model.leaves.some(leaf => JSON.stringify(leaf.path) === '["draft"]' && typeof leaf.value === "string"));
  const read = links.createStructuredPropertyLinkReader(f.app, f.source, "nestedLinks", value, source); f.app.vault.readOnly = true;
  for (const key of ["note", "heading", "block"]) assert.ok(read([key]), key); for (const key of ["draft", "literal", "external", "multiline"]) assert.equal(read([key]), null, key);
});

test("trusted Source focus chooses a visible scroller point when a tall or horizontally clipped CM document center is outside view", () => {
  const viewport = { width: 1400, height: 900 }, scroller = { left: 310, top: 180, right: 840, bottom: 810 };
  for (const content of [{ left: 340, top: -1200, right: 820, bottom: 3200 }, { left: 340, top: 230, right: 2100, bottom: 500 }]) {
    const point = scenarios.nestedPropertyEditorPoint(content, scroller, viewport); assert.ok(point); assert.ok(point.x > Math.max(content.left, scroller.left) && point.x < Math.min(content.right, scroller.right)); assert.ok(point.y > Math.max(content.top, scroller.top) && point.y < Math.min(content.bottom, scroller.bottom));
    assert.ok(content.left + (content.right - content.left) / 2 > scroller.right || content.top + (content.bottom - content.top) / 2 > scroller.bottom);
  }
  assert.equal(scenarios.nestedPropertyEditorPoint({ left: 0, top: -500, right: 200, bottom: -20 }, scroller, viewport), null);
  assert.equal(scenarios.nestedPropertyEditorPoint({ left: 0, top: 0, right: 0, bottom: 0 }, scroller, viewport), null);
});

test("whole scalar wiki and URI Markdown grammar preserves inert display labels and refuses unsupported syntax", () => {
  assert.deepEqual(links.structuredPropertyLinkSyntax("[[Target#Parent λ|A <img> 😀]]"), { destination: "Target#Parent λ", label: "A <img> 😀", format: "wiki" });
  assert.deepEqual(links.structuredPropertyLinkSyntax("[Display λ](../Targets/Target.md#Parent%20%CE%BB)"), { destination: "../Targets/Target.md#Parent%20%CE%BB", label: "Display λ", format: "markdown" });
  for (const text of ["prose [[Target]]", "[[Target]] after", "![[Target]]", "[x](Target title)", "[x](Target(foo))", "[x](<Target>)", "[x][ref]", "[[Target|]]", "[[Target|a|b]]", "[[ Target]]", "[[Target]]\n", "[[Target\\#Parent]]", "[[Target\ud800]]", "[[" + "x".repeat(1024) + "]]"]) assert.equal(links.structuredPropertyLinkSyntax(text), null, text);
});

test("exact nested source paths resolve existing notes, hierarchy, blocks and URI Markdown through the real shared resolver", () => {
  for (const [text, destination, label] of [["[[Target]]", "Targets/Target.md", "Target"], ["[[Target#Parent λ#Child Ω|Go 😀]]", "Targets/Target.md#Parent λ#Child Ω", "Go 😀"], ["[[Target#^known-block]]", "Targets/Target.md#^known-block", "Target#^known-block"], ["[Label <img>](../Targets/Target.md#Parent%20%CE%BB)", "Targets/Target.md#Parent λ", "Label <img>"], ["[[#Source λ|Here]]", "Source folder/Source.md#Source λ", "Here"]]) {
    const f = fixture(withText(text)), result = links.structuredPropertyLinkValue(f.app, context(f));
    assert.ok(result, text); assert.equal(result.linktext, destination); assert.equal(result.label, label); assert.equal(result.target, text.includes("#Source") ? f.source : f.target); assert.deepEqual(f.writes, []);
    assert.equal(links.structuredPropertyLinkValue(f.app, { ...context(f), path: leafPath("missing") }), null);
    assert.equal(links.structuredPropertyLinkValue(f.app, { ...context(f), sourceText: f.editor.getValue() + "changed" }), null);
  }
});

test("missing, ambiguous, external, non-Markdown and unsupported targets stay literal without allocating or creating files", () => {
  for (const text of ["[[Missing]]", "[[Target#Missing]]", "[[Target#^unknown]]", "[[https://example.test]]", "[external](https://example.test)", "[bad](Target%ZZ.md)", "[[Friendly destination]]", "before [[Target]] after", "[[Target|<script>]] prose"]) {
    const f = fixture(withText(text)); assert.equal(links.structuredPropertyLinkValue(f.app, context(f)), null, text); assert.equal(f.files.size, 2); assert.deepEqual(f.writes, []);
  }
  const f = fixture(withText("[[Other]]")); f.add("A/Other.md", "# One\n"); f.add("B/Other.md", "# Two\n"); assert.equal(links.structuredPropertyLinkValue(f.app, context(f)), null);
  f.app.metadataCache.resolveReference = () => ({ file: { ...f.target, extension: "pdf" }, ambiguous: false }); assert.equal(links.structuredPropertyLinkValue(f.app, context(f)), null);
});

test("URI-decoded target punctuation cannot be reinterpreted as a wiki destination during navigation", () => {
  for (const [name, encoded] of [["Named#hash.md", "Named%23hash.md"], ["Named|pipe.md", "Named%7Cpipe.md"], ["Named[left].md", "Named%5Bleft%5D.md"]]) {
    const f = fixture(withText("[Literal punctuation](../Targets/" + encoded + ")")); f.add("Targets/" + name, "# Existing target\n");
    assert.equal(links.structuredPropertyLinkValue(f.app, context(f)), null); assert.deepEqual(f.writes, []); assert.equal(f.files.size, 3);
  }
});

test("BOM-prefixed CRLF source and UTF-16 ranges preserve every byte outside the selected escaped scalar", () => {
  const source = "\ufeff" + original.replace("# Nested fixture λ", "# Nested fixture λ 😀 😀").replace(textToken, '"\\u005b\\u005bTarget#Parent λ|Label 😀\\u005d\\u005d"');
  const f = fixture(source), model = structured.structuredPropertyModel(values(f).opaque, source, "opaque"), leaf = model.leaves.find(leaf => JSON.stringify(leaf.path) === JSON.stringify(leafPath("text")));
  assert.equal(source.slice(leaf.from, leaf.to), '"\\u005b\\u005bTarget#Parent λ|Label 😀\\u005d\\u005d"'); assert.equal(links.structuredPropertyLinkValue(f.app, context(f)).linktext, "Targets/Target.md#Parent λ");
  const result = modelChange(source, leafPath("text"), "[[Target#^known-block|New 😀]]");
  assert.equal(result, source.slice(0, leaf.from) + JSON.stringify("[[Target#^known-block|New 😀]]") + source.slice(leaf.to)); assert.ok(Buffer.from(result).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
});

test("one rendered-inspector reader shares exact source proof while renewing target text and refusing changed source or provider", () => {
  const f = fixture(withText("[[Target#^known-block]]")), read = links.createStructuredPropertyLinkReader(f.app, f.source, "opaque", values(f).opaque, f.editor.getValue());
  f.app.vault.readOnly = true; assert.equal(read(leafPath("text")).linktext, "Targets/Target.md#^known-block"); assert.equal(read(leafPath("missing")), null);
  f.disk.set(f.target.path, { text: targetOriginal.replace(" ^known-block", ""), version: 999 }); f.index(f.target); assert.equal(read(leafPath("text")), null);
  f.disk.set(f.target.path, { text: targetOriginal, version: 1000 }); f.index(f.target); assert.ok(read(leafPath("text")));
  f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: "Changed body\r\n" } }); assert.equal(read(leafPath("text")), null); f.editor.undo(); assert.ok(read(leafPath("text"))); f.app.vault.adapter = {}; assert.equal(read(leafPath("text")), null); assert.deepEqual(f.writes, []);
});

test("nested scalar navigation stays available in readonly, uses canonical heading/block destinations and refuses changed owners", async () => {
  for (const [text, expected, modified] of [["[[Target#Parent λ|Open <img> 😀]]", "Targets/Target.md#Parent λ", false], ["[Known](../Targets/Target.md#%5Eknown-block)", "Targets/Target.md#^known-block", true]]) {
    const f = fixture(withText(text)); f.app.vault.readOnly = true; const opened = []; f.app.workspace.openLinkText = (...args) => { opened.push(args); };
    await withRow(f, "opaque", async f => { const anchor = control(f, "propertyStructuredLink"); assert.ok(anchor); assert.equal(anchor.textContent, text.startsWith("[[") ? "Open <img> 😀" : "Known"); assert.equal(anchor.children.length, 0); assert.equal(find(f.row().valueEl, n => n.tagName === "img"), null);
      anchor.fire(modified ? "auxclick" : "click", { button: modified ? 1 : 0 }); await f.settle(); assert.deepEqual(opened, [[expected, f.source.path, modified ? "tab" : false]]);
      assert.equal(control(f, "propertyStructuredEdit").disabled, true); control(f, "propertyStructuredEdit").disabled = false; control(f, "propertyStructuredEdit").fire("click"); assert.equal(control(f, "propertyStructuredInput"), null); assert.equal(control(f, "propertyStructuredLinkQuery"), null); assert.deepEqual(f.writes, []);
      f.app.vault.rootPath = "other"; anchor.fire("click", { button: 0 }); await f.settle(); assert.equal(opened.length, 1);
    });
  }
});

test("stored navigation rechecks target identity, text, source and draft ownership at acceptance", async () => {
  for (const mutate of [f => { f.state.owned = false; }, f => { f.app.vault.adapter = {}; }, f => { f.sessions.set(f.source.path, { ...f.session }); }, f => { f.files.set(f.target.path, { ...f.target }); }, f => { f.disk.set(f.target.path, { text: targetOriginal + "changed", version: 999 }); f.index(f.target); }, f => { f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: "changed" } }); }, f => { openNested(f, leafPath("text")); }]) {
    const f = fixture(withText("[[Target#Parent λ]]")), opened = []; f.app.workspace.openLinkText = (...args) => opened.push(args);
    await withRow(f, "opaque", async f => { const anchor = control(f, "propertyStructuredLink"); mutate(f); anchor.fire("click", { button: 0 }); await f.settle(); assert.deepEqual(opened, []); assert.deepEqual(f.writes, []); });
  }
});

test("pointer and keyboard existing-link choices fill only the explicit Text draft; Cancel and Escape preserve source bytes and history", async () => {
  for (const [method, query, selected] of [["pointer", "[[Tar", "[[Target]]"], ["Enter", "[[Target#Pa", "[[Target#Parent λ]]"], ["Tab", "[[Target#^known", "[[Target#^known-block]]"]]) {
    await withRow(fixture(), "opaque", async f => { openNested(f, leafPath("text")); await chooseLink(f, query, selected, method); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.writes, []); assert.equal(undoDepth(f.cm.state), 0); assert.match(control(f, "propertyStructuredLinkReview").textContent, /Selected Targets\/Target.md/); assert.equal(f.row().hasDraft(), true);
      control(f, "propertyStructuredCancel").fire("click"); await f.settle(); assert.equal(f.editor.getValue(), original); assert.deepEqual(f.writes, []); assert.equal(control(f, "propertyStructuredLinkQuery"), null); assert.equal(undoDepth(f.cm.state), 0);
    });
  }
});

test("Apply replaces one proven YAML scalar, retaining comments, BOM/CRLF, surrogate pairs and source history in exactly one Undo boundary", async () => {
  for (const token of [textToken, '"<img src=x> \\u03bb \\U0001f600"', '>- # selected block comment\r\n      <img src=x> λ 😀']) {
    const source = original.replace(token.startsWith(">") ? textToken + " # keep text" : textToken, token), f = fixture(source), selected = "[[Target#Parent λ|Label 😀]]";
    await withRow(f, "opaque", async f => { openNested(f, leafPath("text")); await chooseLink(f, "[[Target#Pa|Label 😀", selected); if (token.startsWith(">")) control(f, "propertyStructuredTextReview").fire("click"); applyNested(f); await f.settle();
      const expected = token.startsWith(">") ? source.replace(token, JSON.stringify(selected) + " # selected block comment") : source.replace(token, JSON.stringify(selected));
      assert.equal(f.editor.getValue(), expected); assert.equal(f.disk.get(f.source.path).text, expected); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + expected)); assert.deepEqual(f.bytes(f.target.path), Buffer.from("\ufeff" + targetOriginal)); assert.equal(f.writes.length, 1); assert.equal(undoDepth(f.cm.state), 1); assert.equal(control(f, "propertyStructuredInput"), null);
      f.editor.undo(); assert.equal(f.editor.getValue(), source); f.editor.redo(); assert.equal(f.editor.getValue(), expected);
    });
  }
});

test("earlier dirty Source survives selection and Apply; one Undo removes only the property link", async () => {
  const f = fixture(), suffix = "Earlier body 😀.\r\n"; f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: suffix } });
  await withRow(f, "opaque", async f => { openNested(f, leafPath("text")); await chooseLink(f, "[[Target#^known", "[[Target#^known-block]]"); applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), withText("[[Target#^known-block]]") + suffix); assert.equal(undoDepth(f.cm.state), 2); assert.equal(f.writes.length, 2); f.editor.undo(); assert.equal(f.editor.getValue(), original + suffix); f.editor.undo(); assert.equal(f.editor.getValue(), original); });
});

test("selected nested links reject stale target text, file, source, root, adapter, session, pane, type and preferences while retaining the visible draft", async () => {
  const changes = [f => { f.state.owned = false; }, f => { f.app.vault.readOnly = true; }, f => { f.app.vault.rootPath = "other"; }, f => { f.app.vault.adapter = {}; }, f => { f.sessions.set(f.source.path, { ...f.session }); }, f => { f.state.widget = "text"; }, f => { f.app.workspace.getLeafById = () => null; }, f => { f.view.mode = "source"; }, f => { f.config.set("newLinkFormat", "absolute"); }, f => { f.config.set("useMarkdownLinks", false); }, f => { f.files.set(f.target.path, { ...f.target }); }, f => { f.disk.set(f.target.path, { text: targetOriginal + "New target body\r\n", version: 999 }); f.index(f.target); }, f => { f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: "New body\r\n" } }); }];
  for (const change of changes) await withRow(fixture(), "opaque", async f => { const input = openNested(f, leafPath("text")); await chooseLink(f, "[[Target#Pa", "[[Target#Parent λ]]"); change(f); applyNested(f); await f.settle(); assert.deepEqual(f.writes, []); assert.equal(f.disk.get(f.source.path).text, original); assert.equal(control(f, "propertyStructuredInput"), input); assert.equal(input.value, "[[Target#Parent λ]]"); assert.ok(errorText(f)); });
});

test("late source version and late destination changes are rechecked after the ordinary asynchronous save/reload queue", async () => {
  for (const late of [f => { f.disk.set(f.source.path, { text: original, version: 999 }); }, f => { f.disk.set(f.target.path, { text: targetOriginal + "late", version: 999 }); f.index(f.target); }]) {
    const f = fixture(); f.beforeReload = () => late(f); await withRow(f, "opaque", async f => { openNested(f, leafPath("text")); await chooseLink(f, "[[Target#Pa", "[[Target#Parent λ]]"); applyNested(f); await f.settle(); assert.deepEqual(f.writes, []); assert.equal(f.editor.getValue(), original); assert.equal(control(f, "propertyStructuredInput").value, "[[Target#Parent λ]]"); assert.equal(undoDepth(f.cm.state), 0); assert.match(errorText(f), /changed/); });
  }
});

test("completion is noncreating, IME-safe and bound to its exact field generation and Text type", async () => {
  await withRow(fixture(), "opaque", async f => { const input = openNested(f, leafPath("text")); const query = queryLink(f, "[[Tar"), held = choice(f, "[[Target]]"); assert.ok(held); query.fire("compositionstart"); query.fire("keydown", { key: "Enter", isComposing: true }); held.fire("click"); await f.settle(); assert.equal(input.value, "<img src=x> λ 😀"); query.fire("compositionend"); query.value = "[[Missing target"; query.fire("input"); assert.equal(choice(f, "[[Target]]"), null); assert.equal(find(f.row().valueEl, n => Object.hasOwn(n.dataset, "propertyCreateNote") || Object.hasOwn(n.dataset, "propertyCreateHeading")), null); held.fire("click"); await f.settle(); assert.equal(input.value, "<img src=x> λ 😀");
    query.value = "[[Tar"; query.fire("input"); const retired = choice(f, "[[Target]]"); const type = control(f, "propertyStructuredType"); type.value = "boolean"; type.fire("change"); assert.equal(control(f, "propertyStructuredLinkQuery"), null); retired.fire("click"); await f.settle(); assert.equal(control(f, "propertyStructuredInput").value, "false"); type.value = "string"; type.fire("change"); assert.equal(control(f, "propertyStructuredInput").value, "<img src=x> λ 😀"); assert.deepEqual(f.writes, []); assert.equal(f.files.size, 2);
  });
});

