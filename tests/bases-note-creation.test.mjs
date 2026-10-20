import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,relative} from 'node:path';
import {parseDocument} from 'yaml';

const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(join(root,'.runtime'),{recursive:true});const directory=await mkdtemp(join(root,'.runtime','bases-note-creation-tests-'));
const output=join(directory,'feature.mjs');
await build({stdin:{contents:'export * from "./client/bases-note-creation"; export {newLinkedNotePath} from "./client/links";',resolveDir:root,loader:'ts'},outfile:output,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const {planBaseNote,BaseNoteCreationReview,baseNoteCreationOutcome,newLinkedNotePath,MAX_BASE_NOTE_PROPERTIES,MAX_BASE_NOTE_BODY,MAX_BASE_NOTE_VALUE}=await import(pathToFileURL(output).href);
after(async()=>{assert.match(relative(root,directory).replaceAll('\\','/'),/^\.runtime\/bases-note-creation-tests-[^/]+$/);await rm(directory,{recursive:true});});
const field=(name,type='text',text='',checked=false)=>({name,type,text,checked});
const draft=(properties=[],body='# Explicit body λ\nExact 😀.\n',lineEnding='\r\n')=>({properties,body,lineEnding});
const assigned=()=>null;
const frontmatter=text=>parseDocument(text.slice(text.indexOf('\n')+1,text.lastIndexOf('---')),{intAsBigInt:false}).toJS();
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('Explicit properties serialize as literal safe YAML without inferring a filter or changing body meaning',()=>{
 const plan=planBaseNote(draft([field('status','text','open: # literal λ'),field('amount','number','0'),field('checked','checkbox','',false),field('tags','tags','one\ntwo')]),assigned);
 assert.equal(plan.content,'---\r\n"status": "open: # literal λ"\r\n"amount": 0\r\n"checked": false\r\n"tags": ["one","two"]\r\n---\r\n# Explicit body λ\r\nExact 😀.\r\n');
 assert.deepEqual(frontmatter(plan.content),{status:'open: # literal λ',amount:0,checked:false,tags:['one','two']});assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.properties));assert.ok(plan.properties.every(Object.isFrozen));
});
test('Text quoting preserves newlines, emoji, YAML-looking scalars and arbitrary safe punctuation in names',()=>{
 const value='true\n001\n---\n[not a list] 😀',plan=planBaseNote(draft([field('A: # " λ','text',value)]),assigned);
 assert.equal(frontmatter(plan.content)['A: # " λ'],value);assert.ok(plan.content.includes('"true\\n001\\n---\\n[not a list] 😀"'));
});
test('Unicode YAML line separators in property names, text and list items round-trip without folding',()=>{
 const key='key\u0085next\u2028line\u2029λ',value='A\u0085B\u2028C\u2029D\r\n"quoted" \\ 😀';
 const plan=planBaseNote(draft([field(key,'text',value),field('list','multitext','first\u0085λ\nsecond\u2028Ω\nthird\u2029😀')]),assigned),parsed=frontmatter(plan.content);
 assert.equal(parsed[key],value);assert.deepEqual(parsed.list,['first\u0085λ','second\u2028Ω','third\u2029😀']);for(const separator of ['\u0085','\u2028','\u2029'])assert.equal(plan.content.includes(separator),false);for(const escaped of ['\\u0085','\\u2028','\\u2029'])assert.ok(plan.content.includes(escaped));
});
test('An explicitly entered negative zero retains its numeric sign in the new YAML',()=>{const plan=planBaseNote(draft([field('signed zero','number','-0')]),assigned);assert.ok(plan.content.includes('"signed zero": -0'));assert.equal(Object.is(frontmatter(plan.content)['signed zero'],-0),true);});
test('All eight supported typed values use the existing parser, retaining false, zero, empty text and lists',()=>{
 const rows=[field('text','text',''),field('multi','multitext','a\nλ'),field('number','number','12.5'),field('bool','checkbox','',true),field('date','date','2026-11-20'),field('time','datetime','2026-11-20T12:34:56Z'),field('aliases','aliases','Alias λ'),field('tags','tags','project/demo')];
 const values=frontmatter(planBaseNote(draft(rows),assigned).content);assert.deepEqual(values,{text:'',multi:['a','λ'],number:12.5,bool:true,date:'2026-11-20',time:'2026-11-20T12:34:56Z',aliases:['Alias λ'],tags:['project/demo']});
});
test('Property-free notes have only the explicitly authored body; LF and CRLF are normalized deliberately',()=>{
 assert.equal(planBaseNote(draft([],'','\n'),assigned).content,'');assert.equal(planBaseNote(draft([],'A\r\nB\rC\n','\n'),assigned).content,'A\nB\nC\n');assert.equal(planBaseNote(draft([],'A\nB\n','\r\n'),assigned).content,'A\r\nB\r\n');
 assert.throws(()=>planBaseNote(draft([],'\ufeffBody'),assigned),/BOM/);
});
test('Assigned type identity is captured and must agree with each draft value',()=>{
 assert.equal(planBaseNote(draft([field('amount','number','0')]),name=>name==='amount'?'number':null).properties[0].assigned,'number');
 assert.throws(()=>planBaseNote(draft([field('amount','text','0')]),()=> 'number'),/assigned number/);assert.throws(()=>planBaseNote(draft([field('unknown','text','')]),()=> 'plugin-widget'),/assigned/);
});
test('Duplicate and unsafe keys refuse atomically without changing the caller draft',()=>{
 for(const rows of [[field('Status'),field('status')],[field('__proto__')],[field('Constructor')],[field('prototype')],[field('<<')],[field('')],[field('x\ny')]]){const value=draft(rows),before=structuredClone(value);assert.throws(()=>planBaseNote(value,assigned));assert.deepEqual(value,before);}
});
test('Unsafe numbers, malformed dates, unknown types and duplicate/over-budget lists do not produce YAML',()=>{
 for(const row of [field('v','number','9007199254740993'),field('v','number','0.1234567890123456789'),field('v','number','Infinity'),field('v','date','2026-02-30'),field('v','datetime','yesterday'),field('v','object','{}'),field('v','tags','a\nA'),field('v','multitext',Array.from({length:257},(_,i)=>'v'+i).join('\n'))])assert.throws(()=>planBaseNote(draft([row]),assigned));
});
test('Property/value/body/UTF-8 budgets and malformed Unicode are enforced before creation',()=>{
 assert.equal(MAX_BASE_NOTE_PROPERTIES,16);assert.throws(()=>planBaseNote(draft(Array.from({length:17},(_,i)=>field('k'+i))),assigned),/16/);assert.throws(()=>planBaseNote(draft([field('v','text','x'.repeat(MAX_BASE_NOTE_VALUE+1))]),assigned));assert.throws(()=>planBaseNote(draft([],'x'.repeat(MAX_BASE_NOTE_BODY+1)),assigned));
 assert.throws(()=>planBaseNote(draft([field('x')],'😀'.repeat(65536)),assigned),/256 KiB/);for(const bad of ['\ud800','\udc00','\0','x\u0001'])assert.throws(()=>planBaseNote(draft([field('v','text',bad)]),assigned));assert.throws(()=>planBaseNote({...draft(),lineEnding:'\r'},assigned),/line endings/);
});
test('Plan is immutable and detaches from later caller field and body edits',()=>{
 const input=draft([field('x','text','old')]),plan=planBaseNote(input,assigned);input.properties[0].text='new';input.body='New body';assert.ok(plan.content.includes('"old"'));assert.ok(plan.content.endsWith('Exact 😀.\r\n'));assert.throws(()=>{plan.properties[0].type='number';},TypeError);
});

function fixture(){
 const source={path:'Projects/Catalog.base',extension:'base'},files=new Map([[source.path,source]]),saved={file:{path:source.path},content:'views:\r\n  - type: table\r\n    name: Table\r\n',hasBom:true,version:'base-v1'};
 const state={root:'A',readOnly:false,owner:true,sourceSaved:saved,physical:structuredClone(saved),writes:[],reads:[],probes:[],placements:0,typeReads:0,refreshes:0,location:'current',folder:'Projects',types:new Map(),exists:null,sourceRead:null,beforeAck:null,afterAck:null,cleanup:null,refreshError:false,doc:null};
 const app={changingVault:false,metadataTypeManager:{getAssignedWidget(name){state.typeReads++;return state.types.get(name.toLowerCase())??null;}},fileManager:{getNewNotePath(name,path){state.placements++;return newLinkedNotePath({path:name.trim().replaceAll('\\','/'),subpath:''},path,state.location==='root'?'':state.folder);}},vault:{get rootPath(){return state.root;},get readOnly(){return state.readOnly;},assertWritable(){if(state.readOnly)throw Error('readonly');},getConfig:key=>key==='newFileLocation'?state.location:state.folder,getFileByPath:path=>files.get(path),getAbstractFileByPath:path=>files.get(path),getAllLoadedFiles:()=>[...files.values()],getFolderByPath:path=>path==='Projects'?{path}:null,adapter:{async exists(path){state.probes.push(path);return state.exists?state.exists(path):files.has(path);}},async readDocument(path){state.reads.push(path);return state.sourceRead?state.sourceRead(path):structuredClone(state.physical);},async create(path,content,ack){state.writes.push({path,content});const file={path,extension:'md'};files.set(path,file);const document=state.doc={file:{path},content,hasBom:false,version:'created-v1'};if(state.beforeAck)await state.beforeAck();ack(document);if(state.afterAck)await state.afterAck();return file;}},workspace:{isChangingFiles:false,async withFileMutation(action){if(this.isChangingFiles)throw Error('busy');this.isChangingFiles=true;try{return await action();}finally{this.isChangingFiles=false;if(state.cleanup)await state.cleanup();}}}};
 const authority={current:owned=>state.owner&&(owned||!app.workspace.isChangingFiles),savedSource:()=>state.sourceSaved,refresh(){state.refreshes++;if(state.refreshError)throw Error('query refresh failed');}};
 const prepare=(name='Created λ',input=draft([field('status','text','open'),field('amount','number','0')]))=>new BaseNoteCreationReview(app,source,name,input,authority);
 return{source,files,saved,state,app,authority,prepare};
}
test('Reviewed creation writes one exact new file without modifying the Base or any unrelated note',async()=>{
 const f=fixture(),review=f.prepare();f.files.set('Projects/Peer.md',{path:'Projects/Peer.md',extension:'md',dirty:true,text:'Unsaved peer'});const before=structuredClone(f.state.physical);await review.create();assert.deepEqual(f.state.writes,[{path:'Projects/Created λ.md',content:review.plan.content}]);assert.deepEqual(f.state.physical,before);assert.equal(f.files.get('Projects/Peer.md').text,'Unsaved peer');assert.equal(f.state.refreshes,1);assert.equal(review.receipt.completed,true);assert.equal(review.receipt.document.content,review.plan.content);assert.deepEqual(f.state.reads,[f.source.path,f.source.path]);
});
test('Cancellation and stale ownership refuse before transport or note creation',async()=>{
 for(const change of [f=>f.review.close(),f=>{f.state.owner=false;},f=>{f.state.root='B';},f=>{f.app.changingVault=true;},f=>{f.source.path='Moved.base';}]){const f=fixture();f.review=f.prepare();change(f);await assert.rejects(f.review.create());assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.probes,[]);assert.deepEqual(f.state.writes,[]);assert.equal(f.review.receipt.attempted,false);}
});
test('A read-only constructor refuses before placement, assigned-type reads or authoring transport',()=>{
 const f=fixture();f.state.readOnly=true;assert.throws(()=>f.prepare(),/not available/);assert.equal(f.state.placements,0);assert.equal(f.state.typeReads,0);assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.writes,[]);
});
test('A writable review switched read-only refuses without transport even if forced',async()=>{const f=fixture(),review=f.prepare();f.state.readOnly=true;await assert.rejects(review.create(),/readonly/);assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.probes,[]);assert.deepEqual(f.state.writes,[]);});
test('Placement and assigned-type changes after review refuse before transport',async()=>{
 for(const change of [f=>{f.state.location='root';},f=>{f.state.folder='Elsewhere';},f=>{f.state.types.set('amount','text');}]){const f=fixture();f.review=f.prepare();change(f);await assert.rejects(f.review.create(),/changed/);assert.deepEqual(f.state.reads,[]);assert.deepEqual(f.state.probes,[]);assert.deepEqual(f.state.writes,[]);}
});
test('Present, case-only and physically present destinations are never overwritten',async()=>{
 for(const name of ['Projects/Created λ.md','Projects/CREATED λ.MD']){const f=fixture();f.files.set(name,{path:name,extension:'md'});assert.throws(()=>f.prepare(),/already exists/);assert.deepEqual(f.state.writes,[]);}
 const f=fixture(),review=f.prepare();f.state.exists=()=>true;await assert.rejects(review.create(),/appeared/);assert.deepEqual(f.state.writes,[]);assert.equal(review.receipt.attempted,false);
});
test('Path validation uses normal linked-note rules and existing-folder requirements',()=>{
 for(const name of ['', '../../Escape','CON','Wrong.png','Missing/New','x\u0000y','x'.repeat(4097)]){const f=fixture();assert.throws(()=>f.prepare(name),undefined,name);assert.deepEqual(f.state.writes,[]);}
 assert.equal(fixture().prepare('../Inside root').path,'Inside root.md');
 const f=fixture();f.state.location='root';const review=f.prepare('Root note.md');assert.equal(review.path,'Root note.md');
});
test('A physically changed base version, content or BOM refuses before existence probes and creation',async()=>{
 for(const key of ['version','content','hasBom']){const f=fixture(),review=f.prepare();f.state.physical[key]=key==='hasBom'?false:'external';await assert.rejects(review.create(),/saved base changed/);assert.equal(f.state.reads.length,1);assert.deepEqual(f.state.probes,[]);assert.deepEqual(f.state.writes,[]);}
});
test('A changing owned saved tuple during the physical read refuses its mixed proof',async()=>{const f=fixture(),review=f.prepare();f.state.sourceRead=()=>{f.state.sourceSaved={...f.saved,version:'new-owned-version'};return structuredClone(f.state.physical);};await assert.rejects(review.create(),/saved base changed/);assert.deepEqual(f.state.writes,[]);});
test('A held existence probe rechecks current owner, types and physical base before writing',async()=>{
 for(const kind of ['owner','type','physical']){const f=fixture(),review=f.prepare(),hold=deferred(),entered=deferred();f.state.exists=()=>{entered.resolve();return hold.promise;};const work=review.create();await entered.promise;if(kind==='owner')f.state.owner=false;if(kind==='type')f.state.types.set('status','number');if(kind==='physical')f.state.physical.hasBom=false;hold.resolve(false);await assert.rejects(work,/changed/);assert.deepEqual(f.state.writes,[]);assert.equal(review.receipt.attempted,false);}
});
test('A target appearing in the inventory during a held existence proof also refuses',async()=>{const f=fixture(),review=f.prepare();f.state.exists=()=>{f.files.set(review.path,{path:review.path,extension:'md'});return false;};await assert.rejects(review.create(),/already exists/);assert.deepEqual(f.state.writes,[]);});
test('A confirmed host create followed by inventory failure retains truthful outcome and prevents retry',async()=>{
 const f=fixture(),review=f.prepare();f.state.afterAck=()=>{throw Error('inventory failure');};await assert.rejects(review.create(),/inventory/);assert.ok(review.receipt.document);assert.equal(review.receipt.completed,false);assert.ok(f.files.has(review.path));assert.match(baseNoteCreationOutcome(review.receipt),/Created.*confirmed file was kept/);await assert.rejects(review.create(),/already/);assert.equal(f.state.writes.length,1);
});
test('A lost acknowledgement reports an uncertain file and never retries or deletes it',async()=>{const f=fixture(),review=f.prepare();f.state.beforeAck=()=>{throw Error('lost response');};await assert.rejects(review.create(),/lost/);assert.equal(review.receipt.attempted,true);assert.equal(review.receipt.document,null);assert.ok(f.files.has(review.path));assert.match(baseNoteCreationOutcome(review.receipt),/may exist/);await assert.rejects(review.create(),/already/);assert.equal(f.state.writes.length,1);});
test('Post-acknowledgement mutation cleanup failure retains the confirmed file and receipt',async()=>{const f=fixture(),review=f.prepare();f.state.cleanup=()=>{throw Error('cleanup failure');};await assert.rejects(review.create(),/cleanup/);assert.ok(review.receipt.document);assert.equal(review.receipt.completed,false);assert.match(baseNoteCreationOutcome(review.receipt),/Created/);assert.ok(f.files.has(review.path));assert.equal(f.state.refreshes,0);});
test('Query refresh failure cannot be misreported as a failed create or cause another write',async()=>{const f=fixture(),review=f.prepare();f.state.refreshError=true;await assert.rejects(review.create(),/refresh failed/);assert.equal(review.receipt.completed,true);assert.match(baseNoteCreationOutcome(review.receipt,'query refresh failed'),/Created.*query refresh failed.*filters/);await assert.rejects(review.create(),/already/);assert.equal(f.state.writes.length,1);});
test('Close or vault change during an acknowledged create retains the outcome and skips stale refresh',async()=>{
 for(const kind of ['close','root']){const f=fixture(),review=f.prepare();f.state.afterAck=()=>{if(kind==='close')review.close();else f.state.root='B';};await review.create();assert.equal(review.receipt.completed,true);assert.equal(f.state.refreshes,0);assert.equal(f.state.writes.length,1);assert.ok(review.receipt.document);}
});
test('Receipt snapshots are detached from callers and the mutable host callback value',async()=>{const f=fixture(),review=f.prepare();await review.create();const receipt=review.receipt;receipt.document.file.path='Forged.md';receipt.document.content='Forged';f.state.doc.file.path='Host mutated';assert.equal(review.receipt.document.file.path,review.path);assert.equal(review.receipt.document.content,review.plan.content);assert.ok(Object.isFrozen(receipt));});
test('A malformed creation acknowledgement is retained as confirmed evidence with an explicit verification failure',async()=>{const f=fixture(),review=f.prepare();const create=f.app.vault.create;f.app.vault.create=async function(path,content,ack){return create.call(this,path,content,document=>ack({...document,content:'Host differs'}));};await assert.rejects(review.create(),/exact reviewed/);assert.equal(review.receipt.completed,false);assert.ok(review.receipt.document);assert.equal(f.state.writes.length,1);});
test('A wrong-path acknowledgement names its actual path and never confirms the reviewed destination',async()=>{
 const f=fixture(),review=f.prepare(),create=f.app.vault.create,actualPath='Projects/Other acknowledged.md';f.app.vault.create=async function(path,content,ack){return create.call(this,path,content,document=>ack({...document,file:{...document.file,path:actualPath}}));};
 await assert.rejects(review.create(),/exact reviewed/);assert.equal(review.receipt.completed,false);assert.equal(review.receipt.document.file.path,actualPath);const message=baseNoteCreationOutcome(review.receipt);assert.ok(message.includes('acknowledged "'+actualPath+'"'));assert.ok(message.includes('reviewed destination "'+review.path+'"'));assert.match(message,/reviewed destination was not confirmed/);assert.ok(!message.includes('Created "'+review.path+'"'));await assert.rejects(review.create(),/already/);assert.equal(f.state.writes.length,1);assert.ok(f.files.has(review.path));
});
