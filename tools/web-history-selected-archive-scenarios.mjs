import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistorySelectedArchive({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const modal = "app.workspace.getLeavesOfType('webviewer-history').map(leaf=>leaf.view.archivePreview).find(modal=>modal?.isOpen)";
  const pathInput = "[data-web-history-archive-path]", saveButton = '[data-web-history-archive-action="save"]';
  let pane;
  const selector = child => pane + " " + child, control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()"), files = () => host.evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  const saved = new Map();
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "selected archive history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.selectedArchiveSnapshot=" + active + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(active + ".snapshot!==selectedArchiveSnapshot&&!" + active + ".refreshing", "selected archive refreshed"); await ready();
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + active + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  async function select(id, keyboard = false) {
    const input = selector("[data-web-history-select=" + JSON.stringify(id) + "]");
    if (keyboard) { await host.evaluate("document.querySelector(" + JSON.stringify(input) + ").focus()"); await host.press(" ", "Space", 32); } else { await host.click(input); }
    await host.wait(active + ".selected.has(" + JSON.stringify(id) + ")", "selected archive checked " + id);
  }
  async function selectionCount(count) {
    assert.equal(await host.evaluate(active + ".selected.size"), count);
    assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(control("archive-selected")) + ").disabled"), count === 0);
  }
  async function preview(count, selected = true) {
    await host.click(control(selected ? "archive-selected" : "archive")); await host.wait('Boolean(document.querySelector("[data-web-history-archive]"))&&!document.querySelector(' + JSON.stringify(saveButton) + ").disabled", "selected archive preview ready");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive]").dataset.webHistoryArchiveScope'), selected ? "selected" : "shown");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive-status]").textContent'), count + " " + (selected ? "selected" : "shown") + (count === 1 ? " visit" : " visits") + " · Newest first");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive-preview]").getBoundingClientRect().height>250'), true);
    return host.evaluate('document.querySelector("[data-web-history-archive-preview]").value');
  }
  async function close(escape = false) {
    if (escape) { await host.press("Escape", "Escape", 27); } else { await host.click('[data-web-history-archive-action="cancel"]'); }
    await host.wait('!document.querySelector("[data-web-history-archive]")', "selected archive closed");
  }
  async function save(path, markdown) {
    await host.fill(pathInput, path); await host.click(saveButton);
    await host.wait('!document.querySelector("[data-web-history-archive]")&&app.workspace.getActiveFile()?.path===' + JSON.stringify(path), "selected archive saved " + path);
    assert.deepEqual(await readFile(join(await host.evaluate("app.vault.rootPath"), path)), Buffer.from(markdown));
  }
  async function error(pattern) {
    await host.wait("!" + modal + ".busy&&!document.querySelector('[data-web-history-archive-error]').hidden", "selected archive refusal shown");
    assert.match(await host.evaluate('document.querySelector("[data-web-history-archive-error]").textContent'), pattern);
  }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function remember() { await host.evaluate("globalThis.savedSelectedArchive=" + modal + ";globalThis.invokeOldSelectedArchive=()=>savedSelectedArchive.saveNote();undefined"); }
  async function switchVault(path) {
    if (await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))')) { await host.evaluate('document.querySelector("#vault-switcher").click()'); } else { await host.click("#vault-switcher"); }
    await host.wait('document.querySelector("#vault-dialog").open', "selected archive vault dialog"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "selected archive vault switch");
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const day = await host.evaluate("new Date(2026,0,15,12).getTime()");
  const visit = (id, title, visitedAt = day) => ({ id: "selected-archive-" + id, title, visitedAt, url: origin + "/one?selected-archive=same&value=(x)", future: { keep: [id, "中文 😀"] } });
  const entries = [visit("before", "Earlier", day - 86400000), visit("one", "Chosen 中文 Story <img src=x onerror=evil()> ![[Secret]] **literal**"), visit("two", "Unchecked Story"), visit("keep", "Chosen Other 中文 😀")];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } }, original = "\ufeff" + JSON.stringify(data) + "\r\n";
  await writeFile(historyPath, original); await history(); const initialFiles = await files(); await selectionCount(0);
  await dates("2026-01-15", "2026-01-15"); await select(entries[1].id); await select(entries[3].id, true); await selectionCount(2);
  const shown = await preview(3, false); assert.match(shown, /Unchecked Story/); assert.doesNotMatch(shown, /Selection:/); await close();
  const reviewed = await preview(2); assert.match(reviewed, /Selection: 2 checked visits/); assert.doesNotMatch(reviewed, /Unchecked|Earlier|selected-archive-one|selected-archive-keep/); await capture("review");
  await close(); await selectionCount(2); assert.equal(await host.evaluate("document.activeElement===document.querySelector(" + JSON.stringify(control("archive-selected")) + ")"), true);
  await preview(2); await close(true); await selectionCount(2); assert.deepEqual(await files(), initialFiles); assert.equal(await readFile(historyPath, "utf8"), original);
  await preview(2); const firstPath = "History/Selected 中文.md"; await host.evaluate('globalThis.selectedArchiveCreates=[];app.vault.on("create",file=>selectedArchiveCreates.push(file.path));undefined');
  await save(firstPath, reviewed); saved.set(firstPath, reviewed); assert.equal(await host.evaluate("selectedArchiveCreates.filter(path=>path===" + JSON.stringify(firstPath) + ").length"), 1);
  await host.evaluate(active + '.setMode("preview")'); await host.wait(active + '.previewEl.querySelectorAll(\'a[href^="http"]\').length===2', "selected archive Reading links");
  assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("img,script,iframe,.internal-embed,.internal-link").length'), 0);
  const text = await host.evaluate(active + ".previewEl.textContent"); assert.ok(text.includes(entries[1].title)); assert.ok(text.includes(entries[3].title)); assert.equal(text.includes(entries[2].title), false); await capture("saved");
  assert.equal(await readFile(historyPath, "utf8"), original);
  pass("Real pointer/Space selection archives only the exact checked IDs while Save shown keeps its separate filter scope; count/selection/date review, Cancel/Escape focus, one exact UTF-8 creation and actual Reading preserve repeated URLs and literal hostile/Unicode titles without unchecked visits, internal links, embeds or history writes");

  await history(); await selectionCount(2); const collision = await preview(2); await host.fill(pathInput, firstPath); await host.click(saveButton); await error(/exist|conflict/i);
  assert.equal(await readFile(join(directory, firstPath), "utf8"), reviewed); const correctedPath = "History/Selected corrected.md"; await save(correctedPath, collision); saved.set(correctedPath, collision); await history();
  await preview(2); const refusedPath = "History/Selected refused.md"; await host.fill(pathInput, refusedPath);
  const externalBytes = "\ufeff" + JSON.stringify({ ...data, external: { keep: "after selected review" } }, null, 1) + "\r\n"; await writeFile(historyPath, externalBytes);
  await host.click(saveButton); await error(/history changed/i); assert.equal((await files()).includes(refusedPath), false); assert.equal(await readFile(historyPath, "utf8"), externalBytes); await close(); await refresh(); await selectionCount(0);
  await host.click(selector("[data-web-history-id=" + JSON.stringify(entries[2].id) + '] [data-web-history-action="remove"]')); await idle(); await ready();
  const undoId = await host.evaluate(store + ".getUndo(" + active + ".snapshot).id"), removedBytes = await readFile(historyPath);
  await select(entries[1].id); await select(entries[3].id); const undoPreview = await preview(2), undoPath = "History/Selected before Undo.md";
  await save(undoPath, undoPreview); saved.set(undoPath, undoPreview); await history(); assert.equal(await host.evaluate(store + ".getUndo(" + active + ".snapshot).id"), undoId); assert.deepEqual(await readFile(historyPath), removedBytes);
  await host.click(control("undo")); await idle(); await ready(); const redoId = await host.evaluate(store + ".getRedo(" + active + ".snapshot).id"), finalHistory = await readFile(historyPath);
  await select(entries[1].id); await select(entries[3].id); const redoPreview = await preview(2), redoPath = "History/Selected after Undo.md";
  await save(redoPath, redoPreview); saved.set(redoPath, redoPreview); await history(); assert.equal(await host.evaluate(store + ".getRedo(" + active + ".snapshot).id"), redoId); assert.deepEqual(await readFile(historyPath), finalHistory);
  pass("Selected note collisions refuse without overwrite and allow corrected saving; stale source versions refuse before creation with exact external bytes retained, Refresh discards stale selection, and selected archives preserve both eligible Undo and Redo tokens and exact source bytes");

  const firstId = await host.evaluate("app.workspace.activeLeaf.id"); await host.click(control("reset-dates"));
  await select(entries[1].id); await select(entries[3].id);
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"Unchecked",futureSelectedArchive:{keep:["中文",true]}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"); await selectionCount(0); await select(entries[2].id);
  assert.equal(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(firstId) + ").view.selected.size"), 2);
  const secondPreview = await preview(1), secondPath = "History/Selected other pane.md"; assert.match(secondPreview, /Unchecked Story/); assert.doesNotMatch(secondPreview, /Chosen/);
  await save(secondPath, secondPreview); saved.set(secondPath, secondPreview); await reveal(secondId);
  await preview(1); const queuedPath = "History/Selected queued.md"; await host.fill(pathInput, queuedPath); await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseSelectedArchive=resolve);undefined");
  await host.click(saveButton); await host.wait(modal + ".busy", "selected archive waits in history queue");
  await host.evaluate(active + '.setSelected(' + active + ".snapshot," + JSON.stringify(entries[2].id) + ",false);releaseSelectedArchive();undefined"); await idle(); await error(/no longer available/);
  assert.equal((await files()).includes(queuedPath), false); assert.deepEqual(await readFile(historyPath), finalHistory); await capture("expired"); await close(); await selectionCount(0);
  await select(entries[2].id); await preview(1); await host.fill(pathInput, "History/Selected closed.md"); await remember();
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(secondId) + "))"); await reveal(firstId); await host.evaluate("invokeOldSelectedArchive()");
  assert.equal((await files()).includes("History/Selected closed.md"), false);
  pass("Independent panes retain independent checked sets and archive scopes; changing a queued checked visit expires the review before creation, closing an owner destroys its preview and old callbacks create nothing while another pane retains its current selection");

  await query("Chosen"); await select(entries[1].id); await select(entries[3].id); const expectedState = await host.evaluate(active + ".getState()"); await preview(2);
  await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready(); await selectionCount(0); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))'), false);
  await select(entries[1].id); await preview(1); await host.fill(pathInput, "History/Selected disabled.md"); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("invokeOldSelectedArchive()");
  assert.equal((await files()).includes("History/Selected disabled.md"), false); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready(); await selectionCount(0);
  const other = join(directory, ".history-selected-archive-other-vault"), otherConfig = join(other, ".obsidian"), otherHistoryPath = join(otherConfig, "vault-dotnet-web-history.json");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"selected archive target"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nSelected history target 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const otherHistory = "\ufeff" + JSON.stringify({ ...data, entries: [entries[1], entries[3]], future: { keep: "target" } }) + "\r\n"; await writeFile(otherHistoryPath, otherHistory);
  await select(entries[1].id); await preview(1); await host.fill(pathInput, "History/Selected foreign source.md"); await remember(); await switchVault(other); await history(); await selectionCount(0); await host.evaluate("invokeOldSelectedArchive()");
  assert.equal((await files()).includes("History/Selected foreign source.md"), false); assert.equal(await readFile(otherHistoryPath, "utf8"), otherHistory);
  await select(entries[3].id); const targetPreview = await preview(1), targetPath = "History/Selected target.md"; await save(targetPath, targetPreview); await history();
  await preview(1); await host.fill(pathInput, "History/Selected foreign target.md"); await remember(); await switchVault(directory); await ready(); await selectionCount(0); await host.evaluate("invokeOldSelectedArchive()");
  assert.equal((await files()).includes("History/Selected foreign target.md"), false); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await switchVault(other); await ready(); await selectionCount(0); assert.equal(await readFile(join(other, targetPath), "utf8"), targetPreview); assert.equal(await readFile(otherHistoryPath, "utf8"), otherHistory);
  await switchVault(directory); await ready(); await selectionCount(0); await capture("restored");
  for (const [path, markdown] of saved) { assert.equal(await readFile(join(directory, path), "utf8"), markdown); }
  assert.deepEqual(await readFile(historyPath), finalHistory); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts and repeated actual same-ID vault switches discard selected sets/previews while retaining filters/opaque state and exact saved notes; disabled/foreign callbacks create nothing, a fresh target selection stays in its own vault and both source histories/settings/notes/original workspace/BOM/CRLF/Unicode survive");
}
