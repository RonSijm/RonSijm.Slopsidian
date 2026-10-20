import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { root, startHost } from "./host.mjs";

const version = bytes => createHash("sha256").update(bytes).digest("hex");
const diskPath = (app, path) => join(app.directory, ...path.split("/"));

async function fixture(t) {
  await mkdir(join(root, ".runtime"), { recursive: true });
  const directory = await mkdtemp(join(root, ".runtime", "folder-api-"));
  let host;
  t.after(async () => {
    try { if (host) { await host.stop(); } } finally { await rm(directory, { recursive: true, force: true }); }
  });
  await mkdir(join(directory, ".obsidian"));
  host = await startHost(directory);
  return { directory, request: (...args) => host.request(...args) };
}

async function put(app, path, content) {
  const destination = diskPath(app, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function json(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

const exists = path => stat(path).then(() => true, () => false);
const manifest = files => Object.entries(files).map(([path, bytes]) => ({ path, version: version(bytes) }));

const binary = Buffer.from([0, 255, 1, 254, 0, 13, 10, 0x1a]);
const note = Buffer.from("\ufeffNote\r\nwith [[Other]]\r\n", "utf8");

async function populate(app) {
  const files = { "Projects/a.md": note, "Projects/Deep/b.bin": binary, "Projects/Deep/Deeper/c.md": Buffer.from("c") };
  for (const [path, bytes] of Object.entries(files)) { await put(app, path, bytes); }
  await mkdir(diskPath(app, "Projects/EmptyFolder"));
  return files;
}

test("folder rename preserves exact bytes, empty folders and reports descendant moves", async t => {
  const app = await fixture(t);
  const files = await populate(app);
  const result = await json(await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "Projects", newPath: "Work/Archive", manifest: manifest(files) }));
  assert.equal(result.oldPath, "Projects");
  assert.equal(result.newPath, "Work/Archive");
  assert.deepEqual(result.files.map(file => file.newPath).sort(), ["Work/Archive/Deep/Deeper/c.md", "Work/Archive/Deep/b.bin", "Work/Archive/a.md"].sort());
  assert.ok(result.snapshot.folders.includes("Work/Archive/EmptyFolder"));
  assert.equal(await exists(diskPath(app, "Projects")), false);
  for (const [path, bytes] of Object.entries(files)) {
    assert.deepEqual(await readFile(diskPath(app, path.replace("Projects/", "Work/Archive/"))), bytes);
  }
  assert.deepEqual(await readdir(diskPath(app, ".obsidian")).then(entries => entries.filter(name => name.includes("transactions"))), []);
});

test("folder rename supports case-only renames", async t => {
  const app = await fixture(t);
  const files = await populate(app);
  const result = await json(await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "Projects", newPath: "projects", manifest: manifest(files) }));
  assert.equal(result.newPath, "projects");
  assert.ok((await readdir(app.directory)).includes("projects"));
  assert.deepEqual(await readFile(diskPath(app, "projects/Deep/b.bin")), binary);
});

test("folder rename refuses occupied destinations, self moves, stale manifests and hidden entries", async t => {
  const app = await fixture(t);
  const files = await populate(app);
  await put(app, "Taken/x.md", "x");
  const base = { root: app.directory, path: "Projects", manifest: manifest(files) };
  await json(await app.request("/api/files/folders/rename", "POST", { ...base, newPath: "Taken" }), 409);
  await json(await app.request("/api/files/folders/rename", "POST", { ...base, newPath: "Projects/Inside" }), 409);
  await json(await app.request("/api/files/folders/rename", "POST", { ...base, newPath: "Projects" }), 400);
  await json(await app.request("/api/files/folders/rename", "POST", { ...base, newPath: "Moved", manifest: manifest(files).slice(1) }), 409);
  await json(await app.request("/api/files/folders/rename", "POST", { ...base, newPath: "Moved", manifest: null }), 428);
  await put(app, "Projects/a.md", "changed externally");
  await json(await app.request("/api/files/folders/rename", "POST", { ...base, newPath: "Moved" }), 409);
  await put(app, "Projects/a.md", note);
  await put(app, "Projects/.hidden", "h");
  await json(await app.request("/api/files/folders/rename", "POST", { ...base, newPath: "Moved" }), 409);
  assert.equal(await exists(diskPath(app, "Moved")), false);
  assert.deepEqual(await readFile(diskPath(app, "Projects/Deep/b.bin")), binary);
  await json(await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "", newPath: "Everything", manifest: [] }), 400);
});

test("folder rename applies reference edits outside the folder and reverts them when the move fails", async t => {
  const app = await fixture(t);
  const files = await populate(app);
  const outside = Buffer.from("see [[Projects/a]]");
  await put(app, "Outside.md", outside);
  const edit = { path: "Outside.md", version: version(outside), content: "see [[Moved/a]]" };
  const bad = await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "Projects", newPath: "Moved", manifest: manifest(files), edits: [{ ...edit, path: "Projects/a.md" }] });
  assert.ok(bad.status >= 400);
  assert.deepEqual(await readFile(diskPath(app, "Outside.md")), outside);
  const result = await json(await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "Projects", newPath: "Moved", manifest: manifest(files), edits: [edit] }));
  assert.equal(result.documents[0].content, "see [[Moved/a]]");
  assert.equal(await readFile(diskPath(app, "Outside.md"), "utf8"), "see [[Moved/a]]");

  // A destination appearing through a blocked parent path must revert the edits.
  const blocked = Buffer.from("see [[Moved/a]]");
  await put(app, "Blocker", "file");
  const failed = await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "Moved", newPath: "Blocker/Child", manifest: manifest({ "Moved/a.md": note, "Moved/Deep/b.bin": binary, "Moved/Deep/Deeper/c.md": Buffer.from("c") }), edits: [{ path: "Outside.md", version: version(blocked), content: "see [[Blocker/Child/a]]" }] });
  assert.ok(failed.status >= 400);
  assert.deepEqual(await readFile(diskPath(app, "Outside.md")), blocked);
});

test("folder delete removes the exact manifest, refuses root and stale or unknown content", async t => {
  const app = await fixture(t);
  const files = await populate(app);
  await json(await app.request("/api/files/folders/delete", "POST", { root: app.directory, path: "", manifest: [] }), 403);
  await json(await app.request("/api/files/folders/delete", "POST", { root: app.directory, path: "Projects", manifest: null }), 428);
  await json(await app.request("/api/files/folders/delete", "POST", { root: app.directory, path: "Projects", manifest: manifest(files).slice(1) }), 409);
  await put(app, "Projects/Deep/b.bin", Buffer.from([9]));
  await json(await app.request("/api/files/folders/delete", "POST", { root: app.directory, path: "Projects", manifest: manifest(files) }), 409);
  assert.deepEqual(await readFile(diskPath(app, "Projects/a.md")), note);
  await put(app, "Projects/Deep/b.bin", binary);
  const result = await json(await app.request("/api/files/folders/delete", "POST", { root: app.directory, path: "Projects", manifest: manifest(files) }));
  assert.equal(result.path, "Projects");
  assert.equal(result.deletedFiles.length, 3);
  assert.ok(result.deletedFolders.includes("Projects"));
  assert.equal(await exists(diskPath(app, "Projects")), false);
  assert.deepEqual(result.snapshot.folders, []);
  assert.ok(await exists(app.directory));
});

test("modifyBinary replaces bytes only when the version still matches", async t => {
  const app = await fixture(t);
  await put(app, "img.bin", binary);
  const replacement = Buffer.from([1, 2, 3, 0, 255]);
  await json(await app.request("/api/binary", "PUT", { root: app.directory, path: "img.bin", base64: replacement.toString("base64"), version: "stale" }), 409);
  await json(await app.request("/api/binary", "PUT", { root: app.directory, path: "img.bin", base64: replacement.toString("base64") }), 428);
  await json(await app.request("/api/binary", "PUT", { root: app.directory, path: "missing.bin", base64: "AA==", version: version(binary) }), 404);
  await json(await app.request("/api/binary", "PUT", { root: app.directory, path: "img.bin", base64: "not base64", version: version(binary) }), 400);
  assert.deepEqual(await readFile(diskPath(app, "img.bin")), binary);
  const result = await json(await app.request("/api/binary", "PUT", { root: app.directory, path: "img.bin", base64: replacement.toString("base64"), version: version(binary) }));
  assert.equal(result.version, version(replacement));
  assert.deepEqual(await readFile(diskPath(app, "img.bin")), replacement);
});

test("folder rename can rewrite notes inside the moved folder and verifies the rewritten bytes at the destination", async t => {
  const app = await fixture(t);
  const files = await populate(app);
  const rewritten = "Note\r\nwith [[../Other]]\r\n";
  const result = await json(await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "Projects", newPath: "Work/Archive", manifest: manifest(files), edits: [{ path: "Projects/a.md", version: version(files["Projects/a.md"]), content: rewritten }] }));
  assert.equal(result.documents.length, 1);
  assert.equal(await readFile(diskPath(app, "Work/Archive/a.md"), "utf8"), "\ufeff" + rewritten, "the BOM is preserved");
  assert.deepEqual(await readFile(diskPath(app, "Work/Archive/Deep/b.bin")), binary);
  assert.equal(await exists(diskPath(app, "Projects")), false);
  const stale = await app.request("/api/files/folders/rename", "POST", { root: app.directory, path: "Work/Archive", newPath: "Again", manifest: manifest({ "Work/Archive/a.md": Buffer.from("\ufeff" + rewritten), "Work/Archive/Deep/b.bin": binary, "Work/Archive/Deep/Deeper/c.md": Buffer.from("c") }), edits: [{ path: "Work/Archive/a.md", version: version(files["Projects/a.md"]), content: "x" }] });
  assert.equal(stale.status, 409);
  assert.equal(await readFile(diskPath(app, "Work/Archive/a.md"), "utf8"), "\ufeff" + rewritten);
});
