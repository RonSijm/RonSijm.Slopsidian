import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({
  resolve(specifier, context, next) { try { return next(specifier, context); } catch (issue) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context); throw issue; } },
  load(url, context, next) { if (!url.includes("/client/") || !url.endsWith(".ts")) return next(url, context); return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform" }) }; }
});
const operations = await import("../client/structured-property-operations.ts"), { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts");
const start = '\ufeff---\r\n# Outer source λ\r\nmixed:\r\n', end = 'untouched: &keep { exact: 1.50, zero: -0 } # retain\r\ncopy: *keep\r\n---\r\n# Body 😀\r\nKeep all bytes.\r\n';
const value = source => parseMarkdown(source).frontmatter?.mixed;
const plan = (source, operation) => operations.planStructuredPropertyOperation(source, "mixed", value(source), operation);
const targets = source => operations.structuredPropertyOperationTargets(source, "mixed", value(source));
const inlineMap = '{first: 1.50 , "second Ω": false, third: ~, fourth: -0, }';
const inlineList = '["same", same ,false, -0, ]';
const source = start + '  map: ' + inlineMap + ' # map tail\r\n  list: ' + inlineList + ' # list tail\r\n' + end;

test("real-host mixed flow fixtures have CRLF source, independent expected candidates and genuine ambiguous comments", async () => {
  const { nestedPropertyMixedFlowReadOnlyFixture: fixture, nestedPropertyMixedFlowScenarioFixture: flow } = await import("../tools/nested-property-mixed-flow-scenarios.mjs");
  assert.equal(fixture.source.replaceAll("\r\n", "").includes("\n"), false); assert.equal(fixture.files.length, 1); assert.equal(fixture.files[0][1], fixture.source);
  const current = parseMarkdown(flow.original).frontmatter.flowLayouts, run = operation => operations.planStructuredPropertyOperation(flow.original, "flowLayouts", current, operation).source;
  for (const [name, operation] of [["added", { kind: "add", path: ["map"], key: "added λ", value: "Literal Ω" }], ["movedMap", { kind: "move-to", path: ["map", "fourth"], position: 1 }], ["renamed", { kind: "rename", path: ["inline", "first"], key: "renamed λ" }], ["listAdded", { kind: "add", path: ["list"], key: 2, value: "middle 😀" }], ["listRemoved", { kind: "remove", path: ["list", 2] }], ["singletonRemoved", { kind: "remove", path: ["single", 0] }], ["persisted", { kind: "move-to", path: ["list", 3], position: 1 }]]) assert.equal(run(operation), flow[name], "Independent real-host source expectation: " + name);
  const caps = operations.structuredPropertyOperationTargets(flow.original, "flowLayouts", current); assert.equal(caps.add.has('["blocked"]'), false); assert.equal(caps.add.has('["map"]'), true); assert.equal(caps.rename.has('["inline","first"]'), true); assert.equal(caps["move-to"].has('["list",3]'), true);
  const { structuredPropertyOperationsReadOnlyFixture } = await import("../tools/structured-property-operations-scenarios.mjs"), { structuredPropertyHandoffReadOnlyFixture } = await import("../tools/structured-property-handoff-scenarios.mjs");
  for (const prior of [structuredPropertyOperationsReadOnlyFixture, structuredPropertyHandoffReadOnlyFixture]) {
    assert.equal(prior.source.replaceAll("\r\n", "").includes("\n"), false); const opaque = parseMarkdown(prior.source).frontmatter.opaque; assert.deepEqual(opaque.sourceOnly, { a: 1, b: 2 });
    const targets = operations.structuredPropertyOperationTargets(prior.source, "opaque", opaque); assert.equal(targets.add.has('["sourceOnly"]'), false); assert.equal(targets.rename.has('["sourceOnly","a"]'), false); assert.match(targets.limits.get('["sourceOnly"]'), /Source.*ambiguous comments/);
  }
});

test("inline trailing-comma map operations retain precision, quotes, punctuation and all unrelated bytes", () => {
  const added = plan(source, { kind: "add", path: ["map"], key: "added λ", value: true });
  assert.equal(added.source, source.replace('fourth: -0, }', 'fourth: -0, "added λ": true, }'));
  assert.deepEqual(added.next.map, { first: 1.5, "second Ω": false, third: null, fourth: -0, "added λ": true });
  const renamed = plan(source, { kind: "rename", path: ["map", "second Ω"], key: "renamed 😀" });
  assert.equal(renamed.source, source.replace('"second Ω":', '"renamed 😀":'));
  assert.equal(plan(source, { kind: "remove", path: ["map", "first"] }).source, source.replace(inlineMap, '{"second Ω": false, third: ~, fourth: -0, }'));
  assert.equal(plan(source, { kind: "remove", path: ["map", "second Ω"] }).source, source.replace(inlineMap, '{first: 1.50 , third: ~, fourth: -0, }'));
  assert.equal(plan(source, { kind: "remove", path: ["map", "fourth"] }).source, source.replace(inlineMap, '{first: 1.50 , "second Ω": false, third: ~, }'));
});

test("inline trailing-comma map arbitrary and adjacent moves rotate exact entry lexemes through separator slots", () => {
  const moved = plan(source, { kind: "move-to", path: ["map", "fourth"], position: 1 });
  assert.equal(moved.source, source.replace(inlineMap, '{fourth: -0 , first: 1.50, "second Ω": false, third: ~, }'));
  assert.equal(plan(moved.source, { kind: "move-to", path: ["map", "fourth"], position: 4 }).source, source);
  assert.equal(plan(source, { kind: "move-up", path: ["map", "second Ω"] }).source, source.replace(inlineMap, '{"second Ω": false , first: 1.50, third: ~, fourth: -0, }'));
  assert.equal(plan(source, { kind: "move-down", path: ["map", "third"] }).source, source.replace(inlineMap, '{first: 1.50 , "second Ω": false, fourth: -0, third: ~, }'));
});

test("inline trailing-comma list insertion/removal uses current indexes without conflating equal resolved values", () => {
  assert.equal(plan(source, { kind: "add", path: ["list"], key: 0, value: "new" }).source, source.replace(inlineList, '["new", "same", same ,false, -0, ]'));
  assert.equal(plan(source, { kind: "add", path: ["list"], key: 2, value: null }).source, source.replace(inlineList, '["same", same ,null ,false, -0, ]'));
  assert.equal(plan(source, { kind: "add", path: ["list"], key: 4, value: [] }).source, source.replace(inlineList, '["same", same ,false, -0, [], ]'));
  assert.equal(plan(source, { kind: "remove", path: ["list", 0] }).source, source.replace(inlineList, '[same ,false, -0, ]'));
  assert.equal(plan(source, { kind: "remove", path: ["list", 1] }).source, source.replace(inlineList, '["same", false, -0, ]'));
  assert.equal(plan(source, { kind: "remove", path: ["list", 3] }).source, source.replace(inlineList, '["same", same ,false, ]'));
});

test("every trailing-comma list hop retains exact original separators and can be reversed byte-for-byte", () => {
  for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) {
    if (from === to) continue;
    const moved = plan(source, { kind: "move-to", path: ["list", from], position: to + 1 }), expected = [...value(source).list];
    const [item] = expected.splice(from, 1); expected.splice(to, 0, item); assert.deepEqual(moved.next.list, expected);
    assert.equal(plan(moved.source, { kind: "move-to", path: ["list", to], position: from + 1 }).source, source);
    assert.ok(moved.source.includes('same')); assert.ok(moved.source.includes('"same"')); assert.ok(moved.source.includes('-0')); assert.ok(moved.source.includes(', ]'));
  }
});

for (const newline of ["\n", "\r\n"]) for (const trailing of ["", ","]) test("mixed flow line placement supports all structural operations " + JSON.stringify({ newline, trailing }), () => {
  const map = '{first: 1.50, "second Ω": { child: [one, false] } ,' + newline + '    third: ~, fourth: -0' + trailing + ' }';
  const list = '["one", { child: [false, 1.50] },' + newline + '    ~ , -0' + trailing + ' ]';
  const input = start + '  map: ' + map + ' # map tail\r\n  list: ' + list + ' # list tail\r\n' + end;
  const moved = plan(input, { kind: "move-to", path: ["map", "fourth"], position: 1 });
  assert.equal(moved.source, input.replace(map, '{fourth: -0, first: 1.50 ,' + newline + '    "second Ω": { child: [one, false] }, third: ~' + trailing + ' }'));
  assert.equal(plan(moved.source, { kind: "move-to", path: ["map", "fourth"], position: 4 }).source, input);
  const renamed = plan(input, { kind: "rename", path: ["map", "second Ω"], key: "renamed" });
  assert.equal(renamed.source, input.replace('"second Ω":', '"renamed":'));
  assert.equal(plan(input, { kind: "add", path: ["map"], key: "last", value: {} }).source, input.replace('fourth: -0' + trailing, 'fourth: -0, "last": {}' + trailing));
  assert.equal(plan(input, { kind: "remove", path: ["map", "third"] }).source, input.replace('third: ~, fourth: -0', 'fourth: -0'));
  const firstRemoved = plan(input, { kind: "remove", path: ["list", 0] }); assert.equal(firstRemoved.source, input.replace('["one", { child:', '[{ child:'));
  const middleAdded = plan(input, { kind: "add", path: ["list"], key: 2, value: true });
  assert.equal(middleAdded.source, input.replace('    ~ , -0', '    true,' + newline + '    ~ , -0'));
  assert.equal(plan(input, { kind: "remove", path: ["list", 3] }).source, input.replace('~ , -0' + trailing, '~' + trailing));
});

test("mixed LF/CRLF and tabs in proven flow separators remain exact after long-distance moves", () => {
  const collection = '{first: 1.50,\r\n    second: false ,\n    third: ~,\tfourth: -0,\r\n  }';
  const input = start + '  map: ' + collection + ' # close\r\n' + end;
  const moved = plan(input, { kind: "move-to", path: ["map", "fourth"], position: 1 });
  assert.equal(moved.source, input.replace(collection, '{fourth: -0,\r\n    first: 1.50 ,\n    second: false,\tthird: ~,\r\n  }'));
  assert.equal(plan(moved.source, { kind: "move-to", path: ["map", "fourth"], position: 4 }).source, input);
});

test("nested flow values and comments entirely inside their CST span travel unchanged", () => {
  const nested = '{ inner: [one, # belongs inside value\r\n      false], quoted: "λ 😀" }';
  const input = start + '  list: [one, ' + nested + ',\r\n    false, ] # close\r\n' + end;
  const moved = plan(input, { kind: "move-to", path: ["list", 1], position: 3 });
  assert.equal(moved.source, input.replace('[one, ' + nested + ',\r\n    false, ]', '[one, false,\r\n    ' + nested + ', ]'));
  assert.equal(plan(moved.source, { kind: "move-to", path: ["list", 2], position: 2 }).source, input);
});

test("multiline quoted values remain exact and semantic proof refuses changes to their resolved value", () => {
  const input = start + '  map: {first: "first\r\n    folded λ",\r\n    second: false, third: ~, } # close\r\n' + end;
  const moved = plan(input, { kind: "move-to", path: ["map", "first"], position: 3 });
  assert.equal(moved.next.map.first, value(input).map.first); assert.ok(moved.source.includes('"first\r\n    folded λ"'));
  assert.equal(plan(moved.source, { kind: "move-to", path: ["map", "first"], position: 1 }).source, input);
});

test("ordinary colon/value whitespace and implicit-null map entries have proven punctuation", () => {
  const input = start + '  map: {first:,\r\n    second:\r\n      false, third: ~, }\r\n' + end;
  const moved = plan(input, { kind: "move-to", path: ["map", "first"], position: 3 });
  assert.equal(moved.source, input.replace('{first:,\r\n    second:\r\n      false, third: ~, }', '{second:\r\n      false,\r\n    third: ~, first:, }'));
  assert.equal(plan(input, { kind: "remove", path: ["map", "first"] }).source, input.replace('first:,\r\n    ', ''));
});

for (const [array, collection, expected] of [[false, '{only: ~ ,\r\n    }', '{ \r\n    }'], [true, '[~ ,\r\n    ]', '[ \r\n    ]']]) test("singleton mixed trailing-comma removal retains only original whitespace " + array, () => {
  const input = start + '  single: ' + collection + ' # close\r\n' + end;
  const removed = plan(input, { kind: "remove", path: ["single", array ? 0 : "only"] });
  assert.equal(removed.source, input.replace(collection, expected)); assert.deepEqual(removed.next.single, array ? [] : {});
  const added = plan(removed.source, { kind: "add", path: ["single"], key: array ? 0 : "new", value: true });
  assert.deepEqual(added.next.single, array ? [true] : { new: true }); assert.ok(added.source.endsWith(end));
});

test("empty irregular flow spaces can receive one exact literal entry without rewriting closing whitespace", () => {
  const input = start + '  map: {\r\n \n  } # map close\r\n  list: [ \r\n\n  ] # list close\r\n' + end;
  assert.equal(plan(input, { kind: "add", path: ["map"], key: "new", value: true }).source, input.replace('{\r\n \n  }', '{\r\n \n    "new": true\n  }'));
  assert.equal(plan(input, { kind: "add", path: ["list"], key: 0, value: false }).source, input.replace('[ \r\n\n  ]', '[ \r\n\n    false\n  ]'));
});

test("capabilities expose supported mixed/trailing operations but not ambiguous neighboring collections", () => {
  const input = source.replace('  list: ', '  blocked: [one, # ownership unclear\r\n    false]\r\n  list: '), t = targets(input);
  for (const target of [["map", "first"], ["list", 0]]) for (const kind of ["remove", "move-down", "move-to"]) assert.equal(t[kind].has(JSON.stringify(target)), true);
  assert.equal(t.rename.has('["map","first"]'), true); assert.equal(t.add.has('["map"]'), true); assert.equal(t.add.has('["list"]'), true);
  assert.equal(t.add.has('["blocked"]'), false); assert.equal(t["move-to"].has('["blocked",0]'), false);
});

test("separator, prefix, key/value and tail comments retain Source-only ownership", () => {
  for (const collection of ['[ # before entry\r\n    one, false, ]', '[one, # between entries\r\n    false, ]', '[one, false, # after entry\r\n  ]', '{ first: # key/value comment\r\n    false, second: true, }']) {
    const input = start + '  blocked: ' + collection + '\r\n' + end, array = collection.startsWith('[');
    for (const operation of [{ kind: "add", path: ["blocked"], key: array ? 2 : "new", value: true }, { kind: "remove", path: ["blocked", array ? 0 : "first"] }, { kind: "move-to", path: ["blocked", array ? 0 : "first"], position: 2 }]) assert.throws(() => plan(input, operation));
  }
});

test("aliases, anchors, tags, malformed punctuation, duplicate keys and unsafe mappings remain refused", () => {
  for (const collection of ['{ first: &owned [one], second: *owned, }', '{ first: !!str one, second: false, }', '{ first: one, first: false, }', '[one,, false, ]', '{ __proto__: false, second: one, }']) {
    const input = start + '  blocked: ' + collection + '\r\n' + end;
    assert.throws(() => plan(input, { kind: "add", path: ["blocked"], key: collection.startsWith('[') ? 1 : "new", value: true }));
  }
});

test("queue candidate verification keeps the single exact mixed-flow splice and refuses unrelated changes", () => {
  const operation = { kind: "move-to", path: ["map", "fourth"], position: 1 }, result = plan(source, operation), candidate = updateFrontmatter(source, fm => { fm.mixed = result.next; });
  assert.equal(operations.preserveStructuredPropertyOperationSource(candidate, source, "mixed", operation), result.source);
  assert.throws(() => operations.preserveStructuredPropertyOperationSource(updateFrontmatter(candidate, fm => { fm.unrelated = true; }), source, "mixed", operation));
  assert.throws(() => operations.preserveStructuredPropertyOperationSource(candidate, source.replace('first: 1.50', 'first: 2'), "mixed", operation));
});

test("complete crossed-range review limits and invalid destinations still apply to broader flow", () => {
  const input = start + '  list: ["' + 'x'.repeat(3000) + '",\r\n    "' + 'y'.repeat(3000) + '", ]\r\n' + end;
  assert.throws(() => plan(input, { kind: "move-to", path: ["list", 0], position: 2 }), /review/);
  for (const position of [0, 1, 5, 1.5, NaN, Infinity]) assert.throws(() => plan(source, { kind: "move-to", path: ["list", 0], position }));
  assert.throws(() => plan(source, { kind: "add", path: ["list"], key: 9, value: false }));
});
