import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkGraphs } from "./graph-scenarios.mjs";
import { checkOrganization } from "./organization-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export async function checkBookmarkWorkflows(tools) {
  const { directory, evaluate, command, click, press, wait, restart, afterReload, capture, report } = tools;
  await checkGraphs(tools);
  await checkOrganization(tools);
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const folder = "Bookmark workflows", alpha = folder + "/Alpha.md", beta = folder + "/Beta.md";
  const alphaBytes = Buffer.from("\ufeff# Alpha\r\n\r\n[[Beta]] #bookmark-fixture\r\n"), betaBytes = Buffer.from("# Beta\n\n[[Alpha]]\n");
  const configuration = join(directory, ".obsidian", "bookmarks.json"), graphConfiguration = join(directory, ".obsidian", "graph.json");
  const graphOptions = { search: `path:"${folder}" file:Alpha`, showTags: true, showOrphans: true, futureBookmarkOptions: { keep: [false, 0.125] } };
  const data = { futureConfiguration: { keep: ["bookmarks", null] }, items: [
    { type: "group", title: "Graph and navigation", ctime: 1100, futureGroup: "retained", items: [
      { type: "graph", title: "Saved Alpha graph", ctime: 1101, options: graphOptions },
      { type: "search", title: "Saved Beta search", ctime: 1102, query: "file:Beta" },
      { type: "folder", title: "Empty folder", ctime: 1103, path: folder + "/Empty" },
      { type: "file", title: "Alpha note", ctime: 1104, path: alpha },
      { type: "group", title: "Nested group", ctime: 1105, items: [{ type: "file", path: beta, ctime: 1106 }] },
    ] },
    { type: "search", title: "Saved folder search", ctime: 1110, query: `path:"${folder}"` },
    { type: "future-bookmark", ctime: 1120, payload: { retained: true } },
  ] };
  await evaluate('app.core.setEnabled("bookmarks",false)');
  await evaluate('app.core.setEnabled("graph",false)');
  await mkdir(join(directory, folder, "Empty"), { recursive: true });
  await writeFile(join(directory, alpha), alphaBytes); await writeFile(join(directory, beta), betaBytes);
  const originalBytes = Buffer.from("\ufeff" + JSON.stringify(data, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  const graphBytes = Buffer.from("\ufeff" + JSON.stringify({ search: `path:"${folder}"`, showOrphans: true, futureGlobal: { keep: true } }) + "\r\n");
  await writeFile(configuration, originalBytes); await writeFile(graphConfiguration, graphBytes);
  await evaluate('(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.core.setEnabled("graph",true);await app.core.setEnabled("bookmarks",true);await app.commands.execute("bookmarks:open");})()');
  const first = await evaluate('app.workspace.getLeavesOfType("bookmarks")[0].id');
  const pane = id => `[data-bookmark-pane="${id}"]`, graph = id => `[data-graph-pane="${id}"]`;
  const state = id => evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).view.getState()`);
  const stored = async () => JSON.parse((await readFile(configuration, "utf8")).replace(/^\uFEFF/, ""));
  const address = time => evaluate(`app.core.getEnabledPluginById("bookmarks").entries().find(e=>e.item.ctime===${time}).address.join(".")`);
  const action = async (time, name, id = first) => `${pane(id)} [data-bookmark-address="${await address(time)}"] [data-bookmark-action="${name}"]`;
  const reveal = id => evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(id)}))`);
  async function fill(selector, value) {
    await click(selector);
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, "The actual bookmark workflow input must receive keyboard events.");
    await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: value });
  }
  async function palette(id, query) {
    await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open');
    await command("Input.insertText", { text: query }); await click(`[data-command-id="${id}"]`);
  }
  async function saveDialog(title) {
    await fill('[data-core-dialog="bookmarks"] [data-bookmark-field="title"]', title);
    await click('[data-core-dialog="bookmarks"] [data-bookmark-action="save"]');
    await wait('!document.querySelector(\'[data-core-dialog="bookmarks"]\')&&!app.core.getEnabledPluginById("bookmarks").busy');
  }
  async function completeGraph(id, query, path) {
    const status = JSON.stringify(graph(id) + " [data-graph-status]");
    await wait(`document.querySelector(${status})?.dataset.graphComplete==="true"&&document.querySelector(${status}).dataset.completedQuery===${JSON.stringify(query)}`);
    assert.equal(await evaluate(`document.querySelector(${status}).classList.contains("is-error")`), false, await evaluate(`document.querySelector(${status}).textContent`));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll(${JSON.stringify(graph(id) + " [data-graph-node]")})].map(node=>node.dataset.graphPath)`), [path]);
  }
  await palette("bookmarks:open-view", "Open Bookmarks in a tab");
  await wait(`app.workspace.activeLeaf.view.getViewType()==="bookmarks"&&app.workspace.activeLeaf.id!==${JSON.stringify(first)}`);
  const second = await evaluate("app.workspace.activeLeaf.id");
  assert.notEqual(first, second);
  await reveal(first);
  assert.equal(await evaluate(`(()=>{
    const view=app.workspace.getLeafById(${JSON.stringify(first)}).view, bounds=view.containerEl.getBoundingClientRect();
    return view.actionsEl.children.length===5&&[...view.actionsEl.children].every(button=>{
      const box=button.getBoundingClientRect();
      return button.checkVisibility()&&box.width>0&&box.left>=bounds.left&&box.right<=bounds.right&&box.top>=bounds.top&&box.bottom<=bounds.bottom
        &&button.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2));
    });
  })()`), true, "All five actual Bookmarks header actions must remain visible and unobscured in the sidebar without horizontal scrolling.");
  const headerAction = title => `.workspace-leaf-content:has(> ${pane(first)}) [aria-label="${title}"]`;
  await click(headerAction("Collapse all bookmark groups"));
  await wait(`app.workspace.getLeafById(${JSON.stringify(first)}).view.getState().collapsedGroups.length===2`);
  assert.deepEqual((await state(second)).collapsedGroups, []);
  await click(headerAction("Expand all bookmark groups"));
  await wait(`app.workspace.getLeafById(${JSON.stringify(first)}).view.getState().collapsedGroups.length===0`);
  await click(await action(1100, "fold"));
  const folds = (await state(first)).collapsedGroups;
  assert.equal(folds.length, 1);
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(pane(first) + ' [data-bookmark-address="0.0"]')}))`), false);
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(pane(second) + ' [data-bookmark-address="0.0"]')}))`), true);
  await capture("independent-folds");
  await fill(`${pane(first)} [data-bookmark-filter]`, "Alpha");
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(pane(first) + ' [data-bookmark-target="' + alpha + '"]')}))`), true);
  assert.deepEqual((await state(first)).collapsedGroups, folds);
  await fill(`${pane(first)} [data-bookmark-filter]`, "");
  const groupRow = pane(first) + ' [data-bookmark-address="0"]';
  await evaluate(`document.querySelector(${JSON.stringify(groupRow)}).focus()`);
  await press("ArrowRight", "ArrowRight", 39); await wait(`document.querySelector(${JSON.stringify(groupRow)}).getAttribute("aria-expanded")==="true"`);
  await press("ArrowRight", "ArrowRight", 39);
  assert.equal(await evaluate('document.activeElement.dataset.bookmarkType'), "graph");
  await press("ArrowLeft", "ArrowLeft", 37);
  assert.equal(await evaluate('document.activeElement.dataset.bookmarkType'), "group");
  assert.deepEqual(await readFile(configuration), originalBytes);
  await capture("folds");
  pass("Two actual Bookmarks panes keep independent folds and unobscured narrow-pane header actions; filtering temporarily reveals matching descendants without overwriting ordinary folds, and trusted arrow keys navigate and expand the real tree without changing bookmark bytes.");

  await click(await action(1101, "open"));
  await wait('app.workspace.activeLeaf.view.getViewType()==="graph"');
  const graphId = await evaluate("app.workspace.activeLeaf.id");
  await completeGraph(graphId, graphOptions.search, alpha);
  assert.equal((await state(graphId)).options.search, graphOptions.search);
  assert.deepEqual(await readFile(graphConfiguration), graphBytes);
  if (!await evaluate(`document.querySelector(${JSON.stringify(graph(graphId) + " .graph-controls")}).checkVisibility()`)) { await click(`${graph(graphId)} [data-graph-action=toggle-controls]`); }
  const betaQuery = `path:"${folder}" file:Beta`;
  await fill(`${graph(graphId)} [data-graph-option=search]`, betaQuery); await press("Enter", "Enter", 13);
  await completeGraph(graphId, betaQuery, beta);
  await evaluate("app.workspace.flushLayout()");
  assert.deepEqual(await readFile(graphConfiguration), graphBytes);
  assert.deepEqual((await stored()).items[0].items[0], data.items[0].items[0]);
  await palette("bookmarks:bookmark-current-view", "Bookmark current view");
  assert.equal(await evaluate('document.querySelector("[data-bookmark-field=type]").value'), "graph");
  await saveDialog("Captured Beta graph");
  let saved = await stored();
  const capturedGraph = saved.items.find(item => item.title === "Captured Beta graph");
  assert.equal(capturedGraph.type, "graph"); assert.equal(capturedGraph.options.search, betaQuery);
  assert.deepEqual(capturedGraph.options.futureBookmarkOptions, graphOptions.futureBookmarkOptions);
  await palette("bookmarks:bookmark-current-view", "Bookmark current view");
  await click('[data-core-dialog="bookmarks"] .modal-close-button');
  assert.deepEqual(await stored(), saved);
  await capture("graph");
  pass("An original-format graph bookmark restores real graph controls/results. Editing that preset saves only its leaf state, not canonical graph.json or the saved bookmark; the actual current-view command captures the edited graph and cancellation preserves exact data.");

  await palette("global-search:open-view", "Open Search in a tab");
  await wait('app.workspace.activeLeaf.view.getViewType()==="search"');
  const searchId = await evaluate("app.workspace.activeLeaf.id");
  await fill(`[data-search-pane="${searchId}"] [data-search-query]`, betaQuery);
  await press("Enter", "Enter", 13);
  await wait(`document.querySelector('[data-search-pane="${searchId}"] [data-search-status]')?.dataset.searchComplete==="true"&&document.querySelector('[data-search-pane="${searchId}"] [data-search-status]').dataset.completedQuery===${JSON.stringify(betaQuery)}`);
  assert.equal(await evaluate(`document.querySelector('[data-search-pane="${searchId}"] [data-search-file]')?.dataset.searchFile`), beta);
  await palette("bookmarks:bookmark-current-search", "Bookmark current search");
  assert.equal(await evaluate('document.querySelector("[data-bookmark-field=target]").value'), betaQuery);
  await saveDialog("Captured actual Search");
  saved = await stored();
  assert.equal(saved.items.find(item => item.title === "Captured actual Search").query, betaQuery);
  await reveal(first);
  await click(await action(1110, "open"));
  assert.equal(await evaluate('app.core.getEnabledPluginById("global-search").getGlobalSearchQuery()'), `path:"${folder}"`);
  await reveal(first); await click(await action(1102, "open"), 2);
  assert.equal(await evaluate('app.core.getEnabledPluginById("global-search").getGlobalSearchQuery()'), `path:"${folder}" file:Beta`);
  await wait(`document.querySelector('[data-discovery-view="search"] [data-search-status]')?.dataset.searchComplete==="true"&&document.querySelector('[data-discovery-view="search"] [data-search-status]').dataset.completedQuery===${JSON.stringify(betaQuery)}`);
  assert.equal(await evaluate('document.querySelector(\'[data-discovery-view="search"] [data-search-file]\')?.dataset.searchFile'), beta);
  await reveal(first); await click(await action(1102, "open"), 2);
  assert.equal(await evaluate('app.core.getEnabledPluginById("global-search").getGlobalSearchQuery()'), `path:"${folder}"`);
  assert.deepEqual(await stored(), saved);
  pass("Bookmark current search captures the actual Search pane rather than an older sidebar/file. Trusted modified bookmark clicks add and remove the native saved query fragment; ordinary clicks replace it and real Search executes without changing bookmark data.");

  await reveal(first); await click(await action(1103, "open"));
  await wait(`document.activeElement?.dataset.explorerPath===${JSON.stringify(folder + "/Empty")}&&app.workspace.activeLeaf.view.getViewType()==="file-explorer"`);
  const filesId = await evaluate("app.workspace.activeLeaf.id");
  assert.equal((await state(filesId)).searchQuery, "");
  await reveal(first); await click(await action(1104, "open"), 2);
  await wait(`app.current?.file.path===${JSON.stringify(alpha)}&&app.workspace.activeLeaf.view.getViewType()==="markdown"`);
  await press("F2", "F2", 113); await wait('Boolean(document.querySelector("[data-file-dialog=rename]"))');
  assert.equal(await evaluate('document.querySelector("[data-file-dialog=rename] [data-file-field=path]").value'), alpha);
  await press("Escape", "Escape", 27);
  await reveal(first); await click(await action(1105, "fold")); await click(await action(1100, "fold"));
  const foldedBeforeEdit = (await state(first)).collapsedGroups;
  await click(await action(1100, "edit")); await saveDialog("Renamed graph group");
  await click(await action(1100, "down"));
  await wait(`app.core.getEnabledPluginById("bookmarks").items[1].ctime===1100&&!app.core.getEnabledPluginById("bookmarks").busy`);
  assert.equal(await evaluate("document.activeElement.dataset.bookmarkAddress"), await address(1100));
  await press("F2", "F2", 113);
  await wait('Boolean(document.querySelector("[data-core-dialog=bookmarks] [data-bookmark-field=title]"))');
  assert.equal(await evaluate('document.querySelector("[data-bookmark-field=title]").value'), "Renamed graph group");
  await press("Escape", "Escape", 27);
  await click(await action(1100, "fold"));
  await click(await action(1105, "move")); await press("Home", "Home", 36); await press("Enter", "Enter", 13);
  await wait('app.core.getEnabledPluginById("bookmarks").items.at(-1).ctime===1105&&!app.core.getEnabledPluginById("bookmarks").busy');
  await click(await action(1100, "fold"));
  assert.deepEqual((await state(first)).collapsedGroups, foldedBeforeEdit);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pane(first) + ' [data-bookmark-address="1"]')}).getAttribute("aria-expanded")`), "false");
  assert.deepEqual((await state(second)).collapsedGroups, []);
  const beforeRemove = await readFile(configuration);
  await press("Home", "Home", 36); await press("ArrowDown", "ArrowDown", 40);
  assert.equal(await evaluate("document.activeElement.dataset.bookmarkAddress"), await address(1100));
  await press("ArrowUp", "ArrowUp", 38);
  assert.equal(await evaluate("document.activeElement.dataset.bookmarkAddress"), await address(1110));
  await press("End", "End", 35);
  assert.equal(await evaluate("document.activeElement.dataset.bookmarkAddress"), await address(1105));
  await press("Delete", "Delete", 46); await wait('Boolean(document.querySelector("[data-core-dialog=bookmarks] [data-bookmark-action=confirm-remove]"))');
  assert.match(await evaluate('document.querySelector("[data-core-dialog=bookmarks] .modal-content").textContent'), /Nested group/);
  await press("Escape", "Escape", 27);
  assert.deepEqual(await readFile(configuration), beforeRemove);
  const invalid = await evaluate(`(async()=>{const view=app.workspace.getLeafById(${JSON.stringify(first)}).view,before=JSON.stringify(view.getState());try{await view.setState({...view.getState(),collapsedGroups:[1]},{});return false}catch{return JSON.stringify(view.getState())===before}})()`);
  assert.equal(invalid, true);
  saved = await stored(); assert.deepEqual(saved.futureConfiguration, data.futureConfiguration);
  assert.deepEqual(saved.items.find(item => item.type === "future-bookmark"), data.items[2]);
  assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes); assert.deepEqual(await readFile(join(directory, beta)), betaBytes);
  pass("Folder bookmarks reveal an actual registered Files pane, including a genuinely empty folder. Group folds and keyboard focus follow original creation identities through real rename/reorder/move controls; independent panes, malformed-state refusal, opaque items, BOM and note bytes remain intact.");

  await evaluate(`globalThis.retiredBookmarkView=app.workspace.getLeafById(${JSON.stringify(first)}).view;globalThis.retiredBookmarkControl=retiredBookmarkView.contentEl.querySelector("[data-bookmark-action=fold]");true`);
  const beforeDisable = await state(first);
  await evaluate('app.core.setEnabled("bookmarks",false)');
  assert.equal(await evaluate('!retiredBookmarkView.isLoaded&&!retiredBookmarkView.containerEl.isConnected'), true);
  await evaluate('retiredBookmarkControl.click();true');
  assert.deepEqual(await state(first), beforeDisable);
  await evaluate('app.core.setEnabled("bookmarks",true)');
  assert.deepEqual(await state(first), beforeDisable);
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(first)}).view!==retiredBookmarkView`), true);
  await evaluate("app.workspace.flushLayout()");
  const states = await evaluate(`${JSON.stringify([first, second, graphId])}.map(id=>app.workspace.getLeafById(id).view.getState())`);
  await restart(); await afterReload();
  assert.deepEqual(await evaluate(`${JSON.stringify([first, second, graphId])}.map(id=>app.workspace.getLeafById(id).view.getState())`), states);
  assert.deepEqual(await stored(), saved); assert.deepEqual(await readFile(graphConfiguration), graphBytes);
  assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes); assert.deepEqual(await readFile(join(directory, beta)), betaBytes);
  assert.deepEqual((await readFile(configuration)).subarray(0, 3), Buffer.from([239, 187, 191]));
  await reveal(first); await capture("restored");
  pass("Core disable unloads real bookmark owners and detached controls cannot act; re-enable constructs fresh views with the same folds. Full process restart or real-folder reconnection retains both pane states, edited graph presets, original data and BOM.");

  report.bookmarksWorkflows = { graphPresets: true, activeSearchCapture: true, nativeModifiedSearch: true, registeredFolderReveal: true, independentFoldsAndKeyboard: true, realLifecycleAndRestart: true, graphConfigurationUnchanged: true };
  await readonlyBookmarks(tools);
}

async function readonlyBookmarks({ evaluate, command, click, wait, afterReload, capture, report }) {
  const root = await evaluate("app.vault.rootPath"), url = await evaluate("location.href");
  const original = { main: { id: "readonly-bookmark-main", type: "split", direction: "vertical", children: [
    { id: "readonly-bookmark-tabs", type: "tabs", children: [{ id: "readonly-bookmarks", type: "leaf", state: { type: "bookmarks", state: {} } }] },
    { id: "readonly-bookmark-notes", type: "tabs", children: [{ id: "readonly-bookmark-note", type: "leaf", state: { type: "markdown", state: { file: "Folder/Note.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-bookmark-note" };
  const bookmarks = { future: "retained remote data", items: [{ type: "group", title: "Remote", ctime: 901, items: [
    { type: "graph", title: "Remote graph", ctime: 902, options: { search: "path:Folder", showOrphans: true } },
    { type: "folder", path: "Folder", ctime: 903 },
  ] }] };
  const fixture = await mountCachedGitHub(evaluate, "readonly-bookmarks", [
    ["Folder/Note.md", "# Cached note\n\nRemote bookmark graph.\n"], [".obsidian/workspace.json", JSON.stringify(original)],
    [".obsidian/bookmarks.json", JSON.stringify(bookmarks)], [".obsidian/core-plugins.json", '["bookmarks","graph","file-explorer","command-palette"]'], [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&Boolean(document.querySelector('[data-bookmark-pane="readonly-bookmarks"] [data-bookmark-address="0.0"]'))`);
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click('[data-bookmark-pane="readonly-bookmarks"] [data-bookmark-address="0.1"] [data-bookmark-action=open]');
  await wait('document.activeElement?.dataset.explorerPath==="Folder"');
  await click('[data-bookmark-pane="readonly-bookmarks"] [data-bookmark-address="0.0"] [data-bookmark-action=open]');
  await wait('app.workspace.activeLeaf.view.getViewType()==="graph"');
  const graphId = await evaluate("app.workspace.activeLeaf.id"), graph = `[data-graph-pane="${graphId}"]`;
  await wait(`document.querySelector('${graph} [data-graph-status]')?.dataset.graphComplete==="true"&&document.querySelector('${graph} [data-graph-status]').dataset.completedQuery==="path:Folder"`);
  assert.equal(await evaluate(`document.querySelector('${graph} [data-graph-status]').classList.contains("is-error")`), false);
  assert.equal(await evaluate(`document.querySelector('${graph} [data-graph-node]')?.dataset.graphPath`), "Folder/Note.md");
  await click('[data-bookmark-pane="readonly-bookmarks"] [data-bookmark-address="0"] [data-bookmark-action=fold]');
  await evaluate("app.workspace.flushLayout()");
  assert.equal(await evaluate('app.workspace.getLeafById("readonly-bookmarks").view.getState().collapsedGroups.length'), 1);
  const state = await evaluate("app.githubVaults.state()"); assert.equal(state.counters.api, 0); assert.equal(state.counters.raw, 0);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs); await capture("readonly");
  await command("Page.navigate", { url }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), root); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.bookmarksWorkflows.readOnly = { actualCacheOnlyMount: true, nativeGraphAndFolderTargets: true, localFoldPreferences: true, zeroNetwork: true, allBlobsUnchanged: true, returnedToLocal: true };
  report.checks.push("A genuine cache-only GitHub vault imports original graph/folder bookmarks, navigates actual Graph/Files views and retains folds locally, with zero GitHub requests and every remote content/configuration blob unchanged.");
}
