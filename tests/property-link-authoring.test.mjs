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
const original = '---\r\n# Preserve comment λ\r\nstatus: Open # keep scalar comment\r\naliases: [ Self alias ]\r\nlabels: [ kept ]\r\ncount: 1.50\r\nopaque: { keep: exact }\r\n---\r\n# Source λ\r\n\r\nUntouched 😀 body.\r\n';
const targetOriginal = '---\r\naliases: [Friendly destination]\r\nopaque: { target: "λ 😀" }\r\n---\r\n# Parent\r\n\r\nExisting parent body Ω.\r\n\r\n# Sibling\r\n\r\nUntouched final body.\r\n';
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


const choices=(f,query,property="status",existing=[])=>feature.propertyValueChoices(f.app,f.source,property,property==="labels"?"multitext":"text",existing,query);
function noteFixture(){
 const f=fixture();f.creates=[];
 Object.assign(f.app.vault,{
  getRoot:()=>({path:"/"}),getFolderByPath:path=>["Source folder","Inbox"].includes(path)?{path}:null,
  getAbstractFileByPathInsensitive:path=>[...f.files.values()].find(file=>file.path.toLowerCase()===path.toLowerCase())??null,
  async create(path,text){await f.beforeCreate?.(path);if(f.files.has(path))throw Error("Create-only collision");const file=f.add(path,text);f.creates.push(file);return file;}
 });
 f.noteChoice=(query="[[Fresh λ|Display Ω",existing=[])=>feature.propertyNoteCreationChoice(f.app,f.source,"status","text",existing,query);
 f.acceptNote=(choice=f.noteChoice(),extra={})=>feature.createPropertyNote(f.app,choice,{widget:"text",existing:[],query:choice.query,current:()=>f.state.owned,
  commit:async(value,guard)=>{await new Properties(f.app).changeValue(f.source,"status",parseMarkdown(choice.sourceText).frontmatter.status,value,"text",guard);return true;},kept:path=>f.kept.push(path),...extra});
 return f;
}

test("whole-field display labels preserve explicit destination proof under every link format",()=>{
 for(const format of["shortest","relative","absolute"]){
  const f=fixture();f.config.set("newLinkFormat",format);
  for(const suffix of["", "]]"]){
   const query="[[Target|Display λ 😀"+suffix,choice=choices(f,query).find(item=>item.target===f.target);
   assert.ok(choice);assert.equal(choice.query,query);assert.equal(choice.displayText,"Display λ 😀");
   assert.equal(choice.value,"[["+choice.linktext+"|Display λ 😀]]");
   feature.assertPropertyValueChoice(f.app,choice,"text",[],query);
  }
 }
});

test("explicit display labels override an alias suggestion without changing its canonical target",()=>{
 const f=fixture(),query="[[Friendly destination|Own display Ω",choice=choices(f,query)[0];
 assert.equal(choice.target,f.target);assert.equal(choice.alias,"Friendly destination");assert.equal(choice.displayText,"Own display Ω");assert.equal(choice.value,"[[Target|Own display Ω]]");
 const unlabelled=choices(f,"[[Friendly destination")[0];assert.equal(unlabelled.value,"[[Target|Friendly destination]]");
});

test("heading and block completion retain explicit labels and exact position proof",()=>{
 const f=fixture();f.add("Block target.md","# Existing λ\r\n\r\nWhole paragraph Ω ^known-block\r\n");
 for(const [query,subpath]of[["[[Block target#Ex|Heading # label","#Existing λ"],["[[Block target#^known|Block ^ label]]","#^known-block"],["[[#Source|Self label","#Source λ"]]){
  const choice=choices(f,query)[0];assert.ok(choice,query);assert.equal(choice.subpath,subpath);assert.ok(choice.value.endsWith("|"+choice.displayText+"]]"));feature.assertPropertyValueChoice(f.app,choice,"text",[],query);
 }
});

test("HTML-looking and punctuation labels are plain value text while destination routing ignores label hashes",()=>{
 const f=fixture(),label='<img src=x> # ^ Ω',choice=choices(f,"[[Target|"+label)[0];
 assert.equal(choice.kind,"link");assert.equal(choice.value,"[[Target|"+label+"]]");
 const query="[[Target#Parent|"+label,section=choices(f,query)[0];assert.equal(section.kind,"subpath");assert.equal(section.displayText,label);
});

test("malformed or incomplete display labels refuse every Properties authoring path",()=>{
 const f=noteFixture();
 for(const suffix of["|","| ","| leading","|trailing ","|one|two","|bad[title","|bad]title","|bad\\title","|line\nnext","|line\rnext","|bad\u0000label","|bad\u007flabel","|bad\u2028label","|bad\u2029label","|bad\ud800label","|"+"x".repeat(257)]){
  assert.deepEqual(choices(f,"[[Target"+suffix),[],suffix);
  assert.equal(f.choice("[[Target#Parent#Child"+suffix),null,suffix);
  assert.equal(f.noteChoice("[[Fresh"+suffix),null,suffix);
 }
 for(const query of["prefix [[Target|Label","[[Target|Label]] suffix","[[Target|Label]]]"])assert.deepEqual(choices(f,query),[]);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.creates,[]);
});

test("list duplicate proof ignores display labels and canonicalizes existing alias values",()=>{
 const f=fixture();
 for(const existing of["[[Target|Old]]","[[Targets/Target|Old]]","[[Friendly destination|Old]]"]){
  assert.deepEqual(choices(f,"[[Target|New","labels",[existing]),[],existing);
  assert.deepEqual(choices(f,"[[Friendly destination|New","labels",[existing]),[],existing);
 }
 for(const existing of["[[Target#Parent|Old]]","[[Friendly destination#Parent|Old]]"]){
  assert.deepEqual(choices(f,"[[Target#Parent|New","labels",[existing]),[],existing);
 }
 for(const existing of["[[Target#Parent#Fresh|Old]]","[[Friendly destination#Parent#Fresh|Old]]"]){
  assert.equal(f.choice("[[Target#Parent#Fresh|New","multitext","labels",[existing]),null,existing);
 }
});

test("a unique alias can explicitly create a labelled heading chain in its canonical target",async()=>{
 for(const format of["shortest","relative","absolute"]){
  const f=fixture();f.config.set("newLinkFormat",format);const query="[[Friendly destination#Parent#Branch λ#Leaf Ω|Visible display 😀",choice=f.choice(query);
  assert.ok(choice);assert.equal(choice.target,f.target);assert.equal(choice.alias,"Friendly destination");assert.equal(choice.displayText,"Visible display 😀");
  assert.equal(choice.value,"[["+choice.linktext+"#Parent#Branch λ#Leaf Ω|Visible display 😀]]");
  assert.equal(await f.accept(choice),true);assert.deepEqual(f.writes.map(write=>write.path),[f.target.path,f.source.path]);
  const target=planHeadingCreation(targetOriginal,choice.heading).text;assert.deepEqual(f.bytes(f.target.path),Buffer.from("\ufeff"+target));
  const expected=original.replace("status: Open #","status: "+JSON.stringify(choice.value)+" #");assert.deepEqual(f.bytes(f.source.path),Buffer.from("\ufeff"+expected));
  assert.equal(undoDepth(f.cm.state),1);f.editor.undo();await f.app.saveAll();assert.equal(f.editor.getValue(),original);assert.deepEqual(f.bytes(f.target.path),Buffer.from("\ufeff"+target));
 }
});

test("an alias-created heading defaults its visible label to the queried alias",()=>{
 const f=fixture(),choice=f.choice("[[Friendly destination#Parent#New leaf Ω");
 assert.equal(choice.value,"[[Target#Parent#New leaf Ω|Friendly destination]]");
});

test("same-note labelled alias creation remains one combined YAML/heading Undo and Redo",async()=>{
 const f=fixture(),choice=f.choice("[[Self alias#Source λ#Child Ω|Local display 😀]]");assert.equal(choice.target,f.source);assert.equal(choice.alias,"Self alias");
 const expected=original.replace("status: Open #","status: "+JSON.stringify(choice.value)+" #")+"\r\n## Child Ω\r\n";
 assert.equal(await f.accept(choice),true);assert.deepEqual(f.writes.map(write=>write.path),[f.source.path]);assert.deepEqual(f.bytes(f.source.path),Buffer.from("\ufeff"+expected));
 assert.equal(undoDepth(f.cm.state),1);f.editor.undo();await f.app.saveAll();assert.equal(f.editor.getValue(),original);f.editor.redo();await f.app.saveAll();assert.equal(f.editor.getValue(),expected);
});

test("empty-path labelled same-note heading chains recompute after YAML growth",async()=>{
 const f=fixture(),choice=f.choice("[[#Source λ#Branch Ω#Leaf 😀|A longer display label λ]]");assert.ok(choice);
 assert.equal(await f.accept(choice),true);assert.equal(parseMarkdown(f.editor.getValue()).frontmatter.status,choice.value);
 const target=resolveSubpath(parseMarkdown(f.editor.getValue()),"#Source λ#Branch Ω#Leaf 😀");assert.equal(target.type,"heading");
 f.editor.undo();await f.app.saveAll();assert.deepEqual(f.bytes(f.source.path),Buffer.from("\ufeff"+original));
});

test("ambiguous, unknown, incomplete or dirty alias targets never acquire a creation action",()=>{
 const f=fixture();f.add("Other.md","---\naliases: [Friendly destination]\n---\n# Parent\n");assert.equal(f.choice("[[Friendly destination#Parent#Fresh|Display"),null);
 const g=fixture();g.documents.delete(g.source.path);assert.equal(g.choice("[[Friendly destination#Parent#Fresh|Display"),null);
 const h=fixture();h.sessions.set(h.target.path,{originRoot:h.app.vault.rootPath,text:targetOriginal.replace("Friendly destination","Changed alias"),dirty:true});assert.equal(h.choice("[[Friendly destination#Parent#Fresh|Display"),null);
 const i=fixture();i.documents.get(i.target.path).cache.frontmatter.aliases=Array(33).fill("Friendly destination");assert.equal(i.choice("[[Friendly destination#Parent#Fresh|Display"),null);
});

test("literal note names keep precedence over equal metadata aliases",()=>{
 const f=fixture(),literal=f.add("Friendly destination.md","# Parent\r\n");const choice=f.choice("[[Friendly destination#Parent#Fresh|Display");
 assert.equal(choice.target,literal);assert.equal(choice.alias,undefined);assert.equal(choice.value,"[[Friendly destination#Parent#Fresh|Display]]");
});

test("a held labelled choice refuses changed label, preference, root or source before writing",async()=>{
 for(const mutate of[f=>{f.state.owned=false;},f=>{f.config.set("newLinkFormat","absolute");},f=>{f.app.vault.readOnly=true;},f=>{f.app.vault.rootPath="other";},f=>{f.session.text+="Changed source";}]){
  const f=fixture(),choice=f.choice("[[Friendly destination#Parent#Fresh|Display");mutate(f);await assert.rejects(f.accept(choice));assert.deepEqual(f.writes,[]);
 }
 const f=fixture(),choice=f.choice("[[Friendly destination#Parent#Fresh|Display");await assert.rejects(f.accept(choice,{query:"[[Friendly destination#Parent#Fresh|Changed display"}));assert.deepEqual(f.writes,[]);
});

test("alias retargeting before the target write declines without a speculative mutation",async()=>{
 const f=fixture(),choice=f.choice("[[Friendly destination#Parent#Fresh|Display");f.beforeSaveAll=()=>f.add("Other.md","---\naliases: [Friendly destination]\n---\n# Parent\n");
 await assert.rejects(f.accept(choice));assert.deepEqual(f.writes,[]);assert.deepEqual(f.kept,[]);
});

test("alias ambiguity appearing after target acknowledgement keeps headings but never inserts stale YAML",async()=>{
 const f=fixture(),choice=f.choice("[[Friendly destination#Parent#Fresh|Display");let changed=false;
 f.onRefresh=()=>{if(!changed&&f.disk.get(f.target.path).text.includes("## Fresh")){changed=true;f.add("Other.md","---\naliases: [Friendly destination]\n---\n# Parent\n");}};
 await assert.rejects(f.accept(choice),/changed|Review/);assert.deepEqual(f.writes.map(write=>write.path),[f.target.path]);assert.equal(f.editor.getValue(),original);assert.deepEqual(f.kept,[f.target.path]);assert.ok(f.disk.get(f.target.path).text.includes("## Fresh"));
});

test("known labelled suggestions revalidate label and alias target association on acceptance",()=>{
 const f=fixture(),query="[[Friendly destination#Parent|Display",choice=choices(f,query)[0];feature.assertPropertyValueChoice(f.app,choice,"text",[],query);
 assert.throws(()=>feature.assertPropertyValueChoice(f.app,choice,"text",[],query.replace("Display","Other")),/changed/);
 f.sessions.set(f.target.path,{originRoot:f.app.vault.rootPath,text:targetOriginal.replace("Friendly destination","Other alias")});assert.throws(()=>feature.assertPropertyValueChoice(f.app,choice,"text",[],query),/changed/);
});

test("labelled Create note preserves placement, canonical link formatting and acknowledged file on source Undo",async()=>{
 for(const location of["root","current","folder"])for(const format of["shortest","relative","absolute"]){
  const f=noteFixture();f.config.set("newFileLocation",location);f.config.set("newFileFolderPath","Inbox");f.config.set("newLinkFormat",format);const choice=f.noteChoice();assert.ok(choice);
  assert.equal(choice.displayText,"Display Ω");assert.equal(choice.query,"[[Fresh λ|Display Ω");assert.equal(await f.acceptNote(choice),true);assert.equal(f.creates.length,1);assert.equal(f.creates[0].path,choice.path);
  const value=parseMarkdown(f.editor.getValue()).frontmatter.status;assert.ok(value.endsWith("|Display Ω]]"));assert.equal(f.disk.get(choice.path).text,"");assert.equal(undoDepth(f.cm.state),1);
  f.editor.undo();await f.app.saveAll();assert.equal(f.editor.getValue(),original);assert.ok(f.files.has(choice.path));assert.deepEqual(f.kept,[]);
 }
});

test("labelled Create note keeps complete existence, alias and semantic duplicate proofs",()=>{
 const f=noteFixture();assert.equal(f.noteChoice("[[Friendly destination|Display"),null);assert.equal(f.noteChoice("[[Target|Display"),null);
 assert.equal(f.noteChoice("[[Fresh λ|Display",["[[Fresh λ|Old]]"]),null);
 f.add("Another.md","---\naliases: [Fresh λ]\n---\n");assert.equal(f.noteChoice(),null);
});

test("labelled Create note refuses changed label before dispatch and keeps an acknowledged file on later owner loss",async()=>{
 const f=noteFixture(),choice=f.noteChoice();await assert.rejects(f.acceptNote(choice,{query:"[[Fresh λ|Other"}));assert.deepEqual(f.creates,[]);
 const g=noteFixture(),selected=g.noteChoice();g.afterLock=()=>{g.state.owned=false;};await assert.rejects(g.acceptNote(selected));assert.equal(g.creates.length,1);assert.equal(g.editor.getValue(),original);assert.deepEqual(g.kept,[selected.path]);
});

test("read-only Properties never offers labelled completion or creation",()=>{
 const f=noteFixture();f.app.vault.readOnly=true;
 assert.deepEqual(choices(f,"[[Target|Display"),[]);assert.deepEqual(choices(f,"[[Friendly destination#Parent|Display"),[]);
 assert.equal(f.choice("[[Friendly destination#Parent#Fresh|Display"),null);assert.equal(f.noteChoice(),null);assert.deepEqual(f.writes,[]);assert.deepEqual(f.creates,[]);
});

test("a changed display payload cannot bypass the reviewed new-note label before or after acknowledgement",async()=>{
 const f=noteFixture(),choice=f.noteChoice();choice.displayText="Unreviewed display";await assert.rejects(f.acceptNote(choice));assert.deepEqual(f.creates,[]);
 const g=noteFixture(),selected=g.noteChoice();g.afterLock=()=>{selected.displayText="Unreviewed display";};await assert.rejects(g.acceptNote(selected));assert.equal(g.creates.length,1);assert.equal(g.editor.getValue(),original);assert.deepEqual(g.kept,[selected.path]);
});
