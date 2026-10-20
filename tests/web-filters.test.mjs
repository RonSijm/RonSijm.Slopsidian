import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

const require = createRequire(import.meta.url);
const { FilterStore } = require("../desktop/web-adblock-filters.cjs");
const engine = require("../.runtime/web-adblock/engine.cjs");
const sha = text => createHash("sha256").update(text).digest("hex");
const LIST = "! Title: Local\n||ads.example^$script\nexample.org##.banner\n";
const OTHER = "||other.example^\n";
const review = (text = LIST, url = "https://lists.example/a.txt") => ({ url, text, sha256: sha(text), bytes: Buffer.byteLength(text), stats: { network: 1, exceptions: 0, cosmetic: 1, unsupported: 0, ignored: 0 }, title: "Local", version: "", retrievedAt: "2026-01-01T00:00:00.000Z" });

let temporary, WebFilters, WebFilterData, WEB_FILTERS_CONFIGURATION, notices;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-filters-tests-"));
  const entry = join(temporary, "filters.mjs");
  await build({ stdin: { contents: 'export { WebFilters } from "./client/web-filters"; export { WebFilterData, WEB_FILTERS_CONFIGURATION } from "./client/web-filters-model";', resolveDir: root },
    outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "ui-fixture", setup(build) {
      build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice { constructor(message) { globalThis.__filterNotices.push(message); } } export class Modal {}" }));
    } }] });
  globalThis.__filterNotices = notices = [];
  ({ WebFilters, WebFilterData, WEB_FILTERS_CONFIGURATION } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, { recursive: true }); } });

// One shared "disk" keyed by vault root stands in for the .NET vault configuration; each App is one app run.
function world() {
  const disk = new Map(); let versions = 0, failUpdates = 0;
  const run = (rootPath = "vault-a", options = {}) => {
    const store = new FilterStore({ bundledText: async () => "||bundled.example^\n", defaultEngine: async () => null, compile: options.compile ?? engine.compile });
    const calls = [];
    const app = { vault: { rootPath }, changingVault: false, workspace: { trigger(name) { calls.push(name); } },
      configuration: {
        async read(id) { const entry = disk.get(app.vault.rootPath + "/" + id); return { root: app.vault.rootPath, id, data: structuredClone(entry?.data ?? {}), version: entry?.version ?? null }; },
        async update(id, change) {
          if (failUpdates > 0 && --failUpdates === 0) { throw new Error("vault write failed"); }
          const key = app.vault.rootPath + "/" + id, entry = disk.get(key);
          const data = structuredClone(entry?.data ?? {}); change(data);
          const next = { data, version: "v" + ++versions }; disk.set(key, next);
          return { root: app.vault.rootPath, id, data: structuredClone(data), version: next.version };
        } } };
    const ipc = { invoke: async (channel, request) => {
      assert.equal(channel, "webviewer:filters");
      if (request.action === "apply") { return store.apply(structuredClone(request.filters)); }
      if (request.action === "reset") { store.reset(); return store.status(); }
      if (request.action === "status") { return store.status(); }
      throw new Error("unexpected " + request.action);
    } };
    const filters = new WebFilters(app, () => ipc);
    return { app, store, filters, calls };
  };
  return { disk, run, failNextUpdates: count => { failUpdates = count; } };
}
const blocks = async (store, url) => Boolean((await store.current())({ url, resourceType: "script", referrer: "https://page.example/" }));

test("bundled loopback exemptions preserve host-specific subscription cosmetics", async () => {
  const bundled = await readFile(join(root, "vendor", "easylist", "easylist.txt"), "utf8");
  const match = engine.compile([bundled, "##.sub-generic\n127.0.0.1##.sub-explicit\n"], { cosmetic: true });
  const { styles } = match.cosmetics("http://127.0.0.1:32100/sub-story", { classes: ["sub-generic", "sub-explicit"] });
  assert.ok(!styles.includes(".sub-generic"), "EasyList's generic exemption remains effective");
  assert.ok(styles.includes(".sub-explicit"), "the subscription's explicit host rule still applies");
});

test("a fresh vault applies the bundled default and never reads or fetches a subscription", async () => {
  const w = world(), a = w.run();
  a.filters.start(); await a.filters.ready();
  assert.equal(a.filters.error, ""); assert.deepEqual(a.filters.applied.lists, []); assert.equal(a.filters.applied.bundled, true);
  assert.equal(await blocks(a.store, "https://bundled.example/a.js"), true);
  assert.equal(w.disk.size, 0);
  await a.filters.stop();
});

test("accepted lists persist in the vault, apply natively and survive a restart", async () => {
  const w = world(), a = w.run();
  a.filters.start(); await a.filters.ready();
  const outcome = await a.filters.accept(review());
  assert.equal(outcome.changed, true); assert.match(outcome.id, /^list-/);
  assert.equal(await blocks(a.store, "https://ads.example/a.js"), true);
  const saved = w.disk.get("vault-a/" + WEB_FILTERS_CONFIGURATION).data;
  assert.equal(saved.subscriptions.length, 1); assert.equal(saved.subscriptions[0].url, "https://lists.example/a.txt");
  await a.filters.stop();
  const b = w.run(); b.filters.start(); await b.filters.ready();
  assert.equal(b.filters.applied.lists.length, 1); assert.equal(await blocks(b.store, "https://ads.example/a.js"), true);
  await b.filters.stop();
});

test("update replaces the same subscription, identical updates do not change the engine, remove and disable take effect", async () => {
  const w = world(), a = w.run(); a.filters.start(); await a.filters.ready();
  const { id } = await a.filters.accept(review());
  assert.equal((await a.filters.accept(review(), id)).changed, false);
  const updated = await a.filters.accept(review(OTHER), id);
  assert.equal(updated.changed, true); assert.equal(updated.id, id);
  assert.equal((await a.filters.read()).model.subscriptions.length, 1);
  assert.equal(await blocks(a.store, "https://other.example/a.js"), true); assert.equal(await blocks(a.store, "https://ads.example/a.js"), false);
  await a.filters.setEnabled(id, false); assert.equal(await blocks(a.store, "https://other.example/a.js"), false);
  await a.filters.setEnabled(id, true); assert.equal(await blocks(a.store, "https://other.example/a.js"), true);
  await a.filters.setOption("bundled", false); assert.equal(await blocks(a.store, "https://bundled.example/a.js"), false);
  await a.filters.remove(id); assert.equal(await blocks(a.store, "https://other.example/a.js"), false);
  await assert.rejects(a.filters.remove(id), /no longer exists/);
  await a.filters.stop();
});

test("filters are isolated per vault and a vault switch invalidates the previous owner", async () => {
  const w = world(), a = w.run("vault-a"); a.filters.start(); await a.filters.ready();
  await a.filters.accept(review());
  a.app.vault.rootPath = "vault-b";
  await assert.rejects(a.filters.read(), /no longer active/);
  await assert.rejects(a.filters.accept(review(OTHER)), /no longer active/);
  assert.equal(w.disk.has("vault-b/" + WEB_FILTERS_CONFIGURATION), false);
  await a.filters.stop();
  const b = w.run("vault-b"); b.filters.start(); await b.filters.ready();
  assert.deepEqual(b.filters.applied.lists, []); assert.equal(await blocks(b.store, "https://ads.example/a.js"), false);
  await b.filters.stop();
  a.app.vault.rootPath = "vault-a"; const c = w.run("vault-a"); c.filters.start(); await c.filters.ready();
  assert.equal(c.filters.applied.lists.length, 1);
  c.app.changingVault = true; await assert.rejects(c.filters.setOption("cosmetic", false), /no longer active/);
  c.app.changingVault = false; await c.filters.stop();
  await assert.rejects(c.filters.read(), /no longer active/);
  assert.equal(w.disk.get("vault-a/" + WEB_FILTERS_CONFIGURATION).data.cosmetic !== false, true);
});

test("a failed native apply restores the vault settings and keeps the previous engine", async () => {
  const w = world(); let poison = false;
  const a = w.run("vault-a", { compile: (texts, options) => { if (poison && texts.some(text => text.includes("||poison"))) { throw new Error("compile failed"); } return engine.compile(texts, options); } });
  a.filters.start(); await a.filters.ready();
  const { id } = await a.filters.accept(review());
  const before = structuredClone(w.disk.get("vault-a/" + WEB_FILTERS_CONFIGURATION).data), engineBefore = await a.store.current();
  poison = true; notices.length = 0;
  await assert.rejects(a.filters.accept(review("||poison.example^\n"), id), /compile failed.*previous filter engine remains active.*restored/s);
  assert.deepEqual(w.disk.get("vault-a/" + WEB_FILTERS_CONFIGURATION).data, before);
  assert.equal(await a.store.current(), engineBefore); assert.match(a.filters.error, /compile failed/);
  assert.ok(notices.some(message => /compile failed/.test(message)));
  poison = false; await a.filters.accept(review(OTHER), id);
  assert.equal(a.filters.error, ""); assert.equal(await blocks(a.store, "https://other.example/a.js"), true);
  await a.filters.stop();
});

test("vault write failures surface and leave the engine and saved list untouched; malformed saved data is refused, not reset", async () => {
  const w = world(), a = w.run(); a.filters.start(); await a.filters.ready();
  await a.filters.accept(review()); const engineBefore = await a.store.current();
  w.failNextUpdates(1); await assert.rejects(a.filters.accept(review(OTHER)), /vault write failed/);
  assert.equal(await a.store.current(), engineBefore);
  await a.filters.stop();
  const key = "vault-a/" + WEB_FILTERS_CONFIGURATION, malformed = { version: 99, subscriptions: "nope" };
  w.disk.set(key, { data: malformed, version: "x" });
  const b = w.run(); b.filters.start(); await b.filters.ready();
  assert.notEqual(b.filters.error, ""); assert.deepEqual(w.disk.get(key).data, malformed);
  await assert.rejects(b.filters.setOption("cosmetic", false)); assert.deepEqual(w.disk.get(key).data, malformed);
  await b.filters.stop();
});

test("download review addresses are validated before any native request", async () => {
  const w = world(), a = w.run(); let calls = 0;
  a.filters.start(); await a.filters.ready();
  const filters = new WebFilters(a.app, () => ({ invoke: async () => { calls++; return review(); } })); filters.start(); await filters.ready(); calls = 0;
  for (const bad of ["", "ftp://x.example/a", "javascript:alert(1)", "http://u:p@x.example/a", "x".repeat(2100), null]) { await assert.rejects(Promise.resolve().then(() => filters.review(bad))); }
  assert.equal(calls, 0);
  assert.equal((await filters.review("https://lists.example/a.txt")).sha256, sha(LIST)); assert.equal(calls, 1);
  assert.equal(w.disk.size, 0);
  await filters.stop(); await a.filters.stop();
});

test("the model enforces list count, size and checksum limits", () => {
  const model = new WebFilterData({}); const ids = [];
  for (let index = 0; index < 15; index++) { ids.push(model.accept(review("||a" + index + ".example^\n", "https://lists.example/" + index), null, "").id); }
  assert.equal(new Set(ids).size, 15);
  assert.throws(() => model.accept(review("||overflow.example^\n", "https://lists.example/over"), null, ""));
  assert.throws(() => new WebFilterData({ version: 1, subscriptions: [{ id: "x" }] }));
  assert.equal(model.spec("vault-a", 1).lists.length, 15);
});
