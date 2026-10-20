import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Pure production-model/controller checks; no host, native bridge or build runs.
registerHooks({
  resolve(specifier, context, next) { try { return next(specifier, context); } catch (issue) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context); throw issue; } },
  load(url, context, next) { if (!url.includes("/client/") || !url.endsWith(".ts")) return next(url, context); return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform" }) }; }
});
const api = await import("../client/structured-properties.ts"), operations = await import("../client/structured-property-operations.ts");
const { parseMarkdown, updateFrontmatter } = await import("../client/markdown.ts");
const { nestedPropertyAuthoringReadOnlyFixture } = await import("../tools/nested-property-authoring-scenarios.mjs");
const text = '\ufeff---\r\n# Keep λ\r\nopaque:\r\n  map:\r\n    absent: # exact comment\r\n    bare:\r\n    original: 1.50 # exact value\r\n    "quoted λ": { child: [one, false] } # exact subtree\r\n  flow: { a: 1.50, "β key": false } # outer\r\n  list:\r\n    - # empty item\r\n    - retained\r\n  emptyMap: {}\r\n  emptyList: []\r\nunknown: &shared { text: exact }\r\nalias: *shared\r\n---\r\n# Body 😀\r\n\r\nKeep exact body.\r\n';
const value = source => parseMarkdown(source).frontmatter.opaque;
const plan = (source, operation) => operations.planStructuredPropertyOperation(source, "opaque", value(source), operation);
const rename = (path, key) => ({ kind: "rename", path, key });
const add = (path, key, value) => ({ kind: "add", path, key, value });
const remove = path => ({ kind: "remove", path });
function edit(source, path, next) {
  const original = value(source), model = api.structuredPropertyModel(original, source, "opaque"); assert.ok(model);
  const leaf = model.leaves.find(leaf => JSON.stringify(leaf.path) === JSON.stringify(path)); assert.ok(leaf);
  const changed = api.replaceStructuredPropertyValue(original, path, leaf.value, next), updated = updateFrontmatter(source, fm => { fm.opaque = changed; });
  const result = api.preserveStructuredPropertySource(updated, source, "opaque", path, next);
  assert.deepEqual(value(result), changed); return { source: result, leaf };
}

test("the actual shared GUI/cache fixture has complete CRLF source and precisely advertised new targets", () => {
  const source = nestedPropertyAuthoringReadOnlyFixture.source; assert.equal(source.replaceAll("\r\n", "").includes("\n"), false);
  const model = api.structuredPropertyModel(value(source), source, "opaque"), targets = operations.structuredPropertyOperationTargets(source, "opaque", value(source)); assert.ok(model);
  assert.equal(model.leaves.find(leaf => JSON.stringify(leaf.path) === '["map","implicit"]').implicit, true);
  assert.equal(api.structuredScalarLeafEditable(model.leaves.find(leaf => JSON.stringify(leaf.path) === '["ambiguous","missing"]')), false);
  assert.ok(targets.rename.has('["map","quoted λ"]')); assert.ok(targets.add.has('["containers"]')); assert.equal(targets.rename.has('["ambiguous","other"]'), false);
});

test("implicit map and sequence nulls get explicit punctuation proofs without fabricated nonempty ranges", () => {
  const model = api.structuredPropertyModel(value(text), text, "opaque");
  for (const path of [["map", "absent"], ["map", "bare"], ["list", 0]]) { const leaf = model.leaves.find(leaf => JSON.stringify(leaf.path) === JSON.stringify(path)); assert.equal(leaf.from, leaf.to); assert.equal(leaf.implicit, true); assert.equal(api.structuredScalarLeafEditable(leaf), true); }
  assert.equal(edit(text, ["map", "absent"], "λ 😀").source, text.replace("absent: #", 'absent: "λ 😀" #'));
  assert.equal(edit(text, ["map", "bare"], false).source, text.replace("bare:\r\n", "bare: false\r\n"));
  assert.equal(edit(text, ["list", 0], -0).source, text.replace("- # empty item", "- -0 # empty item"));
});

for (const [literal, next] of [["typed", "typed"], [false, false], [null, null], [1.25, 1.25], [-0, -0], ["line\nnext\u2028", "line\nnext\u2028"]]) {
  test("implicit null safely accepts selected type " + (Object.is(literal, -0) ? "negative zero" : JSON.stringify(literal)), () => {
    const result = edit(text, ["map", "absent"], next); assert.ok(Object.is(value(result.source).map.absent, next));
    assert.ok(result.source.startsWith("\ufeff")); assert.ok(result.source.endsWith("Keep exact body.\r\n"));
    assert.ok(result.source.includes('original: 1.50 # exact value')); assert.ok(result.source.includes('"quoted λ": { child: [one, false] } # exact subtree'));
    if (next === null) assert.equal(result.source, text);
  });
}

test("implicit flow nulls preserve surrounding punctuation and exact whitespace", () => {
  for (const [body, expected] of [["{ a: , b: true }", '{ a: "typed", b: true }'], ["{ a: }", '{ a: "typed"}'], ["{ a:, b: true }", '{ a: "typed", b: true }']]) {
    const source = '---\nopaque: ' + body + '\n---\nbody\n'; assert.equal(edit(source, ["a"], "typed").source, source.replace(body, expected));
  }
});

test("missing-colon and multiline flow nulls cannot authorize an insertion", () => {
  for (const source of ['---\nopaque: { a, b: true }\n---\nbody\n', '---\nopaque: { a: ,\n  b: true }\n---\nbody\n']) {
    const model = api.structuredPropertyModel(value(source), source, "opaque");
    if (model) { const leaf = model.leaves.find(leaf => leaf.path[0] === "a"); assert.equal(api.structuredScalarLeafEditable(leaf), false); }
    assert.throws(() => edit(source, ["a"], "typed"));
  }
});

test("an implicit null with following standalone comments preserves every comment and indentation byte", () => {
  const source = '---\r\nopaque:\r\n  key:\r\n    # explanation\r\n  keep: true\r\n---\r\nbody\r\n';
  assert.equal(edit(source, ["key"], 2).source, source.replace('key:\r\n', 'key: 2\r\n'));
});

test("key rename changes only its exact key token while retaining descendant/comment/value spellings and position", () => {
  for (const [path, key, old, replacement] of [
    [["map", "quoted λ"], "new Ω 😀", '"quoted λ": { child: [one, false] }', '"new Ω 😀": { child: [one, false] }'],
    [["map", "absent"], "explicit key", 'absent: # exact comment', '"explicit key": # exact comment'],
    [["flow", "β key"], 'quote " λ', '"β key": false', '"quote \\" λ": false'],
    [["map"], "renamed branch", '  map:\r\n', '  "renamed branch":\r\n']
  ]) { const result = plan(text, rename(path, key)); assert.equal(result.source, text.replace(old, replacement)); assert.match(result.review, /value, descendants, comments and position stay byte-for-byte unchanged/); }
});

test("rename candidates retain list-index and explicit-key refusals while proving mixed/trailing flow keys", () => {
  const supported = operations.structuredPropertyOperationTargets(text, "opaque", value(text)); assert.ok(supported.rename.has('["map","absent"]')); assert.ok(supported.rename.has('["flow","β key"]')); assert.equal(supported.rename.has('["list",0]'), false);
  for (const source of ['---\nopaque: { a: 1,\n b: 2 }\n---\nbody\n', '---\nopaque: { a: 1, }\n---\nbody\n']) {
    const operation = rename(["a"], "next"), result = plan(source, operation); assert.equal(result.source, source.replace('a: 1', '"next": 1')); assert.equal(result.next.next, 1); assert.equal(Object.hasOwn(result.next, "a"), false); assert.ok(operations.structuredPropertyOperationTargets(source, "opaque", value(source)).rename.has('["a"]'));
    const candidate = updateFrontmatter(source, fm => { fm.opaque = result.next; }); assert.equal(operations.preserveStructuredPropertyOperationSource(candidate, source, "opaque", operation), result.source);
  }
  for (const source of ['---\nopaque:\n  ? a\n  : 1\n---\nbody\n', '---\nopaque: { a: 1, # ambiguous ownership\n b: 2 }\n---\nbody\n']) assert.throws(() => plan(source, rename(["a"], "next")));
});

test("duplicate, forbidden, oversized and structurally invalid renames refuse before source mutation", () => {
  for (const operation of [rename(["map", "original"], "absent"), rename(["map", "original"], "ABSENT"), rename(["map", "original"], "original"), rename(["map", "original"], ""), rename(["map", "original"], "constructor"), rename(["map", "original"], "__proto__"), rename(["map", "original"], "<<"), rename(["map", "original"], "x".repeat(257)), rename(["map", "original"], "new\nline"), rename(["list", 0], "key"), rename([], "key"), rename(["missing"], "key")]) assert.throws(() => plan(text, operation));
  assert.equal(value(text).map.original, 1.5);
});

test("rename preserves actual zero/false/null types rather than converting them through text", () => {
  const source = '---\nopaque: { zero: -0, falsey: false, empty: null }\n---\nbody\n';
  for (const [name, next] of [["zero", -0], ["falsey", false], ["empty", null]]) { const result = plan(source, rename([name], name + " λ")); assert.ok(Object.is(result.next[name + " λ"], next)); assert.equal(Object.hasOwn(result.next, name), false); }
});

test("the ordinary frontmatter queue candidate is verified but only the exact renamed key splice survives", () => {
  const operation = rename(["map", "quoted λ"], "retained subtree"), result = plan(text, operation), candidate = updateFrontmatter(text, fm => { fm.opaque = result.next; });
  assert.equal(operations.preserveStructuredPropertyOperationSource(candidate, text, "opaque", operation), result.source);
  const wrong = updateFrontmatter(candidate, fm => { fm.opaque.map.original = 9; }); assert.throws(() => operations.preserveStructuredPropertyOperationSource(wrong, text, "opaque", operation));
  const unrelated = updateFrontmatter(candidate, fm => { fm.newUnrelated = true; }); assert.throws(() => operations.preserveStructuredPropertyOperationSource(unrelated, text, "opaque", operation));
});

for (const empty of [{}, []]) test("addition creates an empty " + (Array.isArray(empty) ? "List" : "Map") + " that can be filled and removed exactly", () => {
  for (const [path, key] of [[["emptyMap"], "container λ"], [["emptyList"], 0]]) {
    const result = plan(text, add(path, key, empty)); assert.match(result.review, Array.isArray(empty) ? /\[\]/ : /\{\}/);
    const child = [...path, key], filled = plan(result.source, add(child, Array.isArray(empty) ? 0 : "leaf", false)); assert.ok(filled.source.includes("false"));
    const removed = plan(filled.source, remove([...child, Array.isArray(empty) ? 0 : "leaf"])); assert.equal(removed.source, result.source);
    assert.equal(plan(removed.source, remove(child)).source, text);
  }
});

test("only fresh empty containers may be inserted; arbitrary trees/getters/sharing are refused without getter execution", () => {
  let reads = 0;
  const getters = Object.defineProperty({}, "key", { enumerable: true, get() { reads++; return "x"; } });
  for (const item of [{ child: true }, [true], getters, new Map(), Object.create({ inherited: true }), new Date()]) assert.throws(() => plan(text, add(["emptyMap"], "bad", item)));
  const path = ["map", "original"]; Object.defineProperty(path, 0, { get() { reads++; return "map"; } }); assert.throws(() => plan(text, rename(path, "new")));
  const operation = { kind: "rename", path: ["map", "original"], get key() { reads++; return "new"; } }; assert.throws(() => plan(text, operation)); assert.equal(reads, 0);
});

test("stale whole-property snapshots cannot be reused for renaming or empty-container insertion", () => {
  const changed = { ...value(text), injected: false };
  for (const operation of [rename(["map", "original"], "new"), add(["emptyMap"], "new", {})]) assert.throws(() => operations.planStructuredPropertyOperation(text, "opaque", changed, operation), /changed/);
});
