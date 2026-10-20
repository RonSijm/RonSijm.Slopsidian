import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,relative} from 'node:path';
import {parseDocument} from 'yaml';
import {basesFiltersScenarioFixture,basesFiltersReadOnlyFixture} from '../tools/bases-filters-scenarios.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(join(root,'.runtime'),{recursive:true});const directory=await mkdtemp(join(root,'.runtime','bases-filters-tests-')),output=join(directory,'feature.mjs');
await build({stdin:{contents:'export * from "./client/bases-filters";export {BaseDocument,queryBase} from "./client/bases-model";',resolveDir:root},outfile:output,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const {readBaseFilterState:read,baseFilterDraftValue:value,baseFilterPredicateExpression:predicate,baseFilterStructure:structure,planBaseFilters:plan,BaseFilterReview:Review,BaseDocument,queryBase}=await import(pathToFileURL(output).href);
after(async()=>{assert.match(relative(root,directory).replaceAll('\\','/'),/^\.runtime\/bases-filters-tests-[^/]+$/);await rm(directory,{recursive:true});});
const expression=expression=>({kind:'expression',expression}),group=(operator,...children)=>({kind:'group',operator,children}),bom='\ufeff',eol='\r\n';
const prefix=bom+'# Mixed source λ\n'+['opaque: &keep {integer: 9007199254740993, decimal: 1.234567890123456789, negative: -0.0}','copy: *keep','filters: file.ext == "md" # global comment retained','formulas: {twice: "amount * 2"}','properties: {note.amount: {displayName: Amount}}','views: # keep views',''].join(eol);
const table=['  - type: table # table retained','    name: Table','    filters: {and: ["amount > 0", {not: ["status == \'closed\'"]}]} # scope comment retained','    order: [file.name, note.amount, formula.twice]','    sort: [{property: note.amount, direction: DESC, opaque: {integer: 9007199254740995}}]','    limit: 0010','    groupBy: {property: note.status, direction: ASC}','    summaries: {note.amount: Sum}','    future: {integer: 9007199254740997}',''].join(eol);
const list=['  # list retained','  - type: list','    name: List','    order: [file.name]','    markers: number','    separator: " / "','  - type: cards','    name: Cards','    order: [file.name]','    image: note.cover','    cardSize: 0250','  - type: future','    name: Imported','    opaque: true',''].join(eol),tail='tail: {integer: 0012}\r\n',source=prefix+table+list+tail;
const data=text=>parseDocument(text.replace(/^\ufeff/,''),{uniqueKeys:true,intAsBigInt:true}).toJS({maxAliasCount:32});
function proof(before,result){let text=before;for(const edit of [...result.edits].reverse())text=text.slice(0,edit.from)+edit.insert+text.slice(edit.to);assert.equal(text,result.source);assert.equal(result.source,before.slice(0,result.edit.from)+result.edit.insert+before.slice(result.edit.to));for(const item of[result,result.edit,result.edits,result.changes,result.names,...result.edits,...result.changes])assert.equal(Object.isFrozen(item),true);assert.equal(result.source.startsWith(bom),before.startsWith(bom));}
function file(path,amount,status='open',tags=[]){return{path,name:path.split('/').at(-1),basename:path.split('/').at(-1).replace(/\.md$/,''),extension:'md',stat:{ctime:1,mtime:2,size:100},properties:{amount,status,done:status==='closed','odd: λ':'keep "😀"',tags},tags,links:[]};}
const files=[file('Rows/A.md',1),file('Rows/B.md',2,'closed'),file('Rows/C.md',3),file('Other/D.md',5)];
function rows(text,view='Table'){const result=queryBase({text,files,context:files[0],view,search:'',page:0,now:100});assert.deepEqual(result.errors,[]);return result.rows.map(row=>row.path);}

test('Reads exact expression spelling and nested All/None groups without normalization',()=>{
 const state=read(source,'Table');assert.equal(state.global.editable,true);assert.equal(state.view.editable,true);assert.deepEqual(state.global.draft,expression('file.ext == "md"'));assert.deepEqual(state.view.draft,group('and',expression('amount > 0'),group('not',expression("status == 'closed'"))));assert.equal(state.global.source,'file.ext == "md"');assert.deepEqual(value(state.view.draft),{and:['amount > 0',{not:["status == 'closed'"]}]});
});
test('Global and view edits splice only proved fields and retain opaque precision, comments, BOM and mixed EOL',()=>{
 const global=group('and',expression('file.ext == "md"'),expression('file.inFolder("Rows")')),view=group('or',expression('amount >= 3'),expression('status == "closed"')),result=plan(source,'Table',{global,view});proof(source,result);
 assert.ok(result.source.startsWith(prefix.replace('file.ext == "md"',JSON.stringify(value(global)))));assert.ok(result.source.endsWith(list+tail));assert.ok(result.source.includes('# global comment retained'));assert.ok(result.source.includes('# scope comment retained'));assert.ok(result.source.includes('limit: 0010'));assert.ok(result.source.includes('9007199254740995'));assert.deepEqual(result.changes.map(c=>c.scope),['global','view']);
 const expected=data(source);expected.filters=value(global);expected.views[0].filters=value(view);assert.deepEqual(data(result.source),expected);assert.deepEqual(rows(result.source),['Rows/B.md','Rows/C.md']);assert.equal(result.selected,'Table');
});
test('A view-only edit keeps the exact global scalar and all other views; global edit affects List/Cards as well',()=>{
 const viewOnly=plan(source,'Table',{view:expression('amount == 1')});assert.ok(viewOnly.source.startsWith(prefix));assert.deepEqual(rows(viewOnly.source),['Rows/A.md']);assert.deepEqual(rows(viewOnly.source,'List'),['Other/D.md','Rows/A.md','Rows/B.md','Rows/C.md']);
 const shared=plan(viewOnly.source,'Cards',{global:expression('file.inFolder("Rows")')});assert.deepEqual(rows(shared.source,'List'),['Rows/A.md','Rows/B.md','Rows/C.md']);assert.deepEqual(rows(shared.source,'Cards'),['Rows/A.md','Rows/B.md','Rows/C.md']);assert.deepEqual(rows(shared.source),['Rows/A.md']);
});
test('Missing global/current fields sharing an insertion boundary receive one correct nested/global splice',()=>{
 for(const ending of['','\n','\r\n']){const input='views:\n  - type: table\n    name: Table\n    order: [file.name]'+ending,result=plan(input,'Table',{global:expression('amount > 1'),view:expression('status == "open"')});proof(input,result);assert.equal(result.edits.length,1);assert.deepEqual(data(result.source),{views:[{type:'table',name:'Table',order:['file.name'],filters:'status == "open"'}],filters:'amount > 1'});assert.deepEqual(rows(result.source),['Other/D.md','Rows/C.md']);}
});
test('Missing per-view fields are inserted before the following view while global field follows the tail',()=>{
 const result=plan(source,'List',{global:expression('amount > 1'),view:expression('amount < 4')});proof(source,result);assert.ok(result.source.includes('    separator: " / "\r\n    filters: "amount < 4"\r\n  - type: cards'));assert.ok(result.source.endsWith('tail: {integer: 0012}\r\n'));assert.deepEqual(rows(result.source,'List'),['Rows/B.md','Rows/C.md']);
});
test('Explicit Clear uses null, retains surrounding field comments, and no-op scopes do not rewrite source',()=>{
 const result=plan(source,'Table',{global:null,view:null});proof(source,result);assert.ok(result.source.includes('filters: null # global comment retained'));assert.ok(result.source.includes('filters: null # scope comment retained'));assert.deepEqual(rows(result.source),['Rows/B.md','Other/D.md','Rows/C.md','Rows/A.md']);assert.throws(()=>plan(source,'Table',{global:read(source,'Table').global.draft,view:read(source,'Table').view.draft}),/Change a/);assert.throws(()=>plan(source,'List',{view:null}),/Change a/);
});
test('Commented collections and anchored/alias scopes remain Source-only while another scope can change',()=>{
 const commented=source.replace('file.ext == "md" # global comment retained','\r\n  and:\r\n    - file.ext == "md" # per-condition comment\r\n    - amount > 0');const state=read(commented,'Table');assert.equal(state.global.editable,false);assert.match(state.global.issue,/comments/);assert.equal(state.view.editable,true);assert.throws(()=>plan(commented,'Table',{global:expression('true')}),/comments/);const result=plan(commented,'Table',{view:expression('amount == 1')});assert.ok(result.source.startsWith(commented.slice(0,commented.indexOf('    filters:'))));proof(commented,result);
 for(const global of['&filter "amount > 0"','*filter']){const input=source.replace('opaque: &keep','filterOwner: &filter "amount > 0"\r\nopaque: &keep').replace('file.ext == "md" # global comment retained',global);assert.equal(read(input,'Table').global.editable,false);const result=plan(input,'Table',{view:expression('false')});assert.ok(result.source.includes('filters: '+global));assert.throws(()=>plan(input,'Table',{global:expression('true')}),/aliases|anchors/);}
});
test('Root/view/sequence ownership and duplicate normalized view names refuse before planning',()=>{
 for(const input of[source.replace('views: # keep views','views: &views # keep views'),source.replace('  - type: table','  - &owner\r\n    type: table'),source.replace('name: List','name: table'),source.replace('name: List','name: Ｔａｂｌｅ')])assert.throws(()=>plan(input,'Table',{global:expression('true')}));
 assert.throws(()=>plan(source,'Imported',{global:expression('true')}),/Table, List or Cards/);assert.throws(()=>plan(source,'Missing',{view:expression('true')}));assert.throws(()=>plan('{views: [{type: table, name: Table}]}','Table',{global:expression('true')}),/ambiguous/);
});
test('A larger existing filter is kept Source-only and does not block editing the other scope',()=>{
 const text=source.replace('file.ext == "md" # global comment retained',JSON.stringify({and:Array.from({length:65},()=> 'true')}));assert.equal(read(text,'Table').global.editable,false);assert.match(read(text,'Table').global.issue,/64/);const result=plan(text,'Table',{view:expression('false')});assert.ok(result.source.includes(JSON.stringify({and:Array.from({length:65},()=> 'true')})));proof(text,result);
});
test('Visual expression and nesting/node budgets reject malformed syntax, cycles, unknown fields and unsafe values',()=>{
 for(const input of[expression(''),expression('  '),expression('amount === 1'),expression('note.constructor'),expression('"\ud800"'),{kind:'group',operator:'xor',children:[]},{kind:'expression',expression:'true',future:true},group('and',...Array.from({length:64},()=>expression('true')))])assert.throws(()=>value(input));
 let deep=expression('true');for(let i=0;i<9;i++)deep=group('and',deep);assert.throws(()=>value(deep),/eight/);const cyclic=group('and');cyclic.children.push(cyclic);assert.throws(()=>value(cyclic));assert.throws(()=>plan(source,'Table',{future:expression('true')}),/global or/);
 assert.equal(value(expression('true')), 'true');assert.deepEqual(value(group('or')), {or:[]});
});
test('Structural budget checks remain available while an expression is invalid and stop before a 65th row or ninth level',()=>{
 const invalid=expression('amount ===');assert.deepEqual(structure(group('and',invalid)),{nodes:2,depth:1});const full=group('and',...Array.from({length:63},()=>expression('true')));assert.deepEqual(structure(full),{nodes:64,depth:1});full.children.push(expression('true'));assert.throws(()=>structure(full),/64 entries/);let deep=expression('');for(let i=0;i<8;i++)deep=group('and',deep);assert.deepEqual(structure(deep),{nodes:9,depth:8});assert.throws(()=>structure(group('and',deep)),/eight nested/);assert.deepEqual(structure(null),{nodes:0,depth:0});
});
test('Empty All/None pass every row and empty Any passes none, matching the displayed semantics',()=>{
 for(const [operator,expected]of[['and',4],['not',4],['or',0]]){const result=plan(source,'Table',{global:null,view:group(operator)});assert.equal(rows(result.source).length,expected);}
 const none=plan(source,'Table',{global:null,view:group('not',expression('amount < 2'),expression('status == "closed"'))});assert.deepEqual(rows(none.source),['Other/D.md','Rows/C.md']);
});
test('Predicate builder quotes arbitrary Unicode keys and text; comparison input cannot inject expression syntax',()=>{
 const text='x") || true || ("',generated=predicate({property:'note.odd: λ',operator:'==',type:'text',value:text});assert.equal(generated,'note["odd: λ"] == '+JSON.stringify(text));const result=plan(source,'Table',{view:expression(generated)});assert.deepEqual(rows(result.source),[]);
 const literal=predicate({property:'note.odd: λ',operator:'==',type:'text',value:'keep "😀"'});assert.deepEqual(rows(plan(source,'Table',{view:expression(literal)}).source),['Rows/B.md','Other/D.md','Rows/C.md','Rows/A.md']);
});
test('Typed numbers, checkbox, null and property/expression syntax use the actual evaluator',()=>{
 const cases=[['note.amount','>=','number','2',['Rows/B.md','Other/D.md','Rows/C.md']],['note.done','==','boolean','true',['Rows/B.md']],['note.missing','==','null','ignored',['Rows/B.md','Other/D.md','Rows/C.md','Rows/A.md']],['file.name','startsWith','text','C',['Rows/C.md']],['file.path','contains','text','Rows/',['Rows/B.md','Rows/C.md','Rows/A.md']],['note.missing','empty','text','unused',['Rows/B.md','Other/D.md','Rows/C.md','Rows/A.md']],['note.amount','not-empty','text','unused',['Rows/B.md','Other/D.md','Rows/C.md','Rows/A.md']]];
 for(const[property,operator,type,v,expected]of cases){const result=plan(source,'Table',{view:expression(predicate({property,operator,type,value:v}))});assert.deepEqual(rows(result.source),expected,property+' '+operator);}
});
test('Predicate builder rejects unsupported identifiers, numeric precision, ordered checkbox and text-method types',()=>{
 const valid={property:'note.amount',operator:'==',type:'number',value:'1'};
 for(const change of[{property:''},{property:'note.__proto__'},{property:'file.constructor'},{property:'note.\ud800'},{value:'9007199254740992'},{value:'Infinity'},{value:'1 || true'},{type:'boolean',value:'yes'},{operator:'>',type:'boolean',value:'true'},{operator:'startsWith',type:'number',value:'1'},{operator:'invalid'}])assert.throws(()=>predicate({...valid,...change}));
 assert.equal(predicate({...valid,value:'-0'}),'note["amount"] == -0');assert.equal(predicate({...valid,value:'1e2'}),'note["amount"] == 100');
});

function owner(){const file={path:'Catalog.base',extension:'base'},saved={file:{path:file.path},content:source,version:'v1',hasBom:true},state={writable:true,current:true,root:'root',actual:saved,saved,calls:[],read:null,save:null},app={changingVault:false,workspace:{isChangingFiles:false},vault:{get rootPath(){return state.root},getFileByPath:path=>path===file.path?file:null,assertWritable(){if(!state.writable)throw Error('read-only')},async readDocument(path){state.calls.push({read:path});if(state.read)await state.read();return state.actual}}},authority={current:()=>state.current,savedSource:()=>state.saved,async save(plan){state.calls.push({save:plan});if(state.save)await state.save();}};return{app,file,state,authority,review:()=>new Review(app,file,source,'Table',{view:expression('amount > 1')},authority)};}
test('Review uses physical document/version/BOM proof and sends exactly one reviewed plan to the existing save authority',async()=>{
 const o=owner(),review=o.review();assert.equal(review.attempted,false);assert.equal(o.state.calls.length,0);await review.apply();assert.equal(review.attempted,true);assert.equal(review.completed,true);assert.equal(review.applying,false);assert.deepEqual(o.state.calls.map(c=>Object.keys(c)[0]),['read','save']);assert.equal(o.state.calls[1].save,review.plan);await assert.rejects(review.apply(),/already applied/);
});
test('Read-only, unsaved source and stale logical owner refuse before physical read or save',async()=>{
 for(const change of['readonly','owner','root','logical-version','logical-content','logical-bom','path','switching','transition','closed']){const o=owner(),review=o.review();if(change==='readonly')o.state.writable=false;if(change==='owner')o.state.current=false;if(change==='root')o.state.root='new';if(change==='logical-version')o.state.saved={...o.state.saved,version:'v2'};if(change==='logical-content')o.state.saved={...o.state.saved,content:'new'};if(change==='logical-bom')o.state.saved={...o.state.saved,hasBom:false};if(change==='path')o.file.path='Other.base';if(change==='switching')o.app.changingVault=true;if(change==='transition')o.app.workspace.isChangingFiles=true;if(change==='closed')review.close();await assert.rejects(review.apply(),/read-only|changed/);assert.deepEqual(o.state.calls,[]);assert.equal(review.attempted,false);}
 const dirty=owner();dirty.state.saved={...dirty.state.saved,content:'dirty mismatch'};assert.throws(dirty.review,/Save or reload/);
});
test('Physical version, content, path and BOM conflicts refuse before the save pipeline',async()=>{
 for(const replacement of[{version:'v2'},{content:source+'\n'},{file:{path:'Other.base'}},{hasBom:false}]){const o=owner(),review=o.review();o.state.actual={...o.state.actual,...replacement};await assert.rejects(review.apply(),/changed on disk/);assert.deepEqual(o.state.calls,[{read:'Catalog.base'}]);assert.equal(review.attempted,false);assert.equal(review.applying,false);}
});
test('A retired owner or close during the physical await cannot resume into save',async()=>{
 for(const invalidate of[o=>{o.state.current=false},(_o,r)=>r.close(),o=>{o.state.root='new'}]){const o=owner(),review=o.review();o.state.read=async()=>invalidate(o,review);await assert.rejects(review.apply(),/changed/);assert.deepEqual(o.state.calls,[{read:'Catalog.base'}]);assert.equal(review.attempted,false);}
});
test('Unconfirmed save retains explicit attempted/completed distinction without retrying a consumed review',async()=>{
 const o=owner(),review=o.review();o.state.save=async()=>{throw Error('unconfirmed')};await assert.rejects(review.apply(),/unconfirmed/);assert.equal(review.attempted,true);assert.equal(review.completed,false);assert.equal(review.applying,false);await assert.rejects(review.apply(),/already applied/);assert.equal(o.state.calls.length,2);
});
test('Actual host fixtures parse, carry exact BOM/CRLF and exercise editable, Source-only and maximum-size scopes',()=>{
 for(const fixture of[basesFiltersScenarioFixture,basesFiltersReadOnlyFixture]){assert.equal(new Set(fixture.files.map(([path])=>path)).size,fixture.files.length);for(const[path,text]of fixture.files){assert.equal(text.startsWith(bom),true,path);if(path.endsWith('.base')){const model=new BaseDocument(text),state=read(text,model.views[0].name);if(path.endsWith('/Commented.base')){assert.equal(state.global.editable,false);assert.equal(state.view.editable,true)}else if(path.endsWith('/Limits.base')){assert.deepEqual(structure(state.global.draft),{nodes:64,depth:1});assert.deepEqual(structure(state.view.draft),{nodes:9,depth:8});}else{assert.deepEqual(model.views.map(view=>view.name),['Table','List','Cards','Imported']);assert.equal(state.global.editable,true);assert.equal(state.view.editable,true);}}}}
 assert.equal(basesFiltersReadOnlyFixture.sourceAddition.replaceAll('\r\n','').includes('\n'),false);
});
