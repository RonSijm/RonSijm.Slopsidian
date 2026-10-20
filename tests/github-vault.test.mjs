import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Script } from "node:vm";
import { root } from "./host.mjs";

let output, moduleUrl, GitHubReader, GitHubVaultHost, parseGitHubLocation, Vault, configureVaultSource;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  output = await mkdtemp(join(root, ".runtime", "github-tests-"));
  const module = join(output, "github.mjs");
  await build({ stdin: { contents: 'export * from "./plugins/github-vault/provider"; export * from "./client/github-vault"; export { Vault } from "./client/vault"; export { configureVaultSource, configureBrowserHost } from "./client/contracts";', resolveDir: root }, outfile: module, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  moduleUrl = pathToFileURL(module).href;
  ({ GitHubReader, GitHubVaultHost, parseGitHubLocation, Vault, configureVaultSource } = await import(moduleUrl));
  await build({ entryPoints: [join(root, "plugins/github-vault/main.ts")], outfile: join(output, "plugin.cjs"), bundle: true, platform: "browser", format: "cjs", target: "es2022", external: ["obsidian"], logLevel: "silent" });
});
after(async () => {
  configureVaultSource(null);
  if (output) {
    assert.ok(resolve(output).startsWith(resolve(root, ".runtime") + sep));
    await rm(output, { recursive: true });
  }
});

class MemoryCache {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async list(prefix) { return [...this.values].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)); }
}
const commitSha = "1".repeat(40), treeSha = "2".repeat(40), folderSha = "3".repeat(40);
const location = { repository: "RonSijm/RonSijm.Slopsidian", ref: "main", folder: "Example" };
const definitions = [
  { id: "backlink", name: "Backlinks", implemented: true, configuredEnabled: true, enabled: true, settingsSupport: "none", fields: [], settings: {} },
  { id: "templates", name: "Templates", implemented: true, configuredEnabled: true, enabled: true, settingsSupport: "none", fields: [], settings: {} },
];
const blobSha = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

test("the installable plugin loads using public Obsidian APIs without native dependencies or startup downloads", async () => {
  const registered = [], commands = []; let downloads = 0;
  class Plugin {
    async loadData() { return null; }
    registerView(type, factory) { registered.push({ type, factory }); }
    addCommand(command) { commands.push(command); }
    addRibbonIcon() {}
  }
  class ItemView {}
  const module = { exports: {} };
  new Script(await readFile(join(output, "plugin.cjs"), "utf8")).runInNewContext({ module, exports: module.exports, require(name) { assert.equal(name, "obsidian", "The plugin must not require Node, Electron, or unpackaged modules"); return { Plugin, ItemView }; }, fetch() { downloads++; throw new Error("Enabling the plugin must not download a vault"); } });
  const plugin = new module.exports.default();
  await plugin.onload();
  assert.equal(registered.length, 1); assert.equal(registered[0].type, "github-vault-browser");
  assert.equal(commands.length, 1); assert.equal(typeof commands[0].callback, "function"); assert.equal(downloads, 0);
});
async function fixture(withConfiguration = false, originalWorkspace, appearanceFiles = []) {
  const cache = new MemoryCache(), calls = [], bytes = new Map();
  if (originalWorkspace) { bytes.set("Example/.obsidian/workspace.json", originalWorkspace); }
  for (const path of ["Start here.md", "90 Attachments/Vault map.svg", "90 Attachments/Synthetic tone.wav", "10 Core/Search.md"]) bytes.set("Example/" + path, await readFile(join(root, "Example", path)));
  bytes.set("Example/.private/untrusted/main.js", Buffer.from("throw new Error('never fetch or execute me')"));
  if (withConfiguration) {
    const json = (path, value) => bytes.set("Example/.obsidian/" + path, Buffer.from(JSON.stringify(value)));
    json("app.json", { livePreview: true, showInlineTitle: false, newFileFolderPath: "Sandbox" });
    json("appearance.json", { baseFontSize: 18 });
    json("core-plugins.json", { backlink: false, templates: true });
    json("backlink.json", { showAllLinks: false });
    json("community-plugins.json", ["portable", "desktop", "missing"]);
    for (const id of ["portable", "desktop"]) {
      json(`plugins/${id}/manifest.json`, { id, name: id, version: "1.0.0", description: "Fixture", isDesktopOnly: id === "desktop", minAppVersion: "1.0.0" });
      bytes.set(`Example/.obsidian/plugins/${id}/main.js`, Buffer.from(`module.exports = class ${id} {};`));
    }
    bytes.set("Example/.obsidian/plugins/portable/styles.css", Buffer.from(".github-fixture { color: purple; }"));
    json("plugins/portable/data.json", { fromRepository: true, value: 7 });
    bytes.set("Example/.obsidian/plugins/portable/icon.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    json(".private/secret.json", { excluded: true });
  }
  for (const [path, content] of appearanceFiles) { bytes.set("Example/.obsidian/" + path, Buffer.from(content)); }
  bytes.set("outside.md", Buffer.from("outside vault"));
  const entries = () => [...bytes].map(([path, content]) => ({ path, type: "blob", mode: "100644", sha: blobSha(content), size: content.length }));
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, "GET"); assert.equal(options.mode, "cors"); assert.equal(options.credentials, "omit");
    const parsed = new URL(url);
    if (parsed.hostname === "api.github.com") {
      if (parsed.pathname.endsWith("/commits/main")) return Response.json({ sha: commitSha, commit: { tree: { sha: treeSha } } });
      assert.equal(parsed.pathname.split("/").at(-1), treeSha);
      return Response.json({ tree: entries(), truncated: false });
    }
    assert.equal(parsed.hostname, "raw.githubusercontent.com");
    assert.ok(parsed.pathname.includes("/" + commitSha + "/"), "Raw requests must be pinned to the discovered commit");
    const path = decodeURIComponent(parsed.pathname.split("/" + commitSha + "/")[1]);
    return bytes.has(path) ? new Response(bytes.get(path)) : new Response("not found", { status: 404 });
  };
  const reader = new GitHubReader(cache, fetcher);
  return { cache, calls, bytes, entries, fetcher, reader, mount: await reader.discover(location) };
}

test("GitHub original workspace remains a read-only repository source beside independent local and cache-only layouts", async () => {
  const original = { main: { id: "main", type: "split", direction: "vertical", children: [{ id: "tabs", type: "tabs", currentTab: 0, children: [{ id: "empty", type: "leaf", state: { type: "empty", state: {} } }] }] }, active: "empty", future: ["retained"] };
  const bytes = Buffer.from("\ufeff" + JSON.stringify(original) + "\r\n"), f = await fixture(true, bytes), host = new GitHubVaultHost(f.reader);
  const snapshot = await host.open({ url: location.repository, folder: "Example" }, definitions); host.select(snapshot.root);
  const url = "/api/workspace/original?root=" + encodeURIComponent(snapshot.root), source = await host.request(url, "GET");
  assert.equal(source.status, 200, source.error); assert.deepEqual(source.value.data, original); assert.equal(source.value.id, "workspace");
  assert.equal((await host.request("/api/workspace/original?root=other", "GET")).status, 409);
  const local = { version: 1, main: original.main, active: "empty", views: { test: { local: true } } };
  assert.equal((await host.request("/api/workspace", "PUT", local)).status, 204);
  assert.deepEqual((await host.request("/api/workspace", "GET")).value, local);
  assert.equal((await host.request("/api/configuration/workspace", "PUT", { root: snapshot.root, version: source.value.version, data: { corrupt: true } })).status, 403);
  assert.deepEqual((await host.request("/api/workspace", "GET")).value, local);
  assert.deepEqual((await host.request(url, "GET")).value.data, original);
  assert.equal((await host.request(url, "PUT", source.value)).status, 403);
  assert.deepEqual(f.bytes.get("Example/.obsidian/workspace.json"), bytes);
  assert.equal((await f.reader.download(f.mount)).state, "complete");
  const offline = new GitHubVaultHost(new GitHubReader(f.cache, async () => { throw Error("Offline must not fetch"); }));
  offline.select((await offline.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.deepEqual((await offline.request(url, "GET")).value, source.value);
});

test("installed appearance CSS is commit-pinned and cache-only with guarded reads and independent local preference overlays", async () => {
  const assets = [
    ["themes/Portable/theme.css", Buffer.from('\ufeffbody { --label: "portable"; }\r\n')],
    ["snippets/Upper.CSS", Buffer.from("body { color: purple; }\r\n")],
    ["snippets/Invalid.css", Buffer.from([255, 0, 128])],
    ["snippets/Oversized.css", Buffer.alloc(1024 * 1024 + 1, 32)],
    ["themes/Portable/manifest.json", Buffer.from([255, 254, 123, 125])],
    ["themes/Big/manifest.json", Buffer.alloc(64 * 1024 + 1, 32)],
  ];
  const remote = Buffer.from('\ufeff{"baseFontSize":18,"futureAppearance":{"keep":[true,42]}}\r\n');
  const f = await fixture(true, undefined, [["appearance.json", remote], ...assets]), host = new GitHubVaultHost(f.reader);
  host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const cssUrl = path => "/api/appearance/css?" + new URLSearchParams({ root: host.root, path });
  const loaded = [];
  for (const [path, bytes] of assets.slice(0, 2)) {
    const response = await host.request(cssUrl(".obsidian/" + path), "GET");
    assert.equal(response.status, 200, response.error);
    assert.deepEqual(response.value, { root: host.root, path: ".obsidian/" + path, content: new TextDecoder().decode(bytes), version: "git:" + blobSha(bytes), size: bytes.length });
    loaded.push(response.value);
  }
  assert.equal((await host.request(cssUrl(".obsidian/snippets/Invalid.css"), "GET")).status, 415);
  const rawBefore = f.reader.counters.raw;
  assert.equal((await host.request(cssUrl(".obsidian/snippets/Oversized.css"), "GET")).status, 413);
  assert.equal(f.reader.counters.raw, rawBefore, "Oversized CSS must refuse before a raw download.");
  const manifestPath = ".obsidian/themes/Portable/manifest.json", manifestBytes = assets[4][1];
  const manifestRead = await host.request(cssUrl(manifestPath), "GET");
  assert.equal(manifestRead.status, 200, manifestRead.error);
  assert.deepEqual(manifestRead.value, { root: host.root, path: manifestPath, content: "", version: "git:" + blobSha(manifestBytes), size: manifestBytes.length });
  const rawBeforeBig = f.reader.counters.raw;
  assert.equal((await host.request(cssUrl(".obsidian/themes/Big/manifest.json"), "GET")).status, 413);
  assert.equal(f.reader.counters.raw, rawBeforeBig, "An oversized manifest must refuse before a raw download.");
  for (const path of ["Start here.md", ".obsidian/app.json", ".obsidian/snippets/nested/Bad.css", ".obsidian/themes/../theme.css", ".OBSIDIAN/snippets/Upper.CSS"]) {
    assert.equal((await host.request(cssUrl(path), "GET")).status, 400, path);
  }
  assert.equal((await host.request(cssUrl(".obsidian/snippets/Missing.css"), "GET")).status, 404);
  assert.equal((await host.request("/api/appearance/css?root=other&path=.obsidian/snippets/Upper.CSS", "GET")).status, 409);
  assert.equal((await host.request(cssUrl(".obsidian/snippets/Upper.CSS"), "PUT", { content: "replace" })).status, 403);
  const before = (await host.request("/api/configuration/appearance", "GET")).value;
  const local = { ...before.data, theme: "moonstone", cssTheme: "Portable", enabledCssSnippets: ["Upper"] };
  assert.equal((await host.request("/api/configuration/appearance", "PUT", { root: host.root, version: before.version, data: local })).status, 200);
  assert.deepEqual(f.bytes.get("Example/.obsidian/appearance.json"), remote);
  assert.equal((await f.reader.download(f.mount)).state, "complete");
  const blobs = new Map([...f.cache.values].filter(([key]) => key.startsWith("blob:")).map(([key, value]) => [key, structuredClone(value)]));
  const reader = new GitHubReader(f.cache, async () => { throw new Error("Cache-only appearance must not fetch."); }), offline = new GitHubVaultHost(reader);
  offline.select((await offline.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.deepEqual((await offline.request("/api/configuration/appearance", "GET")).value.data, local);
  for (const style of loaded) {
    assert.deepEqual((await offline.request(cssUrl(style.path), "GET")).value, style);
  }
  assert.deepEqual((await offline.request(cssUrl(manifestPath), "GET")).value, manifestRead.value);
  assert.equal((await offline.request(cssUrl(".obsidian/themes/Big/manifest.json"), "GET")).status, 413);
  assert.equal(reader.counters.api, 0); assert.equal(reader.counters.raw, 0);
  for (const [key, value] of blobs) { assert.deepEqual(f.cache.values.get(key), value, "Appearance changed a cached Git blob: " + key); }
});

test("GitHub URLs support subfolders and explicit slash-containing refs, and reject other hosts and traversal", () => {
  assert.deepEqual(parseGitHubLocation("https://github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example"), location);
  assert.deepEqual(parseGitHubLocation("RonSijm/RonSijm.Slopsidian", "feature/notes", "Example"), { ...location, ref: "feature/notes" });
  for (const value of ["https://evil.example/a/b", "https://github.com/a/b?token=secret", "https://user:secret@github.com/a/b", "file:///tmp/notes", "../repo"]) assert.throws(() => parseGitHubLocation(value));
  assert.throws(() => parseGitHubLocation(location.repository, "main", "Example/../private"));
});

test("discovery creates file references with exactly two API calls and no raw downloads or hidden configuration", async () => {
  const f = await fixture();
  assert.equal(f.mount.files.length, 4); assert.equal(f.calls.length, 2); assert.equal(f.reader.counters.raw, 0);
  assert.ok(f.mount.files.every(file => !file.path.startsWith(".") && file.repositoryPath.startsWith("Example/")));
  assert.equal(f.mount.commit, commitSha);
});

test("the default fetch transport retains its browser Window receiver", async () => {
  const f = await fixture(), original = globalThis.fetch;
  globalThis.fetch = function (url, options) { assert.equal(this, globalThis, "Window.fetch requires its Window receiver"); return f.fetcher(url, options); };
  try { assert.equal((await new GitHubReader(f.cache).discover(location)).files.length, 4); }
  finally { globalThis.fetch = original; }
});

test("raw reads are pinned, byte-exact, deduplicated, and persist across reader instances", async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.reader.read(f.mount, "Start here.md"), f.reader.read(f.mount, "Start here.md")]);
  assert.deepEqual(Buffer.from(first), f.bytes.get("Example/Start here.md")); assert.deepEqual(first, second); assert.equal(f.reader.counters.raw, 1);
  first.fill(0); assert.notEqual(second[0], 0, "Callers must not share a mutable cached buffer");
  const offline = new GitHubReader(f.cache, () => { throw new Error("No network is permitted"); });
  const restored = await offline.cached(location);
  assert.deepEqual(await offline.read(restored, "Start here.md", true), second);
  assert.deepEqual(offline.counters, { api: 0, raw: 0, cacheHits: 1 });
  await assert.rejects(offline.read(restored, "10 Core/Search.md", true), /not cached/);
  assert.equal(offline.counters.raw, 0);
});

test("SVG and WAV bodies are preserved and corrupted cache entries are rejected or repaired", async () => {
  const f = await fixture();
  for (const path of ["90 Attachments/Vault map.svg", "90 Attachments/Synthetic tone.wav"]) assert.deepEqual(Buffer.from(await f.reader.read(f.mount, path)), f.bytes.get("Example/" + path));
  const file = f.mount.files.find(file => file.path === "Start here.md");
  await f.cache.put("blob:" + file.sha, new ArrayBuffer(file.size));
  await assert.rejects(f.reader.read(f.mount, file.path, true), /not cached/);
  assert.deepEqual(Buffer.from(await f.reader.read(f.mount, file.path)), f.bytes.get("Example/" + file.path));
});

test("incorrect raw content is never cached as the discovered Git blob", async () => {
  const f = await fixture(), reader = new GitHubReader(f.cache, async () => new Response(Buffer.from("wrong")));
  await assert.rejects(reader.read(f.mount, "Start here.md"), /does not match/);
  assert.equal(await f.cache.get("blob:" + f.mount.files.find(file => file.path === "Start here.md").sha), undefined);
});

test("rate-limit failures preserve the previous offline inventory", async () => {
  const f = await fixture();
  const limited = new GitHubReader(f.cache, async () => new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
  await assert.rejects(limited.discover(location), /anonymous request limit/);
  assert.equal((await limited.cached(location)).commit, commitSha);
});

test("truncated trees fall back to the selected subtree instead of silently losing files", async () => {
  const f = await fixture(); let count = 0;
  const reader = new GitHubReader(new MemoryCache(), async url => {
    count++;
    if (url.includes("/commits/")) return Response.json({ sha: commitSha, commit: { tree: { sha: treeSha } } });
    if (url.endsWith("?recursive=1")) return Response.json({ tree: [], truncated: true });
    if (url.endsWith(treeSha)) return Response.json({ tree: [{ path: "Example", type: "tree", mode: "040000", sha: folderSha }], truncated: false });
    assert.ok(url.endsWith(folderSha));
    return Response.json({ tree: f.entries().filter(entry => entry.path.startsWith("Example/")).map(entry => ({ ...entry, path: entry.path.slice(8) })), truncated: false });
  });
  const mount = await reader.discover(location);
  assert.equal(mount.files.length, 4); assert.equal(count, 5); assert.ok(mount.files.every(file => file.repositoryPath.startsWith("Example/")));
});

test("native vault inventories, stat/list, file info, and metadata polling stay lazy", async () => {
  const f = await fixture(), host = new GitHubVaultHost(f.reader);
  const snapshot = await host.open({ url: location.repository, ref: "main", folder: "Example" }, definitions);
  assert.ok(snapshot.readOnly && snapshot.lazy); host.select(snapshot.root);
  for (const path of ["/api/vault", "/api/core", "/api/adapter/list?path=/", "/api/adapter/stat?path=Start%20here.md", "/api/files/info?path=Start%20here.md", "/api/metadata/documents", "/api/vault/revision"]) assert.equal((await host.request(path, "GET")).status, 200);
  assert.equal(f.reader.counters.raw, 0);
  assert.equal((await host.request("/api/metadata/documents", "GET")).value.documents.length, 0);
  assert.equal((await host.request("/api/file?path=Start%20here.md", "GET")).status, 200);
  assert.equal(f.reader.counters.raw, 1);
  assert.equal((await host.request("/api/metadata/documents", "GET")).value.documents.length, 1);
  assert.equal((await host.request("/api/core", "GET")).value.plugins.find(plugin => plugin.id === "templates").enabled, false);
});

test("all repository mutation routes are rejected before downloading files or performing network writes", async () => {
  const f = await fixture(), host = new GitHubVaultHost(f.reader);
  const snapshot = await host.open({ url: location.repository, folder: "Example", cached: true }, definitions); host.select(snapshot.root);
  for (const [path, method] of [["/api/file", "PUT"], ["/api/file", "POST"], ["/api/binary", "POST"], ["/api/files/edit", "POST"], ["/api/files/rename", "POST"], ["/api/files/trash", "POST"], ["/api/files/delete", "POST"], ["/api/files/folders", "POST"], ["/api/adapter/folder", "POST"], ["/api/community-plugins/a", "POST"]]) {
    assert.equal((await host.request(path, method, { root: snapshot.root, path: "Start here.md" })).status, 403, path);
  }
  assert.equal((await host.request("/api/plugins/untrusted", "GET")).status, 404);
  assert.equal((await host.request("/api/file?path=Start%20here.md&root=other", "GET")).status, 409);
  assert.equal(f.reader.counters.raw, 0); assert.equal(f.calls.length, 2);
});

test("personal preferences persist locally with optimistic concurrency and do not alter repository files", async () => {
  const f = await fixture(), host = new GitHubVaultHost(f.reader);
  const snapshot = await host.open({ url: location.repository, folder: "Example", cached: true }, definitions); host.select(snapshot.root);
  const before = await host.request("/api/configuration/app", "GET"); assert.equal(before.value.data.markdownAutosave, false);
  const saved = await host.request("/api/configuration/app", "PUT", { root: snapshot.root, version: null, data: { fontSize: 18 } }); assert.equal(saved.status, 200);
  assert.equal((await host.request("/api/configuration/app", "PUT", { root: snapshot.root, version: null, data: {} })).status, 409);
  const fresh = new GitHubVaultHost(new GitHubReader(f.cache, () => { throw new Error("offline"); }));
  fresh.select((await fresh.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.equal((await fresh.request("/api/configuration/app", "GET")).value.data.fontSize, 18);
  assert.equal(f.calls.length, 2);
});

test("late file responses cannot populate another selected vault", async () => {
  const f = await fixture(); let release;
  const reader = new GitHubReader(f.cache, (url, options) => url.startsWith("https://api.github.com/") ? f.fetcher(url, options) : new Promise(resolve => { release = () => resolve(new Response(f.bytes.get("Example/Start here.md"))); }));
  const host = new GitHubVaultHost(reader); host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const request = host.request("/api/file?path=Start%20here.md", "GET");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  host.select(null); release();
  assert.equal((await request).status, 409);
});

test("public Vault write and processing APIs refuse read-only sources without reading or invoking callbacks", async () => {
  const f = await fixture(), host = new GitHubVaultHost(f.reader), snapshot = await host.open({ url: location.repository, folder: "Example", cached: true }, definitions);
  host.select(snapshot.root); configureVaultSource(host);
  const vault = new Vault(async () => {}); vault.setSnapshot(snapshot);
  const file = vault.getFileByPath("Start here.md"); let invoked = false;
  const operations = [
    ["write", () => vault.writeDocument(file.path, "changed", null, false)],
    ["process", () => vault.process(file, () => { invoked = true; return "changed"; })],
    ["mkdir", () => vault.adapter.mkdir(".obsidian/unsafe")],
    ["modify", () => vault.modify(file, "changed")],
    ["create", () => vault.create("New.md", "changed")],
    ["create-binary", () => vault.createBinary("New.png", new ArrayBuffer(1))],
    ["modify", () => vault.adapter.write(file.path, "changed")],
    ["rename", () => vault.rename(file, "Renamed.md")],
    ["trash", () => vault.trash(file, false)],
    ["delete", () => vault.delete(file)],
    ["mkdir", () => vault.createFolder("New folder")],
    ["mkdir", () => vault.createDirectory("New folder")],
    ["rename", () => vault.moveFile(file, "Renamed.md", "original", [])],
    ["trash", () => vault.trashFile(file, "original")],
    ["delete", () => vault.deleteFile(file, "original")],
    ["edit-documents", () => vault.editDocuments([], () => { invoked = true; })],
  ];
  for (const [operation, action] of operations) {
    await assert.rejects(action(), error => {
      assert.equal(error.name, "ReadOnlyVaultError"); assert.equal(error.code, "VAULT_READ_ONLY");
      assert.equal(error.operation, operation); assert.match(error.stack, /github-vault.test.mjs/); return true;
    });
  }
  assert.equal(invoked, false); assert.equal(f.reader.counters.raw, 0);
  configureVaultSource(null);
});

test("explicit offline download persists every exact blob without eager metadata indexing or new discovery requests", async () => {
  const f = await fixture(), host = new GitHubVaultHost(f.reader), events = [];
  host.select((await host.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  const before = { ...f.reader.counters };
  assert.deepEqual(await f.reader.offlineStatus(f.mount), { totalFiles: 4, totalBytes: f.mount.files.reduce((size, file) => size + file.size, 0), cachedFiles: 0, cachedBytes: 0, oversizedFiles: 0 });
  assert.deepEqual(f.reader.counters, before, "A cache availability check must not fetch or count file reads");
  const result = await f.reader.download(f.mount, { onProgress: progress => events.push(progress) });
  assert.equal(result.state, "complete"); assert.equal(result.completedFiles, 4); assert.equal(result.completedBytes, result.totalBytes);
  assert.equal(f.reader.counters.raw, 4); assert.equal(f.reader.counters.api, 2);
  assert.equal(host.info().loaded, 0, "Caching a file must not load it into the workspace or metadata index");
  assert.deepEqual(events.map(event => event.completedFiles), [0, 1, 2, 3, 4, 4]);
  const fresh = new GitHubReader(f.cache, () => { throw new Error("Offline must not use the network"); });
  const restored = await fresh.cached(location);
  const status = await fresh.offlineStatus(restored);
  assert.equal(status.cachedFiles, 4); assert.equal(status.cachedBytes, status.totalBytes);
  for (const file of restored.files) assert.deepEqual(Buffer.from(await fresh.read(restored, file.path, true)), f.bytes.get(file.repositoryPath));
  assert.equal((await fresh.download(restored)).state, "complete", "Repeating a completed download must use the cache");
  assert.equal(fresh.counters.raw, 0);
  const first = restored.files[0];
  f.cache.values.delete("blob:" + first.sha);
  assert.equal((await fresh.offlineStatus(restored)).cachedFiles, 3, "A completion claim must not survive missing cache bytes");
  await f.cache.put("blob:" + first.sha, new ArrayBuffer(first.size));
  assert.equal((await fresh.offlineStatus(restored)).cachedFiles, 3, "Corrupt cache bytes are not available offline");
});

function gatedReader(f) {
  const gates = []; let active = 0, maximum = 0, aborted = 0;
  const reader = new GitHubReader(f.cache, (url, options) => {
    if (url.startsWith("https://api.github.com/")) return f.fetcher(url, options);
    return new Promise((resolve, reject) => {
      active++; maximum = Math.max(maximum, active);
      let done = false;
      const settle = action => { if (!done) { done = true; active--; options.signal.removeEventListener("abort", abort); action(); } };
      const abort = () => settle(() => { aborted++; reject(new DOMException("cancelled", "AbortError")); });
      options.signal.addEventListener("abort", abort, { once: true });
      gates.push({ signal: options.signal, release: () => settle(() => resolve(f.fetcher(url, options))) });
      if (options.signal.aborted) abort();
    });
  });
  return { reader, gates, get active() { return active; }, get maximum() { return maximum; }, get aborted() { return aborted; } };
}
async function until(condition) {
  for (let iteration = 0; iteration < 1000; iteration++) { if (condition()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.fail("The controlled asynchronous operation did not reach its expected state");
}

test("offline downloads bound concurrency to four and keep a fixed snapshot while the caller changes its inventory", async () => {
  const f = await fixture();
  for (let index = 0; index < 8; index++) f.bytes.set(`Example/Extra ${index}.md`, Buffer.from("extra note " + index));
  const mount = await f.reader.discover(location), gate = gatedReader(f), events = [];
  const download = gate.reader.download(mount, { onProgress: progress => events.push(progress) });
  await until(() => gate.gates.length === 4);
  assert.equal(gate.active, 4); assert.equal(gate.reader.counters.raw, 4);
  mount.commit = "f".repeat(40); mount.files.length = 0;
  for (let index = 0; index < 12; index++) { await until(() => gate.gates.length > index); gate.gates[index].release(); }
  const result = await download;
  assert.equal(result.state, "complete"); assert.equal(result.completedFiles, 12); assert.equal(gate.maximum, 4);
  assert.equal(events.at(-1).state, "complete");
});

test("cancellation aborts outstanding offline requests, keeps completed files, and resumes from persistent cache", async () => {
  const f = await fixture(), gate = gatedReader(f), controller = new AbortController();
  const download = gate.reader.download(f.mount, { signal: controller.signal, onProgress: progress => { if (progress.completedFiles === 1) controller.abort(); } });
  await until(() => gate.gates.length === 4); gate.gates[0].release();
  const result = await download;
  assert.equal(result.state, "cancelled"); assert.equal(result.completedFiles, 1); assert.equal(gate.aborted, 3);
  const first = f.mount.files[0];
  assert.ok(await f.cache.get("blob:" + first.sha));
  const fresh = new GitHubReader(f.cache, f.fetcher), restored = await fresh.cached(location);
  const resumed = [];
  assert.equal((await fresh.download(restored, { onProgress: progress => resumed.push(progress) })).state, "complete");
  assert.equal(resumed[0].completedFiles, 1, "Resume progress must start from the verified cached count");
  assert.equal(resumed[0].completedBytes, first.size);
  assert.equal(fresh.counters.raw, 3, "A resumed download must not refetch its already verified file");
  assert.equal((await fresh.offlineStatus(restored)).cachedFiles, 4);
});

test("cancelling an offline subscriber does not abort the same download used by an open note", async () => {
  const f = await fixture(), gate = gatedReader(f), controller = new AbortController(), path = f.mount.files[0].path;
  const foreground = gate.reader.read(f.mount, path);
  await until(() => gate.gates.length === 1);
  const background = gate.reader.read(f.mount, path, false, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(background, /cancelled/);
  assert.equal(gate.gates.length, 1); assert.equal(gate.gates[0].signal.aborted, false);
  gate.gates[0].release();
  assert.deepEqual(Buffer.from(await foreground), f.bytes.get("Example/" + path));
  assert.equal(gate.reader.counters.raw, 1);
});

test("a cancelled snapshot can be retried before its abandoned request settles", async () => {
  const f = await fixture(), gate = gatedReader(f), controller = new AbortController(), path = f.mount.files[0].path;
  const abandoned = gate.reader.read(f.mount, path, false, controller.signal);
  await until(() => gate.gates.length === 1); controller.abort();
  await assert.rejects(abandoned, /cancelled/);
  const retry = gate.reader.read(f.mount, path);
  await until(() => gate.gates.length === 2); gate.gates[1].release();
  assert.deepEqual(Buffer.from(await retry), f.bytes.get("Example/" + path));
});

test("download failures and browser quota errors never report a complete offline snapshot", async () => {
  const f = await fixture(), bad = new GitHubReader(f.cache, async () => new Response("wrong"));
  const failed = await bad.download(f.mount);
  assert.equal(failed.state, "error"); assert.match(failed.error, /does not match|exceeded/);
  assert.equal((await f.reader.offlineStatus(f.mount)).cachedFiles, 0);
  const unreachable = new GitHubReader(f.cache, async () => { throw new TypeError("Failed to fetch"); });
  const network = await unreachable.download(f.mount);
  assert.equal(network.state, "error"); assert.match(network.error, /GitHub could not be reached/);
  assert.equal((await f.reader.offlineStatus(f.mount)).cachedFiles, 0);
  const put = f.cache.put.bind(f.cache);
  f.cache.put = async (key, value) => { if (key.startsWith("blob:")) throw new Error("Browser storage quota exceeded"); return put(key, value); };
  const full = await f.reader.download(f.mount);
  assert.equal(full.state, "error"); assert.match(full.error, /quota/);
  assert.equal(full.completedFiles, 0); assert.equal((await f.reader.cached(location)).commit, commitSha);
});

test("oversized files are identified before any offline download, and pre-cancelled runs make no requests", async () => {
  const f = await fixture(), oversized = structuredClone(f.mount);
  oversized.files[0].size = 16 * 1024 * 1024 + 1;
  assert.equal((await f.reader.offlineStatus(oversized)).oversizedFiles, 1);
  const result = await f.reader.download(oversized);
  assert.equal(result.state, "error"); assert.match(result.error, /16 MiB/); assert.equal(f.reader.counters.raw, 0);
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.reader.download(f.mount, { signal: controller.signal })).state, "cancelled");
  assert.equal(f.reader.counters.raw, 0);
});

test("offline source descriptors cannot mutate the selected mount, and selection/refresh announce lifecycle changes", async () => {
  const f = await fixture(), host = new GitHubVaultHost(f.reader); let changes = 0;
  const remove = host.onSourceChange(() => { changes++; });
  host.select((await host.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.equal(changes, 1);
  const source = host.offlineSource(); assert.equal(source.cacheOnly, true);
  source.mount.commit = "f".repeat(40); source.mount.files.length = 0;
  assert.equal(host.info().commit, commitSha); assert.equal(host.snapshot().files.length, 4);
  host.select(null); assert.equal(host.offlineSource(), null); assert.equal(changes, 2);
  host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const pinned = host.offlineSource();
  assert.equal((await host.request("/api/vault/refresh", "POST")).status, 200); assert.equal(changes, 4);
  assert.equal(pinned.mount.commit, commitSha); assert.equal(f.reader.counters.raw, 0);
  remove(); host.select(null); assert.equal(changes, 4);
});

test("GitHub configuration is discovered separately and only plugin manifests load when mounting", async () => {
  const f = await fixture(true);
  assert.equal(f.mount.files.length, 4); assert.equal(f.reader.counters.raw, 0);
  assert.ok(f.mount.configurationFiles.some(file => file.path === ".obsidian/app.json"));
  assert.ok(!f.mount.configurationFiles.some(file => file.path.includes("/.private/")));
  const host = new GitHubVaultHost(f.reader), snapshot = await host.open({ url: location.repository, folder: "Example" }, definitions);
  host.select(snapshot.root);
  assert.deepEqual(snapshot.plugins.map(plugin => plugin.id), ["desktop", "portable"]);
  assert.ok(snapshot.files.every(file => !file.path.startsWith(".")));
  assert.ok(snapshot.folders.every(folder => !folder.startsWith(".")));
  assert.equal(f.reader.counters.raw, 2, "Only two manifest bodies should load at mount time");
  assert.ok(f.calls.every(call => !call.url.endsWith("/main.js") && !call.url.endsWith("/styles.css")));
  assert.equal((await host.request("/api/adapter/stat?path=.obsidian", "GET")).value.type, "folder");
  assert.ok((await host.request("/api/adapter/list?path=.obsidian/plugins/portable", "GET")).value.files.includes(".obsidian/plugins/portable/icon.svg"));
  assert.match((await host.request("/api/file?path=.obsidian/plugins/portable/icon.svg", "GET")).value.content, /<svg/);
  assert.equal(host.info().loaded, 0);
});

test("repository app/core settings seed local overlays and version conflicts cannot modify their original bytes", async () => {
  const f = await fixture(true), host = new GitHubVaultHost(f.reader);
  host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const before = Buffer.from(f.bytes.get("Example/.obsidian/app.json"));
  const app = await host.request("/api/configuration/app", "GET");
  assert.equal(app.value.data.livePreview, true); assert.equal(app.value.data.showInlineTitle, false);
  assert.equal(app.value.data.markdownAutosave, false); assert.match(app.value.version, /^git:/);
  const core = await host.request("/api/core", "GET");
  assert.equal(core.value.plugins.find(plugin => plugin.id === "backlink").enabled, false);
  assert.equal(core.value.plugins.find(plugin => plugin.id === "backlink").settings.showAllLinks, false);
  assert.equal(core.value.plugins.find(plugin => plugin.id === "templates").enabled, false, "Read-only core restrictions still apply");
  const saved = await host.request("/api/configuration/app", "PUT", { root: host.root, version: app.value.version, data: { ...app.value.data, showInlineTitle: true } });
  assert.equal(saved.status, 200);
  assert.equal((await host.request("/api/configuration/app", "PUT", { root: host.root, version: app.value.version, data: {} })).status, 409);
  const fresh = new GitHubVaultHost(new GitHubReader(f.cache, () => { throw new Error("offline"); }));
  fresh.select((await fresh.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.equal((await fresh.request("/api/configuration/app", "GET")).value.data.showInlineTitle, true);
  assert.deepEqual(f.bytes.get("Example/.obsidian/app.json"), before);
});

test("GitHub core settings writes carry the last-read local version and never fall back to unconditional writes", async () => {
  const f = await fixture(true), host = new GitHubVaultHost(f.reader);
  const settingsDefinitions = definitions.map(definition => ({ ...definition, settingsSupport: "implemented" }));
  host.select((await host.open({ url: location.repository, folder: "Example" }, settingsDefinitions)).root);
  const before = Buffer.from(f.bytes.get("Example/.obsidian/app.json"));
  const put = (version, showAllLinks) => host.request("/api/core/backlink/settings", "PUT", { root: host.root, ...(version === undefined ? {} : { version }), values: { showAllLinks } });
  const initial = (await host.request("/api/core", "GET")).value.plugins.find(plugin => plugin.id === "backlink");
  assert.equal(initial.settingsVersion, null, "No local core preference exists yet");
  assert.equal((await put(undefined, true)).status, 200, "The first local write needs no version");
  const first = (await host.request("/api/core", "GET")).value.plugins.find(plugin => plugin.id === "backlink");
  assert.equal(first.settings.showAllLinks, true); assert.notEqual(first.settingsVersion, null);
  assert.equal((await put(undefined, false)).status, 428, "A missing version is refused");
  assert.equal((await put("stale-version", false)).status, 409, "A stale version is refused");
  assert.equal((await host.request("/api/core", "GET")).value.plugins.find(plugin => plugin.id === "backlink").settings.showAllLinks, true);
  assert.equal((await put(first.settingsVersion, false)).status, 200);
  const second = (await host.request("/api/core", "GET")).value.plugins.find(plugin => plugin.id === "backlink");
  assert.equal(second.settings.showAllLinks, false); assert.notEqual(second.settingsVersion, first.settingsVersion);
  assert.deepEqual(f.bytes.get("Example/.obsidian/app.json"), before);
});

test("GitHub core snapshots derive every plugin's settings and version from one preference document", async () => {
  const f = await fixture(true), host = new GitHubVaultHost(f.reader);
  const settingsDefinitions = definitions.map(definition => ({ ...definition, settingsSupport: "implemented" }));
  host.select((await host.open({ url: location.repository, folder: "Example" }, settingsDefinitions)).root);
  assert.equal((await host.request("/api/core/backlink/settings", "PUT", { root: host.root, values: { showAllLinks: true } })).status, 200);
  const get = f.cache.get.bind(f.cache); let reads = 0;
  f.cache.get = async name => {
    const value = await get(name);
    if (typeof name === "string" && name.endsWith(":core") && ++reads === 1) {
      queueMicrotask(() => f.cache.put(name, { data: { "backlink:settings": { showAllLinks: false } }, version: "newer-version" }));
    }
    return value;
  };
  const snapshot = (await host.request("/api/core", "GET")).value.plugins.filter(plugin => plugin.settingsVersion !== null);
  f.cache.get = get;
  assert.ok(snapshot.length > 0);
  assert.equal(new Set(snapshot.map(plugin => plugin.settingsVersion)).size, 1);
  const templates = snapshot.find(plugin => plugin.id === "backlink");
  assert.equal(templates.settings.showAllLinks, true, "Values and version both come from the first read");
  assert.notEqual(templates.settingsVersion, "newer-version");
  assert.equal((await host.request("/api/core/backlink/settings", "PUT", { root: host.root, values: { showAllLinks: false }, version: templates.settingsVersion })).status, 409);
});

test("desktop remote enabled IDs start restricted, explicit enablement loads pinned code/CSS, and trust persists locally", async () => {
  const f = await fixture(true), host = new GitHubVaultHost(f.reader);
  host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const before = await host.request("/api/community-plugins", "GET"), raw = f.reader.counters.raw;
  assert.deepEqual(before.value.enabled, ["portable", "desktop", "missing"]); assert.equal(before.value.restricted, true);
  assert.equal((await host.request("/api/plugins/portable", "GET")).status, 403); assert.equal(f.reader.counters.raw, raw);
  const trusted = await host.request("/api/community-plugins", "PUT", { root: host.root, version: before.value.version, enabled: before.value.enabled, restricted: false });
  assert.equal(trusted.status, 200); assert.equal(trusted.value.restricted, false);
  const source = await host.request("/api/plugins/portable", "GET");
  assert.equal(source.value.code, f.bytes.get("Example/.obsidian/plugins/portable/main.js").toString());
  assert.match(source.value.css, /github-fixture/);
  assert.equal((await host.request("/api/community-plugins", "PUT", { root: host.root, version: before.value.version, enabled: [] })).status, 409);
  assert.equal((await f.reader.download(f.mount)).state, "complete");
  const freshReader = new GitHubReader(f.cache, () => { throw new Error("No GitHub requests are allowed"); }), fresh = new GitHubVaultHost(freshReader);
  fresh.select((await fresh.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.equal((await fresh.request("/api/community-plugins", "GET")).value.restricted, false);
  assert.equal((await fresh.request("/api/plugins/portable", "GET")).value.code, source.value.code);
  const offline = await freshReader.offlineStatus(f.mount);
  assert.equal(offline.cachedFiles, f.mount.files.length + f.mount.configurationFiles.length);
  assert.equal(freshReader.counters.raw, 0); assert.equal(fresh.info().loaded, 0);
  const restricted = await fresh.request("/api/community-plugins", "PUT", { root: fresh.root, version: trusted.value.version, enabled: trusted.value.enabled, restricted: true });
  assert.equal(restricted.status, 200); assert.equal((await fresh.request("/api/plugins/portable", "GET")).status, 403);
});

test("plugin data seeds from GitHub, persists falsy and array values locally, and is isolated by vault", async () => {
  const f = await fixture(true), host = new GitHubVaultHost(f.reader);
  host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const path = "/api/plugins/portable/data", original = Buffer.from(f.bytes.get("Example/.obsidian/plugins/portable/data.json"));
  assert.deepEqual((await host.request(path, "GET")).value, { fromRepository: true, value: 7 });
  for (const value of [false, 0, null, ["local", { retained: true }]]) {
    assert.equal((await host.request(path, "PUT", value)).status, 204);
    assert.deepEqual((await host.request(path, "GET")).value, value);
  }
  const fresh = new GitHubVaultHost(new GitHubReader(f.cache, () => { throw new Error("offline"); }));
  fresh.select((await fresh.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.deepEqual((await fresh.request(path, "GET")).value, ["local", { retained: true }]);
  assert.deepEqual(f.bytes.get("Example/.obsidian/plugins/portable/data.json"), original);
  const other = { ...f.mount, repository: "Different/Repository", id: "github-vault:" + encodeURIComponent(JSON.stringify(["different/repository", "main", "Example"])) };
  await f.cache.put("mount:" + other.id, other);
  fresh.select((await fresh.open({ url: other.repository, folder: "Example", cached: true }, definitions)).root);
  assert.deepEqual((await fresh.request(path, "GET")).value, { fromRepository: true, value: 7 });
  assert.equal((await fresh.request("/api/plugins/not-installed/data", "PUT", {})).status, 404);
});

test("malformed remote configuration and mismatched manifests remain explicit errors without fetching code", async () => {
  const f = await fixture(true);
  f.bytes.set("Example/.obsidian/plugins/portable/manifest.json", Buffer.from(JSON.stringify({ id: "another-plugin", name: "Wrong", version: "1.0.0", description: "Mismatch" })));
  f.bytes.set("Example/.obsidian/community-plugins.json", Buffer.from('{"invalid":"enabled must be an array"}'));
  f.bytes.set("Example/.obsidian/app.json", Buffer.from("[1,2,3]"));
  const host = new GitHubVaultHost(f.reader), snapshot = await host.open({ url: location.repository, folder: "Example" }, definitions); host.select(snapshot.root);
  assert.match(snapshot.plugins.find(plugin => plugin.id === "portable").error, /manifest/);
  assert.equal((await host.request("/api/community-plugins", "GET")).status, 422);
  assert.equal((await host.request("/api/configuration/app", "GET")).status, 422);
  assert.equal((await host.request("/api/plugins/portable", "GET")).status, 422);
  assert.ok(f.calls.every(call => !call.url.endsWith("/main.js")));
});

test("late plugin source responses are refused after either a vault switch or snapshot refresh", async () => {
  for (const action of ["switch", "refresh"]) {
    const f = await fixture(true); let release;
    const reader = new GitHubReader(f.cache, (url, options) => url.endsWith("/portable/main.js") ? new Promise(resolve => { release = () => resolve(f.fetcher(url, options)); }) : f.fetcher(url, options));
    const host = new GitHubVaultHost(reader); host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
    const configuration = (await host.request("/api/community-plugins", "GET")).value;
    await host.request("/api/community-plugins", "PUT", { root: host.root, version: configuration.version, enabled: configuration.enabled, restricted: false });
    const pending = host.request("/api/plugins/portable", "GET"); await until(() => release);
    if (action === "switch") host.select(null);
    else {
      assert.equal((await host.request("/api/vault/refresh", "POST")).status, 200);
    }
    release(); assert.equal((await pending).status, 409);
  }
});

test("older cache inventories remain readable and reject configuration paths outside the vault", async () => {
  const f = await fixture(), legacy = structuredClone(f.mount); delete legacy.configurationFiles;
  await f.cache.put("mount:" + legacy.id, legacy);
  assert.equal((await f.reader.cached(location)).files.length, 4);
  const invalid = structuredClone(f.mount);
  invalid.configurationFiles = [{ ...invalid.files[0], path: ".git/config", repositoryPath: "Example/.git/config" }];
  await f.cache.put("mount:" + invalid.id, invalid);
  await assert.rejects(f.reader.cached(location), /invalid file/);
});

test("truncated-tree walking includes the vault-root .obsidian directory and excludes other hidden directories", async () => {
  const f = await fixture(true), obsidian = "4".repeat(40), plugins = "5".repeat(40), portable = "6".repeat(40);
  const tree = (path, sha) => ({ path, sha, type: "tree", mode: "040000" });
  const blob = path => ({ ...f.entries().find(entry => entry.path === "Example/" + path), path: path.split("/").at(-1) });
  const reader = new GitHubReader(new MemoryCache(), async (url, options) => {
    if (url.includes("/commits/")) return f.fetcher(url, options);
    if (url.endsWith("?recursive=1")) return Response.json({ tree: [], truncated: true });
    const sha = url.split("/").at(-1);
    const listings = {
      [treeSha]: [tree("Example", folderSha)],
      [folderSha]: [blob("Start here.md"), tree(".obsidian", obsidian), tree(".private", "7".repeat(40))],
      [obsidian]: [blob(".obsidian/app.json"), tree("plugins", plugins)],
      [plugins]: [tree("portable", portable)],
      [portable]: [blob(".obsidian/plugins/portable/manifest.json"), blob(".obsidian/plugins/portable/main.js")],
    };
    assert.ok(listings[sha], "Other hidden directories must not be traversed");
    return Response.json({ tree: listings[sha], truncated: false });
  });
  const mount = await reader.discover(location);
  assert.equal(mount.files.length, 1);
  assert.deepEqual(mount.configurationFiles.map(file => file.path), [".obsidian/app.json", ".obsidian/plugins/portable/main.js", ".obsidian/plugins/portable/manifest.json"]);
  assert.equal(reader.counters.raw, 0);
});

test("an incomplete cache-only mount reports missing plugin/settings bytes without falling back to GitHub", async () => {
  const f = await fixture(true), reader = new GitHubReader(f.cache, () => { throw new Error("Network is forbidden"); }), host = new GitHubVaultHost(reader);
  const snapshot = await host.open({ url: location.repository, folder: "Example", cached: true }, definitions); host.select(snapshot.root);
  assert.equal(snapshot.plugins.length, 2); assert.ok(snapshot.plugins.every(plugin => /not cached/.test(plugin.error)));
  assert.equal((await host.request("/api/configuration/app", "GET")).status, 503);
  assert.equal(reader.counters.raw, 0); assert.equal(reader.counters.api, 0);
});

test("WASM GitHub mounts default to unrestricted after platform initialization and preserve an explicit restricted choice", async () => {
  // A separate module instance keeps its once-configured browser platform isolated from desktop cases.
  const wasm = await import(moduleUrl + "?wasm-default");
  const f = await fixture(true), reader = new wasm.GitHubReader(f.cache, f.fetcher);
  const host = new wasm.GitHubVaultHost(reader);
  wasm.configureBrowserHost({ request: async () => { throw new Error("The GitHub source must handle its own requests"); } });
  host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const initial = (await host.request("/api/community-plugins", "GET")).value;
  assert.equal(initial.restricted, false);
  assert.deepEqual(initial.enabled, ["portable", "desktop", "missing"]);
  assert.equal((await host.request("/api/plugins/portable", "GET")).status, 200, "Configured plugin source must be available without an opt-in write");
  assert.equal(await f.cache.get("preference:" + host.root + ":community"), undefined, "Reading a default must not persist a user choice");
  const cached = new wasm.GitHubVaultHost(new wasm.GitHubReader(f.cache, () => { throw new Error("offline"); }));
  cached.select((await cached.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.equal((await cached.request("/api/community-plugins", "GET")).value.restricted, false);
  assert.equal((await cached.request("/api/plugins/portable", "GET")).status, 200);
  const saved = await host.request("/api/community-plugins", "PUT", { root: host.root, version: initial.version, enabled: initial.enabled, restricted: true });
  assert.equal(saved.status, 200); assert.equal((await host.request("/api/plugins/portable", "GET")).status, 403);
  const fresh = new wasm.GitHubVaultHost(new wasm.GitHubReader(f.cache, () => { throw new Error("offline"); }));
  fresh.select((await fresh.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.equal((await fresh.request("/api/community-plugins", "GET")).value.restricted, true);
  assert.equal((await fresh.request("/api/plugins/portable", "GET")).status, 403);
  assert.equal((await fresh.request("/api/file", "PUT", { root: fresh.root, path: "Start here.md", content: "changed" })).status, 403);
});

test("installed appearance assets are commit-pinned, cache-only and verified without a raw download for oversized files", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const assets = [["themes/Portable/img/a.png", png], ["themes/Portable/img/bad.png", Buffer.from("nope")], ["themes/Portable/img/big.png", Buffer.alloc(8 * 1024 * 1024 + 1, 1)]];
  const f = await fixture(true, undefined, assets), host = new GitHubVaultHost(f.reader);
  host.select((await host.open({ url: location.repository, folder: "Example" }, definitions)).root);
  const url = path => "/api/appearance/asset?" + new URLSearchParams({ root: host.root, path });
  const good = await host.request(url(".obsidian/themes/Portable/img/a.png"), "GET");
  assert.equal(good.status, 200, good.error);
  assert.deepEqual(good.value, { root: host.root, path: ".obsidian/themes/Portable/img/a.png", contentType: "image/png", base64: png.toString("base64"), version: "git:" + blobSha(png), size: png.length });
  assert.equal((await host.request(url(".obsidian/themes/Portable/img/bad.png"), "GET")).status, 415);
  const rawBefore = f.reader.counters.raw;
  assert.equal((await host.request(url(".obsidian/themes/Portable/img/big.png"), "GET")).status, 413);
  assert.equal(f.reader.counters.raw, rawBefore);
  for (const path of [".obsidian/themes/Portable/a.svg", ".obsidian/app.json", ".obsidian/themes/../a.png"]) { assert.equal((await host.request(url(path), "GET")).status, 400, path); }
  assert.equal((await host.request(url(".obsidian/themes/Portable/img/none.png"), "GET")).status, 404);
  assert.equal((await host.request("/api/appearance/asset?root=other&path=.obsidian/themes/Portable/img/a.png", "GET")).status, 409);
  assert.equal((await host.request(url(".obsidian/themes/Portable/img/a.png"), "PUT", { content: "x" })).status, 403);
  assert.ok((await host.request("/api/appearance/theme", "PUT", { root: host.root, name: "Portable", cssBase64: "Ym9keXt9", manifestBase64: "e30=", expectedVersion: null })).status >= 400, "a read-only GitHub vault must refuse theme installs");
  assert.equal((await f.reader.download(f.mount)).state, "complete");
  const blobs = new Map([...f.cache.values].filter(([key]) => key.startsWith("blob:")).map(([key, value]) => [key, structuredClone(value)]));
  const offline = new GitHubVaultHost(new GitHubReader(f.cache, async () => { throw new Error("Cache-only appearance must not fetch."); }));
  offline.select((await offline.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  assert.deepEqual((await offline.request(url(".obsidian/themes/Portable/img/a.png"), "GET")).value, good.value);
  assert.ok(blobs.size >= 0);
});

async function cachedIndexHost(f, withFetch) {
  const reader = new GitHubReader(f.cache, withFetch ?? (async () => { throw new Error("Cache-only indexing must not fetch."); }));
  const host = new GitHubVaultHost(reader);
  host.select((await host.open({ url: location.repository, folder: "Example", cached: true }, definitions)).root);
  return { host, reader };
}

test("complete index verifies a fixed cached inventory with zero API/raw traffic and flips partial to complete", async () => {
  const f = await fixture(); assert.equal((await f.reader.download(f.mount)).state, "complete");
  const { host, reader } = await cachedIndexHost(f);
  assert.equal((await host.request("/api/vault", "GET")).value.lazy, true);
  assert.equal((await host.request("/api/metadata/documents", "GET")).value.complete, false);
  assert.equal((await host.indexStatus()).state, "none");
  assert.equal(host.info().loaded, 0, "Mounting must not index");
  const progress = [], before = { ...reader.counters };
  const status = await host.prepareIndex(event => progress.push(event.done));
  assert.equal(status.state, "complete"); assert.deepEqual(progress, [1, 2]);
  assert.deepEqual({ api: reader.counters.api, raw: reader.counters.raw }, { api: before.api, raw: before.raw });
  const snapshot = (await host.request("/api/vault", "GET")).value;
  assert.equal(snapshot.lazy, false); assert.equal(snapshot.indexComplete, true);
  const documents = (await host.request("/api/metadata/documents", "GET")).value;
  assert.equal(documents.complete, true); assert.equal(documents.documents.length, 2);
  assert.equal((await host.indexStatus()).state, "complete");
  const record = await reader.cache.get("index:" + host.root);
  assert.equal(record.complete, true); assert.equal(Object.keys(record.hashes).length, 2);
  assert.ok(Object.values(record.hashes).every(hash => /^[0-9a-f]{64}$/.test(hash)));
  assert.deepEqual(Object.keys(record).sort(), ["commit", "complete", "format", "hashes", "inventory", "mount", "savedAt", "total"], "The persisted record stores hashes, not note text");
});

test("complete index refuses missing or corrupt bytes and never falls back to the network", async () => {
  const f = await fixture(); await f.reader.download(f.mount);
  const md = f.mount.files.filter(file => /\.md$/.test(file.path));
  const saved = f.cache.values.get("blob:" + md[0].sha);
  f.cache.values.delete("blob:" + md[0].sha);
  const { host, reader } = await cachedIndexHost(f);
  const missing = await host.prepareIndex();
  assert.equal(missing.state, "refused"); assert.deepEqual(missing.missing, [md[0].path]); assert.equal(missing.resumable, true);
  assert.equal((await host.request("/api/vault", "GET")).value.lazy, true);
  assert.equal(reader.counters.raw, 0); assert.equal(reader.counters.api, 0);
  await f.cache.put("blob:" + md[0].sha, new ArrayBuffer(md[0].size));
  const corrupt = await host.prepareIndex();
  assert.equal(corrupt.state, "refused"); assert.deepEqual(corrupt.corrupt, [md[0].path]);
  await f.cache.put("blob:" + md[0].sha, saved);
  assert.equal((await host.prepareIndex()).state, "complete");
});

test("complete index cancel keeps verified progress and resume detects content changed since", async () => {
  const f = await fixture(); await f.reader.download(f.mount);
  const { host } = await cachedIndexHost(f);
  const run = host.prepareIndex(event => { if (event.done === 1) host.cancelIndex(); });
  const cancelled = await run;
  assert.equal(cancelled.state, "partial"); assert.equal(cancelled.resumable, true);
  assert.equal((await host.request("/api/vault", "GET")).value.lazy, true);
  assert.equal((await host.indexStatus()).state, "partial");
  const first_ = host.prepareIndex();
  await assert.rejects(host.prepareIndex(), /already running/);
  const resumed = await first_;
  assert.equal(resumed.state, "complete");
  const key = "index:" + host.root, record = await f.cache.get(key), first = Object.keys(record.hashes)[0];
  record.hashes[first] = "0".repeat(64); record.complete = false; await f.cache.put(key, record);
  const again = await cachedIndexHost(f);
  const tampered = await again.host.prepareIndex();
  assert.equal(tampered.state, "refused"); assert.deepEqual(tampered.corrupt, [first]);
});

test("complete index is fenced against vault selection, refresh and a different snapshot", async () => {
  const f = await fixture(); await f.reader.download(f.mount);
  const { host } = await cachedIndexHost(f);
  const other = await host.open({ url: "RonSijm/Other", folder: "Example", cached: true }, definitions).catch(() => null);
  assert.equal(other, null, "An uncached repository cannot be opened offline");
  const run = host.prepareIndex(event => { if (event.done === 1) host.select(null); });
  await assert.rejects(run, /vault changed/);
  host.select(f.mount.id);
  assert.equal((await host.indexStatus()).state, "refused");
  assert.equal((await host.request("/api/vault", "GET")).value.lazy, true, "A fenced run must not mark the vault complete");
  assert.equal((await host.request("/api/metadata/documents", "GET")).value.documents.length, 0);
  const refresh = await host.request("/api/vault/refresh", "POST", { root: host.root });
  assert.equal(refresh.status, 503, "Cache-only mode never rediscovers");
});

test("complete index refuses to adopt after the root changes at the held final-save boundary", async () => {
  const f = await fixture(); await f.reader.download(f.mount);
  const { host } = await cachedIndexHost(f);
  const originalPut = f.cache.put.bind(f.cache);
  let reached, release;
  const held = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.cache.put = async (key, value) => {
    if (String(key).startsWith("index:") && value.complete === true) { await originalPut(key, value); reached(); await gate; return; }
    return originalPut(key, value);
  };
  const run = host.prepareIndex();
  const outcome = run.then(() => "adopted", error => error.message);
  await held;
  host.select(null);
  release();
  assert.match(await outcome, /vault changed/, "The old completion must be refused after the final save.");
  const record = await f.cache.get("index:" + f.mount.id);
  assert.equal(record.complete, false, "No persisted complete claim survives a fenced run.");
  host.select(f.mount.id);
  assert.equal((await host.request("/api/vault", "GET")).value.lazy, true);
  assert.equal((await host.request("/api/metadata/documents", "GET")).value.documents.length, 0, "Nothing from the fenced run was adopted.");
});

test("a failed compensation after a held root change is surfaced, not swallowed", async () => {
  const f = await fixture(); await f.reader.download(f.mount);
  const { host } = await cachedIndexHost(f);
  const originalPut = f.cache.put.bind(f.cache);
  let reached, release;
  const held = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
  let completeWrites = 0;
  f.cache.put = async (key, value) => {
    if (String(key).startsWith("index:") && completeWrites > 0 && value.complete === false) { throw new Error("disk full"); }
    if (String(key).startsWith("index:") && value.complete === true) { completeWrites++; await originalPut(key, value); reached(); await gate; return; }
    return originalPut(key, value);
  };
  const outcome = host.prepareIndex().then(() => "adopted", error => error.message);
  await held;
  host.select(null);
  release();
  const message = await outcome;
  assert.match(message, /could not be reset/, "A failed compensation must be explicit.");
  assert.match(message, /disk full/);
  assert.equal((await f.cache.get("index:" + f.mount.id)).complete, true, "The test proves the stale claim really remains, which is why it must be reported.");
});

test("online lazy sessions can build a complete index only from cached bytes", async () => {
  const f = await fixture();
  const host = new GitHubVaultHost(f.reader);
  host.select((await host.open({ url: location.repository, ref: "main", folder: "Example" }, definitions)).root);
  const status = await host.prepareIndex();
  assert.equal(status.state, "refused"); assert.equal(status.missing.length, 2);
  assert.equal(f.reader.counters.raw, 0, "Index preparation must not download missing notes");
});
