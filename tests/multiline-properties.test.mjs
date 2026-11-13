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
const multiline = await import("../client/multiline-properties.ts");
const { MetadataEditor, Properties, inlinePropertyRow } = await import("../client/properties.ts"), { MarkdownView } = await import("../client/workspace.ts");
const { TFile } = await import("../client/vault.ts"), { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts"), { fileLinktext, resolveLink, resolveSubpath } = await import("../client/links.ts");
const { planHeadingCreation } = await import("../client/heading-authoring.ts");
const original = "---\r\n# Multiline fixture λ\r\ndescription: |- # keep description\r\n  First line λ\r\n  Second line 😀\r\nfolded: >- # keep folded\r\n  Folded first\r\n  continuation Ω\r\nitems:\r\n  - kept\r\n  - |- # keep item\r\n    First item λ\r\n    Second item 😀\r\n  - duplicate\r\nsingle: Plain\r\ncount: 1.50\r\nopaque:\r\n  branch:\r\n    enabled: true\r\n    list: [one, 2, false]\r\n---\r\n# Source λ\r\n\r\nUntouched 😀 body.\r\n";
const targetOriginal = '---\r\nopaque: { target: "λ 😀" }\r\n---\r\n# Parent\r\n\r\nExisting parent body Ω.\r\n\r\n# Sibling\r\n\r\nUntouched final body.\r\n';
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
    commit: async (value, guard, transform) => { assert.equal(app.workspace.isChangingFiles, false); const prior = parseMarkdown(choice.sourceText).frontmatter[choice.property], next = choice.widget === "multitext" ? [...choice.existing, value] : value; await properties.changeValue(source, choice.property, prior, next, choice.widget, guard, transform); return true; }, kept: path => kept.push(path), acknowledgedFailure: issue => reported.push(issue), ...extra });
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

const selfQuery = "[[#Source λ#New parent λ#Leaf Ω";
const selfBody = original + "\r\n## New parent λ\r\n\r\n### Leaf Ω\r\n";
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
function openMultiline(f,index){
  const edit=index===undefined?control(f,"propertyEditMultiline"):find(f.row().valueEl,node=>node.dataset.propertyEditValue===String(index));
  assert.ok(edit);edit.fire("click");const input=control(f,"propertyMultilineInput");assert.ok(input);return input;
}
const errorText=f=>find(f.row().containerEl,node=>node.className==="metadata-property-error").textContent;
const values=f=>parseMarkdown(f.editor.getValue()).frontmatter;

test("multiline text keeps whitespace, normalizes textarea line breaks and rejects unrepresentable input",()=>{
 assert.equal(multiline.checkedMultilineText(" leading \r\nsecond\rthird\n\n")," leading \nsecond\nthird\n\n");
 assert.equal(multiline.checkedMultilineText(""),"");assert.equal(multiline.checkedMultilineText(" ")," ");
 for(const value of["nul\0value","bad\x1fvalue","long".repeat(16385)])assert.throws(()=>multiline.checkedMultilineText(value));
});
test("multiline list replacement retains the original no-op string, index/order and distinct whitespace",()=>{
 const input=[" first\r\nsecond ","other"],before=[...input];
 assert.deepEqual(multiline.replaceMultilinePropertyValue(input,0," first\nsecond "),before);
 assert.deepEqual(multiline.replaceMultilinePropertyValue(input,0," new\nvalue \n"),[" new\nvalue \n","other"]);assert.deepEqual(input,before);
 for(const[index,value]of[[-1,"new"],[4,"new"],[0,"other"],[0," \n "]])assert.throws(()=>multiline.replaceMultilinePropertyValue(input,index,value));
 assert.throws(()=>multiline.replaceMultilinePropertyValue(["one","same\r\nline"],0,"same\nline"));
});
test("structured snapshots inspect only bounded plain JSON-compatible resolved data",()=>{
 const value={branch:{text:"<img src=x> λ\n😀",list:[null,true,2,-0]}},before=structuredClone(value),tree=multiline.structuredPropertyTree(value);
 assert.ok(tree);assert.equal(tree[0].label,"branch");assert.equal(tree[0].children[0].value,JSON.stringify(value.branch.text));assert.equal(tree[0].children[1].children[3].value,"-0");assert.deepEqual(value,before);
});
test("structured snapshots refuse accessors, cycles, repeated aliases, prototypes, symbols and unsupported scalars",()=>{
 let reads=0;const getter=Object.defineProperty({},"unsafe",{enumerable:true,get(){reads++;return"secret"}}),cycle={};cycle.self=cycle;const shared={x:1};
 const sparse=[];sparse[2]="hole";const symbol={};symbol[Symbol("x")]=1;
 for(const value of[getter,cycle,{a:shared,b:shared},new Date(),new Map(),Object.create({inherited:true}),{n:Infinity},{n:NaN},{n:1n},{f:()=>1},{u:undefined},sparse,symbol,JSON.parse('{"__proto__":{"x":1}}')])assert.equal(multiline.structuredPropertyTree(value),null);
 assert.equal(reads,0);
});
test("structured snapshots refuse oversized branches, depth and text before rendering a partial tree",()=>{
 let deep={leaf:true};for(let n=0;n<10;n++)deep={nested:deep};
 for(const value of[deep,Array(257).fill("x"),{large:"x".repeat(4097)},Object.fromEntries(Array.from({length:100},(_,i)=>["key"+i,"x".repeat(400)]))])assert.equal(multiline.structuredPropertyTree(value),null);
});
test("the structured inspector excludes YAML aliases, anchors and explicit tags and renders text inertly",()=>{
 const dom=fakeDocument(),good='---\nopaque:\n  child: "<script>bad()</script>"\n  mixed: [one, 2, false]\n---\n';
 const inspector=multiline.createStructuredPropertyInspector(dom.document,parseMarkdown(good).frontmatter.opaque,"opaque",good);assert.ok(inspector);
 assert.ok(find(inspector,node=>node.tagName==="code"&&node.textContent==='"<script>bad()</script>"'));assert.equal(find(inspector,node=>node.tagName==="script"),null);
 for(const source of['---\nbase: &base {x: one}\nopaque: *base\n---\n','---\nopaque: {x: &value one, y: *value}\n---\n','---\nopaque: !!map {x: one}\n---\n']){
  assert.equal(multiline.createStructuredPropertyInspector(dom.document,parseMarkdown(source).frontmatter.opaque,"opaque",source),null);
 }
 assert.equal(multiline.createStructuredPropertyInspector(dom.document,{x:1},"opaque",undefined),null);
});
test("the actual multiline scalar preview never strips source and its textarea requires explicit apply",async()=>{
 await withRow(fixture(),"description",async f=>{
  assert.equal(control(f,"propertyMultilinePreview").textContent,"First line λ\nSecond line 😀");assert.equal(control(f,"metadataInput"),null);
  const input=openMultiline(f);assert.equal(input.value,"First line λ\nSecond line 😀");assert.equal(input.fire("keydown",{key:"Enter"}).defaultPrevented,false);
  input.value=" leading λ\nSecond Ω\n\nLast 😀\n";input.blur();await f.settle();assert.deepEqual(f.writes,[]);
  input.fire("keydown",{key:"Enter",ctrlKey:true});await f.settle();const updated=f.editor.getValue();
  assert.equal(values(f).description," leading λ\nSecond Ω\n\nLast 😀\n");assert.equal(f.writes.length,1);assert.equal(undoDepth(f.cm.state),1);
  assert.ok(updated.includes("# keep description"));assert.ok(updated.includes("folded: >- # keep folded\r\n  Folded first\r\n  continuation Ω"));assert.ok(updated.includes("count: 1.50"));assert.ok(updated.endsWith("# Source λ\r\n\r\nUntouched 😀 body.\r\n"));
  assert.deepEqual(f.bytes(f.source.path),Buffer.from("\ufeff"+updated));f.editor.undo();assert.equal(f.editor.getValue(),original);f.editor.redo();assert.equal(f.editor.getValue(),updated);
 });
});
test("unchanged literal, folded and CRLF-valued scalar drafts retain exact YAML lexemes without writing",async()=>{
 for(const[key,text]of[["description",original],["folded",original],["description",original.replace(/description: \|- # keep description\r\n  First line λ\r\n  Second line 😀/, 'description: "First\\r\\nSecond"')]]){
  await withRow(fixture(text),key,async f=>{const input=openMultiline(f);control(f,"propertyMultilineApply").fire("click");await f.settle();assert.equal(f.editor.getValue(),text);assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);assert.equal(control(f,"propertyMultilineInput"),null);assert.ok(input.value.length>0);});
 }
});
test("Escape, Cancel and moving focus leave multiline drafts unapplied",async()=>{
 for(const cancel of["Escape","button"]){await withRow(fixture(),"description",async f=>{const input=openMultiline(f);input.value="Discard\nthis λ";input.blur();await f.settle();assert.equal(f.row().hasDraft(),true);assert.deepEqual(f.writes,[]);if(cancel==="Escape")input.fire("keydown",{key:"Escape"});else control(f,"propertyMultilineCancel").fire("click");await f.settle();assert.equal(f.editor.getValue(),original);assert.deepEqual(f.writes,[]);assert.equal(control(f,"propertyMultilineInput"),null);});}
});
test("a single-line scalar can opt into multiline editing without saving an unfinished simple draft",async()=>{
 await withRow(fixture(),"single",async f=>{const single=control(f,"metadataInput");single.value="Unfinished";control(f,"propertyEditMultiline").fire("click");assert.equal(control(f,"propertyMultilineInput"),null);assert.match(errorText(f),/single-line draft/);single.value="Plain";const input=openMultiline(f);input.value="First\nSecond\n";control(f,"propertyMultilineApply").fire("click");await f.settle();assert.equal(values(f).single,"First\nSecond\n");assert.equal(undoDepth(f.cm.state),1);});
});
test("actual multiline list member editing retains order, spaces and one isolated Undo step",async()=>{
 await withRow(fixture(),"items",async f=>{const input=openMultiline(f,1);assert.equal(input.value,"First item λ\nSecond item 😀");input.value=" first Ω \nsecond 😀\n";control(f,"propertyMultilineApply").fire("click");await f.settle();assert.deepEqual(values(f).items,["kept"," first Ω \nsecond 😀\n","duplicate"]);assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),original);});
});
test("list duplicates and control characters leave the textarea open and retain exact source",async()=>{
 await withRow(fixture(),"items",async f=>{const input=openMultiline(f,1);for(const candidate of["duplicate"," \n ","bad\0data"]){input.value=candidate;control(f,"propertyMultilineApply").fire("click");await f.settle();assert.ok(errorText(f));assert.ok(control(f,"propertyMultilineInput"));assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);}control(f,"propertyMultilineCancel").fire("click");});
});
test("composition and process keys cannot apply or cancel a multiline draft",async()=>{
 await withRow(fixture(),"description",async f=>{const input=openMultiline(f);input.value="Composed\nΩ";input.fire("compositionstart");for(const key of["Enter","Escape"])input.fire("keydown",{key,ctrlKey:true});control(f,"propertyMultilineApply").fire("click");await f.settle();assert.deepEqual(f.writes,[]);assert.ok(control(f,"propertyMultilineInput"));input.fire("compositionend");input.fire("keydown",{key:"Enter",ctrlKey:true,keyCode:229});input.fire("keydown",{key:"Enter",metaKey:true,isComposing:true});await f.settle();assert.deepEqual(f.writes,[]);input.fire("keydown",{key:"Enter",metaKey:true});await f.settle();assert.equal(values(f).description,"Composed\nΩ");});
});
test("genuine read-only rows refuse even forced multiline edit controls and permit structured inspection",async()=>{
 for(const property of["description","items"]){const f=fixture();f.app.vault.readOnly=true;await withRow(f,property,async f=>{const edit=property==="items"?find(f.row().valueEl,node=>node.dataset.propertyEditValue==="1"):control(f,"propertyEditMultiline");assert.equal(edit.disabled,true);edit.disabled=false;edit.fire("click");assert.equal(control(f,"propertyMultilineInput"),null);assert.deepEqual(f.writes,[]);});}
 const f=fixture();f.app.vault.readOnly=true;await withRow(f,"opaque",async f=>{assert.ok(control(f,"propertyStructured"));assert.deepEqual(f.writes,[]);});
});
test("multiline drafts refuse replaced sessions, roots, source identities, widgets, modes and detached rows",async()=>{
 for(const change of[f=>{f.state.owned=false},f=>{f.app.vault.readOnly=true},f=>{f.app.vault.rootPath="other"},f=>{f.sessions.set(f.source.path,{...f.session})},f=>{f.session.originRoot="other"},f=>{f.view.mode="source"},f=>{f.row().containerEl.remove()},f=>{f.files.set(f.source.path,{...f.source})},f=>{f.state.widget="number"}]){
  await withRow(fixture(),"description",async f=>{const input=openMultiline(f);input.value="Should not\napply";change(f);control(f,"propertyMultilineApply")?.fire("click");await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.disk.get(f.source.path).text,original);});
 }
});
test("a source change while a multiline draft is open is retained instead of rebasing the draft",async()=>{
 await withRow(fixture(),"description",async f=>{const input=openMultiline(f);input.value="Held\ndraft";const newer=original+"Unrelated dirty body Ω\r\n";f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:"Unrelated dirty body Ω\r\n"}});control(f,"propertyMultilineApply").fire("click");await f.settle();assert.equal(f.editor.getValue(),newer);assert.deepEqual(f.writes,[]);assert.match(errorText(f),/changed/);assert.equal(control(f,"propertyMultilineInput"),input);});
});
test("pending multiline controls stay inert and a late owner change refuses before the queued YAML mutation",async()=>{
 const f=fixture(),gate=deferred();f.beforeSave=()=>gate.promise;
 await withRow(f,"description",async f=>{const input=openMultiline(f);input.value="Queued\nvalue";control(f,"propertyMultilineApply").fire("click");await drain();await drain();assert.equal(input.readOnly,true);assert.equal(control(f,"propertyMultilineApply").disabled,true);assert.equal(control(f,"propertyMultilineCancel").disabled,true);input.fire("keydown",{key:"Escape"});assert.equal(control(f,"propertyMultilineInput"),input);f.state.owned=false;gate.resolve();await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);assert.ok(errorText(f));});
});
test("an external replacement read by the normal queued reload remains exact and blocks multiline mutation",async()=>{
 const f=fixture(),newer=original.replace("Second line 😀","Externally replaced 😀");f.beforeReload=()=>{f.disk.set(f.source.path,{text:newer,version:900});};
 await withRow(f,"description",async f=>{const input=openMultiline(f);input.value="Must not\noverwrite";control(f,"propertyMultilineApply").fire("click");await f.settle();assert.equal(f.editor.getValue(),newer);assert.equal(f.disk.get(f.source.path).text,newer);assert.deepEqual(f.writes,[]);assert.match(errorText(f),/changed/);});
});
test("a dirty source keeps its earlier history while multiline application adds one normal property transaction",async()=>{
 const f=fixture(),extra="Unrelated saved-on-apply body Ω\r\n";f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:extra}});
 await withRow(f,"description",async f=>{const input=openMultiline(f);input.value="Updated\nscalar";control(f,"propertyMultilineApply").fire("click");await f.settle();assert.equal(undoDepth(f.cm.state),2);assert.equal(f.writes.length,2);f.editor.undo();assert.equal(f.editor.getValue(),original+extra);f.editor.undo();assert.equal(f.editor.getValue(),original);});
});
test("closed-note multiline editing uses one checked normal write without claiming editor Undo",async()=>{
 const f=fixture();f.sessions.delete(f.source.path);
 await withRow(f,"description",async f=>{const input=openMultiline(f);input.value="Closed\nnote Ω";control(f,"propertyMultilineApply").fire("click");await f.settle();assert.equal(parseMarkdown(f.disk.get(f.source.path).text).frontmatter.description,"Closed\nnote Ω");assert.equal(f.writes.length,1);assert.equal(undoDepth(f.cm.state),0);});
});
test("aliased multiline changes are refused by the existing YAML round-trip guard without a speculative editor write",async()=>{
 const text=original.replace("description: |- # keep description","description: &shared |- # keep description").replace("folded: >- # keep folded","copy: *shared\r\nfolded: >- # keep folded");
 await withRow(fixture(text),"description",async f=>{const input=openMultiline(f);input.value="Changed\nshared value";control(f,"propertyMultilineApply").fire("click");await f.settle();assert.equal(f.editor.getValue(),text);assert.deepEqual(f.writes,[]);assert.match(errorText(f),/aliases|unsupported/);assert.equal(undoDepth(f.cm.state),0);});
});
test("the legacy property modal remains unavailable for multiline arrays rather than joining and splitting their members",async()=>{
 await withRow(fixture(),"items",async f=>{const edit=find(f.row().containerEl,node=>node.dataset.metadataPropertyAction==="edit");assert.equal(edit.disabled,true);assert.ok(find(f.row().valueEl,node=>node.dataset.propertyEditValue==="1"&&!node.disabled));});
});

test("the multiline source transform preserves untouched folded members, comments and indented root keys",()=>{
 for(const text of[
  '---\r\n  description: |- # keep selected\r\n    Old λ\r\n    Text\r\n  untouched: >- # exact folded\r\n    Leave first\r\n    wrapped line\r\n---\r\nBody 😀.\r\n',
  '---\r\nitems:\r\n    - >- # untouched folded member\r\n      Leave first\r\n      wrapped line\r\n    - |- # changed member\r\n      Old λ\r\n      Text\r\ncount: 1.50\r\n---\r\nBody 😀.\r\n'
 ]){
  const list=text.includes('items:'),name=list?'items':'description',next=" Leading λ\nSecond 😀\n";
  const updated=updateFrontmatter(text,values=>{if(list)values.items[1]=next;else values.description=next});
  assert.ok(updated);const final=multiline.preserveMultilinePropertySource(updated,text,name,list?1:undefined);
  assert.equal(list?parseMarkdown(final).frontmatter.items[1]:parseMarkdown(final).frontmatter.description,next);
  const exact=list?'    - >- # untouched folded member\r\n      Leave first\r\n      wrapped line':'  untouched: >- # exact folded\r\n    Leave first\r\n    wrapped line';
  assert.ok(final.includes(exact));assert.ok(final.endsWith('---\r\nBody 😀.\r\n'));
 }
});

test("structured inspector source policy refreshes for equal-valued anchor and tag edits",()=>{
 for(const addition of[" &newAnchor"," !!map"]){
  const f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
  const owner={id:"structured-policy-owner",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
  const properties=new Properties(f.app),metadata=new MetadataEditor(properties,()=>f.source);dom.container.append(metadata.contentEl);
  const hasInspector=()=>Boolean(find(metadata.rendered.find(row=>row.entry.key==="opaque").valueEl,node=>Object.hasOwn(node.dataset,"propertyStructured")));
  try{
   metadata.render();assert.equal(hasInspector(),true);const originalValue=structuredClone(parseMarkdown(f.editor.getValue()).frontmatter.opaque);
   const from=f.cm.state.doc.toString().indexOf("opaque:")+"opaque:".length;f.cm.dispatch({changes:{from,insert:addition}});assert.deepEqual(parseMarkdown(f.editor.getValue()).frontmatter.opaque,originalValue);
   metadata.render(true);assert.equal(hasInspector(),false);
   f.cm.dispatch({changes:{from,to:from+addition.length,insert:""}});metadata.render(true);assert.equal(hasInspector(),true);
   assert.deepEqual(f.writes,[]);
  }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
 }
});

test("the actual MetadataEditor retains a blurred explicit draft with its original source baseline",async()=>{
 const f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
 const owner={id:"multiline-metadata-owner",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const properties=new Properties(f.app),metadata=new MetadataEditor(properties,()=>f.source);dom.container.append(metadata.contentEl);
 try{
  metadata.render();const row=metadata.rendered.find(row=>row.entry.key==="description");assert.ok(row);
  find(row.valueEl,node=>Object.hasOwn(node.dataset,"propertyEditMultiline")).fire("click");const input=find(row.valueEl,node=>Object.hasOwn(node.dataset,"propertyMultilineInput"));input.value="Retain\nthis draft";input.blur();
  const from=f.cm.state.doc.toString().indexOf("1.50");f.cm.dispatch({changes:{from,to:from+4,insert:"2.50"}});assert.equal(parseMarkdown(f.editor.getValue()).frontmatter.count,2.5);metadata.render(true);
  assert.equal(metadata.rendered.find(current=>current.entry.key==="description"),row);assert.equal(find(row.valueEl,node=>Object.hasOwn(node.dataset,"propertyMultilineInput")),input);assert.equal(input.value,"Retain\nthis draft");
  find(row.valueEl,node=>Object.hasOwn(node.dataset,"propertyMultilineApply")).fire("click");for(let i=0;i<12;i++)await drain();
  assert.deepEqual(f.writes,[]);assert.equal(parseMarkdown(f.editor.getValue()).frontmatter.count,2.5);assert.match(find(row.containerEl,node=>node.className==="metadata-property-error").textContent,/changed/);
 }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

