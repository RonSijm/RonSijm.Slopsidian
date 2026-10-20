import assert from "node:assert/strict";
import {before, after, test} from "node:test";
import {build} from "esbuild";
import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {join, relative} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {history, undo, redo, undoDepth} from "@codemirror/commands";
import {errorLogStub} from "./error-log-stub.mjs";
import {bulkSourceFixture, original, targetText, deferred} from "./outgoing-bulk-source-fixture.mjs";
import {installMentionBulkDom} from "./outgoing-mention-bulk-fixture.mjs";

const root=fileURLToPath(new URL("../",import.meta.url)); let directory,api;
before(async()=>{
  await mkdir(join(root,".runtime"),{recursive:true}); directory=await mkdtemp(join(root,".runtime","outgoing-bulk-source-tests-"));
  const outfile=join(directory,"feature.mjs");
  await build({stdin:{contents:'export * from "./client/outgoing-mention-bulk";export * from "./client/outgoing-mention-intent";export * from "./client/outgoing-mention-authoring";export {OutgoingPaneView} from "./client/outgoing-pane-view";export {OutgoingLinks} from "./client/outgoing-links";export {VaultConfiguration} from "./client/configuration";export {MarkdownView} from "./client/workspace";export {Editor} from "./client/editor";export {Events} from "./client/events";export {FileManager} from "./client/file-manager";export {TFile} from "./client/vault";export {parseMarkdown,outgoingMentions} from "./client/markdown";export {resolveLink} from "./client/links";',resolveDir:root},outfile,bundle:true,packages:"external",platform:"node",format:"esm",logLevel:"silent",plugins:[errorLogStub]});
  api=await import(pathToFileURL(outfile).href);
});
after(async()=>{if(directory){assert.match(relative(root,directory).replaceAll("\\","/"),/^\.runtime\/outgoing-bulk-source-tests-[^/]+$/);await rm(directory,{recursive:true});}});

function fixture(options={}) {
  const f=bulkSourceFixture(api,options);
  f.candidate=(target=f.target,ranges)=>{const text=f.view?.editor.getValue()??options.text??original;const environment=api.outgoingMentionIntentEnvironmentFor(api.outgoingMentionIntentAuthority(f.app,f.source,text));
    const matches=ranges??api.outgoingMentions(text,api.parseMarkdown(text),f.source.path,[{path:target.path,basename:target.basename,cache:f.documents.get(target.path).cache}])[0]?.matches??[];
    return api.outgoingMentionBulkSourceCandidate(environment,target,matches);};
  f.prepare=(candidate=f.candidate())=>{assert.ok(candidate);return api.prepareOutgoingMentionBulkInSource(candidate,()=>f.state.owned);};
  f.apply=review=>api.applyOutgoingMentionBulk(review,()=>f.state.owned);
  return f;
}

test("closed group offers a transport-free intent, explicitly opens Source and creates a literal review without editing or saving",async()=>{
  for(const markdown of [false,true]){
    const f=fixture();f.config.set("useMarkdownLinks",markdown);f.config.set("newLinkFormat",markdown?"relative":"shortest");
    let generated=0;const generate=f.app.fileManager.generateMarkdownLink.bind(f.app.fileManager);f.app.fileManager.generateMarkdownLink=(...args)=>{generated++;return generate(...args);};
    const candidate=f.candidate();assert.ok(candidate);assert.equal(candidate.kind,"visible-source");assert.equal(candidate.choices.length,2);assert.equal(generated,0);assert.equal(f.state.tabs,0);assert.deepEqual(f.reads,[]);
    const review=await f.prepare(candidate),view=f.view;assert.equal(f.state.tabs,1);assert.equal(view.getEditingMode(),"source");assert.equal(f.app.workspace.activeLeaf,view.leaf);assert.equal(view.editor.getValue(),original);assert.equal(undoDepth(view.editor.cm.state),0);assert.equal(f.state.saves,0);assert.equal(review.changes.length,2);
    const expected=markdown?"[TARGET λ](../Targets/Destination.md)":"[[Destination|TARGET λ]]";assert.equal(review.changes[0].insert,expected);assert.deepEqual(review.changes.map(x=>x.label),["TARGET λ","Target λ"]);
    api.cancelOutgoingMentionBulk(review);assert.equal(view.editor.getValue(),original);assert.equal(view.getEditingMode(),"source");assert.equal(f.disk.get(f.source.path).content,original);assert.equal(f.disk.get(f.source.path).hasBom,true);assert.equal(f.disk.get(f.target.path).content,targetText);
    await assert.rejects(f.apply(review),/changed/);assert.equal(undoDepth(view.editor.cm.state),0);
  }
});

test("reviewed closed-note batch uses the exact visible owner and one shared Undo after focus moves back to its review",async()=>{
  const f=fixture(),review=await f.prepare(),view=f.view;
  f.app.workspace.activeLeaf={view:{getViewType:()=>"outgoing-link"}};
  await f.apply(review);assert.equal(view.editor.getValue(),review.text);assert.equal(undoDepth(view.editor.cm.state),1);assert.equal(f.state.saves,0);assert.equal(f.state.tabs,1);
  assert.equal(undo(view.editor.cm),true);assert.equal(view.editor.getValue(),original);assert.equal(redo(view.editor.cm),true);assert.equal(view.editor.getValue(),review.text);
  assert.equal(f.disk.get(f.source.path).content,original);await assert.rejects(f.apply(review),/changed/);
});

test("Reading handoff keeps the same editor/CM/session and earlier dirty history, then reviews before any batch edit",async()=>{
  const f=fixture({reading:true});f.dirtySuffix();const view=f.view,editor=view.editor,cm=editor.cm,session=view.session,document=session.document,dirty=editor.getValue();
  const review=await f.prepare();assert.equal(f.view,view);assert.equal(view.editor,editor);assert.equal(editor.cm,cm);assert.equal(view.session,session);assert.equal(view.savedDocument,document);assert.equal(view.getEditingMode(),"source");assert.equal(editor.getValue(),dirty);assert.equal(undoDepth(cm.state),1);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);
  await f.apply(review);assert.equal(undoDepth(cm.state),2);undo(cm);assert.equal(editor.getValue(),dirty);undo(cm);assert.equal(editor.getValue(),original);assert.equal(f.disk.get(f.source.path).content,original);
});

test("literal review does not expire on a timer, but its exact original editor/document/source lease is never renewed",async()=>{
  const f=fixture(),review=await f.prepare(),now=Date.now;Date.now=()=>now()+60_000;
  try {assert.equal(api.outgoingMentionBulkReviewCurrent(review,()=>true),true);await f.apply(review);assert.equal(f.view.editor.getValue(),review.text);}finally{Date.now=now;}
});

test("unsupported/partial ranges and over-limit groups cannot open Source or silently shorten a batch",async()=>{
  const f=fixture(),candidate=f.candidate();await assert.rejects(f.prepare(f.candidate(f.target,[candidate.ranges[0]])),/changed/);assert.equal(f.state.tabs,0);assert.deepEqual(f.reads,[]);
  const many=fixture({text:Array.from({length:33},()=>"Target λ.").join("\r\n")}),limit=many.candidate();assert.match(limit.unavailable,/32/);await assert.rejects(many.prepare(limit),/32/);assert.equal(many.state.tabs,0);assert.deepEqual(many.reads,[]);
});

test("read-only, busy, disabled and stale cached intent refusal occurs before transport or Source allocation",async()=>{
  for(const change of [f=>f.app.vault.readOnly=true,f=>f.app.changingVault=true,f=>f.app.core.busy=true,f=>f.state.core=false,f=>f.state.owned=false,f=>f.app.workspace.isChangingFiles=true,f=>f.app.workspace.isChangingLayout=true,
    f=>f.documents.get(f.target.path).document={...f.documents.get(f.target.path).document},f=>f.documents.get(f.target.path).cache.frontmatter.aliases=["Other"],f=>f.documents.get(f.source.path).cache.errors.push("bad"),f=>f.config.set("useMarkdownLinks",true),f=>f.add(f.source.path,original)]){
    const f=fixture(),candidate=f.candidate();change(f);await assert.rejects(f.prepare(candidate),/changed/);assert.deepEqual(f.reads,[]);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);
  }
});

test("physical source/target replacements refuse before opening and keep exact newer saved bytes",async()=>{
  for(const name of ["source","target"])for(const field of ["content","version","hasBom"]){const f=fixture(),candidate=f.candidate(),disk=f.disk.get(f[name].path);disk[field]=field==="hasBom"?false:disk[field]+"new Ω";await assert.rejects(f.prepare(candidate),/changed/);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);assert.equal(f.view,null);}
  for(const name of ["source","target"]){const f=fixture();f.onRead=(path,document)=>{if(path===f[name].path)document.file.path="Other physical path.md";};await assert.rejects(f.prepare(),/changed/);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);assert.equal(f.view,null);}
});

test("a held preflight cannot cross changed Reading/closed intent, preferences or document lifetimes",async()=>{
  for(const reading of [false,true])for(const change of [f=>f.state.owned=false,f=>f.app.vault.rootPath="other",f=>f.config.set("newLinkFormat","relative"),f=>f.documents.get(f.target.path).cache={...f.documents.get(f.target.path).cache},f=>{if(reading)f.dirtySuffix();else f.documents.get(f.source.path).document={...f.documents.get(f.source.path).document};}]){
    const f=fixture({reading}),candidate=f.candidate(),gate=deferred(),seen=deferred();f.onRead=path=>{if(path===f.target.path){seen.resolve();return gate.promise;}};const pending=f.prepare(candidate);await seen.promise;change(f);gate.resolve();await assert.rejects(pending,/changed/);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);if(reading)assert.equal(f.view.getMode(),"preview");
  }
});

test("visible opening callbacks cannot renew an equal-text CM, editor, document, target or pane lease",async()=>{
  for(const change of [f=>f.view.editor.cm.state=EditorState.create({doc:original,extensions:[history()]}),f=>f.view.session.document={...f.view.session.document},f=>f.documents.get(f.target.path).document={...f.documents.get(f.target.path).document},f=>f.state.owned=false,f=>f.dirtySuffix()]){
    const f=fixture();f.afterVisible=()=>change(f);await assert.rejects(f.prepare(),/changed/);assert.equal(f.state.saves,0);assert.equal(f.view.editor.getValue().includes("[[Destination"),false);assert.equal(f.disk.get(f.source.path).content,original);
  }
});

test("a retained visible-source review refuses newer editor, mode, physical target and read-only authority",async()=>{
  for(const change of [f=>f.dirtySuffix(),f=>f.view.setEditingMode("preview",false),f=>f.view.editor.cm.state=EditorState.create({doc:original,extensions:[history()]}),f=>f.app.vault.readOnly=true,f=>f.state.core=false,f=>f.state.owned=false,f=>f.documents.get(f.target.path).document={...f.documents.get(f.target.path).document},f=>f.view.leaf.view={}]){
    const f=fixture(),review=await f.prepare(),editor=f.view.editor;change(f);const before=editor.getValue(),depth=undoDepth(editor.cm.state);f.reads.length=0;await assert.rejects(f.apply(review),/changed/);assert.deepEqual(f.reads,[]);assert.equal(editor.getValue(),before);assert.equal(undoDepth(editor.cm.state),depth);assert.equal(f.state.saves,0);
  }
  for(const field of ["version","content","hasBom"]){const f=fixture(),review=await f.prepare(),disk=f.disk.get(f.target.path);disk[field]=field==="hasBom"?false:disk[field]+"new";await assert.rejects(f.apply(review),/changed/);assert.equal(f.view.editor.getValue(),original);}
});

test("held Apply cannot relink after trusted-source typing or cancelled review and cannot create a second source owner",async()=>{
  for(const cancel of [false,true]){const f=fixture(),review=await f.prepare(),gate=deferred(),seen=deferred();f.onRead=path=>{if(path===f.target.path){seen.resolve();return gate.promise;}};const pending=f.apply(review);await seen.promise;if(cancel)api.cancelOutgoingMentionBulk(review);else f.dirtySuffix();const before=f.view.editor.getValue(),depth=undoDepth(f.view.editor.cm.state);gate.resolve();await assert.rejects(pending,/changed/);assert.equal(f.view.editor.getValue(),before);assert.equal(undoDepth(f.view.editor.cm.state),depth);assert.equal(f.state.tabs,1);assert.equal(f.state.saves,0);}
});

const settle=async()=>{for(let index=0;index<40;index++)await Promise.resolve();};
function paneFixture(options={}) {
  const dom=installMentionBulkDom(),f=fixture(options),pane=Object.create(api.OutgoingPaneView.prototype),container=new dom.Element("div");container.root=true;
  Object.assign(pane,{app:f.app,leaf:{parent:{}},sourceRoot:f.app.vault.rootPath,containerEl:container,contentEl:container,options:{file:f.source.path,followActiveFile:false,linksCollapsed:false,unlinkedCollapsed:false},snapshot:null,signature:"",revision:0,request:0,navigationToken:0,queued:false,opening:false,message:"",mentionActions:new Map(),bulkActions:new Map(),authoringAuthority:null,intentAuthority:null,mentionTargets:[],authoringWatch:null,follow:new dom.Element("input"),caption:new dom.Element("p"),status:new dom.Element("p"),results:new dom.Element("div")});
  container.append(pane.results,pane.status);pane.leaf.view=pane;Object.defineProperty(pane,"isLoaded",{value:true,writable:true});
  for(const event of ["layout-change","file-open","active-leaf-change","editor-change"])f.app.workspace.on(event,()=>pane.schedule());
  Object.assign(f,{pane,dom,button:()=>pane.results.querySelector('[data-outgoing-mention-bulk="'+f.target.path+'"]'),cleanup(){pane.closeBulkReview();pane.cancelAuthoringWatch();pane.isLoaded=false;dom.restore();}});return f;
}

test("actual main or sidebar pane offers Review in Source and survives only the intentional closed/Reading render transition",async()=>{
  for(const reading of [false,true]){
    const f=paneFixture({reading});
    try{
      await f.pane.refresh();const button=f.button();assert.equal(button.textContent,"Review in Source");assert.equal(button.disabled,false);assert.equal(button.dataset.outgoingMentionBulkMode,"visible-source");assert.equal(f.pane.bulkReview,undefined);assert.equal(f.state.tabs,0);assert.deepEqual(f.reads,[]);
      const initial=reading?f.view.editor:null;await f.pane.reviewBulkMentions(button);await settle();const review=f.pane.bulkReview;assert.ok(review,f.pane.message);assert.equal(f.app.workspace.activeLeaf,f.pane.leaf,"the literal review is made visible after opening Source");assert.equal(f.view.getEditingMode(),"source");assert.equal(f.view.editor.getValue(),original);assert.equal(undoDepth(f.view.editor.cm.state),0);assert.equal(f.state.saves,0);assert.equal(f.state.tabs,reading?0:1);if(initial)assert.equal(f.view.editor,initial);assert.equal(button.isConnected,false);assert.equal(f.button().textContent,"Review links");assert.match(f.pane.message,/Source is open/);
      const oldPanel=f.pane.bulkReviewEl;await oldPanel.querySelector("[data-outgoing-bulk-cancel]").fire("click");await settle();assert.equal(f.pane.bulkReview,null);assert.equal(f.view.getEditingMode(),"source");assert.equal(f.view.editor.getValue(),original);assert.equal(undoDepth(f.view.editor.cm.state),0);f.reads.length=0;await oldPanel.querySelector("[data-outgoing-bulk-apply]").fire("click");await settle();assert.deepEqual(f.reads,[]);
      await f.pane.reviewBulkMentions(f.button());const live=f.pane.bulkReview;assert.ok(live);await f.pane.applyBulkMentions(live);assert.equal(f.view.editor.getValue(),live.text);assert.equal(undoDepth(f.view.editor.cm.state),1);undo(f.view.editor.cm);assert.equal(f.view.editor.getValue(),original);
    }finally{f.cleanup();}
  }
});

test("actual pane refuses readonly, stale retained buttons and pending handoff after disable, unload, options or parent changes",async()=>{
  for(const change of [f=>f.app.vault.readOnly=true,f=>f.state.core=false,f=>f.pane.isLoaded=false,f=>f.pane.leaf.parent={},f=>f.pane.options={...f.pane.options},f=>f.pane.navigationToken++,f=>f.app.vault.rootPath="other"]){
    const f=paneFixture();try{await f.pane.refresh();const gate=deferred(),seen=deferred();f.onRead=path=>{if(path===f.target.path){seen.resolve();return gate.promise;}};const pending=f.pane.reviewBulkMentions(f.button());await seen.promise;change(f);gate.resolve();await pending;await settle();assert.equal(f.pane.bulkReview==null,true);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);assert.equal(f.disk.get(f.source.path).content,original);}finally{f.cleanup();}
  }
  const f=paneFixture();try{await f.pane.refresh();const stale=f.button();f.documents.get(f.target.path).document={...f.documents.get(f.target.path).document};await f.pane.refresh();assert.equal(stale.isConnected,false);await f.pane.reviewBulkMentions(stale);assert.deepEqual(f.reads,[]);assert.equal(f.state.tabs,0);f.app.vault.readOnly=true;await f.pane.reviewBulkMentions(f.button());assert.deepEqual(f.reads,[]);assert.equal(f.state.tabs,0);}finally{f.cleanup();}
});

test("actual legacy pinned and following panels use the same visible Source handoff, cancellation and exact shared owner",async()=>{
  for(const reading of [false,true])for(const pinned of [false,true]){
    const dom=installMentionBulkDom(),f=fixture({reading}),legacy=new api.OutgoingLinks(f.app),panel=new dom.Element("section");panel.root=true;legacy.panel=panel;legacy.pinnedFile=pinned?f.source.path:null;legacy.unlinkedCollapsed=false;f.app.workspace.getActiveFile=()=>f.source;
    for(const event of ["layout-change","file-open","editor-change"])f.app.workspace.on(event,()=>legacy.requestUpdate());
    const button=()=>panel.querySelector('[data-outgoing-mention-bulk="'+f.target.path+'"]');
    const review=async()=>{const control=button(),candidate=f.candidate();await legacy.reviewBulkMentions(candidate,control,panel,legacy.revision,legacy.generation,f.app.vault.rootPath,f.source.path);await settle();assert.ok(legacy.bulkReview,legacy.mentionMessage);return legacy.bulkReview;};
    try{
      legacy.render();assert.equal(button().textContent,"Review in Source");assert.deepEqual(f.reads,[]);const initial=reading?f.view.editor:null;await review();const old=legacy.bulkReviewEl;assert.equal(f.view.getEditingMode(),"source");assert.equal(f.view.editor.getValue(),original);if(initial)assert.equal(f.view.editor,initial);assert.equal(f.state.tabs,reading?0:1);await old.querySelector("[data-outgoing-bulk-cancel]").fire("click");assert.equal(legacy.bulkReview,null);assert.equal(undoDepth(f.view.editor.cm.state),0);f.reads.length=0;await old.querySelector("[data-outgoing-bulk-apply]").fire("click");await settle();assert.deepEqual(f.reads,[]);
      f.view.setEditingMode("preview",false);await settle();legacy.render();const current=await review();await legacy.bulkReviewEl.querySelector("[data-outgoing-bulk-apply]").fire("click");await settle();assert.equal(f.view.editor.getValue(),current.text);assert.equal(undoDepth(f.view.editor.cm.state),1);undo(f.view.editor.cm);assert.equal(f.view.editor.getValue(),original);assert.equal(f.disk.get(f.source.path).content,original);assert.equal(f.state.saves,0);
    }finally{legacy.closeBulkReview();legacy.cancelAuthoringWatch();dom.restore();}
  }
});

test("actual legacy pending handoff refuses disabled/unloaded/root/pin/folded owners without allocating Source",async()=>{
  for(const change of [(f,p)=>f.app.vault.readOnly=true,(f,p)=>f.state.core=false,(f,p)=>p.generation++,(f,p)=>p.panel=null,(f,p)=>p.pinnedFile="Other.md",(f,p)=>p.unlinkedCollapsed=true,(f,p)=>p.intentRevision++,(f,p)=>f.app.vault.rootPath="other"]){
    const dom=installMentionBulkDom(),f=fixture(),legacy=new api.OutgoingLinks(f.app),panel=new dom.Element("section");panel.root=true;legacy.panel=panel;legacy.pinnedFile=f.source.path;legacy.unlinkedCollapsed=false;f.app.workspace.getActiveFile=()=>f.source;
    try{legacy.render();const button=panel.querySelector('[data-outgoing-mention-bulk="'+f.target.path+'"]'),candidate=f.candidate(),gate=deferred(),seen=deferred();f.onRead=path=>{if(path===f.target.path){seen.resolve();return gate.promise;}};const pending=legacy.reviewBulkMentions(candidate,button,panel,legacy.revision,legacy.generation,f.app.vault.rootPath,f.source.path);await seen.promise;change(f,legacy);gate.resolve();await pending;await settle();assert.equal(legacy.bulkReview,null);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);assert.equal(f.disk.get(f.source.path).content,original);}finally{legacy.closeBulkReview();legacy.cancelAuthoringWatch();dom.restore();}
  }
});

function configurationFixture(options={}) {
  const dom=installMentionBulkDom(),f=fixture(options);
  dom.Element.prototype.removeEventListener=function(name,listener){this.listeners.set(name,(this.listeners.get(name)??[]).filter(value=>value!==listener));};
  for(const target of [f.app.vault,f.app.core,f.app.metadataCache]){const events=new api.Events();for(const name of ["on","off","offref","trigger"])target[name]=events[name].bind(events);}
  const configuration=new api.VaultConfiguration(f.app);configuration.pollMilliseconds=0;f.app.configuration=configuration;f.app.workspace.app=f.app;f.app.workspace.getActiveFile=()=>f.source;
  let revision=0;
  f.acceptPreferences=(markdown,format=markdown?"relative":"shortest",extra={})=>configuration.accept({root:f.app.vault.rootPath,id:"app",version:"config-"+ ++revision,data:{useMarkdownLinks:markdown,newLinkFormat:format,...extra}});
  f.app.vault.getConfig=key=>configuration.get("app",key);f.acceptPreferences(false);
  return Object.assign(f,{dom,configuration});
}
async function configuredPane(f) {
  const leaf={id:"configuration-pane",workspace:f.app.workspace,parent:{}},pane=new api.OutgoingPaneView(leaf);leaf.view=pane;pane.containerEl.root=true;pane.options={file:f.source.path,followActiveFile:false,linksCollapsed:false,unlinkedCollapsed:false};
  await pane.load();await pane.refresh();return pane;
}

test("real workspace pane configuration subscription rebinds closed/Reading candidates without navigation, host reads or implicit Save",async()=>{
  for(const reading of [false,true]){
    const f=configurationFixture({reading});let pane;
    try{
      pane=await configuredPane(f);const button=()=>pane.results.querySelector('[data-outgoing-mention-bulk="'+f.target.path+'"]'),old=button(),revision=pane.snapshot.id,originalView=f.view,originalCm=f.view?.editor.cm,originalDoc=originalCm?.state.doc;
      assert.equal(f.configuration.listeners.get("app").size,1);f.acceptPreferences(true);await settle();const current=button(),candidate=pane.bulkActions.get(current.dataset.outgoingKey);
      assert.ok(pane.snapshot.id>revision);assert.notEqual(current,old);assert.equal(old.isConnected,false);assert.equal(current.disabled,false);assert.equal(candidate.kind,"visible-source");assert.ok(candidate.choice.preferences.every(([key,value])=>f.app.vault.getConfig(key)===value));assert.deepEqual(f.reads,[]);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);if(reading){assert.equal(f.view,originalView);assert.equal(f.view.editor.cm,originalCm);assert.equal(f.view.editor.cm.state.doc,originalDoc);assert.equal(f.view.getMode(),"preview");}
      await pane.reviewBulkMentions(old);assert.deepEqual(f.reads,[]);assert.equal(f.state.tabs,0);await pane.reviewBulkMentions(current);const review=pane.bulkReview;assert.ok(review,pane.message);assert.ok(review.changes.every(change=>change.insert.startsWith("[")&&change.insert.includes("](../Targets/Destination.md)")));await pane.applyBulkMentions(review);assert.equal(f.view.editor.getValue(),review.text);assert.equal(undoDepth(f.view.editor.cm.state),1);assert.equal(f.state.saves,0);undo(f.view.editor.cm);assert.equal(f.view.editor.getValue(),original);
      await pane.unloadAndWait();assert.equal(f.configuration.listeners.get("app")?.size??0,0);f.acceptPreferences(false);await settle();assert.equal(pane.snapshot,null);assert.equal(pane.queued,false);
    }finally{if(pane?.isLoaded)await pane.unloadAndWait();f.dom.restore();}
  }
});

test("Reading preference changes during held preflight refuse the old action and automatically expose a fresh exact candidate",async()=>{
  const f=configurationFixture({reading:true});let pane;
  try{
    f.dirtySuffix();const dirty=f.view.editor.getValue(),cm=f.view.editor.cm,doc=cm.state.doc,depth=undoDepth(cm.state);pane=await configuredPane(f);const button=()=>pane.results.querySelector('[data-outgoing-mention-bulk="'+f.target.path+'"]'),old=button(),gate=deferred(),seen=deferred();
    f.onRead=path=>{if(path===f.target.path){seen.resolve();return gate.promise;}};const pending=pane.reviewBulkMentions(old);await seen.promise;f.acceptPreferences(true);await settle();const fresh=button();assert.notEqual(fresh,old);gate.resolve();await pending;await settle();
    assert.equal(pane.bulkReview,null);assert.match(pane.message,/changed/);assert.equal(f.view.getMode(),"preview");assert.equal(f.view.editor.getValue(),dirty);assert.equal(cm.state.doc,doc);assert.equal(undoDepth(cm.state),depth);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);assert.equal(fresh.disabled,false);assert.ok(pane.bulkActions.get(fresh.dataset.outgoingKey).choice.preferences.every(([key,value])=>f.app.vault.getConfig(key)===value));
    f.onRead=null;await pane.reviewBulkMentions(fresh);const review=pane.bulkReview;assert.ok(review,pane.message);assert.equal(f.view.editor.cm,cm);assert.equal(cm.state.doc,doc);assert.equal(f.view.editor.getValue(),dirty);assert.equal(undoDepth(cm.state),depth);await pane.applyBulkMentions(review);assert.equal(undoDepth(cm.state),depth+1);undo(cm);assert.equal(f.view.editor.getValue(),dirty);assert.equal(f.disk.get(f.source.path).content,original);assert.equal(f.state.saves,0);
  }finally{if(pane?.isLoaded)await pane.unloadAndWait();f.dom.restore();}
});

test("real legacy activation subscribes to accepted link preferences and removes its watcher on disable/unload",async()=>{
  const f=configurationFixture({reading:true}),legacy=new api.OutgoingLinks(f.app);let cleanup;
  f.app.workspace.getViewOptions=()=>({file:f.source.path,pinned:true,unlinkedCollapsed:false});f.app.commands={install:()=>()=>{}};f.app.sidebars={register(_id,_label,_side,panel){panel.root=true;return()=>{panel.root=false;};}};
  try{
    cleanup=legacy.activate();const panel=legacy.panel,button=()=>panel.querySelector('[data-outgoing-mention-bulk="'+f.target.path+'"]'),old=button(),revision=legacy.revision,cm=f.view.editor.cm,doc=cm.state.doc;
    assert.equal(f.configuration.listeners.get("app").size,1);f.acceptPreferences(true);await settle();assert.ok(legacy.revision>revision);assert.equal(old.isConnected,false);assert.equal(button().textContent,"Review in Source");assert.equal(button().disabled,false);assert.equal(f.view.getMode(),"preview");assert.equal(cm.state.doc,doc);assert.deepEqual(f.reads,[]);assert.equal(f.state.tabs,0);assert.equal(f.state.saves,0);
    await button().fire("click");await settle();const review=legacy.bulkReview;assert.ok(review,legacy.mentionMessage);assert.ok(review.changes.every(change=>change.insert.includes("](../Targets/Destination.md)")));await legacy.bulkReviewEl.querySelector("[data-outgoing-bulk-apply]").fire("click");await settle();assert.equal(f.view.editor.getValue(),review.text);assert.equal(undoDepth(cm.state),1);undo(cm);assert.equal(f.view.editor.getValue(),original);assert.equal(f.state.saves,0);
    cleanup();cleanup=null;assert.equal(f.configuration.listeners.get("app")?.size??0,0);const finalRevision=legacy.revision;f.acceptPreferences(false);await settle();assert.equal(legacy.revision,finalRevision);assert.equal(legacy.queued,false);assert.equal(legacy.panel,null);
  }finally{cleanup?.();legacy.cancelAuthoringWatch();f.dom.restore();}
});
