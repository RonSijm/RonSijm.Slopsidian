import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, CorePlugins;
const realFetch = globalThis.fetch;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime", "core-settings-refresh-tests-"));
  const outfile = join(directory, "core-plugins.mjs");
  await build({ stdin: { contents: 'export { CorePlugins } from "./client/core-plugins";', resolveDir: root }, outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent", plugins: [errorLogStub] });
  ({ CorePlugins } = await import(pathToFileURL(outfile).href));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/core-settings-refresh-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});
afterEach(() => { globalThis.fetch = realFetch; });

const state = (folder, version) => ({ id: "templates", name: "Templates", implemented: true, configuredEnabled: false, enabled: false, settingsSupport: "implemented", fields: [], settings: { folder }, settingsVersion: version });
const snapshot = (folder, version) => ({ root: "/vault", plugins: [state(folder, version)] });

function plugins(initial) {
  const app = { vault: { rootPath: "/vault" }, changingVault: false, workspace: { hoverLinkSources: {} }, editorChanged() {} };
  const core = new CorePlugins(app);
  core.snapshot = initial; core.settingsPollMilliseconds = 0;
  return { app, core };
}
const reply = (status, value) => ({ ok: status < 400, status, text: async () => JSON.stringify(value) });

test("a held core refresh that started before a save cannot overwrite the saved settings or announce stale values", async () => {
  const { core } = plugins(snapshot("v1", "h1"));
  let releaseRead; const held = new Promise(resolve => { releaseRead = resolve; });
  let reads = 0;
  globalThis.fetch = async (path, init = {}) => {
    if ((init.method ?? "GET") === "GET") { reads++; const old = snapshot("v1", "h1"); await held; return reply(200, old); }
    return reply(200, snapshot("v2", "h2"));
  };
  let changes = 0; core.on("changed", () => { changes++; });
  const refresh = core.refreshSettings();
  while (reads === 0) { await new Promise(resolve => setImmediate(resolve)); }
  await core.saveSettings("templates", { folder: "v2" }, "h1");
  const afterSave = changes;
  releaseRead();
  assert.deepEqual(await refresh, []);
  assert.equal(core.state("templates").settings.folder, "v2");
  assert.equal(core.state("templates").settingsVersion, "h2");
  assert.equal(changes, afterSave, "The stale refresh broadcast no change");
});

test("a held refresh that started before an enablement write is also refused, while a later refresh adopts external changes", async () => {
  const { core } = plugins(snapshot("v1", "h1"));
  core.isEnabled = () => false;
  let release; const held = new Promise(resolve => { release = resolve; });
  let reads = 0, external = false;
  globalThis.fetch = async (path, init = {}) => {
    if ((init.method ?? "GET") === "GET") {
      reads++; const current = external ? snapshot("ext", "h9") : snapshot("v1", "h1");
      if (reads === 1) { await held; }
      return reply(200, current);
    }
    return reply(200, snapshot("v1", "h1"));
  };
  const refresh = core.refreshSettings();
  while (reads === 0) { await new Promise(resolve => setImmediate(resolve)); }
  await core.setEnabled("templates", false);
  external = true; release();
  assert.deepEqual(await refresh, []);
  assert.equal(core.state("templates").settingsVersion, "h1");
  assert.deepEqual(await core.refreshSettings(), ["templates"]);
  assert.equal(core.state("templates").settings.folder, "ext");
});

test("a version conflict followed by a failed refresh reports the failure, keeps the baseline and never claims a reload", async () => {
  const { core } = plugins(snapshot("v1", "h1"));
  globalThis.fetch = async (path, init = {}) => (init.method ?? "GET") === "GET" ? reply(500, { error: "disk offline" }) : reply(409, { error: "stale" });
  await assert.rejects(core.saveSettings("templates", { folder: "mine" }, "h1"), error => /reloading the newer settings failed/.test(error.message) && /draft is unchanged/.test(error.message) && !/were reloaded/.test(error.message));
  assert.equal(core.state("templates").settingsVersion, "h1");
  assert.equal(core.state("templates").settings.folder, "v1");
});

test("a version conflict while an earlier refresh is held says the newer settings were not loaded", async () => {
  const { core } = plugins(snapshot("v1", "h1"));
  let release; const held = new Promise(resolve => { release = resolve; });
  let reads = 0;
  globalThis.fetch = async (path, init = {}) => {
    if ((init.method ?? "GET") === "GET") { reads++; await held; return reply(200, snapshot("ext", "h9")); }
    return reply(428, { error: "version required" });
  };
  const refresh = core.refreshSettings();
  while (reads === 0) { await new Promise(resolve => setImmediate(resolve)); }
  await assert.rejects(core.saveSettings("templates", { folder: "mine" }, "h1"), error => /not loaded yet/.test(error.message) && !/were reloaded/.test(error.message));
  assert.equal(core.state("templates").settingsVersion, "h1");
  release(); await refresh;
});
