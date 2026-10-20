import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryRetention({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const modal = "app.workspace.getLeavesOfType('webviewer-history').map(leaf=>leaf.view.archivePreview).find(value=>value?.isOpen)";
  let pane;
  const selector = value => pane + " " + value, control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()");
  const read = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "retention history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() { await host.click(control("refresh")); await idle(); await ready(); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function choose(days, wait = true) {
    await host.click(selector("[data-web-history-retention]")); await host.press("Home", "Home", 36);
    for (let index = 0; index < [0, 7, 30, 90].indexOf(days); index++) { await host.press("ArrowDown", "ArrowDown", 40); }
    await host.press("Enter", "Enter", 13);
    if (wait) { await idle(); await ready(); await host.wait(active + ".snapshot.history.retentionDays===" + days, "saved history age limit " + days); }
  }
  async function recording(value) {
    if (await host.evaluate(active + ".recording.checked") !== value) { await host.click(selector("[data-web-history-recording]")); await idle(); await ready(); }
  }
  async function nativeVisit(url) {
    await host.evaluate('app.core.getEnabledPluginById("webviewer").openUrl(' + JSON.stringify(url) + ",true)");
    await host.wait(active + '.getViewType()==="webviewer"&&' + active + ".getState().url===" + JSON.stringify(url) + "&&!" + active + ".loading", "actual native retention visit");
    await idle();
  }
  async function closeWebPages() { await host.evaluate('(async()=>{for(const leaf of app.workspace.getLeavesOfType("webviewer"))await app.workspace.closeLeaf(leaf)})()'); await history(); }
  async function remember() {
    await host.evaluate("globalThis.retentionOwner=" + active + ";globalThis.invokeOldRetention=async days=>{try{await retentionOwner.changeRetention(days);return false}catch{return true}};undefined");
  }
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "retention vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "retention vault switch");
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const now = await host.evaluate("Date.now()"), DAY = 86400000;
  const visit = (id, age) => ({ id: "retention-" + id, title: "Story 中文 " + id + " <img src=x onerror=evil()> ![[Secret]]",
    visitedAt: now - age * DAY, url: origin + "/one?retention=same", future: { keep: [id, "中文 😀"] } });
  const data = { version: 1, recording: false, entries: [visit("future", -1), visit("ancient", 100), visit("older", 8), visit("recent", 2)], future: { keep: ["中文", true] } };
  const original = "\ufeff" + JSON.stringify(data, null, 2) + "\r\n";
  await writeFile(historyPath, original); await history(); const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate(active + '.setState({query:"Story",sortOrder:"oldest",futureRetention:{keep:["中文",true]}},{})');
  assert.equal(await host.evaluate(active + ".snapshot.history.retentionDays"), 0);
  assert.equal(await readFile(historyPath, "utf8"), original);
  await host.click(selector('[data-web-history-select="retention-future"]')); await host.click(control("remove-matching"));
  for (const days of [7, 30, 90, 0, 7]) {
    await choose(days);
    const saved = await read(); assert.deepEqual(saved.entries, data.entries); assert.deepEqual(saved.future, data.future); assert.equal(saved.recording, false);
    assert.equal(saved.retentionDays ?? 0, days); assert.equal((await readFile(historyPath))[0], 0xef);
  }
  assert.equal(await host.evaluate(active + ".selected.size"), 0); assert.equal(await host.evaluate(active + ".review"), null);
  assert.equal("retentionDays" in await host.evaluate(active + ".getState()"), false);
  const initialState = await host.evaluate(active + ".getState()");
  for (const invalid of [null, true, "7", 14, -1, {}]) {
    assert.equal(await host.evaluate("(()=>{try{new " + active + ".snapshot.history.constructor(" + JSON.stringify({ ...data, retentionDays: invalid }) + ");return false}catch{return true}})()"), true);
    assert.deepEqual(await host.evaluate(active + ".getState()"), initialState);
  }
  await capture("policy");
  pass("Real pointer/keyboard no-age-limit/7/30/90-day controls save one vault-wide policy without pruning or changing entries, recording, source order, opaque data or BOM; legacy layouts default to no age limit, invalid imports reject, selection/reviews expire and policy stays out of leaf state");

  const beforePaused = await readFile(historyPath); await nativeVisit(origin + "/one?retention=paused"); await closeWebPages();
  assert.deepEqual(await readFile(historyPath), beforePaused);
  await host.fill(selector("[data-web-history-search]"), ""); await recording(true);
  const recordedUrl = origin + "/one?retention=new";
  await nativeVisit(recordedUrl); await until(async () => (await read()).entries.some(entry => entry.url === recordedUrl), "retention native visit saved");
  const pruned = await read(), newEntry = pruned.entries.at(-1);
  assert.deepEqual(pruned.entries.slice(0, -1), [data.entries[0], data.entries[3]]);
  assert.equal(newEntry.url, recordedUrl); assert.ok(newEntry.visitedAt >= now); assert.equal(pruned.retentionDays, 7);
  assert.deepEqual(pruned.future, data.future); const afterVisit = await readFile(historyPath);
  await nativeVisit(recordedUrl); await closeWebPages(); assert.deepEqual(await readFile(historyPath), afterVisit);
  await recording(false); await capture("pruned");
  await host.click(selector('[data-web-history-id="retention-future"] [data-web-history-action="remove"]')); await idle(); await ready();
  await host.click(control("undo")); await idle(); await ready(); assert.deepEqual((await read()).entries, pruned.entries);
  await host.click(control("redo")); await host.click(control("confirm-clear")); await idle(); await ready();
  await host.click(control("undo")); await idle(); await ready(); assert.deepEqual((await read()).entries, pruned.entries);
  const archiveBytes = await readFile(historyPath), markdown = await host.evaluate(active + '.snapshot.history.archive("",{}, "oldest").markdown');
  await host.click(control("archive")); await host.wait("Boolean(" + modal + ")", "retained visit archive");
  await host.fill("[data-web-history-archive-path]", "History/Retained visits.md"); await host.click('[data-web-history-archive-action="save"]');
  await host.wait('app.workspace.getActiveFile()?.path==="History/Retained visits.md"&&!document.querySelector("[data-web-history-archive]")', "retained visits note");
  assert.equal(await readFile(join(directory, "History/Retained visits.md"), "utf8"), markdown);
  await host.evaluate(active + '.setMode("preview")'); await host.wait(active + ".previewEl.querySelectorAll('a[href^=\"http\"]').length===3", "retained visits Reading");
  assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("img,script,iframe,.internal-embed,.internal-link").length'), 0);
  await history(); assert.deepEqual(await readFile(historyPath), archiveBytes);
  pass("Actual committed native visits prune expired timestamps using the saved rolling policy, retain future/recent visits and original physical order/opaque data, while paused and consecutive-duplicate visits preserve exact bytes; Undo/Redo and exact chronological archive saving/actual Reading retain the policy and source");

  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"Story",futureRetention:{keep:"second pane"}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id");
  assert.equal(await host.evaluate(active + ".snapshot.history.retentionDays"), 7);
  await choose(30); await reveal(firstId); await host.wait(active + ".snapshot.history.retentionDays===30", "vault-wide policy reaches another pane");
  const sourceState = await host.evaluate(active + ".getState()");
  const external = { ...(await read()), retentionDays: 90, external: { keep: ["newer", true] } }, externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n";
  await writeFile(historyPath, externalBytes); await choose(7, false); await idle(); await ready();
  await host.wait(active + '.error.textContent.includes("changed")', "retention conflict is visible");
  assert.equal(await host.evaluate(active + ".retentionSelect.value"), "90"); assert.equal(await readFile(historyPath, "utf8"), externalBytes); await capture("conflict");
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseRetentionQueue=resolve);undefined");
  await choose(30, false); await host.wait(active + ".busy", "policy waits for queue");
  await host.evaluate("void " + active + ".refresh();releaseRetentionQueue();undefined"); await idle(); await ready();
  assert.equal(await readFile(historyPath, "utf8"), externalBytes); assert.equal(await host.evaluate(active + ".retentionSelect.value"), "90");
  const invalidBytes = "\ufeff" + JSON.stringify({ ...external, retentionDays: "7" }) + "\r\n"; await writeFile(historyPath, invalidBytes);
  await host.click(control("refresh")); await idle();
  await host.wait("!" + active + ".snapshot&&!" + active + ".refreshing&&" + active + ".retentionSelect.disabled", "damaged retention is retained");
  assert.equal(await readFile(historyPath, "utf8"), invalidBytes); await writeFile(historyPath, externalBytes); await refresh();
  await remember(); await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(firstId) + "))"); await reveal(secondId);
  assert.equal(await host.evaluate("invokeOldRetention(7)"), true); assert.equal(await readFile(historyPath, "utf8"), externalBytes);
  assert.deepEqual(await host.evaluate(active + ".getState().futureRetention"), { keep: "second pane" });
  pass("Separate filtered panes share vault retention without mixing leaf state; external version conflicts preserve exact newer bytes and restore the visible saved choice, queued Refresh and closed owners refuse before writes, invalid stored policies disable controls without reset and corrected data recovers");

  const restoredState = await host.evaluate(active + ".getState()"), sourceFinal = await readFile(historyPath);
  await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready();
  assert.equal(await host.evaluate(active + ".retentionSelect.value"), "90"); assert.deepEqual(await host.evaluate(active + ".getState()"), restoredState);
  assert.deepEqual(await readFile(historyPath), sourceFinal);
  await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)'); assert.equal(await host.evaluate("invokeOldRetention(7)"), true);
  assert.deepEqual(await readFile(historyPath), sourceFinal); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); assert.deepEqual(await readFile(historyPath), sourceFinal);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready(); assert.equal(await host.evaluate(active + ".retentionSelect.value"), "90");
  const other = join(directory, ".history-retention-other-vault"), otherConfig = join(other, ".obsidian"), otherHistoryPath = join(otherConfig, "vault-dotnet-web-history.json");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"retention target"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nRetention target 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherData = { ...data, entries: [data.entries[3]], future: { keep: "target vault" } }, otherHistory = "\ufeff" + JSON.stringify(otherData) + "\r\n";
  await writeFile(otherHistoryPath, otherHistory); await remember(); await switchVault(other); await history();
  assert.equal(await host.evaluate(active + ".retentionSelect.value"), "0"); assert.equal(await host.evaluate("invokeOldRetention(7)"), true);
  assert.equal(await readFile(otherHistoryPath, "utf8"), otherHistory); await choose(7);
  const targetFinal = await readFile(otherHistoryPath); assert.deepEqual(JSON.parse(targetFinal.toString("utf8").replace(/^\ufeff/, "")).entries, otherData.entries);
  await remember(); await switchVault(directory); await ready(); assert.equal(await host.evaluate("invokeOldRetention(30)"), true);
  assert.equal(await host.evaluate(active + ".retentionSelect.value"), "90"); assert.deepEqual(await host.evaluate(active + ".getState()"), restoredState); assert.deepEqual(await readFile(historyPath), sourceFinal);
  await switchVault(other); await ready(); assert.equal(await host.evaluate(active + ".retentionSelect.value"), "7"); assert.deepEqual(await readFile(otherHistoryPath), targetFinal);
  await switchVault(directory); await ready(); await capture("restored");
  assert.deepEqual(await readFile(historyPath), sourceFinal); assert.equal(await readFile(join(directory, "History/Retained visits.md"), "utf8"), markdown);
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.ok(requests.every(request => request.token === null));
  assert.equal(sourceState.sortOrder, "oldest");
  pass("Full enabled/disabled restarts retain vault-wide age policy without pruning on read; repeated actual same-ID vault switches isolate no-limit/7/90-day choices, saved old callbacks refuse in foreign/disabled owners, pane state stays independent and exact archive/history/settings/original-workspace/BOM/CRLF/Unicode bytes survive");
}
