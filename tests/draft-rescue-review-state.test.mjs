import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { root } from "./host.mjs";
const require = createRequire(import.meta.url);
const { createProfileStorage } = require("../desktop/local-storage.cjs");
const { writeDraftRescue } = require("../desktop/draft-rescue.cjs");
const { readRescueManifest } = require("../desktop/draft-rescue-catalog.cjs");
const { KEY, LIMITS, parseReviewState, createRescueReviewState } = require("../desktop/draft-rescue-review-state.cjs");
let temporary, sequence = 0;
const stores = [];
before(async () => { temporary = await fs.mkdtemp(join(root, ".runtime/rescue-review-state-tests-")); });
after(async () => {
  for (const store of stores) { try { store.close(); } catch {} }
  if (!temporary) { return; }
  const child = relative(join(root, ".runtime"), temporary); assert.ok(child && !isAbsolute(child) && !child.startsWith("..")); await fs.rm(temporary, { recursive: true });
});
const open = path => { const store = createProfileStorage(path); stores.push(store); return store; };
const record = folder => ({ id: folder.id, version: folder.version, reviewedAt: "2026-10-25T12:00:00.000Z" });
async function fixture() {
  const profile = join(temporary, "profile-" + ++sequence); await fs.mkdir(profile);
  for (const name of ["First.md", "Second.md"]) {
    await writeDraftRescue(profile, { schemaVersion: 1, capturedAt: "2026-10-25T11:00:00.000Z", drafts: [{ sourceRoot: "D:\\Original vault", sourcePath: name, sourceVersion: "original", hasBom: true, content: "# Exact 中文\r\n" }] });
  }
  const file = join(profile, "storage.sqlite"), storage = open(file), service = createRescueReviewState(storage), catalog = await service.catalog(profile);
  return { profile, file, storage, service, folders: catalog.folders };
}
async function copies(profile) {
  const result = [];
  for (const directory of await fs.readdir(join(profile, "draft-rescue"))) {
    for (const file of await fs.readdir(join(profile, "draft-rescue", directory))) {
      const path = join(directory, file); result.push([path, createHash("sha256").update(await fs.readFile(join(profile, "draft-rescue", path))).digest("hex")]);
    }
  }
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

test("Conditional SQLite profile writes refuse stale/missing expectations across live connections and preserve unrelated keys", async () => {
  const f = await fixture(), other = open(f.file);
  f.storage.setItem("unrelated", '{"keep":[false,0,"λ"]}');
  assert.equal(f.storage.compareAndSetItem("conditional", null, "first"), true);
  assert.equal(other.compareAndSetItem("conditional", null, "lost"), false);
  assert.equal(other.compareAndSetItem("conditional", "wrong", "lost"), false);
  assert.equal(other.compareAndSetItem("conditional", "first", "second"), true);
  assert.equal(f.storage.getItem("conditional"), "second");
  for (const args of [[null, null, "x"], ["key", false, "x"], ["key", null, 4]]) { assert.throws(() => f.storage.compareAndSetItem(...args), TypeError); }
  assert.equal(f.storage.getItem("unrelated"), '{"keep":[false,0,"λ"]}');
});

test("Catalog defaults and an already-unreviewed action do not create a preference key or alter rescue bytes", async () => {
  const f = await fixture(), before = await copies(f.profile), folder = f.folders[0];
  assert.equal(f.storage.getItem(KEY), null); assert.ok(f.folders.every(item => !item.reviewed && item.reviewedAt === null));
  await f.service.setReviewed(f.profile, folder.id, folder.version, false);
  assert.equal(f.storage.getItem(KEY), null); assert.deepEqual(await copies(f.profile), before);
});

test("Explicit review persists through a new SQLite connection, is idempotent and reverses without hiding or changing copies", async () => {
  const f = await fixture(), before = await copies(f.profile), folder = f.folders[0];
  await f.service.setReviewed(f.profile, folder.id, folder.version, true); const saved = f.storage.getItem(KEY);
  await f.service.setReviewed(f.profile, folder.id, folder.version, true); assert.equal(f.storage.getItem(KEY), saved);
  const reopened = createRescueReviewState(open(f.file)); let catalog = await reopened.catalog(f.profile);
  assert.equal(catalog.folders.length, 2); assert.equal(catalog.folders.find(item => item.id === folder.id).reviewed, true);
  await reopened.setReviewed(f.profile, folder.id, folder.version, false); catalog = await reopened.catalog(f.profile);
  assert.ok(catalog.folders.every(item => !item.reviewed)); assert.deepEqual(await copies(f.profile), before);
});

test("Manifest changes/new folder IDs restore reminders while body-only changes do not reinterpret the captured review preference", async () => {
  const f = await fixture(), folder = f.folders[0]; await f.service.setReviewed(f.profile, folder.id, folder.version, true);
  const body = join(folder.directory, folder.drafts[0].file); await fs.appendFile(body, "External body edit\n");
  assert.equal((await f.service.catalog(f.profile)).folders.find(item => item.id === folder.id).reviewed, true);
  await fs.appendFile(join(folder.directory, "manifest.json"), "\n");
  let catalog = await f.service.catalog(f.profile); assert.equal(catalog.folders.find(item => item.id === folder.id).reviewed, false);
  const before = f.storage.getItem(KEY); await assert.rejects(f.service.setReviewed(f.profile, folder.id, folder.version, false), /information changed/); assert.equal(f.storage.getItem(KEY), before);
  await writeDraftRescue(f.profile, { schemaVersion: 1, capturedAt: "2026-10-25T11:00:00.000Z", drafts: [{ sourceRoot: "D:\\Original vault", sourcePath: "New.md", sourceVersion: "original", hasBom: false, content: "New capture\n" }] });
  catalog = await f.service.catalog(f.profile); assert.equal(catalog.folders.length, 3); assert.ok(catalog.folders.every(item => !item.reviewed));
});

test("Invalid/future/duplicate/oversized saved review state keeps all copies visible and refuses mutation without resetting original values", async () => {
  const f = await fixture(), folder = f.folders[0];
  for (const raw of ["{", '{"schemaVersion":2,"folders":[]}', JSON.stringify({ schemaVersion: 1, folders: [record(folder), record(folder)] }), " ".repeat(LIMITS.bytes + 1)]) {
    f.storage.setItem(KEY, raw); const catalog = await f.service.catalog(f.profile);
    assert.equal(catalog.folders.length, 2); assert.ok(catalog.folders.every(item => !item.reviewed)); assert.match(catalog.reviewError, /could not be read/);
    await assert.rejects(f.service.setReviewed(f.profile, folder.id, folder.version, true)); assert.equal(f.storage.getItem(KEY), raw);
  }
});

test("Unknown envelope and existing-entry fields survive intentional review changes and other entries remain exact", async () => {
  const f = await fixture(), [first, second] = f.folders;
  const saved = { schemaVersion: 1, future: { keep: [false, 0, "中文"] }, folders: [{ ...record(first), futureEntry: { opaque: true } }, { ...record(second), unchanged: ["exact"] }] };
  f.storage.setItem(KEY, JSON.stringify(saved)); await fs.appendFile(join(first.directory, "manifest.json"), "\n");
  const current = (await f.service.catalog(f.profile)).folders.find(item => item.id === first.id);
  await f.service.setReviewed(f.profile, first.id, current.version, true);
  const after = JSON.parse(f.storage.getItem(KEY)); assert.deepEqual(after.future, saved.future); assert.deepEqual(after.folders[0].futureEntry, saved.folders[0].futureEntry); assert.deepEqual(after.folders[1], saved.folders[1]);
});

test("A concurrent profile edit wins conditional persistence and is never overwritten by an older review action", async () => {
  const f = await fixture(), [first, second] = f.folders, other = open(f.file), winning = JSON.stringify({ schemaVersion: 1, folders: [record(second)], opaque: "concurrent" }); let reads = 0;
  const service = createRescueReviewState(f.storage, async (...args) => { const value = await readRescueManifest(...args); if (++reads === 2) { other.setItem(KEY, winning); } return value; });
  await assert.rejects(service.setReviewed(f.profile, first.id, first.version, true), /changed elsewhere/);
  assert.equal(f.storage.getItem(KEY), winning);
});

test("Queued actions retain other reviews and whenIdle also waits for work added during draining", async () => {
  const f = await fixture(), [first, second] = f.folders; let release, started, releaseThird, thirdStarted, count = 0;
  const gate = new Promise(resolve => { release = resolve; }), running = new Promise(resolve => { started = resolve; });
  const thirdGate = new Promise(resolve => { releaseThird = resolve; }), thirdRunning = new Promise(resolve => { thirdStarted = resolve; });
  const service = createRescueReviewState(f.storage, async (...args) => { if (++count === 1) { started(); await gate; } else if (count === 5) { thirdStarted(); await thirdGate; } return readRescueManifest(...args); });
  const one = service.setReviewed(f.profile, first.id, first.version, true); await running;
  const two = service.setReviewed(f.profile, second.id, second.version, true); let drained = false; const idle = service.whenIdle().then(() => { drained = true; });
  const three = service.setReviewed(f.profile, first.id, first.version, false);
  await Promise.resolve(); assert.equal(drained, false); release(); await thirdRunning; assert.equal(drained, false); releaseThird();
  await Promise.all([one, two, three, idle]); assert.equal(drained, true);
  const catalog = await service.catalog(f.profile); assert.equal(catalog.folders.find(item => item.id === first.id).reviewed, false); assert.equal(catalog.folders.find(item => item.id === second.id).reviewed, true);
});

test("Metadata changed during saving refuses, failed writes remain retryable and a rejection does not poison the queue", async () => {
  const f = await fixture(), folder = f.folders[0]; let reads = 0;
  const stale = createRescueReviewState(f.storage, async (...args) => { if (++reads === 2) { await fs.appendFile(join(folder.directory, "manifest.json"), "\n"); } return readRescueManifest(...args); });
  await assert.rejects(stale.setReviewed(f.profile, folder.id, folder.version, true), /changed while saving/); assert.equal(f.storage.getItem(KEY), null);
  const current = (await f.service.catalog(f.profile)).folders.find(item => item.id === folder.id), original = f.storage.compareAndSetItem;
  f.storage.compareAndSetItem = () => { throw new Error("Simulated profile write failure"); };
  await assert.rejects(f.service.setReviewed(f.profile, current.id, current.version, true), /write failure/); assert.equal(f.storage.getItem(KEY), null);
  f.storage.compareAndSetItem = original; await f.service.setReviewed(f.profile, current.id, current.version, true); await f.service.whenIdle();
  assert.equal((await f.service.catalog(f.profile)).folders.find(item => item.id === current.id).reviewed, true);
});

test("Record and encoded-byte capacity refuse without evicting previous reviews or changing copies", async () => {
  const f = await fixture(), folder = f.folders[0], before = await copies(f.profile);
  const full = { schemaVersion: 1, folders: Array.from({ length: 100 }, (_, index) => ({ ...record(folder), id: "rescue-20261025120000-" + String(index).padStart(6, "0") })) };
  f.storage.setItem(KEY, JSON.stringify(full)); const raw = f.storage.getItem(KEY); await assert.rejects(f.service.setReviewed(f.profile, folder.id, folder.version, true), /100 reviewed/); assert.equal(f.storage.getItem(KEY), raw);
  const big = JSON.stringify({ schemaVersion: 1, folders: [], opaque: "x".repeat(LIMITS.bytes - 60) }); assert.ok(Buffer.byteLength(big) <= LIMITS.bytes);
  f.storage.setItem(KEY, big); await assert.rejects(f.service.setReviewed(f.profile, folder.id, folder.version, true), /128 KiB/); assert.equal(f.storage.getItem(KEY), big); assert.deepEqual(await copies(f.profile), before);
});

test("Malformed action arguments and unreadable manifests cannot acquire reviewed status", async () => {
  const f = await fixture(), folder = f.folders[0];
  for (const [id, version, reviewed] of [["../outside", folder.version, true], [folder.id, "invalid", true], [folder.id, folder.version, "true"]]) { await assert.rejects(f.service.setReviewed(f.profile, id, version, reviewed)); }
  for (const value of ['{"schemaVersion":1,"folders":[{"id":"bad"}]}', '{"schemaVersion":1,"folders":{}}', "null"]) { assert.throws(() => parseReviewState(value)); }
  await fs.writeFile(join(folder.directory, "manifest.json"), "{"); await assert.rejects(f.service.setReviewed(f.profile, folder.id, folder.version, true));
  assert.equal(f.storage.getItem(KEY), null); assert.equal((await f.service.catalog(f.profile)).folders.find(item => item.id === folder.id).reviewed, false);
});
