import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Module } from "node:module";
import { join } from "node:path";

const output = await build({ stdin: { contents: 'export * from "./client/attachment-directory"; export { attachmentMarkdown } from "./client/attachment-import";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
const loaded = new Module(join(process.cwd(), ".runtime", "attachment-directory-model.cjs"));
loaded.filename = loaded.id; loaded.paths = Module._nodeModulePaths(process.cwd()); loaded._compile(Buffer.from(output.outputFiles[0].contents).toString("utf8"), loaded.filename);
const { prepareDirectoryAttachments, planDirectoryPaths, readDirectoryEntry, directorySourcesFromFiles, validateDirectoryPaths, attachmentMarkdown } = loaded.exports;

const source = (name, size = 0) => ({ name, size, arrayBuffer: async () => new ArrayBuffer(size) });
const file = (name, bytes) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File([bytes], name)) });
const directory = (name, children) => ({ isFile: false, isDirectory: true, name, createReader() { let done = false; return { readEntries: ok => { const batch = done ? [] : children; done = true; ok(batch); } }; } });

test("Folder files keep hierarchy and exact bytes", async () => {
  const bytes = Uint8Array.from([0, 255, 1]);
  const result = await prepareDirectoryAttachments([{ name: "Root/a/b.bin", size: 3, arrayBuffer: async () => bytes.buffer.slice(0) }, source("Root/c.txt")]);
  assert.deepEqual(result.map(item => item.name), ["Root/a/b.bin", "Root/c.txt"]);
  assert.deepEqual(new Uint8Array(result[0].bytes), bytes);
});

test("Case-aliased source directories are refused instead of merged", () => {
  assert.throws(() => validateDirectoryPaths(["Root/sub/a.md", "Root/Sub/b.md"]), /differ only by case/);
  assert.throws(() => validateDirectoryPaths(["Root/a/Sub/x.md", "Root/a/sub/y/z.md"]), /differ only by case/);
  validateDirectoryPaths(["Root/sub/a.md", "Root/sub/b.md", "Root/other/c.md"]);
});

test("A broken desktop native bridge is refused while a standalone browser keeps browser enumeration", async () => {
  const native = new Module(join(process.cwd(), ".runtime", "attachment-native-model.cjs"));
  const built = await build({ stdin: { contents: 'export { nativeFolderSourcesAvailable } from "./client/attachment-native";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
  native.filename = native.id; native.paths = Module._nodeModulePaths(process.cwd()); native._compile(Buffer.from(built.outputFiles[0].contents).toString("utf8"), native.filename);
  const { nativeFolderSourcesAvailable } = native.exports;
  assert.equal(nativeFolderSourcesAvailable({}), false);
  assert.equal(nativeFolderSourcesAvailable({ require: () => ({ webUtils: {}, ipcRenderer: {} }), electronVersion: "39" }), true);
  assert.throws(() => nativeFolderSourcesAvailable({ require: () => { throw new Error("x"); }, electronVersion: "39" }), /native folder-source bridge is unavailable/);
  assert.throws(() => nativeFolderSourcesAvailable({ electronVersion: "39" }), /unavailable/);
  assert.throws(() => nativeFolderSourcesAvailable({ require: () => ({}), electronVersion: "39" }), /unavailable/);
});

test("The emitted browser bundle chooses browser enumeration in an empty runtime and fails closed in a broken Electron one", async () => {
  const { runInNewContext } = await import("node:vm");
  const built = await build({ stdin: { contents: 'import { nativeFolderSourcesAvailable } from "./client/attachment-native"; globalThis.probe = () => nativeFolderSourcesAvailable();', resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", external: ["electron"], logLevel: "silent" });
  const code = Buffer.from(built.outputFiles[0].contents).toString("utf8");
  const browser = {}; runInNewContext(code, browser);
  assert.equal(browser.probe(), false);
  const broken = { process: { versions: { electron: "39" } } }; runInNewContext(code, broken);
  assert.throws(() => broken.probe(), /unavailable/);
  const healthy = { process: { versions: { electron: "39" } }, require: () => ({ webUtils: {}, ipcRenderer: {} }) }; runInNewContext(code, healthy);
  assert.equal(healthy.probe(), true);
});

test("Folder limits, traversal, hidden, case and file/folder aliases are refused before reads", async () => {
  let reads = 0; const counted = name => ({ name, size: 0, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } });
  const bad = [
    [counted("Root/../x.png")], [counted("Root/.hidden")], [counted("Root")], [counted("Root/A.png"), counted("Root/a.png")],
    [counted("Root/a"), counted("Root/A/b.png")], [counted("One/a.png"), counted("Two/b.png")], [counted("Root/a\\b.png")],
    Array.from({ length: 21 }, (_, i) => counted("Root/" + i)), [{ ...counted("Root/big"), size: 16 * 1024 * 1024 + 1 }],
    [counted("R/" + Array(13).fill("d").join("/") + "/f.png")],
  ];
  for (const selection of bad) { await assert.rejects(prepareDirectoryAttachments(selection)); }
  assert.equal(reads, 0);
});

test("The selected root gets a fresh create-only name and the hierarchy beneath it is retained", () => {
  const paths = ["Photos/a/1.png", "Photos/b.txt"];
  assert.deepEqual(planDirectoryPaths(paths, "Assets", []), ["Assets/Photos/a/1.png", "Assets/Photos/b.txt"]);
  const existing = [{ path: "Assets/Photos", folder: true }, { path: "Assets/photos 1", folder: false }];
  assert.deepEqual(planDirectoryPaths(paths, "Assets", existing), ["Assets/Photos 2/a/1.png", "Assets/Photos 2/b.txt"]);
  assert.deepEqual(planDirectoryPaths(paths, "", [{ path: "Photos", folder: false }]), ["Photos 1/a/1.png", "Photos 1/b.txt"]);
  assert.throws(() => planDirectoryPaths(paths, "A/B", [{ path: "A", folder: false }]), /occupied/);
  assert.throws(() => validateDirectoryPaths(["x/a.png", "y/b.png"]));
});

test("Planned folder files produce exact relative Markdown links", () => {
  assert.equal(attachmentMarkdown("Assets/My Folder/sub/Pic.png", "Notes/Note.md"), "![Pic.png](../Assets/My%20Folder/sub/Pic.png)");
});

test("Dropped directory entries are walked completely or refused", async () => {
  const tree = directory("Drop", [file("a.txt", "A"), directory("sub", [file("b.txt", "BB")])]);
  const sources = await readDirectoryEntry(tree);
  assert.deepEqual(sources.map(item => [item.name, item.size]), [["Drop/a.txt", 1], ["Drop/sub/b.txt", 2]]);
  await assert.rejects(readDirectoryEntry(file("x", "x")), /folder/);
  await assert.rejects(readDirectoryEntry(directory("Empty", [])), /no files/);
  await assert.rejects(readDirectoryEntry(directory("Many", Array.from({ length: 21 }, (_, i) => file(i + ".txt", "")))), /1 and 20/);
  await assert.rejects(readDirectoryEntry(directory("Bad", [file(".secret", "")])));
  let deep = file("leaf.txt", ""); for (let i = 0; i < 14; i++) { deep = directory("d" + i, [deep]); }
  await assert.rejects(readDirectoryEntry(directory("Deep", [deep])), /nested/);
  await assert.rejects(readDirectoryEntry(directory("Failing", [{ isFile: true, isDirectory: false, name: "x", file: (_, fail) => fail(new Error("denied")) }])), /denied/);
});

test("webkitdirectory files require relative paths", () => {
  const picked = new File(["x"], "b.txt"); Object.defineProperty(picked, "webkitRelativePath", { value: "Root/sub/b.txt" });
  assert.equal(directorySourcesFromFiles([picked])[0].name, "Root/sub/b.txt");
  assert.throws(() => directorySourcesFromFiles([new File(["x"], "flat.txt")]), /hierarchy/);
});
