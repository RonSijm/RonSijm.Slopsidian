import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkHistoryCopy, checkRestoredHistoryCopy, checkStaleHistoryCopy } from "./web-history-copy-scenarios.mjs";

export async function checkWebHistoryMenu({ host, origin, targets, restart, until, requests, directory, pass, capture, copyMode = false }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const historyPath = join(directory, ".obsidian", "vault-dotnet-web-history.json"), settingsPath = join(directory, ".obsidian", "webviewer.json");
  const settings = await readFile(settingsPath), workspacePath = join(directory, ".obsidian", "workspace.json"), workspace = await readFile(workspacePath), note = await readFile(join(directory, "Welcome.md"));
  const read = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  const openButton = id => `[data-web-history-id=${JSON.stringify(id)}] [data-web-history-url]`;
  const menuItem = title => `[data-web-history-menu] [data-menu-title=${JSON.stringify(title)}]`;
  const idle = () => host.evaluate(`${store}.whenIdle()`);
  const historyReady = () => host.wait(`${active}.getViewType()==="webviewer-history"&&!document.querySelector("[data-web-history-recording]").disabled`, "history menu pane ready");
  const loaded = url => host.wait(`${active}.getViewType()==="webviewer"&&${active}.getState().url===${JSON.stringify(url)}&&${active}.contentEl.dataset.webviewerLoading==="false"&&!${active}.contentEl.querySelector("[data-webviewer-error]").textContent`, "menu browser loaded " + url);
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await historyReady(); }
  async function context(id, keyboard = false) {
    await idle();
    const selector = openButton(id); await host.wait(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, "reviewed visit visible");
    if (keyboard) {
      await host.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await host.press("F10", "F10", 121, 8);
    } else {
      const point = await host.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:"nearest"});const b=element.getBoundingClientRect();return{x:b.x+b.width*.45,y:b.y+b.height/2}})()`);
      await host.command("Page.bringToFront"); await host.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await host.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "right", clickCount: 1 });
      await host.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "right", clickCount: 1 });
    }
    await host.wait(`document.querySelector("[data-web-history-menu]")?.dataset.webHistoryMenu===${JSON.stringify(id)}`, "owned visit menu opens");
    await host.wait('app.workspace.getLeavesOfType("webviewer").every(leaf=>leaf.view.lastBounds&&!JSON.parse(leaf.view.lastBounds).visible)', "menu native overlays settled");
    assert.equal(await host.evaluate('document.querySelectorAll("[data-web-history-menu]").length'), 1);
  }
  async function rememberActions() {
    await host.evaluate(`${active}.visitMenu.entries.filter(item=>item.callback).forEach(item=>{(globalThis.savedHistoryMenuActions??=[]).push(item.callback)})`);
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await idle();
  const entries = ["one", "two", "stale", "unicode", "keep"].map((name, index) => ({ id: "menu-" + name, url: origin + "/one?menu=" + name, title: name === "unicode" ? "<b>中文 😀 & visit</b>" : "Menu " + name, visitedAt: 1_800_000_000_000 + index, future: { keep: name } }));
  const data = { version: 1, recording: false, entries, future: { keep: [1, true] } };
  await writeFile(historyPath, "\ufeff" + JSON.stringify(data) + "\r\n"); await history();
  const original = await readFile(historyPath);
  await context("menu-unicode");
  assert.deepEqual(await host.evaluate('[...document.querySelectorAll("[data-web-history-menu] [data-menu-title]")].map(item=>item.dataset.menuTitle)'), ["Open in new tab", "Open in this tab", "Copy link address", "Remove visit"]);
  assert.equal(await host.evaluate('document.activeElement.dataset.menuTitle'), "Open in new tab");
  await capture("menu"); await host.press("Escape", "Escape", 27);
  assert.equal(await host.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(openButton("menu-unicode"))})`), true);
  await context("menu-unicode", true); await host.press("ArrowDown", "ArrowDown", 40); assert.equal(await host.evaluate('document.activeElement.dataset.menuTitle'), "Open in this tab");
  await host.press("End", "End", 35); assert.equal(await host.evaluate('document.activeElement.dataset.menuTitle'), "Remove visit");
  await host.press("Home", "Home", 36); await host.press("Escape", "Escape", 27);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-menu]"))'), false); assert.deepEqual(await readFile(historyPath), original);
  pass("Real right-click and Shift+F10 open one accessible visit menu; arrow/Home/End navigation and Escape restore focus without changing Unicode/HTML-literal history bytes");
  if (copyMode) { await checkHistoryCopy({ host, context, menuItem, active, entries, historyPath, idle, pass, capture }); }

  const firstHistoryId = await host.evaluate("app.workspace.activeLeaf.id"), count = await host.evaluate('app.workspace.getLeavesOfType("webviewer").length');
  await context("menu-one"); await host.click(menuItem("Open in new tab")); await loaded(entries[0].url); await idle();
  assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer").length'), count + 1);
  assert.equal(await host.evaluate(`app.workspace.getLeafById(${JSON.stringify(firstHistoryId)}).view.getViewType()`), "webviewer-history");
  await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(firstHistoryId)}))`); await historyReady();
  const leafCount = await host.evaluate("app.workspace.leaves().length");
  await context("menu-two", true); await host.press("ArrowDown", "ArrowDown", 40); await host.press("Enter", "Enter", 13); await loaded(entries[1].url);
  assert.equal(await host.evaluate("app.workspace.activeLeaf.id"), firstHistoryId); assert.equal(await host.evaluate("app.workspace.leaves().length"), leafCount);
  await idle(); assert.deepEqual(await readFile(historyPath), original); await history();
  pass("Open in new tab retains the history leaf, while keyboard Open in this tab replaces exactly its owning pane; paused recording keeps history bytes unchanged");

  const historyId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate("app.workspace.activeLeaf.setPinned(true)"); await context("menu-one", true);
  assert.equal(await host.evaluate(`document.querySelector(${JSON.stringify(menuItem("Open in this tab"))}).disabled`), true);
  await host.click(menuItem("Open in new tab")); await loaded(entries[0].url);
  assert.equal(await host.evaluate(`app.workspace.getLeafById(${JSON.stringify(historyId)}).pinned`), true);
  await host.evaluate(`(async()=>{const leaf=app.workspace.getLeafById(${JSON.stringify(historyId)});await app.workspace.revealLeaf(leaf);leaf.setPinned(false)})()`); await historyReady();
  assert.equal(await host.evaluate(`app.workspace.getLeafById(${JSON.stringify(historyId)}).pinned`), false);
  await host.evaluate(`app.workspace.getLeaf("split").setViewState({type:"webviewer",state:{url:${JSON.stringify(origin + "/two?menu=split")}},active:true})`); await loaded(origin + "/two?menu=split");
  const splitId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.wait('app.workspace.getLeavesOfType("webviewer").some(leaf=>leaf.view.lastBounds&&JSON.parse(leaf.view.lastBounds).visible)', "native page visible beside history");
  await context("menu-keep");
  await host.wait('app.workspace.getLeavesOfType("webviewer").every(leaf=>leaf.view.lastBounds&&!JSON.parse(leaf.view.lastBounds).visible)', "native panes release menu overlay");
  const menuLeaf = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate(`(()=>{const view=app.workspace.getLeafById(${JSON.stringify(splitId)}).view;view.ipc.emit("webviewer:event",{}, {id:view.id,shortcut:"activate"})})()`);
  assert.equal(await host.evaluate("app.workspace.activeLeaf.id"), menuLeaf, "Delayed native focus must not steal a visit menu");
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-menu]"))'), true);
  await capture("split"); await host.press("Escape", "Escape", 27);
  await host.wait('app.workspace.getLeavesOfType("webviewer").some(leaf=>JSON.parse(leaf.view.lastBounds).visible)', "native surface restored after menu closes");
  await context("menu-keep", true); await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(splitId)}))`);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-menu]"))'), false);
  await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(historyId)}))`); await historyReady();
  pass("Pinned history disables replacement but still opens new tabs; split-pane menus hide native surfaces while open, restore them on dismissal and close when the active leaf changes");

  await context("menu-one"); await host.click(menuItem("Remove visit")); await until(async () => !(await read()).entries.some(entry => entry.id === "menu-one"), "context removal saved");
  await host.wait('!document.querySelector("[data-web-history-recording]").disabled', "context removal settled");
  assert.deepEqual(await read(), { ...data, entries: data.entries.filter(entry => entry.id !== "menu-one") });
  await context("menu-stale");
  const external = { ...(await read()), external: { keep: "edit after menu review" } }, externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n";
  await writeFile(historyPath, externalBytes); await host.click(menuItem("Remove visit"));
  await host.wait('document.querySelector("[data-web-history-error]").textContent.includes("changed")', "stale menu removal reports conflict");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes);
  await host.wait(`!${active}.busy`, "conflicted edit refresh complete");
  await host.click('[data-web-history-action="refresh"]'); await idle(); await historyReady();
  assert.deepEqual(await host.evaluate(`${active}.snapshot.history.data.external`), external.external);
  await context("menu-stale"); await host.click(menuItem("Remove visit"));
  await until(async () => !(await read()).entries.some(entry => entry.id === "menu-stale"), "fresh review removes selected visit");
  const removed = await read(); assert.deepEqual(removed.external, external.external); assert.deepEqual(removed.future, data.future); assert.equal(removed.recording, false);
  assert.equal((await readFile(historyPath))[0], 0xef);
  pass("Context removal deletes only the reviewed visit; an external BOM/CRLF edit causes a visible version conflict with exact byte preservation, and refreshed retry retains opaque fields and paused recording");

  await host.wait('!document.querySelector("[data-web-history-recording]").disabled', "menu removal complete");
  // The preceding split case has finished; isolate persistence from native page focus.
  await host.evaluate(`(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer")])await app.workspace.closeLeaf(leaf);await app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(historyId)}))})()`); await historyReady();
  await host.fill("[data-web-history-search]", "menu");
  await host.evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer-history",state:{...leaf.view.getState(),futureMenu:{keep:[1,true]}},active:true});await app.workspace.flushLayout()})()');
  const savedHistory = await readFile(historyPath); await context("menu-keep"); await restart(); await historyReady();
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-menu]"))'), false);
  assert.equal(await host.evaluate('document.querySelector("[data-web-history-search]").value'), "menu"); assert.deepEqual(await host.evaluate(`${active}.getState().futureMenu`), { keep: [1, true] });
  if (copyMode) { await checkRestoredHistoryCopy({ host, context, menuItem, url: entries[4].url }); }
  await context("menu-keep", true); await rememberActions(); await host.evaluate('app.core.setEnabled("webviewer",false)');
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-menu]"))'), false);
  const invokeSaved = 'Promise.all(savedHistoryMenuActions.map(action=>action(new MouseEvent("click"))))';
  if (copyMode) { await checkStaleHistoryCopy(host, invokeSaved); } else { await host.evaluate(invokeSaved); }
  assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer").some(leaf=>leaf.view.getViewType()==="webviewer")'), false);
  await until(async () => !(await targets()).some(item => item.url.startsWith(origin)), "menu disable releases native contents");
  assert.deepEqual(await readFile(historyPath), savedHistory);
  await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await historyReady();
  if (copyMode) { await checkRestoredHistoryCopy({ host, context, menuItem, url: entries[4].url }); }
  await context("menu-keep", true); await host.press("Escape", "Escape", 27); assert.deepEqual(await readFile(historyPath), savedHistory);
  await capture("restored");
  pass("Enabled and disabled full restarts preserve search/opaque history state and exact bytes; owned menus never restore, disable releases them/native pages, and saved callbacks cannot act after unload");

  const otherVault = join(directory, ".history-menu-other-vault"); await mkdir(join(otherVault, ".obsidian"), { recursive: true });
  const otherHistory = "\ufeff" + JSON.stringify({ version: 1, recording: false, entries: [{ ...entries[4], title: "Other vault visit" }], other: { keep: true } }) + "\r\n", otherSettings = '{"enableAdblocking":false,"future":{"keep":"other-vault"}}\n', otherNote = Buffer.from("\ufeff# Keep\r\nHistory menu 中文 😀.\r\n");
  await writeFile(join(otherVault, ".obsidian", "vault-dotnet-web-history.json"), otherHistory); await writeFile(join(otherVault, ".obsidian", "webviewer.json"), otherSettings); await writeFile(join(otherVault, "Keep.md"), otherNote);
  await writeFile(join(otherVault, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(item=>[item.id,["webviewer","command-palette","file-explorer"].includes(item.id)]))')));
  await context("menu-keep", true); await rememberActions();
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "history menu vault dialog ready"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${JSON.stringify(path)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "history menu vault switch " + path);
  }
  await switchVault(otherVault); await history();
  if (copyMode) { await checkStaleHistoryCopy(host, invokeSaved); } else { await host.evaluate(invokeSaved); }
  assert.equal(await host.evaluate(`${active}.getViewType()`), "webviewer-history"); assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer").length'), 0);
  assert.equal(await readFile(join(otherVault, ".obsidian", "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await context("menu-keep", true); await host.press("Escape", "Escape", 27);
  await switchVault(directory); await historyReady();
  assert.deepEqual(await readFile(historyPath), savedHistory); assert.deepEqual(await readFile(settingsPath), settings); assert.deepEqual(await readFile(workspacePath), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.equal(await readFile(join(otherVault, ".obsidian", "webviewer.json"), "utf8"), otherSettings); assert.deepEqual(await readFile(join(otherVault, "Keep.md")), otherNote);
  assert.ok(requests.every(item => item.token === null)); await host.evaluate("app.workspace.flushLayout()");
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.equal(await host.evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  await capture("vault-restored");
  pass("Actual vault switches dismiss menus and reject old callbacks even for the same visit ID, preserve both vaults' history/settings/note/original-workspace bytes and restore the original history pane without stale saves or token exposure");
}
