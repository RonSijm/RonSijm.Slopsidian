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
    commit: async (value, guard, transform) => { assert.equal(app.workspace.isChangingFiles, false); const prior = parseMarkdown(choice.sourceText).frontmatter[choice.property], next = choice.widget === "multitext" ? [...choice.existing, value] : value; await properties.changeValue(source, choice.property, prior, next, choice.widget, guard, transform); return true; }, kept: path => kept.push(path), acknowledgedFailure: issue => reported.push(issue), ...extra });
  f.bytes = path => Buffer.from("\ufeff" + disk.get(path).text);
  return f;
}

function fakeDocument() {
  const document = { defaultView: { AbortController }, activeElement: null, getElementById: () => null, createElement: tag => tag === "input" ? new Input(tag) : tag === "a" ? new Anchor(tag) : new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), createTextNode: text => Object.assign(new Element("#text"), { textContent: text }) };
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
  class Input extends Element { select(){this.selectionStart=0;this.selectionEnd=this.value.length;} }
  class Anchor extends Element {}
  const container = new Element("div"); container.connected = true;
  return { document, container, Input, Element, Anchor };
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

test("same-note local and explicit-name heading chains offer one guarded combined edit",async()=>{
  for(const query of [selfQuery,"[[Source#Source λ#New parent λ#Leaf Ω"])for(const property of ["status","labels"]){
    const f=fixture(),choice=f.choice(query,property==="labels"?"multitext":"text",property,property==="labels"?["kept"]:[]);assert.ok(choice);assert.equal(choice.target,f.source);
    f.app.fileManager.assignMarkdownSubpath=()=>{throw Error("A same-note heading must not use a target host write");};
    const link=choice.value,expected=property==="labels"?selfBody.replace("labels: [ kept ]","labels: [ kept, "+JSON.stringify(link)+" ]"):selfBody.replace("status: Open #","status: "+JSON.stringify(link)+" #");
    assert.equal(await f.accept(choice),true);assert.deepEqual(f.writes,[{path:f.source.path,text:expected}]);assert.equal(f.editor.getValue(),expected);assert.equal(undoDepth(f.cm.state),1);
    const cache=parseMarkdown(expected);assert.ok(resolveSubpath(cache,"#Source λ#New parent λ#Leaf Ω"));assert.equal(cache.headings.at(-1).level,3);
    assert.deepEqual(f.bytes(f.source.path),Buffer.from("\ufeff"+expected));assert.equal(f.disk.get(f.target.path).text,targetOriginal);assert.deepEqual(f.kept,[]);
    f.editor.undo();assert.equal(f.editor.getValue(),original);assert.equal(undoDepth(f.cm.state),0);f.editor.redo();assert.equal(f.editor.getValue(),expected);
  }
});

test("same-note creation derives offsets after final YAML growth and preserves mixed Setext/ATX bytes",async()=>{
  const f=fixture(),text=original.replace("# Source λ","Source λ\r\n  ====")+"\r\n  # Sibling Ω\r\nBody.\r\n";
  f.disk.set(f.source.path,{text,version:99});f.index(f.source);f.session.document=f.documents.get(f.source.path).document;f.cm.state=EditorState.create({doc:text,extensions:[history(),EditorState.lineSeparator.of("\r\n"),EditorView.editable.of(true)]});f.session.text=text;
  const choice=f.choice(selfQuery);assert.ok(choice);assert.equal(await f.accept(choice),true);const updated=f.editor.getValue();
  assert.equal(updated,text.replace("status: Open #","status: "+JSON.stringify(choice.value)+" #").replace("  # Sibling Ω","## New parent λ\r\n\r\n### Leaf Ω\r\n\r\n  # Sibling Ω"));
  assert.ok(resolveSubpath(parseMarkdown(updated),"#Source λ#New parent λ#Leaf Ω"));assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),text);
});

test("a dirty same-note source retains previous history while one Undo removes only its link and new headings",async()=>{
  const f=fixture(),extra="Unrelated unsaved source Ω\r\n";f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:extra}});assert.equal(f.session.dirty,true);const choice=f.choice(selfQuery);assert.ok(choice);
  assert.equal(await f.accept(choice),true);assert.equal(undoDepth(f.cm.state),2);assert.equal(f.writes.length,2);assert.equal(f.writes[0].text,original+extra);
  f.editor.undo();assert.equal(f.editor.getValue(),original+extra);f.editor.undo();assert.equal(f.editor.getValue(),original);
});

test("held same-note choices refuse changed owner, session, property type, preferences and source",async()=>{
  for(const change of [f=>{f.state.owned=false},f=>{f.sessions.set(f.source.path,{...f.session})},f=>{f.state.widget="number"},f=>{f.config.set("newLinkFormat","absolute")},f=>{f.cm.dispatch({changes:{from:f.cm.state.doc.length,insert:"Late source\r\n"}})}]){
    const f=fixture(),choice=f.choice(selfQuery);change(f);await assert.rejects(f.accept(choice),/changed/);assert.deepEqual(f.writes,[]);assert.equal(parseMarkdown(f.editor.getValue()).headings.length,1);assert.deepEqual(f.kept,[]);
  }
});

test("same-note queue rechecks source after asynchronous save and physical reload before any combined transaction",async()=>{
  const changed=fixture(),choice=changed.choice(selfQuery);changed.beforeSave=()=>{changed.cm.dispatch({changes:{from:changed.cm.state.doc.length,insert:"Changed during source save\r\n"}});};
  await assert.rejects(changed.accept(choice),/changed/);assert.ok(changed.editor.getValue().endsWith("Changed during source save\r\n"));assert.equal(parseMarkdown(changed.editor.getValue()).headings.length,1);
  const physical=fixture(),review=physical.choice(selfQuery),external=original+"Physical source addition\r\n";physical.beforeReload=()=>{physical.disk.set(physical.source.path,{text:external,version:90});};
  await assert.rejects(physical.accept(review),/changed/);assert.equal(physical.editor.getValue(),external);assert.equal(physical.disk.get(physical.source.path).text,external);assert.deepEqual(physical.writes,[]);
});

test("same-note save failure retains exactly one dirty combined Undo without a misleading cross-note retained-target Notice",async()=>{
  const f=fixture(),choice=f.choice(selfQuery);f.beforeSave=()=>{if(f.session.text!==original)throw Error("Combined source save failed");};
  await assert.rejects(f.accept(choice),/Combined source save failed/);assert.equal(f.session.dirty,true);assert.equal(undoDepth(f.cm.state),1);assert.ok(resolveSubpath(parseMarkdown(f.editor.getValue()),"#Source λ#New parent λ#Leaf Ω"));
  assert.equal(parseMarkdown(f.editor.getValue()).frontmatter.status,choice.value);assert.deepEqual(f.writes,[]);assert.deepEqual(f.kept,[]);f.editor.undo();assert.equal(f.editor.getValue(),original);
});

test("same-note guards decline unsafe/known/duplicate/oversized and unsupported widget authoring",()=>{
  const f=fixture();for(const query of ["[[#Source λ","[[#Source λ#<Unsafe>","[[#^block","[[#Source λ#"+"x".repeat(257)])assert.equal(f.choice(query),null);
  for(const widget of ["aliases","tags","date","number"])assert.equal(f.choice(selfQuery,widget),null);
  assert.equal(f.choice(selfQuery,"multitext","labels",["[[#source λ#new parent λ#leaf Ω]]"]),null);
  f.app.vault.readOnly=true;assert.equal(f.choice(selfQuery),null);
});

test("the shared frontmatter source transform rejects async/nontext results before one transaction",async()=>{
  for(const transform of [()=>({then:done=>done("unsupported")}),()=>undefined]){
    const f=fixture();await assert.rejects(f.app.fileManager.processFrontMatter(f.source,values=>{values.status="Changed"},undefined,undefined,transform),/transform must/);assert.equal(f.editor.getValue(),original);assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);
  }
});

test("ordinary list replacement preserves order and refuses duplicate, invalid and stale members",()=>{
  assert.deepEqual(feature.replacePropertyListValue(["first","second","last"],1,"[[Target#Parent|Visible λ]]"),["first","[[Target#Parent|Visible λ]]","last"]);
  for(const[index,value]of [[-1,"new"],[3,"new"],[1,"first"],[1,""],[1," padded "],[1,"two\nlines"],[1,"x".repeat(1025)]])assert.throws(()=>feature.replacePropertyListValue(["first","second","last"],index,value));
});

test("whole existing wiki values navigate unique current heading/block/self/alias targets without mutation",()=>{
  const f=fixture(),values=["[[Target#Parent|Visible λ]]","[[#Source λ]]","[[Target#^block]]"];
  const target=targetOriginal+"\r\nParagraph text ^block\r\n",source=original.replace("labels: [ kept ]","labels: "+JSON.stringify(values));
  f.disk.set(f.target.path,{text:target,version:99});f.index(f.target);f.session.text=source;f.cm.state=EditorState.create({doc:source,extensions:[history()]});
  for(const[value,index]of values.map((value,index)=>[value,index])){const choice=feature.propertyWikiValue(f.app,f.source,"labels",value,index);assert.ok(choice);assert.equal(choice.target,index===1?f.source:f.target);}
  assert.equal(feature.propertyWikiValue(f.app,f.source,"labels",values[0],0).label,"Visible λ");assert.deepEqual(f.writes,[]);
  f.app.vault.readOnly=true;assert.ok(feature.propertyWikiValue(f.app,f.source,"labels",values[0],0));
});

test("wiki controls decline malformed, embedded, stale list, missing/ambiguous and missing subpath values",()=>{
  const f=fixture();
  for(const value of ["[[Missing]]","[[Target#Missing]]","text [[Target]]","![[Target]]","[[Target|alias|extra]]","[[Target|]]","[[Target]] suffix"]){const source=original.replace("status: Open #","status: "+JSON.stringify(value)+" #");f.session.text=source;assert.equal(feature.propertyWikiValue(f.app,f.source,"status",value),null,value);}
  const value="[[Target#Parent]]";f.session.text=original.replace("status: Open #","status: "+JSON.stringify(value)+" #");assert.ok(feature.propertyWikiValue(f.app,f.source,"status",value));assert.equal(feature.propertyWikiValue(f.app,f.source,"status",value,0),null);
  f.add("Other/Target.md",targetOriginal);assert.equal(feature.propertyWikiValue(f.app,f.source,"status",value),null);
});

test("real same-note scalar and list-add rows consume one explicit choice and keep link/headings in one Undo",async()=>{
  for(const property of ["status","labels"])await withRow(fixture(),property,async f=>{
    const input=find(f.row().valueEl,node=>node.tagName==="input");input.focus();input.value=selfQuery;input.fire("input");const button=find(f.row().valueEl,node=>node.dataset.propertyCreateHeading===f.source.path);assert.ok(button);assert.match(button.title,/Undo removes the link and new headings together/);button.fire("click");await f.settle();
    assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,f.source.path);assert.equal(undoDepth(f.cm.state),1);assert.equal(f.refreshed(),1);input.fire("blur");await f.settle();assert.equal(f.writes.length,1);f.editor.undo();assert.equal(f.editor.getValue(),original);assert.deepEqual(globalThis.propertyHeadingNotices,[]);
  });
});

test("real list editor supports guarded suggestion replacement, duplicate errors and Escape cancellation",async()=>{
  const f=fixture();f.add("Contributes.md",'---\nlabels: [Candidate]\n---\nBody.\n');
  await withRow(f,"labels",async f=>{
    find(f.row().valueEl,node=>node.dataset.propertyEditValue==="0").fire("click");let input=find(f.row().valueEl,node=>node.dataset.propertyEditIndex==="0");assert.ok(input);input.value="Cancelled";input.fire("keydown",{key:"Escape"});assert.equal(find(f.row().valueEl,node=>node.dataset.propertyEditIndex==="0"),null);assert.deepEqual(f.writes,[]);
    find(f.row().valueEl,node=>node.dataset.propertyEditValue==="0").fire("click");input=find(f.row().valueEl,node=>node.dataset.propertyEditIndex==="0");input.value="Can";input.fire("input");find(f.row().valueEl,node=>node.dataset.propertyValueChoice==="Candidate").fire("click");await f.settle();assert.deepEqual(parseMarkdown(f.editor.getValue()).frontmatter.labels,["Candidate"]);assert.equal(undoDepth(f.cm.state),1);f.editor.undo();assert.equal(f.editor.getValue(),original);
  });
});

test("a list editor retains a stale draft and original comparison when the property changes externally",async()=>{
  await withRow(fixture(),"labels",async f=>{
    find(f.row().valueEl,node=>node.dataset.propertyEditValue==="0").fire("click");const input=find(f.row().valueEl,node=>node.dataset.propertyEditIndex==="0");input.value="Replace kept";
    const source=f.editor.getValue(),from=source.indexOf("kept");f.editor.replaceExpected(source,from,from+4,"external","input");input.fire("keydown",{key:"Enter"});await f.settle();assert.deepEqual(parseMarkdown(f.editor.getValue()).frontmatter.labels,["external"]);assert.match(f.row().containerEl.querySelector(".metadata-property-error").textContent,/changed/);
  });
});

test("Tab and blur leave an existing list draft unapplied so keyboard Cancel can discard it",async()=>{
  await withRow(fixture(),"labels",async f=>{
    find(f.row().valueEl,node=>node.dataset.propertyEditValue==="0").fire("click");const input=find(f.row().valueEl,node=>node.dataset.propertyEditIndex==="0");input.value="Unapplied keyboard draft λ";
    input.fire("keydown",{key:"Tab"});input.fire("blur");await f.settle();assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);
    const cancel=find(f.row().valueEl,node=>node.dataset.propertyCancelValue==="0");cancel.focus();cancel.fire("click");assert.equal(find(f.row().valueEl,node=>node.dataset.propertyEditIndex==="0"),null);assert.deepEqual(f.writes,[]);assert.equal(f.editor.getValue(),original);
  });
});

test("unchanged Apply retains an existing list member's exact surrounding whitespace",async()=>{
  const f=fixture(),text=original.replace("labels: [ kept ]",'labels: [ " kept " ]');f.session.text=text;f.disk.set(f.source.path,{text,version:99});f.index(f.source);f.session.document=f.documents.get(f.source.path).document;f.cm.state=EditorState.create({doc:text,extensions:[history(),EditorState.lineSeparator.of("\r\n"),EditorView.editable.of(true)]});
  await withRow(f,"labels",async f=>{find(f.row().valueEl,node=>node.dataset.propertyEditValue==="0").fire("click");const input=find(f.row().valueEl,node=>node.dataset.propertyEditIndex==="0");assert.equal(input.value," kept ");find(f.row().valueEl,node=>node.dataset.propertyApplyValue==="0").fire("click");await f.settle();assert.equal(f.editor.getValue(),text);assert.deepEqual(f.writes,[]);assert.equal(undoDepth(f.cm.state),0);});
});

test("an existing wiki control accepts a current target-body edit but refuses a removed destination",async()=>{
  const f=fixture(),value="[[Target#Parent]]",text=original.replace("status: Open #","status: "+JSON.stringify(value)+" #");f.session.text=text;f.cm.state=EditorState.create({doc:text,extensions:[history()]});const opened=[];f.app.workspace.openLinkText=(...args)=>opened.push(args);
  await withRow(f,"status",async f=>{const anchor=find(f.row().valueEl,node=>node.dataset.propertyWikiValue===value);assert.ok(anchor);f.disk.set(f.target.path,{text:targetOriginal+"New unrelated target body Ω\r\n",version:99});f.index(f.target);anchor.fire("click",{button:0});await f.settle();assert.deepEqual(opened,[[f.target.path+"#Parent",f.source.path,false]]);assert.deepEqual(f.writes,[]);
    f.disk.set(f.target.path,{text:targetOriginal.replace("# Parent","# Replaced parent"),version:100});f.index(f.target);anchor.fire("click",{button:0});await f.settle();assert.equal(opened.length,1);assert.match(f.row().containerEl.querySelector(".metadata-property-error").textContent,/destination changed/);
  });
});

test("read-only rows keep existing wiki navigation while list mutation controls and authoring stay disabled",async()=>{
  const f=fixture(),value="[[Target#Parent|Known target]]";f.session.text=original.replace("labels: [ kept ]","labels: "+JSON.stringify([value]));f.cm.state=EditorState.create({doc:f.session.text,extensions:[history()]});f.app.vault.readOnly=true;const opened=[];f.app.workspace.openLinkText=(...args)=>opened.push(args);
  await withRow(f,"labels",async f=>{const anchor=find(f.row().valueEl,node=>node.dataset.propertyWikiValue===value);assert.ok(anchor);assert.match(anchor.className,/internal-link metadata-property-link multi-select-pill-content/);assert.equal(find(f.row().valueEl,node=>node.dataset.propertyEditValue==="0").disabled,true);anchor.fire("click",{button:0,ctrlKey:true});await f.settle();assert.deepEqual(opened,[[f.target.path+"#Parent",f.source.path,"tab"]]);assert.deepEqual(f.writes,[]);});
});

test("stored link availability invalidates a reused row after indexing, destination removal or replacement",async()=>{
  const f=fixture(),value="[[Target#Parent|Known target]]",text=original.replace("status: Open #","status: "+JSON.stringify(value)+" #");
  f.session.text=text;f.cm.state=EditorState.create({doc:text,extensions:[history()]});f.app.vault.readOnly=true;f.documents.delete(f.target.path);
  await withRow(f,"status",async f=>{
    assert.equal(find(f.row().valueEl,node=>node.dataset.propertyWikiValue===value),null);assert.equal(f.row().linksCurrent(),true);
    f.index(f.target);assert.equal(f.row().linksCurrent(),false);f.render();assert.ok(find(f.row().valueEl,node=>node.dataset.propertyWikiValue===value));assert.equal(f.row().linksCurrent(),true);
    f.disk.set(f.target.path,{text:targetOriginal+"Unrelated body Ω\r\n",version:99});f.index(f.target);assert.equal(f.row().linksCurrent(),true,"a body edit keeps the existing control and draft owner");
    f.disk.set(f.target.path,{text:targetOriginal.replace("# Parent","# Removed parent"),version:100});f.index(f.target);assert.equal(f.row().linksCurrent(),false);f.render();assert.equal(find(f.row().valueEl,node=>node.dataset.propertyWikiValue===value),null);
    f.disk.set(f.target.path,{text:targetOriginal,version:101});f.index(f.target);assert.equal(f.row().linksCurrent(),false);f.render();
    f.add(f.target.path,targetOriginal);assert.equal(f.row().linksCurrent(),false,"replacement identity cannot inherit a stale control");assert.deepEqual(f.writes,[]);
  });
});

test("a target acknowledgement retains its unfocused accepted creator until the guarded property queue finishes",async()=>{
  const f=fixture(),value="[[Target#Parent#Create during retained link λ]]",text=original.replace("status: Open #","status: "+JSON.stringify(value)+" #");
  f.session.text=text;f.disk.set(f.source.path,{text,version:99});f.index(f.source);f.session.document=f.documents.get(f.source.path).document;f.cm.state=EditorState.create({doc:text,extensions:[history(),EditorState.lineSeparator.of("\r\n"),EditorView.editable.of(true)]});
  await withRow(f,"status",async row=>{
    const previous=row.row(),input=find(previous.valueEl,node=>Object.hasOwn(node.dataset,"metadataInput"));let observed=0;
    f.onRefresh=()=>{if(f.writes.some(write=>write.path===f.target.path)){
      row.dom.document.activeElement=null;input.fire("blur");assert.equal(row.row(),previous);assert.equal(row.row().linksCurrent(),true);observed++;
    }};
    input.focus();input.value=value;input.fire("input");const create=find(previous.valueEl,node=>Object.hasOwn(node.dataset,"propertyCreateHeading"));assert.ok(create);create.fire("click");await row.settle();
    assert.ok(observed>0);assert.deepEqual(f.writes.map(write=>write.path),[f.target.path]);assert.ok(resolveSubpath(parseMarkdown(f.disk.get(f.target.path).text),"#Parent#Create during retained link λ"));
    assert.equal(f.editor.getValue(),text);assert.equal(undoDepth(f.cm.state),0);assert.deepEqual(globalThis.propertyHeadingNotices,[]);assert.equal(row.row().linksCurrent(),true);
  });
});
