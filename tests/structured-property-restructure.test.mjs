import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { build } from 'esbuild';
import { EditorState, Transaction } from '@codemirror/state';
import { history, historyField, undo, undoDepth, redoDepth } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { errorLogStub } from './error-log-stub.mjs';

registerHooks({
  resolve(specifier, context, next) { try { return next(specifier, context); } catch (issue) { if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context); throw issue; } },
  load(url, context, next) { if (!url.includes('/client/') || !url.endsWith('.ts')) return next(url, context); return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }) }; }
});
const api = await import('../client/structured-property-restructure.ts'), structured = await import('../client/structured-properties.ts'), operations = await import('../client/structured-property-operations.ts');
const { parseMarkdown, updateFrontmatter } = await import('../client/markdown.ts');
const source = '\ufeff---\r\n# Retain λ\r\nstructured:\r\n  first: 1.50 # exact number\r\n  middle:\r\n    "child λ":\r\n      inner: [one, false, -0] # inner 😀\r\n      text: \'literal Ω\'\r\n  list:\r\n    - before\r\n    -\r\n      - 1.50 # list number\r\n      - { child: false } # list subtree\r\n    - after\r\n  singleMap:\r\n    "only Ω": |2- # header\r\n      First 😀\r\n      Second λ\r\n  singleList:\r\n    - false # sole child\r\n  singleFlow: { "only Ω": [same, -0,] } # outer header\r\n  flow: { before: 1.50, wrapper: { "promoted Ω": -0, inner: [true, same], }, last: ~, }\r\n  flowList: [one, [false, -0,], last,]\r\n  flowToBlock: { flowA: 1.50, flowB: -0 }\r\n  collision: { FIRST: true }\r\n  empty: {}\r\n  implicit: # keep null\r\n  blocked:\r\n    # ambiguous ownership\r\n    first: true\r\nunknown: &shared { exact: 0.10000000000000001 } # outside property\r\nalias: *shared\r\n---\r\n# Body 😀\r\n\r\nUntouched.\r\n';
const value = text => parseMarkdown(text).frontmatter.structured;
const run = (text, kind = 'wrap-map', path = ['first'], key = 'child Ω') => api.planStructuredPropertyRestructure(text, 'structured', value(text), kind === 'wrap-map' ? { kind, path, key } : { kind, path });
const targets = text => api.structuredPropertyRestructureTargets(text, 'structured', value(text));
const wrapped = source.replace('first: 1.50', 'first: { "child Ω": 1.50 }');

function scenarioExpressions(text) {
  const result = [], deferred = [], substitutions = { sourceView: 'globalThis.sourceView', peerView: 'globalThis.peerView', session: 'globalThis.sourceView.session', trace: 'globalThis.trace', parent: 'globalThis.parent', cached: 'globalThis.cached' };
  // Read only literal arguments from this known scenario grammar. Template
  // substitutions become syntactically valid witnesses; their original surrounding
  // JavaScript, including every closing brace, is still compiled independently.
  const quotedEnd = (start, quote) => { let at = start + 1; for (; at < text.length; at++) { if (text[at] === '\\') { at++; continue; } if (text[at] === quote) return at + 1; } throw Error('Unclosed scenario literal'); };
  const expressionEnd = start => { let depth = 1; for (let at = start; at < text.length; at++) { const c = text[at]; if (c === '"' || c === "'") { at = quotedEnd(at,c)-1; continue; } if (c === '{') depth++; if (c === '}' && --depth === 0) return at; } throw Error('Unclosed scenario substitution'); };
  const literal = start => {
    const quote = text[start]; if (quote === '"' || quote === "'") { const end = quotedEnd(start,quote); return { expression: new Script(text.slice(start,end)).runInNewContext(), end }; }
    if (quote !== '`') return null;
    let at = start + 1, chunk = at, expression = '';
    const decoded = value => new Script('`'+value+'`').runInNewContext();
    for (; at < text.length; at++) {
      if (text[at] === '\\') { at++; continue; }
      if (text[at] === '`') return { expression: expression + decoded(text.slice(chunk,at)), end: at+1 };
      if (text[at] === '$' && text[at+1] === '{') {
        expression += decoded(text.slice(chunk,at)); const end = expressionEnd(at+2), input = text.slice(at+2,end).trim();
        expression += substitutions[input] ?? (/^(?:q|JSON\.stringify)\(/.test(input) ? '"script-compile-fixture"' : '0'); at = end; chunk = end+1;
      }
    }
    throw Error('Unclosed scenario template');
  };
  const cached = /const cachedSnapshot\s*=\s*/g.exec(text), cachedValue = cached ? literal(cached.index+cached[0].length)?.expression : undefined;
  const calls = /\b(?:tools\.)?(?:evaluate|wait)\s*\(\s*/g;
  for (const match of text.matchAll(calls)) {
    const at = match.index + match[0].length, line = text.slice(0,match.index).split('\n').length, value = literal(at);
    if (value) result.push({ expression: value.expression, line });
    else if (/^cachedSnapshot\b/.test(text.slice(at)) && cachedValue !== undefined) result.push({ expression: cachedValue, line });
    else deferred.push({ argument: text.slice(at,text.indexOf('\n',at)).slice(0,160), line });
  }
  return { result, deferred };
}
test('Generated scenario evaluate/wait expressions compile independently of the module parser', () => {
  const content = readFileSync(new URL('../tools/structured-property-restructure-scenarios.mjs',import.meta.url),'utf8'), expressions = scenarioExpressions(content), errors = [];
  for (const { expression, line } of expressions.result) try { new Script(expression, { filename: `structured-property-restructure-scenarios.mjs:${line}` }); } catch (issue) { errors.push({ line, message: issue.message, expression }); }
  assert.ok(expressions.result.length >= 90, 'Compile all inline script literals and generated templates, not only one known failing expression');
  assert.deepEqual(errors, []);
  for (const item of expressions.deferred) assert.match(item.argument, /^(?:nestedPositionInnerRevealExpression|nestedPropertyMultilinePointerExpression|structuredPropertyRestructureApplyProofExpression)\(/, 'Only explicitly inspected expression builders may bypass literal/template scanning');
  console.log('Restructure expression audit: ' + JSON.stringify({ compiled: expressions.result.length, delegatedBuilders: expressions.deferred }));
});

test('Wrap in Map and List keep the selected outer position and exact scalar spelling, comments, BOM/CRLF and unrelated aliases', () => {
  const map = run(source); assert.equal(map.source, wrapped); assert.deepEqual(map.next.first, { 'child Ω': 1.5 });
  assert.match(map.review, /New child map key: "child Ω"/); assert.match(map.review, /Exact source removed:\n1\.50/); assert.ok(map.source.startsWith('\ufeff'));
  const list = run(source, 'wrap-list', ['first']); assert.equal(list.source, source.replace('first: 1.50', 'first: [1.50]')); assert.deepEqual(list.next.first, [1.5]);
  assert.equal(map.source.replaceAll('\r\n', '').includes('\n'), false); assert.equal(map.source.slice(map.source.indexOf('unknown:')), source.slice(source.indexOf('unknown:')));
});
test('Block subtree wrap shifts only structural indentation and round-trip unwrap restores the exact source', () => {
  const selected = '    "child λ":\r\n      inner: [one, false, -0] # inner 😀\r\n      text: \'literal Ω\'\r\n';
  for (const kind of ['wrap-map', 'wrap-list']) {
    const replacement = (kind === 'wrap-map' ? '    "child Ω":\r\n' : '    -\r\n') + selected.split('\r\n').map(line => line ? '  ' + line : line).join('\r\n');
    const result = run(source, kind, ['middle']); assert.equal(result.source, source.replace(selected, replacement));
    assert.equal(run(result.source, 'unwrap-value', ['middle']).source, source); assert.ok(Object.is((kind === 'wrap-map' ? result.next.middle['child Ω'] : result.next.middle[0])['child λ'].inner[2], -0));
  }
});
test('Block scalar wrap/unwrap retains explicit indentation indicator, chomping, header and decoded text', () => {
  const original = '    "only Ω": |2- # header\r\n      First 😀\r\n      Second λ\r\n';
  const result = run(source, 'wrap-list', ['singleMap', 'only Ω']);
  assert.equal(result.source, source.replace(original, '    "only Ω":\r\n      - |2- # header\r\n        First 😀\r\n        Second λ\r\n'));
  assert.equal(result.next.singleMap['only Ω'][0], value(source).singleMap['only Ω']); assert.equal(run(result.source, 'unwrap-value', ['singleMap', 'only Ω']).source, source);
});
test('Plain block strings with flow punctuation get a block wrapper without rewriting their scalar lexeme', () => {
  const text = '---\r\nstructured:\r\n  value: exact, [text] {here} # child\r\n---\r\n';
  assert.equal(run(text, 'wrap-list', ['value']).source, text.replace('  value: exact, [text] {here} # child\r\n', '  value:\r\n    - exact, [text] {here} # child\r\n'));
});
test('Singleton Map and List unwrap explicitly discard the inner key/index and retain owned child comments and strings', () => {
  const map = run(source, 'unwrap-value', ['singleMap']);
  assert.equal(map.source, source.replace('  singleMap:\r\n    "only Ω": |2- # header\r\n      First 😀\r\n      Second λ\r\n', '  singleMap: |2- # header\r\n    First 😀\r\n    Second λ\r\n'));
  assert.match(map.review, /Discard the sole inner map key "only Ω"/); assert.equal(map.next.singleMap, value(source).singleMap['only Ω']);
  const list = run(source, 'unwrap-value', ['singleList']); assert.equal(list.source, source.replace('  singleList:\r\n    - false # sole child\r\n', '  singleList: false # sole child\r\n')); assert.match(list.review, /list index 0/);
  assert.equal(run(source, 'unwrap-value', ['singleFlow']).source, source.replace('{ "only Ω": [same, -0,] }', '[same, -0,]'));
});
test('Promote Map entries replaces the wrapper at its exact position without changing raw descendant lexemes or child comments', () => {
  const before = '  middle:\r\n    "child λ":\r\n      inner: [one, false, -0] # inner 😀\r\n      text: \'literal Ω\'\r\n', after = '  "child λ":\r\n    inner: [one, false, -0] # inner 😀\r\n    text: \'literal Ω\'\r\n';
  const result = run(source, 'promote-entries', ['middle']); assert.equal(result.source, source.replace(before, after)); assert.equal(Object.hasOwn(result.next, 'middle'), false); assert.deepEqual(result.next['child λ'], value(source).middle['child λ']);
  assert.deepEqual(structured.structuredPropertyModel(result.next, result.source, 'structured').entries.slice(0, 3).map(entry => entry.label), ['first', 'child λ', 'list']); assert.match(result.review, /No existing entry is overwritten/);
});
test('Promote List entries preserves before/after order, scalar precision, negative zero and inline child comments', () => {
  const result = run(source, 'promote-entries', ['list', 1]);
  assert.equal(result.source, source.replace('    -\r\n      - 1.50 # list number\r\n      - { child: false } # list subtree\r\n', '    - 1.50 # list number\r\n    - { child: false } # list subtree\r\n'));
  assert.deepEqual(result.next.list, ['before', 1.5, { child: false }, 'after']);
  const flow = run(source, 'promote-entries', ['flowList', 1]); assert.equal(flow.source, source.replace('[one, [false, -0,], last,]', '[one, false, -0, last,]')); assert.ok(Object.is(flow.next.flowList[2], -0));
});
test('Flow Map promotion retains inner separator spelling and parent trailing comma, including mixed multiline flow', () => {
  const result = run(source, 'promote-entries', ['flow', 'wrapper']); assert.equal(result.source, source.replace('wrapper: { "promoted Ω": -0, inner: [true, same], }', '"promoted Ω": -0, inner: [true, same]'));
  const mixed = source.replace('flowList: [one, [false, -0,], last,]', 'flowList: [one, [false,\r\n    -0,], last,]');
  const list = run(mixed, 'promote-entries', ['flowList', 1]); assert.equal(list.source, mixed.replace('[false,\r\n    -0,]', 'false,\r\n    -0'));
  assert.ok(Object.is(result.next.flow['promoted Ω'], -0));
});
test('Single-line flow children can promote to a block parent while preserving keys and exact payload spelling', () => {
  const result = run(source, 'promote-entries', ['flowToBlock']); assert.equal(result.source, source.replace('  flowToBlock: { flowA: 1.50, flowB: -0 }\r\n', '  flowA: 1.50\r\n  flowB: -0\r\n')); assert.ok(Object.is(result.next.flowB, -0));
});
test('Promotion refuses case-insensitive sibling and promoted-child collisions, empty or incompatible containers', () => {
  assert.throws(() => run(source, 'promote-entries', ['collision']), /collides/);
  assert.throws(() => run(source.replace('collision: { FIRST: true }', 'collision: { duplicate: true, DUPLICATE: false }'), 'promote-entries', ['collision']), /collides/);
  for (const path of [['empty'], ['list'], ['first']]) assert.throws(() => run(source, 'promote-entries', path));
  assert.equal(targets(source)['promote-entries'].has('["collision"]'), false);
});
test('Discarded wrapper comments, standalone ownership gaps, compact blocks and implicit-null wraps remain Source-only', () => {
  for (const changed of [source.replace('  middle:\r\n', '  middle: # wrapper header\r\n'), source.replace('flowToBlock: { flowA: 1.50, flowB: -0 }', 'flowToBlock: { flowA: 1.50, flowB: -0 } # wrapper')]) {
    assert.throws(() => run(changed, 'promote-entries', changed.includes('middle: #') ? ['middle'] : ['flowToBlock']), /comment|unowned/i);
  }
  assert.throws(() => run(source, 'unwrap-value', ['blocked']), /Comments|ownership/); assert.throws(() => run(source, 'wrap-list', ['implicit']), /implicit empty/);
  const compact = '---\nstructured:\n  list:\n    - key: value\n---\n'; assert.throws(() => run(compact, 'wrap-list', ['list', 0]), /Compact|proof/);
  assert.equal(targets(source)['wrap-map'].has('["blocked","first"]'), false); assert.equal(targets(source)['wrap-map'].has('["blocked"]'), false); assert.equal(targets(source)['unwrap-value'].has('["empty"]'), false);
});
test('Unsafe/getter/extra operation fields and stale property snapshots fail before effects', () => {
  let read = 0; const getter = {}; Object.defineProperty(getter, 'kind', { enumerable: true, get() { read++; return 'wrap-list'; } });
  for (const operation of [getter, { kind: 'wrap-list', path: ['first'], key: 'extra' }, { kind: 'wrap-map', path: ['first'], key: '__proto__' }, { kind: 'wrap-map', path: ['first'], key: '' }, { kind: 'wrap-list', path: [] }, { kind: 'wrap-list', path: ['constructor'] }]) assert.throws(() => api.planStructuredPropertyRestructure(source, 'structured', value(source), operation));
  assert.equal(read, 0); assert.throws(() => api.planStructuredPropertyRestructure(source.replace('first: 1.50', 'first: 2.50'), 'structured', value(source), { kind: 'wrap-list', path: ['first'] }), /source changed/);
});
test('Final descriptor budgets refuse another wrapper at maximum depth and complete review is never truncated', () => {
  const deep = '---\nstructured: { a: { b: { c: { d: { e: { f: { g: { h: true } } } } } } } }\n---\n';
  assert.throws(() => run(deep, 'wrap-list', ['a','b','c','d','e','f','g','h'])); assert.equal(targets(deep)['wrap-list'].has('["a","b","c","d","e","f","g","h"]'), false);
  const long = '---\nstructured:\n  wrapper: { a: "' + 'a'.repeat(3000) + '", b: "' + 'b'.repeat(3000) + '" }\n---\n'; assert.throws(() => run(long, 'wrap-list', ['wrapper']), /review limit/); assert.equal(targets(long)['wrap-list'].has('["wrapper"]'), false);
});
test('Queue serialization transforms prove the entire frontmatter and cannot silently rebase another root or decoded value', () => {
  const result = run(source), serialized = updateFrontmatter(source, values => { values.structured = result.next; });
  assert.equal(api.preserveStructuredPropertyRestructureSource(serialized, source, 'structured', result.operation), result.source);
  assert.throws(() => api.preserveStructuredPropertyRestructureSource(serialized.replace('Body 😀', 'Changed body'), source, 'structured', { ...result.operation, key: 'other' }));
  assert.throws(() => api.preserveStructuredPropertyRestructureSource(serialized.replace('exact: 0.1', 'exact: 0.2'), source, 'structured', result.operation));
});

function fakeDocument() { const create = tag => { const node = { tagName: tag, dataset: {}, children: [], listeners: {}, isConnected: true, value: '', focus() {}, append(...nodes) { for (const child of nodes) { if (typeof child === 'object') child.parentElement = this; this.children.push(child); } }, setAttribute(key, value) { this[key] = value; }, addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }, fire(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener({ preventDefault() {}, ...event }); }, remove() { this.isConnected = false; }, checkVisibility() { return true; }, contains(child) { return child === this || this.children.some(n => typeof n === 'object' && n.contains?.(child)); }, get lastElementChild() { return this.children.at(-1); }, insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); } }; let text = ''; Object.defineProperty(node, 'textContent', { get: () => text, set: value => { text = value; node.children = []; } }); if (tag === 'textarea') { let value = ''; Object.defineProperty(node, 'value', { get: () => value, set: next => { value = String(next).replace(/\r\n?/g, '\n'); } }); } return node; }; return { createElement: create, createTextNode: text => ({ textContent: text }) }; }
const all = node => [node, ...(node.children ?? []).flatMap(child => typeof child === 'object' ? all(child) : [])];
function editor(overrides = {}) { const state = { current: true, applies: 0, closed: 0 }, errors = [], e = api.createStructuredPropertyRestructureEditor(fakeDocument(), { kind: 'wrap-map', path: ['first'], label: 'structured first', current: () => state.current, plan: operation => api.planStructuredPropertyRestructure(source, 'structured', value(source), operation), apply: async () => { state.applies++; return true; }, error: message => errors.push(message), closed: () => state.closed++, ...overrides }); const find = key => all(e.element).find(n => Object.hasOwn(n.dataset ?? {}, key)); return { e, state, errors, key: find('propertyStructuredRestructureKey'), review: find('propertyStructuredRestructureReview'), apply: find('propertyStructuredApply'), cancel: find('propertyStructuredCancel') }; }
test('Wrap Map requires a deliberately entered new child key and Cancel never invokes mutation', () => {
  const draft = editor(); assert.equal(draft.key.value, ''); assert.equal(draft.apply.disabled, true); draft.key.value = 'child Ω'; draft.key.fire('input'); assert.equal(draft.apply.disabled, false); assert.match(draft.review.value, /New child map key/); draft.cancel.fire('click'); assert.equal(draft.state.applies, 0); assert.equal(draft.state.closed, 1);
});
test('Raw reviewed source identity catches normalization-only drift even when a textarea displays identical LF', async () => {
  let changed = false; const draft = editor({ plan: operation => { const result = api.planStructuredPropertyRestructure(source, 'structured', value(source), operation); return changed ? { ...result, source: result.source.replaceAll('\r\n','\n'), review: result.review.replaceAll('\r\n','\n') } : result; } });
  draft.key.value = 'child Ω'; draft.key.fire('input'); changed = true; draft.apply.fire('click'); assert.equal(draft.state.applies, 0); assert.match(draft.errors.at(-1), /choice or source changed/);
});
test('Held owner, tampered review, IME and pending duplicate actions cannot authorize another write', async () => {
  const draft = editor(); draft.key.value = 'child Ω'; draft.key.fire('input'); draft.state.current = false; draft.apply.fire('click'); assert.match(draft.errors.at(-1), /owner changed/); draft.state.current = true; draft.review.value = 'Forged'; draft.apply.fire('click'); assert.equal(draft.state.applies, 0); draft.key.fire('compositionstart'); draft.apply.fire('click'); draft.e.element.fire('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }); assert.equal(draft.state.applies, 0); draft.key.fire('compositionend');
  let release, applies = 0; const pending = editor({ apply: async () => { applies++; await new Promise(done => release = done); return true; } }); pending.key.value = 'child Ω'; pending.key.fire('input'); pending.apply.fire('click'); for (const control of [pending.key, pending.apply, pending.cancel]) assert.equal(control.disabled, true); pending.apply.fire('click'); pending.cancel.fire('click'); assert.equal(applies, 1); assert.equal(pending.state.closed, 0); release(); await Promise.resolve(); await Promise.resolve(); assert.equal(pending.state.closed, 1);
});
test('All four production inspector actions and Source choices independently refuse forced read-only handlers', () => {
  for (const writable of [true, false]) { let opened = 0, sourced = 0; const model = structured.structuredPropertyModel(value(source), source, 'structured'), inspector = structured.createStructuredEditorInspector(fakeDocument(), model.entries, 'structured', false, { writable, current: () => true, edit() {}, sourceWritable: writable, source() { sourced++; }, operations: { ...operations.structuredPropertyOperationTargets(source,'structured',value(source)), ...targets(source), open() { opened++; } } }); const nodes = all(inspector);
    for (const [kind, data, path] of [['wrap-map','WrapMap',['first']],['wrap-list','WrapList',['first']],['unwrap-value','UnwrapValue',['singleList']],['promote-entries','PromoteEntries',['middle']]]) { const button = nodes.find(n => n.dataset?.['propertyStructured' + data] === JSON.stringify(path)), handoff = nodes.find(n => n.dataset?.propertyStructuredSource === JSON.stringify({ kind, path })); assert.ok(button && handoff); assert.equal(button.disabled, !writable); button.disabled = handoff.disabled = false; button.fire('click'); handoff.fire('click'); }
    assert.equal(opened, writable ? 4 : 0); assert.equal(sourced, writable ? 4 : 0);
  }
});

test('Both-host scenario expected texts are independent exact outcomes for every restructure workflow', async () => {
  const { structuredPropertyRestructureReadOnlyFixture: cached, structuredPropertyRestructureScenarioFixture: host } = await import('../tools/structured-property-restructure-scenarios.mjs');
  assert.equal(cached.source, host.original); assert.equal(cached.files.length, 1); assert.equal(cached.files[0][1], host.original); assert.equal(host.original.replaceAll('\r\n','').includes('\n'),false); assert.equal(host.sourceAddition,'\r\nEarlier Source λ.');
  for (const [kind,path,expected] of [['wrap-map',['first'],host.wrappedMap],['wrap-list',['middle'],host.wrappedList],['unwrap-value',['singleMap'],host.unwrappedMap],['unwrap-value',['singleList'],host.unwrappedList],['promote-entries',['middle'],host.promotedMap],['promote-entries',['list',1],host.promotedList],['promote-entries',['flow','wrapper'],host.promotedFlow],['promote-entries',['flowList',1],host.promotedFlowList]]) assert.equal(run(host.original,kind,path).source,expected);
  assert.equal(run(host.wrappedList,'unwrap-value',['middle']).source,host.original); assert.equal(run(host.original+host.sourceAddition).source,host.wrappedMap+host.sourceAddition);
  for(const [kind,path] of [['promote-entries',['collision']],['promote-entries',['empty']],['promote-entries',['list']],['unwrap-value',['blocked']],['wrap-map',['blocked','first']]]) assert.equal(targets(host.original)[kind].has(JSON.stringify(path)),false);
});
test('Physical refusal assertion distinguishes only the strict observed early watcher or queued history routes', async () => {
  const { assertStructuredRestructurePhysicalRefusal: verify, structuredPropertyRestructureScenarioFixture: host } = await import('../tools/structured-property-restructure-scenarios.mjs');
  const early='The note or nested property owner changed. Cancel this restructure and review the current source.',queued='The note or nested property owner changed. Cancel this draft and review the current source before applying it.',proof={externalSourceExact:true,sourceClean:true,noPropertyUndo:true,peerIdentity:true,peerText:true,peerDirty:true,peerHistory:true},call={path:'Structured property restructure/Source.md',phase:'restructure-expected-physical-conflict',settled:true,reason:queued},external=host.original+'External physical source Ω.\r\n';
  const create=text=>EditorState.create({doc:text,extensions:[history(),EditorState.lineSeparator.of('\r\n')]}),snapshot=state=>({text:state.sliceDoc(),undo:undoDepth(state),redo:redoDepth(state),history:JSON.stringify(state.toJSON({history:historyField}).history)});
  let state=create(host.original);state=state.update({changes:{from:state.doc.length,insert:'Earlier Source'}}).state;undo({get state(){return state},dispatch:tr=>{state=tr.state}});const before=snapshot(state),synced=state.update({changes:{from:state.doc.length,insert:'External physical source Ω.\r\n'}}).state;
  const make=(method,after,calls=[],error=early)=>({calls,error,proof,sourceUndo:after.undo,sourceRedo:after.redo,history:{sourceOwnerExact:true,before:structuredClone(before),after:structuredClone(after),propertyTransactions:[],documentChanges:method==='syncValue'?[{owner:method,before:host.original,after:external}]:[],transitions:[{method,requested:external,preserveHistory:method==='syncValue'?false:null,before,after}]}}),sync=make('syncValue',snapshot(synced)),reset=make('setDocument',snapshot(create(external)));
  assert.equal(verify(sync),'before-queue');assert.equal(verify(reset),'before-queue');assert.equal(verify(make('setDocument',snapshot(create(external)),[call],queued)),'queued');
  for(const receipt of [{...sync,error:queued},{...sync,calls:[call]},{...reset,calls:[{...call,phase:'another-stage'}],error:queued},{...reset,calls:[{...call,reason:'Unexpected failure'}],error:queued},{...reset,calls:[{...call,settled:false}],error:queued},{...reset,calls:[call,call],error:queued}])assert.throws(()=>verify(receipt));
  for(const field of Object.keys(proof))assert.throws(()=>verify({...sync,proof:{...proof,[field]:false}}));
  for(const mutate of [r=>{delete r.history},r=>{r.history.sourceOwnerExact=false},r=>{r.history.transitions[0].method='replaceExpected'},r=>{r.history.transitions[0].preserveHistory=true},r=>{r.history.propertyTransactions.push({method:'replaceExpected'})},r=>{r.history.after.history='{"done":[],"undone":[]}'},r=>{r.history.transitions=[]},r=>{r.history.documentChanges[0].owner='replaceExpected'},r=>{r.sourceRedo++}]){const invalid=structuredClone(sync);mutate(invalid);assert.throws(()=>verify(invalid))}
});

// Test-only production fixture bundling starts no application, server or GUI.
const root = fileURLToPath(new URL('../', import.meta.url)); let directory, production;
before(async () => { await mkdir(join(root, '.runtime'), { recursive: true }); directory = await mkdtemp(join(root, '.runtime', 'property-restructure-queue-tests-')); const output = join(directory, 'queue.mjs'); await build({ stdin: { contents: 'export { Properties } from "./client/properties";export { FileManager } from "./client/file-manager";export { Editor } from "./client/editor";export * from "./client/structured-property-handoff";export { MarkdownView } from "./client/workspace";export { TFile } from "./client/vault";export { Events } from "./client/events";', resolveDir: root }, outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent', plugins: [errorLogStub] }); production = await import(pathToFileURL(output).href); });
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll('\\','/'), /^\.runtime\/property-restructure-queue-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
function queueFixture() { let state = EditorState.create({ doc: source, extensions: [history(), EditorState.lineSeparator.of('\r\n')] }); const editor = Object.create(production.Editor.prototype), calls = [], file = { path: 'Note.md', extension: 'md' }, document = { content: source, version: 'v1', hasBom: true }; editor.cm = { get state() { return state; }, dispatch(...specs) { state = specs.length === 1 && specs[0].startState ? specs[0].state : state.update(...specs).state; } }; let version = 1; const session = { document, get text() { return editor.getValue(); }, leaves: new Set([{ editor }]), async save() { calls.push('save'); await session.onSave?.(); if (this.document.content !== this.text) this.document = { ...this.document, content: this.text, version: 'v' + ++version }; }, async reload() { calls.push('reload'); await session.onReload?.(); } }; const widgets = new Map(), app = { changingVault: false, core: { isEnabled: () => true }, vault: { rootPath: 'restructure-vault', readOnly: false, getAbstractFileByPath: () => file, async readDocument() { calls.push('read'); return document; }, async writeDocument() { calls.push('write'); } }, workspace: { isChangingFiles: false, isChangingLayout: false, sessions: new Map([[file.path, session]]), leaves: () => [], track: operation => operation }, metadataCache: { getDocument: () => ({ text: editor.getValue() }), async refresh() { calls.push('metadata'); } }, metadataTypeManager: { getAssignedWidget: name => widgets.get(name) } }; const manager = Object.assign(Object.create(production.FileManager.prototype), { app, operations: new Map(), batch: null }); let queued = 0; app.fileManager = { processFrontMatter(...args) { queued++; return manager.processFrontMatter(...args); } }; const properties = new production.Properties(app); return { app, properties, manager, file, editor, session, calls, widgets, get queued() { return queued; } }; }
function commit(fixture, result, guard) { return fixture.properties.changeValue(fixture.file, 'structured', value(source), result.next, 'unknown', guard, (updated, original) => api.preserveStructuredPropertyRestructureSource(updated, original, 'structured', result.operation)); }
test('Real Properties/FileManager queue uses one isolated CodeMirror transaction and preserves earlier dirty history through Undo/Redo', async () => {
  for (const [kind, path] of [['wrap-map',['first']],['wrap-list',['middle']],['unwrap-value',['singleMap']],['promote-entries',['middle']],['promote-entries',['list',1]]]) { const f = queueFixture(); f.editor.replaceRange('Earlier ', { line: f.editor.cm.state.doc.lines - 2, ch: 0 }); const baseline = f.editor.getValue(), result = run(baseline, kind, path), depth = undoDepth(f.editor.cm.state); let transactions = 0; const dispatch = f.editor.cm.dispatch; f.editor.cm.dispatch = (...args) => { if (args[0]?.changes) transactions++; dispatch(...args); }; await commit(f, result, content => assert.equal(content, baseline)); assert.equal(f.queued, 1); assert.equal(transactions, 1); assert.equal(f.editor.getValue(), result.source); assert.equal(undoDepth(f.editor.cm.state), depth + 1); assert.deepEqual(f.calls, ['save','reload','save','metadata']); f.editor.undo(); assert.equal(f.editor.getValue(), baseline); f.editor.redo(); assert.equal(f.editor.getValue(), result.source); f.editor.undo(); f.editor.undo(); assert.equal(f.editor.getValue(), source); assert.equal(redoDepth(f.editor.cm.state), 2); }
});
test('Generated Apply proof compiles and evaluates actual CodeMirror history and source/dirty-peer identity witnesses', async () => {
  const { structuredPropertyRestructureApplyProofExpression: expression } = await import('../tools/structured-property-restructure-scenarios.mjs');
  const f = queueFixture(), peer = queueFixture();
  f.editor.replaceRange('Earlier Source ', { line: f.editor.cm.state.doc.lines - 2, ch: 0 });
  peer.editor.replaceRange('Earlier dirty peer ', { line: peer.editor.cm.state.doc.lines - 2, ch: 0 });
  Object.defineProperty(peer.session,'dirty',{get(){return this.text!==this.document.content;}});
  const sourceView={file:{path:'Structured property restructure/Source.md'},editor:f.editor,session:f.session},peerView={file:{path:'Structured property restructure/Peer.md'},editor:peer.editor,session:peer.session};
  const sourceDocBefore=f.editor.cm.state.doc,sourceSavedBefore=f.session.document;
  const before={source:sourceView,editor:f.editor,cm:f.editor.cm,session:f.session,undo:undoDepth(f.editor.cm.state),peer:peerView,peerEditor:peer.editor,peerCM:peer.editor.cm,peerDoc:peer.editor.cm.state.doc,peerSession:peer.session,peerSaved:peer.session.document,peerText:peer.editor.getValue(),peerDirty:peer.session.dirty,peerUndo:undoDepth(peer.editor.cm.state),peerRedo:redoDepth(peer.editor.cm.state)};
  const context={structuredRestructureBefore:before,app:{plugins:{modules:{'@codemirror/commands':{undoDepth,redoDepth}}},workspace:{getLeavesOfType:()=>[{view:sourceView},{view:peerView}]}}},script=new Script(expression());
  const inspect=()=>JSON.parse(JSON.stringify(script.runInNewContext(context))),allTrue={singleUndo:true,sourceIdentity:true,peerIdentity:true,peerText:true,peerHistory:true};
  assert.deepEqual(inspect(),{...allTrue,singleUndo:false});
  const baseline=f.editor.getValue(),result=run(baseline);await commit(f,result,content=>assert.equal(content,baseline));
  assert.deepEqual(inspect(),allTrue);assert.equal(f.queued,1);assert.equal(undoDepth(f.editor.cm.state),before.undo+1);assert.equal(peer.session.dirty,true);assert.notEqual(f.editor.cm.state.doc,sourceDocBefore);assert.notEqual(f.session.document,sourceSavedBefore);assert.equal(peer.editor.cm.state.doc,before.peerDoc);assert.equal(peer.session.document,before.peerSaved);
  const exactBefore={sourceText:f.editor.getValue(),peerText:peer.editor.getValue(),sourceHistory:JSON.stringify(f.editor.cm.state.toJSON({history:historyField}).history),peerHistory:JSON.stringify(peer.editor.cm.state.toJSON({history:historyField}).history),sourceSaved:f.session.document,peerSaved:peer.session.document};
  for(const [fault,field]of [[{undo:before.undo+1},'singleUndo'],[{source:{...sourceView}},'sourceIdentity'],[{editor:{...f.editor}},'sourceIdentity'],[{cm:{...f.editor.cm}},'sourceIdentity'],[{session:{...f.session}},'sourceIdentity'],[{peer:{...peerView}},'peerIdentity'],[{peerEditor:{...peer.editor}},'peerIdentity'],[{peerCM:{...peer.editor.cm}},'peerIdentity'],[{peerDoc:EditorState.create({doc:peer.editor.getValue()}).doc},'peerIdentity'],[{peerSession:{...peer.session}},'peerIdentity'],[{peerSaved:{...peer.session.document}},'peerIdentity'],[{peerText:before.peerText+'changed'},'peerText'],[{peerDirty:false},'peerText'],[{peerUndo:before.peerUndo+1},'peerHistory'],[{peerRedo:before.peerRedo+1},'peerHistory']]){context.structuredRestructureBefore={...before,...fault};assert.deepEqual(inspect(),{...allTrue,[field]:false});}
  context.structuredRestructureBefore=before;assert.deepEqual(inspect(),allTrue);
  assert.deepEqual({sourceText:f.editor.getValue(),peerText:peer.editor.getValue(),sourceHistory:JSON.stringify(f.editor.cm.state.toJSON({history:historyField}).history),peerHistory:JSON.stringify(peer.editor.cm.state.toJSON({history:historyField}).history),sourceSaved:f.session.document,peerSaved:peer.session.document},exactBefore);
  f.editor.undo();assert.deepEqual(inspect(),{...allTrue,singleUndo:false});f.editor.redo();assert.deepEqual(inspect(),allTrue);
});
test('Queued source/type drift and real physical reload refuse before a property transaction or external-byte loss', async () => {
  for (const reason of ['value','type','physical']) { const f = queueFixture(), result = run(source); if (reason === 'type') f.widgets.set('structured','text'); else f.session.onReload = () => { const text = source.replace('first: 1.50','first: 2.50'); f.session.document = { ...f.session.document, content: text, version: 'external' }; f.editor.cm.dispatch({ changes: { from: 0, to: f.editor.cm.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) }); }; await assert.rejects(commit(f, result, reason === 'physical' ? content => { if (content !== source) throw Error('physical source changed'); } : undefined), /property (?:type )?changed|physical source changed/); assert.equal(undoDepth(f.editor.cm.state),0); assert.equal(f.calls.includes('write'),false); assert.equal(f.calls.filter(c=>c==='save').length,1); if (reason !== 'type') assert.equal(f.editor.getValue(),source.replace('first: 1.50','first: 2.50')); }
});
test('Queued read-only and owner revocation plus asynchronous guards refuse before saves and source reads', async () => {
  for (const reason of ['readonly','owner','async']) { const f = queueFixture(); let release, owned = true; f.manager.operations.set('restructure-vault\0Note.md', new Promise(done => release = done)); const pending = commit(f, run(source), reason === 'async' ? async () => {} : () => { if (f.app.vault.readOnly) throw Error('read-only owner'); if (!owned) throw Error('owner changed'); }); if (reason === 'readonly') f.app.vault.readOnly = true; if (reason === 'owner') owned = false; release(); await assert.rejects(pending, /read-only|owner changed|guard must finish synchronously/); assert.deepEqual(f.calls, []); assert.equal(f.editor.getValue(), source); }
});
test('Disabled Properties refuses before queue allocation', async () => { const f = queueFixture(); f.app.core.isEnabled = () => false; await assert.rejects(commit(f, run(source)), /Enable Properties/); assert.equal(f.queued, 0); assert.deepEqual(f.calls, []); });

function handoffFixture() { const calls = { reads: 0, allocations: 0, writes: 0, saves: 0 }, sources = [], configs = new Map(), types = new production.Events(), saved = { file: { path: 'Closed.md' }, content: source, version: 'physical-v1', hasBom: true }, file = new production.TFile(null, { path: 'Closed.md', basename: 'Closed', extension: 'md', stat: { size: source.length, mtime: 1, ctime: 1 } }), cache = parseMarkdown(source), pane = { id: 'properties', parent: {}, getRoot: () => ({}) }; let entry = { document: saved, text: source, cache, missing: false }; const app = { changingVault: false, vault: { rootPath: 'cached-vault', readOnly: false, getFileByPath: path => path === file.path ? file : null, getConfig: key => configs.get(key), async readDocument() { calls.reads++; return { ...saved }; }, async writeDocument() { calls.writes++; } }, core: { busy: false, isEnabled: () => true }, metadataCache: { getDocument: () => entry }, metadataTypeManager: Object.assign(types, { getAssignedWidget: () => null }), configuration: { get: () => ({}), watch: () => () => {} }, workspace: Object.assign(new production.Events(), { sessions: new Map(), isChangingFiles: false, isChangingLayout: false, getLeavesOfType: () => sources, getActiveViewOfType: () => null, setActiveLeaf(leaf) { this.activeLeaf = leaf; }, getLeaf() { calls.allocations++; const leaf = { id: 'opened', parent: {}, async setViewState() { const cm = { state: EditorState.create({ doc: source, extensions: [EditorView.editable.of(true), EditorState.lineSeparator.of('\r\n')] }), dom: { isConnected: true }, contentDOM: { isContentEditable: true }, composing: false }, editor = { cm, getValue: () => cm.state.sliceDoc() }, session = { originRoot: app.vault.rootPath, document: { ...saved }, text: source, isSaving: false, isReloading: false, async save() { calls.saves++; } }; leaf.view = Object.assign(Object.create(production.MarkdownView.prototype), { leaf, file, editor, session, getEditingMode: () => 'source', sourceEl: { checkVisibility: () => true } }); Object.defineProperty(leaf.view, 'isLoaded', { value: true }); app.workspace.sessions.set(file.path, session); entry = { ...entry, document: session.document }; sources.push(leaf); app.workspace.activeLeaf = leaf; app.workspace.trigger('file-open', file); } }; return leaf; } }) }; const request = (kind, path = kind === 'unwrap-value' ? ['singleList'] : kind === 'promote-entries' ? ['middle'] : ['first']) => production.structuredPropertyHandoff(app, file, 'structured', value(source), { kind, path }); return { app, file, pane, calls, saved, configs, request, open: authority => production.openStructuredPropertyInSource(authority, pane, () => true) }; }
test('All restructure closed-note choices use cached-only authority and explicitly open normal Source without edits or saves', async () => {
  for (const kind of ['wrap-map','wrap-list','unwrap-value','promote-entries']) { const f = handoffFixture(), authority = f.request(kind); assert.ok(authority); assert.deepEqual(f.calls,{reads:0,allocations:0,writes:0,saves:0}); const view = await f.open(authority); assert.equal(view.editor.getValue(),source); assert.deepEqual(f.calls,{reads:2,allocations:1,writes:0,saves:0}); await assert.rejects(f.open(authority),/changed/); }
});
test('Cached read-only, root, provider/type, core, preference, physical version and owner drift revoke handoff before I/O/allocation', async () => {
  for (const reason of ['readonly','root','provider','type','core','preference','version']) { const f = handoffFixture(), authority = f.request('wrap-list'); assert.ok(authority); if(reason==='readonly') f.app.vault.readOnly=true; if(reason==='root') f.app.vault.rootPath='another'; if(reason==='provider') f.app.vault.getFileByPath=()=>null; if(reason==='type') f.app.configuration.get=()=>({structured:'text'}); if(reason==='core') f.app.core.isEnabled=()=>false; if(reason==='preference') f.configs.set('newLinkFormat','absolute'); if(reason==='version') f.saved.version='physical-v2'; await assert.rejects(f.open(authority),/changed/); assert.deepEqual(f.calls,{reads:0,allocations:0,writes:0,saves:0}); }
  const f=handoffFixture();f.app.vault.readOnly=true;assert.equal(f.request('wrap-map'),null);assert.deepEqual(f.calls,{reads:0,allocations:0,writes:0,saves:0});assert.equal(handoffFixture().request('promote-entries',['collision']),null);
});
