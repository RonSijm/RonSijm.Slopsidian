import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";

const q=JSON.stringify, host='[data-property-workflow-root="true"]', bytes=text=>Buffer.from("\ufeff"+text);
const row=property=>host+' [data-property-key='+q(property)+']';
const field=property=>row(property)+' [data-metadata-input]:not([data-property-edit-index])';
const editField=index=>row("labels")+' [data-property-edit-index='+q(String(index))+']';
const creation=(path,subpath)=>host+' [data-property-create-heading='+q(path)+'][data-property-heading-subpath='+q(subpath)+']';
const issue=property=>row(property)+' .metadata-property-error';
const pass=(report,message)=>{report.checks.push(message);console.log("PASS "+message);};
async function key(tools,value,code=value,number=value==="Enter"?13:value==="Tab"?9:value==="Escape"?27:value==="ArrowDown"?40:65,modifiers=0){
 const event={key:value,code,windowsVirtualKeyCode:number,nativeVirtualKeyCode:number,modifiers};
 await tools.command("Input.dispatchKeyEvent",{type:value==="Enter"?"keyDown":"rawKeyDown",...event,...(value==="Enter"?{text:"\r",unmodifiedText:"\r"}:{})});
 await tools.command("Input.dispatchKeyEvent",{type:"keyUp",...event});
}
async function fill(tools,selector,value){await tools.click(selector);await key(tools,"a","KeyA",65,2);if(value)await tools.command("Input.insertText",{text:value});else await key(tools,"Backspace","Backspace",8);}
async function mark(tools){await tools.evaluate('(()=>{document.querySelectorAll("[data-property-workflow-root]").forEach(node=>delete node.dataset.propertyWorkflowRoot);app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertyWorkflowRoot="true";return true})()');}
async function cancel(tools,property="status"){await tools.click(field(property));await key(tools,"Escape");await key(tools,"Escape");}
async function ctrlClick(tools,selector){const point=await tools.evaluate('(()=>{const node=document.querySelector('+q(selector)+');node.scrollIntoView({block:"center",inline:"nearest"});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node,visible:node.checkVisibility()&&r.width>0&&r.height>0}})()');assert.ok(point.hit&&point.visible);for(const type of["mouseMoved","mousePressed","mouseReleased"])await tools.command("Input.dispatchMouseEvent",{type,x:point.x,y:point.y,modifiers:2,...(type==="mouseMoved"?{}:{button:"left",clickCount:1})});}

const targetText='# Known heading\r\n\r\nTarget paragraph λ ^workflow-block\r\n\r\n# Completion heading Ω\r\n';
const storedLink='[[./Targets/Target#Known heading|Known λ]]';
const sourceText='---\r\n# Exact Properties source λ\r\nstatus: Open # keep comment\r\nlabels: [ kept, '+JSON.stringify(storedLink)+' ]\r\nrelated: "[[./Targets/Target#^workflow-block|Block λ]]"\r\ncount: 1.50\r\nopaque: { keep: "λ 😀" }\r\n---\r\nParent λ\r\n  ====\r\n\r\nUnchanged parent body.\r\n\r\n  # Sibling Ω\r\n\r\nUnchanged sibling body.\r\n';
const headings=(text,lines)=>text.replace('  # Sibling Ω',lines.join('\r\n\r\n')+'\r\n\r\n  # Sibling Ω');
const propertyValue=(text,property,value)=>property==='status'?text.replace('status: Open #','status: '+JSON.stringify(value)+' #'):text.replace('labels: [ kept, '+JSON.stringify(storedLink)+' ]','labels: [ kept, '+JSON.stringify(storedLink)+', '+JSON.stringify(value)+' ]');

export const propertyWorkflowsReadOnlyFixture=Object.freeze({
 source:'---\r\nrelated: "[[Known target#Workflow cached target λ|Cached scalar λ]]"\r\nlinks: [ kept, "[[Known target#^workflow-cache|Cached block λ]]" ]\r\n---\r\n# Workflow cached source λ\r\n\r\nOriginal source remains exact.\r\n',
 targetAddition:'\r\n# Workflow cached target λ\r\n\r\nCached block target Ω ^workflow-cache\r\n'
});

/** Root owns frozen builds, genuine directory picking, final error audits and shutdown. */
export async function checkPropertyWorkflows(tools){
 const{directory,evaluate,wait,click,capture,report,restart,afterReload}=tools,folder="Property workflows",path=folder+"/Source.md",target=folder+"/Targets/Target.md";
 const configPath=join(directory,".obsidian/app.json"),configBytes=await readFile(configPath),config=JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/,""));
 await evaluate('(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()');
 const layout=await evaluate('app.workspace.getLayout()'),enabled=await evaluate('app.core.isEnabled("properties")'),autosave=await evaluate('app.markdownAutosave.enabled');
 const source='app.workspace.sessions.get('+q(path)+')';let expectedTarget=targetText;
 const exact=async expected=>{await wait(source+'?.text==='+q(expected)+'&&!'+source+'.dirty&&!'+source+'.isSaving','exact combined Properties source is saved');assert.deepEqual(await readFile(join(directory,path)),bytes(expected));assert.deepEqual(await readFile(join(directory,target)),bytes(expectedTarget));};
 const open=async(mode="preview")=>{await evaluate('(async()=>{await app.openFile('+q(path)+');const view=app.workspace.activeLeaf.view;view.setEditingMode("source",false);view.setEditingMode('+q(mode)+',false);view.metadataEditor.render(true)})()');await mark(tools);await wait('Boolean(document.querySelector('+q(field("status"))+')?.checkVisibility())','current Properties workflow source controls');};
 const offer=async(property,query,subpath)=>{await cancel(tools,property);await fill(tools,field(property),query);await wait('Boolean(document.querySelector('+q(creation(path,subpath))+')?.checkVisibility())','explicit reviewed same-note heading action');return evaluate('document.querySelector('+q(creation(path,subpath))+').dataset.propertyValueChoice');};
 const undo=async expected=>{await evaluate('(()=>{const view=[...'+source+'.leaves][0];view.editor.undo();return true})()');await evaluate('app.saveAll()');await exact(expected);};
 const restore='(()=>{const t=globalThis.propertyWorkflowTrace;if(!t)return true;if(t.assign)app.fileManager.assignMarkdownSubpath=t.assign;if(t.write)app.vault.writeDocument=t.write;if(t.session&&t.reload)t.session.reload=t.reload;t.release?.();t.abort?.abort();return true})()';
 let failure,stage="fixture";
 try{
  if(!enabled)await evaluate('app.core.setEnabled("properties",true)');
  await mkdir(join(directory,folder,"Targets"),{recursive:true});await writeFile(join(directory,path),bytes(sourceText),{flag:"wx"});await writeFile(join(directory,target),bytes(targetText),{flag:"wx"});
  await writeFile(configPath,JSON.stringify({...config,markdownAutosave:false,newLinkFormat:"shortest",useMarkdownLinks:true},null,2));
  await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()');await open();
  const inventory=await evaluate('app.vault.getFiles().map(file=>file.path).sort()');
  await evaluate('(()=>{const t=globalThis.propertyWorkflowTrace={trusted:[],assigns:0,writes:[],abort:new AbortController()};t.assign=app.fileManager.assignMarkdownSubpath;app.fileManager.assignMarkdownSubpath=function(...args){t.assigns++;return t.assign.apply(this,args)};t.write=app.vault.writeDocument;app.vault.writeDocument=async function(path,...args){const result=await t.write.call(this,path,...args);if(path.startsWith('+q(folder+"/")+'))t.writes.push({path,text:result.content});return result};for(const type of["pointerdown","keydown"])document.addEventListener(type,event=>{const owner=event.target.closest?.('+q(host)+');if(owner)t.trusted.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()');
  stage="same-note Reading Live Preview list and fixed pane creation";
  const cases=[
   ["preview","status","[[#Parent λ#Reading branch λ#Reading leaf Ω","Parent λ#Reading branch λ#Reading leaf Ω",["## Reading branch λ","### Reading leaf Ω"],"pointer"],
   ["live-preview","status","[["+path.slice(0,-3)+"#Parent λ#LP leaf Ω","Parent λ#LP leaf Ω",["## LP leaf Ω"],"Enter"],
   ["preview","labels","[[#Parent λ#List branch λ#List leaf Ω","Parent λ#List branch λ#List leaf Ω",["## List branch λ","### List leaf Ω"],"Tab"],
   ["pane","status","[["+path.slice(0,-3)+"#Parent λ#Pane leaf Ω","Parent λ#Pane leaf Ω",["## Pane leaf Ω"],"Enter"]
  ];
  for(const[mode,property,query,subpath,lines,input]of cases){
   await open(mode==="pane"?"preview":mode);
   if(mode==="pane"){await evaluate('(async()=>{const pane=app.workspace.getLeaf("split");await pane.setViewState({type:"file-properties",state:{file:'+q(path)+',followActiveFile:false},active:true});})()');await mark(tools);}
   const value=await offer(property,query,subpath),expected=propertyValue(headings(sourceText,lines),property,value);
   assert.ok(value.endsWith("#"+subpath+"]]"));if(query.startsWith("[[#"))assert.equal(value,"[[#"+subpath+"]]");
   assert.match(await evaluate('document.querySelector('+q(creation(path,subpath))+').title'),/Undo removes the link and new headings together/);await exact(sourceText);await capture?.("property-workflows-"+mode+"-"+property);
   if(input==="pointer")await click(creation(path,subpath));else{await key(tools,"ArrowDown");assert.equal(await evaluate('document.querySelector('+q(creation(path,subpath))+').getAttribute("aria-selected")'),"true");await key(tools,input);}
   await exact(expected);assert.equal(await evaluate('propertyWorkflowTrace.assigns'),0);assert.equal(await evaluate('app.vault.getFileByPath('+q(path)+').path'),path);
   await undo(sourceText);await evaluate('(()=>{[...'+source+'.leaves][0].editor.redo();return true})()');await evaluate('app.saveAll()');await exact(expected);await undo(sourceText);
   if(mode==="pane")await evaluate('app.workspace.closeLeaf(app.workspace.activeLeaf)');
  }
  pass(report,"Trusted Reading, Live Preview and fixed Properties text/list-add controls create empty-path and named same-note heading chains beneath unchanged indented Setext ancestry. YAML growth shifts source offsets safely; exact BOM/CRLF/comments/opaque fields survive. One Undo/Redo removes/restores both link and all headings, with zero separate target-authoring calls.");

  stage="cancellation and existing list edit";await open();await offer("status","[[#Parent λ#Cancelled branch λ","Parent λ#Cancelled branch λ");await cancel(tools);await exact(sourceText);
  const editButton=index=>row("labels")+' [data-property-edit-value='+q(String(index))+']';
  assert.equal(await evaluate('document.querySelector('+q(editButton(0))+').textContent.trim()'),"Edit");
  await click(editButton(0));await fill(tools,editField(0),"Cancelled list λ");await capture?.("property-workflows-active-list-draft");await key(tools,"Tab");await key(tools,"Tab");assert.equal(await evaluate('document.activeElement?.dataset.propertyCancelValue'),"0");await exact(sourceText);await key(tools,"Enter");assert.equal(await evaluate('Boolean(document.querySelector('+q(editField(0))+'))'),false);await exact(sourceText);
  await click(editButton(0));await fill(tools,editField(0),"Edited ordinary value λ");await click(row("labels")+' [data-property-apply-value="0"]');const edited=sourceText.replace('labels: [ kept,','labels: [ Edited ordinary value λ,');await exact(edited);await undo(sourceText);
  await open();await click(editButton(0));await fill(tools,editField(0),"[["+target.slice(0,-3)+"#Completion heading Ω");
  const known=row("labels")+' [data-property-link-target='+q(target)+'][data-property-subpath="#Completion heading Ω"]';
  await wait('Boolean(document.querySelector('+q(known)+')?.checkVisibility())','existing heading completion in an ordinary list member editor');const selected=await evaluate('document.querySelector('+q(known)+').dataset.propertyValueChoice');await key(tools,"ArrowDown");await key(tools,"Enter");const linked=sourceText.replace('labels: [ kept,','labels: [ '+JSON.stringify(selected)+',');await exact(linked);await undo(sourceText);
  await open();await click(editButton(0));await fill(tools,editField(0),storedLink);await key(tools,"Enter");await wait('Boolean(document.querySelector('+q(issue("labels"))+')?.textContent)','duplicate list edit reports a local error');await exact(sourceText);await key(tools,"Escape");await key(tools,"Escape");await capture?.("property-workflows-list-editor");
  pass(report,"Existing ordinary string-list members have explicit Edit, Apply and Cancel controls. Trusted keyboard/pointer replacement and existing-heading completion retain order, exact source and one-step Undo; Escape cancels and duplicate values refuse without changing source. Missing headings require their separate list-add creation action.");

  stage="queued same-note physical conflict";await open();const conflictSubpath="Parent λ#Refused conflict λ";await offer("status","[[#"+conflictSubpath,conflictSubpath);
  await evaluate('(()=>{const t=propertyWorkflowTrace;t.session='+source+';t.reload=t.session.reload;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);t.session.reload=async function(...args){if(!t.waiting){t.waiting=true;await t.gate}return t.reload.apply(this,args)};return true})()');
  await click(creation(path,conflictSubpath));await wait('propertyWorkflowTrace.waiting','same-note YAML queue pauses before its real physical reload');await exact(sourceText);const external=sourceText+"External concurrent source Ω\r\n";await writeFile(join(directory,path),bytes(external));await evaluate('propertyWorkflowTrace.release()');
  await wait('Boolean(document.querySelector('+q(issue("status"))+')?.textContent)','same-note heading conflict is declined before its combined transaction');await evaluate('propertyWorkflowTrace.session.reload=propertyWorkflowTrace.reload;delete propertyWorkflowTrace.reload;delete propertyWorkflowTrace.session');await exact(external);assert.equal(await evaluate('propertyWorkflowTrace.assigns'),0);
  await cancel(tools);await writeFile(join(directory,path),bytes(sourceText));await evaluate('app.reloadFromDisk()');await open();await exact(sourceText);
  pass(report,"A genuine external replacement during the held source YAML queue is read by its normal reload and refuses same-note authoring before any speculative heading/link transaction. Newer physical/source bytes remain exact, with no separate target write or misleading retained-target Notice.");

  stage="existing scalar and list wiki navigation";await open();
  const scalarLink=row("related")+' [data-property-wiki-target='+q(target)+']';await evaluate('propertyWorkflowTrace.heldWikiAnchor=document.querySelector('+q(scalarLink)+')');expectedTarget=targetText+"Unrelated newer target body Ω\r\n";await writeFile(join(directory,target),bytes(expectedTarget));await evaluate('app.metadataCache.refresh()');assert.equal(await evaluate('propertyWorkflowTrace.heldWikiAnchor===document.querySelector('+q(scalarLink)+')'),true);
  for(const[property,subpath]of[["related","#^workflow-block"],["labels","#Known heading"]]){
   const selector=row(property)+' [data-property-wiki-target='+q(target)+']';await wait('Boolean(document.querySelector('+q(selector)+')?.checkVisibility())','stored Properties wiki value exposes a current target link');const sourceLeaf=await evaluate('app.workspace.activeLeaf.id'),before=await evaluate('app.workspace.leaves().length');await ctrlClick(tools,selector);
   await wait('app.workspace.getActiveFile()?.path==='+q(target)+'&&app.workspace.leaves().length==='+q(before+1),'trusted modified property link opens the existing target in a new tab');
   assert.equal(await evaluate('app.workspace.getLeafById('+q(sourceLeaf)+').view.file.path'),path);await exact(sourceText);assert.equal(await evaluate('app.workspace.activeLeaf.view.editor.getCursor().line'),subpath.startsWith("#^")?2:0);await evaluate('app.workspace.closeLeaf(app.workspace.activeLeaf)');await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById('+q(sourceLeaf)+'),{focus:true})');await mark(tools);
  }
  expectedTarget=targetText;await writeFile(join(directory,target),bytes(targetText));await evaluate('app.metadataCache.refresh()');await exact(sourceText);
  pass(report,"Stored whole-value scalar and list wiki links navigate existing heading/block targets through trusted modified clicks. New tabs retain the original Properties owner and exact source, and the target editor caret lands at the real section. Link controls never create missing notes.");

  stage="restart and current controls";await open();const persistedSubpath="Parent λ#Persisted workflow λ",persistedValue=await offer("status","[[#"+persistedSubpath,persistedSubpath);await click(creation(path,persistedSubpath));const persisted=propertyValue(headings(sourceText,["## Persisted workflow λ"]),"status",persistedValue);await exact(persisted);
  const trace=await evaluate('({trusted:propertyWorkflowTrace.trusted,assigns:propertyWorkflowTrace.assigns,writes:propertyWorkflowTrace.writes})');assert.equal(trace.assigns,0);assert.ok(trace.trusted.length>12&&trace.trusted.every(event=>event.trusted));report.propertyWorkflowInputs=trace.trusted;report.propertyWorkflowWrites=trace.writes.map(write=>({path:write.path}));
  await evaluate(restore);await evaluate('(async()=>{await app.saveAll();await app.workspace.flushLayout()})()');if(restart)await restart();else await tools.command("Page.reload");await afterReload();await open();await exact(persisted);assert.deepEqual(await evaluate('app.vault.getFiles().map(file=>file.path).sort()'),inventory);
  await offer("status","[[#Parent λ#Fresh after restart Ω","Parent λ#Fresh after restart Ω");await capture?.("property-workflows-restored");await cancel(tools);await exact(persisted);
  report.propertyWorkflows={sameNoteEmptyAndNamedPaths:true,readingAndLivePreview:true,fixedPropertiesPane:true,scalarAndListAddCreation:true,singleCombinedUndoRedo:true,yamlOffsetRevalidation:true,setextSourcePreserved:true,noSeparateTargetWrite:true,explicitListEditAndCancellation:true,listKnownHeadingCompletion:true,duplicateReplacementRefused:true,physicalSourceConflictRetained:true,scalarAndListNavigation:true,refreshedTargetNavigation:true,headingAndBlockCaret:true,exactBomCrLfOpaqueSource:true,trustedInputs:true,restartExactAndFreshControls:true};
  pass(report,"Full restart/browser reconnection preserves the exact combined Properties link and heading edit, target/source bytes and inventory. Fresh explicit same-note controls remain usable; all recorded acceptance inputs are trusted and no target-authoring operation was used.");
 }catch(error){failure=error;report.propertyWorkflowsFailure={stage,error:String(error?.stack??error)};try{report.propertyWorkflowsFailure.state=await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,source:'+source+'?.text,fields:[...document.querySelectorAll('+q(host+' [data-metadata-input]')+')].map(input=>({value:input.value,edit:input.dataset.propertyEditIndex,disabled:input.disabled,visible:input.checkVisibility()})),errors:[...document.querySelectorAll(".metadata-property-error")].filter(node=>node.textContent).map(node=>node.textContent),waiting:globalThis.propertyWorkflowTrace?.waiting}))()');await capture?.("property-workflows-precleanup-failure");}catch{}throw error;}
 finally{try{await evaluate(restore);await evaluate('app.saveAll()');await writeFile(configPath,configBytes);await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout('+q(layout)+');await app.workspace.flushLayout();delete globalThis.propertyWorkflowTrace})()');if(!enabled)await evaluate('app.core.setEnabled("properties",false)');if(autosave)await evaluate('app.markdownAutosave.setEnabled(true)');}catch(error){if(!failure)throw error;report.propertyWorkflowsFailure.cleanupError=String(error?.stack??error);}}
}

/** Parent mounts a complete genuine cached vault and audits blobs/API/raw counters. */
export async function checkPropertyWorkflowsReadOnly(tools){
 const{evaluate,wait,click,capture,report}=tools;assert.equal(await evaluate('app.vault.readOnly'),true);const sourceLeaf=await evaluate('app.workspace.activeLeaf.id');
 const before=await evaluate('app.vault.getFiles().map(file=>{const entry=app.metadataCache.getDocument(file.path);return{path:file.path,text:entry?.text,version:entry?.document.version,hasBom:entry?.document.hasBom}}).sort((a,b)=>a.path.localeCompare(b.path))');
 await evaluate('app.workspace.activeLeaf.view.setMode("preview")');await mark(tools);
 try{
  for(const property of["related","links"]){const selector=field(property);await wait('Boolean(document.querySelector('+q(selector)+')?.checkVisibility())','genuine read-only Properties workflow field');assert.equal(await evaluate('document.querySelector('+q(selector)+').disabled'),true);const previous=await evaluate('document.querySelector('+q(selector)+').value');
   await evaluate('(()=>{const input=document.querySelector('+q(selector)+');input.disabled=false;input.value="[[#Workflow cached source λ#Must not create";input.dispatchEvent(new InputEvent("input",{bubbles:true}));return true})()');assert.equal(await evaluate('document.querySelectorAll('+q(host+' [data-property-create-heading]')+').length'),0);await evaluate('(()=>{const input=document.querySelector('+q(selector)+');input.value='+q(previous)+';input.disabled=true;input.blur();return true})()');
  }
  const edit=row("links")+' [data-property-edit-value="0"]';assert.equal(await evaluate('document.querySelector('+q(edit)+').disabled'),true);await evaluate('document.querySelector('+q(edit)+').disabled=false');await click(edit);assert.equal(await evaluate('document.querySelectorAll('+q(host+' [data-property-edit-index]')+').length'),0);await evaluate('document.querySelector('+q(edit)+').disabled=true');await capture?.("property-workflows-readonly");
  for(const property of["related","links"]){const selector=row(property)+' [data-property-wiki-target="Known target.md"]';await wait('Boolean(document.querySelector('+q(selector)+')?.checkVisibility())','cached existing wiki property link remains navigable');await ctrlClick(tools,selector);await wait('app.workspace.getActiveFile()?.path==="Known target.md"','cached stored Properties link navigates without creating or editing');await evaluate('app.workspace.closeLeaf(app.workspace.activeLeaf)');await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById('+q(sourceLeaf)+'),{focus:true})');await mark(tools);}
  assert.deepEqual(await evaluate('app.vault.getFiles().map(file=>{const entry=app.metadataCache.getDocument(file.path);return{path:file.path,text:entry?.text,version:entry?.document.version,hasBom:entry?.document.hasBom}}).sort((a,b)=>a.path.localeCompare(b.path))'),before);
  report.propertyWorkflowsReadOnly={genuineTextAndListFields:true,forcedSameNoteCreationRefused:true,forcedListEditClickRefused:true,cachedScalarAndListNavigation:true,exactCachedSourceTargetVersionsAndInventory:true};pass(report,"A genuine cached read-only vault keeps same-note authoring and list editing disabled, even after forced eligible input/control activation. Stored scalar/list wiki links still open existing cached heading/block targets through trusted modified clicks; exact cached source, target versions/BOM and inventory survive for the parent’s zero-network/blob audit.");
 }finally{await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById('+q(sourceLeaf)+'),{focus:true});app.workspace.activeLeaf.view.setEditingMode("source",true)');}
}
