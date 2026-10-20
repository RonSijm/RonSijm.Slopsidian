import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown } from "../client/markdown.ts";

const root = fileURLToPath(new URL("../", import.meta.url)); let directory, backlinkState, backlinkGroups, mentionContext, mentionKey, remapMentionKey;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime/backlink-panes-tests-")); const output = join(directory, "backlinks.mjs");
  await build({ entryPoints: [join(root, "client/backlink-model.ts")], outfile: output, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" }); ({ backlinkState, backlinkGroups, mentionContext, mentionKey, remapMentionKey } = await import(pathToFileURL(output).href));
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/backlink-panes-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
const target = { path: "Notes/Target.md", basename: "Target", cache: parseMarkdown("---\naliases: [Seed, '中文 λ']\n---\n# Target\n") };
function document(path, text, mtime = 0, ctime = 0) {
  const cache = parseMarkdown(text), outgoing = [...cache.links, ...cache.embeds, ...cache.frontmatterLinks].map(link => ({ link, destination: /Target/.test(link.link) ? { path: target.path } : null }));
  return { path, text, cache, outgoing, mtime, ctime };
}
const groups = (documents, state = {}) => backlinkGroups(documents, target, backlinkState({ unlinkedCollapsed: false, ...state }));

test("native Backlinks controls validate independently with detached folds and no input mutation", () => {
  const key = mentionKey("linked", "Notes/λ.md"), input = { file: target.path, collapseAll: true, searchQuery: "seed", foldedGroups: [key, key], opaque: { keep: [1] } }, before = structuredClone(input), result = backlinkState(input);
  assert.deepEqual(input, before); assert.equal(result.followActiveFile, true); assert.deepEqual(result.foldedGroups, [key]); result.foldedGroups.push("other"); assert.deepEqual(input, before);
  assert.deepEqual(backlinkState({}), { file: "", followActiveFile: true, collapseAll: false, extraContext: false, sortOrder: "alphabetical", showSearch: false, searchQuery: "", backlinkCollapsed: false, unlinkedCollapsed: true, showUnlinked: true, foldedGroups: [], expandedGroups: [] });
});
test("malformed controls, filters, sorts, unsafe paths and serialized fold keys reject before use", () => {
  const bad = [{ file: null }, { followActiveFile: "true" }, { collapseAll: 0 }, { extraContext: null }, { showSearch: [] }, { backlinkCollapsed: 1 }, { unlinkedCollapsed: "false" }, { showUnlinked: 0 }, { searchQuery: "x".repeat(1025) }, { sortOrder: "__proto__" }, { foldedGroups: null }, { foldedGroups: Array(4097).fill('[]') }, { expandedGroups: ['["linked","../bad"]'] }, { foldedGroups: ['["unknown","A.md"]'] }, { foldedGroups: ['["linked","A.md",0]'] }, ...["/a", "a//b", "../a", ".obsidian/workspace.json", "a\\b", "a\u0000b"].map(file => ({ file }))];
  for (const state of bad) { assert.throws(() => backlinkState(state)); }
  assert.equal(backlinkState({ searchQuery: "<img src=x>" }).searchQuery, "<img src=x>");
});
test("linked mentions use resolved references and exact frontmatter, heading, block and embed ranges", () => {
  const text = '---\nrelated: "[[Target]]"\n---\n# Source\n[[Target#Heading|shown]] and [[Target#^block]].\n![[Target]]\n[[Elsewhere]]\n', source = document("Source.md", text), before = structuredClone(source);
  const result = groups([source, document(target.path, "[[Target]]")]); assert.equal(result.length, 1); assert.equal(result[0].linked.length, 4);
  assert.deepEqual(result[0].linked.map(r => text.slice(r.from, r.to)), ['[[Target]]', '[[Target#Heading|shown]]', '[[Target#^block]]', '![[Target]]']); assert.deepEqual(structuredClone(source), before);
  const unresolved = { ...source, outgoing: source.outgoing.map(ref => ({ ...ref, destination: null })) }; assert.equal(groups([unresolved])[0]?.linked.length ?? 0, 0);
});
test("unlinked basename and alias matches exclude links, code, comments, escapes, self and word fragments", () => {
  const text = 'Target seed 中文 λ <img src=x>\n[[Target]] [Target](Target.md) ![[Target]]\n`Target`\n```\nSeed\n```\n<!-- Target -->\n\\Target Targeted xSeed Seed_x\n';
  const result = groups([document("Source.md", text), document(target.path, "Seed Target")]); assert.equal(result.length, 1); assert.deepEqual(result[0].unlinked.map(r => text.slice(r.from, r.to)), ["Target", "seed", "中文 λ"]);
});
test("collapsed or disabled unlinked sections avoid scanning source metadata", () => {
  const source = document("Source.md", "Target"); Object.defineProperty(source, "cache", { get() { throw Error("Unlinked scan should remain lazy"); } });
  assert.deepEqual(groups([source], { unlinkedCollapsed: true }), []); assert.deepEqual(groups([source], { showUnlinked: false }), []);
});
test("literal case-insensitive filters use source paths and bounded optional neighboring context", () => {
  const source = document("Notes/Source.md", "Neighbor marker\nA [[Target]] here.\nFollowing marker\n");
  assert.equal(groups([source], { showSearch: true, searchQuery: "SOURCE.MD" })[0].linked.length, 1);
  assert.equal(groups([source], { showSearch: true, searchQuery: "neighbor" }).length, 0);
  assert.equal(groups([source], { showSearch: true, searchQuery: "NEIGHBOR", extraContext: true })[0].linked.length, 1);
  assert.equal(groups([source], { showSearch: true, searchQuery: ".*" }).length, 0); assert.equal(groups([source], { searchQuery: "missing" }).length, 1);
  const range = source.outgoing[0].link.position, context = mentionContext(source.text, { from: range.start.offset, to: range.end.offset }, true); assert.equal(source.text.slice(context.from, context.to), source.text.trimEnd());
});
test("natural names and six date directions sort stably without mutating documents", () => {
  const sources = [document("Note10.md", "[[Target]]", 20, 4), document("Note2.md", "[[Target]]", 10, 8), document("Note1.md", "[[Target]]", 10, 4)], before = structuredClone(sources), paths = sortOrder => groups(sources, { sortOrder }).map(r => r.path);
  assert.deepEqual(paths("alphabetical"), ["Note1.md", "Note2.md", "Note10.md"]); assert.deepEqual(paths("alphabeticalReverse"), ["Note10.md", "Note2.md", "Note1.md"]);
  assert.deepEqual(paths("byModifiedTime"), ["Note10.md", "Note1.md", "Note2.md"]); assert.deepEqual(paths("byModifiedTimeReverse"), ["Note1.md", "Note2.md", "Note10.md"]);
  assert.deepEqual(paths("byCreatedTime"), ["Note2.md", "Note1.md", "Note10.md"]); assert.deepEqual(paths("byCreatedTimeReverse"), ["Note1.md", "Note10.md", "Note2.md"]); assert.deepEqual(structuredClone(sources), before);
});
test("out-of-range positions cannot navigate, and rename preserves independent section fold keys", () => {
  const source = document("Source.md", "[[Target]]"); source.outgoing.push(...[-1, 100, NaN].map(offset => ({ destination: { path: target.path }, link: { position: { start: { offset }, end: { offset: offset + 2 } } } })));
  assert.equal(groups([source])[0].linked.length, 1);
  for (const kind of ["linked", "unlinked"]) { const key = mentionKey(kind, "Source.md"); assert.equal(remapMentionKey(key, "Source.md", "Moved.md"), mentionKey(kind, "Moved.md")); assert.equal(remapMentionKey(key, "Other.md", "Moved.md"), key); }
});
