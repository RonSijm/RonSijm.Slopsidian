import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";
import { createProfileStorage } from "../desktop/local-storage.cjs";

let host;
let directory;
let client;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "api-test-"));
  await cp(join(root, ".runtime", "DemoVault"), directory, { recursive: true });
  await writeFile(join(directory, "BOM.md"), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("Original\r\n")]));
  host = await startHost(directory);
  const runtime = await mkdtemp(join(root, ".runtime", "client-vault-tests-"));
  try {
    const outfile = join(runtime, "vault.mjs");
    await build({
      stdin: { contents: 'export { Vault } from "./vault"; export { VaultConfiguration } from "./configuration"; export { MetadataCache } from "./metadata";', resolveDir: join(root, "client"), loader: "ts" },
      outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
    });
    client = await import(pathToFileURL(outfile).href);
  } finally {
    await rm(runtime, { recursive: true });
  }
});
after(async () => {
  if (host) {
    await host.stop();
  }
  if (directory) {
    await rm(directory, { recursive: true });
  }
});

async function clientVault(t) {
  const forwardingFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (input, options) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      requests.push({ path: input, method: options?.method ?? "GET" });
      return host.request(input, options?.method ?? "GET", options?.body === undefined ? undefined : JSON.parse(options.body));
    }
    return forwardingFetch(input, options);
  };
  t.after(() => { globalThis.fetch = forwardingFetch; });
  const vault = new client.Vault(async () => {}, undefined, key => configuration.get("app", key));
  const configuration = new client.VaultConfiguration({ vault });
  vault.setSnapshot(await (await host.request("/api/vault")).json());
  return { vault, configuration, requests };
}

test("desktop vault-local storage survives reopening, isolates keys and observes other live connections", async t => {
  const folder = await mkdtemp(join(root, ".runtime", "profile-storage-test-"));
  t.after(() => rm(folder, { recursive: true }));
  const file = join(folder, "storage.sqlite"), first = createProfileStorage(file), second = createProfileStorage(file);
  try {
    first.setItem("vault-one:false", "false");
    first.setItem("vault-two:false", '{"nested":[0,false],"text":"Unicode λ"}');
    assert.equal(second.getItem("vault-one:false"), "false");
    second.setItem("vault-one:false", "0");
    assert.equal(first.getItem("vault-one:false"), "0");
    assert.equal(first.getItem("vault-two:false"), '{"nested":[0,false],"text":"Unicode λ"}');
    first.removeItem("vault-one:false");
    assert.equal(second.getItem("vault-one:false"), null);
  } finally { first.close(); second.close(); }
  const reopened = createProfileStorage(file);
  try {
    assert.equal(reopened.getItem("vault-one:false"), null);
    assert.equal(reopened.getItem("vault-two:false"), '{"nested":[0,false],"text":"Unicode λ"}');
  } finally { reopened.close(); }
});

test("desktop vault-local storage rejects invalid writes and corrupt databases without replacing previous data", async t => {
  const folder = await mkdtemp(join(root, ".runtime", "profile-storage-failure-test-"));
  t.after(() => rm(folder, { recursive: true }));
  const file = join(folder, "storage.sqlite"), storage = createProfileStorage(file);
  try {
    storage.setItem("retained", "original");
    assert.throws(() => storage.setItem("retained", undefined), TypeError);
    assert.throws(() => storage.removeItem(null), TypeError);
    assert.equal(storage.getItem("retained"), "original");
  } finally { storage.close(); }
  const invalid = join(folder, "invalid.sqlite"), bytes = Buffer.from("Not a database; do not replace.");
  await writeFile(invalid, bytes, { flag: "wx" });
  assert.throws(() => createProfileStorage(invalid), /not a database/);
  assert.deepEqual(await readFile(invalid), bytes);
});

test("loopback host requires its per-launch token and runs the .NET service", async () => {
  const denied = await fetch(host.endpoint + "/api/vault");
  assert.equal(denied.status, 401);
  const response = await host.request("/api/health");
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.application, "Slopsidian");
  assert.match(health.runtime, /^\.NET 10\./);
  assert.equal(health.compatibility, "experimental-subset");
});

test("metadata resolve events expose committed and dirty caches after links are ready, including changed target resolution", async t => {
  const { vault } = await clientVault(t);
  const source = await vault.create("Metadata Event Source.md", "---\nstatus: initial\n---\n[[Metadata Event Target]]\n");
  const sessions = new Map(), events = [];
  const app = {
    vault, workspace: { sessions, acceptExternalDocuments() {} },
    dotNet: { async invokeMethodAsync() {} }, async notifyEditor() {},
  };
  const cache = new client.MetadataCache(app);
  t.after(() => cache.pause());
  await cache.initialize(vault.rootPath);
  cache.on("changed", file => { if (file === source) { events.push("changed"); } });
  cache.on("resolve", file => {
    if (file === source) {
      events.push({ type: "resolve", status: cache.getFileCache(file).frontmatter.status, resolved: { ...cache.resolvedLinks[file.path] }, unresolved: { ...cache.unresolvedLinks[file.path] } });
    }
  });
  cache.on("resolved", () => events.push("resolved"));
  await vault.modify(source, "---\nstatus: committed\n---\n[[Metadata Event Target]]\n");
  await cache.refresh();
  assert.deepEqual(events, ["changed", { type: "resolve", status: "committed", resolved: {}, unresolved: { "Metadata Event Target": 1 } }, "resolved"]);
  events.length = 0;
  await cache.refresh();
  assert.deepEqual(events, ["resolved"], "An unchanged forced refresh must not re-notify per-file resolution.");
  events.length = 0;
  sessions.set(source.path, { document: await vault.readDocument(source.path), text: "---\nstatus: draft\n---\n[[Metadata Event Target]]\n", dirty: true, isSaving: false });
  cache.updateOpenDocuments();
  assert.deepEqual(events, ["changed", { type: "resolve", status: "draft", resolved: {}, unresolved: { "Metadata Event Target": 1 } }, "resolved"]);
  events.length = 0;
  const target = await vault.create("Metadata Event Target.md", "# Resolved target\n");
  await cache.refresh();
  assert.deepEqual(events, [{ type: "resolve", status: "draft", resolved: { [target.path]: 1 }, unresolved: {} }, "resolved"]);
});

test("unselected startup can safely create and open vaults without overwriting existing folders", async () => {
  const parent = join(directory, ".vault-selection");
  const existing = join(parent, "Existing vault");
  await mkdir(existing, { recursive: true });
  await writeFile(join(existing, "Keep.md"), "Existing notes must be preserved.\n");
  await writeFile(join(parent, "Existing file"), "Keep this file.");
  const unselected = await startHost();
  try {
    const initial = await (await unselected.request("/api/vault")).json();
    assert.equal(initial.root, null);
    assert.deepEqual(initial.files, []);
    assert.equal((await unselected.request("/api/workspace")).status, 409);
    for (const name of [null, "", "..", "../Escape", "Nested\\Vault", ".hidden", "CON", "Trailing.", "Trailing ", "a".repeat(256)]) {
      const rejected = await unselected.request("/api/vault/create", "POST", { name, parentPath: parent });
      assert.equal(rejected.status, 400, String(name));
      assert.ok((await rejected.json()).error);
    }
    for (const parentPath of [null, "relative", "C:\\invalid\0folder"]) {
      assert.equal((await unselected.request("/api/vault/create", "POST", { name: "Valid name", parentPath })).status, 400);
    }
    assert.equal((await unselected.request("/api/vault/create", "POST", { name: "Valid name", parentPath: join(parent, "Missing") })).status, 404);
    for (const name of ["Existing vault", "Existing file"]) {
      assert.equal((await unselected.request("/api/vault/create", "POST", { name, parentPath: parent })).status, 409);
    }
    assert.equal((await (await unselected.request("/api/vault")).json()).root, null);
    assert.equal(await readFile(join(existing, "Keep.md"), "utf8"), "Existing notes must be preserved.\n");
    assert.equal(await readFile(join(parent, "Existing file"), "utf8"), "Keep this file.");

    const createdPath = join(parent, "Created vault");
    const created = await unselected.request("/api/vault/create", "POST", { name: "Created vault", parentPath: parent });
    assert.equal(created.status, 200);
    const snapshot = await created.json();
    assert.equal(snapshot.root, createdPath);
    assert.deepEqual(snapshot.files, []);
    assert.deepEqual(await readdir(createdPath), []);
    const content = "# First note\nCreated in the new vault.\n";
    assert.equal((await unselected.request("/api/file", "POST", { path: "First.md", content })).status, 200);
    assert.equal(await readFile(join(createdPath, "First.md"), "utf8"), content);
    assert.equal((await unselected.request("/api/vault/create", "POST", { name: "Created vault", parentPath: parent })).status, 409);
    for (const path of [null, "relative", "C:\\invalid\0folder"]) {
      assert.equal((await unselected.request("/api/vault/open", "POST", { path })).status, 400);
    }
    assert.equal((await (await unselected.request("/api/vault")).json()).root, createdPath);
    const opened = await unselected.request("/api/vault/open", "POST", { path: existing });
    assert.equal(opened.status, 200);
    assert.equal((await opened.json()).root, existing);
    assert.equal(await readFile(join(createdPath, "First.md"), "utf8"), content);
    assert.deepEqual((await readdir(parent)).sort(), ["Created vault", "Existing file", "Existing vault"]);
  } finally {
    await unselected.stop();
  }
});

test("Markdown roundtrip is exact and conflicting saves do not overwrite newer content", async () => {
  const path = "Nested/Roundtrip.md";
  const content = "# Roundtrip\r\n\r\nSaved by C#. \u03bb \u4e2d\u6587\r\n";
  const created = await host.request("/api/file", "POST", { path, content });
  assert.equal(created.status, 200);
  const first = await created.json();
  assert.equal(await readFile(join(directory, "Nested", "Roundtrip.md"), "utf8"), content);
  const saved = await host.request("/api/file", "PUT", { path, content: content + "Second save.\r\n", version: first.version });
  assert.equal(saved.status, 200);
  const second = await saved.json();
  assert.equal(second.file.stat.ctime, first.file.stat.ctime);
  assert.notEqual(second.version, first.version);
  const conflict = await host.request("/api/file", "PUT", { path, content: "Must not overwrite.", version: first.version });
  assert.equal(conflict.status, 409);
  assert.equal(await readFile(join(directory, "Nested", "Roundtrip.md"), "utf8"), content + "Second save.\r\n");
  const external = "Changed by another editor.\n";
  await writeFile(join(directory, "Nested", "Roundtrip.md"), external);
  const externalConflict = await host.request("/api/file", "PUT", { path, content: "Stale text.", version: second.version });
  assert.equal(externalConflict.status, 409);
  assert.equal(await readFile(join(directory, "Nested", "Roundtrip.md"), "utf8"), external);
});

test("text-file reads and writes remain bound to their original vault even when both vaults contain identical bytes", async () => {
  const second = join(directory, ".root-scope-vault");
  await mkdir(second);
  await writeFile(join(directory, "Scoped.probeedit"), "Same original bytes.\n");
  await writeFile(join(second, "Scoped.probeedit"), "Same original bytes.\n");
  const before = await (await host.request("/api/file?path=Scoped.probeedit&root=" + encodeURIComponent(directory))).json();
  try {
    assert.equal((await host.request("/api/vault/open", "POST", { path: second })).status, 200);
    assert.equal((await host.request("/api/file?path=Scoped.probeedit&root=" + encodeURIComponent(directory))).status, 409);
    assert.equal((await host.request("/api/file", "PUT", { root: directory, path: "Scoped.probeedit", version: before.version, content: "A stale view must not write into the other vault." })).status, 409);
    const layout = workspaceLayout();
    const staleLayout = "/api/workspace?root=" + encodeURIComponent(directory);
    assert.equal((await host.request(staleLayout)).status, 409);
    assert.equal((await host.request(staleLayout, "PUT", layout)).status, 409);
    assert.equal((await host.request("/api/workspace/validate?root=" + encodeURIComponent(directory), "POST", layout)).status, 409);
    assert.equal((await host.request("/api/workspace/validate?root=" + encodeURIComponent(second), "POST", layout)).status, 200);
    await assert.rejects(readFile(join(second, ".obsidian", "vault-dotnet-workspace.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(second, "Scoped.probeedit"), "utf8"), "Same original bytes.\n");
    const current = await host.request("/api/file?path=Scoped.probeedit&root=" + encodeURIComponent(second));
    assert.equal(current.status, 200);
    assert.equal((await current.json()).version, before.version);
  } finally {
    await host.request("/api/vault/open", "POST", { path: directory });
  }
});

test("reading-view images retain binary bytes and reject private paths, stale roots and active formats", async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 128]);
  await writeFile(join(directory, "Image.png"), bytes);
  await writeFile(join(directory, "Active.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script></svg>');
  await writeFile(join(directory, "Unsupported.constructor"), bytes);
  const query = path => "/api/resource?root=" + encodeURIComponent(directory) + "&path=" + encodeURIComponent(path);
  const response = await host.request(query("Image.png"));
  assert.equal(response.status, 200);
  const resource = await response.json();
  assert.equal(resource.contentType, "image/png");
  assert.deepEqual(Buffer.from(resource.base64, "base64"), bytes);
  assert.equal((await host.request("/api/resource?root=old-vault&path=Image.png")).status, 409);
  assert.equal((await host.request(query("../Image.png"))).status, 400);
  assert.equal((await host.request(query(".obsidian/workspace.json"))).status, 400);
  assert.equal((await host.request(query("Active.svg"))).status, 415);
  assert.equal((await host.request(query("Unsupported.constructor"))).status, 415);
  assert.equal((await host.request(query("Missing.png"))).status, 404);
});

test("editing preserves an existing UTF-8 BOM and rejects accidental create-overwrite", async () => {
  const response = await host.request("/api/file?path=BOM.md");
  const original = await response.json();
  assert.equal(original.content, "Original\r\n");
  const updated = await host.request("/api/file", "PUT", { path: "BOM.md", content: "Updated\r\n", version: original.version });
  assert.equal(updated.status, 200);
  assert.deepEqual(await readFile(join(directory, "BOM.md")), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("Updated\r\n")]));
  const duplicate = await host.request("/api/file", "POST", { path: "BOM.md", content: "Overwrite" });
  assert.equal(duplicate.status, 409);
});

test("file operations reject traversal, absolute paths, and hidden configuration access", async () => {
  for (const path of ["../outside.md", "nested/../../outside.md", "C:\\outside.md", ".obsidian/community-plugins.json", "nested//note.md", "folder./note.md", "folder /note.md", "CON.md"]) {
    const response = await host.request("/api/file", "POST", { path, content: "Not allowed" });
    assert.equal(response.status, 400, path);
  }
  const missingVersion = await host.request("/api/file", "PUT", { path: "Welcome.md", content: "No version" });
  assert.equal(missingVersion.status, 428);
  for (const body of [{ path: null, content: "" }, { path: "Invalid.md", content: null }]) {
    const invalid = await host.request("/api/file", "POST", body);
    assert.equal(invalid.status, 400);
    assert.ok((await invalid.json()).error);
  }
});

test("adapter stats inspect actual hidden and visible paths with missing, root and path guards", async t => {
  const path = ".obsidian/adapter-stat.json", text = '{ "value": "\u03bb" }\r\n';
  await writeFile(join(directory, path), text);
  await writeFile(join(directory, ".obsidian", "adapter-empty.json"), "");
  const { vault } = await clientVault(t);
  assert.equal(vault.getAbstractFileByPath(path), null);
  const actual = await vault.adapter.stat(path), disk = await stat(join(directory, path));
  assert.equal(actual.type, "file");
  assert.equal(actual.size, disk.size);
  assert.equal(actual.mtime, Math.trunc(disk.mtimeMs));
  assert.equal(actual.ctime, Math.trunc(disk.birthtimeMs));
  assert.equal(await vault.adapter.exists(path), true);
  assert.equal((await vault.adapter.stat(".obsidian/adapter-empty.json")).size, 0);
  assert.equal((await vault.adapter.stat(".obsidian")).type, "folder");
  assert.equal((await vault.adapter.stat("/")).type, "folder");
  assert.equal((await vault.adapter.stat("BOM.md")).type, "file");
  assert.equal(await vault.adapter.stat(".obsidian/adapter-absent.json"), null);
  assert.equal(await vault.adapter.exists(".obsidian/adapter-absent.json"), false);
  assert.equal(await vault.adapter.stat("BOM.md/child"), null);
  const url = path => "/api/adapter/stat?" + new URLSearchParams({ root: directory, path });
  for (const invalid of ["../Outside", ".obsidian/../Outside", "C:\\Windows\\win.ini", "/outside", "file:stream", "CON"]) {
    assert.equal((await host.request(url(invalid))).status, 400, invalid);
  }
  assert.equal((await host.request("/api/adapter/stat?" + new URLSearchParams({ root: "stale-root", path }))).status, 409);
  assert.equal((await host.request("/api/file?path=" + encodeURIComponent(path))).status, 400, "Raw metadata must not widen ordinary text-file access.");
  assert.equal(await readFile(join(directory, path), "utf8"), text);
});

test("plugin data has a real JSON-null initial state and persists independently", async () => {
  const initial = await host.request("/api/plugins/sample-plugin/data");
  assert.equal(initial.status, 200);
  assert.equal(await initial.text(), "null");
  const data = { mySetting: "Persisted by the C# host" };
  const written = await host.request("/api/plugins/sample-plugin/data", "PUT", data);
  assert.equal(written.status, 204);
  assert.deepEqual(JSON.parse(await readFile(join(directory, ".obsidian", "plugins", "sample-plugin", "data.json"), "utf8")), data);
  assert.deepEqual(await (await host.request("/api/plugins/sample-plugin/data")).json(), data);
  await writeFile(join(directory, ".obsidian", "plugins", "sample-plugin", "data.json"), "{invalid");
  assert.equal((await host.request("/api/plugins/sample-plugin/data")).status, 422);
});

test("malformed plugins remain visible with a specific error instead of being silently skipped", async () => {
  const folder = join(directory, ".obsidian", "plugins", "broken-plugin");
  await mkdir(folder);
  await writeFile(join(folder, "manifest.json"), "{invalid");
  const snapshot = await (await host.request("/api/vault")).json();
  const plugin = snapshot.plugins.find(item => item.id === "broken-plugin");
  assert.ok(plugin?.error);
  const source = await host.request("/api/plugins/broken-plugin");
  assert.equal(source.status, 422);
});

function workspaceLayout() {
  return {
    version: 1,
    main: {
      id: "main", type: "split", direction: "vertical",
      children: [
        {
          id: "first-tabs", type: "tabs", currentTab: 1,
          children: [
            { id: "welcome-leaf", type: "leaf", state: { type: "markdown", state: { file: "Welcome.md" }, pinned: false } },
            { id: "bom-leaf", type: "leaf", state: { type: "markdown", state: { file: "BOM.md" }, pinned: true } },
          ],
        },
        { id: "second-tabs", type: "tabs", currentTab: 0, children: [{ id: "empty-leaf", type: "leaf", state: { type: "empty", pinned: false } }] },
      ],
    },
    active: "bom-leaf",
    left: { width: 245, collapsed: false },
    right: { width: 270, collapsed: true },
  };
}

test("per-vault workspace survives a host restart without modifying Obsidian's own layout", async () => {
  const path = join(directory, ".obsidian", "vault-dotnet-workspace.json");
  await rm(path, { force: true });
  assert.equal(await (await host.request("/api/workspace")).text(), "null");
  const original = '{"main":{"type":"original-layout"},"unknown":{"preserve":true}}\n';
  await writeFile(join(directory, ".obsidian", "workspace.json"), original);
  const layout = workspaceLayout();
  layout.main.children[0].children[1].state.state.mode = "preview";
  layout.main.children[0].children[1].state.state.source = false;
  layout.main.children[0].children[0].state.state.source = true;
  const custom = { type: "fixture:panel", state: { label: "Retained", filter: ["one", "two"], mode: { opaque: true }, future: { nested: [null, true, 3] } }, pinned: true };
  layout.main.children[0].children.push({ id: "custom-main", type: "leaf", state: custom });
  layout.left.root = {
    id: "left-root", type: "split", direction: "horizontal", children: [
      { id: "left-tabs", type: "tabs", currentTab: 0, children: [{ id: "custom-side", type: "leaf", state: custom }] },
    ],
  };
  layout.active = "custom-side";
  assert.equal((await host.request("/api/workspace", "PUT", layout)).status, 204);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.main.children[0].children[1].state.state.file, "BOM.md");
  assert.equal(saved.main.children[0].children[1].state.pinned, true);
  assert.equal(saved.main.children[0].children[1].state.state.mode, "preview");
  assert.equal(saved.main.children[0].children[1].state.state.source, false);
  assert.equal(saved.main.children[0].children[0].state.state.source, true);
  assert.equal(Object.hasOwn(saved.main.children[0].children[0].state.state, "mode"), false);
  assert.equal(saved.main.children[0].currentTab, 1);
  assert.equal(saved.active, "custom-side");
  assert.equal(saved.left.width, layout.left.width);
  assert.equal(saved.left.collapsed, layout.left.collapsed);
  assert.deepEqual(saved.main.children[0].children[2].state, custom);
  assert.deepEqual(saved.left.root.children[0].children[0].state, custom);
  await host.stop();
  host = await startHost(directory);
  assert.deepEqual(await (await host.request("/api/workspace")).json(), saved);
  assert.equal(await readFile(join(directory, ".obsidian", "workspace.json"), "utf8"), original);
});

test("invalid workspace trees and paths cannot replace a valid saved layout", async () => {
  const path = join(directory, ".obsidian", "vault-dotnet-workspace.json");
  const original = await readFile(path, "utf8");
  const mutations = [
    layout => { layout.main.type = "tabs"; },
    layout => { layout.main.children[0].children[1].id = "welcome-leaf"; },
    layout => { layout.main.children[0].children[0].state.state.file = "../outside.md"; },
    layout => { layout.main.children[0].children[0].state.state.file = null; },
    layout => { layout.main.children[0].currentTab = 10; },
    layout => { layout.main.children[0].children[0].state.type = ""; },
    layout => { layout.main.children[0].children[0].state = { type: "fixture:panel", state: [], pinned: false }; },
    layout => { layout.main.children[0].children[0].state.type = "invalid\u0000view"; },
    layout => { layout.left.root = { ...layout.main, id: "left-root" }; },
    layout => { layout.right.root = layout.main.children[0]; },
    layout => { layout.main.children[0].children[0].state.state.mode = "invalid"; },
    layout => { layout.main.children[0].children[0].state.state.source = "false"; },
    layout => { layout.main.children[0].children[0].state.state.source = 0; },
    layout => { layout.active = "unknown-leaf"; },
    layout => { layout.left.width = 0; },
  ];
  for (const mutate of mutations) {
    const layout = workspaceLayout();
    mutate(layout);
    assert.equal((await host.request("/api/workspace/validate?root=" + encodeURIComponent(directory), "POST", layout)).status, 400);
    const rejected = await host.request("/api/workspace", "PUT", layout);
    assert.equal(rejected.status, 400, JSON.stringify(layout));
    assert.ok((await rejected.json()).error);
    assert.equal(await readFile(path, "utf8"), original);
  }
  await writeFile(path, "{invalid");
  assert.equal((await host.request("/api/workspace")).status, 422);
  await writeFile(path, original);
});

test("client vault processing serializes real writes and rejects invalid, failed and retargeted callbacks without losing bytes", async t => {
  const path = "Client process.md";
  const initial = "Original \u03bb\r\n";
  await writeFile(join(directory, path), Buffer.from("\ufeff" + initial));
  const { vault, requests } = await clientVault(t);
  const file = vault.getFileByPath(path);
  const observed = [];
  vault.on("modify", changed => { if (changed === file) { observed.push(changed.path); } });
  const first = vault.process(file, text => text + "First\r\n");
  const second = vault.process(file, text => text + "Second\r\n");
  const expected = initial + "First\r\nSecond\r\n";
  assert.deepEqual(await Promise.all([first, second]), [initial + "First\r\n", expected]);
  assert.deepEqual(observed, [path, path]);
  const writes = () => requests.filter(request => request.path === "/api/file" && request.method === "PUT").length;
  assert.equal(writes(), 2);
  assert.equal(await vault.process(file, text => text), expected);
  assert.equal(writes(), 2, "An unchanged callback must not rewrite the file or emit another modification");
  assert.deepEqual(observed, [path, path]);
  const failure = new Error("Actual callback failure");
  const failed = vault.process(file, () => { throw failure; });
  const following = vault.process(file, text => text + "Recovered\r\n");
  await assert.rejects(failed, error => error === failure);
  assert.equal(await following, expected + "Recovered\r\n");
  await assert.rejects(vault.process(file, () => undefined), /return text synchronously/);
  await assert.rejects(vault.process(file, async () => "Not synchronous"), /return text synchronously/);
  await assert.rejects(vault.process(file, () => "Not supported", { mtime: 1 }), /write options are not supported/);
  const beforeRetarget = writes();
  await assert.rejects(vault.process(file, text => {
    vault.setSnapshot({ root: directory + "-other", name: "Other", files: [], plugins: [] });
    return text + "Must not be written";
  }), /file or selected vault changed/);
  assert.equal(writes(), beforeRetarget);
  assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + expected + "Recovered\r\n"));
});

test("cached configuration clones real values and rejects stale selection epochs without letting old reads undo a completed write", { timeout: 10000 }, async t => {
  const { vault, configuration } = await clientVault(t);
  assert.throws(() => vault.getConfig("newFileLocation"), /Load the selected vault/);
  let document = await configuration.read("app");
  document = await configuration.write(document, {
    ...document.data, newFileLocation: "folder", futureClientConfiguration: { values: ["kept"] },
  });
  const value = vault.getConfig("futureClientConfiguration");
  value.values.push("Must not mutate the cache");
  document.data.futureClientConfiguration.values.push("Returned documents must also be detached");
  assert.deepEqual(vault.getConfig("futureClientConfiguration"), { values: ["kept"] });
  for (const action of ["write", "clear"]) {
    const forwardingFetch = globalThis.fetch;
    const arrived = Promise.withResolvers();
    const released = Promise.withResolvers();
    let held = false;
    globalThis.fetch = async (input, options) => {
      const response = await forwardingFetch(input, options);
      if (!held && typeof input === "string" && input.startsWith("/api/configuration/app?") && options?.method === "GET") {
        held = true;
        const text = await response.text();
        arrived.resolve();
        await released.promise;
        return new Response(text, { status: response.status, headers: response.headers });
      }
      return response;
    };
    const reading = configuration.read("app");
    try {
      await Promise.race([arrived.promise, reading.then(() => assert.fail("The real configuration response was not held"))]);
      if (action === "write") {
        document = await configuration.read("app");
        await configuration.write(document, { ...document.data, newFileLocation: "current" });
        released.resolve();
        assert.equal((await reading).data.newFileLocation, "folder");
        assert.equal(vault.getConfig("newFileLocation"), "current");
      } else {
        configuration.clear();
        assert.throws(() => vault.getConfig("newFileLocation"), /Load the selected vault/);
        const rejected = assert.rejects(reading, /vault changed while reading/);
        released.resolve();
        await rejected;
        await configuration.read("app");
        assert.equal(vault.getConfig("newFileLocation"), "current");
      }
    } finally {
      released.resolve();
      globalThis.fetch = forwardingFetch;
      await Promise.allSettled([reading]);
    }
  }
  const saved = await configuration.read("app");
  assert.deepEqual(saved.data.futureClientConfiguration, { values: ["kept"] });
});
