import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, startHost } from "./host.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(root, ".runtime", "core-api-"));
  await mkdir(join(directory, ".obsidian"));
  let host = await startHost(directory);
  t.after(async () => {
    await host.stop();
    await rm(directory, { recursive: true });
  });
  return {
    directory,
    request: (...args) => host.request(...args),
    restart: async () => {
      await host.stop();
      host = await startHost(directory);
    },
  };
}

test("versioned vault configuration preserves compatible data and BOM, rejects stale/root-mismatched saves and survives restart", async t => {
  const app = await fixture(t);
  const url = "/api/configuration/bookmarks?root=" + encodeURIComponent(app.directory);
  const missing = await (await app.request(url)).json();
  assert.deepEqual(missing.data, {});
  assert.equal(missing.version, null);
  const path = join(app.directory, ".obsidian", "bookmarks.json");
  const original = { items: [{ type: "group", title: "Existing", ctime: 123, items: [{ type: "file", path: "Note.md", future: [1, 0.25] }] }], future: { preserve: true } };
  await writeFile(path, "\ufeff" + JSON.stringify(original));
  const before = await (await app.request(url)).json();
  assert.deepEqual(before.data, original);
  const changed = { ...before.data, items: [...before.data.items, { type: "search", query: "#tag", ctime: 124 }] };
  const response = await app.request("/api/configuration/bookmarks", "PUT", { root: app.directory, version: before.version, data: changed });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.notEqual(saved.version, before.version);
  const bytes = await readFile(path);
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([239, 187, 191]));
  assert.deepEqual(JSON.parse(bytes.subarray(3)), changed);
  for (const [root, version, status] of [[app.directory, before.version, 409], [app.directory, null, 428], ["C:\\another-vault", saved.version, 409]]) {
    assert.equal((await app.request("/api/configuration/bookmarks", "PUT", { root, version, data: original })).status, status);
    assert.deepEqual(await readFile(path), bytes);
  }
  await app.restart();
  assert.deepEqual((await (await app.request(url)).json()).data, changed);
  await writeFile(path, JSON.stringify({ externallyChanged: true }));
  assert.equal((await app.request("/api/configuration/bookmarks", "PUT", { root: app.directory, version: saved.version, data: changed })).status, 409);
  assert.equal((await app.request("/api/configuration/not-a-core?root=" + encodeURIComponent(app.directory))).status, 404);
});

test("vault configuration refuses malformed or lossy existing JSON without rewriting it and supports nested named layouts", async t => {
  const app = await fixture(t);
  const path = join(app.directory, ".obsidian", "workspaces.json");
  const url = "/api/configuration/workspaces?root=" + encodeURIComponent(app.directory);
  for (const text of ["{ broken", "[]", '{"unknown":9007199254740993}', '{"unknown":0.123456789012345678901}', '{"unknown":1e-1000}']) {
    await writeFile(path, text);
    assert.equal((await app.request(url)).status, 422, text);
    assert.equal(await readFile(path, "utf8"), text);
  }
  await rm(path);
  let nested = { preserved: true };
  for (let depth = 0; depth < 80; depth++) {
    nested = { nested };
  }
  const data = { workspaces: { Named: nested }, active: "Named", future: { value: 0.125 } };
  const saved = await app.request("/api/configuration/workspaces", "PUT", { root: app.directory, version: null, data });
  assert.equal(saved.status, 200);
  assert.deepEqual((await (await app.request(url)).json()).data, data);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), data);
});

test("core enablement preserves unknown configuration, refuses unavailable modules and guards the selected vault", async t => {
  const app = await fixture(t);
  const path = join(app.directory, ".obsidian", "core-plugins.json");
  const original = { templates: false, "publish": true, "future-core": { preserve: ["all", "fields"] } };
  await writeFile(path, JSON.stringify(original));
  const initial = await (await app.request("/api/core")).json();
  assert.equal(initial.plugins.find(plugin => plugin.id === "templates").enabled, false);
  assert.equal(initial.plugins.find(plugin => plugin.id === "publish").configuredEnabled, true);
  assert.equal(initial.plugins.find(plugin => plugin.id === "publish").enabled, false);
  assert.equal(await readFile(path, "utf8"), JSON.stringify(original), "Reading must not rewrite existing configuration");
  const changed = await app.request("/api/core/random-note", "PUT", { root: app.directory, enabled: true });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).plugins.find(plugin => plugin.id === "random-note").enabled, true);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...original, "random-note": true });
  const saved = await readFile(path, "utf8");
  for (const [endpoint, body, status] of [
    ["/api/core/publish", { root: app.directory, enabled: true }, 501],
    ["/api/core/unknown", { root: app.directory, enabled: true }, 404],
    ["/api/core/templates", { root: "C:\\another-vault", enabled: true }, 409],
    ["/api/core/templates", { root: app.directory }, 400],
  ]) {
    const response = await app.request(endpoint, "PUT", body);
    assert.equal(response.status, status, endpoint);
    assert.ok((await response.json()).error);
    assert.equal(await readFile(path, "utf8"), saved);
  }
});

test("legacy core arrays migrate on an intentional change without resetting new-module defaults or unknown state", async t => {
  const app = await fixture(t);
  const path = join(app.directory, ".obsidian", "core-plugins.json");
  const legacy = '["templates","random-note","future-module"]';
  await writeFile(path, legacy);
  await writeFile(join(app.directory, ".obsidian", "core-plugins-migration.json"), JSON.stringify({ canvas: false, bookmarks: false, "future-migration": { keep: 7 } }));
  const initial = await (await app.request("/api/core")).json();
  assert.equal(initial.plugins.find(plugin => plugin.id === "file-explorer").enabled, false);
  assert.equal(initial.plugins.find(plugin => plugin.id === "templates").enabled, true);
  assert.equal(initial.plugins.find(plugin => plugin.id === "bases").configuredEnabled, true);
  assert.equal(initial.plugins.find(plugin => plugin.id === "canvas").configuredEnabled, false);
  assert.equal(await readFile(path, "utf8"), legacy);
  assert.equal((await app.request("/api/core/word-count", "PUT", { root: app.directory, enabled: true })).status, 200);
  const migrated = JSON.parse(await readFile(path, "utf8"));
  assert.equal(migrated["word-count"], true);
  assert.equal(migrated["file-explorer"], false);
  assert.equal(migrated.templates, true);
  assert.equal(migrated["future-module"], true);
  assert.deepEqual(migrated["future-migration"], { keep: 7 });
});

test("core settings patches preserve unknown data and reject unsafe/invalid updates without changing disk", async t => {
  const app = await fixture(t);
  const path = join(app.directory, ".obsidian", "templates.json");
  const original = { folder: "Templates", dateFormat: "YYYY.MM.DD", timeFormat: "HH:mm:ss", extensionData: { nested: [1, 2] } };
  await writeFile(path, JSON.stringify(original));
  const changed = await app.request("/api/core/templates/settings", "PUT", { root: app.directory, values: { folder: "Templates\\Nested\\", timeFormat: "[at] HH:mm" } });
  assert.equal(changed.status, 200);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...original, folder: "Templates/Nested", timeFormat: "[at] HH:mm" });
  const saved = await readFile(path, "utf8");
  for (const values of [{ folder: "../escape" }, { template: "Unknown.md" }, { folder: "C:\\outside" }, { folder: null }, { dateFormat: 99 }, { extensionData: {} }, ["bad"]]) {
    const response = await app.request("/api/core/templates/settings", "PUT", { root: app.directory, values });
    assert.equal(response.status, 400, JSON.stringify(values));
    assert.ok((await response.json()).error);
    assert.equal(await readFile(path, "utf8"), saved);
  }
  assert.equal((await app.request("/api/core/random-note/settings", "PUT", { root: app.directory, values: {} })).status, 501, "Do not invent a settings page for Random note");
  assert.equal((await app.request("/api/core/templates/settings", "PUT", { root: "C:\\stale-vault", values: { folder: "" } })).status, 409);
  await writeFile(path, "{ broken");
  assert.equal((await app.request("/api/core")).status, 422, "Malformed existing JSON is an explicit error");
});

test("Page preview persists Boolean overrides for registered source identifiers without inventing stored defaults or losing unknown configuration", async t => {
  const app = await fixture(t);
  const initial = (await (await app.request("/api/core")).json()).plugins.find(plugin => plugin.id === "page-preview");
  assert.equal(initial.enabled, true);
  assert.deepEqual(initial.settings, {});
  const path = join(app.directory, ".obsidian", "page-preview.json");
  await assert.rejects(readFile(path), { code: "ENOENT" });
  await writeFile(path, '\ufeff{"editor":false,"futureSetting":{"keep":[true,42]}}\r\n');
  const values = Object.fromEntries([["hover-probe", false], ["__proto__", true]]);
  assert.equal((await app.request("/api/core/page-preview/settings", "PUT", { root: app.directory, values })).status, 200);
  const bytes = await readFile(path);
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([239, 187, 191]));
  const stored = JSON.parse(bytes.subarray(3));
  assert.equal(stored.editor, false);
  assert.equal(stored["hover-probe"], false);
  assert.equal(Object.hasOwn(stored, "__proto__"), true);
  assert.equal(stored.__proto__, true);
  assert.equal(Object.hasOwn(stored, "preview"), false);
  assert.deepEqual(stored.futureSetting, { keep: [true, 42] });
  for (const values of [{ "hover-probe": "false" }, { "hover-probe": null }, { "": true }, { ["x".repeat(257)]: true }]) {
    assert.equal((await app.request("/api/core/page-preview/settings", "PUT", { root: app.directory, values })).status, 400);
    assert.deepEqual(await readFile(path), bytes);
  }
});

test("core state/settings survive a host restart and remain isolated when switching vaults", async t => {
  const app = await fixture(t);
  await mkdir(join(app.directory, "Empty journal"));
  await app.request("/api/core/random-note", "PUT", { root: app.directory, enabled: true });
  const settings = { format: "YYYY/MM/DD", folder: "Empty journal", template: "Templates/Daily" };
  assert.equal((await app.request("/api/core/daily-notes/settings", "PUT", { root: app.directory, values: settings })).status, 200);
  const second = join(app.directory, ".second-vault");
  await mkdir(second);
  await app.request("/api/vault/open", "POST", { path: second });
  const other = await (await app.request("/api/core")).json();
  assert.equal(other.plugins.find(plugin => plugin.id === "random-note").enabled, false);
  assert.equal(other.plugins.find(plugin => plugin.id === "daily-notes").settings.folder, "");
  await app.request("/api/vault/open", "POST", { path: app.directory });
  await app.restart();
  const restored = await (await app.request("/api/core")).json();
  assert.equal(restored.plugins.find(plugin => plugin.id === "random-note").enabled, true);
  assert.deepEqual(restored.plugins.find(plugin => plugin.id === "daily-notes").settings, { ...settings, autorun: false });
  const vault = await (await app.request("/api/vault")).json();
  assert.ok(vault.folders.includes("Empty journal"), "Empty configured folders must not disappear from the client inventory");
});

test("Canvas settings preserve opaque data while enforcing location, wheel, creation, labels, snapping and zoom bounds", async t => {
  const app = await fixture(t);
  const path = join(app.directory, ".obsidian", "canvas.json");
  await writeFile(path, '\ufeff{"defaultModDragBehavior":"webpage","future":{"keep":42}}\r\n');
  const values = { newFileLocation: "folder", newFileFolderPath: "Boards\\Nested\\", defaultWheelBehavior: "zoom", defaultModDragBehavior: "group", cardLabelVisibility: "hover", snapToGrid: false, snapToObjects: true, zoomBreakpoint: -0.7 };
  assert.equal((await app.request("/api/core/canvas/settings", "PUT", { root: app.directory, values })).status, 200);
  const bytes = await readFile(path);
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([239, 187, 191]));
  const saved = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  assert.equal(saved.newFileFolderPath, "Boards/Nested");
  assert.equal(saved.defaultModDragBehavior, "group");
  assert.equal(saved.zoomBreakpoint, -0.7);
  assert.deepEqual(saved.future, { keep: 42 });
  assert.equal(saved.snapToGrid, false);
  for (const values of [{ newFileLocation: "elsewhere" }, { defaultWheelBehavior: "scroll" }, { defaultModDragBehavior: "draw" }, { cardLabelVisibility: "sometimes" }, { newFileFolderPath: "../Escape" }, { snapToGrid: "false" }, { zoomBreakpoint: -0.71 }, { zoomBreakpoint: 2.41 }, { zoomBreakpoint: "0" }, { zoomBreakpoint: null }]) {
    assert.equal((await app.request("/api/core/canvas/settings", "PUT", { root: app.directory, values })).status, 400);
    assert.deepEqual(await readFile(path), bytes);
  }
  assert.equal((await app.request("/api/core/canvas/settings", "PUT", { root: app.directory, values: { zoomBreakpoint: 2.4 } })).status, 200);
  assert.equal(JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")).zoomBreakpoint, 2.4);
});

test("command palette pins round-trip in order without losing unknown settings or accepting malformed lists", async t => {
  const app = await fixture(t);
  const path = join(app.directory, ".obsidian", "command-palette.json");
  const original = { pinned: ["workspace:save-file"], futureSetting: { preserve: ["nested"] } };
  await writeFile(path, JSON.stringify(original));
  const initial = await (await app.request("/api/core")).json();
  assert.equal(initial.plugins.find(plugin => plugin.id === "command-palette").settingsSupport, "implemented");
  assert.deepEqual(initial.plugins.find(plugin => plugin.id === "command-palette").settings, original);
  assert.equal(await readFile(path, "utf8"), JSON.stringify(original));
  const pinned = ["workspace:toggle-pin", "future-plugin:unavailable", "workspace:save-file"];
  const response = await app.request("/api/core/command-palette/settings", "PUT", { root: app.directory, values: { pinned } });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...original, pinned });
  const saved = await readFile(path, "utf8");
  for (const pinned of [true, "workspace:save-file", [23], [""], ["same", "same"], ["bad\0id"]]) {
    const invalid = await app.request("/api/core/command-palette/settings", "PUT", { root: app.directory, values: { pinned } });
    assert.equal(invalid.status, 400);
    assert.ok((await invalid.json()).error);
    assert.equal(await readFile(path, "utf8"), saved);
  }
  await app.restart();
  const restored = await (await app.request("/api/core")).json();
  assert.deepEqual(restored.plugins.find(plugin => plugin.id === "command-palette").settings, { ...original, pinned });
  assert.equal((await app.request("/api/core/command-palette/settings", "PUT", { root: app.directory, values: { pinned: null } })).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...original, pinned: null });
});

test("Quick switcher settings retain unknown options, gate unsupported-file controls and remain typed, persistent and vault-bound", async t => {
  const app = await fixture(t);
  const defaults = { showExistingOnly: false, showAttachments: true, showAllFileTypes: false };
  const state = async () => (await (await app.request("/api/core")).json()).plugins.find(plugin => plugin.id === "switcher");
  const initial = await state();
  assert.equal(initial.settingsSupport, "implemented");
  assert.deepEqual(initial.settings, defaults);
  assert.equal(initial.fields.find(field => field.key === "showAllFileTypes").visible, false);
  const path = join(app.directory, ".obsidian", "switcher.json");
  const appPath = join(app.directory, ".obsidian", "app.json");
  const original = { showExistingOnly: true, showAttachments: false, showAllFileTypes: true, future: { keep: [true, 42] } };
  const originalText = "\ufeff" + JSON.stringify(original) + "\r\n";
  const appText = '{"showUnsupportedFiles":true,"future":{"keep":42}}\r\n';
  await writeFile(path, originalText);
  await writeFile(appPath, appText);
  assert.deepEqual((await state()).settings, original);
  assert.equal((await state()).fields.find(field => field.key === "showAllFileTypes").visible, true);
  assert.equal(await readFile(path, "utf8"), originalText);
  const response = await app.request("/api/core/switcher/settings", "PUT", { root: app.directory, values: defaults });
  assert.equal(response.status, 200);
  const bytes = await readFile(path);
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([239, 187, 191]));
  assert.deepEqual(JSON.parse(bytes.subarray(3)), { ...original, ...defaults });
  assert.equal(await readFile(appPath, "utf8"), appText);
  for (const values of [{ showExistingOnly: "false" }, { showAttachments: null }, { showAllFileTypes: 1 }, { showAttachments: false, showExistingOnly: "invalid" }, { showUnsupportedFiles: true }]) {
    assert.equal((await app.request("/api/core/switcher/settings", "PUT", { root: app.directory, values })).status, 400);
    assert.deepEqual(await readFile(path), bytes);
  }
  await app.restart();
  assert.deepEqual((await state()).settings, { ...original, ...defaults });
  const other = join(app.directory, ".other-vault");
  await mkdir(other);
  assert.equal((await app.request("/api/vault/open", "POST", { path: other })).status, 200);
  assert.deepEqual((await state()).settings, defaults);
  assert.equal((await state()).fields.find(field => field.key === "showAllFileTypes").visible, false);
  assert.equal((await app.request("/api/core/switcher/settings", "PUT", { root: app.directory, values: { showExistingOnly: true } })).status, 409);
  assert.deepEqual(await readFile(path), bytes);
  assert.equal((await app.request("/api/vault/open", "POST", { path: app.directory })).status, 200);
  assert.deepEqual((await state()).settings, { ...original, ...defaults });
  await writeFile(appPath, '{"showUnsupportedFiles":"invalid"}');
  assert.equal((await app.request("/api/core")).status, 400);
  assert.deepEqual(await readFile(path), bytes);
});

test("Backlinks has valid fresh-vault defaults and strictly typed settings preserving unknown data", async t => {
  const app = await fixture(t);
  const initial = await (await app.request("/api/core")).json();
  assert.deepEqual(initial.plugins.find(plugin => plugin.id === "backlink").settings, { backlinkInDocument: false });
  const path = join(app.directory, ".obsidian", "backlink.json");
  const original = { futureSetting: { preserve: ["nested"] } };
  await writeFile(path, JSON.stringify(original));
  const changed = await app.request("/api/core/backlink/settings", "PUT", { root: app.directory, values: { backlinkInDocument: true } });
  assert.equal(changed.status, 200);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...original, backlinkInDocument: true });
  const saved = await readFile(path, "utf8");
  for (const value of [null, "true", 1]) {
    assert.equal((await app.request("/api/core/backlink/settings", "PUT", { root: app.directory, values: { backlinkInDocument: value } })).status, 400);
    assert.equal(await readFile(path, "utf8"), saved);
  }
  await app.restart();
  assert.equal((await (await app.request("/api/core")).json()).plugins.find(plugin => plugin.id === "backlink").settings.backlinkInDocument, true);
});

test("Outgoing links is available without an invented settings page and preserves existing configuration across restart", async t => {
  const app = await fixture(t);
  const path = join(app.directory, ".obsidian", "outgoing-link.json");
  const original = '{"future":{"preserve":["exact"]}}\r\n';
  await writeFile(path, original);
  const initial = (await (await app.request("/api/core")).json()).plugins.find(plugin => plugin.id === "outgoing-link");
  assert.equal(initial.enabled, true);
  assert.equal(initial.settingsSupport, "none");
  assert.equal((await app.request("/api/core/outgoing-link/settings", "PUT", { root: app.directory, values: {} })).status, 501);
  assert.equal((await app.request("/api/core/outgoing-link", "PUT", { root: app.directory, enabled: false })).status, 200);
  await app.restart();
  assert.equal((await (await app.request("/api/core")).json()).plugins.find(plugin => plugin.id === "outgoing-link").enabled, false);
  assert.equal(await readFile(path, "utf8"), original);
});
