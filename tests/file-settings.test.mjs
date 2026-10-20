import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, FileManager, Vault, validateFileSetting;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "file-settings-tests-"));
  const outfile = join(directory, "files.mjs");
  await build({ stdin: { contents: 'export { FileManager } from "./client/file-manager"; export { Vault } from "./client/vault"; export { validateFileSetting } from "./client/file-settings";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  ({ FileManager, Vault, validateFileSetting } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/file-settings-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
function fixture(settings) {
  const vault = new Vault(async () => {}, undefined, key => settings[key]);
  vault.setSnapshot({ root: "fixture", name: "fixture", files: [], folders: ["Notes", "Inbox"], plugins: [] });
  return new FileManager({ vault, workspace: { getActiveFile: () => ({ path: "Notes/Source.md" }) } });
}
test("new-note and missing-link names share current/folder placement without relocating explicit paths", () => {
  const settings = { newFileLocation: "current" }, manager = fixture(settings);
  assert.equal(manager.getNewNotePath("Created"), "Notes/Created.md");
  assert.equal(manager.getNewNotePath("Missing", "Notes/Source.md", true), "Notes/Missing.md");
  assert.equal(manager.getNewNotePath("Root/Explicit"), "Root/Explicit.md");
  assert.equal(manager.getNewNotePath("./Relative"), "Notes/Relative.md");
  assert.equal(manager.getNewNotePath("../Root"), "Root.md");
  assert.equal(manager.getNewNotePath("/Root"), "Root.md");
  settings.newFileLocation = "folder"; settings.newFileFolderPath = "Inbox";
  assert.equal(manager.getNewNotePath("Created"), "Inbox/Created.md");
  settings.newFileFolderPath = "Missing folder";
  assert.equal(manager.getNewNotePath("Fallback"), "Fallback.md");
  settings.newFileLocation = "root";
  assert.equal(manager.getNewNotePath("Root"), "Root.md");
});
test("missing links refuse attachments, invalid names and traversal before applying placement", () => {
  const manager = fixture({ newFileLocation: "current" });
  for (const name of ["", "../../Outside", ".obsidian/Private", "CON", "Missing.png", "Bad?.md"]) { assert.throws(() => manager.getNewNotePath(name, "Notes/Source.md", true)); }
  assert.equal(manager.getNewNotePath("Version.2"), "Notes/Version.2.md");
  assert.equal(manager.getNewNotePath("Version.2.md", "Notes/Source.md", true), "Notes/Version.2.md");
});
test("Files and links settings validate exact choices and safe attachment/note folder paths", () => {
  for (const [key, value] of [
    ["newFileLocation", "current"], ["newLinkFormat", "relative"], ["useMarkdownLinks", false],
    ["newFileFolderPath", "/"], ["newFileFolderPath", "Notes/Inbox"], ["attachmentFolderPath", "./Attachments"],
  ]) { assert.doesNotThrow(() => validateFileSetting(key, value)); }
  for (const [key, value] of [
    ["newFileLocation", "unknown"], ["newLinkFormat", {}], ["useMarkdownLinks", "true"], ["newFileFolderPath", "../outside"],
    ["attachmentFolderPath", "../outside"], ["attachmentFolderPath", undefined], ["other", true],
  ]) { assert.throws(() => validateFileSetting(key, value)); }
});

function reviewedCreation(settings = { newFileLocation: "current" }) {
  const manager = fixture(settings), app = manager.app, writes = [];
  let release, saving;
  app.workspace.withFileMutation = async action => action();
  app.saveAll = async () => { if (saving) await saving; };
  app.metadataCache = { refresh: async () => {}, pause() {}, resume() {} };
  app.vault.refresh = async () => {};
  app.vault.create = async (path, content) => { writes.push({ path, content }); return { path }; };
  return { manager, writes, settings, hold() { saving = new Promise(resolve => { release = resolve; }); }, release() { release(); } };
}

test("reviewed linked-note creation rechecks placement after held saving before creating any file", async () => {
  const f = reviewedCreation(); f.hold();
  const pending = f.manager.createLinkedNote("Fresh", "Notes/Source.md", { expectedPath: "Notes/Fresh.md", guard: () => true });
  f.settings.newFileLocation = "root"; f.release();
  await assert.rejects(pending, /destination changed/); assert.deepEqual(f.writes, []);
});
test("a stale completion review refuses creation after the real mutation preflight", async () => {
  const f = reviewedCreation(); let current = true; f.hold();
  const pending = f.manager.createLinkedNote("Fresh", "Notes/Source.md", { expectedPath: "Notes/Fresh.md", guard: () => current });
  current = false; f.release(); await assert.rejects(pending, /changed before creation/); assert.deepEqual(f.writes, []);
});
test("an unchanged reviewed destination creates exactly one empty Markdown note", async () => {
  const f = reviewedCreation();
  const file = await f.manager.createLinkedNote("Fresh", "Notes/Source.md", { expectedPath: "Notes/Fresh.md", guard: () => true });
  assert.equal(file.path, "Notes/Fresh.md"); assert.deepEqual(f.writes, [{ path: "Notes/Fresh.md", content: "" }]);
});
test("linked-note acknowledgement precedes a postwrite refresh failure and never invents a collision receipt", async () => {
  const f = reviewedCreation(); let refresh = 0, receipt;
  f.manager.app.metadataCache.refresh = async () => { if (++refresh === 2) throw Error("postwrite refresh failed"); };
  await assert.rejects(f.manager.createLinkedNote("Fresh", "Notes/Source.md", { expectedPath: "Notes/Fresh.md", guard: () => true, created: file => { receipt = file; } }), /postwrite refresh failed/);
  assert.equal(receipt.path, "Notes/Fresh.md"); assert.equal(f.writes.length, 1);
  const collision = reviewedCreation(); let reported = false;
  collision.manager.app.vault.create = async () => { throw Error("already exists"); };
  await assert.rejects(collision.manager.createLinkedNote("Fresh", "Notes/Source.md", { expectedPath: "Notes/Fresh.md", guard: () => true, created: () => { reported = true; } }), /already exists/);
  assert.equal(reported, false);
});
