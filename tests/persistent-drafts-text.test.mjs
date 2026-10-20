import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let model, drafts, owners, providers, temporary;
const light = async entry => {
  const compiled = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
};
before(async () => {
  model = await light("client/persistent-draft-model.ts");
  drafts = await light("client/persistent-drafts.ts");
  owners = await light("client/persistent-draft-owners.ts");
  await fs.mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await fs.mkdtemp(join(root, ".runtime/persistent-text-draft-tests-"));
  const outfile = join(temporary, "providers.mjs");
  await build({ entryPoints: ["client/persistent-draft-providers.ts"], outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  providers = await import(pathToFileURL(outfile).href);
});
after(async () => { if (temporary) { await fs.rm(temporary, { recursive: true }); } });

const ROOT = "D:\\Vault A";
const sha = text => createHash("sha256").update(text, "utf8").digest("hex");
const canvasText = JSON.stringify({ future: { keep: [1, null] }, nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "hi", extra: true }], edges: [] }, null, 2);
const baseText = "filters:\n  and: []\nviews:\n  - type: table\n    name: Table\n";
const input = (over = {}) => ({ vaultRoot: ROOT, path: "Boards/Plan.canvas", provider: "core:canvas", baseVersion: "v-base", hasBom: false, content: canvasText, ...over });

function vault(files, over = {}) {
  const versionOf = file => sha(file.content + (file.hasBom ? "\ufeff" : ""));
  return {
    rootPath: ROOT, files, writes: [], versionOf, ...over,
    getAbstractFileByPath(path) { return files.has(path) ? {} : null; },
    async readDocument(path) { const file = files.get(path); return { content: file.content, version: versionOf(file), hasBom: file.hasBom }; },
    async writeDocument(path, content, version, create) {
      const existing = files.get(path);
      if (create && existing) { throw new Error("A file already exists at that path."); }
      if (!create && (!existing || versionOf(existing) !== version)) { throw new Error("This file changed on disk."); }
      this.writes.push({ path, content, version, create });
      const bom = create && content.startsWith("\ufeff");
      files.set(path, { content: bom ? content.slice(1) : content, hasBom: bom || (existing?.hasBom ?? false) });
    },
  };
}
async function orphan(value) {
  const backend = new model.MemoryDraftBackend();
  const old = new model.PersistentDraftStore(backend, { ownerId: "old" });
  assert.equal(await old.put(value), "written"); await old.release();
  const store = new model.PersistentDraftStore(backend, { ownerId: "new" });
  return { store, backend, record: (await store.list()).drafts[0].record };
}
const timers = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} };
const owner = (path, text, over = {}) => ({ provider: "core:canvas", originRoot: ROOT, dirty: true, isSaving: false, text, document: { file: { path }, version: "v1", hasBom: false }, ...over });

test("provider identity decides the accepted extension and Markdown records stay byte-identical", async () => {
  const store = new model.PersistentDraftStore(new model.MemoryDraftBackend(), { ownerId: "a" });
  assert.equal(await store.put(input()), "written");
  assert.equal(await store.put(input({ path: "Data/T.base", provider: "core:bases", content: baseText })), "written");
  assert.equal(await store.put(input({ path: "Data/X.probeedit", provider: "view:probe-text", content: "plugin text" })), "written");
  for (const bad of [input({ path: "Boards/Plan.md" }), input({ provider: "core:bases" }), input({ path: "N.md", provider: "view:probe-text" }), input({ path: "N.markdown", provider: "view:probe-text" }), input({ provider: "core:unknown" }), input({ provider: "view:" }), input({ path: "NoExtension", provider: "view:probe-text" })]) {
    await assert.rejects(() => store.put(bad), /invalid identity|provider/i, JSON.stringify([bad.path, bad.provider]));
  }
  const markdown = new model.MemoryDraftBackend(), md = new model.PersistentDraftStore(markdown, { ownerId: "a" });
  await md.put({ vaultRoot: ROOT, path: "N.md", baseVersion: "v", hasBom: false, content: "x" });
  const raw = [...(await markdown.list("")).map(entry => JSON.parse(entry.value))].find(Boolean);
  assert.equal("provider" in raw, false, "Markdown records must not gain a provider field");
  assert.equal((await md.put({ vaultRoot: ROOT, path: "N.md", baseVersion: "v", hasBom: false, content: "x" })), "unchanged");
});

test("recovery destinations and suggestions keep the original extension", () => {
  assert.equal(model.draftExtension("core:canvas", "A.canvas"), ".canvas");
  assert.equal(model.providerLabel("core:bases"), "Base");
  assert.equal(model.validateRecoveryDestination("Recovered/Plan.canvas", ".canvas"), "Recovered/Plan.canvas");
  assert.throws(() => model.validateRecoveryDestination("Recovered/Plan.md", ".canvas"));
  assert.throws(() => model.validateRecoveryDestination("Recovered/Plan.canvas"));
  assert.match(model.suggestRecoveryPath("Boards/Plan.canvas", () => false, new Date("2026-10-31T10:20:00Z")), /\.canvas$/);
});

test("capture stores dirty Canvas, Bases and plugin text with their provider and restarts as recoverable orphans", async () => {
  const backend = new model.MemoryDraftBackend(), store = new model.PersistentDraftStore(backend, { ownerId: "a" });
  const sessions = new Map([
    ["Boards/Plan.canvas", owner("Boards/Plan.canvas", canvasText)],
    ["Data/T.base", owner("Data/T.base", baseText, { provider: "core:bases" })],
    ["Data/X.probeedit", owner("Data/X.probeedit", "plugin\r\ntext", { provider: "view:probe-text", document: { file: { path: "Data/X.probeedit" }, version: "v1", hasBom: true } })],
  ]);
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers });
  const health = await capture.flush();
  assert.equal(health.protecting, 3); assert.deepEqual(health.failures, []);
  await store.release();
  const next = new model.PersistentDraftStore(backend, { ownerId: "b" });
  const found = new Map((await next.list()).drafts.map(item => [item.record.path, item]));
  assert.equal(found.get("Boards/Plan.canvas").record.content, canvasText);
  assert.equal(found.get("Boards/Plan.canvas").record.provider, "core:canvas");
  assert.equal(found.get("Data/X.probeedit").record.hasBom, true);
  assert.equal(found.get("Data/X.probeedit").record.eol, "crlf");
  assert.equal(found.get("Data/T.base").ownership, "orphaned");
});

test("busy, error and deferred owners neither store nor retire an existing record", async () => {
  const store = new model.PersistentDraftStore(new model.MemoryDraftBackend(), { ownerId: "a" });
  const sessions = new Map([["Boards/Plan.canvas", owner("Boards/Plan.canvas", canvasText)]]);
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers });
  await capture.flush();
  for (const [name, over, kind] of [["busy", { busy: true, dirty: false, text: "" }], ["deferred", { deferred: true, dirty: false, text: "" }], ["error", { error: "serializer threw", dirty: false, text: "" }]]) {
    sessions.set("Boards/Plan.canvas", owner("Boards/Plan.canvas", "", over));
    const health = await capture.flush();
    assert.equal((await store.list()).drafts.length, 1, name + " must keep the existing record");
    assert.equal((await store.list()).drafts[0].record.content, canvasText);
    if (kind === "invalid" || name === "error") { assert.ok(health.failures.some(f => f.kind === "invalid"), "an owner error is an explicit failure"); }
  }
  sessions.set("Boards/Plan.canvas", owner("Boards/Plan.canvas", "", { dirty: false }));
  await capture.flush();
  assert.equal((await store.list()).drafts.length, 0, "a clean saved owner retires its record");
});

test("a failed save keeps the record; two views with different text for one file fail explicitly", async () => {
  const store = new model.PersistentDraftStore(new model.MemoryDraftBackend(), { ownerId: "a" });
  const sessions = new Map([["Boards/Plan.canvas", owner("Boards/Plan.canvas", canvasText, { dirty: false, isSaving: true })]]);
  const capture = new drafts.PersistentDraftCapture(store, () => sessions, { timers });
  await capture.flush();
  assert.equal((await store.list()).drafts.length, 1, "an in-flight save still protects the text");
  const duplicate = () => [["Boards/Plan.canvas", owner("Boards/Plan.canvas", canvasText)], ["Boards/Plan.canvas", owner("Boards/Plan.canvas", canvasText + " ")]];
  const twin = new drafts.PersistentDraftCapture(store, () => duplicate(), { timers });
  const health = await twin.flush();
  assert.ok(health.failures.some(f => /different unsaved text/.test(f.message)), JSON.stringify(health.failures));
  assert.equal((await store.list()).drafts[0].record.content, canvasText, "the first view wins; nothing is overwritten");
});

test("text-view owners expose genuine dirty state, defer plugin serialisers at teardown and report live dirty owners", () => {
  let serialised = 0;
  const view = (provider, path, state) => ({ draftRecoveryProvider: provider, file: { path }, captureDraft() { serialised++; return { provider, state, saving: false, path, root: ROOT, text: "text", version: "v", hasBom: false }; } });
  const app = { vault: { rootPath: ROOT }, workspace: { sessions: new Map(), leaves: () => [{ view: view("core:canvas", "A.canvas", "dirty") }, { view: view("view:probe", "B.probe", "dirty") }, { view: { draftRecoveryProvider: null, captureDraft: () => null } }, { view: {} }] } };
  const live = owners.textViewOwners(app, false);
  assert.deepEqual(live.map(([path]) => path), ["A.canvas", "B.probe"]); assert.equal(serialised, 2);
  serialised = 0;
  const teardown = owners.textViewOwners(app, true);
  assert.equal(serialised, 1, "only the built-in provider is serialised during teardown");
  assert.equal(teardown[1][1].deferred, true);
  assert.match(owners.liveDirtyOwner(app, { vaultRoot: ROOT, path: "A.canvas" }), /still holds unsaved/);
  assert.equal(owners.liveDirtyOwner(app, { vaultRoot: "D:\\Other", path: "A.canvas" }), null);
  assert.equal(owners.liveDirtyOwner(app, { vaultRoot: ROOT, path: "Z.canvas" }), null);
});

test("Canvas, Bases and plugin validators accept only recoverable text", () => {
  const app = { workspace: { viewTypeForExtension: extension => extension === "probeedit" ? "probe-text" : null } };
  const check = (provider, path, content) => providers.validateDraftForReplace(app, { provider, path, content });
  assert.equal(check("core:canvas", "A.canvas", canvasText), null);
  assert.notEqual(check("core:canvas", "A.canvas", "{ not json"), null);
  assert.equal(check("core:bases", "A.base", baseText), null);
  assert.notEqual(check("core:bases", "A.base", "views: [unterminated"), null);
  assert.equal(check("view:probe-text", "A.probeedit", "x"), null);
  assert.match(check("view:probe-text", "A.other", "x"), /not registered/);
  assert.equal(check(undefined, "A.md", "x"), null);
});

test("reviewed replace keeps unknown Canvas JSON and BOM, is version guarded and refuses invalid, read-only and live-owned targets", async () => {
  const existing = { content: "{}", hasBom: true };
  const v = vault(new Map([["Boards/Plan.canvas", existing]]));
  const { store, record } = await orphan(input({ baseVersion: v.versionOf(existing), hasBom: true }));
  const app = { workspace: { viewTypeForExtension: () => null } };
  const options = { validate: item => providers.validateDraftForReplace(app, item), liveOwner: () => "live" };
  const live = await model.applyRecovery(store, v, record, { kind: "replace" }, options);
  assert.equal(live.ok, false); assert.equal(v.writes.length, 0);
  const ro = await model.applyRecovery(store, vault(v.files, { readOnly: true }), record, { kind: "replace" }, { ...options, liveOwner: () => null });
  assert.equal(ro.ok, false);
  const invalid = await orphan(input({ baseVersion: v.versionOf(existing), content: "{ bad" }));
  assert.equal((await model.applyRecovery(invalid.store, v, invalid.record, { kind: "replace" }, { ...options, liveOwner: () => null })).ok, false);
  assert.equal(v.writes.length, 0); assert.equal((await store.list()).drafts.length, 1);
  const ok = await model.applyRecovery(store, v, record, { kind: "replace" }, { ...options, liveOwner: () => null });
  assert.equal(ok.ok, true);
  assert.equal(v.files.get("Boards/Plan.canvas").content, canvasText); assert.equal(v.files.get("Boards/Plan.canvas").hasBom, true);
  assert.deepEqual(JSON.parse(v.files.get("Boards/Plan.canvas").content).future, { keep: [1, null] });
  assert.equal((await store.list()).drafts.length, 0);
});

test("create-only recovery writes the right extension, refuses the wrong one and never overwrites", async () => {
  const v = vault(new Map([["Boards/Plan.canvas", { content: "{}", hasBom: false }], ["Taken.canvas", { content: "x", hasBom: false }]]));
  const { store, record } = await orphan(input({ baseVersion: "stale" }));
  for (const path of ["Taken.canvas", "Recovered.md", "Recovered.base", "Recovered"]) {
    assert.equal((await model.applyRecovery(store, v, record, { kind: "create", path })).ok, false, path);
  }
  assert.equal(v.writes.length, 0);
  const ok = await model.applyRecovery(store, v, record, { kind: "create", path: "Recovered/Plan.canvas" });
  assert.equal(ok.ok, true); assert.equal(v.files.get("Recovered/Plan.canvas").content, canvasText);
  assert.equal(v.files.get("Boards/Plan.canvas").content, "{}");
  assert.equal((await store.list()).drafts.length, 0);
});

test("a live view that turns dirty during the awaited source read blocks the write and keeps the draft", async () => {
  const existing = { content: "{}", hasBom: false };
  const v = vault(new Map([["Boards/Plan.canvas", existing]]));
  const { store, record } = await orphan(input({ baseVersion: v.versionOf(existing) }));
  let dirty = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const read = v.readDocument.bind(v);
  v.readDocument = async path => { const result = await read(path); await gate; return result; };
  const pending = model.applyRecovery(store, v, record, { kind: "replace" }, { liveOwner: () => dirty ? "live" : null });
  await Promise.resolve(); dirty = true; release();
  const outcome = await pending;
  assert.equal(outcome.ok, false); assert.equal(v.writes.length, 0); assert.equal(v.files.get("Boards/Plan.canvas").content, "{}");
  assert.equal((await store.list()).drafts.length, 1);
});

test("owners whose serializer failed or that are deferred count as unconfirmed and block replacement", () => {
  const mk = snapshot => ({ vault: { rootPath: ROOT }, rootPath: ROOT, workspace: { sessions: new Map(), leaves: () => [{ view: { draftRecoveryProvider: "core:canvas", file: { path: "A.canvas" }, captureDraft: () => ({ provider: "core:canvas", saving: false, path: "A.canvas", root: ROOT, text: "", version: "v", hasBom: false, ...snapshot }) } }] } });
  const record = { vaultRoot: ROOT, path: "A.canvas" };
  assert.match(owners.liveDirtyOwner(mk({ state: "error", error: "isDirty threw" }), record), /could not confirm/);
  assert.match(owners.liveDirtyOwner(mk({ state: "busy" }), record), /unsaved/);
  assert.equal(owners.liveDirtyOwner(mk({ state: "clean" }), record), null);
});

test("startup notice keeps the Markdown wording for Markdown-only orphans and is neutral for Canvas, Bases and mixed records", () => {
  const exact = " were recovered from a previous session. ";
  assert.equal(model.recoveredNoticeText([undefined, undefined]), "2 unsaved Markdown draft(s)" + exact);
  assert.equal(model.recoveredNoticeText(["core:canvas"]), "1 unsaved draft(s)" + exact);
  assert.equal(model.recoveredNoticeText(["core:bases", "core:bases"]), "2 unsaved draft(s)" + exact);
  assert.equal(model.recoveredNoticeText([undefined, "core:canvas"]), "2 unsaved draft(s)" + exact);
});

test("uppercase plugin extensions are recoverable under their original filename", async () => {
  const input2 = input({ path: "Data/Note.TXT", provider: "view:plugin", content: "text", baseVersion: "stale" });
  assert.equal(model.draftExtension("view:plugin", "Data/Note.TXT"), ".TXT");
  assert.equal(model.validateRecoveryDestination("Data/Note (recovered).TXT", ".TXT"), "Data/Note (recovered).TXT");
  assert.equal(model.validateRecoveryDestination("Data/Note (recovered).txt", ".TXT"), "Data/Note (recovered).txt");
  const v = vault(new Map());
  const { store, record } = await orphan(input2);
  const suggested = model.suggestRecoveryPath(record.path, () => false);
  assert.ok(suggested.endsWith(".TXT"));
  assert.equal((await model.applyRecovery(store, v, record, { kind: "create", path: suggested })).ok, true);
  assert.equal(v.files.get(suggested).content, "text");
  const app = { workspace: { viewTypeForExtension: extension => extension === "txt" ? "plugin" : null } };
  assert.equal(providers.validateDraftForReplace(app, record), null);
});
