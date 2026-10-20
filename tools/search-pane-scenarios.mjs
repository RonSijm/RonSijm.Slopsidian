import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

const probeCode = `const {Plugin,ItemView}=require("obsidian");module.exports=class extends Plugin{onload(){this.addCommand({id:"set-query",name:"Set a workspace search query",callback:()=>{const leaf=this.app.workspace.getLeafById("search-a"),view=leaf.view;globalThis.searchPaneProbe={sameApp:view.app===this.app,isItemView:view instanceof ItemView,realInput:view.inputEl instanceof HTMLInputElement,factory:typeof this.app.internalPlugins.getPluginById("global-search").views.search==="function"};view.setQuery('path:"Search panes" searchneedle');}});}};`;

export async function checkSearchPanes({ directory, evaluate, command, click, press, wait, report, restart, afterReload, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const prefix = "Search panes", alpha = prefix + "/Note 2.md", beta = prefix + "/Note 10.md", moved = prefix + "/Moved.md";
  const alphaBytes = Buffer.from('\ufeff---\r\nstatus: active\r\ntags: [searchdemo/project]\r\n---\r\n# Note 2\r\n\r\nPrefix context line.\r\nSearchNeedle α <img src=x onerror=globalThis.searchInjected=1>\r\nSuffix context line.\r\nA lowercase searchneedle.\r\n');
  const betaBytes = Buffer.from('---\nstatus: paused\ntags: [searchdemo]\n---\n# Note 10\n\nsearchneedle beta.\n');
  const originalPath = join(directory, ".obsidian/workspace.json"), savedPath = join(directory, ".obsidian/vault-dotnet-workspace.json");
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()"); await mkdir(join(directory, prefix));
  await writeFile(join(directory, alpha), alphaBytes); await writeFile(join(directory, beta), betaBytes);
  const probe = join(directory, ".obsidian/plugins/search-pane-probe"); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, "manifest.json"), JSON.stringify({ id: "search-pane-probe", name: "Search pane probe", version: "1.0.0", minAppVersion: "1.0.0", author: "Slopsidian smoke", description: "Disposable real Search view API probe.", isDesktopOnly: false })); await writeFile(join(probe, "main.js"), probeCode);
  const query = 'path:"Search panes" searchneedle', sideQuery = '[status:active] tag:searchdemo';
  const search = (id, state) => ({ id, type: "leaf", pinned: true, state: { type: "search", state: { query, matchingCase: false, explainSearch: false, collapseAll: false, extraContext: false, sortOrder: "alphabetical", opaque: { keep: id }, ...state } } });
  const original = { main: { id: "search-main", type: "split", direction: "vertical", children: [
    { id: "search-tabs", type: "tabs", dimension: 40, currentTab: 0, children: [search("search-a", {}), search("search-b", { query: 'path:"Search panes" SearchNeedle', matchingCase: true })] },
    { id: "search-note-tabs", type: "tabs", dimension: 60, children: [{ id: "search-note", type: "leaf", state: { type: "markdown", state: { file: alpha, mode: "source", source: true } } }] },
  ] }, active: "search-note", left: { id: "search-left", type: "split", direction: "horizontal", width: 310, children: [{ id: "search-side-tabs", type: "tabs", children: [search("search-side", { query: sideQuery, collapseAll: true, extraContext: true })] }] }, right: { id: "search-right", type: "split", direction: "horizontal", width: 220, collapsed: true, children: [] } };
  const sourceBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await restart(async () => { await writeFile(originalPath, sourceBytes); await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } }); });
  const pane = id => `[data-search-pane="${id}"]`, input = id => pane(id) + " [data-search-query]", status = id => pane(id) + " [data-search-status]";
  const paths = id => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(pane(id) + " [data-search-file]")}),e=>e.dataset.searchFile)`);
  const state = id => evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).view.getState()`);
  const complete = async (id, query) => wait(`document.querySelector(${JSON.stringify(status(id))})?.dataset.searchComplete==="true"&&document.querySelector(${JSON.stringify(status(id))}).dataset.completedQuery===${JSON.stringify(query)}&&!document.querySelector(${JSON.stringify(status(id))}).classList.contains("is-error")`, "completed owned search " + id);
  const fill = async (selector, text) => { await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text }); };
  const searchFor = async (id, query, expected) => { await fill(input(id), query); await press("Enter", "Enter", 13); await complete(id, query); assert.deepEqual(await paths(id), expected); };
  await complete("search-a", query); await complete("search-b", 'path:"Search panes" SearchNeedle'); await complete("search-side", sideQuery);
  assert.deepEqual(await paths("search-a"), [alpha, beta]); assert.deepEqual(await paths("search-b"), [alpha]); assert.deepEqual(await paths("search-side"), [alpha]);
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-left]").getAttribute("aria-selected")'), "true");
  assert.deepEqual((await state("search-a")).opaque, { keep: "search-a" }); assert.equal(await evaluate('app.workspace.getLeafById("search-a").pinned'), true);
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(pane("search-a") + " .discovery-results img")}))||Boolean(globalThis.searchInjected)`), false);
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(pane("search-a") + " .discovery-results")}).textContent.includes("<img src=x")`));
  pass("An original first-open layout restores real main/sidebar Search views with independent query/case/fold/context state, pins and opaque fields; worker results render literal note content safely alongside a BOM/CRLF Source note."); await capture("imported");

  await click(`${pane("search-a")} [data-search-file=${JSON.stringify(alpha)}] [data-search-match]`);
  await wait('app.workspace.getLeafById("search-note").view.editor.getSelection()==="SearchNeedle"', "exact source match selection");
  assert.equal(await evaluate('app.workspace.getLeafById("search-a").view.getViewType()'), "search"); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await click(`${pane("search-a")} [data-search-fold=${JSON.stringify(alpha)}]`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pane("search-a") + ' [data-search-file="' + alpha + '"] .search-result-contexts')}).hidden`), true);
  await click(`${pane("search-a")} [data-search-collapse-all]`); await click(`${pane("search-a")} [data-search-fold=${JSON.stringify(alpha)}]`);
  assert.deepEqual((await state("search-a")).expandedFiles, [alpha]); assert.equal((await state("search-side")).collapseAll, true);
  await click(`${pane("search-a")} [data-search-collapse-all]`);
  await click(`${pane("search-a")} [data-search-option=extraContext]`);
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(pane("search-a") + ' [data-search-file="' + alpha + '"] [data-search-match]')}).textContent.includes("Prefix context line.")`));
  await click(`${pane("search-a")} [data-search-option=explainSearch]`); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pane("search-a") + " .search-syntax")}).hidden`), false);
  await click(`${pane("search-a")} select`); await press("Home", "Home", 36); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13); await wait('app.workspace.getLeafById("search-a").view.getState().sortOrder==="alphabeticalReverse"'); assert.deepEqual(await paths("search-a"), [beta, alpha]);
  await click(`${pane("search-a")} select`); await press("Home", "Home", 36); await press("Enter", "Enter", 13);
  pass("Actual result clicks select exact source text without replacing the pinned Search pane or writing notes. Per-file/global folds, exceptions, extra context, syntax help and real keyboard sorting remain independent across panes.");

  await searchFor("search-a", 'file:"Note 10.md" searchneedle', [beta]); await searchFor("search-a", '[status:active] tag:searchdemo', [alpha]);
  await fill(input("search-a"), "/[/"); await press("Enter", "Enter", 13); await wait(`document.querySelector(${JSON.stringify(status("search-a"))}).classList.contains("is-error")&&document.querySelector(${JSON.stringify(status("search-a"))}).dataset.searchComplete==="true"`, "invalid query explained inline"); assert.deepEqual(await paths("search-a"), []);
  await fill(input("search-a"), "file:no-such-note"); await fill(input("search-a"), query); await press("Enter", "Enter", 13); await complete("search-a", query); assert.deepEqual(await paths("search-a"), [alpha, beta]);
  assert.deepEqual(await paths("search-b"), [alpha]);
  pass("Workspace queries execute real file/property/tag syntax, reject invalid regex inline with no stale results, and replace rapidly superseded queries without affecting another pane.");

  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("search-note"));const e=app.workspace.activeLeaf.view.editor;e.setCursor(e.offsetToPos(e.getValue().length));app.workspace.activeLeaf.view.focus()');
  await command("Input.insertText", { text: "\nunsavedneedle" }); await searchFor("search-a", "unsavedneedle", [alpha]); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await evaluate('app.workspace.getLeafById("search-note").view.focus()'); await press("z", "KeyZ", 90, 2); await complete("search-a", "unsavedneedle"); await wait(`document.querySelectorAll(${JSON.stringify(pane("search-a") + " [data-search-file]")}).length===0`, "dirty undo updates search");
  await press("y", "KeyY", 89, 2); await wait(`document.querySelectorAll(${JSON.stringify(pane("search-a") + " [data-search-file]")}).length===1`, "dirty redo updates search"); await evaluate("app.saveAll()");
  await searchFor("search-a", "externalneedle", []); await writeFile(join(directory, beta), betaBytes.toString() + "\nexternalneedle\n"); await evaluate("app.metadataCache.refresh()"); await wait(`document.querySelector(${JSON.stringify(pane("search-a") + ' [data-search-file="' + beta + '"]')})`, "genuine external text update");
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(beta)}),${JSON.stringify(moved)},true)`); await wait(`document.querySelector(${JSON.stringify(pane("search-a") + ' [data-search-file="' + moved + '"]')})&&!app.workspace.isChangingFiles`, "guarded rename updates search paths");
  pass("Search follows genuine dirty text, undo/redo, external byte replacement and guarded rename, preserving original disk bytes until explicit save and updating the actual result paths.");

  await setCommunityPluginEnabled({ evaluate, click, wait }, "search-pane-probe", true); await click(".settings-close");
  await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open'); await command("Input.insertText", { text: "Set a workspace search query" }); await click('[data-command-id="search-pane-probe:set-query"]'); await complete("search-a", query);
  assert.deepEqual(await evaluate("searchPaneProbe"), { sameApp: true, isItemView: true, realInput: true, factory: true }); assert.deepEqual(await paths("search-a"), [moved, alpha]);
  const invalid = await evaluate('(async()=>{const v=app.workspace.getLeafById("search-a").view,before=v.getState();let refused=false;try{await v.setState({...before,sortOrder:"constructor"},{})}catch{refused=true}return{refused,same:JSON.stringify(v.getState())===JSON.stringify(before),query:v.inputEl.value};})()'); assert.equal(invalid.refused, true); assert.equal(invalid.same, true); assert.equal(invalid.query, query);
  pass("An enabled fixture plugin uses real ItemView/App/input/factory contracts and setQuery through its actual palette command. Malformed state refuses atomically without changing live query/state or reporting an unhandled error.");

  await evaluate(`(()=>{globalThis.searchOriginalWorker=Worker;globalThis.searchHeld=[];globalThis.searchWorkerRecords=[];Worker=class extends searchOriginalWorker{
    constructor(url,options){super(url,options);this.searchRecord={search:new URL(url,document.baseURI).pathname.endsWith("/js/search-worker.js"),stopped:false};searchWorkerRecords.push(this.searchRecord);}
    set onmessage(callback){super.onmessage=!callback||!this.searchRecord.search?callback:event=>{if(event.data?.ready)searchHeld.push(()=>callback.call(this,event));else callback.call(this,event);};}
    get onmessage(){return super.onmessage;}
    terminate(){this.searchRecord.stopped=true;return super.terminate();}
  };globalThis.closedSearch=app.workspace.getLeafById("search-a").view;globalThis.closedSearchInput=closedSearch.inputEl;})()`);
  await fill(input("search-a"), "externalneedle"); await press("Enter", "Enter", 13); await wait('searchHeld.length>0', "real worker readiness held for lifecycle test"); const beforeDisable = await state("search-a");
  await evaluate('app.core.setEnabled("global-search",false)'); assert.equal(await evaluate('app.workspace.getLeavesOfType("search").length'), 0); assert.equal(await evaluate('app.workspace.getLeafById("search-a").view.getViewType()'), "unavailable"); assert.deepEqual(await state("search-a"), beforeDisable);
  assert.equal(await evaluate('searchWorkerRecords.filter(r=>r.search).every(r=>r.stopped)'), true); assert.equal(await evaluate('!closedSearch.isLoaded&&!closedSearch.containerEl.isConnected'), true);
  await evaluate('closedSearchInput.value="stale";closedSearchInput.dispatchEvent(new Event("input",{bubbles:true}));globalThis.staleQueryRefused=false;try{closedSearch.setQuery("stale")}catch{staleQueryRefused=true}Worker=searchOriginalWorker;true'); assert.equal(await evaluate("staleQueryRefused"), true); assert.deepEqual(await state("search-a"), beforeDisable);
  await evaluate('app.core.setEnabled("global-search",true)'); await complete("search-a", "externalneedle"); await evaluate('searchHeld.forEach(release=>release());true'); assert.deepEqual(await paths("search-a"), [moved]); assert.deepEqual(await state("search-a"), beforeDisable);
  pass("Disabling Search terminates actual pending workers, unloads views/handlers and retains exact unavailable state. Detached controls and stale API calls cannot act; re-enable creates fresh owners and delayed old callbacks cannot replace their results.");

  await evaluate("app.workspace.flushLayout()"); const states = await evaluate('["search-a","search-b","search-side"].map(id=>app.workspace.getLeafById(id).view.getState())'); await restart();
  assert.deepEqual(await evaluate('["search-a","search-b","search-side"].map(id=>app.workspace.getLeafById(id).view.getState())'), states); await complete("search-a", "externalneedle"); assert.deepEqual(await paths("search-a"), [moved]); assert.deepEqual(await readFile(originalPath), sourceBytes);
  await click('[data-sidebar-view=search]'); await evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await evaluate('document.querySelector("[data-sidebar-view=search]").getAttribute("aria-selected")'), "true");
  await click('[data-sidebar-view=workspace-left]'); await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open'); await command("Input.insertText", { text: "Open Search in a tab" }); await click('[data-command-id="global-search:open-view"]'); await wait('app.workspace.activeLeaf.view.getViewType()==="search"', "actual new Search command");
  await capture("restored"); pass("Native process restart or actual-folder browser reconnection restores independent Search state, results and original workspace bytes. Explicit legacy sidebar choice wins later, and the palette creates a fresh Search tab.");
  report.searchPanes = { fixturePlugin: "search-pane-probe 1.0.0; host contract only", originalBytesPreserved: true, actualWorkerCancellation: true, independentStateRestored: true };
  await readonlySearch({ evaluate, command, click, wait, report, afterReload, capture }); assert.deepEqual(await readFile(originalPath), sourceBytes);
}

async function readonlySearch({ evaluate, command, click, wait, report, afterReload, capture }) {
  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href");
  const original = { main: { id: "remote-main", type: "split", direction: "vertical", children: [
    { id: "remote-search-tabs", type: "tabs", dimension: 40, children: [{ id: "remote-search", type: "leaf", state: { type: "search", state: { query: "readonlyneedle" } } }] },
    { id: "remote-note-tabs", type: "tabs", dimension: 60, children: [{ id: "remote-note", type: "leaf", state: { type: "markdown", state: { file: "Folder/Note.md", mode: "source", source: true } } }] },
  ] }, active: "remote-note" };
  const fixture = await mountCachedGitHub(evaluate, "readonly-search", [["Folder/Note.md", "# Cached\n\nreadonlyneedle\n"], [".obsidian/workspace.json", JSON.stringify(original)], [".obsidian/core-plugins.json", '["global-search","command-palette"]'], [".obsidian/community-plugins.json", "[]"]]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&document.querySelector('[data-search-pane="remote-search"] [data-search-file="Folder/Note.md"]')`, "genuine cached GitHub search result");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click('[data-search-pane=remote-search] [data-search-match]'); await wait('app.workspace.getLeafById("remote-note").view.editor.getSelection()==="readonlyneedle"'); assert.equal(await evaluate('app.workspace.getLeafById("remote-note").view.editor.cm.contentDOM.contentEditable'), "false");
  await click('[data-search-pane=remote-search] [data-search-collapse-all]'); await evaluate("app.workspace.flushLayout()"); assert.equal(await evaluate('app.workspace.getLeafById("remote-search").view.getState().collapseAll'), true);
  const state = await evaluate("app.githubVaults.state()"); assert.equal(state.counters.api, 0); assert.equal(state.counters.raw, 0); await assertCachedBlobsUnchanged(evaluate, fixture.blobs); await capture("readonly");
  await command("Page.navigate", { url: pageUrl }); await afterReload(); assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  report.searchPanes.readOnly = { genuineCacheOnlyMount: true, exactSourceSelection: true, preferencesIndependent: true, zeroNetwork: true, allBlobsUnchanged: true, returnedToLocal: true };
  report.checks.push("A genuine cache-only GitHub vault imports a real Search pane, queries indexed cached text, selects an exact read-only source match and saves view preferences independently, with zero network requests and every remote blob unchanged.");
}
