import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkHistoryOpen({ host, origin, requests, restart, directory, pass, capture, targets, connect, until }) {
  const active = "app.workspace.activeLeaf.view", provider = 'app.core.getEnabledPluginById("webviewer")', store = provider + ".history";
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json");
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const keep = Buffer.from("\ufeff# Keep\r\nSelected tabs 中文 😀.\r\n"), keepPath = join(directory, "Open selected keep.md"); await writeFile(keepPath, keep, { flag: "wx" });
  let pane, owner, firstId;
  const selector = child => pane + " " + child, control = action => selector('[data-web-history-action="' + action + '"]');
  const modal = () => owner + ".openPreview", idle = () => host.evaluate(store + ".whenIdle()");
  const leafIds = () => host.evaluate('app.workspace.getLeavesOfType("webviewer").map(leaf=>leaf.id)');
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "open-selected history ready");
    const id = await host.evaluate("app.workspace.activeLeaf.id"); pane = "[data-leaf-id=" + JSON.stringify(id) + "]"; owner = "app.workspace.getLeafById(" + JSON.stringify(id) + ").view";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function reveal(id = firstId) { await host.evaluate("app.workspace.revealLeaf(app.workspace.getLeafById(" + JSON.stringify(id) + "))"); await ready(); }
  async function refresh() {
    await host.evaluate("globalThis.openSelectedSnapshot=" + owner + ".snapshot;undefined"); await host.click(control("refresh"));
    await host.wait(owner + ".snapshot!==openSelectedSnapshot&&!" + owner + ".refreshing", "open-selected refreshed"); await ready();
  }
  async function select(id, keyboard = false) {
    const input = selector("[data-web-history-select=" + JSON.stringify(id) + "]");
    if (keyboard) { await host.evaluate("document.querySelector(" + JSON.stringify(input) + ").focus()"); await host.press(" ", "Space", 32); } else { await host.click(input); }
    await host.wait(owner + ".selected.has(" + JSON.stringify(id) + ")", "open-selected checked " + id);
  }
  async function clear() { await host.click(control("clear-selection")); }
  async function preview(count) {
    await host.click(control("open-selected")); await host.wait('document.querySelector("[data-web-history-open]")?.dataset.webHistoryOpen==="review"', "open-selected review visible");
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-open-visits]").children.length'), count);
    assert.equal(await host.evaluate('document.querySelector("[data-web-history-open]").querySelectorAll("a,img,iframe,script,.internal-embed").length'), 0);
  }
  async function close(escape = false) {
    if (escape) { await host.press("Escape", "Escape", 27); } else { await host.click('[data-web-history-open-action="cancel"]'); }
    await host.wait('!document.querySelector("[data-web-history-open]")', "open-selected closed");
  }
  async function confirm(expected = "complete") {
    await host.click('[data-web-history-open-action="open"]');
    await host.wait('document.querySelector("[data-web-history-open]")?.dataset.webHistoryOpen===' + JSON.stringify(expected) + "&&!" + modal() + ".busy", "open-selected " + expected);
  }
  async function openedSince(before, expected) {
    let added;
    await until(async () => {
      added = await host.evaluate('app.workspace.getLeavesOfType("webviewer").filter(leaf=>!' + JSON.stringify(before) + '.includes(leaf.id)).map(leaf=>({id:leaf.id,url:leaf.view.url,loading:leaf.view.loading,error:leaf.view.message.textContent}))');
      return added.length === expected.length && added.every((leaf, index) => leaf.url === expected[index] && !leaf.loading && !leaf.error);
    }, "exact reviewed new tabs loaded");
    return added;
  }
  async function toggle(enabled) {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
    if (await host.evaluate('app.core.isEnabled("webviewer")') !== enabled) { await host.click('[data-core-toggle="webviewer"]'); }
    await host.wait('!app.core.busy&&app.core.isEnabled("webviewer")===' + enabled, "open-selected provider toggle"); await host.click(".settings-close");
  }
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "open-selected vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "open-selected vault selected");
  }
  async function remember() { await host.evaluate("globalThis.oldOpenSelected=" + modal() + ";globalThis.invokeOldOpenSelected=()=>oldOpenSelected.actions.open().then(()=>false,error=>String(error.message));undefined"); }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await toggle(true); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
  const day = await host.evaluate("new Date(2026,0,15,12).getTime()");
  const visit = (id, title, url, time = day) => ({ id: "open-selected-" + id, title, url: origin + url, visitedAt: time, future: { keep: [id, "中文 😀"] } });
  const entries = [
    visit("one", 'Chosen first 中文 <img src=x onerror=evil()> ![[Secret]] **literal**', "/one?history-open=one"),
    visit("two", "Chosen second 😀", "/two?history-open=two"),
    visit("other", "Unchecked other", "/one?history-open=unchecked", day - 86400000),
    visit("repeat", "Chosen repeated address", "/one?history-open=one", day + 1),
  ];
  const data = { version: 1, recording: false, entries, future: { keep: ["中文", true] } }, original = Buffer.from("\ufeff" + JSON.stringify(data) + "\r\n");
  await writeFile(historyPath, original); await history(); firstId = await host.evaluate("app.workspace.activeLeaf.id"); await host.evaluate("app.workspace.activeLeaf.setPinned(true)");
  assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(control("open-selected")) + ").disabled"), true);
  await host.evaluate("document.querySelector(" + JSON.stringify(selector("[data-web-history-order]")) + ").focus()"); await host.press("Home", "Home", 36); await host.press("ArrowDown", "ArrowDown", 40); await host.press("Enter", "Enter", 13);
  await host.wait(owner + '.sortOrder==="oldest"', "actual oldest-first order"); await select(entries[0].id); await select(entries[1].id, true); await select(entries[3].id);
  const before = await leafIds(), requestCount = requests.length; await preview(3);
  const titles = await host.evaluate('[...document.querySelector("[data-web-history-open-visits]").children].map(row=>row.querySelector("strong").textContent)');
  assert.deepEqual(titles, [entries[0].title, entries[1].title, entries[3].title]); assert.ok((await host.evaluate('document.querySelector("[data-web-history-open-scope]").textContent')).includes("(any)"));
  await capture("review"); await close();
  assert.equal(await host.evaluate(owner + ".selected.size"), 3); assert.equal(await host.evaluate("document.activeElement===document.querySelector(" + JSON.stringify(control("open-selected")) + ")"), true);
  await preview(3); await close(true); assert.deepEqual(await leafIds(), before); assert.equal(requests.length, requestCount); assert.deepEqual(await readFile(historyPath), original);
  await preview(3); await confirm(); await openedSince(before, [entries[0].url, entries[1].url, entries[3].url]);
  assert.equal(await host.evaluate("app.workspace.getLeafById(" + JSON.stringify(firstId) + ").pinned"), true);
  assert.ok((await host.evaluate('document.querySelector("[data-web-history-open-status]").textContent')).includes("Opened 3 tabs"));
  assert.equal(await host.evaluate('document.querySelector("[data-web-history-open-action=open]").disabled'), true); await capture("opened");
  let pageTarget; await until(async () => { pageTarget = (await targets()).find(target => target.url === entries[1].url); return pageTarget; }, "selected tab native target");
  const remote = await connect(pageTarget); await remote.wait('document.readyState==="complete"', "selected native document complete");
  assert.deepEqual(await remote.evaluate("({node:typeof require,opener:window.opener===null})"), { node: "undefined", opener: true });
  await close(); await reveal(); assert.equal(await host.evaluate(owner + ".selected.size"), 3); await idle(); assert.deepEqual(await readFile(historyPath), original);
  pass("Actual pointer/Space checked visits, keyboard chronological ordering and Open selected review show literal Unicode/hostile titles and exact repeated addresses without active markup or requests; Cancel/Escape retain selection/focus, confirmation opens exactly three ordered native tabs once while preserving the pinned history pane, paused source bytes and isolation");

  const many = { ...data, entries: Array.from({ length: 21 }, (_, index) => visit("many-" + index, "Limit " + index, "/one?history-open=limit-" + index)) };
  await writeFile(historyPath, Buffer.from("\ufeff" + JSON.stringify(many) + "\r\n")); await refresh(); await host.click(control("select-shown"));
  assert.equal(await host.evaluate(owner + ".selected.size"), 21); assert.equal(await host.evaluate("document.querySelector(" + JSON.stringify(control("open-selected")) + ").disabled"), true);
  assert.match(await host.evaluate("(()=>{try{" + owner + ".beginOpenSelected();return ''}catch(error){return error.message}})()"), /1 and 20/);
  await host.click(selector("[data-web-history-select=" + JSON.stringify(many.entries[20].id) + "]")); await preview(20); await close();
  await writeFile(historyPath, original); await refresh(); for (const entry of [entries[0], entries[1], entries[3]]) { await select(entry.id); }
  await preview(3); const external = Buffer.from("\ufeff" + JSON.stringify({ ...data, external: { keep: "after review" } }, null, 1) + "\r\n"); await writeFile(historyPath, external);
  let baseline = await leafIds(); await confirm("stopped"); assert.match(await host.evaluate('document.querySelector("[data-web-history-open-error]").textContent'), /Opened 0 of 3.*history changed/i);
  assert.deepEqual(await leafIds(), baseline); assert.deepEqual(await readFile(historyPath), external); await close(); await refresh(); for (const entry of [entries[0], entries[1], entries[3]]) { await select(entry.id); }
  await preview(3); await host.evaluate(store + ".tail=new Promise(resolve=>globalThis.releaseOpenSelected=resolve);undefined");
  await host.click('[data-web-history-open-action="open"]'); await host.wait(modal() + ".busy", "selected tab review queued");
  await host.evaluate(owner + ".setSelected(" + owner + ".snapshot," + JSON.stringify(entries[1].id) + ",false);" + owner + ".setSelected(" + owner + ".snapshot," + JSON.stringify(entries[1].id) + ",true);releaseOpenSelected();undefined");
  await host.wait('document.querySelector("[data-web-history-open]")?.dataset.webHistoryOpen==="stopped"&&!' + modal() + ".busy", "queued selection round trip refused");
  assert.deepEqual(await leafIds(), baseline); assert.deepEqual(await readFile(historyPath), external); await close();
  await preview(3); baseline = await leafIds();
  await host.evaluate(provider + ".openUrlBeforeFixture=" + provider + ".openUrl;globalThis.openSelectedCalls=0;" + provider + ".openUrl=async function(...args){if(++openSelectedCalls===2)throw Error('Bounded second-tab failure');return this.openUrlBeforeFixture(...args)};undefined");
  try {
    await confirm("stopped"); assert.match(await host.evaluate('document.querySelector("[data-web-history-open-error]").textContent'), /Opened 1 of 3.*Bounded second-tab failure/);
    assert.equal(await host.evaluate("openSelectedCalls"), 2); await openedSince(baseline, [entries[0].url]); assert.equal(await host.evaluate('document.querySelector("[data-web-history-open-action=open]").disabled'), true); await capture("stopped");
  } finally { await host.evaluate(provider + ".openUrl=" + provider + ".openUrlBeforeFixture;delete " + provider + ".openUrlBeforeFixture;undefined"); }
  await close(); await reveal(); assert.deepEqual(await readFile(historyPath), external);
  pass("The real 21-visit selection cannot open or silently truncate and a corrected 20-visit review is accepted; external version conflicts and a queued selected-ID round trip open no tabs, while a bounded second-tab callback failure reports one confirmed open, stops the remaining addresses and disables retry without rewriting source history");

  await host.click(selector("[data-web-history-id=" + JSON.stringify(entries[2].id) + '] [data-web-history-action="remove"]')); await idle(); await ready();
  const removed = await readFile(historyPath), undo = await host.evaluate(store + ".getUndo(" + owner + ".snapshot).id");
  await select(entries[0].id); baseline = await leafIds(); await preview(1); await confirm(); await openedSince(baseline, [entries[0].url]); await close(); await reveal();
  assert.equal(await host.evaluate(store + ".getUndo(" + owner + ".snapshot).id"), undo); assert.deepEqual(await readFile(historyPath), removed);
  await host.click(control("undo")); await idle(); await ready(); const redoBytes = await readFile(historyPath), redo = await host.evaluate(store + ".getRedo(" + owner + ".snapshot).id");
  await select(entries[1].id); await preview(1); await confirm(); await close(); await reveal(); assert.equal(await host.evaluate(store + ".getRedo(" + owner + ".snapshot).id"), redo); assert.deepEqual(await readFile(historyPath), redoBytes);
  await host.evaluate('app.workspace.getLeaf("split").setViewState({type:"webviewer-history",state:{query:"Chosen second",futureOpenSelected:{keep:true}},active:true})'); await ready();
  const secondId = await host.evaluate("app.workspace.activeLeaf.id"); await select(entries[1].id); await preview(1); await remember(); baseline = await leafIds();
  await host.evaluate("app.workspace.closeLeaf(app.workspace.getLeafById(" + JSON.stringify(secondId) + "))"); await reveal(); assert.equal(await host.evaluate(owner + ".selected.size"), 1);
  assert.match(await host.evaluate("invokeOldOpenSelected()"), /active|available/); assert.deepEqual(await leafIds(), baseline);
  await host.click(selector("[data-web-history-recording]")); await idle(); await ready(); await select(entries[0].id); await select(entries[1].id);
  baseline = await leafIds(); await preview(2); await confirm(); await openedSince(baseline, [entries[0].url, entries[1].url]); await close(); await reveal(); await idle();
  await host.wait("!" + owner + ".refreshing&&" + owner + ".snapshot.history.entries.some(entry=>entry.title==='Viewer fixture Two')", "ordinary distinct committed visit recorded after opening");
  const recorded = await host.evaluate(owner + ".snapshot.history.entries.filter(entry=>!" + JSON.stringify(entries.map(entry => entry.id)) + ".includes(entry.id))");
  assert.ok(recorded.length >= 1 && recorded.length <= 2);
  assert.ok(recorded.every(entry => [entries[0].url, entries[1].url].includes(entry.url) && ["Viewer fixture One", "Viewer fixture Two"].includes(entry.title)));
  assert.equal(await host.evaluate(store + ".getRedo(" + owner + ".snapshot)"), null);
  await host.click(selector("[data-web-history-recording]")); await idle(); await ready(); const finalHistory = await readFile(historyPath);
  assert.equal(await host.evaluate(owner + ".snapshot.history.recording"), false);
  pass("Paused selected-tab opening preserves exact source bytes and eligible Undo/Redo tokens; independent filtered panes retain separate selections and closing a reviewed owner destroys it before old callbacks run. With recording enabled, actual committed page visits record normally after the bounded open operation and invalidate inverse checkpoints through the ordinary history flow");

  await host.evaluate('(async()=>{for(const leaf of app.workspace.getLeavesOfType("webviewer"))await app.workspace.closeLeaf(leaf)})()'); await reveal();
  await host.evaluate("app.workspace.activeLeaf.setViewState({type:'webviewer-history',state:{query:'Chosen',sortOrder:'oldest',futureOpenSelected:{keep:['中文',true]}},pinned:true,active:true})"); await ready();
  const expectedState = await host.evaluate(owner + ".getState()"); await select(entries[0].id); await preview(1);
  assert.equal(Object.hasOwn(expectedState, "selected"), false); assert.equal(Object.hasOwn(expectedState, "openPreview"), false);
  await host.evaluate("app.workspace.flushLayout()"); await restart(); await reveal(); assert.equal(await host.evaluate(owner + ".selected.size"), 0);
  assert.deepEqual(await host.evaluate(owner + ".getState()"), expectedState); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-open]"))'), false); assert.deepEqual(await leafIds(), []);
  await select(entries[0].id); await preview(1); await remember(); await close(); await toggle(false);
  assert.match(await host.evaluate("invokeOldOpenSelected()"), /active|available/); assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-action=open-selected]"))'), false);
  await host.evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); await toggle(true); await reveal();
  assert.equal(await host.evaluate(owner + ".selected.size"), 0); assert.deepEqual(await host.evaluate(owner + ".getState()"), expectedState);
  const other = join(directory, ".history-open-other-vault"), otherConfig = join(other, ".obsidian"), otherHistoryPath = join(otherConfig, "vault-dotnet-web-history.json");
  const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"open selected target"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nTarget tabs 中文 😀.\r\n");
  const targetEntry = { ...entries[0], url: origin + "/two?history-open=target", title: "Chosen target" }, targetHistory = Buffer.from("\ufeff" + JSON.stringify({ ...data, entries: [targetEntry], future: { keep: "target" } }) + "\r\n");
  await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings); await writeFile(otherHistoryPath, targetHistory);
  await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
  await select(entries[0].id); await preview(1); await remember(); await close(); await switchVault(other); await history();
  assert.equal(await host.evaluate(owner + ".selected.size"), 0); assert.match(await host.evaluate("invokeOldOpenSelected()"), /active|available/); baseline = await leafIds();
  await select(targetEntry.id); await preview(1); await confirm(); await openedSince(baseline, [targetEntry.url]); await close(); await history(); assert.deepEqual(await readFile(otherHistoryPath), targetHistory);
  await preview(1); await remember(); await close(); await switchVault(directory); await reveal(); assert.equal(await host.evaluate(owner + ".selected.size"), 0); assert.match(await host.evaluate("invokeOldOpenSelected()"), /active|available/);
  await switchVault(other); await history(); assert.equal(await host.evaluate(owner + ".selected.size"), 0); await switchVault(directory); await reveal(); await capture("restored");
  assert.deepEqual(await host.evaluate(owner + ".getState()"), expectedState); assert.deepEqual(await readFile(historyPath), finalHistory);
  assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note); assert.deepEqual(await readFile(keepPath), keep);
  assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote); assert.deepEqual(await readFile(otherHistoryPath), targetHistory);
  assert.ok(requests.every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Full enabled/disabled restarts discard selected sets and open reviews without replaying tabs, while pinned history/filter/order/opaque state survive; repeated actual same-ID vault switches refuse old callbacks, fresh target reviews open only target addresses and exact source/target histories/settings/notes/original workspace/BOM/CRLF/Unicode bytes survive");
}
