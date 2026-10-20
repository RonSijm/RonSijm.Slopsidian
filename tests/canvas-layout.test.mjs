import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {activateCanvasLayoutByEnter,canvasLayoutReadOnlyFixture} from '../tools/canvas-layout-scenarios.mjs';

const stubs=new Map([
  ['./reading','export class ReadingView {}'],['./views','export class TextFileView {}'],['./menu','export class Menu {}'],
  ['./view-panel','export class ResponsiveViewPanel {}'],['./icons','export function iconButton() {}'],['./dom','export function reportError() {}'],
  ['./vault','export class TFile {}'],['./ui','export class Modal {} export class Notice {}'],
]);
const bundle=await build({stdin:{contents:'export * from "./client/canvas-layout"; export * from "./client/canvas-layout-modal"; export {CanvasBoard} from "./client/canvas"; export {CanvasDocument} from "./client/canvas-model";',resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent',outfile:'x.mjs',plugins:[{name:'canvas-layout-pure',setup(builder){builder.onResolve({filter:/^\.\/(reading|views|menu|view-panel|icons|dom|vault|ui)$/},args=>({path:args.path,namespace:'canvas-layout-stub'}));builder.onLoad({filter:/.*/,namespace:'canvas-layout-stub'},args=>({contents:stubs.get(args.path),loader:'js'}));}}]});
const output=fileURLToPath(new URL('../.runtime/canvas-layout-test.mjs',import.meta.url));await mkdir(fileURLToPath(new URL('../.runtime/',import.meta.url)),{recursive:true});await writeFile(output,bundle.outputFiles[0].text);
const {CanvasDocument,CanvasBoard,CanvasLayoutModal,canvasLayoutKinds,canvasLayoutLimits,canvasLayoutPreview,readCanvasLayoutSettings,planCanvasLayout:plan,applyCanvasLayout:apply}=await import(pathToFileURL(output).href);
const card=(id,extra={})=>({id,type:'text',text:'Literal λ 😀',x:0,y:0,width:100,height:80,...extra});
const fixture=()=>({future:{retained:[null,false,1.25,'😀']},nodes:[card('a',{x:-31,y:19,width:101,height:65,future:{literal:'<b>keep</b>'}}),card('b',{type:'file',file:'Notes/α.md',subpath:'#Chosen',x:170,y:-33,width:54,height:88}),card('c',{type:'link',url:'https://example.invalid/literal',x:399,y:270,width:150,height:111,color:'#abc'})],edges:[{id:'e',fromNode:'a',toNode:'b',fromSide:'bottom',toSide:'right',label:'Exact & Ω',future:{keep:true}}]});
const all=data=>new Set(data.nodes.map(node=>node.id)),settings=(kind='grid',extra={})=>({kind,columns:2,gap:32,...extra});
function positions(data){return Object.fromEntries(data.nodes.map(node=>[node.id,[node.x,node.y]]));}
function sameExceptPositions(after,before){assert.deepEqual(after.edges,before.edges);assert.deepEqual(after.future,before.future);assert.deepEqual(after.nodes.map(n=>n.id),before.nodes.map(n=>n.id));for(let i=0;i<before.nodes.length;i++){const a={...after.nodes[i]},b={...before.nodes[i]};delete a.x;delete a.y;delete b.x;delete b.y;assert.deepEqual(a,b);}}
function changed(data,selected=all(data),choices=settings()){
  const source=JSON.stringify(data,null,2).replaceAll('\n','\r\n')+'\r\n',document=new CanvasDocument(source),before=JSON.stringify(document.data),p=plan(document.data,selected,choices);
  assert.equal(JSON.stringify(document.data),before,'Review is nonmutating');assert.equal(document.canUndo,false);assert.equal(document.edit(value=>apply(value,p)),true);assert.equal(document.past.length,1);sameExceptPositions(document.data,data);
  const result=document.text;assert.equal(document.undo(),true);assert.equal(document.text,source);assert.equal(document.canUndo,false);assert.equal(document.redo(),true);assert.equal(document.text,result);return{document,p,source};
}

test('Grid fits heterogeneous cells in visual order and preserves exact source on one Undo and Redo',()=>{
  const data=fixture(),{document,p}=changed(data);assert.deepEqual(positions(document.data),{a:[151,-33],b:[-31,-33],c:[-31,87]});assert.equal(p.units,3);assert.equal(p.members,3);assert.equal(p.usedConnections,1);assert.equal(p.connectedSets,2);assert.equal(p.cycleClusters,0);assert.equal(p.omittedConnections,0);
});
test('Single row and column use actual sizes and the original selection top-left corner',()=>{
  assert.deepEqual(positions(changed(fixture(),undefined,settings('row')).document.data),{a:[55,-33],b:[-31,-33],c:[188,-33]});
  assert.deepEqual(positions(changed(fixture(),undefined,settings('column')).document.data),{a:[-31,87],b:[-31,-33],c:[-31,184]});
});
test('Grid with one or excess columns and zero spacing remains bounded and nonoverlapping',()=>{
  assert.deepEqual(positions(changed(fixture(),undefined,settings('grid',{columns:1,gap:0})).document.data),{a:[-31,55],b:[-31,-33],c:[-31,120]});
  assert.deepEqual(positions(changed(fixture(),undefined,settings('grid',{columns:1000,gap:0})).document.data),{a:[23,-33],b:[-31,-33],c:[124,-33]});
});
test('Visual ties use IDs independent of node, selection and edge input order',()=>{
  const data={nodes:[card('z'),card('a'),card('m')],edges:[]};const expected={a:[0,0],m:[132,0],z:[0,112]};
  for(const nodes of [data.nodes,[...data.nodes].reverse(),[data.nodes[1],data.nodes[0],data.nodes[2]]]){const source={...data,nodes};assert.deepEqual(positions(changed(source,new Set(['m','z','a'])).document.data),expected);}
});
test('Left-to-right hierarchy ranks a directed pair and packs the disconnected item separately',()=>{
  const{document}=changed(fixture(),undefined,settings('hierarchy-right'));assert.deepEqual(positions(document.data),{a:[-31,-22],b:[102,-33],c:[-31,119]});
});
test('Top-to-bottom hierarchy transposes ranking dimensions and centers each level with integer rounding',()=>{
  const{document}=changed(fixture(),undefined,settings('hierarchy-down'));assert.deepEqual(positions(document.data),{a:[-31,-33],b:[-8,64],c:[134,-33]});
});
test('Hierarchy longest-path levels respect every DAG edge rather than first visitation',()=>{
  const data={nodes:['a','b','c','d'].map((id,i)=>card(id,{x:i*300,y:i*400})),edges:[['a','d'],['a','b'],['b','c'],['c','d']].map(([fromNode,toNode],i)=>({id:String(i),fromNode,toNode}))};
  const{document}=changed(data,undefined,settings('hierarchy-right'));assert.deepEqual(Object.values(positions(document.data)),[[0,0],[132,0],[264,0],[396,0]]);
});
test('Cycles condense to one level, stay adjacent and preserve all original connection fields',()=>{
  const data={nodes:['a','b','c','d'].map((id,i)=>card(id,{x:i*300,y:i*400})),edges:[['a','b'],['b','a'],['b','c'],['c','d']].map(([fromNode,toNode],i)=>({id:String(i),fromNode,toNode,future:{keep:i}}))};
  const{document,p}=changed(data,undefined,settings('hierarchy-right'));assert.equal(p.cycleClusters,1);assert.equal(p.connectedSets,1);assert.deepEqual(positions(document.data),{a:[0,0],b:[0,112],c:[132,56],d:[264,56]});
});
test('Reverse arrowheads reverse the rank; two-headed and arrowless links form a same-level cluster',()=>{
  for(const ends of [{fromEnd:'arrow',toEnd:'none'},{fromEnd:'arrow',toEnd:'arrow'},{fromEnd:'none',toEnd:'none'}]){
    const data={nodes:[card('a',{x:40,y:50}),card('b',{x:500,y:500})],edges:[{id:'e',fromNode:'a',toNode:'b',...ends}]},{document,p}=changed(data,undefined,settings('hierarchy-right'));
    if(ends.fromEnd==='arrow'&&ends.toEnd==='none'){assert.deepEqual(positions(document.data),{a:[172,50],b:[40,50]});assert.equal(p.cycleClusters,0);}else{assert.deepEqual(positions(document.data),{a:[40,50],b:[40,162]});assert.equal(p.cycleClusters,1);assert.equal(p.connections.length,2);}
  }
});
test('Hierarchy geometry is stable under reordered nodes, selections, parallel edges and disconnected sets',()=>{
  const nodes=['d','b','e','a','c'].map((id,i)=>card(id,{x:30+i*170,y:40+i*130})),edges=[{id:'ab',fromNode:'a',toNode:'b'},{id:'ab2',fromNode:'a',toNode:'b'},{id:'bc',fromNode:'b',toNode:'c'},{id:'cb',fromNode:'c',toNode:'b'},{id:'de',fromNode:'d',toNode:'e'}];
  const first=changed({nodes,edges},new Set(['e','d','c','b','a']),settings('hierarchy-right'));
  const second=changed({nodes:[...nodes].reverse(),edges:[...edges].reverse()},new Set(['a','b','c','d','e']),settings('hierarchy-right'));
  assert.deepEqual(positions(second.document.data),positions(first.document.data));assert.deepEqual(second.p.frames,first.p.frames);assert.deepEqual(second.p.connections,first.p.connections);assert.equal(first.p.connectedSets,2);assert.equal(first.p.cycleClusters,1);assert.equal(first.p.usedConnections,5);assert.equal(first.p.connections.length,4);
});
test('Self loops, internal group links and outside-selection links are retained and omitted from ranking',()=>{
  const data={nodes:[card('a',{x:10,y:10}),card('b',{x:400,y:500}),card('outside',{x:900,y:900})],edges:[{id:'self',fromNode:'a',toNode:'a'},{id:'outside',fromNode:'outside',toNode:'b'}]};
  const{document,p}=changed(data,new Set(['a','b']),settings('hierarchy-right'));assert.deepEqual(positions(document.data).outside,[900,900]);assert.equal(p.usedConnections,0);assert.equal(p.omittedConnections,2);assert.equal(p.connectedSets,2);assert.equal(p.cycleClusters,0);
});
function familyFixture(){return{future:{keep:'root'},nodes:[card('group',{type:'group',label:'Outer Ω',x:300,y:-100,width:250,height:400,background:'Assets/α.png',backgroundStyle:'repeat',future:{keep:true}}),card('nested',{type:'group',label:'Nested',x:350,y:-50,width:100,height:200}),card('child',{x:360,y:0,width:40,height:50,future:[1,2]}),card('sibling',{x:480,y:200,width:40,height:50}),card('a',{x:0,y:500,width:80,height:90}),card('c',{x:600,y:1000,width:120,height:90})],edges:[{id:'child-edge',fromNode:'child',toNode:'c',future:{keep:'edge'}},{id:'frame-edge',fromNode:'group',toNode:'a',label:'Keep'}]};}
test('Nested selected groups and explicit children form rigid units with each member moved once',()=>{
  for(const kind of ['grid','row','hierarchy-right','hierarchy-down']){
    const data=familyFixture(),{document,p}=changed(data,new Set(['group','nested','child','a','c']),settings(kind));assert.equal(p.units,3);assert.equal(p.members,6);
    const before=data.nodes[0],after=document.data.nodes[0];for(let i=1;i<4;i++){assert.equal(document.data.nodes[i].x-data.nodes[i].x,after.x-before.x);assert.equal(document.data.nodes[i].y-data.nodes[i].y,after.y-before.y);}assert.equal(p.usedConnections,2);
  }
});
test('A child connection participates through its selected outer group without changing stored endpoints',()=>{
  const data=familyFixture(),{document,p}=changed(data,new Set(['group','a','c']),settings('hierarchy-right'));assert.equal(p.connectedSets,1);assert.equal(document.data.nodes[0].x,0);assert.equal(document.data.nodes.find(n=>n.id==='a').x,282);assert.equal(document.data.nodes.find(n=>n.id==='c').x,282);assert.deepEqual(document.data.edges,data.edges);
});
test('Ambiguous equal or partly overlapping selected group families refuse before history',()=>{
  for(const extra of [{id:'equal',x:300,y:-100,width:250,height:400},{id:'partial',x:400,y:-80,width:250,height:400}]){
    const data=familyFixture();data.nodes.push(card(extra.id,{...extra,type:'group',label:'Ambiguous'}));const document=new CanvasDocument(JSON.stringify(data));assert.throws(()=>document.edit(value=>apply(value,plan(value,new Set(['group','a']),settings()))),/overlap ambiguously/);assert.equal(document.canUndo,false);
  }
});
test('Layout refuses capturing unselected cards into a moved group',()=>{
  const data={nodes:[card('g',{type:'group',x:300,y:0,width:200,height:200}),card('a',{x:0,y:500,width:100,height:80}),card('unrelated',{x:20,y:20,width:30,height:30})],edges:[]};assert.throws(()=>plan(data,new Set(['g','a']),settings('row')),/into or out of/);
});
test('Layout refuses releasing children from an unselected group and newly ambiguous frame overlap',()=>{
  const release={nodes:[card('parent',{type:'group',x:0,y:0,width:250,height:250}),card('child',{x:10,y:10,width:50,height:50}),card('other',{x:600,y:-500,width:50,height:50})],edges:[]};assert.throws(()=>plan(release,new Set(['child','other']),settings('column',{gap:300})),/into or out of/);
  const partial={nodes:[card('g',{type:'group',x:300,y:0,width:100,height:100}),card('unselected',{type:'group',x:-50,y:30,width:100,height:100}),card('a',{x:0,y:500,width:50,height:50})],edges:[]};assert.throws(()=>plan(partial,new Set(['g','a']),settings('row')),/overlap group frames/);
});
test('Invalid choices, empty and missing selections, a lone family and invalid edges refuse without mutation',()=>{
  const data=fixture(),source=JSON.stringify(data);
  for(const choices of [settings('bad'),settings('grid',{columns:0}),settings('grid',{columns:1001}),settings('grid',{columns:1.5}),settings('grid',{gap:-1}),settings('grid',{gap:1001}),settings('grid',{gap:NaN}),settings('grid',{gap:0.5})])assert.throws(()=>plan(data,all(data),choices),/Choose|integer/);
  for(const selected of [new Set(),new Set(['missing']),new Set(['a'])])assert.throws(()=>plan(data,selected,settings()),/Select/);
  assert.throws(()=>plan(familyFixture(),new Set(['group','nested','child']),settings()),/at least two independent/);
  const invalid={...data,edges:[{id:'bad',fromNode:'a',toNode:'missing'}]};assert.throws(()=>plan(invalid,all(data),settings()),/absent card/);assert.equal(JSON.stringify(data),source);
});
test('Inactive column drafts do not block row or hierarchy choices and canonical settings have no extraneous fields',()=>{
  assert.deepEqual(readCanvasLayoutSettings({...settings('row',{columns:NaN}),extra:true}),{kind:'row',columns:1,gap:32});assert.equal(readCanvasLayoutSettings(settings('hierarchy-right',{columns:0})).columns,1);assert.ok(Object.isFrozen(readCanvasLayoutSettings(settings())));
});
test('No-op grid, row, column and hierarchy layouts refuse before adding any history',()=>{
  for(const kind of canvasLayoutKinds.map(kind=>kind.id)){
    const first=changed(fixture(),undefined,settings(kind)),document=first.document,source=document.text,past=document.past.length;assert.throws(()=>plan(document.data,all(document.data),settings(kind)),/already have this layout/);assert.equal(document.text,source);assert.equal(document.past.length,past);
  }
});
test('Automatic layout caps independent units while allowing a 1,000-item chain without recursive traversal',()=>{
  const nodes=Array.from({length:1000},(_,i)=>card(String(i).padStart(4,'0'),{x:0,y:i*3,width:1,height:1})),edges=nodes.slice(1).map((node,i)=>({id:'e'+i,fromNode:nodes[i].id,toNode:node.id}));
  const p=plan({nodes,edges},new Set(nodes.map(n=>n.id)),settings('hierarchy-right',{gap:1}));assert.equal(p.units,1000);assert.equal(p.connectedSets,1);assert.equal(p.cycleClusters,0);assert.equal(p.frames.at(-1).x,1998);
  const tooMany={nodes:[...nodes,card('excess')],edges};assert.throws(()=>plan(tooMany,all(tooMany),settings()),/at most 1,000/);
});
test('A 1,000-item cycle is condensed iteratively without stack overflow',()=>{
  const nodes=Array.from({length:1000},(_,i)=>card(String(i).padStart(4,'0'),{x:i*3,y:0,width:1,height:1})),edges=nodes.map((node,i)=>({id:'e'+i,fromNode:node.id,toNode:nodes[(i+1)%nodes.length].id})),p=plan({nodes,edges},all({nodes}),settings('hierarchy-down',{gap:1}));assert.equal(p.cycleClusters,1);assert.equal(p.connectedSets,1);assert.ok(p.frames.every(n=>n.y===0));assert.equal(p.frames.at(-1).x,1998);
});
test('Dense 20,000-edge inputs stay within the work budget, deduplicate ranks and cap only diagram links',()=>{
  const nodes=Array.from({length:210},(_,i)=>card(String(i).padStart(4,'0'),{x:i*3,y:i*5,width:2,height:2})),edges=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length&&edges.length<20000;j++)edges.push({id:'e'+edges.length,fromNode:nodes[i].id,toNode:nodes[j].id});
  const p=plan({nodes,edges},all({nodes}),settings('hierarchy-right',{gap:1}));assert.equal(p.usedConnections,20000);assert.equal(p.connections.length,canvasLayoutLimits.previewConnections);assert.ok(p.frames.every(n=>Number.isSafeInteger(n.x)&&Number.isSafeInteger(n.y)));
});
test('Group relationship admission, coordinate overflow and model card/edge limits refuse without history',()=>{
  const groups=Array.from({length:1420},(_,i)=>card('g'+i,{type:'group',x:i*2,y:i*2,width:1,height:1}));assert.throws(()=>plan({nodes:groups,edges:[]},new Set(['g0','g1']),settings()),/too many group relationships/);
  const overflow={nodes:[card('a',{x:9999999,y:0,width:10}),card('b',{x:9999999,y:1000,width:10})],edges:[]},document=new CanvasDocument(JSON.stringify(overflow));assert.throws(()=>document.edit(value=>apply(value,plan(value,all(value),settings('row')))),/Card x/);assert.equal(document.canUndo,false);
  assert.throws(()=>plan({nodes:Array.from({length:5001},(_,i)=>card('n'+i)),edges:[]},new Set(['n0','n1']),settings()),/5,000 cards/);
});
test('Reviewed plans and all mutable leaves are frozen and privately branded',()=>{
  const p=plan(fixture(),all(fixture()),settings());for(const value of [p,p.settings,p.positions,p.positions[0],p.selection,p.frames,p.frames[0],p.connections,p.connections[0]])assert.equal(Object.isFrozen(value),true);
  assert.throws(()=>{p.positions[0].x=99;},TypeError);assert.throws(()=>apply(fixture(),{...p}),/not reviewed/);assert.throws(()=>apply(fixture(),new Proxy(p,{})),/not reviewed/);
});
test('Source changes, replaced IDs and retained previously applied plans cannot be replayed',()=>{
  const data=fixture(),p=plan(data,all(data),settings());for(const change of [value=>{value.future.changed=true;},value=>{value.nodes[0].text+='new';},value=>{value.nodes[0].x++;},value=>{value.edges[0].label+='new';}]){const other=structuredClone(data);change(other);const before=JSON.stringify(other);assert.throws(()=>apply(other,p),/Canvas changed/);assert.equal(JSON.stringify(other),before);}
  const changed=structuredClone(data);apply(changed,p);const before=JSON.stringify(changed);assert.throws(()=>apply(changed,p),/Canvas changed/);assert.equal(JSON.stringify(changed),before);
});

function boardFixture(){const data=fixture(),source=JSON.stringify(data,null,2).replaceAll('\n','\r\n')+'\r\n',model=new CanvasDocument(source),file={path:'Boards/Layout.canvas'},leaf={id:'layout-leaf'},state={saves:0,draft:'clean',renders:0,provider:'core:canvas',draftPath:null,draftRoot:null};const app={vault:{rootPath:'Vault A',readOnly:false,getFileByPath:path=>path===file.path?file:null},workspace:{getLeafById:id=>id===leaf.id?leaf:null,isChangingFiles:false},core:{isEnabled:()=>true,busy:false},changingVault:false};const view={app,file,leaf,isLoaded:true,contentEl:{isConnected:true},isReadOnlyForMutation:false,captureDraft:()=>({provider:state.provider,root:state.draftRoot??app.vault.rootPath,path:state.draftPath??file.path,state:state.draft}),requestSave(){state.saves++;}};leaf.view=view;const board=Object.assign(Object.create(CanvasBoard.prototype),{document:model,disposed:false,generation:1,revision:1,loadedPath:file.path,loadedRoot:app.vault.rootPath,drag:null,view,selection:all(data),selectedEdge:null,stage:{focus(){}},updateError(){},render(){state.renders++;}});return{board,model,view,leaf,app,file,state,source};}
test('Board applies one reviewed layout as one shared edit, retains selection, saves once and restores exact source',()=>{
  const f=boardFixture(),p=plan(f.model.data,f.board.selection,settings()),selected=[...f.board.selection];const focus=f.board.applyLayout(p,f.board.reviewAuthority());assert.equal(f.model.past.length,1);assert.equal(f.state.saves,1);assert.deepEqual([...f.board.selection],selected);assert.equal(typeof focus,'function');f.board.undo();assert.equal(f.model.text,f.source);f.board.redo();assert.deepEqual(positions(f.model.data),{a:[151,-33],b:[-31,-33],c:[-31,87]});
});
test('Layout preserves earlier Undo boundaries and clears the old Redo branch once',()=>{
  const f=boardFixture();f.model.edit(data=>{data.future.first=true;});f.model.edit(data=>{data.future.redo=true;});f.model.undo();const before=f.model.text;pApply(f);assert.equal(f.model.past.length,2);assert.equal(f.model.canRedo,false);assert.equal(f.state.saves,1);f.board.undo();assert.equal(f.model.text,before);
});
function pApply(f){f.board.applyLayout(plan(f.model.data,f.board.selection,settings()),f.board.reviewAuthority());}
test('Read-only or obsolete Board review owners refuse before model, selection, history, render or save',()=>{
  const retire=[f=>{f.app.vault.readOnly=true;},f=>{f.view.isReadOnlyForMutation=true;},f=>{f.app.vault.rootPath='Vault B';},f=>{f.leaf.view={};},f=>{f.app.workspace.getLeafById=()=>null;},f=>{f.view.file={...f.file};},f=>{f.file.path='Renamed.canvas';},f=>{f.app.vault.getFileByPath=()=>({...f.file});},f=>{f.board.document=new CanvasDocument(f.source);},f=>{f.model.edit(data=>{data.nodes[0].text='Changed';});},f=>{f.board.revision++;},f=>{f.board.generation++;},f=>{f.board.disposed=true;},f=>{f.view.isLoaded=false;},f=>{f.view.contentEl.isConnected=false;},f=>{f.app.changingVault=true;},f=>{f.app.workspace.isChangingFiles=true;},f=>{f.app.core.isEnabled=()=>false;},f=>{f.app.core.busy=true;},f=>{f.board.drag={};},f=>{f.state.draft='conflict';},f=>{f.state.draft='saving';},f=>{f.state.provider='other';},f=>{f.state.draftPath='Other.canvas';},f=>{f.state.draftRoot='Vault B';},f=>{f.board.loadedPath='Other.canvas';},f=>{f.board.loadedRoot='Vault B';},f=>{f.board.selection.delete('a');}];
  for(const change of retire){const f=boardFixture(),current=f.board.reviewAuthority(),p=plan(f.model.data,f.board.selection,settings());change(f);const before=f.model.text,history=JSON.stringify([f.model.past,f.model.future]),selection=[...f.board.selection];assert.throws(()=>f.board.applyLayout(p,current),/changed/);assert.equal(f.model.text,before);assert.equal(JSON.stringify([f.model.past,f.model.future]),history);assert.deepEqual([...f.board.selection],selection);assert.equal(f.state.saves,0);assert.equal(f.state.renders,0);}
});
test('A branded plan from another selection cannot be smuggled through a new Board authority',()=>{
  const f=boardFixture(),p=plan(f.model.data,new Set(['a','b']),settings());assert.throws(()=>f.board.applyLayout(p,f.board.reviewAuthority()),/selection changed/);assert.equal(f.model.text,f.source);assert.equal(f.state.saves,0);
});

class FakeElement{constructor(tag,owner){this.tagName=tag;this.ownerDocument=owner;this.children=[];this.attributes={};this.dataset={};this.classNames=[];this.classList={add:(...names)=>this.classNames.push(...names)};this.hidden=false;this.disabled=false;this.textContent='';}setAttribute(key,value){this.attributes[key]=value;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}focus(){this.focused=true;}}
const fakeDocument=()=>{const doc={createElementNS(_ns,tag){return new FakeElement(tag,doc);}};return doc;};
function descendants(root){return[root,...root.children.flatMap(node=>typeof node==='object'?descendants(node):[])];}
test('Abstract SVG renders bounded outlines and inert labels without image, file, URL, HTML or rich mounts',()=>{
  const p=plan(fixture(),all(fixture()),settings()),svg=canvasLayoutPreview(p,fakeDocument()),nodes=descendants(svg);assert.equal(svg.tagName,'svg');assert.equal(svg.attributes.role,'img');assert.match(svg.attributes['aria-label'],/3 independent/);assert.equal(nodes.filter(node=>node.tagName==='rect').length,3);assert.equal(nodes.filter(node=>node.tagName==='path').length,1);assert.ok(nodes.every(node=>['svg','path','rect','title','text'].includes(node.tagName)));assert.ok(nodes.every(node=>!('href'in node.attributes)));assert.ok(nodes.every(node=>!JSON.stringify(node.attributes).includes('Infinity')));
});
test('Malicious card IDs remain literal SVG title text and never create active markup',()=>{
  const data=fixture();data.nodes[0].id='a"><image href="https://example.invalid/" onload="x">';data.edges[0].fromNode=data.nodes[0].id;const svg=canvasLayoutPreview(plan(data,all(data),settings()),fakeDocument()),nodes=descendants(svg);assert.equal(nodes.filter(node=>node.tagName==='rect').length,3);assert.ok(nodes.some(node=>node.tagName==='title'&&node.textContent.includes('<image')));assert.equal(nodes.filter(node=>node.tagName==='image').length,0);
});
function modalFixture(data=fixture()){
  let current=true,applied=0,closed=0;const owner=fakeDocument(),element=tag=>new FakeElement(tag,owner),m=Object.assign(Object.create(CanvasLayoutModal.prototype),{isOpen:true,containerEl:{isConnected:true},modalEl:{ownerDocument:owner},retired:false,reviewed:null,error:element('p'),status:element('p'),preview:element('div'),review:element('button'),apply:element('button'),columnsLabel:element('label'),kind:{value:'grid',disabled:false},columns:{value:'2',disabled:false},gap:{value:'32',disabled:false},authority:{current:()=>current,plan:choices=>plan(data,all(data),choices),apply(){applied++;},closed(){closed++;}},close(){this.isOpen=false;this.retired=true;closed++;}});return{m,setCurrent:value=>{current=value;},applied:()=>applied,closed:()=>closed};
}
test('Modal preparation only reviews; separate Apply commits once through the real Board and CanvasDocument',()=>{
  const f=boardFixture(),ui=modalFixture(f.model.data),m=ui.m,current=f.board.reviewAuthority();m.authority={current:()=>f.board.writable()&&current(),plan:choices=>plan(f.model.data,f.board.selection,choices),apply:p=>f.board.applyLayout(p,current)};f.board.layoutReview=m;m.prepare();assert.equal(f.model.text,f.source);assert.equal(f.state.saves,0);assert.equal(m.preview.hidden,false);assert.equal(m.apply.disabled,false);assert.ok(m.reviewed);m.accept();assert.equal(m.isOpen,false);assert.equal(f.model.past.length,1);assert.equal(f.state.saves,1);f.board.undo();assert.equal(f.model.text,f.source);m.accept();assert.equal(f.model.text,f.source);
});
test('Choice changes retire old geometry and require a new Review before Apply',()=>{
  const f=modalFixture();f.m.prepare();const first=f.m.reviewed;f.m.gap.value='64';f.m.choicesChanged();assert.equal(f.m.reviewed,null);assert.equal(f.m.apply.disabled,true);assert.equal(f.m.preview.hidden,true);f.m.accept();assert.equal(f.applied(),0);f.m.prepare();assert.notEqual(f.m.reviewed,first);assert.equal(f.m.reviewed.settings.gap,64);f.m.accept();assert.equal(f.applied(),1);
});
test('Programmatic choice changes without an input event cannot apply the retained plan',()=>{
  const f=modalFixture();f.m.prepare();f.m.columns.value='3';f.m.accept();assert.equal(f.applied(),0);assert.equal(f.m.reviewed,null);assert.equal(f.m.apply.disabled,true);assert.match(f.m.status.textContent,/Review layout/);
});
test('Invalid input and no-op preparation clear the diagram and never leave an enabled old Apply',()=>{
  const f=modalFixture();f.m.prepare();f.m.gap.value='';f.m.prepare();assert.equal(f.m.reviewed,null);assert.equal(f.m.apply.disabled,true);assert.equal(f.m.preview.hidden,true);assert.match(f.m.error.textContent,/integer/);f.m.accept();assert.equal(f.applied(),0);
  const data={nodes:[card('a'),card('b',{x:132})],edges:[]},noOp=modalFixture(data);noOp.m.kind.value='row';noOp.m.prepare();assert.equal(noOp.m.apply.disabled,true);assert.match(noOp.m.error.textContent,/already have this layout/);
});
test('Closed, disconnected, retired, owner-stale and selection-stale retained modal Apply and Review refuse',()=>{
  for(const retire of [f=>{f.m.isOpen=false;},f=>{f.m.containerEl.isConnected=false;},f=>{f.setCurrent(false);},f=>{f.m.retired=true;}]){const f=modalFixture();f.m.prepare();retire(f);f.m.accept();f.m.prepare();assert.equal(f.applied(),0);assert.equal(f.m.apply.disabled,true);assert.equal(f.m.review.disabled,true);assert.equal(f.m.kind.disabled,true);assert.equal(f.m.reviewed,null);}
});
test('A stale owner detected while planning never exposes its completed geometry for Apply',()=>{
  const f=modalFixture(),original=f.m.authority.plan;f.m.authority.plan=choices=>{const p=original(choices);f.setCurrent(false);return p;};f.m.prepare();assert.equal(f.m.reviewed,null);assert.equal(f.m.apply.disabled,true);assert.equal(f.m.preview.hidden,true);assert.equal(f.applied(),0);
});
test('Layout choices retain the existing Arrange workflow separately',()=>{assert.deepEqual(canvasLayoutKinds.map(kind=>kind.id),['grid','row','column','hierarchy-right','hierarchy-down']);});
test('Trusted Apply helper sends complete native Enter activation and refuses an unfocused owner',async()=>{
  const calls=[],tools={async evaluate(){return{focused:true,disabled:false};},async command(name,args){calls.push({name,args});}};await activateCanvasLayoutByEnter(tools);assert.deepEqual(calls,[{name:'Page.bringToFront',args:undefined},{name:'Input.dispatchKeyEvent',args:{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'}},{name:'Input.dispatchKeyEvent',args:{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}}]);
  const refused=[];await assert.rejects(()=>activateCanvasLayoutByEnter({evaluate:async()=>({focused:false,disabled:false}),command:async(...args)=>refused.push(args)}),/owns keyboard focus/);assert.deepEqual(refused,[]);
});
test('Host fixture exercises rigid nested frames, a directed cycle, disconnected sets and retained self/outside/internal links',()=>{
  assert.match(canvasLayoutReadOnlyFixture.sourceAddition,/Cached Canvas automatic layouts/);const [path,text]=canvasLayoutReadOnlyFixture.files[0];assert.match(path,/Board\.canvas$/);assert.ok(text.startsWith('\ufeff'));const data=JSON.parse(text.slice(1));assert.equal(data.nodes.length,9);assert.equal(data.edges.length,8);const selected=new Set(['frame','nested','child','a','b','c','d','isolated']);
  for(const kind of canvasLayoutKinds.map(kind=>kind.id)){const p=plan(data,selected,settings(kind));assert.equal(p.units,6);assert.equal(p.members,8);assert.equal(p.connectedSets,2);assert.equal(p.cycleClusters,1);assert.equal(p.usedConnections,5);assert.equal(p.omittedConnections,3);assert.equal(p.connections.length,5);}
});
