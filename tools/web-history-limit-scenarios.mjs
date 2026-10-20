import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryLimit({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const modal = "app.workspace.getLeavesOfType('webviewer-history').map(leaf=>leaf.view.limitPreview).find(value=>value?.isOpen)";
  const input = "[data-web-history-limit-input]", save = '[data-web-history-limit-action="save"]';
  let pane;
  const selector = child => pane + " " + child, control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()");
  const read = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "visit-limit history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() { await host.click(control("refresh")); await idle(); await ready(); }
  async function open() { await host.click(control("visit-limit")); await host.wait("Boolean(" + modal + ")", "visit-limit review open"); }
  async function close() { await host.click('[data-web-history-limit-action="cancel"]'); await host.wait('!document.querySelector("[data-web-history-limit]")', "visit-limit review closed"); }
  async function choose(value, enter = false) {
    await open(); await host.fill(input, String(value));
    if (enter) { await host.press("Enter", "Enter", 13); } else { await host.click(save); }
    await host.wait('!document.querySelector("[data-web-history-limit]")', "count policy saved"); await idle(); await ready();
    assert.equal(await host.evaluate(active + ".snapshot.history.visitLimit"), value);
  }
  async function recording(value) { if (await host.evaluate(active + ".recording.checked") !== value) { await host.click(selector("[data-web-history-recording]")); await idle(); await ready(); } }
  async function nativeVisit(url) {
    await host.evaluate('app.core.getEnabledPluginById("webviewer").openUrl(' + JSON.stringify(url) + ",true)");
    await host.wait(active + '.getViewType()==="webviewer"&&' + active + ".getState().url===" + JSON.stringify(url) + "&&!" + active + ".loading", "committed count-limit visit"); await idle();
  }
  async function closeWebPages() { await host.evaluate('(async()=>{for(const leaf of app.workspace.getLeavesOfType("webviewer"))await app.workspace.closeLeaf(leaf)})()'); await history(); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function remember() {
    await host.evaluate("globalThis.oldLimitReview=" + modal + ";globalThis.invokeOldLimit=async value=>{try{await oldLimitReview.actions.save(value);return false}catch{return true}};undefined");
  }
  async function switchVault(path) {
    await host.evaluate('document.querySelector("#vault-switcher").click()'); await host.wait('document.querySelector("#vault-dialog").open', "count-limit vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "count-limit vault switch");
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const now = await host.evaluate("Date.now()"), DAY = 86400000;
  const visit = (id, age) => ({ id: "limit-" + id, title: "Story 中文 " + id + " <img src=x onerror=evil()> ![[Secret]]",
    visitedAt: now - age * DAY, url: origin + "/one?limit=same", future: { keep: [id, "中文 😀"] } });
  const data = { version: 1, recording: false, retentionDays: 7, entries: [visit("future", -1), visit("ancient", 100), visit("older", 8), visit("recent", 2)], future: { keep: ["中文", true] } };
  const original = "\ufeff" + JSON.stringify(data, null, 2) + "\r\n";
  await writeFile(historyPath, original); await history(); const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate(active + '.setState({query:"recent",sortOrder:"oldest",futureLimit:{keep:["中文",true]}},{})');
  await open(); assert.match(await host.evaluate('document.querySelector("[data-web-history-limit-status]").textContent'), /4 saved visits.*1000/);
  await host.fill(input, "2"); await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-history-limit]")', "count Escape cancels");
  assert.equal(await host.evaluate("document.activeElement===document.querySelector(" + JSON.stringify(control("visit-limit")) + ")"), true);
  assert.equal(await readFile(historyPath, "utf8"), original);
  await open();
  for (const invalid of ["", "0", "1001", "1.5"]) {
    await host.fill(input, invalid); assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(save) + ").disabled"), true);
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-limit-error]").hidden'), false); assert.equal(await readFile(historyPath, "utf8"), original);
  }
  await host.fill(input, "13"); await capture("review"); await close();
  for (const limit of [1, 1000, 13, 2]) {
    await choose(limit, limit === 13); const saved = await read();
    assert.equal(saved.visitLimit ?? 1000, limit); assert.deepEqual(saved.entries, data.entries); assert.equal(saved.retentionDays, 7);
    assert.equal(saved.recording, false); assert.deepEqual(saved.future, data.future); assert.equal((await readFile(historyPath))[0], 0xef);
  }
  assert.equal("visitLimit" in await host.evaluate(active + ".getState()"), false);
  pass("Actual Visit limit review uses all saved visits despite active filters, supports Save/Cancel/Escape/Enter with restored focus, rejects empty/out-of-range/fractional drafts without writes and saves whole limits 1/2/13/1000 without pruning; source order/opaque data/age policy/recording/BOM and leaf state remain intact");

  const paused = await readFile(historyPath); await nativeVisit(origin + "/one?limit=paused"); await closeWebPages(); assert.deepEqual(await readFile(historyPath), paused);
  await host.fill(selector("[data-web-history-search]"), ""); await recording(true); const recordedUrl = origin + "/one?limit=new";
  await nativeVisit(recordedUrl); await until(async () => (await read()).entries.some(entry => entry.url === recordedUrl), "native count policy applied");
  const trimmed = await read(); assert.equal(trimmed.entries.length, 2); assert.deepEqual(trimmed.entries[0], data.entries[3]); assert.equal(trimmed.entries[1].url, recordedUrl);
  assert.equal(trimmed.visitLimit, 2); assert.equal(trimmed.retentionDays, 7); assert.deepEqual(trimmed.future, data.future);
  const afterVisit = await readFile(historyPath); await nativeVisit(recordedUrl); await closeWebPages(); assert.deepEqual(await readFile(historyPath), afterVisit); await recording(false);
  await host.click(selector('[data-web-history-id="limit-recent"] [data-web-history-action="remove"]')); await idle(); await ready();
  await host.click(control("undo")); await idle(); await ready(); assert.deepEqual((await read()).entries, trimmed.entries);
  await host.click(control("redo")); await host.click(control("confirm-clear")); await idle(); await ready(); await host.click(control("undo")); await idle(); await ready();
  assert.deepEqual((await read()).entries, trimmed.entries); await capture("trimmed");
  const archiveBytes = await readFile(historyPath), markdown = await host.evaluate(active + '.snapshot.history.archive("",{},"oldest").markdown');
  await host.click(control("archive")); await host.wait('Boolean(document.querySelector("[data-web-history-archive]"))', "limited archive review");
  await host.fill("[data-web-history-archive-path]", "History/Limited visits.md"); await host.click('[data-web-history-archive-action="save"]');
  await host.wait('app.workspace.getActiveFile()?.path==="History/Limited visits.md"&&!document.querySelector("[data-web-history-archive]")', "limited archive saved");
  assert.equal(await readFile(join(directory, "History/Limited visits.md"), "utf8"), markdown);
  await host.evaluate(active + '.setMode("preview")'); await host.wait(active + ".previewEl.querySelectorAll('a[href^=\"http\"]').length===2", "limited archive Reading");
  assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("img,script,iframe,.internal-embed,.internal-link").length'), 0);
  await history(); assert.deepEqual(await readFile(historyPath), archiveBytes);
  pass("Actual committed native recording applies the saved count limit after age pruning in stored arrival order, while paused/duplicate visits preserve exact bytes; retained entries/policies/opaque data survive Undo/Redo and exact chronological archive saving/actual Reading without further trimming");

  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"Story",futureLimit:{keep:"second pane"}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"); await choose(13); await reveal(firstId);
  await host.wait(active + ".snapshot.history.visitLimit===13", "count policy reaches another filtered pane");
  await open(); await host.fill(input, "5");
  const external = { ...(await read()), visitLimit: 7, external: { keep: ["newer", true] } }, externalBytes = "\ufeff" + JSON.stringify(external, null, 1) + "\r\n";
  await writeFile(historyPath, externalBytes); await host.click(save); await idle(); await ready();
  await host.wait(modal + ".busy===false&&!document.querySelector('[data-web-history-limit-error]').hidden", "stale count review refused");
  assert.equal(await readFile(historyPath, "utf8"), externalBytes); assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(save) + ").disabled"), true);
  await capture("expired"); await close();
  await open(); await host.fill(input, "3"); await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseLimitQueue=resolve);undefined");
  await host.click(save); await host.wait(modal + ".busy", "limit write queued");
  await host.evaluate(active + '.changeOrder("newest");' + active + '.changeOrder("oldest");releaseLimitQueue();undefined'); await idle(); await ready();
  await host.wait(modal + ".busy===false", "queued count owner refused"); assert.equal(await readFile(historyPath, "utf8"), externalBytes); await close();
  const invalidBytes = "\ufeff" + JSON.stringify({ ...external, visitLimit: "2" }) + "\r\n"; await writeFile(historyPath, invalidBytes);
  await host.click(control("refresh")); await idle(); await host.wait("!" + active + ".snapshot&&" + active + ".limitButton.disabled", "invalid stored count retained");
  assert.equal(await readFile(historyPath, "utf8"), invalidBytes); await writeFile(historyPath, externalBytes); await refresh();
  await open(); await remember(); await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(firstId) + "))"); await reveal(secondId);
  assert.equal(await host.evaluate("invokeOldLimit(1)"), true); assert.equal(await readFile(historyPath, "utf8"), externalBytes);
  pass("Independent filtered panes share the vault count policy; external version conflicts keep exact newer bytes and expire the review, queued order round trips and closed owners refuse before writes, and invalid stored policies disable controls without reset while valid data recovers");

  const restoredState = await host.evaluate(active + ".getState()"), sourceFinal = await readFile(historyPath);
  await open(); await host.fill(input, "2"); await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready();
  assert.equal(await host.evaluate(active + ".snapshot.history.visitLimit"), 7); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-limit]"))'), false);
  assert.deepEqual(await host.evaluate(active + ".getState()"), restoredState); assert.deepEqual(await readFile(historyPath), sourceFinal);
  await open(); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)'); assert.equal(await host.evaluate("invokeOldLimit(1)"), true);
  await host.evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); assert.deepEqual(await readFile(historyPath), sourceFinal);
  await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready();
  const other = join(directory, ".history-limit-other-vault"), otherConfig = join(other, ".obsidian"), otherHistoryPath = join(otherConfig, "vault-dotnet-web-history.json");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"count target"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nCount target 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherData = { ...data, entries: [data.entries[3]], future: { keep: "count target" } }, otherHistory = "\ufeff" + JSON.stringify(otherData) + "\r\n";
  await writeFile(otherHistoryPath, otherHistory); await open(); await remember(); await switchVault(other); await history();
  assert.equal(await host.evaluate(active + ".snapshot.history.visitLimit"), 1000); assert.equal(await host.evaluate("invokeOldLimit(1)"), true);
  assert.equal(await readFile(otherHistoryPath, "utf8"), otherHistory); await choose(1); const targetFinal = await readFile(otherHistoryPath);
  await open(); await remember(); await switchVault(directory); await ready(); assert.equal(await host.evaluate("invokeOldLimit(3)"), true);
  assert.equal(await host.evaluate(active + ".snapshot.history.visitLimit"), 7); assert.deepEqual(await host.evaluate(active + ".getState()"), restoredState); assert.deepEqual(await readFile(historyPath), sourceFinal);
  await switchVault(other); await ready(); assert.equal(await host.evaluate(active + ".snapshot.history.visitLimit"), 1); assert.deepEqual(await readFile(otherHistoryPath), targetFinal);
  await switchVault(directory); await ready(); await capture("restored");
  assert.deepEqual(await readFile(historyPath), sourceFinal); assert.equal(await readFile(join(directory, "History/Limited visits.md"), "utf8"), markdown);
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), ""); assert.ok(requests.every(request => request.token === null));
  pass("Full enabled/disabled restarts discard count drafts/reviews while retaining saved policy without trimming on read; repeated actual same-ID vault switches isolate default/1/7 limits and refuse old callbacks, preserving exact archived notes/history/settings/original-workspace/BOM/CRLF/Unicode bytes");
}
