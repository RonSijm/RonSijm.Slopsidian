import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryArchive({ host, origin, restart, until, requests, directory, pass, capture }) {
  const active = "app.workspace.activeLeaf.view", store = 'app.core.getEnabledPluginById("webviewer").history';
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const pathInput = "[data-web-history-archive-path]", previewInput = "[data-web-history-archive-preview]", saveButton = '[data-web-history-archive-action="save"]';
  const modal = "app.workspace.getLeavesOfType('webviewer-history').map(leaf=>leaf.view.archivePreview).find(modal=>modal?.isOpen)";
  let pane;
  const selector = child => pane + " " + child;
  const control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()");
  const files = () => host.evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  const saved = new Map();
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "archive history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.archiveSnapshot=" + active + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(active + ".snapshot!==archiveSnapshot&&!" + active + ".refreshing", "fresh archive snapshot"); await ready();
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + active + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  async function preview(count) {
    await host.click(control("archive")); await host.wait('Boolean(document.querySelector("[data-web-history-archive]"))&&!document.querySelector(' + JSON.stringify(saveButton) + ").disabled", "archive preview ready");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive-status]").textContent'), count + (count === 1 ? " shown visit" : " shown visits") + " · Newest first");
    assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(previewInput) + ").readOnly"), true);
    assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(previewInput) + ").getBoundingClientRect().height>250&&document.querySelector(" + JSON.stringify(previewInput) + ").getBoundingClientRect().width>500"), true, "Archive Markdown preview is large enough to review");
    return host.evaluate("document.querySelector(" + JSON.stringify(previewInput) + ").value");
  }
  async function close(escape = false) {
    if (escape) { await host.press("Escape", "Escape", 27); } else { await host.click('[data-web-history-archive-action="cancel"]'); }
    await host.wait('!document.querySelector("[data-web-history-archive]")', "archive preview closed");
  }
  async function save(path, markdown) {
    await host.fill(pathInput, path); await host.click(saveButton);
    await host.wait('!document.querySelector("[data-web-history-archive]")&&app.workspace.getActiveFile()?.path===' + JSON.stringify(path), "archive note saved " + path);
    assert.deepEqual(await readFile(join(await host.evaluate("app.vault.rootPath"), path)), Buffer.from(markdown));
  }
  async function error(pattern) {
    await host.wait("!" + modal + ".busy&&!document.querySelector('[data-web-history-archive-error]').hidden", "archive refusal shown");
    assert.match(await host.evaluate('document.querySelector("[data-web-history-archive-error]").textContent'), pattern);
  }
  async function remove(id) {
    await host.click(selector("[data-web-history-id=" + JSON.stringify(id) + '] [data-web-history-action="remove"]')); await idle(); await ready();
  }
  async function undo() { await host.click(control("undo")); await idle(); await ready(); }
  async function reveal(id) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function remember() { await host.evaluate("globalThis.savedArchive=" + modal + ";globalThis.invokeOldArchive=()=>savedArchive.saveNote();undefined"); }
  async function switchVault(path) {
    // An open application modal blocks pointer access to the switcher. This
    // bounded lifecycle fixture opens its existing dialog; path/confirm are real.
    if (await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))')) { await host.evaluate('document.querySelector("#vault-switcher").click()'); }
    else { await host.click("#vault-switcher"); }
    await host.wait('document.querySelector("#vault-dialog").open', "archive vault dialog"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "archive vault switch");
  }
  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const day = await host.evaluate("new Date(2026,0,15,12).getTime()");
  const visit = (id, title, visitedAt = day) => ({ id: "archive-" + id, title, visitedAt, url: origin + "/one?archive=same&value=(x)", future: { keep: [id, "中文 😀"] } });
  const entries = [visit("before", "Earlier", day - 86400000), visit("one", "中文 Story <img src=x onerror=evil()> ![[Secret]] **literal**"), visit("two", "中文 Story"), visit("keep", "Other 中文 😀")];
  const data = { version: 1, recording: false, entries, future: { keep: [1, true, "中文 😀"] } }, initialHistory = "\ufeff" + JSON.stringify(data) + "\r\n";
  await writeFile(historyPath, initialHistory); await history(); const initialFiles = await files();
  await query("story 中文"); await dates("2026-01-15", "2026-01-15"); const reviewed = await preview(2); await capture("preview");
  assert.equal(reviewed.split("](<http").length - 1, 2); assert.doesNotMatch(reviewed, /Earlier|Other/); assert.match(reviewed, /2026-01-15/);
  assert.equal(await host.evaluate('(()=>{const bounds=document.querySelector(".web-history-archive-modal").getBoundingClientRect();return[...document.querySelectorAll("[data-web-history-archive-action]")].every(button=>{const rect=button.getBoundingClientRect();return rect.top>=bounds.top&&rect.bottom<=bounds.bottom&&rect.bottom<=innerHeight})})()'), true);
  await close(); await preview(2); await close(true); assert.deepEqual(await files(), initialFiles); assert.equal(await readFile(historyPath, "utf8"), initialHistory);
  await preview(2); const firstPath = "History/Reviewed 中文.md";
  await host.evaluate('globalThis.archiveCreates=[];app.vault.on("create",file=>archiveCreates.push(file.path));undefined'); await save(firstPath, reviewed); saved.set(firstPath, reviewed);
  assert.equal(await host.evaluate("archiveCreates.filter(path=>path===" + JSON.stringify(firstPath) + ").length"), 1);
  await host.evaluate(active + '.setMode("preview")'); await host.wait(active + '.previewEl.querySelectorAll(\'a[href^="http"]\').length===2', "actual archived links render");
  assert.deepEqual(await host.evaluate(active + '.previewEl.querySelectorAll(\'a[href^="http"]\').values().map(link=>link.href).toArray()'), [entries[2].url, entries[1].url]);
  assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("img,script,iframe,.internal-embed,.internal-link").length'), 0);
  assert.ok((await host.evaluate(active + ".previewEl.textContent")).includes(entries[1].title)); await capture("saved");
  assert.equal(await readFile(historyPath, "utf8"), initialHistory);
  pass("Real Save shown visits previews exact search/local-date scope, repeated addresses and literal Unicode/Markdown/HTML titles; Cancel/Escape create nothing, Save creates one exact UTF-8 note and missing folders, actual Reading shows two safe links without embeds/active markup, and history remains byte-identical");

  await history(); await query(""); await host.click(control("reset-dates")); const all = await preview(4);
  await host.fill(pathInput, "../Welcome.md"); await host.click(saveButton); await error(/relative path/); assert.deepEqual(await files(), [...initialFiles, firstPath].sort());
  await host.fill(pathInput, firstPath); await host.click(saveButton); await error(/exist|conflict/i); assert.equal(await readFile(join(directory, firstPath), "utf8"), reviewed);
  const correctedPath = "History/Corrected.md"; await save(correctedPath, all); saved.set(correctedPath, all); await history();
  const stale = await preview(4), refusedPath = "History/Refused.md"; await host.fill(pathInput, refusedPath);
  const externalBytes = "\ufeff" + JSON.stringify({ ...data, external: { keep: "edited after archive preview" } }, null, 1) + "\r\n";
  await writeFile(historyPath, externalBytes); await host.click(saveButton); await error(/history changed/i); assert.equal((await files()).includes(refusedPath), false);
  assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(previewInput) + ").value"), stale); assert.equal(await readFile(historyPath, "utf8"), externalBytes); await close(); await refresh();
  await remove("archive-one"); const undoId = await host.evaluate(store + ".getUndo(" + active + ".snapshot).id"), afterRemoval = await readFile(historyPath);
  const removedPreview = await preview(3), removedPath = "History/After removal.md"; await save(removedPath, removedPreview); saved.set(removedPath, removedPreview); await history();
  assert.equal(await host.evaluate(store + ".getUndo(" + active + ".snapshot).id"), undoId); assert.deepEqual(await readFile(historyPath), afterRemoval); await undo();
  const redoId = await host.evaluate(store + ".getRedo(" + active + ".snapshot).id"), afterUndo = await readFile(historyPath);
  const restoredPreview = await preview(4), restoredPath = "History/After Undo.md"; await save(restoredPath, restoredPreview); saved.set(restoredPath, restoredPreview); await history();
  assert.equal(await host.evaluate(store + ".getRedo(" + active + ".snapshot).id"), redoId); assert.deepEqual(await readFile(historyPath), afterUndo);
  pass("Invalid destinations and existing-note collisions refuse without overwrite and allow correction; an externally changed source refuses before note creation with exact external bytes retained, while successful archives leave source bytes and both eligible Undo and Redo tokens unchanged");

  const firstId = await host.evaluate("app.workspace.activeLeaf.id"), finalHistory = await readFile(historyPath);
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"Other",futureHistoryArchive:{keep:["中文",true]}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"), secondPreview = await preview(1), secondPath = "History/Other pane.md";
  assert.match(secondPreview, /Other 中文/); assert.doesNotMatch(secondPreview, /Story/); await save(secondPath, secondPreview); saved.set(secondPath, secondPreview); await reveal(secondId);
  await preview(1); const queuedPath = "History/Queued.md"; await host.fill(pathInput, queuedPath);
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseArchiveQueue=resolve);undefined"); await host.click(saveButton); await host.wait(modal + ".busy", "archive waits for history queue");
  await host.evaluate(active + '.search.value="Story";' + active + '.search.dispatchEvent(new Event("input",{bubbles:true}));releaseArchiveQueue();undefined');
  await idle(); await error(/no longer available/i); assert.equal((await files()).includes(queuedPath), false); assert.deepEqual(await readFile(historyPath), finalHistory); await capture("expired"); await close();
  await query("Other"); await preview(1); await host.fill(pathInput, "History/Closed owner.md"); await remember();
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(secondId) + "))"); await reveal(firstId); await host.evaluate("invokeOldArchive()");
  assert.equal((await files()).includes("History/Closed owner.md"), false); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))'), false);
  pass("Independent panes archive their own filters; a bounded queued owner-input fixture expires the reviewed save before creation without changing history, and closing an owner destroys its modal and prevents saved callbacks from creating a note");

  await query("Story"); const expectedState = await host.evaluate(active + ".getState()"); await preview(2); await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready();
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))'), false); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await preview(2); await host.fill(pathInput, "History/Disabled.md"); await remember(); await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("invokeOldArchive()");
  assert.equal((await files()).includes("History/Disabled.md"), false); await host.evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready();
  const other = join(directory, ".history-archive-other-vault"), otherConfig = join(other, ".obsidian"), otherPath = join(otherConfig, "vault-dotnet-web-history.json");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"other archive"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nHistory archive target 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  const targetHistory = "\ufeff" + JSON.stringify({ ...data, entries: [entries[1], entries[3]], future: { keep: "target" } }) + "\r\n"; await writeFile(otherPath, targetHistory);
  await preview(2); await host.fill(pathInput, "History/Foreign source.md"); await remember(); await switchVault(other); await history(); await host.evaluate("invokeOldArchive()");
  assert.equal((await files()).includes("History/Foreign source.md"), false); assert.equal(await readFile(otherPath, "utf8"), targetHistory);
  const targetPreview = await preview(2), targetNotePath = "History/Target.md"; await save(targetNotePath, targetPreview); await history();
  await preview(2); await host.fill(pathInput, "History/Foreign target.md"); await remember(); await switchVault(directory); await ready(); await host.evaluate("invokeOldArchive()");
  assert.equal((await files()).includes("History/Foreign target.md"), false); assert.deepEqual(await readFile(historyPath), finalHistory); assert.deepEqual(await host.evaluate(active + ".getState()"), expectedState);
  await switchVault(other); await ready(); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-archive]"))'), false);
  assert.equal(await readFile(join(other, targetNotePath), "utf8"), targetPreview); assert.equal(await readFile(otherPath, "utf8"), targetHistory);
  await switchVault(directory); await ready(); await capture("restored");
  for (const [path, markdown] of saved) { assert.equal(await readFile(join(directory, path), "utf8"), markdown); }
  assert.deepEqual(await readFile(historyPath), finalHistory); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts and repeated actual same-ID vault switches retain exact archived notes and filters/opaque state while discarding previews; disabled/foreign callbacks create nothing, a fresh target archive stays in its own vault and source histories/notes/settings/original workspace/BOM/CRLF/Unicode survive");
}
