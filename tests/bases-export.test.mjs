import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {build} from 'esbuild';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {errorLogStub} from './error-log-stub.mjs';
import {parseBaseExportDelimited,baseExportWindowsClipboardText,baseExportClipboardConvention,validateBaseExportClipboardReadback,observeBaseExportClipboard,createBaseExportClipboardPermissionLease,acquireBaseExportClipboardPermissionLease} from '../tools/bases-export-scenarios.mjs';
// All fixtures are in-process. No browser, native host, API server or real clipboard is started.
const root=fileURLToPath(new URL('../',import.meta.url));let temporary,api;
const uiStub=`export class Notice {constructor(message,timeout=5000){this.message=message;this.timeout=timeout;}} export class Modal {constructor(app){this.app=app;this.containerEl=document.createElement('div');this.modalEl=document.createElement('div');this.contentEl=document.createElement('div');this.containerEl.append(this.modalEl);this.modalEl.append(this.contentEl);this.isOpen=false;}setTitle(title){this.title=title;return this;}open(){this.isOpen=true;document.body.append(this.containerEl);}close(){if(!this.isOpen)return;this.isOpen=false;this.onClose?.();this.containerEl.remove();}}`;
before(async()=>{
 await mkdir(join(root,'.runtime'),{recursive:true});temporary=await mkdtemp(join(root,'.runtime','bases-export-tests-'));const entry=join(temporary,'api.mjs');
 await build({stdin:{contents:'export * from "./client/bases-export";export * from "./client/bases-export-modal";export {queryBase,BaseDocument} from "./client/bases-model";export {BasesView} from "./client/bases";export {MetadataCache} from "./client/metadata";export {MetadataTypeManager} from "./client/property-types";export {Events} from "./client/events";export {TFile} from "./client/vault";',resolveDir:root},outfile:entry,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[errorLogStub,{name:'pure-view',setup(build){build.onResolve({filter:/^\.\/ui$/},()=>({path:'ui',namespace:'pure-view'}));build.onLoad({filter:/.*/,namespace:'pure-view'},()=>({contents:uiStub}));build.onResolve({filter:/^\.\/views$/},()=>({path:'views',namespace:'pure-views'}));build.onLoad({filter:/.*/,namespace:'pure-views'},()=>({contents:'export class TextFileView {}'}));}}]});api=await import(pathToFileURL(entry).href);
});
after(async()=>{if(temporary){assert.ok(relative(root,temporary).startsWith('.runtime'+sep));await rm(temporary,{recursive:true});}});
const file=(path,properties={})=>({path,name:path.split('/').at(-1),basename:path.split('/').at(-1).replace(/\.[^.]+$/,''),extension:path.split('.').at(-1),stat:{size:1,mtime:0,ctime:0},properties,tags:[],links:[]});
const config=(type='table',extra='')=>'filters: file.ext == "md"\nviews:\n - type: '+type+'\n   name: Main\n   order: [file.name, note.value, note.number, note.flag]\n'+extra;
const query=(files,text=config(),extra={})=>api.queryBase({text,files,context:file('Catalog.base'),view:'Main',search:'',page:0,now:1700000000000,...extra});
const table=(files,text,extra={})=>api.baseExportTable(query(files,text,{...extra,export:true}));

test('same-engine export includes all125 sorted/filter/search/limited rows across pages and folds',()=>{
 const files=Array.from({length:125},(_,index)=>file('Rows/Note '+String(index).padStart(3,'0')+'.md',{value:index<110?'open':'done',number:index,flag:false}));
 assert.equal(query(files).rows.length,100);assert.equal(query(files).exported,undefined);
 for(const type of ['table','list','cards']){
  const text=config(type,'   sort: [{property: note.number, direction: DESC}]\n   groupBy: {property: note.value, direction: ASC}\n');const complete=query(files,text,{page:1,export:true});
  assert.equal(complete.rows.length,125);assert.equal(complete.total,125);assert.equal(complete.exported,true);assert.equal(complete.rows[0].path,'Rows/Note 124.md');
  assert.equal(api.baseExportTable(complete).rows.length,125);assert.equal(table(files,text,{search:'done'}).rows.length,15);
  const limited=query(files,text+'   limit: 105\n',{export:true});assert.equal(limited.rows.length,105);assert.equal(limited.matched,125);
 }
 assert.throws(()=>api.baseExportTable(query(files)),/complete/);
});
test('CSV and TSV use exact LF records, delimiter/quote/CRLF quoting, labels and inert displayed values',()=>{
 const text='properties:\n  value: {displayName: "Value, label"}\n'+config();
 const data=table([file('Rows/Label.md',{value:'line "one",\r\nline\ttwo 😀',number:0,flag:false})],text);
 assert.deepEqual(data.headers,['name','Value, label','number','flag']);
 const csv=api.serializeBaseExport(data,'csv');assert.equal(csv.text,'name,"Value, label",number,flag\nLabel.md,"line ""one"",\r\nline\ttwo 😀",0,false');assert.equal(csv.bytes,Buffer.byteLength(csv.text));assert.equal(csv.protectedCells,0);
 assert.equal(api.serializeBaseExport(data,'tsv').text,'name\tValue, label\tnumber\tflag\nLabel.md\t"line ""one"",\r\nline\ttwo 😀"\t0\tfalse');
 assert.equal(Object.isFrozen(data.rows[0][0]),true);assert.equal(Object.isFrozen(data.rows),true);
});
test('empty/null/list/date/link cells use the documented display contract without summary/group/cover rows',()=>{
 const source='filters: file.ext == "md"\nformulas:\n  date: date("2025-01-02T00:00:00")\n  link: link("Other.md", "Visible alias")\nviews:\n - type: cards\n   name: Main\n   order: [note.nil, note.empty, note.list, formula.date, formula.link, note.number]\n   summaries: {note.number: Sum}\n';
 const result=query([file('A.md',{nil:null,empty:'',list:['one','two'],number:2})],source,{export:true});assert.deepEqual(result.errors,[]);const output=api.serializeBaseExport(api.baseExportTable(result),'csv',false).text;
 assert.equal(output.split('\n').length,2);assert.ok(output.includes(',,"one, two",2025-01-02 00:00:00,Visible alias'));assert.ok(!output.includes('Other.md'));assert.equal(output.includes('All rows'),false);
});

test('empty-label links use the same visible path fallback as rendered links, while ordinary empty/null cells stay blank',()=>{
 const source='filters: file.ext == "md"\nformulas:\n  link: link("=Other.md", "")\n  fileLink: file.asLink("")\nviews:\n - type: table\n   name: Main\n   order: [formula.link, formula.fileLink, note.nil, note.empty]\n';
 const result=query([file('Folder/A.md',{nil:null,empty:''})],source,{export:true});assert.deepEqual(result.errors,[]);assert.equal(result.rows[0].cells[0].text,'');assert.equal(result.rows[0].cells[0].link,'=Other.md');
 const data=api.baseExportTable(result),protectedText=api.serializeBaseExport(data,'csv'),literal=api.serializeBaseExport(data,'csv',false);
 assert.equal(protectedText.text.split('\n')[1],"'=Other.md,Folder/A.md,,");assert.equal(protectedText.protectedCells,1);assert.equal(literal.text.split('\n')[1],'=Other.md,Folder/A.md,,');assert.equal(api.serializeBaseExport(data,'tsv').text.split('\n')[1],"'=Other.md\tFolder/A.md\t\t");
});
test('spreadsheet protection is explicit/default-on and preserves genuine numeric negatives',()=>{
 const rows=['=cmd','+formula','-formula','@SUM(A1)','\t=hidden','  =spaced','\ufeff=marked','safe'];
 const result=query(rows.map((value,index)=>file(index+'.md',{value,number:-2,flag:false})),config(),{export:true});const data=api.baseExportTable(result);
 const protectedText=api.serializeBaseExport(data,'csv');assert.equal(protectedText.protectedCells,7);assert.ok(protectedText.text.includes("'=cmd,-2,false"));
 assert.ok(!protectedText.text.includes("'-2"));const literal=api.serializeBaseExport(data,'csv',false);assert.equal(literal.protectedCells,0);assert.ok(literal.text.includes('=cmd,-2,false'));
 const stringNumber=table([file('X.md',{value:'-2',number:-2})]);assert.ok(api.serializeBaseExport(stringNumber,'csv').text.includes("'-2,-2,"));
});

test('clipboard proof accepts only the exact observed-platform forward transform and preserves quoted TSV cell values',()=>{
 const raw='Name\tValue\nA\t"Quoted ""one"",\r\nnext\tline 😀"\nB\t0\nC\tfalse',native=baseExportWindowsClipboardText(raw),cells=[['Name','Value'],['A','Quoted "one",\r\nnext\tline 😀'],['B','0'],['C','false']];
 assert.equal(native,'Name\tValue\r\nA\t"Quoted ""one"",\r\nnext\tline 😀"\r\nB\t0\r\nC\tfalse');assert.deepEqual(parseBaseExportDelimited(raw,'\t'),cells);assert.deepEqual(parseBaseExportDelimited(native,'\t'),cells);
 assert.equal(validateBaseExportClipboardReadback(raw,native,'Win32',cells),'windows-lf-to-crlf');assert.equal(validateBaseExportClipboardReadback(raw,raw,'Linux x86_64',cells),'none');
 assert.equal(baseExportClipboardConvention(raw,raw,'Linux x86_64'),'none');assert.equal(baseExportClipboardConvention(raw,native,'Win32'),'windows-lf-to-crlf');assert.equal(baseExportClipboardConvention(raw,native,'Windows'),'windows-lf-to-crlf');
 for(const platform of ['Linux x86_64','MacIntel','unknown'])assert.equal(baseExportClipboardConvention(raw,native,platform),null);
 for(const changed of [native.replace('one"",\r\nnext','one"",\nnext'),native.replace('\r\n','\r\r\n'),native+'\r\n','Unrelated clipboard content'])assert.equal(baseExportClipboardConvention(raw,changed,'Win32'),null);
 const cellLF='A\t"bare\ncell"\nB\tend';assert.notDeepEqual(parseBaseExportDelimited(baseExportWindowsClipboardText(cellLF),'\t'),parseBaseExportDelimited(cellLF,'\t'),'A supported byte convention alone cannot stand in for exact parsed fixture cell values');assert.throws(()=>validateBaseExportClipboardReadback(cellLF,baseExportWindowsClipboardText(cellLF),'Win32',parseBaseExportDelimited(cellLF,'\t')),/TSV values or order/);
 assert.throws(()=>validateBaseExportClipboardReadback(raw,'Unrelated private clipboard content','Win32',cells),error=>error.message.includes('unsupported newline convention')&&!String(error).includes('Unrelated private clipboard content'));
 for(const malformed of ['A\tvalue\rB\tother','A\t"closed"junk','A\t"open'])assert.throws(()=>parseBaseExportDelimited(malformed,'\t'));
});

test('clipboard fixture observer passes through the original arguments, waits for real acknowledgement and redacts unknown inputs',async()=>{
 const held=deferred(),calls=[],prototype={writeText(text){calls.push({receiver:this,text});return held.promise;}},clipboard=Object.create(prototype),state={clipboardExpected:'known\nfixture',clipboardWrites:[]},restore=observeBaseExportClipboard(clipboard,state);
 const write=clipboard.writeText(state.clipboardExpected);assert.equal(calls.length,1);assert.equal(calls[0].receiver,clipboard);assert.equal(calls[0].text,state.clipboardExpected);assert.equal(state.clipboardWrites[0].acknowledged,false);held.resolve();await write;assert.equal(state.clipboardWrites[0].acknowledged,true);assert.deepEqual(state.clipboardWrites[0].arguments,[state.clipboardExpected]);
 await clipboard.writeText('unknown private text');assert.equal(calls.length,2);assert.equal(state.clipboardWrites[1].matchesExpected,false);assert.equal(Object.hasOwn(state.clipboardWrites[1],'arguments'),false);assert.equal(JSON.stringify(state).includes('unknown private text'),false);restore();assert.equal(clipboard.writeText,prototype.writeText);assert.equal(Object.hasOwn(clipboard,'writeText'),false);
 const failure=Error('Native write denied'),owned={writeText(){return Promise.reject(failure);}},descriptor=Object.getOwnPropertyDescriptor(owned,'writeText'),denied={clipboardExpected:'known',clipboardWrites:[]},reset=observeBaseExportClipboard(owned,denied);await assert.rejects(owned.writeText('known'),error=>error===failure);assert.equal(denied.clipboardWrites[0].acknowledged,false);reset();assert.deepEqual(Object.getOwnPropertyDescriptor(owned,'writeText'),descriptor);
});

test('temporary CDP clipboard permission leases grant once and reset once without clipboard content actions',async()=>{
 const calls=[],lease=createBaseExportClipboardPermissionLease(async(method,params)=>{calls.push({method,params});},'http://127.0.0.1:1234');
 await lease.acquire();await lease.acquire();assert.deepEqual(calls,[{method:'Browser.grantPermissions',params:{origin:'http://127.0.0.1:1234',permissions:['clipboardReadWrite','clipboardSanitizedWrite']}}]);
 await Promise.all([lease.release(),lease.release()]);await lease.release();assert.deepEqual(calls.map(call=>call.method),['Browser.grantPermissions','Browser.resetPermissions']);assert.deepEqual(calls[1].params,{});assert.equal(lease.receipt.grantAcknowledged,true);assert.equal(lease.receipt.resetAcknowledged,true);assert.equal(lease.receipt.released,true);await assert.rejects(lease.acquire(),/already closed/);
 const unusedCalls=[],unused=createBaseExportClipboardPermissionLease(async method=>unusedCalls.push(method),'http://127.0.0.1:1234');await unused.release();assert.deepEqual(unusedCalls,[]);await assert.rejects(unused.acquire(),/already closed/);
});

test('permission cleanup waits for a pending grant and resets failed acquisitions while preserving strict failures',async()=>{
 const held=deferred(),calls=[],lease=createBaseExportClipboardPermissionLease(async method=>{calls.push(method);if(method==='Browser.grantPermissions')await held.promise;},'http://127.0.0.1:1234'),acquiring=lease.acquire();await tick();const releasing=lease.release();await tick();assert.deepEqual(calls,['Browser.grantPermissions']);held.resolve();await assert.rejects(acquiring,/closed while its grant was pending/);await releasing;assert.deepEqual(calls,['Browser.grantPermissions','Browser.resetPermissions']);assert.equal(lease.receipt.released,true);
 const grantError=Error('Synthetic grant failure'),failedCalls=[],failed=createBaseExportClipboardPermissionLease(async method=>{failedCalls.push(method);if(method==='Browser.grantPermissions')throw grantError;},'http://127.0.0.1:1234');await assert.rejects(failed.acquire(),error=>error===grantError);await failed.release();assert.deepEqual(failedCalls,['Browser.grantPermissions','Browser.resetPermissions']);assert.equal(failed.receipt.grantAcknowledged,false);assert.equal(failed.receipt.resetAcknowledged,true);
 const resetError=Error('Synthetic reset failure'),strictCalls=[],strict=createBaseExportClipboardPermissionLease(async method=>{strictCalls.push(method);if(method==='Browser.resetPermissions')throw resetError;},'http://127.0.0.1:1234');await strict.acquire();await assert.rejects(strict.release(),error=>error===resetError);await assert.rejects(strict.release(),error=>error===resetError);assert.deepEqual(strictCalls,['Browser.grantPermissions','Browser.resetPermissions']);assert.equal(strict.receipt.resetAcknowledged,false);assert.equal(strict.receipt.released,false);
});

test('collection cleanup registration is required and acknowledged before any clipboard permission grant',async()=>{
 const calls=[],registered=[],tools={report:{},async evaluate(expression){assert.equal(expression,'location.origin');calls.push('origin');return'http://127.0.0.1:1234';},async command(method){calls.push(method);},async deferClipboardPermissionCleanup(lease,section){calls.push('registered');assert.equal(lease.receipt.grantAttempted,false);registered.push({lease,section});}};
 const lease=await acquireBaseExportClipboardPermissionLease(tools,'basesExportReadOnly');assert.deepEqual(calls,['origin','registered','Browser.grantPermissions']);assert.equal(registered[0].lease,lease);assert.equal(registered[0].section,'basesExportReadOnly');assert.equal(tools.report.basesExportReadOnlyClipboardPermissions,lease.receipt);assert.equal(lease.receipt.resetAttempted,false);assert.equal(lease.receipt.released,false);
 // Only the collection owner invokes the existing real-API release function later.
 await registered[0].lease.release();assert.deepEqual(calls,['origin','registered','Browser.grantPermissions','Browser.resetPermissions']);assert.equal(lease.receipt.resetAcknowledged,true);
 const missing={...tools,deferClipboardPermissionCleanup:undefined};await assert.rejects(acquireBaseExportClipboardPermissionLease(missing,'basesExport'),/requires collection-owned/);assert.equal(calls.length,4);
 const registrationError=Error('Synthetic collection registration failure'),blockedCalls=[],blocked={report:{},async evaluate(){return'http://127.0.0.1:1234';},async command(method){blockedCalls.push(method);},async deferClipboardPermissionCleanup(){throw registrationError;}};await assert.rejects(acquireBaseExportClipboardPermissionLease(blocked,'basesExport'),error=>error===registrationError);assert.deepEqual(blockedCalls,[]);assert.equal(blocked.report.basesExportClipboardPermissions.grantAttempted,false);
});
test('overflow refuses complete export without truncation; existing page/query guards stay intact',()=>{
 assert.throws(()=>query(Array.from({length:2001},(_,i)=>file(i+'.md')),config(),{export:true}),/2,000/);
 const rows=Array.from({length:2000},(_,i)=>file(i+'.md'));assert.equal(query(rows).rows.length,100);assert.equal(query(rows,config(),{export:true}).rows.length,2000);
 assert.throws(()=>query(Array.from({length:10001},(_,i)=>file(i+'.md')),config(),{export:true}),/10,000/);
 const keys=Array.from({length:51},(_,i)=>'note.key'+i),wide='views:\n - type: table\n   name: Main\n   order: ['+keys.join(',')+']\n';assert.throws(()=>query(rows,wide,{export:true}),/100,000/);
 const big=table(Array.from({length:1100},(_,i)=>file(i+'.md',{value:'😀'.repeat(1000)})));assert.throws(()=>api.serializeBaseExport(big,'csv'),/2 MiB/);
 assert.throws(()=>query([],config(),{export:false}),/export mode/);
});
test('incomplete/error/malformed Unicode cells cannot be published as a successful export',()=>{
 const bad=query([file('A.md',{number:1})],config()+'   filters: missingFunction()\n',{export:true});assert.ok(bad.errors.length);assert.throws(()=>api.baseExportTable(bad),/error-free/);
 const result=query([file('A.md',{value:'fine'})],config(),{export:true});result.rows[0].cells.pop();assert.throws(()=>api.baseExportTable(result),/columns/);
 for(const value of ['\ud800','\udc00','\x00']){const data={headers:['A'],rows:[[{text:value,number:false}]],matched:1,warnings:[]};assert.throws(()=>api.serializeBaseExport(data,'csv'),/Unicode|text subset/);}
 assert.equal(api.baseExportFilename('../CON / unsafe: name.'),'base-.._CON _ unsafe_ name.csv');
});

class Node{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parent=null;this.dataset={};this.listeners=new Map();this.attributes={};this.disabled=false;this.hidden=false;this.checked=false;this.value='';this.textContent='';}
 get value(){return this._value;}set value(value){this._value=this.tagName==='TEXTAREA'?String(value).replace(/\r\n?/g,'\n'):value;}
 get isConnected(){return this.root||Boolean(this.parent?.isConnected);}get options(){return this.children.filter(node=>node.tagName==='OPTION');}
 append(...nodes){for(const node of nodes){if(typeof node==='string')continue;node.parent=this;this.children.push(node);if(this.tagName==='SELECT'&&!this.value)this.value=node.value;}}
 replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=value;}checkVisibility(){return this.isConnected&&!this.hidden;}addEventListener(type,fn){const all=this.listeners.get(type)??[];all.push(fn);this.listeners.set(type,all);}
 emit(type){for(const fn of this.listeners.get(type)??[])fn({target:this,preventDefault(){}});}click(){if(!this.disabled){this.emit('click');if(this.tagName==='A')this.ownerDocument.downloads.push({url:this.href,name:this.download});}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;this.root=false;}
}
const all=node=>[node,...node.children.flatMap(all)];const find=(node,key)=>all(node).find(node=>Object.hasOwn(node.dataset,key));
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return{promise,resolve};};const tick=()=>new Promise(ok=>setImmediate(ok));
function dom(t){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),navigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),worker=globalThis.Worker;
 const doc={downloads:[],baseURI:'http://local/',createElement(tag){return new Node(tag,this);}};doc.body=new Node('body',doc);doc.body.root=true;globalThis.document=doc;const clipboard=[];Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{async writeText(text){clipboard.push(text);}}}});
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,objects=[],revoked=[];URL.createObjectURL=blob=>{const url='blob:export-'+objects.length;objects.push({url,blob});return url;};URL.revokeObjectURL=url=>revoked.push(url);
 class Worker{static instances=[];static hold=false;constructor(){this.listeners=new Map();Worker.instances.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}postMessage(request){this.request=structuredClone(request);if(!Worker.hold)queueMicrotask(()=>this.respond());}respond(){if(this.terminated)return;let data;try{data={serial:this.request.serial,result:api.queryBase(this.request)};}catch(error){data={serial:this.request.serial,error:error.message};}this.listeners.get('message')?.({data});}terminate(){this.terminated=true;}}
 globalThis.Worker=Worker;
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;if(navigator)Object.defineProperty(globalThis,'navigator',navigator);else delete globalThis.navigator;globalThis.Worker=worker;URL.createObjectURL=create;URL.revokeObjectURL=revoke;});
 return{doc,clipboard,objects,revoked,Worker};
}
function modalFixture(t,check=async()=>{}){const d=dom(t),state={current:true,checks:0,closed:0},modal=new api.BaseExportModal({}, {title:'Main',current:()=>state.current,check:async()=>{state.checks++;await check();},closed:()=>state.closed++});modal.open();modal.setResult(query([file('A.md',{value:'=text',number:-2,flag:false})],config(),{export:true}));t.after(()=>modal.close());return{...d,state,modal};}

test('literal modal review switches format/protection without implicit publication, then CSV owns exact Blob and URL cleanup',async t=>{
 const f=modalFixture(t);assert.equal(f.clipboard.length,0);assert.equal(f.doc.downloads.length,0);assert.ok(find(f.modal.contentEl,'basesExportPreview').value.includes("'=text,-2,false"));
 const protect=find(f.modal.contentEl,'basesExportProtect');protect.checked=false;protect.emit('change');assert.ok(find(f.modal.contentEl,'basesExportPreview').value.includes('=text,-2,false'));
 find(f.modal.contentEl,'basesExportPublish').click();await tick();assert.equal(f.state.checks,1);assert.equal(f.doc.downloads.length,1);assert.equal(f.objects.length,1);assert.equal(await f.objects[0].blob.text(),find(f.modal.contentEl,'basesExportPreview').value);assert.equal(f.objects[0].blob.type,'text/csv;charset=utf-8');assert.equal(f.doc.downloads[0].name,'base-Main.csv');f.modal.close();f.modal.close();assert.deepEqual(f.revoked,['blob:export-0']);
});

test('the LF-normalized textarea preview never changes embedded CRLF/CR bytes sent to CSV or TSV',async t=>{
 const f=modalFixture(t);f.modal.setResult(query([file('A.md',{value:'Quoted "one",\r\nnext\tline 😀\rlast',number:0,flag:false})],config(),{export:true}));
 const preview=find(f.modal.contentEl,'basesExportPreview'),csv=f.modal.rendered.text;assert.equal(preview.value,csv.replace(/\r\n?/g,'\n'));assert.equal(preview.value.includes('\r'),false);assert.ok(csv.includes('\r\nnext\tline 😀\rlast'));assert.equal(f.modal.rendered.bytes,Buffer.byteLength(csv));assert.match(f.modal.contentEl.children[0].textContent,/Preview line breaks are shown as LF; CSV preserves embedded CR\/LF/);assert.match(f.modal.contentEl.children[0].textContent,/Clipboard line endings may be normalized by your system/);assert.equal(preview.attributes['aria-label'],'Export text preview');
 find(f.modal.contentEl,'basesExportPublish').click();await tick();assert.equal(await f.objects[0].blob.text(),csv);assert.notEqual(await f.objects[0].blob.text(),preview.value);
 const format=find(f.modal.contentEl,'basesExportFormat');format.value='tsv';format.emit('change');const tsv=f.modal.rendered.text;assert.equal(preview.value,tsv.replace(/\r\n?/g,'\n'));find(f.modal.contentEl,'basesExportPublish').click();await tick();assert.deepEqual(f.clipboard,[tsv]);assert.notEqual(f.clipboard[0],preview.value);assert.ok(f.clipboard[0].includes('\r\nnext\tline 😀\rlast'));
});
test('a held pre-publication check refuses canceled, changed-format or retired query before clipboard/Blob effects',async t=>{
 for(const transition of ['cancel','format','owner']){
  const held=deferred(),f=modalFixture(t,()=>held.promise),format=find(f.modal.contentEl,'basesExportFormat');format.value='tsv';format.emit('change');find(f.modal.contentEl,'basesExportPublish').click();
  if(transition==='cancel')f.modal.close();if(transition==='format')format.value='csv';if(transition==='owner')f.state.current=false;held.resolve();await tick();assert.deepEqual(f.clipboard,[]);assert.deepEqual(f.doc.downloads,[]);f.modal.close();
 }
});
test('clipboard permission failure stays retryable; an acknowledged write after retirement is not misrepresented as canceled',async t=>{
 const f=modalFixture(t),format=find(f.modal.contentEl,'basesExportFormat');format.value='tsv';format.emit('change');const held=deferred();let calls=0;
 globalThis.navigator.clipboard.writeText=async text=>{calls++;if(calls===1)throw Error('Permission denied');f.clipboard.push(text);await held.promise;};
 const publish=find(f.modal.contentEl,'basesExportPublish');publish.click();await tick();assert.match(find(f.modal.contentEl,'basesExportError').textContent,/Permission denied/);assert.equal(publish.disabled,false);
 publish.click();await tick();assert.equal(f.clipboard.length,1);const status=find(f.modal.contentEl,'basesExportStatus'),before=status.textContent;f.state.current=false;f.modal.close();held.resolve();await tick();assert.equal(calls,2);assert.equal(status.textContent,before);assert.equal(f.clipboard[0].includes("'=text"),true);
});
function ownerFixture(t){
 const d=dom(t),fileObject=file('Catalog.base'),version='a'.repeat(64),request={text:config(),files:[file('A.md',{value:'one',number:1})],context:fileObject,view:'Main',search:'',page:0,now:1,serial:4};
 const leaf={},app={vault:{rootPath:'root',lazy:false,getFileByPath:path=>path===fileObject.path?fileObject:null,async getFileInfo(){return{root:'root',file:{path:fileObject.path},version};}},core:{isEnabled:()=>true,busy:false},changingVault:false};
 const host=new Node('div',d.doc);host.root=true;const owner={app,leaf,file:fileObject,containerEl:host,model:{},text:request.text,selected:'Main',search:'',savedDocument:{version},isLoaded:true,isSaving:false,exportButton:{disabled:false},noteCreationButton:{disabled:true},exportQuery:{request,epoch:1,serial:4,version},exportEpoch:1,serial:4,modal:null,exportWorker:null,exportTimeout:null};leaf.view=owner;
 t.after(()=>owner.modal?.close());return{...d,owner,version,file:fileObject};
}
test('a real Bases export owner uses the exact existing query snapshot and excludes late worker results after search/core retirement',async t=>{
 const f=ownerFixture(t);await api.BasesView.prototype.openExport.call(f.owner);await tick();assert.equal(f.Worker.instances.length,1);assert.equal(f.Worker.instances[0].request.export,true);assert.equal(f.Worker.instances[0].request.now,1);assert.ok(find(f.owner.modal.contentEl,'basesExportPreview').value.includes('A.md,one,1,'));
 api.BasesView.prototype.retireExport.call(f.owner);assert.equal(f.owner.modal,null);assert.equal(f.owner.exportQuery,null);assert.equal(f.owner.exportButton.disabled,true);
});
test('physical source versions and held root/path/session/view/provider changes fence export before worker or output',async t=>{
 for(const change of ['version','root','path','provider','hidden','index']){
  const f=ownerFixture(t),held=deferred();f.owner.app.vault.getFileInfo=()=>held.promise;const opening=api.BasesView.prototype.openExport.call(f.owner);await tick();
  if(change==='root')f.owner.app.vault.rootPath='new';if(change==='path')f.file.path='Renamed.base';if(change==='provider')f.owner.app.core.isEnabled=()=>false;if(change==='hidden')f.owner.containerEl.hidden=true;if(change==='index'){f.owner.app.vault.lazy=true;f.owner.app.vault.indexComplete=false;}
  held.resolve({root:'root',file:{path:'Catalog.base'},version:change==='version'?'b'.repeat(64):f.version});await opening;await tick();assert.equal(f.Worker.instances.length,0);assert.deepEqual(f.clipboard,[]);assert.deepEqual(f.doc.downloads,[]);f.owner.modal?.close();
 }
});

test('a genuine worker result still requires a fresh physical source version before the review is enabled',async t=>{
 const f=ownerFixture(t),held=deferred();let reads=0;
 f.owner.app.vault.getFileInfo=()=>++reads===1?Promise.resolve({root:'root',file:{path:'Catalog.base'},version:f.version}):held.promise;
 await api.BasesView.prototype.openExport.call(f.owner);await tick();assert.equal(reads,2);assert.equal(find(f.owner.modal.contentEl,'basesExportPreview').value,'');assert.equal(find(f.owner.modal.contentEl,'basesExportPublish').disabled,true);
 held.resolve({root:'root',file:{path:'Catalog.base'},version:'b'.repeat(64)});await tick();assert.match(find(f.owner.modal.contentEl,'basesExportError').textContent,/saved base changed/);assert.equal(find(f.owner.modal.contentEl,'basesExportPublish').disabled,true);assert.deepEqual(f.clipboard,[]);assert.deepEqual(f.doc.downloads,[]);
});

test('a delayed dirty-peer metadata notification retires the old review; indexing it before review prevents that recurrence',async t=>{
 const f=ownerFixture(t),owner=f.owner,app=owner.app,events=new api.Events(),peerPath='Peer.md',peerFile=new api.TFile(app.vault,file(peerPath)),settled=deferred();
 const session={text:'# Earlier dirty peer Ω.',dirty:true,document:{file:{path:peerPath},content:'# Saved peer.',version:'c'.repeat(64)}};
 app.vault.on=events.on.bind(events);app.vault.getAbstractFileByPath=path=>path===peerPath?peerFile:null;app.workspace={sessions:new Map([[peerPath,session]])};app.metadataCache=new api.MetadataCache(app);app.metadataCache.root='root';app.metadataTypeManager=new api.MetadataTypeManager(app);
 Object.assign(owner,{model:new api.BaseDocument(owner.text),status:new Node('output',f.doc),table:new Node('div',f.doc),pagination:new Node('div',f.doc),contentEl:new Node('div',f.doc),debounce:null,timeout:null,worker:null,cardCovers:null,exportEpoch:4});owner.exportQuery.epoch=4;
 owner.stop=api.BasesView.prototype.stop.bind(owner);owner.retireExport=api.BasesView.prototype.retireExport.bind(owner);owner.refresh=api.BasesView.prototype.refresh.bind(owner);owner.snapshot=()=>[...owner.exportQueryFiles];owner.exportQueryFiles=[...owner.exportQuery.request.files,owner.file];owner.render=result=>{owner.lastResult=result;queueMicrotask(settled.resolve);};owner.setError=value=>{owner.lastError=value;};
 let schedules=0;const schedule=()=>{schedules++;api.BasesView.prototype.schedule.call(owner);};app.metadataCache.on('changed',schedule);app.metadataTypeManager.on('changed',schedule);app.metadataCache.on('finished',schedule);
 await api.BasesView.prototype.openExport.call(owner);await tick();const oldModal=owner.modal;assert.equal(oldModal.isOpen,true);
 // This is the real update invoked by the workspace's delayed notifyEditor callback.
 app.metadataCache.updateOpenDocuments();assert.equal(schedules,3);assert.equal(oldModal.isOpen,false);assert.equal(owner.modal,null);assert.equal(owner.exportQuery,null);assert.equal(owner.exportButton.disabled,true);
 await settled.promise;assert.equal(owner.serial,6);assert.equal(owner.exportEpoch,9);assert.equal(owner.exportButton.disabled,false);assert.equal(app.metadataCache.getDocument(peerPath).text,session.text);assert.equal(app.metadataCache.getDocument(peerPath).dirty,true);
 await api.BasesView.prototype.openExport.call(owner);await tick();const freshModal=owner.modal;assert.equal(freshModal.isOpen,true);app.metadataCache.updateOpenDocuments();assert.equal(schedules,3);assert.equal(owner.modal,freshModal);assert.equal(freshModal.isOpen,true);assert.deepEqual(f.clipboard,[]);assert.deepEqual(f.doc.downloads,[]);
});
