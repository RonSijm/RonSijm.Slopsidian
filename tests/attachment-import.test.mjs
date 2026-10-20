import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { attachmentReadHoldScript } from "../tools/attachment-read-fixture.mjs";
import { test } from "node:test";
import { build } from "esbuild";
import { Module } from "node:module";
import { join } from "node:path";

const output = await build({ stdin: { contents: 'export * from "./client/attachment-import"; export { recordingFolder } from "./client/audio-paths"; export { resolveLink } from "./client/links";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
const loaded = new Module(join(process.cwd(), ".runtime", "attachment-import-model.cjs"));
loaded.filename = loaded.id; loaded.paths = Module._nodeModulePaths(process.cwd()); loaded._compile(Buffer.from(output.outputFiles[0].contents).toString("utf8"), loaded.filename);
const { ATTACHMENT_IMPORT_LIMITS: limits, validateImportSources, prepareAttachmentFiles, planAttachmentPaths, attachmentMarkdown, recordingFolder, resolveLink } = loaded.exports;

function readFixture(selection, require) {
  const reads = [];
  class FixtureFile {
    constructor(name, bytes, webkitRelativePath = "") { Object.assign(this, { name, bytes, size: bytes.length, webkitRelativePath }); }
    async arrayBuffer() { reads.push(this.webkitRelativePath || this.name); return Uint8Array.from(this.bytes).buffer; }
  }
  const original = FixtureFile.prototype.arrayBuffer, context = { File: FixtureFile, require };
  runInNewContext(attachmentReadHoldScript(selection), context);
  return { File: FixtureFile, original, context, reads, probe: context.attachmentReadProbe };
}

test("a source-read hold ignores browser previews and wrong-sized files, then releases only the selected exact bytes", async () => {
  const f = readFixture({ name: "Stale.bin", size: 3 });
  assert.deepEqual([...new Uint8Array(await new f.File("Photo.png", [9]).arrayBuffer())], [9]);
  await new f.File("Stale.bin", [9, 9]).arrayBuffer();
  assert.equal(f.probe.held, false);
  let settled = false;
  const pending = new f.File("Stale.bin", [1, 2, 3]).arrayBuffer().then(value => { settled = true; return value; });
  await Promise.resolve(); assert.equal(settled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.probe.source)), { kind: "file", name: "Stale.bin", size: 3, relativePath: "" });
  assert.equal(f.File.prototype.arrayBuffer, f.original);
  await new f.File("Background.md", [4]).arrayBuffer();
  assert.deepEqual(f.reads, ["Photo.png", "Stale.bin", "Background.md"]);
  f.probe.release(); assert.deepEqual([...new Uint8Array(await pending)], [1, 2, 3]);
  f.probe.restore(); assert.equal(f.File.prototype.arrayBuffer, f.original);
});

test("a folder-read hold distinguishes the selected relative path from same-named background files", async () => {
  const f = readFixture({ name: "Top.bin", size: 2, relativePath: "Folder Stale/Top.bin" });
  await new f.File("Top.bin", [8, 9], "Other/Top.bin").arrayBuffer();
  assert.equal(f.probe.held, false);
  const pending = new f.File("Top.bin", [1, 2], "Folder Stale/Top.bin").arrayBuffer();
  assert.equal(f.probe.source.relativePath, "Folder Stale/Top.bin");
  assert.deepEqual(f.reads, ["Other/Top.bin"]);
  f.probe.release(); assert.deepEqual([...new Uint8Array(await pending)], [1, 2]);
});

test("the native folder hold leaves unrelated IPC and File reads live and restores both boundaries before release", async () => {
  const calls = [], invoke = async function (channel, ...args) { calls.push({ channel, args }); return args; };
  const electron = { ipcRenderer: { invoke } };
  const f = readFixture({ name: "Top.bin", size: 2, relativePath: "Folder Stale/Top.bin", nativeFolder: true }, name => { assert.equal(name, "electron"); return electron; });
  await electron.ipcRenderer.invoke("vault:unrelated", "live"); await new f.File("Photo.png", [8]).arrayBuffer();
  assert.equal(f.probe.held, false);
  const pending = electron.ipcRenderer.invoke("vault:attachment-folder", "C:\\fixture\\Folder Stale");
  assert.equal(f.probe.source.kind, "native-folder"); assert.equal(calls.length, 1);
  assert.equal(electron.ipcRenderer.invoke, invoke); assert.equal(f.File.prototype.arrayBuffer, f.original);
  f.probe.release(); assert.deepEqual(await pending, ["C:\\fixture\\Folder Stale"]);
  assert.equal(calls.length, 2);
});

test("Selected files retain exact binary/BOM/Unicode bytes, including empty attachments", async () => {
  const bytes = Uint8Array.from([0, 255, 128, 10]), text = new TextEncoder().encode("\ufeff中文 λ\r\n");
  const result = await prepareAttachmentFiles([new File([bytes], "Opaque.bin"), new File([text], "Text.txt"), new File([], "Empty.dat")]);
  assert.deepEqual(result.map(file => file.name), ["Opaque.bin", "Text.txt", "Empty.dat"]);
  assert.deepEqual(new Uint8Array(result[0].bytes), bytes); assert.deepEqual(new Uint8Array(result[1].bytes), text); assert.equal(result[2].bytes.byteLength, 0);
});

test("Selection count and aggregate/per-file sizes reject before any file read", async () => {
  let reads = 0; const file = (name, size) => ({ name, size, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } });
  for (const selection of [[], Array.from({ length: 21 }, (_, i) => file(i + ".png", 0)), [file("Too big.png", limits.fileBytes + 1)], [file("A", limits.fileBytes), file("B", limits.fileBytes), file("C", 1)], [file("Negative", -1)], [file("NaN", NaN)], [file("Fraction", 1.5)]]) {
    await assert.rejects(prepareAttachmentFiles(selection));
  }
  assert.equal(reads, 0); validateImportSources([file("A", limits.fileBytes), file("B", limits.fileBytes)]);
});

test("Unsafe, hidden, reserved and malformed filenames are refused without reading bytes", async () => {
  let reads = 0;
  for (const name of ["", "../Escape.png", "Nested/image.png", "Nested\\image.png", ".obsidian", "CON.png", "COM1", "end.", "end ", "bad?.png", "bad\u0000.png", "\ud800.png", "a".repeat(256)]) {
    await assert.rejects(prepareAttachmentFiles([{ name, size: 0, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } }]));
  }
  assert.equal(reads, 0);
});

test("A failed or incomplete source read fails preparation rather than producing a partial prepared batch", async () => {
  const good = new File(["good"], "Good.txt");
  await assert.rejects(prepareAttachmentFiles([good, { name: "Short.bin", size: 5, arrayBuffer: async () => new ArrayBuffer(4) }]), /completely/);
  await assert.rejects(prepareAttachmentFiles([good, { name: "Denied.bin", size: 0, arrayBuffer: async () => { throw new Error("Source read denied"); } }]), /Source read denied/);
});

test("Filename planning avoids files, folders, case aliases and duplicates within the same selection", () => {
  const existing = [{ path: "Assets/Photo.png", folder: false }, { path: "Assets/Photo 1.png", folder: true }, { path: "Assets/Archive.tar.gz", folder: false }];
  assert.deepEqual(planAttachmentPaths(["photo.png", "Photo.png", "Archive.tar.gz", "No extension", "No extension"], "Assets", existing), ["Assets/photo 2.png", "Assets/Photo 3.png", "Assets/Archive.tar 1.gz", "Assets/No extension", "Assets/No extension 1"]);
  assert.equal(existing.length, 3);
});

test("A configured attachment folder cannot pass through a file or a private/traversal path", () => {
  assert.throws(() => planAttachmentPaths(["x.png"], "A/B", [{ path: "a", folder: false }]), /occupied/);
  for (const folder of ["../outside", "/absolute", ".obsidian", "A/.secret", "A\\B", "C:"]) { assert.throws(() => planAttachmentPaths(["x.png"], folder, [])); }
});

test("A suffix for a maximum-length Unicode filename stays valid and cannot split a surrogate pair", () => {
  const name = "a".repeat(247) + "😀😀.png"; assert.equal(name.length, 255);
  const [path] = planAttachmentPaths([name], "", [{ path: name, folder: false }]);
  assert.ok(path.length <= 255); assert.ok(path.endsWith(" 1.png")); assert.equal(path.isWellFormed(), true);
  assert.notEqual(path, name);
});

test("Exhausted names and overlong combined paths fail explicitly", () => {
  const existing = Array.from({ length: 10000 }, (_, i) => ({ path: "x" + (i ? " " + i : "") + ".png", folder: false }));
  assert.throws(() => planAttachmentPaths(["x.png"], "", existing), /No available/);
  assert.throws(() => planAttachmentPaths(["a".repeat(255)], Array(16).fill("b".repeat(255)).join("/"), []));
});

test("Root, configured and note-relative placement follow the existing attachment preference", () => {
  for (const value of [undefined, "", ".", "/"]) { assert.equal(recordingFolder(value, "Notes/Note.md"), ""); }
  assert.equal(recordingFolder("Attachments/Images", "Notes/Note.md"), "Attachments/Images");
  assert.equal(recordingFolder("./Assets", "Notes/Note.md"), "Notes/Assets"); assert.equal(recordingFolder("./", "Notes/Note.md"), "Notes");
});

test("Generated image URLs resolve exact punctuation/Unicode names and preserve the label as Markdown text", () => {
  const path = "Assets/Image [one] # 中文 (x)!.png", source = "Notes/Deep/Note.md";
  const markdown = attachmentMarkdown(path, source);
  assert.equal(markdown, "![Image \\[one\\] # 中文 (x)!.png](../../Assets/Image%20%5Bone%5D%20%23%20%E4%B8%AD%E6%96%87%20%28x%29%21.png)");
  const url = markdown.slice(markdown.lastIndexOf("](") + 2, -1);
  assert.equal(resolveLink([{ path }], url, source, true).file.path, path);
});

test("Attachment links are relative to their owning note; files are links and supported raster images are embeds", () => {
  assert.equal(attachmentMarkdown("Notes/picture.PNG", "Notes/Note.md"), "![picture.PNG](./picture.PNG)");
  assert.equal(attachmentMarkdown("Notes/Assets/Document.pdf", "Notes/Note.md"), "[Document.pdf](./Assets/Document.pdf)");
  assert.equal(attachmentMarkdown("data.bin", "Notes/Note.md"), "[data.bin](../data.bin)");
});

test("Explicit relative links cannot be captured by a same-named attachment folder at the vault root", () => {
  const path = "Notes/Assets/image.png", source = "Notes/Note.md", markdown = attachmentMarkdown(path, source);
  const url = markdown.slice(markdown.lastIndexOf("](") + 2, -1);
  assert.equal(resolveLink([{ path: "Assets/image.png" }, { path }], url, source, true).file.path, path);
});
