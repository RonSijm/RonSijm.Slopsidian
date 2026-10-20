import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, VaultConfiguration, Vault;
const realFetch = globalThis.fetch;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "configuration-lifecycle-tests-"));
  const outfile = join(directory, "configuration.mjs");
  await build({ stdin: { contents: 'export { VaultConfiguration } from "./client/configuration"; export { Vault } from "./client/vault";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  ({ VaultConfiguration, Vault } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/configuration-lifecycle-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
afterEach(() => { globalThis.fetch = realFetch; });

// A fake host: versioned documents per root, with controllable gates on reads and writes.
function host() {
  const documents = new Map(), gates = [], log = [];
  const get = (rootPath, id) => {
    const key = `${rootPath}\0${id}`;
    if (!documents.has(key)) { documents.set(key, { root: rootPath, id, data: {}, version: "v0" }); }
    return documents.get(key);
  };
  const gate = kind => { const hit = gates.findIndex(entry => entry.kind === kind); return hit < 0 ? null : gates.splice(hit, 1)[0].promise; };
  globalThis.fetch = async (path, init = {}) => {
    const method = init.method ?? "GET";
    const reply = (status, value) => ({ ok: status < 400, status, text: async () => JSON.stringify(value) });
    if (method === "GET") {
      const url = new URL(path, "http://host"), rootPath = url.searchParams.get("root"), id = decodeURIComponent(url.pathname.split("/").pop());
      const snapshot = structuredClone(get(rootPath, id));
      const wait = gate("read"); if (wait) { await wait; }
      log.push(["read", id]);
      return reply(200, snapshot);
    }
    const id = decodeURIComponent(path.split("/").pop()), body = JSON.parse(init.body), current = get(body.root, id);
    const wait = gate("write"); if (wait) { await wait; }
    if (body.version !== current.version) { return reply(409, "The configuration changed on disk."); }
    current.data = body.data; current.version = `v${Number(current.version.slice(1)) + 1}`;
    log.push(["write", id, structuredClone(body.data)]);
    return reply(200, structuredClone(current));
  };
  return { documents, log, get, hold(kind) { let release; const promise = new Promise(resolve => { release = resolve; }); gates.push({ kind, promise }); return release; } };
}
function fixture(rootPath = "/vault") {
  const app = { vault: { rootPath } };
  const configuration = new VaultConfiguration(app);
  return { app, configuration, enter(next) { app.vault.rootPath = next; configuration.clear(); } };
}

test("a queued update captured before clear is rejected explicitly after re-entering the same root", async () => {
  const fake = host(), { configuration, enter } = fixture();
  await configuration.read("app");
  const release = fake.hold("write");
  const first = configuration.update("app", data => { data.first = true; });
  const queued = configuration.update("app", data => { data.queued = true; });
  const queuedFailure = assert.rejects(queued, /queued update was not applied/);
  await new Promise(resolve => setTimeout(resolve, 5));
  enter("/vault");
  release();
  await assert.rejects(first, /previous vault|reset/);
  await queuedFailure;
  assert.equal(fake.get("/vault", "app").data.queued, undefined);
  const fresh = await configuration.update("app", data => { data.fresh = true; });
  assert.equal(fresh.data.fresh, true);
});

test("an update whose change callback is running during clear cannot write under the new generation", async () => {
  const fake = host(), { configuration, enter } = fixture();
  await assert.rejects(configuration.update("app", data => { enter("/vault"); data.stale = true; }), /not applied/);
  assert.equal(fake.get("/vault", "app").version, "v0");
  assert.equal(fake.log.some(entry => entry[0] === "write"), false);
});

test("a read held across a write returns the newer written document and keeps the cache", async () => {
  const fake = host(), { configuration } = fixture();
  const release = fake.hold("read");
  const held = configuration.read("app");
  await new Promise(resolve => setTimeout(resolve, 5));
  const written = await configuration.write({ root: "/vault", id: "app", data: {}, version: "v0" }, { theme: "dark" });
  release();
  const result = await held;
  assert.equal(result.version, written.version);
  assert.deepEqual(result.data, { theme: "dark" });
  assert.equal(configuration.get("app", "theme"), "dark");
});

test("an older concurrent read cannot replace a newer adopted read or notify watchers", async () => {
  const fake = host(), { configuration } = fixture();
  const seen = [];
  configuration.watch("app", document => seen.push(document.version));
  const release = fake.hold("read");
  const older = configuration.read("app");
  await new Promise(resolve => setTimeout(resolve, 5));
  fake.get("/vault", "app").data = { value: 2 }; fake.get("/vault", "app").version = "v7";
  const newer = await configuration.read("app");
  release();
  const stale = await older;
  assert.equal(newer.version, "v7");
  assert.equal(stale.version, "v7");
  assert.deepEqual(seen, ["v7"]);
  assert.equal(configuration.get("app", "value"), 2);
});

test("watchers see accepted external changes via refresh, ignore identical versions and end on leave or same-root re-entry", async () => {
  const fake = host(), { configuration, enter } = fixture();
  const seen = [];
  const stop = configuration.watch("app", document => seen.push([document.version, document.data.mode]));
  await configuration.refresh("app");
  await configuration.refresh("app");
  fake.get("/vault", "app").data = { mode: "dark" }; fake.get("/vault", "app").version = "v5";
  await configuration.refresh("app");
  assert.deepEqual(seen, [["v0", undefined], ["v5", "dark"]]);
  configuration.watch("app", () => { throw new Error("listener failure is isolated"); });
  fake.get("/vault", "app").version = "v6";
  await configuration.refresh("app");
  assert.equal(seen.length, 3);
  stop();
  enter("/vault");
  fake.get("/vault", "app").version = "v8";
  await configuration.refresh("app");
  assert.equal(seen.length, 3);
});

const until = async (check, label) => {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) { return; } await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail(label);
};

test("a subscribed watch polls for external changes on its own and stops on unsubscribe and clear", async () => {
  const fake = host(), { configuration, enter } = fixture();
  configuration.pollMilliseconds = 10;
  const seen = [];
  const stop = configuration.watch("app", document => seen.push(document.version));
  await until(() => seen.length === 1, "initial poll");
  fake.get("/vault", "app").data = { mode: "dark" }; fake.get("/vault", "app").version = "v7";
  await until(() => seen.includes("v7"), "external change detected without refresh");
  stop();
  const reads = fake.log.length;
  fake.get("/vault", "app").version = "v8";
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(fake.log.length, reads, "no polling after the last watcher leaves");
  assert.equal(seen.includes("v8"), false);
  configuration.watch("app", document => seen.push(document.version));
  await until(() => seen.includes("v8"), "resubscribed");
  enter("/vault");
  const after = fake.log.length;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(fake.log.length, after, "clear stops polling");
});

test("polling does not overlap reads and routes poll failures to the error listener", async () => {
  const fake = host(), { configuration } = fixture();
  configuration.pollMilliseconds = 5;
  const errors = [];
  const release = fake.hold("read");
  const stop = configuration.watch("app", () => {}, error => errors.push(error));
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(fake.log.filter(entry => entry[0] === "read").length, 0, "the held read blocks further polls");
  release();
  await until(() => fake.log.length > 0, "held read completes");
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => JSON.stringify("boom") });
  await until(() => errors.length > 0, "error routed");
  globalThis.fetch = previous;
  stop();
});

test("reads and writes fail explicitly for changed roots, changed versions and non-object data", async () => {
  const fake = host(), { app, configuration } = fixture();
  const document = await configuration.read("app");
  await assert.rejects(configuration.write({ ...document, root: "/other" }, {}), /changed before saving/);
  await assert.rejects(configuration.write(document, []), /JSON object/);
  fake.get("/vault", "app").version = "v9";
  await assert.rejects(configuration.write(document, { a: 1 }), /changed on disk|409/);
  assert.equal(fake.log.some(entry => entry[0] === "write"), false);
  const release = fake.hold("read");
  const held = configuration.read("app");
  await new Promise(resolve => setTimeout(resolve, 5));
  app.vault.rootPath = "/other";
  release();
  await assert.rejects(held, /changed while reading/);
  app.vault.rootPath = null;
  await assert.rejects(configuration.read("app"), /Open a vault/);
});

test("update preserves unknown keys and queued writes run in order without dropping any", async () => {
  const fake = host(), { configuration } = fixture();
  fake.get("/vault", "app").data = { unknown: { nested: [1, "\ufeff"] }, count: 0 };
  await Promise.all([1, 2, 3].map(() => configuration.update("app", data => { data.count += 1; })));
  assert.deepEqual(fake.get("/vault", "app").data, { unknown: { nested: [1, "\ufeff"] }, count: 3 });
  assert.equal(fake.log.filter(entry => entry[0] === "write").length, 3);
  await configuration.whenIdle();
});

test("Vault.getConfig reads the live cache and setConfigAsync is an explicit awaited extension", async () => {
  const fake = host(), { app, configuration } = fixture();
  await configuration.read("app");
  const vault = new Vault(async () => {}, undefined, key => configuration.get("app", key), (key, value) => configuration.update("app", data => { data[key] = value; }).then(() => {}));
  vault.setSnapshot({ root: "/vault", name: "v", files: [], folders: [], plugins: [] });
  assert.equal(vault.getConfig("newFileLocation"), "root");
  await vault.setConfigAsync("newFileLocation", "current");
  assert.equal(vault.getConfig("newFileLocation"), "current");
  assert.equal(fake.get("/vault", "app").data.newFileLocation, "current");
  const readOnly = new Vault(async () => {}, undefined, key => configuration.get("app", key));
  readOnly.setSnapshot({ root: "/vault", name: "v", files: [], folders: [], plugins: [] });
  await assert.rejects(readOnly.setConfigAsync("newFileLocation", "root"), /writable vault/);
  void app;
});
