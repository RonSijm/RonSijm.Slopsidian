import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Pure source/CST tests. This process starts no build, server or desktop host.
registerHooks({
  resolve(specifier, context, next) { try { return next(specifier, context); } catch (issue) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context); throw issue; } },
  load(url, context, next) { if (!url.includes("/client/") || !url.endsWith(".ts")) return next(url, context); return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform" }) }; }
});
const { planStructuredPropertyOperation: plan, preserveStructuredPropertyOperationSource: preserve, structuredPropertyOperationTargets: targets } = await import("../client/structured-property-operations.ts");
const { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts");
const source = '\ufeff---\r\n# Keep λ\r\nopaque:\r\n  map:\r\n    first: 1.50 # preserve number\r\n    second: true # attached comment\r\n    third: \'λ 😀\'\r\n  list:\r\n    - one # first comment\r\n    - { child: value } # subtree comment\r\n    - [two, false]\r\n  flow: { a: 1, b: 2, c: 3 } # retain flow\r\n  emptyMap: {}\r\n  emptyList: []\r\nanchored: &shared { retained: exact }\r\naliased: *shared\r\n---\r\n# Body λ\r\n\r\nUntouched 😀.\r\n';
const value = text => parseMarkdown(text).frontmatter.opaque;
const run = (text, operation) => plan(text, "opaque", value(text), operation);
const add = (path, key, value) => ({ kind: "add", path, key, value });
const remove = path => ({ kind: "remove", path });

test("block map addition splices one quoted key and scalar without serializing surrounding YAML", () => {
  const result = run(source, add(["map"], "added λ", "001\n😀"));
  assert.equal(result.source, source.replace('  list:\r\n', '    "added λ": "001\\n😀"\r\n  list:\r\n'));
  assert.equal(result.next.map["added λ"], "001\n😀"); assert.match(result.review, /Literal YAML insertion/);
  assert.match(result.review, /\["opaque","map","added λ"\]/); assert.ok(result.source.startsWith("\ufeff"));
});

for (const [label, entry] of [["text", ""], ["number", -0], ["boolean", true], ["null", null]]) {
  test(`empty flow maps and lists accept explicit ${label} entries`, () => {
    const map = run(source, add(["emptyMap"], "key", entry)), list = run(source, add(["emptyList"], 0, entry));
    assert.ok(Object.is(map.next.emptyMap.key, entry)); assert.ok(Object.is(list.next.emptyList[0], entry));
    assert.equal(map.source.slice(0, map.source.indexOf('  emptyMap:')), source.slice(0, source.indexOf('  emptyMap:')));
    assert.equal(run(map.source, remove(["emptyMap", "key"])).source, source);
    assert.equal(run(list.source, remove(["emptyList", 0])).source, source);
  });
}

test("block list insertion and append use explicit current indexes and preserve prior spelling", () => {
  const first = run(source, add(["list"], 0, false));
  assert.equal(first.source, source.replace('    - one', '    - false\r\n    - one'));
  const middle = run(source, add(["list"], 1, null)); assert.equal(middle.next.list[1], null);
  assert.equal(middle.source, source.replace('    - { child:', '    - null\r\n    - { child:'));
  const append = run(source, add(["list"], 3, 2.5));
  assert.equal(append.source, source.replace('  flow:', '    - 2.5\r\n  flow:'));
});

for (const key of ["a", "b", "c"]) {
  test(`flow map removes ${key} with the right comma and unchanged outer bytes`, () => {
    const result = run(source, remove(["flow", key])); assert.equal(Object.hasOwn(result.next.flow, key), false);
    assert.equal(result.source.replace(/  flow:.*\r\n/, ""), source.replace(/  flow:.*\r\n/, ""));
    assert.match(result.source, / # retain flow\r\n/); assert.ok(!/\{\s*,|,,|,\s*\}/.test(result.source));
  });
}

test("flow list insertion/removal covers first, middle and append, preserving nested values", () => {
  const text = '---\nopaque: ["one", { key: true }, [2, false]] # intact\n---\nbody\n';
  for (let index = 0; index <= 3; index++) {
    const result = run(text, add([], index, "new")); assert.equal(result.next[index], "new");
    assert.equal(run(result.source, remove([index])).source, text);
  }
});

test("bounded subtree removal reviews the complete current value and exact removed source", () => {
  const result = run(source, remove(["list", 1]));
  assert.deepEqual(result.next.list, ["one", ["two", false]]);
  assert.equal(result.source, source.replace('    - { child: value } # subtree comment\r\n', ""));
  assert.match(result.review, /Current value: \{"child": "value"\}/); assert.match(result.review, /# subtree comment/);
  assert.match(result.review, /\["opaque","list",1\]/);
});

test("removing a sole block entry retains an explicit empty container instead of YAML null", () => {
  for (const [entry, operation, expected] of [['  key: 1 # removed\n', remove(["key"]), '  {}\n'], ['  - 1 # removed\n', remove([0]), '  []\n']]) {
    const text = '---\nopaque:\n' + entry + 'unrelated: exact\n---\nbody\n', result = run(text, operation);
    assert.equal(result.source, text.replace(entry, expected)); assert.equal(result.next === null, false);
    const added = run(result.source, add([], Array.isArray(result.next) ? 0 : "new", true)); assert.ok(added.source.includes("true"));
  }
});

test("root and nested removals preserve preceding standalone comments and unrelated lexemes", () => {
  const text = '---\nopaque:\n  # retained explanation\n  first: 1 # removed\n  # kept sibling comment\n  second: 2.00\nnext: \'exact\'\n---\nbody\n';
  const result = run(text, remove(["first"]));
  assert.equal(result.source, text.replace('  first: 1 # removed\n', ""));
  assert.ok(result.source.includes('  # retained explanation\n  # kept sibling comment\n  second: 2.00'));
});

test("reviewed operation preservation verifies the queue's entire candidate semantics", () => {
  const operation = add(["map"], "added", false), expected = run(source, operation);
  const updated = updateFrontmatter(source, frontmatter => { frontmatter.opaque = expected.next; });
  assert.equal(preserve(updated, source, "opaque", operation), expected.source);
  assert.throws(() => preserve(updateFrontmatter(updated, frontmatter => { frontmatter.aliased.retained = "changed"; }), source, "opaque", operation));
  assert.throws(() => preserve(updateFrontmatter(source, frontmatter => { frontmatter.opaque.map.wrong = false; }), source, "opaque", operation));
});

test("unsafe keys, collisions, stale paths, indexes, scalar limits and precision are refused", () => {
  for (const operation of [add(["map"], "first", true), add(["map"], "__proto__", true), add(["map"], "constructor", true), add(["map"], "<<", true),
    add(["map"], "", true), add(["map"], "x".repeat(257), true), add(["list"], 4, true), add(["list"], -1, true), add(["list"], "0", true),
    add(["missing"], "new", true), remove(["map", "missing"]), remove(["list", 3]), remove([]), add(["map"], "new", Infinity),
    add(["map"], "new", Number.MAX_SAFE_INTEGER + 1), add(["map"], "new", "x".repeat(4097)), add(["map"], "new", "\u0000"),
    add(["map"], "new", { object: true }), { kind: "add", path: ["map"], key: "new", value: true, extra: true }]) assert.throws(() => run(source, operation));
  assert.throws(() => plan(source, "opaque", { ...value(source), changed: true }, add([], "new", true)));
});

test("getter-bearing operations and source snapshots are refused before invoking a getter", () => {
  let reads = 0; const operation = { kind: "add", path: ["map"], key: "new", get value() { reads++; return true; } };
  assert.throws(() => run(source, operation));
  const path = ["map"]; Object.defineProperty(path, 0, { get() { reads++; return "map"; } }); assert.throws(() => run(source, add(path, "new", true)));
  const old = { get map() { reads++; return {}; } }; assert.throws(() => plan(source, "opaque", old, add([], "new", true))); assert.equal(reads, 0);
});

test("mixed multiline and inline trailing-comma flow now preserve exact source through the existing queue candidate", () => {
  for (const [yaml, expected] of [['opaque: { a: 1,\n  b: 2 }\n', 'opaque: { a: 1,\n  b: 2,\n  "new": true }\n'], ['opaque: { a: 1, }\n', 'opaque: { a: 1, "new": true, }\n']]) {
    const text = '---\n' + yaml + '---\nbody\n', result = run(text, add([], "new", true));
    assert.equal(result.source, '---\n' + expected + '---\nbody\n'); assert.deepEqual(result.next, { a: 1, ...(yaml.includes('b:') ? { b: 2 } : {}), new: true });
    const candidate = updateFrontmatter(text, frontmatter => { frontmatter.opaque = result.next; }); assert.equal(preserve(candidate, text, "opaque", add([], "new", true)), result.source);
  }
});

test("compact block, aliases/tags/merges, duplicate keys and imprecise YAML stay Source-only", () => {
  for (const yaml of ['opaque:\n  - a: 1\n    b: 2\n', 'opaque:\n  a: &anchor 1\n  b: *anchor\n',
    'opaque: { a: !custom value }\n', 'opaque: { <<: { a: 1 } }\n', 'opaque: { a: 1, a: 2 }\n', 'opaque: { a: 0.10000000000000001 }\n']) {
    const text = '---\n' + yaml + '---\nbody\n';
    assert.throws(() => run(text, add(yaml.includes('  -') ? [0] : [], "new", true)), yaml);
  }
});

test("capabilities expose only proven layouts and bound destructive subtree review", () => {
  const supported = targets(source, "opaque", value(source)); assert.ok(supported.add.has('["emptyMap"]')); assert.ok(supported.add.has('["emptyList"]'));
  assert.ok(supported.remove.has('["list",1]')); assert.ok(supported.add.has("[]"));
  const large = '---\nopaque:\n  huge:\n    a: "' + "x".repeat(4000) + '"\n    b: "' + "y".repeat(4000) + '"\n  keep: true\n---\nbody\n';
  assert.equal(targets(large, "opaque", value(large)).remove.has('["huge"]'), false); assert.throws(() => run(large, remove(["huge"])));
});
