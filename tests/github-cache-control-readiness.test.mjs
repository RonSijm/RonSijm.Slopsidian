import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Test the production controls and their real modal composition without starting
// an application, renderer, server or browser. Only Modal's host shell is inert.
const modalStub = `export const cacheReadinessTestModals=[];export class Modal{constructor(){this.containerEl=document.createElement('div');this.modalEl=document.createElement('div');this.contentEl=document.createElement('div');this.containerEl.append(this.modalEl);this.modalEl.append(this.contentEl);cacheReadinessTestModals.push(this)}setTitle(text){this.title=text}open(){this.isOpen=true;this.onOpen?.()}close(){this.isOpen=false;this.onClose?.();this.containerEl.remove()}}`;
const productionRoot=process.env.SLOPSIDIAN_CACHE_READINESS_BASELINE??fileURLToPath(new URL('../',import.meta.url));
const bundle = await build({ stdin: { contents: 'export {GitHubOfflineControls} from "./plugins/github-vault/offline-controls";export {GitHubIndexControls} from "./client/github-index-ui";export {installGitHubOffline} from "./client/github-offline-ui";export {cacheReadinessTestModals} from "./client/ui";', resolveDir: productionRoot, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'cache-readiness-modal-shell', setup(builder) { builder.onResolve({filter:/^\.\/(?:client\/)?ui$/},()=>({path:'modal',namespace:'cache-readiness-modal-shell'}));builder.onLoad({filter:/.*/,namespace:'cache-readiness-modal-shell'},()=>({contents:modalStub,loader:'js'})); } }] });
const {GitHubOfflineControls,GitHubIndexControls,installGitHubOffline,cacheReadinessTestModals} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const priorDocument = globalThis.document;
after(()=>{if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;});
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<8;index++)await Promise.resolve();};

function fakeDocument(){
  const document={events:[],onEnable:null,buttons:new Map(),createElement(tag){return new Element(tag,this);},getElementById(id){return this.buttons.get(id)??null;}};
  class Element{
    constructor(tag,owner){this.tagName=tag.toUpperCase();this.ownerDocument=owner;this.children=[];this.dataset={};this.attributes={};this.listeners=new Map();this.isConnected=true;this.hidden=false;this.text='';this.disabledValue=false;}
    set textContent(text){this.text=String(text);this.children=[];this.ownerDocument.events.push({kind:'text',node:this,text:this.text});}get textContent(){return this.text+this.children.map(child=>child.textContent??'').join('');}
    set disabled(value){this.disabledValue=Boolean(value);this.ownerDocument.events.push({kind:'disabled',node:this,value:this.disabledValue});if(!this.disabledValue)this.ownerDocument.onEnable?.(this);}get disabled(){return this.disabledValue;}
    setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}
    fire(type){for(const listener of this.listeners.get(type)??[])listener({target:this,preventDefault(){}});}
    focus(){this.ownerDocument.activeElement=this;}remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
  }
  return document;
}
const all=node=>[node,...node.children.flatMap(all)],find=(node,key)=>all(node).find(item=>Object.hasOwn(item.dataset,key));
const mount={id:'cached:test',repository:'owner/repo',ref:'main',folder:'',commit:'c'.repeat(40),savedAt:1,files:[{path:'A.md',repositoryPath:'A.md',sha:'a'.repeat(40),size:5},{path:'B.md',repositoryPath:'B.md',sha:'b'.repeat(40),size:5}],configurationFiles:[{path:'.obsidian/app.json',repositoryPath:'.obsidian/app.json',sha:'d'.repeat(40),size:4}]};
const cached={totalFiles:3,cachedFiles:3,totalBytes:14,cachedBytes:14,oversizedFiles:0};
const idle={state:'none',done:0,total:2,missing:[],corrupt:[],message:'Only notes you open are indexed.',resumable:false};
const complete={...idle,state:'complete',done:2,message:'All 2 notes are verified and indexed.'};
function fixture({wire=false}={}){
  const document=globalThis.document=fakeDocument(),container=document.createElement('div'),cacheRead=deferred(),indexRead=deferred(),prepare=deferred(),calls={cache:0,indexStatus:0,prepare:0,cancel:0,activity:0},signals=[];
  let status=idle,progress=null;
  const reader={offlineStatus(_mount,signal){calls.cache++;signals.push(signal);return cacheRead.promise;}},host={reader,offlineSource:()=>({mount,cacheOnly:true}),indexStatus(){calls.indexStatus++;return calls.indexStatus===1?indexRead.promise:Promise.resolve(status);},prepareIndex(callback){calls.prepare++;progress=callback;return prepare.promise;},cancelIndex(){calls.cancel++;},onSourceChange(callback){this.changed=callback;}};
  let offline,index,modal;
  if(wire){const button=document.createElement('button');document.buttons.set('github-vault-offline',button);const app={changingVault:false,commands:{addCommand(command){this.command=command;}},registerLeaveGuard(guard){this.guard=guard;}};installGitHubOffline(app,host,()=>calls.activity++);button.fire('click');modal=cacheReadinessTestModals.at(-1);container.append(modal.containerEl);}
  else{offline=new GitHubOfflineControls(container,reader,mount,true,()=>calls.activity++);index=new GitHubIndexControls(container,host,()=>calls.activity++,offline.initialStatusSettled);}
  const root=modal?.contentEl??container;
  return{document,container,root,offline,index,modal,reader,host,cacheRead,indexRead,prepare,calls,signals,button:find(root,'githubIndexPrepare'),indexSection:all(root).find(node=>node.className==='github-index-controls'),offlineSection:all(root).find(node=>node.className==='github-offline-controls'),offlineCounts:find(root,'githubOfflineCounts'),offlineStatus:find(root,'githubOfflineStatus'),indexStatus:find(root,'githubIndexStatus'),cancel:find(root,'githubIndexCancel'),setStatus:value=>{status=value;},progress:value=>progress?.(value)};
}

test('index-first initialization cannot advertise NONE or enable Prepare before the upper cache counts/status settle',async()=>{
  const f=fixture();assert.equal(f.calls.cache,1);assert.equal(f.calls.indexStatus,1);assert.equal(f.button.disabled,true);assert.equal(f.indexSection.attributes['aria-busy'],'true');
  f.indexRead.resolve(idle);await flush();assert.equal(f.indexSection.dataset.githubIndexState,undefined);assert.equal(f.button.disabled,true);assert.equal(f.offlineCounts.textContent,'');
  const witnessed=[];f.document.onEnable=node=>{if(node===f.button)witnessed.push({counts:f.offlineCounts.textContent,status:f.offlineStatus.textContent,offline:f.offlineSection.dataset.githubOfflineState,index:f.indexSection.dataset.githubIndexState});};
  f.cacheRead.resolve(cached);await f.offline.initialStatusSettled;await flush();
  assert.deepEqual(witnessed,[{counts:'3 of 3 files · 14 B of 14 B',status:'All files in this snapshot are available offline. Reopen this vault with “Use cached snapshot only”.',offline:'complete',index:'none'}]);assert.equal(f.button.disabled,false);assert.equal(f.indexSection.attributes['aria-busy'],undefined);assert.equal(f.calls.prepare,0);
});
test('offline-first initialization still waits for the independent current index status before publishing an actionable state',async()=>{
  const f=fixture();f.cacheRead.resolve(cached);await f.offline.initialStatusSettled;await flush();assert.equal(f.offlineSection.dataset.githubOfflineState,'complete');assert.equal(f.indexSection.dataset.githubIndexState,undefined);assert.equal(f.button.disabled,true);
  f.indexRead.resolve(idle);await flush();assert.equal(f.button.disabled,false);assert.equal(f.indexSection.dataset.githubIndexState,'none');assert.equal(f.calls.prepare,0);
});
test('a completed index read cannot expose Prepare while the upper cache counts are still pending',async()=>{
  const f=fixture({wire:true});f.indexRead.resolve(idle);await flush();assert.equal(f.offlineCounts.textContent,'');assert.equal(f.offlineSection.dataset.githubOfflineState,'checking');assert.equal(f.button.disabled,true);assert.equal(f.indexSection.dataset.githubIndexState,undefined);f.cacheRead.resolve(cached);await flush();assert.equal(f.offlineCounts.textContent,'3 of 3 files · 14 B of 14 B');assert.equal(f.button.disabled,false);f.modal.close();
});
test('the real Offline dialog wiring supplies the upper readiness barrier in both completion orders',async()=>{
  for(const first of ['index','offline']){const f=fixture({wire:true});assert.equal(f.modal.isOpen,true);assert.equal(f.button.disabled,true);if(first==='index')f.indexRead.resolve(idle);else f.cacheRead.resolve(cached);await flush();assert.equal(f.button.disabled,true);assert.equal(f.indexSection.dataset.githubIndexState,undefined);if(first==='index')f.cacheRead.resolve(cached);else f.indexRead.resolve(idle);await flush();assert.equal(f.button.disabled,false);assert.equal(f.offlineSection.dataset.githubOfflineState,'complete');assert.equal(f.indexSection.dataset.githubIndexState,'none');f.modal.close();}
});
test('forced early click and retained start handlers cannot bypass the independent readiness guard',async()=>{
  const f=fixture();f.button.disabled=false;f.button.fire('click');await f.index.start();assert.equal(f.calls.prepare,0);f.indexRead.resolve(idle);await flush();f.button.disabled=false;await f.index.start();assert.equal(f.calls.prepare,0);f.cacheRead.resolve(cached);await flush();assert.equal(f.button.disabled,false);assert.equal(f.calls.prepare,0);
});
test('closing the real dialog while either read is pending prevents late state publication or index preparation',async()=>{
  for(const first of ['index','offline']){const f=fixture({wire:true});if(first==='index')f.indexRead.resolve(idle);else f.cacheRead.resolve(cached);await flush();f.modal.close();assert.equal(f.signals[0].aborted,first==='index');assert.equal(f.button.disabled,true);const before={status:f.indexStatus.textContent,state:f.indexSection.dataset.githubIndexState,counts:f.offlineCounts.textContent,offline:f.offlineStatus.textContent};f.indexRead.resolve(idle);f.cacheRead.resolve(cached);await flush();assert.deepEqual({status:f.indexStatus.textContent,state:f.indexSection.dataset.githubIndexState,counts:f.offlineCounts.textContent,offline:f.offlineStatus.textContent},before);f.button.disabled=false;f.button.fire('click');await flush();assert.equal(f.calls.prepare,0);assert.equal(f.modal.isOpen,false);}
});
test('disposed standalone controls refuse retained handlers and keep both completion callbacks inert',async()=>{
  const f=fixture();f.offline.dispose();f.index.dispose();const before=f.document.events.length;f.indexRead.resolve(idle);f.cacheRead.resolve(cached);await flush();assert.equal(f.document.events.length,before);f.button.disabled=false;await f.index.start();assert.equal(f.calls.prepare,0);assert.equal(f.calls.activity,0);
});
test('an upper cache-status failure settles after its visible error before allowing an explicit local-cache index attempt',async()=>{
  const f=fixture();f.indexRead.resolve(idle);await flush();f.cacheRead.reject(new Error('Cache verification unavailable'));await f.offline.initialStatusSettled;await flush();assert.equal(f.offlineSection.dataset.githubOfflineState,'error');assert.equal(f.offlineStatus.textContent,'Cache verification unavailable');assert.equal(f.button.disabled,false);assert.equal(f.indexSection.dataset.githubIndexState,'none');assert.equal(f.calls.prepare,0);
});
test('an initial index-status failure is visible and cannot be bypassed by a forced retained handler',async()=>{
  const f=fixture();f.indexRead.reject(new Error('Index status cache read failed'));f.cacheRead.resolve(cached);await flush();assert.equal(f.indexSection.dataset.githubIndexState,'refused');assert.equal(f.indexStatus.textContent,'Index status cache read failed');assert.equal(f.button.disabled,true);f.button.disabled=false;await f.index.start();assert.equal(f.calls.prepare,0);
});
test('an unexpectedly rejected readiness barrier or absent mount fails conservatively without an unhandled rejection',async()=>{
  for(const reason of ['barrier','mount']){const document=globalThis.document=fakeDocument(),root=document.createElement('div'),gate=deferred();let prepared=0;const index=new GitHubIndexControls(root,{indexStatus:async()=>reason==='mount'?null:idle,prepareIndex:async()=>{prepared++;}},()=>{},gate.promise);if(reason==='barrier')gate.reject(new Error('Upper status failed'));else gate.resolve();await flush();const button=find(root,'githubIndexPrepare');assert.equal(button.disabled,true);assert.equal(all(root).find(node=>node.className==='github-index-controls').dataset.githubIndexState,'refused');button.disabled=false;await index.start();assert.equal(prepared,0);}
});
test('ready controls preserve explicit Prepare, progress, duplicate refusal, cancellation and final complete-index behavior',async()=>{
  const f=fixture();f.indexRead.resolve(idle);f.cacheRead.resolve(cached);await flush();f.button.fire('click');assert.equal(f.calls.prepare,1);assert.equal(f.indexSection.dataset.githubIndexState,'running');assert.equal(f.button.disabled,true);assert.equal(f.cancel.hidden,false);await f.index.start();assert.equal(f.calls.prepare,1);f.progress({done:1,total:2,path:'A.md'});assert.equal(f.indexStatus.textContent,'Verifying 1 of 2 notes…');f.cancel.fire('click');assert.equal(f.calls.cancel,1);assert.equal(f.cancel.disabled,true);f.setStatus(complete);f.prepare.resolve(complete);await flush();assert.equal(f.indexSection.dataset.githubIndexState,'complete');assert.equal(f.button.disabled,true);assert.equal(f.cancel.hidden,true);assert.equal(f.indexStatus.textContent,'2 of 2 notes. All 2 notes are verified and indexed.');assert.equal(f.calls.activity,2);await f.index.start();assert.equal(f.calls.prepare,1);
});
test('an already complete initial index stays non-actionable after the cache readiness barrier settles',async()=>{
  const f=fixture();f.indexRead.resolve(complete);f.cacheRead.resolve(cached);await flush();assert.equal(f.indexSection.dataset.githubIndexState,'complete');assert.equal(f.button.disabled,true);await f.index.start();assert.equal(f.calls.prepare,0);
});
test('Check cached files still recovers a visible offline error after the initial settled barrier',async()=>{
  const f=fixture();f.indexRead.resolve(idle);f.cacheRead.reject(new Error('Temporary offline read failure'));await f.offline.initialStatusSettled;await flush();assert.equal(f.offlineSection.dataset.githubOfflineState,'error');const check=all(f.root).find(node=>node.tagName==='BUTTON'&&node.textContent==='Check cached files');assert.equal(check.disabled,false);f.reader.offlineStatus=async()=>{f.calls.cache++;return cached;};check.fire('click');await flush();assert.equal(f.offlineSection.dataset.githubOfflineState,'complete');assert.equal(f.offlineCounts.textContent,'3 of 3 files · 14 B of 14 B');assert.equal(f.button.disabled,false);assert.equal(f.calls.cache,2);assert.equal(f.calls.prepare,0);
});
test('reopening a failed initial index review creates fresh checks without enabling the retired controls',async()=>{
  const f=fixture({wire:true});f.indexRead.reject(new Error('Temporary index status failure'));f.cacheRead.resolve(cached);await flush();assert.equal(f.button.disabled,true);assert.equal(f.indexSection.dataset.githubIndexState,'refused');f.modal.close();f.document.buttons.get('github-vault-offline').fire('click');const reopened=cacheReadinessTestModals.at(-1),button=find(reopened.contentEl,'githubIndexPrepare');assert.notEqual(reopened,f.modal);assert.equal(button.disabled,true);await flush();assert.equal(button.disabled,false);assert.equal(find(reopened.contentEl,'githubIndexStatus').textContent,'0 of 2 notes. Only notes you open are indexed.');assert.equal(f.button.disabled,true);assert.equal(f.calls.cache,2);assert.equal(f.calls.indexStatus,2);assert.equal(f.calls.prepare,0);reopened.close();
});
