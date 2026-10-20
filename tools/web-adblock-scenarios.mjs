import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkWebAddressDraft } from "./webviewer-scenarios.mjs";

export async function checkWebAdblock({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", output = `${view}.contentEl.querySelector("[data-webviewer-adblocking]")`;
  const settingsPath = join(directory, ".obsidian", "webviewer.json"), originalSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  const originalEffectiveSettings = await host.evaluate('app.core.state("webviewer").settings');
  const workspacePath = join(directory, ".obsidian", "workspace.json"), originalWorkspace = await readFile(workspacePath);
  const source = phase => origin + "/adblock-story?phase=" + phase;
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${JSON.stringify(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"&&!${view}.contentEl.querySelector("[data-webviewer-error]").textContent`, "ad-blocking source loaded " + url);
  const count = value => host.wait(`${output}?.dataset.blockedRequests===${JSON.stringify(String(value))}`, "blocked request count " + value);
  async function remotePage(url) {
    let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native ad-blocking page " + url);
    return connect(target);
  }
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${JSON.stringify(url)},true)`); await loaded(url); return remotePage(url); }
  async function navigate(url) { await checkWebAddressDraft(host, url); await loaded(url); }
  async function reveal(url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getState().url===${JSON.stringify(url)}))`); await loaded(url); }
  async function settingsList() {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
  }
  async function setting(enabled) {
    await settingsList(); await host.click('[data-core-settings="webviewer"]');
    if (await host.evaluate('document.querySelector("[data-core-field=enableAdblocking]").checked') !== enabled) { await host.click('[data-core-field="enableAdblocking"]'); }
    await host.click('[data-core-save="webviewer"]');
    await host.wait(`!app.core.busy&&app.core.state("webviewer").settings.enableAdblocking===${enabled}`, "ad-blocking settings saved");
    await host.click(".settings-close");
    await host.wait(`app.workspace.getLeavesOfType("webviewer").length>0&&app.workspace.getLeavesOfType("webviewer").every(leaf=>leaf.view.contentEl.querySelector("[data-webviewer-adblocking]")?.dataset.webviewerAdblocking===${JSON.stringify(enabled ? "on" : "off")})`, "all native tabs adopt the saved ad-blocking setting");
  }
  const adRequests = phase => requests.filter(item => item.destination === "script" && /\/ads\/(?:cbr|custom_ads)\.js\?phase=/.test(item.url) && new URL(item.url, origin).searchParams.get("phase") === phase);
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  let first = await open(source("off"));
  await first.wait('document.documentElement.dataset.adScript==="off"&&document.documentElement.dataset.secondAdScript==="off"&&document.documentElement.dataset.xhr==="allowed"', "disabled resources execute");
  assert.equal(adRequests("off").length, 2); await count(0);
  await setting(true); await navigate(source("enabled"));
  await first.wait('document.documentElement.dataset.normalScript==="enabled"&&document.documentElement.dataset.xhr==="allowed"&&document.documentElement.dataset.vault==="blocked"', "normal scripts and typed XHR work while vault requests stay blocked");
  await count(2);
  assert.equal(await first.evaluate('Boolean(document.documentElement.dataset.adScript||document.documentElement.dataset.secondAdScript)'), false);
  assert.equal(adRequests("enabled").length, 0, "blocked scripts never reach the fixture server");
  assert.ok(requests.some(item => item.url === "/ads/cbr.js?phase=xhr-enabled"));
  await capture("on");
  pass("Real Block ads settings and bundled EasyList cancel both native script requests before they reach the server; normal scripts and the same ad URL as XHR still load, with exactly two blocked requests and no vault access");

  const secondUrl = source("second"); let second = await open(secondUrl); await count(2);
  await setting(false);
  await Promise.all([first.evaluate('loadAds("disabled-live")'), second.evaluate('loadAds("disabled-live")')]);
  assert.equal(adRequests("disabled-live").length, 4);
  for (const remote of [first, second]) { assert.equal(await remote.evaluate('document.documentElement.dataset.secondAdScript'), "disabled-live"); }
  await setting(true);
  await Promise.all([first.evaluate('loadAds("enabled-live")'), second.evaluate('loadAds("enabled-live")')]);
  await count(4); await reveal(source("enabled")); await count(4);
  assert.equal(adRequests("enabled-live").length, 0);
  assert.equal(await first.evaluate('document.documentElement.dataset.secondAdScript'), "disabled-live", "already loaded page scripts are not removed by toggling");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { ...originalEffectiveSettings, ...originalSettings, enableAdblocking: true });
  pass("Saving the setting updates both visible and hidden native sessions for future requests, without reloading or removing existing scripts; per-tab counts and unknown vault settings remain independent and intact");

  await first.click("#adblock-hash"); await loaded(source("enabled") + "#section"); await count(4);
  const beforeReload = await first.evaluate("performance.timeOrigin");
  await host.click('[data-webviewer-action="reload"]');
  await first.wait(`performance.timeOrigin>${beforeReload}&&document.readyState==="complete"`, "ad-blocking reload commits a new document");
  await loaded(source("enabled") + "#section"); await count(2);
  await navigate(origin + "/two"); await count(0);
  await host.click('[data-webviewer-action="back"]'); await loaded(source("enabled") + "#section"); await count(2);
  await host.click('[data-webviewer-action="forward"]'); await loaded(origin + "/two"); await count(0);
  await navigate(source("persist")); await count(2);
  pass("Counts retain blocked requests across hash changes and reset for actual document loads, reload, back and forward without treating denied vault requests as advertisements");

  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer",state:{...leaf.view.getState(),enableAdblocking:false,futureAdblock:{keep:[1,true]}},active:true});await app.workspace.flushLayout()})()`);
  await count(2); await restart(); await loaded(source("persist")); await count(2);
  assert.deepEqual(await host.evaluate(`${view}.getState().futureAdblock`), { keep: [1, true] });
  assert.equal(await host.evaluate(`${output}.dataset.webviewerAdblocking`), "on", "opaque tab fields do not override vault settings");
  first = await remotePage(source("persist"));
  assert.equal(await first.evaluate('Boolean(document.documentElement.dataset.adScript)'), false);
  await setting(false); await restart(); await loaded(source("persist")); await count(0);
  first = await remotePage(source("persist"));
  await first.wait('document.documentElement.dataset.adScript==="persist"', "disabled setting takes effect before restored navigation");
  assert.equal(await host.evaluate(`${output}.dataset.webviewerAdblocking`), "off");
  await capture("off");
  pass("Full enabled and disabled process restarts restore the saved Boolean before loading page resources, preserve opaque tab fields and ignore an unrelated leaf field with the same name");

  await setting(true); await host.click('[data-webviewer-action="reload"]'); await loaded(source("persist")); await count(2);
  assert.equal(await host.evaluate(`(async()=>{try{await ${view}.request("ad-blocking",{enabled:"true"});return false}catch{return true}})()`), true);
  await count(2); assert.equal(await host.evaluate(`${output}.dataset.webviewerAdblocking`), "on");
  first = await remotePage(source("persist")); await first.evaluate('document.cookie="adblockTransient=clear;path=/"');
  await settingsList(); await host.click('[data-core-toggle="webviewer"]');
  await host.wait('!app.core.busy&&!app.core.isEnabled("webviewer")', "ad-blocking provider disabled");
  await until(async () => !(await targets()).some(item => item.url.startsWith(origin)), "native ad-blocking sessions destroyed");
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-webviewer-adblocking]"))'), false);
  await host.click('[data-core-toggle="webviewer"]'); await host.wait('!app.core.busy&&app.core.isEnabled("webviewer")', "ad-blocking provider enabled"); await host.click(".settings-close");
  await loaded(source("persist")); await count(2);
  first = await remotePage(source("persist")); assert.equal(await first.evaluate('document.cookie.includes("adblockTransient")'), false);
  assert.equal(await first.evaluate('typeof require'), "undefined");
  pass("Invalid native IPC cannot mutate protection; disabling releases every page and counter, and re-enabling restores filtering with fresh ephemeral storage and no page access to Node");

  const originalSaved = await readFile(settingsPath), otherVault = join(directory, ".adblock-other-vault");
  await mkdir(join(otherVault, ".obsidian"), { recursive: true }); await writeFile(join(otherVault, "Keep.md"), "# Keep\nAd-blocking isolation.\n");
  await writeFile(join(otherVault, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(item=>[item.id,["webviewer","command-palette","file-explorer"].includes(item.id)]))')));
  const otherSettings = '{"enableAdblocking":false,"future":{"keep":"other-vault"}}\n';
  await writeFile(join(otherVault, ".obsidian", "webviewer.json"), otherSettings);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "ad-blocking vault switch " + path);
  }
  await switchVault(otherVault); const other = await open(source("other-vault")); await count(0);
  await other.wait('document.documentElement.dataset.adScript==="other-vault"', "other vault uses its own disabled setting");
  await switchVault(directory); await loaded(source("persist")); await count(2);
  assert.deepEqual(await readFile(settingsPath), originalSaved);
  assert.equal(await readFile(join(otherVault, ".obsidian", "webviewer.json"), "utf8"), otherSettings);
  assert.equal(await readFile(join(otherVault, "Keep.md"), "utf8"), "# Keep\nAd-blocking isolation.\n");
  assert.deepEqual(await readFile(workspacePath), originalWorkspace);
  assert.ok(requests.every(item => item.token === null));
  await host.evaluate('app.workspace.flushLayout()');
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "", "Vault switching must not enqueue obsolete layout saves.");
  assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await capture("restored");
  pass("Real vault switches replace each native session's filtering setting, restore the original enabled tabs, preserve both vaults' settings/note/original-workspace bytes and never expose a vault token to fixture requests");
}
