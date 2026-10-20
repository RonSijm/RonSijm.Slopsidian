import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";

let directory, client;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "metadata-folders-"));
  const entry = join(directory, "client.mjs");
  await build({
    stdin: { contents: 'export { Vault, TFile, TFolder } from "./client/vault"; export { MetadataCache } from "./client/metadata"; export { FileManager } from "./client/file-manager"; export { BrowserVault } from "./client/browser-vault"; export { configureVaultSource } from "./client/contracts";', resolveDir: root, loader: "ts" },
    outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
  });
  client = await import(pathToFileURL(entry).href);
});
after(async () => { if (directory) { await rm(directory, { recursive: true }); } });

// Directory-handle fixture: BrowserVault performs its real scans, hashing and mutations.
class Folder {
  kind = "directory";
  children = new Map();
  constructor(name) { this.name = name; }
  async queryPermission() { return "granted"; }
  async requestPermission() { return "granted"; }
  async isSameEntry(other) { return this === other; }
  async *entries() { yield* this.children; }
  async getDirectoryHandle(name, options = {}) { return this.child(name, "directory", options.create); }
  async getFileHandle(name, options = {}) { return this.child(name, "file", options.create); }
  child(name, kind, create) {
    let item = this.children.get(name);
    if (!item && create) {
      item = kind === "directory" ? new Folder(name) : new DiskFile(name);
      this.children.set(name, item);
    }
    if (!item) { throw new DOMException("Not found: " + name, "NotFoundError"); }
    if (item.kind !== kind) { throw new DOMException("Wrong entry kind", "TypeMismatchError"); }
    return item;
  }
  async removeEntry(name, options = {}) {
    const item = this.children.get(name);
    if (!item) { throw new DOMException("Not found", "NotFoundError"); }
    if (item.kind === "directory" && item.children.size && !options.recursive) { throw new DOMException("Not empty", "InvalidModificationError"); }
    this.children.delete(name);
  }
}
class DiskFile {
  kind = "file";
  bytes = new Uint8Array();
  modified = 1;
  constructor(name) { this.name = name; }
  async isSameEntry(other) { return this === other; }
  async getFile() { return new File([this.bytes], this.name, { lastModified: this.modified }); }
  async createWritable() {
    let bytes;
    return { write: async value => { bytes = new Uint8Array(value); }, close: async () => { this.bytes = bytes; this.modified++; }, abort: async () => {} };
  }
}
async function childFolder(folder, path) {
  for (const part of path.split("/").filter(Boolean)) { folder = await folder.getDirectoryHandle(part, { create: true }); }
  return folder;
}

async function fixture(t, kind) {
  let server, source, selected, makeFolder, write, remove, other;
  const owned = await mkdtemp(join(directory, kind + "-"));
  if (kind === "native") {
    selected = join(owned, "First");
    const second = join(owned, "Second");
    await mkdir(selected); await mkdir(join(second, "Fresh"), { recursive: true });
    server = await startHost(selected);
    source = { request: async (...args) => {
      const response = await server.request(...args), value = await response.json();
      return { status: response.status, value, error: value.error };
    } };
    makeFolder = path => mkdir(join(selected, path), { recursive: true });
    write = (path, text) => writeFile(join(selected, path), text);
    remove = path => rm(join(selected, path), { recursive: true });
    other = () => source.request("/api/vault/open", "POST", { path: second });
  } else {
    const folder = new Folder("First"), second = new Folder("Second"), records = new Map();
    await childFolder(second, "Fresh");
    source = new client.BrowserVault([], [], { list: async () => [...records.values()], put: async record => { records.set(record.id, record); } });
    await source.initialize();
    selected = await source.select(folder);
    await source.request("/api/vault/open", "POST", { path: selected });
    makeFolder = path => childFolder(folder, path);
    write = async (path, text) => {
      const parts = path.split("/"), parent = await childFolder(folder, parts.slice(0, -1).join("/"));
      const file = await parent.getFileHandle(parts.at(-1), { create: true });
      file.bytes = new TextEncoder().encode(text); file.modified++;
    };
    remove = async path => {
      const parts = path.split("/"), parent = await childFolder(folder, parts.slice(0, -1).join("/"));
      await parent.removeEntry(parts.at(-1), { recursive: true });
    };
    other = async () => source.request("/api/vault/open", "POST", { path: await source.select(second) });
  }
  client.configureVaultSource(source);
  const app = {
    changingVault: false, saveAll: async () => {}, notifyEditor: async () => {},
    dotNet: { invokeMethodAsync: async () => {} },
    workspace: {
      sessions: new Map(), acceptExternalDocuments() {}, withFileMutation: async action => action(),
      hasUnsavedChanges: false, leaves: () => [], getActiveFile: () => null, trigger() {},
    },
  };
  const vault = new client.Vault(async () => {}, {
    createFolder: path => app.fileManager.createFolder(path),
    renameFile: (file, path, links) => app.fileManager.renameFile(file, path, links),
    deleteFile: file => app.fileManager.deleteFile(file),
  });
  app.vault = vault;
  vault.setSnapshot((await source.request("/api/vault", "GET")).value);
  const cache = app.metadataCache = new client.MetadataCache(app);
  app.fileManager = new client.FileManager(app);
  t.after(async () => {
    await cache.pause(); client.configureVaultSource(null);
    if (server) { await server.stop(); }
    await rm(owned, { recursive: true });
  });
  await cache.initialize(selected);
  const events = [], deleted = [];
  for (const name of ["create", "modify", "delete", "rename"]) {
    vault.on(name, file => events.push({
      name, path: file.path, file, current: vault.getAbstractFileByPath(file.path),
      parentContains: file.parent?.children.includes(file), cache: file instanceof client.TFile ? cache.getFileCache(file) : null,
    }));
  }
  cache.on("deleted", file => deleted.push(file));
  return { vault, cache, events, deleted, makeFolder, write, remove, source, other };
}
const summary = events => events.map(event => [event.name, event.path]);

for (const kind of ["native", "browser"]) {
  test(`${kind}: external nested folder creation survives inventory refresh and exposes ready parents and metadata once`, async t => {
    const { vault, cache, events, makeFolder, write } = await fixture(t, kind);
    await makeFolder("External/Deep/Empty");
    await write("External/Deep/Note.md", "# Ready\n");
    await vault.refresh();
    assert.deepEqual(events, []);
    await cache.refresh();
    assert.deepEqual(summary(events), [["create", "External"], ["create", "External/Deep"], ["create", "External/Deep/Empty"], ["create", "External/Deep/Note.md"]]);
    for (const event of events) {
      assert.equal(event.current, event.file);
      assert.equal(event.parentContains, true);
    }
    assert.equal(events.at(-1).cache.headings[0].heading, "Ready");
    events.length = 0;
    await cache.refresh(); await cache.refresh(false);
    assert.deepEqual(events, [], "Unchanged refreshes must not repeat creates or emit root events.");
  });

  test(`${kind}: external recursive deletion reports original children before parents and metadata deletion only for files`, async t => {
    const { vault, cache, events, deleted, makeFolder, write, remove } = await fixture(t, kind);
    await makeFolder("Tree/Inner/Empty"); await write("Tree/Inner/Note.md", "# Before\n");
    await cache.refresh();
    const original = new Map(events.map(event => [event.path, event.file]));
    events.length = 0;
    await remove("Tree"); await vault.refresh(); await cache.refresh();
    assert.equal(events.length, 4);
    for (const event of events) {
      assert.equal(event.name, "delete"); assert.equal(event.file, original.get(event.path)); assert.equal(event.current, null);
      const parent = events.findIndex(item => item.path === event.file.parent?.path);
      if (parent >= 0) { assert.ok(events.indexOf(event) < parent, "Delete descendants before their parent."); }
    }
    assert.deepEqual(deleted, [original.get("Tree/Inner/Note.md")]);
    events.length = 0; await cache.refresh(); assert.deepEqual(events, []);
  });

  test(`${kind}: folder/file replacements delete the previous kind before creating the new entity`, async t => {
    const { cache, events, deleted, makeFolder, write, remove } = await fixture(t, kind);
    await makeFolder("Swap.md"); await cache.refresh();
    const folder = events[0].file;
    events.length = 0;
    await remove("Swap.md"); await write("Swap.md", "# Replacement\n"); await cache.refresh();
    assert.deepEqual(summary(events), [["delete", "Swap.md"], ["create", "Swap.md"]]);
    assert.equal(events[0].file, folder); assert.ok(events[1].file instanceof client.TFile);
    const file = events[1].file;
    assert.deepEqual(deleted, []);
    events.length = 0;
    await remove("Swap.md"); await makeFolder("Swap.md"); await cache.refresh();
    assert.deepEqual(summary(events), [["delete", "Swap.md"], ["create", "Swap.md"]]);
    assert.equal(events[0].file, file); assert.ok(events[1].file instanceof client.TFolder);
    assert.deepEqual(deleted, [file]);
  });

  test(`${kind}: real FileManager creation, rename and deletion do not repeat folder events or consume unrelated external changes`, async t => {
    const { vault, cache, events, makeFolder } = await fixture(t, kind);
    await vault.createFolder("Managed/Nested"); await cache.pause();
    assert.deepEqual(summary(events), [["create", "Managed"], ["create", "Managed/Nested"]]);
    const nested = vault.getFolderByPath("Managed/Nested");
    events.length = 0;
    await makeFolder("Unrelated");
    await vault.rename(vault.getFolderByPath("Managed"), "Moved"); await cache.pause();
    assert.deepEqual(summary(events), [["create", "Unrelated"], ["rename", "Moved"]]);
    assert.equal(vault.getFolderByPath("Moved/Nested"), nested);
    events.length = 0; await cache.refresh(); assert.deepEqual(events, []);
    await vault.delete(vault.getFolderByPath("Moved"), true); await cache.pause();
    assert.deepEqual(summary(events), [["delete", "Moved"]], "Keep FileManager's explicit event sequence without refresh duplicates.");
    events.length = 0; await cache.refresh(); assert.deepEqual(events, []);
  });

  test(`${kind}: overlapping directory creation and metadata refresh coalesce acknowledgements`, async t => {
    const { vault, cache, events, source } = await fixture(t, kind);
    const arrived = Promise.withResolvers(), release = Promise.withResolvers();
    client.configureVaultSource({ request: async (...args) => {
      const result = await source.request(...args);
      if (args[0] === "/api/files/folders") { arrived.resolve(); await release.promise; }
      return result;
    } });
    const creating = vault.createDirectory("Overlap/Child");
    try {
      await arrived.promise; await cache.refresh();
    } finally { release.resolve(); }
    await creating; await cache.refresh();
    assert.deepEqual(summary(events), [["create", "Overlap"], ["create", "Overlap/Child"]]);
  });

  test(`${kind}: a held previous-vault scan cannot publish folders into the next vault`, async t => {
    const { vault, cache, events, makeFolder, source, other } = await fixture(t, kind);
    await makeFolder("Late");
    const arrived = Promise.withResolvers(), release = Promise.withResolvers();
    client.configureVaultSource({ request: async (...args) => {
      const result = await source.request(...args);
      if (args[0].startsWith("/api/metadata/documents?")) { arrived.resolve(); await release.promise; }
      return result;
    } });
    const refreshing = cache.refresh();
    let switching;
    try {
      await arrived.promise;
      vault.setSnapshot((await other()).value);
      switching = cache.initialize(vault.rootPath);
    } finally { release.resolve(); }
    await refreshing; await switching;
    assert.deepEqual(events, []);
    assert.equal(vault.getFolderByPath("Late"), null);
    assert.ok(vault.getFolderByPath("Fresh"));
    await cache.refresh(); assert.deepEqual(events, []);
  });

  test(`${kind}: revision polling discovers an external empty folder without a forced scan`, async t => {
    const { cache, events, makeFolder } = await fixture(t, kind);
    await makeFolder("Polled");
    const deadline = Date.now() + 6000;
    while (!events.length && Date.now() < deadline) { await cache.refresh(false); if (!events.length) { await delay(25); } }
    assert.deepEqual(summary(events), [["create", "Polled"]]);
  });
}
