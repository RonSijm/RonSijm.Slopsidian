import assert from "node:assert/strict";
import { openExplorerOptions } from "./explorer-options-scenarios.mjs";
import {mkdir,readFile,writeFile,unlink} from "node:fs/promises";
import {join} from "node:path";

const q=JSON.stringify, mime="application/x-slopsidian-selected-notes";
const sourceId="crosspane-drop-source", targetId="crosspane-drop-target", noteId="crosspane-drop-note";
const pane=id=>`[data-file-explorer=${q(id)}]`,row=(id,path)=>`${pane(id)} [data-explorer-path=${q(path)}]`;
const action=(id,name)=>`${pane(id)} [data-explorer-action=${q(name)}]`;
const modal="[data-explorer-move]",control=name=>`${modal} [data-explorer-move-${name}]`;
const bytes=text=>Buffer.from("\ufeff"+text), pass=(tools,message)=>{tools.report.checks.push(message);console.log("PASS "+message);};
export const crosspaneDropReadOnlyFixture={files:[]}; // Reuses the combined fixture's Drop folder/Kept.md.

async function choose(tools,id,paths){
 if(await tools.evaluate(`document.querySelector(${q(action(id,"select-notes"))}).getAttribute("aria-pressed")!=="true"`)){await openExplorerOptions(tools,pane(id));await tools.click(action(id,"select-notes"));}
 if(await tools.evaluate(`document.querySelector(${q(action(id,"clear-selection"))})?.disabled===false`))await tools.click(action(id,"clear-selection"));
 for(const[index,path]of paths.entries())await tools.click(row(id,path),index?2:0);
 assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(pane(id)+' [data-explorer-selected="true"]')})].map(r=>r.dataset.explorerPath))()`),paths);
}
async function point(tools,selector){return tools.evaluate(`(()=>{const e=document.querySelector(${q(selector)});if(!e)throw Error("Missing cross-pane drag target");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);}
async function gesture(tools,from,to,{beforeTarget,hover,finalTarget}={}){
 await tools.command("Page.bringToFront");const start=await point(tools,from);let end=start;
 await tools.command("Input.setInterceptDrags",{enabled:true});await tools.evaluate("crosspaneDropTrace.started=null");
 try{
  await tools.command("Input.dispatchMouseEvent",{type:"mouseMoved",...start});
  await tools.command("Input.dispatchMouseEvent",{type:"mousePressed",...start,button:"left",buttons:1,clickCount:1});
  await tools.command("Input.dispatchMouseEvent",{type:"mouseMoved",x:start.x+16,y:start.y+2,button:"left",buttons:1});
  await tools.wait("crosspaneDropTrace.started!==null","a real pointer gesture starts the cross-pane group drag");
  const started=await tools.evaluate("crosspaneDropTrace.started");assert.equal(started.trusted,true);assert.deepEqual(started.items.map(i=>i.mimeType),[mime]);assert.equal(started.items[0].data.length,36);
  if(beforeTarget)await beforeTarget(started);
  end=await point(tools,to);const data={items:started.items,dragOperationsMask:16};
  for(const type of ["dragEnter","dragOver"])await tools.command("Input.dispatchDragEvent",{type,...end,data});
  if(hover)await hover(started);
  end=await point(tools,finalTarget??to);
  for(const type of ["dragOver","drop"])await tools.command("Input.dispatchDragEvent",{type,...end,data});
  return started;
 }finally{
  await tools.command("Input.dispatchMouseEvent",{type:"mouseReleased",...end,button:"left",clickCount:1});
  await tools.command("Input.setInterceptDrags",{enabled:false});
  await tools.command("Input.cancelDragging",{});
 }
}

/** Real HTML5 pointer gestures cross two independently owned Files panes; drop remains a review. */
export async function checkCrosspaneDrops(tools){
 const{directory,evaluate,command,click,wait,capture,restart,afterReload,report}=tools;
 const base="Cross-pane drops",incoming=base+"/In",destination=base+"/Dest",nested=destination+"/Nested",taken=base+"/Taken";
 const a=incoming+"/A λ.md",b=incoming+"/B.md",anchor=base+"/Anchor.md",canvas=base+"/Board.canvas",asset=base+"/kept.bin",extra=base+"/Z refresh.md";
 const movedA=nested+"/A λ.md",movedB=nested+"/B.md";
 const aText="# Alpha λ\r\n\r\nCross-pane source λ 😀.\r\n",bText="# Beta\r\n\r\nSecond source Ω.\r\n";
 const anchorText="# Anchor\r\n\r\n[[In/A λ#Alpha λ]] [B](./In/B.md#Beta)\r\n\r\nRetain unrelated Ω.\r\n";
 const board={nodes:[{id:"file",type:"file",x:0,y:0,width:240,height:160,file:a,subpath:"#Alpha λ",opaque:{keep:"λ"}}],edges:[],opaque:{keep:"😀"}};
 const serialize=value=>JSON.stringify(value,null,2).replaceAll("\n","\r\n")+"\r\n";
 const expected=new Map([[a,bytes(aText)],[b,bytes(bText)],[anchor,bytes(anchorText)],[canvas,bytes(serialize(board))],[asset,Buffer.from([0,255,13,10])],
  [nested+"/Kept.md",bytes("# Kept target\r\n")],[taken+"/A λ.md",bytes("# Occupied\r\n")]]),absent=new Set();
 const exact=async()=>{for(const[path,value]of expected)assert.deepEqual(await readFile(join(directory,path)),value,path);for(const path of absent)await assert.rejects(readFile(join(directory,path)),{code:"ENOENT"});};
 await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
 const previous=await evaluate("app.workspace.getLayout()"),enabled=await evaluate('app.core.isEnabled("file-explorer")'),autosave=await evaluate("app.markdownAutosave.enabled");
 const filesLeaf=(id,collapsedFolders=[])=>({id,type:"leaf",state:{type:"file-explorer",pinned:true,state:{showSearch:false,searchQuery:"",collapsedFolders,opaque:{keep:id}}}});
 const layout={version:1,main:{id:"crosspane-drop-main",type:"split",direction:"vertical",children:[
  {id:"crosspane-drop-source-tabs",type:"tabs",dimension:33,currentTab:0,children:[filesLeaf(sourceId)]},
  {id:"crosspane-drop-target-tabs",type:"tabs",dimension:33,currentTab:0,children:[filesLeaf(targetId,[destination])]},
  {id:"crosspane-drop-note-tabs",type:"tabs",dimension:34,currentTab:0,children:[{id:noteId,type:"leaf",state:{type:"markdown",pinned:true,state:{file:a,mode:"source",source:true}}}]}
 ]},active:sourceId};
 const live=`document.querySelector(${q(pane(sourceId)+" select")})?.disabled===false&&document.querySelector(${q(pane(targetId)+" select")})?.disabled===false`;
 const restore='(()=>{const t=globalThis.crosspaneDropTrace;if(t?.rename)app.fileManager.renameFile=t.rename;t?.abort?.abort();t?.sourceObserver?.disconnect();app.workspace.getLeafById("crosspane-drop-source")?.view.clearNoteDrag?.();app.workspace.getLeafById("crosspane-drop-target")?.view.clearNoteDrag?.();return true})()';
 const install=()=>evaluate(`(()=>{const old=globalThis.crosspaneDropTrace;old?.abort?.abort();const rename=old?.rename??app.fileManager.renameFile;const t=globalThis.crosspaneDropTrace={events:old?.events??[],calls:old?.calls??[],abort:new AbortController(),rename};app.fileManager.renameFile=function(...a){t.calls.push({from:a[0].path,to:a[1]});return t.rename.apply(this,a)};for(const type of ["dragstart","dragover","drop","dragend"])document.addEventListener(type,e=>{const owner=e.target.closest?.("[data-file-explorer]")?.dataset.fileExplorer;if(owner!==${q(sourceId)}&&owner!==${q(targetId)})return;t.events.push({type,owner,trusted:e.isTrusted,types:[...e.dataTransfer.types]});if(type==="dragstart")t.started={trusted:e.isTrusted,owner,paths:app.workspace.getLeafById(owner).view.noteDrag?.plan.items.map(i=>i.path),items:[...e.dataTransfer.types].map(mimeType=>({mimeType,data:e.dataTransfer.getData(mimeType)}))}},{signal:t.abort.signal});return true})()`);
 const resetLayout=async()=>{await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);await wait(live,"both independent Files panes are interactive");};
 let stage="fixture",failure;
 try{
  if(!enabled)await evaluate('app.core.setEnabled("file-explorer",true)');if(autosave)await evaluate("app.markdownAutosave.setEnabled(false)");
  for(const path of[incoming,nested,taken])await mkdir(join(directory,path),{recursive:true});for(const[path,value]of expected)await writeFile(join(directory,path),value,{flag:"wx"});
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");await resetLayout();await install();
  stage="cross-pane hover review and cancel";await choose(tools,sourceId,[a,b]);await choose(tools,targetId,[anchor]);
  assert.equal(await evaluate(`document.querySelector(${q(row(targetId,destination))}).getAttribute("aria-expanded")`),"false");
  const started=await gesture(tools,row(sourceId,a),row(targetId,destination),{hover:async()=>{
   assert.equal(await evaluate(`document.querySelector(${q(row(targetId,destination))}).getAttribute("aria-expanded")`),"false","the first dragOver must not unfold synchronously");
   await wait(`document.querySelector(${q(row(targetId,destination))}).getAttribute("aria-expanded")==="true"&&Boolean(document.querySelector(${q(row(targetId,nested))}))`,"a retained real drag unfolds its exact hovered folder after 750ms");
   assert.equal(await evaluate(`app.workspace.getLeafById(${q(targetId)}).getViewState().state.collapsedFolders.includes(${q(destination)})`),false,"hover expansion updates the ordinary saved folder state");
   assert.equal(await evaluate(`Boolean(app.workspace.getLeafById(${q(sourceId)}).view.noteDrag)`),true);await capture?.("crosspane-drop-hover-expanded");
  },finalTarget:row(targetId,nested)});
  assert.deepEqual(started.paths,[a,b]);assert.equal(started.owner,sourceId);
  await wait(`Boolean(document.querySelector(${q(modal)}))`,"cross-pane drop opens the source group's ordinary move review");
  assert.equal(await evaluate(`document.querySelector(${q(control("folder"))}).value`),nested);assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);
  assert.deepEqual(await evaluate("crosspaneDropTrace.calls"),[]);await exact();await click(control("review"));
  await wait(`document.querySelector(${q(control("confirm"))})?.disabled===false`,"the cross-pane source group is explicitly reviewed");
  assert.deepEqual(await evaluate(`(()=>[...document.querySelectorAll(${q(control("preview")+" li")})].map(r=>r.textContent))()`),[a+" → "+movedA,b+" → "+movedB]);
  assert.deepEqual(await evaluate(`(()=>[...document.querySelectorAll(${q(pane(targetId)+' [data-explorer-selected="true"]')})].map(r=>r.dataset.explorerPath))()`),[anchor]);
  await capture?.("crosspane-drop-review");await click(control("cancel"));await wait(`!document.querySelector(${q(modal)})`,"cross-pane cancellation closes the review");await exact();
  assert.deepEqual(await evaluate("crosspaneDropTrace.calls"),[]);
  pass(tools,"A genuine pointer drag crosses independent Files panes, waits before expanding the exact hovered folder, and reviews the source's two selected notes at the nested destination. The receiving pane's unrelated selection is preserved; drop, Review and Cancel perform no file mutation.");

  stage="same-pane retained DOM and native cancellation";await click(row(sourceId,destination));
  assert.equal(await evaluate(`document.querySelector(${q(row(sourceId,destination))}).getAttribute("aria-expanded")`),"false");
  await gesture(tools,row(sourceId,a),row(sourceId,destination),{beforeTarget:async()=>{
   await evaluate(`(()=>{const t=crosspaneDropTrace;t.dragRow=document.querySelector(${q(row(sourceId,a))});t.sourceRemovals=0;t.sourceObserver=new MutationObserver(records=>{for(const record of records)if([...record.removedNodes].includes(t.dragRow))t.sourceRemovals++});t.sourceObserver.observe(t.dragRow.parentElement,{childList:true});return true})()`);
  },hover:async()=>{
   await wait(`document.querySelector(${q(row(sourceId,destination))}).getAttribute("aria-expanded")==="true"`,"a same-pane native gesture expands without replacing its source");
   assert.equal(await evaluate(`crosspaneDropTrace.dragRow===document.querySelector(${q(row(sourceId,a))})&&crosspaneDropTrace.dragRow.isConnected&&crosspaneDropTrace.sourceRemovals===0`),true);
   const canceled=await point(tools,row(sourceId,destination)),items=await evaluate("crosspaneDropTrace.started.items");
   await command("Input.dispatchDragEvent",{type:"dragCancel",...canceled,data:{items,dragOperationsMask:16}});
   await command("Input.cancelDragging",{});
   await wait(`!app.workspace.getLeafById(${q(sourceId)}).view.noteDrag&&!app.workspace.getLeafById(${q(sourceId)}).view.noteDragHover`,"native browser cancellation retires the expanded gesture and hover");
   await evaluate("crosspaneDropTrace.sourceObserver.disconnect()");
  }});
  assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();assert.deepEqual(await evaluate("crosspaneDropTrace.calls"),[]);
  pass(tools,"Same-pane hover expansion keeps the actual native drag source row attached with identical DOM identity and no removal records. Native browser cancellation retires the gesture and its hover state; replaying that captured token cannot open review or mutate files.");

  stage="hover leave and revoked inventory";await resetLayout();await choose(tools,sourceId,[a,b]);
  await gesture(tools,row(sourceId,a),row(targetId,destination),{hover:async()=>{
   const end=await point(tools,row(targetId,anchor)),items=await evaluate("crosspaneDropTrace.started.items");
   await command("Input.dispatchDragEvent",{type:"dragOver",...end,data:{items,dragOperationsMask:16}});
   await evaluate("new Promise(resolve=>setTimeout(resolve,825))");
   assert.equal(await evaluate(`document.querySelector(${q(row(targetId,destination))}).getAttribute("aria-expanded")`),"false");
  },finalTarget:row(targetId,anchor)});
  assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();
  await gesture(tools,row(sourceId,a),row(targetId,destination),{beforeTarget:async()=>{
   await writeFile(join(directory,extra),bytes("# Physical inventory change\r\n"),{flag:"wx"});await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
   await wait(`!app.workspace.getLeafById(${q(sourceId)}).view.noteDrag`,"a physical inventory refresh retires the source gesture");
  }});assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();await unlink(join(directory,extra));await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  assert.deepEqual(await evaluate("crosspaneDropTrace.calls"),[]);
  pass(tools,"Leaving a folded target cancels hover expansion, and a real physical inventory refresh revokes the held cross-pane drag. Nonfolder and retired tokens cannot open a review, expand folders later or change exact original/reference/attachment bytes.");

  stage="source and destination disposal";await choose(tools,sourceId,[a,b]);
  await gesture(tools,row(sourceId,a),row(targetId,destination),{beforeTarget:async()=>{
   await evaluate(`app.workspace.getLeafById(${q(sourceId)}).setViewState({type:"empty",state:{}})`);
  }});assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();
  await resetLayout();await choose(tools,sourceId,[a,b]);
  await gesture(tools,row(sourceId,a),row(targetId,destination),{hover:async()=>{
   await evaluate(`(async()=>{const leaf=app.workspace.getLeafById(${q(targetId)});await leaf.setViewState({type:"empty",state:{}});await leaf.setViewState({type:"file-explorer",state:{showSearch:true,searchQuery:${q(base)},collapsedFolders:[${q(destination)}]}})})()`);
   await wait(live,"the receiving leaf has a replacement Files owner");
   assert.equal(await evaluate(`Boolean(app.workspace.getLeafById(${q(sourceId)}).view.noteDrag)`),false);
  }});assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();assert.deepEqual(await evaluate("crosspaneDropTrace.calls"),[]);
  pass(tools,"Disposing the real source view or the hovered receiving view revokes the gesture. A replacement Files view at the same leaf cannot inherit its old opaque token or authorize a move; originals and references remain exact.");

  stage="collision and foreign token";await resetLayout();await choose(tools,sourceId,[a,b]);
  const stale=await gesture(tools,row(sourceId,a),row(targetId,taken));await wait(`Boolean(document.querySelector(${q(modal)}))`,"an occupied target is only a review destination");await click(control("review"));
  await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("occupied or duplicated")`,"the cross-pane collision refuses all destinations");assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);await exact();await capture?.("crosspane-drop-collision");await click(control("cancel"));
  const end=await point(tools,row(targetId,destination));for(const items of[stale.items,[{mimeType:mime,data:"foreign-crosspane-token"}]])for(const type of["dragEnter","dragOver","drop"])await command("Input.dispatchDragEvent",{type,...end,data:{items,dragOperationsMask:16}});
  assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();assert.deepEqual(await evaluate("crosspaneDropTrace.calls"),[]);
  pass(tools,"Cross-pane moves keep ordinary collision refusal: review enables no partial group and generates no filenames. Consumed and forged opaque tokens cannot reopen a move review or mutate files.");

  stage="confirm cross-pane group";await choose(tools,sourceId,[a,b]);await choose(tools,targetId,[anchor]);
  await gesture(tools,row(sourceId,a),row(targetId,destination),{hover:async()=>{await wait(`Boolean(document.querySelector(${q(row(targetId,nested))}))`,"a new current gesture expands the receiving folder again");},finalTarget:row(targetId,nested)});
  await wait(`Boolean(document.querySelector(${q(modal)}))`,"a fresh cross-pane review opens");await click(control("review"));await wait(`document.querySelector(${q(control("confirm"))})?.disabled===false`,"fresh exact destinations are reviewed");
  await evaluate(`(()=>{const v=app.workspace.getLeafById(${q(noteId)}).view;crosspaneDropTrace.editor=v.editor;crosspaneDropTrace.cm=v.editor.cm;return true})()`);await click(control("confirm"));
  await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&app.vault.getFileByPath(${q(movedA)})&&app.vault.getFileByPath(${q(movedB)})`,"two ordinary cross-pane FileManager renames finish");
  expected.delete(a);expected.delete(b);absent.add(a);absent.add(b);expected.set(movedA,bytes(aText));expected.set(movedB,bytes(bText));
  expected.set(anchor,bytes(anchorText.replace("[[In/A λ#","[["+nested+"/A λ#").replace("./In/B.md","./Dest/Nested/B.md")));
  const changedBoard=structuredClone(board);changedBoard.nodes[0].file=movedA;expected.set(canvas,bytes(serialize(changedBoard)));await exact();
  assert.deepEqual(await evaluate("crosspaneDropTrace.calls"),[{from:a,to:movedA},{from:b,to:movedB}]);
  assert.equal(await evaluate(`app.workspace.getLeafById(${q(noteId)}).view.file.path`),movedA);assert.equal(await evaluate(`app.workspace.getLeafById(${q(noteId)}).view.editor===crosspaneDropTrace.editor&&app.workspace.getLeafById(${q(noteId)}).view.editor.cm===crosspaneDropTrace.cm`),true);
  assert.deepEqual(await evaluate(`(()=>[...document.querySelectorAll(${q(pane(targetId)+' [data-explorer-selected="true"]')})].map(r=>r.dataset.explorerPath))()`),[anchor]);await capture?.("crosspane-drop-complete");
  report.crosspaneDropEvents=await evaluate("crosspaneDropTrace.events");assert.ok(report.crosspaneDropEvents.filter(e=>e.type==="dragstart").length>=7);assert.ok(report.crosspaneDropEvents.every(e=>e.trusted));
  pass(tools,"Confirming the cross-pane source group performs exactly two ordinary FileManager moves, retains the receiving pane's independent selection and remaps the existing open editor without replacing its history owner. Notes, Markdown references, Canvas file targets and unrelated binary data retain exact BOM/CRLF/Unicode bytes.");

  stage="restart";await evaluate(restore);await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");if(restart)await restart();else await command("Page.reload");await afterReload();
  await wait(live,"both Files panes restore after real restart or folder reconnection");await exact();
  for(const id of[sourceId,targetId]){
   assert.equal(await evaluate(`document.querySelector(${q(action(id,"select-notes"))}).getAttribute("aria-pressed")`),"false");
   assert.equal(await evaluate(`Boolean(app.workspace.getLeafById(${q(id)}).view.noteDrag||app.workspace.getLeafById(${q(id)}).view.noteDragHover)`),false);
  }
  assert.equal(await evaluate(`document.querySelector(${q(row(targetId,destination))}).getAttribute("aria-expanded")`),"true");await capture?.("crosspane-drop-restored");
  report.crosspaneDrops={trustedCrossPanePointer:true,opaqueMimeOnly:true,sourceOwnsGroup:true,independentDestinationSelection:true,reviewBeforeMutation:true,cancelExact:true,delayedHoverExpansion:true,samePaneSourceDomRetained:true,nativeCancelRetiresExpandedDrag:true,canceledTokenCannotReplay:true,hoverLeaveCancels:true,inventoryRefreshRevokes:true,sourceDisposalRevokes:true,destinationReplacementRevokes:true,collisionRefused:true,foreignAndReplayRefused:true,twoNormalMoves:true,exactBytesAndReferences:true,editorIdentityPreserved:true,restartExact:true,foldPreferenceRetained:true,transientDragAndSelectionReset:true};
  pass(tools,"Actual restart or browser folder reconnection preserves confirmed cross-pane destinations, exact references and the receiving folder's expanded preference, while both panes discard transient selections, opaque drag tokens and hover timers.");
 }catch(error){failure=error;report.crosspaneDropFailure={stage,error:String(error?.stack??error)};try{report.crosspaneDropFailure.state=await evaluate(`(()=>({source:app.workspace.getLeafById(${q(sourceId)})?.view.getViewType(),target:app.workspace.getLeafById(${q(targetId)})?.view.getViewType(),drag:Boolean(app.workspace.getLeafById(${q(sourceId)})?.view.noteDrag),modal:document.querySelector(${q(modal)})?.textContent,trace:globalThis.crosspaneDropTrace?.events}))()`);await capture?.("crosspane-drop-precleanup-failure");}catch{}throw error;
 }finally{
  const errors=[];try{await command("Input.setInterceptDrags",{enabled:false});await evaluate(restore);await wait("!app.workspace.isChangingFiles","cross-pane cleanup waits for normal owned file operations");await evaluate(`app.workspace.getLeafById(${q(sourceId)})?.view.selectionModal?.dispose()`);}catch(error){errors.push(error);}
  try{await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(previous)});await app.workspace.flushLayout();if(app.core.isEnabled("file-explorer")!==${enabled})await app.core.setEnabled("file-explorer",${enabled});await app.markdownAutosave.setEnabled(${autosave});delete globalThis.crosspaneDropTrace})()`);}catch(error){errors.push(error);}if(!failure&&errors.length)throw new AggregateError(errors,"Could not restore cross-pane drop fixture.");
 }
}

/** Two real read-only panes expose no writable drag, review or hover expansion. */
export async function checkCrosspaneDropsReadOnly(tools){
 const{evaluate,command,click,wait,capture,report}=tools,source="crosspane-readonly-source",target="crosspane-readonly-target";
 assert.equal(await evaluate("app.vault.readOnly"),true);const previous=await evaluate("app.workspace.getLayout()"),inventory=await evaluate("app.vault.getFiles().map(f=>f.path).sort()");
 const layout={version:1,main:{id:"crosspane-ro-main",type:"split",direction:"vertical",children:[source,target].map((id,index)=>({id:id+"-tabs",type:"tabs",dimension:50,currentTab:0,children:[{id,type:"leaf",state:{type:"file-explorer",state:{collapsedFolders:index?["Drop folder"]:[]}}}]}))},active:source};
 try{
  await evaluate(`app.workspace.changeLayout(${q(layout)})`);await wait(`document.querySelector(${q(pane(source)+" select")})?.disabled===false&&document.querySelector(${q(pane(target)+" select")})?.disabled===false`,"two genuine cached Files panes support ordinary browsing");
  await choose(tools,source,["Known target.md","Read only.md"]);await choose(tools,target,["Known target.md"]);
  const from=row(source,"Known target.md"),to=row(target,"Drop folder");assert.equal(await evaluate(`document.querySelector(${q(from)}).draggable`),false);
  const start=await point(tools,from),end=await point(tools,to);await command("Page.bringToFront");
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",...start});await command("Input.dispatchMouseEvent",{type:"mousePressed",...start,button:"left",buttons:1,clickCount:1});await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:start.x+16,y:start.y+2,button:"left",buttons:1});await command("Input.dispatchMouseEvent",{type:"mouseReleased",...end,button:"left",clickCount:1});
  const data={items:[{mimeType:mime,data:"foreign-cached-crosspane-token"}],dragOperationsMask:16};for(const type of["dragEnter","dragOver","drop"])await command("Input.dispatchDragEvent",{type,...end,data});
  await evaluate("new Promise(resolve=>setTimeout(resolve,825))");
  assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);assert.equal(await evaluate(`document.querySelector(${q(to)}).getAttribute("aria-expanded")`),"false");
  for(const id of[source,target])assert.equal(await evaluate(`Boolean(app.workspace.getLeafById(${q(id)}).view.noteDrag||app.workspace.getLeafById(${q(id)}).view.noteDragHover)`),false);
  assert.deepEqual(await evaluate("app.vault.getFiles().map(f=>f.path).sort()"),inventory);await capture?.("crosspane-drop-readonly");
  report.crosspaneDropsReadOnly={genuineCacheOnly:true,twoIndependentPanes:true,actualSelection:true,rowsNotDraggable:true,noReviewOrHoverExpansion:true,foreignTokenRefused:true,inventoryExact:true};
  pass(tools,"Two genuine cached read-only Files panes retain independent selections and ordinary browsing but expose no writable drag, cross-pane review or delayed expansion. Actual pointer and forged-token input preserve inventory; the parent audits every cached blob and zero network requests.");
 }finally{await evaluate(`app.workspace.changeLayout(${q(previous)})`);}
}
