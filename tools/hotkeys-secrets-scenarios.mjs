import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";

const pluginId = "hotkey-probe";
const ALPHA = `${pluginId}:alpha`, BETA = `${pluginId}:beta`, GAMMA = `${pluginId}:gamma`;
const CTRL = 2;
const CTRL_SHIFT = 2 | 8;

const pluginSource = `
const { Plugin, PluginSettingTab, SecretComponent } = require("obsidian");
const probe = globalThis.hotkeyProbe = { calls: [], gammaReady: false };
class ProbeTab extends PluginSettingTab {
  display() {
    this.containerEl.replaceChildren();
    const host = document.createElement("div");
    host.className = "hotkey-probe-secret";
    this.containerEl.appendChild(host);
    new SecretComponent(this.app, host).onChange(value => { probe.selected = value; });
  }
}
module.exports = class extends Plugin {
  onload() {
    const keys = key => [{ modifiers: ["Mod", "Shift"], key }];
    this.addCommand({ id: "alpha", name: "Probe alpha", hotkeys: keys("Y"), callback: () => { probe.calls.push("alpha"); } });
    this.addCommand({ id: "beta", name: "Probe beta", hotkeys: keys("U"), callback: () => { probe.calls.push("beta"); } });
    this.addCommand({ id: "gamma", name: "Probe gamma", hotkeys: keys("U"), checkCallback: checking => {
      if (!probe.gammaReady) { return false; }
      if (!checking) { probe.calls.push("gamma"); }
      return true;
    } });
    this.addSettingTab(new ProbeTab(this.app, this));
  }
};
`;

export async function checkHotkeysSecrets({ host, directory, targetDirectory, profile, evaluate, command, click, press, wait, report, restart, afterReload, selectVault, capture }) {
  const browser = host === "browser";
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const configPath = join(directory, ".obsidian", "hotkeys.json");
  const pluginDirectory = join(directory, ".obsidian", "plugins", pluginId);
  const synthetic = "synthetic-disposable-" + randomBytes(12).toString("hex");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const calls = () => evaluate("hotkeyProbe.calls.join(',')");
  const row = id => `#hotkey-settings-host [data-hotkey-command="${id}"]`;
  const chips = async id => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(row(id) + " [data-hotkey-chip]")}),chip=>chip.dataset.hotkeyChip)`);
  const stored = async () => JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, ""));
  async function storedWhen(predicate, label) {
    let last;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { last = await stored(); if (predicate(last)) { return last; } } catch { /* file not written yet */ }
      await sleep(100);
    }
    throw new Error(`${label}: ${JSON.stringify(last)}`);
  }
  async function closeSettings() {
    if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
    await wait('!document.querySelector("#settings-dialog").open', "settings closed");
  }
  async function openHotkeys() {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#hotkeys-tab");
    await wait('Boolean(document.querySelector("#hotkey-settings-host [data-hotkey-list]"))', "hotkeys settings rendered");
  }
  async function reload() {
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }
  const waitPlugin = () => wait(`Boolean(app.plugins.getPlugin(${JSON.stringify(pluginId)}))&&app.commands.listCommands().some(c=>c.id===${JSON.stringify(ALPHA)})`, "hotkey probe plugin loaded");
  async function pressMod(key, code, virtualKey) { await press(key, code, virtualKey, CTRL_SHIFT); }
  async function record(id, key, code, virtualKey) {
    await click(`${row(id)} [data-hotkey-record]`);
    await wait(`Boolean(document.querySelector(${JSON.stringify(row(id) + " [data-hotkey-recording]")}))`, "recording armed");
    await pressMod(key, code, virtualKey);
    await wait(`!document.querySelector(${JSON.stringify(row(id) + " [data-hotkey-recording]")})`, "recording finished");
  }

  // Install the probe plugin in a disposable vault and enable it through the real Community UI.
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(join(pluginDirectory, "manifest.json"), JSON.stringify({ id: pluginId, name: "Hotkey probe", version: "1.0.0", description: "Hotkey and SecretStorage fixture", isDesktopOnly: false }));
  await writeFile(join(pluginDirectory, "main.js"), pluginSource);
  await reload();
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true);
  await closeSettings();
  await waitPlugin();

  // 1. Plugin defaults dispatch from real keyboard input; auto-repeat is ignored for non-repeatable commands.
  await evaluate("hotkeyProbe.calls.length=0");
  await pressMod("y", "KeyY", 89);
  assert.equal(await calls(), "alpha");
  for (const type of ["rawKeyDown", "keyUp"]) { await command("Input.dispatchKeyEvent", { type, key: "y", code: "KeyY", windowsVirtualKeyCode: 89, modifiers: CTRL_SHIFT, autoRepeat: type === "rawKeyDown" }); }
  assert.equal(await calls(), "alpha", "Held keys must not repeat a command that is not repeatable.");
  pass("Plugin default Mod+Shift+Y dispatched once from real key events and ignored auto-repeat.");

  // 2. Collisions are displayed and an unavailable command does not consume the key.
  await pressMod("u", "KeyU", 85);
  assert.equal(await calls(), "alpha,beta", "An unavailable colliding command must not consume the key.");
  await openHotkeys();
  assert.ok(await evaluate(`Boolean(document.querySelector(${JSON.stringify(row(BETA) + " [data-hotkey-collision]")}))&&Boolean(document.querySelector(${JSON.stringify(row(GAMMA) + " [data-hotkey-collision]")}))`), "Both colliding rows must warn.");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(GAMMA) + " [data-hotkey-availability]")}).dataset.hotkeyAvailability`), "unavailable");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(ALPHA) + " [data-hotkey-availability]")}).dataset.hotkeyAvailability`), "available");
  pass("The Hotkeys page showed per-command availability and collision warnings for shared Mod+Shift+U.");

  // 3. Esc cancels recording; recording overrides, persists and dispatches.
  const before = await chips(ALPHA);
  await click(`${row(ALPHA)} [data-hotkey-record]`);
  await wait(`Boolean(document.querySelector(${JSON.stringify(row(ALPHA) + " [data-hotkey-recording]")}))`, "recording armed");
  await press("Escape", "Escape", 27);
  await wait(`!document.querySelector(${JSON.stringify(row(ALPHA) + " [data-hotkey-recording]")})`, "recording cancelled");
  assert.deepEqual(await chips(ALPHA), before, "Esc must cancel without changing hotkeys.");
  await record(ALPHA, "o", "KeyO", 79);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(ALPHA))}).dataset.hotkeyState`), "customized");
  const afterRecord = await storedWhen(data => data[ALPHA]?.some(h => h.key === "o"), "recorded override persisted");
  assert.ok(afterRecord[ALPHA].every(h => h.modifiers.includes("Mod") && h.modifiers.includes("Shift")));
  await closeSettings();
  await evaluate("hotkeyProbe.calls.length=0");
  await pressMod("o", "KeyO", 79);
  assert.equal(await calls(), "alpha", "The recorded key must run the command exactly once.");
  await pressMod("y", "KeyY", 89);
  assert.equal(await calls(), "alpha,alpha", "Recording adds a binding next to the default; both keys run the command once each.");
  pass("A recorded binding was added to the default, written to .obsidian/hotkeys.json and dispatched from the keyboard.");

  // 4. Remove the chip: the command then has no key at all.
  await openHotkeys();
  for (const signature of await chips(ALPHA)) { await click(`${row(ALPHA)} [data-hotkey-remove="${signature}"]`); }
  await wait(`!document.querySelector(${JSON.stringify(row(ALPHA) + " [data-hotkey-chip]")})`, "chip removed");
  await storedWhen(data => Array.isArray(data[ALPHA]) && data[ALPHA].length === 0, "removed hotkey persisted as an explicit empty override");
  await closeSettings();
  await evaluate("hotkeyProbe.calls.length=0");
  await pressMod("o", "KeyO", 79);
  await pressMod("y", "KeyY", 89);
  assert.equal(await calls(), "");
  pass("Removing every chip persisted an explicit empty override and stopped dispatch.");

  // 5. Disable via the page, restart and verify persistence.
  await openHotkeys();
  await click(`${row(BETA)} [data-hotkey-disable]`);
  await wait(`document.querySelector(${JSON.stringify(row(BETA))}).dataset.hotkeyState==="disabled"`, "beta disabled");
  await storedWhen(data => Array.isArray(data[BETA]) && data[BETA].length === 0, "disabled hotkey persisted");
  await closeSettings();
  await reload();
  await waitPlugin();
  await evaluate("hotkeyProbe.calls.length=0");
  await pressMod("u", "KeyU", 85);
  await pressMod("o", "KeyO", 79);
  assert.equal(await calls(), "", "Disabled and removed overrides must survive restart.");
  pass("Disable and removal overrides survived a real application restart/reload.");

  // 6. Unloading keeps overrides but drops dispatch and shows the command as not loaded.
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, false);
  await click("#hotkeys-tab");
  await wait('Boolean(document.querySelector("#hotkey-settings-host [data-hotkey-list]"))', "hotkeys settings rendered");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(ALPHA) + " [data-hotkey-availability]")})?.dataset.hotkeyAvailability`), "not-loaded");
  assert.ok(Object.hasOwn(await stored(), ALPHA), "Unloading must not discard persisted overrides.");
  await closeSettings();
  assert.equal(await evaluate(`app.commands.listCommands().some(c=>c.id===${JSON.stringify(ALPHA)})`), false);
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true);
  await closeSettings();
  await waitPlugin();
  await openHotkeys();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(ALPHA))}).dataset.hotkeyState`), "disabled", "The emptied override is re-applied after reload.");
  pass("Unload removed the commands, kept their overrides as not-loaded rows, and reload re-applied them.");

  // 7. Restore defaults, per command and for everything.
  await click(`${row(ALPHA)} [data-hotkey-restore]`);
  await wait(`document.querySelector(${JSON.stringify(row(ALPHA))}).dataset.hotkeyState==="default"`, "alpha restored");
  await click("#hotkey-settings-host [data-hotkey-restore-all]");
  await wait(`document.querySelector(${JSON.stringify(row(BETA))}).dataset.hotkeyState==="default"`, "all restored");
  await storedWhen(data => !Object.hasOwn(data, ALPHA) && !Object.hasOwn(data, BETA), "restored defaults removed overrides");
  await closeSettings();
  await evaluate("hotkeyProbe.calls.length=0;hotkeyProbe.gammaReady=true");
  await pressMod("y", "KeyY", 89);
  await pressMod("u", "KeyU", 85);
  const ran = (await calls()).split(",");
  assert.equal(ran[0], "alpha");
  assert.equal(ran.length, 2, "A shared key must run exactly one command.");
  assert.ok(["beta", "gamma"].includes(ran[1]));
  pass("Restore default and Restore all removed overrides and returned plugin defaults to the keyboard.");

  // 7b. Built-in commands obey the same overrides: disable, rebind, collide and restore with real keys.
  await evaluate(`(()=>{window.saveProbe={n:0};const run=app.commands.executeCommandById.bind(app.commands);app.commands.executeCommandById=id=>{if(id==="editor:save-file"){window.saveProbe.n++;return true}return run(id)};return true})()`);
  const saves = async () => Number(await evaluate("window.saveProbe.n"));
  await press("s", "KeyS", 83, CTRL);
  assert.equal(await saves(), 1, "The default Ctrl+S runs the built-in command through the manager.");
  await evaluate(`app.hotkeyManager.setHotkeys("editor:save-file", [])`);
  await press("s", "KeyS", 83, CTRL);
  assert.equal(await saves(), 1, "A disabled built-in leaves Ctrl+S inert.");
  await evaluate(`app.hotkeyManager.setHotkeys("editor:save-file", [{modifiers:["Mod"],key:"y"}])`);
  await press("s", "KeyS", 83, CTRL);
  assert.equal(await saves(), 1, "The old built-in key stays dead after a rebind.");
  await press("y", "KeyY", 89, CTRL);
  assert.equal(await saves(), 2, "Only the rebound key saves.");
  assert.ok(await evaluate(`app.hotkeyManager.getConflicts({modifiers:["Mod"],key:"p"},"editor:save-file").includes("command-palette:open")`), "Collisions include built-in defaults.");
  await evaluate(`app.hotkeyManager.removeHotkeys("editor:save-file")`);
  await press("s", "KeyS", 83, CTRL);
  assert.equal(await saves(), 3, "Restoring the default brings Ctrl+S back.");
  pass("Built-in command shortcuts were disabled, rebound, collision-checked and restored through real keyboard dispatch.");

  // 8. Unreadable configuration is never overwritten; unknown entries are retained.
  const corrupt = "{ this is not json";
  await evaluate("app.hotkeyManager.save().then(()=>true)");
  await writeFile(configPath, corrupt);
  await reload();
  await waitPlugin();
  await openHotkeys();
  assert.ok(await evaluate('Boolean(document.querySelector("#hotkey-settings-host [data-hotkey-load-error]"))'), "A load error banner is required.");
  await record(ALPHA, "o", "KeyO", 79).catch(() => {});
  await sleep(500);
  assert.equal(await readFile(configPath, "utf8"), corrupt, "The unreadable file must stay byte-identical.");
  assert.equal(await evaluate('document.querySelector("#hotkey-settings-host [data-hotkey-status]").dataset.hotkeyStatusKind'), "error");
  const corruptRecords = await evaluate("slopsidianDiagnostics.current()");
  assert.equal(corruptRecords.length, 3, "Exactly the load failure and the two refused saves are reported: " + JSON.stringify(corruptRecords));
  const unreadable = /could not be loaded; defaults are active|hotkeys file could not be read, so it was not overwritten: Host 422/;
  for (const item of corruptRecords) {
    assert.match(item.error.message, unreadable);
    (report.expectedDiagnostics ??= []).push({ id: item.id, source: item.source, message: item.error.message, reason: "A deliberately unreadable hotkeys.json must be reported, never overwritten." });
  }
  await closeSettings();
  const foreign = { "other-plugin:unknown": [{ modifiers: ["Mod"], key: "q" }], "bad:entry": "not a hotkey list" };
  await writeFile(configPath, JSON.stringify(foreign));
  await reload();
  await waitPlugin();
  await openHotkeys();
  await record(ALPHA, "o", "KeyO", 79);
  const merged = await storedWhen(data => data[ALPHA]?.some(h => h.key === "o"), "override saved beside foreign entries");
  assert.deepEqual(merged["other-plugin:unknown"], foreign["other-plugin:unknown"]);
  assert.equal(merged["bad:entry"], "not a hotkey list");
  await closeSettings();
  pass("An unreadable hotkeys.json was left byte-identical with a visible error; unknown and malformed entries were retained when saving.");

  // 9. Foreign vault isolation.
  await mkdir(targetDirectory, { recursive: true });
  await selectVault(targetDirectory);
  await evaluate("hotkeyProbe.calls.length=0");
  assert.deepEqual(await evaluate("Object.keys(app.hotkeyManager.customKeys)"), [], "Overrides must not leak into another vault.");
  assert.equal(await evaluate(`app.commands.listCommands().some(c=>c.id===${JSON.stringify(ALPHA)})`), false);
  await pressMod("o", "KeyO", 79);
  assert.equal(await calls().catch(() => ""), "");
  await selectVault(directory);
  await waitPlugin();
  assert.ok(await evaluate("Object.keys(app.hotkeyManager.customKeys).includes(" + JSON.stringify(ALPHA) + ")"), "Returning restores that vault's overrides.");
  await evaluate("hotkeyProbe.calls.length=0");
  await pressMod("o", "KeyO", 79);
  assert.equal(await calls(), "alpha");
  pass("Overrides were isolated per vault and restored on return.");

  // 10. SecretStorage through the real plugin settings control.
  const openProbeSecretPage = async () => {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#community-plugins-tab");
    await wait(`Boolean(document.querySelector('[data-settings-plugin="${pluginId}"]'))`, "probe settings button");
    await click(`[data-settings-plugin="${pluginId}"]`);
    await wait('Boolean(document.querySelector("#plugin-settings-host .secret-component"))', "SecretComponent rendered");
  };
  await openProbeSecretPage();
  const probeStatus = () => evaluate('(()=>{try{return app.secretStorage.getStatus()}catch(e){return{error:e.name}}})()');
  if (browser) {
    assert.deepEqual(await probeStatus(), { available: false, protection: "unavailable", backend: null });
    const message = await evaluate('document.querySelector("#plugin-settings-host .secret-component [role=status]").textContent');
    assert.match(message, /unavailable/i);
    assert.equal(await evaluate('document.querySelector("#plugin-settings-host .secret-component select").disabled'), true);
    assert.equal(await evaluate('document.querySelector("#plugin-settings-host .secret-component button")'), null, "No save control may be offered in the browser.");
    for (const call of [`app.secretStorage.setSecret("probe-secret", ${JSON.stringify(synthetic)})`, 'app.secretStorage.getSecret("probe-secret")', "app.secretStorage.listSecrets()", 'app.secretStorage.removeSecret("probe-secret")']) {
      assert.equal(await evaluate(`(()=>{try{${call};return"no error"}catch(e){return e.name}})()`), "SecretStorageUnavailableError", call.split("(")[0]);
    }
    assert.equal(await evaluate(`[localStorage,sessionStorage].some(s=>Object.keys(s).some(k=>k.includes(${JSON.stringify(synthetic)})||String(s.getItem(k)).includes(${JSON.stringify(synthetic)})))`), false);
    await capture?.();
    pass("The browser host refused every SecretStorage operation visibly in the settings control and with SecretStorageUnavailableError; nothing was stored.");
  } else {
    const status = await probeStatus();
    assert.equal(status.available, true, "Windows desktop must provide operating-system protection: " + JSON.stringify(status));
    assert.equal(status.protection, "os-encrypted");
    await click('#plugin-settings-host input[aria-label="New secret ID"]');
    await command("Input.insertText", { text: "probe-secret" });
    await click('#plugin-settings-host input[aria-label="New secret value"]');
    await command("Input.insertText", { text: synthetic });
    await click("#plugin-settings-host .secret-component button");
    await wait('app.secretStorage.listSecrets().includes("probe-secret")', "secret saved from the settings control");
    assert.equal(await evaluate('app.secretStorage.getSecret("probe-secret")'), synthetic);
    assert.equal(await evaluate("hotkeyProbe.selected"), "probe-secret");
    assert.equal(await evaluate('document.querySelector("#plugin-settings-host .secret-component input[type=password]").value'), "", "The value field must be cleared after saving.");
    await evaluate('app.secretStorage.setSecret("probe-empty","");true');
    assert.equal(await evaluate('app.secretStorage.getSecret("probe-empty")'), "", "Empty strings are stored values, not deletions.");
    assert.equal(await evaluate('app.secretStorage.getSecret("probe-absent")'), null);
    const secretFile = join(profile, "secret-storage.sqlite");
    const onDisk = await readFile(secretFile);
    for (const needle of [synthetic, Buffer.from(synthetic).toString("base64"), Buffer.from(synthetic, "utf16le").toString("hex")]) {
      assert.equal(onDisk.includes(needle), false, "The secret file must hold ciphertext only.");
    }
    await closeSettings();
    await reload();
    assert.equal(await evaluate('app.secretStorage.getSecret("probe-secret")'), synthetic, "Protected secrets must survive restart.");
    assert.equal(await evaluate('app.secretStorage.getSecret("probe-empty")'), "");
    assert.equal(await evaluate("(()=>{try{app.secretStorage.setSecret('Bad Id','x');return'no error'}catch(e){return e.message}})()"), "A secret ID must be lowercase alphanumeric text with optional single dashes.");
    await capture?.();
    await evaluate('app.secretStorage.removeSecret("probe-secret");app.secretStorage.removeSecret("probe-empty");true');
    assert.equal(await evaluate('app.secretStorage.listSecrets().includes("probe-secret")||app.secretStorage.listSecrets().includes("probe-empty")'), false);
    assert.equal((await readFile(secretFile)).includes(synthetic), false);
    pass("Desktop SecretStorage saved through the settings control, stored only OS-protected ciphertext, kept empty values, survived restart and the non-native removeSecret extension cleaned up.");
  }
  await closeSettings();
}
