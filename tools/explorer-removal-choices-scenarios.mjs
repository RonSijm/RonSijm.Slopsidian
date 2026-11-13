import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const q=JSON.stringify,bytes=text=>Buffer.from("\ufeff"+text),id="removal-choices-files",note="removal-choices-note";
const pane=`[data-file-explorer=${q(id)}]`,modal="[data-explorer-trash]",control=name=>`${modal} [data-explorer-trash-${name}]`;
const action=name=>`${pane} [data-explorer-action=${q(name)}]`,row=path=>`${pane} [data-explorer-path=${q(path)}]`;
const pass=(tools,message)=>{tools.report.checks.push(message);console.log("PASS "+message);};
async function key(tools,key,code,number){
 for(const type of[key==="Enter"?"keyDown":"rawKeyDown","keyUp"])await tools.command("Input.dispatchKeyEvent",{type,key,code,windowsVirtualKeyCode:number,...(key==="Enter"&&type==="keyDown"?{text:"\r",unmodifiedText:"\r"}:{})});
}
async function chooseMode(tools,value){
 await tools.click(control("mode"));await key(tools,value==="permanent"?"End":"Home",value==="permanent"?"End":"Home",value==="permanent"?35:36);await key(tools,"Enter","Enter",13);
 await tools.wait(`document.querySelector(${q(control("mode"))})?.value===${q(value)}`,"the native removal-method control applies the explicit choice");
}
async function select(tools,paths){
 if(await tools.evaluate(`document.querySelector(${q(action("select-notes"))})?.getAttribute("aria-pressed")!=="true"`))await tools.click(action("select-notes"));
 if(await tools.evaluate(`document.querySelector(${q(action("clear-selection"))})?.disabled===false`))await tools.click(action("clear-selection"));
 for(const[index,path]of paths.entries())await tools.click(row(path),index?2:0);
 assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(pane+' [data-explorer-selected="true"]')})].map(element=>element.dataset.explorerPath))()`),paths);
}
async function open(tools,paths){
 await select(tools,paths);await tools.click(action("trash-selected"));await tools.wait(`Boolean(document.querySelector(${q(modal)}))`,"a fresh explicit selected-note removal review opens");
 assert.equal(await tools.evaluate(`document.querySelector(${q(control("mode"))}).value`),"vault");assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);
}
async function review(tools,paths,mode="vault",acknowledge=true){
 if(mode!=="vault")await chooseMode(tools,mode);
 await tools.click(control("review"));await tools.wait(`document.querySelector(${q(control("status"))})?.textContent.includes(${q(paths.length+" saved notes reviewed")})&&document.querySelector(${q(control("review"))})?.disabled===false`,"the exact current versions are reviewed for the selected method");
 const destination=mode==="permanent"?"permanent deletion":mode==="system"?"system trash":".trash";
 assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(control("preview")+" li")})].map(element=>element.textContent))()`),paths.map(path=>path+" → "+destination));
 if(mode==="permanent"){
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("acknowledge"))}).checked`),false);assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);
  assert.match(await tools.evaluate(`document.querySelector(${q(control("status"))}).textContent`),/Acknowledge permanent deletion/);
  if(acknowledge){await tools.click(control("acknowledge"));assert.doesNotMatch(await tools.evaluate(`document.querySelector(${q(control("status"))}).textContent`),/Acknowledge permanent deletion/);}
 }
 assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),mode==="permanent"&&!acknowledge);
}
async function disabledPointer(tools,selector){
 const point=await tools.evaluate(`(()=>{const element=document.querySelector(${q(selector)});element.scrollIntoView({block:"center"});const r=element.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===element}})()`);assert.equal(point.hit,true);
 for(const type of["mousePressed","mouseReleased"])await tools.command("Input.dispatchMouseEvent",{type,x:point.x,y:point.y,button:"left",clickCount:1});
}
async function trashContents(directory){
 const values=[];async function visit(path){for(const item of await readdir(path,{withFileTypes:true}).catch(error=>{if(error.code==="ENOENT")return[];throw error;})){const full=join(path,item.name);if(item.isDirectory())await visit(full);else if(item.isFile())values.push((await readFile(full)).toString("hex"));}}await visit(join(directory,".trash"));return values.sort();
}

/** Real native controls and checked actual-folder BrowserVault removal, on disposable notes only. */
export async function checkExplorerRemovalChoices(tools){
 const{directory,evaluate,wait,click,command,capture,restart,afterReload,report}=tools,base="Files removal choices";
 const a=base+"/A permanent λ.md",b=base+"/B permanent.md",c=base+"/C partial.md",d=base+"/D remaining.md",e=base+"/E recoverable λ.md",links=base+"/Links.md",asset=base+"/kept.bin";
 const contents=new Map([[a,bytes("# Alpha λ\r\n\r\nExact permanent 😀 source.\r\n")],[b,bytes("# Beta\r\n\r\nExact second Ω source.\r\n")],[c,bytes("# Partial first\r\n")],[d,bytes("# Remaining second\r\n")],[e,bytes("# Recoverable λ 😀\r\n")],[links,bytes("# Links\r\n\r\n[[A permanent λ]] [[B permanent]] ![[kept.bin]]\r\n")],[asset,Buffer.from([0,255,13,10])]]),remaining=new Set(contents.keys()),removed=new Set();
 await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
 const previous=await evaluate("app.workspace.getLayout()"),enabled=await evaluate('app.core.isEnabled("file-explorer")'),autosave=await evaluate("app.markdownAutosave.enabled"),preference=await evaluate('app.vault.getConfig("trashOption")??null');
 const layout={version:1,main:{id:"removal-choices-main",type:"split",direction:"vertical",children:[{id:"removal-choices-files-tabs",type:"tabs",dimension:45,currentTab:0,children:[{id,type:"leaf",state:{type:"file-explorer",pinned:true,state:{showSearch:true,searchQuery:base}}}]},{id:"removal-choices-note-tabs",type:"tabs",dimension:55,currentTab:0,children:[{id:note,type:"leaf",state:{type:"markdown",pinned:true,state:{file:a,mode:"source",source:true}}}]}]},active:id};
 const originalTrash=await trashContents(directory),exact=async()=>{for(const path of remaining)assert.deepEqual(await readFile(join(directory,path)),contents.get(path),path);for(const path of removed)await assert.rejects(readFile(join(directory,path)),{code:"ENOENT"});};
 const recordRemoval=path=>{remaining.delete(path);removed.add(path);};let stage="fixture",failure;
 const restore='(()=>{const t=globalThis.removalChoicesTrace;if(t?.info)app.vault.getFileInfo=t.info;if(t?.trash)app.fileManager.trashFile=t.trash;if(t?.remove)app.fileManager.deleteFile=t.remove;t?.release?.();t?.abort?.abort();return true})()';
 try{
  if(!enabled)await evaluate('app.core.setEnabled("file-explorer",true)');if(autosave)await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory,base));for(const[path,value]of contents)await writeFile(join(directory,path),value,{flag:"wx"});
  await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  await wait(`document.querySelector(${q(pane+" select")})?.disabled===false`,"the actual Files removal pane is ready");
  await evaluate('(()=>{const t=globalThis.removalChoicesTrace={events:[],calls:[],abort:new AbortController(),trash:app.fileManager.trashFile,remove:app.fileManager.deleteFile};app.fileManager.trashFile=function(...args){t.calls.push({kind:args[1]?"system":"vault",path:args[0].path});return t.trash.apply(this,args)};app.fileManager.deleteFile=function(...args){t.calls.push({kind:"permanent",path:args[0].path});return t.remove.apply(this,args)};for(const type of["click","change"])document.addEventListener(type,event=>{const target=event.target.closest?.("[data-explorer-action=trash-selected],[data-explorer-trash-mode],[data-explorer-trash-review],[data-explorer-trash-acknowledge],[data-explorer-trash-confirm],[data-explorer-trash-cancel]");if(target)t.events.push({type,trusted:event.isTrusted,action:target.dataset.explorerAction??target.textContent,value:target.value??null})},{capture:true,signal:t.abort.signal});return true})()');

  stage="default vault review";await open(tools,[a,b]);
  const capability=await evaluate("app.vault.supportsSystemTrash");assert.equal(await evaluate(`Boolean(document.querySelector(${q(control("mode")+' option[value="system"]')}))`),capability);
  await review(tools,[a,b]);await exact();assert.deepEqual(await trashContents(directory),originalTrash);assert.deepEqual(await evaluate("removalChoicesTrace.calls"),[]);await capture?.("explorer-removal-vault-review");await click(control("cancel"));await wait(`!document.querySelector(${q(modal)})`,"cancelling default vault review makes no removal");
  pass(tools,"Selected-note removal always opens in recoverable vault-trash mode. Exact paths/versions are reviewed without any file changes; cancellation keeps every source, reference, attachment and existing trash byte. The real host capability alone controls whether system trash is offered.");

  stage="permanent acknowledgement and changed method";await open(tools,[a,b]);await review(tools,[a,b],"permanent",false);await capture?.("explorer-removal-permanent-unacknowledged");
  await disabledPointer(tools,control("confirm"));await exact();assert.deepEqual(await evaluate("removalChoicesTrace.calls"),[]);await click(control("acknowledge"));assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),false);assert.doesNotMatch(await evaluate(`document.querySelector(${q(control("status"))}).textContent`),/Acknowledge permanent deletion/);await capture?.("explorer-removal-permanent-acknowledged");
  await chooseMode(tools,"vault");assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);assert.equal(await evaluate(`document.querySelectorAll(${q(control("preview")+" li")}).length`),0);assert.equal(await evaluate(`document.querySelector(${q(control("acknowledge"))}).checked`),false);
  await chooseMode(tools,"permanent");assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`),true);await click(control("cancel"));await exact();assert.deepEqual(await trashContents(directory),originalTrash);assert.deepEqual(await evaluate("removalChoicesTrace.calls"),[]);
  pass(tools,"The native removal-method control requires a fresh review after every method change. Permanent deletion stays disabled until a distinct trusted acknowledgement; trusted input on the disabled button and cancelling an acknowledged review remove nothing. Switching methods clears the old preview and acknowledgement.");

  stage="stale physical version";await open(tools,[a,b]);await review(tools,[a,b],"permanent");
  const newer=bytes("# Newer external λ\r\n\r\nKeep this replacement 😀.\r\n");await writeFile(join(directory,a),newer);await click(control("confirm"));
  await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("Confirmed 0 of 2")&&!app.workspace.isChangingFiles`,"the reviewed permanent version refuses a real replacement");assert.deepEqual(await readFile(join(directory,a)),newer);for(const path of [b,c,d,e,links,asset])assert.deepEqual(await readFile(join(directory,path)),contents.get(path));assert.deepEqual(await trashContents(directory),originalTrash);await capture?.("explorer-removal-stale");await click(control("cancel"));
  await writeFile(join(directory,a),contents.get(a));await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.whenIdle()})()");
  pass(tools,"An independent physical replacement after permanent review makes the ordinary FileManager refuse before any deletion. Newer BOM/CRLF/Unicode bytes, the second note, all incoming links/attachments and existing trash remain intact.");

  stage="two actual permanent removals";await open(tools,[a,b]);await review(tools,[a,b],"permanent");await click(control("confirm"));
  await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&!app.vault.getFileByPath(${q(a)})&&!app.vault.getFileByPath(${q(b)})`,"two real versioned permanent removals finish");recordRemoval(a);recordRemoval(b);await exact();assert.deepEqual(await trashContents(directory),originalTrash);assert.equal(await evaluate(`app.workspace.leaves().some(leaf=>[${q(a)},${q(b)}].includes(leaf.view.file?.path))`),false);
  assert.ok(await evaluate(`document.querySelector(${q(pane+' [role="status"]')})?.textContent.includes("Confirmed 2 of 2 notes permanently deleted")`));await capture?.("explorer-removal-permanent-complete");
  pass(tools,"Two actual checked-handle permanent removals delete only their reviewed Markdown versions and close removed-note views. They create no .trash copies; unrelated exact bytes, links and binary attachments remain untouched and Files reports both acknowledgements.");

  stage="partial permanent refusal";await open(tools,[c,d]);await review(tools,[c,d],"permanent");
  await evaluate(`(()=>{const t=removalChoicesTrace;t.info=app.vault.getFileInfo;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.getFileInfo=async function(file){if(file.path===${q(d)}){t.waiting=true;await t.gate;throw Error("Second reviewed removal version read refused")}return t.info.call(this,file)};return true})()`);
  await click(control("confirm"));await wait("removalChoicesTrace.waiting","the second real permanent-removal read waits after the first acknowledgement");recordRemoval(c);await exact();
  for(const name of["mode","acknowledge","review","confirm","cancel"])assert.equal(await evaluate(`document.querySelector(${q(control(name))}).disabled`),true);
  await key(tools,"Escape","Escape",27);assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),true);
  await evaluate("app.vault.getFileInfo=removalChoicesTrace.info;removalChoicesTrace.release();delete removalChoicesTrace.info");await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("Confirmed 1 of 2")&&!app.workspace.isChangingFiles&&!document.querySelector(${q(control("cancel"))}).disabled`,"the partial permanent result is retained and closable");
  for(const name of["mode","acknowledge","review","confirm"])assert.equal(await evaluate(`document.querySelector(${q(control(name))}).disabled`),true);await exact();assert.deepEqual(await trashContents(directory),originalTrash);await disabledPointer(tools,control("confirm"));await exact();await capture?.("explorer-removal-partial");await click(control("cancel"));
  pass(tools,"A real later version-read refusal preserves the first acknowledged permanent removal and the second exact original. Busy controls and Escape cannot dismiss the operation; the settled dialog reports 1 of 2, disables replay and leaves existing trash, links and attachments unchanged.");

  stage="vault-trash compatibility";await open(tools,[e]);await review(tools,[e]);assert.equal(await evaluate(`document.querySelector(${q(control("acknowledge"))}).parentElement.hidden`),true);await click(control("confirm"));await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&!app.vault.getFileByPath(${q(e)})`,"fresh default vault trash remains recoverable");recordRemoval(e);await exact();assert.deepEqual(await trashContents(directory),[...originalTrash,contents.get(e).toString("hex")].sort());assert.equal(await evaluate('app.vault.getConfig("trashOption")??null'),preference);
  pass(tools,"After permanent operations, a fresh dialog still defaults to vault trash. Its ordinary versioned removal retains the exact recoverable BOM/CRLF/Unicode note in physical .trash, without changing global removal preferences or following a previous destructive choice.");

  stage="restart";report.explorerRemovalChoiceInputs=await evaluate("removalChoicesTrace.events");report.explorerRemovalChoiceCalls=await evaluate("removalChoicesTrace.calls");assert.ok(report.explorerRemovalChoiceInputs.length>=20&&report.explorerRemovalChoiceInputs.every(event=>event.trusted));assert.equal(report.explorerRemovalChoiceCalls.some(call=>call.kind==="system"),false);
  await evaluate(restore);await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");if(restart)await restart();else await command("Page.reload");await afterReload();
  await wait(`app.workspace.getLeafById(${q(id)})?.view.getViewType()==="file-explorer"&&!app.workspace.isChangingLayout`,"Files returns after process restart or real-folder reconnection");await exact();assert.deepEqual(await trashContents(directory),[...originalTrash,contents.get(e).toString("hex")].sort());assert.equal(await evaluate(`document.querySelector(${q(action("select-notes"))}).getAttribute("aria-pressed")`),"false");assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);await capture?.("explorer-removal-restored");
  report.explorerRemovalChoices={defaultVault:true,explicitMethods:true,capabilityGatedSystemTrash:true,methodChangeInvalidatesReview:true,noMutationBeforeConfirm:true,separatePermanentAcknowledgement:true,cancelledPermanentRetained:true,physicalVersionReplacementRetained:true,twoRealPermanentRemovals:true,noPermanentTrashCopies:true,removedViewsClosed:true,exactBOMCRLFUnicode:true,linksAndAttachmentsExact:true,partialConfirmedOnly:true,busyControlsAndEscapeRefused:true,noPlanReplay:true,vaultTrashStillRecoverable:true,globalPreferenceUnchanged:true,restartAndTransientSelectionReset:true};
  pass(tools,"Actual process restart or real-folder browser reconnection retains every confirmed removal, exact remaining notes/links/attachments and the recoverable vault-trash copy. No selected notes, pending removal method or reviewed destructive plan survives restart.");
 }catch(error){failure=error;report.explorerRemovalChoicesFailure={stage,error:String(error?.stack??error)};try{report.explorerRemovalChoicesFailure.state=await evaluate(`({active:app.workspace.activeLeaf?.id,changingFiles:app.workspace.isChangingFiles,modal:document.querySelector(${q(modal)})?.textContent,inventory:app.vault.getFiles().map(file=>file.path).filter(path=>path.startsWith(${q(base+"/")}))})`);await capture?.("explorer-removal-precleanup-failure");}catch{/* Preserve the first failure. */}throw error;
 }finally{
  const errors=[];try{await evaluate(restore);await wait("!app.workspace.isChangingFiles","removal fixture cleanup releases its operation");await evaluate(`app.workspace.getLeafById(${q(id)})?.view.selectionModal?.dispose()`);}catch(error){errors.push(error);}
  try{await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(previous)});await app.workspace.flushLayout();if(app.core.isEnabled("file-explorer")!==${enabled})await app.core.setEnabled("file-explorer",${enabled});await app.markdownAutosave.setEnabled(${autosave});delete globalThis.removalChoicesTrace})()`);}catch(error){errors.push(error);}if(!failure&&errors.length)throw new AggregateError(errors,"Could not restore the reviewed removal fixture.");
 }
}

export const explorerRemovalChoicesReadOnlyFixture={files:[]};
/** Parent mounts and prepares the genuine cache-only fixture and audits every blob/network counter. */
export async function checkExplorerRemovalChoicesReadOnly(tools){
 const{evaluate,click,wait,report}=tools,previous=await evaluate("app.workspace.getLayout()"),ro="removal-choices-readonly",base=`[data-file-explorer=${q(ro)}]`;
 const layout={version:1,main:{id:"removal-choices-ro-main",type:"split",direction:"vertical",children:[{id:"removal-choices-ro-tabs",type:"tabs",currentTab:0,children:[{id:ro,type:"leaf",state:{type:"file-explorer",state:{}}}]}]},active:ro};
 const inventory=await evaluate("app.vault.getFiles().map(file=>file.path).sort()");assert.equal(await evaluate("app.vault.readOnly"),true);
 try{
  await evaluate(`app.workspace.changeLayout(${q(layout)})`);await wait(`document.querySelector(${q(base+" select")})?.disabled===false`,"cached Files is interactive while all removal choices stay unavailable");await click(base+' [data-explorer-action="select-notes"]');
  for(const[index,path]of["Known target.md","Read only.md"].entries())await click(base+` [data-explorer-path=${q(path)}]`,index?2:0);
  const selector=base+' [data-explorer-action="trash-selected"]';assert.equal(await evaluate(`document.querySelector(${q(selector)}).disabled`),true);await disabledPointer(tools,selector);assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),false);assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"),inventory);await tools.capture?.("explorer-removal-readonly");
  report.explorerRemovalChoicesReadOnly={genuineCacheOnly:true,actualSelection:true,allModesUnavailable:true,trustedPointerRefused:true,inventoryExact:true};
  pass(tools,"Genuine cache-only Files selection keeps the shared removal action disabled for vault trash, system trash and permanent deletion. Trusted pointer input opens no review and preserves the complete indexed inventory; the parent verifies exact blobs and zero API/raw traffic.");
 }finally{await evaluate(`app.workspace.changeLayout(${q(previous)})`);}
}
