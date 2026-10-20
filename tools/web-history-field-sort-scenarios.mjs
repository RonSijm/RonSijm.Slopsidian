import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";

export async function checkHistoryFieldSort({ host, origin, requests, restart, directory, pass, capture, until }) {
  const active = "app.workspace.activeLeaf.view", provider = 'app.core.getEnabledPluginById("webviewer")', store = provider + ".history";
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const keep = Buffer.from("\ufeff# Keep\r\nField sort 中文 😀.\r\n"), keepPath = join(directory, "Field sort keep.md"); await writeFile(keepPath, keep, { flag: "wx" });
  const choices = ["newest", "oldest", "title-asc", "title-desc", "address-asc", "address-desc"], labels = ["Newest first", "Oldest first", "Title A–Z", "Title Z–A", "Address A–Z", "Address Z–A"];
  const saved = new Map(); let pane, owner, firstId;
  const selector = child => pane + " " + child, control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(store + ".whenIdle()");
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "field-sort history ready");
    const id = await host.evaluate("app.workspace.activeLeaf.id"); pane = "[data-leaf-id=" + JSON.stringify(id) + "]"; owner = "app.workspace.getLeafById(" + JSON.stringify(id) + ").view";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function reveal(id = firstId) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  const ids = () => host.evaluate("[...document.querySelectorAll(" + JSON.stringify(selector("[data-web-history-id]")) + ")].map(row=>row.dataset.webHistoryId)");
  async function order(value) {
    const index = choices.indexOf(value); assert.ok(index >= 0); await host.evaluate("document.querySelector(" + JSON.stringify(selector("[data-web-history-order]")) + ").focus()");
    await host.press("Home", "Home", 36); for (let step = 0; step < index; step++) { await host.press("ArrowDown", "ArrowDown", 40); } await host.press("Enter", "Enter", 13);
    await host.wait(owner + ".getState().sortOrder===" + JSON.stringify(value) + (value === "newest" ? "||" + owner + ".getState().sortOrder===undefined" : ""), "field-sort order " + value);
  }
  async function query(value) { await host.fill(selector("[data-web-history-search]"), value); }
  async function dates(fromDate, throughDate) {
    for (const [field, value] of [["from", fromDate], ["through", throughDate]]) {
      await host.evaluate("(()=>{const input=" + owner + "." + field + ";input.value=" + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    }
  }
  async function select(id, keyboard = false) {
    const input = selector("[data-web-history-select=" + JSON.stringify(id) + "]");
    if (keyboard) { await host.evaluate("document.querySelector(" + JSON.stringify(input) + ").focus()"); await host.press(" ", "Space", 32); } else { await host.click(input); }
    await host.wait(owner + ".selected.has(" + JSON.stringify(id) + ")", "field-sort checked " + id);
  }
  async function clear() { if (await host.evaluate(owner + ".selected.size")) { await host.click(control("clear-selection")); } }
  async function archive(count, selected = false, expectedOrder) {
    await host.click(control(selected ? "archive-selected" : "archive")); await host.wait('Boolean(document.querySelector("[data-web-history-archive]"))&&!document.querySelector("[data-web-history-archive-action=save]").disabled', "field-sort archive ready");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive]").dataset.webHistoryArchiveOrder'), expectedOrder);
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-archive-status]").textContent'), count + " " + (selected ? "selected" : "shown") + (count === 1 ? " visit" : " visits") + " · " + labels[choices.indexOf(expectedOrder)]);
    return host.evaluate('document.querySelector("[data-web-history-archive-preview]").value');
  }
  async function closeArchive(escape = false) {
    if (escape) { await host.press("Escape", "Escape", 27); } else { await host.click('[data-web-history-archive-action="cancel"]'); }
    await host.wait('!document.querySelector("[data-web-history-archive]")', "field-sort archive closed");
  }
  async function save(path, markdown) {
    await host.fill("[data-web-history-archive-path]", path); await host.click('[data-web-history-archive-action="save"]');
    await host.wait('!document.querySelector("[data-web-history-archive]")&&app.workspace.getActiveFile()?.path===' + JSON.stringify(path), "field-sort note saved");
    assert.deepEqual(await readFile(join(await host.evaluate("app.vault.rootPath"), path)), Buffer.from(markdown)); saved.set(path, markdown);
  }
  const markdownLinks = markdown => [...marked.parse(markdown).matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  async function reading(urls) {
    await host.evaluate(active + '.setMode("preview")'); await host.wait(active + '.previewEl.querySelectorAll(\'a[href^="http"]\').length===' + urls.length, "sorted archive Reading ready");
    assert.deepEqual(await host.evaluate("[..." + active + '.previewEl.querySelectorAll(\'a[href^="http"]\')].map(link=>link.getAttribute("href"))'), urls);
    assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("img,script,iframe,.internal-embed,.internal-link").length'), 0);
  }
  async function openReview(count, expectedOrder) {
    await host.click(control("open-selected")); await host.wait('document.querySelector("[data-web-history-open]")?.dataset.webHistoryOpen==="review"', "sorted selected tabs reviewed");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-open-status]").textContent'), count + " selected " + (count === 1 ? "visit" : "visits") + " · " + labels[choices.indexOf(expectedOrder)]);
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-open-visits]").children.length'), count);
  }
  async function closeOpen() { await host.click('[data-web-history-open-action="cancel"]'); await host.wait('!document.querySelector("[data-web-history-open]")', "field-sort tab review closed"); }
  async function toggle(enabled) {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
    if (await host.evaluate('app.core.isEnabled("webviewer")') !== enabled) { await host.click('[data-core-toggle="webviewer"]'); }
    await host.wait('!app.core.busy&&app.core.isEnabled("webviewer")===' + enabled, "field-sort provider toggle"); await host.click(".settings-close");
  }
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "field-sort vault dialog"); await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "field-sort vault selected");
  }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await toggle(true); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const day = await host.evaluate("new Date(2026,0,15,12).getTime()");
  const entry = (id, title, suffix, time = day) => ({ id: "field-sort-" + id, title, url: origin + "/one?field-sort=" + suffix, visitedAt: time, future: { keep: [id, "中文 😀"] } });
  const entries = [
    entry("bravo", "bravo Story 中文", "Z", day + 100), entry("alpha-a", "Alpha Story 中文", "B"),
    entry("charlie", "CHARLIE Story 中文 😀", "A", day - 86400000), entry("alpha-b", "alpha Story 中文", "b"),
    entry("literal", '<img src=x onerror=evil()> Story 中文 ![[Secret]] **literal**', "C", day + 50),
  ];
  const expected = {
    "title-asc": [4, 3, 1, 0, 2], "title-desc": [2, 0, 3, 1, 4],
    "address-asc": [2, 3, 1, 4, 0], "address-desc": [0, 4, 3, 1, 2],
  };
  const expectedIds = value => expected[value].map(index => entries[index].id), expectedUrls = value => expected[value].map(index => entries[index].url);
  const data = { version: 1, recording: false, entries, future: { keep: ["中文", true] } }, original = Buffer.from("\ufeff" + JSON.stringify(data) + "\r\n");
  await writeFile(historyPath, original); await history(); firstId = await host.evaluate("app.workspace.activeLeaf.id"); await host.evaluate("app.workspace.activeLeaf.setPinned(true)");
  assert.deepEqual(await host.evaluate("[...document.querySelector(" + JSON.stringify(selector("[data-web-history-order]")) + ").options].map(option=>[option.value,option.textContent])"), choices.map((value, index) => [value, labels[index]]));
  const requestCount = requests.length;
  for (const value of choices.slice(2)) { await order(value); assert.deepEqual(await ids(), expectedIds(value)); assert.equal(await host.evaluate(owner + ".getState().sortOrder"), value); }
  await order("title-asc"); await capture("list"); await select(entries[0].id); await order("address-desc"); assert.equal(await host.evaluate(owner + ".selected.size"), 0);
  await host.click(control("clear")); await host.wait("Boolean(" + owner + ".review)", "field-sort removal review"); await order("title-desc"); assert.equal(await host.evaluate(owner + ".review"), null);
  await query("Story 中文"); await dates("2026-01-15", "2026-01-15"); await order("address-asc"); assert.deepEqual(await ids(), expectedIds("address-asc").filter(id => id !== entries[2].id));
  const beforeInvalid = await host.evaluate(owner + ".getState()");
  assert.match(await host.evaluate("(async()=>{try{await " + owner + ".setState({sortOrder:'title',query:'wrong'},{});return ''}catch(error){return error.message}})()"), /sort order/); assert.deepEqual(await host.evaluate(owner + ".getState()"), beforeInvalid);
  await dates("", ""); await query(""); assert.equal(requests.length, requestCount); assert.deepEqual(await readFile(historyPath), original);
  pass("Actual keyboard Order exposes all six choices and four new title/address directions sort literal titles/URLs with case-insensitive newest/source ties; search/local-date scope, clear-review/selection invalidation and atomic invalid imports preserve source bytes without requests or default history writes");

  const chosen = [entries[0].id, entries[1].id];
  for (const value of choices.slice(2)) {
    await order(value); const shown = await archive(5, false, value); assert.deepEqual(markdownLinks(shown), expectedUrls(value)); assert.ok(shown.includes("Order: " + labels[choices.indexOf(value)]));
    if (value === "title-asc") { await save("History/Title order 中文.md", shown); await reading(expectedUrls(value)); await reveal(); } else { await closeArchive(); }
    await clear(); await select(chosen[0]); await select(chosen[1], true);
    const selected = await archive(2, true, value), selectedUrls = expected[value].filter(index => chosen.includes(entries[index].id)).map(index => entries[index].url);
    assert.deepEqual(markdownLinks(selected), selectedUrls);
    if (value === "address-desc") { await save("History/Address selection.md", selected); await reading(selectedUrls); await capture("saved"); await reveal(); } else { await closeArchive(); }
    await openReview(2, value);
    assert.deepEqual(await host.evaluate('[...document.querySelector("[data-web-history-open-visits]").children].map(row=>row.querySelector("div").textContent)'), selectedUrls);
    if (value === "address-desc") {
      await capture("review"); const previous = await host.evaluate('app.workspace.getLeavesOfType("webviewer").map(leaf=>leaf.id)');
      await host.click('[data-web-history-open-action="open"]'); await host.wait('document.querySelector("[data-web-history-open]")?.dataset.webHistoryOpen==="complete"', "field-sorted new tabs opened");
      await until(async () => {
        const added = await host.evaluate('app.workspace.getLeavesOfType("webviewer").filter(leaf=>!' + JSON.stringify(previous) + '.includes(leaf.id)).map(leaf=>({url:leaf.view.url,loading:leaf.view.loading,error:leaf.view.message.textContent}))');
        return added.length === 2 && added.every((leaf, index) => leaf.url === selectedUrls[index] && !leaf.loading && !leaf.error);
      }, "field-sorted exact native tabs");
    }
    await closeOpen(); await reveal(); await idle(); assert.deepEqual(await readFile(historyPath), original);
  }
  pass("Shown and exact-selected note archives and selected-tab reviews share all four displayed field orders and labels; real UTF-8 saves/Reading retain literal hostile/Unicode titles and URL case, and Address Z–A confirmation opens exactly the reviewed native tabs while paused history and pinned history remain intact");

  await clear(); await host.click(selector("[data-web-history-id=" + JSON.stringify(entries[2].id) + '] [data-web-history-action="remove"]')); await idle(); await ready();
  const removed = await readFile(historyPath), undo = await host.evaluate(store + ".getUndo(" + owner + ".snapshot).id");
  for (const value of choices.slice(2)) { await order(value); assert.equal(await host.evaluate(store + ".getUndo(" + owner + ".snapshot).id"), undo); assert.deepEqual(await readFile(historyPath), removed); }
  await host.click(control("undo")); await idle(); await ready(); const finalHistory = await readFile(historyPath), redo = await host.evaluate(store + ".getRedo(" + owner + ".snapshot).id");
  await order("title-asc"); await order("address-desc"); assert.equal(await host.evaluate(store + ".getRedo(" + owner + ".snapshot).id"), redo);
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"Alpha Story",sortOrder:"title-desc",futureFieldSort:{keep:true}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"); assert.deepEqual(await ids(), [entries[3].id, entries[1].id]);
  assert.equal(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(firstId) + ").view.getState().sortOrder"), "address-desc");
  await select(entries[1].id); await archive(1, true, "title-desc"); await host.fill("[data-web-history-archive-path]", "History/Field queued.md");
  await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseFieldSort=resolve);undefined"); await host.click('[data-web-history-archive-action="save"]');
  await host.wait(owner + ".archivePreview.busy", "field archive queued"); await host.evaluate(owner + ".changeOrder('address-asc');" + owner + ".changeOrder('title-desc');releaseFieldSort();undefined"); await idle();
  await host.wait("!" + owner + '.archivePreview.busy&&!document.querySelector("[data-web-history-archive-error]").hidden', "field archive expired");
  assert.equal(await host.evaluate('Boolean(app.vault.getFileByPath("History/Field queued.md"))'), false); await closeArchive(true); await select(entries[1].id); await openReview(1, "title-desc");
  const leafCount = await host.evaluate('app.workspace.getLeavesOfType("webviewer").length'); await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseFieldSort=resolve);undefined");
  await host.click('[data-web-history-open-action="open"]'); await host.wait(owner + ".openPreview.busy", "field tabs queued");
  await host.evaluate(owner + ".changeOrder('address-desc');" + owner + ".changeOrder('title-desc');releaseFieldSort();undefined"); await idle();
  await host.wait('document.querySelector("[data-web-history-open]")?.dataset.webHistoryOpen==="stopped"&&!' + owner + ".openPreview.busy", "field tabs expired");
  assert.match(await host.evaluate('document.querySelector("[data-web-history-open-error]").textContent'), /Opened 0 of 1/); assert.equal(await host.evaluate('app.workspace.getLeavesOfType("webviewer").length'), leafCount); await capture("queued"); await closeOpen();
  await select(entries[1].id); await openReview(1, "title-desc"); await host.evaluate("globalThis.closedFieldOpen=" + owner + ".openPreview;undefined");
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(secondId) + "))"); await reveal();
  assert.match(await host.evaluate("closedFieldOpen.actions.open().then(()=>'',error=>error.message)"), /active|available/); assert.deepEqual(await readFile(historyPath), finalHistory);
  pass("Independent panes retain distinct field orders; sort changes preserve eligible Undo/Redo and exact physical history data while expiring selections/reviews. Queued field-order round trips refuse both note creation and selected-tab opening before side effects, and a closed owner cannot replay its sorted review");

  await host.evaluate('(async()=>{for(const leaf of app.workspace.getLeavesOfType("webviewer"))await app.workspace.closeLeaf(leaf)})()'); await reveal();
  await host.evaluate("app.workspace.activeLeaf.setViewState({type:'webviewer-history',state:{query:'Story 中文',sortOrder:'address-asc',fromDate:'2026-01-15',throughDate:'2026-01-15',futureFieldSort:{keep:['中文',true]}},pinned:true,active:true})"); await ready();
  const expectedState = await host.evaluate(owner + ".getState()"), restoredIds = expectedIds("address-asc").filter(id => id !== entries[2].id);
  await select(entries[1].id); await archive(1, true, "address-asc"); await host.evaluate("app.workspace.flushLayout()"); await restart(); await reveal();
  assert.equal(await host.evaluate(owner + ".selected.size"), 0); assert.deepEqual(await host.evaluate(owner + ".getState()"), expectedState); assert.deepEqual(await ids(), restoredIds);
  assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-archive],[data-web-history-open]"))'), false);
  await toggle(false); await host.evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await toggle(true); await reveal();
  assert.deepEqual(await host.evaluate(owner + ".getState()"), expectedState); assert.deepEqual(await ids(), restoredIds);
  const other = join(directory, ".history-field-sort-other-vault"), otherConfig = join(other, ".obsidian"), otherHistoryPath = join(otherConfig, "vault-dotnet-web-history.json");
  const targetEntries = [{ ...entries[0], title: "Target z", url: origin + "/one?field-target=a" }, { ...entries[1], title: "Target a", url: origin + "/one?field-target=z" }];
  const otherHistory = Buffer.from("\ufeff" + JSON.stringify({ ...data, entries: targetEntries, future: { keep: "target" } }) + "\r\n"), otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"field sort target"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nField order target 中文 😀.\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(otherHistoryPath, otherHistory); await writeFile(join(otherConfig, "webviewer.json"), otherSettings); await writeFile(join(other, "Keep.md"), otherNote);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  await select(entries[1].id); await archive(1, true, "address-asc"); await host.evaluate("globalThis.foreignFieldArchive=" + owner + ".archivePreview;undefined"); await closeArchive(); await switchVault(other); await history();
  assert.equal(Object.hasOwn(await host.evaluate(owner + ".getState()"), "sortOrder"), false); await order("title-desc"); await query("Target"); assert.deepEqual(await ids(), targetEntries.map(entry => entry.id));
  assert.match(await host.evaluate("(()=>{try{foreignFieldArchive.actions.guard();return ''}catch(error){return error.message}})()"), /available/);
  await switchVault(directory); await reveal(); assert.deepEqual(await host.evaluate(owner + ".getState()"), expectedState); assert.deepEqual(await ids(), restoredIds);
  await switchVault(other); await history(); assert.equal(await host.evaluate(owner + ".getState().sortOrder"), "title-desc"); assert.deepEqual(await ids(), targetEntries.map(entry => entry.id));
  await switchVault(directory); await reveal(); await capture("restored");
  for (const [path, markdown] of saved) { assert.deepEqual(await readFile(join(directory, path)), Buffer.from(markdown)); }
  assert.deepEqual(await readFile(historyPath), finalHistory); assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note); assert.deepEqual(await readFile(keepPath), keep);
  assert.deepEqual(await readFile(otherHistoryPath), otherHistory); assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts retain the new pane-local field order, pin/search/date/opaque state and saved sorted notes while dropping selection/reviews; repeated actual same-ID vault switches isolate source Address A–Z and target Title Z–A, reject old reviews and preserve exact history/settings/notes/original workspace/BOM/CRLF/Unicode bytes");
}
