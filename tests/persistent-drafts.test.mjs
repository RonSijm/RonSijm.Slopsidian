import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join, relative, isAbsolute } from "node:path";
import { root } from "./host.mjs";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

let model, drafts, temporary, sequence = 0;
async function load(entry) {
  const compiled = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
}
before(async () => {
  model = await load("client/persistent-draft-model.ts");
  drafts = await load("client/persistent-drafts.ts");
  temporary = await fs.mkdtemp(join(root, ".runtime/persistent-draft-tests-"));
});
after(async () => {
  if (temporary) {
    const child = relative(join(root, ".runtime"), temporary);
    assert.ok(child && !isAbsolute(child) && !child.startsWith("..")); await fs.rm(temporary, { recursive: true });
  }
});

/** Real durable SQLite file with the same atomic contract as the IndexedDB backend. */
function sqliteBackend(file, hooks = {}) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS rows (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;");
  const backend = {
    async list(prefix) { await hooks.before?.("list"); return db.prepare("SELECT key, value FROM rows WHERE substr(key, 1, ?) = ? ORDER BY key").all(prefix.length, prefix).map(row => ({ key: row.key, value: row.value })); },
    async get(key) { await hooks.before?.("get"); return db.prepare("SELECT value FROM rows WHERE key = ?").get(key)?.value ?? null; },
    async update(key, change) {
      await hooks.before?.("update");
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = change(db.prepare("SELECT value FROM rows WHERE key = ?").get(key)?.value ?? null);
        if (result.action === "put") { db.prepare("INSERT INTO rows (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, result.value); }
        else if (result.action === "delete") { db.prepare("DELETE FROM rows WHERE key = ?").run(key); }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async transact(keys, change) {
      await hooks.before?.("transact");
      db.exec("BEGIN IMMEDIATE");
      try {
        const values = {};
        for (const key of keys) { values[key] = db.prepare("SELECT value FROM rows WHERE key = ?").get(key)?.value ?? null; }
        for (const [key, value] of Object.entries(change(values) ?? {})) {
          if (value === null) { db.prepare("DELETE FROM rows WHERE key = ?").run(key); }
          else { db.prepare("INSERT INTO rows (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value); }
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    close() { db.close(); },
    raw: db,
  };
  return backend;
}
const dbFile = () => join(temporary, "drafts-" + ++sequence + ".sqlite");
const draft = (over = {}) => ({ vaultRoot: "D:\\Vault A", path: "Notes/中文.md", baseVersion: "v-base", hasBom: true, content: "Unsaved 中文\r\nSecond line\r\n😀", ...over });
const clock = (start = 1_000_000) => { const state = { now: start }; return { state, now: () => state.now }; };
const sha = text => createHash("sha256").update(text, "utf8").digest("hex");

test("SHA-256 matches the platform for empty, Unicode and block-boundary inputs", () => {
  for (const text of ["", "abc", "中文😀\r\n", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(100000)]) { assert.equal(model.hashText(text), sha(text)); }
});

test("line endings and invalid text are identified exactly", async () => {
  assert.equal(model.detectLineEnding("a\r\nb\r\n"), "crlf"); assert.equal(model.detectLineEnding("a\nb"), "lf");
  assert.equal(model.detectLineEnding("a\r\nb\n"), "mixed"); assert.equal(model.detectLineEnding("a\rb"), "mixed"); assert.equal(model.detectLineEnding("abc"), "none");
  const store = new model.PersistentDraftStore(new model.MemoryDraftBackend(), { ownerId: "a" });
  for (const bad of [draft({ content: "\ud800" }), draft({ path: "../x.md" }), draft({ path: "a\\b.md" }), draft({ path: "x.canvas" }), draft({ vaultRoot: "" })]) {
    await assert.rejects(() => store.put(bad), /invalid identity/);
  }
});

test("stores exact text, BOM, line ending and original version, and survives a real restart as an orphan", async () => {
  const file = dbFile(), time = clock();
  let backend = sqliteBackend(file);
  const first = new model.PersistentDraftStore(backend, { ownerId: "window-1", now: time.now });
  const mixed = draft({ content: "a\r\nb\nc\r" });
  assert.equal(await first.put(draft()), "written"); assert.equal(await first.put(mixed.path === draft().path ? draft({ path: "Mixed.md", content: mixed.content, hasBom: false }) : mixed), "written");
  await first.heartbeat();
  backend.close();
  backend = sqliteBackend(file);
  time.state.now += 3000;
  const second = new model.PersistentDraftStore(backend, { ownerId: "window-2", now: time.now });
  let listing = await second.list();
  assert.equal(listing.corrupt.length, 0); assert.deepEqual(listing.drafts.map(item => item.ownership), ["active-elsewhere", "active-elsewhere"]);
  time.state.now += model.LEASE_MS;
  listing = await second.list();
  assert.deepEqual(listing.drafts.map(item => item.ownership), ["orphaned", "orphaned"]);
  const unicode = listing.drafts.find(item => item.record.path === "Notes/中文.md").record;
  assert.equal(unicode.content, draft().content); assert.equal(unicode.hasBom, true); assert.equal(unicode.eol, "crlf"); assert.equal(unicode.baseVersion, "v-base");
  assert.equal(unicode.vaultRoot, "D:\\Vault A"); assert.equal(unicode.sha256, sha(draft().content)); assert.equal(unicode.bytes, Buffer.byteLength(draft().content));
  const other = listing.drafts.find(item => item.record.path === "Mixed.md").record;
  assert.equal(other.eol, "mixed"); assert.equal(other.hasBom, false); assert.equal(other.content, "a\r\nb\nc\r");
  backend.close();
});

test("released leases become recoverable at once; a stalled owner is never taken over while its lease is live", async () => {
  const time = clock(), backend = new model.MemoryDraftBackend();
  const a = new model.PersistentDraftStore(backend, { ownerId: "a", now: time.now }), b = new model.PersistentDraftStore(backend, { ownerId: "b", now: time.now });
  await a.heartbeat(); await a.put(draft());
  assert.equal((await b.list()).drafts[0].ownership, "active-elsewhere");
  assert.equal(await b.remove(a.currentId(draft().vaultRoot, draft().path), null, true), false, "a live owner's draft is not removable");
  await a.release();
  assert.equal((await b.list()).drafts[0].ownership, "orphaned");
});

test("each owner has its own record, so a new window never overwrites an unreviewed earlier draft", async () => {
  const time = clock(), backend = new model.MemoryDraftBackend();
  const a = new model.PersistentDraftStore(backend, { ownerId: "a", now: time.now });
  await a.put(draft({ content: "old window text" })); await a.release();
  const b = new model.PersistentDraftStore(backend, { ownerId: "b", now: time.now }); await b.heartbeat();
  assert.equal(await b.put(draft({ content: "new window text" })), "written");
  const listing = await b.list();
  assert.deepEqual(listing.drafts.map(item => item.record.content).sort(), ["new window text", "old window text"]);
  assert.equal(await b.put(draft({ content: "new window text" })), "unchanged");
});

test("tombstones stop a stalled former owner from resurrecting an already resolved identical draft", async () => {
  const time = clock(), backend = new model.MemoryDraftBackend();
  const a = new model.PersistentDraftStore(backend, { ownerId: "a", now: time.now }), b = new model.PersistentDraftStore(backend, { ownerId: "b", now: time.now });
  await a.put(draft()); time.state.now += model.LEASE_MS * 2;
  const listed = (await b.list()).drafts[0];
  assert.equal(listed.ownership, "orphaned");
  assert.equal(await b.resolve(listed.record), true);
  assert.equal((await b.list()).drafts.length, 0);
  assert.equal(await a.put(draft()), "revoked");
  assert.equal(await a.put(draft({ content: "edited again" })), "written");
});

test("corrupt, tampered and unsupported records are listed with raw bytes, never repaired or overwritten silently", async () => {
  const backend = new model.MemoryDraftBackend(), store = new model.PersistentDraftStore(backend, { ownerId: "a" });
  await store.put(draft());
  const key = [...backend.rows.keys()].find(k => k.startsWith(model.DRAFT_KEY_PREFIX)), good = backend.rows.get(key);
  const tampered = JSON.stringify({ ...JSON.parse(good), content: "tampered" });
  backend.rows.set(key, tampered); backend.rows.set(model.DRAFT_KEY_PREFIX + "junk", "{not json"); backend.rows.set(model.DRAFT_KEY_PREFIX + "future", JSON.stringify({ schema: 2 }));
  const listing = await store.list();
  assert.equal(listing.drafts.length, 0); assert.equal(listing.corrupt.length, 3);
  assert.equal(listing.corrupt.find(item => item.key === key).raw, tampered);
  assert.match(listing.corrupt.find(item => item.key === key).reason, /hash/);
  assert.equal(await store.put(draft({ content: "fresh edit" })), "written");
  const quarantined = [...backend.rows].filter(([k]) => k.startsWith(model.QUARANTINE_KEY_PREFIX));
  assert.equal(quarantined.length, 1); assert.equal(quarantined[0][1], tampered);
  assert.equal(await store.removeCorrupt(model.DRAFT_KEY_PREFIX + "junk", "other"), false);
  assert.equal(await store.removeCorrupt(model.DRAFT_KEY_PREFIX + "junk", "{not json"), true);
});

test("quota, storage and size limits are classified and visible instead of silently ignored", async () => {
  const backend = new model.MemoryDraftBackend(), store = new model.PersistentDraftStore(backend, { ownerId: "a" });
  const quota = new Error("full"); quota.name = "QuotaExceededError"; backend.failWith = quota;
  await assert.rejects(() => store.put(draft()), error => error.kind === "quota");
  backend.failWith = new Error("disk gone");
  await assert.rejects(() => store.put(draft()), error => error.kind === "storage");
  backend.failWith = null;
  await assert.rejects(() => store.put(draft({ content: "x".repeat(model.MAX_RECORD_BYTES + 1) })), error => error.kind === "too-large");
});

function session(path, text, over = {}) { return { originRoot: "D:\\Vault A", dirty: true, isSaving: false, text, document: { file: { path }, version: "v1", hasBom: false }, ...over }; }
function manualTimers() {
  const timers = new Map(); let next = 1;
  return { timers: { setTimeout(fn) { timers.set(next, fn); return next++; }, clearTimeout(h) { timers.delete(h); }, setInterval() { return next++; }, clearInterval() {} }, fire() { const all = [...timers.values()]; timers.clear(); all.forEach(fn => fn()); }, size: () => timers.size };
}

test("shared panes dedupe to one record and clean sessions remove only the matching record", async () => {
  const backend = new model.MemoryDraftBackend(), store = new model.PersistentDraftStore(backend, { ownerId: "a" });
  const sessions = new Map([["A.md", session("A.md", "draft A")], ["B.md", session("B.md", "draft B")], ["C.md", session("C.md", "clean", { dirty: false })]]);
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers: manualTimers().timers });
  const health = await capture.flush();
  assert.equal(health.protecting, 2); assert.equal((await store.list()).drafts.length, 2);
  await capture.flush(); assert.equal((await store.list()).drafts.length, 2);
  sessions.get("A.md").dirty = false; await capture.flush();
  assert.deepEqual((await store.list()).drafts.map(item => item.record.path), ["B.md"]);
  sessions.get("B.md").dirty = false; sessions.get("B.md").isSaving = true; await capture.flush();
  assert.equal((await store.list()).drafts.length, 1, "an in-flight save keeps its draft");
  sessions.get("B.md").isSaving = false; await capture.flush();
  assert.equal((await store.list()).drafts.length, 0);
});

test("late and in-flight edits are not discarded by debounce, a running pass or dispose", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let blockNext = true;
  const backend = sqliteBackend(dbFile(), { async before(op) { if (op === "update" && blockNext) { blockNext = false; await gate; } } });
  const store = new model.PersistentDraftStore(backend, { ownerId: "a" }), t = manualTimers();
  const sessions = new Map([["A.md", session("A.md", "first")]]);
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers: t.timers });
  const running = capture.flush();
  sessions.get("A.md").text = "second (typed during the running pass)"; capture.schedule();
  sessions.get("A.md").text = "third (typed during the running pass, after schedule)";
  assert.ok(t.size() >= 1, "a follow-up pass is scheduled");
  release();
  await running;
  const disposed = await capture.dispose();
  assert.deepEqual((await store.list()).drafts.map(item => item.record.content), ["third (typed during the running pass, after schedule)"]);
  assert.equal(disposed.failures.length, 0);
  sessions.get("A.md").text = "after dispose"; capture.schedule(); await capture.flush();
  assert.equal((await store.list()).drafts[0].record.content, "after dispose", "capture resumes instead of silently dropping edits");
  backend.close();
});

test("capture failures are published as health and later retried successfully", async () => {
  const backend = new model.MemoryDraftBackend(), store = new model.PersistentDraftStore(backend, { ownerId: "a" });
  const events = []; const sessions = new Map([["A.md", session("A.md", "keep me")]]);
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers: manualTimers().timers, onHealth: health => events.push(health.failures.map(f => f.kind)) });
  const quota = new Error("quota"); quota.name = "QuotaExceededError"; backend.failWith = quota;
  let health = await capture.flush();
  assert.equal(health.failures[0].kind, "quota"); assert.match(health.storageError, /full/);
  backend.failWith = null; health = await capture.flush();
  assert.equal(health.failures.length, 0); assert.equal(health.storageError, null); assert.equal((await store.list()).drafts.length, 1);
  assert.ok(events.some(kinds => kinds.includes("quota")));
  const bad = new Map([["A.md", session("A.md", "x", { originRoot: null })]]);
  const unidentified = await new drafts.PersistentDraftCapture(store, () => bad, { timers: manualTimers().timers }).flush();
  assert.equal(unidentified.failures[0].kind, "invalid");
});

test("vanished sessions keep their draft unless the vault proves identical saved text", async () => {
  const backend = new model.MemoryDraftBackend(), store = new model.PersistentDraftStore(backend, { ownerId: "a" });
  const sessions = new Map([["A.md", session("A.md", "saved text")], ["B.md", session("B.md", "unsaved text")]]);
  const disk = { "A.md": "saved text", "B.md": "something else" };
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers: manualTimers().timers, currentRoot: () => "D:\\Vault A", readCurrent: async path => ({ state: "present", content: disk[path], version: "v", hasBom: false }) });
  await capture.flush(); sessions.clear();
  const health = await capture.flush();
  assert.deepEqual((await store.list()).drafts.map(item => item.record.path), ["B.md"]);
  assert.deepEqual(health.retained.length, 1);
});

function vault(files, rootPath = "D:\\Vault A") {
  const versionOf = file => sha(file.content + (file.hasBom ? "\ufeff" : ""));
  return {
    rootPath, files, writes: [], failWith: null,
    getAbstractFileByPath(path) { return files.has(path) ? {} : null; },
    async readDocument(path) { const file = files.get(path); return { content: file.content, version: versionOf(file), hasBom: file.hasBom }; },
    async writeDocument(path, content, version, create) {
      if (this.failWith) { throw this.failWith; }
      const existing = files.get(path);
      if (create && existing) { throw new Error("A file already exists at that path."); }
      if (!create && (!existing || versionOf(existing) !== version)) { throw new Error("This file changed on disk."); }
      this.writes.push({ path, content, version, create });
      // Both real create transports encode a leading U+FEFF as the BOM bytes, and a replace keeps the existing BOM.
      const bom = create && content.startsWith("\ufeff");
      files.set(path, { content: bom ? content.slice(1) : content, hasBom: bom || (existing?.hasBom ?? false) });
    },
    versionOf,
  };
}

async function orphan(input = draft(), content = null) {
  const time = clock(), backend = new model.MemoryDraftBackend();
  const a = new model.PersistentDraftStore(backend, { ownerId: "old", now: time.now }); await a.put(input); await a.release();
  const store = new model.PersistentDraftStore(backend, { ownerId: "new", now: time.now });
  return { store, record: (await store.list()).drafts[0].record, backend };
}

test("recovery assessment allows replacement only for the exact captured source version", async () => {
  const base = vault(new Map([["Notes/中文.md", { content: "original", hasBom: true }]]));
  const { record } = await orphan(draft({ baseVersion: base.versionOf({ content: "original", hasBom: true }) }));
  const read = async () => model.readSource(base, record.path);
  assert.equal(model.assessRecovery(record, "D:\\Vault A", await read()).canReplace, true);
  base.files.set(record.path, { content: "edited elsewhere", hasBom: true });
  const changed = model.assessRecovery(record, "D:\\Vault A", await read());
  assert.equal(changed.status, "changed"); assert.equal(changed.canReplace, false);
  base.files.set(record.path, { content: record.content, hasBom: true });
  assert.equal(model.assessRecovery(record, "D:\\Vault A", await read()).alreadySaved, true);
  base.files.delete(record.path);
  assert.equal(model.assessRecovery(record, "D:\\Vault A", await read()).canCreateAtOriginalPath, true);
  assert.equal(model.assessRecovery(record, "D:\\Other", null).status, "other-vault");
  assert.equal(model.assessRecovery(record, "D:\\Vault A", { state: "unreadable", error: "denied" }).canReplace, false);
});

test("reviewed replacement is version guarded, exact, removes only the reviewed record and never touches changed sources", async () => {
  const originalFile = { content: "original", hasBom: true }, v = vault(new Map([["Notes/中文.md", originalFile]]));
  const { store, record } = await orphan(draft({ baseVersion: v.versionOf(originalFile) }));
  const result = await model.applyRecovery(store, v, record, { kind: "replace" });
  assert.equal(result.ok, true); assert.equal(result.removed, true);
  assert.equal(v.files.get(record.path).content, draft().content); assert.deepEqual(v.writes, [{ path: record.path, content: draft().content, version: record.baseVersion, create: false }]);
  assert.equal((await store.list()).drafts.length, 0);

  const second = await orphan(draft({ baseVersion: "stale-version" }));
  const external = vault(new Map([["Notes/中文.md", { content: "external edit", hasBom: true }]]));
  const refused = await model.applyRecovery(second.store, external, second.record, { kind: "replace" });
  assert.equal(refused.ok, false); assert.equal(external.writes.length, 0); assert.equal(external.files.get(second.record.path).content, "external edit");
  assert.equal((await second.store.list()).drafts.length, 1, "refused replacement keeps the draft");
});

test("save-as-new is exclusive, validated and keeps the draft when the host fails", async () => {
  const v = vault(new Map([["Notes/中文.md", { content: "original", hasBom: false }], ["Taken.md", { content: "x", hasBom: false }]]));
  const { store, record } = await orphan(draft({ baseVersion: "stale" }));
  for (const path of ["Taken.md", "../escape.md", "C:/x.md", ".hidden/x.md", "no-extension", "CON.md"]) {
    const outcome = await model.applyRecovery(store, v, record, { kind: "create", path }).catch(error => ({ ok: false, thrown: error }));
    assert.equal(outcome.ok, false, path);
  }
  assert.equal(v.writes.length, 0);
  v.failWith = new Error("disk full");
  assert.equal((await model.applyRecovery(store, v, record, { kind: "create", path: "Recovered.md" })).ok, false);
  assert.equal((await store.list()).drafts.length, 1);
  v.failWith = null;
  const ok = await model.applyRecovery(store, v, record, { kind: "create", path: "Recovered.md" });
  assert.equal(ok.ok, true); assert.equal(v.files.get("Recovered.md").content, draft().content); assert.equal(v.files.get("Notes/中文.md").content, "original");
  assert.equal((await store.list()).drafts.length, 0);
  assert.equal(model.suggestRecoveryPath("a/B.md", candidate => candidate.includes("recovered") && !candidate.endsWith(" 2).md"), new Date("2026-10-31T10:20:00Z")), "a/B (recovered 202610311020 2).md");
});

test("a draft that changes after review is kept; discard is explicit and active windows are protected", async () => {
  const v = vault(new Map());
  const { store, record, backend } = await orphan();
  const reviewed = record;
  const writer = new model.PersistentDraftStore(backend, { ownerId: "old" });
  await writer.put(draft({ content: "typed after review" })); await writer.release();
  const result = await model.applyRecovery(store, v, reviewed, { kind: "create", path: "R.md" });
  assert.equal(result.ok, true); assert.equal(result.removed, false);
  assert.equal((await store.list()).drafts[0].record.content, "typed after review");
  const kept = (await store.list()).drafts[0].record;
  const discard = await model.applyRecovery(store, v, kept, { kind: "discard" });
  assert.equal(discard.removed, true);
  const live = new model.PersistentDraftStore(backend, { ownerId: "live" }); await live.heartbeat(); await live.put(draft({ path: "Live.md" }));
  const liveRecord = (await store.list()).drafts[0].record;
  assert.equal((await model.applyRecovery(store, v, liveRecord, { kind: "discard" })).ok, false);
  assert.equal((await store.list()).drafts.length, 1);
});

test("cancelling a review (doing nothing) preserves every record and source byte", async () => {
  const file = dbFile(), source = { content: "original", hasBom: true }, v = vault(new Map([["Notes/中文.md", source]]));
  let backend = sqliteBackend(file), time = clock();
  const store = new model.PersistentDraftStore(backend, { ownerId: "a", now: time.now });
  await store.put(draft({ baseVersion: v.versionOf(source) })); await store.release(); backend.close();
  const before = JSON.stringify([...v.files]);
  for (let i = 0; i < 3; i++) {
    backend = sqliteBackend(file);
    const next = new model.PersistentDraftStore(backend, { ownerId: "r" + i, now: time.now });
    const listing = await next.list(); assert.equal(listing.drafts.length, 1); assert.equal(listing.drafts[0].record.content, draft().content);
    backend.close();
  }
  assert.equal(JSON.stringify([...v.files]), before); assert.equal(v.writes.length, 0);
});

test("save-as-new restores the exact BOM through the create transport and refuses what it cannot reproduce", async () => {
  const v = vault(new Map());
  for (const [hasBom, content, name] of [[true, "bom\r\ntext 😀", "Bom.md"], [false, "plain\ntext", "Plain.md"], [true, "\ufeffstarts with zwnbsp", "Both.md"]]) {
    const { store, record } = await orphan(draft({ hasBom, content, path: "Src-" + name, baseVersion: "gone" }));
    const result = await model.applyRecovery(store, v, record, { kind: "create", path: name });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(v.files.get(name), { content, hasBom });
    assert.equal(v.writes.at(-1).content, (hasBom ? "\ufeff" : "") + content);
  }
  const { store, record } = await orphan(draft({ hasBom: false, content: "\ufeffambiguous", path: "Amb.md", baseVersion: "gone" }));
  const refused = await model.applyRecovery(store, v, record, { kind: "create", path: "Amb-new.md" });
  assert.equal(refused.ok, false); assert.match(refused.message, /Copy the text/); assert.equal(v.files.has("Amb-new.md"), false);
  assert.equal((await store.list()).drafts.length, 1);
});

test("a host that stores different bytes is reported and the draft record is kept", async () => {
  const v = vault(new Map());
  const original = v.writeDocument.bind(v);
  v.writeDocument = async (path, content, version, create) => { await original(path, content.replace(/^\ufeff/, ""), version, create); };
  const { store, record } = await orphan(draft({ baseVersion: "gone" }));
  const result = await model.applyRecovery(store, v, record, { kind: "create", path: "Dropped.md" });
  assert.equal(result.ok, false); assert.match(result.message, /differs/);
  assert.equal((await store.list()).drafts.length, 1);
});

test("the desktop profile SQLite backend survives a different host port and enforces conditional writes", async () => {
  const { createProfileStorage } = require("../desktop/local-storage.cjs");
  const { handlePersistentDraftRequest } = require("../desktop/persistent-draft-storage.cjs");
  const file = join(temporary, "profile-" + ++sequence + ".sqlite");
  const open = () => { const storage = createProfileStorage(file); return { storage, backend: drafts.createProfileDraftBackend(async (operation, key, expected, value) => handlePersistentDraftRequest(storage, operation, key, expected, value)) }; };
  const time = clock();
  let session = open();
  const first = new model.PersistentDraftStore(session.backend, { ownerId: "http://127.0.0.1:41001-window", now: time.now });
  assert.equal(await first.put(draft()), "written"); await first.heartbeat();
  session.storage.setItem("slopsidian:vault-local:unrelated", "keep");
  session.storage.close();
  time.state.now += 60_000;
  // A new process on another loopback port reads the same stable profile file; nothing is keyed by origin.
  session = open();
  const second = new model.PersistentDraftStore(session.backend, { ownerId: "http://127.0.0.1:52002-window", now: time.now });
  const listing = await second.list();
  assert.equal(listing.drafts.length, 1); assert.equal(listing.drafts[0].ownership, "orphaned"); assert.equal(listing.drafts[0].record.content, draft().content);
  assert.equal(session.storage.getItem("slopsidian:vault-local:unrelated"), "keep");
  // Conditional write and delete: a stale expectation never overwrites or removes the stored value.
  const key = model.draftKey(listing.drafts[0].record.id), raw = session.storage.getItem(key);
  assert.equal(session.storage.compareAndSetItem(key, "stale", "x"), false);
  assert.equal(session.storage.compareAndRemoveItem(key, "stale"), false);
  assert.equal(session.storage.getItem(key), raw);
  // Concurrent connections (two windows/processes) never lose a record.
  const other = open();
  const writerA = new model.PersistentDraftStore(session.backend, { ownerId: "a", now: time.now }), writerB = new model.PersistentDraftStore(other.backend, { ownerId: "b", now: time.now });
  await Promise.all([writerA.put(draft({ path: "A.md" })), writerB.put(draft({ path: "B.md" })), writerA.heartbeat(), writerB.heartbeat()]);
  assert.deepEqual((await second.list()).drafts.map(item => item.record.path).sort(), ["A.md", "B.md", "Notes/中文.md"]);
  // The host IPC only reaches draft keys.
  assert.throws(() => handlePersistentDraftRequest(session.storage, "get", "slopsidian:vault-local:unrelated"), /Not a persistent draft/);
  assert.throws(() => handlePersistentDraftRequest(session.storage, "set", model.draftKey("x"), null, "v"), /Unknown/);
  assert.throws(() => handlePersistentDraftRequest(session.storage, "cas", model.draftKey("x"), null, 5), /text or null/);
  // Host and storage failures surface as explicit classified errors.
  const failing = new model.PersistentDraftStore(drafts.createProfileDraftBackend(async () => { throw new Error("database or disk is full"); }), { ownerId: "c" });
  await assert.rejects(() => failing.put(draft()), error => error.kind === "quota");
  const broken = new model.PersistentDraftStore(drafts.createProfileDraftBackend(async () => "nonsense"), { ownerId: "d" });
  await assert.rejects(() => broken.list(), error => error.kind === "storage");
  // Contention beyond the retry budget fails loudly instead of dropping the write.
  const contended = drafts.createProfileDraftBackend(async operation => operation === "cas" ? { applied: false } : { value: null }, 3);
  await assert.rejects(() => contended.update("slopsidian:persistent-draft:v1:x", () => ({ action: "put", value: "v" })), /busy/);
  session.storage.close(); other.storage.close();
});

/**
 * Backends whose commit boundary can be interleaved deterministically. `hooks.beforeCommit()` runs after a writer
 * has read its snapshot but before its atomic commit is attempted (for the profile backend: between the reads and the
 * host's all-or-nothing apply, which then fails and is retried); `hooks.afterCommit()` runs right after a commit.
 */
function transactHooks(backend, hooks) {
  let nested = false;
  const wrap = async run => {
    if (nested) { return run(); }
    nested = true;
    try { await hooks.beforeCommit?.(); } finally { nested = false; }
    const result = await run();
    nested = true;
    try { await hooks.afterCommit?.(); } finally { nested = false; }
    return result;
  };
  return { list: p => backend.list(p), get: k => backend.get(k), update: (k, c) => backend.update(k, c), transact: (keys, change) => wrap(() => backend.transact(keys, change)) };
}
const backendKinds = {
  memory: hooks => { const raw = new model.MemoryDraftBackend(); return { raw, backend: transactHooks(raw, hooks), close() {} }; },
  sqlite: hooks => { const raw = sqliteBackend(dbFile()); return { raw, backend: transactHooks(raw, hooks), close: () => raw.close() }; },
  "desktop profile CAS": hooks => {
    const { createProfileStorage } = require("../desktop/local-storage.cjs");
    const { handlePersistentDraftRequest } = require("../desktop/persistent-draft-storage.cjs");
    const storage = createProfileStorage(join(temporary, "fence-" + ++sequence + ".sqlite"));
    let nested = false, commits = 0;
    const raw = drafts.createProfileDraftBackend(async (op, key, expected, value) => {
      if (op !== "txn" || nested) { return handlePersistentDraftRequest(storage, op, key, expected, value); }
      nested = true;
      try { await hooks.beforeCommit?.(); } finally { nested = false; }
      const result = handlePersistentDraftRequest(storage, op, key, expected, value);
      if (result.applied) { commits++; nested = true; try { await hooks.afterCommit?.(); } finally { nested = false; } }
      return result;
    });
    return { raw: { list: p => raw.list(p) }, backend: raw, close: () => storage.close(), commits: () => commits };
  },
};

/** One-shot hook: runs `fn` the first time it is reached. */
const once = fn => { let done = false; return async () => { if (!done) { done = true; await fn(); } }; };

async function orphanFixture(kind, hooks) {
  const time = clock(), state = backendKinds[kind](hooks);
  const a = new model.PersistentDraftStore(state.backend, { ownerId: "a", now: time.now }), b = new model.PersistentDraftStore(state.backend, { ownerId: "b", now: time.now });
  await a.heartbeat(); assert.equal(await a.put(draft()), "written");
  time.state.now += model.LEASE_MS * 2;
  const listed = (await b.list()).drafts[0];
  assert.equal(listed.ownership, "orphaned");
  return { a, b, time, listed, state };
}

for (const kind of Object.keys(backendKinds)) {
  test(`renewal that commits before the removal commit makes the removal refuse and leaves no tombstone (${kind})`, async () => {
    const hooks = {}, ctx = await orphanFixture(kind, hooks);
    hooks.beforeCommit = once(() => ctx.a.heartbeat());
    assert.equal(await ctx.b.resolve(ctx.listed.record), false, "a renewed owner's draft is kept");
    const after = (await ctx.b.list()).drafts;
    assert.equal(after.length, 1); assert.equal(after[0].record.content, draft().content); assert.equal(after[0].ownership, "active-elsewhere");
    assert.equal((await ctx.state.raw.list(model.REVOKED_KEY_PREFIX)).length, 0, "no tombstone");
    assert.equal(await ctx.a.put(draft()), "unchanged", "the owner's next identical capture is not revoked");
    ctx.state.close();
  });

  test(`removal that commits first fences the stale owner's later renewal and identical write (${kind})`, async () => {
    const hooks = {}, ctx = await orphanFixture(kind, hooks);
    let renewed = false;
    hooks.afterCommit = once(async () => { await ctx.a.heartbeat(); renewed = true; });
    assert.equal(await ctx.b.resolve(ctx.listed.record), true);
    assert.equal(renewed, true);
    assert.equal((await ctx.b.list()).drafts.length, 0);
    assert.equal((await ctx.state.raw.list(model.REVOKED_KEY_PREFIX)).length, 1, "tombstone committed with the removal");
    assert.equal(await ctx.a.put(draft()), "revoked", "the renewed stale owner cannot resurrect the resolved text");
    assert.equal(await ctx.a.put(draft({ content: "new edit after resolution" })), "written");
    ctx.state.close();
  });

  test(`a stale owner's write prepared before a winning removal conflicts instead of overwriting (${kind})`, async () => {
    const hooks = {}, ctx = await orphanFixture(kind, hooks);
    hooks.beforeCommit = once(async () => { assert.equal(await ctx.b.resolve(ctx.listed.record), true); });
    assert.equal(await ctx.a.put(draft({ content: "edit prepared against the old record" })), "conflict");
    assert.equal((await ctx.b.list()).drafts.length, 0);
    ctx.state.close();
  });

  test(`storage failure at the commit boundary preserves the record and reports a classified error (${kind})`, async () => {
    const hooks = {}, ctx = await orphanFixture(kind, hooks);
    hooks.beforeCommit = once(async () => { throw new Error("database or disk is full"); });
    await assert.rejects(() => ctx.b.resolve(ctx.listed.record), error => error.kind === "quota");
    const after = (await ctx.b.list()).drafts;
    assert.equal(after.length, 1); assert.equal(after[0].record.content, draft().content);
    assert.equal((await ctx.state.raw.list(model.REVOKED_KEY_PREFIX)).length, 0);
    ctx.state.close();
  });
}

test("the profile host applies all keys or none, and a commit raced by a renewal is retried against the fresh lease", async () => {
  const hooks = {}, ctx = await orphanFixture("desktop profile CAS", hooks);
  hooks.beforeCommit = async () => { await ctx.a.heartbeat(); };
  assert.equal(await ctx.b.resolve(ctx.listed.record), false, "every retry sees the freshly renewed lease");
  assert.equal((await ctx.b.list()).drafts.length, 1);
  ctx.state.close();
  const { createProfileStorage } = require("../desktop/local-storage.cjs");
  const storage = createProfileStorage(join(temporary, "txn-" + ++sequence + ".sqlite"));
  storage.setItem("slopsidian:persistent-draft:a", "1");
  assert.equal(storage.compareAndApply([["slopsidian:persistent-draft:a", "stale"]], [["slopsidian:persistent-draft:a", null], ["slopsidian:persistent-draft:b", "x"]]), false);
  assert.equal(storage.getItem("slopsidian:persistent-draft:a"), "1"); assert.equal(storage.getItem("slopsidian:persistent-draft:b"), null);
  assert.equal(storage.compareAndApply([["slopsidian:persistent-draft:a", "1"], ["slopsidian:persistent-draft:b", null]], [["slopsidian:persistent-draft:a", null], ["slopsidian:persistent-draft:b", "x"]]), true);
  assert.equal(storage.getItem("slopsidian:persistent-draft:a"), null); assert.equal(storage.getItem("slopsidian:persistent-draft:b"), "x");
  storage.close();
});

test("retirement is bound to the exact reviewed revision, including BOM", async () => {
  const time = clock(), backend = new model.MemoryDraftBackend();
  const a = new model.PersistentDraftStore(backend, { ownerId: "a", now: time.now }), b = new model.PersistentDraftStore(backend, { ownerId: "b", now: time.now });
  assert.equal(await a.put(draft({ hasBom: false, content: "same text" })), "written");
  time.state.now += model.LEASE_MS * 2;
  const v1 = (await b.list()).drafts[0].record;
  // The writer wakes and stores revision 2 with identical text but a BOM.
  assert.equal(await a.put(draft({ hasBom: true, content: "same text" })), "written");
  time.state.now += model.LEASE_MS * 2;
  assert.equal(await b.resolve(v1), false);
  const kept = (await b.list()).drafts;
  assert.equal(kept.length, 1); assert.equal(kept[0].record.hasBom, true); assert.equal(kept[0].record.revision, 2);
  assert.equal(await b.remove(v1.id, { sha256: v1.sha256, hasBom: false }, true), false);
  assert.equal((await b.list()).drafts.length, 1);
  assert.equal((await backend.list(model.REVOKED_KEY_PREFIX)).length, 0);
  assert.equal(await b.resolve(kept[0].record), true, "the exact current revision is retired");
});

test("BOM-different siblings with identical text are not collapsed by a reviewed recovery", async () => {
  const time = clock(), backend = new model.MemoryDraftBackend();
  const a = new model.PersistentDraftStore(backend, { ownerId: "a", now: time.now }), c = new model.PersistentDraftStore(backend, { ownerId: "c", now: time.now }), reviewer = new model.PersistentDraftStore(backend, { ownerId: "r", now: time.now });
  await a.put(draft({ hasBom: false, content: "same text" })); await c.put(draft({ hasBom: true, content: "same text" }));
  time.state.now += model.LEASE_MS * 2;
  const listed = (await reviewer.list()).drafts, plain = listed.find(item => !item.record.hasBom).record;
  assert.equal(await reviewer.resolve(plain), true);
  const rest = (await reviewer.list()).drafts;
  assert.deepEqual(rest.map(item => [item.record.ownerId, item.record.hasBom]), [["c", true]]);
  const exactSibling = new model.PersistentDraftStore(backend, { ownerId: "d", now: time.now }); await exactSibling.put(draft({ hasBom: true, content: "same text" }));
  time.state.now += model.LEASE_MS * 2;
  assert.equal(await reviewer.resolve(rest[0].record), true);
  assert.equal((await reviewer.list()).drafts.length, 0, "identical text and BOM siblings are resolved together");
});

test("capture cleanup never removes a same-text record whose BOM differs, and the source bytes survive", async () => {
  const backend = new model.MemoryDraftBackend(), store = new model.PersistentDraftStore(backend, { ownerId: "a" });
  const disk = { "A.md": { content: "text", hasBom: true } };
  const sessions = new Map([["A.md", session("A.md", "text", { document: { file: { path: "A.md" }, version: "v1", hasBom: false } })]]);
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers: manualTimers().timers, currentRoot: () => "D:\\Vault A", readCurrent: async path => ({ state: "present", version: "v", ...disk[path] }) });
  await capture.flush();
  // Same owner id (another tab of the same profile slot) replaces the record with the BOM variant.
  await new model.PersistentDraftStore(backend, { ownerId: "a" }).put(draft({ path: "A.md", hasBom: true, content: "text" }));
  sessions.get("A.md").dirty = false;
  await capture.flush();
  const kept = (await store.list()).drafts;
  assert.equal(kept.length, 1); assert.equal(kept[0].record.hasBom, true);
  // Vanished session: the vault holds the same text but a BOM-different file; the draft is retained.
  sessions.clear(); await capture.flush();
  assert.equal((await store.list()).drafts.length, 1);
  assert.deepEqual(disk["A.md"], { content: "text", hasBom: true }, "source bytes untouched");
});
