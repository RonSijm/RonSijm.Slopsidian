import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

const stubs=new Map([
  ['./reading','export class ReadingView {}'],['./views','export class TextFileView {}'],['./menu','export class Menu {}'],
  ['./view-panel','export class ResponsiveViewPanel {}'],['./icons','export function iconButton() { return {dataset:{},remove(){}}; }'],['./dom','export function reportError() {}'],
  ['./vault','export class TFile {}'],['./ui','export class Modal {} export class Notice {}'],
]);
const bundle=await build({stdin:{contents:'export * from "./client/canvas-jump"; export {CanvasBoard,Canvases} from "./client/canvas"; export {CanvasDocument} from "./client/canvas-model"; export {CanvasJumpModal} from "./client/canvas-jump-modal"; export {CanvasExportModal} from "./client/canvas-export-modal"; export {readViewport} from "./client/viewport"; export {HotkeyManager} from "./client/hotkeys"; export {PersistentDraftCapture} from "./client/persistent-drafts"; export {PersistentDraftStore,MemoryDraftBackend} from "./client/persistent-draft-model";',resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent',outfile:'x.mjs',plugins:[{name:'pure-canvas-navigation',setup(builder){builder.onResolve({filter:/^\.\/(reading|views|menu|view-panel|icons|dom|vault|ui)$/},args=>({path:args.path,namespace:'canvas-navigation-stub'}));builder.onLoad({filter:/.*/,namespace:'canvas-navigation-stub'},args=>({contents:stubs.get(args.path),loader:'js'}));}}]});
const output=fileURLToPath(new URL('../.runtime/canvas-navigation-test.mjs',import.meta.url));await mkdir(fileURLToPath(new URL('../.runtime/',import.meta.url)),{recursive:true});await writeFile(output,bundle.outputFiles[0].text);
const {CanvasBoard,Canvases,CanvasDocument,CanvasJumpModal,CanvasExportModal,HotkeyManager,PersistentDraftCapture,PersistentDraftStore,MemoryDraftBackend,captureCanvasJump,canvasJumpChoices,canvasJumpViewport,readViewport}=await import(pathToFileURL(output).href);
const card=(id,extra={})=>({id,type:'text',text:'',x:0,y:0,width:200,height:100,...extra});
const helperSource=await readFile(new URL('../tools/canvas-navigation-scenarios.mjs',import.meta.url),'utf8');
const {choose:chooseCanvasControl,captureDrain:drainCanvasCapture}=await import('data:text/javascript;base64,'+Buffer.from(helperSource+'\nexport {choose,captureDrain};').toString('base64'));

test('Canvas Jump snapshots text, file sections, website and group labels without changing unknown node data',()=>{
  const nodes=[card('a',{text:'# Project λ\r\nExact 😀.',future:{keep:true}}),card('b',{type:'file',file:'Notes/Project Plan.md',subpath:'#Chosen'}),card('c',{type:'link',url:'https://example.invalid/literal?a=1&b=2'}),card('d',{type:'group',label:'Group Ω'}),card('e',{type:'future-type',future:{keep:[1,2]}})],before=JSON.stringify(nodes),choices=captureCanvasJump(nodes);
  assert.deepEqual(choices.map(value=>value.type),['Text card','File card','Website','Group','Other card']);assert.match(choices[0].label,/# Project λ Exact 😀/);assert.match(choices[1].label,/Notes\/Project Plan.md #Chosen/);assert.match(choices[2].label,/https:\/\/example.invalid/);assert.equal(JSON.stringify(nodes),before);
  nodes[0].text='later';nodes[1].x=999;assert.match(choices[0].search,/# Project λ/);assert.equal(choices[1].x,0);assert.equal(Object.isFrozen(choices),true);assert.equal(Object.isFrozen(choices[0]),true);
});
test('Canvas Jump keeps label content literal and supplies explicit untitled-group labels',()=>{
  const choices=captureCanvasJump([card('a',{text:'<img src=x onerror=alert(1)> **literal**'}),card('b',{type:'group',label:'   '})]);assert.match(choices[0].label,/<img src=x onerror=alert\(1\)> \*\*literal\*\*/);assert.equal(choices[1].label,'Group · Untitled group');
});
test('Canvas Jump ranks literal and fuzzy queries while type filters exclude unrelated cards',()=>{
  const choices=captureCanvasJump([card('a',{text:'Project Plan'}),card('b',{text:'Project Progress'}),card('c',{type:'group',label:'Project Group'}),card('d',{type:'file',file:'Notes/Project Plan.md'})]);
  assert.equal(canvasJumpChoices(choices,'Project Plan').values[0].id,'a');assert.ok(canvasJumpChoices(choices,'PjPl').values.some(value=>value.id==='a'));assert.deepEqual(canvasJumpChoices(choices,'Project','Group').values.map(value=>value.id),['c']);assert.deepEqual(canvasJumpChoices(choices,'Plan','File card').values.map(value=>value.id),['d']);assert.equal(canvasJumpChoices(choices,'absent').total,0);
});
test('Canvas Jump preserves stable board order for identically labelled duplicate cards',()=>{
  const choices=captureCanvasJump([card('first',{text:'Duplicate'}),card('other',{text:'Duplicate'}),card('third',{text:'Duplicate'})]);assert.deepEqual(canvasJumpChoices(choices,'Duplicate').values.map(value=>value.id),['first','other','third']);
});
test('Canvas Jump reports all matches while rendering only one hundred options',()=>{
  const choices=captureCanvasJump(Array.from({length:130},(_,index)=>card('node-'+index,{text:'Matching card '+index}))),result=canvasJumpChoices(choices,'Matching');assert.equal(result.total,130);assert.equal(result.values.length,100);assert.equal(new Set(result.values.map(value=>value.id)).size,100);
});
test('Canvas Jump bounds cards, queries and search text before expensive work',()=>{
  assert.throws(()=>captureCanvasJump(Array.from({length:5001},(_,i)=>card(String(i)))),/5,000/);const choices=captureCanvasJump([card('a',{text:'x'.repeat(1024)+'notsearched'})]);assert.equal(choices[0].search.length,1024);assert.equal(canvasJumpChoices(choices,'notsearched').total,0);assert.throws(()=>canvasJumpChoices(choices,'x'.repeat(257)),/256/);assert.throws(()=>canvasJumpChoices(choices,'','unknown'),/supported/);
});
test('Canvas Jump clips Unicode at a complete surrogate pair and preserves ordinary emoji queries',()=>{
  const choices=captureCanvasJump([card('a',{text:'x'.repeat(1023)+'😀tail'}),card('b',{text:'Chosen 😀 λ'})]);assert.ok(!/[\uD800-\uDBFF]$/u.test(choices[0].search));assert.equal(canvasJumpChoices(choices,'😀').values.some(value=>value.id==='b'),true);
});
test('Canvas Jump refuses duplicate IDs and malformed geometry rather than centering invalid data',()=>{
  assert.throws(()=>captureCanvasJump([card('a'),card('a')]),/unique/);for(const extra of [{width:0},{height:-1},{x:NaN},{y:1.5},{x:10000001}])assert.throws(()=>captureCanvasJump([card('a',extra)]),/geometry/);
});
test('Canvas Jump centers a normal card without magnifying it and retains opaque camera state',()=>{
  const node=card('a',{x:500,y:-300}),prior={x:2,y:3,scale:4,future:{keep:true}},before=JSON.stringify([node,prior]),camera=canvasJumpViewport(node,900,600,prior);assert.equal(camera.scale,1);assert.equal(camera.x+(node.x+node.width/2)*camera.scale,450);assert.equal(camera.y+(node.y+node.height/2)*camera.scale,300);assert.deepEqual(camera.future,{keep:true});assert.equal(JSON.stringify([node,prior]),before);assert.deepEqual(readViewport(camera),camera);
});
test('Canvas Jump fits groups into a narrow viewport with padding and centers huge groups at minimum zoom',()=>{
  const group=card('g',{type:'group',x:-1000,y:500,width:1200,height:800}),camera=canvasJumpViewport(group,240,600);assert.ok(camera.scale<1);assert.ok(group.width*camera.scale<=240-60);assert.equal(camera.x+(group.x+group.width/2)*camera.scale,120);assert.equal(camera.y+(group.y+group.height/2)*camera.scale,300);
  const huge=canvasJumpViewport(card('huge',{x:10000000,y:-10000000,width:10000000,height:10000000}),300,500);assert.equal(huge.scale,0.02);assert.deepEqual(readViewport(huge),huge);
});
test('Canvas Jump refuses hidden viewport sizes and unsafe node rectangles',()=>{
  for(const [width,height]of [[0,100],[100,0],[-1,10],[NaN,20],[100,Infinity],[10000001,600]])assert.throws(()=>canvasJumpViewport(card('a'),width,height),/visible size/);assert.throws(()=>canvasJumpViewport(card('a',{width:Infinity}),100,100),/geometry/);
});
test('Canvas Jump cameras round trip at both signed geometry boundaries on narrow, standard and large screens',()=>{
  for(const [width,height]of [[240,600],[800,600],[5120,2880],[10000000,10000000]])for(const x of [-10000000,10000000])for(const y of [-10000000,10000000]){
    const node=card('boundary',{x,y}),camera=canvasJumpViewport(node,width,height,{x:0,y:0,scale:1,future:'retained'});
    assert.ok(Math.abs(camera.x)<=10000000);assert.ok(Math.abs(camera.y)<=10000000);assert.ok(camera.scale>=0.02&&camera.scale<=1);assert.ok(Math.abs(camera.x+(node.x+node.width/2)*camera.scale-width/2)<1e-6);assert.ok(Math.abs(camera.y+(node.y+node.height/2)*camera.scale-height/2)<1e-6);assert.deepEqual(readViewport(JSON.parse(JSON.stringify(camera))),camera);assert.equal(camera.future,'retained');
  }
});

function fixture(){
  const source=JSON.stringify({future:{keep:[false,null,'λ']},nodes:[card('a',{x:500,y:300,text:'Exact 😀'}),card('g',{type:'group',label:'Destination',width:900,height:600})],edges:[{id:'edge',fromNode:'a',toNode:'g',future:true}]},null,2).replaceAll('\n','\r\n')+'\r\n',model=new CanvasDocument(source),file={path:'Boards/Exact.canvas'},state={layout:0,saves:0,transforms:0,renderSelection:0,draftState:'dirty'},leaf={id:'canvas-leaf'};
  const app={vault:{rootPath:'Vault A',readOnly:false,getFileByPath:path=>path===file.path?file:null},workspace:{getLeafById:id=>id===leaf.id?leaf:null,isChangingFiles:false},core:{isEnabled:()=>true,busy:false},changingVault:false};
  const view={app,file,leaf,isLoaded:true,contentEl:{isConnected:true},captureDraft:()=>({provider:'core:canvas',root:app.vault.rootPath,path:file.path,state:state.draftState}),requestSave(){state.saves++;}};leaf.view=view;
  const board=Object.assign(Object.create(CanvasBoard.prototype),{document:model,disposed:false,generation:1,revision:1,loadedPath:file.path,loadedRoot:app.vault.rootPath,drag:null,view,selection:new Set(['g']),selectedEdge:'edge',camera:{x:10,y:20,scale:0.1,future:'retain'},stage:{clientWidth:800,clientHeight:600},transform(){state.transforms++;},renderSelection(){state.renderSelection++;},layoutChanged(){state.layout++;}});
  return{board,model,view,leaf,app,file,state,source};
}
test('Canvas Jump changes only selection/camera/layout, retaining exact dirty text and both Undo branches',()=>{
  const f=fixture();f.model.edit(data=>{data.nodes[0].text+=' earlier edit';});f.model.edit(data=>{data.nodes[0].text+=' redo branch';});f.model.undo();const before={text:f.model.text,data:JSON.stringify(f.model.data),past:JSON.stringify(f.model.past),future:JSON.stringify(f.model.future),revision:f.board.revision};
  f.board.jumpToCard('a',f.board.reviewAuthority());assert.deepEqual([...f.board.selection],['a']);assert.equal(f.board.selectedEdge,null);assert.equal(f.board.camera.future,'retain');assert.equal(f.state.layout,1);assert.equal(f.state.transforms,1);assert.equal(f.state.renderSelection,1);assert.equal(f.state.saves,0);assert.equal(f.board.revision,before.revision);assert.equal(f.model.text,before.text);assert.equal(JSON.stringify(f.model.data),before.data);assert.equal(JSON.stringify(f.model.past),before.past);assert.equal(JSON.stringify(f.model.future),before.future);assert.equal(f.state.draftState,'dirty');
});

test('Canvas dirty-history navigation proof uses distinct selected-node nudges and respects same-node coalescing',()=>{
  const originalNow=Date.now,originalElement=globalThis.Element;Date.now=()=>1000;globalThis.Element=class{};
  const event=key=>({key,code:key,ctrlKey:false,metaKey:false,shiftKey:false,target:null,preventDefault(){},stopPropagation(){}});
  const boardFixture=()=>{const f=fixture();f.board.selection=new Set(['a']);f.board.updateError=()=>{};f.board.render=()=>{};f.board.fail=error=>{throw error;};return f;};
  try{
    const same=boardFixture();same.board.keydown(event('ArrowRight'));same.board.keydown(event('ArrowDown'));assert.equal(same.model.past.length,1);same.board.undo();assert.equal(same.model.text,same.source,'Consecutive same-node nudges intentionally form one Undo entry');
    const distinct=boardFixture();distinct.board.keydown(event('ArrowRight'));const earlier=distinct.model.text;distinct.board.jumpToCard('g',distinct.board.reviewAuthority());distinct.board.keydown(event('ArrowDown'));assert.equal(distinct.model.past.length,2);distinct.board.undo();assert.equal(distinct.model.text,earlier);assert.notEqual(distinct.model.text,distinct.source);assert.equal(distinct.model.past.length,1);assert.equal(distinct.model.future.length,1);assert.equal(distinct.model.data.nodes[0].x,501);assert.equal(distinct.model.data.nodes[1].y,0);
  }finally{Date.now=originalNow;if(originalElement===undefined)delete globalThis.Element;else globalThis.Element=originalElement;}
});
test('A genuine live-clean capture retires an undone Canvas draft before closing; retired mismatched dirty text remains protected',async()=>{
  const run=async observeClean=>{const f=fixture(),backend=new MemoryDraftBackend(),store=new PersistentDraftStore(backend,{ownerId:observeClean?'live-clean':'retired-first'}),timers={setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}};let live=true;
    const capture=new PersistentDraftCapture(store,()=>live?[[f.file.path,{originRoot:f.app.vault.rootPath,provider:'core:canvas',dirty:f.model.text!==f.source,isSaving:false,text:f.model.text,document:{file:{path:f.file.path},version:'original',hasBom:true}}]]:[],{timers,currentRoot:()=>f.app.vault.rootPath,readCurrent:async()=>({state:'present',content:f.source,hasBom:true,version:'original'})});
    try{f.model.edit(data=>{data.future.diagnostic='dirty snapshot';});const protectedHealth=await capture.flush();assert.equal(protectedHealth.protecting,1);const protectedRecord=(await store.list()).drafts[0].record;assert.equal(protectedRecord.path,f.file.path);assert.equal(protectedRecord.content,f.model.text);f.model.undo();assert.equal(f.model.text,f.source);
      if(observeClean){const cleanHealth=await capture.flush();assert.equal(cleanHealth.protecting,0);assert.deepEqual(cleanHealth.retained,[]);}
      live=false;const retiredHealth=await capture.flush();assert.deepEqual(retiredHealth.failures,[]);assert.equal(retiredHealth.storageError,null);assert.equal(retiredHealth.protecting,observeClean?0:1);assert.equal(retiredHealth.retained.length,observeClean?0:1);const remaining=(await store.list()).drafts;assert.equal(remaining.length,observeClean?0:1);if(!observeClean)assert.equal(remaining[0].record.content,protectedRecord.content);assert.equal(f.model.text,f.source);assert.equal(f.state.saves,0);
    }finally{await capture.dispose();}
  };await run(false);await run(true);
});

test('Canvas Jump navigation remains available on a current cached read-only Canvas without any authoring call',()=>{
  const f=fixture();f.app.vault.readOnly=true;f.view.isReadOnlyForMutation=true;f.state.draftState='clean';const current=f.board.reviewAuthority();assert.equal(current(),true);f.board.jumpToCard('g',current);assert.deepEqual([...f.board.selection],['g']);assert.equal(f.model.text,f.source);assert.equal(f.state.saves,0);assert.equal(f.model.canUndo,false);assert.equal(f.model.canRedo,false);
});
test('Canvas Jump refuses a missing target before changing selection or camera',()=>{
  const f=fixture(),before=JSON.stringify(f.board.camera);assert.throws(()=>f.board.jumpToCard('absent',f.board.reviewAuthority()),/no longer exists/);assert.equal(JSON.stringify(f.board.camera),before);assert.deepEqual([...f.board.selection],['g']);assert.equal(f.state.layout,0);
});
test('Canvas Jump rechecks authority after measuring viewport size and before navigation',()=>{
  const f=fixture(),original=f.board.camera;let checks=0;assert.throws(()=>f.board.jumpToCard('a',()=>++checks===1),/changed/);assert.equal(f.board.camera,original);assert.deepEqual([...f.board.selection],['g']);assert.equal(f.state.layout,0);
});
test('Canvas Jump snapshots reject retired roots, leaves, source revisions, provider states and changing files',()=>{
  const retire=[f=>{f.app.vault.rootPath='Vault B';},f=>{f.leaf.view={};},f=>{f.app.workspace.getLeafById=()=>null;},f=>{f.view.file={...f.file};},f=>{f.file.path='Renamed.canvas';},f=>{f.app.vault.getFileByPath=()=>({...f.file});},f=>{f.board.document=new CanvasDocument(f.source);},f=>{f.model.edit(data=>{data.nodes[0].text='changed';});},f=>{f.board.revision++;},f=>{f.board.generation++;},f=>{f.board.disposed=true;},f=>{f.view.isLoaded=false;},f=>{f.view.contentEl.isConnected=false;},f=>{f.app.changingVault=true;},f=>{f.app.workspace.isChangingFiles=true;},f=>{f.app.core.isEnabled=()=>false;},f=>{f.app.core.busy=true;},f=>{f.board.drag={};},f=>{f.state.draftState='conflict';},f=>{f.board.selection.add('a');}];
  for(const change of retire){const f=fixture(),current=f.board.reviewAuthority(),camera=f.board.camera;assert.equal(current(),true);change(f);const before=f.model.text;assert.equal(current(),false);assert.throws(()=>f.board.jumpToCard('a',current),/changed/);assert.equal(f.board.camera,camera);assert.equal(f.model.text,before);assert.equal(f.state.layout,0);assert.equal(f.state.saves,0);}
});
test('Canvas Jump modal forced acceptance refuses a retired or stale owner before applying',()=>{
  for(const retired of [true,false]){let applied=0,closed=0;const choice={id:'a'},modal=Object.assign(Object.create(CanvasJumpModal.prototype),{retired,isOpen:true,containerEl:{isConnected:true},visible:[choice],results:{value:'a',disabled:false},search:{disabled:false},kind:{disabled:false},action:{disabled:false},error:{textContent:''},authority:{current:()=>false,apply(){applied++;}},close(){closed++;}});modal.accept();assert.equal(applied,0);assert.equal(closed,0);assert.equal(modal.action.disabled,true);assert.match(modal.error.textContent,/changed/);}
});
test('Canvas Jump accepts only a currently visible choice and restores focus after closing',()=>{
  const calls=[],modal=Object.assign(Object.create(CanvasJumpModal.prototype),{retired:false,isOpen:true,containerEl:{isConnected:true},visible:[{id:'a'}],results:{value:'a'},action:{disabled:false},error:{textContent:''},authority:{current:()=>true,apply(id){calls.push('apply:'+id);return()=>calls.push('focus');}},close(){calls.push('close');this.retired=true;}});modal.accept();assert.deepEqual(calls,['apply:a','close','focus']);
  calls.length=0;modal.retired=false;modal.results.value='forged';modal.accept();assert.deepEqual(calls,[]);assert.equal(modal.action.disabled,true);
});
test('Canvas Jump close aborts event listeners and releases provider subscriptions and retained results',()=>{
  const calls=[],events=new AbortController(),ref={emitter:{offref(value){calls.push(value);}}},modal=Object.assign(Object.create(CanvasJumpModal.prototype),{events,refs:[ref],visible:[{id:'a'}],retired:false,authority:{closed(){calls.push('closed');}}});modal.onClose();assert.equal(events.signal.aborted,true);assert.equal(modal.retired,true);assert.deepEqual(modal.visible,[]);assert.deepEqual(modal.refs,[]);assert.deepEqual(calls,[ref,'closed']);
});
async function commandFixture(run){
  const previous=globalThis.document,previousElement=globalThis.Element,f=fixture(),commands=new Map(),calls=[],state={active:true,markdown:false,focusedInput:false,find:0,jump:0};
  globalThis.Element=class{};
  globalThis.document={getElementById:()=>({append(){}})};
  const manager=new HotkeyManager({dispatch(id){calls.push(id);if(id==='editor:open-search'){if(!state.markdown)return false;state.find++;return true;}const command=commands.get(id);if(!command?.checkCallback(true))return false;return command.checkCallback(false)!==false;},isApplication:id=>id==='editor:open-search',allowInModal:()=>false});
  const event=(extra={})=>({key:'f',code:'KeyF',ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,isComposing:false,defaultPrevented:false,repeat:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra});
  manager.addDefaultHotkeys('editor:open-search',[{modifiers:['Mod'],key:'f'}]);
  f.board.stage.ownerDocument={get activeElement(){return{closest:()=>state.focusedInput?{}:null};}};f.view.canvas=f.board;f.board.jump=()=>{state.jump++;};
  f.app.workspace.getActiveViewOfType=type=>{assert.equal(type.name,'CanvasView');return state.active?f.view:null;};f.app.workspace.registerExtensions=()=>()=>{};
  f.app.commands={install(items){for(const command of items){commands.set(command.id,command);if(command.hotkeys)manager.addDefaultHotkeys(command.id,command.hotkeys);}return()=>{for(const command of items){commands.delete(command.id);manager.removeDefaultHotkeys(command.id);}};}};
  let install;f.app.core.register=(_id,loader)=>{install=loader;};f.app.core.installViews=async()=>async()=>{};
  new Canvases(f.app).register(f.app.core);
  try{await run({f,state,calls,commands,manager,event,install:()=>install()});}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;if(previousElement===undefined)delete globalThis.Element;else globalThis.Element=previousElement;}
}

test('Canvas Jump registers in the actual shared hotkey manager before unavailable Markdown search consumes Mod+F',async()=>{
  await commandFixture(async({f,state,calls,manager,event,install})=>{
    const swallowed=event();assert.equal(manager.handle(swallowed),true);assert.equal(swallowed.defaultPrevented,true);assert.deepEqual(calls,['editor:open-search']);assert.equal(state.jump,0);
    const dispose=await install();assert.deepEqual(manager.getDefaultHotkeys('canvas:jump-to-card'),[{modifiers:['Mod'],key:'f'}]);
    for(const readOnly of [false,true]){f.app.vault.readOnly=readOnly;calls.length=0;const key=event();assert.equal(manager.handle(key),true);assert.equal(key.defaultPrevented,true);assert.equal(key.stopped,true);assert.deepEqual(calls,['canvas:jump-to-card']);}
    assert.equal(state.jump,2);assert.equal(state.find,0);await dispose();assert.deepEqual(manager.getDefaultHotkeys('canvas:jump-to-card'),[]);
  });
});

test('Canvas Jump uses shared user overrides and falls through to note Find when no eligible Canvas is active',async()=>{
  await commandFixture(async({state,calls,manager,event,install})=>{
    const dispose=await install();manager.disableHotkeys('canvas:jump-to-card');calls.length=0;assert.equal(manager.handle(event()),true);assert.deepEqual(calls,['editor:open-search']);assert.equal(state.jump,0);
    manager.setHotkeys('canvas:jump-to-card',[{modifiers:['Mod'],key:'j'}]);calls.length=0;assert.equal(manager.handle(event()),true);assert.deepEqual(calls,['editor:open-search']);assert.equal(state.jump,0);assert.equal(manager.handle(event({key:'j',code:'KeyJ'})),true);assert.equal(state.jump,1);
    manager.removeHotkeys('canvas:jump-to-card');state.active=false;state.markdown=true;calls.length=0;assert.equal(manager.handle(event()),true);assert.deepEqual(calls,['canvas:jump-to-card','editor:open-search']);assert.equal(state.find,1);assert.equal(state.jump,1);await dispose();
  });
});

test('Canvas Jump shared routing refuses text inputs, composing/modal keys and stale or disabled Canvas owners',async()=>{
  await commandFixture(async({f,state,calls,manager,event,install})=>{
    const dispose=await install();state.focusedInput=true;assert.equal(manager.handle(event()),true);assert.equal(state.jump,0);state.focusedInput=false;
    calls.length=0;assert.equal(manager.handle(event({isComposing:true})),false);assert.deepEqual(calls,[]);assert.equal(manager.handle(event(),{modal:true}),false);assert.deepEqual(calls,[]);
    for(const change of [()=>{f.app.core.isEnabled=()=>false;},()=>{f.app.core.isEnabled=()=>true;f.board.disposed=true;},()=>{f.board.disposed=false;f.board.drag={};},()=>{f.board.drag=null;f.app.changingVault=true;}]){change();assert.equal(manager.handle(event()),true);assert.equal(state.jump,0);}
    f.app.changingVault=false;await dispose();calls.length=0;assert.equal(manager.handle(event()),true);assert.deepEqual(calls,['editor:open-search']);assert.equal(state.jump,0);
    const local={...event(),target:null};f.board.keydown(local);assert.equal(local.defaultPrevented,false);assert.equal(state.jump,0,'The local board handler cannot bypass a disabled or remapped shared hotkey');
  });
});
function selectionTools(size,{ignoreKeyboard=false}={}){
  const prefix='[data-canvas-jump] ',selector=prefix+'[data-canvas-jump-'+(size>1?'results':'kind')+']',search=prefix+'[data-canvas-jump-search]',values=size>1?['first','second','chosen']:['all','Text card','File card','Website','Group','Other card'],control={size,multiple:false,disabled:false,selectedIndex:0,options:values.map(value=>({value})),get value(){return values[this.selectedIndex];}},searchNode={},other={},calls=[];let active=other,popup=false;
  const doc={querySelector:value=>value===selector?control:value===search?searchNode:null,get activeElement(){return active;}};
  return{selector,search,control,calls,report:{},async evaluate(source){return new Function('document','return ('+source+')')(doc);},async click(value){calls.push({type:'click',selector:value});active=value===selector?control:searchNode;if(value===selector){if(size<=1)popup=true;else control.selectedIndex=1;}},async press(key){calls.push({type:'key',key});if(popup)throw Error('The helper opened a native popup rather than focusing its collapsed select');if(key==='Tab')active=active===searchNode?control:other;else if(active===control&&!ignoreKeyboard){if(key==='Home')control.selectedIndex=0;else if(key==='ArrowDown')control.selectedIndex=Math.min(values.length-1,control.selectedIndex+1);}}};
}

test('Canvas dropdown selection helper uses search then Tab to avoid a native popup and records actual readbacks',async()=>{
  const tools=selectionTools(0);await chooseCanvasControl(tools,tools.selector,'File card');assert.deepEqual(tools.calls,[{type:'click',selector:tools.search},{type:'key',key:'Tab'},{type:'key',key:'Home'},{type:'key',key:'ArrowDown'},{type:'key',key:'ArrowDown'},{type:'key',key:'Tab'}]);const record=tools.report.canvasNavigationSelections[0];assert.equal(record.mode,'collapsed-kind-by-trusted-tab');assert.equal(record.focus.focused,true);assert.equal(record.after.value,'File card');assert.deepEqual(record.steps.map(step=>step.state.value),['all','Text card','File card']);assert.equal(record.failure,undefined);
});

test('Canvas visible-list helper retains pointer selection and preserves failed value/focus diagnostics before rejecting',async()=>{
  const tools=selectionTools(8);await chooseCanvasControl(tools,tools.selector,'chosen');assert.equal(tools.calls[0].selector,tools.selector);assert.equal(tools.report.canvasNavigationSelections[0].mode,'visible-list');assert.equal(tools.control.value,'chosen');
  const failed=selectionTools(0,{ignoreKeyboard:true});await assert.rejects(()=>chooseCanvasControl(failed,failed.selector,'File card'),/actual keyboard-selected Canvas option/);const record=failed.report.canvasNavigationSelections[0];assert.equal(record.after.value,'all');assert.equal(record.failure.value,'all');assert.equal(record.expected,'File card');assert.equal(record.focus.focused,true);assert.equal(record.steps.length,3);
});

test('Canvas capture helper retains returned unhealthy drain and owner diagnostics before rejecting',async()=>{
  const health={protecting:1,failures:[],retained:['Vault A\u0000Boards/Exact.canvas'],lastPassAt:123,storageError:null},ownerState={health,root:'Vault A',queues:{workspaceDirty:false},views:[],sessions:[]},tools={report:{},async evaluate(source){new Function('return ('+source+')');if(source==='globalThis.slopsidianDraftCapture.status()')return health;if(source.includes('flushed=await c.flush()'))return{flushed:health,after:health};if(source.includes('const w=app.workspace'))return ownerState;throw Error('Unexpected capture readback');}};
  await assert.rejects(()=>drainCanvasCapture(tools,'failed owned close'));const record=tools.report.canvasNavigationDrains[0];assert.deepEqual(record.before,health);assert.deepEqual(record.flushed,health);assert.deepEqual(record.after,health);assert.match(record.failure,/AssertionError/);assert.equal(record.failureState.state,ownerState);assert.equal(tools.report.canvasNavigationCaptureTransitions[0],record.failureState);
});

test('Stale Canvas export hides the emptied preview and releases its URL, raster work and downloads',()=>{
  const original=URL.revokeObjectURL,revoked=[],removed=[],controller=new AbortController(),timer=setTimeout(()=>{},100000);URL.revokeObjectURL=url=>revoked.push(url);
  try{const modal=Object.assign(Object.create(CanvasExportModal.prototype),{revision:4,prepared:{keep:false},preparation:controller,preview:{hidden:false,removeAttribute:name=>removed.push(name)},previewUrl:'blob:preview',downloads:new Map([['blob:download',timer]]),stale:false,action:{disabled:false},status:{textContent:''},error:{textContent:''}});modal.invalidate();assert.equal(modal.stale,true);assert.equal(modal.action.disabled,true);assert.equal(modal.preview.hidden,true);assert.deepEqual(removed,['src']);assert.equal(controller.signal.aborted,true);assert.equal(modal.previewUrl,null);assert.equal(modal.prepared,null);assert.equal(modal.downloads.size,0);assert.deepEqual(revoked,['blob:preview','blob:download']);assert.match(modal.status.textContent,/stale/);assert.match(modal.error.textContent,/Canvas changed/);}finally{clearTimeout(timer);URL.revokeObjectURL=original;}
});
