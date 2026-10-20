import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, explorerState, explorerTree;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime/file-explorer-tests-"));
  const output = join(directory, "model.mjs");
  await build({ entryPoints: [join(root, "client/file-explorer-model.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ explorerState, explorerTree } = await import(pathToFileURL(output).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/file-explorer-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
const file = (path, mtime = 0, ctime = 0) => ({ path, folder: false, mtime, ctime });
const folder = path => ({ path, folder: true });
const names = tree => tree.roots.map(node => node.name);

test("original minimal Files state gains independent defaults without losing or mutating opaque input", () => {
  const input = { sortOrder: "byModifiedTime", opaque: { plugin: [1, true] }, collapsedFolders: ["Projects", "Projects", "中文/λ"] };
  const before = structuredClone(input), state = explorerState(input);
  assert.deepEqual(input, before); assert.deepEqual(state.collapsedFolders, ["Projects", "中文/λ"]);
  state.collapsedFolders.push("Extra"); assert.deepEqual(input, before);
  assert.deepEqual(explorerState({}), { sortOrder: "alphabetical", autoReveal: false, showSearch: false, searchQuery: "", collapsedFolders: [] });
});
test("malformed saved controls fail before applying state, including prototype keys and unsafe folder paths", () => {
  for (const input of [{ sortOrder: "constructor" }, { sortOrder: null }, { autoReveal: "true" }, { showSearch: 1 }, { searchQuery: "a".repeat(1025) }, { collapsedFolders: null }, { collapsedFolders: Array(4097).fill("a") }, ...["", "/a", "../a", ".obsidian", "a//b", "a\\b", "a/./b", "a\u0000b"].map(path => ({ collapsedFolders: [path] }))]) {
    assert.throws(() => explorerState(input));
  }
  assert.equal(explorerState({ searchQuery: "<img src=x onerror=alert(1)>" }).searchQuery, "<img src=x onerror=alert(1)>");
});
test("natural name ordering remains folders first in either direction and leaves the snapshot untouched", () => {
  const entries = [file("Note 10.md"), folder("Folder 10"), file("Note 2.md"), folder("Folder 2"), file("a.md")], before = structuredClone(entries);
  assert.deepEqual(names(explorerTree(entries, "alphabetical", "")), ["Folder 2", "Folder 10", "a.md", "Note 2.md", "Note 10.md"]);
  assert.deepEqual(names(explorerTree(entries, "alphabeticalReverse", "")), ["Folder 10", "Folder 2", "Note 10.md", "Note 2.md", "a.md"]);
  assert.deepEqual(entries, before);
});
test("modified and created ordering uses the right field, deterministic ties, and folders first", () => {
  const entries = [file("B.md", 20, 10), file("A.md", 20, 30), folder("Z"), file("C.md", 5, 20)];
  assert.deepEqual(names(explorerTree(entries, "byModifiedTime", "")), ["Z", "A.md", "B.md", "C.md"]);
  assert.deepEqual(names(explorerTree(entries, "byModifiedTimeReverse", "")), ["Z", "C.md", "A.md", "B.md"]);
  assert.deepEqual(names(explorerTree(entries, "byCreatedTime", "")), ["Z", "A.md", "C.md", "B.md"]);
  assert.deepEqual(names(explorerTree(entries, "byCreatedTimeReverse", "")), ["Z", "B.md", "C.md", "A.md"]);
  assert.deepEqual(names(explorerTree([file("A", NaN), file("B", Infinity), file("C", 1)], "byModifiedTime", "")), ["C", "A", "B"]);
});
test("case-insensitive path filtering retains ancestors and explicit empty folders with accurate counts", () => {
  const entries = [file("Projects/Garden/Plan.md"), file("Projects/Other.md"), folder("Empty λ"), file("Loose.md")];
  const filtered = explorerTree(entries, "alphabetical", "  GARDEN/plan  ");
  assert.equal(filtered.files, 1); assert.equal(filtered.folders, 2); assert.equal(filtered.roots.find(node => node.name === "Projects").visible, true);
  assert.equal(filtered.roots.find(node => node.name === "Loose.md").visible, false);
  const empty = explorerTree(entries, "alphabetical", "λ"); assert.equal(empty.files, 0); assert.equal(empty.folders, 1);
  assert.equal(empty.roots.find(node => node.name === "Empty λ").visible, true);
  const all = explorerTree(entries, "alphabetical", "Projects"); assert.equal(all.files, 2); assert.equal(all.folders, 2);
});
test("snapshot identity errors and path collisions are rejected in either input order", () => {
  for (const entries of [[file("A.md"), file("A.md")], [folder("A"), file("A")], [file("A/B.md"), file("A")], [file("A"), file("A/B.md")], [file("../hidden")]]) {
    assert.throws(() => explorerTree(entries, "alphabetical", ""));
  }
  assert.throws(() => explorerTree([], "future-sort", ""));
  assert.deepEqual(explorerTree([folder("/"), folder("Empty")], "alphabetical", "").roots.map(node => node.path), ["Empty"]);
});
test("deep paths build and filter iteratively rather than exhausting the JavaScript call stack", () => {
  const path = Array(1500).fill("x").join("/") + "/Target.md";
  const tree = explorerTree([file(path)], "alphabetical", "target");
  assert.equal(tree.files, 1); assert.equal(tree.folders, 1500);
  let node = tree.roots[0], depth = 0; while (node.folder) { assert.equal(node.visible, true); depth++; node = node.children[0]; }
  assert.equal(depth, 1500); assert.equal(node.path, path);
});
