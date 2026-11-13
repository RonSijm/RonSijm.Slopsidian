import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
let directory,current,BrowserVault,Vault,FileManager,TFolder,parseMarkdown,reviewSelectedNoteTrash,trashSelectedNotes,ExplorerTrashModal;
before(async()=>{
 await mkdir(join(root,".runtime"),{recursive:true});directory=await mkdtemp(join(root,".runtime/explorer-removal-tests-"));
 const output=join(directory,"feature.mjs");
 await build({stdin:{contents:'export {BrowserVault} from "./client/browser-vault";export {Vault,TFolder} from "./client/vault";export {FileManager} from "./client/file-manager";export {parseMarkdown} from "./client/markdown";export {configureBrowserHost} from "./client/contracts";export {reviewSelectedNoteTrash,trashSelectedNotes} from "./client/explorer-trash";',resolveDir:root,loader:"ts"},outfile:output,bundle:true,platform:"node",format:"esm",packages:"external",logLevel:"silent"});
 const feature=await import(pathToFileURL(output).href);({BrowserVault,Vault,FileManager,TFolder,parseMarkdown,reviewSelectedNoteTrash,trashSelectedNotes}=feature);
 feature.configureBrowserHost({request:(...args)=>current.request(...args),chooseDirectory:async()=>null,getVaultChoices:()=>({})});
 const modalOutput=join(directory,"modal.mjs");
 await build({entryPoints:[join(root,"client/explorer-trash-modal.ts")],outfile:modalOutput,bundle:true,platform:"node",format:"esm",logLevel:"silent",plugins:[{name:"model-modal-shell",setup(plugin){plugin.onResolve({filter:/^\.\/ui$/},()=>({path:"ui",namespace:"model-shell"}));plugin.onLoad({filter:/.*/,namespace:"model-shell"},()=>({contents:'export class Modal { constructor(app){this.app=app;this.containerEl=new globalThis.RemovalElement("div");this.contentEl=new globalThis.RemovalElement("div");this.containerEl.append(this.contentEl);this.isOpen=true;}setTitle(title){this.title=title;return this;}close(){this.isOpen=false;this.containerEl.isConnected=false;this.onClose?.();}}',loader:"js"}));}}]});
 ({ExplorerTrashModal}=await import(pathToFileURL(modalOutput).href));
});
after(async()=>{delete globalThis.RemovalElement;delete globalThis.document;if(directory){assert.match(relative(root,directory).replaceAll("\\","/"),/^\.runtime\/explorer-removal-tests-[^/]+$/);await rm(directory,{recursive:true});}});

class Folder {
 kind="directory";children=new Map();constructor(name){this.name=name;}
 async isSameEntry(other){return this===other;}async queryPermission(){return"granted";}async requestPermission(){return"granted";}
 async*entries(){yield*this.children;}
 async getDirectoryHandle(name,options={}){return this.child(name,"directory",options.create);}async getFileHandle(name,options={}){return this.child(name,"file",options.create);}
 child(name,kind,create){let item=this.children.get(name);if(!item&&create){item=kind==="directory"?new Folder(name):new DiskFile(name);this.children.set(name,item);}if(!item)throw new DOMException("Missing "+name,"NotFoundError");if(item.kind!==kind)throw new DOMException("Wrong kind","TypeMismatchError");return item;}
 async removeEntry(name,options={}){const item=this.children.get(name);if(!item)throw new DOMException("Missing","NotFoundError");if(item.kind==="directory"&&item.children.size&&!options.recursive)throw new DOMException("Not empty","InvalidModificationError");this.children.delete(name);}
}
class DiskFile {
 kind="file";bytes=new Uint8Array();modified=1;constructor(name){this.name=name;}
 async isSameEntry(other){return this===other;}set(bytes){this.bytes=typeof bytes==="string"?new TextEncoder().encode(bytes):new Uint8Array(bytes);this.modified++;}
 async getFile(){return new File([this.bytes],this.name,{lastModified:this.modified});}
 async createWritable(){let bytes;return{write:async value=>{bytes=new Uint8Array(value);},close:async()=>this.set(bytes),abort:async()=>{}};}
}
const lookup=(folder,path)=>path.split("/").reduce((parent,name)=>parent?.children.get(name),folder)??null;
async function put(folder,path,bytes){const parts=path.split("/");for(const part of parts.slice(0,-1))folder=await folder.getDirectoryHandle(part,{create:true});const file=await folder.getFileHandle(parts.at(-1),{create:true});file.set(bytes);return file;}
const originals={"Notes/A λ.md":"\ufeff# Alpha\r\n\r\nExact 😀.\r\n","Notes/B.md":"\ufeff# Beta\r\n","Links.md":"\ufeff[[Notes/A λ]] [[Notes/B]] ![[kept.bin]]\r\n","kept.bin":new Uint8Array([0,255,13,10])};
const snapshot=folder=>{const values={};const visit=(parent,prefix)=>{for(const[name,item]of parent.children){if(item.kind==="directory")visit(item,prefix+name+"/");else values[prefix+name]=Buffer.from(item.bytes).toString("hex");}};visit(folder,"");return values;};
async function fixture(){
 const folder=new Folder("Removal fixture");for(const[path,bytes]of Object.entries(originals))await put(folder,path,bytes);
 const records=new Map(),host=new BrowserVault([], ["file-explorer"],{list:async()=>[...records.values()],put:async record=>records.set(record.id,record)});
 await host.initialize();const id=await host.select(folder);assert.equal((await host.request("/api/vault/open","POST",{path:id})).status,200);current=host;
 const app={changingVault:false,core:{busy:false,isEnabled:id=>id==="file-explorer"}},log={saved:0,stages:[],commits:[],rollbacks:[],events:[],mutations:[]};
 const vault=new Vault(async()=>{},{renameFile:(file,path)=>app.fileManager.renameFile(file,path,true),trashFile:(file,system)=>app.fileManager.trashFile(file,system),deleteFile:file=>app.fileManager.deleteFile(file),createFolder:path=>app.fileManager.createFolder(path)});app.vault=vault;vault.setSnapshot((await host.request("/api/vault")).value);
 for(const event of["delete","modify","create"])vault.on(event,file=>log.events.push([event,file.path]));
 let documents=[];
 const metadataCache={async refresh(){await vault.refresh();documents=[];for(const file of vault.getMarkdownFiles()){const document=await vault.readDocument(file.path);documents.push({document,text:document.content,cache:parseMarkdown(document.content)});}},getDocument:path=>documents.find(entry=>entry.document.file.path===path),getDocuments:()=>documents,getIssues:()=>[],pause:async()=>{},resume:()=>{},acceptFileMutation:(file,path,entry)=>log.mutations.push([file.path,path,entry])};
 const workspace={isChangingFiles:false,isChangingLayout:false,hasUnsavedChanges:false,sessions:new Map(),leaves:()=>[],getActiveFile:()=>null,trigger:()=>{},track:()=>{},withFileMutation:async action=>action(),stageFileTrash:async file=>{log.stages.push(file.path);if(workspace.refuse===file.path)throw Error("View refused to close");return{commit:()=>log.commits.push(file.path),rollback:async()=>log.rollbacks.push(file.path)};}};
 Object.assign(app,{workspace,metadataCache,notifyEditor:async()=>{},saveAll:async()=>{log.saved++;},metadataTypeManager:{accept:()=>{}}});app.fileManager=new FileManager(app);await metadataCache.refresh();
 const files=["Notes/A λ.md","Notes/B.md"].map(path=>vault.getFileByPath(path));
 return{app,vault,folder,host,files,workspace,log,metadataCache,review:(mode="vault",owner=()=>true)=>reviewSelectedNoteTrash(app,files,owner,mode)};
}

test("review defaults to vault trash independently of destructive global configuration, freezes the method and never saves",async()=>{
 const f=await fixture(),before=snapshot(f.folder);f.vault.getConfig=()=>"none";const plan=await f.review();assert.equal(plan.mode,"vault");assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.items)&&plan.items.every(Object.isFrozen));assert.deepEqual(snapshot(f.folder),before);assert.equal(f.log.saved,0);
 const result=await trashSelectedNotes(f.app,plan,()=>true);assert.equal(result.error,null);assert.equal(result.trashed.length,2);
 for(const item of plan.items)assert.equal(Buffer.from(lookup(f.folder,".trash/"+item.file.name).bytes).toString("utf8"),originals[item.path]);
});
test("unsupported or malformed removal methods refuse before reading versions or invoking a mutation",async()=>{
 const f=await fixture(),before=snapshot(f.folder);let reads=0;const info=f.vault.getFileInfo;f.vault.getFileInfo=async(...args)=>{reads++;return info.apply(f.vault,args);};
 for(const mode of["system","none","constructor",null,{},"PERMANENT"])await assert.rejects(f.review(mode),/unavailable/);
 assert.equal(reads,0);assert.equal(f.log.saved,0);assert.deepEqual(snapshot(f.folder),before);
});
test("permanent deletion requires a separate explicit acknowledgement and preserves all reviewed bytes without it",async()=>{
 const f=await fixture(),before=snapshot(f.folder),plan=await f.review("permanent");for(const acknowledgement of[undefined,false,1,"true"]){const result=await trashSelectedNotes(f.app,plan,()=>true,acknowledgement);assert.equal(result.trashed.length,0);assert.match(result.error,/Acknowledge/);assert.deepEqual(snapshot(f.folder),before);assert.equal(f.log.saved,0);}
});
test("acknowledged permanent removal reaches real BrowserVault checked handles without making trash copies or changing references",async()=>{
 const f=await fixture(),before=snapshot(f.folder),plan=await f.review("permanent"),result=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(result.error,null);assert.equal(result.trashed.length,2);
 assert.equal(lookup(f.folder,"Notes/A λ.md"),null);assert.equal(lookup(f.folder,"Notes/B.md"),null);assert.equal(lookup(f.folder,".trash"),null);assert.equal(snapshot(f.folder)["Links.md"],before["Links.md"]);assert.equal(snapshot(f.folder)["kept.bin"],before["kept.bin"]);assert.deepEqual(f.log.commits,["Notes/A λ.md","Notes/B.md"]);assert.equal(f.log.events.filter(([type])=>type==="delete").length,2);
});
test("reviewed permanent versions refuse unobserved and observed newer bytes before staging a view",async()=>{
 for(const observed of[false,true]){const f=await fixture(),plan=await f.review("permanent");await put(f.folder,f.files[0].path,"\ufeffNewer λ\r\n");if(observed)await f.metadataCache.refresh();const result=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(result.trashed.length,0);assert.match(result.error,/reviewed note changed/i);assert.equal(Buffer.from(lookup(f.folder,f.files[0].path).bytes).toString("utf8"),"\ufeffNewer λ\r\n");assert.deepEqual(f.log.stages,[]);assert.ok(lookup(f.folder,f.files[1].path));}
});
test("view-close refusal and a newly dirty workspace keep original files and roll back staged owners",async()=>{
 for(const phase of["refuse","dirty","owner"]){const f=await fixture(),before=snapshot(f.folder),plan=await f.review("permanent");let owner=true;const stage=f.workspace.stageFileTrash;if(phase==="refuse")f.workspace.refuse=f.files[0].path;else f.workspace.stageFileTrash=async file=>{const result=await stage(file);if(phase==="dirty")f.workspace.hasUnsavedChanges=true;else owner=false;return result;};const result=await trashSelectedNotes(f.app,plan,()=>owner,true);assert.equal(result.trashed.length,0);assert.ok(result.error);assert.deepEqual(snapshot(f.folder),before);assert.deepEqual(f.log.commits,[]);assert.deepEqual(f.log.rollbacks,phase==="refuse"?[]:[f.files[0].path]);}
});
test("replacement after view staging reaches the backend version guard and preserves newer bytes",async()=>{
 const f=await fixture(),plan=await f.review("permanent"),stage=f.workspace.stageFileTrash;f.workspace.stageFileTrash=async file=>{const result=await stage(file);await put(f.folder,file.path,"After staging Ω\r\n");return result;};const result=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(result.trashed.length,0);assert.ok(result.error);assert.equal(Buffer.from(lookup(f.folder,f.files[0].path).bytes).toString("utf8"),"After staging Ω\r\n");assert.deepEqual(f.log.rollbacks,[f.files[0].path]);
});
test("later permanent-removal failure retains only acknowledged progress and an old plan cannot replay",async()=>{
 const f=await fixture(),plan=await f.review("permanent");f.workspace.refuse=f.files[1].path;const result=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(result.trashed.length,1);assert.equal(result.remaining[0].path,f.files[1].path);assert.match(result.error,/View refused/);assert.equal(lookup(f.folder,f.files[0].path),null);assert.ok(lookup(f.folder,f.files[1].path));assert.equal(lookup(f.folder,".trash"),null);
 await put(f.folder,f.files[0].path,"A newer replacement\r\n");await f.metadataCache.refresh();const replay=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(replay.trashed.length,0);assert.equal(Buffer.from(lookup(f.folder,f.files[0].path).bytes).toString("utf8"),"A newer replacement\r\n");
});
test("lost permanent-removal acknowledgement never counts absence as a successful requested deletion",async()=>{
 const f=await fixture(),plan=await f.review("permanent"),remove=f.vault.deleteFile.bind(f.vault);f.vault.deleteFile=async(...args)=>{await remove(...args);throw Error("Lost acknowledgement");};const result=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(result.trashed.length,0);assert.match(result.error,/could not be confirmed/);assert.equal(lookup(f.folder,f.files[0].path),null);assert.ok(lookup(f.folder,f.files[1].path));assert.deepEqual(f.log.commits,[f.files[0].path]);
});
test("cleanup failure after permanent acknowledgement reports that removal and keeps remaining files",async()=>{
 const f=await fixture(),plan=await f.review("permanent");f.app.notifyEditor=async()=>{throw Error("Cleanup refused");};const result=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(result.trashed.length,1);assert.match(result.error,/Cleanup refused/);assert.ok(lookup(f.folder,f.files[1].path));
});
test("system-trash capability is rechecked and the dispatch flag uses the reviewed mode, with no real OS mutation",async()=>{
 const f=await fixture();let capable=true;Object.defineProperty(f.vault,"supportsSystemTrash",{get:()=>capable});const plan=await f.review("system"),before=snapshot(f.folder);capable=false;const refused=await trashSelectedNotes(f.app,plan,()=>true);assert.equal(refused.trashed.length,0);assert.deepEqual(snapshot(f.folder),before);assert.equal(f.log.saved,0);
 capable=true;const calls=[];f.app.fileManager.trashFile=async(file,system,review)=>{assert.equal(review.guard(),true);calls.push([file.path,system,review.version]);await lookup(f.folder,dirname(file.path).replaceAll("\\","/")).removeEntry(file.name);f.vault.setSnapshot((await f.host.request("/api/vault")).value);review.removed();};const result=await trashSelectedNotes(f.app,plan,()=>true);assert.equal(result.error,null);assert.equal(calls.length,2);assert.ok(calls.every(([,system])=>system===true));
});
test("read-only, root/layout/core changes, lost owner and dirty sessions refuse every reviewed removal method",async()=>{
 for(const change of[f=>Object.defineProperty(f.vault,"readOnly",{value:true}),f=>{f.app.changingVault=true;},f=>{f.workspace.isChangingLayout=true;},f=>{f.app.core.busy=true;},f=>{f.workspace.sessions.set(f.files[0].path,{dirty:true});}]){const f=await fixture(),before=snapshot(f.folder),plan=await f.review("permanent");change(f);const result=await trashSelectedNotes(f.app,plan,()=>true,true);assert.equal(result.trashed.length,0);assert.ok(result.error);assert.deepEqual(snapshot(f.folder),before);assert.equal(f.log.saved,0);}
 const f=await fixture(),plan=await f.review("permanent"),result=await trashSelectedNotes(f.app,plan,()=>false,true);assert.equal(result.trashed.length,0);assert.equal(f.log.saved,0);
});
test("reviewed deleteFile explicitly refuses folders rather than entering an unreviewed recursive operation",async()=>{
 const f=await fixture(),folder=f.vault.getFolderByPath("Notes"),before=snapshot(f.folder);assert.ok(folder instanceof TFolder);await assert.rejects(f.app.fileManager.deleteFile(folder,{guard:()=>true,version:"forged"}),/cannot remove folders/);assert.deepEqual(snapshot(f.folder),before);
});

class RemovalElement {
 dataset={};style={};children=[];listeners=new Map();isConnected=true;disabled=false;checked=false;hidden=false;value="";textContent="";
 constructor(tag){this.tagName=tag.toUpperCase();}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=[...children];}setAttribute(name,value){this[name]=value;}addEventListener(name,action){const actions=this.listeners.get(name)??[];actions.push(action);this.listeners.set(name,actions);}emit(name){for(const action of this.listeners.get(name)??[])action({preventDefault(){}});}find(key){if(Object.hasOwn(this.dataset,key))return this;for(const child of this.children){const found=child?.find?.(key);if(found)return found;}return null;}
}
const settle=async(predicate=()=>true)=>{const deadline=Date.now()+3000;do{await new Promise(resolve=>setTimeout(resolve,1));if(predicate())return;}while(Date.now()<deadline);assert.fail("Removal modal did not settle before its deadline");};
function modal(f){globalThis.RemovalElement=RemovalElement;globalThis.document={createElement:tag=>new RemovalElement(tag),createTextNode:text=>text};let owned=true;const messages=[];const view=new ExplorerTrashModal(f.app,f.files,()=>owned,message=>messages.push(message));return{view,get:key=>view.containerEl.find("explorerTrash"+key),messages,retire:()=>{owned=false;}};}
test("actual removal modal keeps vault trash default, invalidates method changes and requires a separate permanent acknowledgement",async()=>{
 const f=await fixture(),m=modal(f),before=snapshot(f.folder);assert.equal(m.get("Mode").value,"vault");assert.equal(m.get("Mode").children.some(option=>option.value==="system"),false);m.get("Review").emit("click");await settle(()=>!m.get("Review").disabled);assert.equal(m.get("Confirm").disabled,false);assert.equal(m.get("Preview").children[0].textContent,f.files[0].path+" → .trash");assert.deepEqual(snapshot(f.folder),before);
 m.get("Mode").value="permanent";m.get("Mode").emit("change");assert.equal(m.get("Confirm").disabled,true);assert.equal(m.get("Preview").children.length,0);assert.equal(m.get("Acknowledge").checked,false);m.get("Review").emit("click");await settle(()=>!m.get("Review").disabled);assert.equal(m.get("Confirm").disabled,true);assert.equal(m.get("Preview").children[0].textContent,f.files[0].path+" → permanent deletion");assert.match(m.get("Confirm").textContent,/Delete notes permanently/);assert.deepEqual(snapshot(f.folder),before);
 assert.match(m.get("Status").textContent,/Acknowledge permanent deletion/);
 m.get("Acknowledge").checked=true;m.get("Acknowledge").emit("change");assert.equal(m.get("Confirm").disabled,false);assert.doesNotMatch(m.get("Status").textContent,/Acknowledge permanent deletion/);m.get("Acknowledge").checked=false;m.get("Acknowledge").emit("change");assert.equal(m.get("Confirm").disabled,true);assert.match(m.get("Status").textContent,/Acknowledge permanent deletion/);
 m.get("Acknowledge").checked=true;m.get("Acknowledge").emit("change");
 const form=m.view.contentEl.children[0];form.emit("submit");await settle(()=>m.messages.length>0&&!m.view.busy);assert.equal(m.view.isOpen,false);assert.equal(m.messages[0],"Confirmed 2 of 2 notes permanently deleted.");assert.equal(lookup(f.folder,".trash"),null);
});
test("modal cancellation is mutation-free and held asynchronous reviews cannot enable a changed method",async()=>{
 const f=await fixture(),m=modal(f),before=snapshot(f.folder),info=f.vault.getFileInfo.bind(f.vault);let release;const gate=new Promise(resolve=>release=resolve);f.vault.getFileInfo=async file=>{await gate;return info(file);};m.get("Review").emit("click");m.get("Mode").value="permanent";m.get("Mode").emit("change");release();await settle();assert.equal(m.get("Confirm").disabled,true);assert.equal(m.get("Preview").children.length,0);assert.deepEqual(snapshot(f.folder),before);m.get("Cancel").emit("click");assert.equal(m.view.isOpen,false);assert.deepEqual(snapshot(f.folder),before);
});
test("modal refuses a programmatically changed mode or unchecked acknowledgement at submit without dispatch",async()=>{
 for(const change of[m=>{m.get("Mode").value="vault";},m=>{m.get("Acknowledge").checked=false;}]){const f=await fixture(),m=modal(f),before=snapshot(f.folder);m.get("Mode").value="permanent";m.get("Mode").emit("change");m.get("Review").emit("click");await settle(()=>!m.get("Review").disabled);m.get("Acknowledge").checked=true;m.get("Acknowledge").emit("change");assert.equal(m.get("Confirm").disabled,false);change(m);m.view.contentEl.children[0].emit("submit");await settle();assert.equal(m.get("Confirm").disabled,true);assert.deepEqual(snapshot(f.folder),before);assert.equal(f.log.saved,0);m.view.dispose();}
});
