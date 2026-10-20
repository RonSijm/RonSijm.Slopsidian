import assert from 'node:assert/strict';
import {mkdir,cp,readFile,writeFile,open} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';

const root=process.cwd(),base=resolve('.runtime/core-reference-audit-'+Date.now());
const vault=join(base,'vault'),profile=join(base,'profile'),application=join(base,'app');
const reference=resolve('.runtime/obsidian-comparison-2026-10-26/reference-app');
const executable='D:/source/DecomTest/Reference/Obsidian-Recovered/node_modules/electron/dist/electron.exe';
const pluginIds=[];
const report={status:'running',base,host:'Obsidian 1.12.7 original reference resources; isolated vault/profile',pluginIds,checks:[],exceptions:[]};
await mkdir(base);await mkdir(profile);await mkdir(application);
await cp(resolve('Example'),vault,{recursive:true,filter:source=>{
  const path=relative(resolve('Example'),source).replaceAll('\\','/');
  if(path.startsWith('.obsidian/workspace')||path.startsWith('.obsidian/cache')||path==='.obsidian/plugins/recent-files-obsidian/data.json')return false;
  const id=path.match(/^\.obsidian\/plugins\/([^/]+)/)?.[1];
  return !id||pluginIds.includes(id);
}});
await writeFile(join(vault,'.obsidian/community-plugins.json'),'[]\n');
const probe=join(vault,'.obsidian/plugins/example-validation-probe');await mkdir(probe);
await writeFile(join(probe,'manifest.json'),JSON.stringify({id:'example-validation-probe',name:'Isolated example validator',version:'1.0.0',minAppVersion:'1.0.0',description:'Temporary local integration-test helper',author:'Example validator',isDesktopOnly:true}));
await writeFile(join(probe,'main.js'),'const obs=require("obsidian");module.exports=class extends obs.Plugin{onload(){this.obs=obs;}};');
await writeFile(join(profile,'obsidian.json'),JSON.stringify({vaults:{[randomBytes(8).toString('hex')]:{path:vault,ts:Date.now(),open:true}},updateDisabled:true}));
await writeFile(join(application,'package.json'),JSON.stringify({name:'obsidian',version:'1.12.7',main:'main.cjs'}));
const wrapper=await readFile(join(reference,'main.cjs'),'utf8');
await writeFile(join(application,'main.cjs'),wrapper
  .replace(/app\.setPath\('userData',[^;]+;/,`app.setPath('userData',${JSON.stringify(profile)});`)
  .replaceAll("path.join(__dirname,'resources'",`path.join(${JSON.stringify(reference)},'resources'`)
  .replace('window.setSize(1280,900)', '(()=>{window.webContents.setBackgroundThrottling(false);window.setSize(1280,900)})()')
  .replace("const {app,shell}=require('electron');", "const {app,shell,BrowserWindow}=require('electron');BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};"));
report.sourceHashes={};
for(const id of pluginIds)for(const file of ['main.js','manifest.json']){
  const key=`${id}/${file}`;report.sourceHashes[key]=createHash('sha256').update(await readFile(join(vault,'.obsidian/plugins',key))).digest('hex');
}
await writeFile('.runtime/core-reference-audit-path.txt',base);
const log=await open(join(base,'application.log'),'w');
const child=spawn(executable,[application,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--force-device-scale-factor=1'],{cwd:application,windowsHide:true,stdio:['ignore',log.fd,log.fd]});await log.close();
let socket,id=0;const pending=new Map();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(child.exitCode!==null)throw new Error('Reference exited '+child.exitCode+': '+await readFile(join(base,'application.log'),'utf8'));if(await fn())return;await pause(200);}throw new Error('Timed out: '+label);}
function send(method,params={}){const key=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout '+method));},20000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!result.exceptionDetails,result.exceptionDetails?.exception?.description??result.exceptionDetails?.text);return result.result.value;}
function record(label,value){report.checks.push({label,value});console.log(label+': '+JSON.stringify(value));}
try{
  await waitFor(async()=>{try{return !!(await readFile(join(profile,'DevToolsActivePort'),'utf8'));}catch{return false;}},'CDP endpoint');
  const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0];
  report.endpoint='http://127.0.0.1:'+port;
  let target;
  await waitFor(async()=>{const targets=await(await fetch(report.endpoint+'/json/list')).json();report.targets=targets.map(t=>({type:t.type,url:t.url}));target=targets.find(t=>t.type==='page'&&/^(file|app):/.test(t.url));return Boolean(target);},'reference application page');
  report.targetId=target.id;
  socket=new WebSocket(target.webSocketDebuggerUrl);
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(p){clearTimeout(p.timer);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown'){report.exceptions.push(message.params.exceptionDetails?.text);}else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error'){(report.consoleErrors??=[]).push(message.params.args.map(v=>v.value??v.description).join(' ').slice(0,1200));}};
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  await send('Runtime.enable');
  await waitFor(()=>evaluate('Boolean(globalThis.app?.vault?.getMarkdownFiles().length&&app.workspace.layoutReady)'),'vault ready');
  await evaluate('(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Trust author and enable plugins"));if(button)button.click();return true;})()');
  await waitFor(()=>evaluate('!Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Trust author and enable plugins"))'),'disposable vault trust dialog dismissed');
  await evaluate('app.plugins.loadManifests()');
  await evaluate('app.plugins.enablePluginAndSave("example-validation-probe")');
  for(const pluginId of pluginIds.filter(id=>id!=='obsidian-excalidraw-plugin')){await evaluate(`app.plugins.enablePluginAndSave(${JSON.stringify(pluginId)})`);}

const contract=JSON.parse(await readFile(resolve('shared/core-plugins.json'),'utf8'));
report.reference=await evaluate("({version:app.plugins.plugins['example-validation-probe'].obs.apiVersion,modules:Object.fromEntries(Object.entries(app.internalPlugins.plugins).map(([id,p])=>[id,{enabled:p.enabled,instance:Boolean(p.instance),data:p.instance?.options??p.instance?.data,prototype:p.instance?Object.getOwnPropertyNames(Object.getPrototypeOf(p.instance)):[]}]))})");
await writeFile(join(base,'inventory.json'),JSON.stringify(report.reference,null,2));
console.log(JSON.stringify({base,endpoint:report.endpoint,modules:Object.keys(report.reference.modules).length,version:report.reference.version}));
await new Promise(resolve=>setTimeout(resolve,1200000));
report.status='inventory-only';
}catch(error){report.status='failed';report.error=String(error.stack??error);console.error(report.error);process.exitCode=1;}finally{await writeFile(join(base,'report.json'),JSON.stringify(report,null,2));if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:999999,method:'Browser.close'}));socket.close()}await Promise.race([new Promise(r=>child.once('exit',r)),pause(2000)]);if(child.exitCode===null)child.kill();console.log(JSON.stringify({status:report.status,report:join(base,'report.json')}));}
