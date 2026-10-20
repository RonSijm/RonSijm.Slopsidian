import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryFilter({ host, origin, restart, until, requests, directory, pass, capture }) {
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
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!"+ active + ".busy", "matching-removal history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.filterRefreshSnapshot=" + active + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(active + ".snapshot!==filterRefreshSnapshot&&" + active + ".snapshot!==null", "refreshed matching snapshot ready"); await ready();
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function review(value) {
    await query(value); await host.click(control("remove-matching"));
    await host.wait("!" + active + ".confirmation.hidden&&Boolean(" + active + ".review)", "matching visits reviewed");
  }
  async function confirm() {
    await host.click(control("confirm-clear")); await idle();
    await host.wait("!" + active + ".busy&&" + active + ".confirmation.hidden", "matching removal settled");
  }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function remember() { await host.evaluate("globalThis.filteredOwner=" + active + ";globalThis.confirmOldFilter=()=>filteredOwner.confirmRemoval().then(()=>false,()=>true);undefined"); }
  const ids = () => host.evaluate("[..." + active + '.list.querySelectorAll("[data-web-history-id]")].map(row=>row.dataset.webHistoryId)');
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  await idle();
  const visit = (id, title, url) => ({ id: "filter-" + id, title, url, visitedAt: 1_800_000_000_000, future: { keep: [id, "中文 😀"] } });
  const entries = [
    visit("one", "中文 Story <b>", origin + "/one?filter=one"),
    visit("keep", 'Other <img src=x onerror="bad()">', origin + "/two?filter=keep"),
    visit("two", "Story", origin + "/中文?filter=two"),
    visit("partial", "中文 only", origin + "/two?filter=partial"),
    visit("literal", "Literal <b> & 中文 😀", origin + "/one?filter=literal"),
  ];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } };
  await writeFile(historyPath, "\ufeff" + JSON.stringify(data) + "\r\n"); await history();
  const original = await readFile(historyPath);
  assert.equal(await host.evaluate(element('[data-web-history-action="remove-matching"]') + ".disabled"), true);
  for (const value of ["  \t ", "no matching visits"]) {
    await query(value); assert.equal(await host.evaluate(element('[data-web-history-action="remove-matching"]') + ".disabled"), true);
  }
  await review("<b>");
  assert.equal(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), "Remove 2 matching visits for “<b>”? Other visits will be kept. ");
  assert.equal(await host.evaluate(active + ".confirmation.querySelectorAll('b,img,script').length"), 0);
  await host.press("Escape", "Escape", 27);
  assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
  assert.equal(await host.evaluate("document.activeElement===" + active + ".search"), true);
  await review("  STORY  中文 "); assert.deepEqual(await ids(), ["filter-two", "filter-one"]);
  assert.equal(await host.evaluate("document.activeElement.dataset.webHistoryAction"), "confirm-clear"); await capture("review");
  await host.click(control("cancel-clear")); assert.deepEqual(await readFile(historyPath), original);
  await review("story 中文"); await remember(); await query("other");
  assert.equal(await host.evaluate(active + ".confirmation.hidden"), true); assert.equal(await host.evaluate("confirmOldFilter()"), true);
  await review("story 中文"); await refresh();
  await host.wait(active + ".review===null&&!" + active + ".confirmation.checkVisibility()", "refresh invalidates matching review");
  assert.deepEqual(await readFile(historyPath), original);
  pass("Real search controls review the exact literal query and all-word title/address count; blank/no-match queries disable removal, keyboard Escape/Cancel return focus, and changed searches or Refresh invalidate review without changing BOM/Unicode history bytes");

  await review("story 中文"); await confirm();
  const after = { ...data, entries: entries.filter(entry => !["filter-one", "filter-two"].includes(entry.id)) };
  await until(async () => (await read()).entries.length === 3, "only matching visits saved");
  assert.deepEqual(await read(), after); assert.equal((await readFile(historyPath))[0], 0xef);
  await review("other");
  const external = { ...after, external: { keep: "edit after review" }, entries: [...after.entries, visit("later", "Other later", origin + "/two?history-filter=later")] };
  const externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n"; await writeFile(historyPath, externalBytes);
  await confirm(); await host.wait(element("[data-web-history-error]") + '.textContent.includes("changed")', "stale matching removal visible conflict");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes);
  await refresh(); await review("OTHER");
  assert.match(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), /^Remove 2 matching visits/);
  await confirm();
  const retained = { ...external, entries: external.entries.filter(entry => !["filter-keep", "filter-later"].includes(entry.id)) };
  await until(async () => (await read()).entries.length === 2, "explicit refreshed matches removed");
  assert.deepEqual(await read(), retained); await query(""); await capture("retained");
  assert.deepEqual(await ids(), ["filter-literal", "filter-partial"]);
  pass("Confirmed matching removal preserves unmatched ordering/opaque fields and paused recording; external edits cause a visible version conflict with exact bytes untouched, and only a fresh review includes newly matching visits");

  const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await review("中文"); await remember();
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"only"},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.click(selector('[data-web-history-id="filter-partial"] [data-web-history-action="remove"]'));
  await until(async () => (await read()).entries.length === 1, "other pane selected removal saved"); await idle();
  await reveal(firstId); await host.wait(active + ".review===null", "other pane update invalidates review");
  assert.equal(await host.evaluate("confirmOldFilter()"), true);
  const protectedBytes = await readFile(historyPath);
  await review("<b>");
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseFilteredQueue=resolve);globalThis.filteredPending=" + active + ".confirmRemoval();undefined");
  await host.wait(active + ".busy", "matching removal waiting in serialized queue");
  await query("different"); await host.evaluate("releaseFilteredQueue();filteredPending");
  await host.wait("!" + active + ".busy", "changed queued review refused");
  assert.match(await host.evaluate(active + ".error.textContent"), /no longer active/); assert.deepEqual(await readFile(historyPath), protectedBytes);
  await review("<b>"); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)');
  assert.equal(await host.evaluate("confirmOldFilter()"), true); assert.deepEqual(await readFile(historyPath), protectedBytes);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready();
  await review("<b>"); await remember(); await host.evaluate('app.workspace.activeLeaf.setViewState({type:"empty",state:{},active:true})');
  assert.equal(await host.evaluate("confirmOldFilter()"), true); assert.deepEqual(await readFile(historyPath), protectedBytes);
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(secondId) + "))");
  await history(); await query("<b>"); await capture("guards");
  pass("Independent history panes invalidate each other's reviews after saved changes; queued search edits, plugin disable and replaced/unloaded panes refuse saved callbacks and retain exact history bytes");

  await review("<b>"); await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready();
  assert.equal(await host.evaluate(active + ".search.value"), "<b>"); assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
  assert.deepEqual(await readFile(historyPath), protectedBytes);
  await review("<b>"); await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready();
  assert.equal(await host.evaluate(active + ".search.value"), "<b>"); assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
  await review("<b>"); await remember();
  const other = join(directory, ".history-filter-other-vault"), otherConfig = join(other, ".obsidian");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"other history removal"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nOther history 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherData = { ...data, entries: [{ ...entries[4], future: { keep: "same ID in different vault" } }], future: { keep: "other vault" } };
  const otherHistory = "\ufeff" + JSON.stringify(otherData) + "\r\n"; await writeFile(join(otherConfig, "vault-dotnet-web-history.json"), otherHistory);
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "matching-removal vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "matching-removal vault switch");
  }
  await switchVault(other); await history(); assert.equal(await host.evaluate("confirmOldFilter()"), true);
  assert.equal(await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8"), otherHistory);
  await review("<b>"); assert.match(await host.evaluate(active + ".confirmation.querySelector('span').textContent"), /^Remove 1 matching visit for/);
  await confirm();
  const otherAfter = { ...otherData, entries: [] };
  await until(async () => JSON.parse((await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, "")).entries.length === 0, "target vault exact matching removal");
  assert.deepEqual(await readFile(historyPath), protectedBytes);
  await switchVault(directory); await ready(); assert.deepEqual(await readFile(historyPath), protectedBytes);
  assert.equal(await host.evaluate(active + ".confirmation.hidden"), true);
  await switchVault(other); await ready();
  assert.deepEqual(JSON.parse((await readFile(join(otherConfig, "vault-dotnet-web-history.json"), "utf8")).replace(/^\ufeff/, "")), otherAfter);
  await switchVault(directory); await ready(); await query(""); await capture("restored");
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.deepEqual(await readFile(historyPath), protectedBytes); assert.ok(requests.every(request => request.token === null));
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts preserve the search and retained visits while dropping unconfirmed reviews; repeated real vault switches isolate matching removal even for identical visit IDs, with notes/settings/original-workspace/BOM/CRLF/Unicode state retained");
}
