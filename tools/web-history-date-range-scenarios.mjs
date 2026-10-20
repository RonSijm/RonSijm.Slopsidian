import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryDateRange({ host, origin, restart, until, requests, directory, pass, capture }) {
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
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "date-range history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.dateRefreshSnapshot=" + active + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(active + ".snapshot!==dateRefreshSnapshot&&" + active + ".snapshot!==null&&!" + active + ".refreshing", "fresh date-range snapshot"); await ready();
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  // Bounded native-input fixture; filtering, confirmation and persistence use production code.
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + active + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  const ids = () => host.evaluate("[..." + active + '.list.querySelectorAll("[data-web-history-id]")].map(row=>row.dataset.webHistoryId)');
  async function review() { await host.click(control("remove-matching")); await host.wait("Boolean(" + active + ".review)&&!" + active + ".confirmation.hidden", "date-scoped removal review"); }
  async function confirm() {
    await host.click(control("confirm-clear")); await idle();
    await host.wait("!" + active + ".busy&&!" + active + ".refreshing&&" + active + ".confirmation.hidden", "date-scoped removal settled");
  }
  async function remember() { await host.evaluate("globalThis.dateOwner=" + active + ";globalThis.confirmOldDates=()=>dateOwner.confirmRemoval().then(()=>false,()=>true);undefined"); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const [start, end] = await host.evaluate("[new Date(2026,0,15).getTime(),new Date(2026,0,17).getTime()]");
  const visit = (id, visitedAt, title = "中文 Story") => ({ id: "date-" + id, visitedAt, title, url: origin + "/one?dates=" + id, future: { keep: [id, "中文 😀"] } });
  const entries = [visit("before", start - 1), visit("start", start), visit("middle", start + 3600000, "Other <b>"), visit("last", end - 1), visit("after", end)];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } };
  await writeFile(historyPath, "\ufeff" + JSON.stringify(data) + "\r\n"); await history();
  const original = await readFile(historyPath);
  assert.deepEqual(await ids(), ["date-after", "date-last", "date-middle", "date-start", "date-before"]);
  assert.deepEqual(await host.evaluate("[" + active + ".from.type," + active + ".through.type]"), ["date", "date"]);
  await dates("2026-01-15", ""); assert.deepEqual(await ids(), ["date-after", "date-last", "date-middle", "date-start"]);
  await dates("", "2026-01-16"); assert.deepEqual(await ids(), ["date-last", "date-middle", "date-start", "date-before"]);
  await dates("2026-01-15", "2026-01-16"); assert.deepEqual(await ids(), ["date-last", "date-middle", "date-start"]);
  await query("STORY 中文"); assert.deepEqual(await ids(), ["date-last", "date-start"]); await capture("filtered");
  const validState = await host.evaluate(active + ".getState()");
  await dates("2026-01-17", "2026-01-16");
  assert.deepEqual(await ids(), []); assert.match(await host.evaluate(element("[data-web-history-date-error]") + ".textContent"), /From must be on or before Through/);
  assert.equal(await host.evaluate(element('[data-web-history-action="remove-matching"]') + ".disabled"), true);
  assert.deepEqual(await host.evaluate(active + ".getState()"), validState);
  await dates("2026-01-15", "2026-01-16"); await host.click(control("reset-dates"));
  assert.equal(await host.evaluate(active + ".search.value"), "STORY 中文"); assert.deepEqual(await ids(), ["date-after", "date-last", "date-start", "date-before"]);
  assert.deepEqual(await readFile(historyPath), original);
  pass("Real history controls combine open/inclusive local-day bounds with all-word title/address search, include exact midnight/last-millisecond boundaries, reject reversed drafts without broadening saved state, and Reset dates retains search; native input values/events are driven without using the OS calendar popover");

  await query(""); await dates("2026-01-15", "2026-01-16"); await review();
  assert.equal(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), "Remove 3 matching visits from 2026-01-15 through 2026-01-16? Other visits will be kept. ");
  await capture("review"); await host.press("Escape", "Escape", 27);
  assert.equal(await host.evaluate(active + ".confirmation.hidden"), true); assert.deepEqual(await readFile(historyPath), original);
  await review(); await dates("2026-01-16", "2026-01-16"); assert.equal(await host.evaluate(active + ".review===null"), true);
  await dates("2026-01-15", "2026-01-16"); await query("story 中文"); await review(); await confirm();
  const after = { ...data, entries: [entries[0], entries[2], entries[4]] };
  await until(async () => (await read()).entries.length === 3, "only date/search conjunction saved"); assert.deepEqual(await read(), after); assert.equal((await readFile(historyPath))[0], 0xef);
  await query(""); await review();
  const external = { ...after, entries: [...after.entries, visit("later", start + 7200000, "External date")], external: { keep: true } };
  const externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n"; await writeFile(historyPath, externalBytes); await confirm();
  await host.wait(element("[data-web-history-error]") + '.textContent.includes("changed")', "date-only stale file conflict");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes); await refresh(); await review(); await confirm();
  const retained = { ...external, entries: [entries[0], entries[4]] };
  await until(async () => (await read()).entries.length === 2, "fresh date-only matching removal saved");
  assert.deepEqual(await read(), retained); await host.click(control("reset-dates"));
  assert.deepEqual(await ids(), ["date-after", "date-before"]);
  pass("Actual confirmation reviews date-only or combined search/date counts and exact bounds; Escape and date edits cancel, confirmed removal retains unmatched ordering/opaque data/recording/BOM, and external changes refuse with exact bytes until Refresh and a new date-scoped review");

  const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await dates("", "2026-01-14"); await review(); await remember();
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"story",fromDate:"2026-01-17",throughDate:"",futureDatePane:{keep:"second"}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"), secondState = await host.evaluate(active + ".getState()");
  assert.deepEqual(await ids(), ["date-after"]); await reveal(firstId);
  assert.equal(await host.evaluate(active + ".through.value"), "2026-01-14");
  assert.deepEqual(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(secondId) + ").view.getState()"), secondState);
  await reveal(secondId); await host.click(selector('[data-web-history-id="date-after"] [data-web-history-action="remove"]'));
  await until(async () => (await read()).entries.length === 1, "other pane removal saved"); await idle(); await reveal(firstId);
  await host.wait(active + ".review===null&&" + active + ".snapshot.history.entries.length===1", "other pane invalidates date review");
  assert.equal(await host.evaluate("confirmOldDates()"), true);
  const protectedBytes = await readFile(historyPath);
  await review(); await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseDateQueue=resolve);globalThis.datePending=" + active + ".confirmRemoval();undefined");
  await host.wait(active + ".busy", "date edit waits in serialized queue"); await dates("", "2026-01-13");
  await host.evaluate("releaseDateQueue();datePending"); await host.wait("!" + active + ".busy", "queued changed date refused");
  assert.match(await host.evaluate(active + ".error.textContent"), /no longer active/); assert.deepEqual(await readFile(historyPath), protectedBytes);
  await dates("", "2026-01-14"); await query("story");
  const beforeImport = await host.evaluate(active + ".getState()");
  for (const invalid of [{ fromDate: "2026-02-30" }, { throughDate: null }, { fromDate: "2026-01-17", throughDate: "2026-01-16" }]) {
    assert.equal(await host.evaluate("(async()=>{try{await " + active + ".setState(" + JSON.stringify({ ...beforeImport, ...invalid, query: "wrong" }) + ",{});return false}catch{return true}})()"), true);
    assert.deepEqual(await host.evaluate(active + ".getState()"), beforeImport); assert.deepEqual(await readFile(historyPath), protectedBytes);
  }
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(secondId) + "))"); await ready();
  await host.evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"webviewer-history",state:{...leaf.view.getState(),futureHistoryDates:{keep:["中文",true]}},active:true})})()'); await ready();
  pass("Separate panes retain independent date/search/opaque state; another pane's saved edit invalidates date review, queued date changes refuse before writing, and invalid imported date states reject atomically with retained visits and prior filters intact");

  await review(); await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready();
  const expectedState = { ...beforeImport, futureHistoryDates: { keep: ["中文", true] } };
  assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState); assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
  assert.deepEqual(await readFile(historyPath), protectedBytes); await review(); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)');
  assert.equal(await host.evaluate("confirmOldDates()"), true); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready();
  assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState); assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
  await review(); await remember();
  const other = join(directory, ".history-date-range-other-vault"), otherConfig = join(other, ".obsidian");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"other date range"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nOther history dates 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherData = { ...data, entries: [{ ...entries[0], future: { keep: "same ID in target vault" } }, entries[4]], future: { keep: "target vault" } };
  const otherHistory = "\ufeff" + JSON.stringify(otherData) + "\r\n"; await writeFile(join(otherConfig, "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "date-range vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "date-range vault switch");
  }
  await switchVault(other); await history(); assert.equal(await host.evaluate("confirmOldDates()"), true);
  assert.equal(await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await dates("2026-01-17", ""); await review(); await confirm();
  await until(async () => JSON.parse((await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, "")).entries.length === 1, "target vault date removal saved");
  const otherAfter = { ...otherData, entries: [otherData.entries[0]] };
  assert.deepEqual(await readFile(historyPath), protectedBytes);
  await switchVault(directory); await ready(); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await switchVault(other); await ready(); assert.equal(await host.evaluate(active + ".from.value"), "2026-01-17"); assert.equal(await host.evaluate(active + ".through.value"), "");
  assert.deepEqual(JSON.parse((await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, "")), otherAfter);
  await switchVault(directory); await ready(); await capture("restored");
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.deepEqual(await readFile(historyPath), protectedBytes);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts retain valid date/search/opaque pane state and discard unconfirmed reviews; repeated actual vault switches isolate date filters/removal even for identical visit IDs, while disabled callbacks refuse and exact note/settings/original-workspace/BOM/CRLF/Unicode bytes survive");
}
