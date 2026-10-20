import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";

let directory;
let BrowserVault;
let definitions;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "browser-folder-tests-"));
  const entry = join(directory, "browser-vault.mjs");
  await build({ stdin: { contents: 'export { BrowserVault } from "./client/browser-vault";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  ({ BrowserVault } = await import(pathToFileURL(entry).href));
  const host = await startHost();
  try {
    definitions = (await (await host.request("/api/core")).json()).plugins.map(plugin => ({ ...plugin, defaultOn: plugin.configuredEnabled }));
  } finally { await host.stop(); }
});
after(async () => { if (directory) { await rm(directory, { recursive: true }); } });

class Folder {
  kind = "directory";
  children = new Map();
  constructor(name, owner) { this.name = name; this.root = owner ?? this; }
  async isSameEntry(other) { return this === other; }
  async queryPermission() { return "granted"; }
  async requestPermission() { return "granted"; }
  async *entries() { yield* this.children; }
  async getDirectoryHandle(name, options = {}) { return this.child(name, "directory", options.create); }
  async getFileHandle(name, options = {}) { return this.child(name, "file", options.create); }
  child(name, kind, create) {
    let child = this.children.get(name);
    if (!child && create) {
      child = kind === "directory" ? new Folder(name, this.root) : new DiskFile(name, this.root);
      this.children.set(name, child);
    }
    if (!child) { throw new DOMException("Not found: " + name, "NotFoundError"); }
    if (child.kind !== kind) { throw new DOMException("Wrong entry kind", "TypeMismatchError"); }
    return child;
  }
  async removeEntry(name, options = {}) {
    const child = this.children.get(name);
    if (!child) { throw new DOMException("Not found: " + name, "NotFoundError"); }
    if (child.kind === "directory" && child.children.size && !options.recursive) { throw new DOMException("Directory is not empty: " + name, "InvalidModificationError"); }
    if (this.failRemove === name) { throw new DOMException("Fixture removal denied", "NoModificationAllowedError"); }
    this.children.delete(name);
  }
}
class DiskFile {
  kind = "file";
  bytes = new Uint8Array();
  modified = 1;
  constructor(name, owner) { this.name = name; this.root = owner; }
  async isSameEntry(other) { return this === other; }
  set(value) { this.bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); this.modified++; }
  async getFile() { return new File([this.bytes], this.name, { lastModified: this.modified }); }
  async createWritable() {
    let bytes;
    return { write: async value => { bytes = new Uint8Array(value); }, close: async () => { this.set(bytes); }, abort: async () => {} };
  }
}

async function put(folder, path, content) {
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) { folder = await folder.getDirectoryHandle(part, { create: true }); }
  const file = await folder.getFileHandle(parts.at(-1), { create: true });
  file.set(content);
  return file;
}
async function lookup(folder, path) {
  for (const part of path.split("/")) { folder = folder.children.get(part); if (!folder) { return null; } }
  return folder;
}
async function fixture() {
  const folder = new Folder("Browser folder fixture");
  const records = new Map();
  const host = new BrowserVault(definitions, ["file-explorer"], { list: async () => [...records.values()], put: async record => { records.set(record.id, record); } });
  await host.initialize();
  const id = await host.select(folder);
  assert.equal((await host.request("/api/vault/open", "POST", { path: id })).status, 200);
  return { host, folder, id };
}
const version = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = files => Object.entries(files).map(([path, bytes]) => ({ path, version: version(bytes) }));
const bytesOf = file => Buffer.from(file.bytes);
const binary = Buffer.from([0, 255, 1, 254, 0, 13, 10, 0x1a]);
const note = Buffer.from("\ufeffNote\r\n", "utf8");
async function populate(folder) {
  const files = { "Projects/a.md": note, "Projects/Deep/b.bin": binary, "Projects/Deep/Deeper/c.md": Buffer.from("c") };
  for (const [path, bytes] of Object.entries(files)) { await put(folder, path, bytes); }
  await folder.children.get("Projects").getDirectoryHandle("Empty", { create: true });
  return files;
}

test("browser folder rename copies exact bytes, keeps empty folders and removes the source", async () => {
  const { host, folder, id } = await fixture();
  const files = await populate(folder);
  const response = await host.request("/api/files/folders/rename", "POST", { root: id, path: "Projects", newPath: "Work/Archive", manifest: manifest(files) });
  assert.equal(response.status, 200, response.error);
  assert.deepEqual(response.value.files.map(file => file.newPath).sort(), ["Work/Archive/Deep/Deeper/c.md", "Work/Archive/Deep/b.bin", "Work/Archive/a.md"].sort());
  assert.equal(await lookup(folder, "Projects"), null);
  assert.ok(response.value.snapshot.folders.includes("Work/Archive/Empty"));
  for (const [path, bytes] of Object.entries(files)) { assert.deepEqual(bytesOf(await lookup(folder, path.replace("Projects/", "Work/Archive/"))), bytes); }
});

test("browser folder rename handles case-only renames through verified staging", async () => {
  const { host, folder, id } = await fixture();
  const files = await populate(folder);
  const response = await host.request("/api/files/folders/rename", "POST", { root: id, path: "Projects", newPath: "projects", manifest: manifest(files) });
  assert.equal(response.status, 200, response.error);
  assert.deepEqual(bytesOf(await lookup(folder, "projects/Deep/b.bin")), binary);
  assert.equal(await lookup(folder, "Projects"), null);
});

test("browser folder case-only rename never merges with a distinct occupied folder", async () => {
  const { host, folder, id } = await fixture();
  const files = { "P/a.md": Buffer.from("a"), "p/b.md": Buffer.from("b") };
  for (const [path, bytes] of Object.entries(files)) { await put(folder, path, bytes); }
  const response = await host.request("/api/files/folders/rename", "POST", { root: id, path: "P", newPath: "p", manifest: manifest({ "P/a.md": files["P/a.md"] }) });
  assert.equal(response.status, 409);
  assert.deepEqual(bytesOf(await lookup(folder, "P/a.md")), files["P/a.md"]);
  assert.deepEqual(bytesOf(await lookup(folder, "p/b.md")), files["p/b.md"]);
  assert.equal(await lookup(folder, "p/a.md"), null);
});

test("browser folder operations refuse stale, unknown, hidden, occupied and root requests without changing bytes", async () => {
  const { host, folder, id } = await fixture();
  const files = await populate(folder);
  await put(folder, "Taken/x.md", "x");
  const base = { root: id, path: "Projects", manifest: manifest(files) };
  const status = async (route, body) => (await host.request(route, "POST", body)).status;
  assert.equal(await status("/api/files/folders/rename", { ...base, newPath: "Taken" }), 409);
  assert.equal(await status("/api/files/folders/rename", { ...base, newPath: "Projects/In" }), 409);
  assert.equal(await status("/api/files/folders/rename", { ...base, newPath: "Moved", manifest: manifest(files).slice(1) }), 409);
  assert.equal(await status("/api/files/folders/rename", { ...base, newPath: "Moved", manifest: undefined }), 428);
  assert.equal(await status("/api/files/folders/delete", { root: id, path: "", manifest: [] }), 403);
  assert.equal(await status("/api/files/folders/delete", { ...base, manifest: manifest(files).slice(1) }), 409);
  (await lookup(folder, "Projects/a.md")).set("external");
  assert.equal(await status("/api/files/folders/delete", base), 409);
  assert.equal(await status("/api/files/folders/rename", { ...base, newPath: "Moved" }), 409);
  (await lookup(folder, "Projects/a.md")).set(note);
  await put(folder, "Projects/.hidden", "h");
  assert.equal(await status("/api/files/folders/delete", base), 409);
  assert.equal(await lookup(folder, "Moved"), null);
  assert.deepEqual(bytesOf(await lookup(folder, "Projects/Deep/b.bin")), binary);
});

test("browser folder rename applies outside reference edits and reverts them when the copy fails", async () => {
  const { host, folder, id } = await fixture();
  const files = await populate(folder);
  const outside = Buffer.from("see [[Projects/a]]");
  const outsideFile = await put(folder, "Outside.md", outside);
  const edit = { path: "Outside.md", version: version(outside), content: "see [[Moved/a]]" };
  const rejected = await host.request("/api/files/folders/rename", "POST", { root: id, path: "Projects", newPath: "Moved", manifest: manifest(files), edits: [{ ...edit, path: "Projects/a.md" }] });
  assert.equal(rejected.status, 409);
  await put(folder, "Blocker", "file");
  const failed = await host.request("/api/files/folders/rename", "POST", { root: id, path: "Projects", newPath: "Blocker/Child", manifest: manifest(files), edits: [edit] });
  assert.ok(failed.status >= 400);
  assert.deepEqual(bytesOf(outsideFile), outside);
  assert.deepEqual(bytesOf(await lookup(folder, "Projects/Deep/b.bin")), binary);
  const applied = await host.request("/api/files/folders/rename", "POST", { root: id, path: "Projects", newPath: "Moved", manifest: manifest(files), edits: [edit] });
  assert.equal(applied.status, 200, applied.error);
  assert.equal(applied.value.documents[0].content, "see [[Moved/a]]");
});

test("browser folder delete removes exactly the manifest and reports partial failure explicitly", async () => {
  const { host, folder, id } = await fixture();
  const files = await populate(folder);
  const deep = await lookup(folder, "Projects/Deep");
  deep.failRemove = "b.bin";
  const partial = await host.request("/api/files/folders/delete", "POST", { root: id, path: "Projects", manifest: manifest(files) });
  assert.equal(partial.status, 500);
  assert.match(partial.error, /Deleted files: .*Remaining files: /s);
  deep.failRemove = undefined;
  const remaining = Object.fromEntries(Object.entries(files).filter(([path]) => await_exists(folder, path)));
  const result = await host.request("/api/files/folders/delete", "POST", { root: id, path: "Projects", manifest: manifest(remaining) });
  assert.equal(result.status, 200, result.error);
  assert.equal(await lookup(folder, "Projects"), null);
  assert.deepEqual(result.value.snapshot.folders, []);
});

function await_exists(folder, path) {
  let current = folder;
  for (const part of path.split("/")) { current = current?.children.get(part); }
  return Boolean(current);
}

test("browser modifyBinary replaces bytes only for the matching version", async () => {
  const { host, folder, id } = await fixture();
  await put(folder, "img.bin", binary);
  const replacement = Buffer.from([1, 2, 3, 0, 255]);
  const send = body => host.request("/api/binary", "PUT", { root: id, path: "img.bin", ...body });
  assert.equal((await send({ base64: replacement.toString("base64"), version: "stale" })).status, 409);
  assert.equal((await send({ base64: replacement.toString("base64") })).status, 428);
  assert.equal((await send({ base64: "not base64", version: version(binary) })).status, 400);
  assert.deepEqual(bytesOf(await lookup(folder, "img.bin")), binary);
  const result = await send({ base64: replacement.toString("base64"), version: version(binary) });
  assert.equal(result.status, 200, result.error);
  assert.equal(result.value.version, version(replacement));
  assert.deepEqual(bytesOf(await lookup(folder, "img.bin")), replacement);
});
