import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertStructuredHandoffRefusal, structuredPropertyHandoffReadOnlyFixture } from "../tools/structured-property-handoff-scenarios.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));let directory,api;
before(async()=>{
 await mkdir(join(root,".runtime"),{recursive:true});directory=await mkdtemp(join(root,".runtime","properties-handoff-tests-"));
 const output=join(directory,"handoff.mjs");
 await build({stdin:{contents:'export * from "./client/structured-property-handoff";export {structuredPropertyModel,createStructuredEditorInspector} from "./client/structured-properties";export {structuredPropertyOperationTargets,planStructuredPropertyOperation} from "./client/structured-property-operations";export {MetadataTypeManager} from "./client/property-types";export {MetadataCache} from "./client/metadata";export {TFile} from "./client/vault";export {parseMarkdown} from "./client/markdown";export {Events} from "./client/events";export {MarkdownView} from "./client/workspace";export {EditorState} from "@codemirror/state";export {EditorView} from "@codemirror/view";',resolveDir:root,loader:"ts"},outfile:output,bundle:true,platform:"node",format:"esm",packages:"external",logLevel:"silent",plugins:[{name:"pure-workspace",setup(build){build.onResolve({filter:/^(?:\.\/client\/workspace|\.\/workspace)$/},()=>({path:"workspace",namespace:"pure"}));build.onLoad({filter:/.*/,namespace:"pure"},()=>({contents:"export class MarkdownView {}"}));}}]});api=await import(pathToFileURL(output).href);
});
after(async()=>{if(directory){assert.ok(relative(root,directory).startsWith(".runtime"+sep));await rm(directory,{recursive:true});}});
const text="---\r\n# exact λ\r\nopaque:\r\n  map: { key: 1.50, empty: ~ } # retain\r\n  list: [one, 2, false]\r\n  emptyMap: {}\r\nother: Plain\r\n---\r\n# Source 😀\r\n\r\nBody.\r\n";
test("closed-note transfer choices use the same cached exact-target Source authority",async()=>{
 for(const target of[{kind:"duplicate",path:["list",0]},{kind:"copy-to",path:["map","key"]},{kind:"move-into",path:["map","key"]}]){
  const f=fixture(),authority=f.authority(target);assert.ok(authority,target.kind);assert.deepEqual(authority.target,target);assert.equal(f.calls.reads,0);assert.equal(f.calls.allocations,0);const view=await f.open(authority);assert.equal(view.editor.getValue(),text);assert.equal(f.calls.writes,0);assert.equal(f.calls.saves,0);assert.equal(f.calls.reads,2);assert.equal(f.calls.allocations,1);
 }
});
test("whole-property and stale/read-only transfer handoffs refuse before source reads or allocation",async()=>{
 const f=fixture();assert.equal(f.authority({kind:"copy-to",path:[]}),null);assert.equal(f.authority({kind:"move-into",path:["missing"]}),null);const authority=f.authority({kind:"copy-to",path:["map","key"]});assert.ok(authority);f.app.vault.readOnly=true;assert.equal(f.authority({kind:"duplicate",path:["list",0]}),null);await assert.rejects(f.open(authority),/changed/);assert.equal(f.calls.reads,0);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);
});
test("the deliberate UI queue-refusal assertion accepts only its exact owned error and no unrelated failure",()=>{
 const reason="The note or nested property owner changed. Cancel this draft and review the current source before applying it.",owned={expected:true,status:"rejected",reason},other={expected:false,status:"fulfilled",reason:null};
 assert.doesNotThrow(()=>assertStructuredHandoffRefusal([owned,other]));
 for(const outcomes of [[],[other],[{...owned,status:"fulfilled",reason:null}], [{...owned,reason:"Unexpected transport failure"}], [owned,{...other,status:"rejected",reason:"Unrelated task failed"}], [owned,owned]])assert.throws(()=>assertStructuredHandoffRefusal(outcomes));
});
test("the actual full YAML GUI fixture has proven scalar and structural handoff targets",()=>{
 const source=structuredPropertyHandoffReadOnlyFixture.source,value=api.parseMarkdown(source).frontmatter.opaque;
 assert.ok(api.structuredPropertyModel(value,source,"opaque"));
});
test("the real GUI fixture creates closed disabled mutation buttons alongside required Source handoff choices",()=>{
 const source=structuredPropertyHandoffReadOnlyFixture.source,value=api.parseMarkdown(source).frontmatter.opaque,model=api.structuredPropertyModel(value,source,"opaque");
 const make=tag=>({tagName:tag,dataset:{},children:[],append(...children){this.children.push(...children)},setAttribute(){},addEventListener(){},get lastElementChild(){return this.children.at(-1)},insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child)}}),document={createElement:make,createTextNode:text=>({textContent:text})};
 const inspector=api.createStructuredEditorInspector(document,model.entries,"opaque",false,{writable:false,sourceWritable:true,current:()=>true,source(){},edit(){},operations:{...api.structuredPropertyOperationTargets(source,"opaque",value),open(){}}});
 const all=node=>[node,...(node.children??[]).flatMap(all)],nodes=all(inspector);assert.equal(Boolean(inspector.open),false);
 for(const[kind,path]of[["edit",["map","count"]],["edit",["implicit"]],["add",["map"]],["remove",["list",1]],["rename",["map","count"]]]){
  const action=nodes.find(n=>n.dataset?.["propertyStructured"+kind[0].toUpperCase()+kind.slice(1)]===JSON.stringify(path)),handoff=nodes.find(n=>n.dataset?.propertyStructuredSource===JSON.stringify({kind,path}));
  assert.ok(action,kind+" existing control");assert.equal(action.disabled,true);assert.ok(handoff,kind+" explicit Source choice");assert.equal(handoff.disabled,false);
 }
 assert.equal(nodes.some(n=>n.dataset?.propertyStructuredSource===JSON.stringify({kind:"edit",path:["implicit"]})),true);
 const plan=api.planStructuredPropertyOperation(source,"opaque",value,{kind:"add",path:["map"],key:"new λ",value:"001\n😀"});
 assert.equal(plan.source,source.replace("  implicit:",'    "new λ": "001\\n😀"\r\n  implicit:'));
});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function fixture({live=false,dirty=false,main=false,sameGroup=false}={}){
 const calls={reads:0,allocations:0,writes:0,saves:0,observed:0,configWatches:0,docks:0,splits:0},state={owned:true,mode:"preview",readOnly:false,widget:null,typeRegistry:{}},sources=[],events=new api.Events(),types=new api.Events(),watchers=new Set(),configs=new Map();
 const saved={file:{path:"Notes/Source.md"},content:text,hasBom:true,version:"1".repeat(64)},file=new api.TFile(null,{path:saved.file.path,basename:"Source",extension:"md",stat:{size:text.length,mtime:1,ctime:1}}),cache=api.parseMarkdown(text);
 let entry={document:saved,text,cache,missing:false},session=null,disk={...saved},f;
 const rootSplit={},side={},parent={},pane={id:"properties",parent,getRoot:()=>main?rootSplit:side,view:{getViewType:()=>"file-properties",getState:()=>({file:file.path,followActiveFile:false})}};
 const app={changingVault:false,vault:Object.assign(new api.Events(),{rootPath:"local-handoff",readOnly:false,getFileByPath:path=>path===file.path?file:null,getAbstractFileByPath:path=>path===file.path?file:null,getConfig:key=>configs.get(key),async readDocument(path){calls.reads++;await f.beforeRead?.(path,calls.reads);return{...disk,file:{...disk.file}};}}),core:{busy:false,isEnabled:()=>true},metadataTypeManager:Object.assign(types,{getAssignedWidget:()=>state.widget}),metadataCache:Object.assign(new api.Events(),{getDocument:()=>entry}),configuration:{get(id,key){return id==="types"&&key==="types"?state.typeRegistry:configs.get(key)},watch(id,callback){const witness={id,callback};calls.configWatches++;watchers.add(witness);return()=>{calls.configWatches--;watchers.delete(witness);};}},workspace:Object.assign(events,{sessions:new Map(),isChangingFiles:false,isChangingLayout:false,rootSplit,activeLeaf:pane,getActiveViewOfType(){return this.activeLeaf.view instanceof api.MarkdownView?this.activeLeaf.view:null;},getLeavesOfType:type=>type==="markdown"?sources:[],getLeafById:id=>[pane,...sources].find(leaf=>leaf.id===id),getLeaf(){return allocate();},createLeafBySplit(){calls.splits++;return allocate();},dockLeaf(leaf){calls.docks++;leaf.parent={};},setActiveLeaf(leaf){this.activeLeaf=leaf;}})};
 function source(leaf,sameSession){
  const cm={state:api.EditorState.create({doc:dirty?text+"Earlier dirty prose.\r\n":text,extensions:[api.EditorView.editable.of(true),api.EditorState.lineSeparator.of("\r\n")]}),dom:{isConnected:true},contentDOM:{isContentEditable:true},composing:false};
  const editor={cm,getValue:()=>cm.state.sliceDoc()},view=Object.assign(Object.create(api.MarkdownView.prototype),{file,editor,isLoaded:true,leaf,getEditingMode:()=>state.mode,setEditingMode:mode=>state.mode=mode,sourceEl:{checkVisibility:()=>state.mode==="source"}});
  session=sameSession??{originRoot:app.vault.rootPath,document:{...saved,file:{...saved.file}},text:editor.getValue(),dirty,isReloading:false,isSaving:false};view.session=session;leaf.view=view;app.workspace.sessions.set(file.path,session);entry={...entry,document:session.document,text:session.text,cache:dirty?api.parseMarkdown(session.text):cache};return view;
 }
 function allocate(){calls.allocations++;const leaf={id:"opened-"+calls.allocations,parent:{},view:null,async setViewState(request){await f.beforeOpen?.();state.mode=request.state.mode;source(leaf);sources.push(leaf);app.workspace.activeLeaf=leaf;events.trigger("file-open",file);calls.observed++;await f.afterOpen?.(leaf);}};return leaf;}
 if(live){const leaf={id:"existing",parent:sameGroup?parent:{}};source(leaf);sources.push(leaf);}
 f={app,file,pane,calls,state,sources,events,types,watchers,configs,diagnostics:[],get entry(){return entry},get disk(){return disk},set disk(value){disk=value},get session(){return session},value:()=>entry.cache.frontmatter.opaque,authority:(target={kind:"edit",path:["map","key"]})=>api.structuredPropertyHandoff(app,file,"opaque",f.value(),target),open:(authority)=>api.openStructuredPropertyInSource(authority,pane,()=>state.owned,(phase,guards)=>f.diagnostics.push({phase,guards})),publishConfig(id="app"){for(const witness of watchers)if(witness.id===id)witness.callback({});}};return f;
}
test("closed handoff is cached, immutable, exact-target and cannot itself allocate, read or write",()=>{
 const f=fixture(),choice=f.authority();assert.ok(choice);assert.equal(f.calls.reads,0);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);assert.equal(Object.isFrozen(choice),true);assert.equal(Object.isFrozen(choice.value.map),true);assert.equal(Object.isFrozen(choice.target.path),true);
 for(const target of [{kind:"edit",path:["map","missing"]},{kind:"remove",path:[]},{kind:"add",path:["list",0]},{kind:"edit",path:["constructor"]},{kind:"other",path:[]}])assert.equal(f.authority(target),null);
 assert.equal(f.authority({kind:"edit",path:["map","empty"]})!==null,true);
});
test("observation arrays and records cannot be rewritten while live editor owners stay unfrozen",async()=>{
 const f=fixture({live:true}),configured={retained:["original"]};f.configs.set("propertiesInDocument",configured);const a=f.authority();assert.ok(a);
 assert.ok(Object.isFrozen(a.peers)&&Object.isFrozen(a.peers[0])&&Object.isFrozen(a.preferences)&&a.preferences.every(Object.isFrozen));
 assert.throws(()=>a.peers.push(a.peers[0]),TypeError);assert.throws(()=>a.peers[0].mode="source",TypeError);assert.throws(()=>a.preferences[0][1]="other",TypeError);
 const captured=a.preferences.find(([key])=>key==="propertiesInDocument")[1];assert.notEqual(captured,configured);assert.ok(Object.isFrozen(captured.retained));assert.equal(Object.isFrozen(a.peers[0].view),false);assert.equal(Object.isFrozen(a.peers[0].cm),false);
 configured.retained[0]="changed";await assert.rejects(f.open(a),/changed/);assert.equal(f.calls.reads,0);
});
test("a closed note opens a visible normal Source owner without save or mutation, with listeners released",async()=>{
 const f=fixture(),view=await f.open(f.authority());assert.equal(view,f.sources[0].view);assert.equal(f.app.workspace.activeLeaf,view.leaf);assert.equal(view.getEditingMode(),"source");assert.equal(view.editor.getValue(),text);assert.equal(f.calls.reads,2);assert.equal(f.calls.allocations,1);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);assert.equal(f.calls.configWatches,0);
});
test("real Source metadata publication and the real type-manager inventory relay do not revoke unchanged types",async()=>{
 const f=fixture(),metadata=new api.MetadataCache(f.app);metadata.root=f.app.vault.rootPath;metadata.documents.set(f.file.path,f.entry);f.app.metadataCache=metadata;
 const types=new api.MetadataTypeManager(f.app);types.accept({root:f.app.vault.rootPath,id:"types",version:"types-1",data:{types:{}}});f.app.metadataTypeManager=types;
 let relays=0;types.on("changed",()=>relays++);const priorCache=f.entry.cache;
 f.afterOpen=()=>metadata.updateOpenDocuments();const view=await f.open(f.authority());
 assert.equal(relays,1);assert.equal(metadata.getDocument(f.file.path).cache,priorCache);assert.equal(metadata.getDocument(f.file.path).document,view.session.document);assert.equal(view.getEditingMode(),"source");
 assert.equal(f.calls.reads,2);assert.equal(f.calls.allocations,1);assert.equal(f.calls.writes,0);assert.equal(f.calls.configWatches,0);assert.ok(f.diagnostics.every(item=>Object.values(item.guards).every(Boolean)));
});
test("a real dirty-session metadata notification is required before choosing the exact cached existing-owner handoff",async()=>{
 const f=fixture({live:true,dirty:true}),view=f.sources[0].view,cm=view.editor.cm,doc=cm.state.doc,saved=f.session.document;
 f.entry.text=text;f.entry.cache=api.parseMarkdown(text);f.entry.dirty=false;
 const metadata=new api.MetadataCache(f.app);metadata.root=f.app.vault.rootPath;metadata.documents.set(f.file.path,f.entry);f.app.metadataCache=metadata;
 const types=new api.MetadataTypeManager(f.app);types.accept({root:f.app.vault.rootPath,id:"types",version:"types-1",data:{types:{}}});f.app.metadataTypeManager=types;
 assert.equal(f.authority({kind:"add",path:["emptyMap"]}),null);assert.equal(f.calls.reads,0);assert.equal(f.calls.allocations,0);assert.equal(metadata.getDocument(f.file.path).text,text);
 // App.notifyEditor invokes this real method; the delayed workspace callback
 // must settle before a positive choice can own a cached source snapshot.
 metadata.updateOpenDocuments();const indexed=metadata.getDocument(f.file.path);assert.equal(indexed.text,f.session.text);assert.equal(indexed.dirty,true);assert.equal(indexed.document,saved);
 const authority=f.authority({kind:"add",path:["emptyMap"]});assert.ok(authority);assert.equal(await f.open(authority),view);assert.equal(view.editor.cm,cm);assert.equal(cm.state.doc,doc);assert.equal(view.session.document,saved);assert.equal(view.session.dirty,true);assert.equal(f.calls.allocations,0);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);
});
test("the immutable registry and sticky actual type-configuration change still revoke changed-and-reverted held actions",async t=>{
 for(const physicalOnly of [false,true])await t.test(physicalOnly?"same-value physical type configuration version":"real registry changed and reverted",async()=>{
  const f=fixture(),types=new api.MetadataTypeManager(f.app);types.accept({root:f.app.vault.rootPath,id:"types",version:"types-1",data:{types:{}}});f.app.metadataTypeManager=types;
  const authority=f.authority(),gate=deferred();assert.ok(Object.isFrozen(authority.typeRegistry));f.beforeRead=()=>gate.promise;const opening=f.open(authority);await Promise.resolve();
  if(physicalOnly)f.publishConfig("types");else{f.state.typeRegistry={opaque:"number"};types.accept({root:f.app.vault.rootPath,id:"types",version:"types-2",data:{types:f.state.typeRegistry}});f.state.typeRegistry={};types.accept({root:f.app.vault.rootPath,id:"types",version:"types-3",data:{types:{}}});}
  gate.resolve();await assert.rejects(opening,/changed/);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);assert.equal(f.calls.configWatches,0);assert.equal(f.diagnostics.at(-1).guards.notRevoked,false);
 });
});
test("a main File properties pane creates a visible split rather than hiding its review tab",async()=>{
 const f=fixture({main:true});await f.open(f.authority({kind:"add",path:["emptyMap"]}));assert.equal(f.calls.splits,1);assert.equal(f.calls.writes,0);
});
test("an existing dirty Reading/Source owner is reused by identity and preserves exact CM document and dirty text",async()=>{
 const f=fixture({live:true,dirty:true}),view=f.sources[0].view,editor=view.editor,cm=editor.cm,doc=cm.state.doc,saved=f.session.document;
 assert.equal(await f.open(f.authority({kind:"remove",path:["list",1]})),view);assert.equal(view.editor,editor);assert.equal(view.editor.cm,cm);assert.equal(cm.state.doc,doc);assert.equal(f.session.document,saved);assert.equal(f.session.text,text+"Earlier dirty prose.\r\n");assert.equal(f.calls.allocations,0);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);
});
test("an existing Source tab sharing the main review group is docked, preserving its actual editor",async()=>{
 const f=fixture({main:true,live:true,sameGroup:true}),old=f.sources[0].view;assert.equal(await f.open(f.authority()),old);assert.equal(f.calls.docks,1);assert.equal(f.calls.allocations,0);
});
test("global read-only, closed owner, core busy and replaced cached authority refuse before any IO or allocation",async t=>{
 for(const [name,change]of[["readonly",f=>f.app.vault.readOnly=true],["owner",f=>f.state.owned=false],["corebusy",f=>f.app.core.busy=true],["root",f=>f.app.vault.rootPath="other"],["path",f=>f.file.path="Moved.md"],["config",f=>f.configs.set("useMarkdownLinks",true)],["source",f=>f.entry.text+="changed"]])await t.test(name,async()=>{const f=fixture(),a=f.authority();change(f);await assert.rejects(f.open(a),/changed/);assert.equal(f.calls.reads,0);assert.equal(f.calls.allocations,0);assert.equal(f.calls.configWatches,0);});
 const f=fixture();f.app.vault.readOnly=true;assert.equal(f.authority(),null);await assert.rejects(f.open({...fixture().authority()}),/changed/);assert.equal(f.calls.reads,0);
});
test("physical BOM-only, same-value spelling and changed descendant replacements refuse before Source allocation",async t=>{
 for(const replacement of [{hasBom:false},{version:"2".repeat(64),content:text.replace("empty: ~","empty: null")},{version:"3".repeat(64),content:text.replace("one, 2","one, 3")}])await t.test(JSON.stringify(replacement),async()=>{const f=fixture(),a=f.authority();f.disk={...f.disk,...replacement};await assert.rejects(f.open(a),/changed/);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);});
});
test("a held physical check cannot continue after configuration/type/owner or exact cached-document retirement",async t=>{
 for(const change of [f=>f.publishConfig(),f=>{f.state.widget="number";f.types.trigger("changed")},f=>f.state.owned=false,f=>f.entry.document.version="9".repeat(64)])await t.test(String(change),async()=>{const f=fixture(),gate=deferred(),a=f.authority();f.beforeRead=()=>gate.promise;const pending=f.open(a);await Promise.resolve();change(f);gate.resolve();await assert.rejects(pending,/changed/);assert.equal(f.calls.allocations,0);assert.equal(f.calls.configWatches,0);});
});
test("source creation acknowledgement does not renew a reset editor or allow an after-open disk conflict",async t=>{
 for(const change of [f=>f.state.owned=false,f=>f.disk={...f.disk,version:"4".repeat(64)},f=>{const view=f.sources[0].view;view.editor.cm={...view.editor.cm};},f=>f.session.document={...f.session.document}])await t.test(String(change),async()=>{const f=fixture(),a=f.authority();f.afterOpen=()=>change(f);await assert.rejects(f.open(a),/changed/);assert.equal(f.calls.allocations,1);assert.equal(f.calls.writes,0);assert.equal(f.sources[0].view.getEditingMode(),"source");assert.equal(f.calls.configWatches,0);});
});
test("consumed and forged handoffs cannot allocate a second owner or read a current note",async()=>{
 const f=fixture(),a=f.authority();await f.open(a);const before={...f.calls};await assert.rejects(f.open(a),/changed/);await assert.rejects(f.open({...a}),/changed/);assert.deepEqual(f.calls,before);
});
test("descriptor validation never invokes caller getters and a proven implicit empty null has cached handoff authority",()=>{
 const f=fixture();let reads=0;const getter=Object.defineProperty({},"kind",{enumerable:true,get(){reads++;return"edit"}});assert.equal(api.structuredPropertyHandoff(f.app,f.file,"opaque",f.value(),getter),null);assert.equal(reads,0);
 f.entry.text=f.entry.text.replace("empty: ~","empty:");f.entry.cache=api.parseMarkdown(f.entry.text);f.entry.document={...f.entry.document,content:f.entry.text};assert.ok(f.authority({kind:"edit",path:["map","empty"]}));assert.equal(f.calls.reads,0);
});

test("a nested key rename uses the same issued exact-target Source authority without saving or applying",async()=>{
 const f=fixture(),authority=f.authority({kind:"rename",path:["map","key"]});assert.ok(authority);assert.deepEqual(authority.target,{kind:"rename",path:["map","key"]});const view=await f.open(authority);assert.equal(view.editor.getValue(),text);assert.equal(view.getEditingMode(),"source");assert.equal(f.calls.allocations,1);assert.equal(f.calls.reads,2);assert.equal(f.calls.writes,0);assert.equal(f.calls.saves,0);
});

test("adjacent nested reorder uses issued exact-target Source authority while collection boundaries refuse before I/O",async()=>{
 for(const kind of ["move-up","move-down"]){const f=fixture(),path=kind==="move-up"?["list",1]:["list",0],authority=f.authority({kind,path});assert.ok(authority);assert.deepEqual(authority.target,{kind,path});const view=await f.open(authority);assert.equal(view.editor.getValue(),text);assert.equal(view.getEditingMode(),"source");assert.equal(f.calls.allocations,1);assert.equal(f.calls.reads,2);assert.equal(f.calls.writes,0);assert.equal(f.calls.saves,0);}
 for(const [kind,path]of[["move-up",["list",0]],["move-down",["list",2]],["move-up",["emptyMap","missing"]]]){const f=fixture();assert.equal(f.authority({kind,path}),null);assert.equal(f.calls.reads,0);assert.equal(f.calls.allocations,0);}
 const f=fixture();f.app.vault.readOnly=true;assert.equal(f.authority({kind:"move-up",path:["list",1]}),null);assert.equal(f.calls.reads,0);assert.equal(f.calls.allocations,0);
});
