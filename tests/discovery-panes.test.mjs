import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseMarkdown } from "../client/markdown.ts";
import { root } from "./host.mjs";

let directory, tagsPaneState, tagNodes, footnotesPaneState, footnoteEntries, mergeSearchQuery;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "discovery-panes-tests-"));
  const outfile = join(directory, "models.cjs");
  await build({ stdin: { contents: 'export { tagsPaneState, tagNodes } from "./client/tags-pane-model"; export { footnotesPaneState, footnoteEntries } from "./client/footnotes-pane-model"; export { mergeSearchQuery } from "./client/search-pane-model";', resolveDir: root }, outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ tagsPaneState, tagNodes, footnotesPaneState, footnoteEntries, mergeSearchQuery } = createRequire(import.meta.url)(outfile));
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/discovery-panes-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
const tags = (counts, state = {}) => tagNodes(counts, tagsPaneState(state));
const footnotes = text => footnoteEntries(parseMarkdown(text), text);

test("native Tags controls retain independent state with effective nested defaults and detached case-folded keys", () => {
  const input = { sortOrder: "alphabeticalReverse", useHierarchy: false, showSearch: true, searchQuery: "Work", foldedTags: ["#Work", "#work"], opaque: { keep: [1] } }, original = structuredClone(input), state = tagsPaneState(input);
  assert.deepEqual(input, original); assert.equal(state.sortOrder, "alphabeticalReverse"); assert.equal(state.useHierarchy, false); assert.deepEqual(state.foldedTags, ["#work"]); state.foldedTags.push("#other"); assert.deepEqual(input, original);
  assert.deepEqual(tagsPaneState({}), { sortOrder: "frequency", useHierarchy: true, showSearch: false, searchQuery: "", foldedTags: [] });
});
test("malformed tag controls, filters and fold limits reject before state can be applied", () => {
  for (const state of [{ sortOrder: "__proto__" }, { sortOrder: null }, { useHierarchy: 1 }, { showSearch: "true" }, { searchQuery: null }, { searchQuery: "x".repeat(1025) }, { foldedTags: null }, { foldedTags: ["work"] }, { foldedTags: ["#bad space"] }, { foldedTags: Array(4097).fill("#a") }, { foldedTags: ["#" + "x".repeat(8192)] }]) { assert.throws(() => tagsPaneState(state)); }
  assert.equal(tagsPaneState({ searchQuery: "<img src=x>" }).searchQuery, "<img src=x>");
});
test("tag hierarchy consumes indexed counts once, constructs missing ancestors and merges only case-equivalent identities", () => {
  const counts = { "#Work": 5, "#Work/Alpha": 2, "#work/alpha": 1, "#Work/Beta": 1, "#Separate/Child": 4 }, before = structuredClone(counts), result = tags(counts, { sortOrder: "alphabetical" });
  assert.deepEqual(counts, before); assert.deepEqual(result.map(node => [node.key, node.count, node.parent?.key ?? null, node.depth]), [
    ["#separate", 0, null, 1], ["#separate/child", 4, "#separate", 2], ["#work", 5, null, 1], ["#work/alpha", 3, "#work", 2], ["#work/beta", 1, "#work", 2],
  ]);
});
test("four tag sorts apply to every sibling level with stable alphabetical frequency ties", () => {
  const counts = { "#c": 2, "#a": 5, "#b": 2, "#a/second": 1, "#a/first": 3 }, names = sortOrder => tags(counts, { sortOrder, useHierarchy: false }).map(node => node.key);
  assert.deepEqual(names("frequency"), ["#a", "#a/first", "#b", "#c", "#a/second"]);
  assert.deepEqual(names("frequencyReverse"), ["#a/second", "#b", "#c", "#a/first", "#a"]);
  assert.deepEqual(names("alphabetical"), ["#a", "#a/first", "#a/second", "#b", "#c"]);
  assert.deepEqual(names("alphabeticalReverse"), ["#c", "#b", "#a/second", "#a/first", "#a"]);
  assert.deepEqual(tags(counts, { sortOrder: "frequency" }).map(node => node.key), ["#a", "#a/first", "#a/second", "#b", "#c"]);
});
test("literal tag filtering preserves matching ancestors without displaying unrelated descendants", () => {
  const counts = { "#Parent": 4, "#Parent/Child": 2, "#Parent/Other": 2, "#Separate": 1 };
  assert.deepEqual(tags(counts, { searchQuery: " CHILD " }).filter(node => node.visible).map(node => node.key), ["#parent", "#parent/child"]);
  assert.deepEqual(tags(counts, { useHierarchy: false, searchQuery: "CHILD" }).filter(node => node.visible).map(node => node.key), ["#parent/child"]);
  assert.deepEqual(tags(counts, { searchQuery: "missing" }).filter(node => node.visible), []);
});
test("invalid metadata names, counts and case-merge overflow do not produce navigable tag rows", () => {
  for (const counts of [{ bad: 1 }, { "#bad space": 1 }, { "#a": -1 }, { "#a": NaN }, { "#a": 1.5 }, { "#a": Number.MAX_SAFE_INTEGER, "#A": 1 }]) { assert.throws(() => tags(counts)); }
});
test("large tag inventories filter iteratively with distinct parent/child identities", () => {
  const counts = Object.fromEntries(Array.from({ length: 20000 }, (_, index) => ["#Root/Tag" + index, 1])), result = tags(counts, { searchQuery: "Tag19999" });
  assert.equal(result.length, 20001); assert.equal(new Set(result.map(node => node.key)).size, result.length); assert.deepEqual(result.filter(node => node.visible).map(node => node.key), ["#root", "#root/tag19999"]);
});
test("native modified Search fragments append or remove the first literal match without token rewriting", () => {
  assert.equal(mergeSearchQuery("  path:Work  ", "tag:#todo", true), "path:Work tag:#todo");
  assert.equal(mergeSearchQuery("tag:#todo tag:#todo", "tag:#todo", true), "tag:#todo");
  assert.equal(mergeSearchQuery("tag:#workbench", "tag:#work", true), "bench");
  assert.equal(mergeSearchQuery("old", "new", false), "new"); assert.equal(mergeSearchQuery("", "tag:#todo", true), "tag:#todo");
});
test("Footnotes targets retain native file state with an explicit independent follow option", () => {
  const input = { file: "Notes/\u03bb.md", followActiveFile: false, opaque: { keep: [true] } }, before = structuredClone(input);
  assert.deepEqual(footnotesPaneState(input), { file: "Notes/\u03bb.md", followActiveFile: false }); assert.deepEqual(input, before);
  assert.deepEqual(footnotesPaneState({}), { file: "", followActiveFile: true });
  for (const state of [{ file: null }, { followActiveFile: 0 }, ...["/a", "a//b", "../a", ".obsidian/workspace.json", "a\\b", "a\u0000b"].map(file => ({ file }))]) { assert.throws(() => footnotesPaneState(state)); }
});
test("defined footnotes order by first reference, with unreferenced definitions after used notes", () => {
  const text = "[^unused]: Unused first definition.\n\nSecond [^b], first [^a], repeat [^b].\n\n[^a]: A.\n[^b]: B.\n", cache = parseMarkdown(text), before = structuredClone(cache), result = footnoteEntries(cache, text);
  assert.deepEqual(result.map(item => [item.id, item.number, item.references.length]), [["b", 1, 2], ["a", 2, 1], ["unused", 3, 0]]);
  assert.deepEqual(structuredClone(cache), before); result[0].references[0].position.start.line = 999; assert.deepEqual(structuredClone(cache), before);
});
test("missing and duplicate footnotes remain explicit, individually positioned and outside valid-note numbering", () => {
  const text = "Missing [^gone], valid [^twice].\n\n[^twice]: First.\n[^twice]: Second.\n", result = footnotes(text);
  assert.deepEqual(result.map(item => [item.id, item.number, item.definitions.length]), [["twice", 1, 2], ["gone", null, 0]]);
  assert.deepEqual(result[0].definitions.map(definition => definition.labelPosition.start.line), [2, 3]);
  assert.equal(text.slice(result[1].references[0].position.start.offset, result[1].references[0].position.end.offset), "[^gone]");
});
test("multiline CRLF/Unicode footnotes preserve exact source targets while code and metadata stay excluded", () => {
  const text = "---\r\ntitle: '[^hidden]'\r\n---\r\nText \u03bb [^note]. `[^code]`\r\n\r\n[^note]: **Bold** first.\r\n    Continued \u4e2d\u6587.\r\n\r\n```\r\n[^literal]: Not a definition.\r\n```\r\n", result = footnotes(text);
  assert.equal(result.length, 1); assert.equal(result[0].id, "note"); assert.equal(result[0].definitions[0].content, "**Bold** first.\nContinued \u4e2d\u6587."); assert.equal(result[0].references.length, 1);
  for (const position of [result[0].definitions[0].labelPosition, result[0].references[0].position]) { assert.equal(text.slice(position.start.offset, position.end.offset), "[^note]"); }
});
test("invalid, stale and mismatched footnote positions refuse before navigation targets exist", () => {
  const text = "Text [^a].\n\n[^a]: Body.\n", original = parseMarkdown(text);
  for (const change of [
    cache => { cache.footnoteRefs[0].position.start.offset = -1; },
    cache => { cache.footnoteRefs[0].position.start.line = 10; },
    cache => { cache.footnotes[0].labelPosition.end.offset = text.length + 1; },
    cache => { cache.footnoteRefs[0].id = "other"; },
    cache => { cache.footnotes[0].id = "other"; },
  ]) { const cache = structuredClone(original); change(cache); assert.throws(() => footnoteEntries(cache, text)); }
  assert.throws(() => footnoteEntries(original, "Inserted\n" + text));
});
test("large repeated-reference inventories keep exact detached positions without recursive traversal", () => {
  const text = Array(10000).fill("[^many]").join(" ") + "\n\n[^many]: One note.\n", result = footnotes(text);
  assert.equal(result.length, 1); assert.equal(result[0].references.length, 10000);
  const last = result[0].references.at(-1).position; assert.equal(text.slice(last.start.offset, last.end.offset), "[^many]");
});
