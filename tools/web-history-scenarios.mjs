import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkWebHistory({ host, origin, targets, connect, restart, until, directory, pass, capture }) {
  const store = 'app.core.getEnabledPluginById("webviewer").history';
  const active = "app.workspace.activeLeaf.view";
  const historyPath = join(directory, ".obsidian", "vault-dotnet-web-history.json");
  const settingsPath = join(directory, ".obsidian", "webviewer.json"), settings = await readFile(settingsPath);
  const workspacePath = join(directory, ".obsidian", "workspace.json"), originalWorkspace = await readFile(workspacePath);
  const read = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  const idle = () => host.evaluate(`${store}.whenIdle()`);
  const rows = () => host.evaluate('[...document.querySelectorAll("[data-web-history-url]")].map(button=>({url:button.dataset.webHistoryUrl,text:button.innerText}))');
  const loaded = url => host.wait(`${active}.getViewType()==="webviewer"&&${active}.getState().url===${JSON.stringify(url)}&&${active}.contentEl.dataset.webviewerLoading==="false"&&!${active}.contentEl.querySelector("[data-webviewer-error]").textContent`, "history fixture loaded " + url);
  const waitVisit = url => until(async () => (await read()).entries.at(-1)?.url === url, "durable visit " + url);
  async function navigate(url, final = url) { await host.fill("[data-webviewer-address]", url); await host.click('[data-webviewer-action="go"]'); await loaded(final); }
  async function remotePage() {
    let target;
    await until(async () => { target = (await targets()).find(item => item.url.startsWith(origin)); return target; }, "history native page");
    return connect(target);
  }
  async function history() {
    await host.click('[data-webviewer-action="history"]');
    await host.wait(`${active}.getViewType()==="webviewer-history"&&document.querySelector("[data-web-history-recording]")`, "history pane loaded");
  }
  async function browser() {
    const id = await host.evaluate('app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getViewType()==="webviewer").id');
    await host.click(`[data-tab-id=${JSON.stringify(id)}]`);
    await host.wait(`${active}.getViewType()==="webviewer"`, "browser pane active");
  }
  async function recording(enabled) {
    if (await host.evaluate('document.querySelector("[data-web-history-recording]").checked') !== enabled) { await host.click("[data-web-history-recording]"); }
    await until(async () => (await read()).recording === enabled, "recording preference saved");
    await host.wait(`!document.querySelector("[data-web-history-recording]").disabled&&document.querySelector("[data-web-history-recording]").checked===${enabled}`, "recording control settled");
  }

  await idle();
  await writeFile(historyPath, "\ufeff" + JSON.stringify({ version: 1, recording: true, entries: [], future: { keep: [1, true] } }));
  await host.click('[data-core-ribbon="webviewer"]'); await loaded(origin + "/one"); await waitVisit(origin + "/one");
  let remote = await remotePage();
  let data = await read(); data.entries[0].future = { entry: "retained" };
  await idle(); await writeFile(historyPath, "\ufeff" + JSON.stringify(data));
  await remote.click("#next"); await loaded(origin + "/two"); await waitVisit(origin + "/two");
  const reloads = await remote.evaluate("Number(sessionStorage.reloads)");
  await host.click('[data-webviewer-action="reload"]');
  await remote.wait(`Number(sessionStorage.reloads)>${reloads}`); await loaded(origin + "/two"); await idle();
  assert.equal((await read()).entries.length, 2, "consecutive reload does not duplicate history");
  await remote.click("#hash"); await loaded(origin + "/two#anchor"); await waitVisit(origin + "/two#anchor");
  await remote.evaluate(`new Promise(resolve=>{const frame=document.createElement("iframe");frame.onload=()=>resolve(true);frame.src=${JSON.stringify(origin + "/one?subframe")};document.body.append(frame)})`);
  await idle(); assert.equal((await read()).entries.length, 3, "subframe loads are not visits");
  await navigate(origin + "/redirect-history", origin + "/two?redirect");
  await loaded(origin + "/two?redirect"); await waitVisit(origin + "/two?redirect");
  assert.deepEqual((await read()).entries.map(entry => entry.url), ["/one", "/two", "/two#anchor", "/two?redirect"].map(path => origin + path));
  await navigate(origin + "/failure-history"); await idle();
  assert.equal((await read()).entries.length, 4, "HTTP failures are not visits");
  await navigate("about:blank"); await idle(); assert.equal((await read()).entries.length, 4);
  pass("History records successful main-frame and same-document visits, skips consecutive reloads, subframes, blank/error pages and redirect intermediates");

  await history();
  await host.wait('app.workspace.getLeavesOfType("webviewer").every(leaf=>JSON.parse(leaf.view.lastBounds).visible===false)', "history hides the native page");
  await capture("populated");
  await host.fill("[data-web-history-search]", "VIEWER two redirect");
  await until(async () => (await rows()).length === 1, "history title/address search");
  assert.equal((await rows())[0].url, origin + "/two?redirect");
  await host.click(`[data-web-history-url=${JSON.stringify(origin + "/two?redirect")}]`);
  await loaded(origin + "/two?redirect"); await idle();
  const currentId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate(`Promise.all(app.workspace.getLeavesOfType("webviewer").filter(leaf=>leaf.id!==${JSON.stringify(currentId)}).map(leaf=>app.workspace.closeLeaf(leaf)))`);
  await host.wait(`JSON.parse(${active}.lastBounds).visible===true`, "reopened browser surface visible");
  remote = await remotePage(); await remote.click("#page-input");
  await remote.wait('document.hasFocus()&&document.activeElement.id==="page-input"', "reopened native page receives keyboard focus");
  await host.click("[data-webviewer-address]"); await host.press("h", "KeyH", 72, 2);
  await host.wait(`${active}.getViewType()==="webviewer-history"`, "toolbar Ctrl+H opens history");
  assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer-history").length'), 1);
  await host.evaluate('app.commands.execute("webviewer:open-history")');
  assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer-history").length'), 1);
  await host.fill("[data-web-history-search]", "");
  pass("History pane searches titles and URLs, reopens a saved address in an isolated browser tab and is reused by toolbar Ctrl+H");

  await recording(false);
  const paused = (await read()).entries.length;
  await browser(); await navigate(origin + "/one?paused"); await idle();
  assert.equal((await read()).entries.length, paused);
  await history(); await recording(true);
  await browser(); await navigate(origin + "/one?resumed"); await waitVisit(origin + "/one?resumed");
  await history();
  pass("Record visits control durably pauses and resumes automatic history without deleting saved visits");

  const removeId = (await read()).entries.find(entry => entry.url.endsWith("#anchor")).id;
  await host.click(`[data-web-history-id=${JSON.stringify(removeId)}] [data-web-history-action="remove"]`);
  await until(async () => !(await read()).entries.some(entry => entry.id === removeId), "selected visit removed");
  await host.wait('!document.querySelector("[data-web-history-action=clear]").disabled', "history removal settled");
  await host.click('[data-web-history-action="clear"]');
  const external = { ...(await read()), external: { keep: "external edit after review" } };
  const externalBytes = "\ufeff" + JSON.stringify(external); await writeFile(historyPath, externalBytes);
  await host.click('[data-web-history-action="confirm-clear"]');
  await host.wait('document.querySelector("[data-web-history-error]").textContent.includes("changed")', "stale clear reports disk conflict");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes, "stale review does not erase externally edited history");
  pass("Per-visit removal works; a real external edit invalidates a reviewed clear and its exact bytes survive");

  await recording(false);
  await host.fill("[data-web-history-search]", "two");
  await host.evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer-history",state:{...leaf.view.getState(),futureHistoryView:{keep:true}},active:true});await ${store}.whenIdle();await app.workspace.flushLayout()})()`);
  const beforeRestart = await readFile(historyPath);
  await restart();
  await host.wait(`${active}.getViewType()==="webviewer-history"&&document.querySelector("[data-web-history-search]").value==="two"&&!document.querySelector("[data-web-history-recording]").disabled`, "history pane restored after process restart");
  await idle(); assert.deepEqual(await readFile(historyPath), beforeRestart);
  assert.deepEqual(await host.evaluate(`${active}.getState().futureHistoryView`), { keep: true });
  for (const enabled of [false, true]) {
    await host.click("#open-settings"); await host.click("#core-plugins-tab"); await host.click('[data-core-toggle="webviewer"]');
    await host.wait(`!app.core.busy&&app.core.isEnabled("webviewer")===${enabled}`, "history provider toggled"); await host.click(".settings-close");
    if (!enabled) {
      assert.equal(await host.evaluate('app.commands.listCommands().some(command=>command.id==="webviewer:open-history")'), false);
      assert.equal(await host.evaluate(`${active}.getViewType()`), "unavailable");
      await restart();
      assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
    }
  }
  await host.wait(`${active}.getViewType()==="webviewer-history"&&!document.querySelector("[data-web-history-recording]").disabled`, "history pane restores after disabled restart");
  await idle(); assert.deepEqual(await readFile(historyPath), beforeRestart);
  pass("History, paused recording, search and opaque pane state survive full process restarts; disable removes commands and restores the retained pane on re-enable");

  await host.fill("[data-web-history-search]", "");
  await host.click('[data-web-history-action="clear"]'); await host.click('[data-web-history-action="cancel-clear"]');
  assert.deepEqual(await readFile(historyPath), beforeRestart);
  await host.click('[data-web-history-action="clear"]'); await host.click('[data-web-history-action="confirm-clear"]');
  await until(async () => (await read()).entries.length === 0, "confirmed clear saved");
  data = await read();
  assert.deepEqual(data.future, { keep: [1, true] }); assert.deepEqual(data.external, external.external); assert.equal(data.recording, false);
  assert.equal((await readFile(historyPath))[0], 0xef);
  pass("Cancel leaves history untouched; confirmed clear removes visits while preserving the recording preference, BOM and opaque configuration fields");

  await host.wait('!document.querySelector("[data-web-history-recording]").disabled', "clear operation settled");
  const unsupported = "\ufeff" + JSON.stringify({ ...data, version: 99 }); await writeFile(historyPath, unsupported);
  await host.click('[data-web-history-action="refresh"]');
  await host.wait('document.querySelector("[data-web-history-error]").textContent.includes("Unsupported")', "unsupported history is explained");
  await browser(); await navigate(origin + "/one?future-format"); await idle();
  assert.equal(await readFile(historyPath, "utf8"), unsupported, "automatic recording never resets a future format");
  await writeFile(historyPath, "\ufeff" + JSON.stringify(data));
  await history(); await host.click('[data-web-history-action="refresh"]');
  await host.wait('!document.querySelector("[data-web-history-recording]").disabled', "history recovers after externally repaired data");
  assert.deepEqual(await readFile(settingsPath), settings); assert.deepEqual(await readFile(workspacePath), originalWorkspace);
  await capture("empty");
  pass("Unsupported externally written history is retained during reads and automatic visits; original workspace and Web viewer settings remain byte-identical");
}
