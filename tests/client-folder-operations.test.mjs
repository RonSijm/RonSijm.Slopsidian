import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";

// Real Vault + FileManager + BrowserVault over in-memory directory handles; workspace/metadata are recording stand-ins.
let directory, BrowserVault, Vault, FileManager, TFolder, configureBrowserHost, parseMarkdown, linkDestination, definitions;
let current = null;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "client-folder-tests-"));
  const entry = join(directory, "client.mjs");
  await build({
    stdin: { contents: 'export { BrowserVault } from "./client/browser-vault"; export { Vault, TFolder } from "./client/vault"; export { FileManager } from "./client/file-manager"; export { configureBrowserHost } from "./client/contracts"; export { parseMarkdown } from "./client/markdown"; export { linkDestination } from "./client/links";', resolveDir: root, loader: "ts" },
    outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
  });
  ({ BrowserVault, Vault, FileManager, TFolder, configureBrowserHost, parseMarkdown, linkDestination } = await import(pathToFileURL(entry).href));
  configureBrowserHost({ request: (...args) => current.request(...args), chooseDirectory: async () => null, getVaultChoices: () => ({}) });
  const host = await startHost();
  try { definitions = (await (await host.request("/api/core")).json()).plugins.map(plugin => ({ ...plugin, defaultOn: plugin.configuredEnabled })); }
  finally { await host.stop(); }
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
    if (!child && create) { child = kind === "directory" ? new Folder(name, this.root) : new DiskFile(name, this.root); this.children.set(name, child); }
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
function lookup(folder, path) {
  for (const part of path.split("/")) { folder = folder?.children.get(part); }
  return folder ?? null;
}
function dump(folder, prefix = "") {
  const result = {};
  for (const [name, child] of folder.children) {
    if (name.startsWith(".")) { continue; }
    if (child.kind === "directory") { result[prefix + name + "/"] = ""; Object.assign(result, dump(child, prefix + name + "/")); }
    else { result[prefix + name] = Buffer.from(child.bytes).toString("latin1"); }
  }
  return result;
}
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture(files, options = {}) {
  const folder = new Folder("Client folder fixture");
  for (const [path, content] of Object.entries(files)) { await put(folder, path, content); }
  const records = new Map();
  const host = new BrowserVault(definitions, ["file-explorer"], { list: async () => [...records.values()], put: async record => { records.set(record.id, record); } });
  await host.initialize();
  const id = await host.select(folder);
  assert.equal((await host.request("/api/vault/open", "POST", { path: id })).status, 200);
  current = host;
  const log = { renames: [], trashStages: [], rollbacks: [], commits: [], mutations: [], events: [], saved: 0 };
  const app = { changingVault: false };
  const vault = new Vault(async () => {}, { renameFile: (file, path) => app.fileManager.renameFile(file, path, true), trashFile: (file, system) => app.fileManager.trashFile(file, system), deleteFile: file => app.fileManager.deleteFile(file), createFolder: path => app.fileManager.createFolder(path) });
  app.vault = vault;
  vault.setSnapshot((await host.request("/api/vault")).value);
  for (const name of ["rename", "delete", "modify", "create"]) { vault.on(name, (file, old) => log.events.push([name, file.path, old])); }
  let documents = [];
  const metadataCache = {
    async refresh() {
      await vault.refresh();
      documents = [];
      for (const file of vault.getMarkdownFiles()) {
        const document = await vault.readDocument(file.path);
        documents.push({ document, text: document.content, cache: parseMarkdown(document.content) });
      }
    },
    getDocuments: () => documents, getDocument: path => documents.find(entry => entry.document.file.path === path), getIssues: () => [],
    pause: async () => {}, resume: () => {}, acceptFileMutation: (file, old, entry) => log.mutations.push([file.path, old, entry?.path ?? null]),
  };
  const workspace = {
    unsaved: false, stageFailure: null, dirtyAfterStage: false,
    withFileMutation: async action => action(), hasUnsavedChanges: false, isChangingFiles: false, isChangingLayout: false,
    leaves: () => [], sessions: new Map(), track: () => {}, trigger: () => {}, getActiveFile: () => null,
    acceptFileRename: (file, old, entry) => log.renames.push([file, old, entry.path]),
    acceptExternalDocuments: () => {},
    stageFileTrash: async file => {
      if (workspace.stageFailure === file.path) { throw new Error("View for " + file.path + " refused to close."); }
      log.trashStages.push(file.path);
      if (workspace.dirtyAfterStage) { workspace.hasUnsavedChanges = true; }
      return { commit: () => log.commits.push(file.path), rollback: async () => { log.rollbacks.push(file.path); } };
    },
  };
  Object.assign(app, { metadataCache, workspace, notifyEditor: async () => {}, saveAll: async () => { log.saved++; }, metadataTypeManager: { accept: () => {} } });
  app.fileManager = new FileManager(app);
  await metadataCache.refresh();
  return { app, vault, folder, workspace, log, host, metadataCache };
}

// Every link in every note must resolve to the same (possibly moved) file after the operation.
function resolutions(texts, tree, moves = new Map()) {
  const listing = Object.keys(tree).filter(path => !path.endsWith("/")).map(path => ({ path }));
  const result = {};
  for (const [path, text] of Object.entries(texts)) {
    const cache = parseMarkdown(text);
    result[moves.get(path) ?? path] = [...cache.links, ...cache.embeds].map(link => {
      const destination = linkDestination(listing, link, path);
      return destination ? `${link.link.includes("#") ? link.link.slice(link.link.indexOf("#")) : ""}->${destination.file.path}` : "unresolved";
    });
  }
  return result;
}

const notes = {
  "Projects/a.md": "# A\n[[Deep/c#Head]] [[Outside]] [Out](../Outside.md#Top) [[c#^blk]] [[#A]] ![[Deep/pic.png]]\n",
  "Projects/Deep/c.md": "# Head\nBody ^blk\n[[a]] [[../a#A]] [[Outside#Top]] [Up](../a.md)\n",
  "Projects/Deep/pic.png": Buffer.from([0, 255, 1, 254, 13, 10, 26]),
  "Outside.md": "# Top\n[[Projects/a#A]] [[a#A]] [[Deep/c#Head]] [[c#^blk]] [Rel](Projects/Deep/c.md)\n",
  "Deep/Far/c.md": "far c\n",
  "Deep/Far2/a.md": "# A\nshadow\n",
};

test("folder move rewrites links in outside AND moved notes, keeping headings, blocks, relative paths and shadowing intact", async () => {
  const { app, folder, log, vault } = await fixture(notes);
  const before = dump(folder);
  const texts = Object.fromEntries(Object.entries(before).filter(([path]) => path.endsWith(".md")));
  const target = "Deep/Far2/Projects";
  const moves = new Map(Object.keys(before).filter(path => path.startsWith("Projects/") && !path.endsWith("/")).map(path => [path, target + path.slice("Projects".length)]));
  const expected = resolutions(texts, before, moves);
  await app.fileManager.renameFile(vault.getFolderByPath("Projects"), target, true);
  const after = dump(folder);
  const afterTexts = Object.fromEntries(Object.entries(after).filter(([path]) => path.endsWith(".md")));
  const listing = Object.keys(after).filter(path => !path.endsWith("/")).map(path => ({ path }));
  const resolved = {};
  for (const [path, text] of Object.entries(afterTexts)) {
    const cache = parseMarkdown(text);
    resolved[path] = [...cache.links, ...cache.embeds].map(link => { const d = linkDestination(listing, link, path); return d ? `${link.link.includes("#") ? link.link.slice(link.link.indexOf("#")) : ""}->${d.file.path}` : "unresolved"; });
  }
  // Compare against the pre-move resolution mapped through the move.
  const mapTarget = value => value.replace(/->(.*)$/, (_, path) => "->" + (moves.get(path) ?? path)).replace(/#[^->]*(?=->)/, match => match);
  for (const [path, links] of Object.entries(expected)) { assert.deepEqual(resolved[path], links.map(mapTarget), path); }
  assert.equal(after["Deep/Far2/Projects/Deep/pic.png"], before["Projects/Deep/pic.png"], "descendant bytes are exact");
  assert.equal(after["Deep/Far/c.md"], "far c\n");
  assert.ok(!Object.keys(after).some(path => path.startsWith("Projects")), "source removed");
  assert.match(afterTexts["Outside.md"], /^# Top\n\[\[Deep\/Far2\/Projects\/a#A\]\] \[\[Deep\/Far2\/Projects\/a#A\]\] /, "a shortest link now shadowed by Deep/Far2/a.md becomes explicit");
  assert.match(afterTexts["Deep/Far2/Projects/Deep/c.md"], /\[\[Outside#Top\]\]/);
  assert.equal(log.renames.length, 3, "every descendant is remapped for open views");
  for (const [file, old, now] of log.renames) { assert.equal(vault.getFileByPath(now), file, "TFile identity survives"); assert.ok(old.startsWith("Projects/")); assert.ok(now.startsWith(target + "/")); }
  assert.equal(vault.getFolderByPath("Projects"), null);
  assert.ok(log.events.some(([name, path, old]) => name === "rename" && path === target && old === "Projects"));
  assert.ok(log.events.some(([name, path]) => name === "modify" && path === "Outside.md"), "rewritten outside note emits modify");
});

test("link updates off moves bytes untouched; a move that cannot keep links valid is refused before mutation", async () => {
  const unresolved = { ...notes, "Projects/Deep/c.md": notes["Projects/Deep/c.md"] + "[[Missing note]]\n" };
  const { app, folder, vault, log } = await fixture(unresolved);
  const before = dump(folder);
  await assert.rejects(app.fileManager.renameFile(vault.getFolderByPath("Projects"), "Moved/Projects", true), /unresolved|No files were moved/i);
  assert.deepEqual(dump(folder), before, "refusal changed nothing");
  assert.equal(log.renames.length, 0);
  await app.fileManager.renameFile(vault.getFolderByPath("Projects"), "Moved/Projects", false);
  const after = dump(folder);
  assert.equal(after["Moved/Projects/Deep/c.md"], before["Projects/Deep/c.md"]);
  assert.equal(after["Outside.md"], before["Outside.md"]);
});

test("more than 256 required link rewrites refuse explicitly before any folder mutation", async () => {
  const files = { "Projects/a.md": "a\n" };
  for (let index = 0; index < 257; index++) { files[`Refs/r${index}.md`] = "[[Projects/a]]\n"; }
  const { app, folder, vault, log } = await fixture(files);
  const before = dump(folder);
  await assert.rejects(app.fileManager.renameFile(vault.getFolderByPath("Projects"), "Moved", true), /256/);
  assert.deepEqual(dump(folder), before);
  assert.equal(log.renames.length, 0);
});

test("stale manifest, collisions, nesting and the root are refused with the vault untouched", async () => {
  const { app, folder, vault, log } = await fixture(notes);
  const before = dump(folder);
  const projects = vault.getFolderByPath("Projects");
  const original = vault.folderManifest.bind(vault);
  vault.folderManifest = async target => { const manifest = await original(target); folder.children.get("Projects").children.get("a.md").set("changed externally\n"); return manifest; };
  await assert.rejects(app.fileManager.renameFile(projects, "Moved", false), /changed on disk/);
  vault.folderManifest = original;
  assert.equal(dump(folder)["Projects/a.md"], "changed externally\n");
  assert.equal(log.renames.length, 0);
  await assert.rejects(app.fileManager.renameFile(projects, "Deep", false), /already exists/);
  await assert.rejects(app.fileManager.renameFile(projects, "Projects/Inner", false), /inside itself/);
  await assert.rejects(app.fileManager.renameFile(vault.getRoot(), "Anything", false), /root/);
  await assert.rejects(app.fileManager.deleteFile(vault.getRoot()), /root/);
  await assert.rejects(vault.delete(vault.getRoot(), true), /root/);
  assert.ok(Object.keys(dump(folder)).length >= Object.keys(before).length);
  assert.ok(lookup(folder, "Projects/Deep/pic.png"));
});

const canvasOf = (...nodes) => JSON.stringify({ nodes: nodes.map((node, index) => ({ id: "n" + index, x: index * 100, y: 0, width: 80, height: 40, ...node })), edges: [] });

test("moving a Canvas with its linked note rewrites text cards, file cards and backgrounds once against the final Canvas path", async () => {
  const files = {
    "P/Board.canvas": canvasOf({ type: "text", text: "[Z](./z.md) [[z]]" }, { type: "file", file: "P/z.md" }, { type: "group", background: "P/z.md" }),
    "P/z.md": "# Z\n",
  };
  const { app, folder, vault } = await fixture(files);
  await app.fileManager.renameFile(vault.getFolderByPath("P"), "Q/Sub", true);
  const after = dump(folder);
  const canvas = JSON.parse(after["Q/Sub/Board.canvas"]);
  assert.equal(canvas.nodes[0].text, "[Z](./z.md) [[Q/Sub/z]]");
  assert.equal(canvas.nodes[1].file, "Q/Sub/z.md");
  assert.equal(canvas.nodes[2].background, "Q/Sub/z.md");
  assert.equal(after["Q/Sub/z.md"], "# Z\n");
});

test("Markdown changed on disk after indexing is refused before any mutation, never rebased", async () => {
  const { app, folder, vault, metadataCache, log } = await fixture({ "Projects/a.md": "# A\n", "Outside.md": "o\n" });
  folder.children.get("Projects").children.get("a.md").set("# A\n[Out](../Outside.md)\n");
  metadataCache.refresh = async () => {};
  const before = dump(folder);
  await assert.rejects(app.fileManager.renameFile(vault.getFolderByPath("Projects"), "Q/Projects", true), /changed on disk after it was indexed/);
  assert.deepEqual(dump(folder), before);
  assert.equal(log.renames.length, 0);
});

test("a case-only folder rename onto a distinct occupied folder is refused with both folders untouched", async () => {
  const { app, folder, vault, log } = await fixture({ "P/a.md": "a", "p/b.md": "b" });
  const before = dump(folder);
  await assert.rejects(app.fileManager.renameFile(vault.getFolderByPath("P"), "p", false), /already exists/);
  assert.deepEqual(dump(folder), before);
  assert.equal(log.renames.length, 0);
});

test("folder delete stages every owner, deletes exact verified bytes, removes metadata and emits one delete per file plus the folder", async () => {
  const { app, folder, vault, log } = await fixture(notes);
  await app.fileManager.deleteFile(vault.getFolderByPath("Projects"));
  assert.ok(!lookup(folder, "Projects"));
  assert.deepEqual(log.trashStages.sort(), ["Projects/Deep/c.md", "Projects/Deep/pic.png", "Projects/a.md"]);
  assert.deepEqual(log.commits.sort(), log.trashStages.sort());
  assert.deepEqual(log.mutations.filter(([, , entry]) => entry === null).map(([path]) => path).sort(), log.trashStages.sort());
  assert.equal(log.events.filter(([name]) => name === "delete").length, 4);
  assert.ok(lookup(folder, "Outside.md") && lookup(folder, "Deep/Far/c.md"), "unrelated files remain");
  assert.equal(vault.getFolderByPath("Projects"), null);
});

test("held view owner or stale dirty owner cancels deletion and restores every closed view", async () => {
  const { app, folder, vault, workspace, log } = await fixture(notes);
  const before = dump(folder);
  workspace.stageFailure = "Projects/Deep/pic.png";
  await assert.rejects(app.fileManager.deleteFile(vault.getFolderByPath("Projects")), /refused to close/);
  assert.deepEqual(dump(folder), before);
  assert.deepEqual(log.rollbacks.sort(), [...log.trashStages].sort(), "closed views are restored");
  workspace.stageFailure = null; log.rollbacks.length = 0; log.trashStages.length = 0;
  workspace.dirtyAfterStage = true;
  await assert.rejects(app.fileManager.deleteFile(vault.getFolderByPath("Projects")), /No files were deleted/);
  assert.deepEqual(dump(folder), before);
  assert.equal(log.rollbacks.length, 3);
  assert.equal(log.commits.length, 0);
  assert.ok(vault.getFolderByPath("Projects"));
});

test("external replacement between manifest and deletion refuses without deleting and restores views", async () => {
  const { app, folder, vault, log } = await fixture(notes);
  const original = vault.folderManifest.bind(vault);
  vault.folderManifest = async target => { const manifest = await original(target); lookup(folder, "Projects/Deep/c.md").set("replaced\n"); return manifest; };
  await assert.rejects(app.fileManager.deleteFile(vault.getFolderByPath("Projects")), error => /changed on disk/.test(error.errors.map(item => item.message).join("\n")));
  assert.equal(dump(folder)["Projects/Deep/c.md"], "replaced\n");
  assert.ok(lookup(folder, "Projects/a.md") && lookup(folder, "Projects/Deep/pic.png"));
  assert.equal(log.commits.length, 0);
  assert.equal(log.rollbacks.length, 3);
});

test("partial browser delete commits only vanished files, restores views for survivors and reports both sets", async () => {
  const { app, folder, vault, log } = await fixture(notes);
  lookup(folder, "Projects/Deep").failRemove = "pic.png";
  await assert.rejects(app.fileManager.deleteFile(vault.getFolderByPath("Projects")), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /partial/);
    assert.match(error.errors.map(item => item.message).join("\n"), /Deleted files: .*Remaining files: .*pic\.png/s);
    return true;
  });
  assert.ok(lookup(folder, "Projects/Deep/pic.png"), "survivor remains on disk");
  assert.ok(!lookup(folder, "Projects/a.md"), "first file was really deleted");
  assert.ok(vault.getFileByPath("Projects/Deep/pic.png") && !vault.getFileByPath("Projects/a.md"), "inventory reconciled");
  assert.ok(log.commits.includes("Projects/a.md") && !log.commits.includes("Projects/Deep/pic.png"));
  assert.deepEqual(log.rollbacks, ["Projects/Deep/pic.png"].filter(path => log.rollbacks.includes(path)).length ? log.rollbacks : ["Projects/Deep/pic.png"]);
  assert.ok(log.rollbacks.includes("Projects/Deep/pic.png") && !log.rollbacks.includes("Projects/a.md"));
});

test("partial browser move retains both verified copies, reports explicit paths and leaves inventory showing both", async () => {
  const { app, folder, vault, log } = await fixture({ "P/a.md": "a\n", "P/b.bin": Buffer.from([0, 1, 2, 255]) });
  lookup(folder, "P").failRemove = "b.bin";
  await assert.rejects(app.fileManager.renameFile(vault.getFolderByPath("P"), "Q", false), error => {
    const text = error instanceof AggregateError ? error.errors.map(item => item.message).join("\n") : error.message;
    assert.match(text, /copied to 'Q' and verified.*Both locations are retained/s);
    return true;
  });
  const after = dump(folder);
  assert.equal(after["Q/b.bin"], after["P/b.bin"]);
  assert.equal(after["Q/a.md"], "a\n");
  assert.ok(vault.getFileByPath("Q/b.bin") && vault.getFileByPath("P/b.bin"), "inventory reflects both locations");
  assert.equal(log.renames.length, 0, "workspace is not remapped on an unconfirmed move");
});

test("standalone browser hosts refuse system trash explicitly without staging, deleting or creating vault trash", async () => {
  const { vault, folder, log, host } = await fixture({ "Keep.md": "Keep\n", "Dir/x.md": "x\n" });
  const file = vault.getFileByPath("Keep.md");
  await assert.rejects(vault.trash(file, true), /System trash is only available in the Windows native host/);
  await assert.rejects(vault.adapter.trashSystem("Keep.md").then(value => { assert.equal(value, false); throw new Error("refused"); }), /refused/);
  assert.equal((await host.request("/api/files/system-trash", "POST", { root: vault.rootPath, path: "Keep.md", version: "x" })).status, 501);
  assert.deepEqual(log.trashStages, []);
  assert.equal(dump(folder)["Keep.md"], "Keep\n");
  assert.ok(!lookup(folder, ".trash"));
  assert.equal(vault.getFileByPath("Keep.md"), file);
  await assert.rejects(vault.trash(vault.getFolderByPath("Dir"), true), /Folder trash is not supported|System trash/);
  await vault.trash(file, false);
  assert.ok(!lookup(folder, "Keep.md"));
});

test("native system trash stages views, preserves rollback and truthful unknown outcomes, and commits exactly once on success", async () => {
  const { app, vault, workspace, log } = await fixture({ "A.md": "A\n", "B.md": "B\n", "C.md": "C\n" });
  Object.defineProperty(vault, "supportsSystemTrash", { value: true });
  const files = path => vault.getFileByPath(path);
  const versions = [];
  vault.systemTrashFile = async (file, version) => { versions.push([file.path, version]); throw new Error("Recycle Bin refused " + file.path); };
  await assert.rejects(vault.trash(files("A.md"), true), /Recycle Bin refused A\.md/);
  assert.deepEqual(log.trashStages, ["A.md"]);
  assert.deepEqual(log.rollbacks, ["A.md"], "a refusal restores the closed views");
  assert.deepEqual(log.commits, []);
  assert.equal(versions[0][1], sha(Buffer.from("A\n")));
  assert.ok(files("A.md"));

  log.trashStages.length = 0; log.rollbacks.length = 0;
  workspace.stageFailure = "A.md";
  await assert.rejects(vault.trash(files("A.md"), true), /refused to close/);
  assert.equal(versions.length, 1, "a view that cannot close prevents any host request");
  workspace.stageFailure = null;

  // Lost acknowledgement: the file is gone from disk, so views stay closed and the error is reported as unconfirmed.
  vault.systemTrashFile = async file => { await vault.deleteFile(file, sha(Buffer.from("B\n"))); throw new Error("response lost"); };
  log.trashStages.length = 0; log.rollbacks.length = 0; log.commits.length = 0;
  await assert.rejects(vault.trash(files("B.md"), true), error => error instanceof AggregateError && /removal response could not be confirmed/.test(error.message));
  assert.deepEqual(log.commits, ["B.md"]);
  assert.deepEqual(log.rollbacks, []);

  vault.systemTrashFile = async file => { await vault.deleteFile(file, sha(Buffer.from("C\n"))); return { snapshot: null, path: file.path, recycledPath: "C:\\$Recycle.Bin\\x\\$R1.md" }; };
  log.commits.length = 0;
  await vault.trash(files("C.md"), true);
  assert.deepEqual(log.commits, ["C.md"]);
  assert.ok(log.events.some(([name, path]) => name === "delete" && path === "C.md"));
  assert.equal(app.vault.getFileByPath("C.md"), null);
});

test("native folder system trash stages every owner, restores on refusal and commits per-file deletes plus the folder once", async () => {
  const { vault, workspace, log, folder } = await fixture({ "Dir/A.md": "A\n", "Dir/Sub/B.md": "B\n", "Keep.md": "K\n" });
  Object.defineProperty(vault, "supportsSystemTrash", { value: true });
  const dir = () => vault.getFolderByPath("Dir");
  const sent = [];
  vault.systemTrashFolder = async (target, manifest) => { sent.push(manifest.map(entry => entry.path).toSorted()); throw new Error("Recycle Bin refused the folder"); };
  await assert.rejects(vault.trash(dir(), true), /Recycle Bin refused the folder/);
  assert.deepEqual(sent, [["Dir/A.md", "Dir/Sub/B.md"]]);
  assert.deepEqual(log.trashStages.toSorted(), ["Dir/A.md", "Dir/Sub/B.md"]);
  assert.deepEqual(log.rollbacks.toSorted(), ["Dir/A.md", "Dir/Sub/B.md"]);
  assert.deepEqual(log.commits, []);
  assert.ok(dir());

  await assert.rejects(vault.trash(dir(), false), /Vault-local folder trash is not supported/);
  workspace.dirtyAfterStage = true;
  log.trashStages.length = 0; log.rollbacks.length = 0; sent.length = 0;
  await assert.rejects(vault.trash(dir(), true), /open view changed/);
  assert.deepEqual(sent, [], "a dirty view prevents any host request");
  assert.equal(log.rollbacks.length, 2);
  workspace.dirtyAfterStage = false; workspace.hasUnsavedChanges = false;
  log.rollbacks.length = 0; log.events.length = 0;
  vault.systemTrashFolder = async () => { await vault.deleteFolder(dir(), await vault.folderManifest(dir())); return { snapshot: null, path: "Dir", recycledPath: "C:\\$Recycle.Bin\\x\\$R2", files: [] }; };
  await vault.trash(dir(), true);
  assert.deepEqual(log.commits.toSorted(), ["Dir/A.md", "Dir/Sub/B.md"]);
  assert.deepEqual(log.events.filter(([name]) => name === "delete").map(([, path]) => path).toSorted(), ["Dir", "Dir/A.md", "Dir/Sub/B.md"]);
  assert.ok(!lookup(folder, "Dir"));
  assert.ok(lookup(folder, "Keep.md"));
});

test("a binary replacement rechecks live file identity and write policy after its awaited version read", async () => {
  for (const change of ["recreate", "rename", "read-only"]) {
    const originalBytes = new Uint8Array([0, 255, 1, 254]);
    const { vault, folder, host, app } = await fixture({ "Data/file.bin": originalBytes });
    const file = vault.getFileByPath("Data/file.bin"), request = host.request.bind(host);
    let reached, release, armed = true, writes = 0;
    const ready = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
    host.request = async (path, method, ...args) => {
      if (path === "/api/binary" && method === "PUT") writes++;
      const response = await request(path, method, ...args);
      if (armed && path.startsWith("/api/binary?") && method === "GET") { armed = false; reached(); await gate; }
      return response;
    };
    const operation = vault.modifyBinary(file, Uint8Array.of(9, 8, 7).buffer);
    const refused = assert.rejects(operation, error => change === "read-only" ? error.code === "VAULT_READ_ONLY" : /binary file changed/.test(error.message));
    await ready;
    if (change === "recreate") {
      await (await folder.getDirectoryHandle("Data")).removeEntry("file.bin"); await vault.refresh();
      await put(folder, "Data/file.bin", originalBytes); await vault.refresh();
      assert.notEqual(vault.getFileByPath("Data/file.bin"), file, "The replacement has the same bytes and path but a new live TFile");
    } else if (change === "rename") {
      await app.fileManager.renameFile(file, "Data/moved.bin");
    } else {
      vault.setSnapshot({ ...(await request("/api/vault", "GET")).value, readOnly: true });
    }
    release(); await refused;
    assert.equal(writes, 0, change + " must refuse before the actual binary write");
    assert.deepEqual(lookup(folder, change === "rename" ? "Data/moved.bin" : "Data/file.bin").bytes, originalBytes);
  }
});

test("adapter binary, remove, rmdir and rename use guarded paths and reject hidden or root paths", async () => {
  const { vault, folder, log } = await fixture({ "Data/seed.bin": Buffer.from([1, 2, 3]), "Data/Sub/x.md": "x\n" });
  const bytes = new Uint8Array([0, 255, 10, 13, 26]);
  await vault.adapter.writeBinary("Data/new.bin", bytes.buffer);
  assert.deepEqual([...new Uint8Array(await vault.adapter.readBinary("Data/new.bin"))], [...bytes]);
  await vault.adapter.writeBinary("Data/new.bin", new Uint8Array([9, 9]).buffer);
  assert.equal(dump(folder)["Data/new.bin"], "\u0009\u0009");
  assert.ok(log.events.some(([name, path]) => name === "modify" && path === "Data/new.bin"));
  await assert.rejects(vault.adapter.rmdir("Data", false), /not empty/);
  await assert.rejects(vault.adapter.readBinary(".obsidian/app.json"), /hidden|not supported/);
  await assert.rejects(vault.adapter.remove("/"), /root|not supported/);
  await vault.adapter.remove("Data/seed.bin");
  assert.ok(!lookup(folder, "Data/seed.bin"));
  await vault.adapter.rename("Data/Sub", "Data/Moved");
  assert.equal(dump(folder)["Data/Moved/x.md"], "x\n");
  await vault.adapter.rmdir("Data", true);
  assert.ok(!lookup(folder, "Data"));
  assert.equal(sha(Buffer.from(bytes)).length, 64);
});
