import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {checkCanvasWorkflows,checkCanvasWorkflowsReadOnly,canvasWorkflowsReadOnlyFixture} from "./canvas-workflow-scenarios.mjs";
import {checkGraphSharing,checkGraphSharingReadOnly,graphSharingReadOnlyFixture} from "./graph-sharing-scenarios.mjs";
import {checkOutgoingNewDestination,checkOutgoingNewDestinationReadOnly,outgoingNewDestinationReadOnlyFixture} from "./outgoing-new-destination-scenarios.mjs";
import {mountCachedGitHub,assertCachedBlobsUnchanged} from "./cached-github-fixture.mjs";

/** Real host collections remain serial; each feature owns its local fixtures. */
export async function checkVisualAuthoring(hostTools) {
  const report=hostTools.report,failures=report.visualAuthoringFailures=[];
  const tools={...hostTools,click:async(selector,modifiers=0)=>{
    const covered=`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.scrollIntoView({block:'center',inline:'nearest'});const r=[...node.getClientRects()].find(r=>r.width>0&&r.height>0);if(!r)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(hit?.closest('.notice')&&!node.contains(hit))})()`;
    if(await hostTools.evaluate(covered))await hostTools.wait(`!(${covered})`,"the actual transient notice no longer covers this control");
    await hostTools.click(selector,modifiers);
  }};
  await tools.evaluate("app.workspace.whenIdle()");
  assert.equal(await tools.evaluate("app.workspace.hasUnsavedChanges"),false,"The prepared runner has no unsaved drafts before opening the parent fixture");
  const parentPath=tools.host==="desktop"?"CRLF note.md":"Visual authoring parent.md";
  if(tools.host==="web"){
    await writeFile(join(tools.directory,parentPath),"\ufeff# Visual authoring parent\r\n\r\nKeep the saved parent Ω.\r\n",{flag:"wx"});
    await tools.evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  }
  await tools.evaluate('(async()=>{const file=app.vault.getFileByPath('+JSON.stringify(parentPath)+');if(!file)throw Error("The real runner parent fixture is missing");await app.workspace.activeLeaf.openFile(file);app.workspace.activeLeaf.view.setEditingMode("source",false);await app.workspace.whenIdle();await app.notifyEditor();await app.core.whenIdle()})()');
  await tools.wait('app.workspace.activeLeaf.view.file?.path==='+JSON.stringify(parentPath)+'&&app.workspace.activeLeaf.view.getEditingMode()==="source"&&app.workspace.activeLeaf.view.sourceEl.checkVisibility()&&!app.workspace.hasUnsavedChanges',"the real saved parent note is open in visible normal Source");
  report.visualAuthoringParentSetup=await tools.evaluate('(()=>{const v=app.workspace.activeLeaf.view;return{path:v.file.path,leafId:v.leaf.id,mode:v.getEditingMode(),text:v.session.text,version:v.savedDocument.version,bom:v.savedDocument.hasBom===true,dirty:v.session.dirty}})()');
  for(const [name,check] of [["canvasWorkflows",checkCanvasWorkflows],["graphSharing",checkGraphSharing],["outgoingNewDestination",checkOutgoingNewDestination]]){
    try{await check(tools);}catch(error){failures.push({name,error:String(error?.stack??error)});}
  }
  if(failures.length)throw new AggregateError(failures.map(item=>new Error(item.name+": "+item.error)),"Canvas, Graph and new-destination workflows failed");
  const {evaluate,wait,command,click,afterReload}=tools;
  const localRoot=await evaluate("app.vault.rootPath"),localUrl=await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.whenIdle();await app.workspace.flushLayout();await app.core.whenIdle()})()");
  assert.equal(await evaluate("app.workspace.hasUnsavedChanges"),false,"Each local fixture must finish its own saves/Undo before the cached-vault boundary");
  const workspace={version:1,main:{id:"readonly-visual-authoring-main",type:"split",direction:"vertical",children:[{id:"readonly-visual-authoring-tabs",type:"tabs",currentTab:0,children:[{id:"readonly-visual-authoring",type:"leaf",state:{type:"markdown",state:{file:"Read only.md",mode:"source",source:true}}}]}]},active:"readonly-visual-authoring"};
  const fixtures=[];
  for(const exported of [outgoingNewDestinationReadOnlyFixture,canvasWorkflowsReadOnlyFixture,graphSharingReadOnlyFixture])fixtures.push(typeof exported==="function"?await exported(report):exported);
  assert.ok(fixtures.every(fixture=>fixture&&Array.isArray(fixture.files)));
  const source=fixtures.map(fixture=>fixture.sourceAddition??fixture.source??"").filter(Boolean).join("\n\n");assert.ok(source.length);
  const files=new Map([["Read only.md",source]]);
  for(const fixture of fixtures)for(const [path,content] of fixture.files){assert.equal(files.has(path),false,"Unique cached fixture path: "+path);files.set(path,content);}
  for(const [path,content] of [[".obsidian/app.json",'{"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"Visual authoring"}}'],[".obsidian/workspace.json",JSON.stringify(workspace)],[".obsidian/core-plugins.json",'["command-palette","file-explorer","graph","canvas","outgoing-link"]'],[".obsidian/community-plugins.json","[]"]]){assert.equal(files.has(path),false,"Common fixture config is parent-owned: "+path);files.set(path,content);}
  const fixture=await mountCachedGitHub(evaluate,"visual-authoring",[...files]);
  await wait('app.vault.rootPath==='+JSON.stringify(fixture.mount.id)+'&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-visual-authoring"',"genuine cached visual-authoring vault");
  assert.equal(await evaluate("app.vault.readOnly"),true);
  await click("#github-vault-offline");await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"',"fresh cached index state");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"',"complete genuine cached Markdown index");
  for(const type of ["rawKeyDown","keyUp"])await command("Input.dispatchKeyEvent",{type,key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await wait('!document.querySelector("[data-github-offline-dialog]")',"cached index dialog closes");
  await evaluate("app.metadataCache.refresh()");assert.equal(await evaluate("app.vault.indexComplete"),true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"),[...files.keys()].filter(path=>/\.md$/i.test(path)).length);
  await evaluate('(()=>{const leaf=app.workspace.getLeafById("readonly-visual-authoring"),view=leaf.view,editor=view.editor,cm=editor.cm,session=app.workspace.sessions.get("Read only.md");globalThis.visualAuthoringCachedOwner={leaf,view,editor,cm,doc:cm.state.doc,session,saved:session.document,text:session.text,dirty:session.dirty,root:app.vault.rootPath,file:view.file}})()');
  const checks=report.visualAuthoringCachedOwnerChecks=[];
  for(const [name,check] of [["canvasWorkflowsReadOnly",checkCanvasWorkflowsReadOnly],["graphSharingReadOnly",checkGraphSharingReadOnly],["outgoingNewDestinationReadOnly",checkOutgoingNewDestinationReadOnly]]){
    try{
      await evaluate('(async()=>{const leaf=app.workspace.getLeafById("readonly-visual-authoring");app.workspace.setActiveLeaf(leaf);leaf.view.setEditingMode("source",false);await app.core.whenIdle()})()');
      await check(tools);
      const observed=await evaluate('(()=>{const o=visualAuthoringCachedOwner,leaf=app.workspace.getLeafById("readonly-visual-authoring");return{sameLeaf:leaf===o.leaf,sameView:leaf?.view===o.view,sameEditor:leaf?.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:app.workspace.sessions.get("Read only.md")===o.session,sameSavedDocument:o.session.document===o.saved,sourceExact:o.session.text===o.text,dirtyExact:o.session.dirty===o.dirty,sameRoot:app.vault.rootPath===o.root,sameFile:o.view.file===o.file&&app.vault.getFileByPath("Read only.md")===o.file}})()');
      checks.push({name,observed});for(const [key,value]of Object.entries(observed))assert.equal(value,true,name+" preserves original cached owner: "+key);
    }catch(error){failures.push({name,error:String(error?.stack??error)});}
  }
  assert.deepEqual(await evaluate("(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()"),{api:0,raw:0});
  await assertCachedBlobsUnchanged(evaluate,fixture.blobs);await tools.capture?.("readonly-combined");
  await evaluate("delete globalThis.visualAuthoringCachedOwner");
  await command("Page.navigate",{url:localUrl});await afterReload();assert.equal(await evaluate("app.vault.rootPath"),localRoot);assert.equal(await evaluate("app.vault.readOnly"),false);
  await assertCachedBlobsUnchanged(evaluate,fixture.blobs);
  if(failures.length)throw new AggregateError(failures.map(item=>new Error(item.name+": "+item.error)),"Cached visual-authoring workflows failed");
  report.visualAuthoring={readOnly:{genuineCachedMount:true,completeIndex:true,zeroApiRaw:true,exactBlobsBeforeAndAfterLocalReturn:true}};
  report.checks.push("A genuine complete cached vault retains Canvas previews and Graph exports while new-destination authoring refuses before IO; every original Source owner and cached blob remains exact through local return.");
}
