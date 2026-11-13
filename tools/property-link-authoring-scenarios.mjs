import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";

const q=JSON.stringify,host='[data-property-link-authoring-root="true"]',bytes=text=>Buffer.from("\ufeff"+text);
const row=property=>host+' [data-property-key='+q(property)+']';
const field=property=>row(property)+' [data-metadata-input]:not([data-property-edit-index])';
const error=property=>row(property)+' .metadata-property-error';
const heading=(target,subpath)=>host+' [data-property-create-heading='+q(target)+'][data-property-heading-subpath='+q(subpath)+']';
const known=(target,label,subpath)=>host+' [data-property-link-target='+q(target)+'][data-property-display-text='+q(label)+']'+(subpath?'[data-property-subpath='+q(subpath)+']':':not([data-property-subpath])');
const pass=(report,message)=>{report.checks.push(message);console.log('PASS '+message);};
async function key(tools,value,code=value,number=value==='Enter'?13:value==='Tab'?9:value==='Escape'?27:value==='ArrowDown'?40:65,modifiers=0){
 const event={key:value,code,windowsVirtualKeyCode:number,nativeVirtualKeyCode:number,modifiers};
 await tools.command('Input.dispatchKeyEvent',{type:value==='Enter'?'keyDown':'rawKeyDown',...event,...(value==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
 await tools.command('Input.dispatchKeyEvent',{type:'keyUp',...event});
}
async function fill(tools,selector,value){await tools.click(selector);await key(tools,'a','KeyA',65,2);await tools.command('Input.insertText',{text:value});}
async function mark(tools){await tools.evaluate('(()=>{document.querySelectorAll("[data-property-link-authoring-root]").forEach(node=>delete node.dataset.propertyLinkAuthoringRoot);app.workspace.activeLeaf.view.metadataEditor.contentEl.dataset.propertyLinkAuthoringRoot="true";return true})()');}
async function cancel(tools,property='status'){await tools.click(field(property));await key(tools,'Escape');await key(tools,'Escape');}
async function modifiedClick(tools,selector){const point=await tools.evaluate('(()=>{const node=document.querySelector('+q(selector)+');node.scrollIntoView({block:"center",inline:"nearest"});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node,visible:node.checkVisibility()&&r.width>0&&r.height>0}})()');assert.ok(point.hit&&point.visible);for(const type of['mouseMoved','mousePressed','mouseReleased'])await tools.command('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,modifiers:2,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}

export const propertyLinkAuthoringReadOnlyFixture=Object.freeze({
 source:'---\r\nstatus: "[[Known target#Existing heading|Cached explicit display λ]]"\r\nlinks: [ "[[Cached alias#Existing heading|Cached alias display Ω]]" ]\r\n---\r\n# Property link authoring cached source λ\r\n\r\nExact cached source body 😀.\r\n',
 targetAddition:'\r\nCached block for display labels Ω ^label-cache\r\n'
});

/** Parent owns frozen builds, actual folder selection, final logs and shutdown. */
export async function checkPropertyLinkAuthoring(tools){
 const{directory,evaluate,wait,click,capture,report,restart,afterReload}=tools;
 const folder='Property link authoring',path=folder+'/Source.md',target=folder+'/Targets/Target.md',newPath=folder+'/Inbox/Fresh labelled note λ.md';
 const original='---\r\n# Preserve display source Ω\r\nstatus: Open # keep comment\r\naliases: [ Self authoring alias ]\r\nlabels: [ kept ]\r\nrelated: "[[./Targets/Target#^label-block|Stored block display Ω]]"\r\ncount: 1.50\r\nopaque: { retain: "λ 😀" }\r\n---\r\n# Source λ\r\n\r\nOriginal source body.\r\n\r\n# Sibling Ω\r\n\r\nPreserve final source body.\r\n';
 const targetOriginal='---\r\naliases: [ Friendly authoring alias ]\r\nopaque: { preserve: "λ 😀" }\r\n---\r\n# Parent λ\r\n\r\nExisting target block Ω ^label-block\r\n\r\n# Sibling Ω\r\n\r\nPreserve final target body.\r\n';
 const configPath=join(directory,'.obsidian/app.json'),configBytes=await readFile(configPath),config=JSON.parse(configBytes.toString('utf8').replace(/^\ufeff/,''));
 await evaluate('(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()');
 const layout=await evaluate('app.workspace.getLayout()'),enabled=await evaluate('app.core.isEnabled("properties")'),autosave=await evaluate('app.markdownAutosave.enabled');
 const source='app.workspace.sessions.get('+q(path)+')';let expectedTarget=targetOriginal,stage='fixture',failure;
 const exact=async expected=>{await wait(source+'?.text==='+q(expected)+'&&!'+source+'.dirty&&!'+source+'.isSaving','exact labelled Properties source is saved');assert.deepEqual(await readFile(join(directory,path)),bytes(expected));assert.deepEqual(await readFile(join(directory,target)),bytes(expectedTarget));};
 const changed=(text,property,value)=>property==='status'?text.replace('status: Open #','status: '+JSON.stringify(value)+' #'):text.replace('labels: [ kept ]','labels: [ kept, '+JSON.stringify(value)+' ]');
 const append=(text,lines)=>text.replace('# Sibling Ω',lines.join('\r\n\r\n')+'\r\n\r\n# Sibling Ω');
 const open=async(mode='preview')=>{await evaluate('(async()=>{await app.openFile('+q(path)+');const view=app.workspace.activeLeaf.view;view.setEditingMode("source",false);view.setEditingMode('+q(mode)+',false);view.metadataEditor.render(true)})()');await mark(tools);await wait('Boolean(document.querySelector('+q(field('status'))+')?.checkVisibility())','current labelled Properties controls');};
 const undo=async expected=>{await evaluate('(()=>{[...'+source+'.leaves][0].editor.undo();return true})()');await evaluate('app.saveAll()');await exact(expected);};
 const offer=async(property,query,selector)=>{await cancel(tools,property);await fill(tools,field(property),query);await wait('Boolean(document.querySelector('+q(selector)+')?.checkVisibility())','current labelled Properties choice');return evaluate('document.querySelector('+q(selector)+').dataset.propertyValueChoice');};
 const restore='(()=>{const trace=globalThis.propertyLinkAuthoringTrace;trace?.abort?.abort();return true})()';
 try{
  if(!enabled)await evaluate('app.core.setEnabled("properties",true)');
  await mkdir(join(directory,folder,'Targets'),{recursive:true});await mkdir(join(directory,folder,'Inbox'),{recursive:true});
  await writeFile(join(directory,path),bytes(original),{flag:'wx'});await writeFile(join(directory,target),bytes(targetOriginal),{flag:'wx'});
  await writeFile(configPath,JSON.stringify({...config,markdownAutosave:false,newFileLocation:'folder',newFileFolderPath:folder+'/Inbox',newLinkFormat:'shortest',useMarkdownLinks:true},null,2));
  await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()');await open();
  await evaluate('(()=>{const trace=globalThis.propertyLinkAuthoringTrace={trusted:[],abort:new AbortController()};for(const type of["pointerdown","keydown"])document.addEventListener(type,event=>{if(event.target.closest?.('+q(host)+'))trace.trusted.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:trace.abort.signal});return true})()');

  stage='labelled known note, heading and block choices';
  for(const[property,query,label,subpath,input]of[
   ['status','[['+target.slice(0,-3)+'|Visible note # label λ','Visible note # label λ',null,'pointer'],
   ['status','[[Friendly authoring alias#Parent|Visible heading Ω','Visible heading Ω','#Parent λ','Enter'],
   ['labels','[['+target.slice(0,-3)+'#^label|Visible block 😀]]','Visible block 😀','#^label-block','Tab']
  ]){
   await open(property==='labels'?'live-preview':'preview');const selector=known(target,label,subpath),value=await offer(property,query,selector);assert.ok(value.endsWith('|'+label+']]'));await exact(original);
   if(!subpath)await capture?.('property-link-authoring-existing-labelled-choice');
   if(input==='pointer')await click(selector);else{await key(tools,'ArrowDown');assert.equal(await evaluate('document.querySelector('+q(selector)+').getAttribute("aria-selected")'),'true');await key(tools,input);}
   await exact(changed(original,property,value));await undo(original);
  }
  await open();await click(row('labels')+' [data-property-edit-value="0"]');
  const edit=row('labels')+' [data-property-edit-index="0"]',editLabel='Edited label λ',editChoice=known(target,editLabel,'#Parent λ');
  await fill(tools,edit,'[[Friendly authoring alias#Parent|'+editLabel);await wait('Boolean(document.querySelector('+q(editChoice)+')?.checkVisibility())','labelled choice inside existing member editor');const editedValue=await evaluate('document.querySelector('+q(editChoice)+').dataset.propertyValueChoice');await click(editChoice);
  await exact(original.replace('labels: [ kept ]','labels: [ '+JSON.stringify(editedValue)+' ]'));await undo(original);
  pass(report,'Trusted text, list-add and existing-member Properties controls complete labelled existing note/heading/block values. Explicit labels override alias labels, hashes in labels do not become destination syntax, and exact BOM/CRLF/YAML comments and isolated source Undo survive.');

  stage='labelled same-note combined heading creation';
  for(const[property,query,subpath,lines]of[
   ['status','[[#Source λ#Local branch λ#Local leaf Ω|Own chain display 😀','Source λ#Local branch λ#Local leaf Ω',['## Local branch λ','### Local leaf Ω']],
   ['labels','[[Self authoring alias#Source λ#Alias local leaf Ω|Alias self display λ]]','Source λ#Alias local leaf Ω',['## Alias local leaf Ω']]
  ]){
   await open();const selector=heading(path,subpath),value=await offer(property,query,selector);assert.match(await evaluate('document.querySelector('+q(selector)+').title'),/Undo removes the link and new headings together/);assert.ok((await evaluate('document.querySelector('+q(selector)+').textContent')).includes(value));await exact(original);await capture?.('property-link-authoring-labelled-heading-chain');
   await click(selector);const expected=changed(append(original,lines),property,value);await exact(expected);await undo(original);await evaluate('(()=>{[...'+source+'.leaves][0].editor.redo();return true})()');await evaluate('app.saveAll()');await exact(expected);await undo(original);
  }
  pass(report,'Explicit labelled same-note heading chains work through empty paths and a unique self alias. The preview includes every generated ATX level and complete wiki value; YAML growth is recomputed before one combined transaction, with exact Undo/Redo and unchanged target bytes.');

  stage='unique alias target-first heading creation';await open();
  const crossSubpath='Parent λ#Alias branch λ#Alias leaf Ω',crossSelector=heading(target,crossSubpath),crossValue=await offer('status','[[Friendly authoring alias#'+crossSubpath+'|Cross-note display 😀',crossSelector);
  assert.ok(crossValue.endsWith('|Cross-note display 😀]]'));assert.ok((await evaluate('document.querySelector('+q(crossSelector)+').textContent')).includes(target));await click(crossSelector);
  expectedTarget=append(targetOriginal,['## Alias branch λ','### Alias leaf Ω']);await exact(changed(original,'status',crossValue));await undo(original);assert.deepEqual(await readFile(join(directory,target)),bytes(expectedTarget));
  pass(report,'A unique current metadata alias can explicitly create a reviewed labelled heading chain in its canonical Markdown target. The ordinary target write is acknowledged before the YAML link; source Undo keeps every acknowledged target heading and exact unrelated target bytes.');

  stage='held alias and malformed/duplicate guards';await open();
  const staleSubpath='Parent λ#Refused alias leaf Ω',staleSelector=heading(target,staleSubpath);await offer('status','[[Friendly authoring alias#'+staleSubpath+'|Held label λ',staleSelector);
  expectedTarget=expectedTarget.replace('Friendly authoring alias','Changed authoring alias');await writeFile(join(directory,target),bytes(expectedTarget));await evaluate('app.metadataCache.refresh()');await click(staleSelector);
  await wait('Boolean(document.querySelector('+q(error('status'))+')?.textContent)','held alias creation reports a current-field refusal');await exact(original);assert.ok(!expectedTarget.includes('## Refused alias leaf Ω'));await cancel(tools);
  expectedTarget=expectedTarget.replace('Changed authoring alias','Friendly authoring alias');await writeFile(join(directory,target),bytes(expectedTarget));await evaluate('app.metadataCache.refresh()');
  for(const query of['[[Friendly authoring alias#Parent λ#Never create|One|Two','[[Fresh labelled note λ|','[[Fresh labelled note λ| leading']){
   await fill(tools,field('status'),query);assert.equal(await evaluate('document.querySelectorAll('+q(host+' [data-property-value-choice]')+').length'),0);await cancel(tools);await exact(original);
  }
  await click(row('labels')+' [data-property-edit-value="0"]');await fill(tools,edit,'[[Friendly authoring alias#Parent|Another display');await wait('Boolean(document.querySelector('+q(known(target,'Another display','#Parent λ'))+')?.checkVisibility())','known alias draft remains available after refused stale creation');await key(tools,'Escape');await key(tools,'Escape');await exact(original);
  pass(report,'A held alias-based creation action refuses after real indexed alias replacement, without appending a heading or writing YAML. Empty, padded and multiply separated display labels expose no action; cancellation preserves exact source/target bytes and fresh completion remains usable.');

  stage='labelled explicit new-note placement and Undo';await open();
  const createSelector=host+' [data-property-create-note='+q(newPath)+']',newQuery='[[Fresh labelled note λ|Created note display Ω';
  const createValue=await offer('status',newQuery,createSelector);assert.equal(createValue,'[[Fresh labelled note λ|Created note display Ω]]');assert.ok((await evaluate('document.querySelector('+q(createSelector)+').textContent')).includes(createValue));await capture?.('property-link-authoring-labelled-new-note');
  await exact(original);assert.equal(await evaluate('app.vault.getFileByPath('+q(newPath)+')'),null);await click(createSelector);
  await wait('typeof app.metadataCache.getDocument('+q(path)+')?.cache.frontmatter?.status==="string"&&app.metadataCache.getDocument('+q(path)+').cache.frontmatter.status.endsWith("|Created note display Ω]]")','labelled newly created note is acknowledged and indexed in its source property');
  const linked=await evaluate('app.metadataCache.getDocument('+q(path)+').cache.frontmatter.status');assert.ok(linked.endsWith('|Created note display Ω]]'));await exact(changed(original,'status',linked));assert.deepEqual(await readFile(join(directory,newPath)),Buffer.alloc(0));
  await undo(original);assert.deepEqual(await readFile(join(directory,newPath)),Buffer.alloc(0));
  await fill(tools,field('status'),newQuery);assert.equal(await evaluate('document.querySelectorAll('+q(createSelector)+').length'),0);await cancel(tools);await exact(original);
  pass(report,'The separate labelled Create note action previews its configured Inbox destination and wiki value, creates one exact empty note before the guarded property link, and preserves that acknowledged file when source Undo removes the link. Existing destination proof suppresses repeat creation.');

  stage='restart and labelled stored navigation';await open();
  const persistedLabel='Persisted heading display Ω',persistedSelector=known(target,persistedLabel,'#Parent λ'),persistedValue=await offer('status','[[Friendly authoring alias#Parent|'+persistedLabel,persistedSelector);await click(persistedSelector);const persisted=changed(original,'status',persistedValue);await exact(persisted);await capture?.('property-link-authoring-persisted-label');
  const inputs=await evaluate('propertyLinkAuthoringTrace.trusted');assert.ok(inputs.length>12&&inputs.every(event=>event.trusted));report.propertyLinkAuthoringInputs=inputs;
  await evaluate(restore);await evaluate('(async()=>{await app.saveAll();await app.workspace.flushLayout()})()');if(restart)await restart();else await tools.command('Page.reload');await afterReload();await open();await exact(persisted);
  const stored=row('status')+' [data-property-wiki-target='+q(target)+']';await wait('Boolean(document.querySelector('+q(stored)+')?.checkVisibility())','restart restores the labelled stored wiki control');assert.equal(await evaluate('document.querySelector('+q(stored)+').textContent'),persistedLabel);
  const sourceLeaf=await evaluate('app.workspace.activeLeaf.id');await modifiedClick(tools,stored);await wait('app.workspace.getActiveFile()?.path==='+q(target)+'&&!app.workspace.isChangingFiles&&app.workspace.activeLeaf.view.editor?.getCursor().line===4','trusted restored labelled property link settles at its actual heading target');assert.equal(await evaluate('app.workspace.activeLeaf.view.editor.getCursor().line'),4);await exact(persisted);await evaluate('app.workspace.closeLeaf(app.workspace.activeLeaf)');await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById('+q(sourceLeaf)+'),{focus:true})');await mark(tools);
  report.propertyLinkAuthoring={labelledNotes:true,labelledHeadings:true,labelledBlocks:true,labelsIgnoreDestinationSyntax:true,explicitLabelOverridesAlias:true,existingListMember:true,uniqueAliasHeadingCreation:true,sameNoteAliasCreation:true,combinedUndoRedo:true,targetFirstAcknowledgement:true,sourceUndoKeepsTarget:true,staleAliasRefused:true,malformedLabelsRefused:true,labelledNewNotePlacement:true,sourceUndoKeepsCreatedNote:true,repeatCreateRefused:true,exactBomCrLfOpaqueSource:true,trustedInputs:true,restartStoredLabelAndNavigation:true};
  pass(report,'Full restart/browser reconnection retains exact labelled source and target bytes. The restored visible display text navigates through a trusted modified click to the canonical existing heading and correct editor caret; the source owner and created empty note remain intact.');
 }catch(issue){failure=issue;report.propertyLinkAuthoringFailure={stage,error:String(issue?.stack??issue)};try{report.propertyLinkAuthoringFailure.state=await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,source:'+source+'?.text,fields:[...document.querySelectorAll('+q(host+' [data-metadata-input]')+')].map(input=>({value:input.value,disabled:input.disabled,visible:input.checkVisibility()})),errors:[...document.querySelectorAll(".metadata-property-error")].filter(node=>node.textContent).map(node=>node.textContent)}))()');await capture?.('property-link-authoring-precleanup-failure');}catch{}throw issue;}
 finally{try{await evaluate(restore);await evaluate('app.saveAll()');await writeFile(configPath,configBytes);await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout('+q(layout)+');await app.workspace.flushLayout();delete globalThis.propertyLinkAuthoringTrace})()');if(!enabled)await evaluate('app.core.setEnabled("properties",false)');if(autosave)await evaluate('app.markdownAutosave.setEnabled(true)');}catch(issue){if(!failure)throw issue;report.propertyLinkAuthoringFailure.cleanupError=String(issue?.stack??issue);}}
}

/** Parent mounts a complete real cached vault and audits actual blobs/network. */
export async function checkPropertyLinkAuthoringReadOnly(tools){
 const{evaluate,wait,click,capture,report}=tools;assert.equal(await evaluate('app.vault.readOnly'),true);const sourceLeaf=await evaluate('app.workspace.activeLeaf.id');
 const before=await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
 await evaluate('app.workspace.activeLeaf.view.setMode("preview")');await mark(tools);
 for(const property of['status','links']){
  const selector=field(property);await wait('Boolean(document.querySelector('+q(selector)+')?.checkVisibility())','genuine cached labelled Properties control');assert.equal(await evaluate('document.querySelector('+q(selector)+').disabled'),true);
  const prior=await evaluate('document.querySelector('+q(selector)+').value');await evaluate('(()=>{const input=document.querySelector('+q(selector)+');input.disabled=false;input.value="[[Cached alias#Existing heading#Never create|Display Ω";input.dispatchEvent(new InputEvent("input",{bubbles:true}));return true})()');
  assert.equal(await evaluate('document.querySelectorAll('+q(host+' [data-property-value-choice]')+').length'),0);await evaluate('(()=>{const input=document.querySelector('+q(selector)+');input.value='+q(prior)+';input.disabled=true;input.blur();return true})()');
 }
 pass(report,'Genuine prepared cache-only Properties leaves labelled scalar/list fields disabled. Even a tampered enabled input cannot offer known choices, labelled heading creation or new-note creation; cached source and target documents retain exact versions and bytes.');
 await capture?.('property-link-authoring-readonly-labelled-values');
 for(const[property,label]of[['status','Cached explicit display λ'],['links','Cached alias display Ω']]){
  const selector=row(property)+' [data-property-wiki-target="Known target.md"]';await wait('Boolean(document.querySelector('+q(selector)+')?.checkVisibility())','cached labelled wiki navigation is available');assert.equal(await evaluate('document.querySelector('+q(selector)+').textContent'),label);await modifiedClick(tools,selector);
  await wait('app.workspace.getActiveFile()?.path==="Known target.md"&&!app.workspace.isChangingFiles&&app.workspace.activeLeaf.view.editor?.getCursor().line===3','cached labelled property settles at its canonical existing heading');assert.equal(await evaluate('app.workspace.activeLeaf.view.editor.getCursor().line'),3);
  await evaluate('app.workspace.closeLeaf(app.workspace.activeLeaf)');await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById('+q(sourceLeaf)+'),{focus:true})');await mark(tools);
 }
 assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'),before);
 report.propertyLinkAuthoringReadOnly={genuineCachedReadOnly:true,labelledFieldsDisabled:true,tamperedInputCreationRefused:true,explicitDisplayNavigation:true,aliasDisplayNavigation:true,exactDocumentsAndVersions:true};
 pass(report,'Trusted modified clicks on labelled cached scalar and alias-based list wiki values navigate the canonical existing heading. Both visible labels, source owner and every cached document/version remain intact without creating a missing note.');
}
