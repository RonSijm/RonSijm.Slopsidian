import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryOrder({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const modal = "app.workspace.getLeavesOfType('webviewer-history').map(leaf=>leaf.view.archivePreview).find(modal=>modal?.isOpen)";
  const saveButton = '[data-web-history-archive-action="save"]', pathInput = "[data-web-history-archive-path]";
  let pane;
  const selector = child => pane + " " + child, control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()"), files = () => host.evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  const ids = () => host.evaluate("[..." + active + '.list.querySelectorAll("[data-web-history-id]")].map(row=>row.dataset.webHistoryId)');
  const saved = new Map();
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "ordered history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function order(value) {
    if (await host.evaluate("document.querySelector(" + JSON.stringify(selector("[data-web-history-order]")) + ").value") === value) { return; }
    await host.click(selector("[data-web-history-order]")); await host.press("Home", "Home", 36);
    if (value === "oldest") { await host.press("ArrowDown", "ArrowDown", 40); }
    await host.press("Enter", "Enter", 13); await host.wait(active + ".sortOrder===" + JSON.stringify(value), "real order choice " + value);
  }
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + active + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  async function select(id) {
    await host.click(selector("[data-web-history-select=" + JSON.stringify(id) + "]"));
    await host.wait(active + ".selected.has(" + JSON.stringify(id) + ")", "ordered visit selected");
  }
  async function preview(count, selected = false) {
    const expectedOrder = await host.evaluate(active + ".sortOrder");
    await host.click(control(selected ? "archive-selected" : "archive"));
    await host.wait('Boolean(document.querySelector("[data-web-history-archive]"))&&!document.querySelector(' + JSON.stringify(saveButton) + ").disabled", "ordered archive ready");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive]").dataset.webHistoryArchiveOrder'), expectedOrder);
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive-status]").textContent'), count + " " + (selected ? "selected" : "shown") + (count === 1 ? " visit" : " visits") + " · " + (expectedOrder === "oldest" ? "Oldest first" : "Newest first"));
    return host.evaluate('document.querySelector("[data-web-history-archive-preview]").value');
  }
  async function close() { await host.click('[data-web-history-archive-action="cancel"]'); await host.wait('!document.querySelector("[data-web-history-archive]")', "ordered archive closed"); }
  async function save(path, markdown) {
    await host.fill(pathInput, path); await host.click(saveButton);
    await host.wait('!document.querySelector("[data-web-history-archive]")&&app.workspace.getActiveFile()?.path===' + JSON.stringify(path), "ordered archive saved");
    assert.deepEqual(await readFile(join(await host.evaluate("app.vault.rootPath"), path)), Buffer.from(markdown));
  }
  async function remove(id) { await host.click(selector("[data-web-history-id=" + JSON.stringify(id) + '] [data-web-history-action="remove"]')); await idle(); await ready(); }
  async function undo() { await host.click(control("undo")); await idle(); await ready(); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function switchVault(path) {
    if (await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))')) { await host.evaluate('document.querySelector("#vault-switcher").click()'); } else { await host.click("#vault-switcher"); }
    await host.wait('document.querySelector("#vault-dialog").open', "order vault dialog"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "order vault switch");
  }
  async function remember() { await host.evaluate("globalThis.savedOrderArchive=" + modal + ";globalThis.invokeOldOrderArchive=()=>savedOrderArchive.saveNote();undefined"); }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const day = await host.evaluate("new Date(2026,0,15,12).getTime()");
  const visit = (id, title, visitedAt) => ({ id: "order-" + id, title, visitedAt, url: origin + "/one?order=same", future: { keep: [id, "中文 😀"] } });
  const entries = [visit("late", "Late 中文 Story <img src=x onerror=evil()> ![[Secret]]", day + 3600000), visit("tie-a", "Tie A 中文 Story", day),
    visit("early", "Earlier", day - 86400000), visit("tie-b", "Tie B 中文 Story", day)];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } }, original = "\ufeff" + JSON.stringify(data) + "\r\n";
  const oldest = [entries[2].id, entries[1].id, entries[3].id, entries[0].id], newest = [...oldest].reverse();
  await writeFile(historyPath, original); await history(); assert.deepEqual(await ids(), newest); assert.equal("sortOrder" in await host.evaluate(active + ".getState()"), false);
  await order("oldest"); assert.deepEqual(await ids(), oldest); await query("Story 中文"); await dates("2026-01-15", "2026-01-15");
  assert.deepEqual(await ids(), oldest.slice(1)); await capture("oldest");
  await select(entries[1].id); await order("newest"); assert.equal(await host.evaluate(active + ".selected.size"), 0); assert.deepEqual(await ids(), newest.slice(0, 3));
  await host.click(control("remove-matching")); await host.wait("Boolean(" + active + ".review)", "ordered removal reviewed"); await order("oldest"); assert.equal(await host.evaluate(active + ".review"), null);
  const expectedState = await host.evaluate(active + ".getState()");
  for (const sortOrder of [null, false, 7, "title", "OLDEST"]) {
    assert.equal(await host.evaluate("(async()=>{try{await " + active + ".setState(" + JSON.stringify({ ...expectedState, query: "wrong", sortOrder }) + ",{});return false}catch{return true}})()"), true);
    assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  }
  assert.equal(await readFile(historyPath, "utf8"), original);
  pass("Real pointer/keyboard Newest first/Oldest first controls sort actual timestamps with deterministic ties in an unsorted imported history, retain search/date scope and source bytes, clear checked visits/removal reviews and atomically refuse invalid imported sort state while older layouts keep the newest default");

  await query(""); await host.click(control("reset-dates")); const shown = await preview(4); assert.match(shown, /Order: Oldest first/); assert.ok(shown.indexOf("Earlier") < shown.indexOf("Late"));
  await capture("archive"); const shownPath = "History/Chronological shown.md"; await save(shownPath, shown); saved.set(shownPath, shown);
  await host.evaluate(active + '.setMode("preview")'); await host.wait(active + '.previewEl.querySelectorAll(\'a[href^="http"]\').length===4', "ordered Reading links");
  assert.deepEqual(await host.evaluate("Array.from(" + active + '.previewEl.querySelectorAll(\'a[href^="http"]\'),link=>link.textContent)'), [entries[2].title, entries[1].title, entries[3].title, entries[0].title]);
  assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("img,script,iframe,.internal-embed,.internal-link").length'), 0); assert.equal(await readFile(historyPath, "utf8"), original);
  await history(); await select(entries[0].id); await select(entries[1].id); const selected = await preview(2, true); assert.match(selected, /Order: Oldest first/); assert.ok(selected.indexOf("Tie A") < selected.indexOf("Late"));
  const selectedPath = "History/Chronological selected.md"; await save(selectedPath, selected); saved.set(selectedPath, selected); await history();
  await order("newest"); const descending = await preview(4); assert.doesNotMatch(descending, /Order: Oldest first/); assert.ok(descending.indexOf("Late") < descending.indexOf("Earlier")); await close();
  await remove(entries[2].id); const undoId = await host.evaluate(store + ".getUndo(" + active + ".snapshot).id"), removedBytes = await readFile(historyPath);
  await order("oldest"); await order("newest"); assert.equal(await host.evaluate(store + ".getUndo(" + active + ".snapshot).id"), undoId); assert.deepEqual(await readFile(historyPath), removedBytes); await undo();
  const redoId = await host.evaluate(store + ".getRedo(" + active + ".snapshot).id"); await order("oldest"); assert.equal(await host.evaluate(store + ".getRedo(" + active + ".snapshot).id"), redoId);
  await host.click(control("redo")); await host.click(control("confirm-clear")); await idle(); await ready(); await undo();
  const finalHistory = await readFile(historyPath); assert.deepEqual(JSON.parse(finalHistory.toString("utf8").replace(/^\ufeff/, "")), data);
  pass("Shown and exact-selected archives use the displayed chronology in review and exact saved Markdown/actual Reading, preserve literal hostile titles and unchanged source bytes; newest output retains its prior format, while sorting keeps eligible Undo/Redo and inverse writes preserve the original physical history order and opaque data");

  const firstId = await host.evaluate("app.workspace.activeLeaf.id");
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"Story",futureHistoryOrder:{keep:["中文",true]}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"); assert.deepEqual(await ids(), newest.slice(0, 3));
  assert.equal(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(firstId) + ").view.getState().sortOrder"), "oldest");
  await host.click(control("remove-matching")); await order("oldest"); assert.equal(await host.evaluate(active + ".review"), null);
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseOrderQueue=resolve);undefined"); await host.click(selector("[data-web-history-id=" + JSON.stringify(entries[1].id) + '] [data-web-history-action="remove"]'));
  await host.wait(active + ".busy", "row removal waits for queue"); await host.evaluate(active + '.changeOrder("newest");releaseOrderQueue();undefined'); await idle(); await ready();
  assert.match(await host.evaluate(active + ".error.textContent"), /no longer active/); assert.deepEqual(await readFile(historyPath), finalHistory);
  await remove(entries[3].id); const queuedBytes = await readFile(historyPath), queuedUndoId = await host.evaluate(store + ".getUndo(" + active + ".snapshot).id");
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseOrderQueue=resolve);undefined"); await host.click(control("undo")); await host.wait(active + ".busy", "undo waits for order queue");
  await host.evaluate(active + '.changeOrder("oldest");' + active + '.changeOrder("newest");releaseOrderQueue();undefined'); await idle(); await ready();
  assert.match(await host.evaluate(active + ".error.textContent"), /no longer available/); assert.deepEqual(await readFile(historyPath), queuedBytes);
  assert.equal(await host.evaluate(store + ".getUndo(" + active + ".snapshot).id"), queuedUndoId); await undo();
  await preview(3); const expiredPath = "History/Chronological expired.md"; await host.fill(pathInput, expiredPath); await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseOrderQueue=resolve);undefined");
  await host.click(saveButton); await host.wait(modal + ".busy", "archive waits for order queue"); await host.evaluate(active + '.changeOrder("oldest");releaseOrderQueue();undefined'); await idle();
  await host.wait("!" + modal + ".busy&&!document.querySelector('[data-web-history-archive-error]').hidden", "obsolete order archive refused");
  assert.equal((await files()).includes(expiredPath), false); assert.deepEqual(await readFile(historyPath), finalHistory); await capture("expired"); await close();
  const retry = await preview(3), retryPath = "History/Chronological retry.md"; await save(retryPath, retry); saved.set(retryPath, retry); await reveal(firstId);
  await preview(4); await host.fill(pathInput, "History/Chronological closed.md"); await remember(); await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(firstId) + "))"); await reveal(secondId);
  await host.evaluate("invokeOldOrderArchive()"); assert.equal((await files()).includes("History/Chronological closed.md"), false);
  pass("Separate panes retain independent order/filter state; sort changes cancel inline reviews, queued row removal and an Undo oldest/newest round trip refuse before writing or consuming eligibility, and a queued archive expires without creation while a fresh ordered save succeeds and a closed owner cannot write");

  const restoredState = await host.evaluate(active + ".getState()"); await select(entries[1].id); await preview(1, true); await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready();
  assert.deepEqual(await host.evaluate(active + ".getState()"), restoredState); assert.deepEqual(await ids(), oldest.slice(1)); assert.equal(await host.evaluate(active + ".selected.size"), 0);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))'), false);
  await select(entries[1].id); await preview(1, true); await host.fill(pathInput, "History/Chronological disabled.md"); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("invokeOldOrderArchive()");
  assert.equal((await files()).includes("History/Chronological disabled.md"), false); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready(); assert.deepEqual(await host.evaluate(active + ".getState()"), restoredState);
  const other = join(directory, ".history-order-other-vault"), otherConfig = join(other, ".obsidian"), otherHistoryPath = join(otherConfig, "vault-dotnet-web-history.json");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"order target"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nChronological history target 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const targetEntries = [{ ...entries[1], title: "Target later", visitedAt: day + 86400000 }, { ...entries[0], title: "Target earlier", visitedAt: day - 3 * 86400000 }];
  const otherHistory = "\ufeff" + JSON.stringify({ ...data, entries: targetEntries, future: { keep: "target" } }) + "\r\n"; await writeFile(otherHistoryPath, otherHistory);
  await preview(3); await host.fill(pathInput, "History/Chronological foreign.md"); await remember(); await switchVault(other); await history(); await host.evaluate("invokeOldOrderArchive()");
  assert.equal((await files()).includes("History/Chronological foreign.md"), false); assert.equal("sortOrder" in await host.evaluate(active + ".getState()"), false); assert.deepEqual(await ids(), targetEntries.map(entry => entry.id));
  await order("oldest"); await query("Target"); assert.deepEqual(await ids(), [...targetEntries].reverse().map(entry => entry.id));
  await preview(2); await host.fill(pathInput, "History/Chronological foreign target.md"); await remember(); await switchVault(directory); await ready(); await host.evaluate("invokeOldOrderArchive()");
  assert.equal((await files()).includes("History/Chronological foreign target.md"), false); assert.deepEqual(await host.evaluate(active + ".getState()"), restoredState); assert.deepEqual(await ids(), oldest.slice(1));
  await switchVault(other); await ready(); assert.equal(await host.evaluate(active + ".getState().sortOrder"), "oldest");
  const targetPreview = await preview(2), targetPath = "History/Chronological target.md"; assert.ok(targetPreview.indexOf("Target earlier") < targetPreview.indexOf("Target later")); await save(targetPath, targetPreview); await history();
  assert.equal(await readFile(otherHistoryPath, "utf8"), otherHistory); await switchVault(directory); await ready(); await capture("restored");
  for (const [path, markdown] of saved) { assert.equal(await readFile(join(directory, path), "utf8"), markdown); }
  assert.deepEqual(await readFile(historyPath), finalHistory); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts and repeated actual same-ID vault switches retain pane-local chronology/filter/opaque state and exact saved notes while discarding checked sets/previews; a fresh target pane defaults newest and retains its own oldest choice without source-state leakage, obsolete owners cannot create notes, and history/settings/notes/original workspace/BOM/CRLF/Unicode survive");
}
