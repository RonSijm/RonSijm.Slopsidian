import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {build} from 'esbuild';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createContext,runInContext} from 'node:vm';
import {EditorState, StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history, historyField, isolateHistory, undo, redo, undoDepth, redoDepth} from '@codemirror/commands';
import {errorLogStub} from './error-log-stub.mjs';
import {installMentionBulkDom, deferred} from './outgoing-mention-bulk-fixture.mjs';
import {revealCachedBasesInlineWithWheel,basesEmbedAuthoringReadOnlyFixture} from '../tools/bases-embed-authoring-scenarios.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)); let directory, api;
before(async () => {
  await mkdir(join(root, '.runtime'), {recursive:true}); directory = await mkdtemp(join(root, '.runtime', 'bases-embed-authoring-tests-'));
  const output=join(directory,'feature.mjs');
  await build({stdin:{contents:'export * from "./client/bases-embed-authoring";export * from "./client/bases-embed-authoring-modal";export {BaseEmbed} from "./client/base-embed";export {BaseDocument,queryBase} from "./client/bases-model";export {MarkdownView} from "./client/workspace";export {Editor} from "./client/editor";export {TFile} from "./client/vault";export {Events} from "./client/events";export {parseMarkdown} from "./client/markdown";export {Modal,Notice} from "./client/ui";',resolveDir:root},outfile:output,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent',plugins:[errorLogStub]});
  api=await import(pathToFileURL(output).href);
});
after(async()=>{if(directory){assert.match(relative(root,directory).replaceAll('\\','/'),/^\.runtime\/bases-embed-authoring-tests-[^/]+$/);await rm(directory,{recursive:true});}});
const original='\ufeff---\r\n# retain comment λ\r\nstatus: "open" # retain status comment\r\namount: -0\r\nchecked: false\r\ntags: [ "old", "keep" ] # list comment\r\nopaque: &keep {big: 9007199254740993, decimal: 0.123456789012345678901}\r\ncopy: *keep\r\n---\r\n# Exact target 😀\r\n\r\nUnrelated saved body.\r\n';
const value=source=>api.parseMarkdown(source).frontmatter;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('the real source planner changes one scalar token and preserves all unrelated BOM/CRLF/YAML/body bytes',()=>{
 const plan=api.planEmbeddedPropertyEdit(original,'status','open','closed λ');
 assert.equal(plan.source,original.replace('"open"','"closed λ"'));assert.equal(plan.source,original.slice(0,plan.from)+plan.insert+original.slice(plan.to));
 assert.equal(value(plan.source).status,'closed λ');assert.ok(plan.source.includes('9007199254740993, decimal: 0.123456789012345678901'));assert.ok(plan.source.endsWith('Unrelated saved body.\r\n'));
});
test('top-level booleans, safe numbers, dates, multiline text and string lists retain non-target tokens',()=>{
 for(const [key,prior,next]of[['checked',false,true],['amount',-0,42],['status','open','2026-11-20'],['status','open','line 1\nline 2'],['tags',['old','keep'],['new','λ']]]){
  const plan=api.planEmbeddedPropertyEdit(original,key,prior,next);assert.deepEqual(value(plan.source)[key],next);assert.equal(plan.source.slice(0,plan.from),original.slice(0,plan.from));assert.equal(plan.source.slice(plan.from+plan.insert.length),original.slice(plan.to));assert.ok(plan.source.includes('copy: *keep'));
 }
});
test('missing keys and absent frontmatter are added without rewriting existing pairs or a BOM',()=>{
 const plan=api.planEmbeddedPropertyEdit(original,'new λ',undefined,'001');assert.equal(value(plan.source)['new λ'],'001');assert.ok(plan.source.startsWith(original.slice(0,original.indexOf('---\r\n# Exact'))));
 const source='\ufeff# Header\r\nExact body.\r\n',added=api.planEmbeddedPropertyEdit(source,'status',undefined,'open');assert.equal(added.source.charCodeAt(0),0xFEFF);assert.ok(added.source.endsWith('# Header\r\nExact body.\r\n'));assert.equal(value(added.source).status,'open');
});
test('unchanged source and negative zero do not create a replacement or normalize source spelling',()=>{
 for(const [key,prior]of[['status','open'],['amount',-0],['tags',['old','keep']]])assert.deepEqual(api.planEmbeddedPropertyEdit(original,key,prior,prior),{source:original,from:0,to:0,insert:''});
});
test('scalar/list conversions and block string-list values preserve the other pairs and exact edited-value bounds',()=>{
 assert.equal(api.planEmbeddedPropertyEdit(original,'status','open',['one','λ']).source,original.replace('"open"','["one","λ"]'));
 const source='---\r\ntags:\r\n  - old\r\n  - keep\r\nopaque: { x: 9007199254740993 } # keep\r\n---\r\n# Body\r\n';
 for(const next of[['new','λ'],'text',true]){const plan=api.planEmbeddedPropertyEdit(source,'tags',['old','keep'],next);assert.deepEqual(value(plan.source).tags,next);assert.equal(plan.source.slice(0,plan.from),source.slice(0,plan.from));assert.equal(plan.source.slice(plan.from+plan.insert.length),source.slice(plan.to));assert.ok(plan.source.includes('opaque: { x: 9007199254740993 } # keep'));}
});
test('source planner refuses unsafe values, implicit null, aliases/tags, bad YAML and changed prior values',()=>{
 for(const next of [Infinity,9007199254740992,{nested:true},['a\nb'],'bad\u0000'])assert.throws(()=>api.planEmbeddedPropertyEdit(original,'status','open',next));
 assert.throws(()=>api.planEmbeddedPropertyEdit(original,'status','other','closed'));
 assert.throws(()=>api.planEmbeddedPropertyEdit('---\nstatus:\n---\n','status',null,'closed'),/implicit-empty/);
 assert.throws(()=>api.planEmbeddedPropertyEdit('---\na: &s open\nstatus: *s\n---\n','status','open','closed'),/aliased|aliases/);
 assert.throws(()=>api.planEmbeddedPropertyEdit('---\nstatus: !!str open\n---\n','status','open','closed'),/tagged/);
 assert.throws(()=>api.planEmbeddedPropertyEdit('---\nstatus: open\nstatus: closed\n---\n','status','closed','x'));
 assert.throws(()=>api.planEmbeddedPropertyEdit('x'.repeat(api.MAX_BASE_PROPERTY_SOURCE+1),'status',undefined,'open'),/262,144/);
});

function fixture({live=true,reading=false,sameGroup=false,dirty=false,parentDirty=false}={}){
 const calls={reads:[],allocations:0,docks:0,writes:0,saves:0,updates:0,physical:0},state={owned:true,visible:true,base:true,enabled:true,assigned:null,registry:{},root:'embedded-vault'},disk=new Map(),files=new Map(),documents=new Map(),leaves=[],watchers=new Set(),sessions=new Map();let f;
 const app={changingVault:false,vault:Object.assign(new api.Events(),{rootPath:state.root,readOnly:false,getFileByPath:path=>files.get(path)??null,getAbstractFileByPath:path=>files.get(path)??null,getConfig:()=>undefined,async readDocument(path){calls.reads.push(path);await f.beforeRead?.(path,calls.reads.length);return structuredClone(disk.get(path));},async writeDocument(){calls.writes++;throw Error('No save is part of embedded Apply');}}),core:Object.assign(new api.Events(),{busy:false,isEnabled:()=>state.enabled}),workspace:Object.assign(new api.Events(),{sessions,isChangingFiles:false,isChangingLayout:false,getLeavesOfType:()=>leaves,getLeaf(){throw Error('Never allocate a hidden leaf');},setActiveLeaf(leaf){this.activeLeaf=leaf;},dockLeaf(leaf){calls.docks++;leaf.parent={docked:true};},createLeafBySplit(){calls.allocations++;const leaf={id:'new-source-'+calls.allocations,parent:{},async setViewState(request){await f.beforeOpen?.();makeView(target,leaf,false);app.workspace.activeLeaf=leaf;app.workspace.trigger('file-open',target);await f.afterOpen?.(leaf);}};return leaf;}}),configuration:{get:()=>state.registry,watch(id,callback){const witness={id,callback};watchers.add(witness);return()=>watchers.delete(witness);}},metadataTypeManager:Object.assign(new api.Events(),{getAssignedWidget:()=>state.assigned}),metadataCache:Object.assign(new api.Events(),{getDocument:path=>documents.get(path)??null,updateOpenDocuments(){calls.updates++;for(const [path,session]of sessions){const current=documents.get(path);documents.set(path,{...current,document:session.document,text:session.text,cache:api.parseMarkdown(session.text)});}}})};
 const add=(path,content)=>{const file=new api.TFile(app.vault,{path,basename:path.split('/').at(-1).replace(/\.md$/i,''),extension:'md',stat:{size:content.length,mtime:1,ctime:1}});files.set(path,file);const saved={file:{path},content,version:'version:'+path,hasBom:content.startsWith('\ufeff')};disk.set(path,saved);documents.set(path,{document:saved,text:content,cache:api.parseMarkdown(content),missing:false});return file;};
 const parent=add('Parent.md','# Embedded dashboard\r\n\r\n![[Catalog.base]]\r\n'),target=add('Target.md',original),host={isConnected:true,checkVisibility:()=>state.visible};
 function makeView(file,leaf,isParent){
  const saved=disk.get(file.path),editor=Object.create(api.Editor.prototype),cm={dom:{isConnected:true},composing:false,state:EditorState.create({doc:saved.content,extensions:[history(),EditorView.editable.of(true),EditorState.lineSeparator.of('\r\n')]})};
  const session=sessions.get(file.path)??{originRoot:app.vault.rootPath,document:saved,text:saved.content,dirty:false,isSaving:false,isReloading:false,async save(){calls.saves++;throw Error('Dirty Source must not be saved by this action');}};sessions.set(file.path,session);
  let mode=isParent?'preview':reading?'preview':'source';
  cm.dispatch=spec=>{const tx=spec.startState?spec:cm.state.update(spec);cm.state=tx.state;session.text=editor.getValue();session.dirty=session.text!==saved.content;documents.set(file.path,{...documents.get(file.path),text:session.text,cache:api.parseMarkdown(session.text)});};editor.cm=cm;
  const view=Object.assign(Object.create(api.MarkdownView.prototype),{file,editor,session,leaf,containerEl:{contains:node=>isParent&&node===host},sourceEl:{checkVisibility:()=>mode==='source'&&state.visible},getEditingMode:()=>mode,getMode:()=>mode==='preview'?'preview':'source',setEditingMode:next=>{mode=next;}});Object.defineProperty(view,'isLoaded',{value:true,writable:true});leaf.view=view;leaves.push(leaf);
  if(isParent?parentDirty:dirty){cm.dispatch({changes:{from:cm.state.doc.length,insert:'Earlier dirty prose Ω.\r\n'},annotations:isolateHistory.of('full'),userEvent:'input.type'});}
  return view;
 }
 const parentLeaf={id:'parent',parent:{}},parentView=makeView(parent,parentLeaf,true),targetLeaf={id:'target',parent:sameGroup?parentLeaf.parent:{}},targetView=live?makeView(target,targetLeaf,false):null;
 const owner={app,host,sourcePath:parent.path,current:()=>state.owned,async physical(){calls.physical++;await f.beforeBase?.();return state.base;}};
 f={app,calls,state,disk,files,documents,leaves,watchers,owner,parent,parentView,parentLeaf,target,targetView,targetLeaf,host,
  review:(key='status')=>api.embeddedPropertyReview(owner,target.path,key),
  dirtyTarget(){targetView.editor.cm.dispatch({changes:{from:targetView.editor.cm.state.doc.length,insert:'Later change.\r\n'},annotations:isolateHistory.of('full')});},
  changePhysical(path,content=disk.get(path).content){disk.set(path,{...disk.get(path),content,version:disk.get(path).version+':changed'});},
  changeRegistry(registry){state.registry=registry;for(const witness of watchers)witness.callback({});}
 };return f;
}

test('cached review captures real parent/target owners without reads, allocation or writes; forged and self targets refuse',()=>{
 const f=fixture({dirty:true,parentDirty:true}),review=f.review();assert.ok(review);assert.equal(Object.isFrozen(review),true);assert.deepEqual(f.calls.reads,[]);assert.equal(f.calls.allocations,0);assert.equal(f.calls.saves,0);assert.equal(api.embeddedPropertyCurrent({...review}),false);assert.equal(api.embeddedPropertyReview(f.owner,f.parent.path,'status'),null);
});
test('actual cached authority refuses edited scalar aliases, tags and implicit null before any read or Source allocation',()=>{
 for(const text of ['---\r\nstatus:\r\n---\r\n','---\r\nother: &shared open\r\nstatus: *shared\r\n---\r\n','---\r\nstatus: !!str open\r\n---\r\n','---\r\nstatus: &owned open\r\n---\r\n']){
  const f=fixture(),cm=f.targetView.editor.cm;cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:text}});assert.equal(f.review(),null);assert.deepEqual(f.calls.reads,[]);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);assert.equal(f.calls.saves,0);
 }
});
test('actual cached authority refuses unsupported missing-key root flow insertions while existing flow scalar edits remain valid',()=>{
 for(const body of['{}','{status: open}']){
  const f=fixture(),cm=f.targetView.editor.cm;cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'---\r\n'+body+'\r\n---\r\n# Body\r\n'}});assert.equal(f.review('missing λ'),null);assert.deepEqual(f.calls.reads,[]);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);
 }
 const source='---\r\n{status: open}\r\n---\r\n# Body\r\n';assert.equal(api.planEmbeddedPropertyEdit(source,'status','open','closed').source,source.replace('status: open','status: "closed"'));
});
test('closed target explicitly opens normal Source in a split while parent text/history and disk remain unchanged',async()=>{
 const f=fixture({live:false,parentDirty:true}),review=f.review(),parent=f.parentView.editor.cm.state.doc,parentText=f.parentView.session.text,depth=undoDepth(f.parentView.editor.cm.state);assert.ok(review);assert.equal(api.embeddedPropertyHasSource(review),false);
 await api.showEmbeddedPropertySource(review);assert.equal(f.calls.allocations,1);assert.equal(f.calls.docks,0);assert.equal(api.embeddedPropertyHasSource(review),true);assert.equal(f.parentView.editor.cm.state.doc,parent);assert.equal(f.parentView.session.text,parentText);assert.equal(undoDepth(f.parentView.editor.cm.state),depth);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);
 const source=f.leaves.find(leaf=>leaf.view.file===f.target).view;await api.applyEmbeddedProperty(review,'text','closed');assert.equal(source.session.text,original.replace('"open"','"closed"'));assert.equal(f.disk.get(f.target.path).content,original);undo(source.editor.cm);assert.equal(source.editor.getValue(),original);assert.equal(f.parentView.editor.cm.state.doc,parent);
});
test('dirty Reading target is docked and revealed without replacing its editor/session/history, then Apply is one isolated Undo',async()=>{
 const f=fixture({dirty:true,parentDirty:true,reading:true,sameGroup:true}),review=f.review(),view=f.targetView,editor=view.editor,cm=editor.cm,doc=cm.state.doc,saved=view.session.document,before=view.session.text,depth=undoDepth(cm.state);
 await api.showEmbeddedPropertySource(review);assert.equal(f.calls.docks,1);assert.equal(f.calls.allocations,0);assert.equal(view.getEditingMode(),'source');assert.equal(view.editor,editor);assert.equal(cm.state.doc,doc);assert.equal(view.session.document,saved);assert.equal(view.session.text,before);
 await api.applyEmbeddedProperty(review,'text','closed λ');assert.equal(view.session.text,before.replace('"open"','"closed λ"'));assert.equal(undoDepth(cm.state),depth+1);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);undo(cm);assert.equal(view.session.text,before);redo(cm);assert.equal(view.session.text,before.replace('"open"','"closed λ"'));undo(cm);undo(cm);assert.equal(view.session.text,original);
});
test('all ordinary typed drafts use the installed parser and explicit Source; an unchanged list/negative zero makes no Undo entry',async()=>{
 for(const [key,type,text,checked,expected]of[['amount','number','12.5',false,12.5],['checked','checkbox','',true,true],['status','date','2026-11-20',false,'2026-11-20'],['status','datetime','2026-11-20T12:34',false,'2026-11-20T12:34'],['tags','tags','new\nλ',false,['new','λ']],['tags','aliases','new\nλ',false,['new','λ']],['tags','multitext','new\nλ',false,['new','λ']]]){
  const f=fixture(),review=f.review(key);await api.showEmbeddedPropertySource(review);await api.applyEmbeddedProperty(review,type,text,checked);assert.deepEqual(value(f.targetView.session.text)[key],expected);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);
 }
 for(const [key,type,text]of[['tags','multitext','old\nkeep'],['amount','number','-0']]){const f=fixture(),review=f.review(key);await api.showEmbeddedPropertySource(review);const doc=f.targetView.editor.cm.state.doc,depth=undoDepth(f.targetView.editor.cm.state);const result=await api.applyEmbeddedProperty(review,type,text,false);assert.equal(result.changed,false);assert.equal(f.targetView.editor.cm.state.doc,doc);assert.equal(undoDepth(f.targetView.editor.cm.state),depth);}
});
test('a missing ordinary property can be reviewed and inserted through Source with one Undo; imprecise numeric source refuses cached authoring',async()=>{
 const f=fixture(),review=f.review('new λ');assert.ok(review);await api.showEmbeddedPropertySource(review);await api.applyEmbeddedProperty(review,'text','001');assert.equal(value(f.targetView.session.text)['new λ'],'001');undo(f.targetView.editor.cm);assert.equal(f.targetView.editor.getValue(),original);assert.equal(f.calls.saves,0);
 const bad=fixture(),cm=bad.targetView.editor.cm;cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:original.replace('amount: -0','amount: 0.123456789012345678901')}});assert.equal(bad.review('amount'),null);assert.deepEqual(bad.calls.reads,[]);assert.equal(bad.calls.allocations,0);
});
test('Cancel before and after Source never applies a property and keeps an explicitly opened Source',async()=>{
 const closed=fixture({live:false}),before=closed.review();api.cancelEmbeddedPropertyReview(before);await assert.rejects(api.showEmbeddedPropertySource(before));assert.deepEqual(closed.calls.reads,[]);assert.equal(closed.calls.allocations,0);
 const f=fixture({live:false}),review=f.review();await api.showEmbeddedPropertySource(review);api.cancelEmbeddedPropertyReview(review);await assert.rejects(api.applyEmbeddedProperty(review,'text','closed'));assert.equal(f.leaves.length,2);assert.equal(f.disk.get(f.target.path).content,original);assert.equal(f.calls.saves,0);
});
test('read-only and every stale cached authority refuse before IO or Source allocation',async()=>{
 for(const mutation of [f=>f.app.vault.readOnly=true,f=>f.state.owned=false,f=>f.state.visible=false,f=>f.host.isConnected=false,f=>f.app.changingVault=true,f=>f.app.core.busy=true,f=>f.state.enabled=false,f=>f.app.workspace.isChangingFiles=true,f=>f.app.workspace.isChangingLayout=true]){
  const f=fixture({live:false}),review=f.review();mutation(f);assert.equal(f.review(),null);await assert.rejects(api.showEmbeddedPropertySource(review));assert.deepEqual(f.calls.reads,[]);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);
 }
});
test('changed parent, target, types, provider, render, root and dirty Source owners cannot revive after a held read',async()=>{
 const mutations=[f=>f.state.owned=false,f=>f.app.vault.rootPath='other',f=>f.state.assigned='number',f=>f.state.registry={status:'text'},f=>f.parentView.editor.cm.dispatch({changes:{from:0,insert:'x'}}),f=>f.dirtyTarget(),f=>f.targetView.editor.cm.composing=true,f=>f.targetView.session.isSaving=true,f=>f.target.path='Renamed.md',f=>f.state.base=false];
 for(const mutation of mutations){const f=fixture({dirty:true,parentDirty:true}),review=f.review(),held=deferred();f.beforeRead=async(path,count)=>{if(count===1)await held.promise;};const action=api.showEmbeddedPropertySource(review);await tick();mutation(f);held.resolve();await assert.rejects(action);assert.equal(f.calls.writes,0);assert.equal(f.calls.saves,0);assert.equal(f.calls.allocations,0);}
});
test('BOM-only/same-value physical target, base and parent changes refuse without editing a dirty target',async()=>{
 for(const changedPath of ['Target.md','Parent.md','base']){
  const f=fixture({dirty:true,parentDirty:true}),review=f.review();await api.showEmbeddedPropertySource(review);const doc=f.targetView.editor.cm.state.doc;
  if(changedPath==='base')f.state.base=false;else f.changePhysical(changedPath);
  await assert.rejects(api.applyEmbeddedProperty(review,'text','closed'));assert.equal(f.targetView.editor.cm.state.doc,doc);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);
 }
});
test('held Source and Apply reads cannot rewrite issued target/parent saved witnesses by mutating the same live document object',async()=>{
 for(const phase of['Source','Apply'])for(const owner of['target','parent'])for(const field of['version','content','hasBom']){
  const f=fixture({dirty:true,parentDirty:true}),review=f.review();assert.ok(Object.isFrozen(review.witness));assert.ok(Object.isFrozen(review.parent.witness));
  if(phase==='Apply')await api.showEmbeddedPropertySource(review);
  const held=deferred();f.beforeRead=async()=>held.promise;const doc=f.targetView.editor.cm.state.doc,depth=undoDepth(f.targetView.editor.cm.state);
  const action=phase==='Apply'?api.applyEmbeddedProperty(review,'text','closed'):api.showEmbeddedPropertySource(review);await tick();
  const saved=owner==='target'?f.targetView.session.document:f.parentView.session.document;
  assert.equal(saved,owner==='target'?review.saved:review.parent.saved);
  if(field==='hasBom')saved.hasBom=!saved.hasBom;else if(field==='content')saved.content+='Mutated saved witness.\r\n';else saved.version+=':in-place';
  assert.equal(api.embeddedPropertyCurrent(review),false);held.resolve();await assert.rejects(action);assert.equal(f.targetView.editor.cm.state.doc,doc);assert.equal(undoDepth(f.targetView.editor.cm.state),depth);assert.equal(f.calls.saves,0);assert.equal(f.calls.writes,0);assert.equal(f.calls.allocations,0);
 }
});
test('late retained Apply and changed/readonly/composing Source refuse, while transaction filters cannot silently accept a partial edit',async()=>{
 for(const mutation of [f=>f.state.owned=false,f=>f.app.vault.readOnly=true,f=>f.targetView.setEditingMode('preview'),f=>f.targetView.editor.cm.composing=true]){
  const f=fixture(),review=f.review();await api.showEmbeddedPropertySource(review);const doc=f.targetView.editor.cm.state.doc;mutation(f);await assert.rejects(api.applyEmbeddedProperty(review,'text','closed'));assert.equal(f.targetView.editor.cm.state.doc,doc);assert.equal(f.calls.saves,0);
 }
 const f=fixture(),review=f.review();await api.showEmbeddedPropertySource(review);const cm=f.targetView.editor.cm;cm.state=cm.state.update({effects:StateEffect.appendConfig.of(EditorState.transactionFilter.of(tx=>tx.docChanged?[]:tx))}).state;
 // A different CM document configuration may keep the doc identity; the actual
 // transaction method still proves the full exact result and Undo annotation.
 await assert.rejects(api.applyEmbeddedProperty(review,'text','closed'),/accept every expected/);assert.equal(f.targetView.editor.getValue(),original);assert.equal(f.calls.saves,0);
});

test('actual modal constructor/controller keeps Apply disabled until explicit Source, and Cancel retains the typed draft without writes',async()=>{
 const dom=installMentionBulkDom(),previousOpen=api.Modal.prototype.open,previousClose=api.Modal.prototype.close;
 api.Modal.prototype.open=function(){this.containerEl.root=true;this.opened=true;this.onOpen();};api.Modal.prototype.close=function(){this.opened=false;this.onClose();this.containerEl.root=false;};
 try{
  const f=fixture({dirty:true,parentDirty:true}),review=f.review();let closed=0;const modal=new api.EmbeddedPropertyModal(f.app,review,()=>closed++);modal.open();
  const find=name=>modal.contentEl.querySelector('[data-bases-embed-property-'+name+'="true"]');
  assert.equal(find('apply').disabled,true);assert.equal(find('source').disabled,false);find('value').value='closed λ';await find('value').fire('input');assert.ok(find('preview').textContent.includes('closed λ'));
  await find('source').fire('click');await modal.settled;assert.equal(find('apply').disabled,false);assert.equal(f.targetView.session.text,review.text);assert.equal(f.calls.saves,0);
  await find('cancel').fire('click');assert.equal(closed,1);assert.equal(f.targetView.getEditingMode(),'source');assert.equal(f.targetView.session.text,review.text);assert.equal(f.watchers.size,0);assert.equal(f.calls.writes,0);
 }finally{api.Modal.prototype.open=previousOpen;api.Modal.prototype.close=previousClose;dom.restore();}
});
test('the actual modal reports a committed property honestly after late metadata failure, refuses another Apply and retains Undo',async()=>{
 const dom=installMentionBulkDom(),previousOpen=api.Modal.prototype.open,previousClose=api.Modal.prototype.close;
 api.Modal.prototype.open=function(){this.containerEl.root=true;this.opened=true;this.onOpen();};api.Modal.prototype.close=function(){this.opened=false;this.onClose();this.containerEl.root=false;};
 try{
  const f=fixture({dirty:true}),review=f.review(),before=f.targetView.session.text,modal=new api.EmbeddedPropertyModal(f.app,review,()=>{});modal.open();const find=name=>modal.contentEl.querySelector('[data-bases-embed-property-'+name+'="true"]');
  find('value').value='closed λ';await find('value').fire('input');await find('source').fire('click');await modal.settled;f.app.metadataCache.updateOpenDocuments=()=>{throw Error('Synthetic late metadata failure');};await find('apply').fire('click');await modal.settled;
  assert.equal(f.targetView.session.text,before.replace('"open"','"closed λ"'));assert.equal(api.embeddedPropertyOutcome(review).changed,true);assert.ok(find('status').textContent.includes('property was applied'));assert.ok(find('status').textContent.includes('Synthetic late metadata failure'));assert.equal(find('status').textContent.includes('no property was applied'),false);assert.equal(find('apply').disabled,true);
  const reads=f.calls.reads.length;await find('apply').fire('click');await modal.settled;assert.equal(f.calls.reads.length,reads);undo(f.targetView.editor.cm);assert.equal(f.targetView.session.text,before);assert.equal(f.calls.saves,0);modal.close();
 }finally{api.Modal.prototype.open=previousOpen;api.Modal.prototype.close=previousClose;dom.restore();}
});
test('actual embedded Table/List/Cards rendering stays read-only by default, exposes only note-property edits after opt-in, and cached handlers refuse before IO',async()=>{
 const dom=installMentionBulkDom(),proto=dom.Element.prototype,create=document.createElement;
 Object.defineProperties(proto,{childElementCount:{configurable:true,get(){return this.children.length;}},firstElementChild:{configurable:true,get(){return this.children[0]??null;}}});proto.checkVisibility=function(){return this.isConnected&&!this.hidden;};
 document.createElement=tag=>{const n=create(tag);n.ownerDocument=document;n.style={setProperty(){}};return n;};
 try{for(const layout of['table','list','cards']){
  const f=fixture(),host=f.host;host.ownerDocument=document;host.children=[];host.contains=node=>node===host||host.children.some(child=>child.contains(node));host.append=(...nodes)=>{for(const n of nodes){n.parent=host;host.children.push(n);}};
  const make=()=>document.createElement('div'),results=make(),pages=make(),warnings=make(),status=make(),toggle=document.createElement('button'),caption=document.createElement('p');host.append(results,pages,warnings,status,toggle,caption);
  const text='formulas: {one: "1"}\nfilters: file.path == "Target.md"\nviews:\n  - type: '+layout+'\n    name: Main\n    order: [file.name, note.status, note.amount, formula.one]\n',model=new api.BaseDocument(text);
  const files=[{path:'Target.md',name:'Target.md',basename:'Target',extension:'md',stat:{size:original.length,mtime:1,ctime:1},properties:value(original)}],result=api.queryBase({text,files,context:files[0],view:'Main',search:'',page:0});
  const embed=Object.assign(Object.create(api.BaseEmbed.prototype),{options:{app:f.app,host,sourcePath:f.parent.path,scope:{depth:0},owned:()=>true,inline:{current:()=>true}},root:f.app.vault.rootPath,path:f.parent.path,source:f.parent,sourcePath:f.parent.path,closed:false,acquired:true,generation:0,model,text,selected:'Main',page:0,search:{value:''},results,pages,warnings,status,editProperties:toggle,caption,editingProperties:false,completeQuery:false});
  embed.render(result,0);assert.equal(results.querySelectorAll('[data-bases-embed-property-edit]').length,0,layout+' defaults to browsing');embed.editingProperties=true;embed.render(result,0);
  const buttons=results.querySelectorAll('[data-bases-embed-property-edit]');assert.deepEqual(buttons.map(n=>n.dataset.basesEmbedPropertyEdit),['note.status','note.amount']);assert.ok(buttons.every(n=>!n.disabled));assert.deepEqual(f.calls.reads,[]);assert.equal(f.calls.allocations,0);
  f.app.vault.readOnly=true;embed.render(result,0);const readonly=results.querySelectorAll('[data-bases-embed-property-edit]');assert.ok(readonly.every(n=>n.disabled));for(const n of readonly){n.disabled=false;await n.fire('click');n.disabled=true;}assert.deepEqual(f.calls.reads,[]);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);
 }}finally{dom.restore();}
});
test('the actual embedded file review closure pins scalar base witnesses instead of rebasing on a mutable saved Base document',async()=>{
 const dom=installMentionBulkDom(),previousOpen=api.Modal.prototype.open,previousClose=api.Modal.prototype.close;
 api.Modal.prototype.open=function(){this.containerEl.root=true;this.opened=true;this.onOpen();};api.Modal.prototype.close=function(){this.opened=false;this.onClose();this.containerEl.root=false;};
 try{for(const field of['version','content','hasBom']){
  const f=fixture(),text='views:\n  - type: table\n    name: Main\n    order: [file.name, note.status]\n',baseFile=new api.TFile(f.app.vault,{path:'Catalog.base',basename:'Catalog',extension:'base',stat:{size:text.length,mtime:1,ctime:1}}),saved={file:{path:baseFile.path},content:text,version:'base-original',hasBom:true};f.files.set(baseFile.path,baseFile);f.disk.set(baseFile.path,saved);f.host.contains=node=>node===f.host;
  const embed=Object.assign(Object.create(api.BaseEmbed.prototype),{options:{app:f.app,host:f.host,file:baseFile,linktext:'Catalog.base',sourcePath:f.parent.path,scope:{depth:0},owned:()=>true},root:f.app.vault.rootPath,path:baseFile.path,source:f.parent,sourcePath:f.parent.path,closed:false,acquired:true,generation:0,model:new api.BaseDocument(text),text,selected:'Main',page:0,search:{value:''},status:{textContent:''},savedBase:saved,editingProperties:true,completeQuery:true});
  embed.editProperty(f.target.path,'status',0);const modal=embed.propertyModal,review=modal.review;assert.ok(review);assert.equal(review.owner.current(),true);
  if(field==='hasBom')saved.hasBom=false;else if(field==='content')saved.content+='# in-place change\n';else saved.version+=':changed';
  assert.equal(review.owner.current(),false);assert.equal(await review.owner.physical(),false);await assert.rejects(api.showEmbeddedPropertySource(review));assert.deepEqual(f.calls.reads,[]);assert.equal(f.calls.allocations,0);assert.equal(f.calls.writes,0);modal.close();
 }}finally{api.Modal.prototype.open=previousOpen;api.Modal.prototype.close=previousClose;dom.restore();}
});

function cachedViewport({mounted=false,mountOnWheel=true,covered=false,changeBeforeInput}={}){
 const text='# Exact cached parent λ\r\n'+basesEmbedAuthoringReadOnlyFixture.sourceAddition,file={path:'Read only.md'},saved={file:{path:file.path},content:text,version:'git:exact',hasBom:false},session={originRoot:'cached-root',document:saved,text,dirty:false},calls=[],state={mounted,loading:false,covered,changed:false},historyToken={};
 const cm={state:EditorState.create({doc:text,extensions:[history(),EditorState.lineSeparator.of('\r\n')]}),viewport:{from:0,to:text.replaceAll('\r\n','\n').indexOf('```base')-2},visibleRanges:[{from:0,to:10}]},editor={cm,getValue:()=>cm.state.sliceDoc()},rect=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top}),content={scrollTop:0,getBoundingClientRect:()=>rect(0,80,800,400),parentElement:null},scroller={getBoundingClientRect:()=>rect(0,150,800,600),parentElement:content,checkVisibility:()=>true,contains:node=>node===scroller},source={checkVisibility:()=>true},view={file,session,editor,sourceEl:source,contentEl:content,getEditingMode:()=> 'live-preview'},leaf={id:'cached-parent',view,containerEl:{querySelector:()=>state.mounted?{}:null,querySelectorAll:()=>[false,...(state.mounted?[true]:[])].map(inline=>({hasAttribute:()=>inline,dataset:{slopsidianEmbedState:state.loading&&inline?'loading':'ready'},querySelectorAll:()=>Array.from({length:state.loading&&inline?0:1},()=>({}))}))}};cm.scrollDOM=scroller;
 const app={vault:{rootPath:'cached-root',readOnly:true,getFileByPath:path=>path===file.path?file:null},changingVault:false,workspace:{activeLeaf:leaf,isChangingFiles:false,getLeafById:id=>id===leaf.id?leaf:null,sessions:new Map([[file.path,session]])},plugins:{modules:{'@codemirror/commands':{historyField,undoDepth,redoDepth}}}},context=createContext({app,innerWidth:800,innerHeight:500,getComputedStyle:()=>({overflowX:'hidden',overflowY:'auto'}),document:{elementFromPoint:()=>state.covered?{}:scroller},requestAnimationFrame:callback=>setImmediate(()=>callback(0))}),tools={report:{},async evaluate(code){calls.push({evaluate:code});if(code==='basesEmbedAuthoringWheelOwner.sample()'&&changeBeforeInput&&!state.changed){state.changed=true;changeBeforeInput({app,cm,editor,view,session,saved,leaf,state})}return await runInContext(code,context)},async command(method,event){calls.push({method,event});assert.equal(method,'Input.dispatchMouseEvent');assert.equal(event.type,'mouseWheel');assert.equal(event.deltaY,240);assert.ok(event.x>=0&&event.x<800&&event.y>=150&&event.y<=400,'wheel coordinates are clipped to the owned source intersection');content.scrollTop+=event.deltaY;if(mountOnWheel){state.mounted=true;state.loading=true;cm.viewport={from:0,to:cm.state.doc.length}}}};
 return{tools,state,calls,app,context,cm,editor,view,session,saved,leaf,text,historyToken};
}
test('cached viewport reveal uses clipped ordinary wheel input before requiring the formerly unmounted inline query, retaining exact owner/history',async()=>{
 const f=cachedViewport(),doc=f.cm.state.doc,selection=f.cm.state.selection,history=f.cm.state.field(historyField),saved=f.session.document;
 assert.equal(f.state.mounted,false);const result=await revealCachedBasesInlineWithWheel(f.tools,f.leaf.id);assert.equal(result.samples[0].inlineMounted,false);assert.equal(result.samples.at(-1).inlineMounted,true);assert.equal(result.samples.at(-1).embeds.length,2);assert.equal(result.samples.at(-1).embeds.find(n=>n.inline).state,'loading','viewport reveal does not substitute for the subsequent unchanged complete-query wait');assert.equal(result.wheelsSent,1);assert.equal(result.ownerSourceHistoryRetained,true);assert.equal(result.wheels[0].y,275);assert.equal(f.calls.filter(c=>c.method).length,1);assert.equal(f.session.text,f.text);assert.equal(f.editor.getValue(),f.text);assert.equal(f.cm.state.doc,doc);assert.equal(f.cm.state.selection,selection);assert.equal(f.cm.state.field(historyField),history);assert.equal(f.session.document,saved);assert.equal(saved.hasBom,false);assert.equal(runInContext('Object.hasOwn(globalThis,"basesEmbedAuthoringWheelOwner")',f.context),false);
});
test('a cached inline query already mounted needs no wheel, while an unreachable viewport and four unproductive wheels refuse within the bound',async()=>{
 const ready=cachedViewport({mounted:true}),result=await revealCachedBasesInlineWithWheel(ready.tools,ready.leaf.id);assert.equal(result.wheelsSent,0);assert.equal(ready.calls.filter(c=>c.method).length,0);
 const covered=cachedViewport({covered:true});await assert.rejects(revealCachedBasesInlineWithWheel(covered.tools,covered.leaf.id),/clipped owned CodeMirror/);assert.equal(covered.calls.filter(c=>c.method).length,0);
 const blocked=cachedViewport({mountOnWheel:false}),doc=blocked.cm.state.doc;await assert.rejects(revealCachedBasesInlineWithWheel(blocked.tools,blocked.leaf.id),/after four ordinary wheel/);assert.equal(blocked.calls.filter(c=>c.method).length,4);assert.equal(blocked.cm.state.doc,doc);assert.equal(blocked.session.text,blocked.text);assert.equal(runInContext('Object.hasOwn(globalThis,"basesEmbedAuthoringWheelOwner")',blocked.context),false);
});
test('cached viewport owner, exact source and saved BOM/version changes refuse before any wheel or selection mutation',async()=>{
 for(const changeBeforeInput of[({app})=>{app.vault.rootPath='new-root'},({app})=>{app.workspace.activeLeaf={}},({view})=>{view.editor={}},({view})=>{view.getEditingMode=()=> 'source'},({session})=>{session.text+='changed'},({saved})=>{saved.hasBom=true},({saved})=>{saved.version='new-version'}]){
  const f=cachedViewport({changeBeforeInput}),selection=f.cm.state.selection;await assert.rejects(revealCachedBasesInlineWithWheel(f.tools,f.leaf.id),/owner\/source\/history changed/,String(changeBeforeInput));assert.equal(f.calls.filter(c=>c.method).length,0);assert.equal(f.cm.state.selection,selection);assert.equal(runInContext('Object.hasOwn(globalThis,"basesEmbedAuthoringWheelOwner")',f.context),false);
 }
});
