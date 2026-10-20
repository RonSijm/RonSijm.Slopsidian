import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryUndo({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const read = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  let pane;
  const selector = child => pane + " " + child;
  const element = child => "document.querySelector(" + JSON.stringify(selector(child)) + ")";
  const control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()");
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "undo history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.undoSnapshot=" + active + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(active + ".snapshot!==undoSnapshot&&!" + active + ".refreshing", "fresh undo snapshot"); await ready();
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + active + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  async function availability(count) {
    await host.wait(element('[data-web-history-action="undo"]') + ".dataset.webHistoryUndoCount===" + JSON.stringify(String(count))
      + "&&" + element('[data-web-history-action="undo"]') + ".disabled===" + (count === 0), "undo availability " + count);
  }
  async function undo(count) {
    await availability(count); await host.click(control("undo")); await idle(); await ready();
    await host.wait(element("[data-web-history-status]") + ".textContent===" + JSON.stringify("Restored " + count + (count === 1 ? " visit." : " visits.")), "successful undo feedback");
    await availability(0);
  }
  async function remove(id, menu = false) {
    if (menu) {
      await host.evaluate("document.querySelector(" + JSON.stringify(selector("[data-web-history-id=" + JSON.stringify(id) + "] [data-web-history-url]")) + ").focus()");
      await host.press("F10", "F10", 121, 8); await host.wait('Boolean(document.querySelector("[data-web-history-menu]"))', "undo visit menu opens");
      await host.press("End", "End", 35); await host.press("Enter", "Enter", 13);
    } else { await host.click(selector("[data-web-history-id=" + JSON.stringify(id) + '] [data-web-history-action="remove"]')); }
    await idle(); await ready();
    await until(async () => !(await read()).entries.some(entry => entry.id === id), "removed visit " + id);
  }
  async function confirm(action) {
    await host.click(control(action)); await host.wait("!" + active + ".confirmation.hidden", "undo source removal review");
    await host.click(control("confirm-clear")); await idle(); await ready();
  }
  async function select(id, keyboard = false) {
    const input = selector("[data-web-history-select=" + JSON.stringify(id) + "]");
    if (keyboard) { await host.evaluate("document.querySelector(" + JSON.stringify(input) + ").focus()"); await host.press(" ", "Space", 32); }
    else { await host.click(input); }
    await host.wait(active + ".selected.has(" + JSON.stringify(id) + ")", "undo selected visit " + id);
  }
  async function recording(enabled) {
    if (await host.evaluate(element("[data-web-history-recording]") + ".checked") !== enabled) { await host.click(selector("[data-web-history-recording]")); }
    await idle(); await ready(); await until(async () => (await read()).recording === enabled, "recording saved " + enabled);
  }
  async function remember() { await host.evaluate("globalThis.undoOwner=" + active + ";globalThis.invokeOldUndo=()=>undoOwner.undoRemoval().then(()=>false,()=>true);undefined"); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const day = await host.evaluate("new Date(2026,0,15,12).getTime()");
  const visit = (id, title = "中文 Story", visitedAt = day) => ({ id: "undo-" + id, title, visitedAt, url: origin + "/one?undo=same", future: { keep: [id, "中文 😀"] } });
  const entries = [visit("before", "Earlier", day - 86400000), visit("one"), visit("two"), visit("keep", "Other <b> & 中文 😀")];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } };
  await writeFile(historyPath, "\ufeff" + JSON.stringify(data) + "\r\n"); await history(); await availability(0);
  await remove("undo-one"); await undo(1); assert.deepEqual(await read(), data);
  await remove("undo-two", true); await undo(1); assert.deepEqual(await read(), data);
  await query("story 中文"); await confirm("remove-matching"); await undo(2); assert.deepEqual(await read(), data);
  await query(""); await dates("2026-01-15", "2026-01-15"); await confirm("remove-matching"); await undo(3); assert.deepEqual(await read(), data);
  await select("undo-one"); await select("undo-keep", true); await confirm("remove-selected"); await undo(2);
  assert.deepEqual(await read(), data); assert.equal(await host.evaluate(active + ".selected.size"), 0);
  await query("story"); await confirm("clear"); await availability(4); assert.equal((await read()).entries.length, 0);
  const token = await host.evaluate(store + ".getUndo(" + active + ".snapshot).id");
  assert.equal(JSON.stringify(await host.evaluate(active + ".getState()")).includes(token), false); await capture("clear");
  await undo(4); assert.deepEqual(await read(), data); assert.equal((await readFile(historyPath))[0], 0xef); await query(""); await host.click(control("reset-dates"));
  pass("Real single-row/context-menu, matching, date-only, selected and clear-all removals each offer one exact-count Undo, including an empty history list; restore retains original order/repeated URLs/opaque data/recording/BOM, clears selection, reports success and keeps checkpoints out of serialized state without a multi-step stack");

  await remove("undo-one"); await availability(1); await recording(true); await availability(0);
  await remove("undo-keep"); await availability(1);
  const recordedUrl = origin + "/one?undo-recorded";
  await host.evaluate('app.core.getEnabledPluginById("webviewer").openUrl(' + JSON.stringify(recordedUrl) + ",true)");
  await host.wait(active + '.getViewType()==="webviewer"&&' + active + ".getState().url===" + JSON.stringify(recordedUrl) + "&&!" + active + ".loading", "real visit invalidates undo");
  await until(async () => (await read()).entries.some(entry => entry.url === recordedUrl), "native committed visit recorded");
  await history(); await availability(0); await recording(false);
  const recordedId = (await read()).entries.find(entry => entry.url === recordedUrl).id;
  await remove("undo-before"); const prior = await host.evaluate(store + ".getUndo(" + active + ".snapshot)");
  await remove(recordedId); const newer = await host.evaluate(store + ".getUndo(" + active + ".snapshot)"); assert.notEqual(prior.id, newer.id);
  assert.equal(await host.evaluate("(async()=>{try{await " + store + ".undo(" + active + ".snapshot," + JSON.stringify(prior) + ",()=>true);return false}catch{return true}})()"), true);
  await undo(1); assert.equal((await read()).entries.some(entry => entry.id === "undo-before"), false);
  await remove(recordedId); await availability(1);
  const external = { ...(await read()), external: { keep: "after removal, before undo" } }, externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n";
  await writeFile(historyPath, externalBytes); await host.click(control("undo")); await idle(); await ready();
  await host.wait(element("[data-web-history-error]") + '.textContent.includes("changed")', "stale undo explains refusal");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes); await availability(0); await capture("conflict"); await refresh(); await availability(0);
  await remove("undo-two"); await undo(1); assert.deepEqual(await read(), external);
  pass("Recording-preference writes and a real native committed visit invalidate Undo; newer removals replace the checkpoint, old tokens cannot restore older data, and external edits cause visible exact-byte refusal that consumes Undo without retry or false success; a fresh removal/undo retains external metadata");

  await host.evaluate('(async()=>{for(const leaf of app.workspace.getLeavesOfType("webviewer"))await app.workspace.closeLeaf(leaf)})()'); await history(); await idle();
  const phaseData = { ...(await read()), entries: [entries[0], entries[1], ...(await read()).entries] };
  await writeFile(historyPath, "\ufeff" + JSON.stringify(phaseData) + "\r\n"); await refresh(); await availability(0);
  const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"story",futureHistoryUndo:{keep:["中文",true]}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id");
  await reveal(firstId); await remove("undo-one"); await availability(1);
  await reveal(secondId); await availability(1); await capture("shared"); await undo(1); assert.deepEqual(await read(), phaseData);
  await reveal(firstId); await remove("undo-one"); await remember();
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(firstId) + "))"); await reveal(secondId);
  assert.equal(await host.evaluate("invokeOldUndo()"), true); await undo(1); assert.deepEqual(await read(), phaseData);
  await remove("undo-two"); const protectedBytes = await readFile(historyPath);
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseUndoQueue=resolve);globalThis.pendingUndo=" + active + ".undoRemoval();undefined");
  await host.wait(active + ".busy", "undo waits in serialized queue"); await host.click(control("refresh"));
  await host.evaluate("releaseUndoQueue();pendingUndo"); await ready();
  assert.match(await host.evaluate(active + ".error.textContent"), /no longer available/); assert.deepEqual(await readFile(historyPath), protectedBytes);
  await undo(1); assert.deepEqual(await read(), phaseData);
  pass("One vault-scoped checkpoint is shared by independent history panes and survives closing the removing pane; disposed owners cannot undo, another current pane restores exactly once, and a queued owner refresh refuses before consuming the still-valid checkpoint so a fresh Undo can succeed");

  const expectedState = await host.evaluate(active + ".getState()");
  await remove("undo-one"); await availability(1); const afterRestart = { ...phaseData, entries: phaseData.entries.filter(entry => entry.id !== "undo-one") };
  await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready(); await availability(0);
  assert.deepEqual(await read(), afterRestart); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await remove("undo-two"); await availability(1); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)');
  assert.equal(await host.evaluate("invokeOldUndo()"), true); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready(); await availability(0);
  await query(""); await remove("undo-before"); await availability(1); await remember();
  const sourceFinal = { ...phaseData, entries: [] }, other = join(directory, ".history-undo-other-vault"), otherConfig = join(other, ".obsidian");
  assert.deepEqual(await read(), sourceFinal);
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"other undo"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nOther history undo 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherData = { ...data, entries: [entries[0], { ...entries[3], future: { keep: "other vault" } }], future: { keep: "target vault" } };
  const otherHistory = "\ufeff" + JSON.stringify(otherData) + "\r\n"; await writeFile(join(otherConfig, "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "undo vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "undo vault switch");
  }
  await switchVault(other); await history(); await availability(0); assert.equal(await host.evaluate("invokeOldUndo()"), true);
  assert.equal(await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await remove("undo-before"); await availability(1); await remember(); await switchVault(directory); await ready(); await availability(0);
  assert.equal(await host.evaluate("invokeOldUndo()"), true); assert.deepEqual(await read(), sourceFinal);
  await switchVault(other); await ready(); await availability(0); await remove("undo-keep"); await undo(1);
  const otherFinal = { ...otherData, entries: [otherData.entries[1]] };
  assert.deepEqual(JSON.parse((await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, "")), otherFinal);
  await switchVault(directory); await ready(); await availability(0); await capture("restored");
  assert.deepEqual(await read(), sourceFinal); assert.deepEqual(await host.evaluate(active + ".getState()"), { ...expectedState, query: "" });
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts and repeated real vault switches discard checkpoints without restoring deleted visits, retain filters/opaque leaf state, reject disabled/foreign saved owners even for matching IDs and allow only a fresh target-vault removal/Undo; exact note/settings/original-workspace/BOM/CRLF/Unicode state remains intact");
}
