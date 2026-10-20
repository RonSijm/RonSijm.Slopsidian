import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, historyField, undoDepth, redoDepth } from "@codemirror/commands";
import { createContext, runInContext } from "node:vm";

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
const { MetadataEditor, Properties, inlinePropertyRow } = await import("../client/properties.ts"), { MarkdownView } = await import("../client/workspace.ts");
const { TFile } = await import("../client/vault.ts"), { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts"), { fileLinktext, resolveLink } = await import("../client/links.ts");
const original = "---\r\n# Nested fixture λ\r\nuntouched: >- # original folded\r\n  Exact first\r\n  second 😀\r\nopaque:\r\n  branch:\r\n    enabled: true # keep boolean\r\n    count: 1.50 # exact number\r\n    empty: null # retain null type\r\n    text: '<img src=x> λ 😀' # keep text\r\n    multiline: |- # keep block comment\r\n      First line λ\r\n      Second line 😀\r\n    folded: >- # keep folded comment\r\n      Folded first\r\n      wrapped Ω\r\n    mixed: [one, 2, false, { child: value }] # keep flow\r\nanchored: &shared { retained: exact }\r\naliased: *shared\r\n---\r\n# Source λ\r\n\r\nUntouched 😀 body.\r\n";
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

test("nested scalar edits splice only a proven source token and preserve exact BOM, mixed newlines, comments, key order and body",()=>{
 const source="\ufeff"+original.replace("# Nested fixture λ\r\n","# Nested fixture λ\n").replace("    count: 1.50 # exact number\r\n","    count: 1.50 # exact number\n");
 assert.equal(modelChange(source,leafPath("count"),-2.75),source.replace("count: 1.50","count: -2.75"));
 assert.equal(modelChange(source,leafPath("enabled"),false),source.replace("enabled: true","enabled: false"));
 assert.equal(modelChange(source,leafPath("text"),' false: ["literal"] λ\n😀 '),source.replace("'<img src=x> λ 😀'",JSON.stringify(' false: ["literal"] λ\n😀 ')));
 assert.equal(modelChange(source,leafPath("mixed",3,"child"),"<script>inert()</script>"),source.replace("child: value",'child: "<script>inert()</script>"'));
});

test("selected block literal/folded and multiline quoted strings retain their header comments and every untouched lexeme",()=>{
 for(const [key,old]of[["multiline","|- # keep block comment\r\n      First line λ\r\n      Second line 😀\r\n"],["folded",">- # keep folded comment\r\n      Folded first\r\n      wrapped Ω\r\n"]]){
  const candidate=" Leading λ\nSecond 😀\n\n",suffix=old.slice(old.indexOf(" "),old.indexOf("\n")+1);
  assert.equal(modelChange(original,leafPath(key),candidate),original.replace(old,JSON.stringify(candidate)+suffix));
 }
 const source=original.replace("'<img src=x> λ 😀'",'"first\r\n      second"');
 assert.equal(modelChange(source,leafPath("text"),"changed\u0085\u2028\u2029λ"),source.replace('"first\r\n      second"','"changed\\u0085\\u2028\\u2029λ"'));
});

test("safe number parsing retains negative zero and refuses rounded decimal digits, overflow, underflow and unsafe integers",()=>{
 for(const [text,value]of[["1.50",1.5],["-0",-0],[".25",.25],["+2e-3",.002],["0xff",255],["0o17",15]])assert.ok(Object.is(structured.structuredPropertyNumber(text),value),text);
 for(const text of["", "NaN","Infinity",".inf","9007199254740992","9007199254740991.1","0.10000000000000001","1e-999","1e999","1_000","0x20000000000000","2 # comment","true","1".repeat(129)])assert.throws(()=>structured.structuredPropertyNumber(text),text);
 const source=original.replace("count: 1.50","count: -0");assert.equal(modelChange(source,leafPath("count"),-1),source.replace("count: -0","count: -1"));
});

test("the structured model refuses mismatched source, malformed or ambiguous YAML, anchors, aliases, tags and unsafe or nonstring map keys",()=>{
 const bodies=["opaque: {a: one, a: two}","opaque: [unclosed","opaque: &root {a: one}","opaque: {a: &shared one, b: *shared}","opaque: !!map {a: one}","opaque: {a: !!str one}","opaque: {&key a: one}","opaque: {__proto__: one}","opaque: {constructor: one}","opaque: {prototype: one}","opaque: {<<: one}","opaque: {1: one}","opaque: {? [a, b]: one}","opaque: {number: 9007199254740993}","opaque: {number: 0.10000000000000001}","opaque: {number: .nan}"];
 for(const body of bodies){const source="---\n"+body+"\n---\nBody\n";assert.equal(structured.structuredPropertyModel(parseMarkdown(source).frontmatter?.opaque,source,"opaque"),null,body);}
 assert.equal(structured.structuredPropertyModel({other:"shape"},original,"opaque"),null);assert.equal(structured.structuredPropertyModel({x:1},undefined,"opaque"),null);
 assert.equal(structured.structuredPropertyModel({x:1},"---\nopaque: {x: 1}\n","opaque"),null);
});

test("descriptor validation refuses getters without invoking them, nonenumerable/symbol properties, prototypes, sparse arrays, cycles and shared objects",()=>{
 let reads=0;const getter=Object.defineProperty({},"unsafe",{enumerable:true,get(){reads++;return 1;}}),hidden=Object.defineProperty({},"hidden",{value:1}),cycle={};cycle.self=cycle;
 const shared={text:"one"},symbol={};symbol[Symbol("unsafe")]=1;const sparse=[];sparse[1]="one";
 for(const value of[getter,hidden,cycle,{a:shared,b:shared},symbol,sparse,new Date(),new Map(),Object.create({inherited:true}),{n:Infinity},{n:NaN},{n:1n},{u:undefined},{f(){}}]){
  assert.throws(()=>structured.checkedStructuredPropertySnapshot(value));assert.equal(structured.structuredPropertyModel(value,original,"opaque"),null);
 }
 assert.equal(reads,0);
});

test("source, tree, text and depth budgets refuse the whole model rather than rendering a partial editable tree",()=>{
 let deep={leaf:true};for(let i=0;i<9;i++)deep={nested:deep};
 for(const value of[deep,Array(257).fill("one"),{text:"a".repeat(4097)},Object.fromEntries(Array.from({length:100},(_,i)=>["key"+i,"x".repeat(400)]))])assert.throws(()=>structured.checkedStructuredPropertySnapshot(value));
 for(const source of[original+"x".repeat(1_048_576),"---\n#"+"x".repeat(65_537)+"\nopaque: {x: one}\n---\n"]){assert.equal(structured.structuredPropertyModel({x:"one"},source,"opaque"),null);}
});

test("leaf replacement refuses key/index coercion, missing leaves, wrong baselines and structural edits",()=>{
 const value=parseMarkdown(original).frontmatter.opaque,before=structuredClone(value);
 for(const [path,prior,next]of[[[],value,{}],[leafPath("missing"),undefined,"x"],[leafPath("text"),"wrong baseline","new"],[leafPath("mixed","1"),2,3],[leafPath("mixed",99),undefined,"new"],[leafPath("mixed",3),value.branch.mixed[3],{}],[leafPath("__proto__"),undefined,"new"],[leafPath("empty"),null,{}],[leafPath("count"),1.5,Infinity],[leafPath("text"),"<img src=x> λ 😀",undefined]])assert.throws(()=>structured.replaceStructuredPropertyValue(value,path,prior,next));
 assert.deepEqual(value,before);
 const updated=updateFrontmatter(original,values=>{values.opaque.branch.count=3;values.opaque.branch.enabled=false;});
 assert.throws(()=>structured.preserveStructuredPropertySource(updated,original,"opaque",leafPath("count")));
});

test("actual nested text controls show inert content, keep all whitespace and require explicit Apply with isolated shared Undo/Redo",async()=>{
 await withRow(fixture(),"opaque",async f=>{
  const input=openNested(f,leafPath("text"));assert.equal(input.tagName,"textarea");assert.equal(input.value,"<img src=x> λ 😀");
  assert.equal(find(f.row().valueEl,node=>["img","script","a"].includes(node.tagName)),null);
  input.value=" leading λ\nSecond 😀\n\n";assert.equal(input.fire("keydown",{key:"Enter"}).defaultPrevented,false);input.blur();await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.row().hasDraft(),true);
  control(f,"propertyStructuredTextReview").fire("click");
  input.fire("keydown",{key:"Enter",ctrlKey:true});await f.settle();const expected=original.replace("'<img src=x> λ 😀'",JSON.stringify(" leading λ\nSecond 😀\n\n"));
  assert.equal(f.editor.getValue(),expected);assert.equal(f.disk.get(f.source.path).text,expected);assert.equal(undoDepth(f.cm.state),1);assert.equal(f.writes.length,1);
  assert.equal(control(f,"propertyStructuredInput"),null);f.editor.undo();assert.equal(f.editor.getValue(),original);f.editor.redo();assert.equal(f.editor.getValue(),expected);
 });
});

test("actual number and boolean editors retain type; invalid numeric drafts remain visible without writes",async()=>{
 for(const [path,tag,text,value]of[[leafPath("count"),"input","-3.25",-3.25],[leafPath("enabled"),"select","false",false],[leafPath("mixed",1),"input","-0",-0]]){
  await withRow(fixture(),"opaque",async f=>{const input=openNested(f,path);assert.equal(input.tagName,tag);input.value=text;applyNested(f);await f.settle();let actual=values(f).opaque;for(const key of path)actual=actual[key];assert.ok(Object.is(actual,value));assert.equal(typeof actual,typeof value);assert.equal(undoDepth(f.cm.state),1);});
 }
 await withRow(fixture(),"opaque",async f=>{const input=openNested(f,leafPath("count"));for(const candidate of["NaN","9007199254740991.1","false"]){input.value=candidate;applyNested(f);await f.settle();assert.equal(control(f,"propertyStructuredInput"),input);assert.ok(errorText(f));assert.deepEqual(f.writes,[]);}control(f,"propertyStructuredCancel").fire("click");});
});

test("unchanged decimal/quoted/CRLF string drafts and explicit Cancel or Escape retain exact original lexemes without entering the queue",async()=>{
 for(const path of[leafPath("text"),leafPath("multiline"),leafPath("folded"),leafPath("count"),leafPath("enabled")]){
  await withRow(fixture(),"opaque",async f=>{openNested(f,path);applyNested(f);await f.settle();assert.equal(f.editor.getValue(),original);assert.deepEqual(f.writes,[]);assert.equal(control(f,"propertyStructuredInput"),null);});
 }
 await withRow(fixture(),"opaque",async f=>{const input=openNested(f,leafPath("count"));input.value="1.5000";applyNested(f);await f.settle();assert.deepEqual(f.writes,[]);assert.equal(control(f,"propertyStructuredInput"),null);});
 for(const via of["Escape","Cancel"]){await withRow(fixture(),"opaque",async f=>{const input=openNested(f,leafPath("text"));input.value="discard\nme";input.blur();await f.settle();assert.deepEqual(f.writes,[]);if(via==="Escape")input.fire("keydown",{key:"Escape"});else control(f,"propertyStructuredCancel").fire("click");assert.equal(f.editor.getValue(),original);assert.equal(control(f,"propertyStructuredInput"),null);});}
 const source=original.replace("'<img src=x> λ 😀'",'"first\\r\\nsecond"');await withRow(fixture(source),"opaque",async f=>{const input=openNested(f,leafPath("text"));assert.equal(input.value,"first\nsecond");applyNested(f);await f.settle();assert.equal(f.editor.getValue(),source);assert.deepEqual(f.writes,[]);});
});

test("composition and process keys cannot apply or cancel a nested scalar draft",async()=>{
 await withRow(fixture(),"opaque",async f=>{const input=openNested(f,leafPath("text"));input.value="Composed Ω";input.fire("compositionstart");applyNested(f);for(const key of["Enter","Escape"])input.fire("keydown",{key,ctrlKey:true});await f.settle();assert.deepEqual(f.writes,[]);input.fire("compositionend");for(const extra of[{keyCode:229},{isComposing:true},{key:"Process"},{key:"Unidentified"}])input.fire("keydown",{key:"Enter",ctrlKey:true,...extra});await f.settle();assert.deepEqual(f.writes,[]);input.fire("keydown",{key:"Enter",metaKey:true});await f.settle();assert.equal(values(f).opaque.branch.text,"Composed Ω");});
});

test("read-only cached rows and closed-note inspectors refuse forged Edit controls before any write or draft",async()=>{
 for(const configure of[f=>{f.app.vault.readOnly=true},f=>{f.sessions.delete(f.source.path)}]){
  const f=fixture();configure(f);await withRow(f,"opaque",async f=>{const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(leafPath("text")));assert.ok(button);assert.equal(button.disabled,true);button.disabled=false;button.fire("click");await f.settle();assert.equal(control(f,"propertyStructuredInput"),null);assert.deepEqual(f.writes,[]);assert.equal(f.disk.get(f.source.path).text,original);});
 }
});

test("nested drafts refuse stale source, root, session, file identity, pane, mode, widget, readonly and detached owners while retaining draft text",async()=>{
 const mutations=[f=>{f.state.owned=false},f=>{f.app.vault.readOnly=true},f=>{f.app.vault.rootPath="other"},f=>{f.sessions.set(f.source.path,{...f.session})},f=>{f.session.originRoot="other"},f=>{f.view.mode="source"},f=>{f.view.getEditingMode=()=>"source"},f=>{f.app.workspace.getLeafById=()=>null},f=>{f.row().containerEl.remove()},f=>{f.files.set(f.source.path,{...f.source})},f=>{f.state.widget="text"},f=>{f.row().containerEl.hidden=true},f=>{control(f,"propertyStructuredInput").parentElement.hidden=true},f=>{f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:"New body\r\n"}})}];
 for(const change of mutations){await withRow(fixture(),"opaque",async f=>{const input=openNested(f,leafPath("text"));input.value="Must stay\na draft";change(f);applyNested(f);await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.disk.get(f.source.path).text,original);assert.equal(control(f,"propertyStructuredInput"),input);assert.equal(input.value,"Must stay\na draft");assert.ok(errorText(f));});}
});

test("late physical source replacements and same-text physical versions refuse before a property transaction",async()=>{
 for(const newer of[original.replace("count: 1.50","count: 4.50"),original]){
  const f=fixture();f.beforeReload=()=>{f.disk.set(f.source.path,{text:newer,version:900});};
  await withRow(f,"opaque",async f=>{const input=openNested(f,leafPath("text"));input.value="Stale draft";applyNested(f);await f.settle();assert.equal(f.editor.getValue(),newer);assert.equal(f.disk.get(f.source.path).text,newer);assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);assert.equal(control(f,"propertyStructuredInput"),input);assert.match(errorText(f),/changed/);});
 }
});

test("earlier dirty text is saved intact and a nested Apply adds exactly one shared isolated history step",async()=>{
 const f=fixture(),extra="Earlier dirty body Ω.\r\n";f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:extra}});
 await withRow(f,"opaque",async f=>{const input=openNested(f,leafPath("count"));input.value="2.75";applyNested(f);await f.settle();assert.equal(f.editor.getValue(),original.replace("count: 1.50","count: 2.75")+extra);assert.equal(undoDepth(f.cm.state),2);assert.equal(f.writes.length,2);f.editor.undo();assert.equal(f.editor.getValue(),original+extra);f.editor.undo();assert.equal(f.editor.getValue(),original);});
});

test("pending nested controls lock through the normal queue, and a late owner change rejects without mutating source",async()=>{
 const f=fixture(),gate=deferred();f.beforeReload=()=>gate.promise;
 await withRow(f,"opaque",async f=>{const input=openNested(f,leafPath("text"));input.value="Queued draft";applyNested(f);await drain();await drain();assert.equal(input.disabled,true);assert.equal(control(f,"propertyStructuredApply").disabled,true);assert.equal(control(f,"propertyStructuredCancel").disabled,true);input.fire("keydown",{key:"Escape"});assert.equal(control(f,"propertyStructuredInput"),input);f.state.owned=false;gate.resolve();await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);assert.equal(undoDepth(f.cm.state),0);assert.match(errorText(f),/changed/);});
});

test("actual MetadataEditor retains a blurred nested draft and its original comparison baseline across refreshes",async()=>{
 const f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
 const owner={id:"nested-metadata-owner",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);
 try{
  metadata.render();const row=metadata.rendered.find(row=>row.entry.key==="opaque"),button=find(row.valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(leafPath("text")));button.fire("click");const input=find(row.valueEl,node=>Object.hasOwn(node.dataset,"propertyStructuredInput"));input.value="Retain\nthis draft";input.blur();
  const from=f.cm.state.doc.toString().indexOf("1.50");f.cm.dispatch({changes:{from,to:from+4,insert:"2.50"}});metadata.render(true);
  assert.equal(metadata.rendered.find(current=>current.entry.key==="opaque"),row);assert.equal(input.value,"Retain\nthis draft");find(row.valueEl,node=>Object.hasOwn(node.dataset,"propertyStructuredApply")).fire("click");for(let i=0;i<12;i++)await drain();assert.deepEqual(f.writes,[]);assert.equal(values(f).opaque.branch.count,2.5);assert.match(find(row.containerEl,node=>node.className==="metadata-property-error").textContent,/changed/);
 }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test("same-value source-only anchors and tags revoke editable nested controls on the actual MetadataEditor",()=>{
 for(const addition of[" &newAnchor"," !!map"]){
  const f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
  const owner={id:"nested-source-policy",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
  const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);
  const editable=()=>Boolean(find(metadata.rendered.find(row=>row.entry.key==="opaque").valueEl,node=>Object.hasOwn(node.dataset,"propertyStructuredEdit")));
  try{
   metadata.render();assert.equal(editable(),true);const expected=structuredClone(values(f).opaque),from=f.cm.state.doc.toString().indexOf("opaque:")+"opaque:".length;
   f.cm.dispatch({changes:{from,insert:addition}});assert.deepEqual(values(f).opaque,expected);metadata.render();assert.equal(editable(),false);
   f.cm.dispatch({changes:{from,to:from+addition.length,insert:""}});metadata.render();assert.equal(editable(),true);assert.deepEqual(f.writes,[]);
  }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
 }
});

test("the final source transform verifies the exact intended scalar, rather than accepting serializer coercion",()=>{
 const updated=updateFrontmatter(original,values=>{values.opaque.branch.count=2.5;});
 assert.throws(()=>structured.preserveStructuredPropertySource(updated,original,"opaque",leafPath("count"),3.5));
});

test("nested safety does not shrink existing ordinary or multiline string-list editing limits",async()=>{
 const text="x".repeat(5000)+"\nsecond",source=original.replace("anchored:","longList: ["+JSON.stringify(text)+"]\r\nanchored:");
 await withRow(fixture(source),"longList",async f=>{const button=find(f.row().valueEl,node=>node.dataset.propertyEditValue==="0");assert.ok(button);assert.equal(button.disabled,false);button.fire("click");assert.equal(control(f,"propertyMultilineInput").value,text);assert.deepEqual(f.writes,[]);});
 const list=Array(300).fill("plain"),source2=original.replace("anchored:","longList: "+JSON.stringify(list)+"\r\nanchored:");
 await withRow(fixture(source2),"longList",async f=>{assert.equal(find(f.row().valueEl,node=>node.dataset.propertyEditValue==="299").disabled,false);assert.deepEqual(f.writes,[]);});
});

test("direct hostile array rows refuse getters before clone, widget inference or rendering",async()=>{
 let reads=0;const value=[];Object.defineProperty(value,0,{enumerable:true,get(){reads++;return"hostile"}});
 await withRow(fixture(),"opaque",async f=>{const row=inlinePropertyRow(new Properties(f.app),f.source,"opaque",value,()=>{},()=>true);assert.equal(reads,0);assert.equal(find(row.valueEl,node=>Object.hasOwn(node.dataset,"propertyStructuredEdit")),null);assert.deepEqual(f.writes,[]);row.cleanup?.();});
});

const selectNestedType=(f,type)=>{const select=control(f,"propertyStructuredType");assert.ok(select,"explicit nested scalar type selector");select.value=type;select.fire("change");return control(f,"propertyStructuredInput");};
test("existing nested scalar tokens support explicit string, number, boolean and null conversions without changing unrelated source",()=>{
 const candidates=[null,"false",false,2.75,-0," leading λ\n😀 "];
 for(const path of[leafPath("text"),leafPath("count"),leafPath("enabled"),leafPath("empty"),leafPath("mixed",0),leafPath("mixed",1),leafPath("mixed",2),leafPath("mixed",3,"child")]){
  for(const next of candidates){const prior=structured.structuredPropertyModel(parseMarkdown(original).frontmatter.opaque,original,"opaque").leaves.find(leaf=>JSON.stringify(leaf.path)===JSON.stringify(path));
   const expected=Object.is(prior.value,next)?original:original.slice(0,prior.from)+(Object.is(next,-0)?"-0":JSON.stringify(next))+original.slice(prior.to);
   assert.equal(modelChange(original,path,next),expected,JSON.stringify({path,next}));
  }
 }
 for(const literal of["~","NULL","Null"]){const source=original.replace("empty: null","empty: "+literal);assert.equal(modelChange(source,leafPath("empty"),"null"),source.replace("empty: "+literal,'empty: "null"'));assert.equal(modelChange(source,leafPath("empty"),null),source);}
});

test("implicit nested nulls use proven empty boundaries for reviewed editing, Cancel and isolated Undo",async()=>{
 for(const source of[original.replace("empty: null # retain null type","empty: # retain null type"),original.replace("empty: null # retain null type","empty:"),original.replace("mixed: [one, 2, false, { child: value }]","mixed: [one, 2, false, { child: }]")]){
  const path=source.includes("{ child: }")?leafPath("mixed",3,"child"):leafPath("empty"),value=parseMarkdown(source).frontmatter.opaque,model=structured.structuredPropertyModel(value,source,"opaque");assert.ok(model);const leaf=model.leaves.find(leaf=>JSON.stringify(leaf.path)===JSON.stringify(path));assert.equal(leaf.value,null);assert.equal(leaf.from,leaf.to);
  assert.equal(leaf.implicit,true);const expected=modelChange(source,path,"typed");let changed=parseMarkdown(expected).frontmatter.opaque;for(const key of path)changed=changed[key];assert.equal(changed,"typed");
  await withRow(fixture(source),"opaque",async f=>{openNested(f,path);selectNestedType(f,"string").value="typed";assert.deepEqual(f.writes,[]);control(f,"propertyStructuredCancel").fire("click");assert.equal(f.editor.getValue(),source);assert.deepEqual(f.writes,[]);openNested(f,path);selectNestedType(f,"string").value="typed";applyNested(f);await f.settle();assert.equal(f.editor.getValue(),expected);assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),source);});
 }
});

test("actual nested key rename reviews a literal key, retains subtree/comments, and uses the ordinary isolated Undo queue",async()=>{
 const path=leafPath("mixed",3,"child");
 await withRow(fixture(),"opaque",async f=>{
  const open=()=>{const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredRename===JSON.stringify(path));assert.ok(button);button.fire("click");return control(f,"propertyStructuredRenameInput")};
  let input=open();input.value="renamed λ 😀";input.fire("input");assert.match(control(f,"propertyStructuredRenameReview").value,/byte-for-byte unchanged/);assert.deepEqual(f.writes,[]);control(f,"propertyStructuredCancel").fire("click");assert.equal(f.editor.getValue(),original);assert.deepEqual(f.writes,[]);
  input=open();input.value="renamed λ 😀";input.fire("input");applyNested(f);await f.settle();const changed=original.replace("child: value",'"renamed λ 😀": value');assert.equal(f.editor.getValue(),changed);assert.equal(values(f).opaque.branch.mixed[3]["renamed λ 😀"],"value");assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),original);f.editor.redo();assert.equal(f.editor.getValue(),changed);
 });
});

test("actual nested reorder has explicit Cancel then one isolated ordinary queue Apply/Undo/Redo with exact source",async()=>{
 const first="    enabled: true # keep boolean\r\n",second="    count: 1.50 # exact number\r\n",changed=original.replace(first+second,second+first);
 await withRow(fixture(),"opaque",async f=>{
  const open=()=>{const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredMoveDown===JSON.stringify(leafPath("enabled")));assert.ok(button);button.fire("click");return control(f,"propertyStructuredReorderReview");};
  const preview=open();assert.match(preview.value,/Exact adjacent entries before:/);assert.match(preview.value,/# exact number/);assert.equal(control(f,"propertyStructuredApply").textContent,"Apply reorder");assert.deepEqual(f.writes,[]);
  control(f,"propertyStructuredCancel").fire("click");assert.equal(f.editor.getValue(),original);assert.deepEqual(f.writes,[]);open();applyNested(f);await f.settle();
  assert.equal(f.editor.getValue(),changed);assert.deepEqual(Object.keys(values(f).opaque.branch).slice(0,2),["count","enabled"]);assert.equal(undoDepth(f.cm.state),1);assert.equal(f.writes.length,1);f.editor.undo();assert.equal(f.editor.getValue(),original);f.editor.redo();assert.equal(f.editor.getValue(),changed);
 });
});

for(const focused of [false,true])test("the actual MetadataEditor repaints mapping order after an order-only source change and Undo, focused="+focused,()=>{
 const first="    enabled: true # keep boolean\r\n",second="    count: 1.50 # exact number\r\n",changed=original.replace(first+second,second+first),f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","CSS","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,CSS:{escape:value=>String(value)},propertyHeadingNotices:[],propertyHeadingReported:[]});
 const owner={id:"nested-reorder-owner",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);const row=()=>metadata.rendered.find(row=>row.entry.key==="opaque"),all=root=>root.children.flatMap(child=>[child,...all(child)]),order=()=>all(row().valueEl).filter(n=>n.className==="metadata-structured-key").map(n=>n.textContent);
 try{metadata.render();const initial=row();assert.deepEqual(order().slice(0,3),["branch","enabled","count"]);if(focused)find(row().valueEl,n=>n.dataset.propertyStructuredMoveDown===JSON.stringify(leafPath("enabled"))).focus();f.cm.dispatch({changes:{from:0,to:f.cm.state.doc.length,insert:changed}});assert.deepEqual(values(f).opaque,parseMarkdown(original).frontmatter.opaque);metadata.render();assert.notEqual(row(),initial);assert.deepEqual(order().slice(0,3),["branch","count","enabled"]);const reordered=row();if(focused)find(row().valueEl,n=>n.dataset.propertyStructuredMoveDown===JSON.stringify(leafPath("count"))).focus();f.editor.undo();metadata.render();assert.notEqual(row(),reordered);assert.deepEqual(order().slice(0,3),["branch","enabled","count"]);assert.deepEqual(f.writes,[]);}
 finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

for(const failure of ["later Source edit","queued physical version change"])test("MetadataEditor retains local reorder feedback beside Apply and Cancel after "+failure,async()=>{
 const f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","CSS","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,CSS:{escape:String},propertyHeadingNotices:[],propertyHeadingReported:[]});
 const owner={id:"nested-local-feedback",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);const row=()=>metadata.rendered.find(row=>row.entry.key==="opaque"),control=name=>find(row().valueEl,node=>Object.hasOwn(node.dataset,name));let reads=0;f.beforeRead=()=>{reads++;if(failure==="later Source edit")throw Error("A stale draft must refuse before physical reads");};
 try{
  metadata.render();find(row().valueEl,node=>node.dataset.propertyStructuredMoveDown===JSON.stringify(leafPath("enabled"))).fire("click");
  const drafted=row(),review=control("propertyStructuredReorderReview"),apply=control("propertyStructuredApply"),cancel=control("propertyStructuredCancel"),local=control("propertyStructuredError"),globalError=drafted.containerEl.children.find(node=>node.className==="metadata-property-error");
  assert.ok(local&&globalError&&local!==globalError);assert.equal(local.textContent??"","");assert.equal(local.getAttribute("role"),"alert");assert.equal(local.style.gridColumn,"1 / -1");assert.equal(local.parentElement,apply.parentElement.parentElement);assert.equal(local.parentElement,cancel.parentElement.parentElement);assert.equal(local.parentElement.children.indexOf(local),local.parentElement.children.indexOf(apply.parentElement)+1,"the local error follows the draft action row rather than the entire nested tree");
  if(failure==="later Source edit"){f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:"Later body λ.\r\n"}});metadata.render();assert.equal(row(),drafted);}else{f.beforeReload=()=>f.disk.set(f.source.path,{text:original,version:900});}
  const text=f.editor.getValue(),doc=f.cm.state.doc,historyBefore=undoDepth(f.cm.state);apply.fire("click");for(let i=0;i<16;i++)await drain();
  assert.match(local.textContent,/changed/);assert.equal(globalError.textContent,local.textContent,"the existing row-level feedback remains available");assert.equal(local.checkVisibility(),true);assert.equal(row(),drafted);assert.equal(control("propertyStructuredReorderReview"),review);assert.equal(apply.disabled,false);assert.equal(cancel.disabled,false);assert.equal(f.editor.getValue(),text);assert.equal(f.cm.state.doc,doc);assert.equal(undoDepth(f.cm.state),historyBefore);assert.deepEqual(f.writes,[]);if(failure==="later Source edit")assert.equal(reads,0);
  cancel.fire("click");assert.equal(local.isConnected,false);assert.equal(control("propertyStructuredReorderReview"),null);assert.equal(f.editor.getValue(),text);assert.equal(undoDepth(f.cm.state),historyBefore);assert.deepEqual(f.writes,[]);
 }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test("queued reorder refuses changed physical versions or retired owners before a source transaction",async()=>{
 for(const mutate of [f=>{f.state.owned=false;},f=>{f.app.vault.readOnly=true;},f=>{f.app.vault.rootPath="other";},f=>{f.session.document.version=777;},f=>{f.beforeReload=()=>f.disk.set(f.source.path,{text:original,version:900});}]){
  const state=fixture();await withRow(state,"opaque",async f=>{const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredMoveDown===JSON.stringify(leafPath("enabled")));button.fire("click");const preview=control(f,"propertyStructuredReorderReview");mutate(state);applyNested(f);await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);assert.equal(undoDepth(f.cm.state),0);assert.equal(control(f,"propertyStructuredReorderReview"),preview);assert.match(errorText(f),/changed|source/);});
 }
});

test("actual Add entry can create empty Map/List containers and populate them without rewriting unrelated YAML",async()=>{
 for(const kind of["map","list"]){const source='---\r\nopaque:\r\n  host: {}\r\n  keep: 1.50 # preserve\r\n---\r\nbody λ\r\n';await withRow(fixture(source),"opaque",async f=>{
  const open=path=>{const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredAdd===JSON.stringify(path));assert.ok(button);button.fire("click");};
  open(["host"]);control(f,"propertyStructuredPosition").value="new λ";selectNestedType(f,kind);assert.equal(control(f,"propertyStructuredInput").readOnly,true);assert.equal(control(f,"propertyStructuredInput").value,kind==="map"?"{}":"[]");assert.deepEqual(f.writes,[]);applyNested(f);await f.settle();const created=source.replace("host: {}",'host: {"new λ": '+(kind==="map"?"{}":"[]")+'}');assert.equal(f.editor.getValue(),created);
  open(["host","new λ"]);if(kind==="map")control(f,"propertyStructuredPosition").value="child";selectNestedType(f,"boolean").value="false";applyNested(f);await f.settle();assert.equal(kind==="map"?values(f).opaque.host["new λ"].child:values(f).opaque.host["new λ"][0],false);assert.equal(undoDepth(f.cm.state),2);f.editor.undo();assert.equal(f.editor.getValue(),created);f.editor.undo();assert.equal(f.editor.getValue(),source);
 });}
});

test("actual Rename key refuses duplicate and composing drafts, then retains a stale owner draft without writes",async()=>{
 const path=leafPath("count");await withRow(fixture(),"opaque",async f=>{
  const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredRename===JSON.stringify(path));button.fire("click");const input=control(f,"propertyStructuredRenameInput");input.value="enabled";applyNested(f);await f.settle();assert.match(errorText(f),/duplicate/);assert.deepEqual(f.writes,[]);
  input.value="new λ";input.fire("compositionstart");applyNested(f);await f.settle();assert.deepEqual(f.writes,[]);input.fire("compositionend");f.state.owned=false;applyNested(f);await f.settle();assert.equal(input.value,"new λ");assert.match(errorText(f),/changed/);assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);
 });
});

test("actual explicit-null editing opens a typed draft and one shared Undo preserves original null spelling/comments",async()=>{
 for(const literal of["null","~"]){const source=original.replace("empty: null","empty: "+literal);await withRow(fixture(source),"opaque",async f=>{openNested(f,leafPath("empty"));assert.equal(control(f,"propertyStructuredType").value,"null");const input=selectNestedType(f,"string");input.value="Typed null λ\n😀";input.fire("input");assert.ok(control(f,"propertyStructuredPreview").textContent.includes('"Typed null λ\\n😀"'));assert.deepEqual(f.writes,[]);applyNested(f);await f.settle();assert.equal(f.editor.getValue(),source.replace("empty: "+literal,'empty: "Typed null λ\\n😀"'));assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),source);});}
});

test("type changes retain separate drafts and do not coerce invalid numbers or ambiguous string values before Apply",async()=>{
 await withRow(fixture(),"opaque",async f=>{let input=openNested(f,leafPath("text"));input.value="String draft λ";input=selectNestedType(f,"number");assert.equal(input.value,"");input.value="0.10000000000000001";applyNested(f);await f.settle();assert.match(errorText(f),/precision/);assert.deepEqual(f.writes,[]);input=selectNestedType(f,"boolean");input.value="true";input=selectNestedType(f,"string");assert.equal(input.value,"String draft λ");input=selectNestedType(f,"number");assert.equal(input.value,"0.10000000000000001");input.value="0x10";applyNested(f);await f.settle();assert.equal(values(f).opaque.branch.text,16);assert.equal(f.editor.getValue(),original.replace("'<img src=x> λ 😀'","16"));assert.equal(undoDepth(f.cm.state),1);});
 await withRow(fixture(),"opaque",async f=>{openNested(f,leafPath("enabled"));const input=selectNestedType(f,"string");assert.equal(input.value,"true");applyNested(f);await f.settle();assert.equal(values(f).opaque.branch.enabled,"true");assert.equal(f.editor.getValue(),original.replace("enabled: true",'enabled: "true"'));});
});

test("choosing null is explicit, while switching away and back or cancelling retains exact original scalar tokens",async()=>{
 await withRow(fixture(),"opaque",async f=>{openNested(f,leafPath("count"));const input=selectNestedType(f,"null");assert.equal(input.readOnly,true);assert.match(control(f,"propertyStructuredPreview").textContent,/null/);assert.deepEqual(f.writes,[]);applyNested(f);await f.settle();assert.equal(values(f).opaque.branch.count,null);assert.equal(f.editor.getValue(),original.replace("count: 1.50","count: null"));assert.equal(undoDepth(f.cm.state),1);});
 for(const leaf of["count","enabled","empty","multiline"]){await withRow(fixture(),"opaque",async f=>{const input=openNested(f,leafPath(leaf)),kind=control(f,"propertyStructuredType").value;selectNestedType(f,kind==="string"?"number":"string");selectNestedType(f,kind);applyNested(f);await f.settle();assert.equal(f.editor.getValue(),original);assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);});}
 for(const via of["Cancel","Escape"]){await withRow(fixture(),"opaque",async f=>{openNested(f,leafPath("empty"));const input=selectNestedType(f,"string");input.value="Discard type change";if(via==="Escape")input.fire("keydown",{key:"Escape"});else control(f,"propertyStructuredCancel").fire("click");await f.settle();assert.equal(f.editor.getValue(),original);assert.deepEqual(f.writes,[]);});}
});

test("typed nested conversion preserves earlier dirty history and the existing queued owner/version guards",async()=>{
 const f=fixture(),dirty="Earlier dirty Ω.\r\n";f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:dirty}});
 await withRow(f,"opaque",async f=>{openNested(f,leafPath("empty"));selectNestedType(f,"boolean").value="true";applyNested(f);await f.settle();assert.equal(f.editor.getValue(),original.replace("empty: null","empty: true")+dirty);assert.equal(undoDepth(f.cm.state),2);f.editor.undo();assert.equal(f.editor.getValue(),original+dirty);f.editor.undo();assert.equal(f.editor.getValue(),original);});
 for(const mutate of[f=>{f.app.vault.readOnly=true},f=>{f.app.vault.rootPath="other"},f=>{f.state.owned=false},f=>{f.sessions.set(f.source.path,{...f.session})}]){await withRow(fixture(),"opaque",async f=>{openNested(f,leafPath("empty"));selectNestedType(f,"number").value="2.5";mutate(f);applyNested(f);await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);assert.match(errorText(f),/changed/);});}
 const held=fixture(),gate=deferred();held.beforeReload=()=>gate.promise;await withRow(held,"opaque",async f=>{openNested(f,leafPath("empty"));selectNestedType(f,"number").value="2.5";applyNested(f);await drain();await drain();assert.equal(control(f,"propertyStructuredType").disabled,true);f.state.owned=false;gate.resolve();await f.settle();assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);assert.match(errorText(f),/changed/);});
});

test("readonly/closed explicit-null controls and stale or composing type selectors cannot authorize nested mutations",async()=>{
 for(const configure of[f=>{f.app.vault.readOnly=true},f=>{f.sessions.delete(f.source.path)}]){const f=fixture();configure(f);await withRow(f,"opaque",async f=>{const button=find(f.row().valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(leafPath("empty")));assert.ok(button);assert.equal(button.disabled,true);button.disabled=false;button.fire("click");assert.equal(control(f,"propertyStructuredType"),null);assert.deepEqual(f.writes,[]);});}
 await withRow(fixture(),"opaque",async f=>{const input=openNested(f,leafPath("text")),type=control(f,"propertyStructuredType");input.fire("compositionstart");type.value="null";type.fire("change");assert.equal(type.value,"string");input.fire("compositionend");type.value="map";type.fire("change");assert.equal(type.value,"string");assert.match(errorText(f),/type/);f.state.owned=false;type.value="null";type.fire("change");assert.equal(type.value,"string");assert.deepEqual(f.writes,[]);control(f,"propertyStructuredCancel").fire("click");type.value="null";type.fire("change");assert.equal(control(f,"propertyStructuredType"),null);assert.deepEqual(f.writes,[]);});
});

test("replaced scalar inputs cannot apply, cancel or lock the current typed draft",async()=>{
 await withRow(fixture(),"opaque",async f=>{const old=openNested(f,leafPath("text")),input=selectNestedType(f,"number");input.value="2.75";assert.equal(old.isConnected,false);for(const key of["Enter","Escape"])old.fire("keydown",{key,ctrlKey:true});old.fire("compositionstart");await f.settle();assert.equal(control(f,"propertyStructuredInput"),input);assert.deepEqual(f.writes,[]);input.fire("keydown",{key:"Enter",ctrlKey:true});await f.settle();assert.equal(values(f).opaque.branch.text,2.75);assert.equal(undoDepth(f.cm.state),1);});
});

test("explicit typed nested conversion uses the existing visible Reading, Source and Live Preview Properties contract",async()=>{
 for(const mode of["preview","source","live-preview"]){const f=fixture();f.view.mode=mode==="preview"?"preview":"source";f.view.sourceEditing=mode==="source";await withRow(f,"opaque",async f=>{assert.equal(f.view.getEditingMode(),mode);openNested(f,leafPath("empty"));selectNestedType(f,"number").value="-0";applyNested(f);await f.settle();assert.ok(Object.is(values(f).opaque.branch.empty,-0));assert.equal(f.editor.getValue(),original.replace("empty: null","empty: -0"));assert.equal(undoDepth(f.cm.state),1);assert.equal(f.view.getEditingMode(),mode);});}
});

test("block scalar type conversion keeps its selected header comment and every unrelated block token",()=>{
 for(const [key,old]of[["multiline","|- # keep block comment\r\n      First line λ\r\n      Second line 😀\r\n"],["folded",">- # keep folded comment\r\n      Folded first\r\n      wrapped Ω\r\n"]]){
  for(const next of[null,false,2.75]){const suffix=old.slice(old.indexOf(" "),old.indexOf("\n")+1);assert.equal(modelChange(original,leafPath(key),next),original.replace(old,JSON.stringify(next)+suffix));}
 }
});

for(const focused of[false,true])test(`MetadataEditor refreshes cached nested availability when the live source closes, including focused=${focused}`,()=>{
 const f=fixture(),dom=fakeDocument(),keys=["document","CSS","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.document,CSS:{escape:String},HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
 const owner={id:"nested-session-availability",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);let reads=0;f.beforeRead=()=>{reads++;throw Error("Closed nested inspection must not read source");};
 const row=()=>metadata.rendered.find(row=>row.entry.key==="opaque"),button=()=>find(row().valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(leafPath("empty")));
 try{
  metadata.render();assert.equal(button().disabled,false);const retired=button();if(focused){const inspector=find(row().valueEl,node=>node.dataset.propertyStructured==="opaque");inspector.children[0].focus();}
  f.sessions.delete(f.source.path);metadata.render();assert.equal(button().disabled,true);assert.match(find(row().valueEl,node=>node.tagName==="p").textContent,/Open this note.*Markdown/);
  assert.equal(retired.isConnected,false);retired.disabled=false;retired.fire("click");assert.equal(find(row().valueEl,node=>Object.hasOwn(node.dataset,"propertyStructuredType")),null);
  button().disabled=false;button().fire("click");assert.equal(find(row().valueEl,node=>Object.hasOwn(node.dataset,"propertyStructuredType")),null);assert.equal(reads,0);assert.deepEqual(f.writes,[]);assert.equal(f.sessions.has(f.source.path),false);
  f.sessions.set(f.source.path,f.session);metadata.render();assert.equal(button().disabled,false);button().fire("click");assert.ok(find(row().valueEl,node=>Object.hasOwn(node.dataset,"propertyStructuredType")));assert.equal(reads,0);assert.deepEqual(f.writes,[]);
 }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test("a live-session identity change revokes cached controls but retains an active stale draft for refusal and Cancel",async()=>{
 const f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
 const owner={id:"nested-stale-session-draft",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);let reads=0;f.beforeRead=()=>{reads++;throw Error("Stale nested draft must not read source");};
 const row=()=>metadata.rendered.find(row=>row.entry.key==="opaque"),findControl=name=>find(row().valueEl,node=>Object.hasOwn(node.dataset,name));
 try{
  metadata.render();const first=row();f.sessions.set(f.source.path,{...f.session});metadata.render();assert.notEqual(row(),first,"a different live session gets fresh controls even with identical YAML");
  find(row().valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(leafPath("empty"))).fire("click");findControl("propertyStructuredType").value="string";findControl("propertyStructuredType").fire("change");const input=findControl("propertyStructuredInput");input.value="Retained stale typed draft λ";const drafted=row();
  f.sessions.delete(f.source.path);metadata.render();assert.equal(row(),drafted);assert.equal(findControl("propertyStructuredInput"),input);assert.equal(input.value,"Retained stale typed draft λ");findControl("propertyStructuredApply").fire("click");for(let i=0;i<12;i++)await drain();assert.match(find(row().containerEl,node=>node.className==="metadata-property-error").textContent,/changed/);assert.equal(reads,0);assert.deepEqual(f.writes,[]);assert.equal(f.sessions.has(f.source.path),false);
  findControl("propertyStructuredCancel").fire("click");assert.equal(findControl("propertyStructuredType"),null);assert.equal(find(row().valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(leafPath("empty"))).disabled,true);
 }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test("nested availability refresh preserves an unrelated blurred explicit property draft",()=>{
 const f=fixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,propertyHeadingNotices:[],propertyHeadingReported:[]});
 const owner={id:"nested-unrelated-draft",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);let reads=0;f.beforeRead=()=>{reads++;throw Error("Availability refresh must not read source");};
 const row=name=>metadata.rendered.find(row=>row.entry.key===name);
 try{
  metadata.render();const ordinary=row("untouched");find(ordinary.valueEl,node=>Object.hasOwn(node.dataset,"propertyEditMultiline")).fire("click");const input=find(ordinary.valueEl,node=>Object.hasOwn(node.dataset,"propertyMultilineInput"));input.value="Keep this unrelated blurred draft λ";input.blur();
  f.sessions.delete(f.source.path);metadata.render();assert.equal(row("untouched"),ordinary);assert.equal(find(ordinary.valueEl,node=>Object.hasOwn(node.dataset,"propertyMultilineInput")),input);assert.equal(input.value,"Keep this unrelated blurred draft λ");assert.equal(find(row("opaque").valueEl,node=>node.dataset.propertyStructuredEdit===JSON.stringify(leafPath("empty"))).disabled,true);assert.equal(reads,0);assert.deepEqual(f.writes,[]);
 }finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

const operationButton=(f,kind,path)=>find(f.row().valueEl,node=>node.dataset[kind==="add"?"propertyStructuredAdd":"propertyStructuredRemove"]===JSON.stringify(path));
const openOperation=(f,kind,path)=>{const button=operationButton(f,kind,path);assert.ok(button,`${kind} ${JSON.stringify(path)} available`);button.fire("click");return control(f,kind==="add"?"propertyStructuredPosition":"propertyStructuredRemovalReview");};
const setOperationType=(f,kind,value)=>{const type=control(f,"propertyStructuredType");type.value=kind;type.fire("change");const input=control(f,"propertyStructuredInput");if(value!==undefined){input.value=value;input.fire("input");}return input;};

test("actual reviewed map addition keeps an empty text scalar explicit and adds one shared isolated Undo step",async()=>{
 await withRow(fixture(),"opaque",async f=>{
  const key=openOperation(f,"add",["branch"]);key.value="added λ";key.fire("input");
  assert.match(control(f,"propertyStructuredPreview").textContent,/\["opaque","branch","added λ"\]/);assert.match(control(f,"propertyStructuredPreview").textContent,/"added λ": ""/);
  key.blur();await f.settle();assert.deepEqual(f.writes,[]);applyNested(f);await f.settle();
  const expected=original.replace("anchored:",'    "added λ": ""\r\nanchored:');assert.equal(f.editor.getValue(),expected);assert.equal(f.writes.length,1);assert.equal(undoDepth(f.cm.state),1);
  assert.equal(control(f,"propertyStructuredPosition"),null);f.editor.undo();assert.equal(f.editor.getValue(),original);f.editor.redo();assert.equal(f.editor.getValue(),expected);
 });
});

test("actual list insertion and append use a reviewed explicit index and selected null/boolean/number scalar type",async()=>{
 for(const[index,kind,text,value]of[[0,"null",undefined,null],[2,"boolean","true",true],[4,"number","-0",-0]]){
  await withRow(fixture(),"opaque",async f=>{const position=openOperation(f,"add",["branch","mixed"]);assert.equal(position.value,"4");position.value=String(index);position.fire("input");setOperationType(f,kind,text);assert.deepEqual(f.writes,[]);applyNested(f);await f.settle();assert.ok(Object.is(values(f).opaque.branch.mixed[index],value));assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),original);});
 }
});

test("actual removal is a complete literal review until Apply; Cancel and retired controls cannot delete",async()=>{
 await withRow(fixture(),"opaque",async f=>{
  const review=openOperation(f,"remove",["branch","mixed",3]),apply=control(f,"propertyStructuredApply");assert.equal(review.readOnly,true);assert.match(review.value,/\["opaque","branch","mixed",3\]/);assert.match(review.value,/\{"child": "value"\}/);assert.deepEqual(f.writes,[]);
  control(f,"propertyStructuredCancel").fire("click");apply.fire("click");await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);
  openOperation(f,"remove",["branch","mixed",3]);applyNested(f);await f.settle();assert.deepEqual(values(f).opaque.branch.mixed,["one",2,false]);assert.equal(f.writes.length,1);assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),original);
 });
});

test("actual singleton block removal retains a usable explicit empty map and empty list",async()=>{
 for(const[yaml,path,expected]of[['    only: { child: true } # removed\r\n',["nested","only"],'    {}\r\n'],['    - { child: true } # removed\r\n',["nested",0],'    []\r\n']]){
  const source='---\r\nopaque:\r\n  nested:\r\n'+yaml+'---\r\nbody λ\r\n';await withRow(fixture(source),"opaque",async f=>{openOperation(f,"remove",path);applyNested(f);await f.settle();assert.equal(f.editor.getValue(),source.replace(yaml,expected));const position=openOperation(f,"add",["nested"]);position.value=typeof path[1]==="number"?"0":"new";position.fire("input");setOperationType(f,"boolean","false");applyNested(f);await f.settle();assert.ok(f.editor.getValue().includes("false"));});
 }
});

test("actual key/index collisions, rounded numbers and resource limits remain drafts without IO",async()=>{
 for(const[path,key,kind,text]of[[["branch"],"count","string","x"],[["branch","mixed"],"5","null",undefined],[["branch","mixed"],"01","boolean","true"],[["branch"],"constructor","null",undefined],[["branch"],"new","number","0.10000000000000001"],[["branch"],"new","string","x".repeat(4097)]]){
  const f=fixture();let reads=0;f.beforeRead=()=>{reads++;throw Error("Invalid addition must not read source");};await withRow(f,"opaque",async f=>{const position=openOperation(f,"add",path);position.value=key;position.fire("input");setOperationType(f,kind,text);applyNested(f);await f.settle();assert.ok(errorText(f));assert.equal(reads,0);assert.deepEqual(f.writes,[]);assert.ok(control(f,"propertyStructuredPosition"));control(f,"propertyStructuredCancel").fire("click");});
 }
});

test("forced structural handlers refuse read-only, closed-note and disabled Properties before IO or creating drafts",async()=>{
 for(const configure of[f=>{f.app.vault.readOnly=true},f=>{f.sessions.delete(f.source.path)},f=>{f.app.core.isEnabled=()=>false}]){
  const f=fixture();configure(f);let reads=0;f.beforeRead=()=>{reads++;throw Error("Unavailable structural controls must not read source");};await withRow(f,"opaque",async f=>{for(const[kind,path]of[["add",["branch"]],["remove",["branch","mixed",3]]]){const button=operationButton(f,kind,path);assert.ok(button);button.disabled=false;button.fire("click");assert.equal(control(f,"propertyStructuredPosition"),null);assert.equal(control(f,"propertyStructuredRemovalReview"),null);}await f.settle();assert.equal(reads,0);assert.deepEqual(f.writes,[]);});
 }
});

test("structural drafts never rebase after a descendant/index/source/session/core/pane/owner change",async()=>{
 const mutations=[f=>{f.cm.dispatch({changes:{from:f.cm.state.doc.toString().indexOf("[one, 2"),to:f.cm.state.doc.toString().indexOf("[one, 2")+7,insert:"[one, 8"}})},f=>{f.sessions.delete(f.source.path)},f=>{f.sessions.set(f.source.path,{...f.session})},f=>{f.app.core.isEnabled=()=>false},f=>{f.view.mode="source"},f=>{f.row().containerEl.remove()},f=>{f.app.vault.readOnly=true}];
 for(const change of mutations){for(const kind of["add","remove"]){const f=fixture();let reads=0;f.beforeRead=()=>{reads++;throw Error("Stale structural drafts must not read source");};await withRow(f,"opaque",async f=>{const input=openOperation(f,kind,kind==="add"?["branch","mixed"]:["branch","mixed",3]);if(kind==="add"){input.value="2";input.fire("input");setOperationType(f,"string","Retain this draft λ");}const retained=input.value;change(f);applyNested(f);await f.settle();assert.ok(errorText(f));assert.equal(reads,0);assert.deepEqual(f.writes,[]);assert.equal(input.value,retained);assert.ok(control(f,kind==="add"?"propertyStructuredPosition":"propertyStructuredRemovalReview"));control(f,"propertyStructuredCancel").fire("click");});}}
});

test("a newly unsupported removal layout reports a visible refusal instead of throwing from a stale button",async()=>{
 await withRow(fixture(),"opaque",async f=>{const button=operationButton(f,"remove",["branch","mixed",1]),from=f.cm.state.doc.toString().indexOf("[one, 2");f.cm.dispatch({changes:{from:from+6,insert:"# ambiguous separator ownership\r\n      "}});assert.doesNotThrow(()=>button.fire("click"));assert.ok(errorText(f));assert.equal(control(f,"propertyStructuredRemovalReview"),null);assert.deepEqual(f.writes,[]);});
});

test("structural Apply preserves earlier dirty source history and refuses a late queued physical change",async()=>{
 const f=fixture(),extra="Earlier dirty structured body Ω.\r\n";f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:extra}});await withRow(f,"opaque",async f=>{const position=openOperation(f,"add",["branch"]);position.value="added";position.fire("input");setOperationType(f,"null");applyNested(f);await f.settle();assert.equal(undoDepth(f.cm.state),2);assert.equal(f.writes.length,2);f.editor.undo();assert.equal(f.editor.getValue(),original+extra);f.editor.undo();assert.equal(f.editor.getValue(),original);});
 const late=fixture(),gate=deferred();late.beforeReload=()=>gate.promise;await withRow(late,"opaque",async f=>{openOperation(f,"remove",["branch","mixed",3]);applyNested(f);await drain();await drain();assert.equal(control(f,"propertyStructuredApply").disabled,true);assert.equal(control(f,"propertyStructuredCancel").disabled,true);f.disk.set(f.source.path,{text:original.replace("count: 1.50","count: 2.50"),version:900});gate.resolve();await f.settle();assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);assert.ok(errorText(f));assert.ok(control(f,"propertyStructuredRemovalReview"));});
});

test("structural insertion key Escape cancels while composition cannot cancel, and Source-only reasons are visible",async()=>{
 await withRow(fixture(),"opaque",async f=>{const key=openOperation(f,"add",["branch"]);key.value="draft";key.fire("compositionstart");applyNested(f);await f.settle();assert.deepEqual(f.writes,[]);key.fire("keydown",{key:"Escape"});assert.equal(control(f,"propertyStructuredPosition"),key);key.fire("compositionend");key.fire("keydown",{key:"Escape",isComposing:true});assert.equal(control(f,"propertyStructuredPosition"),key);key.fire("keydown",{key:"Escape"});assert.equal(control(f,"propertyStructuredPosition"),null);assert.deepEqual(f.writes,[]);});
 const text='---\r\nopaque:\r\n  multiline: { a: 1, # ambiguous separator ownership\r\n    b: 2 }\r\n---\r\nbody\r\n';await withRow(fixture(text),"opaque",async f=>{assert.equal(operationButton(f,"add",["multiline"]),null);const limit=find(f.row().valueEl,node=>node.dataset.propertyStructuredOperationLimit==='["multiline"]');assert.match(limit.textContent,/Source.*ambiguous comments/);});
});

test("typed scenario completion waits beyond saved bytes and idle until the accepted row retires without replacing Source history",async()=>{
 const {finishNestedPropertyTypeApply}=await import("../tools/nested-property-types-scenarios.mjs");
 const actual=fixture();await withRow(actual,"opaque",async f=>{
  const metadata=deferred(),retirement=deferred(),actionDone=deferred(),trace={calls:[]};
  actual.onRefresh=()=>metadata.promise;
  const frontmatter=f.app.fileManager.processFrontMatter;
  f.app.fileManager.processFrontMatter=async function(...args){const call={path:args[0].path,settled:false};trace.calls.push(call);try{return await frontmatter.apply(this,args)}finally{call.settled=true}};
  const run=f.app.core.run;f.app.core.run=async action=>{await run(action);actionDone.resolve();await retirement.promise};
  f.app.core.whenIdle=()=>actionDone.promise;f.app.workspace.whenIdle=async()=>{};
  f.app.plugins={modules:{"@codemirror/commands":{historyField,undoDepth,redoDepth}}};
  const panel=f.app.workspace.leaves()[0],root={isConnected:true,querySelector:()=>f.row().containerEl};
  panel.pinned=true;panel.parent={id:"same-parent"};f.view.session=f.session;f.view.metadataEditor={contentEl:root};f.view.getState=()=>({file:f.source.path,mode:f.view.getEditingMode()});
  const context=createContext({app:f.app,nestedPropertyTypesTrace:trace,document:{querySelector:selector=>selector==='[data-nested-property-types-root="true"]'?root:selector.includes('data-property-structured-type')?control(f,"propertyStructuredType"):null}});
  const wakeups=[],tools={evaluate:expression=>Promise.resolve(runInContext(expression,context)),wait:async expression=>{while(!await tools.evaluate(expression)){const gate=deferred();wakeups.push(gate);await gate.promise}}};
  const wake=()=>{for(const gate of wakeups.splice(0))gate.resolve()};
  openNested(f,leafPath("empty"));selectNestedType(f,"string").value="null";const oldRow=f.row().containerEl;applyNested(f);await f.settle();
  const expected=original.replace("empty: null",'empty: "null"'),physical=f.bytes(f.source.path),peer=f.bytes(f.target.path),state=f.cm.state,saved=f.session.document;
  assert.equal(f.session.text,expected);assert.equal(f.session.dirty,false);assert.equal(f.session.isSaving,false);assert.deepEqual(physical,Buffer.from("\ufeff"+expected));assert.equal(trace.calls[0].settled,false);
  let completed=false,failure,proof;const completion=finishNestedPropertyTypeApply(tools,f.source.path).then(value=>{completed=true;proof=value},error=>{completed=true;failure=error});
  await drain();assert.equal(failure,undefined);assert.equal(completed,false);assert.equal(context.nestedPropertyTypesApplyOwner.receipt.phase,"mutation");
  metadata.resolve();await f.settle();wake();await f.settle();
  assert.equal(trace.calls[0].settled,true);assert.equal(context.nestedPropertyTypesApplyOwner.receipt.phase,"row");assert.equal(completed,false,"Core idle and exact saved bytes do not retire the accepted draft");assert.equal(f.row().containerEl,oldRow);assert.ok(control(f,"propertyStructuredType"));
  retirement.resolve();await f.settle();wake();await completion;
  assert.equal(failure,undefined);assert.equal(completed,true);assert.ok(Object.values(proof).every(value=>value===true));assert.notEqual(f.row().containerEl,oldRow);assert.equal(control(f,"propertyStructuredType"),null);
  assert.equal(f.app.workspace.leaves()[0],panel);assert.equal(panel.view,f.view);assert.equal(f.view.editor,f.editor);assert.equal(f.editor.cm,f.cm);assert.equal(f.cm.state,state);assert.equal(f.cm.state.doc,state.doc);assert.equal(f.cm.state.field(historyField),state.field(historyField));assert.equal(f.cm.state.selection,state.selection);assert.equal(f.session.document,saved);assert.equal(f.sessions.get(f.source.path),f.session);assert.equal(f.session.text,expected);
  assert.deepEqual(f.bytes(f.source.path),physical);assert.deepEqual(f.bytes(f.target.path),peer);assert.equal(f.writes.length,1);assert.equal(undoDepth(f.cm.state),1);assert.equal(redoDepth(f.cm.state),0);
 });
});

// Transfer coverage uses this module's real row, FileManager queue and CM Undo.
const transferButton=(f,kind,path)=>find(f.row().valueEl,node=>node.dataset[kind==="duplicate"?"propertyStructuredDuplicate":kind==="copy-to"?"propertyStructuredCopyTo":"propertyStructuredMoveInto"]===JSON.stringify(path));
function openTransfer(f,kind,path,destination,key){const button=transferButton(f,kind,path);assert.ok(button,`${kind} ${JSON.stringify(path)} available`);button.fire("click");const select=control(f,"propertyStructuredTransferDestination"),input=control(f,"propertyStructuredTransferKey");assert.ok(select&&input,errorText(f));if(destination){select.value=JSON.stringify(destination);select.fire("change");}if(key!==undefined){input.value=String(key);input.fire("input");}return input;}

test("actual Duplicate, Copy to and Move into keep exact source until Apply and use one ordinary shared Undo",async()=>{
 for(const[kind,path,destination,key,expected]of[
  ["duplicate",["branch","count"],["branch"],"count copy",original.replace("anchored:",'    "count copy": 1.50 # exact number\r\nanchored:')],
  ["copy-to",["branch","mixed",3],["branch"],"copied λ",original.replace("anchored:",'    "copied λ": { child: value }\r\nanchored:')],
  ["move-into",["branch","mixed",3],["branch"],"moved λ",original.replace(", { child: value }","").replace("anchored:",'    "moved λ": { child: value }\r\nanchored:')]
 ])await withRow(fixture(),"opaque",async f=>{
  const peer=f.bytes(f.target.path),input=openTransfer(f,kind,path,destination,key),held=control(f,"propertyStructuredApply");assert.match(control(f,"propertyStructuredTransferReview").value,/Exact destination replacement/);input.blur();await f.settle();assert.deepEqual(f.writes,[]);control(f,"propertyStructuredCancel").fire("click");held.fire("click");await f.settle();assert.equal(f.editor.getValue(),original);
  openTransfer(f,kind,path,destination,key);applyNested(f);await f.settle();assert.equal(f.editor.getValue(),expected);assert.equal(f.writes.length,1);assert.equal(undoDepth(f.cm.state),1);assert.deepEqual(f.bytes(f.target.path),peer);f.editor.undo();assert.equal(f.editor.getValue(),original);f.editor.redo();assert.equal(f.editor.getValue(),expected);
 });
});

test("transfer Apply preserves earlier dirty Source history and unrelated dirty peer state",async()=>{
 const f=fixture(),suffix="Earlier dirty transfer body Ω.\r\n",peer=EditorState.create({doc:targetOriginal,extensions:[history(),EditorState.lineSeparator.of("\r\n")]});
 const peerDirty=peer.update({changes:{from:peer.doc.length,insert:"Earlier dirty peer λ.\r\n"}}).state,peerSaved=f.documents.get(f.target.path).document,peerSession={text:peerDirty.sliceDoc(),document:peerSaved,dirty:true};f.sessions.set(f.target.path,peerSession);f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:suffix}});
 await withRow(f,"opaque",async f=>{const physical=f.bytes(f.target.path);openTransfer(f,"move-into",["branch","mixed",3],["branch"],"moved Ω");applyNested(f);await f.settle();const expected=original.replace(", { child: value }","").replace("anchored:",'    "moved Ω": { child: value }\r\nanchored:')+suffix;assert.equal(f.editor.getValue(),expected);assert.equal(undoDepth(f.cm.state),2);assert.equal(f.writes.length,2);assert.equal(f.sessions.get(f.target.path),peerSession);assert.equal(peerSession.document,peerSaved);assert.equal(peerSession.text,peerDirty.sliceDoc());assert.equal(peerSession.dirty,true);assert.deepEqual(f.bytes(f.target.path),physical);assert.equal(undoDepth(peerDirty),1);f.editor.undo();assert.equal(f.editor.getValue(),original+suffix);f.editor.undo();assert.equal(f.editor.getValue(),original);});
});

test("transfer handlers refuse read-only, closed-note and disabled Properties before source IO",async()=>{
 for(const configure of[f=>{f.app.vault.readOnly=true},f=>{f.sessions.delete(f.source.path)},f=>{f.app.core.isEnabled=()=>false}]){const f=fixture();configure(f);let reads=0;f.beforeRead=()=>{reads++;throw Error("Unavailable transfer must not read Source")};await withRow(f,"opaque",async f=>{for(const kind of["duplicate","copy-to","move-into"]){const button=transferButton(f,kind,["branch","mixed",3]);assert.ok(button);button.disabled=false;button.fire("click");assert.equal(control(f,"propertyStructuredTransferKey"),null);}await f.settle();assert.equal(reads,0);assert.deepEqual(f.writes,[]);});}
});

test("held transfer reviews retain drafts while source/session/type/pane/core/read-only changes refuse before IO",async()=>{
 for(const change of[f=>{f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:"Later source Ω.\r\n"}})},f=>{f.sessions.delete(f.source.path)},f=>{f.sessions.set(f.source.path,{...f.session})},f=>{f.app.core.isEnabled=()=>false},f=>{f.state.widget="text"},f=>{f.view.mode="source"},f=>{f.row().containerEl.remove()},f=>{f.app.vault.readOnly=true}]){const f=fixture();let reads=0;f.beforeRead=()=>{reads++;throw Error("Stale transfer must not read Source")};await withRow(f,"opaque",async f=>{const key=openTransfer(f,"copy-to",["branch","mixed",3],["branch"],"retained draft λ"),review=control(f,"propertyStructuredTransferReview").value;change(f);applyNested(f);await f.settle();assert.ok(errorText(f));assert.equal(reads,0);assert.deepEqual(f.writes,[]);assert.equal(key.value,"retained draft λ");assert.equal(control(f,"propertyStructuredTransferReview").value,review);control(f,"propertyStructuredCancel").fire("click");});}
});

test("late physical source changes refuse a pending atomic transfer without creating an Undo step",async()=>{
 const f=fixture(),gate=deferred();f.beforeReload=()=>gate.promise;await withRow(f,"opaque",async f=>{openTransfer(f,"move-into",["branch","mixed",3],["branch"],"moved λ");applyNested(f);await drain();await drain();for(const key of["propertyStructuredTransferDestination","propertyStructuredTransferKey","propertyStructuredApply","propertyStructuredCancel"])assert.equal(control(f,key).disabled,true);f.disk.set(f.source.path,{text:original.replace("count: 1.50","count: 2.50"),version:900});gate.resolve();await f.settle();assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);assert.match(errorText(f),/changed/);assert.ok(control(f,"propertyStructuredTransferKey"));});
});

// Cross-property tests reuse the unchanged real row/queue/source-disk fixture.
const crossPropertySource=original.replace("anchored:","receiving:\r\n  target:\r\n    deep:\r\n      existing: true # exact destination\r\n  list:\r\n    - retained # exact list\r\nanchored:");
const crossPropertyFixture=()=>{const f=fixture(crossPropertySource);f.registry={};f.app.configuration={get:()=>f.registry};return f;};
function openCrossProperty(f,kind,path,property,destination,key){const button=find(f.row().valueEl,node=>node.dataset[kind==="copy-to-property"?"propertyStructuredCopyToProperty":"propertyStructuredMoveToProperty"]===JSON.stringify(path));assert.ok(button,`${kind} ${JSON.stringify(path)} offered`);button.fire("click");const other=control(f,"propertyStructuredCrossProperty"),target=control(f,"propertyStructuredCrossDestination"),input=control(f,"propertyStructuredCrossKey");assert.ok(other&&target&&input,errorText(f));other.value=property;other.fire("change");target.value=JSON.stringify(destination);target.fire("change");input.value=String(key);input.fire("input");return input;}

test("actual other-property controller Cancel then Copy/Move Apply uses one ordinary queue and one shared Undo for both roots",async()=>{
 for(const[kind,path,destination,key,expected]of[
  ["copy-to-property",["branch","mixed",3],["target","deep"],"copied λ",crossPropertySource.replace("  list:",'      "copied λ": { child: value }\r\n  list:')],
  ["move-to-property",["branch","count"],["list"],1,crossPropertySource.replace("    count: 1.50 # exact number\r\n","").replace("anchored:","    - 1.50 # exact number\r\nanchored:")]
 ])await withRow(crossPropertyFixture(),"opaque",async f=>{let queues=0;const process=f.app.fileManager.processFrontMatter;f.app.fileManager.processFrontMatter=function(...args){queues++;return process.apply(this,args)};const peer=f.bytes(f.target.path),keyInput=openCrossProperty(f,kind,path,"receiving",destination,key),review=control(f,"propertyStructuredCrossReview");assert.match(review.value,/Destination property: "receiving"/);assert.equal(review.value.includes("\r"),false);assert.equal(queues,0);keyInput.blur();await f.settle();control(f,"propertyStructuredCancel").fire("click");assert.equal(f.editor.getValue(),crossPropertySource);assert.equal(queues,0);openCrossProperty(f,kind,path,"receiving",destination,key);applyNested(f);await f.settle();assert.equal(f.editor.getValue(),expected);assert.equal(queues,1);assert.equal(f.writes.length,1);assert.equal(undoDepth(f.cm.state),1);assert.deepEqual(f.bytes(f.target.path),peer);assert.equal(control(f,"propertyStructuredCrossKey"),null);f.editor.undo();assert.equal(f.editor.getValue(),crossPropertySource);f.editor.redo();assert.equal(f.editor.getValue(),expected);});
});

test("actual held cross-property reviews refuse destination-only edits, either type, registry, provider and pane drift before I/O",async()=>{
 for(const change of[f=>{const from=f.cm.state.doc.toString().indexOf("existing: true")+"existing: ".length;f.cm.dispatch({changes:{from,to:from+4,insert:"false"}})},f=>{f.app.metadataTypeManager.getAssignedWidget=name=>name==="receiving"?"text":null},f=>{f.app.metadataTypeManager.getAssignedWidget=name=>name==="opaque"?"text":null;f.state.widget="text"},f=>{f.registry.receiving="text"},f=>{f.app.vault.readOnly=true},f=>{f.app.vault.rootPath="different-provider"},f=>{f.app.workspace.getLeafById=()=>null}]){const f=crossPropertyFixture();let reads=0,queues=0;f.beforeRead=()=>{reads++;throw Error("Revoked cross-property review must not read Source")};const process=f.app.fileManager.processFrontMatter;f.app.fileManager.processFrontMatter=function(...args){queues++;return process.apply(this,args)};await withRow(f,"opaque",async f=>{const input=openCrossProperty(f,"move-to-property",["branch","mixed",3],"receiving",["target","deep"],"held Ω"),review=control(f,"propertyStructuredCrossReview").value;change(f);applyNested(f);await f.settle();assert.ok(errorText(f));assert.equal(reads,0);assert.equal(queues,0);assert.deepEqual(f.writes,[]);assert.equal(input.value,"held Ω");assert.equal(control(f,"propertyStructuredCrossReview").value,review);control(f,"propertyStructuredCancel").fire("click");});}
});

test("actual cross-property pending transfer locks both destinations and refuses late physical version drift before transaction",async()=>{
 const f=crossPropertyFixture(),gate=deferred();f.beforeReload=()=>gate.promise;await withRow(f,"opaque",async f=>{openCrossProperty(f,"move-to-property",["branch","count"],"receiving",["list"],1);applyNested(f);await drain();await drain();for(const name of["propertyStructuredCrossProperty","propertyStructuredCrossDestination","propertyStructuredCrossKey","propertyStructuredApply","propertyStructuredCancel"])assert.equal(control(f,name).disabled,true);f.disk.set(f.source.path,{text:crossPropertySource,version:901});gate.resolve();await f.settle();assert.equal(f.editor.getValue(),crossPropertySource);assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);assert.match(errorText(f),/physical source version changed/);assert.ok(control(f,"propertyStructuredCrossKey"));control(f,"propertyStructuredCancel").fire("click");});
});

test("actual MetadataEditor refreshes both transferred roots while its new controller uses one real queue and Undo",async()=>{
 const f=crossPropertyFixture(),dom=fakeDocument(),keys=["document","HTMLInputElement","HTMLAnchorElement","CSS","propertyHeadingNotices","propertyHeadingReported"],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));Object.assign(globalThis,{document:dom.document,HTMLInputElement:dom.Input,HTMLAnchorElement:dom.Anchor,CSS:{escape:String},propertyHeadingNotices:[],propertyHeadingReported:[]});const owner={id:"cross-property-metadata-owner",view:f.view};f.view.containerEl=dom.container;f.app.workspace.leaves=()=>[owner];f.app.workspace.getLeafById=id=>id===owner.id?owner:null;
 const metadata=new MetadataEditor(new Properties(f.app),()=>f.source);dom.container.append(metadata.contentEl);const rendered=name=>metadata.rendered.find(row=>row.entry.key===name),handle={...f,row:()=>rendered("opaque")};let queues=0;const process=f.app.fileManager.processFrontMatter;f.app.fileManager.processFrontMatter=function(...args){queues++;return process.apply(this,args)};
 try{metadata.render();const previousSource=rendered("opaque"),previousDestination=rendered("receiving");openCrossProperty(handle,"move-to-property",["branch","count"],"receiving",["list"],1);applyNested(handle);for(let index=0;index<12;index++)await drain();const expected=crossPropertySource.replace("    count: 1.50 # exact number\r\n","").replace("anchored:","    - 1.50 # exact number\r\nanchored:");assert.equal(f.editor.getValue(),expected);assert.equal(queues,1);assert.equal(f.writes.length,1);assert.notEqual(rendered("opaque"),previousSource);assert.notEqual(rendered("receiving"),previousDestination);assert.equal(Object.hasOwn(rendered("opaque").entry.value.branch,"count"),false);assert.equal(rendered("receiving").entry.value.list[1],1.5);assert.equal(undoDepth(f.cm.state),1);f.editor.undo();metadata.render();assert.equal(f.editor.getValue(),crossPropertySource);assert.equal(rendered("opaque").entry.value.branch.count,1.5);assert.deepEqual(rendered("receiving").entry.value.list,["retained"]);f.editor.redo();metadata.render();assert.equal(f.editor.getValue(),expected);assert.equal(rendered("receiving").entry.value.list[1],1.5);}
 finally{for(const row of metadata.rendered)row.cleanup?.();for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

