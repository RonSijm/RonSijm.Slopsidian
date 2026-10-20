import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseMarkdown } from "../client/markdown.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, outlineState, outlineNodes, planOutlineMove, outlineSibling, OutlineView;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime/outline-panes-tests-")); const output = join(directory, "outline.mjs");
  await build({ entryPoints: [join(root, "client/outline-model.ts")], outfile: output, bundle: true, platform: "node", format: "esm",   logLevel: "silent" }); ({ outlineState, outlineNodes } = await import(pathToFileURL(output).href));   const reorder = join(directory, "reorder.mjs");
  await build({ entryPoints: [join(root, "client/outline-reorder.ts")], outfile: reorder, bundle: true, platform: "node", format: "esm", logLevel: "silent", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } }); ({ planOutlineMove, outlineSibling } = await import(pathToFileURL(reorder).href));
  const view = join(directory, "view.cjs"); await build({ entryPoints: [join(root, "client/outline-view.ts")], outfile: view, bundle: true, platform: "node", format: "cjs", logLevel: "silent" }); ({ OutlineView } = createRequire(import.meta.url)(view));
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

const move = (text, source, target, placement, eol = "\n") => { const headings = parseMarkdown(text).headings; return planOutlineMove(text, headings, source, target, placement, eol); };
test("reorder moves a heading with its children and keeps BOM, frontmatter, CRLF, Setext and code bytes", () => {
  const text = "\ufeff---\r\ntitle: x\r\n---\r\nIntro\r\n\r\n# A\r\nbody\r\n## A1\r\n```\r\n# not\r\n```\r\nSetext\r\n======\r\ntail\r\n# C\r\nlast";
  const plan = move(text, 0, 2, "after", "\r\n");
  assert.equal(plan.text, "\ufeff---\r\ntitle: x\r\n---\r\nIntro\r\n\r\nSetext\r\n======\r\ntail\r\n# A\r\nbody\r\n## A1\r\n```\r\n# not\r\n```\r\n# C\r\nlast");
  assert.equal(plan.text.slice(0, plan.from), text.slice(0, plan.from)); assert.equal(plan.text.slice(plan.text.length - (text.length - plan.to)), text.slice(plan.to)); assert.equal(plan.text.length, text.length);
  assert.throws(() => move(text, 0, 2, "before", "\r\n"), /already/);
});
test("reorder rejects a move that would merge Setext text with a preceding paragraph", () => {
  assert.throws(() => move("Intro\n# A\nSetext\n======\n", 0, 1, "after"), /parse/);
});
test("reorder handles unterminated last line in both directions and rejects no-op, self and nested targets", () => {
  const text = "# A\nx\n# B\ny";
  assert.equal(move(text, 0, 1, "after").text, "# B\ny\n# A\nx");
  assert.equal(move(text, 1, 0, "before").text, "# B\ny\n# A\nx");
  assert.throws(() => move(text, 0, 1, "before"), /already/);
  assert.throws(() => move("# A\n## B\n", 0, 1, "after"), /own section/);
});
test("reorder permutes duplicate headings and reports the order map; siblings stay within their parent", () => {
  const text = "# R\n## D\n### L\n## D\n### L\n# S\n", plan = move("# R\n## D\n### L1\n## D\n### L2\n# S\n", 3, 1, "before");
  assert.equal(plan.text, "# R\n## D\n### L2\n## D\n### L1\n# S\n"); assert.deepEqual(plan.order, [0, 3, 4, 1, 2, 5]);
  assert.throws(() => move(text, 3, 1, "before"), /identical/);
  const headings = parseMarkdown(text).headings;
  assert.equal(outlineSibling(headings, 1, 1), 3); assert.equal(outlineSibling(headings, 3, 1), -1); assert.equal(outlineSibling(headings, 2, -1), -1); assert.equal(outlineSibling(headings, 5, -1), 0);
});
test("reorder refuses moves that would change comment or quote parsing", () => {
  assert.throws(() => move("# X\n# A\n<!-- open\n# Q\n# B\n", 1, 0, "before"), /parse/);
  assert.throws(() => move("# A\n> # Q\n# B\n", 0, 1, "after"), /top-level|parse/);
});

function reorderFixture(mutate = () => {}) {
  const text = "# A\nx\n# B\ny\n", headings = parseMarkdown(text).headings, file = { path: "N.md" }, nodes = outlineNodes(headings, "");
  const dto = { path: "N.md" }, calls = [], state = { text };
  const editor = { cm: { state: { lineBreak: "\n" } }, getValue: () => state.text, replaceExpected: (expected, from, to, insert) => { assert.equal(expected, text); calls.push([from, to]); state.text = text.slice(0, from) + insert + text.slice(to); } };
  const session = { document: { file: dto, version: "v1" }, originRoot: "root", isReloading: false };
  const view = { isLoaded: true, file, session, isSaving: false, editor };
  const sessions = new Map([["N.md", session]]);
  const app = { vault: { readOnly: false, rootPath: "root", getFileByPath: path => path === "N.md" ? file : null, readDocument: async () => ({ version: "v1" }) }, workspace: { sessions, updateOpenDocuments() {} }, metadataCache: { updateOpenDocuments() {} } };
  const outline = Object.assign(Object.create(OutlineView.prototype), { app, nodes, snapshot: { id: 7, file, path: "N.md", text, headings }, options: { file: "N.md", foldedHeadings: [] }, filteredFolds: new Set(), focusKey: "", message: "", scheduled: 0, interactive: () => true, source: () => view, schedule() { this.scheduled++; }, save() {} });
  mutate({ app, session, view, sessions, file, dto, outline });
  return { outline, calls, state, keys: nodes.map(node => node.key), text };
}
test("reorder accepts a real distinct FileEntry DTO for a live session and edits once", async () => {
  const { outline, calls, state, keys } = reorderFixture();
  await outline.reorder(keys[0], 7, keys[1], "after", 7);
  assert.equal(calls.length, 1); assert.equal(state.text, "# B\ny\n# A\nx\n");
});
test("reorder refuses wrong-path, replaced, detached, renamed and changed-version sessions before editing", async () => {
  const cases = {
    wrongPath: ({ dto }) => { dto.path = "Other.md"; },
    replacedSession: ({ sessions }) => { sessions.set("N.md", { document: { file: { path: "N.md" }, version: "v1" }, originRoot: "root" }); },
    detachedSession: ({ sessions }) => { sessions.delete("N.md"); },
    otherRoot: ({ session }) => { session.originRoot = "elsewhere"; },
    replacedFile: ({ app }) => { app.vault.getFileByPath = () => ({ path: "N.md" }); },
    version: ({ session }) => { session.document.version = "v0"; },
    reloading: ({ session }) => { session.isReloading = true; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const { outline, calls, state, keys, text } = reorderFixture(mutate);
    await assert.rejects(() => outline.reorder(keys[0], 7, keys[1], "after", 7), Error, name);
    assert.equal(calls.length, 0, name); assert.equal(state.text, text, name);
  }
  const { outline, calls, keys } = reorderFixture(({ app }) => { app.vault.readOnly = true; });
  await assert.rejects(() => outline.reorder(keys[0], 7, keys[1], "after", 7), /read-only/); assert.equal(calls.length, 0);
});
test("reorder refuses a same-path replacement session adopted during the awaited source read", async () => {
  const { outline, calls, state, keys, text } = reorderFixture(({ app, view, sessions, session }) => {
    app.vault.readDocument = async () => {
      const replacement = { ...session, document: { ...session.document, file: { path: "N.md" } } };
      view.session = replacement;
      sessions.set("N.md", replacement);
      return { version: "v1" };
    };
  });
  await assert.rejects(() => outline.reorder(keys[0], 7, keys[1], "after", 7), /changed|save conflict/);
  assert.equal(calls.length, 0);
  assert.equal(state.text, text);
});
