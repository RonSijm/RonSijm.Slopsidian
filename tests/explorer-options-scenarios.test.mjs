import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {Script,createContext} from 'node:vm';
import {parser} from '@lezer/javascript';
import {explorerOptionsStateExpression,openExplorerOptions,explorerOwnHit} from '../tools/explorer-options-scenarios.mjs';

const modules=['file-explorer','file-selection','explorer-move','explorer-rename','explorer-trash','explorer-removal-choices','explorer-drop','crosspane-drop','bulk-system-trash','trash-recovery'];
const expressionCounts=[89,99,91,84,59,73,70,94,73,84];
const selector='[data-file-explorer="actual-files"]';
function page(open=false) {
 const trace=[],saved=Object.freeze({content:'\ufeff---\r\ntitle: Exact λ\r\n---\r\n# Dirty source\r\n',version:'exact-version',hasBom:true}),history=Object.freeze({past:Object.freeze(['prior']),future:Object.freeze([])});
 let roots,keyboardSteps=2,blocked=false,afterInput=()=>{};
 const document={activeElement:null,querySelectorAll:value=>value===selector?roots:[]};
 const root={dataset:{fileExplorer:'actual-files'},isConnected:true,ownerDocument:document,children:[],closest:value=>value==='[inert]'?null:root,querySelector:value=>value==='[data-explorer-sort]'?sort:null};
 const details={open,isConnected:true,children:[],matches:value=>value==='details[data-explorer-options]',closest:value=>value==='[data-file-explorer]'?root:null};
 const summary={tagName:'SUMMARY',textContent:'More file options',parentElement:details,isConnected:true,checkVisibility:()=>true};
 const sort={disabled:false};root.children.push(details);details.children.push(summary);roots=[root];
 const view={contentEl:root,containerEl:{ownerDocument:document,isConnected:true},sourceRoot:'Exact root',isLoaded:true,getViewType:()=>'file-explorer'};
 const app={workspace:{getLeafById:id=>id==='actual-files'?{view}:null},vault:{rootPath:'Exact root',readDocument(){throw Error('Disclosure navigation must not read saved notes')},modify(){throw Error('Disclosure navigation must not write notes')}},saved,history};
 const context=createContext({document,app}),evaluate=expression=>JSON.parse(JSON.stringify(new Script(expression).runInContext(context)));
 const tools={report:{checks:[]},async evaluate(expression){trace.push('evaluate');return evaluate(expression)},async wait(expression){trace.push('wait');assert.equal(evaluate(expression),true,'Native disclosure must actually be open with a current owner')},async click(value){trace.push(['click',value]);assert.equal(value,selector+' > details[data-explorer-options] > summary');if(!blocked){document.activeElement=summary;details.open=!details.open}afterInput()},async press(key,code,number,modifiers=0){trace.push(['key',key,code,number,modifiers]);if(key==='Tab'){assert.equal(modifiers,8);if(--keyboardSteps<=0)document.activeElement=summary}else{assert.equal(key,'Enter');assert.equal(document.activeElement,summary);if(!blocked)details.open=!details.open}afterInput()}};
 return{tools,trace,document,root,details,summary,sort,view,app,saved,history,evaluate,setRoots:value=>{roots=value},setKeyboardSteps:value=>{keyboardSteps=value},setBlocked:value=>{blocked=value},afterInput:fn=>{afterInput=fn}};
}

test('Explorer disclosure expressions compile safely for arbitrary selectors and report the actual native state',()=>{
 for(const value of[selector,'[data-file-explorer="quotes \\" λ"]','one\nline','backtick ` ${literal}','\u0000'])assert.doesNotThrow(()=>new Script(explorerOptionsStateExpression(value)));
 for(const open of[false,true]){const f=page(open),state=f.evaluate(explorerOptionsStateExpression(selector));assert.equal(state.ready,true);assert.equal(state.open,open);assert.equal(state.id,'actual-files');assert.equal(state.summaryFocused,false);assert.equal(state.sortEnabled,true);assert.equal(state.label,'More file options')}
});
test('Closed disclosure opens through exactly one trusted summary click; an already open disclosure needs no input or source/history changes',async()=>{
 for(const open of[false,true]){const f=page(open),receipt=await openExplorerOptions(f.tools,selector);assert.equal(receipt.input,'pointer');assert.equal(receipt.alreadyOpen,open);assert.equal(receipt.after.open,true);assert.equal(receipt.tabs,0);assert.equal(f.trace.filter(value=>Array.isArray(value)&&value[0]==='click').length,open?0:1);assert.equal(f.trace.filter(value=>Array.isArray(value)&&value[0]==='key').length,0);assert.equal(f.tools.report.explorerOptionsInteractions.length,1);assert.deepEqual(f.tools.report.checks,[]);assert.equal(f.app.saved,f.saved);assert.equal(f.app.history,f.history)}
});
test('Native keyboard mode reaches the real summary with bounded reverse-Tab and activates Enter without a pointer or programmatic focus',async()=>{
 const f=page(),receipt=await openExplorerOptions(f.tools,selector,{input:'keyboard'});assert.equal(receipt.tabs,2);assert.equal(receipt.after.open,true);assert.equal(f.trace.some(value=>Array.isArray(value)&&value[0]==='click'),false);assert.deepEqual(f.trace.filter(Array.isArray),[['key','Tab','Tab',9,8],['key','Tab','Tab',9,8],['key','Enter','Enter',13,0]]);assert.equal(f.app.saved,f.saved);assert.equal(f.app.history,f.history);
 const already=page(true);await openExplorerOptions(already.tools,selector,{input:'keyboard'});assert.equal(already.trace.some(Array.isArray),false);
});
test('Missing, ambiguous, foreign, disabled, hidden, inert and retired controls cannot cause the helper to deliver input',async()=>{
 const faults={missing:f=>f.setRoots([]),duplicate:f=>f.setRoots([f.root,f.root]),missingDetails:f=>{f.root.children=[]},duplicateDetails:f=>f.root.children.push(f.details),missingSummary:f=>{f.details.children=[]},duplicateSummary:f=>f.details.children.push(f.summary),wrongLabel:f=>{f.summary.textContent='Other options'},hidden:f=>{f.summary.checkVisibility=()=>false},inert:f=>{f.root.closest=()=>({})},disabledSort:f=>{f.sort.disabled=true},oldRoot:f=>{f.view.sourceRoot='Other root'},oldView:f=>{f.view.contentEl={}},unloaded:f=>{f.view.isLoaded=false},wrongView:f=>{f.view.getViewType=undefined},detached:f=>{f.view.containerEl.isConnected=false},foreignDocument:f=>{f.root.ownerDocument={}}};
 for(const[kind,mutate]of Object.entries(faults)){const f=page();mutate(f);assert.equal(f.evaluate(explorerOptionsStateExpression(selector)).ready,false,kind);await assert.rejects(openExplorerOptions(f.tools,selector),undefined,kind);assert.equal(f.trace.some(Array.isArray),false,kind);assert.equal(f.details.open,false,kind)}
});
test('A refused native click, retired owner after input or unreachable keyboard summary never produces a successful receipt',async()=>{
 for(const kind of['blocked','retired','keyboard']){const f=page();if(kind==='blocked')f.setBlocked(true);if(kind==='retired')f.afterInput(()=>{f.view.sourceRoot='Replacement root'});if(kind==='keyboard')f.setKeyboardSteps(Infinity);await assert.rejects(openExplorerOptions(f.tools,selector,{input:kind==='keyboard'?'keyboard':'pointer'}));assert.equal(f.tools.report.explorerOptionsInteractions,undefined);if(kind==='keyboard'){assert.equal(f.trace.filter(value=>Array.isArray(value)&&value[1]==='Tab').length,32);assert.equal(f.trace.some(value=>Array.isArray(value)&&value[1]==='Enter'),false);assert.equal(f.details.open,false)}assert.equal(f.app.saved,f.saved);assert.equal(f.app.history,f.history)}
});
test('Exact disabled-button reachability accepts its icon/label descendants and rejects unrelated overlays or missing hits',()=>{
 class Node{constructor(parent=null){this.parent=parent}contains(hit){for(let value=hit;value;value=value.parent)if(value===this)return true;return false}}
 const button=new Node(),label=new Node(button),svg=new Node(button),path=new Node(svg),other=new Node(),foreignChild=new Node(other);
 for(const hit of[button,label,svg,path]){assert.equal(explorerOwnHit(button,hit),true);assert.equal(new Script('('+explorerOwnHit.toString()+')(button,hit)').runInNewContext({button,hit}),true)}
 for(const hit of[null,undefined,other,foreignChild])assert.equal(explorerOwnHit(button,hit),false);assert.equal(explorerOwnHit(null,label),false);
});

function scriptsIn(source,filename){
 const tree=parser.parse(source),definitions=new Map(),expressions=[],deferred=[],errors=[],text=node=>source.slice(node.from,node.to);
 tree.iterate({enter(ref){const node=ref.node;if(node.type.isError)errors.push({at:node.from,source:text(node)});if(node.name==='VariableDeclaration')for(let child=node.firstChild;child;child=child.nextSibling)if(child.name==='VariableDefinition'&&child.nextSibling?.name==='Equals'&&child.nextSibling.nextSibling)definitions.set(text(child),child.nextSibling.nextSibling)}});
 assert.deepEqual(errors,[],filename+' module syntax');
 function witness(node){const value=text(node);if(value==='explorerOwnHit.toString()')return explorerOwnHit.toString();if(/^(?:q|JSON\.stringify)\(/.test(value))return '"expression-fixture"';if(/^selected\(/.test(value))return '[]';if(/^live\(/.test(value))return 'true';return '0'}
 function literal(node,seen=new Set()){
  if(node.name==='String')return new Script(text(node)).runInNewContext();
  if(node.name==='TemplateString'){let at=node.from+1,result='';const decode=value=>new Script('`'+value+'`').runInNewContext();for(let child=node.firstChild;child;child=child.nextSibling)if(child.name==='Interpolation'){result+=decode(source.slice(at,child.from))+witness(child.firstChild.nextSibling);at=child.to}return result+decode(source.slice(at,node.to-1))}
  if(node.name==='VariableName'&&definitions.has(text(node))&&!seen.has(text(node))){seen.add(text(node));return literal(definitions.get(text(node)),seen)}
  if(node.name==='CallExpression'&&node.firstChild.name==='VariableName'&&definitions.has(text(node.firstChild))){const value=definitions.get(text(node.firstChild));if(value.name==='ArrowFunction'&&value.lastChild.name!=='Block')return literal(value.lastChild,seen)}
  return null;
 }
 tree.iterate({enter(ref){const node=ref.node;if(node.name==='CallExpression'&&/^(?:evaluate|wait|tools\.evaluate|tools\.wait)$/.test(text(node.firstChild))){const arg=node.getChild('ArgList')?.firstChild?.nextSibling;if(!arg||arg.name===')')return;const expression=literal(arg),line=source.slice(0,node.from).split('\n').length;if(expression===null)deferred.push({line,argument:text(arg)});else expressions.push({line,expression})}}});
 return{expressions,deferred};
}
test('All adapted scenario modules and every generated literal/template evaluate/wait script compile independently',async()=>{
 const receipt=[];for(const[index,name]of modules.entries()){const filename=name+'-scenarios.mjs',source=await readFile(new URL('../tools/'+filename,import.meta.url),'utf8'),result=scriptsIn(source,filename),errors=[];for(const{line,expression}of result.expressions)try{new Script(expression,{filename:filename+':'+line})}catch(error){errors.push({line,message:error.message,expression})}assert.deepEqual(errors,[],filename);assert.deepEqual(result.deferred,[],filename+' has no uninspected generated script');assert.equal(result.expressions.length,expressionCounts[index],filename+' complete script coverage');receipt.push({module:filename,compiled:result.expressions.length})}console.log('Explorer expression compilation: '+JSON.stringify(receipt));
});
