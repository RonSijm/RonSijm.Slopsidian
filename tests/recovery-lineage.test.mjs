import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import {build} from "esbuild";
import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {join, relative} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
const root=fileURLToPath(new URL('../',import.meta.url));
let directory,api;
before(async()=>{
 await mkdir(join(root,'.runtime'),{recursive:true});directory=await mkdtemp(join(root,'.runtime','recovery-lineage-tests-'));
 const outfile=join(directory,'api.mjs');
 await build({stdin:{contents:'export * from "./client/recovery-model";export * from "./client/file-recovery";export {HostError} from "./client/contracts";export {TFile} from "./client/vault";',resolveDir:root},outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'pure-shell',setup(plugin){
  plugin.onResolve({filter:/^\.\/(vault|ui|views)$/},args=> /file-recovery\.ts$/.test(args.importer)||args.importer.endsWith('<stdin>')?{path:args.path.slice(2),namespace:'pure-shell'}:undefined);
  plugin.onResolve({filter:/^\.\/client\/vault$/},()=>({path:'vault',namespace:'pure-shell'}));
  plugin.onLoad({filter:/.*/,namespace:'pure-shell'},args=>({contents:args.path==='vault'?'export class TFile { constructor(path){this.path=path;this.stat={size:20};}get extension(){return this.path.split(".").at(-1)}}':args.path==='views'?'export class TextFileView {}':'export class Notice {constructor(message){globalThis.lineageNotices.push(message)}} export class Modal {}'}));
 }}]});api=await import(pathToFileURL(outfile).href);
});
after(async()=>{delete globalThis.lineageNotices;if(directory){assert.match(relative(root,directory).replaceAll('\\','/'),/^\.runtime\/recovery-lineage-tests-[^/]+$/);await rm(directory,{recursive:true});}});
const sha=value=>createHash('sha256').update(value).digest('hex');
const snapshot=(id,path,content=id,ts=1000)=>({id,path,content,ts,hasBom:true,sourceVersion:sha('\ufeff'+content),reason:'manual',future:{retain:[1,true]}});
const history=(...snapshots)=>new api.RecoveryHistory({version:1,future:{opaque:true},snapshots});
const reload=model=>new api.RecoveryHistory(structuredClone(model.data));
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('confirmed chains preserve immutable captured paths, IDs, source text and unknown fields',()=>{
 const a=snapshot('a','A.md'),model=history(a),original=structuredClone(model.snapshots);
 assert.equal(model.rename('A.md','Folder/B.md',1100),'followed');assert.equal(model.rename('Folder/B.md','Folder/C.md',1200),'followed');
 assert.deepEqual(model.snapshots,original);assert.equal(model.target('a').path,'Folder/C.md');assert.equal(model.latest('A.md'),null);assert.equal(model.latest('Folder/C.md').id,'a');
 const again=reload(model);assert.deepEqual(again.snapshots,original);assert.deepEqual(again.data.future,{opaque:true});assert.equal(again.target('a').capturedPath,'A.md');assert.equal(again.target('a').path,'Folder/C.md');
});
test('new target captures join the same group and dedupe across captured names without retargeting provenance',()=>{
 const model=history(snapshot('a','A.md','same'));model.rename('A.md','B.md',1100);const token=model.target('a').token;
 assert.equal(model.capture({path:'B.md',content:'same',hasBom:true,sourceVersion:sha('same'),reason:'auto'},1200,0,true,'dup'),'unchanged');
 assert.equal(model.capture({path:'B.md',content:'new',hasBom:false,sourceVersion:sha('new'),reason:'manual'},1300,0,true,'b'),'added');
 assert.equal(model.target('a').group,model.target('b').group);assert.equal(model.target('a').token,token);assert.equal(model.snapshots[1].path,'B.md');assert.equal(reload(model).target('b').path,'B.md');
});
test('destination collisions retire both unrelated groups and later captures start independent history',()=>{
 const model=history(snapshot('a','A.md'),snapshot('oldb','B.md')),original=structuredClone(model.snapshots);
 assert.equal(model.rename('A.md','B.md',1100),'blocked');assert.deepEqual(model.snapshots,original);
 assert.equal(model.target('a').path,null);assert.equal(model.target('oldb').path,null);assert.notEqual(model.target('a').group,model.target('oldb').group);
 model.capture({path:'B.md',content:'current moved file',hasBom:true,sourceVersion:sha('current'),reason:'auto'},1200,0,true,'newb');
 assert.equal(model.target('newb').path,'B.md');assert.notEqual(model.target('newb').group,model.target('oldb').group);assert.equal(reload(model).target('a').path,null);
});
test('a moved file without prior snapshots cannot inherit destination history',()=>{
 const model=history(snapshot('oldb','B.md'));assert.equal(model.rename('A.md','B.md',1200),'blocked');assert.equal(model.target('oldb').path,null);
 model.capture({path:'B.md',content:'fresh',hasBom:true,sourceVersion:null,reason:'auto'},1300,0,true,'newb');assert.notEqual(model.target('newb').group,model.target('oldb').group);
});
test('cycles and exhausted rename chains retain snapshots but disable association rather than recreating old names',()=>{
 const model=history(snapshot('a','A.md'));model.rename('A.md','B.md',1100);assert.equal(model.rename('B.md','A.md',1200),'blocked');assert.equal(model.target('a').path,null);assert.match(model.target('a').reason,/historical path/);
 const capped=history(snapshot('a','N0.md'));for(let i=0;i<64;i++)assert.equal(capped.rename(`N${i}.md`,`N${i+1}.md`,2000+i),'followed');assert.equal(capped.rename('N64.md','N65.md',3000),'blocked');assert.equal(reload(capped).target('a').path,null);
});
test('known deletion/reuse retires renamed history; original missing-file recovery remains compatible',()=>{
 const model=history(snapshot('a','A.md'),snapshot('plain','Plain.md'));model.rename('A.md','B.md',1100);
 assert.equal(model.retireTarget('B.md',1200,'Target deleted'),true);assert.equal(model.target('a').path,null);
 assert.equal(model.retireTarget('Plain.md',1200,'Deleted'),false);assert.equal(model.target('plain').path,'Plain.md');
 model.retireTarget('Plain.md',1300,'A new file reused the path',true);assert.equal(model.target('plain').path,null);
});
test('case-only acknowledged changes follow while distinct case-colliding histories remain separate',()=>{
 const model=history(snapshot('a','A.md'));assert.equal(model.rename('A.md','a.md',1100),'followed');assert.equal(model.target('a').path,'a.md');assert.equal(reload(model).target('a').path,'a.md');
 const clash=history(snapshot('a','A.md'),snapshot('b','a.md'));assert.equal(clash.rename('A.md','a.md',1100),'blocked');assert.equal(clash.target('a').path,null);assert.equal(clash.target('b').path,null);
});
test('pruning and clear keep association references consistent and preserve unknown extension data',()=>{
 const model=history(snapshot('a','A.md','old',1000));model.rename('A.md','B.md',1100);model.capture({path:'B.md',content:'new',hasBom:false,sourceVersion:null,reason:'manual'},86400000*2,0,true,'b');
 model.data.slopsidianRenames.future='retain';assert.equal(model.prune(86400000*2,1),1);assert.equal(reload(model).target('b').path,'B.md');assert.equal(model.clear(),true);assert.deepEqual(model.data.slopsidianRenames.lineages,[]);assert.equal(model.data.slopsidianRenames.future,'retain');assert.deepEqual(reload(model).snapshots,[]);
});
test('malformed/future/duplicate/orphan/cyclic associations fail without mutating input',()=>{
 const good=history(snapshot('a','A.md'));good.rename('A.md','B.md',1200);
 for(const change of [d=>d.slopsidianRenames.version=2,d=>d.slopsidianRenames.lineages[0].snapshotIds.push('a'),d=>d.slopsidianRenames.lineages[0].snapshotIds=['missing'],d=>d.slopsidianRenames.lineages[0].moves[0].to='../Secret.md',d=>d.slopsidianRenames.lineages[0].moves.push({from:'B.md',to:'A.md',ts:1300}),d=>d.slopsidianRenames.lineages[0].moves[0].from='Other.md']){
  const data=structuredClone(good.data);change(data);const before=structuredClone(data);assert.throws(()=>new api.RecoveryHistory(data));assert.deepEqual(data,before);
 }
});

function emitter(){const events=new Map();return{on(name,callback){const entry={emitter:this,name,callback};const list=events.get(name)??[];list.push(entry);events.set(name,list);return entry;},offref(entry){events.set(entry.name,(events.get(entry.name)??[]).filter(item=>item!==entry));},trigger(name,...args){for(const entry of [...events.get(name)??[]])entry.callback(...args);}};}
async function fixture(t,{data,changing=false}={}){
 globalThis.lineageNotices=[];let store=structuredClone(data??{version:1,future:{keep:true},snapshots:[snapshot('first','A.md','Original λ\r\n',Date.now())]}),storeVersion=1,active=true,activate,dispose;
 const calls=[],writes=[],documents=new Map(),files=new Map(),vaultEvents=emitter(),coreEvents=emitter(),workspaceEvents=emitter();
 const put=(path,content='Saved current 😀\r\n',bom=true)=>{const file=new api.TFile(path);file.stat.size=Buffer.byteLength(content)+(bom?3:0);files.set(path,file);documents.set(path,{file:{path},content,hasBom:bom,version:sha((bom?'\ufeff':'')+content)});return file;};put('A.md');
 const app={changingVault:changing,vault:{...vaultEvents,rootPath:'vault-A',readOnly:false,getFileByPath:path=>files.get(path)??null,async readDocument(path){calls.push(['read',path]);const value=structuredClone(documents.get(path));await f.beforeRead?.(path);if(!value)throw new api.HostError(404,'Missing');return value;},async writeDocument(path,value,version,missing){calls.push(['write',path]);const current=documents.get(path);if(current?.version!==version&&!(current===undefined&&version===null)||missing&&current)throw Error('version conflict');put(path,value.replace(/^\ufeff/,''),current?current.hasBom:value.startsWith('\ufeff'));writes.push(path);return structuredClone(documents.get(path));}},
 configuration:{async read(){calls.push(['history-read']);const value={root:app.vault.rootPath,id:'vault-dotnet-recovery',version:storeVersion,data:structuredClone(store)};await f.beforeHistory?.();return value;},async write(before,next){calls.push(['history-write']);if(f.failStore)throw Error('History conflict');if(before.version!==storeVersion)throw Error('History changed');store=structuredClone(next);storeVersion++;}},
 workspace:{...workspaceEvents,hasUnsavedChanges:false,leaves:()=>[],getLeavesOfType:()=>[],getActiveFile:()=>null,withFileMutation:action=>action(),acceptExternalDocuments:()=>{}},
 core:{...coreEvents,busy:false,isEnabled:()=>active,state:()=>({settings:{intervalMinutes:0,keepDays:3650}}),register(id,factory){activate=factory;},run:action=>action()},commands:{install:()=>()=>{}},metadataCache:{refresh:async()=>{}},notifyEditor:async()=>{}};
 const recovery=new api.FileRecovery(app),f={app,recovery,calls,writes,files,documents,put,failStore:false,get store(){return store;},set store(value){store=structuredClone(value);storeVersion++;},async rename(from,to){const file=files.get(from);assert.ok(file);files.delete(from);files.set(to,file);file.path=to;const doc=documents.get(from);documents.delete(from);documents.set(to,{...doc,file:{path:to}});vaultEvents.trigger('rename',file,from);return file;},async idle(){for(let i=0;i<3;i++)await tick();await recovery.whenIdle();},async disable(){active=false;await dispose();},async enable(){active=true;dispose=await activate();}};
 recovery.register(app.core);dispose=await activate();if(!changing){await new Promise(resolve=>setTimeout(resolve,10));await f.idle();}
 t.after(async()=>{if(active)await f.disable();});calls.length=0;return f;
}
test('actual module follows rapid confirmed chains behind a held store read and ignores folder event duplication',async t=>{
 const f=await fixture(t),gate=deferred();let first=true;f.beforeHistory=()=>{if(first){first=false;return gate.promise;}};
 await f.rename('A.md','B.md');await f.rename('B.md','C.md');f.app.vault.trigger('rename',{path:'Folder'},'OldFolder');gate.resolve();await f.idle();
 assert.equal(new api.RecoveryHistory(f.store).target('first').path,'C.md');assert.equal(f.store.slopsidianRenames.lineages.length,1);assert.equal(f.store.slopsidianRenames.lineages[0].moves.length,2);assert.equal(f.store.snapshots[0].path,'A.md');
});
test('actual restore targets current renamed path, records safety snapshot there, and never recreates captured name',async t=>{
 const f=await fixture(t);await f.rename('A.md','B.md');await f.idle();const plan=await f.recovery.prepareRestore('first');assert.equal(plan.targetPath,'B.md');assert.equal(plan.snapshot.path,'A.md');await f.recovery.restore(plan);
 assert.deepEqual(f.writes,['B.md']);assert.equal(f.documents.has('A.md'),false);assert.equal(f.documents.get('B.md').content,'Original λ\r\n');assert.ok(f.store.snapshots.some(snapshot=>snapshot.path==='B.md'&&snapshot.reason==='before-restore'));assert.equal(f.store.snapshots[0].path,'A.md');
});
test('held compare and pre-rename restore plans refuse rather than creating ghost source names',async t=>{
 const f=await fixture(t),plan=await f.recovery.prepareRestore('first'),gate=deferred();f.beforeRead=async()=>{f.beforeRead=null;await gate.promise;};const compare=f.recovery.compareSaved('first');for(let i=0;i<4;i++)await tick();await f.rename('A.md','B.md');gate.resolve();await assert.rejects(compare,/renamed|association/);await f.idle();await assert.rejects(f.recovery.restore(plan),/renamed target/);assert.deepEqual(f.writes,[]);assert.equal(f.documents.has('A.md'),false);
});
test('held old-path capture is dropped and acknowledged new target can be captured independently',async t=>{
 const f=await fixture(t),gate=deferred();f.beforeRead=async()=>{f.beforeRead=null;await gate.promise;};const capture=f.recovery.capture('A.md',true);for(let i=0;i<3;i++)await tick();await f.rename('A.md','B.md');gate.resolve();assert.equal(await capture,'missing');await f.idle();assert.equal(await f.recovery.capture('B.md',true),'added');assert.equal(new api.RecoveryHistory(f.store).target('first').path,'B.md');assert.equal(f.store.snapshots.length,2);
});
test('known path reuse prevents old target history inheriting a new file; Copy/list entries retain originals',async t=>{
 const f=await fixture(t);await f.rename('A.md','B.md');await f.idle();const previous=f.files.get('B.md');f.files.delete('B.md');f.documents.delete('B.md');f.app.vault.trigger('delete',previous);await f.idle();const newFile=f.put('B.md','Different owner');f.app.vault.trigger('create',newFile);await f.idle();
 const original=(await f.recovery.entries()).find(entry=>entry.snapshot.id==='first');assert.equal(original.target.path,null);assert.equal(original.snapshot.content,'Original λ\r\n');await assert.rejects(f.recovery.prepareRestore('first'),/unresolved|separate/);assert.deepEqual(f.writes,[]);await f.recovery.capture('B.md',true);assert.ok(f.store.snapshots.some(item=>item.path==='B.md'&&item.content==='Different owner'));
});
test('failed lineage persistence leaves store exact, acknowledges move, fences fresh and held restores across re-enable',async t=>{
 const f=await fixture(t),plan=await f.recovery.prepareRestore('first'),original=structuredClone(f.store);f.failStore=true;await f.rename('A.md','B.md');await f.idle();assert.deepEqual(f.store,original);assert.equal(f.files.has('B.md'),true);assert.match(f.recovery.error,/History conflict/);await assert.rejects(f.recovery.restore(plan),/renamed target/);await assert.rejects(f.recovery.prepareRestore('first'),/write failed|update failed/);assert.equal((await f.recovery.entries())[0].target.path,null);await f.disable();await f.enable();await assert.rejects(f.recovery.prepareRestore('first'),/update failed/);assert.deepEqual(f.writes,[]);assert.deepEqual(f.store,original);
});
test('failed rename fences survive leaving for another root and returning, while independent roots remain usable',async t=>{
 const f=await fixture(t),original=structuredClone(f.store);f.failStore=true;await f.rename('A.md','B.md');await f.idle();await f.disable();
 f.app.vault.rootPath='vault-Other';f.failStore=false;f.store={version:1,snapshots:[snapshot('other','A.md','Independent root',Date.now())]};f.put('A.md','Independent saved file');await f.enable();assert.equal((await f.recovery.prepareRestore('other')).targetPath,'A.md');assert.equal((await f.recovery.entries())[0].target.path,'A.md');await f.disable();
 f.files.delete('A.md');f.documents.delete('A.md');f.app.vault.rootPath='vault-A';f.store=original;await f.enable();await assert.rejects(f.recovery.prepareRestore('first'),/update failed/);assert.equal((await f.recovery.entries())[0].target.path,null);assert.deepEqual(f.store,original);assert.deepEqual(f.writes,[]);
});
test('a later move after failed persistence keeps a visible last-known-target refusal rather than claiming a current path',async t=>{
 const f=await fixture(t);f.failStore=true;await f.rename('A.md','B.md');await f.idle();f.failStore=false;await f.rename('B.md','C.md');await f.idle();const entry=(await f.recovery.entries()).find(x=>x.snapshot.id==='first');assert.equal(entry.target.path,null);assert.equal(entry.target.lastPath,'B.md');assert.match(entry.target.reason,/last known failed target.*moved again/);assert.match(f.recovery.error,/last known targets are unresolved/);await assert.rejects(f.recovery.prepareRestore('first'),/update failed/);assert.equal(f.documents.has('A.md'),false);assert.equal(f.documents.has('C.md'),true);assert.deepEqual(f.writes,[]);
});
test('startup inventory materialization does not retire a persisted association, but later actual creation does',async t=>{
 const model=history(snapshot('first','A.md','original',Date.now()));model.rename('A.md','B.md',Date.now());const f=await fixture(t,{data:model.data,changing:true});const a=f.files.get('A.md');f.files.delete('A.md');a.path='B.md';f.files.set('B.md',a);const doc=f.documents.get('A.md');f.documents.delete('A.md');f.documents.set('B.md',{...doc,file:{path:'B.md'}});f.app.vault.trigger('create',a);f.app.changingVault=false;await new Promise(resolve=>setTimeout(resolve,270));await f.idle();assert.equal(new api.RecoveryHistory(f.store).target('first').path,'B.md');
 const fresh=f.put('B.md','new');f.app.vault.trigger('create',fresh);await f.idle();assert.equal(new api.RecoveryHistory(f.store).target('first').path,null);
});
test('external stored association changes invalidate held review without touching the file',async t=>{
 const f=await fixture(t);await f.rename('A.md','B.md');await f.idle();const plan=await f.recovery.prepareRestore('first'),model=new api.RecoveryHistory(f.store);model.rename('B.md','C.md',Date.now());f.store=model.data;await assert.rejects(f.recovery.restore(plan),/association changed/);assert.deepEqual(f.writes,[]);
});
test('readonly and unloaded direct methods refuse before history or source IO',async t=>{
 const f=await fixture(t);f.app.vault.readOnly=true;f.calls.length=0;for(const action of [()=>f.recovery.entries(),()=>f.recovery.capture('A.md'),()=>f.recovery.prepareRestore('first'),()=>f.recovery.compareSaved('first'),()=>f.recovery.restore({})])await assert.rejects(action(),/read-only/);assert.deepEqual(f.calls,[]);f.app.vault.readOnly=false;await f.disable();f.calls.length=0;await assert.rejects(f.recovery.prepareRestore('first'),/no longer active/);assert.deepEqual(f.calls,[]);
});
