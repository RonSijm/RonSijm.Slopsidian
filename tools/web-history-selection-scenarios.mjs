import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistorySelection({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const read = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  let pane;
  const selector = child => pane + " " + child;
  const element = child => "document.querySelector(" + JSON.stringify(selector(child)) + ")";
  const control = action => selector('[data-web-history-action="' + action + '"]');
  const checkbox = id => selector("[data-web-history-select=" + JSON.stringify(id) + "]");
  const idle = () => host.evaluate(store + ".whenIdle()");
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "selection history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.selectionSnapshot=" + active + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(active + ".snapshot!==selectionSnapshot&&!" + active + ".refreshing", "fresh selection snapshot"); await ready();
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + active + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  async function select(id, checked = true, keyboard = false) {
    if (await host.evaluate("document.querySelector(" + JSON.stringify(checkbox(id)) + ").checked") !== checked) {
      if (keyboard) { await host.evaluate("document.querySelector(" + JSON.stringify(checkbox(id)) + ").focus()"); await host.press(" ", "Space", 32); }
      else { await host.click(checkbox(id)); }
    }
    await host.wait(active + ".selected.has(" + JSON.stringify(id) + ")===" + checked, "selected visit " + id);
  }
  const selected = () => host.evaluate("[..." + active + ".selected]");
  async function review() { await host.click(control("remove-selected")); await host.wait("Boolean(" + active + ".review?.ids)&&!" + active + ".confirmation.hidden", "selected removal review"); }
  async function confirm() { await host.click(control("confirm-clear")); await idle(); await ready(); }
  async function remember() { await host.evaluate("globalThis.selectionOwner=" + active + ";globalThis.confirmOldSelection=()=>selectionOwner.confirmRemoval().then(()=>false,()=>true);undefined"); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const start = await host.evaluate("new Date(2026,0,15).getTime()");
  const visit = (id, visitedAt, title = "中文 Story", url = origin + "/one?selected=same") => ({ id: "select-" + id, visitedAt, title, url, future: { keep: [id, "中文 😀"] } });
  const entries = [visit("before", start - 1), visit("one", start), visit("keep", start + 1), visit("two", start + 2), visit("literal", start + 3, "Other <b> & 中文 😀", origin + "/two?selected=literal"), visit("after", start + 172800000)];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } };
  await writeFile(historyPath, "\ufeff" + JSON.stringify(data) + "\r\n"); await history();
  const original = await readFile(historyPath);
  assert.equal(await host.evaluate(element('[data-web-history-action="remove-selected"]') + ".disabled"), true);
  await query("story"); await dates("2026-01-15", "2026-01-15");
  await select("select-one"); await select("select-two", true, true);
  assert.equal(await host.evaluate("document.activeElement.dataset.webHistorySelect"), "select-two");
  assert.deepEqual(await selected(), ["select-one", "select-two"]);
  assert.equal(await host.evaluate(element("[data-web-history-selection]") + ".textContent"), "2 selected");
  assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer").length'), 0);
  const savedState = await host.evaluate(active + ".getState()");
  assert.equal("selected" in savedState, false); assert.equal("selectedIds" in savedState, false);
  await review(); assert.equal(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), "Remove 2 selected visits? Other visits will be kept. ");
  await capture("review"); await host.press("Escape", "Escape", 27);
  assert.equal(await host.evaluate("document.activeElement.dataset.webHistoryAction"), "remove-selected"); assert.equal((await selected()).length, 2);
  await host.click(control("select-shown")); assert.equal((await selected()).length, 3);
  await host.click(control("clear-selection")); assert.deepEqual(await selected(), []); assert.equal(await host.evaluate(active + ".search.value"), "story");
  await host.click(control("select-shown")); await query("Other"); assert.deepEqual(await selected(), []);
  await select("select-literal"); await dates("2026-01-16", "2026-01-16"); assert.deepEqual(await selected(), []);
  await host.click(control("reset-dates")); await host.click(control("select-shown")); await refresh(); assert.deepEqual(await selected(), []);
  await query("story"); await dates("2026-01-15", "2026-01-15"); await select("select-one"); await select("select-two");
  await host.click(control("remove-matching")); assert.match(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), /^Remove 3 matching visits/);
  await host.click(control("cancel-clear")); assert.equal((await selected()).length, 2);
  await host.click(control("clear")); assert.match(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), /^Clear all 6 saved visits/);
  await host.click(control("cancel-clear")); assert.equal((await selected()).length, 2); assert.deepEqual(await readFile(historyPath), original);
  pass("Real pointer and Space checkbox controls retain focus and per-pane selection without navigation or file writes; Select shown obeys search/dates, Clear selection retains filters, filter/Refresh changes discard selection, Escape preserves it, and matching/global clear reviews keep their distinct scopes");

  await review(); await confirm();
  const after = { ...data, entries: entries.filter(entry => !["select-one", "select-two"].includes(entry.id)) };
  await until(async () => (await read()).entries.length === 4, "exact two selected IDs saved");
  assert.deepEqual(await read(), after); assert.deepEqual(await selected(), []); assert.equal((await readFile(historyPath))[0], 0xef);
  await select("select-keep"); await review();
  const later = visit("later", start + 3600000), external = { ...after, entries: [...after.entries, later], external: { keep: "after selection review" } };
  const externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n"; await writeFile(historyPath, externalBytes); await confirm();
  await host.wait(element("[data-web-history-error]") + '.textContent.includes("changed")', "selected stale version conflict");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes); assert.deepEqual(await selected(), []);
  await refresh(); await select("select-keep"); await review(); await confirm();
  const retained = { ...external, entries: external.entries.filter(entry => entry.id !== "select-keep") };
  await until(async () => (await read()).entries.length === 4, "fresh exact selection retry saved");
  assert.deepEqual(await read(), retained); assert.equal((await read()).entries.some(entry => entry.id === "select-later"), true);
  await query(""); await host.click(control("reset-dates")); await capture("retained");
  pass("Reviewed selected removal deletes only exact IDs even when multiple visits share a URL, retains unmatched order/opaque data/recording/BOM, clears selection after saving, refuses external edits byte-for-byte and requires a fresh selection that leaves newly matching unselected visits intact");

  const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await select("select-before"); await select("select-literal"); await review(); await remember();
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"story",futureSelectionPane:{keep:"second"}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"); assert.deepEqual(await selected(), []);
  await select("select-after"); assert.equal(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(firstId) + ").view.selected.size"), 2); await capture("independent");
  await review(); await confirm(); await until(async () => (await read()).entries.length === 3, "second pane exact selection removal saved");
  await reveal(firstId); await host.wait(active + ".review===null&&" + active + ".selected.size===0", "history update invalidates other-pane selection");
  assert.equal(await host.evaluate("confirmOldSelection()"), true);
  const protectedBytes = await readFile(historyPath);
  await select("select-before"); await review();
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseSelectionQueue=resolve);globalThis.selectionPending=" + active + ".confirmRemoval();undefined");
  await host.wait(active + ".busy", "selected removal waits in serialized queue"); await query("Other");
  await host.evaluate("releaseSelectionQueue();selectionPending"); await ready();
  assert.match(await host.evaluate(active + ".error.textContent"), /no longer active/); assert.deepEqual(await readFile(historyPath), protectedBytes);
  await select("select-literal"); await review();
  const beforeImport = await host.evaluate(active + ".getState()");
  assert.equal(await host.evaluate("(async()=>{try{await " + active + ".setState(" + JSON.stringify({ ...beforeImport, fromDate: "2026-02-30" }) + ",{});return false}catch{return true}})()"), true);
  assert.equal((await selected()).length, 1); assert.equal(await host.evaluate("Boolean(" + active + ".review)"), true);
  await host.evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer-history",state:{...leaf.view.getState(),futureHistorySelection:{keep:["中文",true]}},active:true})})()'); await ready();
  assert.deepEqual(await selected(), []); assert.equal(await host.evaluate(active + ".review===null"), true);
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(secondId) + "))"); await ready();
  pass("Split history panes keep independent selections; another pane's saved edit invalidates old IDs/review, queued filter changes refuse before writing, invalid imports retain selection atomically and valid state replacement clears transient selection without losing opaque state");

  await query("story"); await dates("2026-01-15", "2026-01-15"); const expectedState = await host.evaluate(active + ".getState()");
  await select("select-later"); await review(); await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready();
  assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState); assert.deepEqual(await selected(), []); assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
  assert.deepEqual(await readFile(historyPath), protectedBytes);
  await select("select-later"); await review(); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)');
  assert.equal(await host.evaluate("confirmOldSelection()"), true); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready();
  assert.deepEqual(await selected(), []); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await select("select-later"); await review(); await remember();
  const other = join(directory, ".history-selection-other-vault"), otherConfig = join(other, ".obsidian");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"other selected visits"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nOther history selection 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherData = { ...data, entries: [entries[0], { ...later, title: "中文 Target", future: { keep: "same ID in other vault" } }], future: { keep: "target vault" } };
  const otherHistory = "\ufeff" + JSON.stringify(otherData) + "\r\n"; await writeFile(join(otherConfig, "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "selection vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "selection vault switch");
  }
  await switchVault(other); await history(); assert.equal(await host.evaluate("confirmOldSelection()"), true);
  assert.equal(await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  assert.deepEqual(await selected(), []); await query("Target"); await dates("2026-01-15", "2026-01-15"); await select("select-later"); await review(); await confirm();
  await until(async () => JSON.parse((await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, "")).entries.length === 1, "target vault exact selected ID saved");
  const otherAfter = { ...otherData, entries: [otherData.entries[0]] }; assert.deepEqual(await readFile(historyPath), protectedBytes);
  await switchVault(directory); await ready(); assert.deepEqual(await selected(), []); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await switchVault(other); await ready(); assert.deepEqual(await selected(), []);
  assert.deepEqual(JSON.parse((await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, "")), otherAfter);
  await switchVault(directory); await ready(); await capture("restored");
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.deepEqual(await readFile(historyPath), protectedBytes);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts and repeated actual vault switches retain filters/opaque state and exact note/settings/original-workspace/BOM/CRLF/Unicode bytes while discarding selection/reviews; disabled/foreign callbacks refuse even for identical visit IDs and a fresh target selection removes only its own reviewed visit");
}
