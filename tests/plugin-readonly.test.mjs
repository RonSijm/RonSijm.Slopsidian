import assert from "node:assert/strict";
import { test } from "node:test";
import { configureReadOnlyPlugin, configureReadOnlyPluginView } from "../client/plugin-readonly.ts";
import { ReadOnlyVaultError, assertVaultWritable } from "../client/vault-io.ts";

function fixture(readOnly = true, version = "2.29.0") {
  const cleanups = [], vault = { readOnly };
  const plugin = { manifest: { id: "obsidian-excalidraw-plugin", version }, app: { vault },
    autosaveEnabled: true, forceExcalidrawViewMode: false, register: cleanup => cleanups.push(cleanup) };
  const view = { app: plugin.app, savedRevision: 0, currentRevision: 3, attempts: [], updates: [], changes: [],
    getViewType: () => "excalidraw", isDirty() { return this.currentRevision > this.savedRevision; },
    async executeSaveRequest(...args) { this.attempts.push(args); this.savedRevision = this.currentRevision; return { status: "persisted" }; },
    updateScene(scene) { this.updates.push(scene); }, onChange(...args) { this.changes.push(args); } };
  return { plugin, view, vault, cleanups };
}

test("read-only refusals have a stable policy code, operation, path and original call stack", () => {
  assert.throws(() => assertVaultWritable(true, "modify", "Drawings/Plan.md"), error => {
    assert.ok(error instanceof ReadOnlyVaultError);
    assert.equal(error.name, "ReadOnlyVaultError"); assert.equal(error.code, "VAULT_READ_ONLY");
    assert.equal(error.operation, "modify"); assert.equal(error.path, "Drawings/Plan.md");
    assert.match(error.stack, /plugin-readonly.test.mjs/); return true;
  });
  assert.doesNotThrow(() => assertVaultWritable(false, "modify", "Drawings/Plan.md"));
});

test("read-only Excalidraw session flags resist re-enabling autosave and restore requested values on cleanup", () => {
  const { plugin, cleanups } = fixture();
  configureReadOnlyPlugin(plugin);
  assert.equal(plugin.autosaveEnabled, false); assert.equal(plugin.forceExcalidrawViewMode, true);
  plugin.autosaveEnabled = true; plugin.forceExcalidrawViewMode = false;
  assert.equal(plugin.autosaveEnabled, false); assert.equal(plugin.forceExcalidrawViewMode, true);
  assert.equal(cleanups.length, 1); cleanups[0]();
  assert.equal(plugin.autosaveEnabled, true); assert.equal(plugin.forceExcalidrawViewMode, false);
  assert.equal(Object.getOwnPropertyDescriptor(plugin, "autosaveEnabled").writable, true);
});

test("repeated Excalidraw saves skip serialization and persistence without acknowledging dirty revisions", async () => {
  const { plugin, view, vault } = fixture();
  assert.equal(configureReadOnlyPluginView(plugin, view), view);
  for (let attempt = 0; attempt < 50; attempt++) {
    assert.deepEqual(await view.executeSaveRequest(attempt), { status: "skipped" });
  }
  assert.equal(view.attempts.length, 0); assert.equal(view.savedRevision, 0);
  assert.equal(view.isDirty(), true); assert.equal(view.isReadOnly, true);
  vault.readOnly = false;
  assert.equal(view.isReadOnly, false);
  assert.deepEqual(await view.executeSaveRequest("local", false), { status: "persisted" });
  assert.deepEqual(view.attempts, [["local", false]]); assert.equal(view.savedRevision, 3);
});

test("read-only drawing mode remains enforced after a toolbar or scene API request to edit", () => {
  const { plugin, view, vault } = fixture(); configureReadOnlyPluginView(plugin, view);
  view.updateScene({ appState: { viewModeEnabled: false, zoom: 2 }, captureUpdate: "NEVER" });
  assert.deepEqual(view.updates[0], { appState: { viewModeEnabled: true, zoom: 2 }, captureUpdate: "NEVER" });
  view.onChange([], { viewModeEnabled: false }, {});
  assert.equal(view.updates.at(-1).appState.viewModeEnabled, true); assert.equal(view.changes.length, 0);
  const state = { viewModeEnabled: true, zoom: 2 }; view.onChange([], state, {});
  assert.equal(view.changes.length, 1); assert.equal(view.changes[0][1], state);
  vault.readOnly = false; view.onChange([], { viewModeEnabled: false }, {});
  view.updateScene({ appState: { viewModeEnabled: false } });
  assert.equal(view.changes.length, 2); assert.equal(view.updates.at(-1).appState.viewModeEnabled, false);
});

test("local, unknown-version and unrelated plugin instances retain their exact methods and flags", () => {
  for (const item of [fixture(false), fixture(true, "9.0.0"), fixture()]) {
    if (item.plugin.manifest.version === "2.29.0" && item.vault.readOnly) { item.plugin.manifest.id = "another-plugin"; }
    const save = item.view.executeSaveRequest, update = item.view.updateScene;
    configureReadOnlyPlugin(item.plugin); configureReadOnlyPluginView(item.plugin, item.view);
    assert.equal(item.plugin.autosaveEnabled, true); assert.equal(item.plugin.forceExcalidrawViewMode, false);
    assert.equal(item.view.executeSaveRequest, save); assert.equal(item.view.updateScene, update);
    assert.equal(item.cleanups.length, 0);
  }
});

test("unexpected writable save failures still reject and incompatible adapter shapes fail closed", async () => {
  const { plugin, view, vault } = fixture(), error = new Error("Real disk failure");
  view.executeSaveRequest = async () => { throw error; }; configureReadOnlyPluginView(plugin, view);
  vault.readOnly = false; await assert.rejects(view.executeSaveRequest(), actual => actual === error);
  vault.readOnly = true; delete view.onChange;
  assert.throws(() => configureReadOnlyPluginView(plugin, view), /does not support/);
  Object.defineProperty(plugin, "forceExcalidrawViewMode", { value: false, configurable: false });
  assert.throws(() => configureReadOnlyPlugin(plugin), /cannot constrain/);
  assert.equal(plugin.autosaveEnabled, true);
  assert.equal(Object.getOwnPropertyDescriptor(plugin, "autosaveEnabled").writable, true);
});
