import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const q=JSON.stringify,bom=String.fromCharCode(0xfeff),eol=String.fromCharCode(13,10);
const folder='Grouped base controls',path=folder+'/Catalog.base',otherPath=folder+'/Other.base',sourcePath=folder+'/Row 020.md';
const makeBase=directory=>bom+[
 '# Retain grouping source λ', 'future: &opaque {keep: true, precise: 9007199254740993}', 'copy: *opaque',
 'filters: file.inFolder('+q(directory)+') && file.ext == '+q('md'), 'views:',
 ...['Table','Other'].flatMap(name=>['  - type: table','    name: '+name,'    order: [file.name, note.status, note.amount]','    groupBy: {property: note.status, direction: ASC}','    summaries: {note.amount: Sum}','    futureView: {keep: true}']),''
].join(eol);
const baseSource=makeBase(folder);
const noteSource=index=>bom+['---','status: '+(index<120?'open':'done'),'amount: 2','---','# Row '+index,'','Retain exact λ 😀 source '+index+'.',''].join(eol);
const leaf=id=>`app.workspace.getLeafById(${q(id)})`,view=id=>leaf(id)+'.view';
const root=id=>`[data-bases-view=${q(id)}]`,group=(id,label)=>root(id)+` [data-bases-group-label=${q(label)}] [data-bases-group-fold]`;
const action=(id,name)=>root(id)+` [data-bases-action=${q(name)}]`;
const workspace=(base=path,prefix='group-controls')=>({version:1,main:{id:prefix+'-main',type:'split',direction:'vertical',children:[
 ...['left','right'].map(side=>({id:prefix+'-'+side+'-tabs',type:'tabs',currentTab:0,dimension:base===path?38:50,children:[{id:prefix+'-'+side,type:'leaf',state:{type:'bases',state:{file:base,view:'Table',opaqueGroupState:{keep:[true,'λ']}}}}]})),
 ...(base===path?[{id:prefix+'-source-tabs',type:'tabs',currentTab:0,dimension:24,children:[{id:prefix+'-source',type:'leaf',state:{type:'markdown',state:{file:sourcePath,mode:'source',source:true}}}]}]:[])
]},active:prefix+'-left'});
const optional=path=>readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
async function restore(path,bytes){if(bytes!==null)await writeFile(path,bytes);else await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});}
async function key(command,value,code,windowsVirtualKeyCode,modifiers=0){for(const type of [value==='Enter'?'keyDown':'rawKeyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:value,code,windowsVirtualKeyCode,modifiers,...(value==='Enter'&&type==='keyDown'?{text:String.fromCharCode(13),unmodifiedText:String.fromCharCode(13)}:{})});}
const complete=(tools,id)=>tools.wait(`document.querySelector(${q(root(id))})?.dataset.basesComplete==='true'`,'current group query rendered');
const expanded=(tools,id,label)=>tools.evaluate(`document.querySelector(${q(group(id,label))})?.getAttribute('aria-expanded')`);
async function choose(tools,selector,value){
 const index=await tools.evaluate(`(()=>{const node=document.querySelector(${q(selector)});node.scrollIntoView({block:'center'});node.focus();return [...node.options].findIndex(option=>option.value===${q(value)})})()`);
 assert.ok(index>=0);await key(tools.command,'Home','Home',36);
 assert.equal(await tools.evaluate(`document.querySelector(${q(selector)}).selectedIndex`),0);
 for(let offset=0;offset<index;offset++){await key(tools.command,'ArrowDown','ArrowDown',40);assert.equal(await tools.evaluate(`document.querySelector(${q(selector)}).selectedIndex`),offset+1);}
 await key(tools.command,'Tab','Tab',9);await tools.wait(`document.querySelector(${q(selector)})?.value===${q(value)}`,'trusted closed select changes named view');
}
async function fill(tools,selector,text){await tools.click(selector);await key(tools.command,'a','KeyA',65,2);await tools.command('Input.insertText',{text});}
async function trace(tools){await tools.evaluate(`(()=>{globalThis.basesGroupInputs=[];globalThis.basesGroupInputListener=event=>{if(event.target instanceof Element&&event.target.closest('[data-bases-view]'))basesGroupInputs.push({type:event.type,key:event.key??null,code:event.code??null,trusted:event.isTrusted,time:performance.now(),detail:event.detail??null,targetTag:event.target.tagName,targetGroup:event.target.closest('[data-bases-group-fold]')?.dataset.basesGroupFold??null,focusedTarget:document.activeElement===event.target,targetConnected:event.target.isConnected})};for(const type of ['click','keydown','keypress','keyup','change'])document.addEventListener(type,basesGroupInputListener,true);return true})()`);}
async function stopTrace(tools){return tools.evaluate(`(()=>{for(const type of ['click','keydown','keypress','keyup','change'])document.removeEventListener(type,globalThis.basesGroupInputListener,true);const result=globalThis.basesGroupInputs??[];delete globalThis.basesGroupInputListener;delete globalThis.basesGroupInputs;return result})()`);}
async function keyboardSnapshot(tools,id,label){return tools.evaluate(`(()=>{const button=document.querySelector(${q(group(id,label))}),original=globalThis.basesGroupKeyboardButton,active=document.activeElement,owner=${view(id)};return{expanded:button?.getAttribute('aria-expanded')==='true',ariaExpanded:button?.getAttribute('aria-expanded')??null,focusedCurrent:active===button,focusedOriginal:active===original,originalConnected:Boolean(original?.isConnected),originalIsCurrent:original===button,currentConnected:Boolean(button?.isConnected),activeTag:active?.tagName??null,activeGroup:active?.closest?.('[data-bases-group-fold]')?.dataset.basesGroupFold??null,serial:owner.serial,workerActive:Boolean(owner.worker),complete:document.querySelector(${q(root(id))})?.dataset.basesComplete??null}})()`);}
async function freshReload(tools,reloadContext){
 const before=(await tools.command('Page.getFrameTree')).frameTree.frame.loaderId;
 assert.equal(await tools.evaluate('app.workspace.hasUnsavedChanges'),false);await tools.command('Page.reload');
 let after=before;const deadline=Date.now()+20000;
 while(after===before&&Date.now()<deadline){after=(await tools.command('Page.getFrameTree')).frameTree.frame.loaderId;if(after===before)await delay(50);}
 assert.ok(after&&after!==before,'A distinct real main document loaded');await tools.afterReload(reloadContext);return{previousLoaderId:before,nextLoaderId:after};
}

/** Parent binds source/artifacts/errors/shutdown and serializes real GUI execution. */
export async function checkBasesGroups(tools){
 const{directory,evaluate,click,wait,command,restart,afterReload,capture,report}=tools,left='group-controls-left',right='group-controls-right',source='group-controls-source';
 const configPath=join(directory,'.obsidian/app.json'),corePath=join(directory,'.obsidian/core-plugins.json');
 await evaluate('(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()');
 const priorLayout=await evaluate('app.workspace.getLayout()'),enabled=await evaluate(`app.core.isEnabled('bases')`),configBytes=await optional(configPath),coreBytes=await optional(corePath);
 const config=configBytes?JSON.parse(configBytes.toString('utf8').replace(/^\ufeff/,'')):{};
 const fixtures=new Map([[path,Buffer.from(baseSource)],[otherPath,Buffer.from(baseSource)]]),events=[];
 for(let index=0;index<135;index++)fixtures.set(folder+'/Row '+String(index).padStart(3,'0')+'.md',Buffer.from(noteSource(index)));
 const exact=async()=>{for(const[path,bytes]of fixtures)assert.deepEqual(await readFile(join(directory,path)),bytes,'Exact group fixture '+path);};
 const pass=message=>{report.checks.push(message);console.log('PASS '+message);};let stage='fixture',failure,tracing=false;
 const toggle=async enabled=>{await click('#open-settings');await click('#core-plugins-tab');if(await evaluate(`app.core.isEnabled('bases')`)!==enabled)await click('[data-core-toggle=bases]');await wait(`!app.core.busy&&app.core.isEnabled('bases')===${enabled}`,'real Bases lifecycle controls');await click('.settings-close');};
 try{
  await mkdir(join(directory,folder));for(const[path,bytes]of fixtures)await writeFile(join(directory,path),bytes,{flag:'wx'});
  await writeFile(configPath,JSON.stringify({...config,markdownAutosave:false}));
  await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh();if(!app.core.isEnabled('bases'))await app.core.setEnabled('bases',true)})()`);
  await evaluate(`app.workspace.changeLayout(${q(workspace())})`);await complete(tools,left);await complete(tools,right);await trace(tools);tracing=true;

  stage='row folding and summaries';assert.equal(await expanded(tools,left,'open'),'true');await click(group(left,'open'));
  assert.equal(await expanded(tools,left,'open'),'false');assert.equal(await expanded(tools,right,'open'),'true');
  assert.equal(await evaluate(`document.querySelectorAll(${q(root(left)+' [data-bases-row][hidden]')}).length`),85);
  assert.equal(await evaluate(`document.querySelectorAll(${q(root(left)+' [data-bases-row]:not([hidden])')}).length`),15);
  assert.match(await evaluate(`document.querySelector(${q(root(left)+' [data-bases-status]')}).textContent`),/135 rows.*Page 1 of 2/);
  assert.equal(await evaluate(`document.querySelector(${q(root(left)+' tfoot [data-bases-summary='+q('note.amount')+'] [data-bases-summary-value]')}).textContent`),'270');
  const summary=await evaluate(`(()=>{const row=document.querySelector(${q(group(left,'open'))}).closest('tr').nextElementSibling;return{summary:row.matches('.bases-summary-row'),visible:row.checkVisibility(),amount:row.querySelector('[data-bases-summary='+CSS.escape('note.amount')+'] [data-bases-summary-value]').textContent}})()`);
  assert.deepEqual(summary,{summary:true,visible:true,amount:'240'});await capture?.('bases-groups-collapsed');await exact();
  pass('Trusted Bases group controls hide only member rows, retain visible all-row/group summaries and counts, and leave an independent pane expanded with exact BOM/CRLF/Unicode .base/note bytes.');

  stage='keyboard and pagination';await evaluate(`globalThis.basesGroupKeyboardButton=document.querySelector(${q(group(left,'open'))});basesGroupKeyboardButton.focus()`);
  report.basesGroupKeyboard={before:await keyboardSnapshot(tools,left,'open')};await key(command,' ','Space',32);report.basesGroupKeyboard.afterSpace=await keyboardSnapshot(tools,left,'open');assert.equal(report.basesGroupKeyboard.afterSpace.expanded,true);
  await key(command,'Enter','Enter',13);report.basesGroupKeyboard.afterEnter=await keyboardSnapshot(tools,left,'open');report.basesGroupKeyboard.events=await evaluate('basesGroupInputs.slice()');assert.equal(report.basesGroupKeyboard.afterEnter.expanded,false);await click(action(left,'next-page'));await complete(tools,left);
  assert.equal(await evaluate(`document.querySelectorAll(${q(root(left)+' [data-bases-row]')}).length`),35);assert.equal(await evaluate(`document.querySelectorAll(${q(root(left)+' [data-bases-row][hidden]')}).length`),35);
  assert.equal(await expanded(tools,left,'open'),'false');await click(action(left,'previous-page'));await complete(tools,left);await exact();
  pass('Trusted Space and Enter operate the real group button with correct aria-expanded. The same typed value stays folded across100-row pages without changing membership, totals or summaries.');

  stage='named views and filtering';await choose(tools,root(left)+' [data-bases-select]','Other');await complete(tools,left);assert.equal(await expanded(tools,left,'open'),'true');
  await choose(tools,root(left)+' [data-bases-select]','Table');await complete(tools,left);assert.equal(await expanded(tools,left,'open'),'false');
  await fill(tools,root(left)+' [data-bases-search]','done');await wait(`!document.querySelector(${q(group(left,'open'))})`,'filter removes absent group');
  await fill(tools,root(left)+' [data-bases-search]','');await wait(`document.querySelector(${q(group(left,'open'))})?.getAttribute('aria-expanded')==='false'`,'restored filtered group retains fold');
  assert.equal(await expanded(tools,right,'open'),'true');await exact();
  pass('Named views and panes retain independent fold intent. Filtering a value out and restoring it preserves its saved fold without modifying query/source data.');

  stage='earlier group and detached controls';const earlierPath=folder+'/Earlier.md',earlier=Buffer.from(bom+['---','status: alpha','amount: 3','---','# Earlier λ',''].join(eol));
  await evaluate(`globalThis.basesGroupDetached=document.querySelector(${q(group(left,'open'))})`);await writeFile(join(directory,earlierPath),earlier,{flag:'wx'});fixtures.set(earlierPath,earlier);
  await evaluate('(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()');await wait(`Boolean(document.querySelector(${q(group(left,'alpha'))}))`,'new earlier group rendered');
  assert.equal(await expanded(tools,left,'alpha'),'true');assert.equal(await expanded(tools,left,'open'),'false');const foldBefore=await evaluate(`${view(left)}.getState().groupFolds`);
  await evaluate('basesGroupDetached.click()');assert.deepEqual(await evaluate(`${view(left)}.getState().groupFolds`),foldBefore);await exact();
  pass('A newly inserted earlier group changes ordinal query keys without moving a fold to the wrong value. Retained detached controls cannot change current folds or any physical source.');

  stage='dirty source history';const original=noteSource(20).slice(1),dirty=original+'Dirty body retained Ω.'+eol;
  const sourceSelector=await evaluate(`(()=>{const leaf=${leaf(source)};app.workspace.setActiveLeaf(leaf);leaf.view.sourceEl.dataset.basesGroupSource='true';leaf.view.editor.focus();return '[data-bases-group-source=true] .cm-content'})()`);
  await click(sourceSelector);await key(command,'End','End',35,2);await command('Input.insertText',{text:'Dirty body retained Ω.'+String.fromCharCode(10)});await wait(`${view(source)}.editor.getValue()===${q(dirty)}`,'body edit remains dirty');
  const history=await evaluate(`(()=>{globalThis.basesGroupEditor=${view(source)}.editor;globalThis.basesGroupDocument=basesGroupEditor.cm.state.doc;const m=app.plugins.modules['@codemirror/commands'];return{undo:m.undoDepth(basesGroupEditor.cm.state),redo:m.redoDepth(basesGroupEditor.cm.state),text:basesGroupEditor.getValue()}})()`);
  await wait(`app.metadataCache.getDocument(${q(sourcePath)})?.text===${q(dirty)}`,'dirty body metadata reaches normal query input');
  await click(action(left,'refresh'));await complete(tools,left);await click(group(left,'open'));await wait(`document.querySelector(${q(group(left,'open'))})?.getAttribute('aria-expanded')==='true'`,'dirty-body fold expands');await click(group(left,'open'));await wait(`document.querySelector(${q(group(left,'open'))})?.getAttribute('aria-expanded')==='false'`,'dirty-body fold collapses again');
  assert.deepEqual(await evaluate(`(()=>{const e=${view(source)}.editor,m=app.plugins.modules['@codemirror/commands'];return{undo:m.undoDepth(e.cm.state),redo:m.redoDepth(e.cm.state),text:e.getValue()}})()`),history);
  assert.equal(await evaluate(`${view(source)}.editor===basesGroupEditor&&${view(source)}.editor.cm.state.doc===basesGroupDocument`),true);
  await click(sourceSelector);await key(command,'z','KeyZ',90,2);await wait(`${view(source)}.editor.getValue()===${q(original)}`,'one source Undo survives folds');
  await key(command,'y','KeyY',89,2);await wait(`${view(source)}.editor.getValue()===${q(dirty)}`,'source Redo remains exact');await key(command,'z','KeyZ',90,2);await wait(`${view(source)}.editor.getValue()===${q(original)}`,'source restored before restart');await exact();
  pass('Folding while a real Markdown body is dirty preserves the editor/document and history depths. Trusted Undo/Redo still affects only that body transaction while every saved note/base byte remains exact.');

  stage='file scopes and invalid state';const fileProbeState=await evaluate(`${view(left)}.getState()`);await evaluate(`${leaf(left)}.openFile(app.vault.getFileByPath(${q(otherPath)}))`);await complete(tools,left);assert.equal(await expanded(tools,left,'open'),'true');
  await evaluate(`${leaf(left)}.openFile(app.vault.getFileByPath(${q(path)}))`);await complete(tools,left);assert.equal(await expanded(tools,left,'open'),'false');
  await evaluate(`${leaf(left)}.setViewState({type:'bases',state:${q(fileProbeState)}})`);await complete(tools,left);
  const beforeInvalid=await evaluate(`${view(left)}.getState()`),refused=await evaluate(`(async()=>{try{await ${view(left)}.setState({...${view(left)}.getState(),file:${q(otherPath)},groupFolds:{version:2,contexts:[]}},{});return false}catch{return true}})()`);
  assert.equal(refused,true);assert.deepEqual(await evaluate(`${view(left)}.getState()`),beforeInvalid);await exact();
  pass('Folds stay scoped to their base file when a pane navigates between bases. Malformed saved fold state refuses before retargeting a file or replacing current view state.');

  stage='lifecycle and fresh runtime';await evaluate(`globalThis.basesGroupOldView=${view(left)};globalThis.basesGroupOldButton=document.querySelector(${q(group(left,'open'))})`);const old=await evaluate('basesGroupOldView.getState().groupFolds');
  await toggle(false);await evaluate('basesGroupOldButton.click()');assert.deepEqual(await evaluate('basesGroupOldView.getState().groupFolds'),old);await toggle(true);await complete(tools,left);await complete(tools,right);
  assert.equal(await expanded(tools,left,'open'),'false');assert.equal(await expanded(tools,right,'open'),'true');events.push(...await stopTrace(tools));tracing=false;
  await evaluate('(async()=>{await app.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()');if(restart){await restart();await afterReload();}else report.basesGroupReload=await freshReload(tools);
  await complete(tools,left);await complete(tools,right);await wait(`document.querySelector(${q(group(left,'open'))})?.getAttribute('aria-expanded')==='false'&&document.querySelector(${q(group(right,'open'))})?.getAttribute('aria-expanded')==='true'`,'fresh group owners restore independent folds');assert.deepEqual(await evaluate(`${view(left)}.getState().opaqueGroupState`),{keep:[true,'λ']});await exact();await capture?.('bases-groups-restored');
  pass('Disable/re-enable and a real native restart or distinct fresh browser document restore independent folds and opaque leaf state. Disabled/detached controls remain inert and physical source remains exact.');

  stage='narrow view';const ownedLayout=await evaluate('app.workspace.getLayout()'),state=await evaluate(`${view(left)}.getState()`),narrow={version:1,main:{id:'groups-narrow-main',type:'split',direction:'vertical',children:[{id:'groups-narrow-tabs',type:'tabs',currentTab:0,children:[{id:'groups-narrow',type:'leaf',state:{type:'bases',state}}]}]},left:{width:260,collapsed:true},right:{width:260,collapsed:true},active:'groups-narrow'};
  await evaluate(`app.workspace.changeLayout(${q(narrow)})`);await command('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:false});await complete(tools,'groups-narrow');await trace(tools);tracing=true;
  const narrowBounds=`(()=>{const button=document.querySelector(${q(group('groups-narrow','open'))});if(!button)return null;button.scrollIntoView({block:'center',inline:'nearest'});const rect=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},main=rect(app.workspace.rootSplit.containerEl),pane=rect(document.querySelector(${q(root('groups-narrow'))})),bounds=rect(button),layout=app.workspace.getLayout(),x=bounds.left+bounds.width/2,y=bounds.top+bounds.height/2,hit=document.elementFromPoint(x,y);return{viewport:{width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,visualWidth:visualViewport?.width??null},sidebars:{leftCollapsed:layout.left?.collapsed===true,rightCollapsed:layout.right?.collapsed===true},main,pane,button:bounds,center:{x,y,withinMain:x>=main.left&&x<=main.right&&y>=main.top&&y<=main.bottom,withinViewport:x>=0&&x<=innerWidth&&y>=0&&y<=innerHeight,reachable:hit===button||button.contains(hit)},expanded:button.getAttribute('aria-expanded')}})()`;
  await wait(`(()=>{const b=${narrowBounds};return Boolean(b&&b.viewport.width===360&&b.viewport.height===800&&b.sidebars.leftCollapsed&&b.sidebars.rightCollapsed&&b.main.width>=260&&b.pane.width>=240&&b.center.withinMain&&b.center.withinViewport&&b.center.reachable)})()`,'360px collapsed-sidebar profile has visible main space and a physically reachable group button');
  report.basesGroupsNarrow=await evaluate(narrowBounds);assert.equal(report.basesGroupsNarrow.viewport.width,360);assert.equal(report.basesGroupsNarrow.viewport.height,800);assert.equal(report.basesGroupsNarrow.sidebars.leftCollapsed,true);assert.equal(report.basesGroupsNarrow.sidebars.rightCollapsed,true);assert.ok(report.basesGroupsNarrow.main.width>=260&&report.basesGroupsNarrow.pane.width>=240);for(const value of Object.values(report.basesGroupsNarrow.center).filter(value=>typeof value==='boolean'))assert.equal(value,true);
  await click(group('groups-narrow','open'));assert.equal(await expanded(tools,'groups-narrow','open'),'true');await click(group('groups-narrow','open'));assert.equal(await expanded(tools,'groups-narrow','open'),'false');await capture?.('bases-groups-narrow');events.push(...await stopTrace(tools));tracing=false;
  await command('Emulation.clearDeviceMetricsOverride');await evaluate(`app.workspace.changeLayout(${q(ownedLayout)})`);await exact();assert.ok(events.length>15&&events.every(event=>event.trusted));report.basesGroupInputs=events;
  report.basesGroups={actualControls:true,keyboardExpandedState:true,summariesRemainVisible:true,countsAndPaginationUnchanged:true,stableTypedGroupIdentity:true,earlierGroupDoesNotStealFold:true,independentPanes:true,independentNamedViews:true,fileAndPropertyScopes:true,searchRetainsAbsentFolds:true,invalidStateAtomic:true,detachedControlsInert:true,dirtyDocumentAndHistoryRetained:true,realSourceUndoRedo:true,exactBOMCRLFUnicode:true,opaqueLeafStateRetained:true,lifecycleAndFreshRuntime:true,narrowControlsReachable:true,trustedInputs:true};
  pass('At a360px logical viewport with both sidebars explicitly collapsed, the recorded main/pane/button bounds prove a physically reachable group control and correct expanded state. All positive input is trusted and every physical base/note byte remains exact.');
 }catch(error){failure=error;report.basesGroupsFailure={stage,error:String(error?.stack??error),keyboard:report.basesGroupKeyboard};try{report.basesGroupsFailure.inputEvents=await evaluate('globalThis.basesGroupInputs??[]');await capture?.('bases-groups-precleanup-failure');report.basesGroupsFailure.state=await evaluate(`({left:${leaf(left)}?.view?.getState(),right:${leaf(right)}?.view?.getState(),errors:[...document.querySelectorAll('[data-bases-error]')].map(node=>node.textContent)})`);}catch{}throw error;
 }finally{try{if(tracing)await stopTrace(tools);await command('Emulation.clearDeviceMetricsOverride');await evaluate('app.saveAll()');await evaluate(`app.workspace.changeLayout(${q(priorLayout)})`);if(!enabled)await evaluate(`app.core.setEnabled('bases',false)`);await evaluate('app.core.whenIdle()');await restore(configPath,configBytes);await restore(corePath,coreBytes);await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.workspace.flushLayout();delete globalThis.basesGroupDetached;delete globalThis.basesGroupOldView;delete globalThis.basesGroupOldButton;delete globalThis.basesGroupEditor;delete globalThis.basesGroupDocument;delete globalThis.basesGroupKeyboardButton})()`);}catch(error){if(!failure)throw error;report.basesGroupsFailure.cleanupError=String(error?.stack??error);}}
}

const cachedFolder='Cached grouped bases',cachedPath=cachedFolder+'/Catalog.base';
export const basesGroupsReadOnlyFixture={files:[[cachedPath,makeBase(cachedFolder)],...['A','B','C'].map((name,index)=>[cachedFolder+'/'+name+'.md',bom+['---','status: '+(index===2?'done':'open'),'amount: '+[2,3,7][index],'---','# Cached '+name+' λ 😀',''].join(eol)])]};
/** Parent supplies genuine prepared cached mount and audits every original blob. */
export async function checkBasesGroupsReadOnly(tools){
 const{evaluate,click,wait,report,capture,command}=tools,left='readonly-groups-left',right='readonly-groups-right';assert.equal(await evaluate('app.vault.readOnly'),true);assert.equal(await evaluate(`app.core.isEnabled('bases')`),true);
 const previousLayout=await evaluate('app.workspace.getLayout()'),previousRoot=await evaluate('app.vault.rootPath');
 const snapshot=()=>evaluate(`(async()=>({base:await app.vault.readDocument(${q(cachedPath)}),documents:app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path)),configuration:(await app.configuration.read('app')).data}))()`),before=await snapshot();let tracing=false,indexTracing=false,stage='cached controls';
 const witness=()=>evaluate(`(async()=>{const r=indexedDB.open('slopsidian-github-vault-v1',1),db=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});let saved;try{const r=db.transaction('entries','readonly').objectStore('entries').get('preference:'+app.vault.rootPath+':workspace');saved=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result?.value?.data??null);r.onerror=()=>no(r.error)})}finally{db.close()}const panes={};for(const id of ${q([left,right])}){const leaf=app.workspace.getLeafById(id),owner=leaf?.view,pane=document.querySelector('[data-bases-view='+CSS.escape(id)+']');panes[id]={type:owner?.getViewType(),state:owner?.getState(),dirty:owner?.isDirty,complete:pane?.dataset.basesComplete??null,groups:[...(pane?.querySelectorAll('[data-bases-group-label]')??[])].map(node=>({label:node.dataset.basesGroupLabel,expanded:node.querySelector('[data-bases-group-fold]')?.getAttribute('aria-expanded')})),rows:pane?.querySelectorAll('[data-bases-row]').length??0,hidden:pane?.querySelectorAll('[data-bases-row][hidden]').length??0,issues:pane?.querySelector('[data-bases-issues]')?.textContent??null}}return{root:app.vault.rootPath,indexComplete:app.vault.indexComplete,index:app.githubVaults.state(),documents:app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,version:entry.document.version})).sort((a,b)=>a.path.localeCompare(b.path)),panes,savedWorkspace:saved,liveWorkspace:app.workspace.getLayout()}})()`);
 const savedFold=(state,id)=>{const walk=node=>node?.id===id?node.state?.state?.groupFolds:(node?.children??[]).map(walk).find(value=>value!==undefined);return walk(state?.main);};
 try{
  await evaluate(`app.workspace.changeLayout(${q(workspace(cachedPath,'readonly-groups'))})`);await complete(tools,left);await complete(tools,right);
  const guards=await evaluate(`(async()=>{
   const owner=${view(left)},pane=document.querySelector(${q(root(left))}),ribbon=document.querySelector('[data-core-ribbon=bases]'),grouping=pane.querySelector('[data-bases-group]'),source=pane.querySelector('[data-bases-action=source]');
   const controls=[source,grouping,...pane.querySelectorAll('[data-bases-sort],[data-bases-summarize],.bases-summary-button,.bases-cell-edit')],disabled=controls.length>8&&controls.every(node=>node?.disabled===true),ribbonDisabled=ribbon?.disabled===true;
   const before=owner.getViewData(),state=JSON.stringify(owner.getState()),model=owner.model,counts={plan:0,property:0,scan:0,create:0},restores=[];
   const wrap=(object,key,count)=>{const descriptor=Object.getOwnPropertyDescriptor(object,key),original=object[key];object[key]=function(...args){counts[count]++;return original.apply(this,args)};restores.push(()=>{if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key]})};
   wrap(model,'setView','plan');wrap(model,'setSummary','plan');wrap(app.fileManager,'processFrontMatter','property');wrap(app.vault,'getAbstractFileByPath','scan');wrap(app.vault,'create','create');
   const typed=[];let commandRefused=false;
   try{
    for(const control of controls){control.disabled=false;try{if(control===grouping){control.value='file.name';control.dispatchEvent(new Event('change',{bubbles:true}))}else control.click()}finally{control.disabled=true}}
    for(let i=0;i<4;i++)await Promise.resolve();
    const provider=app.core.getEnabledPluginById('bases'),command=app.commands.listCommands().find(entry=>entry.id==='bases:new-file');
    commandRefused=Boolean(command&&!app.commands.isRunnable(command.id)&&command.checkCallback(true)===false&&command.checkCallback(false)===false&&!app.commands.executeCommandById(command.id));
    for(const action of [()=>provider.create(),()=>owner.commit(before+'# Refuse cached mutation'+String.fromCharCode(10)),()=>owner.sourceDialog(),()=>owner.summaryDialog({key:'note.amount',label:'Amount',summaryKind:'number'}),()=>owner.editProperty(${q(cachedFolder+'/A.md')},'amount')]){try{await action();typed.push(false)}catch(error){typed.push(error?.code==='VAULT_READ_ONLY')}}
    return{disabled,ribbonDisabled,commandRefused,typed,counts,modelUnchanged:owner.model===model,sourceUnchanged:owner.getViewData()===before,clean:!owner.isDirty,readonly:owner.isReadOnly===true,stateUnchanged:JSON.stringify(owner.getState())===state,noDialog:!document.querySelector('[data-core-dialog=bases]'),refusalVisible:/read.only/i.test(pane.querySelector('[data-bases-error]')?.textContent??'')};
   }finally{for(const restore of restores.reverse())restore()}
  })()`);
  report.basesGroupsReadOnlyGuards=guards;for(const key of ['disabled','ribbonDisabled','commandRefused','modelUnchanged','sourceUnchanged','clean','readonly','stateUnchanged','noDialog','refusalVisible'])assert.equal(guards[key],true,key);assert.deepEqual(guards.typed,[true,true,true,true,true]);assert.deepEqual(guards.counts,{plan:0,property:0,scan:0,create:0});await evaluate(`${view(left)}.setError('')`);
  report.checks.push('Genuine cached Bases disable create/source/group/sort/summary/property writes. Forced handlers, retained command callbacks and direct create/commit/dialog calls refuse before planning, file scans, dirty source or note callbacks.');
  await trace(tools);tracing=true;
  await choose(tools,root(left)+' [data-bases-select]','Other');await complete(tools,left);assert.equal(await evaluate(`${view(left)}.selected`),'Other');assert.equal(await expanded(tools,left,'open'),'true');
  await choose(tools,root(left)+' [data-bases-select]','Table');await complete(tools,left);await fill(tools,root(left)+' [data-bases-search]','done');await wait(`document.querySelectorAll(${q(root(left)+' [data-bases-row]')}).length===1&&!document.querySelector(${q(group(left,'open'))})`,'cached local search filters query rows');
  await fill(tools,root(left)+' [data-bases-search]','');await wait(`document.querySelectorAll(${q(root(left)+' [data-bases-row]')}).length===3&&Boolean(document.querySelector(${q(group(left,'open'))}))`,'cached local search clears');assert.equal(await evaluate(`${view(left)}.isDirty`),false);
  report.checks.push('Trusted cached named-view and search controls remain available as local presentation without changing the base model or dirtying its source.');
  await click(group(left,'open'));assert.equal(await expanded(tools,left,'open'),'false');assert.equal(await expanded(tools,right,'open'),'true');assert.equal(await evaluate(`document.querySelectorAll(${q(root(left)+' [data-bases-row][hidden]')}).length`),2);
  assert.equal(await evaluate(`document.querySelector(${q(root(left)+' tfoot [data-bases-summary='+q('note.amount')+'] [data-bases-summary-value]')}).textContent`),'12');
  const inputs=await stopTrace(tools);tracing=false;assert.ok(inputs.length>0&&inputs.every(event=>event.trusted));report.basesGroupsReadOnlyInputs=inputs;
  stage='flush cached folds';const persistence=report.basesGroupsReadOnlyPersistence={beforeFlush:await witness()};await evaluate('app.workspace.flushLayout()');persistence.afterFlush=await witness();
  for(const id of [left,right])assert.deepEqual(savedFold(persistence.afterFlush.savedWorkspace,id),persistence.beforeFlush.panes[id].state.groupFolds,'The normal local workspace write stores exact fold intent before reload');
  stage='fresh cached document';report.basesGroupsReadOnlyReload=await freshReload(tools,{cachedRoot:previousRoot});
  if(await evaluate('app.vault.rootPath')!==previousRoot){const repository=JSON.parse(decodeURIComponent(previousRoot.slice('github-vault:'.length)))[0];await evaluate(`app.githubVaults.open({url:${q(repository)},cached:true})`);}
  await wait(`app.vault.rootPath===${q(previousRoot)}&&!app.changingVault`,'fresh genuine cached Bases root');await complete(tools,left);await complete(tools,right);persistence.afterReload=await witness();
  for(const id of [left,right]){assert.deepEqual(persistence.afterReload.panes[id].state.groupFolds,persistence.beforeFlush.panes[id].state.groupFolds,'Fresh owners retain exact typed fold stores before index preparation');assert.deepEqual(savedFold(persistence.afterReload.savedWorkspace,id),persistence.beforeFlush.panes[id].state.groupFolds);}
  stage='prepare fresh cached index';
  if(!persistence.afterReload.indexComplete){
   await evaluate(`(()=>{const t=globalThis.basesGroupIndexTrace={events:[],abort:new AbortController()};for(const type of ['click','keydown','keyup'])document.addEventListener(type,event=>{if(event.target instanceof Element&&event.target.closest('#github-vault-offline,[data-github-offline-dialog]'))t.events.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal})})()`);indexTracing=true;
   await click('#github-vault-offline');await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"','fresh cached notes require normal index preparation');await click('[data-github-offline-dialog] [data-github-index-prepare]');await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"','actual fresh cache-only index preparation completes');await key(command,'Escape','Escape',27);await wait('!document.querySelector("[data-github-offline-dialog]")','fresh cached index dialog closes');await evaluate('app.metadataCache.refresh()');
   report.basesGroupsReadOnlyIndexInputs=await evaluate('(()=>{const t=basesGroupIndexTrace;t.abort.abort();const events=t.events;delete globalThis.basesGroupIndexTrace;return events})()');indexTracing=false;assert.ok(report.basesGroupsReadOnlyIndexInputs.length>=2&&report.basesGroupsReadOnlyIndexInputs.every(event=>event.trusted));
  }
  await wait('app.vault.indexComplete','fresh cached query input is explicitly prepared');await complete(tools,left);await complete(tools,right);persistence.afterIndex=await witness();
  for(const id of [left,right])assert.deepEqual(persistence.afterIndex.panes[id].state.groupFolds,persistence.beforeFlush.panes[id].state.groupFolds,'Index preparation cannot replace or force a fold preference');assert.deepEqual(persistence.afterIndex.documents,before.documents.map(({path,version})=>({path,version})));
  stage='restored cached group rendering';await wait(`document.querySelector(${q(group(left,'open'))})?.getAttribute('aria-expanded')==='false'&&document.querySelector(${q(group(right,'open'))})?.getAttribute('aria-expanded')==='true'`,'fresh prepared cached group owners restore independent folds');await capture?.('bases-groups-readonly');
  report.checks.push('Genuine cache-only Bases panes retain exact independent fold intent through a distinct fresh document. Trusted Prepare index restores complete query inputs without changing those local folds or remote source.');
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await evaluate(`(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()`),{api:0,raw:0});
  report.basesGroupsReadOnly={genuineCachedReadOnly:true,trustedLocalFold:true,independentPanes:true,summaryRetained:true,freshDocumentPersistence:true,baseDocumentVersionAndBomUnchanged:true,indexedDocumentsUnchanged:true,configurationUnchanged:true,zeroApiRaw:true,mutationControlsDisabled:true,forcedMutationHandlersRefused:true,directCreateAndCommandRefused:true,sourceRemainsClean:true,readonlyInheritedSaveGuard:true,localNamedViewSelection:true,localSearchFiltering:true};
  report.checks.push('Cached folding changes local workspace presentation only: original base content/version/BOM, indexed notes and app configuration stay exact, with zero API/raw requests before and after reload.');
 }catch(error){report.basesGroupsReadOnlyFailure={stage,error:String(error?.stack??error)};try{report.basesGroupsReadOnlyFailure.precleanup=await witness();await capture?.('bases-groups-readonly-precleanup-failure')}catch(issue){report.basesGroupsReadOnlyFailure.witnessError=String(issue?.stack??issue)}throw error;
 }finally{if(tracing)await stopTrace(tools);if(indexTracing)await evaluate('(()=>{globalThis.basesGroupIndexTrace?.abort.abort();delete globalThis.basesGroupIndexTrace})()');if(await evaluate('app.vault.rootPath')===previousRoot)await evaluate(`app.workspace.changeLayout(${q(previousLayout)})`);}
}
