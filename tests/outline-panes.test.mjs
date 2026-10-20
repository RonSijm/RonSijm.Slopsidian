import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown } from "../client/markdown.ts";

const root = fileURLToPath(new URL("../", import.meta.url)); let directory, outlineState, outlineNodes;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime/outline-panes-tests-")); const output = join(directory, "outline.mjs");
  await build({ entryPoints: [join(root, "client/outline-model.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" }); ({ outlineState, outlineNodes } = await import(pathToFileURL(output).href));
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/outline-panes-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
const nodes = (text, query = "") => outlineNodes(parseMarkdown(text).headings, query);

test("original Outline state retains its target and controls with independent defaults and detached folds", () => {
  const input = { file: "Notes/λ.md", followCursor: true, showSearch: true, searchQuery: "child", foldedHeadings: ['[1,"A",0]', '[1,"A",0]'], opaque: { keep: [true] } }, before = structuredClone(input), state = outlineState(input);
  assert.deepEqual(input, before); assert.equal(state.followActiveFile, true); assert.deepEqual(state.foldedHeadings, ['[1,"A",0]']); state.foldedHeadings.push("other"); assert.deepEqual(input, before);
  assert.deepEqual(outlineState({}), { file: "", followActiveFile: true, followCursor: false, showSearch: false, searchQuery: "", foldedHeadings: [] });
});
test("malformed note/control/filter/fold state rejects before use, including unsafe paths and null values", () => {
  for (const state of [{ file: null }, { followCursor: "true" }, { followActiveFile: 0 }, { showSearch: null }, { searchQuery: [] }, { searchQuery: "x".repeat(1025) }, { foldedHeadings: null }, { foldedHeadings: Array(4097).fill("a") }, { foldedHeadings: ["x".repeat(8193)] }, ...["/a", "a//b", "../a", ".obsidian/workspace.json", "a\\b", "a\u0000b"].map(file => ({ file }))]) { assert.throws(() => outlineState(state)); }
  assert.equal(outlineState({ searchQuery: "<img src=x>" }).searchQuery, "<img src=x>");
});
test("ATX/Setext hierarchy skips absent levels and excludes frontmatter, fenced code and comments", () => {
  const text = "---\ntitle: '# Hidden'\n---\n# Root\n#### Deep\n## Branch\n### Child\nTitle\n=====\n```md\n# Literal\n```\n<!--\n# Comment\n-->\n";
  const headings = parseMarkdown(text).headings, before = structuredClone(headings), tree = outlineNodes(headings, "");
  assert.deepEqual(tree.map(n => [n.heading.heading, n.parent?.heading.heading ?? null, n.depth]), [["Root", null, 1], ["Deep", "Root", 2], ["Branch", "Root", 2], ["Child", "Branch", 3], ["Title", null, 1]]); assert.deepEqual(headings, before);
});
test("duplicate heading identities are distinct and folds survive inserted lines before unchanged headings", () => {
  const text = "# Root\n## Repeat\n### Leaf\n## Repeat\n### Leaf\n# Other\n", before = nodes(text), after = nodes("Inserted line\n\n" + text);
  assert.equal(new Set(before.map(n => n.key)).size, before.length); assert.deepEqual(after.map(n => n.key), before.map(n => n.key)); assert.notEqual(after[0].heading.position.start.line, before[0].heading.position.start.line);
  assert.equal(before[2].parent, before[1]); assert.equal(before[4].parent, before[3]);
});
test("case-insensitive heading filtering retains matching ancestors and ordinary tree order without mutating metadata", () => {
  const tree = nodes("# Root\n## Branch\n### TARGET λ\n## Other\n# Separate\n", " target λ ");
  assert.deepEqual(tree.filter(n => n.visible).map(n => n.heading.heading), ["Root", "Branch", "TARGET λ"]); assert.equal(tree[3].visible, false); assert.equal(tree[4].visible, false);
  assert.deepEqual(nodes("# Empty\n", "missing").filter(n => n.visible), []);
});
test("invalid heading positions and levels cannot become navigation targets", () => {
  const valid = parseMarkdown("# Root\n## Child\n").headings;
  for (const headings of [[{ ...valid[0], level: 7 }], [{ ...valid[0], level: 0 }], [{ ...valid[0], heading: null }], [valid[1], valid[0]], [valid[0], valid[0]], [{ ...valid[0], position: { ...valid[0].position, start: { line: -1, offset: 0, ch: 0 } } }]]) { assert.throws(() => outlineNodes(headings, "")); }
});
test("large heading inventories build/filter iteratively with distinct duplicate keys", () => {
  const headings = Array.from({ length: 25000 }, (_, i) => ({ heading: i === 24999 ? "Last target" : "Repeated", level: i % 6 + 1, position: { start: { line: i, offset: i * 20, ch: 0 }, end: { line: i, offset: i * 20 + 10, ch: 10 } } }));
  const tree = outlineNodes(headings, "Last target"); assert.equal(tree.length, 25000); assert.equal(new Set(tree.map(n => n.key)).size, 25000); assert.ok(tree.filter(n => n.visible).length <= 6); assert.equal(tree.at(-1).visible, true);
});
