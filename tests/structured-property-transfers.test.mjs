import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Compartment, EditorState } from "@codemirror/state";
import { history, historyField, undoDepth, redoDepth } from "@codemirror/commands";
import { createContext, runInContext } from 'node:vm';

// Pure production planner/controller checks; this process starts no host/build.
registerHooks({
  resolve(specifier, context, next) { try { return next(specifier, context); } catch (issue) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context); throw issue; } },
  load(url, context, next) { if (url.endsWith('/client/error-log.ts')) return {format:'module',shortCircuit:true,source:'export function recordError(error){return{error:{message:String(error)}}}export async function downloadErrorLog(){}'}; if (!url.includes("/client/") || !url.endsWith(".ts")) return next(url, context); let source=readFileSync(fileURLToPath(url), "utf8");if(url.endsWith('/client/workspace.ts'))source+='\nexport { DocumentSession };';return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(source, { mode: "transform" }) }; }
});
const transfers = await import("../client/structured-property-transfers.ts"), structured = await import("../client/structured-properties.ts"), operations = await import("../client/structured-property-operations.ts");
const { Editor }=await import('../client/editor.ts'),{Workspace,DocumentSession}=await import('../client/workspace.ts'),{FileManager}=await import('../client/file-manager.ts');
const { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts");
const value = source => parseMarkdown(source).frontmatter?.opaque;
const plan = (source, kind, path, destination, key) => transfers.planStructuredPropertyTransfer(source, "opaque", value(source), { kind, path, destination, key });
const targets = source => transfers.structuredPropertyTransferTargets(source, "opaque", value(source));
const original = '\ufeff---\r\n# Keep λ\r\nopaque:\r\n  map:\r\n    first: 1.50 # number\r\n    "branch λ":\r\n      inner: [one, false, -0] # subtree 😀\r\n      text: \'quoted Ω\'\r\n    multiline: |2- # header\r\n      First 😀\r\n      Second λ\r\n    implicit: # attached null\r\n  target:\r\n    deep:\r\n      existing: true # keep\r\n  list:\r\n    - one # list comment\r\n    - { child: [false, 1.50] } # list subtree\r\n  flow: { first: 1.50, "branch λ": { child: [one, -0] }, last: ~, }\r\n  flowList: ["same", same ,false, -0,]\r\n  emptyMap: {}\r\n  emptyList: []\r\nunknown: &shared { exact: retained }\r\nalias: *shared\r\n---\r\n# Body 😀\r\n\r\nUntouched.\r\n';
const branch = '    "branch λ":\r\n      inner: [one, false, -0] # subtree 😀\r\n      text: \'quoted Ω\'\r\n';
const assertOuter = result => { assert.ok(result.startsWith('\ufeff')); assert.ok(result.endsWith('unknown: &shared { exact: retained }\r\nalias: *shared\r\n---\r\n# Body 😀\r\n\r\nUntouched.\r\n')); };

test("duplicate map subtree preserves raw descendants, comments, numeric spelling, BOM and CRLF", () => {
  const result = plan(original, "duplicate", ["map", "branch λ"], ["map"], "copy Ω");
  const added = branch.replace('"branch λ"', '"copy Ω"');
  assert.equal(result.source, original.replace('  target:', added + '  target:'));
  assert.deepEqual(result.next.map["copy Ω"], value(original).map["branch λ"]); assert.notEqual(result.next.map["copy Ω"], result.next.map["branch λ"]);
  assert.match(result.review, /The original entry remains unchanged/); assert.match(result.review, /Exact destination replacement/); assertOuter(result.source);
});
test("block subtree copy into a deeper proved map changes only structural indentation", () => {
  const result = plan(original, "copy-to", ["map", "branch λ"], ["target", "deep"], "branch λ"), added = branch.split('\r\n').map(line => line ? '  ' + line : line).join('\r\n');
  assert.equal(result.source, original.replace('  list:', added + '  list:')); assert.deepEqual(result.next.target.deep["branch λ"], result.next.map["branch λ"]);
  assert.ok(result.source.includes('inner: [one, false, -0] # subtree 😀')); assertOuter(result.source);
});
test("atomic move into another map removes exactly the old subtree and inserts its exact reindented text", () => {
  const result = plan(original, "move-into", ["map", "branch λ"], ["target", "deep"], "moved Ω"), added = branch.replace('"branch λ"', '"moved Ω"').split('\r\n').map(line => line ? '  ' + line : line).join('\r\n');
  assert.equal(result.source, original.replace(branch, '').replace('  list:', added + '  list:'));
  assert.equal(Object.hasOwn(result.next.map, "branch λ"), false); assert.deepEqual(result.next.target.deep["moved Ω"], value(original).map["branch λ"]); assert.match(result.review, /Exact source removed/);
});
test("block map/list transfer changes entry punctuation while owned comments remain attached", () => {
  const moved = plan(original, "move-into", ["map", "first"], ["list"], 1);
  assert.equal(moved.source, original.replace('    first: 1.50 # number\r\n', '').replace('    - { child:', '    - 1.50 # number\r\n    - { child:'));
  const copied = plan(original, "copy-to", ["list", 1], ["target", "deep"], "from list");
  assert.equal(copied.source, original.replace('  list:', '      "from list": { child: [false, 1.50] } # list subtree\r\n  list:'));
  assert.deepEqual(copied.next.target.deep["from list"], value(original).list[1]);
});
test("literal block text retains its explicit indentation indicator, chomping and exact decoded text", () => {
  const copied = plan(original, "copy-to", ["map", "multiline"], ["target", "deep"], "multiline");
  assert.equal(copied.next.target.deep.multiline, value(original).map.multiline);
  assert.ok(copied.source.includes('      multiline: |2- # header\r\n        First 😀\r\n        Second λ\r\n'));
});
test("implicit-null map/list transfers retain punctuation/comment ownership and remain null", () => {
  const moved = plan(original, "move-into", ["map", "implicit"], ["list"], 0);
  assert.equal(moved.source, original.replace('    implicit: # attached null\r\n', '').replace('    - one', '    - # attached null\r\n    - one')); assert.equal(moved.next.list[0], null);
});
test("flow copy/duplicate keep exact value tokens, negative zero and untouched separator slots", () => {
  const copied = plan(original, "copy-to", ["flow", "branch λ"], ["emptyList"], 0);
  assert.equal(copied.source, original.replace('  emptyList: []', '  emptyList: [{ child: [one, -0] }]'));
  assert.ok(Object.is(copied.next.emptyList[0].child[1], -0));
  const duplicate = plan(original, "duplicate", ["flowList", 0], ["flowList"], 2);
  assert.equal(duplicate.source, original.replace('["same", same ,false, -0,]', '["same", same ,"same" ,false, -0,]'));
});
test("flow payload copies to block containers and comment-free block payload copies into empty flow", () => {
  const copied = plan(original, "copy-to", ["flow", "branch λ"], ["list"], 2);
  assert.equal(copied.source, original.replace('  flow:', '    - { child: [one, -0] }\r\n  flow:'));
  const clean = original.replace('first: 1.50 # number', 'first: 1.50');
  assert.equal(plan(clean, "copy-to", ["map", "first"], ["emptyMap"], "first").source, clean.replace('emptyMap: {}', 'emptyMap: {first: 1.50}'));
});
test("moving a singleton retains a usable explicit empty source collection", () => {
  for (const [yaml, path] of [['  from:\n    only: 1.50 # attached\n', ['from', 'only']], ['  from:\n    - 1.50 # attached\n', ['from', 0]]]) {
    const source = '---\nopaque:\n' + yaml + '  destination:\n    retained: false\n---\nBody\n', moved = plan(source, 'move-into', path, ['destination'], 'moved');
    assert.deepEqual(moved.next.from, typeof path[1] === 'number' ? [] : {}); assert.ok(moved.source.includes(typeof path[1] === 'number' ? '    []\n' : '    {}\n')); assert.equal(moved.next.destination.moved, 1.5);
  }
});
test("original-offset splices handle destination before source and sibling list index shifts", () => {
  const source = '---\nopaque: [{ target: [] }, { moving: [one, -0] }, { last: true }]\n---\nBody\n', moved = plan(source, 'move-into', [1], [0, 'target'], 0);
  assert.equal(moved.source, source.replace('[{ target: [] }, { moving: [one, -0] }, { last: true }]', '[{ target: [{ moving: [one, -0] }] }, { last: true }]'));
  const later = '---\nopaque: [{ moving: true }, { target: [] }]\n---\nBody\n', shifted = plan(later, 'move-into', [0], [1, 'target'], 0);
  assert.equal(shifted.source, '---\nopaque: [{ target: [{ moving: true }] }]\n---\nBody\n');
});
test("copy and move into the same property's root container retain exact nested payloads", () => {
  // A child ending in implicit null has an overlapping YAML collection range;
  // the existing shared layout proof correctly leaves that root Source-only.
  assert.throws(()=>plan(original,'copy-to',['flow','branch λ'],[],'root copy'));
  const provedRoot=original.replace('    implicit: # attached null\r\n','');
  const copied = plan(provedRoot, 'copy-to', ['flow','branch λ'], [], 'root copy');
  assert.equal(copied.source, provedRoot.replace('unknown:', '  "root copy": { child: [one, -0] }\r\nunknown:'));
  const moved = plan(provedRoot, 'move-into', ['map','first'], [], 'root moved');
  assert.equal(moved.source, provedRoot.replace('    first: 1.50 # number\r\n','').replace('unknown:', '  "root moved": 1.50 # number\r\nunknown:'));
  assert.equal(Object.hasOwn(moved.next.map,'first'),false);assert.equal(moved.next['root moved'],1.5);
});
test("multiline flow payload text remains exact while destination punctuation is proved", () => {
  const source = '---\nopaque: { from: { a: 1.50,\r\n    nested: [false, -0],\n  }, target: [retained,] }\n---\nBody\n', copied = plan(source, 'copy-to', ['from'], ['target'], 0);
  assert.equal(copied.source, source.replace('target: [retained,]', 'target: [{ a: 1.50,\r\n    nested: [false, -0],\n  },retained,]'));
});
test("complete candidate semantics are checked before retaining only the reviewed source splices", () => {
  for (const [kind, path, destination, key] of [['duplicate', ['map', 'first'], ['map'], 'copied'], ['move-into', ['flow', 'branch λ'], ['emptyMap'], 'moved']]) {
    const result = plan(original, kind, path, destination, key), operation = result.operation, candidate = updateFrontmatter(original, fm => { fm.opaque = result.next; });
    assert.equal(transfers.preserveStructuredPropertyTransferSource(candidate, original, 'opaque', operation), result.source);
    assert.throws(() => transfers.preserveStructuredPropertyTransferSource(updateFrontmatter(candidate, fm => { fm.unrelated = true; }), original, 'opaque', operation));
    assert.throws(() => transfers.preserveStructuredPropertyTransferSource(updateFrontmatter(candidate, fm => { fm.opaque.map.first = 2; }), original, 'opaque', operation));
  }
});
test("ancestor cycles, same-container moves, map collisions, unsafe names and invalid indexes refuse", () => {
  for (const [kind, path, destination, key] of [['copy-to', ['map'], ['map'], 'new'], ['move-into', ['target'], ['target', 'deep'], 'new'], ['move-into', ['list', 0], ['list'], 1], ['duplicate', ['map', 'first'], ['list'], 0], ['copy-to', ['map', 'first'], ['map'], 'FIRST'], ['copy-to', ['map', 'first'], ['list'], 3], ['copy-to', ['map', 'first'], ['list'], '0'], ['copy-to', ['map', 'first'], ['missing'], 'new'], ['copy-to', [], ['list'], 0]]) assert.throws(() => plan(original, kind, path, destination, key));
  for (const key of ['__proto__', 'prototype', 'constructor', '<<', '', 'x'.repeat(257), 'line\nkey']) assert.throws(() => plan(original, 'copy-to', ['map', 'first'], ['map'], key));
});
test("ambiguous source/destination comments, compact blocks and cross-layout comments stay Source-only", () => {
  for (const source of ['---\nopaque:\n  source:\n    # unowned\n    one: true\n  target: [retained]\n---\n', '---\nopaque:\n  source:\n    one: true\n\n    two: false\n  target: [retained]\n---\n', '---\nopaque: { source: { one: true, # separator\n  two: false }, target: [] }\n---\n']) { assert.throws(() => plan(source, 'copy-to', ['source', 'one'], ['target'], 0)); assert.equal(targets(source)['copy-to'].has('["source","one"]'), false); }
  assert.throws(() => plan(original, 'copy-to', ['map', 'first'], ['emptyList'], 0), /attached comment/);
  assert.throws(() => plan(original, 'copy-to', ['map', 'branch λ'], ['emptyList'], 0), /block subtree/);
  const compact = '---\nopaque:\n  list:\n    - a: 1\n      b: 2\n  target:\n    keep: true\n---\n'; assert.throws(() => plan(compact, 'copy-to', ['list', 0], ['target'], 'new'), /Compact block/);
});
test("aliases, tags, precision loss, malformed YAML and stale snapshot refuse before a plan exists", () => {
  for (const yaml of ['opaque: { a: &shared {x: one}, b: *shared, target: [] }', 'opaque: { a: !custom one, target: [] }', 'opaque: { a: 0.10000000000000001, target: [] }', 'opaque: { a: 9007199254740993, target: [] }', 'opaque: { a: one, a: two, target: [] }']) { const source = '---\n' + yaml + '\n---\n'; assert.throws(() => plan(source, 'copy-to', ['a'], ['target'], 0)); assert.equal(targets(source)['copy-to'].size, 0); }
  assert.throws(() => transfers.planStructuredPropertyTransfer(original, 'opaque', { ...value(original), changed: true }, { kind: 'copy-to', path: ['map','first'], destination: ['list'], key: 0 }));
});
test("descriptor/path operations refuse getters without invoking them and do not mutate callers", () => {
  let reads = 0; const operation = { kind: 'copy-to', path: ['map', 'first'], destination: ['list'], get key() { reads++; return 0; } };
  assert.throws(() => transfers.planStructuredPropertyTransfer(original, 'opaque', value(original), operation));
  const path = ['map', 'first']; Object.defineProperty(path, 0, { get() { reads++; return 'map'; } }); assert.throws(() => transfers.planStructuredPropertyTransfer(original, 'opaque', value(original), { kind: 'copy-to', destination: ['list'], key: 0, path }));
  const before = value(original), copy = structuredClone(before), input = { kind: 'duplicate', path: ['map', 'first'], destination: ['map'], key: 'copy' }; transfers.planStructuredPropertyTransfer(original, 'opaque', before, input); assert.deepEqual(before, copy); assert.equal(reads, 0);
  assert.deepEqual(input, { kind: 'duplicate', path: ['map', 'first'], destination: ['map'], key: 'copy' });
});
test("review and final tree budgets refuse whole transfers rather than truncating source", () => {
  const text = '---\nopaque: { big: { first: "' + 'x'.repeat(2200) + '", second: "' + 'y'.repeat(2200) + '" }, target: [] }\n---\n'; assert.throws(() => plan(text, 'copy-to', ['big'], ['target'], 0), /review limit/); assert.equal(targets(text)['copy-to'].has('["big"]'), false);
  const many = '---\nopaque: { values: [' + Array.from({ length: 246 }, () => 'true').join(', ') + '], target: [] }\n---\n'; assert.throws(() => plan(many, 'copy-to', ['values'], ['target'], 0));
});
test("capabilities advertise compatible containers with typed paths and exclude source descendants", () => {
  const discovered = targets(original); assert.ok(discovered.duplicate.has('["map","branch λ"]')); assert.ok(discovered['move-into'].has('["map","branch λ"]'));
  const destinations = discovered.transferDestinations.get('["map","branch λ"]'); assert.ok(destinations.some(container => JSON.stringify(container.path) === '["target","deep"]'));
  assert.equal(destinations.some(container => JSON.stringify(container.path).startsWith('["map","branch λ"')), false); assert.equal(destinations.some(container => JSON.stringify(container.path) === '["emptyList"]'), false);
});
test("the shared host fixture is complete CRLF with independently spelled exact transfer outcomes", async () => {
  const { structuredPropertyTransfersReadOnlyFixture: cached, structuredPropertyTransfersScenarioFixture: host } = await import('../tools/structured-property-transfers-scenarios.mjs');
  assert.equal(cached.source,host.original);assert.equal(host.original.replaceAll('\r\n','').includes('\n'),false);assert.equal(cached.files.length,1);
  const run=(kind,path,destination,key)=>transfers.planStructuredPropertyTransfer(host.original,'transferable',parseMarkdown(host.original).frontmatter.transferable,{kind,path,destination,key});
  for(const[kind,path,destination,key,expected]of[['duplicate',['from','branch λ'],['from'],'copy Ω',host.duplicate],['copy-to',['from','branch λ'],['target','deep'],'branch λ',host.copied],['move-into',['from','number'],['list'],1,host.moved],['copy-to',['from','multiline'],['target','deep'],'multiline',host.copiedMultiline],['copy-to',['flow','branch'],['empty'],0,host.persisted],['copy-to',['flow','branch'],[],'root copy',host.rootCopied],['move-into',['shifted',0],['shifted',1,'target'],0,host.shiftedMove]])assert.equal(run(kind,path,destination,key).source,expected);
  const offered=transfers.structuredPropertyTransferTargets(host.original,'transferable',parseMarkdown(host.original).frontmatter.transferable);assert.equal(offered['copy-to'].has('["blocked","first"]'),false);
});
const earlyPhysicalRefusal='The note or nested property owner changed. Cancel this transfer and review the current source.',queuedPhysicalRefusal='The note or nested property owner changed. Cancel this draft and review the current source before applying it.';
async function physicalHistoryFixture(route){
 const {structuredPropertyTransfersScenarioFixture:host,assertStructuredTransferPhysicalRefusal:verify,structuredTransferPhysicalHistoryTrace}=await import('../tools/structured-property-transfers-scenarios.mjs');const original=host.original,external=original+'External physical source Ω.\r\n',file={path:'Structured entry transfers/Source.md',extension:'md'},separator=new Compartment(),createState=text=>EditorState.create({doc:text,extensions:[history(),separator.of(EditorState.lineSeparator.of('\r\n'))]});let state=createState(original),reads=0,transactions=0;
 const editor=Object.assign(Object.create(Editor.prototype),{lineSeparatorCompartment:separator,state:createState}),cm={get state(){return state},setState(next){state=next},scrollDOM:{scrollTop:0},dispatch(spec){state=(spec.startState?spec:state.update(spec)).state}};editor.cm=cm;const replacement=editor.replaceExpected;editor.replaceExpected=function(...args){transactions++;return replacement.apply(this,args)};
 editor.replaceRange('Later Source Ω.',editor.offsetToPos(original.length));editor.undo();assert.deepEqual([undoDepth(state),redoDepth(state)],[0,1]);
 const app={changingVault:false,vault:{rootPath:'physical-history',getAbstractFileByPath:()=>file,async readDocument(){reads++;return{file,version:'external',content:external}}}},workspace={app,sessions:new Map(),isChangingFiles:false,isChangingLayout:false,leaves:()=>[],track:p=>p,notifyEditor(){}};app.workspace=workspace;app.metadataCache={getDocument:()=>({text:original})};const session=new DocumentSession(workspace,{file,version:'before',content:original});workspace.sessions.set(file.path,session);session.leaves.add({editor,leaf:{updateHeader(){}},getMode:()=>'source'});
 const snapshot=()=>({text:editor.getValue(),undo:undoDepth(state),redo:redoDepth(state),history:JSON.stringify(state.toJSON({history:historyField}).history)}),ownedMethods=Object.fromEntries(['syncValue','setDocument','replaceExpected','replaceExpectedChanges'].map(method=>[method,editor[method]])),ownedDispatch=cm.dispatch,context=createContext({sourceView:{editor,session},app:{plugins:{modules:{'@codemirror/commands':{historyField,undoDepth,redoDepth}}}}}),trace=structuredTransferPhysicalHistoryTrace(async expression=>JSON.parse(JSON.stringify(runInContext(expression,context))),'sourceView','physicalHistoryFixtureTrace');await trace.start();
 const calls=[],errors=[],path=['flow','branch'],document=fakeDocument(),draft=transfers.createStructuredPropertyTransferEditor(document,{kind:'copy-to',path,label:'physical source',destinations:transfers.structuredPropertyTransferTargets(original,'transferable',parseMarkdown(original).frontmatter.transferable).transferDestinations.get(JSON.stringify(path)),current:()=>route==='queued-reset'||editor.getValue()===original,plan:operation=>transfers.planStructuredPropertyTransfer(original,'transferable',parseMarkdown(original).frontmatter.transferable,operation),async apply(){const call={path:file.path,phase:'transfer-expected-physical-conflict',settled:false};calls.push(call);try{const manager=new FileManager(app);await manager.processFrontMatter(file,()=>{throw Error('A refused transfer must not call its property mutator')},undefined,content=>{if(content!==original)throw Error(queuedPhysicalRefusal)});return true}catch(error){call.reason=error.message;throw error}finally{call.settled=true}},error:message=>errors.push(message),closed(){}});
 if(route==='before-queue-sync')Workspace.prototype.acceptExternalDocuments.call(workspace,[{file,version:'external',content:external}]);else if(route==='before-queue-reset')await session.reload(false);
 const afterExternal=route==='queued-reset'?null:snapshot();all(draft.element).find(n=>Object.hasOwn(n.dataset??{},'propertyStructuredApply')).fire('click');for(let i=0;i<12;i++)await Promise.resolve();const after=snapshot();assert.equal(transactions,0);assert.equal(session.text,external);assert.equal(session.document.content,external);assert.equal(session.dirty,false);if(afterExternal)assert.deepEqual(after,afterExternal);
 const receipt={calls,error:errors.at(-1),sourceUndo:after.undo,sourceRedo:after.redo,history:await trace.stop(),proof:{externalSourceExact:true,sourceClean:true,noPropertyUndo:true,peerIdentity:true,peerText:true,peerDirty:true,peerHistory:true}};assert.equal(Object.hasOwn(context,'physicalHistoryFixtureTrace'),false);assert.equal(cm.dispatch,ownedDispatch);for(const[method,owned]of Object.entries(ownedMethods))assert.equal(editor[method],owned);assert.equal(await trace.stop(),null);assert.equal(verify(receipt),route==='queued-reset'?'queued':'before-queue');return{receipt,verify,editor,original,external,reads};
}
test('real metadata sync retains its external-source Undo while earlier watcher refusal adds no transfer history',async()=>{
 const f=await physicalHistoryFixture('before-queue-sync');assert.deepEqual([f.receipt.sourceUndo,f.receipt.sourceRedo],[1,0]);assert.deepEqual(f.receipt.calls,[]);assert.equal(f.receipt.error,earlyPhysicalRefusal);assert.equal(f.reads,0);f.editor.undo();assert.equal(f.editor.getValue(),f.original);f.editor.redo();assert.equal(f.editor.getValue(),f.external);
});
test('real DocumentSession reload resets history and exact earlier/queued refusals add no property transaction',async()=>{
 for(const route of ['before-queue-reset','queued-reset']){const f=await physicalHistoryFixture(route);assert.deepEqual([f.receipt.sourceUndo,f.receipt.sourceRedo],[0,0]);assert.equal(f.reads,1);assert.equal(f.receipt.calls.length,route==='queued-reset'?1:0);f.editor.undo();assert.equal(f.editor.getValue(),f.external)}
});
test('physical receipts require exact route, zero property transactions and unchanged witnessed synchronization history',async()=>{
 const {receipt,verify}=await physicalHistoryFixture('before-queue-sync'),call={path:'Structured entry transfers/Source.md',phase:'transfer-expected-physical-conflict',settled:true,reason:queuedPhysicalRefusal};
 for(const change of[r=>{r.error=queuedPhysicalRefusal},r=>{r.error='Unexpected failure'},r=>{r.calls=[call]},r=>{r.calls=[{...call,reason:'Transport failed'}];r.error=queuedPhysicalRefusal},r=>{r.calls=[{...call,settled:false}];r.error=queuedPhysicalRefusal},r=>{r.calls=[{...call,path:'Unrelated.md'}];r.error=queuedPhysicalRefusal},r=>{r.calls=[call,call];r.error=queuedPhysicalRefusal},r=>{delete r.history},r=>{r.history.propertyTransactions.push({method:'replaceExpected'})},r=>{r.history.sourceOwnerExact=false},r=>{r.history.transitions=[]},r=>{r.history.transitions[0].preserveHistory=true},r=>{r.history.transitions[0].requested+='wrong'},r=>{r.history.documentChanges[0].owner='replaceExpected'},r=>{r.history.after.history='{"done":[],"undone":[]}'},r=>{r.sourceUndo++}]){const invalid=structuredClone(receipt);change(invalid);assert.throws(()=>verify(invalid))}
 for(const key of Object.keys(receipt.proof)){const invalid=structuredClone(receipt);invalid.proof[key]=false;assert.throws(()=>verify(invalid),key)}
});

function fakeDocument() {
  const create = tag => {
    const node = { tagName: tag, dataset: {}, children: [], listeners: {}, isConnected: true, value: '', focus() {}, append(...nodes) { for (const n of nodes) { if (typeof n === 'object') n.parentElement = this; this.children.push(n); } }, setAttribute(k, v) { this[k] = v; }, addEventListener(k, v) { (this.listeners[k] ??= []).push(v); }, fire(k, event = {}) { for (const fn of this.listeners[k] ?? []) fn({ preventDefault() {}, ...event }); }, remove() { this.isConnected = false; }, checkVisibility() { return true; }, contains(n) { return n === this || this.children.some(c => typeof c === 'object' && c.contains?.(n)); }, get lastElementChild() { return this.children.at(-1); }, insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); child.parentElement = this; } };
    let text = ''; Object.defineProperty(node, 'textContent', { get: () => text, set: value => { text = value; node.children = []; } });
    if (tag.toLowerCase() === 'textarea') { let value = ''; Object.defineProperty(node, 'value', { enumerable: true, get: () => value, set: next => { value = String(next).replace(/\r\n?/g, '\n'); } }); }
    return node;
  };
  return { createElement: create, createTextNode: text => ({ textContent: text }) };
}
const all = node => [node, ...(node.children ?? []).filter(n => typeof n === 'object').flatMap(all)];
function editor(overrides = {}) {
  const document = fakeDocument(), errors = [], state = { applies: 0, closed: 0, current: true }, path = ['map', 'branch λ'];
  const e = transfers.createStructuredPropertyTransferEditor(document, { kind: 'copy-to', path, label: 'opaque branch λ', destinations: targets(original).transferDestinations.get(JSON.stringify(path)), current: () => state.current, plan: operation => transfers.planStructuredPropertyTransfer(original, 'opaque', value(original), operation), apply: async () => { state.applies++; return true; }, error: text => errors.push(text), closed: () => state.closed++, ...overrides });
  const find = key => all(e.element).find(n => Object.hasOwn(n.dataset ?? {}, key)); return { e, state, errors, apply: find('propertyStructuredApply'), cancel: find('propertyStructuredCancel'), destination: find('propertyStructuredTransferDestination'), key: find('propertyStructuredTransferKey'), review: find('propertyStructuredTransferReview') };
}
const choose = (editor, path, key) => { editor.destination.value = JSON.stringify(path); editor.destination.fire('change'); if (key !== undefined) { editor.key.value = key; editor.key.fire('input'); } };
test("transfer destination/type/key are visible drafts and Cancel or Escape changes no source", () => {
  for (const finish of ['cancel', 'escape']) { const result = editor(); choose(result, ['target', 'deep'], 'copy Ω'); assert.match(result.review.value, /Destination: \["opaque","target","deep"\] \(Map\)/); assert.equal(result.apply.disabled, false); assert.equal(result.state.applies, 0); if (finish === 'cancel') result.cancel.fire('click'); else result.e.element.fire('keydown', { key: 'Escape' }); assert.equal(result.state.closed, 1); }
});
test("HTML-normalized CRLF review authorizes the unchanged raw plan and applies once", async () => {
  let applied; const result = editor({ apply: async plan => { applied = plan; return true; } }); choose(result, ['target', 'deep'], 'copy Ω'); assert.equal(result.review.value.includes('\r'), false); result.apply.fire('click'); await Promise.resolve(); await Promise.resolve(); assert.equal(applied.source, plan(original, 'copy-to', ['map','branch λ'], ['target','deep'], 'copy Ω').source); assert.ok(applied.review.includes('\r\n')); assert.equal(result.state.closed, 1);
});
test("unreviewed destination/key mutations and visible/raw review changes refuse Apply", () => {
  for (const alteration of ['key', 'destination', 'review']) { const result = editor(); choose(result, ['target', 'deep'], 'copy Ω'); if (alteration === 'key') result.key.value = 'unreviewed'; else if (alteration === 'destination') result.destination.value = '["map"]'; else result.review.value += '\nchanged'; result.apply.fire('click'); assert.equal(result.state.applies, 0); assert.match(result.errors.at(-1), /destination or source changed/); }
  let changed = false; const result = editor({ plan: operation => { const candidate = transfers.planStructuredPropertyTransfer(original, 'opaque', value(original), operation); return changed ? { ...candidate, source: candidate.source.replaceAll('\r\n','\n'), review: candidate.review.replaceAll('\r\n','\n') } : candidate; } }); choose(result, ['target','deep'], 'copy Ω'); changed = true; result.apply.fire('click'); assert.equal(result.state.applies, 0); assert.match(result.errors.at(-1), /destination or source changed/);
});
test("stale owners, composition and invalid indexes refuse before the ordinary mutation queue", () => {
  const result = editor(); choose(result, ['list'], '0'); result.state.current = false; result.apply.fire('click'); assert.equal(result.state.applies, 0); assert.match(result.errors.at(-1), /owner changed/); result.state.current = true; result.key.fire('compositionstart'); result.apply.fire('click'); result.e.element.fire('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }); assert.equal(result.state.applies, 0); result.key.fire('compositionend'); result.key.value = '99'; result.key.fire('input'); assert.equal(result.apply.disabled, true); assert.match(result.review.value, /insertion index/);
});
test("pending Apply locks all destination controls, Cancel and repeated actions", async () => {
  let resolve, applies = 0; const gate = new Promise(done => resolve = done), result = editor({ apply: async () => { applies++; await gate; return true; } }); choose(result, ['target','deep'], 'copy Ω'); result.apply.fire('click'); for (const control of [result.destination, result.key, result.apply, result.cancel]) assert.equal(control.disabled, true); result.apply.fire('click'); result.cancel.fire('click'); assert.equal(applies, 1); assert.equal(result.state.closed, 0); resolve(); await gate; await Promise.resolve(); assert.equal(result.state.closed, 1);
});
test("actual inspector exposes transfer and Source-review actions with independent read-only handler guards", () => {
  for (const writable of [true, false]) { const document = fakeDocument(), model = structured.structuredPropertyModel(value(original), original, 'opaque'); let opened = 0, sourced = 0;
    const inspector = structured.createStructuredEditorInspector(document, model.entries, 'opaque', false, { writable, current: () => true, edit() {}, sourceWritable: writable, source() { sourced++; }, operations: { ...operations.structuredPropertyOperationTargets(original,'opaque',value(original)), ...targets(original), open(kind) { assert.equal(kind,'copy-to'); opened++; } } });
    const nodes = all(inspector), copy = nodes.find(n => n.dataset?.propertyStructuredCopyTo === '["map","branch λ"]'), source = nodes.find(n => n.dataset?.propertyStructuredSource === '{"kind":"copy-to","path":["map","branch λ"]}'); assert.ok(copy && source); assert.equal(copy.disabled,!writable); assert.equal(source.disabled,!writable); copy.disabled = source.disabled = false; copy.fire('click'); source.fire('click'); assert.equal(opened,writable?1:0); assert.equal(sourced,writable?1:0);
  }
});
