import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

const require = createRequire(import.meta.url);
const { FilterStore } = require("../desktop/web-adblock-filters.cjs");
const { applyCosmetics, clearCosmetics } = require("../desktop/web-cosmetic.cjs");
const sha = text => createHash("sha256").update(text).digest("hex");
const LIST = "||ads.example^\n";
const spec = (generation, rootPath = "vault-a") => ({ generation, root: rootPath, cosmetic: false, bundled: true, lists: [{ id: "one", text: LIST, sha256: sha(LIST) }] });

test("a held apply cannot reactivate old-vault filters after reset", async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  let compiled = 0;
  const store = new FilterStore({ bundledText: async () => { await held; return "||bundled.example^\n"; }, defaultEngine: async () => null, compile: () => { compiled++; return () => false; } });
  const pending = store.apply(spec(1));
  await new Promise(resolve => setImmediate(resolve));
  store.reset();
  release();
  await assert.rejects(pending, /reset/);
  assert.equal(store.match, null); assert.equal(store.status().root, null); assert.equal(store.status().generation, 0);
  assert.equal(compiled, 0);
  assert.equal((await store.apply(spec(1, "vault-b"))).root, "vault-b");
});

test("a reset during compile discards the compiled engine", async () => {
  let store; store = new FilterStore({ bundledText: async () => "", defaultEngine: async () => null, compile: () => { store.reset(); return () => true; } });
  await assert.rejects(store.apply(spec(1)), /reset/);
  assert.equal(store.match, null);
});

function viewer(contents, extra = {}) {
  const state = { applied: [] };
  return Object.assign({ cosmeticKey: null, cosmeticGeneration: 0, adBlocking: { cosmetics: () => ({ styles: "x{display:none}", rules: 1 }), cosmeticApplied: (rules, error = "") => state.applied.push({ rules, error }) } }, extra, { state });
}
const page = (overrides = {}) => {
  let serial = 0; const removed = [];
  return Object.assign({ removed, isDestroyed: () => false, getURL: () => "https://a.example/", executeJavaScriptInIsolatedWorld: async () => null,
    insertCSS: async () => "key" + ++serial, removeInsertedCSS: async key => { removed.push(key); } }, overrides);
};

test("a failed replacement insert keeps ownership of the last accepted stylesheet", async () => {
  const contents = page(), current = viewer(contents);
  await applyCosmetics(current, contents, () => true, { scan: false });
  assert.equal(current.cosmeticKey, "key1");
  contents.insertCSS = async () => { throw new Error("insert denied"); };
  await applyCosmetics(current, contents, () => true, { scan: false });
  assert.equal(current.cosmeticKey, "key1", "the accepted sheet is still owned");
  assert.deepEqual(contents.removed, []);
  assert.match(current.state.applied.at(-1).error, /insert denied/);
});

test("cleanup failures are reported and ownership is kept so removal can be retried", async () => {
  const contents = page(), current = viewer(contents);
  await applyCosmetics(current, contents, () => true, { scan: false });
  contents.removeInsertedCSS = async () => { throw new Error("remove denied"); };
  await clearCosmetics(current, contents);
  assert.equal(current.cosmeticKey, "key1");
  assert.match(current.state.applied.at(-1).error, /remove denied/);
  contents.removeInsertedCSS = async key => { contents.removed.push(key); };
  await clearCosmetics(current, contents);
  assert.equal(current.cosmeticKey, null); assert.deepEqual(contents.removed, ["key1"]); assert.equal(current.state.applied.at(-1).error, "");
  const replaced = page(), second = viewer(replaced);
  await applyCosmetics(second, replaced, () => true, { scan: false });
  replaced.removeInsertedCSS = async () => { throw new Error("old sheet stuck"); };
  await applyCosmetics(second, replaced, () => true, { scan: false });
  assert.equal(second.cosmeticKey, "key2");
  assert.match(second.state.applied.at(-1).error, /old sheet stuck/);
});

test("a stale generation neither adopts nor leaks a new stylesheet", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const contents = page({ insertCSS: async () => { await gate; return "late"; } }), current = viewer(contents);
  const pending = applyCosmetics(current, contents, () => true, { scan: false });
  await new Promise(resolve => setImmediate(resolve));
  current.cosmeticGeneration++;
  release(); await pending;
  assert.equal(current.cosmeticKey, null); assert.deepEqual(contents.removed, ["late"]);
});

test("the page scan visits a bounded number of elements even when class and id caps never fill", async () => {
  const code = await new Promise(resolve => {
    const contents = page({ executeJavaScriptInIsolatedWorld: async (_world, [script]) => { resolve(script.code); return null; } });
    applyCosmetics(viewer(contents), contents, () => true, { scan: true });
  });
  let visits = 0;
  const nodes = { [Symbol.iterator]: function* () { for (let index = 0; index < 1e6; index++) { visits++; yield { id: "", classList: [] }; } } };
  const context = { document: { querySelectorAll: selector => selector === "a[href]" ? { [Symbol.iterator]: function* () { for (let index = 0; index < 1e6; index++) { visits++; yield { getAttribute: () => "" }; } } } : nodes } };
  const result = vm.runInNewContext(code, context);
  assert.ok(visits <= 25002, "visited " + visits);
  assert.deepEqual(JSON.parse(JSON.stringify(result.classes)), []);
});

let temporary, WebFilters;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "web-filter-lifecycle-"));
  const entry = join(temporary, "filters.mjs");
  await build({ stdin: { contents: 'export { WebFilters } from "./client/web-filters";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "ui-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "ui", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice {} export class Modal {}" }));
  } }] });
  ({ WebFilters } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

function client(applyHook) {
  const writes = [], disk = new Map(); let version = 0;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { const entry = disk.get(app.vault.rootPath + id); return { root: app.vault.rootPath, id, data: structuredClone(entry?.data ?? {}), version: entry?.version ?? null }; },
    async update(id, change) {
      const data = structuredClone(disk.get(app.vault.rootPath + id)?.data ?? {}); change(data);
      writes.push(app.vault.rootPath); disk.set(app.vault.rootPath + id, { data, version: "v" + ++version });
      return { root: app.vault.rootPath, id, data: structuredClone(data), version: "v" + version };
    } } };
  const calls = [];
  const filters = new WebFilters(app, () => ({ invoke: async (_channel, request) => { calls.push(request.action); return applyHook(request, app); } }));
  return { app, filters, writes, calls };
}

test("stop reports a failed native reset instead of a success-shaped stop", async () => {
  const fixture = client(request => { if (request.action === "reset") { throw new Error("ipc gone"); } return { generation: 1, cosmetic: false, bundled: true, lists: [] }; });
  fixture.filters.start(); await fixture.filters.ready();
  await assert.rejects(fixture.filters.stop(), /could not be reset.*ipc gone/);
});

test("a failed apply after a vault switch never writes rollback data to the new vault", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const fixture = client(async request => { if (request.action === "apply" && request.filters.lists.length) { await gate; throw new Error("compile failed"); } return { generation: request.filters.generation, cosmetic: false, bundled: true, lists: [] }; });
  fixture.filters.start(); await fixture.filters.ready();
  const text = "||ads.example^\n";
  const review = { url: "https://lists.example/a.txt", text, sha256: sha(text), bytes: text.length, stats: { network: 1, exceptions: 0, cosmetic: 0, unsupported: 0, ignored: 0 }, title: "T", version: "", retrievedAt: "2026-01-01T00:00:00.000Z" };
  const pending = fixture.filters.accept(review, null, "");
  await new Promise(resolve => setTimeout(resolve, 20));
  const before = fixture.writes.length; assert.equal(before, 1);
  fixture.app.vault.rootPath = "vault-b";
  release();
  await assert.rejects(pending);
  assert.equal(fixture.writes.length, before, "no rollback write after the owner changed");
  assert.ok(fixture.writes.every(owner => owner === "vault-a"));
});

test("only the persisted initial apply may run while the vault is changing; user actions are still refused", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const fixture = client(async request => {
    if (request.action === "apply") { await gate; }
    return { generation: request.filters.generation, cosmetic: false, bundled: true, lists: [] };
  });
  fixture.app.changingVault = true;
  fixture.filters.start();
  const queued = [fixture.filters.setOption("cosmetic", false), fixture.filters.read()];
  await assert.rejects(async () => fixture.filters.review("https://lists.example/a.txt"), /no longer active/);
  await new Promise(resolve => setTimeout(resolve, 10));
  release(); await fixture.filters.ready();
  for (const action of queued) { await assert.rejects(action, /no longer active/); }
  assert.equal(fixture.filters.error, "");
  assert.ok(fixture.filters.applied);
  assert.deepEqual(fixture.writes, []);
});

test("a late failure of an old generation's initial apply is not reported against the new owner", async () => {
  let fail; const gate = new Promise((_, reject) => { fail = reject; });
  const fixture = client(async request => {
    if (request.action === "apply" && !fixture.second) { await gate; }
    return { generation: request.filters.generation, cosmetic: false, bundled: true, lists: [] };
  });
  fixture.filters.start();
  const first = fixture.filters.ready();
  await new Promise(resolve => setTimeout(resolve, 10));
  fixture.second = true;
  const stopping = fixture.filters.stop().catch(() => {});
  fixture.filters.start();
  fail(new Error("old compile failed"));
  await first; await stopping; await fixture.filters.ready();
  assert.equal(fixture.filters.error, "");
});
