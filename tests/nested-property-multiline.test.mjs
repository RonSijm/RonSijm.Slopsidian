import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
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
const multiline = await import("../client/structured-property-multiline.ts");
const operations = await import("../client/structured-property-operations.ts");
const scenarios = await import("../tools/nested-property-multiline-scenarios.mjs");

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

const reviewText = f => control(f, "propertyStructuredTextReview").fire("click");
const reviewedPart = (f, part) => find(f.row().valueEl, n => n.dataset.propertyStructuredTextPart === part)?.textContent;
const formatText = (f, mode) => { const select = control(f, "propertyStructuredTextFormat"); select.value = mode; select.fire("change"); return control(f, "propertyStructuredInput"); };
const textPlan = (text, path, value) => multiline.planStructuredPropertyMultiline(text, "opaque", path, value);
const run = (text, operation) => operations.planStructuredPropertyOperation(text, "opaque", parseMarkdown(text).frontmatter.opaque, operation);

test("the shared real-host fixture contains exact literal/folded/quoted/CRLF text and both proved multiline flow containers", () => {
  const source = scenarios.nestedPropertyMultilineReadOnlyFixture.source; assert.ok(source.includes("\r\n")); assert.equal(source.replaceAll("\r\n", "").includes("\n"), false);
  const value = parseMarkdown(source).frontmatter.nestedMultiline, model = structured.structuredPropertyModel(value, source, "nestedMultiline"); assert.ok(model); assert.equal(value.literal, "First literal λ\nSecond literal 😀\n\n"); assert.equal(value.escaped, "First\r\nSecond\rThird\n\n"); assert.equal(value.folded, "First folded λ continuation Ω");
  const caps = operations.structuredPropertyOperationTargets(source, "nestedMultiline", value); for (const path of ['["map"]', '["list"]']) assert.ok(caps.add.has(path)); assert.ok(caps.rename.has('["map","first"]')); assert.ok(caps["move-up"].has('["list",1]')); assert.equal(caps.add.has('["ambiguous"]'), false);
  assert.equal(scenarios.nestedPropertyMultilineReadOnlyFixture.files.length, 1); assert.equal(scenarios.nestedPropertyMultilineReadOnlyFixture.files[0][1], source);
});

test("real-host Source pointers use the clipped visible scroller intersection", () => {
  const point = scenarios.nestedPropertyMultilineEditorPoint({ left: 320, top: -1200, right: 1800, bottom: 3000 }, { left: 310, top: 180, right: 810, bottom: 720 }, { width: 1400, height: 900 }); assert.ok(point); assert.ok(point.x >= 320 && point.x <= 810 && point.y >= 180 && point.y <= 720); assert.equal(scenarios.nestedPropertyMultilineEditorPoint({ left: 0, top: -500, right: 0, bottom: -20 }, { left: 0, top: 0, right: 10, bottom: 10 }, { width: 400, height: 800 }), null);
});

test("client clipping excludes borders and scrollbar gutters at the actual rendered scale", () => {
  const metrics = { left: 10, right: 350, top: 20, bottom: 220, width: 340, height: 200, offsetWidth: 340, offsetHeight: 200, clientLeft: 0, clientTop: 0, clientWidth: 324, clientHeight: 184 };
  const clip = scenarios.nestedPropertyMultilineClientClip(metrics); assert.deepEqual(clip, { left: 10, right: 334, top: 20, bottom: 204, scaleX: 1, scaleY: 1 });
  const region = scenarios.nestedPropertyMultilineControlRegion({ left: 16, right: 344, top: 180, bottom: 212 }, { width: 360, height: 800 }, [{ ...metrics, clip, overflowX: "hidden", overflowY: "auto" }]); assert.ok(region); assert.equal(region.fullHorizontal, false, "a viewport-contained control still fails when ten pixels are hidden by its ancestor scrollbar"); assert.equal(region.height, 24, "horizontal scrollbar clipping does not overstate a complete action-control height");
  const scaled = scenarios.nestedPropertyMultilineClientClip({ ...metrics, left: 20, right: 700, top: 40, bottom: 440, width: 680, height: 400, clientLeft: 2, clientTop: 3 }); assert.deepEqual(scaled, { left: 24, right: 672, top: 46, bottom: 414, scaleX: 2, scaleY: 2 });
  assert.equal(scenarios.nestedPropertyMultilineControlRegion(metrics, { width: 360, height: 800 }, [{ clip: null, overflowX: "hidden", overflowY: "auto" }]), null, "invalid clipping metrics cannot fall back to a border box");
});

test("Source focus after outer Markdown scroll chooses the real client viewport instead of the tab toolbar", () => {
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, toJSON() { return { left, top, right, bottom, width: right - left, height: bottom - top }; } });
  const outer = { tagName: "DIV", id: "markdown-content", className: "markdown-view-content", parentElement: null, clientLeft: 0, clientTop: 0, clientWidth: 384, clientHeight: 620, offsetWidth: 400, offsetHeight: 620, scrollLeft: 0, scrollTop: 680, overflowX: "hidden", overflowY: "auto", getBoundingClientRect: () => rect(80, 80, 480, 700) };
  const scroller = { ...outer, id: "cm-scroller", className: "cm-scroller", parentElement: outer, clientWidth: 400, clientHeight: 1800, offsetHeight: 1800, scrollTop: 0, overflowX: "visible", overflowY: "visible", getBoundingClientRect: () => rect(80, -600, 480, 1200) };
  const file = { path: "Nested multiline text/Source.md" }, saved = { version: "exact-source", hasBom: true }, session = { text: "exact original + earlier dirty suffix", dirty: false, document: saved, isSaving: false, isReloading: false };
  const content = { tagName: "DIV", id: "cm-content", className: "cm-content", textContent: "Visible folded source", parentElement: scroller, isContentEditable: true, checkVisibility: () => true, contains: node => node === content, getBoundingClientRect: () => rect(100, -600, 400, 1200), getAttribute: () => null, closest: selector => selector === "[data-leaf-id]" ? { dataset: { leafId: "source" } } : null };
  const cm = { contentDOM: content, state: { doc: { length: 1800 } }, hasFocus: true }, view = { file, session, editor: { cm }, getViewType: () => "markdown", getEditingMode: () => "source", containerEl: { contains: node => node === content } }, leaf = { id: "source", view };
  const toolbar = { tagName: "DIV", id: "tab-toolbar", className: "workspace-tab-header", textContent: "Source", getAttribute: () => null }, document = { querySelector: () => content, elementFromPoint: (_x, y) => y < 80 ? toolbar : content };
  const context = { document, innerWidth: 1400, innerHeight: 912, app: { vault: { getFileByPath: () => file }, workspace: { activeLeaf: leaf, getLeafById: () => leaf, sessions: new Map([[file.path, session]]) } }, getComputedStyle: element => ({ overflowX: element.overflowX, overflowY: element.overflowY }) };
  const old = scenarios.nestedPropertyMultilineEditorPoint(content.getBoundingClientRect(), scroller.getBoundingClientRect(), { width: 1400, height: 912 }); assert.equal(old.y, 12); assert.equal(document.elementFromPoint(old.x, old.y), toolbar);
  const proof = JSON.parse(JSON.stringify(runInNewContext(scenarios.nestedPropertyMultilinePointerExpression("existing Source content", true), context))); assert.equal(proof.y, 92); assert.equal(proof.reachable, true); assert.equal(proof.hit.id, "cm-content"); assert.equal(proof.owner.path, file.path); assert.equal(proof.owner.sourceContentIdentity, true); assert.equal(proof.owner.sessionIdentity, true); assert.equal(proof.ancestors[1].clip.right, 464); assert.ok(JSON.stringify(proof).length < 8192, "geometry and owner diagnostics contain no live owner/history objects");
});

test("a tall nested review visits every real scroller point, records failing geometry first and rejects clipped or covered controls", async () => {
  const region = scenarios.nestedPropertyMultilineControlRegion({ left: 16, right: 344, top: -500, bottom: 1000 }, { width: 360, height: 800 }, [{ left: 10, right: 350, top: 320, bottom: 500, overflowX: "hidden", overflowY: "auto" }]);
  assert.ok(region); assert.equal(region.fullHorizontal, true); assert.equal(region.y, 410); assert.ok(region.y > 320 && region.y < 500); assert.equal(scenarios.nestedPropertyMultilineControlRegion({ left: 16, right: 344, top: 350, bottom: 400 }, { width: 360, height: 800 }, [{ left: 20, right: 330, top: 320, bottom: 500, overflowX: "hidden", overflowY: "auto" }]).fullHorizontal, false); assert.equal(scenarios.nestedPropertyMultilineControlRegion({ left: 16, right: 344, top: -200, bottom: -10 }, { width: 360, height: 800 }, []), null);
  const keys = ["type", "text-format", "input", "text-review", "text-reviewed", "apply", "cancel", "before", "after", "source-before", "source-after"], parts = new Set(keys.slice(7)), scrolled = [];
  const rect = (left, top, right, bottom) => ({ left, right, top, bottom, width: right - left, height: bottom - top, toJSON() { return { left, right, top, bottom, width: right - left, height: bottom - top }; } });
  const outer = { tagName: "DIV", id: "properties-scroll", className: "metadata-properties", overflowX: "hidden", overflowY: "auto", parentElement: null, scrollTop: 0, scrollLeft: 0, clientLeft: 0, clientTop: 0, clientWidth: 340, clientHeight: 580, offsetWidth: 340, offsetHeight: 580, getBoundingClientRect: () => rect(10, 180, 350, 760) };
  const inner = { ...outer, id: "exact-review-scroll", className: "metadata-structured-text-review", parentElement: outer, clientWidth: 336, clientHeight: 160, offsetWidth: 336, offsetHeight: 160, getBoundingClientRect: () => rect(12, 340, 348, 500) };
  let current, blocked = false, cut = false; const nodes = new Map(keys.map((key, index) => [key, { tagName: key === "input" ? "TEXTAREA" : "BUTTON", id: key, className: "control", disabled: false, textContent: key, parentElement: parts.has(key) ? inner : outer, checkVisibility: () => true, contains(node) { return node === this; }, getAttribute: () => key,
    scrollIntoView() { current = this; scrolled.push(key); }, getBoundingClientRect() { return current === this ? rect(16, parts.has(key) ? 360 : 260, cut && key === "cancel" ? 400 : 344, parts.has(key) ? 420 : 292) : rect(16, 900 + index * 150, 344, 932 + index * 150); } }]));
  const root = {}, group = {}, p = { id: "properties", parent: group, view: { file: { path: "Nested multiline text/Source.md" } }, containerEl: { checkVisibility: () => true, getBoundingClientRect: () => rect(0, 0, 360, 800) } };
  const workspace = { rootSplit: root, activeLeaf: p, getLeafById: id => id === p.id ? p : null, leaves: () => [p, { parent: group, getRoot: () => root }, { parent: group, getRoot: () => root }], leftSplit: { collapsed: true }, rightSplit: { collapsed: true } }; p.getRoot = () => root;
  const context = { app: { workspace }, innerWidth: 360, innerHeight: 800, requestAnimationFrame: callback => callback(0), getComputedStyle: element => ({ overflowX: element.overflowX, overflowY: element.overflowY }), document: {
    querySelector(selector) { const part = /data-property-structured-text-part="([^"]+)"/.exec(selector)?.[1]; return part ? nodes.get(part) : keys.slice(0, 7).map(key => [key, selector.endsWith(`[data-property-structured-${key}]`)]).filter(([, found]) => found).map(([key]) => nodes.get(key))[0]; },
    elementFromPoint: () => blocked && current.id === "cancel" ? { tagName: "DIV", id: "cover", className: "cover", textContent: "Covered", getAttribute: () => null } : current
  } };
  const tools = { report: {}, async evaluate(code) { return JSON.parse(JSON.stringify(await runInNewContext(code, context))); } };
  assert.ok([...nodes.values()].every(n => n.getBoundingClientRect().top > 800), "the unscrolled editor cannot fit all control centers simultaneously");
  const geometry = await scenarios.inspectNestedPropertyMultilineNarrowReview(tools, p.id); assert.deepEqual(scrolled, keys); assert.equal(geometry.controls.length, 11); assert.equal(geometry.controls.find(c => c.key === "source-before").ancestors[0].id, inner.id); assert.ok(geometry.controls.every(c => c.region && c.reachable && c.inViewport)); assert.equal(tools.report.nestedPropertyMultilineNarrow, geometry);
  blocked = true; await assert.rejects(() => scenarios.inspectNestedPropertyMultilineNarrowReview(tools, p.id), /cancel is physically reachable/); assert.equal(tools.report.nestedPropertyMultilineNarrow.controls.find(c => c.key === "cancel").hit.id, "cover", "the failing hit is retained before the assertion throws");
  blocked = false; cut = true; await assert.rejects(() => scenarios.inspectNestedPropertyMultilineNarrowReview(tools, p.id), /cancel retains its full horizontal width/); assert.equal(tools.report.nestedPropertyMultilineNarrow.controls.find(c => c.key === "cancel").region.fullHorizontal, false);
  cut = false; outer.clientWidth = 324; await assert.rejects(() => scenarios.inspectNestedPropertyMultilineNarrowReview(tools, p.id), /type retains its full horizontal width/); const clipped = tools.report.nestedPropertyMultilineNarrow.controls.find(c => c.key === "type"); assert.equal(clipped.right, 344); assert.equal(clipped.ancestors[0].right, 350); assert.equal(clipped.ancestors[0].clip.right, 334); assert.equal(clipped.region.fullHorizontal, false, "the actual inspection rejects ancestor client clipping despite a successful center hit");
});

for (const newline of ["\n", "\r\n"]) for (const [label, token] of [
  ["literal strip", "|- # owned header\n      Alpha λ\n      Beta 😀\n"],
  ["literal clip", "| # owned header\n      Alpha λ\n      Beta 😀\n"],
  ["literal keep", "|+ # owned header\n      Alpha λ\n      Beta 😀\n\n"],
  ["folded strip", ">- # owned header\n      Alpha λ\n      Beta 😀\n"],
  ["folded keep", ">+ # owned header\n      Alpha λ\n      Beta 😀\n\n"],
  ["explicit indentation literal", "|2- # owned header\n      Alpha λ\n      Beta 😀\n"],
  ["multiline quoted", '"Alpha λ\n      Beta 😀"'],
  ["multiline single quoted", "'Alpha ''quoted'' λ\n      Beta 😀'"],
  ["quoted CRLF", '"Alpha λ\\r\\nBeta 😀\\r"']
]) test(`${label} exact reviewed splice keeps BOM, ${JSON.stringify(newline)} and every unrelated scalar/block byte`, () => {
  const source = "\ufeff" + original.replaceAll("\r\n", "\n").replace(textToken, token).replaceAll("\n", newline);
  const before = parseMarkdown(source).frontmatter.opaque.branch.text;
  for (const after of [" Leading λ\nSecond 😀\n\n", "Exact\r\nCRLF\rCR\n", "", "\n", "\n\n", "literal <img src=x> # : [ ]\\\"\u0085\u2028\u2029"]) {
    const plan = textPlan(source, leafPath("text"), after);
    assert.equal(plan.before, before); assert.equal(plan.after, after); assert.equal(parseMarkdown(plan.result).frontmatter.opaque.branch.text, after);
    assert.equal(plan.result, source.slice(0, plan.from) + plan.sourceAfter + source.slice(plan.to));
    assert.equal(plan.sourceBefore, source.slice(plan.from, plan.to)); assert.ok(plan.result.startsWith("\ufeff")); assert.ok(plan.requiresReview);
    assert.equal(plan.result.slice(0, plan.from), source.slice(0, plan.from)); assert.equal(plan.result.slice(plan.from + plan.sourceAfter.length), source.slice(plan.to));
    assert.ok(plan.result.includes("# owned header") || label.includes("quoted"));
    assert.equal(textPlan(source, leafPath("text"), before).result, source, "unchanged decoded value preserves original chomping and spelling");
    assert.ok(Object.isFrozen(plan));
  }
});

test("multiline string drafts require an explicit exact decoded/source review, invalidated by any later edit", async () => {
  await withRow(fixture(), "opaque", async f => {
    const input = openNested(f, leafPath("text")), candidate = " Leading λ\nSecond 😀\n\n";
    input.value = candidate; input.fire("input"); applyNested(f); await f.settle(); assert.deepEqual(f.writes, []); assert.equal(undoDepth(f.cm.state), 0); assert.match(errorText(f), /Review multiline text/);
    reviewText(f); assert.equal(reviewedPart(f, "before"), JSON.stringify("<img src=x> λ 😀")); assert.equal(reviewedPart(f, "after"), JSON.stringify(candidate)); assert.equal(reviewedPart(f, "source-before"), textToken); assert.equal(reviewedPart(f, "source-after"), JSON.stringify(candidate));
    assert.equal(find(f.row().valueEl, n => ["img", "script"].includes(n.tagName)), null);
    input.value = candidate + "last\n"; input.fire("input"); assert.equal(control(f, "propertyStructuredTextReviewed").hidden, true); applyNested(f); await f.settle(); assert.deepEqual(f.writes, []);
    reviewText(f); const expected = withText(candidate + "last\n"); applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), expected); assert.deepEqual(f.bytes(f.source.path), Buffer.from("\ufeff" + expected)); assert.equal(undoDepth(f.cm.state), 1); assert.equal(f.writes.length, 1);
    f.editor.undo(); assert.equal(f.editor.getValue(), original); f.editor.redo(); assert.equal(f.editor.getValue(), expected);
  });
});

test("decoded CR and CRLF start as a read-only LF display; Escaped text edits the exact string without normalization", async () => {
  const before = "First\r\nSecond\rThird\n\n", source = withText(before), after = " First\r\nChanged 😀\rFinal\n\n\n";
  await withRow(fixture(source), "opaque", async f => {
    const input = openNested(f, leafPath("text")); assert.equal(input.value, before.replace(/\r\n?/g, "\n")); assert.equal(input.readOnly, true); assert.equal(control(f, "propertyStructuredLinkAuthoring")?.hidden ?? true, true);
    assert.match(control(f, "propertyStructuredTextHelp").textContent, /carriage returns.*read-only/);
    assert.equal(formatText(f, "escaped"), input); assert.equal(input.readOnly, false); assert.equal(input.value, JSON.stringify(before));
    input.value = JSON.stringify(after); input.fire("input"); reviewText(f); assert.equal(reviewedPart(f, "after"), JSON.stringify(after)); assert.equal(reviewedPart(f, "source-after"), JSON.stringify(after));
    applyNested(f); await f.settle(); assert.equal(values(f).opaque.branch.text, after); assert.equal(f.editor.getValue(), withText(after)); assert.equal(undoDepth(f.cm.state), 1); f.editor.undo(); assert.equal(f.editor.getValue(), source);
  });
});

test("unchanged CR, folded and literal multiline Apply plus Cancel/Escape preserve exact original tokens and history", async () => {
  for (const [source, path] of [[withText("a\r\nb\rc\n"), leafPath("text")], [original, leafPath("multiline")], [original, leafPath("folded")]]) {
    await withRow(fixture(source), "opaque", async f => { openNested(f, path); applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), source); assert.deepEqual(f.writes, []); assert.equal(undoDepth(f.cm.state), 0); assert.equal(control(f, "propertyStructuredInput"), null); });
    for (const escape of [false, true]) await withRow(fixture(source), "opaque", async f => { const input = openNested(f, path); formatText(f, "escaped"); input.value = JSON.stringify("draft\n\r\n"); input.fire("input"); reviewText(f); if (escape) input.fire("keydown", { key: "Escape" }); else control(f, "propertyStructuredCancel").fire("click"); await f.settle(); assert.equal(f.editor.getValue(), source); assert.deepEqual(f.writes, []); assert.equal(undoDepth(f.cm.state), 0); });
  }
});

test("invalid escaped strings and over-budget decoded text stay drafts; type changes retain exact invalid text and revoke review", async () => {
  await withRow(fixture(), "opaque", async f => {
    let input = openNested(f, leafPath("text")); formatText(f, "escaped");
    for (const invalid of ['"unclosed', "123", '"bad\\x"', JSON.stringify("x".repeat(4097)), '"\\u0000"']) { input.value = invalid; input.fire("input"); reviewText(f); applyNested(f); await f.settle(); assert.deepEqual(f.writes, []); assert.equal(control(f, "propertyStructuredInput"), input); assert.ok(errorText(f)); }
    input.value = '"kept invalid'; input.fire("input"); const type = control(f, "propertyStructuredType"); type.value = "number"; type.fire("change"); type.value = "string"; type.fire("change"); assert.equal(control(f, "propertyStructuredInput"), input); assert.equal(input.value, '"kept invalid');
    input.value = JSON.stringify("Reviewed\nvalue\n"); input.fire("input"); reviewText(f); type.value = "boolean"; type.fire("change"); type.value = "string"; type.fire("change"); assert.equal(control(f, "propertyStructuredTextReviewed").hidden, true); applyNested(f); await f.settle(); assert.deepEqual(f.writes, []);
  });
});

for (const stale of [false, true]) test(`switching a picked existing link to escaped text compares its decoded value and ${stale ? "retains stale-destination refusal" : "keeps the destination proof valid"}`, async () => {
  await withRow(fixture(), "opaque", async f => {
    const selected = "[[Target#Parent λ|Label 😀]]"; openNested(f, leafPath("text")); await chooseLink(f, "[[Target#Pa|Label 😀", selected); formatText(f, "escaped"); assert.equal(control(f, "propertyStructuredInput").value, JSON.stringify(selected));
    if (stale) { f.disk.set(f.target.path, { text: targetOriginal + "changed", version: 1000 }); f.index(f.target); }
    applyNested(f); await f.settle();
    if (stale) { assert.equal(f.editor.getValue(), original); assert.deepEqual(f.writes, []); assert.match(errorText(f), /changed|no longer/i); assert.equal(control(f, "propertyStructuredInput").value, JSON.stringify(selected)); }
    else { assert.equal(f.editor.getValue(), withText(selected)); assert.equal(undoDepth(f.cm.state), 1); }
  });
});

test("composition and process keys cannot acknowledge or apply a multiline review", async () => {
  await withRow(fixture(), "opaque", async f => { const input = openNested(f, leafPath("text")); input.value = "Composed\nΩ"; input.fire("input"); input.fire("compositionstart"); reviewText(f); applyNested(f); input.fire("keydown", { key: "Enter", ctrlKey: true }); await f.settle(); assert.deepEqual(f.writes, []); input.fire("compositionend"); input.fire("keydown", { key: "Enter", ctrlKey: true, isComposing: true }); await f.settle(); assert.deepEqual(f.writes, []); });
});

for (const [name, change] of [
  ["root", f => { f.app.vault.rootPath = "changed"; }], ["session", f => { f.sessions.set(f.source.path, { ...f.session }); }], ["file", f => { f.files.set(f.source.path, { ...f.source }); }],
  ["owner", f => { f.state.owned = false; }], ["mode", f => { f.view.mode = "source"; f.view.sourceEditing = true; }], ["readonly", f => { f.app.vault.readOnly = true; }],
  ["source", f => { f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: "Later Source\r\n" } }); }], ["widget", f => { f.state.widget = "number"; }]
]) test(`a reviewed multiline draft refuses changed ${name} without applying or losing draft text`, async () => {
  await withRow(fixture(), "opaque", async f => { const input = openNested(f, leafPath("text")); input.value = "reviewed\nλ 😀\n"; input.fire("input"); reviewText(f); change(f); const source = f.editor.getValue(), depth = undoDepth(f.cm.state); applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), source); assert.equal(undoDepth(f.cm.state), depth); assert.deepEqual(f.writes, []); assert.equal(control(f, "propertyStructuredInput"), input); assert.equal(input.value, "reviewed\nλ 😀\n"); assert.match(errorText(f), /changed|readonly|read.only/i); });
});

test("queued physical source and late draft changes refuse after the held Source reload, retaining explicit review and history", async () => {
  for (const replace of ["physical", "draft"]) { const base = fixture(), gate = deferred(); let waiting = false; base.beforeReload = async () => { waiting = true; await gate.promise; };
    await withRow(base, "opaque", async f => { const input = openNested(f, leafPath("text")); input.value = "reviewed\nλ\n"; input.fire("input"); reviewText(f); applyNested(f); await f.settle(); assert.equal(waiting, true); assert.equal(control(f, "propertyStructuredApply").disabled, true); assert.equal(control(f, "propertyStructuredTextReview").disabled, true); assert.equal(control(f, "propertyStructuredTextFormat").disabled, true);
    if (replace === "physical") f.disk.set(f.source.path, { text: original, version: 1000 }); else { input.value = "Changed\nwithout event"; }
    gate.resolve(); await f.settle(); assert.deepEqual(f.writes, []); assert.equal(f.editor.getValue(), original); assert.equal(undoDepth(f.cm.state), 0); assert.ok(errorText(f)); assert.equal(control(f, "propertyStructuredInput"), input);
  }); }
});

test("reviewed empty commented blocks bypass only the selected lossy serialization while every other frontmatter value must match", async () => {
  for (const path of [leafPath("multiline"), leafPath("folded")]) await withRow(fixture(), "opaque", async f => {
    const input = openNested(f, path); input.value = ""; input.fire("input"); reviewText(f); const plan = textPlan(original, path, "");
    const updated = updateFrontmatter(original, values => { values.opaque.branch[path.at(-1)] = ""; });
    assert.throws(() => structured.preserveStructuredPropertySource(updated, original, "opaque", path, ""), "old scalar editor still rejects stringifier coercion");
    assert.equal(multiline.preserveStructuredPropertyMultilineSource(updated, original, plan), plan.result);
    for (const wrong of [updateFrontmatter(original, values => { values.opaque.branch.count = 2; }), updateFrontmatter(original, values => { values.untouched = "corrupted"; })]) assert.throws(() => multiline.preserveStructuredPropertyMultilineSource(wrong, original, plan));
    assert.throws(() => multiline.preserveStructuredPropertyMultilineSource(updated, original + "changed", plan)); assert.throws(() => multiline.preserveStructuredPropertyMultilineSource(updated, original, { ...plan }));
    applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), plan.result); assert.equal(values(f).opaque.branch[path.at(-1)], ""); assert.ok(f.editor.getValue().includes('"" # keep ')); assert.equal(undoDepth(f.cm.state), 1); f.editor.undo(); assert.equal(f.editor.getValue(), original);
  });
});

test("direct Text plans reject hostile paths, source ambiguity, controls and oversized decoded values before authoring", () => {
  let reads = 0; const path = ["branch", "text"]; Object.defineProperty(path, 1, { get() { reads++; return "text"; } }); assert.throws(() => textPlan(original, path, "x\ny")); assert.equal(reads, 0);
  for (const value of ["x".repeat(4097), "bad\u0000", "bad\u007f"]) assert.throws(() => textPlan(original, leafPath("text"), value));
  for (const yaml of ["opaque: {a: &owner one, b: *owner}", "opaque: {a: !!str one}", "opaque: {a: one, a: two}"]) assert.throws(() => textPlan("---\n" + yaml + "\n---\nbody\n", ["a"], "x\ny"));
  assert.equal(multiline.structuredTextNewlines("λ😀\r\nΩ\r\n\n\r"), '10 UTF-16 units; LF 1, CRLF 2, CR 1; trailing newline text "\\r\\n\\n\\r".');
});

test("earlier dirty Source text has its own Undo boundary before reviewed multiline Apply", async () => {
  await withRow(fixture(), "opaque", async f => { const suffix = "Earlier dirty λ 😀\r\n"; f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: suffix } }); f.render(); assert.equal(undoDepth(f.cm.state), 1); const input = openNested(f, leafPath("multiline")); input.value = "New literal\nwith trailing\n\n"; input.fire("input"); reviewText(f); const plan = textPlan(original + suffix, leafPath("multiline"), input.value); applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), plan.result); assert.equal(undoDepth(f.cm.state), 2); f.editor.undo(); assert.equal(f.editor.getValue(), original + suffix); f.editor.undo(); assert.equal(f.editor.getValue(), original); });
});

test("existing nested flow-list and block-list string leaves use the same exact reviewed Text path", async () => {
  for (const [source, path] of [[original, leafPath("mixed", 0)], ["---\r\nopaque:\r\n  list:\r\n    - |+ # item header\r\n      First λ\r\n      Second 😀\r\n\r\n    - 2 # keep scalar\r\n---\r\nbody\r\n", ["list", 0]]]) await withRow(fixture(source), "opaque", async f => {
    const candidate = "Nested list\nλ 😀\n\n", input = openNested(f, path); input.value = candidate; input.fire("input"); applyNested(f); await f.settle(); assert.deepEqual(f.writes, []); reviewText(f); const plan = textPlan(source, path, candidate); applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), plan.result); assert.equal(undoDepth(f.cm.state), 1); f.editor.undo(); assert.equal(f.editor.getValue(), source);
  });
});

test("readonly cached multiline rows inspect literal text but refuse forged Text/Source authoring without allocating or reading", async () => {
  const f = fixture(); f.app.vault.readOnly = true; let reads = 0; f.beforeRead = () => { reads++; throw Error("Unexpected read"); };
  await withRow(f, "opaque", async f => { const button = find(f.row().valueEl, n => n.dataset.propertyStructuredEdit === JSON.stringify(leafPath("multiline"))); assert.equal(button.disabled, true); button.disabled = false; button.fire("click"); assert.equal(control(f, "propertyStructuredInput"), null); assert.equal(control(f, "propertyStructuredTextReview"), null); assert.equal(reads, 0); assert.deepEqual(f.writes, []); assert.equal(f.sessions.size, 1); });
});

for (const newline of ["\n", "\r\n"]) for (const array of [false, true]) for (const trailing of [false, true]) test(`one-entry-per-line flow ${array ? "list" : "map"} preserves exact ${JSON.stringify(newline)}, ${trailing ? "trailing comma" : "no trailing comma"} through all operations`, () => {
  const entries = array ? ["'first λ'", "{ child: [one, false] }", '"third 😀"'] : ["first: 1.50", "second: { child: [one, false] }", "third: 'λ 😀'"];
  const chosen = (array ? "[" : "{") + newline + entries.map((e, i) => "    " + e + (i < 2 || trailing ? "," : "")).join(newline) + newline + "  " + (array ? "]" : "}");
  const source = "\ufeff---" + newline + "# literal λ" + newline + "opaque:" + newline + "  flow: " + chosen + " # retained outer comment" + newline + "  sibling: |- # retained block" + newline + "    Exact λ" + newline + "    😀" + newline + "other: 1.50 # keep" + newline + "---" + newline + "Body 😀" + newline;
  const value = parseMarkdown(source).frontmatter.opaque, caps = operations.structuredPropertyOperationTargets(source, "opaque", value), key = array ? 1 : "second";
  assert.ok(caps.add.has('["flow"]')); assert.ok(caps.remove.has(JSON.stringify(["flow", key]))); assert.ok(caps["move-up"].has(JSON.stringify(["flow", key]))); if (!array) assert.ok(caps.rename.has('["flow","second"]'));
  for (const operation of [{ kind: "add", path: ["flow"], key: array ? 0 : "new λ", value: "A\nB\r\n" }, { kind: "add", path: ["flow"], key: array ? 1 : "new λ", value: null }, { kind: "add", path: ["flow"], key: array ? 3 : "new λ", value: {} },
    ...[0, 1, 2].map(i => ({ kind: "remove", path: ["flow", array ? i : ["first", "second", "third"][i]] })), { kind: "move-up", path: ["flow", key] }, { kind: "move-down", path: ["flow", key] }, ...(!array ? [{ kind: "rename", path: ["flow", "second"], key: "Renamed λ" }] : [])]) {
    const result = run(source, operation), updated = updateFrontmatter(source, values => { values.opaque = result.next; }); assert.equal(operations.preserveStructuredPropertyOperationSource(updated, source, "opaque", operation), result.source); assert.deepEqual(parseMarkdown(result.source).frontmatter.opaque, result.next);
    const from = source.indexOf(chosen), after = source.slice(from + chosen.length); assert.equal(result.source.slice(0, from), source.slice(0, from)); assert.ok(result.source.endsWith(after)); assert.ok(result.source.includes("  sibling: |- # retained block" + newline + "    Exact λ" + newline + "    😀"));
    assert.ok(result.review.includes(operation.kind === "add" ? "Literal YAML insertion" : operation.kind === "rename" ? "Replacement key" : operation.kind.startsWith("move") ? "Exact adjacent entries" : "Exact source removed"));
    if (operation.kind === "move-up") assert.equal(result.source, source.replace(entries[0] + "," + newline + "    " + entries[1], entries[1] + "," + newline + "    " + entries[0]));
    if (operation.kind === "rename") assert.equal(result.source, source.replace("second:", '"Renamed λ":'));
  }
  let current = source; for (let remaining = 3; remaining; remaining--) current = run(current, { kind: "remove", path: ["flow", array ? 0 : Object.keys(parseMarkdown(current).frontmatter.opaque.flow)[0]] }).source;
  const empty = array ? [] : {}; assert.deepEqual(parseMarkdown(current).frontmatter.opaque.flow, empty); const added = run(current, { kind: "add", path: ["flow"], key: array ? 0 : "restored", value: "literal" }); assert.deepEqual(parseMarkdown(added.source).frontmatter.opaque.flow, array ? ["literal"] : { restored: "literal" });
});

test("multiline nested flow values move whole descendants and exact quoted/newline lexemes", () => {
  const source = "---\nopaque:\n  flow: {\n    first: {\n      inner: [one, false],\n    },\n    second: 'two',\n  }\n---\nbody\n";
  const result = run(source, { kind: "move-down", path: ["flow", "first"] }); assert.equal(result.source, source.replace("first: {\n      inner: [one, false],\n    },\n    second: 'two'", "second: 'two',\n    first: {\n      inner: [one, false],\n    }"));
  assert.deepEqual(result.next, parseMarkdown(source).frontmatter.opaque);
});

test("mixed flow line placement, blank whitespace, indentation and inline trailing commas now have proved literal additions", () => {
  for (const [flow, expected] of [["{ a: 1,\n    b: 2 }", "{ a: 1,\n    b: 2,\n    \"new\": true }"], ["{ a: 1, }", "{ a: 1, \"new\": true, }"], ["{\n    a: 1,\n\n    b: 2,\n  }", "{\n    a: 1,\n\n    b: 2,\n\n    \"new\": true,\n  }"], ["{\n    a: 1,\n     b: 2,\n  }", "{\n    a: 1,\n     b: 2,\n     \"new\": true,\n  }"]]) {
    const source = "---\nopaque:\n  flow: " + flow + "\n---\nbody\n", value = parseMarkdown(source).frontmatter?.opaque;
    const caps = operations.structuredPropertyOperationTargets(source, "opaque", value); assert.equal(caps.add.has('["flow"]'), true, flow);
    const result = run(source, { kind: "add", path: ["flow"], key: "new", value: true }); assert.equal(result.source, source.replace(flow, expected)); assert.deepEqual(result.next.flow, { a: 1, ...(flow.includes('b:') ? { b: 2 } : {}), new: true });
  }
});

test("separator comments, invalid indentation, anchors, duplicate keys and custom tags remain Source-only", () => {
  for (const flow of ["{ a: 1,\n  b: 2 }", "{\n    a: 1, # attached?\n    b: 2,\n  }", "{\n    # leading?\n    a: 1,\n  }", "{\n    a: &shared 1,\n    b: *shared,\n  }", "{\n    a: 1,\n    a: 2,\n  }", "{\n    a: !custom one,\n  }"]) {
    const source = "---\nopaque:\n  flow: " + flow + "\n---\nbody\n", value = parseMarkdown(source).frontmatter?.opaque;
    const caps = operations.structuredPropertyOperationTargets(source, "opaque", value); assert.equal(caps.add.has('["flow"]'), false, flow); assert.throws(() => run(source, { kind: "add", path: ["flow"], key: "new", value: true }), flow);
  }
});

test("flow operation UI uses the normal reviewed queue with exact Cancel/Apply/Undo and stale/readonly refusal", async () => {
  const source = "---\r\nopaque:\r\n  flow: {\r\n    first: 1.50,\r\n    second: 'λ 😀',\r\n  } # keep\r\n  sibling: |-\r\n    exact\r\n---\r\nbody\r\n";
  await withRow(fixture(source), "opaque", async f => {
    const open = () => { const button = find(f.row().valueEl, n => n.dataset.propertyStructuredAdd === '["flow"]'); assert.ok(button); button.fire("click"); const key = control(f, "propertyStructuredPosition"); key.value = "added λ"; key.fire("input"); return control(f, "propertyStructuredInput"); };
    let input = open(); input.value = "Literal\n😀\n"; input.fire("input"); const expected = run(source, { kind: "add", path: ["flow"], key: "added λ", value: input.value }).source; assert.match(control(f, "propertyStructuredPreview").textContent, /Literal YAML insertion/); control(f, "propertyStructuredCancel").fire("click"); await f.settle(); assert.deepEqual(f.writes, []); assert.equal(undoDepth(f.cm.state), 0);
    input = open(); input.value = "Literal\n😀\n"; input.fire("input"); applyNested(f); await f.settle(); assert.equal(f.editor.getValue(), expected); assert.equal(undoDepth(f.cm.state), 1); f.editor.undo(); assert.equal(f.editor.getValue(), source); f.editor.redo(); assert.equal(f.editor.getValue(), expected);
  });
  for (const readonly of [false, true]) await withRow(fixture(source), "opaque", async f => { if (readonly) { f.app.vault.readOnly = true; f.render(); } const button = find(f.row().valueEl, n => n.dataset.propertyStructuredRemove === '["flow","first"]'); assert.ok(button); if (readonly) { assert.equal(button.disabled, true); button.disabled = false; button.fire("click"); assert.equal(control(f, "propertyStructuredRemovalReview"), null); } else { button.fire("click"); f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: "Later\r\n" } }); applyNested(f); await f.settle(); assert.ok(errorText(f)); } assert.deepEqual(f.writes, []); });
});

