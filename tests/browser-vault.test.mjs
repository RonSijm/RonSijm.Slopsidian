import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, startHost } from "./host.mjs";
import { createHash } from "node:crypto";

let directory;
let BrowserVault;
let definitions;
let legacyIds;
let parsePropertyValue;
let inferPropertyType;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "browser-tests-"));
  const entry = join(directory, "browser-vault.mjs");
  await build({ stdin: { contents: 'export { BrowserVault } from "./client/browser-vault"; export { parsePropertyValue, inferPropertyType } from "./client/property-types";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  ({ BrowserVault, parsePropertyValue, inferPropertyType } = await import(pathToFileURL(entry).href));
  const host = await startHost();
  try {
    const snapshot = await (await host.request("/api/core")).json();
    definitions = snapshot.plugins.map(plugin => ({ ...plugin, defaultOn: plugin.configuredEnabled }));
    legacyIds = ["file-explorer", "templates", "daily-notes", "zk-prefixer", "random-note"];
  } finally {
    await host.stop();
  }
});
after(async () => {
  if (directory) {
    await rm(directory, { recursive: true });
  }
});

class Folder {
  kind = "directory";
  children = new Map();
  permission = "granted";
  failWrite = false;
  caseInsensitive = false;
  constructor(name, root) { this.name = name; this.root = root ?? this; }
  async isSameEntry(other) { return this === other; }
  async queryPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
  check() {
    if (this.root.permission !== "granted") {
      throw new DOMException("Fixture permission revoked", "NotAllowedError");
    }
  }
  async *entries() { this.check(); yield* this.children; }
  async getDirectoryHandle(name, options = {}) { return this.child(name, "directory", options.create); }
  async getFileHandle(name, options = {}) { return this.child(name, "file", options.create); }
  child(name, kind, create) {
    this.check();
    const key = this.root.caseInsensitive ? [...this.children.keys()].find(key => key.toLowerCase() === name.toLowerCase()) ?? name : name;
    let child = this.children.get(key);
    if (!child && create) {
      child = kind === "directory" ? new Folder(name, this.root) : new DiskFile(name, this.root);
      this.children.set(name, child);
    }
    if (!child) {
      throw new DOMException("Not found: " + name, "NotFoundError");
    }
    if (child.kind !== kind) {
      throw new DOMException("Wrong entry kind", "TypeMismatchError");
    }
    return child;
  }
  async removeEntry(name, options = {}) {
    this.check();
    const key = this.root.caseInsensitive ? [...this.children.keys()].find(key => key.toLowerCase() === name.toLowerCase()) ?? name : name;
    const child = this.children.get(key);
    if (!child) { throw new DOMException("Not found: " + name, "NotFoundError"); }
    if (child.kind === "directory" && child.children.size && !options.recursive) { throw new DOMException("Directory is not empty: " + name, "InvalidModificationError"); }
    this.children.delete(key);
  }
}
class DiskFile {
  kind = "file";
  bytes = new Uint8Array();
  modified = 1;
  constructor(name, root) { this.name = name; this.root = root; }
  async isSameEntry(other) { return this === other; }
  set(value) { this.bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); this.modified++; }
  async getFile() { this.root.check(); return new File([this.bytes], this.name, { lastModified: this.modified }); }
  async createWritable() {
    let bytes;
    return {
      write: async value => { bytes = new Uint8Array(value); },
      close: async () => {
        if (this.root.failWrite) {
          throw new DOMException("Fixture disk is full", "QuotaExceededError");
        }
        this.set(bytes);
      },
      abort: async () => {},
    };
  }
}
async function put(root, path, content) {
  const parts = path.split("/");
  let folder = root;
  for (const part of parts.slice(0, -1)) {
    folder = await folder.getDirectoryHandle(part, { create: true });
  }
  const file = await folder.getFileHandle(parts.at(-1), { create: true });
  file.set(content);
  return file;
}
async function fixture() {
  const folder = new Folder("Browser fixture");
  const records = new Map();
  const store = { list: async () => [...records.values()], put: async record => { records.set(record.id, record); } };
  const host = new BrowserVault(definitions, legacyIds, store);
  await host.initialize();
  const id = await host.select(folder);
  assert.equal((await host.request("/api/vault/open", "POST", { path: id })).status, 200);
  return { host, folder, id, store };
}
function data(response) { assert.equal(response.status, 200, response.error); return response.value; }

function browserCommunityBundle(id, pluginVersion = "1.0.0", styles = "\ufeff.fixture { color: red; }\r\n") {
  const manifest = Buffer.from("\ufeff" + JSON.stringify({ id, name: "Browser community fixture", version: pluginVersion, description: "Management never evaluates code", author: "Fixture author", authorUrl: "https://example.invalid/author", minAppVersion: "1.0.0", future: { exact: true } }, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  const code = Buffer.from(`\ufeffthrow new Error("Management must not execute ${pluginVersion}");\r\n`);
  const css = styles === null ? null : Buffer.from(styles);
  return { manifest, code, css, request: { version: null, manifestBase64: manifest.toString("base64"), codeBase64: code.toString("base64"), cssBase64: css?.toString("base64") ?? null } };
}
function browserCommunityFingerprint({ manifest, code, css }) {
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  return hash(hash(manifest) + "." + hash(code) + "." + (css === null ? "missing" : hash(css)));
}

test("browser original-workspace reads preserve exact bytes, reject foreign roots and expose no original-write route", async () => {
  const { host, folder, id } = await fixture(), url = "/api/workspace/original?root=" + encodeURIComponent(id);
  assert.equal(data(await host.request(url)).version, null); assert.equal(folder.children.has(".obsidian"), false);
  const original = { main: { future: true }, active: "kept" }, bytes = Buffer.from("\ufeff" + JSON.stringify(original) + "\r\n");
  const file = await put(folder, ".obsidian/workspace.json", bytes);
  const document = data(await host.request(url)); assert.deepEqual(document.data, original); assert.equal(document.version, createHash("sha256").update(bytes).digest("hex"));
  assert.equal((await host.request("/api/workspace/original?root=other")).status, 409);
  assert.ok((await host.request(url, "PUT", document)).status >= 400);
  assert.equal((await host.request("/api/configuration/workspace", "PUT", { root: id, data: {} })).status, 404);
  assert.deepEqual(Buffer.from(file.bytes), bytes);
  file.set("{"); assert.equal((await host.request(url)).status, 422); assert.equal(new TextDecoder().decode(file.bytes), "{");
  file.set(" ".repeat(1024 * 1024 + 1)); assert.equal((await host.request(url)).status, 413);
});

test("browser community enabled IDs retain exact existing BOM bytes and absent plugins, with explicit versioned writes and visible malformed-data errors", async () => {
  const { host, folder, id, store } = await fixture();
  const url = "/api/community-plugins?root=" + encodeURIComponent(id);
  assert.deepEqual(data(await host.request(url)), { root: id, version: null, enabled: [] });
  assert.ok(!folder.children.has(".obsidian"), "An enablement read must not create configuration");
  const original = Buffer.from('\ufeff[\r\n "missing-plugin", "future-plugin", "missing-plugin"\r\n]\r\n');
  const file = await put(folder, ".obsidian/community-plugins.json", original);
  const before = data(await host.request(url));
  assert.deepEqual(before.enabled, ["missing-plugin", "future-plugin"]);
  assert.equal(before.version, createHash("sha256").update(original).digest("hex"));
  assert.deepEqual(file.bytes, new Uint8Array(original));
  for (const [body, status] of [
    [{ root: "stale-root", version: before.version, enabled: [] }, 409],
    [{ root: id, version: null, enabled: [] }, 409],
    [{ root: id, version: before.version, enabled: ["duplicate", "duplicate"] }, 400],
    [{ root: id, version: before.version, enabled: ["CON"] }, 400],
    [{ root: id, version: before.version, enabled: Array(4097).fill("bounded") }, 400],
  ]) {
    assert.equal((await host.request("/api/community-plugins", "PUT", body)).status, status);
    assert.deepEqual(file.bytes, new Uint8Array(original));
  }
  const saved = data(await host.request("/api/community-plugins", "PUT", { root: id, version: before.version, enabled: ["missing-plugin", "new-plugin"] }));
  assert.deepEqual([...file.bytes.subarray(0, 3)], [239, 187, 191]);
  const bytes = file.bytes.slice();
  assert.equal((await host.request("/api/community-plugins", "PUT", { root: id, version: before.version, enabled: [] })).status, 409);
  assert.deepEqual(file.bytes, bytes);
  const reconnected = new BrowserVault(definitions, legacyIds, store); await reconnected.initialize(); await reconnected.reconnect(id);
  data(await reconnected.request("/api/vault/open", "POST", { path: id }));
  assert.deepEqual(data(await reconnected.request(url)), saved);
  const getFile = file.getFile.bind(file), writable = file.createWritable.bind(file);
  let armed = true, failMetadata = false;
  file.createWritable = async () => {
    const stream = await writable(), close = stream.close;
    stream.close = async () => { await close(); if (armed) { armed = false; failMetadata = true; } };
    return stream;
  };
  file.getFile = async () => {
    if (failMetadata) { failMetadata = false; throw new DOMException("Expected configuration acknowledgement failure", "NotReadableError"); }
    return getFile();
  };
  assert.equal((await host.request("/api/community-plugins", "PUT", { root: id, version: saved.version, enabled: ["must-roll-back"] })).status, 409);
  assert.deepEqual(file.bytes, bytes, "A failed post-commit acknowledgement restores the exact prior BOM/configuration bytes");
  file.getFile = getFile; file.createWritable = writable;
  for (const invalid of [Buffer.from("\ufeff{}\r\n"), Buffer.from('["valid", 1]'), Buffer.from("[invalid"), Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28])]) {
    file.set(invalid);
    assert.equal((await host.request(url)).status, 422);
    assert.equal((await host.request("/api/community-plugins", "PUT", { root: id, version: createHash("sha256").update(invalid).digest("hex"), enabled: [] })).status, 422);
    assert.deepEqual(file.bytes, new Uint8Array(invalid));
  }
});

test("browser community installation preserves downloaded BOM/CRLF bytes without enabling or executing and refuses unsafe or incomplete packages", async () => {
  const { host, folder, id } = await fixture();
  const pluginId = "community-exact", api = "/api/community-plugins/" + pluginId, bundle = browserCommunityBundle(pluginId);
  const enabled = await put(folder, ".obsidian/community-plugins.json", '\ufeff["not-installed"]\r\n'), enabledBytes = enabled.bytes.slice();
  for (const badId of ["CON", "nul", "COM1", "_invalid", "bad.id", "bad\n", "a".repeat(129)]) {
    assert.equal((await host.request("/api/community-plugins/" + encodeURIComponent(badId), "POST", { root: id, ...bundle.request })).status, 400);
  }
  for (const [body, status] of [
    [{ root: "stale-root", ...bundle.request }, 409],
    [{ root: id, ...bundle.request, manifestBase64: Buffer.from('{"id":"wrong","name":"Wrong","version":"1","description":"Wrong"}').toString("base64") }, 422],
    [{ root: id, ...bundle.request, manifestBase64: Buffer.from('{"id":"community-exact","version":"1","description":"Missing name"}').toString("base64") }, 422],
    [{ root: id, ...bundle.request, codeBase64: "AR==" }, 400],
    [{ root: id, ...bundle.request, codeBase64: "wyg=" }, 422],
    [{ root: id, ...bundle.request, cssBase64: "YQ==\r\n" }, 400],
  ]) {
    assert.equal((await host.request(api, "POST", body)).status, status);
    assert.ok(!(await folder.getDirectoryHandle(".obsidian")).children.has("plugins"));
    assert.deepEqual(enabled.bytes, enabledBytes);
  }
  for (const [key, limit] of [["manifestBase64", 64 * 1024], ["codeBase64", 16 * 1024 * 1024], ["cssBase64", 4 * 1024 * 1024]]) {
    assert.notEqual((await host.request(api, "POST", { root: id, ...bundle.request, [key]: Buffer.alloc(limit + 1, 32).toString("base64") })).status, 200);
  }
  const plugins = await (await folder.getDirectoryHandle(".obsidian")).getDirectoryHandle("plugins", { create: true });
  await plugins.getDirectoryHandle(pluginId, { create: true });
  assert.equal((await host.request(api, "POST", { root: id, ...bundle.request })).status, 409);
  assert.equal((await plugins.getDirectoryHandle(pluginId)).children.size, 0);
  await plugins.removeEntry(pluginId);
  const snapshot = data(await host.request(api, "POST", { root: id, ...bundle.request }));
  assert.ok(snapshot.plugins.some(plugin => plugin.id === pluginId));
  const installed = data(await host.request(api + "?root=" + encodeURIComponent(id)));
  assert.equal(installed.version, browserCommunityFingerprint(bundle));
  assert.equal(installed.manifest.author, "Fixture author");
  assert.equal(installed.manifest.authorUrl, "https://example.invalid/author");
  assert.equal(installed.manifest.minAppVersion, "1.0.0");
  const plugin = await plugins.getDirectoryHandle(pluginId);
  for (const [name, bytes] of [["manifest.json", bundle.manifest], ["main.js", bundle.code], ["styles.css", bundle.css]]) { assert.deepEqual((await plugin.getFileHandle(name)).bytes, new Uint8Array(bytes)); }
  assert.deepEqual(enabled.bytes, enabledBytes);
  assert.equal(data(await host.request("/api/plugins/" + pluginId)).manifest.author, "Fixture author");
  assert.equal((await host.request("/api/file?path=" + encodeURIComponent(".obsidian/plugins/" + pluginId + "/main.js"))).status, 400);
  assert.equal((await host.request(api, "POST", { root: id, ...bundle.request })).status, 409);
  await plugin.removeEntry("main.js");
  assert.equal((await host.request(api + "?root=" + encodeURIComponent(id))).status, 404);
  assert.equal((await host.request(api, "POST", { root: id, ...bundle.request, version: installed.version })).status, 404);
  assert.equal((await host.request(api, "DELETE", { root: id, version: installed.version })).status, 404);
  assert.deepEqual((await plugin.getFileHandle("manifest.json")).bytes, new Uint8Array(bundle.manifest));
});

test("browser community updates preserve data and other files, remove obsolete styles, guard stale packages and uninstall only the selected plugin", async () => {
  const { host, folder, id } = await fixture();
  const pluginId = "community-managed", api = "/api/community-plugins/" + pluginId, initial = browserCommunityBundle(pluginId);
  data(await host.request(api, "POST", { root: id, ...initial.request }));
  const plugins = await directoryHandle(folder, ".obsidian/plugins"), plugin = await plugins.getDirectoryHandle(pluginId);
  const dataFile = await put(folder, `.obsidian/plugins/${pluginId}/data.json`, '\ufeff{"retain":"plugin-owned"}\r\n');
  const opaque = await put(folder, `.obsidian/plugins/${pluginId}/assets/opaque.bin`, new Uint8Array([0, 255, 128, 13, 10]));
  const dataBytes = dataFile.bytes.slice(), opaqueBytes = opaque.bytes.slice(), url = api + "?root=" + encodeURIComponent(id);
  const before = data(await host.request(url));
  assert.equal(before.version, browserCommunityFingerprint(initial));
  const update = browserCommunityBundle(pluginId, "2.0.0", null);
  data(await host.request(api, "POST", { root: id, ...update.request, version: before.version }));
  const after = data(await host.request(url));
  assert.equal(after.version, browserCommunityFingerprint(update));
  assert.deepEqual((await plugin.getFileHandle("manifest.json")).bytes, new Uint8Array(update.manifest));
  assert.deepEqual((await plugin.getFileHandle("main.js")).bytes, new Uint8Array(update.code));
  assert.ok(!plugin.children.has("styles.css"));
  assert.deepEqual(dataFile.bytes, dataBytes); assert.deepEqual(opaque.bytes, opaqueBytes);
  const main = await plugin.getFileHandle("main.js"); main.set("\ufeff// Newer external code\r\n");
  const external = main.bytes.slice();
  for (const body of [{ root: id, ...initial.request, version: before.version }, { root: id, ...initial.request, version: after.version }, { root: "other-root", ...initial.request, version: after.version }]) {
    assert.equal((await host.request(api, "POST", body)).status, 409);
    assert.deepEqual(main.bytes, external);
    assert.deepEqual((await plugin.getFileHandle("manifest.json")).bytes, new Uint8Array(update.manifest));
    assert.deepEqual(dataFile.bytes, dataBytes);
  }
  const enabled = await put(folder, ".obsidian/community-plugins.json", '\ufeff["not-installed"]\r\n'), enabledBytes = enabled.bytes.slice();
  const sibling = browserCommunityBundle("community-keep");
  data(await host.request("/api/community-plugins/community-keep", "POST", { root: id, ...sibling.request }));
  const current = data(await host.request(url));
  for (const body of [{ root: id, version: after.version }, { root: "other-root", version: current.version }]) {
    assert.equal((await host.request(api, "DELETE", body)).status, 409);
    assert.deepEqual(dataFile.bytes, dataBytes);
  }
  const removed = data(await host.request(api, "DELETE", { root: id, version: current.version }));
  assert.ok(!removed.plugins.some(plugin => plugin.id === pluginId));
  assert.ok(!plugins.children.has(pluginId));
  assert.deepEqual((await (await plugins.getDirectoryHandle("community-keep")).getFileHandle("main.js")).bytes, new Uint8Array(sibling.code));
  assert.deepEqual(enabled.bytes, enabledBytes);
  assert.equal((await directoryHandle(folder, ".obsidian/vault-dotnet-transactions")).children.size, 0);
});

test("browser community rollback restores owned bytes and deleted CSS while preserving detectable foreign replacements and late uninstall files", async () => {
  for (const external of [false, true]) {
    const { host, folder, id } = await fixture();
    const pluginId = "community-rollback", api = "/api/community-plugins/" + pluginId;
    const initial = browserCommunityBundle(pluginId), update = browserCommunityBundle(pluginId, "2.0.0", null);
    data(await host.request(api, "POST", { root: id, ...initial.request }));
    const plugin = await directoryHandle(folder, ".obsidian/plugins/" + pluginId), manifest = await plugin.getFileHandle("manifest.json");
    const before = data(await host.request(api + "?root=" + encodeURIComponent(id)));
    let replacement;
    manifest.createWritable = async () => ({
      write: async () => {},
      close: async () => {
        if (external) { replacement = new DiskFile("main.js", folder); replacement.set(update.code); plugin.children.set("main.js", replacement); }
        throw new DOMException("Expected manifest write failure", "QuotaExceededError");
      },
      abort: async () => {},
    });
    const result = await host.request(api, "POST", { root: id, ...update.request, version: before.version });
    assert.equal(result.status, external ? 500 : 507);
    assert.deepEqual(manifest.bytes, new Uint8Array(initial.manifest));
    assert.deepEqual((await plugin.getFileHandle("styles.css")).bytes, new Uint8Array(initial.css));
    if (external) {
      assert.match(result.error, /rollback.*incomplete.*Newer external bytes were retained/);
      assert.equal(await plugin.getFileHandle("main.js"), replacement);
      assert.deepEqual(replacement.bytes, new Uint8Array(update.code));
      assert.ok((await directoryHandle(folder, ".obsidian/vault-dotnet-transactions")).children.size > 0, "Original recovery assets remain available");
    } else {
      assert.deepEqual((await plugin.getFileHandle("main.js")).bytes, new Uint8Array(initial.code));
      assert.equal((await directoryHandle(folder, ".obsidian/vault-dotnet-transactions")).children.size, 0);
    }
  }
  const { host, folder, id } = await fixture();
  const pluginId = "community-uninstall-race", api = "/api/community-plugins/" + pluginId, initial = browserCommunityBundle(pluginId);
  data(await host.request(api, "POST", { root: id, ...initial.request }));
  const plugin = await directoryHandle(folder, ".obsidian/plugins/" + pluginId), remove = plugin.removeEntry.bind(plugin);
  plugin.removeEntry = async (name, options) => {
    await remove(name, options);
    if (name === "manifest.json") { const late = await plugin.getFileHandle("late.dat", { create: true }); late.set("New external plugin data"); }
  };
  const before = data(await host.request(api + "?root=" + encodeURIComponent(id)));
  const result = await host.request(api, "DELETE", { root: id, version: before.version });
  assert.equal(result.status, 409);
  assert.equal(await (await (await plugin.getFileHandle("late.dat")).getFile()).text(), "New external plugin data");
  for (const [name, bytes] of [["manifest.json", initial.manifest], ["main.js", initial.code], ["styles.css", initial.css]]) { assert.deepEqual((await plugin.getFileHandle(name)).bytes, new Uint8Array(bytes)); }
});

async function directoryHandle(root, path) {
  for (const part of path.split("/")) { root = await root.getDirectoryHandle(part); }
  return root;
}

test("browser adapter stats read hidden file handles without widening note paths or masking denied access", async () => {
  const { host, folder, id } = await fixture();
  const file = await put(folder, ".obsidian/plugins/stat-probe/data.json", '{ "value": "\u03bb" }\r\n');
  await put(folder, ".obsidian/empty.json", "");
  await put(folder, "Visible.md", "Visible note");
  const url = path => "/api/adapter/stat?" + new URLSearchParams({ root: id, path });
  assert.deepEqual(data(await host.request(url(".obsidian/plugins/stat-probe/data.json"))), { type: "file", ctime: 0, mtime: file.modified, size: file.bytes.length });
  assert.equal(data(await host.request(url(".obsidian/empty.json"))).size, 0);
  assert.deepEqual(data(await host.request(url(".obsidian"))), { type: "folder", ctime: 0, mtime: 0, size: 0 });
  assert.equal(data(await host.request(url("/"))).type, "folder");
  assert.equal(data(await host.request(url("Visible.md"))).type, "file");
  assert.equal(data(await host.request(url(".obsidian/plugins/stat-probe/missing.json"))), null);
  assert.equal(data(await host.request(url("Visible.md/child"))), null);
  for (const invalid of ["../Outside", ".obsidian/../Outside", "C:\\Windows\\win.ini", "/outside", "file:stream", "CON"]) {
    assert.equal((await host.request(url(invalid))).status, 400, invalid);
  }
  assert.equal((await host.request("/api/adapter/stat?" + new URLSearchParams({ root: "stale-root", path: "/" }))).status, 409);
  assert.equal((await host.request("/api/file?path=" + encodeURIComponent(".obsidian/empty.json"))).status, 400);
  folder.permission = "denied";
  assert.equal((await host.request(url(".obsidian/empty.json"))).status, 403);
  assert.equal((await host.request(url("/"))).status, 403);
});

test("browser adapter folders persist hidden assets while retaining visible-path, permission, collision and selected-root guards", async () => {
  const { host, folder, id } = await fixture();
  const path = ".obsidian/icons/custom/nested";
  assert.deepEqual(data(await host.request("/api/adapter/folder", "POST", { root: id, path })).folders, []);
  await put(folder, ".obsidian/icons/custom/keep.svg", "<svg></svg>");
  const url = path => "/api/adapter/list?" + new URLSearchParams({ root: id, path });
  assert.deepEqual(data(await host.request(url(".obsidian/icons/custom"))), { files: [".obsidian/icons/custom/keep.svg"], folders: [path] });
  assert.equal((await host.request("/api/adapter/folder", "POST", { root: id, path })).status, 409);
  assert.equal((await host.request("/api/files/folders", "POST", { root: id, path: ".obsidian/no-visible-folder" })).status, 400);
  for (const invalid of ["../Outside", ".obsidian/../Outside", "C:\\Outside", "CON", "Trailing."]) {
    assert.equal((await host.request("/api/adapter/folder", "POST", { root: id, path: invalid })).status, 400);
    assert.equal((await host.request(url(invalid))).status, 400);
  }
  assert.equal((await host.request("/api/adapter/folder", "POST", { root: "stale-root", path: ".obsidian/stale" })).status, 409);
  assert.equal((await host.request("/api/adapter/list?" + new URLSearchParams({ root: "stale-root", path: "/" }))).status, 409);
  folder.permission = "denied";
  assert.equal((await host.request(url(".obsidian/icons/custom"))).status, 403);
  assert.equal((await host.request("/api/adapter/folder", "POST", { root: id, path: ".obsidian/denied" })).status, 403);
});

test("browser binary create/read and audio resources preserve exact bytes with root/path/collision guards and handle reconnect", async () => {
  const { host, folder, id, store } = await fixture();
  const bytes = new Uint8Array([239, 187, 191, 0, 255, 128, 26, 69, 223, 163]);
  const base64 = Buffer.from(bytes).toString("base64"), path = "Recordings/clip.webm";
  const saved = data(await host.request("/api/binary", "POST", { root: id, path, base64 }));
  const handle = await (await folder.getDirectoryHandle("Recordings")).getFileHandle("clip.webm");
  assert.deepEqual(handle.bytes, bytes);
  const url = "/api/binary?" + new URLSearchParams({ root: id, path });
  assert.equal(data(await host.request(url)).base64, base64);
  const resource = data(await host.request("/api/resource?" + new URLSearchParams({ root: id, path })));
  assert.deepEqual(resource, { contentType: "audio/webm", base64 });
  for (const [root, target, value, status] of [[id, path, "AA==", 409], ["other-vault", "New.webm", "AA==", 409], [id, "../Escape.webm", "AA==", 400], [id, ".obsidian/Hidden.webm", "AA==", 400], [id, "Bad.webm", "AR==", 400]]) {
    assert.equal((await host.request("/api/binary", "POST", { root, path: target, base64: value })).status, status);
    assert.deepEqual(handle.bytes, bytes);
  }
  const reconnected = new BrowserVault(definitions, legacyIds, store); await reconnected.initialize(); await reconnected.reconnect(id);
  data(await reconnected.request("/api/vault/open", "POST", { path: id }));
  assert.equal(data(await reconnected.request(url)).version, saved.version);
});

test("browser binary creation retains late external files and rejects a changed new file before commit", async () => {
  for (const stage of ["create", "write"]) {
    const { host, folder, id } = await fixture();
    const original = folder.getFileHandle.bind(folder);
    let raced;
    folder.getFileHandle = async (name, options = {}) => {
      const file = await original(name, options);
      if (options.create && name === "Race.webm") {
        raced = file;
        if (stage === "create") { file.set("External file must survive"); }
        else {
          const writable = file.createWritable.bind(file);
          file.createWritable = async () => {
            const stream = await writable();
            const write = stream.write.bind(stream);
            stream.write = async bytes => { await write(bytes); file.set("External file must survive"); };
            return stream;
          };
        }
      }
      return file;
    };
    const save = () => host.request("/api/binary", "POST", { root: id, path: "Race.webm", base64: "AA==" });
    if (stage === "write") { await assert.rejects(save(), /Saving Race.webm failed/); }
    else { assert.equal((await save()).status, 409); }
    assert.equal(new TextDecoder().decode(raced.bytes), "External file must survive");
  }
});

test("browser recovery history preserves BOM and opaque data, guards stale/root writes and survives handle reconnect", async () => {
  const { host, folder, id, store } = await fixture();
  const original = { version: 1, snapshots: [], future: { keep: true } };
  const history = await put(folder, ".obsidian/vault-dotnet-recovery.json", "\ufeff" + JSON.stringify(original));
  await put(folder, "BOM.md", "\ufeff# Note\r\n");
  assert.equal(data(await host.request("/api/file?path=BOM.md")).hasBom, true);
  const url = "/api/configuration/vault-dotnet-recovery?root=" + encodeURIComponent(id);
  const before = data(await host.request(url));
  const updated = { ...original, snapshots: [{ id: "snapshot", path: "BOM.md", ts: 1000, content: "# Note\r\n", hasBom: true, sourceVersion: null, reason: "manual" }] };
  const saved = data(await host.request("/api/configuration/vault-dotnet-recovery", "PUT", { root: id, version: before.version, data: updated }));
  assert.deepEqual([...history.bytes.slice(0, 3)], [239, 187, 191]);
  const bytes = history.bytes.slice();
  for (const [root, version] of [[id, before.version], ["another-vault", saved.version]]) {
    assert.equal((await host.request("/api/configuration/vault-dotnet-recovery", "PUT", { root, version, data: {} })).status, 409);
    assert.deepEqual(history.bytes, bytes);
  }
  const reconnected = new BrowserVault(definitions, legacyIds, store); await reconnected.initialize();
  await reconnected.reconnect(id);
  data(await reconnected.request("/api/vault/open", "POST", { path: id }));
  assert.deepEqual(data(await reconnected.request(url)).data, updated);
});

test("browser recovery numeric settings validate without coercion or partial writes and retain unknown options", async () => {
  const { host, folder, id } = await fixture();
  const settings = await put(folder, ".obsidian/file-recovery.json", '{"future":{"keep":true}}');
  data(await host.request("/api/core/file-recovery/settings", "PUT", { root: id, values: { intervalMinutes: 0.25, keepDays: 3 } }));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(settings.bytes)), { future: { keep: true }, intervalMinutes: 0.25, keepDays: 3 });
  const before = settings.bytes.slice();
  for (const values of [{ intervalMinutes: "5" }, { intervalMinutes: -1 }, { intervalMinutes: 10081 }, { keepDays: 0 }, { keepDays: 3651 }]) {
    assert.equal((await host.request("/api/core/file-recovery/settings", "PUT", { root: id, values })).status, 400);
    assert.deepEqual(settings.bytes, before);
  }
});

test("browser file management creates real empty folders and moves/trashes arbitrary bytes with root/version guards", async () => {
  const { host, folder, id } = await fixture();
  const folders = data(await host.request("/api/files/folders", "POST", { root: id, path: "Empty/Nested" }));
  assert.deepEqual(folders.folders, ["Empty", "Empty/Nested"]);
  assert.equal((await host.request("/api/files/folders", "POST", { root: id, path: "Empty/Nested" })).status, 409);
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0, 0xff, 0xfe, 128, 13, 10]);
  await put(folder, "Assets/Original.bin", bytes);
  const source = data(await host.request("/api/files/info?" + new URLSearchParams({ root: id, path: "Assets/Original.bin" })));
  const request = { root: id, path: source.file.path, newPath: "Attachments/Renamed.bin", version: source.version };
  assert.equal((await host.request("/api/files/rename", "POST", { ...request, root: "stale" })).status, 409);
  assert.equal((await host.request("/api/files/rename", "POST", { ...request, version: "stale" })).status, 409);
  assert.equal((await host.request("/api/files/rename", "POST", { ...request, newPath: "../Escape.bin" })).status, 400);
  assert.equal((await host.request("/api/files/info?path=Assets/Original.bin")).status, 409);
  const moved = data(await host.request("/api/files/rename", "POST", request));
  assert.deepEqual(moved.documents, []);
  const target = await (await folder.getDirectoryHandle("Attachments")).getFileHandle("Renamed.bin");
  assert.deepEqual(new Uint8Array(await (await target.getFile()).arrayBuffer()), bytes);
  assert.equal((await folder.getDirectoryHandle("Assets")).children.size, 0);
  await put(folder, ".trash/Renamed.bin", "Keep the earlier trash file");
  const trashed = data(await host.request("/api/files/trash", "POST", { root: id, path: moved.newPath, version: source.version }));
  assert.match(trashed.trashPath, /^\.trash\/Renamed\..+\.bin$/);
  const trash = await folder.getDirectoryHandle(".trash");
  assert.deepEqual((await trash.getFileHandle(trashed.trashPath.split("/")[1])).bytes, bytes);
  assert.equal(await (await (await trash.getFileHandle("Renamed.bin")).getFile()).text(), "Keep the earlier trash file");
});

test("browser rename preflights Markdown and Canvas edits and preserves BOM/CRLF and explicit reference changes", async () => {
  const { host, folder, id } = await fixture();
  const original = await put(folder, "Source.md", "\ufeff# Source\r\n[[Source]]\r\n");
  const reference = await put(folder, "References/One.md", "\ufeff[[Source]]\r\n");
  const canvas = await put(folder, "Board.canvas", '\ufeff{"nodes":[],"future":"Source.md"}\r\n');
  const source = data(await host.request("/api/file?path=Source.md"));
  const ref = data(await host.request("/api/file?path=References%2FOne.md"));
  const board = data(await host.request("/api/file?path=Board.canvas"));
  const edits = [
    { path: "Source.md", version: source.version, content: "# Source\r\n[[Archive/Project]]\r\n" },
    { path: ref.file.path, version: ref.version, content: "[[Archive/Project]]\r\n" },
    { path: "Board.canvas", version: board.version, content: '{"nodes":[],"future":"Archive/Project.md"}\r\n' },
  ];
  const request = { root: id, path: "Source.md", newPath: "Archive/Project.md", version: source.version, edits };
  assert.equal((await host.request("/api/files/rename", "POST", { ...request, edits: [...edits.slice(0, 2), { ...edits[2], version: "stale" }] })).status, 409);
  assert.ok(!folder.children.has("Archive"));
  assert.equal(await (await original.getFile()).text(), source.content);
  const result = data(await host.request("/api/files/rename", "POST", request));
  assert.deepEqual(result.documents.map(document => document.file.path).sort(), ["Archive/Project.md", "Board.canvas", ref.file.path]);
  const moved = await (await folder.getDirectoryHandle("Archive")).getFileHandle("Project.md");
  assert.deepEqual(moved.bytes, new Uint8Array([239, 187, 191, ...new TextEncoder().encode(edits[0].content)]));
  assert.deepEqual(reference.bytes, new Uint8Array([239, 187, 191, ...new TextEncoder().encode(edits[1].content)]));
  assert.deepEqual(canvas.bytes, new Uint8Array([239, 187, 191, ...new TextEncoder().encode(edits[2].content)]));
});

test("browser move rollback restores written references and keeps newer external bytes on conflicts", async () => {
  for (const external of [false, true]) {
    const { host, folder, id } = await fixture();
    const source = await put(folder, "Source.md", "\ufeffOriginal source\r\n");
    const first = await put(folder, "First.md", "\ufeffOriginal first\r\n");
    const last = await put(folder, "Last.md", "Original last\n");
    const before = [source.bytes.slice(), first.bytes.slice(), last.bytes.slice()];
    const documents = await Promise.all(["Source.md", "First.md", "Last.md"].map(async path => data(await host.request("/api/file?path=" + path))));
    last.createWritable = async () => ({
      write: async () => {},
      close: async () => {
        if (external) { source.set("Newer external source"); first.set("Newer external reference"); }
        throw new DOMException("Expected reference write failure", "QuotaExceededError");
      },
      abort: async () => {},
    });
    const result = await host.request("/api/files/rename", "POST", {
      root: id, path: "Source.md", newPath: "Moved.md", version: documents[0].version,
      edits: documents.slice(1).map(document => ({ path: document.file.path, version: document.version, content: "Changed reference\r\n" })),
    });
    if (external) {
      assert.equal(result.status, 500);
      assert.match(result.error, /rollback is incomplete.*Moved\.md/);
      assert.equal(await (await source.getFile()).text(), "Newer external source");
      assert.equal(await (await first.getFile()).text(), "Newer external reference");
      assert.ok(folder.children.has("Moved.md"), "The recovery copy remains when rollback is incomplete");
    } else {
      assert.equal(result.status, 507);
      assert.deepEqual([source.bytes, first.bytes], before.slice(0, 2));
      assert.ok(!folder.children.has("Moved.md"));
    }
    assert.deepEqual(last.bytes, before[2]);
  }
});

test("browser moves undo committed copies when their metadata acknowledgement fails", async () => {
  for (const caseOnly of [false, true]) {
    const { host, folder, id } = await fixture();
    folder.caseInsensitive = caseOnly;
    const source = await put(folder, "Source.md", "\ufeff# Original\r\n");
    const original = source.bytes.slice();
    const info = data(await host.request("/api/files/info?" + new URLSearchParams({ root: id, path: "Source.md" })));
    const destination = caseOnly ? "source.md" : "Moved.md";
    const getFileHandle = folder.getFileHandle.bind(folder);
    folder.getFileHandle = async (name, options = {}) => {
      const file = await getFileHandle(name, options);
      if (name === destination && options.create) {
        const createWritable = file.createWritable.bind(file);
        const getFile = file.getFile.bind(file);
        let fail = false;
        file.createWritable = async () => {
          const stream = await createWritable();
          const close = stream.close;
          stream.close = async () => { await close(); fail = true; };
          return stream;
        };
        file.getFile = async () => {
          if (fail) { fail = false; throw new DOMException("Expected metadata acknowledgement failure", "NotReadableError"); }
          return getFile();
        };
      }
      return file;
    };
    const result = await host.request("/api/files/rename", "POST", { root: id, path: "Source.md", newPath: destination, version: info.version });
    assert.notEqual(result.status, 200);
    assert.match(result.error, /metadata acknowledgement failure/);
    assert.ok(folder.children.has("Source.md"), "The original physical filename is restored");
    assert.ok(!folder.children.has(destination), "The acknowledged or unacknowledged destination copy is removed");
    assert.deepEqual((await getFileHandle("Source.md")).bytes, original);
    if (caseOnly) {
      const transactions = await (await folder.getDirectoryHandle(".obsidian")).getDirectoryHandle("vault-dotnet-transactions");
      assert.equal(transactions.children.size, 0);
    }
  }
});

test("browser rollback retains an externally replaced destination even when its bytes match the recovery copy", async () => {
  const { host, folder, id } = await fixture();
  const source = await put(folder, "Source.md", "# Original\n");
  const reference = await put(folder, "Reference.md", "[[Source]]\n");
  const documents = await Promise.all(["Source.md", "Reference.md"].map(async path => data(await host.request("/api/file?path=" + path))));
  let replacement;
  reference.createWritable = async () => ({
    write: async () => {},
    close: async () => {
      replacement = new DiskFile("Moved.md", folder);
      replacement.set(source.bytes);
      folder.children.set("Moved.md", replacement);
      throw new DOMException("Expected reference failure after replacement", "QuotaExceededError");
    },
    abort: async () => {},
  });
  const result = await host.request("/api/files/rename", "POST", {
    root: id, path: "Source.md", newPath: "Moved.md", version: documents[0].version,
    edits: [{ path: "Reference.md", version: documents[1].version, content: "[[Moved]]\n" }],
  });
  assert.equal(result.status, 500);
  assert.match(result.error, /rollback is incomplete.*replaced.*Moved\.md/);
  assert.equal(folder.children.get("Moved.md"), replacement);
  assert.equal(await (await source.getFile()).text(), documents[0].content);
  assert.equal(await (await reference.getFile()).text(), documents[1].content);
});

test("browser case-only Windows renames stage exact bytes and return the actual new filename", async () => {
  const { host, folder, id } = await fixture();
  folder.caseInsensitive = true;
  const source = await put(folder, "Case.md", "\ufeff# Exact case\r\n");
  const bytes = source.bytes.slice();
  const info = data(await host.request("/api/files/info?" + new URLSearchParams({ root: id, path: "Case.md" })));
  const result = data(await host.request("/api/files/rename", "POST", { root: id, path: "Case.md", newPath: "case.md", version: info.version }));
  assert.ok(folder.children.has("case.md"));
  assert.ok(!folder.children.has("Case.md"));
  assert.deepEqual((await folder.getFileHandle("case.md")).bytes, bytes);
  assert.equal(result.documents[0].file.path, "case.md");
  const transactions = await (await folder.getDirectoryHandle(".obsidian")).getDirectoryHandle("vault-dotnet-transactions");
  assert.equal(transactions.children.size, 0);
});

test("browser case-only moves recognize Chromium's distinct alias handles without treating different case-sensitive files as aliases", async () => {
  for (const caseSensitive of [false, true]) {
    const { host, folder, id } = await fixture();
    folder.caseInsensitive = !caseSensitive;
    const source = await put(folder, "Case.md", "# Preserve original\n");
    const original = source.bytes.slice();
    let occupied;
    if (caseSensitive) { occupied = await put(folder, "case.md", "A different file\n"); }
    const info = data(await host.request("/api/files/info?" + new URLSearchParams({ root: id, path: "Case.md" })));
    const getFileHandle = folder.getFileHandle.bind(folder);
    folder.getFileHandle = async (name, options = {}) => {
      const file = await getFileHandle(name, options);
      if (!caseSensitive && name !== file.name) {
        return { kind: "file", name, isSameEntry: async other => other.name === name, getFile: () => file.getFile(), createWritable: () => file.createWritable() };
      }
      return file;
    };
    const result = await host.request("/api/files/rename", "POST", { root: id, path: "Case.md", newPath: "case.md", version: info.version });
    if (caseSensitive) {
      assert.equal(result.status, 409);
      assert.equal(folder.children.get("case.md"), occupied);
      assert.deepEqual(source.bytes, original);
    } else {
      assert.equal(result.status, 200, result.error);
      assert.ok(!folder.children.has("Case.md"));
      assert.deepEqual(folder.children.get("case.md").bytes, original);
    }
  }
});

test("typed properties reject lossy numbers, invalid calendar values and unsupported types without coercing them", () => {
  assert.equal(parsePropertyValue("number", "+001.2500"), 1.25);
  for (const value of ["", "Infinity", "NaN", "12junk", "9007199254740993", "0.1234567890123456789", "1e-4000"]) {
    assert.throws(() => parsePropertyValue("number", value), /number|precision/);
  }
  assert.equal(parsePropertyValue("date", "2024-02-29"), "2024-02-29");
  assert.throws(() => parsePropertyValue("date", "2025-02-29"), /valid/);
  assert.equal(parsePropertyValue("datetime", "2026-10-21T12:30:00Z"), "2026-10-21T12:30:00Z");
  assert.throws(() => parsePropertyValue("datetime", "2026-02-30T12:30"), /valid/);
  assert.deepEqual(parsePropertyValue("multitext", "one\r\ntwo\n\n"), ["one", "two"]);
  assert.equal(parsePropertyValue("checkbox", "", true), true);
  assert.throws(() => parsePropertyValue("future-widget", "value"), /not implemented/);
  assert.equal(inferPropertyType("2026-10-21"), "date");
  assert.equal(inferPropertyType({ preserve: true }), "unknown");
});

test("browser permanent deletion removes only actual versioned files without trash, preserves empty folders and survives reconnect", async () => {
  const { host, folder, id, store } = await fixture();
  const keep = await put(folder, "Keep.md", "\ufeffKeep these bytes.\r\n");
  const original = keep.bytes.slice();
  for (const [path, bytes] of [
    ["Delete/Nested/Empty.md", new Uint8Array()],
    ["Delete/Nested/Binary.bin", new Uint8Array([0, 255, 254, 128, 13, 10])],
  ]) {
    await put(folder, path, bytes);
    const before = data(await host.request("/api/files/info?" + new URLSearchParams({ root: id, path })));
    const body = { root: id, path, version: before.version };
    const result = data(await host.request("/api/files/delete", "POST", body));
    assert.equal(result.path, path);
    assert.equal(result.snapshot.files.some(file => file.path === path), false);
    assert.ok(result.snapshot.folders.includes("Delete/Nested"));
    assert.equal((await host.request("/api/files/delete", "POST", body)).status, 404);
  }
  assert.deepEqual(keep.bytes, original);
  assert.equal(folder.children.has(".trash"), false);
  const nested = await (await folder.getDirectoryHandle("Delete")).getDirectoryHandle("Nested");
  assert.equal(nested.children.size, 0);
  const restarted = new BrowserVault(definitions, legacyIds, store);
  await restarted.initialize();
  await restarted.reconnect(id);
  data(await restarted.request("/api/vault/open", "POST", { path: id }));
  assert.deepEqual(data(await restarted.request("/api/vault")).files.map(file => file.path), ["Keep.md"]);
});

test("browser permanent deletion acknowledges case aliases without removing a distinct case-sensitive sibling from inventory", async () => {
  for (const caseInsensitive of [true, false]) {
    const { host, folder, id } = await fixture();
    folder.caseInsensitive = caseInsensitive;
    await put(folder, "Nested/Keep.bin", new Uint8Array([255, 0, 128]));
    const sibling = caseInsensitive ? null : await put(folder, "Nested/KEEP.bin", new Uint8Array([7, 8, 9]));
    const path = caseInsensitive ? "nested/KEEP.BIN" : "Nested/Keep.bin";
    const before = data(await host.request("/api/files/info?" + new URLSearchParams({ root: id, path })));
    const result = data(await host.request("/api/files/delete", "POST", { root: id, path, version: before.version }));
    assert.equal(result.snapshot.files.some(file => file.path === "Nested/Keep.bin"), false);
    if (sibling) {
      assert.equal(result.snapshot.files.some(file => file.path === "Nested/KEEP.bin"), true);
      assert.equal((await folder.getDirectoryHandle("Nested")).children.get("KEEP.bin"), sibling);
      assert.deepEqual(sibling.bytes, new Uint8Array([7, 8, 9]));
    }
  }
});

test("browser permanent deletion rejects stale roots, paths, versions, replacement handles and failed removals without losing external bytes", async () => {
  const { host, folder, id } = await fixture();
  const source = await put(folder, "Keep.md", "Original\r\n");
  const original = source.bytes.slice();
  const before = data(await host.request("/api/files/info?" + new URLSearchParams({ root: id, path: "Keep.md" })));
  const body = { root: id, path: "Keep.md", version: before.version };
  for (const [change, status] of [
    [{ root: null }, 409], [{ root: "stale-root" }, 409], [{ version: null }, 428], [{ version: "stale" }, 409],
    [{ path: "../Keep.md" }, 400], [{ path: ".obsidian/workspace.json" }, 400], [{ path: "/" }, 400],
  ]) {
    assert.equal((await host.request("/api/files/delete", "POST", { ...body, ...change })).status, status);
    assert.deepEqual(source.bytes, original);
    assert.equal(folder.children.get("Keep.md"), source);
  }
  await folder.getDirectoryHandle("Folder", { create: true });
  assert.equal((await host.request("/api/files/delete", "POST", { ...body, path: "Folder" })).status, 409);
  source.set("Newer external bytes\r\n");
  assert.equal((await host.request("/api/files/delete", "POST", body)).status, 409);
  assert.equal(await (await source.getFile()).text(), "Newer external bytes\r\n");
  source.set(original);
  const entries = folder.entries.bind(folder);
  let replacement;
  folder.entries = async function* () {
    replacement = new DiskFile("Keep.md", folder);
    replacement.set(original);
    folder.children.set("Keep.md", replacement);
    yield* entries();
  };
  const replaced = await host.request("/api/files/delete", "POST", body);
  assert.equal(replaced.status, 409);
  assert.match(replaced.error, /replaced/);
  assert.equal(folder.children.get("Keep.md"), replacement);
  assert.deepEqual(replacement.bytes, original, "Even a replacement with identical bytes must retain its new handle");
  folder.entries = entries;
  const remove = folder.removeEntry.bind(folder);
  folder.removeEntry = async () => { throw new DOMException("Expected permanent-delete denial", "NotAllowedError"); };
  assert.equal((await host.request("/api/files/delete", "POST", body)).status, 403);
  assert.equal(folder.children.get("Keep.md"), replacement);
  assert.deepEqual(replacement.bytes, original);
  folder.removeEntry = remove;
  data(await host.request("/api/files/delete", "POST", body));
  assert.equal(folder.children.has("Keep.md"), false);
});

test("browser Markdown batches preflight every version/path and retain BOM/CRLF without partial stale writes", async () => {
  const { host, folder, id } = await fixture();
  const first = await put(folder, "First.md", "\ufeff---\r\namount: 1\r\n---\r\nBody A\r\n");
  const second = await put(folder, "Second.md", "---\namount: 2\n---\nBody B\n");
  const before = await Promise.all(["First.md", "Second.md"].map(async path => data(await host.request("/api/file?path=" + path))));
  const edits = before.map(document => ({ path: document.file.path, version: document.version, content: document.content.replace("amount:", "renamed:") }));
  const original = [first.bytes.slice(), second.bytes.slice()];
  assert.equal((await host.request("/api/files/edit", "POST", { root: id, edits: [edits[0], { ...edits[1], version: "stale" }] })).status, 409);
  assert.deepEqual([first.bytes, second.bytes], original);
  assert.equal((await host.request("/api/files/edit", "POST", { root: "stale", edits })).status, 409);
  assert.equal((await host.request("/api/files/edit", "POST", { root: id, edits: [edits[0], edits[0]] })).status, 400);
  assert.equal((await host.request("/api/files/edit", "POST", { root: id, edits: [{ ...edits[0], content: "\ud800" }] })).status, 400);
  assert.equal((await host.request("/api/files/edit", "POST", { root: id, edits: [{ ...edits[0], path: "Attachment.bin" }] })).status, 400);
  assert.deepEqual([first.bytes, second.bytes], original);
  const result = data(await host.request("/api/files/edit", "POST", { root: id, edits }));
  assert.equal(result.snapshot.root, id);
  assert.equal(result.documents.length, 2);
  assert.equal(await (await first.getFile()).text(), edits[0].content);
  assert.deepEqual(first.bytes.subarray(0, 3), new Uint8Array([0xef, 0xbb, 0xbf]));
  assert.equal(await (await second.getFile()).text(), edits[1].content);
});

test("browser edit batches roll back already-written files on later write failure and retain newer external bytes on rollback conflicts", async () => {
  for (const externalConflict of [false, true]) {
    const { host, folder, id } = await fixture();
    const first = await put(folder, "First.md", "\ufeffOriginal first\r\n");
    const second = await put(folder, "Second.md", "Original second\n");
    const original = [first.bytes.slice(), second.bytes.slice()];
    const documents = await Promise.all(["First.md", "Second.md"].map(async path => data(await host.request("/api/file?path=" + path))));
    const edits = documents.map(document => ({ path: document.file.path, version: document.version, content: "Batch changed " + document.file.path + "\r\n" }));
    second.createWritable = async () => ({
      write: async () => {},
      close: async () => {
        if (externalConflict) { first.set("Newer external first\n"); }
        throw new DOMException("Expected second-file write failure", "QuotaExceededError");
      },
      abort: async () => {},
    });
    const result = await host.request("/api/files/edit", "POST", { root: id, edits });
    if (externalConflict) {
      assert.equal(result.status, 500);
      assert.match(result.error, /could not completely roll back.*First\.md/);
      assert.equal(await (await first.getFile()).text(), "Newer external first\n");
    } else {
      assert.equal(result.status, 507);
      assert.deepEqual(first.bytes, original[0]);
    }
    assert.deepEqual(second.bytes, original[1]);
  }
});

test("browser extraction creation is version-guarded and rolls back new targets without deleting newer external bytes", async () => {
  for (const externalConflict of [false, true]) {
    const { host, folder, id } = await fixture();
    const source = await put(folder, "Source.md", "\ufeffBefore\r\nSelected\r\nAfter\r\n");
    const document = data(await host.request("/api/file?path=Source.md"));
    const create = { path: "Extracted/Nested/Selection.md", content: "Selected\r\n", version: null, create: true };
    const edit = { path: "Source.md", content: "Before\r\n[[Extracted/Nested/Selection]]\r\nAfter\r\n", version: document.version };
    assert.equal((await host.request("/api/files/edit", "POST", { root: id, edits: [create, { ...edit, version: "stale" }] })).status, 409);
    assert.equal(folder.children.has("Extracted"), false);
    const original = source.bytes.slice();
    const writable = source.createWritable.bind(source);
    source.createWritable = async () => ({
      write: async () => {},
      close: async () => {
        if (externalConflict) {
          const target = await (await (await folder.getDirectoryHandle("Extracted")).getDirectoryHandle("Nested")).getFileHandle("Selection.md");
          target.set("Newer external selection\r\n");
        }
        throw new DOMException("Expected source-write failure", "QuotaExceededError");
      },
      abort: async () => {},
    });
    const failed = await host.request("/api/files/edit", "POST", { root: id, edits: [create, edit] });
    assert.equal(failed.status, externalConflict ? 500 : 507);
    assert.deepEqual(source.bytes, original);
    if (externalConflict) {
      assert.match(failed.error, /Selection\.md/);
      const target = await (await (await folder.getDirectoryHandle("Extracted")).getDirectoryHandle("Nested")).getFileHandle("Selection.md");
      assert.equal(await (await target.getFile()).text(), "Newer external selection\r\n");
    } else {
      assert.equal(folder.children.has("Extracted"), false);
      source.createWritable = writable;
      const saved = data(await host.request("/api/files/edit", "POST", { root: id, edits: [create, edit] }));
      assert.deepEqual(saved.documents.map(document => document.file.path).sort(), ["Extracted/Nested/Selection.md", "Source.md"]);
      assert.equal(await (await source.getFile()).text(), edit.content);
      assert.deepEqual(source.bytes.subarray(0, 3), new Uint8Array([239, 187, 191]));
      assert.equal((await host.request("/api/files/edit", "POST", { root: id, edits: [create] })).status, 409);
    }
  }
});

test("browser note merge trash includes guarded target and incoming edits in the same rollback operation", async () => {
  const { host, folder, id } = await fixture();
  const source = await put(folder, "Source.md", "\ufeffSource\r\n");
  const incoming = await put(folder, "Incoming.md", "See [[Source]].\r\n");
  const sourceDocument = data(await host.request("/api/file?path=Source.md"));
  const reference = data(await host.request("/api/file?path=Incoming.md"));
  const target = { path: "Merged/Target.md", content: "Source\r\n", version: null, create: true };
  const edit = { path: "Incoming.md", content: "See [[Merged/Target]].\r\n", version: reference.version };
  const body = { root: id, path: "Source.md", version: sourceDocument.version, edits: [target, edit] };
  assert.equal((await host.request("/api/files/trash", "POST", { ...body, edits: [target, { ...edit, version: "stale" }] })).status, 409);
  assert.equal(folder.children.get("Source.md"), source);
  assert.equal(folder.children.has("Merged"), false);
  const result = data(await host.request("/api/files/trash", "POST", body));
  assert.equal(folder.children.has("Source.md"), false);
  const trashed = await (await folder.getDirectoryHandle(".trash")).getFileHandle("Source.md");
  assert.deepEqual(trashed.bytes, source.bytes);
  assert.equal(await (await incoming.getFile()).text(), edit.content);
  assert.deepEqual(result.documents.map(document => document.file.path).sort(), ["Incoming.md", "Merged/Target.md"]);
});

test("browser versioned configuration retains original bookmark data and BOM, guards versions/root, and persists across reconnect", async () => {
  const { host, folder, id, store } = await fixture();
  const url = "/api/configuration/bookmarks?root=" + encodeURIComponent(id);
  assert.deepEqual(data(await host.request(url)).data, {});
  const original = { items: [{ type: "file", ctime: 123, path: "Existing.md", future: { keep: 0.125 } }], future: [true] };
  const file = await put(folder, ".obsidian/bookmarks.json", "\ufeff" + JSON.stringify(original));
  const before = data(await host.request(url));
  const changed = { ...before.data, items: [...before.data.items, { type: "search", query: "#tag", ctime: 124 }] };
  const saved = data(await host.request("/api/configuration/bookmarks", "PUT", { root: id, version: before.version, data: changed }));
  assert.deepEqual(file.bytes.subarray(0, 3), new Uint8Array([239, 187, 191]));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(file.bytes)), changed);
  const bytes = file.bytes.slice();
  for (const [root, version, status] of [[id, before.version, 409], [id, null, 428], ["another-vault", saved.version, 409]]) {
    assert.equal((await host.request("/api/configuration/bookmarks", "PUT", { root, version, data: original })).status, status);
    assert.deepEqual(file.bytes, bytes);
  }
  const restarted = new BrowserVault(definitions, legacyIds, store);
  await restarted.initialize();
  await restarted.reconnect(id);
  data(await restarted.request("/api/vault/open", "POST", { path: id }));
  assert.deepEqual(data(await restarted.request(url)).data, changed);
  file.set('{"externallyChanged":true}');
  assert.equal((await restarted.request("/api/configuration/bookmarks", "PUT", { root: id, version: saved.version, data: changed })).status, 409);
});

test("browser configuration rejects malformed/lossy JSON without altering bytes and retains nested named layouts", async () => {
  const { host, folder, id } = await fixture();
  const file = await put(folder, ".obsidian/workspaces.json", "{}");
  const url = "/api/configuration/workspaces?root=" + encodeURIComponent(id);
  for (const text of ["{ broken", "[]", '{"unknown":9007199254740993}', '{"unknown":0.123456789012345678901}', '{"unknown":1e-1000}']) {
    file.set(text);
    assert.equal((await host.request(url)).status, 422, text);
    assert.equal(new TextDecoder().decode(file.bytes), text);
  }
  file.set("{}");
  const before = data(await host.request(url));
  let nested = { preserved: true };
  for (let depth = 0; depth < 80; depth++) {
    nested = { nested };
  }
  const values = { workspaces: { Named: nested }, active: "Named", future: { value: 0.125 } };
  data(await host.request("/api/configuration/workspaces", "PUT", { root: id, version: before.version, data: values }));
  assert.deepEqual(data(await host.request(url)).data, values);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(file.bytes)), values);
  assert.equal((await host.request("/api/configuration/not-a-core?root=" + encodeURIComponent(id))).status, 404);
});

test("browser storage writes the original file bytes, retains BOM/CRLF, and rejects stale saves", async () => {
  const { host, folder } = await fixture();
  const original = await put(folder, "Original.md", new Uint8Array([239, 187, 191, ...new TextEncoder().encode("Old\r\n")]));
  const first = data(await host.request("/api/file?path=Original.md"));
  assert.equal(first.content, "Old\r\n");
  const text = "# Direct save\r\n\r\nUnicode \u03bb \u4e2d\u6587\r\n";
  const saved = data(await host.request("/api/file", "PUT", { path: "Original.md", content: text, version: first.version }));
  assert.deepEqual(original.bytes, new Uint8Array([239, 187, 191, ...new TextEncoder().encode(text)]));
  assert.notEqual(saved.version, first.version);
  assert.equal((await host.request("/api/file", "PUT", { path: "Original.md", content: "Must not replace", version: first.version })).status, 409);
  original.set("Written externally.\n");
  assert.equal((await host.request("/api/file", "PUT", { path: "Original.md", content: "Stale", version: saved.version })).status, 409);
  assert.equal(new TextDecoder().decode(original.bytes), "Written externally.\n");
});

test("browser text views cannot read or overwrite another selected vault with an identical file version", async () => {
  const { host, folder, id } = await fixture();
  await put(folder, "Scoped.probeedit", "Same original bytes.\n");
  const before = data(await host.request("/api/file?path=Scoped.probeedit&root=" + encodeURIComponent(id)));
  const second = new Folder("Second vault");
  const file = await put(second, "Scoped.probeedit", "Same original bytes.\n");
  const other = await host.select(second);
  data(await host.request("/api/vault/open", "POST", { path: other }));
  assert.equal((await host.request("/api/file?path=Scoped.probeedit&root=" + encodeURIComponent(id))).status, 409);
  assert.equal((await host.request("/api/file", "PUT", { root: id, path: "Scoped.probeedit", version: before.version, content: "Must not cross vaults." })).status, 409);
  assert.equal(new TextDecoder().decode(file.bytes), "Same original bytes.\n");
  assert.equal(data(await host.request("/api/file?path=Scoped.probeedit&root=" + encodeURIComponent(other))).version, before.version);
});

test("browser path and create preconditions reject traversal, private files, collisions and missing versions", async () => {
  const { host, folder } = await fixture();
  const created = data(await host.request("/api/file", "POST", { path: "Folder/New.md", content: "Created in place.\n" }));
  assert.equal(created.content, "Created in place.\n");
  for (const path of ["../Escape.md", "/Absolute.md", "C:\\Escape.md", ".obsidian/app.json", "Nested//Bad.md", "Folder./Bad.md", "CON.md"]) {
    assert.equal((await host.request("/api/file", "POST", { path, content: "Rejected" })).status, 400, path);
  }
  assert.equal((await host.request("/api/file", "POST", { path: "Folder/New.md", content: "Overwrite" })).status, 409);
  assert.equal((await host.request("/api/file", "PUT", { path: "Folder/New.md", content: "No version" })).status, 428);
  assert.equal((await host.request("/api/file", "POST", { path: "Bad.md", content: "\ud800" })).status, 400);
  assert.deepEqual([...folder.children.keys()], ["Folder"]);
});

test("browser repeated saves report and retain exact BOM, line endings and Unicode", async () => {
  const { host, folder } = await fixture();
  const file = await put(folder, "Autosave.md", "\ufeffOriginal\r\n");
  let document = data(await host.request("/api/file?path=Autosave.md"));
  for (const content of ["First λ\r\n", "Second 中文 😀\r\n"]) {
    document = data(await host.request("/api/file", "PUT", { path: "Autosave.md", content, version: document.version }));
    assert.equal(document.hasBom, true); assert.equal(document.content, content);
    assert.deepEqual(file.bytes, new TextEncoder().encode("\ufeff" + content));
  }
});

test("browser save acknowledgements describe the committed bytes, not a subsequent external edit", async () => {
  const { host, folder } = await fixture();
  const file = await put(folder, "Concurrent.md", "Original.\n");
  const original = data(await host.request("/api/file?path=Concurrent.md"));
  const writable = file.createWritable.bind(file);
  file.createWritable = async () => {
    const stream = await writable();
    return { ...stream, close: async () => { await stream.close(); file.set("External edit after commit.\n"); } };
  };
  const saved = data(await host.request("/api/file", "PUT", { path: "Concurrent.md", content: "Committed by this save.\n", version: original.version }));
  const current = data(await host.request("/api/file?path=Concurrent.md"));
  assert.equal(saved.content, "Committed by this save.\n");
  assert.equal(current.content, "External edit after commit.\n");
  assert.notEqual(saved.version, current.version);
  assert.equal((await host.request("/api/file", "PUT", { path: "Concurrent.md", content: "Must not overwrite", version: saved.version })).status, 409);
  assert.equal(new TextDecoder().decode(file.bytes), "External edit after commit.\n");
});

test("desktop Web viewer stays unavailable in the browser without rewriting its native configuration", async () => {
  const { host, folder, id } = await fixture();
  const enablement = await put(folder, ".obsidian/core-plugins.json", '{"webviewer":true,"future":{"keep":true}}');
  const settings = await put(folder, ".obsidian/webviewer.json", '{"homepage":null,"future":{"native":"keep"}}');
  const beforeEnablement = enablement.bytes.slice();
  const beforeSettings = settings.bytes.slice();
  const history = await put(folder, ".obsidian/vault-dotnet-web-history.json", '\ufeff{"version":1,"recording":false,"entries":[],"future":{"native":"history"}}');
  const beforeHistory = history.bytes.slice();
  const snapshot = data(await host.request("/api/core"));
  const viewer = snapshot.plugins.find(plugin => plugin.id === "webviewer");
  assert.equal(viewer.configuredEnabled, true);
  assert.equal(viewer.implemented, false);
  assert.equal(viewer.enabled, false);
  assert.equal((await host.request("/api/core/webviewer", "PUT", { root: id, enabled: true })).status, 501);
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: id, values: { homepage: "https://example.com" } })).status, 501);
  assert.deepEqual(enablement.bytes, beforeEnablement);
  assert.deepEqual(settings.bytes, beforeSettings);
  const historyDocument = data(await host.request("/api/configuration/vault-dotnet-web-history?root=" + encodeURIComponent(id)));
  assert.equal(historyDocument.data.recording, false);
  assert.deepEqual(history.bytes, beforeHistory);
});

test("browser core settings preserve unknown data, migrate intentionally, validate pins, and remain root-bound", async () => {
  const { host, folder, id } = await fixture();
  await put(folder, ".obsidian/core-plugins.json", JSON.stringify(["templates", "future-core"]));
  await put(folder, ".obsidian/core-plugins-migration.json", JSON.stringify({ preserve: { exact: true } }));
  const pinFile = await put(folder, ".obsidian/command-palette.json", JSON.stringify({ future: { keep: true }, pinned: null }));
  const initial = data(await host.request("/api/core"));
  assert.equal(initial.plugins.find(plugin => plugin.id === "templates").enabled, true);
  assert.equal((await host.request("/api/core/templates", "PUT", { root: "other-vault", enabled: false })).status, 409);
  assert.equal((await host.request("/api/core/publish", "PUT", { root: id, enabled: true })).status, 501);
  data(await host.request("/api/core/templates", "PUT", { root: id, enabled: false }));
  const configuration = await folder.getDirectoryHandle(".obsidian");
  const migrated = JSON.parse(new TextDecoder().decode((await configuration.getFileHandle("core-plugins.json")).bytes));
  assert.deepEqual(migrated.preserve, { exact: true });
  assert.equal(migrated["future-core"], true);
  assert.equal(migrated.templates, false);
  const pins = ["workspace:save-file", "future:command"];
  data(await host.request("/api/core/command-palette/settings", "PUT", { root: id, values: { pinned: pins } }));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(pinFile.bytes)), { future: { keep: true }, pinned: pins });
  const before = pinFile.bytes.slice();
  assert.equal((await host.request("/api/core/command-palette/settings", "PUT", { root: id, values: { pinned: ["duplicate", "duplicate"] } })).status, 400);
  assert.deepEqual(pinFile.bytes, before);
  for (const number of ["9007199254740993", "1e400"]) {
    const json = `{"templates":false,"future":{"identifier":${number}}}`;
    const file = await put(folder, ".obsidian/core-plugins.json", json);
    assert.equal((await host.request("/api/core/templates", "PUT", { root: id, enabled: true })).status, 422);
    assert.equal(new TextDecoder().decode(file.bytes), json);
  }
});

test("browser Quick switcher options preserve opaque data and conditional controls across reconnects without coercion or cross-vault writes", async () => {
  const { host, folder, id, store } = await fixture();
  const defaults = { showExistingOnly: false, showAttachments: true, showAllFileTypes: false };
  const state = async active => data(await active.request("/api/core")).plugins.find(plugin => plugin.id === "switcher");
  assert.deepEqual((await state(host)).settings, defaults);
  assert.equal((await state(host)).fields.find(field => field.key === "showAllFileTypes").visible, false);
  const original = { showExistingOnly: true, showAttachments: false, showAllFileTypes: true, future: { keep: [true, 42] } };
  const originalText = "\ufeff" + JSON.stringify(original) + "\r\n";
  const file = await put(folder, ".obsidian/switcher.json", originalText);
  const appText = '{"showUnsupportedFiles":true,"future":{"keep":42}}\r\n';
  const appFile = await put(folder, ".obsidian/app.json", appText);
  assert.deepEqual((await state(host)).settings, original);
  assert.equal((await state(host)).fields.find(field => field.key === "showAllFileTypes").visible, true);
  assert.equal(new TextDecoder().decode(file.bytes), originalText.slice(1));
  data(await host.request("/api/core/switcher/settings", "PUT", { root: id, values: defaults }));
  const bytes = file.bytes.slice();
  assert.deepEqual(bytes.slice(0, 3), new Uint8Array([239, 187, 191]));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), { ...original, ...defaults });
  assert.equal(new TextDecoder().decode(appFile.bytes), appText);
  for (const values of [{ showExistingOnly: "false" }, { showAttachments: null }, { showAllFileTypes: 1 }, { showAttachments: false, showExistingOnly: "invalid" }, { showUnsupportedFiles: true }]) {
    assert.equal((await host.request("/api/core/switcher/settings", "PUT", { root: id, values })).status, 400);
    assert.deepEqual(file.bytes, bytes);
  }
  const reconnected = new BrowserVault(definitions, legacyIds, store);
  await reconnected.initialize();
  await reconnected.reconnect(id);
  data(await reconnected.request("/api/vault/open", "POST", { path: id }));
  assert.deepEqual((await state(reconnected)).settings, { ...original, ...defaults });
  const other = await host.select(new Folder("Other vault"));
  data(await host.request("/api/vault/open", "POST", { path: other }));
  assert.deepEqual((await state(host)).settings, defaults);
  assert.equal((await state(host)).fields.find(field => field.key === "showAllFileTypes").visible, false);
  assert.equal((await host.request("/api/core/switcher/settings", "PUT", { root: id, values: { showExistingOnly: true } })).status, 409);
  assert.deepEqual(file.bytes, bytes);
  appFile.set('{"showUnsupportedFiles":"invalid"}');
  assert.equal((await reconnected.request("/api/core")).status, 400);
  assert.deepEqual(file.bytes, bytes);
});

test("browser hover settings preserve extensible Boolean source overrides and reject lossy configuration without rewriting it", async () => {
  const { host, folder, id } = await fixture();
  const file = await put(folder, ".obsidian/page-preview.json", '\ufeff{"editor":false,"futureSetting":{"keep":[true,42]}}\r\n');
  const values = Object.fromEntries([["preview-probe", true], ["__proto__", false]]);
  data(await host.request("/api/core/page-preview/settings", "PUT", { root: id, values }));
  const saved = JSON.parse(new TextDecoder().decode(file.bytes));
  assert.deepEqual(file.bytes.slice(0, 3), new Uint8Array([239, 187, 191]));
  assert.equal(saved.editor, false);
  assert.equal(saved["preview-probe"], true);
  assert.equal(Object.hasOwn(saved, "__proto__"), true);
  assert.equal(saved.__proto__, false);
  assert.equal(Object.hasOwn(saved, "preview"), false);
  assert.deepEqual(saved.futureSetting, { keep: [true, 42] });
  const before = file.bytes.slice();
  for (const values of [{ "preview-probe": "false" }, { "": true }, { ["x".repeat(257)]: true }]) {
    assert.equal((await host.request("/api/core/page-preview/settings", "PUT", { root: id, values })).status, 400);
    assert.deepEqual(file.bytes, before);
  }
  for (const number of ["0.123456789012345678901", "1e-1000"]) {
    const raw = `\ufeff{"editor":false,"futureSetting":${number}}`;
    const file = await put(folder, ".obsidian/page-preview.json", raw);
    assert.equal((await host.request("/api/core/page-preview/settings", "PUT", { root: id, values: { editor: true } })).status, 422);
    assert.deepEqual(file.bytes, new TextEncoder().encode(raw));
  }
});

test("browser Canvas settings enforce enum/path/checkbox/zoom values without discarding opaque options", async () => {
  const { host, folder, id } = await fixture();
  const configuration = await put(folder, ".obsidian/canvas.json", '\ufeff{"defaultModDragBehavior":"webpage","future":{"keep":42}}\r\n');
  const values = { newFileLocation: "folder", newFileFolderPath: "Boards\\Nested\\", defaultWheelBehavior: "zoom", defaultModDragBehavior: "group", cardLabelVisibility: "hover", snapToGrid: false, snapToObjects: true, zoomBreakpoint: -0.7 };
  data(await host.request("/api/core/canvas/settings", "PUT", { root: id, values }));
  const saved = JSON.parse(new TextDecoder().decode(configuration.bytes));
  assert.equal(saved.newFileFolderPath, "Boards/Nested");
  assert.equal(saved.defaultModDragBehavior, "group");
  assert.equal(saved.zoomBreakpoint, -0.7);
  assert.deepEqual(saved.future, { keep: 42 });
  assert.equal(saved.snapToGrid, false);
  const before = configuration.bytes.slice();
  for (const values of [{ newFileLocation: "elsewhere" }, { defaultWheelBehavior: "scroll" }, { defaultModDragBehavior: "draw" }, { cardLabelVisibility: "sometimes" }, { newFileFolderPath: "../Escape" }, { snapToGrid: "false" }, { zoomBreakpoint: -0.71 }, { zoomBreakpoint: 2.41 }, { zoomBreakpoint: "0" }, { zoomBreakpoint: null }]) {
    assert.equal((await host.request("/api/core/canvas/settings", "PUT", { root: id, values })).status, 400);
    assert.deepEqual(configuration.bytes, before);
  }
  data(await host.request("/api/core/canvas/settings", "PUT", { root: id, values: { zoomBreakpoint: 2.4 } }));
  assert.equal(JSON.parse(new TextDecoder().decode(configuration.bytes)).zoomBreakpoint, 2.4);
});

test("browser metadata detects external content and empty folders without decoding binary attachments", async () => {
  const { host, folder, id } = await fixture();
  const note = await put(folder, "Note.md", "# Metadata\r\n");
  await put(folder, "Image.bin", new Uint8Array([255, 0, 128]));
  await put(folder, "Invalid.md", new Uint8Array([255, 254]));
  const first = data(await host.request("/api/metadata/documents?root=" + encodeURIComponent(id)));
  assert.deepEqual(first.documents.map(document => document.file.path), ["Note.md"]);
  assert.equal(first.documents[0].content, "# Metadata\r\n");
  assert.equal(first.errors[0].path, "Invalid.md");
  note.set("# External change\n");
  await folder.getDirectoryHandle("Empty folder", { create: true });
  const second = data(await host.request("/api/metadata/documents?root=" + encodeURIComponent(id)));
  assert.ok(second.revision > first.revision);
  assert.equal(second.documents[0].content, "# External change\n");
  assert.ok(data(await host.request("/api/vault")).folders.includes("Empty folder"));
  assert.equal((await host.request("/api/metadata/documents?root=stale")).status, 409);
});

test("browser reading-view images return exact local bytes with vault and format guards", async () => {
  const { host, folder, id } = await fixture();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 128]);
  await put(folder, "Image.png", bytes);
  await put(folder, "Active.svg", "<svg><script>throw 1</script></svg>");
  await put(folder, "Unsupported.constructor", bytes);
  const query = path => "/api/resource?root=" + encodeURIComponent(id) + "&path=" + encodeURIComponent(path);
  const resource = data(await host.request(query("Image.png")));
  assert.equal(resource.contentType, "image/png");
  assert.deepEqual(Buffer.from(resource.base64, "base64"), Buffer.from(bytes));
  assert.equal((await host.request("/api/resource?root=old-vault&path=Image.png")).status, 409);
  assert.equal((await host.request(query("../Image.png"))).status, 400);
  assert.equal((await host.request(query(".obsidian/workspace.json"))).status, 400);
  assert.equal((await host.request(query("Active.svg"))).status, 415);
  assert.equal((await host.request(query("Unsupported.constructor"))).status, 415);
  assert.equal((await host.request(query("Missing.png"))).status, 404);
});

test("browser configuration distinguishes missing files from invalid JSON/null and protects valid layouts", async () => {
  const { host, folder } = await fixture();
  assert.equal(data(await host.request("/api/workspace")), null);
  const stored = await put(folder, ".obsidian/vault-dotnet-workspace.json", "null");
  assert.equal((await host.request("/api/workspace")).status, 422);
  const layout = { version: 1, active: "leaf", main: { id: "root", type: "split", direction: "vertical", children: [{ id: "tabs", type: "tabs", currentTab: 0, children: [{ id: "leaf", type: "leaf", state: { type: "markdown", pinned: true, state: { file: "Note.md", mode: "preview", source: false } } }] }] }, views: { sidebars: { left: "file-explorer" } } };
  layout.main.children[0].dimension = 100;
  const root = data(await host.request("/api/vault")).root;
  assert.deepEqual(data(await host.request("/api/workspace/validate?root=" + encodeURIComponent(root), "POST", layout)), layout);
  assert.equal(await (await stored.getFile()).text(), "null");
  assert.equal((await host.request("/api/workspace?root=stale")).status, 409);
  assert.equal((await host.request("/api/workspace?root=stale", "PUT", layout)).status, 409);
  assert.equal((await host.request("/api/workspace/validate?root=stale", "POST", layout)).status, 409);
  assert.equal((await host.request("/api/workspace", "PUT", layout)).status, 204);
  assert.deepEqual(data(await host.request("/api/workspace")), layout);
  const before = stored.bytes.slice();
  for (const dimension of [0, -1, 101, "50", NaN]) {
    const invalid = structuredClone(layout); invalid.main.children[0].dimension = dimension;
    assert.equal((await host.request("/api/workspace/validate?root=" + encodeURIComponent(root), "POST", invalid)).status, 422);
    assert.equal((await host.request("/api/workspace", "PUT", invalid)).status, 422);
    assert.deepEqual(stored.bytes, before);
  }
  assert.equal((await host.request("/api/workspace", "PUT", { ...layout, active: "missing" })).status, 422);
  assert.deepEqual(stored.bytes, before);
  const invalidMode = structuredClone(layout);
  invalidMode.main.children[0].children[0].state.state.mode = "invalid";
  assert.equal((await host.request("/api/workspace", "PUT", invalidMode)).status, 422);
  assert.deepEqual(stored.bytes, before);
  for (const source of ["false", 0]) {
    const invalid = structuredClone(layout);
    invalid.main.children[0].children[0].state.state.source = source;
    assert.equal((await host.request("/api/workspace/validate?root=" + encodeURIComponent(root), "POST", invalid)).status, 422);
    assert.equal((await host.request("/api/workspace", "PUT", invalid)).status, 422);
    assert.deepEqual(stored.bytes, before);
  }
  await put(folder, ".obsidian/templates.json", "null");
  assert.equal((await host.request("/api/core")).status, 422);
  await put(folder, ".obsidian/templates.json", "{broken");
  assert.equal((await host.request("/api/core")).status, 422);
});

test("browser recent handles reconnect without reopening a copy and failed selections retain the old vault", async () => {
  const { host, folder, id, store } = await fixture();
  await put(folder, "Keep.md", "Original vault.\n");
  const other = new Folder("Other");
  const otherId = await host.select(other);
  other.permission = "denied";
  assert.equal((await host.request("/api/vault/open", "POST", { path: otherId })).status, 403);
  assert.equal(data(await host.request("/api/vault")).root, id);
  const reloaded = new BrowserVault(definitions, legacyIds, store);
  await reloaded.initialize();
  assert.equal(reloaded.choices(true).recent[0].name, folder.name);
  assert.equal(await reloaded.reconnect(id), id);
  assert.equal(data(await reloaded.request("/api/vault/open", "POST", { path: id })).root, id);
  assert.equal(data(await reloaded.request("/api/file?path=Keep.md")).content, "Original vault.\n");
  folder.permission = "denied";
  assert.equal((await reloaded.request("/api/file?path=Keep.md")).status, 403);
});

test("browser custom panes retain opaque state and sidedock selection across reconnect while rejecting malformed layouts", async () => {
  const { host, folder, id, store } = await fixture();
  const custom = { type: "fixture:panel", pinned: true, state: { label: "Retained", mode: { opaque: true }, future: { nested: [null, true, 3] } } };
  custom.state.optional = undefined;
  const layout = {
    version: 1, active: "side-leaf",
    main: { id: "main-root", type: "split", direction: "vertical", children: [
      { id: "main-tabs", type: "tabs", currentTab: 0, children: [{ id: "main-leaf", type: "leaf", state: custom }] },
    ] },
    right: { width: 310, collapsed: false, root: { id: "side-root", type: "split", direction: "horizontal", children: [
      { id: "side-tabs", type: "tabs", currentTab: 0, children: [{ id: "side-leaf", type: "leaf", state: { ...custom, state: { ...custom.state, file: "Custom.view" } } }] },
    ] } },
  };
  assert.equal((await host.request("/api/workspace", "PUT", layout)).status, 204);
  const stored = await (await folder.getDirectoryHandle(".obsidian")).getFileHandle("vault-dotnet-workspace.json");
  const bytes = stored.bytes.slice();
  const reloaded = new BrowserVault(definitions, legacyIds, store);
  await reloaded.initialize();
  await reloaded.reconnect(id);
  data(await reloaded.request("/api/vault/open", "POST", { path: id }));
  assert.deepEqual(data(await reloaded.request("/api/workspace")), JSON.parse(JSON.stringify(layout)));
  const mutations = [
    value => { value.main.children[0].children[0].state.type = "invalid\u0000view"; },
    value => { value.main.children[0].children[0].state.type = "invalid\u007fview"; },
    value => { value.main.children[0].children[0].state.type = "invalid\u009fview"; },
    value => { value.main.children[0].children[0].state.state = []; },
    value => { value.main.children[0].children[0].state.state.number = Infinity; },
    value => { value.right.root.children[0].children[0].id = "main-leaf"; },
    value => { value.right.root.type = "tabs"; },
    value => { value.active = "missing"; },
    value => { value.main.children[0].children[0].state.pinned = null; },
    value => {
      let nested = value.main.children[0].children[0].state.state;
      for (let index = 0; index < 34; index++) { nested.child = {}; nested = nested.child; }
    },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(layout);
    mutate(invalid);
    assert.equal((await reloaded.request("/api/workspace/validate?root=" + encodeURIComponent(id), "POST", invalid)).status, 422);
    assert.equal((await reloaded.request("/api/workspace", "PUT", invalid)).status, 422);
    assert.deepEqual(stored.bytes, bytes);
  }
});

test("browser plugins use their actual data files while desktop-only plugins fail explicitly", async () => {
  const { host, folder } = await fixture();
  for (const [id, desktop] of [["browser-plugin", false], ["desktop-plugin", true]]) {
    await put(folder, `.obsidian/plugins/${id}/manifest.json`, JSON.stringify({ id, name: id, version: "1.0.0", description: "Fixture", isDesktopOnly: desktop }));
    await put(folder, `.obsidian/plugins/${id}/main.js`, "module.exports = class Fixture {};");
  }
  assert.equal(data(await host.request("/api/plugins/browser-plugin/data")), null);
  assert.equal((await host.request("/api/plugins/browser-plugin/data", "PUT", { saved: "Locally" })).status, 204);
  assert.deepEqual(data(await host.request("/api/plugins/browser-plugin/data")), { saved: "Locally" });
  assert.match(data(await host.request("/api/plugins/browser-plugin")).code, /Fixture/);
  assert.equal((await host.request("/api/plugins/desktop-plugin")).status, 501);
});

test("failed browser writes retain existing bytes and remove an uncommitted newly created file", async () => {
  const { host, folder } = await fixture();
  const original = await put(folder, "Existing.md", "Never lose this.\n");
  const document = data(await host.request("/api/file?path=Existing.md"));
  folder.failWrite = true;
  assert.equal((await host.request("/api/file", "PUT", { path: "Existing.md", content: "Rejected", version: document.version })).status, 507);
  assert.equal(new TextDecoder().decode(original.bytes), "Never lose this.\n");
  assert.equal((await host.request("/api/file", "POST", { path: "Failed.md", content: "Rejected" })).status, 507);
  assert.equal(folder.children.has("Failed.md"), false);
});
