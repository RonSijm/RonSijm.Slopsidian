import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join,relative,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";
import {root} from "./host.mjs";
let temporary,historyState,remember,position,WebViewerView;
before(async()=>{
 await mkdir(join(root,".runtime"),{recursive:true});temporary=await mkdtemp(join(root,".runtime","reader-progress-history-tests-"));const entry=join(temporary,"history.mjs");
 await build({stdin:{contents:'export * from "./client/web-reader-progress";export {WebViewerView} from "./client/web-viewer";',resolveDir:root},outfile:entry,bundle:true,format:"esm",platform:"node",external:["electron"],logLevel:"silent"});
 const module=await import(pathToFileURL(entry).href);({readerScrollHistoryState:historyState,rememberReaderScroll:remember,readerScrollFor:position,WebViewerView}=module);
});
after(async()=>{if(temporary){const path=relative(join(root,".runtime"),temporary);assert.ok(path&&!isAbsolute(path)&&!path.startsWith(".."));await rm(temporary,{recursive:true})}});
const first="https://example.com/story?one#part",second="https://example.com/story?two#part";
test("Reader history seeds legacy positions, keeps exact queries/fragments independent and returns detached opaque state",()=>{
 const legacy={url:first,progress:.4,future:{keep:[false,"中文"]}},saved=[{url:second,progress:.7,futureOther:{keep:true}}],copy=structuredClone({legacy,saved});
 const history=historyState(saved,legacy);assert.deepEqual(history,[...saved,legacy]);assert.deepEqual({legacy,saved},copy);
 history[1].future.keep.push(1);assert.deepEqual(legacy.future.keep,[false,"中文"]);assert.equal(position(history,first),.4);assert.equal(position(history,second),.7);assert.equal(position(history,"https://example.com/story?one#different"),0);
 assert.deepEqual(historyState(undefined,legacy),[legacy]);assert.deepEqual(historyState(null,null),[]);
});
test("Imported Reader history rejects oversized/duplicate/malformed state atomically instead of normalizing unsafe URLs or corrupt progress",()=>{
 const entry={url:first,progress:.4};
 for(const invalid of [{},true,"text",[null],[{}],[{url:first,progress:"0.4"}],[{url:first,progress:NaN}],[{url:first,progress:Infinity}],[{url:first,progress:-.1}],[{url:first,progress:1.1}],...["javascript:alert(1)","file:///secret","https://user:pass@example.com","https://example.com/\nwrong"].map(url=>[{url,progress:.4}]),[entry,entry],Array.from({length:21},(_,i)=>({url:"https://example.com/"+i,progress:.5}))])assert.throws(()=>historyState(invalid));
 assert.throws(()=>historyState([entry],{url:second,progress:"bad"}));assert.deepEqual(entry,{url:first,progress:.4});
});
test("Recording progress preserves entry metadata, promotes reused URLs and evicts only the oldest of twenty positions with no input mutation",()=>{
 const original=[{url:first,progress:0,future:{keep:["中文"]}}];let history=structuredClone(original);
 for(let i=0;i<20;i++)history=remember(history,{url:"https://example.com/"+i,progress:i===19?1:i/20});
 assert.equal(history.length,20);assert.equal(position(history,first),0);assert.equal(history[0].url,"https://example.com/0");
 const before=structuredClone(history);history=remember(history,{url:before[0].url,progress:.9});assert.equal(history.length,20);assert.equal(history.at(-1).url,before[0].url);assert.equal(history[0].url,before[1].url);assert.deepEqual(before,Array.from({length:20},(_,i)=>({url:"https://example.com/"+i,progress:i===19?1:i/20})));
 const retained=remember(original,{url:first,progress:1});assert.deepEqual(retained,[{...original[0],progress:1}]);retained[0].future.keep.push("detached");assert.deepEqual(original[0].future.keep,["中文"]);
});
test("Legacy last-position state wins conflicts without discarding unrelated historical or opaque fields",()=>{
 const history=[{url:first,progress:.1,old:{keep:true}},{url:second,progress:.8}];const legacy={url:first,progress:.6,newer:{keep:"中文"}};
 assert.deepEqual(historyState(history,legacy),[{url:second,progress:.8},{url:first,progress:.6,old:{keep:true},newer:{keep:"中文"}}]);
});
function viewFixture(){
 const calls=[],view=Object.create(WebViewerView.prototype);Object.assign(view,{app:{changingVault:false,vault:{rootPath:"D:\\one"},workspace:{layoutChanged:()=>calls.push("layout")}},provider:{options:{}},readerScroll:null,readerScrollHistory:[],reader:null,pendingReader:null,readerGeneration:0,progressSave:null,readerWarning:{},findResult:{},status:{},loading:false,disposed:false,frame:null,address:{value:""},url:first,title:""});
 view.updateReaderButton=view.scheduleBounds=()=>{};view.request=async(action,values)=>{calls.push({action,values});return {}};return{view,calls};
}
test("The actual Reader owner records multiple articles without cross-pane sharing, retains opaque fields and keeps durable debounce saves through navigation reset",async t=>{
 const {view,calls}=viewFixture(),other=viewFixture().view;t.after(()=>{view.cancelProgressSave();other.cancelProgressSave()});view.readerScroll={url:first,progress:.2,future:{keep:"中文"}};
 view.acceptReaderProgress(.4,first);view.acceptReaderProgress(.7,second);view.resetReader();assert.equal(position(view.readerScrollHistory,first),.4);assert.equal(position(view.readerScrollHistory,second),.7);assert.deepEqual(other.readerScrollHistory,[]);
 view.acceptReaderProgress(.6,first);assert.deepEqual(view.readerScroll.future,{keep:"中文"});assert.notEqual(view.progressSave,null);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(calls.filter(item=>item==="layout").length,1);
});
test("Owned navigation and Back/Forward/Reload await the final Reader snapshot; stale vault/disposed/generation completions cannot navigate or enqueue layout writes",async()=>{
 for(const action of ["navigate","back","forward","reload"]){
  const {view,calls}=viewFixture();let release;view.reader={flushProgress:()=>new Promise(resolve=>release=resolve)};
  const pending=action==="navigate"?view.navigate(second):view.action(action);await Promise.resolve();assert.deepEqual(calls,[]);release();await pending;assert.equal(calls[0].action,action);if(action==="navigate")assert.equal(calls[0].values.url,second);
 }
 for(const mutate of [view=>{view.app.changingVault=true},view=>{view.app.vault.rootPath="D:\\two"},view=>{view.disposed=true},view=>{view.readerGeneration++}]){
  const {view,calls}=viewFixture();let release;view.reader={flushProgress:()=>new Promise(resolve=>release=resolve)};const pending=view.navigate(second);await Promise.resolve();mutate(view);release();await pending;assert.deepEqual(calls,[]);
 }
});
