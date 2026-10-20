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
const { nestedPropertyPositionReadOnlyFixture, nestedPositionClientScroll } = await import("../tools/nested-property-position-scenarios.mjs");
const value = source => parseMarkdown(source).frontmatter?.positioned;
const plan = (source, path, position) => operations.planStructuredPropertyOperation(source, "positioned", value(source), { kind: "move-to", path, position });
const targets = source => operations.structuredPropertyOperationTargets(source, "positioned", value(source));
const start = '\ufeff---\r\n# Retain outer λ\r\npositioned:\r\n', end = 'other: &shared { exact: kept }\r\nalias: *shared\r\n---\r\n# Body 😀\r\nUntouched.\r\n';
const first = '    first: 1.50 # first λ\r\n', second = '    "second Ω": { inner: [one, false] } # second subtree\r\n', third = '    third: >- # original folded\r\n      Literal first\r\n      next 😀\r\n', fourth = '    fourth: ~ # original null\r\n';
const block = start + '  map:\r\n' + first + second + third + fourth + end;

test("arbitrary map moves preserve every crossed token and descendant, with a complete one-based review", () => {
  const moved = plan(block, ["map", "fourth"], 1);
  assert.equal(moved.source, start + '  map:\r\n' + fourth + first + second + third + end);
  assert.deepEqual(Object.keys(value(moved.source).map), ["fourth", "first", "second Ω", "third"]);
  assert.match(moved.review, /to final position 1 of 4 \(positions start at 1\)/);
  assert.match(moved.review, /Exact crossed entries before:/); assert.match(moved.review, /After reordering:/);
  for (const entry of [first, second, third, fourth]) assert.equal(moved.review.split(entry).length, 3, "Every exact entry appears completely before and after");
  assert.equal(plan(moved.source, ["map", "fourth"], 4).source, block);
});
test("moving the first map entry to the end performs a rotation rather than swapping endpoints", () => {
  assert.equal(plan(block, ["map", "first"], 4).source, start + '  map:\r\n' + second + third + fourth + first + end);
});
test("moving within a collection only replaces the crossed range", () => {
  const moved = plan(block, ["map", "second Ω"], 4);
  assert.equal(moved.source, start + '  map:\r\n' + first + third + fourth + second + end);
  assert.equal(moved.next.map.third, value(block).map.third);
});
test("block list moves include implicit nulls, exact subtrees and inline comments", () => {
  const a = '    - one # first\r\n', b = '    - { inner: [false, 1.50] } # middle\r\n', c = '    - # implicit null\r\n', d = '    - "last Ω" # last\r\n';
  const source = start + '  list:\r\n' + a + b + c + d + end, moved = plan(source, ["list", 0], 4);
  assert.equal(moved.source, start + '  list:\r\n' + b + c + d + a + end); assert.deepEqual(moved.next.list, [{ inner: [false, 1.5] }, null, "last Ω", "one"]);
  assert.equal(plan(moved.source, ["list", 3], 1).source, source);
});
test("single-line flow keeps separator whitespace in each original slot and all scalar spellings", () => {
  const source = start + '  list: ["same", same ,false, -0]\r\n' + end, moved = plan(source, ["list", 0], 4);
  assert.equal(moved.source, source.replace('["same", same ,false, -0]', '[same, false ,-0, "same"]'));
  assert.ok(Object.is(moved.next.list[2], -0)); assert.equal(plan(moved.source, ["list", 3], 1).source, source);
});
for (const newline of ["\n", "\r\n"]) for (const trailing of ["", ","]) test("multiline flow arbitrary map/list moves retain indentation, commas and EOL " + JSON.stringify({ newline, trailing }), () => {
  const source = ['---', 'positioned:', '  map: {', '    first: 1.50,', '    second: { child: [one, false] },', '    third: -0' + trailing, '  } # map close', '  list: [', '    "quoted λ",', '    [one, false],', '    ~' + trailing, '  ] # list close', '---', 'Body', ''].join(newline);
  const mapMoved = plan(source, ["map", "third"], 1);
  assert.equal(mapMoved.source, source.replace('    first: 1.50,' + newline + '    second: { child: [one, false] },' + newline + '    third: -0' + trailing,
    '    third: -0,' + newline + '    first: 1.50,' + newline + '    second: { child: [one, false] }' + trailing));
  const listMoved = plan(source, ["list", 0], 3);
  assert.equal(listMoved.source, source.replace('    "quoted λ",' + newline + '    [one, false],' + newline + '    ~' + trailing,
    '    [one, false],' + newline + '    ~,' + newline + '    "quoted λ"' + trailing));
  assert.equal(plan(mapMoved.source, ["map", "third"], 3).source, source); assert.equal(plan(listMoved.source, ["list", 2], 1).source, source);
});
test("every non-adjacent array hop uses the final destination and is exactly reversible", () => {
  const source = '---\npositioned: { list: [zero, one, two, three, four] } # keep\n---\nBody\n', before = value(source).list;
  for (let from = 0; from < before.length; from++) for (let to = 0; to < before.length; to++) {
    if (from === to) continue;
    const moved = plan(source, ["list", from], to + 1), expected = before.filter((_, at) => at !== from); expected.splice(to, 0, before[from]);
    assert.deepEqual(moved.next.list, expected); assert.equal(plan(moved.source, ["list", to], from + 1).source, source);
  }
});
test("map source order is preserved even for integer-looking keys whose JavaScript order differs", () => {
  const source = '---\npositioned: { "2": two, "1": one, third: three }\n---\nBody\n';
  assert.equal(plan(source, ["2"], 3).source, source.replace('{ "2": two, "1": one, third: three }', '{ "1": one, third: three, "2": two }'));
});
test("queue candidate validation retains the single exact splice and rejects unrelated changes", () => {
  const operation = { kind: "move-to", path: ["map", "first"], position: 4 }, moved = plan(block, operation.path, operation.position);
  const candidate = updateFrontmatter(block, fm => { fm.positioned = moved.next; });
  assert.equal(operations.preserveStructuredPropertyOperationSource(candidate, block, "positioned", operation), moved.source);
  assert.throws(() => operations.preserveStructuredPropertyOperationSource(updateFrontmatter(candidate, fm => { fm.extra = true; }), block, "positioned", operation));
});
for (const gap of ['\n', '  # ambiguous middle\n', '  \n']) test("a non-adjacent move proves every crossed gap " + JSON.stringify(gap), () => {
  const source = '---\npositioned:\n  first: 1\n  second: false\n' + gap + '  third: null\n  fourth: four\n---\nBody\n';
  assert.throws(() => plan(source, ["first"], 4), /ownership/); assert.throws(() => plan(source, ["fourth"], 1), /ownership/);
  assert.equal(plan(source, ["first"], 2).source, source.replace('  first: 1\n  second: false\n', '  second: false\n  first: 1\n'));
});
test("crossed review limits apply to the full range although the first adjacent hop fits", () => {
  const source = '---\npositioned:\n  first: x\n  second: "' + 's'.repeat(2100) + '"\n  third: "' + 't'.repeat(2100) + '"\n---\nBody\n';
  assert.ok(targets(source)["move-to"].has('["first"]')); assert.throws(() => plan(source, ["first"], 3), /too large/); assert.doesNotThrow(() => plan(source, ["first"], 2));
});
for (const position of [0, -1, 1.5, 5, NaN, Infinity, "2", null]) test("invalid destination refuses " + String(position), () => { assert.throws(() => plan(block, ["map", "first"], position)); });
test("no-op destinations, missing paths and stale snapshots refuse without mutating caller values", () => {
  const before = value(block), operation = { kind: "move-to", path: ["map", "first"], position: 4 }, saved = structuredClone(before);
  operations.planStructuredPropertyOperation(block, "positioned", before, operation); assert.deepEqual(before, saved); assert.deepEqual(operation, { kind: "move-to", path: ["map", "first"], position: 4 });
  assert.throws(() => plan(block, ["map", "first"], 1), /already there/); assert.throws(() => plan(block, [], 2)); assert.throws(() => plan(block, ["map", "missing"], 2));
  assert.throws(() => operations.planStructuredPropertyOperation(block, "positioned", { ...before, added: true }, operation), /changed/);
});
test("destination accessors, foreign operation fields and unsafe paths are refused before getters execute", () => {
  let reads = 0; const accessor = Object.defineProperty({ kind: "move-to", path: ["map", "first"] }, "position", { enumerable: true, get() { reads++; return 4; } });
  for (const operation of [accessor, { kind: "move-to", path: ["map", "first"], position: 4, extra: true }, { kind: "move-to", path: ["constructor"], position: 2 }]) assert.throws(() => operations.planStructuredPropertyOperation(block, "positioned", value(block), operation));
  assert.equal(reads, 0);
});
test("target discovery records one-based positions and disables singleton/ambiguous entries", () => {
  const t = targets(block); assert.deepEqual(t.positions.get('["map","first"]'), { position: 1, length: 4 }); assert.deepEqual(t.positions.get('["map","fourth"]'), { position: 4, length: 4 }); assert.ok(t["move-to"].has('["map","first"]'));
  const singleton = targets('---\npositioned: { only: true }\n---\n'); assert.equal(singleton["move-to"].size, 0); assert.deepEqual(singleton.positions.get('["only"]'), { position: 1, length: 1 });
});
test("actual both-host cached fixtures expose all declared map/list/flow position targets", () => {
  for (const source of [nestedPropertyPositionReadOnlyFixture.source, ...nestedPropertyPositionReadOnlyFixture.files.map(([, content]) => content)]) {
    const t = targets(source); for (const path of [['map', 'fourth'], ['list', 0], ['flow', 'first'], ['multi', 3]]) assert.ok(t['move-to'].has(JSON.stringify(path)), 'Actual fixture target ' + JSON.stringify(path));
    assert.equal(t['move-to'].has('["single","only"]'), false); assert.throws(() => plan(source, ['gap', 'first'], 4), /ownership/);
  }
});
test("measured narrow disclosure geometry needs no inner scroll when its exact summary is already contained", () => {
  const bounds = { left: 74, right: 332.8000183105469, top: 454.6000061035156, bottom: 473.4000072479248 }, clip = { left: 72, right: 333, top: 209, bottom: 719.3999938964844 };
  assert.equal(nestedPositionClientScroll(bounds, clip, 'x'), 0); assert.equal(nestedPositionClientScroll(bounds, clip, 'y'), 0);
  // The preparation must not center an already-visible summary in the outer
  // document, where sidebar pointerdown reveals its top tab and shifts the hit.
  const offset = 19.600000381469727, shifted = { ...bounds, top: bounds.top + offset, bottom: bounds.bottom + offset }, shiftedClip = { ...clip, top: clip.top + offset, bottom: clip.bottom + offset };
  assert.equal(nestedPositionClientScroll(shifted, shiftedClip, 'y'), 0);
});
test("inner reveal scrolls a wholly clipped control and retains an already-visible oversized Source document", () => {
  const clip = { left: 10, right: 210, top: 100, bottom: 500 };
  assert.equal(nestedPositionClientScroll({ left: 20, right: 180, top: 600, bottom: 640 }, clip, 'y'), 320);
  assert.equal(nestedPositionClientScroll({ left: 20, right: 180, top: -100, bottom: 900 }, clip, 'y'), 0);
  assert.throws(() => nestedPositionClientScroll({ top: NaN, bottom: 120 }, clip, 'y'));
});
for (const [yaml, expected] of [['{ first: 1, second: false, }', '{ second: false, first: 1, }'], ['{ first: 1,\n second: false }', '{ second: false,\n first: 1 }']]) test("arbitrary positions now prove mixed and trailing flow source " + JSON.stringify(yaml), () => {
  const source = '---\npositioned: ' + yaml + '\n---\nBody\n', moved = plan(source, ['first'], 2);
  assert.equal(moved.source, source.replace(yaml, expected)); assert.equal(targets(source)["move-to"].has('["first"]'), true); assert.equal(plan(moved.source, ['first'], 1).source, source);
});
for (const yaml of ['{\n  first: 1, # ambiguous\n  second: false\n}', '{ first: &shared 1, second: *shared }', '{ first: !!str 1, second: false }', '{ first: 1, first: 2 }', '{ constructor: 1, second: false }']) test("arbitrary positions keep unsupported source layouts read-only " + JSON.stringify(yaml), () => {
  const source = '---\npositioned: ' + yaml + '\n---\nBody\n'; assert.throws(() => plan(source, ['first'], 2)); assert.equal(targets(source)["move-to"].size, 0);
});

function fakeDocument() {
  const create = tag => {
    const node = { tagName: tag, dataset: {}, children: [], listeners: {}, isConnected: true, focus() {}, append(...nodes) { for (const n of nodes) { if (typeof n === 'object') n.parentElement = this; this.children.push(n); } }, setAttribute(k, v) { this[k] = v; }, addEventListener(k, v) { (this.listeners[k] ??= []).push(v); }, fire(k, event = {}) { for (const fn of this.listeners[k] ?? []) fn({ preventDefault() {}, ...event }); }, remove() { this.isConnected = false; }, checkVisibility() { return true; }, contains(n) { return n === this || this.children.some(c => typeof c === 'object' && c.contains?.(n)); }, get lastElementChild() { return this.children.at(-1); }, insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); child.parentElement = this; } };
    if (tag.toLowerCase() === 'textarea') {
      // HTML textarea.value normalizes assigned CRLF/CR to LF. A plain property
      // hid the real-host false refusal while every source-slice test passed.
      let value = '';
      Object.defineProperty(node, 'value', { enumerable: true, get: () => value, set: next => { value = String(next).replace(/\r\n?/g, '\n'); } });
    }
    return node;
  };
  return { createElement: create, createTextNode: text => ({ textContent: text }) };
}
const all = node => [node, ...(node.children ?? []).filter(n => typeof n === 'object').flatMap(all)];
function editor(overrides = {}) {
  const document = fakeDocument(), errors = [], state = { applies: 0, closed: 0, current: true };
  const e = operations.createStructuredPropertyOperationEditor(document, { kind: "move-to", path: ["map", "first"], position: { position: 1, length: 4 }, label: "positioned map first", current: () => state.current, plan: operation => operations.planStructuredPropertyOperation(block, "positioned", value(block), operation), apply: async () => { state.applies++; return true; }, error: text => errors.push(text), closed: () => state.closed++, ...overrides });
  const nodes = all(e.element), find = key => nodes.find(n => Object.hasOwn(n.dataset ?? {}, key));
  return { e, state, errors, apply: find('propertyStructuredApply'), cancel: find('propertyStructuredCancel'), first: find('propertyStructuredMoveFirst'), last: find('propertyStructuredMoveLast'), review: find('propertyStructuredReorderReview') };
}
test("Move to editor starts with a disabled no-op and First/Last only prepare the full review", () => {
  const { e, state, apply, first, last, review } = editor(); assert.equal(e.input.value, "1"); assert.equal(apply.disabled, true); assert.equal(first.disabled, true); assert.equal(last.disabled, false);
  last.fire('click'); assert.equal(e.input.value, "4"); assert.equal(apply.disabled, false); assert.match(review.value, /final position 4 of 4/); assert.equal(state.applies, 0);
});
test("invalid and ambiguous position drafts visibly refuse while Cancel and Escape remain available", () => {
  for (const finish of ['cancel', 'escape']) { const { e, state, apply, cancel, review } = editor(); e.input.value = "5"; e.input.fire('input'); assert.equal(apply.disabled, true); assert.match(review.value, /within this collection/); apply.fire('click'); assert.equal(state.applies, 0); if (finish === 'cancel') cancel.fire('click'); else e.element.fire('keydown', { key: 'Escape' }); assert.equal(state.closed, 1); }
});
test("a destination changed without a review event cannot apply unseen source", () => {
  const { e, state, errors, apply, last } = editor(); last.fire('click'); e.input.value = "3"; apply.fire('click'); assert.equal(state.applies, 0); assert.match(errors.at(-1), /position changed/); assert.equal(apply.disabled, false);
});
test("HTML-normalized CRLF review applies the exact raw BOM/CRLF plan once", async () => {
  let applied;
  const result = editor({ apply: async candidate => { applied = candidate; return true; } }); result.last.fire('click');
  assert.ok(result.review.value.includes('\n')); assert.equal(result.review.value.includes('\r'), false, 'Visible textarea follows HTML normalization');
  result.apply.fire('click'); await Promise.resolve(); await Promise.resolve();
  assert.equal(applied.source, start + '  map:\r\n' + second + third + fourth + first + end); assert.ok(applied.review.includes('\r\n'), 'The exact reviewed authority retains original CRLF bytes');
  assert.ok(applied.source.startsWith('\ufeff')); assert.equal(applied.source.replaceAll('\r\n', '').includes('\n'), false); assert.equal(result.state.closed, 1); assert.equal(result.e.active, false);
});
test("the raw reviewed candidate refuses source/review changes hidden by identical textarea LF normalization", () => {
  let changed = false;
  const result = editor({ plan: operation => { const candidate = operations.planStructuredPropertyOperation(block, 'positioned', value(block), operation); return changed ? { ...candidate, source: candidate.source.replaceAll('\r\n', '\n'), review: candidate.review.replaceAll('\r\n', '\n') } : candidate; } });
  result.last.fire('click'); const visible = result.review.value; changed = true; result.apply.fire('click');
  assert.equal(result.state.applies, 0); assert.match(result.errors.at(-1), /position changed/); assert.equal(result.review.value, visible, 'Identical visible LF text cannot authorize changed raw source');
});
test("altering the visible review still refuses an otherwise unchanged raw candidate", () => {
  const result = editor(); result.last.fire('click'); result.review.value += '\nUnreviewed change'; result.apply.fire('click'); assert.equal(result.state.applies, 0); assert.match(result.errors.at(-1), /position changed/);
});
test("retired owners and composition refuse Apply before the mutation queue", () => {
  const { e, state, errors, apply, last } = editor(); last.fire('click'); state.current = false; apply.fire('click'); assert.equal(state.applies, 0); assert.match(errors.at(-1), /owner changed/); state.current = true; e.input.fire('compositionstart'); assert.equal(apply.disabled, true); apply.fire('click'); e.element.fire('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }); assert.equal(state.applies, 0); e.input.fire('compositionend'); assert.equal(apply.disabled, false);
});
test("a real Apply is one-shot and locks the destination, shortcuts, Cancel and Apply while pending", async () => {
  let resolve, applies = 0; const gate = new Promise(done => resolve = done), result = editor({ apply: async () => { applies++; await gate; return true; } }); result.last.fire('click'); result.apply.fire('click');
  assert.equal(applies, 1); for (const control of [result.e.input, result.apply, result.cancel, result.first, result.last]) assert.equal(control.disabled, true);
  result.apply.fire('click'); result.last.fire('click'); result.cancel.fire('click'); assert.equal(applies, 1); assert.equal(result.state.closed, 0); resolve(); await gate; await Promise.resolve(); assert.equal(result.state.closed, 1); assert.equal(result.e.active, false);
});
test("actual inspector exposes Move to and Source review with read-only handlers independently guarded", () => {
  for (const writable of [true, false]) { const document = fakeDocument(), model = structured.structuredPropertyModel(value(block), block, "positioned"); let opened = 0, sourced = 0;
    const inspector = structured.createStructuredEditorInspector(document, model.entries, "positioned", false, { writable, current: () => true, edit() {}, sourceWritable: writable, source() { sourced++; }, operations: { ...targets(block), open(kind) { assert.equal(kind, 'move-to'); opened++; } } });
    const nodes = all(inspector), move = nodes.find(n => n.dataset?.propertyStructuredMoveTo === '["map","first"]'), source = nodes.find(n => n.dataset?.propertyStructuredSource === '{"kind":"move-to","path":["map","first"]}'); assert.ok(move && source); assert.equal(move.disabled, !writable); assert.equal(source.disabled, !writable); move.disabled = source.disabled = false; move.fire('click'); source.fire('click'); assert.equal(opened, writable ? 1 : 0); assert.equal(sourced, writable ? 1 : 0);
  }
});
