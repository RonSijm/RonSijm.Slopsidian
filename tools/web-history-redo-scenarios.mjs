import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryRedo({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  let currentHistoryPath = historyPath;
  const read = async () => JSON.parse((await readFile(currentHistoryPath, "utf8")).replace(/^\ufeff/, ""));
  let pane;
  const selector = child => pane + " " + child;
  const element = child => "document.querySelector(" + JSON.stringify(selector(child)) + ")";
  const control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()");
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "redo history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.redoSnapshot=" + active + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(active + ".snapshot!==redoSnapshot&&!" + active + ".refreshing", "fresh redo snapshot"); await ready();
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + active + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  async function availability(action, count) {
    const button = element('[data-web-history-action="' + action + '"]'), field = action === "undo" ? "webHistoryUndoCount" : "webHistoryRedoCount";
    await host.wait(button + ".dataset." + field + "===" + JSON.stringify(String(count)) + "&&" + button + ".disabled===" + (count === 0), action + " availability " + count);
  }
  async function undo(count) {
    await availability("undo", count); await host.click(control("undo")); await idle(); await ready();
    await host.wait(element("[data-web-history-status]") + ".textContent===" + JSON.stringify("Restored " + count + (count === 1 ? " visit." : " visits.")), "successful undo feedback");
    await availability("undo", 0); await availability("redo", count);
  }
  async function beginRedo(count) {
    await availability("redo", count); await host.click(control("redo"));
    await host.wait("Boolean(" + active + ".review?.redo)&&!" + active + ".confirmation.hidden", "reviewed redo opens");
    assert.equal(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), "Remove the " + count + (count === 1 ? " visit" : " visits") + " restored by Undo again? Other visits will be kept. ");
    assert.equal(await host.evaluate("document.activeElement===" + element('[data-web-history-action="confirm-clear"]')), true);
  }
  async function finishRedo(count) {
    await host.click(control("confirm-clear")); await idle(); await ready();
    await host.wait(element("[data-web-history-status]") + ".textContent===" + JSON.stringify("Removed " + count + (count === 1 ? " visit again." : " visits again.")), "successful redo feedback");
    await availability("redo", 0); await availability("undo", count);
  }
  async function redo(count) { await beginRedo(count); await finishRedo(count); }
  async function remove(id, menu = false) {
    if (menu) {
      await host.evaluate("document.querySelector(" + JSON.stringify(selector("[data-web-history-id=" + JSON.stringify(id) + "] [data-web-history-url]")) + ").focus()");
      await host.press("F10", "F10", 121, 8); await host.wait('Boolean(document.querySelector("[data-web-history-menu]"))', "redo source visit menu");
      await host.press("End", "End", 35); await host.press("Enter", "Enter", 13);
    } else { await host.click(selector("[data-web-history-id=" + JSON.stringify(id) + '] [data-web-history-action="remove"]')); }
    await idle(); await ready(); await until(async () => !(await read()).entries.some(entry => entry.id === id), "removed visit " + id);
    await availability("redo", 0);
  }
  async function confirm(action) {
    await host.click(control(action)); await host.wait("!" + active + ".confirmation.hidden", "redo source removal review");
    await host.click(control("confirm-clear")); await idle(); await ready(); await availability("redo", 0);
  }
  async function select(id, keyboard = false) {
    const input = selector("[data-web-history-select=" + JSON.stringify(id) + "]");
    if (keyboard) { await host.evaluate("document.querySelector(" + JSON.stringify(input) + ").focus()"); await host.press(" ", "Space", 32); }
    else { await host.click(input); }
    await host.wait(active + ".selected.has(" + JSON.stringify(id) + ")", "redo source selected visit " + id);
  }
  async function recording(enabled) {
    if (await host.evaluate(element("[data-web-history-recording]") + ".checked") !== enabled) { await host.click(selector("[data-web-history-recording]")); }
    await idle(); await ready(); await until(async () => (await read()).recording === enabled, "recording saved " + enabled);
  }
  async function remember() { await host.evaluate("globalThis.redoOwner=" + active + ";globalThis.invokeOldRedo=()=>redoOwner.confirmRemoval().then(()=>false,()=>true);undefined"); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function cycle(count, original, cancel = false, screenshot = false) {
    const removed = await read(); await undo(count); assert.deepEqual(await read(), original);
    if (cancel) {
      const bytes = await readFile(historyPath);
      for (const escape of [false, true]) {
        await beginRedo(count);
        if (escape) { await host.press("Escape", "Escape", 27); } else { await host.click(control("cancel-clear")); }
        assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
        assert.equal(await host.evaluate("document.activeElement===" + element('[data-web-history-action="redo"]')), true);
        await availability("redo", count); assert.deepEqual(await readFile(historyPath), bytes);
      }
    }
    await beginRedo(count); if (screenshot) { await capture("review"); }
    await finishRedo(count); assert.deepEqual(await read(), removed);
    await undo(count); assert.deepEqual(await read(), original);
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const day = await host.evaluate("new Date(2026,0,15,12).getTime()");
  const visit = (id, title = "中文 Story", visitedAt = day) => ({ id: "redo-" + id, title, visitedAt, url: origin + "/one?redo=same", future: { keep: [id, "中文 😀"] } });
  const entries = [visit("before", "Earlier", day - 86400000), visit("one"), visit("two"), visit("keep", "Other <b> & 中文 😀")];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } };
  await writeFile(historyPath, "\ufeff" + JSON.stringify(data) + "\r\n"); await history(); await availability("undo", 0); await availability("redo", 0);
  await remove("redo-one"); await cycle(1, data, true);
  await remove("redo-two", true); await cycle(1, data);
  await query("story 中文"); await confirm("remove-matching"); await cycle(2, data);
  await query(""); await dates("2026-01-15", "2026-01-15"); await confirm("remove-matching"); await cycle(3, data);
  await select("redo-one"); await select("redo-keep", true); await confirm("remove-selected"); await cycle(2, data);
  assert.equal(await host.evaluate(active + ".selected.size"), 0);
  await query("story"); await confirm("clear"); assert.equal((await read()).entries.length, 0); await cycle(4, data, false, true);
  const token = await host.evaluate(store + ".getRedo(" + active + ".snapshot).id");
  assert.equal(JSON.stringify(await host.evaluate(active + ".getState()")).includes(token), false);
  assert.equal((await readFile(historyPath))[0], 0xef); await query(""); await host.click(control("reset-dates")); await refresh(); await availability("redo", 4);
  pass("Real single/menu, matching/date-only, selected and clear-all removal/Undo each offer reviewed exact-count Redo and a fresh inverse Undo; Cancel/Escape preserve data and return focus, current filters never broaden or shrink the checkpoint, original order/repeated URLs/opaque data/recording/BOM survive and no checkpoint enters leaf state");

  await recording(true); await availability("redo", 0); await availability("undo", 0);
  await remove("redo-one"); await undo(1);
  const recordedUrl = origin + "/one?redo-recorded";
  await host.evaluate('app.core.getEnabledPluginById("webviewer").openUrl(' + JSON.stringify(recordedUrl) + ",true)");
  await host.wait(active + '.getViewType()==="webviewer"&&' + active + ".getState().url===" + JSON.stringify(recordedUrl) + "&&!" + active + ".loading", "real visit invalidates redo");
  await until(async () => (await read()).entries.some(entry => entry.url === recordedUrl), "native committed visit recorded");
  await history(); await availability("redo", 0); await availability("undo", 0); await recording(false);
  await remove("redo-one"); await undo(1); const prior = await host.evaluate(store + ".getRedo(" + active + ".snapshot)");
  await remove("redo-two"); await undo(1); const newer = await host.evaluate(store + ".getRedo(" + active + ".snapshot)"); assert.notEqual(prior.id, newer.id);
  const protectedVersion = await readFile(historyPath);
  assert.equal(await host.evaluate("(async()=>{try{await " + store + ".redo(" + active + ".snapshot," + JSON.stringify(prior) + ",()=>true);return false}catch{return true}})()"), true);
  assert.deepEqual(await readFile(historyPath), protectedVersion); await redo(1); await undo(1);
  await beginRedo(1);
  const external = { ...(await read()), external: { keep: "after Undo, before Redo" } }, externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n";
  await writeFile(historyPath, externalBytes); await host.click(control("confirm-clear")); await idle(); await ready();
  await host.wait(element("[data-web-history-error]") + '.textContent.includes("changed")', "stale redo explains refusal");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes); await availability("redo", 0); await availability("undo", 0);
  assert.notEqual(await host.evaluate(active + ".status.textContent"), "Removed 1 visit again."); await capture("conflict"); await refresh(); await availability("redo", 0);
  await remove("redo-one"); await undo(1); await redo(1); await undo(1); assert.deepEqual(await read(), external);
  pass("Same-version refresh retains Redo while recording-preference writes and a real native committed visit discard it; new removal/Undo replaces old tokens, external edits visibly refuse with exact bytes retained and both checkpoints consumed, and a fresh cycle keeps external metadata without retry or false success");

  await host.evaluate('(async()=>{for(const leaf of app.workspace.getLeavesOfType("webviewer"))await app.workspace.closeLeaf(leaf)})()'); await history(); await idle();
  const phaseData = await read(); const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"story",futureHistoryRedo:{keep:["中文",true]}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id");
  await reveal(firstId); await remove("redo-one"); await undo(1);
  await reveal(secondId); await availability("redo", 1); await capture("shared"); await redo(1); await undo(1); assert.deepEqual(await read(), phaseData);
  await reveal(firstId); await beginRedo(1); await remember();
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(firstId) + "))"); await reveal(secondId);
  assert.equal(await host.evaluate("invokeOldRedo()"), true); await redo(1); await undo(1); assert.deepEqual(await read(), phaseData);
  const queuedBytes = await readFile(historyPath); await beginRedo(1);
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseRedoQueue=resolve);undefined");
  await host.click(control("confirm-clear")); await host.wait(active + ".busy", "redo waits in serialized queue");
  await host.click(control("refresh")); await host.evaluate("releaseRedoQueue();undefined"); await idle(); await ready();
  assert.match(await host.evaluate(active + ".error.textContent"), /no longer available/); assert.deepEqual(await readFile(historyPath), queuedBytes);
  await availability("redo", 1); await redo(1); await undo(1); assert.deepEqual(await read(), phaseData);
  pass("Current history panes share one Redo checkpoint across different filters and owner closure; disposed saved confirmations refuse, a current pane can reapply exactly once, and a queued Refresh cancels the owner before consumption so a fresh reviewed Redo and inverse Undo still succeed");

  const expectedState = await host.evaluate(active + ".getState()");
  await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready(); await availability("redo", 0); await availability("undo", 0);
  assert.deepEqual(await read(), phaseData); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await remove("redo-one"); await undo(1); await beginRedo(1); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)');
  assert.equal(await host.evaluate("invokeOldRedo()"), true); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready(); await availability("redo", 0); await availability("undo", 0);
  await query(""); await remove("redo-one"); await undo(1); await beginRedo(1); await remember();
  const other = join(directory, ".history-redo-other-vault"), otherConfig = join(other, ".obsidian");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"other redo"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nOther history redo 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherData = { ...data, entries: [entries[1], { ...entries[2], future: { keep: "other vault" } }], future: { keep: "target vault" } };
  const otherPath = join(otherConfig, "vault-dotnet-web-history.json"), otherHistory = "\ufeff" + JSON.stringify(otherData) + "\r\n"; await writeFile(otherPath, otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "redo vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "redo vault switch");
    currentHistoryPath = join(path, ".obsidian", "vault-dotnet-web-history.json");
  }
  await switchVault(other); await history(); await availability("redo", 0); await availability("undo", 0);
  assert.equal(await host.evaluate("invokeOldRedo()"), true); assert.equal(await readFile(otherPath, "utf8"), otherHistory);
  await remove("redo-one"); await undo(1); await beginRedo(1); await remember(); await switchVault(directory); await ready(); await availability("redo", 0); await availability("undo", 0);
  assert.equal(await host.evaluate("invokeOldRedo()"), true); assert.deepEqual(await read(), phaseData);
  await switchVault(other); await ready(); await availability("redo", 0); await availability("undo", 0);
  assert.deepEqual(JSON.parse((await readFile(otherPath, "utf8")).replace(/^\ufeff/, "")), otherData);
  await remove("redo-two"); await undo(1); await redo(1); await undo(1);
  assert.deepEqual(JSON.parse((await readFile(otherPath, "utf8")).replace(/^\ufeff/, "")), otherData);
  await switchVault(directory); await ready(); await availability("redo", 0); await availability("undo", 0); await capture("restored");
  assert.deepEqual(await read(), phaseData); assert.deepEqual(await host.evaluate(active + ".getState()"), { ...expectedState, query: "" });
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts and repeated real same-ID vault switches discard Undo/Redo, preserve restored data and filters/opaque leaf state, reject disabled/foreign saved reviews and allow a fresh target-vault cycle; exact notes/settings/original workspace/BOM/CRLF/Unicode survive");
}
