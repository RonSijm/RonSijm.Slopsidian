import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { root } from "./host.mjs";
const require = createRequire(import.meta.url);
const { writeDraftRescue } = require("../desktop/draft-rescue.cjs");
const { listDraftRescues } = require("../desktop/draft-rescue-catalog.cjs");
const { inspectDraftRescue, LIMITS } = require("../desktop/draft-rescue-inspector.cjs");
let temporary, sequence = 0;
before(async () => { temporary = await fs.mkdtemp(join(root, ".runtime/rescue-inspector-tests-")); });
after(async () => {
  if (!temporary) { return; }
  const child = relative(join(root, ".runtime"), temporary);
  assert.ok(child && !isAbsolute(child) && !child.startsWith("..")); await fs.rm(temporary, { recursive: true });
});
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(content = "# Rescued 中文\r\n\r\nλ e\u0301 😀 <script>literal</script>\r\n", hasBom = true, io) {
  const profile = join(temporary, "profile-" + ++sequence); await fs.mkdir(profile);
  const sourceRoot = join(profile, "original-vault"); await fs.mkdir(sourceRoot); await fs.writeFile(join(sourceRoot, "Note.md"), "Original source must remain unchanged.\r\n");
  const draft = { sourceRoot, sourcePath: "Note.md", sourceVersion: "original-version", hasBom, content };
  const saved = await writeDraftRescue(profile, { schemaVersion: 1, capturedAt: "2026-10-25T13:00:00.000Z", drafts: [draft] }, io);
  const folder = (await listDraftRescues(profile)).folders[0], file = folder.drafts[0].file;
  return { profile, sourceRoot, draft, saved, folder, file, path: join(saved.directory, file), manifest: join(saved.directory, "manifest.json"), inspect: (options) => inspectDraftRescue(profile, folder.id, file, folder.version, options) };
}
const interceptRead = callback => ({ ...fs, async open(path, ...args) {
  const handle = await fs.open(path, ...args); let called = false;
  return { stat: () => handle.stat(), close: () => handle.close(), async read(...input) { const result = await handle.read(...input); if (!called) { called = true; await callback(path); } return result; } };
} });

test("A real copy verifies exact full bytes, BOM and hash, previews literal CRLF/Unicode and never reads or writes the original note", async () => {
  const f = await fixture(), beforeCopy = await fs.readFile(f.path), beforeManifest = await fs.readFile(f.manifest), beforeSource = await fs.readFile(join(f.sourceRoot, "Note.md"));
  const result = await f.inspect();
  assert.equal(result.state, "verified"); assert.equal(result.actualBytes, beforeCopy.length); assert.equal(result.actualSha256, digest(beforeCopy));
  assert.equal(result.actualBom, true); assert.equal(result.expectedBom, true); assert.equal(result.preview, f.draft.content); assert.equal(result.previewTruncated, false);
  assert.deepEqual(await fs.readFile(f.path), beforeCopy); assert.deepEqual(await fs.readFile(f.manifest), beforeManifest); assert.deepEqual(await fs.readFile(join(f.sourceRoot, "Note.md")), beforeSource);
});

test("Empty Markdown with and without a BOM remains a verified empty preview", async () => {
  for (const bom of [false, true]) {
    const f = await fixture("", bom), result = await f.inspect();
    assert.equal(result.state, "verified"); assert.equal(result.preview, ""); assert.equal(result.actualBytes, bom ? 3 : 0); assert.equal(result.actualBom, bom);
  }
});

test("The preview never breaks a UTF-8 character and verification still detects edits beyond its 64 KiB prefix", async () => {
  const content = "a".repeat(LIMITS.previewBytes - 1) + "😀中文" + "z".repeat(200), f = await fixture(content, false);
  const first = await f.inspect(); assert.equal(first.state, "verified"); assert.equal(first.previewTruncated, true); assert.equal(first.preview, "a".repeat(LIMITS.previewBytes - 1)); assert.ok(!first.preview.includes("\ufffd"));
  const bytes = await fs.readFile(f.path); bytes[bytes.length - 1] = 120; await fs.writeFile(f.path, bytes);
  const changed = await f.inspect(); assert.equal(changed.state, "changed"); assert.equal(changed.preview, first.preview); assert.equal(changed.actualSha256, digest(bytes));
});

test("Changed file bytes, byte-count metadata and BOM metadata cannot be called matching copies", async () => {
  const f = await fixture("Exact\r\n", true);
  await fs.writeFile(f.path, "Changed text\n"); const changed = await f.inspect(); assert.equal(changed.state, "changed"); assert.equal(changed.actualBom, false); assert.equal(changed.preview, "Changed text\n");
  const other = await fixture("Same hash\n", true), raw = JSON.parse(await fs.readFile(other.manifest, "utf8")); raw.drafts[0].hasBom = false;
  await fs.writeFile(other.manifest, JSON.stringify(raw)); let folder = (await listDraftRescues(other.profile)).folders[0];
  const bom = await inspectDraftRescue(other.profile, folder.id, other.file, folder.version); assert.equal(bom.actualSha256, bom.expectedSha256); assert.equal(bom.state, "changed");
  raw.drafts[0].hasBom = true; raw.drafts[0].bytes--; await fs.writeFile(other.manifest, JSON.stringify(raw)); folder = (await listDraftRescues(other.profile)).folders[0];
  assert.equal((await inspectDraftRescue(other.profile, folder.id, other.file, folder.version)).state, "changed");
});

test("A recorded failed copy stays incomplete even if a later file happens to match all expected bytes", async () => {
  const failing = { ...fs, async open(path, ...args) {
    const handle = await fs.open(path, ...args);
    if (!path.endsWith(".md")) { return handle; }
    return { async writeFile(bytes) { await handle.writeFile(bytes.subarray(0, 4)); throw new Error("Interrupted fixture write"); }, sync: () => handle.sync(), close: () => handle.close() };
  } };
  const f = await fixture("Partial copy content\n", false, failing), partial = await f.inspect();
  assert.equal(partial.state, "incomplete"); assert.equal(partial.preview, "Part");
  await fs.writeFile(f.path, f.draft.content); const matching = await f.inspect(); assert.equal(matching.actualSha256, matching.expectedSha256); assert.equal(matching.state, "incomplete");
});

test("Missing files and linked/non-file copies provide no preview and do not touch outside data", async () => {
  const f = await fixture(); await fs.unlink(f.path); const missing = await f.inspect(); assert.equal(missing.state, "missing"); assert.equal(missing.preview, null);
  const outside = join(f.profile, "outside-copy"); await fs.mkdir(outside); await fs.writeFile(join(outside, "Keep.md"), "Outside bytes\n");
  await fs.symlink(outside, f.path, "junction"); const linked = await f.inspect(); assert.equal(linked.state, "unavailable"); assert.equal(linked.preview, null); assert.match(linked.message, /linked|ordinary/);
  assert.equal(await fs.readFile(join(outside, "Keep.md"), "utf8"), "Outside bytes\n");
});

test("Invalid UTF-8 beyond the preview and files exceeding the byte limit refuse text output", async () => {
  const f = await fixture("x".repeat(LIMITS.previewBytes + 1), false), bytes = await fs.readFile(f.path); bytes[bytes.length - 1] = 255; await fs.writeFile(f.path, bytes);
  const invalid = await f.inspect(); assert.equal(invalid.state, "unavailable"); assert.match(invalid.message, /UTF-8/); assert.equal(invalid.preview, null); assert.equal(invalid.actualSha256, digest(bytes));
  const big = await fixture("Small\n", false), handle = await fs.open(big.path, "r+"); await handle.truncate(LIMITS.bytes + 1); await handle.close(); let opened = false;
  const refused = await big.inspect({ ...fs, async open() { opened = true; throw new Error("Body must not open"); } });
  assert.equal(opened, false); assert.equal(refused.state, "unavailable"); assert.match(refused.message, /32 MiB/); assert.equal(refused.preview, null);
});

test("Stale manifest versions and arbitrary file/folder identifiers reject before opening a copy", async () => {
  const f = await fixture(); let opened = false;
  const io = { ...fs, async open() { opened = true; throw new Error("Body must not open"); } };
  await fs.appendFile(f.manifest, "\n"); await assert.rejects(f.inspect(io), /information changed/); assert.equal(opened, false);
  const current = (await listDraftRescues(f.profile)).folders[0];
  for (const file of ["../Note.md", "D:\\Other.md", "manifest.json", "missing.md", null]) { await assert.rejects(inspectDraftRescue(f.profile, current.id, file, current.version, io)); }
  await assert.rejects(inspectDraftRescue(f.profile, "../outside", f.file, current.version, io));
  await assert.rejects(inspectDraftRescue(f.profile, current.id, f.file, "wrong-version", io)); assert.equal(opened, false);
});

test("A manifest changed during the real file read invalidates the result rather than returning obsolete text", async () => {
  const f = await fixture();
  await assert.rejects(f.inspect(interceptRead(async () => { await fs.appendFile(f.manifest, "\n"); })), /information changed during inspection/);
});

test("Concurrent file changes and growth past the read limit never produce a verified preview", async () => {
  const f = await fixture("Stable\n", false);
  const changed = await f.inspect(interceptRead(async path => { await fs.appendFile(path, "Later\n"); }));
  assert.equal(changed.state, "unavailable"); assert.equal(changed.preview, null); assert.match(changed.message, /changed while reading/);
  const growing = await fixture("Stable\n", false);
  const large = await growing.inspect(interceptRead(async path => { const handle = await fs.open(path, "r+"); await handle.truncate(LIMITS.bytes + 1); await handle.close(); }));
  assert.equal(large.state, "unavailable"); assert.equal(large.preview, null); assert.match(large.message, /grew beyond/);
});
