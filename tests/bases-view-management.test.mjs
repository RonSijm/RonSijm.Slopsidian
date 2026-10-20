import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,relative} from 'node:path';
import {parseDocument} from 'yaml';
import {errorLogStub} from './error-log-stub.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(join(root,'.runtime'),{recursive:true});const directory=await mkdtemp(join(root,'.runtime','bases-view-management-tests-'));
const output=join(directory,'feature.mjs');await build({stdin:{contents:'export * from "./client/bases-view-management";export {BasesView} from "./client/bases";',resolveDir:root},outfile:output,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent',plugins:[errorLogStub,{name:'pure-base-owner',setup(build){build.onResolve({filter:/^\.\/views$/},()=>({path:'views',namespace:'pure-base-owner'}));build.onLoad({filter:/.*/,namespace:'pure-base-owner'},()=>({contents:'export class TextFileView {}'}));build.onResolve({filter:/^\.\/ui$/},()=>({path:'ui',namespace:'pure-base-ui'}));build.onLoad({filter:/.*/,namespace:'pure-base-ui'},()=>({contents:'export class Modal {} export class Notice {}'}));}}]});
const {planBaseViewChange:plan,BaseViewManagementReview,MAX_BASE_VIEW_NAME,BasesView}=await import(pathToFileURL(output).href);
after(async()=>{assert.match(relative(root,directory).replaceAll('\\','/'),/^\.runtime\/bases-view-management-tests-[^/]+$/);await rm(directory,{recursive:true});});
const bom='\ufeff',eol='\r\n',q=JSON.stringify;
const blocks=[
 ['  - type: table # original renderer','    name: Table # owned name comment','    order: [file.name, note.amount]','    filters: note.amount >= 0','    sort: [{property: note.amount, direction: DESC}]','    groupBy: {property: note.status, direction: ASC}','    limit: 0010','    summaries: {note.amount: Sum}','    futureView: {integer: 9007199254740993, negative: -0.0, escaped: "λ # true"}'].join(eol)+eol,
 ['','  # Owned List comment λ','  - type: list','    name: List','    order: [file.name, note.status]','    markers: number','    indentProperties: true','    separator: " / "'].join(eol)+eol,
 ['  - {type: cards, name: Cards, order: [file.name], cardSize: 0250, image: note.cover, imageFit: contain, imageAspectRatio: 1.25} # inline map'].join(eol)+eol,
 ['  - type: future-renderer','    name: Imported','    order: [file.name]','    future: {precise: 9007199254740995}'].join(eol)+eol
];
const prefix=bom+['# Whole base comment λ','opaque: &keep {precise: 9007199254740993, flags: [true, false]}','copy: *keep','filters: file.ext == "md"','formulas: {twice: "amount * 2"}','properties: {note.amount: {displayName: Amount}}','views: # collection header','  # Collection comment kept',''].join(eol);
const suffix=['  # Collection footer kept','tail: {untouched: 1.234567890123456789}',''].join(eol),source=prefix+blocks.join('')+suffix;
const data=text=>parseDocument(text.replace(/^\ufeff/,''),{intAsBigInt:true}).toJS({maxAliasCount:32});
const names=text=>data(text).views.map(view=>view.name);
const proved=(before,result)=>{assert.equal(result.source,before.slice(0,result.edit.from)+result.edit.insert+before.slice(result.edit.to));assert.equal(result.source.startsWith(bom),before.startsWith(bom));assert.equal(result.source.replaceAll(eol,'').includes('\n'),false);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.edit));assert.ok(Object.isFrozen(result.names));};

test('Rename splices only its scalar token and retains every comment, unknown token, BOM and CRLF',()=>{
 const result=plan(source,'Table',{kind:'rename',name:'Archive: λ # "😀"'});proved(source,result);
 assert.equal(result.source,source.replace('name: Table #','name: '+q('Archive: λ # "😀"')+' #'));assert.equal(result.selected,'Archive: λ # "😀"');
 const expected=data(source);expected.views[0].name=result.selected;assert.deepEqual(data(result.source),expected);
});
test('Add explicitly creates each supported view with file.name and retains shared and existing configuration',()=>{
 for(const type of ['table','list','cards']){const name='New '+type,result=plan(source,'Table',{kind:'add',name,type});proved(source,result);assert.equal(result.selected,name);assert.deepEqual(names(result.source),['Table','List','Cards','Imported',name]);assert.deepEqual(data(result.source).views.at(-1),{type,name,order:['file.name']});assert.ok(result.source.startsWith(prefix+blocks.join('')));assert.ok(result.source.endsWith(suffix));assert.match(result.description,/Shared base filters/);}
});
test('Duplicate copies complete Table configuration and exact unknown numeric/comment bytes',()=>{
 const result=plan(source,'Table',{kind:'duplicate',name:'Table copy'});proved(source,result);
 const copy=blocks[0].replace('name: Table #','name: "Table copy" #');assert.equal(result.source,prefix+blocks[0]+copy+blocks.slice(1).join('')+suffix);assert.equal(result.selected,'Table copy');
 const values=data(result.source).views;assert.deepEqual(values[1],{...values[0],name:'Table copy'});
});
test('Duplicate retains List presentation, CST-owned leading comments and Cards flow mapping configuration',()=>{
 for(const [at,name] of [[1,'List'],[2,'Cards']]){const result=plan(source,name,{kind:'duplicate',name:name+' copy'});proved(source,result);const values=data(result.source).views;assert.deepEqual(values[at+1],{...values[at],name:name+' copy'});const duplicated=blocks[at].replace('name: '+name,'name: '+q(name+' copy'));assert.equal(result.source,prefix+blocks.slice(0,at+1).join('')+duplicated+blocks.slice(at+1).join('')+suffix);}
});
test('Unknown renderer views remain exact and duplication preserves their unsupported type',()=>{
 const result=plan(source,'Imported',{kind:'duplicate',name:'Imported copy'});proved(source,result);assert.equal(data(result.source).views.at(-1).type,'future-renderer');assert.ok(result.source.includes(blocks[3]));assert.match(result.description,/including unknown settings/);
 const renamed=plan(source,'Imported',{kind:'rename',name:'Kept unsupported'});assert.equal(data(renamed.source).views.at(-1).type,'future-renderer');
});
test('Adjacent moves keep complete exact view spans and the selected name without editing shared settings',()=>{
 for(const [name,direction,order] of [['Table',1,[1,0,2,3]],['Cards',-1,[0,2,1,3]],['Imported',-1,[0,1,3,2]]]){const result=plan(source,name,{kind:'move',direction});proved(source,result);assert.equal(result.selected,name);assert.equal(result.source,prefix+order.map(index=>blocks[index]).join('')+suffix);assert.deepEqual(names(result.source),order.map(index=>['Table','List','Cards','Imported'][index]));}
});
test('Removing only the chosen view retains matching notes independently and selects the adjacent survivor',()=>{
 for(const [name,index,next] of [['Table',0,'List'],['List',1,'Cards'],['Imported',3,'Cards']]){const result=plan(source,name,{kind:'remove'});proved(source,result);assert.equal(result.source,prefix+blocks.filter((_,at)=>at!==index).join('')+suffix);assert.equal(result.selected,next);assert.match(result.description,/matching notes/i);}
});
test('Last view and move boundary guards refuse before producing a plan',()=>{
 const one='views:\n  - type: table\n    name: Only\n';assert.throws(()=>plan(one,'Only',{kind:'remove'}),/Keep at least one view/);
 assert.throws(()=>plan(source,'Table',{kind:'move',direction:-1}),/beginning or end/);assert.throws(()=>plan(source,'Imported',{kind:'move',direction:1}),/beginning or end/);assert.throws(()=>plan(source,'Table',{kind:'move',direction:0}),/Move earlier or Move later/);
});
test('Names refuse Unicode, case-only and compatibility collisions instead of choosing an ambiguous owner',()=>{
 for(const name of ['Table','table','Ｔａｂｌｅ','LIST','List']){assert.throws(()=>plan(source,'Table',{kind:'add',name,type:'table'}),/already exists/);assert.throws(()=>plan(source,'Table',{kind:'duplicate',name}),/already exists/);}
 assert.throws(()=>plan(source,'Table',{kind:'rename',name:'LIST'}),/already exists/);assert.throws(()=>plan(source,'Table',{kind:'rename',name:'Table'}),/different/);
 assert.equal(plan(source,'Table',{kind:'rename',name:'TABLE'}).selected,'TABLE');
 for(const pair of [['A','a'],['é','e\u0301'],['List','Ｌｉｓｔ']]){const ambiguous='views:\n'+pair.map(name=>'  - type: table\n    name: '+q(name)+'\n').join('');assert.throws(()=>plan(ambiguous,pair[0],{kind:'add',name:'Fresh',type:'table'}),/ambiguous/);}
});
test('Name budgets, control characters and malformed Unicode refuse with exact caller source retained',()=>{
 assert.equal(MAX_BASE_VIEW_NAME,128);for(const name of ['', ' leading','trailing ','line\nbreak','line\rbreak','\0','\u0085','\u2028','x\ud800','\udc00','x'.repeat(129)])assert.throws(()=>plan(source,'Table',{kind:'duplicate',name}),/view name/);
 const result=plan(source,'Table',{kind:'rename',name:'x'.repeat(128)});assert.equal(result.selected.length,128);assert.ok(source.includes('name: Table #'));
});
test('A missing selected name, unsupported new type and unknown operations cannot silently target the first view',()=>{
 assert.throws(()=>plan(source,'Missing',{kind:'remove'}),/selected named view changed/);assert.throws(()=>plan(source,'Table',{kind:'add',name:'Future',type:'future'}),/Table, List or Cards/);assert.throws(()=>plan(source,'Table',{kind:'unknown'}),/supported view-management/);
});
test('64-view and total source budgets apply to add and duplicate without losing imported views',()=>{
 const many='views:\n'+Array.from({length:64},(_,at)=>'  - type: table\n    name: V'+at+'\n').join('');for(const change of [{kind:'add',name:'New',type:'table'},{kind:'duplicate',name:'Copy'}])assert.throws(()=>plan(many,'V0',change),/64 views/);
 assert.equal(names(plan(many,'V0',{kind:'remove'}).source).length,63);const padded=source+'#'+ 'x'.repeat(1024*1024-source.length-2)+'\n';assert.equal(padded.length,1024*1024);assert.throws(()=>plan(padded,'Table',{kind:'duplicate',name:'Copy'}),/1 MiB/);
});
test('Aliased, implicit, flow-sequence and multiline-name layouts require explicit Source work',()=>{
 for(const text of ['opaque: true\n','views: [{type: table, name: Table}]\n','list: &views [{type: table, name: Table}]\nviews: *views\n','views:\n  - &view {type: table, name: Table}\n','views:\n  - type: table\n    name: &name Table\n','views:\n  - type: table\n    name: |\n      Table\n'])assert.throws(()=>plan(text,'Table',{kind:'duplicate',name:'Copy'}),/source|anchor|view name/i);
});
test('Duplicate refuses nested anchors while unchanged global aliases and exact anchor bytes remain supported',()=>{
 const nested=source.replace('futureView: {','futureView: &owned {');assert.throws(()=>plan(nested,'Table',{kind:'duplicate',name:'Copy'}),/contains anchors/);
 const result=plan(source,'List',{kind:'duplicate',name:'List copy'});assert.ok(result.source.includes('opaque: &keep {precise: 9007199254740993, flags: [true, false]}'));assert.deepEqual(data(result.source).copy,data(source).copy);
});
test('Moving a view cannot change previously bound alias ownership',()=>{
 const aliases=['views:','  - type: table','    name: First','    future: &first {kept: true}','  - type: table','    name: Second','    future: *first',''].join('\n');assert.throws(()=>plan(aliases,'First',{kind:'move',direction:1}),/alias|anchor/i);assert.deepEqual(names(aliases),['First','Second']);
});
test('Dedented inter-view comments refuse structural ownership guesses but token-only rename is safe',()=>{
 const text='views:\n  - type: table\n    name: First\n# ambiguous comment\n  - type: table\n    name: Second\n';for(const change of [{kind:'duplicate',name:'Copy'},{kind:'remove'},{kind:'move',direction:-1}])assert.throws(()=>plan(text,'Second',change),/ambiguous/);assert.equal(plan(text,'Second',{kind:'rename',name:'Kept'}).source,text.replace('name: Second','name: "Kept"'));
});
test('EOF without newline supports appended explicit views and exact rename without rewriting the prefix',()=>{
 const text='views:\n  - type: table\n    name: Only';const added=plan(text,'Only',{kind:'add',name:'New',type:'list'});assert.ok(added.source.startsWith(text+'\n'));assert.deepEqual(names(added.source),['Only','New']);const copied=plan(text,'Only',{kind:'duplicate',name:'Copy'});assert.deepEqual(names(copied.source),['Only','Copy']);assert.equal(plan(text,'Only',{kind:'rename',name:'Renamed'}).source,text.replace('Only','"Renamed"'));
});
test('LF and unusual indentation stay exact while new names serialize YAML punctuation literally',()=>{
 const text='views:\n- {type: table, name: Main, future: "true: # λ"}\ntail: 001\n',result=plan(text,'Main',{kind:'add',name:'true: # "λ"',type:'cards'});assert.ok(result.source.startsWith(text.slice(0,text.indexOf('tail:'))));assert.ok(result.source.endsWith('tail: 001\n'));assert.equal(data(result.source).views[1].name,'true: # "λ"');assert.equal(result.source.includes('\r'),false);
});
test('Mixed EOL review text reaches the real Bases commit and requested save without normalization of unrelated spans',()=>{
 const mixed=source.replace('# Whole base comment λ\r\n','# Whole base comment λ\n').replace('tail: {untouched: 1.234567890123456789}\r\n','tail: {untouched: 1.234567890123456789}\n');
 const result=plan(mixed,'Table',{kind:'rename',name:'Mixed retained'}),writes=[];
 const owner={text:mixed,model:null,selected:'Table',page:4,assertEditable(){},populateControls(){},setError(){},requestSave(){writes.push(this.text);},refresh(){},normalizeSource:BasesView.prototype.normalizeSource};
 BasesView.prototype.commitSource.call(owner,result.source,result.selected);
 assert.equal(owner.text,result.source);assert.deepEqual(writes,[result.source]);assert.equal(owner.selected,'Mixed retained');assert.equal(owner.page,0);assert.equal(owner.text,mixed.replace('name: Table #','name: "Mixed retained" #'));
 assert.notEqual(owner.normalizeSource(result.source),result.source,'The legacy source normalization would have changed the reviewed bytes');
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(){
 const file={path:'Views/Catalog.base',extension:'base'},saved={file:{path:file.path},content:source.slice(1),version:'v1',hasBom:true};
 const state={root:'root-a',readOnly:false,owner:true,closed:false,saved,physical:structuredClone(saved),file,reads:[],saves:[],read:null,save:null};
 const app={changingVault:false,workspace:{isChangingFiles:false},vault:{get rootPath(){return state.root;},get readOnly(){return state.readOnly;},assertWritable(){if(state.readOnly)throw Error('readonly');},getFileByPath:path=>path===file.path?state.file:null,async readDocument(path){state.reads.push(path);return state.read?state.read():structuredClone(state.physical);}}};
 const authority={current:()=>state.owner&&!state.closed,savedSource:()=>state.saved,async save(plan){state.saves.push(plan);if(state.save)await state.save(plan);}};
 const prepare=(change={kind:'rename',name:'Renamed'})=>new BaseViewManagementReview(app,file,saved.content,'Table',change,authority);
 return{app,state,file,saved,authority,prepare};
}
test('Apply checks exact physical content, version and BOM then hands only the reviewed plan to the normal save pipeline',async()=>{
 const f=fixture(),review=f.prepare();assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.saves,[]);await review.apply();assert.deepEqual(f.state.reads,[f.file.path]);assert.deepEqual(f.state.saves,[review.plan]);assert.equal(review.attempted,true);assert.equal(review.completed,true);assert.equal(review.applying,false);assert.deepEqual(f.state.physical,f.saved);
});
test('Cancel and read-only at construction or forced Apply perform zero physical source reads and saves',async()=>{
 const f=fixture();f.state.readOnly=true;assert.throws(()=>f.prepare(),/readonly/);assert.deepEqual(f.state.reads,[]);f.state.readOnly=false;const cancelled=f.prepare();cancelled.close();await assert.rejects(cancelled.apply(),/owner changed/);const locked=f.prepare();f.state.readOnly=true;await assert.rejects(locked.apply(),/readonly/);assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.saves,[]);
});
test('Dirty source cannot acquire management authority or trigger an implicit save',()=>{
 const f=fixture();assert.throws(()=>new BaseViewManagementReview(f.app,f.file,f.saved.content+'# dirty\n','Table',{kind:'remove'},f.authority),/Save or reload/);assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.saves,[]);
});
test('External source edits, version changes and BOM-only changes refuse before the save pipeline',async()=>{
 for(const mutate of [f=>f.state.physical.content+='# external\r\n',f=>f.state.physical.version='v2',f=>f.state.physical.hasBom=false,f=>f.state.physical.file.path='Other.base']){const f=fixture(),review=f.prepare();mutate(f);await assert.rejects(review.apply(),/saved base changed on disk/);assert.deepEqual(f.state.saves,[]);assert.equal(review.attempted,false);assert.equal(review.applying,false);}
});
test('Retired roots, files, selected/model owners, saved baselines and file mutations refuse before authoring IO',async()=>{
 for(const mutate of [f=>f.state.owner=false,f=>f.state.closed=true,f=>f.state.root='root-b',f=>f.state.file={...f.file},f=>f.file.path='Renamed.base',f=>f.state.saved={...f.saved,version:'v2'},f=>f.state.saved={...f.saved,hasBom:false},f=>f.app.changingVault=true,f=>f.app.workspace.isChangingFiles=true]){const f=fixture(),review=f.prepare();mutate(f);await assert.rejects(review.apply(),/owner changed/);assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.saves,[]);assert.equal(review.attempted,false);}
});
test('A held physical read cannot resume after cancellation, owner retirement, readonly or a new saved baseline',async()=>{
 for(const mutate of [(f,r)=>r.close(),f=>f.state.owner=false,f=>f.state.readOnly=true,f=>f.state.saved={...f.saved,version:'v2'}]){const f=fixture(),gate=deferred();f.state.read=()=>gate.promise;const review=f.prepare(),operation=review.apply();assert.equal(review.applying,true);mutate(f,review);gate.resolve(structuredClone(f.saved));await assert.rejects(operation,/owner changed|readonly/);assert.deepEqual(f.state.saves,[]);assert.equal(review.attempted,false);}
});
test('A failed guarded save is attempted exactly once and keeps a truthful incomplete outcome',async()=>{
 const f=fixture();f.state.save=async()=>{throw Error('version conflict: pane source retained');};const review=f.prepare();await assert.rejects(review.apply(),/version conflict/);assert.equal(review.attempted,true);assert.equal(review.completed,false);assert.equal(review.applying,false);await assert.rejects(review.apply(),/already applied or attempted/);assert.equal(f.state.saves.length,1);assert.equal(f.state.saves[0],review.plan);
});
test('Double Apply and retry after physical-source refusal never issue another read or save',async()=>{
 const f=fixture(),gate=deferred();f.state.read=()=>gate.promise;const review=f.prepare(),first=review.apply();await assert.rejects(review.apply(),/already applied or attempted/);gate.resolve(structuredClone(f.saved));await first;assert.equal(f.state.reads.length,1);assert.equal(f.state.saves.length,1);
 const stale=fixture(),rejected=stale.prepare();stale.state.physical.version='v2';await assert.rejects(rejected.apply(),/changed on disk/);await assert.rejects(rejected.apply(),/already applied or attempted/);assert.equal(stale.state.reads.length,1);assert.equal(stale.state.saves.length,0);
});
