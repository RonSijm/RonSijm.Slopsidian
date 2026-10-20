import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, startHost } from "./host.mjs";

let temporary, RecoveryHistory, recoveryPath, recoveryOptions;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "recovery-tests-"));
  const entry = join(temporary, "recovery.mjs");
  await build({ stdin: { contents: 'export * from "./client/recovery-model";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ RecoveryHistory, recoveryPath, recoveryOptions } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });
const input = (content = "First\r\n", extra = {}) => ({ path: "Notes/Note.md", content, hasBom: true, sourceVersion: "a".repeat(64), reason: "auto", ...extra });

test("recovery keeps exact saved text, BOM metadata, opaque fields and equal-time version order without mutating input", () => {
  const data = { future: { retained: [42, true] } }, history = new RecoveryHistory(data);
  assert.equal(history.capture(input("λ, 中文 and 😀\r\n"), 1000, 5, false, "one"), "added");
  history.snapshots[0].future = { native: ["opaque"] };
  assert.equal(history.capture(input("Second\r\n", { path: "Canvas.canvas" }), 1000, 0, true, "two"), "added");
  const restored = new RecoveryHistory(JSON.parse(JSON.stringify(history.data)));
  assert.deepEqual(data, { future: { retained: [42, true] } });
  assert.equal(restored.latest("Notes/Note.md").content, "λ, 中文 and 😀\r\n");
  assert.equal(restored.latest("Notes/Note.md").hasBom, true);
  assert.deepEqual(restored.latest("Notes/Note.md").future, { native: ["opaque"] });
  assert.deepEqual(restored.newest().map(item => item.id), ["two", "one"]);
  assert.deepEqual(restored.data.future, data.future);
});

test("recovery intervals defer changes, deduplicate identical bytes, honor due boundaries and allow explicit snapshots", () => {
  const history = new RecoveryHistory({});
  assert.equal(history.capture(input(), 1000, 5, false, "a"), "added");
  assert.equal(history.capture(input("Changed\n"), 300999, 5, false, "b"), "waiting");
  assert.equal(history.capture(input("Changed\n"), 301000, 5, false, "b"), "added");
  assert.equal(history.capture(input("Changed\n", { sourceVersion: "b".repeat(64) }), 302000, 5, true, "c"), "unchanged");
  assert.equal(history.capture(input("Manual\n"), 302000, 5, true, "c"), "added");
  assert.equal(history.capture(input("BOM changed\n", { hasBom: false }), 302000, 0, false, "d"), "added");
  assert.equal(history.capture(input("BOM changed\n", { hasBom: true }), 302000, 0, false, "e"), "added");
  assert.equal(history.capture(input("Clock moved back"), 2000, 5, false, "f"), "waiting");
  assert.equal(history.snapshots.length, 5);
});

test("recovery retention removes only expired versions, including deleted paths, while retaining boundary and future records", () => {
  const day = 86400000, now = 10 * day, history = new RecoveryHistory({ unknown: "keep" });
  for (const [id, ts, path] of [["expired", 2 * day - 1, "Deleted.md"], ["boundary", 2 * day, "Present.md"], ["new", now, "New.base"], ["future", now + day, "Future.md"]]) { history.capture(input(id, { path }), ts, 0, true, id); }
  assert.equal(history.prune(now, 8), 1);
  assert.deepEqual(history.newest().map(item => item.id), ["future", "new", "boundary"]);
  assert.equal(history.prune(now, 8), 0);
  assert.equal(history.data.unknown, "keep");
  for (const bad of [0, -1, Infinity, NaN, 3651]) { assert.throws(() => history.prune(now, bad)); }
});

test("unsafe recovery paths, malformed/future history and duplicate IDs fail without clearing existing data", () => {
  for (const path of ["", "/Root.md", "../Outside.md", ".obsidian/Secret.md", "A/../B.md", "A\\B.md", "CON.md", "A./B.md", "file.txt", "image.png", "A//B.md", "A\u0000.md"]) { assert.throws(() => recoveryPath(path), path); }
  for (const path of ["A.md", "Folder/Note.CANVAS", "Catalog.base"]) { assert.equal(recoveryPath(path), path); }
  const valid = new RecoveryHistory({}); valid.capture(input(), 100, 0, false, "a");
  for (const data of [{ version: 2, snapshots: [] }, { version: 1 }, { version: 1, snapshots: [null] }, { ...valid.data, snapshots: [valid.snapshots[0], valid.snapshots[0]] }, { ...valid.data, snapshots: [{ ...valid.snapshots[0], ts: -1 }] }, { ...valid.data, snapshots: [{ ...valid.snapshots[0], sourceVersion: "invalid" }] }]) {
    const original = JSON.stringify(data);
    assert.throws(() => new RecoveryHistory(data));
    assert.equal(JSON.stringify(data), original);
  }
});

test("recovery refuses capacity/UTF-8 overflows without evicting recent versions or changing retained history", () => {
  const history = new RecoveryHistory({});
  assert.throws(() => history.capture(input("😀".repeat(262145)), 100, 0), /1 MiB/);
  for (let index = 0; index < 1000; index++) { history.capture(input(String(index)), index, 0, true, "id_" + index); }
  const before = JSON.stringify(history.data);
  assert.throws(() => history.capture(input("Overflow"), 1001, 0), /full/);
  assert.equal(JSON.stringify(history.data), before);
  assert.throws(() => new RecoveryHistory({ future: "x".repeat(32 * 1024 * 1024 + 1) }), /32 MiB/);
});

test("recovery numeric settings retain reference defaults and reject coercion, nonfinite values and out-of-range settings", () => {
  assert.deepEqual(recoveryOptions({}), { intervalMinutes: 5, keepDays: 7 });
  assert.deepEqual(recoveryOptions({ intervalMinutes: 0.5, keepDays: 1 }), { intervalMinutes: 0.5, keepDays: 1 });
  for (const data of [{ intervalMinutes: "5" }, { intervalMinutes: -1 }, { intervalMinutes: NaN }, { intervalMinutes: 10081 }, { keepDays: 0 }, { keepDays: Infinity }, { keepDays: 3651 }]) { assert.throws(() => recoveryOptions(data)); }
});

test("native recovery history is version/root guarded, preserves unknown data/BOM and survives complete host restarts", async t => {
  const directory = await mkdtemp(join(temporary, "vault-"));
  await mkdir(join(directory, ".obsidian"));
  const path = join(directory, ".obsidian", "vault-dotnet-recovery.json"), note = join(directory, "Note.md");
  await writeFile(note, "\ufeff# Preserve\r\n");
  const original = { version: 1, snapshots: [], future: { keep: true } };
  await writeFile(path, "\ufeff" + JSON.stringify(original));
  let host = await startHost(directory);
  t.after(() => host.stop());
  const url = "/api/configuration/vault-dotnet-recovery?root=" + encodeURIComponent(directory);
  const initial = await (await host.request(url)).json();
  assert.deepEqual(initial.data, original);
  assert.equal((await (await host.request("/api/file?path=Note.md")).json()).hasBom, true);
  const data = new RecoveryHistory(initial.data); data.capture(input(), Date.now(), 0);
  const saved = await host.request("/api/configuration/vault-dotnet-recovery", "PUT", { root: directory, version: initial.version, data: data.data });
  assert.equal(saved.status, 200);
  const bytes = await readFile(path);
  assert.ok(bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])));
  for (const [root, version] of [[directory, initial.version], ["C:/OtherVault", (await saved.json()).version]]) {
    assert.equal((await host.request("/api/configuration/vault-dotnet-recovery", "PUT", { root, version, data: {} })).status, 409);
    assert.deepEqual(await readFile(path), bytes);
  }
  await host.stop(); host = await startHost(directory);
  assert.deepEqual((await (await host.request(url)).json()).data, data.data);
});

test("native recovery settings use numeric values, retain unknown options and reject invalid updates without changing bytes", async t => {
  const directory = await mkdtemp(join(temporary, "settings-")); await mkdir(join(directory, ".obsidian"));
  const path = join(directory, ".obsidian", "file-recovery.json");
  await writeFile(path, '{"future":{"keep":true}}');
  const host = await startHost(directory); t.after(() => host.stop());
  assert.equal((await host.request("/api/core/file-recovery/settings", "PUT", { root: directory, values: { intervalMinutes: 0.25, keepDays: 3 } })).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { future: { keep: true }, intervalMinutes: 0.25, keepDays: 3 });
  const before = await readFile(path);
  for (const values of [{ intervalMinutes: "5" }, { intervalMinutes: -1 }, { keepDays: 0 }, { keepDays: 3651 }, { intervalMinutes: 10081 }]) {
    assert.equal((await host.request("/api/core/file-recovery/settings", "PUT", { root: directory, values })).status, 400);
    assert.deepEqual(await readFile(path), before);
  }
});
