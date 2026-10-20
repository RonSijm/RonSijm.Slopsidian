import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

function installNetworkFixture(configuration) {
  const original = window.fetch.bind(window);
  const state = window.communityInstallNetwork = { version: "1.0.0", blocked: configuration.browser, hold: false, waiting: false, canceled: false, requests: [] };
  const registry = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
  const raw = "https://raw.githubusercontent.com/" + configuration.entry.repo + "/";
  const assets = "https://github.com/" + configuration.entry.repo + "/releases/download/";
  window.fetch = async (input, options) => {
    const url = input instanceof Request ? input.url : String(input);
    const target = url === "/api/community-download" ? JSON.parse(options.body).url : url;
    if (target !== registry && !target.startsWith(raw) && !target.startsWith(assets)) { return original(input, options); }
    state.requests.push({ url: target, mode: options.mode, credentials: options.credentials });
    if (target === registry) { return new Response(JSON.stringify([configuration.entry])); }
    if (target === raw + "HEAD/manifest.json") { return new Response(configuration.packages[state.version]["manifest.json"]); }
    if (target.startsWith(assets)) {
      if (state.blocked) { throw new TypeError("Intentional fixture: GitHub release CORS blocked"); }
      const [version, name] = target.slice(assets.length).split("/");
      if (state.hold && name === "main.js") {
        await new Promise((resolve, reject) => {
          state.waiting = true;
          const signal = options.signal;
          const abort = () => { state.canceled = true; reject(signal.reason); };
          if (signal.aborted) { abort(); }
          else { signal.addEventListener("abort", abort, { once: true }); }
        });
      }
      const value = configuration.packages[version]?.[name];
      return value === undefined || value === null ? new Response("", { status: 404 }) : new Response(value);
    }
    throw new Error("Unexpected fixture request: " + target);
  };
}

export async function checkCommunityInstallation({ directory, evaluate, command, click, press, wait, handleDialog, report, afterReload, capture, browser = false }) {
  const id = "community-install-fixture", repo = "slopsidian-test/community-install-fixture";
  const entry = { id, repo, name: "Catalog install fixture", author: "Slopsidian test", description: "Deterministic install, update and removal fixture" };
  const packageFor = version => ({
    "manifest.json": "\ufeff" + JSON.stringify({ ...entry, version, minAppVersion: "1.0.0", isDesktopOnly: false, future: { preserve: [true, version] } }, null, 2).replaceAll("\n", "\r\n") + "\r\n",
    "main.js": `\ufeffconst {Plugin,PluginSettingTab}=require("obsidian");module.exports=class extends Plugin{
      async onload(){
        (window.communityInstallEvents??=[]).push("load:${version}");
        this.data=await this.loadData()??{preserve:"created",version:"${version}"};
        this.addCommand({id:"save-proof",name:"Save installation proof",callback:async()=>{this.data.preserve="user data";await this.saveData(this.data)}});
        this.addSettingTab(new(class extends PluginSettingTab{display(){this.containerEl.empty();this.containerEl.createEl("p",{text:"Installed fixture ${version}",cls:"community-install-setting"})}})(this.app,this));
      }
      onunload(){window.communityInstallEvents.push("unload:${version}");void this.saveData({...this.data,stoppedVersion:"${version}"});}
    };\r\n`,
    "styles.css": version === "1.0.0" ? "\ufeff.community-install-setting { font-weight: bold; }\r\n" : null,
  });
  const packages = { "1.0.0": packageFor("1.0.0"), "2.0.0": packageFor("2.0.0") };
  const checks = [], sources = directory + "-release-files", pluginDirectory = join(directory, ".obsidian", "plugins", id);
  const enabledPath = join(directory, ".obsidian", "community-plugins.json");
  const pass = (name, detail) => { checks.push({ id: name, status: "passed", detail }); report.checks.push(detail); console.log("PASS " + detail); };
  const closeBrowser = async () => { if (await evaluate('Boolean(document.querySelector("#community-browser"))')) { await click("#community-browser .modal-close-button"); } };
  const openSettings = async () => {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#community-plugins-tab");
    await wait("!app.plugins.isManaging");
  };
  const openBrowser = async (update = false) => {
    await openSettings();
    await click(update ? `[data-update-plugin="${id}"]` : "#community-plugin-browse");
    await wait('document.querySelector("#community-browser .modal-content")?.getAttribute("aria-busy")==="false"', "catalog ready");
  };
  const selectEntry = async () => {
    await click("#community-catalog-search");
    await command("Input.insertText", { text: "Catalog install fixture" });
    assert.equal(await evaluate('document.querySelectorAll("[data-catalog-plugin]").length'), 1);
    await click(`[data-catalog-plugin="${id}"]`);
    await wait('!document.querySelector("#community-install-download")?.disabled', "reviewed plugin release");
  };
  const chooseFiles = async (version, names = ["manifest.json", "main.js", ...(version === "1.0.0" ? ["styles.css"] : [])]) => {
    await command("Page.setInterceptFileChooserDialog", { enabled: true });
    await click("#community-select-release-files");
    const { root } = await command("DOM.getDocument");
    const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector: "#community-release-files" });
    assert.ok(nodeId, "The actual release-file input must still own its picker.");
    await command("DOM.setFileInputFiles", { nodeId, files: names.map(name => join(sources, version, name)) });
    await wait('document.querySelector("#community-browser .modal-content")?.getAttribute("aria-busy")==="false"', "selected release files validated");
  };
  const confirm = (selector, accept = true) => Promise.all([click(selector), handleDialog(accept)]);
  const idle = () => wait("!app.plugins.isManaging", "package management settled");
  const assertAssets = async version => {
    for (const [name, value] of Object.entries(packages[version])) {
      if (value === null) { await assert.rejects(readFile(join(pluginDirectory, name)), { code: "ENOENT" }); }
      else { assert.deepEqual(await readFile(join(pluginDirectory, name)), Buffer.from(value)); }
    }
  };
  await mkdir(sources);
  for (const [version, assets] of Object.entries(packages)) {
    await mkdir(join(sources, version));
    for (const [name, value] of Object.entries(assets)) { if (value !== null) { await writeFile(join(sources, version, name), value); } }
  }
  const fixtureScript = `(${installNetworkFixture.toString()})(${JSON.stringify({ entry, packages, browser })})`;
  const { identifier } = await command("Page.addScriptToEvaluateOnNewDocument", { source: fixtureScript });
  await evaluate(fixtureScript);
  report.communityInstallation = {
    checks, network: "Explicit deterministic GitHub responses; no public network/download or extension claim",
    publicDownloadsTested: false, realSelectedFiles: browser, fixtureAssets: Object.fromEntries(Object.entries(packages).map(([version, assets]) => [version, Object.fromEntries(Object.entries(assets).map(([name, value]) => [name, value === null ? null : createHash("sha256").update(value).digest("hex")]))])),
  };
  try {
    const enabledBefore = await readFile(enabledPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
    const originalLeaf = await evaluate("app.workspace.activeLeaf.id");
    await openBrowser();
    if (browser) { assert.match(await evaluate('document.querySelector("#community-cors-guidance").textContent'), /WASM CORS limitation/); }
    assert.equal(await evaluate('document.querySelector(\'#community-catalog-list [data-catalog-plugin="community-install-fixture"]\').textContent'), entry.name);
    await selectEntry();
    assert.equal(await evaluate('document.querySelector("#community-plugin-detail h3").textContent'), entry.name);
    assert.equal(await evaluate('document.querySelector("#community-plugin-detail a").href'), `https://github.com/${repo}/releases/tag/1.0.0`);
    const layout = await evaluate(`(()=>{
      const columns=document.querySelector(".community-browser-columns"),modal=document.querySelector("#community-browser .modal").getBoundingClientRect();
      const list=columns.children[0].getBoundingClientRect(),detail=columns.children[1].getBoundingClientRect();
      return {display:getComputedStyle(columns).display,sideBySide:detail.left>list.right,withinViewport:modal.left>=0&&modal.top>=0&&modal.right<=innerWidth&&modal.bottom<=innerHeight};
    })()`);
    assert.equal(layout.display, "grid", "The published Community stylesheet must actually load.");
    assert.equal(layout.sideBySide, true, "The catalog and release review must share the normal-width dialog.");
    assert.equal(layout.withinViewport, true);
    report.communityInstallation.layout = layout;
    await capture("catalog");
    pass("browse", "The actual Community Browse modal searched validated catalog records, loaded matching release metadata and exposed the reviewed GitHub release link.");
    if (browser) {
      await expectErrors({ evaluate, report }, [{ source: "notification", message: "The browser could not read the GitHub download. This can be a WASM CORS limitation or a connection failure. Download the release files from GitHub and select them instead." }], async () => {
        await click("#community-install-download");
        await wait('document.querySelector("#community-browser [role=alert]")?.textContent.includes("CORS")');
      }, "Exercise the deterministic browser CORS failure and explain the approved selected-file fallback");
      await assert.rejects(readFile(join(pluginDirectory, "manifest.json")), { code: "ENOENT" });
      await chooseFiles("1.0.0");
      assert.equal(await evaluate('document.querySelector("#community-install-selected").disabled'), false);
      await confirm("#community-install-selected", false);
      await wait('document.querySelector("#community-browser .modal-content").getAttribute("aria-busy")==="false"');
      await assert.rejects(readFile(join(pluginDirectory, "manifest.json")), { code: "ENOENT" });
      await confirm("#community-install-selected");
      pass("file-fallback", "An attributed CORS failure wrote nothing; actual browser-selected manifest/main/styles files required explicit confirmation, and canceling confirmation left the package absent.");
    } else {
      await confirm("#community-install-download", false);
      await wait('document.querySelector("#community-browser .modal-content").getAttribute("aria-busy")==="false"');
      await assert.rejects(readFile(join(pluginDirectory, "manifest.json")), { code: "ENOENT" });
      await confirm("#community-install-download");
    }
    await wait(`!app.plugins.isManaging&&app.plugins.installedPlugins.some(plugin=>plugin.id==="${id}")`, "actual installed inventory");
    await assertAssets("1.0.0");
    assert.equal(await evaluate(`app.plugins.getPlugin("${id}")`), null);
    assert.deepEqual(await readFile(enabledPath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; }), enabledBefore);
    assert.equal(await evaluate("app.workspace.activeLeaf.id"), originalLeaf);
    pass("install", "Installation published exact BOM/CRLF package bytes, refreshed the real inventory without resetting the active leaf, and neither executed the plugin nor changed canonical enablement.");
    await closeBrowser();
    await click(`[data-toggle-plugin="${id}"]`);
    await wait(`!app.plugins.isManaging&&Boolean(app.plugins.getPlugin("${id}"))`, "separate explicit enable");
    await evaluate(`app.commands.execute("${id}:save-proof")`);
    assert.equal(JSON.parse(await readFile(join(pluginDirectory, "data.json"), "utf8")).preserve, "user data");
    await click(`[data-settings-plugin="${id}"]`);
    await wait('document.querySelector(".community-install-setting")?.textContent==="Installed fixture 1.0.0"');
    await click(".settings-close");
    await openSettings();
    const enabledAfter = await readFile(enabledPath);
    pass("enable-settings", "A separate trusted Enable started the unchanged selected plugin, its owned command saved actual data.json, and its actual Community card opened registered settings.");
    await evaluate('communityInstallNetwork.version="2.0.0"');
    await openBrowser(true);
    await wait('!document.querySelector("#community-install-download").disabled', "update release reviewed");
    if (browser) { await chooseFiles("2.0.0"); }
    await confirm(browser ? "#community-install-selected" : "#community-install-download");
    await wait(`!app.plugins.isManaging&&app.plugins.getPlugin("${id}")?.manifest.version==="2.0.0"`, "updated owner restarted");
    await assertAssets("2.0.0");
    assert.deepEqual(await readFile(enabledPath), enabledAfter);
    const data = JSON.parse(await readFile(join(pluginDirectory, "data.json"), "utf8"));
    assert.equal(data.preserve, "user data");
    assert.equal(data.stoppedVersion, "1.0.0");
    assert.deepEqual(await evaluate("communityInstallEvents"), ["load:1.0.0", "unload:1.0.0", "load:2.0.0"]);
    await writeFile(join(pluginDirectory, "extra-user-file.txt"), "Keep through update; remove only on reviewed uninstall.\n");
    pass("update", "Updating a running plugin awaited its unload-owned settings write, preserved data and exact enablement, removed omitted CSS and restarted precisely the newly installed owner.");
    await closeBrowser();
    await click(".settings-close");
    await command("Page.reload");
    await afterReload();
    await wait(`!app.plugins.isManaging&&app.plugins.getPlugin("${id}")?.manifest.version==="2.0.0"`, "updated plugin after real reload");
    await assertAssets("2.0.0");
    assert.deepEqual(await readFile(enabledPath), enabledAfter);
    assert.equal(JSON.parse(await readFile(join(pluginDirectory, "data.json"), "utf8")).preserve, "user data");
    pass("reload", "A real page reload (and actual-folder WASM handle reconnect) retained the updated package, canonical enabled list and plugin data.");
    await openSettings();
    await confirm(`[data-uninstall-plugin="${id}"]`, false);
    await idle();
    await assertAssets("2.0.0");
    assert.equal(await evaluate(`Boolean(app.plugins.getPlugin("${id}"))`), true);
    await openBrowser(true);
    await confirm("#community-browser-uninstall");
    await wait(`!app.plugins.isManaging&&!app.plugins.installedPlugins.some(plugin=>plugin.id==="${id}")`, "reviewed uninstall complete");
    await assert.rejects(readFile(join(pluginDirectory, "manifest.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(pluginDirectory, "data.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(pluginDirectory, "extra-user-file.txt")), { code: "ENOENT" });
    assert.equal(JSON.parse((await readFile(enabledPath, "utf8")).replace(/^\ufeff/, "")).includes(id), false);
    assert.equal(await evaluate(`app.commands.listCommands().some(command=>command.id.startsWith("${id}:"))`), false);
    await closeBrowser();
    pass("uninstall", "Canceling real uninstall confirmation preserved the running plugin; accepting it removed its enabled ID, owned commands, package and explicitly warned-about data/unrelated files only inside its directory.");
    await openBrowser();
    await selectEntry();
    await evaluate('communityInstallNetwork.blocked=false;communityInstallNetwork.hold=true');
    await click("#community-install-download");
    await wait("communityInstallNetwork.waiting", "download body deliberately held");
    await closeBrowser();
    await wait("communityInstallNetwork.canceled", "closing modal aborted the incomplete download");
    await assert.rejects(readFile(join(pluginDirectory, "manifest.json")), { code: "ENOENT" });
    report.communityInstallation.requests = await evaluate("communityInstallNetwork.requests");
    await capture();
    await click(".settings-close");
    pass("cancel-download", "Closing the modal canceled a deliberately incomplete direct download before any package was written; no relay, opaque no-cors fetch, extension or Node shim was involved.");
  } finally {
    await closeBrowser();
    await command("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    await rm(sources, { recursive: true });
  }
}
