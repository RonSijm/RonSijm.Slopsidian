import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, before, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "fold-state-storage-tests-"));
  const outfile = join(directory, "storage.mjs");
  await build({ entryPoints: [join(root, "client/fold-state-storage.ts")], outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  feature = await import(pathToFileURL(outfile).href);
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/fold-state-storage-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
function fixture() {
  const values = new Map(); let root = "vault-A", busy = false, reads = 0, writes = 0, errors = 0, denied = false;
  const backend = { root: () => root, busy: () => busy, load: () => { reads++; if (denied) throw Error("denied"); return structuredClone(values.get(root) ?? null); }, save: value => { if (denied) throw Error("quota"); writes++; values.set(root, structuredClone(value)); }, onError: () => { errors++; } };
  return { values, backend, port: kind => feature.createFoldStatePort(backend, kind), root: value => { root = value; }, busy: value => { busy = value; }, denied: value => { denied = value; }, counts: () => ({ reads, writes, errors }) };
}
const source = "\ufeff# Title λ\r\nBody 😀\r\n- Parent\r\n  - Child\r\n";
test("source identity matches independent UTF16LE SHA256 and distinguishes BOM, line endings and lone surrogates", () => {
  for (const text of [source, "", "\ud800", "\ud801", "\ufffd"]) assert.equal(feature.foldSourceHash(text), createHash("sha256").update(Buffer.from(text, "utf16le")).digest("hex"));
  assert.notEqual(feature.foldSourceHash(source), feature.foldSourceHash(source.replaceAll("\r\n", "\n")));
  assert.notEqual(feature.foldSourceHash("\ud800"), feature.foldSourceHash("\ud801"));
});
test("independent channels survive new ports while source/path/root changes refuse restoration", () => {
  const f = fixture();
  assert.equal(f.port("editor").save("Notes/A.md", source, [{ from: 12, to: 20 }]), true);
  assert.equal(f.port("reading-headings").save("Notes/A.md", source, [0]), true);
  assert.equal(f.port("reading-lists").save("Notes/A.md", source, [2]), true);
  assert.equal(f.port("reading-callouts").save("Notes/A.md", source, [3]), true);
  assert.deepEqual(f.port("editor").load("Notes/A.md", source), [{ from: 12, to: 20 }]);
  assert.deepEqual(f.port("reading-headings").load("Notes/A.md", source), [0]);
  assert.deepEqual(f.port("reading-callouts").load("Notes/A.md", source), [3]);
  assert.equal(f.port("editor").load("Notes/B.md", source), null);
  assert.equal(f.port("editor").load("Notes/A.md", source.replace("Body", "body")), null);
  const old = f.port("editor"); f.root("vault-B");
  assert.equal(old.load("Notes/A.md", source), null); assert.equal(old.save("Notes/A.md", source, []), false);
  assert.equal(f.port("editor").load("Notes/A.md", source), null); assert.equal(f.values.has("vault-B"), false);
});
test("explicit expansion replaces old collapse and returned arrays are detached", () => {
  const f = fixture(), p = f.port("reading-lists"), value = [2];
  p.save("A.md", source, value); value.push(3);
  const loaded = p.load("A.md", source); loaded.push(4);
  assert.deepEqual(p.load("A.md", source), [2]);
  p.save("A.md", source, []); assert.deepEqual(f.port("reading-lists").load("A.md", source), []);
});
test("invalid paths, oversized source and malformed payloads never write preferences", () => {
  const f = fixture(), p = f.port("editor");
  for (const path of ["", "../A.md", "A/../B.md", "/A.md", "C:/A.md", "A\\B.md", "A\0.md"]) assert.equal(p.save(path, source, []), false);
  assert.equal(p.save("A.md", "x".repeat(feature.MAX_FOLD_SOURCE + 1), []), false);
  for (const value of [[{ from: 2, to: 1 }], [{ from: 0, to: source.length + 1 }], [{ from: 1.5, to: 2 }], [null], Array.from({ length: 513 }, () => ({ from: 1, to: 2 }))]) assert.equal(p.save("A.md", source, value), false);
  assert.equal(f.port("reading-headings").save("A.md", source, [0, 0]), false);
  assert.equal(f.counts().writes, 0);
});
test("corrupt catalog cannot provide fold ranges and a fresh user action recovers only its own record", () => {
  const f = fixture(), p = f.port("editor"); f.values.set("vault-A", { version: 1, records: [{ channel: "editor", path: "A.md", source: feature.foldSourceHash(source), length: source.length, value: [{ from: 0, to: 999999 }] }] });
  assert.equal(p.load("A.md", source), null); assert.equal(f.counts().writes, 0);
  assert.equal(p.save("A.md", source, [{ from: 1, to: 2 }]), true);
  assert.deepEqual(p.load("A.md", source), [{ from: 1, to: 2 }]);
});
test("storage denial and changing-vault state do not throw or perform document operations", () => {
  const f = fixture(), p = f.port("editor"); f.denied(true);
  assert.equal(p.load("A.md", source), null); assert.equal(p.save("A.md", source, []), false); assert.equal(f.counts().errors, 1);
  f.denied(false); f.busy(true); const reads = f.counts().reads;
  assert.equal(p.load("A.md", source), null); assert.equal(p.save("A.md", source, []), false); assert.equal(f.counts().reads, reads + 1);
});
test("bounded eviction retains most recent actions without storing note bodies", () => {
  const f = fixture(), p = f.port("reading-headings");
  for (let index = 0; index <= feature.MAX_FOLD_RECORDS; index++) p.save(`Notes/${index}.md`, source, [0]);
  assert.equal(p.load("Notes/0.md", source), null); assert.deepEqual(p.load(`Notes/${feature.MAX_FOLD_RECORDS}.md`, source), [0]);
  const catalog = f.values.get("vault-A"); assert.equal(catalog.records.length, feature.MAX_FOLD_RECORDS); assert.ok(Buffer.byteLength(JSON.stringify(catalog)) <= feature.MAX_FOLD_STORAGE_BYTES); assert.equal(JSON.stringify(catalog).includes("Body"), false);
});
test("confirmed renames move all independent preferences and retire the old path without replaying changed source", () => {
  const f = fixture();
  for (const channel of ["editor", "reading-headings", "reading-lists", "reading-callouts"]) f.port(channel).save("Old/A.md", source, channel === "editor" ? [{ from: 1, to: 2 }] : [0]);
  f.port("reading-headings").save("New/A.md", source, [2]);
  f.busy(true); assert.equal(feature.moveFoldState(f.backend, "Old/A.md", "New/A.md"), true); f.busy(false);
  assert.equal(f.port("editor").load("Old/A.md", source), null);
  assert.deepEqual(f.port("editor").load("New/A.md", source), [{ from: 1, to: 2 }]);
  assert.deepEqual(f.port("reading-headings").load("New/A.md", source), [0]);
  assert.equal(f.port("reading-lists").load("New/A.md", source.replace("Body", "body")), null);
  assert.equal(feature.moveFoldState(f.backend, "New/A.md", "../Outside.md"), false);
});
test("a moved note with no saved folds cannot inherit an earlier destination file's preferences", () => {
  const f = fixture(); f.port("reading-headings").save("Destination.md", source, [0]);
  assert.equal(feature.moveFoldState(f.backend, "No profile.md", "Destination.md"), true);
  assert.equal(f.port("reading-headings").load("Destination.md", source), null);
  assert.equal(feature.moveFoldState(f.backend, "No profile.md", "Unused.md"), false);
});
