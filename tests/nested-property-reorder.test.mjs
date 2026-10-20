import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) { try { return next(specifier, context); } catch (issue) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context); throw issue; } },
  load(url, context, next) { if (!url.includes("/client/") || !url.endsWith(".ts")) return next(url, context); return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform" }) }; }
});
const operations = await import("../client/structured-property-operations.ts"), structured = await import("../client/structured-properties.ts");
const { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts");
const { assertNestedPropertyReorderTrace } = await import("../tools/nested-property-reorder-scenarios.mjs");
const original = '\ufeff---\r\n# Keep outer λ\r\nopaque:\r\n  map:\r\n    first: 1.50 # first λ\r\n    "second Ω": { inner: [one, false] } # second subtree\r\n    third: >- # third multiline\r\n      Exact first\r\n      next 😀\r\n  list:\r\n    - one # one comment\r\n    - { nested: [false, 1.50] } # subtree\r\n    - # implicit null\r\n  flow: { first: 1.50 , "second Ω": false,third: null } # flow outer\r\n  flowList: ["quoted", one ,false, -0]\r\n  singleton: { only: true }\r\n  empty: []\r\nunknown: &shared { exact: kept }\r\nalias: *shared\r\n---\r\n# Body 😀\r\n\r\nKeep exact body.\r\n';
const value = source => parseMarkdown(source).frontmatter?.opaque;
const plan = (source, kind, path) => operations.planStructuredPropertyOperation(source, "opaque", value(source), { kind, path });
const targets = source => operations.structuredPropertyOperationTargets(source, "opaque", value(source));

test("block mapping reordering moves the exact Unicode entry and descendant/comment text without rewriting YAML", () => {
  const left = '    first: 1.50 # first λ\r\n', right = '    "second Ω": { inner: [one, false] } # second subtree\r\n';
  for (const [kind,path] of [["move-down",["map","first"]],["move-up",["map","second Ω"]]]) {
    const moved=plan(original,kind,path);assert.equal(moved.source,original.replace(left+right,right+left));
    assert.deepEqual(moved.next,value(original));assert.match(moved.review,/Exact adjacent entries before:/);assert.match(moved.review,/After reordering:/);assert.match(moved.review,/# first λ/);assert.match(moved.review,/# second subtree/);
    assert.deepEqual(Object.keys(value(moved.source).map),["second Ω","first","third"]);assert.ok(moved.source.startsWith('\ufeff'));assert.ok(moved.source.endsWith('Keep exact body.\r\n'));
  }
});

test("block list reordering retains complete container/implicit-null entries and inline comments", () => {
  const left='    - one # one comment\r\n',middle='    - { nested: [false, 1.50] } # subtree\r\n',right='    - # implicit null\r\n';
  const moved=plan(original,"move-up",["list",1]);assert.equal(moved.source,original.replace(left+middle,middle+left));assert.deepEqual(moved.next.list,[{nested:[false,1.5]},"one",null]);
  const implicit=plan(original,"move-up",["list",2]);assert.equal(implicit.source,original.replace(middle+right,right+middle));assert.deepEqual(implicit.next.list,["one",null,{nested:[false,1.5]}]);
  assert.equal(plan(moved.source,"move-down",["list",0]).source,original);assert.equal(plan(implicit.source,"move-down",["list",1]).source,original);
});

test("a multiline block scalar travels with its original header, indentation, spelling and inline comment", () => {
  const second='    "second Ω": { inner: [one, false] } # second subtree\r\n',third='    third: >- # third multiline\r\n      Exact first\r\n      next 😀\r\n';
  const moved=plan(original,"move-up",["map","third"]);assert.equal(moved.source,original.replace(second+third,third+second));assert.equal(value(moved.source).map.third,value(original).map.third);
  assert.equal(plan(moved.source,"move-down",["map","third"]).source,original);
});

test("single-line flow map and list swaps preserve separators, numeric/null/negative-zero tokens and surrounding whitespace", () => {
  const moved=plan(original,"move-down",["flow","first"]);assert.equal(moved.source,original.replace('first: 1.50 , "second Ω": false','"second Ω": false , first: 1.50'));assert.deepEqual(Object.keys(value(moved.source).flow),["second Ω","first","third"]);
  const last=plan(original,"move-up",["flowList",3]);assert.equal(last.source,original.replace('false, -0','-0, false'));assert.ok(Object.is(last.next.flowList[2],-0));assert.equal(last.next.flowList[3],false);
  assert.equal(plan(moved.source,"move-up",["flow","first"]).source,original);assert.equal(plan(last.source,"move-down",["flowList",2]).source,original);
});

test("semantically identical quoted/plain list entries still reorder their exact source spellings", () => {
  const source='---\nopaque: { list: ["same", same] }\n---\nbody\n',moved=plan(source,"move-down",["list",0]);
  assert.deepEqual(moved.next,value(source));assert.equal(moved.source,source.replace('["same", same]','[same, "same"]'));assert.notEqual(moved.source,source);
});

test("the queued frontmatter candidate is validated semantically while the exact reordered splice is retained", () => {
  for(const[kind,path]of[["move-down",["map","first"]],["move-up",["list",1]],["move-down",["flow","first"]]]){
    const moved=plan(original,kind,path),candidate=updateFrontmatter(original,fm=>{fm.opaque=moved.next;});
    assert.equal(operations.preserveStructuredPropertyOperationSource(candidate,original,"opaque",{kind,path}),moved.source);
    assert.throws(()=>operations.preserveStructuredPropertyOperationSource(updateFrontmatter(candidate,fm=>{fm.extra=true;}),original,"opaque",{kind,path}));
    assert.throws(()=>operations.preserveStructuredPropertyOperationSource(updateFrontmatter(candidate,fm=>{fm.opaque.map.first=99;}),original,"opaque",{kind,path}));
  }
});

test("target discovery exposes safe directions and explicitly records disabled first/last/singleton boundaries",()=>{
  const t=targets(original);assert.deepEqual(t.moves.get('["map","first"]'),{up:false,down:true});assert.deepEqual(t.moves.get('["map","third"]'),{up:true,down:false});
  assert.deepEqual(t.moves.get('["singleton","only"]'),{up:false,down:false});assert.equal(t["move-up"].has('["list",1]'),true);assert.equal(t["move-down"].has('["list",2]'),false);
  for(const[kind,path]of[["move-up",["map","first"]],["move-down",["list",2]],["move-up",["singleton","only"]]])assert.throws(()=>plan(original,kind,path),/beginning or end/);
});

for(const gap of ['  # ambiguous standalone\n','\n','  \n'])test("standalone comment/blank gap refuses both directions: "+JSON.stringify(gap),()=>{
  const source='---\nopaque:\n  first: 1\n'+gap+'  second: false\n---\nbody\n',t=targets(source);
  for(const[kind,path]of[["move-down",["first"]],["move-up",["second"]]]){assert.throws(()=>plan(source,kind,path),/ownership|safely/);assert.equal(t[kind].has(JSON.stringify(path)),false);assert.match(t.limits.get(JSON.stringify(path)),/ownership/);}
});

for(const[body,expected]of[['{ first: 1,\n second: false }','{ second: false,\n first: 1 }'],['{ first: 1, second: false, }','{ second: false, first: 1, }']])test("proven mixed and inline trailing-comma flow supports exact adjacent move and reverse: "+JSON.stringify(body),()=>{
  const source='---\nopaque: '+body+'\n---\nbody\n',moved=plan(source,"move-down",["first"]);assert.equal(moved.source,source.replace(body,expected));assert.deepEqual(moved.next,{second:false,first:1});assert.equal(targets(source)["move-down"].has('["first"]'),true);assert.equal(plan(moved.source,"move-up",["first"]).source,source);
  const candidate=updateFrontmatter(source,fm=>{fm.opaque=moved.next;});assert.equal(operations.preserveStructuredPropertyOperationSource(candidate,source,"opaque",{kind:"move-down",path:["first"]}),moved.source);
});

for(const body of ['\n  ? first\n  : 1\n  second: false','\n  first: &same 1\n  second: *same','{ first: !!str 1, second: false }','{ first: 1, first: 2 }','{ constructor: 1, second: false }'])test("unproven, aliased, tagged, duplicate or unsafe layout stays Source-only: "+JSON.stringify(body),()=>{
  const source='---\nopaque: '+body+'\n---\nbody\n';assert.throws(()=>plan(source,"move-down",["first"]));assert.equal(targets(source)["move-down"].size,0);
});

test("unrelated standalone comments outside the swapped pair remain exact and do not authorize moving across that gap",()=>{
  const source='---\nopaque:\n  first: 1 # a\n  second: false # b\n\n  # stationary comment\n  third: null # c\n---\nbody\n';
  assert.equal(plan(source,"move-down",["first"]).source,source.replace('  first: 1 # a\n  second: false # b\n','  second: false # b\n  first: 1 # a\n'));assert.throws(()=>plan(source,"move-down",["second"]));
});

test("reordering refuses invalid operation descriptors, paths and foreign fields without invoking accessors",()=>{
  let reads=0;const getter=Object.defineProperty({path:["map","first"]},"kind",{enumerable:true,get(){reads++;return"move-down";}});
  const path=["map","first"];Object.defineProperty(path,0,{get(){reads++;return"map";}});
  for(const operation of [getter,{kind:"move-down",path},{kind:"move-down",path:[]},{kind:"move-down",path:["list",-1]},{kind:"move-down",path:["constructor"]},{kind:"move-down",path:["map","first"],direction:1},{kind:"move-sideways",path:["map","first"]}])assert.throws(()=>operations.planStructuredPropertyOperation(original,"opaque",value(original),operation));
  assert.equal(reads,0);
});

test("the planner never mutates caller values or operations and rejects stale snapshots",()=>{
  const before=value(original),operation={kind:"move-up",path:["list",1]},copy=structuredClone(before),operationCopy=structuredClone(operation);
  operations.planStructuredPropertyOperation(original,"opaque",before,operation);assert.deepEqual(before,copy);assert.deepEqual(operation,operationCopy);
  assert.throws(()=>operations.planStructuredPropertyOperation(original,"opaque",{...before,extra:true},operation),/changed/);
});

test("complete adjacent source review remains bounded rather than silently truncating either moved entry",()=>{
  const source='---\nopaque:\n  first: "'+"x".repeat(2300)+'"\n  second: "'+"y".repeat(2300)+'"\n---\nbody\n',t=targets(source);
  assert.ok(structured.structuredPropertyModel(value(source),source,"opaque"));assert.throws(()=>plan(source,"move-down",["first"]),/too large/);assert.equal(t["move-down"].has('["first"]'),false);assert.match(t.limits.get('["first"]'),/review limit/);
});

function fakeDocument(){
  const create=tag=>({tagName:tag,dataset:{},children:[],listeners:{},isConnected:true,append(...nodes){for(const n of nodes){if(typeof n==='object')n.parentElement=this;this.children.push(n);}},setAttribute(k,v){this[k]=v;},addEventListener(k,v){(this.listeners[k]??=[]).push(v);},fire(k,event={}){for(const fn of this.listeners[k]??[])fn({preventDefault(){},...event});},remove(){this.isConnected=false;},checkVisibility(){return true;},contains(n){return n===this||this.children.some(c=>typeof c==='object'&&c.contains?.(n));},get lastElementChild(){return this.children.at(-1)},insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child);child.parentElement=this;}});
  return{createElement:create,createTextNode:text=>({textContent:text})};
}
const all=node=>[node,...(node.children??[]).filter(n=>typeof n==='object').flatMap(all)];
test("actual inspector shows disabled boundary/read-only controls and forced handlers cannot open an unavailable reorder",()=>{
  for(const writable of [true,false]){const document=fakeDocument(),model=structured.structuredPropertyModel(value(original),original,"opaque"),t=targets(original);let opened=0,sourced=0;
    const inspector=structured.createStructuredEditorInspector(document,model.entries,"opaque",false,{writable,current:()=>true,sourceWritable:writable,source(){sourced++;},edit(){},operations:{...t,open(){opened++;}}});
    const nodes=all(inspector),up=nodes.find(n=>n.dataset?.propertyStructuredMoveUp==='["map","first"]'),down=nodes.find(n=>n.dataset?.propertyStructuredMoveDown==='["map","first"]');
    assert.ok(up&&down);assert.equal(up.disabled,true);assert.equal(down.disabled,!writable);up.disabled=false;up.fire('click');assert.equal(opened,0);
    const boundary=nodes.find(n=>n.dataset?.propertyStructuredSource==='{"kind":"move-up","path":["map","first"]}');assert.ok(boundary);assert.equal(boundary.disabled,true);boundary.disabled=false;boundary.fire('click');assert.equal(sourced,0);
    down.fire('click');assert.equal(opened,writable?1:0);
  }
});

test("actual reorder editor is explicit Apply/Cancel, one-shot, busy-locked and rejects retired owners",async()=>{
  for(const via of ['Cancel','Escape']){const document=fakeDocument();let applies=0,closed=0;const editor=operations.createStructuredPropertyOperationEditor(document,{kind:"move-up",path:["list",1],label:"opaque list",current:()=>true,plan:o=>operations.planStructuredPropertyOperation(original,"opaque",value(original),o),apply:async()=>{applies++;return true;},error(){},closed(){closed++;}});assert.match(editor.input.value,/Move \["opaque","list",1\] up/);assert.equal(applies,0);if(via==='Cancel')all(editor.element).find(n=>n.textContent==='Cancel').fire('click');else editor.element.fire('keydown',{key:'Escape'});assert.equal(applies,0);assert.equal(closed,1);assert.equal(editor.active,false);}
  let resolve;const gate=new Promise(done=>resolve=done),document=fakeDocument(),errors=[];let current=true,applies=0,closed=0;
  const editor=operations.createStructuredPropertyOperationEditor(document,{kind:"move-up",path:["list",1],label:"opaque list",current:()=>current,plan:o=>operations.planStructuredPropertyOperation(original,"opaque",value(original),o),apply:async()=>{applies++;await gate;return true;},error:e=>errors.push(e),closed(){closed++;}}),apply=all(editor.element).find(n=>n.textContent==='Apply reorder'),cancel=all(editor.element).find(n=>n.textContent==='Cancel');
  current=false;apply.fire('click');assert.equal(applies,0);assert.match(errors.at(-1),/changed/);current=true;apply.fire('click');assert.equal(applies,1);assert.equal(apply.disabled,true);assert.equal(cancel.disabled,true);apply.fire('click');cancel.fire('click');assert.equal(applies,1);assert.equal(closed,0);resolve();await gate;await Promise.resolve();assert.equal(closed,1);assert.equal(editor.active,false);apply.fire('click');assert.equal(applies,1);
});

const acceptedTrace=()=>({calls:["list-apply","map-apply","flow-apply","persisted-flow-apply"].map(phase=>({path:"Nested reorder/Source.md",phase,settled:true})),events:[...Array.from({length:21},()=>({type:"click",trusted:true,probe:null})),...Array.from({length:5},(_,i)=>({type:"click",trusted:false,probe:"forced boundary "+i}))]});
test("runtime acceptance accounts for exactly the declared four successful Apply stages",()=>{assert.doesNotThrow(()=>assertNestedPropertyReorderTrace(acceptedTrace(),"Nested reorder/Source.md"));});
test("runtime acceptance refuses omitted, duplicated or additional queue calls",()=>{for(const change of [t=>t.calls.pop(),t=>t.calls.push({...t.calls[0]}),t=>t.calls.splice(2,0,{...t.calls[1]})]){const t=acceptedTrace();change(t);assert.throws(()=>assertNestedPropertyReorderTrace(t,"Nested reorder/Source.md"));}});
test("runtime acceptance refuses foreign targets and unsettled or rejected positive calls",()=>{for(const patch of [{path:"Another.md"},{settled:false},{reason:"unexpected transport failure"}]){const t=acceptedTrace();Object.assign(t.calls[1],patch);assert.throws(()=>assertNestedPropertyReorderTrace(t,"Nested reorder/Source.md"));}});
test("runtime acceptance refuses reordered or mislabeled positive stages",()=>{for(const change of [t=>t.calls.reverse(),t=>t.calls[1].phase="stale-refusal",t=>delete t.calls[0].phase]){const t=acceptedTrace();change(t);assert.throws(()=>assertNestedPropertyReorderTrace(t,"Nested reorder/Source.md"));}});
test("runtime acceptance refuses untrusted positive input or insufficient genuine events",()=>{for(const change of [t=>t.events[0].trusted=false,t=>t.events.splice(0,1)]){const t=acceptedTrace();change(t);assert.throws(()=>assertNestedPropertyReorderTrace(t,"Nested reorder/Source.md"));}});
test("runtime acceptance keeps five forced-handler negatives separate from trusted positive input",()=>{for(const change of [t=>t.events.pop(),t=>t.events.at(-1).trusted=true,t=>t.events.at(-1).type="pointerdown",t=>t.events.at(-1).probe=null]){const t=acceptedTrace();change(t);assert.throws(()=>assertNestedPropertyReorderTrace(t,"Nested reorder/Source.md"));}});
