import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";

let temporary, clipDefaults, withClipProperties;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "clip-defaults-tests-"));
  const entry = join(temporary, "defaults.mjs");
  await build({ stdin: { contents: 'export * from "./client/web-clip-policy";', resolveDir: root }, outfile: entry, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  ({ clipDefaults, withClipProperties } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

const validTags = ["", "#research, project/nested, 中文, research", "\ufeff#𐐀/二\u2003, a-1, _", "a,".repeat(1000), "x".repeat(100), Array.from({ length: 50 }, (_, i) => "tag" + i).join(",")];
const invalidTags = [null, true, 1, [], {}, "#", "123", "/start", "end/", "a//b", "has space", "a\0b", "é\u0301", "a\u0085", "x".repeat(101), "a".repeat(2049), Array.from({ length: 51 }, (_, i) => "tag" + i).join(",")];

test("clipping defaults preserve the opt-in baseline and return detached validated values without changing opaque settings", () => {
  const input = { future: { keep: [false, "中文"] } }, original = structuredClone(input);
  const first = clipDefaults(input); assert.deepEqual(first, { clipIncludeProperties: false, clipDefaultTags: "" });
  first.clipIncludeProperties = true; assert.deepEqual(clipDefaults(input), { clipIncludeProperties: false, clipDefaultTags: "" }); assert.deepEqual(input, original);
  assert.deepEqual(clipDefaults({ clipIncludeProperties: true, clipDefaultTags: "#research, project/nested, research" }), { clipIncludeProperties: true, clipDefaultTags: "research,project/nested" });
});

test("default tags use the same bounded Unicode and nested-tag policy as each reviewed clip even when defaults are disabled", () => {
  const clip = { url: "https://example.com/story", title: "Current article", markdown: "# Body\n", navigationId: 1 };
  for (const tags of validTags) {
    const defaults = clipDefaults({ clipIncludeProperties: false, clipDefaultTags: tags });
    assert.deepEqual(clipDefaults(defaults), defaults);
    assert.doesNotThrow(() => withClipProperties(clip, { title: clip.title, tags: defaults.clipDefaultTags, clippedAt: "2026-10-23T14:00:00.000Z" }));
  }
  for (const tags of invalidTags) { assert.throws(() => clipDefaults({ clipIncludeProperties: false, clipDefaultTags: tags }), /tag/i); }
  for (const value of [null, "true", "false", 0, 1, [], {}]) { assert.throws(() => clipDefaults({ clipIncludeProperties: value }), /Boolean/i); }
});

test("native clipping defaults expose real settings and do not create a configuration file for an older vault", async t => {
  const directory = await mkdtemp(join(temporary, "absent-")), host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.equal(state.settings.clipIncludeProperties, false); assert.equal(state.settings.clipDefaultTags, "");
  assert.equal(state.fields.find(field => field.key === "clipIncludeProperties").type, "checkbox");
  assert.equal(state.fields.find(field => field.key === "clipDefaultTags").type, "text");
  await assert.rejects(readFile(join(directory, ".obsidian", "webviewer.json")), { code: "ENOENT" });
});

test("native clipping settings validate atomically, retain opaque values and survive a full host restart", async t => {
  const directory = await mkdtemp(join(temporary, "persist-")), path = join(directory, ".obsidian", "webviewer.json");
  await mkdir(join(directory, ".obsidian"));
  const original = { homepage: "https://example.com", markdownPath: "Clips", future: { keep: [false, "中文"] }, clipIncludeProperties: false, clipDefaultTags: "old" };
  await writeFile(path, JSON.stringify(original));
  let host = await startHost(directory); t.after(() => host.stop());
  for (const values of [{ clipIncludeProperties: "true" }, { clipIncludeProperties: true, clipDefaultTags: "bad tag" }, { homepage: "changed", clipDefaultTags: null }]) {
    assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values })).status, 400);
    assert.equal(await readFile(path, "utf8"), JSON.stringify(original));
  }
  const defaults = { clipIncludeProperties: true, clipDefaultTags: "#research, 中文, research" };
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: defaults })).status, 200);
  const expected = { ...original, ...clipDefaults(defaults) }; assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: "D:\\stale-clip-vault", values: { clipDefaultTags: "foreign" } })).status, 409);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  await host.stop(); host = await startHost(directory);
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  for (const [key, value] of Object.entries(expected)) { assert.deepEqual(state.settings[key], value); }
});

test("native and client default-tag policies agree on normalization, Unicode, duplicate/input/count limits and invalid data", async t => {
  const directory = await mkdtemp(join(temporary, "policy-")), host = await startHost(directory); t.after(() => host.stop());
  for (const tags of validTags) {
    const values = { clipDefaultTags: tags };
    const response = await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values }); assert.equal(response.status, 200, JSON.stringify(tags));
    const state = (await response.json()).plugins.find(plugin => plugin.id === "webviewer");
    assert.equal(state.settings.clipDefaultTags, clipDefaults(values).clipDefaultTags);
  }
  const path = join(directory, ".obsidian", "webviewer.json"), before = await readFile(path);
  for (const tags of invalidTags) {
    assert.equal((await host.request("/api/core/webviewer/settings", "PUT", { root: directory, values: { clipIncludeProperties: true, clipDefaultTags: tags } })).status, 400, JSON.stringify(tags));
    assert.deepEqual(await readFile(path), before);
  }
});

test("reading imported valid defaults normalizes only the snapshot and leaves original BOM/CRLF settings bytes intact", async t => {
  const directory = await mkdtemp(join(temporary, "imported-")), path = join(directory, ".obsidian", "webviewer.json"); await mkdir(join(directory, ".obsidian"));
  const original = Buffer.from('\ufeff{\r\n  "clipIncludeProperties": true, "clipDefaultTags": "#研究, 研究, nested/tag", "future": {"keep":true}\r\n}\r\n'); await writeFile(path, original);
  const host = await startHost(directory); t.after(() => host.stop());
  const state = (await (await host.request("/api/core")).json()).plugins.find(plugin => plugin.id === "webviewer");
  assert.deepEqual(clipDefaults(state.settings), { clipIncludeProperties: true, clipDefaultTags: "研究,nested/tag" });
  assert.deepEqual(await readFile(path), original);
});
