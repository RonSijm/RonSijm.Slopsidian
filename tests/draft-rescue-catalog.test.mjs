import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { root } from "./host.mjs";
const require = createRequire(import.meta.url);
const { writeDraftRescue } = require("../desktop/draft-rescue.cjs");
const { listDraftRescues, resolveRescueFolder, parseManifest, LIMITS } = require("../desktop/draft-rescue-catalog.cjs");
let temporary, sequence = 0;
before(async () => { temporary = await fs.mkdtemp(join(root, ".runtime/rescue-catalog-tests-")); });
after(async () => {
  const child = relative(join(root, ".runtime"), temporary);
  assert.ok(child && !isAbsolute(child) && !child.startsWith(".."));
  await fs.rm(temporary, { recursive: true });
});
const profile = async () => { const value = join(temporary, "profile-" + ++sequence); await fs.mkdir(value); return value; };
const draft = (path = "Notes/中文.md") => ({ sourceRoot: "D:\\Earlier vault", sourcePath: path, sourceVersion: "known-version", hasBom: true, content: "# Unsaved\r\n中文 e\u0301 😀\r\n" });
const snapshot = (time = "2026-10-25T12:00:00.000Z", drafts = [draft()]) => ({ schemaVersion: 1, capturedAt: time, drafts });
async function fingerprint(directory) {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { files.push(...await fingerprint(path)); }
    else if (!item.isSymbolicLink()) { files.push([path, createHash("sha256").update(await fs.readFile(path)).digest("hex")]); }
  }
  return files.sort((a, b) => a[0].localeCompare(b[0]));
}

test("An unused profile returns an empty catalog without creating rescue directories or notification state", async () => {
  const owner = await profile();
  assert.deepEqual(await listDraftRescues(owner), { folders: [], truncated: false });
  assert.deepEqual(await fs.readdir(owner), []);
});

test("The real writer's Unicode/BOM/CRLF manifest is detached metadata and repeated catalog/reveal resolution preserves every byte", async () => {
  const owner = await profile(), saved = await writeDraftRescue(owner, snapshot());
  const before = await fingerprint(owner), catalog = await listDraftRescues(owner), folder = catalog.folders[0];
  assert.equal(catalog.truncated, false); assert.equal(folder.readable, true);
  assert.equal(folder.directory, saved.directory); assert.equal(folder.capturedAt, snapshot().capturedAt);
  assert.deepEqual(folder.drafts, [{ sourceRoot: draft().sourceRoot, sourcePath: draft().sourcePath, file: "001-中文.md", copied: true, bytes: Buffer.byteLength("\ufeff" + draft().content) }]);
  assert.equal(await resolveRescueFolder(owner, folder.id), await fs.realpath(saved.directory));
  folder.drafts[0].sourceRoot = "changed only in caller";
  assert.equal((await listDraftRescues(owner)).folders[0].drafts[0].sourceRoot, draft().sourceRoot);
  assert.deepEqual(await fingerprint(owner), before);
});

test("Partial copies retain explicit per-note failure metadata without discarding successful notes", async () => {
  const owner = await profile();
  const io = { ...fs, async open(path, ...args) { if (path.endsWith("001-中文.md")) { throw new Error("Simulated permission failure"); } return fs.open(path, ...args); } };
  const saved = await writeDraftRescue(owner, snapshot(undefined, [draft(), draft("Second.md")]), io);
  assert.equal(saved.complete, false);
  const folder = (await listDraftRescues(owner)).folders[0];
  assert.equal(folder.readable, true); assert.deepEqual(folder.drafts.map(item => item.copied), [false, true]);
  assert.match(folder.errors.join("\n"), /permission failure/);
});

test("Catalog metadata never reads or verifies note bodies, including missing files and externally changed bytes", async () => {
  const owner = await profile(), saved = await writeDraftRescue(owner, snapshot(undefined, [draft(), draft("Second.md")]));
  await fs.unlink(join(saved.directory, "001-中文.md"));
  await fs.writeFile(join(saved.directory, "002-Second.md"), Buffer.from([255, 0, 128]));
  const before = await fingerprint(owner), folder = (await listDraftRescues(owner)).folders[0];
  assert.equal(folder.readable, true); assert.deepEqual(folder.drafts.map(item => item.copied), [true, true]);
  assert.deepEqual(await fingerprint(owner), before);
});

test("Invalid, future, duplicated, escaped or excessive manifest metadata refuses instead of supplying restore destinations", async () => {
  const owner = await profile(), saved = await writeDraftRescue(owner, snapshot());
  const value = JSON.parse(await fs.readFile(join(saved.directory, "manifest.json"), "utf8"));
  for (const mutate of [v => v.schemaVersion++, v => v.capturedAt = "yesterday", v => v.drafts.push(v.drafts[0]), v => v.drafts[0].file = "../outside.md", v => v.drafts[0].sourcePath = "../outside.md", v => v.drafts[0].copied = "true", v => v.drafts[0].sha256 = "invalid", v => v.drafts[0].bytes = 32 * 1024 * 1024 + 1, v => v.errors = Array(101).fill("error"), v => v.drafts = Array(101).fill(v.drafts[0])]) {
    const changed = structuredClone(value); mutate(changed); assert.throws(() => parseManifest(changed));
  }
  const parsed = parseManifest(value); parsed.errors.push("caller error"); assert.deepEqual(value.errors, []);
});

test("Missing, malformed, invalid UTF-8 and oversized manifests remain discoverable folders with explicit read errors", async () => {
  const owner = await profile(), base = join(owner, "draft-rescue"); await fs.mkdir(base);
  const names = ["rescue-20261025120000-aaaa00", "rescue-20261025120001-aaaa01", "rescue-20261025120002-aaaa02", "rescue-20261025120003-aaaa03"];
  for (const name of names) { await fs.mkdir(join(base, name)); }
  await fs.writeFile(join(base, names[1], "manifest.json"), "{");
  await fs.writeFile(join(base, names[2], "manifest.json"), Buffer.from([255, 128]));
  const large = await fs.open(join(base, names[3], "manifest.json"), "wx"); await large.truncate(LIMITS.manifestBytes + 1); await large.close();
  const catalog = await listDraftRescues(owner);
  assert.equal(catalog.folders.length, 4); assert.ok(catalog.folders.every(folder => !folder.readable && folder.errors.length === 1));
  for (const name of names) { assert.equal(await resolveRescueFolder(owner, name), await fs.realpath(join(base, name))); }
});

test("Linked roots, child folders and manifests never follow an outside directory or supply its metadata", async () => {
  const owner = await profile(), outside = await profile();
  await fs.symlink(outside, join(owner, "draft-rescue"), "junction");
  await assert.rejects(listDraftRescues(owner), /ordinary directory/);
  await assert.rejects(resolveRescueFolder(owner, "rescue-20261025120000-aaaa00"), /ordinary directory/);
  const normal = await profile(), saved = await writeDraftRescue(normal, snapshot());
  const child = "rescue-20261025120000-linked";
  await fs.symlink(outside, join(normal, "draft-rescue", child), "junction");
  assert.equal((await listDraftRescues(normal)).folders.length, 1);
  await assert.rejects(resolveRescueFolder(normal, child), /link/);
  await fs.unlink(join(saved.directory, "manifest.json"));
  // A manifest junction is not a regular file; no foreign traversal is needed.
  await fs.symlink(outside, join(saved.directory, "manifest.json"), "junction");
  const folder = (await listDraftRescues(normal)).folders[0]; assert.equal(folder.readable, false); assert.match(folder.errors[0], /ordinary file/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("Folder names/order and the scan/list bounds remain deterministic and explicitly report omitted entries", async () => {
  const owner = await profile(), base = join(owner, "draft-rescue"); await fs.mkdir(base);
  for (let index = 0; index < 25; index++) { await fs.mkdir(join(base, "rescue-2026102512" + String(index).padStart(4, "0") + "-aaaaaa")); }
  await fs.mkdir(join(base, "unrelated-folder")); await fs.writeFile(join(base, "unrelated-file"), "Keep me");
  const catalog = await listDraftRescues(owner);
  assert.equal(catalog.truncated, true); assert.equal(catalog.folders.length, 20);
  assert.ok(catalog.folders[0].id.includes("20261025120024"));
  assert.deepEqual(catalog.folders.map(item => item.id), [...catalog.folders.map(item => item.id)].sort().reverse());
  for (let index = 0; index < 100; index++) { await fs.writeFile(join(base, "noise-" + index), "Keep noise"); }
  assert.equal((await listDraftRescues(owner)).truncated, true);
  assert.equal((await fs.readdir(base)).length, 127);
});

test("Revealing rejects arbitrary paths/identifiers and a formerly listed folder removed by another process", async () => {
  const owner = await profile(), saved = await writeDraftRescue(owner, snapshot()), id = (await listDraftRescues(owner)).folders[0].id;
  for (const invalid of [null, {}, "", "..", "../outside", "D:\\Other", "rescue-20261025120000-aaaaaa/child"]) { await assert.rejects(resolveRescueFolder(owner, invalid), /Choose/); }
  await fs.rename(saved.directory, saved.directory + "-moved");
  await assert.rejects(resolveRescueFolder(owner, id), { code: "ENOENT" });
  assert.deepEqual((await listDraftRescues(owner)).folders, []);
  assert.equal((await fs.readdir(saved.directory + "-moved")).length, 2);
});
