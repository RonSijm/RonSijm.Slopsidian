import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, startHost } from "./host.mjs";

let temporary, WebHistoryData, WebHistory, historyUrl;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "web-history-tests-"));
  const entry = join(temporary, "history.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-history-model"; export * from "./client/web-history";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "notice-fixture", setup(build) {
    build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: "notice", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class Notice { constructor() {} }" }));
  } }] });
  ({ WebHistoryData, WebHistory, historyUrl } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

test("web history preserves opaque data, deduplicates only consecutive URLs and searches titles and addresses", () => {
  const original = { future: { retained: [1, true] } }, history = new WebHistoryData(original);
  assert.equal(history.recording, true);
  assert.equal(history.add("about:blank", "Empty"), false);
  assert.equal(history.add("https://example.com/notes", "中文 Notes", 100, "first"), true);
  history.entries[0].future = { keep: ["entry"] };
  assert.equal(history.add("https://example.com/notes", "Duplicate", 200, "duplicate"), false);
  history.add("https://example.org/second", "Second", 50, "second");
  history.add("https://example.com/notes", "Returned", 50, "third");
  assert.deepEqual(history.newest().map(entry => entry.id), ["third", "second", "first"]);
  assert.deepEqual(history.newest("NOTES example.com 中文").map(entry => entry.id), ["first"]);
  history.data.recording = false;
  assert.equal(history.add("https://example.org/paused", "Paused"), false);
  const restored = new WebHistoryData(JSON.parse(JSON.stringify(history.data)));
  assert.deepEqual(restored.entries[0].future, { keep: ["entry"] });
  assert.deepEqual(original, { future: { retained: [1, true] } });
  assert.equal(restored.remove("second"), true);
  assert.equal(restored.remove("missing"), false);
  assert.equal(restored.clear(), true);
  assert.equal(restored.clear(), false);
  assert.deepEqual(restored.data.future, original.future);
  assert.equal(restored.recording, false);
});

test("web history retains exactly the latest 1000 visits and bounds title storage", () => {
  const history = new WebHistoryData({});
  for (let i = 0; i < 1003; i++) { history.add(`https://example.com/${i}`, "x".repeat(2048), i, "visit-" + i); }
  assert.equal(history.entries.length, 1000);
  assert.equal(history.entries[0].id, "visit-3");
  assert.equal(history.newest()[0].id, "visit-1002");
  assert.equal(history.entries[0].title.length, 1024);
});

test("web history refuses unsafe URLs and damaged or newer schemas without modifying the input", () => {
  for (const url of ["about:blank", "javascript:alert(1)", "file:///secret", "https://user:password@example.com", "https://example.com/\nwrong", "https://example.com/a b"]) { assert.throws(() => historyUrl(url)); }
  const valid = { id: "one", url: "https://example.com/", title: "Example", visitedAt: 10 };
  for (const data of [{ version: 2, entries: [] }, { version: 1, entries: {}, future: [1] }, { version: 1, entries: [valid, valid] }, { version: 1, recording: "true", entries: [] }, { version: 1, entries: [{ ...valid, visitedAt: -1 }] }, { version: 1, entries: [{ ...valid, url: "data:text/html,unsafe" }] }]) {
    const before = JSON.stringify(data);
    assert.throws(() => new WebHistoryData(data));
    assert.equal(JSON.stringify(data), before);
  }
});

function storeFixture() {
  let version = 0, data = {}, writes = 0;
  const app = { vault: { rootPath: "vault-a" }, changingVault: false, workspace: { trigger() {} }, configuration: {
    async read(id) { return { id, root: app.vault.rootPath, data: structuredClone(data), version: String(version) }; },
    async write(document, next) {
      if (document.root !== app.vault.rootPath || document.version !== String(version)) { throw new Error("Configuration changed on disk"); }
      data = structuredClone(next); version++; writes++;
      return { ...document, data: structuredClone(data), version: String(version) };
    },
  } };
  return { app, data: () => data, writes: () => writes, external(next) { data = structuredClone(next); version++; } };
}

test("web history serializes simultaneous visits, preserves external fields, pauses and drains on disable", async () => {
  const fixture = storeFixture(), store = new WebHistory(fixture.app); store.start();
  fixture.external({ future: { preserve: true } });
  for (let i = 0; i < 8; i++) { store.record(`https://example.com/${i}`, "Page " + i); }
  await store.whenIdle();
  assert.equal(fixture.data().entries.length, 8);
  assert.deepEqual(fixture.data().future, { preserve: true });
  await store.setRecording(false, () => true);
  store.record("https://example.com/paused", "Paused"); await store.whenIdle();
  assert.equal(fixture.data().entries.length, 8);
  await store.setRecording(true, () => true);
  store.record("https://example.com/last", "Last");
  await store.stop();
  assert.equal(fixture.data().entries.length, 9);
  store.record("https://example.com/disabled", "Disabled");
  assert.equal(fixture.data().entries.length, 9);
});

test("web history rejects stale deletion, cancelled review and old-vault queued work", async () => {
  const fixture = storeFixture(), store = new WebHistory(fixture.app); store.start();
  store.record("https://example.com/one", "One"); await store.whenIdle();
  const snapshot = await store.read();
  fixture.external({ ...fixture.data(), external: "retained" });
  const before = JSON.stringify(fixture.data());
  await assert.rejects(store.edit(snapshot, null, () => true), /changed on disk/);
  assert.equal(JSON.stringify(fixture.data()), before);
  await assert.rejects(store.edit(await store.read(), null, () => false), /no longer active/);
  store.record("https://example.com/late", "Late");
  fixture.app.vault.rootPath = "vault-b";
  await store.whenIdle();
  assert.equal(JSON.stringify(fixture.data()), before);
  await store.stop(); store.start();
  await assert.rejects(store.edit(snapshot, null, () => true), /no longer active/);
  await store.stop();
});

test("native history configuration keeps BOM and unknown fields and rejects stale or wrong-root writes across restart", async t => {
  const directory = await mkdtemp(join(temporary, "vault-")); await mkdir(join(directory, ".obsidian"));
  const path = join(directory, ".obsidian", "vault-dotnet-web-history.json");
  const data = { version: 1, recording: false, entries: [], future: { native: [1, true] } };
  await writeFile(path, "\ufeff" + JSON.stringify(data));
  let host = await startHost(directory); t.after(async () => host.stop());
  const route = "/api/configuration/vault-dotnet-web-history";
  const read = async () => (await (await host.request(route + "?root=" + encodeURIComponent(directory))).json());
  const document = await read(); assert.deepEqual(document.data, data);
  const next = { ...data, recording: true };
  assert.equal((await host.request(route, "PUT", { root: directory, version: document.version, data: next })).status, 200);
  assert.equal((await readFile(path))[0], 0xef);
  const external = "\ufeff" + JSON.stringify({ ...next, external: { keep: "bytes" } }); await writeFile(path, external);
  assert.equal((await host.request(route, "PUT", { root: directory, version: document.version, data })).status, 409);
  assert.equal((await host.request(route, "PUT", { root: directory + "-wrong", version: (await read()).version, data })).status, 409);
  assert.equal(await readFile(path, "utf8"), external);
  await host.stop(); host = await startHost(directory);
  assert.deepEqual((await read()).data, JSON.parse(external.slice(1)));
});
