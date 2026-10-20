import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { errorLogStub } from "./error-log-stub.mjs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { root } from "./host.mjs";

let directory, PluginHost, Commands, CommunityCatalog, comparePluginVersions, current;
const errorElement = { textContent: "", append() {} };
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "community-settings-tests-"));
  const output = join(directory, "model.cjs");
  await build({
    stdin: { contents: 'export { PluginHost } from "./client/plugin-host"; export { Commands } from "./client/app"; export { configureBrowserHost } from "./client/contracts"; export { CommunityCatalog, comparePluginVersions } from "./client/community-catalog";', resolveDir: root, loader: "ts" },
    outfile: output, bundle: true, platform: "node", format: "cjs", external: ["electron"], loader: { ".css": "empty" }, logLevel: "silent", plugins: [errorLogStub],
  });
  const module = createRequire(import.meta.url)(output);
  PluginHost = module.PluginHost;
  Commands = module.Commands;
  CommunityCatalog = module.CommunityCatalog;
  comparePluginVersions = module.comparePluginVersions;
  module.configureBrowserHost({ request: (...args) => current.request(...args) });
  globalThis.document = { getElementById: () => errorElement, createElement: () => ({ addEventListener() {} }) };
});
after(async () => {
  delete globalThis.document;
  if (directory) { await rm(directory, { recursive: true }); }
});

function manifest(id, changes = {}) {
  return { id, name: id, version: "1.0.0", description: "", isDesktopOnly: false, error: null, ...changes };
}

test("remote community configuration keeps initial loads restricted and persists explicit trust in the transport overlay", async () => {
  const state = fixture(["good"], undefined, "git:remote", true);
  state.app.loadLocalStorage = () => { throw new Error("Remote restricted mode must not use another local-storage preference"); };
  state.app.saveLocalStorage = () => { throw new Error("Remote restricted mode must persist with the transport's local overlay"); };
  await state.host.restoreEnabled();
  assert.equal(state.host.isRestricted, true); assert.deepEqual(state.starts, []);
  await state.host.setRestricted(false);
  assert.equal(state.host.isRestricted, false); assert.equal(state.configuration().restricted, false);
  assert.deepEqual(state.starts, ["good"]); assert.deepEqual(state.configuration().enabled, ["good"]);
  await state.host.setRestricted(true);
  assert.equal(state.configuration().restricted, true); assert.deepEqual(state.stops, ["good"]);
});

test("failed remote restricted-mode persistence rolls back the running state and keeps the enabled IDs", async () => {
  const state = fixture(["good"], undefined, "git:remote", true);
  await state.host.restoreEnabled(); await state.host.setRestricted(false);
  state.conflict = true;
  await assert.rejects(state.host.setRestricted(true), /changed on disk/);
  assert.equal(state.host.isRestricted, false); assert.equal(state.configuration().restricted, false);
  assert.ok(state.host.getPlugin("good")); assert.deepEqual(state.configuration().enabled, ["good"]);
});

test("unrestricted WASM remote defaults start configured plugins without writing preferences and retain a later explicit pause", async () => {
  const state = fixture(["good"], undefined, "git:remote", true, false);
  state.app.loadLocalStorage = () => { throw new Error("The GitHub transport owns restricted mode"); };
  state.app.saveLocalStorage = () => { throw new Error("The GitHub transport owns restricted mode"); };
  await state.host.restoreEnabled();
  assert.equal(state.host.isRestricted, false); assert.deepEqual(state.starts, ["good"]);
  assert.deepEqual(state.calls.map(call => call.method), ["GET"]);
  await state.host.setRestricted(true);
  assert.equal(state.configuration().restricted, true); assert.deepEqual(state.stops, ["good"]);
  state.host.setManifests([manifest("good")]);
  await state.host.restoreEnabled();
  assert.equal(state.host.isRestricted, true); assert.equal(state.host.getPlugin("good"), null);
  assert.deepEqual(state.starts, ["good"], "Restoring an explicit pause must not start the plugin again");
});

test("native command objects expose live hooks and accept void execution callbacks without concealing explicit rejection", async () => {
  const phases = [], app = { changingVault: false, workspace: {}, hotkeyManager: { addDefaultHotkeys() {}, removeDefaultHotkeys() {} } };
  const commands = new Commands(app);
  commands.addCommand({ id: "editor:save-file", name: "Save", checkCallback: checking => { if (checking) { return true; } phases.push("save"); } });
  const command = commands.commands["editor:save-file"], original = command.checkCallback;
  command.checkCallback = checking => { if (checking) { return original(true); } original(false); phases.push("plugin"); };
  await commands.execute("editor:save-file");
  assert.deepEqual(phases, ["save", "plugin"]);
  command.checkCallback = checking => checking;
  await assert.rejects(commands.execute("editor:save-file"), /declined/);
  commands.removeCommand("editor:save-file");
  assert.equal(Object.hasOwn(commands.commands, "editor:save-file"), false);
  assert.deepEqual(commands.listCommands(), []);
});

test("native editor-check commands receive the active owned editor during availability and execution", async () => {
  const calls = [], editor = {}, view = { editor }, app = { changingVault: false, workspace: { activeEditor: null }, hotkeyManager: { addDefaultHotkeys() {}, removeDefaultHotkeys() {} } };
  const commands = new Commands(app);
  commands.addCommand({ id: "lint", name: "Lint", editorCheckCallback: (checking, actualEditor, actualView) => {
    assert.equal(actualEditor, editor);
    assert.equal(actualView, view);
    calls.push(checking);
    if (checking) { return true; }
  } });
  assert.equal(commands.executeCommandById("lint"), false);
  assert.deepEqual(calls, []);
  app.workspace.activeEditor = view;
  await commands.execute("lint");
  assert.deepEqual(calls, [true, false]);
});

test("editor callbacks use an actual embedded owner's editor rather than the top-level Markdown view", async () => {
  const editor = {}, owner = { editor }, calls = [];
  const app = {
    changingVault: false, workspace: { activeEditor: owner },
    get editor() { throw new Error("An embedded editor must not redirect to a top-level Markdown view."); },
    hotkeyManager: { addDefaultHotkeys() {}, removeDefaultHotkeys() {} },
  };
  const commands = new Commands(app);
  commands.addCommand({ id: "embedded", name: "Embedded", editorCallback: (actualEditor, actualOwner) => calls.push([actualEditor, actualOwner]) });
  await commands.execute("embedded");
  assert.deepEqual(calls, [[editor, owner]]);
});

for (const next of ["show", "hide"]) test(`a later settings ${next} supersedes a page waiting for the previous tab's asynchronous close`, async () => {
  const state = fixture(), shown = [], closed = [], rendered = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tab = (id, close = async () => {}) => ({
    containerEl: { id }, showSettings: async () => { shown.push(id); },
    closeSettings: async () => { closed.push(id); await close(); },
  });
  for (const [id, value] of [["good", tab("good", () => gate)], ["waiting", tab("waiting")], ["other", tab("other")]]) { state.app.settingsTabs.set(id, value); }
  errorElement.replaceChildren = node => { rendered.push(node.id); };
  try {
    await state.host.showSettings("good");
    const waiting = state.host.showSettings("waiting");
    if (next === "show") { await state.host.showSettings("other"); }
    else { await state.host.hideSettings(); }
    release(); await waiting;
    assert.deepEqual(shown, next === "show" ? ["good", "other"] : ["good"]);
    assert.deepEqual(rendered, shown, "An obsolete navigation must not remount its settings DOM.");
    await state.host.hideSettings();
    assert.deepEqual(closed, next === "show" ? ["good", "other"] : ["good"]);
  } finally { release(); delete errorElement.replaceChildren; }
});

test("an obsolete settings display failure stays visible without closing the newer tab", async () => {
  const state = fixture(), closed = [];
  let reject;
  const gate = new Promise((_, fail) => { reject = fail; });
  for (const id of ["good", "other"]) {
    state.app.settingsTabs.set(id, {
      containerEl: { id }, showSettings: () => id === "good" ? gate : Promise.resolve(),
      closeSettings: async () => { closed.push(id); },
    });
  }
  errorElement.replaceChildren = () => {};
  try {
    const opening = state.host.showSettings("good");
    while (!state.host.settingsTab) { await Promise.resolve(); }
    await state.host.showSettings("other");
    reject(new Error("Original display failure"));
    await assert.rejects(opening, /Original display failure/);
    assert.deepEqual(closed, ["good"]);
    await state.host.hideSettings();
    assert.deepEqual(closed, ["good", "other"], "The newer tab must retain ownership until its own close.");
  } finally { delete errorElement.replaceChildren; }
});

function fixture(enabled = [], manifests = [manifest("good"), manifest("other")], version = "original", remote = false, remoteRestricted = true) {
  let configuration = { root: "browser:vault-a", enabled: [...enabled], version, ...(remote ? { restricted: remoteRestricted } : {}) };
  let preference = null;
  const calls = [], starts = [], stops = [];
  const packages = new Map(manifests.map(value => [value.id, { root: configuration.root, version: "package-original-" + value.id, manifest: structuredClone(value) }]));
  const snapshot = () => ({ root: configuration.root, name: "Fixture", files: [], plugins: [...packages.values()].map(value => value.manifest) });
  const app = {
    changingVault: false, vault: { rootPath: configuration.root },
    settingsTabs: new Map(), commands: { status: () => [] },
    dotNet: { invokeMethodAsync: async () => {} },
    loadLocalStorage: () => preference,
    saveLocalStorage: (_key, value) => { preference = value; },
  };
  const host = new PluginHost(app);
  host.setManifests(manifests);
  const state = {
    app, host, calls, starts, stops, packages, conflict: false, packageConflict: false, failing: new Set(), startGate: null, stopGate: null,
    request: async (path, method = "GET", body) => {
      calls.push({ path, method, body: structuredClone(body) });
      if (path.startsWith("/api/community-plugins?") && method === "GET") {
        return { status: 200, value: structuredClone(configuration) };
      }
      if (path === "/api/vault" && method === "GET") { return { status: 200, value: structuredClone(snapshot()) }; }
      if (path.startsWith("/api/community-plugins/")) {
        const id = decodeURIComponent(path.slice("/api/community-plugins/".length).split("?")[0]), existing = packages.get(id);
        if (method === "GET") { return existing ? { status: 200, value: structuredClone(existing) } : { status: 404, error: "Plugin not installed." }; }
        assert.equal(body.root, configuration.root);
        if (state.packageConflict || body.version !== (existing?.version ?? null)) { return { status: 409, error: "Package changed on disk." }; }
        if (method === "POST") {
          const value = JSON.parse(Buffer.from(body.manifestBase64, "base64").toString("utf8").replace(/^\ufeff/, ""));
          packages.set(id, { root: body.root, version: "package-saved-" + calls.length, manifest: value });
        } else {
          assert.equal(method, "DELETE");
          packages.delete(id);
        }
        return { status: 200, value: structuredClone(snapshot()) };
      }
      assert.equal(path, "/api/community-plugins");
      assert.equal(method, "PUT");
      assert.equal(body.root, configuration.root);
      if (state.conflict || body.version !== configuration.version) { return { status: 409, error: "Settings changed on disk." }; }
      configuration = { root: body.root, enabled: [...body.enabled], version: "saved-" + calls.length, ...(remote ? { restricted: body.restricted ?? configuration.restricted } : {}) };
      return { status: 200, value: structuredClone(configuration) };
    },
    configuration: () => structuredClone(configuration),
    preference: () => preference,
    setPreference: value => { preference = value; },
  };
  host.enable = async id => {
    starts.push(id);
    if (state.startGate) { await state.startGate; }
    if (state.failing.has(id)) { throw new Error("Expected startup failure"); }
    host.plugins[id] = {};
    host.enabledPlugins.add(id);
  };
  host.disable = async id => {
    stops.push(id);
    if (state.stopGate) { await state.stopGate; }
    delete host.plugins[id];
    host.enabledPlugins.delete(id);
  };
  current = state;
  return state;
}

test("caught unavailable browser modules remain visible without disabling portable fallbacks or leaking into a new vault selection", async () => {
  const state = fixture(), selection = state.host.selectionVersion;
  state.host.plugins.good = {};
  const requirePlugin = name => state.host.require(name, "good", selection);
  assert.throws(() => requirePlugin("http"), /Unsupported module without the desktop Node runtime: http/);
  assert.deepEqual(state.host.unavailableModulesFor("good"), ["http"]);
  assert.match(state.host.errorFor("good"), /Browser limitation: unavailable modules http/);
  assert.ok(state.host.getPlugin("good"), "A caught optional-module probe must not forcibly disable a portable plugin.");
  const modules = state.host.unavailableModulesFor("good");
  modules.length = 0;
  assert.deepEqual(state.host.unavailableModulesFor("good"), ["http"]);
  assert.equal(typeof requirePlugin("timers/promises").setTimeout, "function");
  await state.host.disable("good");
  state.host.setManifests([manifest("good")]);
  assert.deepEqual(state.host.unavailableModulesFor("good"), []);
  assert.equal(state.host.errorFor("good"), null);
  assert.throws(() => requirePlugin("child_process"), /Unsupported module/);
  assert.deepEqual(state.host.unavailableModulesFor("good"), [], "Old module closures must not attach their warnings to another selection.");
});

test("vault enablement restores compatible plugins, retains missing/incompatible/failed IDs and never writes while reading", async t => {
  t.mock.method(console, "error", () => {});
  const enabled = ["good", "desktop", "future", "bad-version", "missing", "broken", "other"];
  const state = fixture(enabled, [
    manifest("good"), manifest("desktop", { isDesktopOnly: true }), manifest("future", { minAppVersion: "99.0.0" }),
    manifest("bad-version", { minAppVersion: "invalid" }), manifest("broken"), manifest("other"),
  ]);
  state.failing.add("broken");
  state.app.changingVault = true;
  await state.host.restoreEnabled();
  assert.deepEqual(Object.keys(state.host.plugins), ["good", "other"]);
  assert.deepEqual([...state.host.configuredPlugins], enabled);
  assert.deepEqual(state.configuration().enabled, enabled);
  assert.deepEqual(state.calls.map(call => call.method), ["GET"]);
  assert.match(state.host.errorFor("desktop"), /Desktop-only/);
  assert.match(state.host.errorFor("future"), /99\.0\.0/);
  assert.match(state.host.errorFor("bad-version"), /Invalid minAppVersion/);
  assert.match(state.host.errorFor("missing"), /not installed/);
  assert.equal(state.host.isRestricted, false);
  assert.equal(state.host.isManaging, false);
});

test("explicit toggles persist canonical enabled IDs and retain configured plugins unavailable in this host", async () => {
  const state = fixture(["desktop"], [manifest("good"), manifest("desktop", { isDesktopOnly: true })]);
  await state.host.restoreEnabled();
  await state.host.enablePluginAndSave("good");
  assert.deepEqual(state.configuration().enabled, ["desktop", "good"]);
  assert.equal(Boolean(state.host.getPlugin("good")), true);
  await state.host.disablePluginAndSave("good");
  assert.deepEqual(state.configuration().enabled, ["desktop"]);
  assert.equal(state.host.getPlugin("good"), null);
  const writes = state.calls.filter(call => call.method === "PUT");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.version, "original");
  assert.equal(writes[1].body.version, "saved-3");
});

test("a failed settings save rolls back the running state for both enable and disable", async () => {
  const state = fixture(["good"]);
  await state.host.restoreEnabled();
  state.conflict = true;
  await assert.rejects(state.host.disablePluginAndSave("good"), /changed on disk/);
  assert.equal(Boolean(state.host.getPlugin("good")), true);
  assert.deepEqual(state.configuration().enabled, ["good"]);
  await assert.rejects(state.host.enablePluginAndSave("other"), /changed on disk/);
  assert.equal(state.host.getPlugin("other"), null);
  assert.deepEqual(state.configuration().enabled, ["good"]);
});

test("retrying an already-configured plugin does not rewrite its enabled list", async () => {
  const state = fixture(["good"]);
  await state.host.restoreEnabled();
  await state.host.disable("good");
  await state.host.enablePluginAndSave("good");
  assert.deepEqual(state.calls.map(call => call.method), ["GET", "GET"]);
  assert.deepEqual(state.configuration().enabled, ["good"]);
});

test("restricted mode is separate from the enabled-ID file and its saved preference survives host restoration", async () => {
  const state = fixture(["good"]);
  await state.host.restoreEnabled();
  await state.host.setRestricted(true);
  assert.equal(state.host.isRestricted, true);
  assert.equal(state.preference(), true);
  assert.equal(state.host.getPlugin("good"), null);
  assert.deepEqual(state.configuration().enabled, ["good"]);
  state.host.setManifests([manifest("good")]);
  await state.host.restoreEnabled();
  assert.equal(state.host.getPlugin("good"), null);
  await state.host.setRestricted(false);
  assert.equal(Boolean(state.host.getPlugin("good")), true);
  assert.equal(state.host.isRestricted, false);
  assert.ok(state.calls.every(call => call.method === "GET"));
});

test("new vaults require opt-in without creating an enabled file until an explicit plugin toggle", async () => {
  const state = fixture([], [manifest("good")], null);
  await state.host.restoreEnabled();
  assert.equal(state.host.isRestricted, true);
  await assert.rejects(state.host.enablePluginAndSave("good"), /Turn on community plugins/);
  assert.equal(state.configuration().version, null);
  await state.host.setRestricted(false);
  assert.equal(state.configuration().version, null);
  await state.host.enablePluginAndSave("good");
  assert.deepEqual(state.configuration().enabled, ["good"]);
  assert.equal(state.calls.find(call => call.method === "PUT").body.version, null);
});

test("restricted-mode persistence failures restore previously running plugins without changing enabled IDs", async () => {
  const state = fixture(["good", "other"]);
  await state.host.restoreEnabled();
  state.app.saveLocalStorage = () => { throw new Error("Profile storage unavailable"); };
  await assert.rejects(state.host.setRestricted(true), /Profile storage unavailable/);
  assert.equal(state.host.isRestricted, false);
  assert.deepEqual(Object.keys(state.host.plugins), ["good", "other"]);
  assert.deepEqual(state.configuration().enabled, ["good", "other"]);
});

test("pending plugin management blocks vault replacement and quiescence waits for persistence", async () => {
  const state = fixture([]);
  await state.host.restoreEnabled();
  let release;
  state.startGate = new Promise(resolve => { release = resolve; });
  const enabling = state.host.enablePluginAndSave("good");
  assert.throws(() => state.host.setManifests([]), /Wait for community/);
  let settled = false;
  const idle = state.host.whenIdle().then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  state.app.changingVault = true;
  await assert.rejects(state.host.enablePluginAndSave("other"), /ready vault/);
  release();
  await enabling;
  await idle;
  assert.deepEqual(state.configuration().enabled, ["good"]);
  assert.equal(settled, true);
});

test("invalid enabled-file reads remain visible and never reset or write settings", async () => {
  const state = fixture([]);
  state.request = async () => ({ status: 422, error: "community-plugins.json must contain an array of plugin IDs." });
  await assert.rejects(state.host.restoreEnabled(), /must contain an array/);
  assert.match(state.host.configurationError, /must contain an array/);
  assert.equal(state.host.isRestricted, true);
  assert.deepEqual(state.configuration().enabled, []);
  assert.deepEqual(state.starts, []);
});

function packageBundle(id = "good", version = "2.0.0") {
  const value = manifest(id, { version, description: "Selected package" });
  return { manifest: value, manifestBase64: Buffer.from(JSON.stringify(value)).toString("base64"), codeBase64: Buffer.from('module.exports = class {};').toString("base64"), cssBase64: null };
}

test("catalog installation leaves new plugins disabled and does not rewrite enablement", async () => {
  const state = fixture(["other"]);
  const review = await state.host.reviewInstalled("fresh");
  assert.equal(review.installed, null);
  await state.host.installPackage(packageBundle("fresh"), review);
  assert.equal(state.host.installedPlugins.find(value => value.id === "fresh").version, "2.0.0");
  assert.deepEqual(state.starts, []);
  assert.deepEqual(state.configuration().enabled, ["other"]);
  assert.ok(state.calls.every(call => call.method !== "PUT"));
  assert.equal(state.calls.find(call => call.method === "POST").body.version, null);
});

test("a running package update awaits unload, blocks vault replacement and restores only its previous runtime state", async () => {
  const state = fixture(["good", "other"]);
  await state.host.restoreEnabled();
  const review = await state.host.reviewInstalled("good");
  let release;
  state.stopGate = new Promise(resolve => { release = resolve; });
  const updating = state.host.installPackage(packageBundle(), review);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.stops, ["good"]);
  assert.equal(state.calls.some(call => call.method === "POST"), false, "No package write may race the old owner's cleanup.");
  assert.throws(() => state.host.setManifests([]), /Wait for community/);
  release();
  await updating;
  assert.deepEqual(state.starts, ["good", "other", "good"]);
  assert.deepEqual(state.configuration().enabled, ["good", "other"]);
  assert.equal(state.configuration().version, "original");
  assert.equal(state.calls.find(call => call.method === "POST").body.version, review.installed.version);
});

test("installing a previously missing configured plugin preserves its existing ID without starting it during installation", async () => {
  const state = fixture(["fresh"]);
  const review = await state.host.reviewInstalled("fresh");
  await state.host.installPackage(packageBundle("fresh"), review);
  assert.deepEqual(state.starts, []);
  assert.deepEqual(state.configuration().enabled, ["fresh"]);
  assert.ok(state.calls.every(call => call.method !== "PUT"));
  await state.host.restoreEnabled();
  assert.deepEqual(state.starts, ["fresh"], "Normal reopening follows the preserved vault setting rather than an invented new default.");
});

test("a rejected package update restarts unchanged previous files but never runs a foreign replacement", async () => {
  for (const foreign of [false, true]) {
    const state = fixture(["good"]);
    await state.host.restoreEnabled();
    const review = await state.host.reviewInstalled("good");
    state.packageConflict = true;
    if (foreign) { state.packages.get("good").version = "foreign-package"; }
    await assert.rejects(state.host.installPackage(packageBundle(), review), foreign ? /could not be safely restored/ : /changed on disk/);
    assert.equal(Boolean(state.host.getPlugin("good")), !foreign);
    assert.deepEqual(state.configuration().enabled, ["good"]);
  }
});

test("an updated package that fails startup remains installed and enabled with an explicit partial-outcome error", async () => {
  const state = fixture(["good"]);
  await state.host.restoreEnabled();
  const review = await state.host.reviewInstalled("good");
  state.failing.add("good");
  await assert.rejects(state.host.installPackage(packageBundle(), review), /updated on disk.*could not start/);
  assert.equal(state.packages.get("good").manifest.version, "2.0.0");
  assert.equal(state.host.getPlugin("good"), null);
  assert.deepEqual(state.configuration().enabled, ["good"]);
});

test("uninstall removes only the reviewed plugin and its enabled entry, retaining unavailable configured IDs", async () => {
  const state = fixture(["good", "unavailable"]);
  await state.host.enable("good");
  const review = await state.host.reviewInstalled("good");
  await state.host.uninstallPlugin(review);
  assert.equal(state.host.getPlugin("good"), null);
  assert.equal(state.packages.has("good"), false);
  assert.equal(state.packages.has("other"), true);
  assert.deepEqual(state.configuration().enabled, ["unavailable"]);
  assert.deepEqual([...state.host.configuredPlugins], ["unavailable"]);
  assert.equal(state.calls.find(call => call.method === "DELETE").body.version, review.installed.version);
});

test("a failed uninstall restores canonical enablement and the unchanged running plugin", async () => {
  const state = fixture(["good", "unavailable"]);
  await state.host.enable("good");
  const review = await state.host.reviewInstalled("good");
  state.packageConflict = true;
  await assert.rejects(state.host.uninstallPlugin(review), /changed on disk/);
  assert.equal(Boolean(state.host.getPlugin("good")), true);
  assert.deepEqual(state.configuration().enabled, ["good", "unavailable"]);
  assert.deepEqual(state.stops, ["good"]);
  assert.deepEqual(state.starts, ["good", "good"]);
});

test("uninstall rollback retains a newer external enabled list instead of overwriting it", async () => {
  const state = fixture(["good"]);
  await state.host.enable("good");
  const review = await state.host.reviewInstalled("good"), originalRequest = state.request;
  state.request = async (path, method, body) => {
    if (method === "DELETE") {
      await originalRequest("/api/community-plugins", "PUT", { ...state.configuration(), enabled: ["foreign"] });
      return { status: 409, error: "Package changed on disk." };
    }
    return originalRequest(path, method, body);
  };
  await assert.rejects(state.host.uninstallPlugin(review), /could not be completely restored/);
  assert.deepEqual(state.configuration().enabled, ["foreign"]);
  assert.equal(state.host.getPlugin("good"), null);
  assert.equal(state.packages.has("good"), true);
});

test("an inventory notification failure after committed deletion does not restore a nonexistent plugin's enablement", async () => {
  const state = fixture(["good"]);
  const review = await state.host.reviewInstalled("good");
  state.app.dotNet.invokeMethodAsync = async method => { if (method === "OnVaultFilesChanged") { throw new Error("Fixture inventory notification failed"); } };
  await assert.rejects(state.host.uninstallPlugin(review), /inventory notification failed/);
  assert.equal(state.packages.has("good"), false);
  assert.deepEqual(state.configuration().enabled, []);
  assert.equal(state.calls.filter(call => call.method === "PUT").length, 1);
});

test("a lost deletion response does not restore enablement or execute files that are no longer present", async () => {
  const state = fixture(["good"]);
  await state.host.enable("good");
  const review = await state.host.reviewInstalled("good"), request = state.request;
  state.request = async (path, method, body) => {
    const response = await request(path, method, body);
    return method === "DELETE" ? { status: 503, error: "Deletion response lost" } : response;
  };
  await assert.rejects(state.host.uninstallPlugin(review), /could not be completely restored/);
  assert.equal(state.packages.has("good"), false);
  assert.equal(state.host.getPlugin("good"), null);
  assert.deepEqual(state.configuration().enabled, []);
});

test("package reviews cannot be reused after a selection change, even when returning to the same root", async () => {
  const state = fixture();
  const review = await state.host.reviewInstalled("good");
  state.host.setManifests([manifest("good"), manifest("other")]);
  await assert.rejects(state.host.installPackage(packageBundle(), review), /Review this vault selection/);
  await assert.rejects(state.host.uninstallPlugin(review), /Review this vault selection/);
  assert.equal(state.calls.some(call => call.method === "POST" || call.method === "DELETE"), false);
});

test("read-only vaults reject package review, install, update and uninstall before transport or runtime changes", async () => {
  const state = fixture(["good"]);
  const review = await state.host.reviewInstalled("good");
  state.calls.length = 0;
  state.app.vault.readOnly = true;
  await assert.rejects(state.host.reviewInstalled("good"), /read-only/);
  await assert.rejects(state.host.installPackage(packageBundle(), review), /read-only/);
  await assert.rejects(state.host.uninstallPlugin(review), /read-only/);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.stops, []);
});

const catalogEntry = { id: "catalog-fixture", name: "Catalog fixture", author: "Fixture", description: "Searchable registry fixture", repo: "fixture/plugin" };
function catalogManifest(changes = {}) { return { id: catalogEntry.id, name: catalogEntry.name, version: "1.0.0", description: catalogEntry.description, minAppVersion: "1.0.0", isDesktopOnly: false, ...changes }; }
function catalogFixture(values) {
  const calls = [];
  const catalog = new CommunityCatalog("1.13.3", async (url, options) => {
    calls.push({ url, options });
    const key = Object.keys(values).find(candidate => url.endsWith(candidate));
    assert.ok(key, "Unexpected catalog request: " + url);
    const value = values[key];
    if (value instanceof Error) { throw value; }
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status: 200 });
  });
  return { catalog, calls };
}

test("the public catalog validates identifiers, repositories, duplicate records and bounded response bytes", async () => {
  const { catalog, calls } = catalogFixture({ "community-plugins.json": [catalogEntry] });
  assert.deepEqual(await catalog.list(), [catalogEntry]);
  assert.equal(calls[0].options.mode, "cors");
  assert.equal(calls[0].options.credentials, "omit");
  for (const entry of [{ ...catalogEntry, id: "../outside" }, { ...catalogEntry, repo: "https://not-github.invalid/repo" }, { ...catalogEntry, repo: "fixture/.." }]) {
    await assert.rejects(catalogFixture({ "community-plugins.json": [entry] }).catalog.list(), /identifier|repository/);
  }
  await assert.rejects(catalogFixture({ "community-plugins.json": [catalogEntry, catalogEntry] }).catalog.list(), /duplicate/);
  const dotted = await catalogFixture({ "community-plugins.json": [catalogEntry, { ...catalogEntry, id: "official.dotted-id" }] }).catalog.list();
  assert.equal(dotted.length, 2, "One unsupported package id must not hide the rest of the official catalog.");
  assert.match(dotted[1].unavailable, /dotted id/);
  await assert.rejects(catalog.release(dotted[1]), /dotted id/);
  const large = new Response("[]", { headers: { "Content-Length": String(8 * 1024 * 1024 + 1) } });
  await assert.rejects(catalogFixture({ "community-plugins.json": large }).catalog.list(), /size/);
});

test("release selection uses numeric compatible version history and verifies the selected tagged manifest", async () => {
  const { catalog, calls } = catalogFixture({
    "HEAD/manifest.json": catalogManifest({ version: "2.0.0", minAppVersion: "2.0.0" }),
    "HEAD/versions.json": { "0.0.9": "1.0.0", "0.0.10": "1.13.3", "2.0.0": "2.0.0" },
    "0.0.10/manifest.json": catalogManifest({ version: "0.0.10" }),
  });
  const release = await catalog.release(catalogEntry);
  assert.equal(release.version, "0.0.10");
  assert.equal(release.manifest.version, "0.0.10");
  assert.equal(calls.length, 3);
  assert.equal(comparePluginVersions("1.10.0", "1.9.9"), 1);
  assert.throws(() => comparePluginVersions("unsafe", "1.0.0"), /numeric/);
});

test("incompatible histories, mismatched manifests and invalid minimum versions fail explicitly", async () => {
  for (const values of [
    { "HEAD/manifest.json": catalogManifest({ id: "different" }) },
    { "HEAD/manifest.json": catalogManifest({ minAppVersion: "invalid" }) },
    { "HEAD/manifest.json": catalogManifest({ minAppVersion: "2.0.0" }), "HEAD/versions.json": { "1.0.0": "2.0.0" } },
    { "HEAD/manifest.json": catalogManifest({ minAppVersion: "2.0.0" }), "HEAD/versions.json": { "0.0.9": "1.0.0" }, "0.0.9/manifest.json": catalogManifest({ version: "0.0.8" }) },
  ]) {
    await assert.rejects(catalogFixture(values).catalog.release(catalogEntry), /match|numeric|compatible|different version/);
  }
});

test("release downloads preserve exact UTF-8 bytes and only an absent stylesheet is optional", async () => {
  const manifestBytes = Buffer.from("\ufeff" + JSON.stringify(catalogManifest()) + "\r\n");
  const codeBytes = Buffer.from('\ufeffmodule.exports={};\r\n');
  const { catalog } = catalogFixture({ "manifest.json": new Response(manifestBytes), "main.js": new Response(codeBytes), "styles.css": new Response("", { status: 404 }) });
  const bundle = await catalog.download({ entry: catalogEntry, version: "1.0.0" });
  assert.deepEqual(Buffer.from(bundle.manifestBase64, "base64"), manifestBytes);
  assert.deepEqual(Buffer.from(bundle.codeBase64, "base64"), codeBytes);
  assert.equal(bundle.cssBase64, null);
  const failing = catalogFixture({ "manifest.json": catalogManifest(), "main.js": new Response("module.exports={}"), "styles.css": new Response("", { status: 503 }) }).catalog;
  await assert.rejects(failing.download({ entry: catalogEntry, version: "1.0.0" }), /503/);
});

test("WASM network failures explain CORS and selected-file recovery without switching to no-cors", async () => {
  const { catalog, calls } = catalogFixture({ "manifest.json": new TypeError("Failed to fetch") });
  await assert.rejects(catalog.download({ entry: catalogEntry, version: "1.0.0" }), /WASM CORS limitation.*select them/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.mode, "cors");
});

test("canceled and oversized streamed downloads never become installable packages", async () => {
  const { catalog } = catalogFixture({ "manifest.json": catalogManifest() });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(catalog.download({ entry: catalogEntry, version: "1.0.0" }, controller.signal), { name: "AbortError" });
  const stream = new ReadableStream({ start(control) { control.enqueue(new Uint8Array(64 * 1024 + 1)); control.close(); } });
  await assert.rejects(catalogFixture({ "manifest.json": new Response(stream) }).catalog.download({ entry: catalogEntry, version: "1.0.0" }), /size/);
});

test("selected release files preserve BOM/CRLF and reject mixed IDs, versions, invalid UTF-8, missing and extra files", async () => {
  const { catalog } = catalogFixture({});
  const manifestBytes = Buffer.from("\ufeff" + JSON.stringify(catalogManifest()) + "\r\n");
  const codeBytes = Buffer.from('\ufeffmodule.exports={};\r\n');
  const files = [new File([manifestBytes], "manifest.json"), new File([codeBytes], "main.js"), new File([".fixture {}\r\n"], "styles.css")];
  const bundle = await catalog.files(files, catalogEntry.id, "1.0.0");
  assert.deepEqual(Buffer.from(bundle.manifestBase64, "base64"), manifestBytes);
  assert.deepEqual(Buffer.from(bundle.codeBase64, "base64"), codeBytes);
  await assert.rejects(catalog.files(files, "different"), /id does not match/);
  await assert.rejects(catalog.files(files, catalogEntry.id, "2.0.0"), /version 2.0.0/);
  await assert.rejects(catalog.files(files.slice(0, 1)), /both manifest.json and main.js/);
  await assert.rejects(catalog.files([...files, new File(["{}"], "data.json")]), /No data/);
  await assert.rejects(catalog.files([...files, files[0]]), /exactly one/);
  await assert.rejects(catalog.files([files[0], new File([new Uint8Array([0xc3, 0x28])], "main.js")]), /UTF-8/);
  await assert.rejects(catalog.files([new File([JSON.stringify(catalogManifest({ minAppVersion: "2.0.0" }))], "manifest.json"), files[1]]), /requires API 2.0.0/);
  await assert.rejects(catalog.files([{ name: "main.js", size: 16 * 1024 * 1024 + 1, arrayBuffer() { throw new Error("Oversized file must not be read"); } }]), /size/);
});
