import assert from "node:assert/strict";
import { openExplorerOptions } from "./explorer-options-scenarios.mjs";
import { mkdir,readFile,writeFile,unlink } from "node:fs/promises";
import { join } from "node:path";

const q=JSON.stringify,bytes=text=>Buffer.from("\ufeff"+text),mime="application/x-slopsidian-selected-notes",id="explorer-drop-files",note="explorer-drop-note";
const pane=`[data-file-explorer=${q(id)}]`,row=path=>`${pane} [data-explorer-path=${q(path)}]`,action=name=>`${pane} [data-explorer-action=${q(name)}]`,modal="[data-explorer-move]",control=name=>`${modal} [data-explorer-move-${name}]`;
const pass=(tools,message)=>{tools.report.checks.push(message);console.log("PASS "+message);};
export const explorerDropReadOnlyFixture={files:[["Drop folder/Kept.md","# Keep cached destination\r\n"]]};
async function choose(tools,paths){
 if(await tools.evaluate(`document.querySelector(${q(action("select-notes"))}).getAttribute("aria-pressed")!=="true"`)){await openExplorerOptions(tools,pane);await tools.click(action("select-notes"));}
 if(await tools.evaluate(`document.querySelector(${q(action("clear-selection"))})?.disabled===false`))await tools.click(action("clear-selection"));
 for(const[index,path]of paths.entries())await tools.click(row(path),index?2:0);
 assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(pane+' [data-explorer-selected="true"]')})].map(r=>r.dataset.explorerPath))()`),paths);
}
async function point(tools,selector){return tools.evaluate(`(()=>{const e=document.querySelector(${q(selector)});e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);}
async function drag(tools,from,to,beforeDrop){
 await tools.command("Page.bringToFront");const start=await point(tools,from);
 await tools.command("Input.setInterceptDrags",{enabled:true});await tools.evaluate("explorerDropTrace.started=null");let end=start;
 try{
  await tools.command("Input.dispatchMouseEvent",{type:"mouseMoved",...start});
  await tools.command("Input.dispatchMouseEvent",{type:"mousePressed",...start,button:"left",buttons:1,clickCount:1});
  await tools.command("Input.dispatchMouseEvent",{type:"mouseMoved",x:start.x+16,y:start.y+2,button:"left",buttons:1});
  await tools.wait("explorerDropTrace.started!==null","a genuine pointer gesture starts the selected-note drag");
  const started=await tools.evaluate("explorerDropTrace.started");assert.equal(started.trusted,true);assert.equal(started.items.length,1);assert.equal(started.items[0].mimeType,mime);assert.equal(started.items[0].data.length,36);
  if(beforeDrop)await beforeDrop(started);
  end=await point(tools,to);
  for(const type of ["dragEnter","dragOver","drop"])await tools.command("Input.dispatchDragEvent",{type,...end,data:{items:started.items,dragOperationsMask:16}});
  return started;
 }finally{
  await tools.command("Input.dispatchMouseEvent",{type:"mouseReleased",...end,button:"left",clickCount:1});await tools.command("Input.setInterceptDrags",{enabled:false});
 }
}

/** Same-pane native drag opens the ordinary versioned move review against disposable real files. */
export async function checkExplorerDrops(tools){
 const{directory,evaluate,command,click,wait,capture,restart,afterReload,report}=tools,base="Files drops",incoming=base+"/In",destination=base+"/Dest",taken=base+"/Taken";
 const a=incoming+"/A λ.md",b=incoming+"/B.md",movedA=destination+"/A λ.md",movedB=destination+"/B.md",anchor=base+"/Anchor.md",canvas=base+"/Board.canvas",asset=base+"/kept.bin",extra=base+"/Z refresh.md";
 const aText="# Alpha λ\r\n\r\nExact source λ 😀.\r\n",bText="# Beta\r\n\r\nExact second Ω.\r\n",anchorText="# Anchor\r\n\r\n[[In/A λ#Alpha λ]] [B](./In/B.md#Beta)\r\n\r\nKeep unrelated Ω.\r\n";
 const board={nodes:[{id:"file",type:"file",x:0,y:0,width:240,height:160,file:a,subpath:"#Alpha λ",opaque:{keep:"λ"}},{id:"text",type:"text",x:280,y:0,width:240,height:160,text:"[[In/A λ#Alpha λ]] [B](./In/B.md#Beta) `[[In/A λ]]`"}],edges:[],opaque:{keep:"😀"}},serialize=value=>JSON.stringify(value,null,2).replaceAll("\n","\r\n")+"\r\n";
 const expected=new Map([[a,bytes(aText)],[b,bytes(bText)],[anchor,bytes(anchorText)],[canvas,bytes(serialize(board))],[asset,Buffer.from([0,255,13,10])],[taken+"/A λ.md",bytes("# Occupied destination\r\n")]]),absent=new Set();
 const exact=async()=>{for(const[path,value]of expected)assert.deepEqual(await readFile(join(directory,path)),value,path);for(const path of absent)await assert.rejects(readFile(join(directory,path)),{code:"ENOENT"});};
 await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
 const previous=await evaluate("app.workspace.getLayout()"),enabled=await evaluate('app.core.isEnabled("file-explorer")'),autosave=await evaluate("app.markdownAutosave.enabled");
 const layout={version:1,main:{id:"explorer-drop-main",type:"split",direction:"vertical",children:[{id:"explorer-drop-files-tabs",type:"tabs",dimension:45,currentTab:0,children:[{id,type:"leaf",state:{type:"file-explorer",pinned:true,state:{showSearch:true,searchQuery:base,opaque:{keep:"drop review"}}}}]},{id:"explorer-drop-note-tabs",type:"tabs",dimension:55,currentTab:0,children:[{id:note,type:"leaf",state:{type:"markdown",pinned:true,state:{file:a,mode:"source",source:true}}}]}]},active:id};
 let stage="fixture",failure;
 const restore='(()=>{const t=globalThis.explorerDropTrace;if(t?.rename)app.fileManager.renameFile=t.rename;t?.abort?.abort();app.workspace.getLeafById("explorer-drop-files")?.view.clearNoteDrag();return true})()';
 try{
  if(!enabled)await evaluate('app.core.setEnabled("file-explorer",true)');if(autosave)await evaluate("app.markdownAutosave.setEnabled(false)");
  for(const path of [incoming,destination,taken])await mkdir(join(directory,path),{recursive:true});for(const[path,value]of expected)await writeFile(join(directory,path),value,{flag:"wx"});
  await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  await wait(`document.querySelector(${q(pane+" select")})?.disabled===false`,"the actual Files drop pane is ready");
  await evaluate(`(()=>{const t=globalThis.explorerDropTrace={events:[],calls:[],abort:new AbortController(),rename:app.fileManager.renameFile};app.fileManager.renameFile=function(...a){t.calls.push({from:a[0].path,to:a[1]});return t.rename.apply(this,a)};for(const type of ["dragstart","dragover","drop","dragend"])document.addEventListener(type,e=>{if(!e.target.closest?.(${q(pane)}))return;const entry={type,trusted:e.isTrusted,types:[...e.dataTransfer.types]};t.events.push(entry);if(type==="dragstart")t.started={trusted:e.isTrusted,items:[...e.dataTransfer.types].map(mimeType=>({mimeType,data:e.dataTransfer.getData(mimeType)}))}},{signal:t.abort.signal});return true})()`);
  stage="prefilled review and cancellation";await choose(tools,[a,b]);assert.equal(await evaluate(`document.querySelector(${q(row(a))}).draggable`),true);assert.equal(await evaluate(`document.querySelector(${q(row(asset))}).draggable`),false);
  await drag(tools,row(a),row(destination));await wait(`Boolean(document.querySelector(${q(modal)}))`,"the trusted folder drop opens a review");
  assert.equal(await evaluate(`document.querySelector(${q(control("folder"))}).value`),destination);assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);assert.deepEqual(await evaluate("explorerDropTrace.calls"),[]);await exact();
  await click(control("review"));await wait(`document.querySelector(${q(control("confirm"))})?.disabled===false`,"drop destinations are explicitly reviewed");
  assert.deepEqual(await evaluate(`(()=>[...document.querySelectorAll(${q(control("preview")+" li")})].map(r=>r.textContent))()`),[a+" → "+movedA,b+" → "+movedB]);await capture?.("explorer-drop-review");await exact();assert.deepEqual(await evaluate("explorerDropTrace.calls"),[]);
  await click(control("cancel"));await wait(`!document.querySelector(${q(modal)})`,"cancellation closes the dropped-folder review");await exact();
  pass(tools,"A genuine native pointer drag carries both selected Markdown notes to an existing same-pane folder and opens the ordinary move review with that exact folder preselected. Drop, Review and Cancel perform no rename; exact BOM/CRLF/Unicode/reference/attachment bytes and selection remain intact.");

  stage="nonfolder and stale render refusal";await drag(tools,row(a),row(b));await wait(`!document.querySelector(${q(modal)})`,"dropping onto a note cannot authorize a folder move");await exact();
  await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.cm.contentDOM.dataset.explorerDropEditor="true"`);
  const editorBefore=await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`);await drag(tools,row(a),'[data-explorer-drop-editor="true"]');
  assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`),editorBefore);assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();
  await drag(tools,row(a),row(destination),async()=>{await writeFile(join(directory,extra),bytes("# Independent refresh\r\n"),{flag:"wx"});await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");await wait(`!app.workspace.getLeafById(${q(id)}).view.noteDrag`,"a real inventory render revokes the held drag");});
  await wait(`!document.querySelector(${q(modal)})`,"the old drag token cannot survive a real inventory redraw");await exact();assert.deepEqual(await evaluate("explorerDropTrace.calls"),[]);await unlink(join(directory,extra));await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  const end=await point(tools,row(destination));for(const type of ["dragEnter","dragOver","drop"])await command("Input.dispatchDragEvent",{type,...end,data:{items:[{mimeType:mime,data:"foreign-token"}],dragOperationsMask:16}});
  assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await exact();
  pass(tools,"A native drop onto another note is refused, and dropping onto the writable real CodeMirror editor preserves its source: the drag carries only an opaque custom MIME, with no plain text to insert. An independent physical inventory change revokes a held real drag; replayed and foreign tokens cannot open a review or rename anything. Exact originals and references are preserved.");

  stage="occupied dropped destination";await choose(tools,[a,b]);await drag(tools,row(a),row(taken));await wait(`Boolean(document.querySelector(${q(modal)}))`,"the occupied folder is only a review destination");await click(control("review"));
  await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("occupied or duplicated")`,"a real destination collision refuses the dropped plan");assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);await exact();assert.deepEqual(await evaluate("explorerDropTrace.calls"),[]);await capture?.("explorer-drop-collision");await click(control("cancel"));
  pass(tools,"Dropping into a genuinely occupied destination never generates filenames or moves a partial group: the ordinary Review destinations action reports the collision with confirmation disabled and every original byte retained.");

  stage="two confirmed normal moves";await choose(tools,[a,b]);await drag(tools,row(a),row(destination));await wait(`Boolean(document.querySelector(${q(modal)}))`,"a fresh native drag opens a fresh review");await click(control("review"));await wait(`document.querySelector(${q(control("confirm"))})?.disabled===false`,"the fresh group is explicitly reviewed");
  await evaluate(`(()=>{const v=app.workspace.getLeafById(${q(note)}).view;explorerDropTrace.editor=v.editor;explorerDropTrace.cm=v.editor.cm;return true})()`);await click(control("confirm"));
  await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&app.vault.getFileByPath(${q(movedA)})&&app.vault.getFileByPath(${q(movedB)})`,"both real versioned FileManager moves finish");
  expected.delete(a);expected.delete(b);absent.add(a);absent.add(b);expected.set(movedA,bytes(aText));expected.set(movedB,bytes(bText));expected.set(anchor,bytes(anchorText.replace("[[In/A λ#","[["+destination+"/A λ#").replace("./In/B.md","./Dest/B.md")));
  const movedBoard=structuredClone(board);movedBoard.nodes[0].file=movedA;movedBoard.nodes[1].text="[[Files drops/Dest/A λ#Alpha λ]] [B](./Dest/B.md#Beta) `[[In/A λ]]`";expected.set(canvas,bytes(serialize(movedBoard)));await exact();
  assert.deepEqual(await evaluate("explorerDropTrace.calls"),[{from:a,to:movedA},{from:b,to:movedB}]);assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.file.path`),movedA);assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor===explorerDropTrace.editor&&app.workspace.getLeafById(${q(note)}).view.editor.cm===explorerDropTrace.cm`),true);await capture?.("explorer-drop-complete");
  report.explorerDropEvents=await evaluate("explorerDropTrace.events");assert.ok(report.explorerDropEvents.filter(e=>e.type==="dragstart").length>=4);assert.ok(report.explorerDropEvents.every(e=>e.trusted));
  pass(tools,"Confirming a fresh dropped-folder review runs exactly two normal FileManager renames. Moved notes, Markdown/wiki and Canvas file/text references retain exact BOM/CRLF/Unicode bytes and unrelated data, attachments stay exact, and the open editor keeps its identity at the new path.");

  stage="restart";await evaluate(restore);await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");if(restart)await restart();else await command("Page.reload");await afterReload();
  await wait(`document.querySelector(${q(pane+" select")})?.disabled===false`,"the Files pane restores after actual restart/reconnection");await exact();assert.equal(await evaluate(`document.querySelector(${q(action("select-notes"))}).getAttribute("aria-pressed")`),"false");assert.equal(await evaluate(`Boolean(app.workspace.getLeafById(${q(id)}).view.noteDrag)`),false);assert.equal(await evaluate(`document.querySelector(${q(row(movedA))}).draggable`),false);await capture?.("explorer-drop-restored");
  report.explorerDrops={trustedNativeGroupDrag:true,samePaneFolderOnly:true,opaqueMimeWithoutTextFallback:true,editorDropPreservesSource:true,exactPrefilledReview:true,noMutationUntilConfirmation:true,cancelExact:true,nonfolderRefused:true,realInventoryRedrawRevokesDrag:true,foreignReplayRefused:true,occupiedDestinationRefused:true,twoNormalMoves:true,markdownAndCanvasReferences:true,exactBomCrlfUnicode:true,openEditorPreserved:true,restartExact:true,transientDragAndSelectionReset:true};
  pass(tools,"Full native restart or real-folder browser reconnection retains the confirmed destinations and exact references, restores Files preferences, and drops transient selection/drag state. Ordinary browsing rows are not draggable until notes are explicitly selected again.");
 }catch(error){failure=error;report.explorerDropFailure={stage,error:String(error?.stack??error)};try{report.explorerDropFailure.state=await evaluate(`(()=>({drag:Boolean(app.workspace.getLeafById(${q(id)})?.view.noteDrag),dragPaths:app.workspace.getLeafById(${q(id)})?.view.noteDrag?.plan.items.map(i=>i.path),modal:document.querySelector(${q(modal)})?.textContent,trace:globalThis.explorerDropTrace?.events,files:app.vault.getFiles().map(f=>f.path).filter(p=>p.startsWith(${q(base)}))}))()`);await capture?.("explorer-drop-precleanup-failure");}catch{}throw error;
 }finally{
  const errors=[];try{await command("Input.setInterceptDrags",{enabled:false});await evaluate(restore);await wait("!app.workspace.isChangingFiles","drop cleanup waits for owned file operations");await evaluate(`app.workspace.getLeafById(${q(id)})?.view.selectionModal?.dispose()`);}catch(error){errors.push(error);}
  try{await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(previous)});await app.workspace.flushLayout();if(app.core.isEnabled("file-explorer")!==${enabled})await app.core.setEnabled("file-explorer",${enabled});await app.markdownAutosave.setEnabled(${autosave});delete globalThis.explorerDropTrace})()`);}catch(error){errors.push(error);}if(!failure&&errors.length)throw new AggregateError(errors,"Could not restore Files drop fixture.");
 }
}

/** The parent prepares and audits a genuine cached mount, including the exported destination fixture. */
export async function checkExplorerDropsReadOnly(tools){
 const{evaluate,command,click,wait,capture,report}=tools,ro="explorer-drop-readonly",base=`[data-file-explorer=${q(ro)}]`;
 assert.equal(await evaluate("app.vault.readOnly"),true);const previous=await evaluate("app.workspace.getLayout()"),inventory=await evaluate("app.vault.getFiles().map(f=>f.path).sort()");
 const layout={version:1,main:{id:"drop-ro-main",type:"split",direction:"vertical",children:[{id:"drop-ro-tabs",type:"tabs",currentTab:0,children:[{id:ro,type:"leaf",state:{type:"file-explorer",state:{}}}]}]},active:ro};
 try{
  await evaluate(`app.workspace.changeLayout(${q(layout)})`);await wait(`document.querySelector(${q(base+" select")})?.disabled===false`,"actual cached Files controls permit selection");await openExplorerOptions(tools,base);await click(base+' [data-explorer-action="select-notes"]');
  for(const[index,path]of ["Known target.md","Read only.md"].entries())await click(base+` [data-explorer-path=${q(path)}]`,index?2:0);
  const source=base+' [data-explorer-path="Known target.md"]',target=base+' [data-explorer-path="Drop folder"]';assert.equal(await evaluate(`document.querySelector(${q(source)}).draggable`),false);
  const start=await point(tools,source),end=await point(tools,target);await command("Page.bringToFront");
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",...start});await command("Input.dispatchMouseEvent",{type:"mousePressed",...start,button:"left",buttons:1,clickCount:1});await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:start.x+16,y:start.y+2,button:"left",buttons:1});await command("Input.dispatchMouseEvent",{type:"mouseReleased",...end,button:"left",clickCount:1});
  for(const type of ["dragEnter","dragOver","drop"])await command("Input.dispatchDragEvent",{type,...end,data:{items:[{mimeType:mime,data:"cached-foreign-token"}],dragOperationsMask:16}});
  assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);assert.equal(await evaluate(`Boolean(app.workspace.getLeafById(${q(ro)}).view.noteDrag)`),false);assert.deepEqual(await evaluate("app.vault.getFiles().map(f=>f.path).sort()"),inventory);await capture?.("explorer-drop-readonly");
  report.explorerDropsReadOnly={genuineCacheOnly:true,actualSelection:true,rowsNotDraggable:true,trustedPointerAndForeignDropRefused:true,noReviewOrMutation:true,inventoryExact:true};
  pass(tools,"A genuine cached read-only Files pane selects real Markdown notes but keeps them non-draggable. Trusted pointer and foreign-drop input cannot open a move review or change inventory; the parent verifies every cached byte and zero network requests.");
 }finally{await evaluate(`app.workspace.changeLayout(${q(previous)})`);}
}
