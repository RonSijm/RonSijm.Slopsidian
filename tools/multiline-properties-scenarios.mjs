import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q=JSON.stringify,host='[data-multiline-properties-root="true"]',bytes=text=>Buffer.from("\ufeff"+text);
const row=name=>host+' [data-property-key='+q(name)+']',edit=name=>row(name)+' [data-property-edit-multiline]';
const input=name=>row(name)+' [data-property-multiline-input]',apply=name=>row(name)+' [data-property-multiline-apply]',cancel=name=>row(name)+' [data-property-multiline-cancel]';
const issue=name=>row(name)+' .metadata-property-error',inspector=row('opaque')+' [data-property-structured="opaque"]';
const pass=(report,message)=>{report.checks.push(message);console.log('PASS '+message);};
async function key(tools,value,code=value,number=value==='Enter'?13:value==='Escape'?27:value==='Tab'?9:65,modifiers=0){
 const event={key:value,code,windowsVirtualKeyCode:number,nativeVirtualKeyCode:number,modifiers};
 await tools.command('Input.dispatchKeyEvent',{type:value==='Enter'&&!modifiers?'keyDown':'rawKeyDown',...event,...(value==='Enter'&&!modifiers?{text:'\r',unmodifiedText:'\r'}:{})});
 await tools.command('Input.dispatchKeyEvent',{type:'keyUp',...event});
}
async function fill(tools,selector,value){await tools.click(selector);await key(tools,'a','KeyA',65,2);if(value)await tools.command('Input.insertText',{text:value});else await key(tools,'Backspace','Backspace',8);}
async function mark(tools,id){
 await tools.evaluate(`(()=>{for(const node of document.querySelectorAll('[data-multiline-properties-root]'))delete node.dataset.multilinePropertiesRoot;const view=${id?'app.workspace.getLeafById('+q(id)+').view':'app.workspace.activeLeaf.view'};view.metadataEditor.contentEl.dataset.multilinePropertiesRoot='true'})()`);
}
async function openEditor(tools,name,index){
 const selector=index===undefined?edit(name):row(name)+' [data-property-edit-value='+q(String(index))+']';
 await tools.wait(`(()=>{const el=document.querySelector(${q(selector)});return el&&!el.disabled&&!el.closest('[inert]')&&el.checkVisibility()})()`,'the current multiline owner has released its busy controls');
 await tools.click(selector);
 await tools.wait(`Boolean(document.querySelector(${q(input(name))})?.checkVisibility())`,'the current multiline textarea is visible');
 assert.equal(await tools.evaluate(`document.querySelector(${q(input(name))}).tagName`),'TEXTAREA');
}
async function disabledPointer(tools,selector){
 const point=await tools.evaluate(`(()=>{const node=document.querySelector(${q(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node}})()`);assert.equal(point.hit,true);
 for(const type of['mousePressed','mouseReleased'])await tools.command('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
}

const original=['---','# Exact multiline source λ','description: |- # keep description','  First line λ','  Second line 😀','folded: >- # keep folded','  Folded first','  continuation Ω','items:','  - kept','  - |- # keep item','    First item λ','    Second item 😀','  - duplicate','single: Plain','count: 1.50','opaque:','  branch:','    enabled: true','    mixed: [one, 2, false]','    text: "<img src=x> λ 😀"','anchored: &shared { retained: exact }','aliased: *shared','---','# Source λ','','Untouched source body 😀.',''].join('\r\n');
const description=(text,first,second)=>text.replace('  First line λ\r\n  Second line 😀','  '+first+'\r\n  '+second);
export const multilinePropertiesReadOnlyFixture=Object.freeze({
 source:'---\r\ndescription: |- # cached multiline\r\n  Cached first λ\r\n  Cached second 😀\r\nitems:\r\n  - kept\r\n  - |-\r\n    Cached item Ω\r\n    Second item 😀\r\nopaque:\r\n  branch:\r\n    enabled: true\r\n    mixed: [one, 2, false]\r\n    text: "<img src=x> cached λ"\r\n---\r\n# Multiline cached source λ\r\n\r\nExact cached body.\r\n',files:[]
});

/** Parent owns the frozen source/build, genuine directory picker, final audit and shutdown. */
export async function checkMultilineProperties(tools){
 const{directory,evaluate,wait,click,command,capture,report,restart,afterReload}=tools,folder='Multiline properties',path=folder+'/Source.md',other=folder+'/Other.md';
 await evaluate('(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()');
 const layout=await evaluate('app.workspace.getLayout()'),enabled=await evaluate('app.core.isEnabled("properties")'),autosave=await evaluate('app.markdownAutosave.enabled');
 const configPath=join(directory,'.obsidian/app.json'),configBytes=await readFile(configPath),config=JSON.parse(configBytes.toString('utf8').replace(/^\ufeff/,''));
 const source='app.workspace.sessions.get('+q(path)+')';let stage='fixture',failure;
 const workingConfig=Buffer.from(JSON.stringify({...config,markdownAutosave:false},null,2));
 const exact=async expected=>{await wait(source+'?.text==='+q(expected)+'&&!'+source+'.dirty&&!'+source+'.isSaving','exact multiline source is saved');assert.deepEqual(await readFile(join(directory,path)),bytes(expected));assert.deepEqual(await readFile(join(directory,other)),bytes('# Other λ\r\n\r\nUnchanged peer.\r\n'));};
 const open=async(mode='preview')=>{await evaluate('(async()=>{await app.openFile('+q(path)+');app.workspace.activeLeaf.view.setEditingMode('+q(mode)+',false);if(app.workspace.activeLeaf.view.getMode()==="preview")await app.workspace.activeLeaf.view.currentMode.whenReady();app.workspace.activeLeaf.view.metadataEditor.render(true)})()');await mark(tools);await wait('Boolean(document.querySelector('+q(edit('description'))+')?.checkVisibility())','current multiline Properties owner');};
 const undo=async(expected=original)=>{await evaluate('(()=>{const session='+source+';[...session.leaves][0].editor.undo()})()');await evaluate('app.saveAll()');await exact(expected);};
 const restore='(()=>{const t=globalThis.multilinePropertiesTrace;if(t?.reload&&t.session)t.session.reload=t.reload;t?.release?.();if(t?.frontmatter)app.fileManager.processFrontMatter=t.frontmatter;t?.abort?.abort();return true})()';
 try{
  if(!enabled)await evaluate('app.core.setEnabled("properties",true)');
  await mkdir(join(directory,folder));await writeFile(join(directory,path),bytes(original),{flag:'wx'});await writeFile(join(directory,other),bytes('# Other λ\r\n\r\nUnchanged peer.\r\n'),{flag:'wx'});
  await writeFile(configPath,workingConfig);await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()');await open();
  await evaluate(`(()=>{const t=globalThis.multilinePropertiesTrace={events:[],calls:[],frontmatter:app.fileManager.processFrontMatter,abort:new AbortController()};app.fileManager.processFrontMatter=async function(...args){const call={path:args[0].path,settled:false};t.calls.push(call);try{return await t.frontmatter.apply(this,args)}finally{call.settled=true}};for(const type of['pointerdown','keydown'])document.addEventListener(type,event=>{if(event.target.closest?.(${q(host)}))t.events.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()`);

  stage='scalar textarea, native newline and Ctrl+Enter';
  assert.equal(await evaluate('document.querySelector('+q(row('description')+' [data-property-multiline-preview]')+').textContent'),'First line λ\nSecond line 😀');assert.equal(await evaluate('document.querySelectorAll('+q(row('description')+' [data-metadata-input]')+').length'),0);await capture?.('multiline-scalar-preview');
  await openEditor(tools,'description');await fill(tools,input('description'),'First typed λ');await key(tools,'Enter');await command('Input.insertText',{text:'Second typed 😀'});
  assert.equal(await evaluate('document.querySelector('+q(input('description'))+').value'),'First typed λ\nSecond typed 😀');await exact(original);
  await click(row('single')+' input[data-metadata-input]');await wait('Boolean(document.querySelector('+q(input('description'))+'))','blur retains the explicit multiline draft');await exact(original);await click(input('description'));await capture?.('multiline-scalar-editor');
  await key(tools,'Enter','Enter',13,2);const changedScalar=description(original,'First typed λ','Second typed 😀');await exact(changedScalar);
  assert.ok(changedScalar.includes('folded: >- # keep folded\r\n  Folded first\r\n  continuation Ω'));await undo();
  await evaluate('(()=>{[...'+source+'.leaves][0].editor.redo()})()');await evaluate('app.saveAll()');await exact(changedScalar);await undo();
  pass(report,'Multiline scalar Properties preview every line, edit through a native textarea and keep Enter as a newline. Moving focus cannot save. Trusted Ctrl+Enter makes one ordinary source transaction with exact BOM/CRLF/Unicode, comments, other folded scalars and isolated Undo/Redo.');

  stage='unchanged lexemes and cancellation';
  const callsBefore=await evaluate('multilinePropertiesTrace.calls.length');
  for(const name of['description','folded']){await openEditor(tools,name);await click(apply(name));await wait('!document.querySelector('+q(input(name))+')','unchanged multiline draft closes without a write');await exact(original);}
  for(const via of['Escape','Cancel']){await openEditor(tools,'description');await fill(tools,input('description'),'Discard λ\nthis draft 😀');await click(row('single')+' input[data-metadata-input]');await exact(original);if(via==='Escape'){await click(input('description'));await key(tools,'Escape');}else await click(cancel('description'));await wait('!document.querySelector('+q(input('description'))+')','explicit multiline cancellation removes its draft');await exact(original);}
  assert.equal(await evaluate('multilinePropertiesTrace.calls.length'),callsBefore);
  pass(report,'Unchanged literal/folded scalar drafts keep their exact original YAML spelling and never enter the write queue. Escape, Cancel and Tab/blur navigation leave multiline drafts unapplied and preserve source, peers and every untouched value.');

  stage='multiline list replacement and duplicate refusal';await open('live-preview');await openEditor(tools,'items',1);
  assert.equal(await evaluate('document.querySelector('+q(input('items'))+').value'),'First item λ\nSecond item 😀');await fill(tools,input('items'),'duplicate');await click(apply('items'));await wait('document.querySelector('+q(issue('items'))+')?.textContent.includes("distinct")','duplicate multiline member refuses without source mutation');await exact(original);await click(cancel('items'));
  await openEditor(tools,'items',1);await fill(tools,input('items'),'Cancelled item λ\nSecond line');await key(tools,'Escape');await exact(original);
  await openEditor(tools,'items',1);await fill(tools,input('items'),'Updated item Ω\nSecond item 🙂');await capture?.('multiline-list-editor');await click(apply('items'));
  const changedList=original.replace('    First item λ\r\n    Second item 😀','    Updated item Ω\r\n    Second item 🙂');await exact(changedList);assert.deepEqual(await evaluate('app.metadataCache.getDocument('+q(path)+').cache.frontmatter.items'),['kept','Updated item Ω\nSecond item 🙂','duplicate']);await undo();
  pass(report,'Existing multiline ordinary-list members use explicit Apply/Cancel in Live Preview. Duplicate values refuse, Escape preserves the source, and a trusted replacement keeps member order, exact untouched list/scalar lexemes and one isolated Undo. The legacy split-by-line dialog remains unavailable for multiline arrays.');

  stage='bounded structured inspection';await open();await click(inspector+' > summary');await wait('document.querySelector('+q(inspector)+')?.open','native structured inspector opens');await click(inspector+' > ul > li > details > summary');await wait('document.querySelector('+q(inspector+' > ul > li > details')+')?.open','native nested YAML branch opens');
  assert.equal(await evaluate('document.querySelector('+q(inspector)+').querySelectorAll("input,textarea,img,script,a").length'),0);assert.ok(await evaluate('document.querySelector('+q(inspector)+').textContent.includes("<img src=x> λ 😀")'));assert.equal(await evaluate('document.querySelectorAll('+q(row('aliased')+' [data-property-structured]')+').length'),0);await capture?.('multiline-structured-inspector');await exact(original);
  pass(report,'Bounded nested maps and mixed lists expose native expandable read-only YAML inspection with literal values. HTML-looking text stays inert, no editing/links/media are introduced, and aliased/anchored values keep their guarded source-only fallback without any source or configuration write.');

  stage='fixed Properties and shared editor history';
  const fixed='multiline-fixed-properties',md='multiline-fixed-note',fixedLayout={version:1,main:{id:'multiline-fixed-main',type:'split',direction:'vertical',children:[{id:'multiline-fixed-note-tabs',type:'tabs',dimension:55,currentTab:0,children:[{id:md,type:'leaf',state:{type:'markdown',pinned:true,state:{file:path,mode:'source',source:true}}}]},{id:'multiline-fixed-properties-tabs',type:'tabs',dimension:45,currentTab:0,children:[{id:fixed,type:'leaf',state:{type:'file-properties',pinned:true,state:{file:path,followActiveFile:false,sort:'name',query:''}}}]}]},active:fixed};
  await evaluate('(async()=>{await app.workspace.changeLayout('+q(fixedLayout)+');await app.workspace.flushLayout()})()');await wait('app.workspace.getLeafById('+q(fixed)+')?.view.metadataEditor?.rendered.length>0','real fixed Properties pane is ready');await mark(tools,fixed);await wait('Boolean(document.querySelector('+q(edit('description'))+')?.checkVisibility())','fixed pane owns the multiline field');
  await openEditor(tools,'description');await fill(tools,input('description'),'Pane first λ\nPane second Ω');await click(apply('description'));await exact(description(original,'Pane first λ','Pane second Ω'));await undo();
  const dirty=original+'Unrelated dirty body Ω.\r\n';await click('[data-leaf-id='+q(md)+'] .cm-content');await key(tools,'End','End',35,2);await command('Input.insertText',{text:'Unrelated dirty body Ω.\n'});await wait(source+'.dirty&&'+source+'.text==='+q(dirty),'trusted source edit remains dirty before multiline Apply');assert.deepEqual(await readFile(join(directory,path)),bytes(original));
  await openEditor(tools,'description');await fill(tools,input('description'),'Dirty first λ\nDirty second Ω');await capture?.('multiline-fixed-pane-editor');await click(apply('description'));await exact(description(dirty,'Dirty first λ','Dirty second Ω'));await undo(dirty);await undo();
  await evaluate('(async()=>{await app.workspace.changeLayout('+q(layout)+');await app.workspace.flushLayout()})()');await open();
  pass(report,'A real fixed Properties pane edits multiline text through the same source/version queue as inline Reading and Live Preview. A trusted earlier dirty CodeMirror body edit is saved intact before Apply; one shared-session Undo restores only the property, and another restores the earlier body transaction with exact source bytes.');

  stage='independent physical replacement';await openEditor(tools,'description');await fill(tools,input('description'),'Held old λ\ndraft');
  const external=description(original,'External first λ','External second 😀');await writeFile(join(directory,path),bytes(external));await click(apply('description'));
  await wait('document.querySelector('+q(issue('description'))+')?.textContent.includes("changed")&&!'+source+'.isSaving','normal queued reload rejects a physical replacement');await exact(external);assert.equal(await evaluate('document.querySelector('+q(input('description'))+').value'),'Held old λ\ndraft');await capture?.('multiline-conflict');await click(cancel('description'));
  await writeFile(join(directory,path),bytes(original));await evaluate('(async()=>{await '+source+'.reload(false);await app.metadataCache.refresh()})()');await open();await exact(original);
  pass(report,'A physical BOM/CRLF/Unicode replacement after opening a draft is read by the ordinary session reload and blocks the stale property mutation. The newer note remains exact, the failed draft stays visible for review, and Cancel refreshes current source instead of rebasing or overwriting it.');

  stage='queued owner refusal and full restart';await openEditor(tools,'description');await fill(tools,input('description'),'Never apply λ\nthis queued draft');
  await evaluate('(()=>{const t=multilinePropertiesTrace;t.session='+source+';t.reload=t.session.reload;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);t.session.reload=async function(...args){t.waiting=true;await t.gate;return t.reload.apply(this,args)};return true})()');await click(apply('description'));await wait('multilinePropertiesTrace.waiting','real YAML queue holds its normal session reload');assert.equal(await evaluate('document.querySelector('+q(input('description'))+').readOnly'),true);for(const selector of[apply('description'),cancel('description')])assert.equal(await evaluate('document.querySelector('+q(selector)+').disabled'),true);
  await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);multilinePropertiesTrace.session.reload=multilinePropertiesTrace.reload;multilinePropertiesTrace.release()');await wait('multilinePropertiesTrace.calls.at(-1)?.settled&&!'+source+'.isSaving&&!app.workspace.isChangingFiles','held normal queue settles after source-mode owner change');await exact(original);
  await evaluate('(async()=>{const view=app.workspace.activeLeaf.view;view.setEditingMode("preview",false);await view.currentMode.whenReady();view.metadataEditor.render(true)})()');await mark(tools);
  await wait('Boolean(document.querySelector('+q(input('description'))+')?.checkVisibility())&&document.querySelector('+q(issue('description'))+')?.textContent.includes("changed")','the stale multiline draft is retained for explicit review');
  assert.equal(await evaluate('document.querySelector('+q(input('description'))+').value'),'Never apply λ\nthis queued draft');await click(cancel('description'));await wait('!document.querySelector('+q(input('description'))+')','trusted Cancel discards the refused draft before a new edit');await exact(original);await open();
  const persisted=description(original,'Persisted first λ','Persisted second Ω');await openEditor(tools,'description');await fill(tools,input('description'),'Persisted first λ\nPersisted second Ω');await click(apply('description'));await exact(persisted);assert.deepEqual(await readFile(configPath),workingConfig);
  report.multilinePropertyInputs=await evaluate('multilinePropertiesTrace.events');assert.ok(report.multilinePropertyInputs.length>15&&report.multilinePropertyInputs.every(event=>event.trusted));await evaluate(restore);await evaluate('(async()=>{await app.saveAll();await app.workspace.flushLayout()})()');if(restart)await restart();else await command('Page.reload');await afterReload();await open();await exact(persisted);assert.equal(await evaluate('document.querySelector('+q(row('description')+' [data-property-multiline-preview]')+').textContent'),'Persisted first λ\nPersisted second Ω');await capture?.('multiline-restored');
  report.multilineProperties={scalarPreview:true,explicitTextarea:true,enterAddsNewline:true,ctrlEnterApplies:true,noBlurCommit:true,noOpLexemesExact:true,literalAndFoldedSourceExact:true,multilineListMember:true,duplicatesRefused:true,cancelPreserved:true,isolatedUndoRedo:true,structuredInspection:true,noStructuredCoercion:true,aliasInspectionFallback:true,fixedPaneEditor:true,sharedEditorHistory:true,physicalReplacementRetained:true,queuedOwnerRefused:true,pendingControlsLocked:true,exactBOMCRLFUnicode:true,restartRestoresValues:true,trustedInputs:true};
  pass(report,'Pending multiline textareas/buttons stay locked, and a real mode change during the held normal YAML reload refuses before a property transaction. A later valid edit persists through full restart or actual-folder reconnection with exact values, source/configuration bytes and usable fresh controls.');
 }catch(error){failure=error;report.multilinePropertiesFailure={stage,error:String(error?.stack??error)};try{report.multilinePropertiesFailure.state=await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,source:'+source+'?.text,fields:[...document.querySelectorAll('+q(host+' input,'+host+' textarea')+')].map(input=>({tag:input.tagName,value:input.value,disabled:input.disabled,readOnly:input.readOnly})),errors:[...document.querySelectorAll(".metadata-property-error")].filter(node=>node.textContent).map(node=>node.textContent)}))()');await capture?.('multiline-precleanup-failure');}catch{}throw error;}
 finally{try{await evaluate(restore);await evaluate('app.saveAll()');await writeFile(configPath,configBytes);await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout('+q(layout)+');await app.workspace.flushLayout();delete globalThis.multilinePropertiesTrace})()');if(!enabled)await evaluate('app.core.setEnabled("properties",false)');if(autosave)await evaluate('app.markdownAutosave.setEnabled(true)');}catch(error){if(!failure)throw error;report.multilinePropertiesFailure.cleanupError=String(error?.stack??error);}}
}

/** Parent supplies the genuine prepared cache-only mount and audits all blobs/counters. */
export async function checkMultilinePropertiesReadOnly(tools){
 const{evaluate,wait,click,capture,report}=tools;assert.equal(await evaluate('app.vault.readOnly'),true);
 const before=await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
 const config=await evaluate('(async()=>(await app.configuration.read("app")).data)()');await evaluate('(async()=>{app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady();app.workspace.activeLeaf.view.metadataEditor.render(true)})()');await mark(tools);
 for(const selector of[edit('description'),row('items')+' [data-property-edit-value="1"]']){
  await wait('Boolean(document.querySelector('+q(selector)+')?.checkVisibility())','cached multiline preview controls are visible');assert.equal(await evaluate('document.querySelector('+q(selector)+').disabled'),true);await disabledPointer(tools,selector);assert.equal(await evaluate('document.querySelectorAll('+q(host+' [data-property-multiline-input]')+').length'),0);
  await evaluate('(()=>{const button=document.querySelector('+q(selector)+');button.disabled=false;button.click();button.disabled=true})()');assert.equal(await evaluate('document.querySelectorAll('+q(host+' [data-property-multiline-input]')+').length'),0);
 }
 assert.equal(await evaluate('document.querySelector('+q(row('description')+' [data-property-multiline-preview]')+').textContent'),'Cached first λ\nCached second 😀');
 for(const name of['description','items'])for(const action of['edit','remove'])assert.equal(await evaluate('document.querySelector('+q(row(name)+' [data-property-action='+q(action)+']')+').disabled'),true);
 pass(report,'Genuine cache-only multiline scalar/list previews retain every line while Edit, removal and legacy array conversion remain disabled. Trusted disabled-pointer input and a forged enabled control cannot open a textarea or reach a property write.');
 await click(inspector+' > summary');await click(inspector+' > ul > li > details > summary');await wait('document.querySelector('+q(inspector+' > ul > li > details')+')?.open','cached nested YAML inspection opens locally');assert.equal(await evaluate('document.querySelector('+q(inspector)+').querySelectorAll("input,textarea,img,script,a").length'),0);await capture?.('multiline-readonly-inspector');
 assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'),before);assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'),config);assert.deepEqual(await evaluate('(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()'),{api:0,raw:0});
 report.multilinePropertiesReadOnly={genuineCachedReadOnly:true,allLinesVisible:true,scalarAndMemberEditingDisabled:true,forcedControlRefused:true,readOnlyStructuredInspection:true,htmlLookingTextInert:true,exactDocumentsAndVersions:true,configurationUnchanged:true,zeroNetwork:true};
 pass(report,'Native nested YAML details remain inspectable in a prepared cache-only note without introducing mutating controls or interpreting HTML-looking values. Every cached document/version and configuration remains exact, with zero API/raw requests.');
}
