import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["client/markdown-autosave.ts"], bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
const { MarkdownAutosave } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture(preference) {
  let now = 0, next = 0;
  const timers = new Map(), writes = [], settings = { opaque: { retained: "中文" }, ...(preference === undefined ? {} : { markdownAutosave: preference }) };
  const app = {
    commands: { install() {} }, changingVault: false, vault: { rootPath: "vault-A" },
    workspace: { sessions: new Map(), isChangingFiles: false, isChangingLayout: false },
    configuration: { get: (_file, key) => settings[key], update: async (_file, change) => { change(settings); } },
  };
  const service = new MarkdownAutosave(app, { now: () => now, set: (callback, delay) => { timers.set(++next, { callback, at: now + delay }); return next; }, clear: id => timers.delete(id) });
  const add = (path = "Note.md") => {
    const session = { originRoot: app.vault.rootPath, document: { file: { path }, content: "Original", version: "v1" }, text: "Original", dirty: false, isSaving: false, isReloading: false,
      async save(automatic) { writes.push({ path, text: this.text, automatic }); this.document.content = this.text; this.dirty = false; },
    };
    app.workspace.sessions.set(path, session); return session;
  };
  const edit = (session, text) => { session.text = text; session.dirty = text !== session.document.content; service.changed(session); };
  const advance = async duration => {
    const target = now + duration;
    for (;;) {
      const job = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!job) { break; }
      now = job[1].at; timers.delete(job[0]); job[1].callback(); await settle();
    }
    now = target; await settle();
  };
  service.configure(); return { app, service, settings, writes, add, edit, advance, timers };
}

test("Markdown autosave defaults on without writing configuration; pause/invalid preferences are respected", async () => {
  for (const [value, enabled] of [[undefined, true], [true, true], [false, false], ["true", false]]) {
    const f = fixture(value), s = f.add();
    assert.equal(f.service.enabled, enabled); assert.equal(Boolean(f.service.settingError), value === "true");
    assert.equal(f.settings.markdownAutosave, value);
    f.edit(s, "Draft"); await f.advance(2000); assert.equal(f.writes.length, enabled ? 1 : 0);
  }
});

test("Typing debounces to two seconds and repeated shared-session notifications produce one write", async () => {
  const f = fixture(), s = f.add();
  f.edit(s, "First"); await f.advance(1500); f.edit(s, "Second"); f.service.changed(s);
  await f.advance(1999); assert.equal(f.writes.length, 0);
  await f.advance(1); assert.deepEqual(f.writes, [{ path: "Note.md", text: "Second", automatic: true }]);
  assert.equal(f.service.dirtyCount, 0); assert.equal(f.timers.size, 0);
});

test("Continuous edits are persisted after ten seconds even without an idle interval", async () => {
  const f = fixture(), s = f.add(); f.edit(s, "0");
  for (let i = 1; i < 10; i++) { await f.advance(1000); f.edit(s, String(i)); }
  assert.equal(f.writes.length, 0); await f.advance(1000);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].text, "9");
  f.edit(s, "Later"); await f.advance(2000); assert.equal(f.writes.at(-1).text, "Later");
});

test("Separate notes save independently; undoing to saved text cancels only that note", async () => {
  const f = fixture(), a = f.add("A.md"), b = f.add("B.md");
  f.edit(a, "Draft A"); f.edit(b, "Draft B"); await f.advance(1000); f.edit(a, "Original");
  await f.advance(2000); assert.deepEqual(f.writes.map(value => value.path), ["B.md"]); assert.equal(f.service.dirtyCount, 0);
});

test("An in-flight explicit save blocks autosave; a clean acknowledgement cancels the queued write", async () => {
  const f = fixture(), s = f.add(); s.isSaving = true; f.edit(s, "Draft");
  await f.advance(5000); assert.equal(f.writes.length, 0);
  s.document.content = s.text; s.dirty = false; s.isSaving = false; f.service.saved(s); f.service.changed(s);
  await f.advance(10000); assert.equal(f.writes.length, 0);
});

test("File mutations, layout changes and reloads defer automatic writes until their barrier ends", async () => {
  for (const [owner, key] of [["workspace", "isChangingFiles"], ["workspace", "isChangingLayout"], ["session", "isReloading"]]) {
    const f = fixture(), s = f.add(), target = owner === "workspace" ? f.app.workspace : s;
    target[key] = true; f.edit(s, "Deferred"); await f.advance(5000); assert.equal(f.writes.length, 0);
    target[key] = false; await f.advance(250); assert.equal(f.writes[0].text, "Deferred");
  }
});

test("A save failure retains the draft and stops retries through later edits, until explicit success", async () => {
  const f = fixture(), s = f.add(); let attempts = 0;
  s.save = async () => { attempts++; throw new Error("External version changed"); };
  f.edit(s, "Kept draft"); await f.advance(2000); assert.equal(attempts, 1);
  assert.equal(s.text, "Kept draft"); assert.equal(s.dirty, true); assert.match(f.service.errors()[0].message, /External version/);
  f.edit(s, "Later draft"); await f.advance(60000); assert.equal(attempts, 1);
  s.save = async () => { s.document.content = s.text; s.dirty = false; f.service.saved(s); f.service.changed(s); };
  await s.save(); assert.equal(f.service.errors().length, 0);
  f.edit(s, "Resumed"); await f.advance(2000); assert.equal(s.document.content, "Resumed");
});

test("Reload/undo to clean clears a failed note without retrying or writing stale text", async () => {
  const f = fixture(), s = f.add(); f.edit(s, "Draft"); f.service.failed(s, new Error("Denied"));
  f.edit(s, "Original"); await f.advance(10000);
  assert.equal(f.service.errors().length, 0); assert.equal(f.writes.length, 0);
});

test("Root and session ownership changes invalidate pending timers", async () => {
  for (const change of [f => { f.app.vault.rootPath = "vault-B"; }, (f, s) => { f.app.workspace.sessions.set(s.document.file.path, { ...s }); }]) {
    const f = fixture(), s = f.add(); f.edit(s, "Old root draft"); change(f, s); await f.advance(10000);
    assert.equal(f.writes.length, 0); assert.equal(f.timers.size, 0); assert.equal(s.dirty, true);
  }
});

test("Suspension waits for a started save and prevents another automatic write until resumed", async () => {
  const f = fixture(), s = f.add(), gate = deferred(); let attempts = 0, drained = false;
  s.save = async () => { attempts++; await gate.promise; };
  f.edit(s, "Pending"); await f.advance(2000); assert.equal(attempts, 1);
  const waiting = f.service.suspend().then(() => { drained = true; }); await settle(); assert.equal(drained, false);
  gate.resolve(); await waiting; await f.advance(20000); assert.equal(attempts, 1);
  s.save = async () => { attempts++; s.dirty = false; }; f.service.resume(); await f.advance(2000); assert.equal(attempts, 2);
});

test("Pause/resume persists only the owned setting and reschedules retained dirty text", async () => {
  const f = fixture(), s = f.add(); f.edit(s, "Unsaved"); await f.service.setEnabled(false); await f.advance(10000);
  assert.equal(f.writes.length, 0); assert.equal(f.settings.markdownAutosave, false); assert.deepEqual(f.settings.opaque, { retained: "中文" });
  await f.service.setEnabled(true); await f.advance(2000); assert.equal(f.writes[0].text, "Unsaved"); assert.equal(f.settings.markdownAutosave, true);
});

test("Preference failure pauses locally, retains dirty text and supports an explicit preference retry", async () => {
  const f = fixture(), s = f.add(), update = f.app.configuration.update;
  f.app.configuration.update = async () => { throw new Error("Permission revoked"); };
  f.edit(s, "Keep"); await assert.rejects(f.service.setEnabled(false), /Permission revoked/); await f.advance(10000);
  assert.equal(f.service.enabled, false); assert.equal(f.service.pendingPreference, false); assert.match(f.service.settingError, /paused/);
  assert.equal(s.dirty, true); assert.equal(f.settings.markdownAutosave, undefined); assert.equal(f.writes.length, 0);
  f.app.configuration.update = update; await f.service.setEnabled(false); assert.equal(f.service.settingError, ""); assert.equal(f.settings.markdownAutosave, false);
});

test("Transitions drain an accepted preference write before changing roots", async () => {
  const f = fixture(), gate = deferred(); let drained = false;
  f.app.configuration.update = async (_file, change) => { await gate.promise; change(f.settings); };
  const updating = f.service.setEnabled(false); const leaving = f.service.suspend().then(() => { drained = true; });
  await settle(); assert.equal(drained, false); gate.resolve(); await updating; await leaving;
  f.app.vault.rootPath = "vault-B"; f.service.configure(); assert.equal(f.service.errors().length, 0);
});

test("The empty vault chooser initializes without reading a nonexistent vault configuration", () => {
  const f = fixture(); f.app.vault.rootPath = null;
  f.app.configuration.get = () => { throw new Error("No selected vault"); };
  f.service.configure(); assert.equal(f.service.dirtyCount, 0); assert.equal(f.service.enabled, true);
});

test("A root changed outside orderly transition cannot receive an old preference after a pending save", async () => {
  const f = fixture(), s = f.add(), gate = deferred(); let settingsWrites = 0;
  s.save = () => gate.promise; f.edit(s, "Draft"); await f.advance(2000);
  f.app.configuration.update = async () => { settingsWrites++; };
  const pending = f.service.setEnabled(false); f.app.vault.rootPath = "vault-B"; gate.resolve();
  await assert.rejects(pending, /vault changed/); assert.equal(settingsWrites, 0); assert.equal(s.dirty, true);
});

test("Save failure text exposes the host's reason without JSON or transport prefixes", async () => {
  const output = await build({ stdin: { contents: 'export { markdownSaveError } from "./client/markdown-autosave"; export { HostError } from "./client/contracts";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
  const { markdownSaveError, HostError } = await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].contents).toString("base64"));
  assert.equal(markdownSaveError(new HostError(409, '{"error":"This file changed on disk."}')), "This file changed on disk.");
  assert.equal(markdownSaveError(new HostError(403, "Permission revoked")), "Permission revoked");
  assert.equal(markdownSaveError(new Error("Offline")), "Offline");
});
