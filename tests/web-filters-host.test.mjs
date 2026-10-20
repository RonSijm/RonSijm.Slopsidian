import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, startHost } from "./host.mjs";

let temporary, WebFilterData, WEB_FILTERS_CONFIGURATION;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "web-filters-host-tests-"));
  const entry = join(temporary, "model.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-filters-model";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ WebFilterData, WEB_FILTERS_CONFIGURATION } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

const review = (text, url) => ({ url, text, sha256: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text), stats: { network: 1, exceptions: 0, cosmetic: 0, unsupported: 0, ignored: 0 }, title: "T", version: "", retrievedAt: "2026-01-01T00:00:00.000Z" });

test("the real host persists maximum-size accepted lists, rejects stale or foreign-root writes and survives restart", async t => {
  const directory = await mkdtemp(join(temporary, "vault-")); await mkdir(join(directory, ".obsidian"));
  const path = join(directory, ".obsidian", WEB_FILTERS_CONFIGURATION + ".json");
  let host = await startHost(directory); t.after(async () => host.stop());
  const route = "/api/configuration/" + WEB_FILTERS_CONFIGURATION, query = "?root=" + encodeURIComponent(directory);
  const read = async () => (await host.request(route + query)).json();
  const empty = await read(); assert.deepEqual(empty.data, {});
  const model = new WebFilterData(empty.data);
  const big = "||" + "a".repeat(60) + ".example^\n";
  for (let index = 0; index < 3; index++) { model.accept(review(big.repeat(Math.floor(4 * 1024 * 1024 / big.length)), "https://lists.example/" + index), null, ""); }
  const response = await host.request(route, "PUT", { root: directory, version: empty.version, data: model.data });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await read(); assert.equal(saved.data.subscriptions.length, 3);
  assert.ok((await readFile(path)).length > 11 * 1024 * 1024);
  assert.equal((await host.request(route, "PUT", { root: directory + "-foreign", version: saved.version, data: {} })).status, 409);
  const external = JSON.stringify({ ...saved.data, external: true }); await writeFile(path, external);
  assert.equal((await host.request(route, "PUT", { root: directory, version: saved.version, data: {} })).status, 409);
  const before = await readFile(path);
  assert.equal(before.toString(), external);
  await host.stop(); host = await startHost(directory);
  const restored = await read(); assert.deepEqual(restored.data, JSON.parse(external)); assert.deepEqual(await readFile(path), before);
  assert.equal(new WebFilterData(restored.data).spec(directory, 1).lists.length, 3);
});
