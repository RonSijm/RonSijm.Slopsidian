import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join, relative, isAbsolute } from "node:path";
import { root } from "./host.mjs";
const require = createRequire(import.meta.url);
const { validateDraftSnapshot, rescueName, writeDraftRescue, createDraftRescuer, LIMITS } = require("../desktop/draft-rescue.cjs");
let captureMarkdownDrafts, temporary, sequence = 0;
before(async () => {
  const compiled = await build({ entryPoints: ["client/draft-rescue.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  ({ captureMarkdownDrafts } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")));
  temporary = await fs.mkdtemp(join(root, ".runtime/draft-rescue-tests-"));
});
after(async () => {
  if (temporary) {
    const child = relative(join(root, ".runtime"), temporary);
    assert.ok(child && !isAbsolute(child) && !child.startsWith("..")); await fs.rm(temporary, { recursive: true });
  }
});
const draft = (path = "Notes/中文.md", content = "Unsaved 中文\r\nSecond line\r\n", hasBom = true) => ({ sourceRoot: "D:\\Vault A", sourcePath: path, sourceVersion: "old-version", hasBom, content });
const snapshot = (drafts = [draft()]) => ({ schemaVersion: 1, capturedAt: "2026-10-25T12:34:56.000Z", drafts });
async function profile() { const value = join(temporary, "profile-" + ++sequence); await fs.mkdir(value); return value; }
const bytes = value => Buffer.concat([value.hasBom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(value.content, "utf8")]);

test("Renderer captures dirty/in-flight canonical Markdown sessions once without reading view widgets or saving", () => {
  const session = (path, dirty, isSaving) => ({ originRoot: "D:\\Old vault", dirty, isSaving, text: "Canonical\r\n中文", document: { file: { path }, version: "v1", hasBom: true }, leaves: [{ getViewData() { throw new Error("Do not read widgets"); } }, {}] });
  const app = { vault: { rootPath: "D:\\New vault" }, workspace: { sessions: new Map([["Dirty.md", session("Dirty.md", true, false)], ["Saving.md", session("Saving.md", false, true)], ["Clean.md", session("Clean.md", false, false)]]) }, saveAll() { throw new Error("No writes"); } };
  const result = captureMarkdownDrafts(app);
  assert.equal(result.schemaVersion, 1); assert.equal(result.drafts.length, 2);
  assert.deepEqual(result.drafts.map(item => item.sourcePath), ["Dirty.md", "Saving.md"]);
  for (const item of result.drafts) { assert.equal(item.sourceRoot, "D:\\Old vault"); assert.equal(item.content, "Canonical\r\n中文"); assert.equal(item.hasBom, true); }
});
test("Renderer refuses unidentified owners or a mismatched source path instead of assigning current-vault metadata", () => {
  const item = { dirty: true, isSaving: false, originRoot: null, text: "Keep me", document: { file: { path: "A.md" }, version: "v1" } };
  const app = { workspace: { sessions: new Map([["A.md", item]]) } };
  assert.throws(() => captureMarkdownDrafts(app), /original vault/);
  item.originRoot = "D:\\A"; item.document.file.path = "B.md";
  assert.throws(() => captureMarkdownDrafts(app), /original vault/);
});
test("Snapshot validation detaches supported fields and rejects malformed, duplicated, unsafe-path and non-lossless data", () => {
  const value = snapshot(), copy = validateDraftSnapshot(value); value.drafts[0].content = "Changed";
  assert.notEqual(copy.drafts[0].content, "Changed");
  for (const bad of [null, {}, { ...snapshot(), schemaVersion: 2 }, { ...snapshot(), capturedAt: "yesterday" }, { ...snapshot(), drafts: [draft(), draft()] },
    ...["/A.md", "../A.md", "a/../A.md", "C:/A.md", "a\\A.md", "a//A.md", "A.txt", "a/\u0000.md"].map(path => snapshot([draft(path)])),
    snapshot([{ ...draft(), content: "\ud800" }]), snapshot([{ ...draft(), hasBom: "true" }]), snapshot([{ ...draft(), sourceRoot: "" }])]) {
    assert.throws(() => validateDraftSnapshot(bad));
  }
});
test("Draft and byte limits refuse the entire snapshot before opening any profile files", async () => {
  for (const value of [snapshot(Array.from({ length: LIMITS.drafts + 1 }, (_, index) => draft(index + ".md", ""))), snapshot([draft("Large.md", "x".repeat(LIMITS.bytes + 1), false)])]) {
    await assert.rejects(writeDraftRescue("unused-profile", value, { mkdir() { throw new Error("Must not touch files"); } }), /snapshot|32 MiB/);
  }
});
test("Real rescue files retain exact UTF-8/BOM/CRLF/literal Unicode bytes and original metadata in a new profile folder", async () => {
  const value = snapshot([draft("Notes/CON.md", "\ufeffLiteral BOM\r\n中文 e\u0301 🚀\r\n"), draft("Elsewhere/con.MD", "LF\nCase-sensitive text", false)]);
  const owner = await profile(), result = await writeDraftRescue(owner, value);
  assert.equal(result.complete, true); assert.equal(result.copied, 2); assert.equal(relative(owner, result.directory).startsWith("draft-rescue"), true);
  const manifest = JSON.parse(await fs.readFile(join(result.directory, "manifest.json"), "utf8"));
  for (const [index, entry] of manifest.drafts.entries()) {
    const actual = await fs.readFile(join(result.directory, entry.file));
    assert.deepEqual(actual, bytes(value.drafts[index])); assert.equal(entry.copied, true);
    assert.equal(entry.sourceRoot, value.drafts[index].sourceRoot); assert.equal(entry.sourcePath, value.drafts[index].sourcePath);
    assert.equal(entry.sha256, createHash("sha256").update(actual).digest("hex"));
  }
  assert.notEqual(manifest.drafts[0].file, manifest.drafts[1].file);
  assert.match(manifest.drafts[0].file, /^001-CON\.md$/);
});
test("Empty captures create no rescue folder; generated names are bounded and cannot become Windows device or traversal paths", async () => {
  const owner = await profile(); assert.equal((await writeDraftRescue(owner, snapshot([]))).directory, null);
  assert.deepEqual(await fs.readdir(owner), []);
  for (const name of ["CON.md", "folder/NUL.md", "a/<unsafe>?:*.md", "x".repeat(200) + ".md"]) {
    const result = rescueName(name, 0); assert.match(result, /^001-.+\.md$/); assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(result)); assert.ok(Array.from(result).length <= 47);
  }
});
test("Exclusive copy collisions preserve the foreign file while salvaging other drafts and reporting the incomplete result", async () => {
  const owner = await profile(), value = snapshot([draft("A.md"), draft("B.md")]);
  const io = { ...fs, async mkdtemp(prefix) { const directory = await fs.mkdtemp(prefix); await fs.writeFile(join(directory, "001-A.md"), "Foreign bytes"); return directory; } };
  const result = await writeDraftRescue(owner, value, io);
  assert.equal(result.complete, false); assert.equal(result.copied, 1);
  assert.equal(await fs.readFile(join(result.directory, "001-A.md"), "utf8"), "Foreign bytes");
  assert.deepEqual(await fs.readFile(join(result.directory, "002-B.md")), bytes(value.drafts[1]));
  assert.match(result.errors.join("\n"), /A.md/);
});
test("A manifest collision never overwrites foreign metadata or removes successfully copied Markdown", async () => {
  const owner = await profile();
  const io = { ...fs, async mkdtemp(prefix) { const directory = await fs.mkdtemp(prefix); await fs.writeFile(join(directory, "manifest.json"), "Keep foreign manifest"); return directory; } };
  const result = await writeDraftRescue(owner, snapshot(), io);
  assert.equal(result.complete, false); assert.equal(result.copied, 1); assert.match(result.errors.join("\n"), /manifest/);
  assert.equal(await fs.readFile(join(result.directory, "manifest.json"), "utf8"), "Keep foreign manifest");
  assert.deepEqual(await fs.readFile(join(result.directory, "001-中文.md")), bytes(draft()));
});
test("A failed write retains its readable partial file and explicitly marks it uncopied", async () => {
  const owner = await profile();
  const io = { ...fs, async open(file, ...args) {
    const handle = await fs.open(file, ...args);
    if (file.endsWith(".md")) { return { async writeFile(data) { await handle.writeFile(data.subarray(0, 3)); throw new Error("Simulated disk full"); }, sync: () => handle.sync(), close: () => handle.close() }; }
    return handle;
  } };
  const result = await writeDraftRescue(owner, snapshot(), io);
  assert.equal(result.complete, false); assert.equal(result.copied, 0);
  assert.equal((await fs.readFile(join(result.directory, "001-中文.md"))).length, 3);
  const manifest = JSON.parse(await fs.readFile(join(result.directory, "manifest.json"), "utf8")); assert.equal(manifest.drafts[0].copied, false);
});
test("Linked rescue roots and full snapshot folders refuse without following links or deleting earlier copies", async () => {
  const owner = await profile(), destination = await profile();
  await fs.symlink(destination, join(owner, "draft-rescue"), "junction");
  await assert.rejects(writeDraftRescue(owner, snapshot()), /link/); assert.deepEqual(await fs.readdir(destination), []);
  const full = await profile(), base = join(full, "draft-rescue"); await fs.mkdir(base);
  for (let index = 0; index < LIMITS.snapshots; index++) { await fs.writeFile(join(base, "keep-" + index), "Original " + index); }
  await assert.rejects(writeDraftRescue(full, snapshot()), /20 entries/);
  assert.equal((await fs.readdir(base)).length, LIMITS.snapshots); assert.equal(await fs.readFile(join(base, "keep-0"), "utf8"), "Original 0");
});
test("Repeated captures reuse only an identical complete copy, while later edits produce a fresh rescue", async () => {
  let value = snapshot(), saves = 0;
  const rescuer = createDraftRescuer(async () => value, async () => ({ complete: true, directory: "copy-" + ++saves, copied: 1, total: 1, errors: [] }));
  const first = await rescuer.capture(); value = { ...value, capturedAt: "2026-10-25T12:35:56.000Z" };
  assert.equal(await rescuer.capture(), first); assert.equal(saves, 1);
  value = snapshot([draft("Notes/中文.md", "Later text")]); assert.equal((await rescuer.capture()).directory, "copy-2");
});
test("An exit/close capture race is serialized and the close capture reads later text instead of replaying the earlier snapshot", async () => {
  let value = snapshot(), release, started;
  const running = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; }), saved = [];
  const rescuer = createDraftRescuer(async () => value, async captured => { saved.push(captured.drafts[0].content); if (saved.length === 1) { started(); await gate; } return { complete: true, directory: "copy-" + saved.length }; });
  const first = rescuer.capture(); await running; const second = rescuer.capture(); value = snapshot([draft("Notes/中文.md", "Newest close text")]); release();
  await Promise.all([first, second]); assert.deepEqual(saved, [draft().content, "Newest close text"]);
});
test("Failed saves remain retryable and failed live capture keeps the location of an earlier successful copy", async () => {
  let captureFails = false, saves = 0;
  const rescuer = createDraftRescuer(async () => { if (captureFails) { throw "Renderer unavailable"; } return snapshot(); },
    async () => { if (++saves === 1) { throw new Error("Permission denied"); } return { complete: true, directory: "retained-copy" }; });
  assert.equal((await rescuer.capture()).complete, false);
  assert.equal((await rescuer.capture()).complete, true);
  captureFails = true; const failure = await rescuer.capture();
  assert.equal(failure.complete, false); assert.equal(failure.previousDirectory, "retained-copy"); assert.deepEqual(failure.errors, ["Renderer unavailable"]);
});
