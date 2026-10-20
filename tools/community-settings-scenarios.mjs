import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function checkCommunitySettings({ directory, evaluate, command, click, press, wait, report, afterReload, selectVault, capture, browser = false, targetDirectory }) {
  const configurationPath = join(directory, ".obsidian", "community-plugins.json");
  const ids = ["settings-failure", "settings-restored", "settings-later", "settings-desktop", "settings-future", "settings-bad-version", "settings-missing"];
  const enabled = [...ids, "settings-restored"];
  const original = "\ufeff" + JSON.stringify(enabled, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const checks = [];
  const packageHashes = [];
  const pass = (id, detail) => { checks.push({ id, status: "passed", detail }); report.checks.push(detail); console.log("PASS " + detail); };
  const parsed = text => JSON.parse(text.replace(/^\ufeff/, ""));
  const loaded = () => evaluate("Object.keys(app.plugins.plugins).sort()");
  const expected = ["settings-restored", "settings-later", ...(browser ? [] : ["settings-desktop"])].sort();
  const open = async () => {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#community-plugins-tab");
    await wait("!app.plugins.isManaging");
  };
  const close = async () => {
    if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
  };
  const reload = async () => {
    await close();
    await command("Page.reload");
    await afterReload();
    await wait("!app.plugins.isManaging");
  };
  const createPlugin = async (id, changes = {}) => {
    const path = join(directory, ".obsidian", "plugins", id);
    await mkdir(path, { recursive: true });
    const manifest = JSON.stringify({ id, name: id === "settings-restored" ? "Restored fixture" : id, version: "1.0.0", description: "Disposable community settings fixture", author: "Fixture author", minAppVersion: "1.0.0", isDesktopOnly: false, ...changes });
    const code = `const {Plugin,PluginSettingTab}=require("obsidian");module.exports=class extends Plugin{
      async onload(){
        (window.communityFixtureStarts??={})[${JSON.stringify(id)}]=true;
        this.addCommand({id:"fixture-command",name:"Community settings fixture",callback(){}});
        if(${JSON.stringify(id)}==="settings-restored"){
          this.addSettingTab(new(class extends PluginSettingTab{
            display(){
              this.containerEl.empty();
              this.containerEl.createEl("p",{text:"Community settings fixture",cls:"community-settings-fixture"});
            }
          })(this.app,this));
        }
        if(${JSON.stringify(id)}==="settings-failure"){throw new Error("Expected community settings startup failure");}
        if(${JSON.stringify(id)}==="settings-conflict"){window.communityConflictStarted=true;await new Promise(resolve=>window.releaseCommunityConflict=resolve);}
      }
    };`;
    for (const [name, bytes] of [["manifest.json", manifest], ["main.js", code], ["data.json", '{"preserve":["plugin","data"]}\n']]) {
      await writeFile(join(path, name), bytes);
      packageHashes.push({ id, name, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  };
  for (const id of ids.filter(id => id !== "settings-missing")) {
    await createPlugin(id, id === "settings-desktop" ? { isDesktopOnly: true } : id === "settings-future" ? { minAppVersion: "99.0.0" } : id === "settings-bad-version" ? { minAppVersion: "invalid" } : {});
  }
  await createPlugin("settings-conflict");
  await writeFile(configurationPath, original);
  report.communitySettings = { checks, packageHashes, configuredFile: ".obsidian/community-plugins.json", publicDownloadsTested: false };
  await reload();
  assert.deepEqual(await loaded(), expected);
  assert.equal(await readFile(configurationPath, "utf8"), original);
  assert.deepEqual(await evaluate("[...app.plugins.configuredPlugins]"), ids);
  assert.equal(await evaluate('Boolean(app.commands.listCommands().find(item=>item.id==="settings-failure:fixture-command"))'), false);
  assert.equal(await evaluate('Boolean(window.communityFixtureStarts?.["settings-future"]||window.communityFixtureStarts?.["settings-bad-version"])'), false);
  if (browser) { assert.equal(await evaluate('Boolean(window.communityFixtureStarts?.["settings-desktop"])'), false); }
  pass("restore", "Vault opening restored compatible enabled plugins without rewriting BOM/CRLF/duplicate bytes; one failed startup did not prevent later plugins.");
  await open();
  assert.match(await evaluate('document.querySelector(\'[data-plugin-id="settings-future"] .plugin-error\').textContent'), /99\.0\.0/);
  assert.match(await evaluate('document.querySelector(\'[data-plugin-id="settings-bad-version"] .plugin-error\').textContent'), /Invalid minAppVersion/);
  assert.ok(await evaluate('document.querySelector(\'[data-missing-plugin="settings-missing"]\').textContent.includes("preserved")'));
  if (browser) {
    assert.equal(await evaluate('document.querySelector(\'[data-toggle-plugin="settings-desktop"]\').disabled'), true);
    assert.match(await evaluate('document.querySelector(\'[data-plugin-id="settings-desktop"] .plugin-error\').textContent'), /desktop/i);
  }
  pass("compatibility", "Missing, desktop-only and minimum-version-incompatible enabled entries remained configured and displayed concrete explanations.");
  await click("#community-plugin-search");
  await command("Input.insertText", { text: "Restored fixture" });
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#installed-community-plugins [data-plugin-id]"),row=>row.dataset.pluginId)'), ["settings-restored"]);
  await press("a", "KeyA", 65, 2);
  await command("Input.insertText", { text: "not-present-in-any-plugin" });
  assert.equal(await evaluate('document.querySelectorAll("#installed-community-plugins [data-plugin-id]").length'), 0);
  await press("a", "KeyA", 65, 2);
  await press("Backspace", "Backspace", 8);
  pass("search", "The installed-plugin search filtered actual rendered cards by name and showed an explicit empty result.");

  await click('[data-settings-plugin="settings-restored"]');
  await wait('document.querySelector("#plugin-settings-host .community-settings-fixture")?.textContent==="Community settings fixture"', "registered settings reached from the actual Community card");
  await wait('!document.querySelector("main[aria-busy=true]")&&!document.querySelector("#open-settings").disabled', "plugin settings completion renders the enabled toolbar");
  await close();
  await open();
  assert.equal(await readFile(configurationPath, "utf8"), original);
  pass("settings", "A real installed-plugin card opened its registered settings, cleared the host busy state and allowed closing/reopening Settings without rewriting enablement.");

  await click('[data-toggle-plugin="settings-restored"]');
  await wait('!app.plugins.isManaging&&!app.plugins.getPlugin("settings-restored")');
  let saved = await readFile(configurationPath, "utf8");
  let configured = ids.filter(id => id !== "settings-restored");
  assert.deepEqual(parsed(saved), configured);
  assert.ok(saved.startsWith("\ufeff"), "Explicit enablement writes preserve the original BOM.");
  await reload();
  assert.equal(await evaluate('app.plugins.getPlugin("settings-restored")'), null);
  assert.equal(await readFile(configurationPath, "utf8"), saved);
  await open();
  await click('[data-toggle-plugin="settings-restored"]');
  await wait('!app.plugins.isManaging&&Boolean(app.plugins.getPlugin("settings-restored"))');
  configured.push("settings-restored");
  assert.deepEqual(parsed(await readFile(configurationPath, "utf8")), configured);
  pass("persist", "Explicit disable/enable controls persisted the canonical enabled array, retained unavailable IDs, preserved BOM, and survived a real page reload.");

  const leaf = await evaluate("app.workspace.activeLeaf.id");
  await createPlugin("settings-added");
  saved = await readFile(configurationPath, "utf8");
  await click("#community-plugin-reload");
  await wait('!app.plugins.isManaging&&Boolean(document.querySelector(\'[data-plugin-id="settings-added"]\'))');
  assert.equal(await evaluate("app.workspace.activeLeaf.id"), leaf);
  assert.equal(await evaluate('app.plugins.getPlugin("settings-added")'), null);
  assert.equal(await readFile(configurationPath, "utf8"), saved);
  pass("refresh", "Reloading plugin inventory discovered new files without resetting the active workspace, enabling new code, or rewriting enabled IDs.");

  await click("#community-restricted-toggle");
  await wait("!app.plugins.isManaging&&app.plugins.isRestricted");
  assert.deepEqual(await loaded(), []);
  assert.equal(await readFile(configurationPath, "utf8"), saved);
  await reload();
  assert.equal(await evaluate("app.plugins.isRestricted"), true);
  assert.deepEqual(await loaded(), []);
  assert.deepEqual(await evaluate("[...app.plugins.configuredPlugins]"), configured);
  await open();
  await click("#community-restricted-toggle");
  await wait("!app.plugins.isManaging&&!app.plugins.isRestricted");
  assert.deepEqual(await loaded(), expected);
  assert.equal(await readFile(configurationPath, "utf8"), saved);
  pass("restricted", "Restricted mode unloaded plugins, persisted separately across reload, and restored the same configured list without editing Obsidian's enabled file.");

  await click('[data-toggle-plugin="settings-conflict"]');
  await wait("window.communityConflictStarted===true");
  const external = "\ufeff" + JSON.stringify([...configured, "external-preserved"], null, 2) + "\n";
  await writeFile(configurationPath, external);
  await evaluate("window.releaseCommunityConflict()");
  await wait('!app.plugins.isManaging&&Boolean(document.querySelector("#community-settings-error"))');
  assert.match(await evaluate('document.querySelector("#community-settings-error").textContent'), /changed/i);
  assert.equal(await evaluate('app.plugins.getPlugin("settings-conflict")'), null);
  assert.equal(await evaluate('app.commands.listCommands().some(item=>item.id.startsWith("settings-conflict:"))'), false);
  assert.equal(await readFile(configurationPath, "utf8"), external);
  pass("conflict", "An actual external enabled-file change rejected a stale toggle, removed its started plugin/command, and preserved the external bytes.");

  const malformed = "\ufeff{ invalid community configuration }\r\n";
  await writeFile(configurationPath, malformed);
  await reload();
  assert.deepEqual(await loaded(), []);
  await open();
  assert.ok(await evaluate('Boolean(document.querySelector("#community-settings-error")?.textContent)'));
  assert.equal(await readFile(configurationPath, "utf8"), malformed);
  await writeFile(configurationPath, external);
  await reload();
  assert.deepEqual(await loaded(), expected);
  assert.equal(await readFile(configurationPath, "utf8"), external);
  pass("invalid", "Malformed existing enablement remained untouched, showed a visible read error, and a corrected file restored normally on the next reload.");

  const other = targetDirectory ?? await mkdtemp(join(dirname(directory), "community-isolated-"));
  if (targetDirectory) { await mkdir(other); }
  report.communitySettings.isolatedVault = other;
  try {
    await mkdir(join(other, ".obsidian"));
    await writeFile(join(other, ".obsidian", "community-plugins.json"), "[]\n");
    await writeFile(join(other, "Other.md"), "# Community isolation\n");
    await selectVault(other);
    await wait("!app.plugins.isManaging&&!app.changingVault");
    assert.deepEqual(await loaded(), []);
    assert.deepEqual(await evaluate("[...app.plugins.configuredPlugins]"), []);
    assert.equal(await readFile(join(other, ".obsidian", "community-plugins.json"), "utf8"), "[]\n");
    await selectVault(directory);
    await wait("!app.plugins.isManaging&&!app.changingVault");
    assert.deepEqual(await loaded(), expected);
    assert.deepEqual(await evaluate("[...app.plugins.configuredPlugins]"), [...configured, "external-preserved"]);
    assert.equal(await readFile(configurationPath, "utf8"), external);
  } finally {
    if (await evaluate("app.vault.getName()") !== other.split(/[\\/]/).at(-1)) { await rm(other, { recursive: true, force: true }); }
  }
  pass("isolation", "Actual vault switching unloaded the previous plugins, imported only the selected vault's IDs, and restored the original vault without cross-vault writes.");
  for (const { id, name, sha256 } of packageHashes) {
    assert.equal(createHash("sha256").update(await readFile(join(directory, ".obsidian", "plugins", id, name))).digest("hex"), sha256);
  }
  await open();
  await click("#community-plugin-reload");
  await wait("!app.plugins.isManaging");
  await capture();
  await close();
  pass("ownership", "Settings management left every installed manifest, main.js and data.json byte unchanged; the final Community settings page was captured.");
}
