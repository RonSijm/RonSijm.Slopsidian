import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

const probeCode = `const {Plugin,ItemView}=require("obsidian");module.exports=class extends Plugin{onload(){this.addCommand({id:"set-note",name:"Set an Outline pane note",callback:async()=>{const view=this.app.workspace.getLeafById("outline-b").view;await view.setFile(this.app.vault.getFileByPath("Outline panes/Alpha.md"));globalThis.outlinePaneProbe={sameApp:view.app===this.app,isItemView:view instanceof ItemView,sameFile:view.file===this.app.vault.getFileByPath("Outline panes/Alpha.md"),factory:typeof this.app.internalPlugins.getPluginById("outline").views.outline==="function"};}});}};`;

export async function checkOutlinePanes({ directory, evaluate, command, click, press, wait, report, restart, afterReload, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); }, prefix = "Outline panes", alpha = prefix + "/Alpha.md", beta = prefix + "/Beta.md", moved = prefix + "/Moved.md", delayed = prefix + "/Delayed.md";
  const alphaText = ["---", "title: '# Hidden metadata'", "---", "# Alpha root", "", "Intro λ and 中文.", "", "## Branch", "", "#### Deep child", "", "## Repeat", "Text", "## Repeat", "Text", "", "Setext root", "===", "", "```md", "# Literal code", "```", "", "<!--", "# Hidden comment", "-->", ""].join("\r\n");
  const alphaBytes = Buffer.from("\ufeff" + alphaText), betaText = "# Beta root\n\n" + Array(32).fill("Reading filler before target.\n\n").join("") + "## Reading target\n\n" + Array(40).fill("Reading filler after target.\n\n").join("") + "## Last section\n\nEnd.\n", betaBytes = Buffer.from(betaText);
  const originalPath = join(directory, ".obsidian/workspace.json"), savedPath = join(directory, ".obsidian/vault-dotnet-workspace.json");
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()"); await mkdir(join(directory, prefix));
  await writeFile(join(directory, alpha), alphaBytes); await writeFile(join(directory, beta), betaBytes); await writeFile(join(directory, delayed), "# Old delayed\n\nOriginal slow result.\n");
  const probe = join(directory, ".obsidian/plugins/outline-pane-probe"); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, "manifest.json"), JSON.stringify({ id: "outline-pane-probe", name: "Outline pane probe", version: "1.0.0", minAppVersion: "1.0.0", author: "Slopsidian smoke", description: "Disposable actual Outline file/owner/factory probe.", isDesktopOnly: false })); await writeFile(join(probe, "main.js"), probeCode);
  const outline = (id, state) => ({ id, type: "leaf", pinned: true, state: { type: "outline", state: { file: alpha, followCursor: false, showSearch: false, searchQuery: "", opaque: { keep: id }, ...state } } });
  const note = (id, file, mode, source) => ({ id, type: "leaf", state: { type: "markdown", state: { file, mode, source } } });
  const original = { main: { id: "outline-main", type: "split", direction: "vertical", children: [
    { id: "outline-tabs", type: "tabs", dimension: 40, currentTab: 0, children: [outline("outline-a", {}), outline("outline-b", { file: beta, followActiveFile: false, showSearch: true, searchQuery: "target" })] },
    { id: "outline-note-tabs", type: "tabs", dimension: 60, currentTab: 0, children: [note("outline-alpha", alpha, "source", true), note("outline-beta", beta, "preview", false)] },
  ] }, active: "outline-alpha", left: { id: "outline-left", type: "split", direction: "horizontal", width: 220, collapsed: true, children: [] }, right: { id: "outline-right", type: "split", direction: "horizontal", width: 310, children: [{ id: "outline-side-tabs", type: "tabs", children: [outline("outline-side", { file: beta, followActiveFile: false, followCursor: true })] }] } };
  const sourceBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await restart(async () => { await writeFile(originalPath, sourceBytes); await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } }); });
  const pane = id => `[data-outline-pane="${id}"]`, titles = id => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(pane(id) + " .outline-heading")}),e=>e.textContent)`), state = id => evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).view.getState()`);
  const expectedAlpha = ["Alpha root", "Branch", "Deep child", "Repeat", "Repeat", "Setext root"], expectedBeta = ["Beta root", "Reading target", "Last section"];
  const expectTitles = async (id, expected) => wait(`JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(pane(id) + " .outline-heading")}),e=>e.textContent))===${JSON.stringify(JSON.stringify(expected))}`, "owned headings " + id);
  const heading = async (id, text, occurrence = 0) => {
    const line = await evaluate(`app.metadataCache.getDocument(app.workspace.getLeafById(${JSON.stringify(id)}).view.file.path).cache.headings.filter(h=>h.heading===${JSON.stringify(text)})[${occurrence}].position.start.line`);
    return pane(id) + ` [data-outline-line="${line}"]`;
  };
  const fold = async (id, text) => { const selector = await heading(id, text), key = await evaluate(`document.querySelector(${JSON.stringify(selector)}).closest("[data-outline-node]").dataset.outlineNode`); return pane(id) + " [data-outline-node=" + JSON.stringify(key) + "] [data-outline-fold]"; };
  const activate = async id => { await click(`[data-tab-id="${id}"]`); await wait(`app.workspace.activeLeaf.id===${JSON.stringify(id)}`); };
  await expectTitles("outline-a", expectedAlpha); await expectTitles("outline-b", ["Beta root", "Reading target"]); await expectTitles("outline-side", expectedBeta);
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-right]").getAttribute("aria-selected")'), "true");
  assert.equal((await state("outline-a")).file, alpha); assert.equal((await state("outline-side")).file, beta); assert.deepEqual((await state("outline-a")).opaque, { keep: "outline-a" }); assert.equal(await evaluate('app.workspace.getLeafById("outline-a").pinned'), true);
  assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes); await capture("imported");
  pass("A first-open original layout restores real main/sidebar Outline panes with independent note/filter/follow state, pins and opaque fields, alongside Source and Reading notes; parsed ATX/Setext headings exclude metadata, code and comments without changing BOM/CRLF/Unicode bytes.");

  await click(await fold("outline-a", "Branch")); await expectTitles("outline-a", expectedAlpha.filter(t => t !== "Deep child")); const folded = (await state("outline-a")).foldedHeadings;
  await click(`${pane("outline-a")} [data-outline-action=filter]`); await command("Input.insertText", { text: "DEEP" }); await expectTitles("outline-a", ["Alpha root", "Branch", "Deep child"]); assert.deepEqual((await state("outline-a")).foldedHeadings, folded);
  await click(`${pane("outline-a")} [data-outline-action=filter]`); await expectTitles("outline-a", expectedAlpha.filter(t => t !== "Deep child"));
  const branch = await heading("outline-a", "Branch"); await evaluate(`document.querySelector(${JSON.stringify(branch)}).closest("[data-outline-node]").focus()`); await press("ArrowRight", "ArrowRight", 39); await expectTitles("outline-a", expectedAlpha); await press("ArrowRight", "ArrowRight", 39);
  assert.equal(await evaluate('document.activeElement.querySelector(".outline-heading")?.textContent'), "Deep child"); await press("ArrowLeft", "ArrowLeft", 37); assert.equal(await evaluate('document.activeElement.querySelector(".outline-heading")?.textContent'), "Branch"); await press("Enter", "Enter", 13);
  const branchLine = await evaluate(`app.metadataCache.getDocument(${JSON.stringify(alpha)}).cache.headings.find(h=>h.heading==="Branch").position.start.line`); await wait(`app.workspace.getLeafById("outline-alpha").view.editor.getCursor().line===${branchLine}`);
  await click(`${pane("outline-a")} [data-outline-option=followCursor]`); await evaluate('app.workspace.getLeafById("outline-alpha").view.focus()'); await wait(`document.querySelector(${JSON.stringify(pane("outline-a") + ' [aria-current="location"] .outline-heading')})?.textContent==="Branch"`);
  assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes); assert.deepEqual(await titles("outline-side"), expectedBeta);
  pass("Real filtering retains ancestors and saved ordinary folds, keyboard arrows navigate the hierarchy and Enter reveals the exact Source heading. Active-heading following leaves editor focus and independent pinned-note panes intact.");

  await click(await heading("outline-side", "Reading target")); await wait('app.workspace.activeLeaf.id==="outline-beta"&&app.workspace.activeLeaf.view.getMode()==="preview"');
  await wait(`document.querySelector(${JSON.stringify(pane("outline-side") + ' [aria-current="location"] .outline-heading')})?.textContent==="Reading target"`, "Reading viewport follows revealed heading");
  await expectTitles("outline-a", expectedBeta); assert.equal((await state("outline-a")).file, beta); assert.equal(await evaluate('app.workspace.getLeafById("outline-beta").view.getMode()'), "preview"); assert.deepEqual(await readFile(join(directory, beta)), betaBytes);
  await click(`${pane("outline-a")} [data-outline-option=followActiveFile]`); await activate("outline-alpha"); await expectTitles("outline-a", expectedBeta);
  await click(`${pane("outline-a")} [data-outline-option=followActiveFile]`); await expectTitles("outline-a", expectedAlpha); assert.equal((await state("outline-side")).file, beta);
  pass("Pinned-note navigation activates an existing Reading pane and reveals/highlights its real heading without changing mode or bytes. Follow active note switches targets; turning it off retains an independent note until following resumes.");

  await activate("outline-alpha");
  await evaluate(`(()=>{const view=app.workspace.getLeafById("outline-alpha").view;view.editor.setCursor({line:3,ch:0});view.editor.replaceRange("Inserted prefix\\n",{line:3,ch:0});globalThis.outlineStaleCursor=view.editor.getCursor();document.querySelector(${JSON.stringify(await heading("outline-a", "Branch"))}).click();})()`);
  await expectTitles("outline-a", expectedAlpha); assert.deepEqual(await evaluate('app.workspace.getLeafById("outline-alpha").view.editor.getCursor()'), await evaluate("outlineStaleCursor")); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await click(await fold("outline-a", "Branch")); const keys = (await state("outline-a")).foldedHeadings;
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("outline-alpha"));app.workspace.activeLeaf.view.focus()'); await press("z", "KeyZ", 90, 2); await wait(`app.workspace.getLeafById("outline-alpha").view.editor.getValue()===${JSON.stringify(alphaText)}`); await wait(`JSON.stringify(app.workspace.getLeafById("outline-a").view.getState().foldedHeadings)===${JSON.stringify(JSON.stringify(keys))}`);
  await wait(`document.querySelector(${JSON.stringify(pane("outline-a") + ' [data-outline-line="' + branchLine + '"]')})?.textContent==="Branch"`, "undo restores the original heading source line");
  await press("y", "KeyY", 89, 2); await evaluate("app.notifyEditor()"); await wait(`document.querySelector(${JSON.stringify(pane("outline-a") + ' [data-outline-line="' + (branchLine + 1) + '"]')})?.textContent==="Branch"`, "redo restores the shifted heading source line"); assert.deepEqual((await state("outline-a")).foldedHeadings, keys); await evaluate("app.saveAll()");
  const savedAlpha = await readFile(join(directory, alpha)); await writeFile(join(directory, alpha), Buffer.concat([savedAlpha, Buffer.from("\r\n## External heading\r\n")])); await evaluate("app.metadataCache.refresh()"); await wait(`Array.from(document.querySelectorAll(${JSON.stringify(pane("outline-a") + " .outline-heading")})).some(e=>e.textContent==="External heading")`, "external heading update");
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(beta)}),${JSON.stringify(moved)},true)`); await wait(`app.workspace.getLeafById("outline-side").view.getState().file===${JSON.stringify(moved)}&&!app.workspace.isChangingFiles`); await expectTitles("outline-side", expectedBeta);
  pass("An immediate stale heading click after a real editor transaction refuses obsolete navigation. Dirty undo/redo and inserted lines retain fold identity; genuine external writes refresh headings and guarded rename remaps fixed-note panes without touching the original workspace.");

  await setCommunityPluginEnabled({ evaluate, click, wait }, "outline-pane-probe", true); await click(".settings-close"); await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open'); await command("Input.insertText", { text: "Set an Outline pane note" }); await click('[data-command-id="outline-pane-probe:set-note"]');
  await wait('Boolean(globalThis.outlinePaneProbe)'); assert.deepEqual(await evaluate("outlinePaneProbe"), { sameApp: true, isItemView: true, sameFile: true, factory: true }); assert.equal((await state("outline-b")).file, alpha); assert.equal((await state("outline-b")).followActiveFile, false);
  const invalid = await evaluate('(async()=>{const v=app.workspace.getLeafById("outline-a").view,before=JSON.stringify(v.getState());let refused=false;try{await v.setState({...v.getState(),followCursor:"yes"},{})}catch{refused=true}return{refused,same:JSON.stringify(v.getState())===before};})()'); assert.deepEqual(invalid, { refused: true, same: true });
  pass("An enabled fixture plugin uses real ItemView/App/file/factory contracts and the guarded setFile method through its palette command. Malformed state refuses atomically without changing the live pane or reporting an unhandled error.");

  await evaluate(`(()=>{globalThis.closedOutline=app.workspace.getLeafById("outline-a").view;globalThis.closedOutlineFollow=closedOutline.contentEl.querySelector("[data-outline-option=followActiveFile]");globalThis.originalOutlineGetDocument=app.metadataCache.getDocument;globalThis.originalOutlineRead=app.vault.read;
    app.metadataCache.getDocument=function(path){return path===${JSON.stringify(delayed)}?null:originalOutlineGetDocument.call(this,path);};
    app.vault.read=async function(file){const text=await originalOutlineRead.call(this,file);if(file.path===${JSON.stringify(delayed)}){globalThis.outlineReadStarted=true;await new Promise(resolve=>globalThis.releaseOutlineRead=resolve);}return text;};
    globalThis.outlinePendingRead=closedOutline.setFile(app.vault.getFileByPath(${JSON.stringify(delayed)}));})()`); await wait("globalThis.outlineReadStarted===true", "actual file read held before completion");
  const beforeDisable = await state("outline-a"); await evaluate('app.core.setEnabled("outline",false)'); assert.equal(await evaluate('app.workspace.getLeavesOfType("outline").length'), 0); assert.equal(await evaluate('!closedOutline.isLoaded&&!closedOutline.containerEl.isConnected'), true); assert.deepEqual(await state("outline-a"), beforeDisable);
  await evaluate('closedOutlineFollow.checked=true;closedOutlineFollow.dispatchEvent(new Event("change",{bubbles:true}));app.metadataCache.getDocument=originalOutlineGetDocument;app.vault.read=originalOutlineRead;true'); assert.deepEqual(await state("outline-a"), beforeDisable);
  await writeFile(join(directory, delayed), "# Fresh delayed\n\nA newer physical note.\n"); await evaluate("app.metadataCache.refresh()"); await evaluate('app.core.setEnabled("outline",true)'); await expectTitles("outline-a", ["Fresh delayed"]);
  await evaluate('(async()=>{releaseOutlineRead();await outlinePendingRead;})()'); await expectTitles("outline-a", ["Fresh delayed"]); assert.equal(await evaluate('app.workspace.getLeafById("outline-a").view!==closedOutline'), true);
  const staleApi = await evaluate(`(async()=>{try{await closedOutline.setFile(app.vault.getFileByPath(${JSON.stringify(alpha)}));return false}catch{return true}})()`); assert.equal(staleApi, true);
  pass("Disabling Outline unloads owners/handlers and retains exact unavailable state without waiting on a held real read. Fresh owners use newer physical content after re-enable; releasing the old read, detached controls and stale API calls cannot replace or retarget them.");

  await click(await fold("outline-side", "Beta root")); assert.equal((await state("outline-side")).foldedHeadings.length, 1);
  await evaluate("app.workspace.flushLayout()"); const states = await evaluate('["outline-a","outline-b","outline-side"].map(id=>app.workspace.getLeafById(id).view.getState())'); await restart();
  assert.deepEqual(await evaluate('["outline-a","outline-b","outline-side"].map(id=>app.workspace.getLeafById(id).view.getState())'), states); await expectTitles("outline-a", ["Fresh delayed"]); await expectTitles("outline-side", ["Beta root"]); assert.deepEqual(await readFile(originalPath), sourceBytes);
  await click('[data-sidebar-view=outline]'); await evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await evaluate('document.querySelector("[data-sidebar-view=outline]").getAttribute("aria-selected")'), "true");
  await click('[data-sidebar-view=workspace-right]'); await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open'); await command("Input.insertText", { text: "Open Outline in a tab" }); await click('[data-command-id="outline:open-view"]'); await wait('app.workspace.activeLeaf.view.getViewType()==="outline"'); await capture("restored");
  pass("Full restart or actual-folder reconnection restores independent targets/filters/folds and original workspace bytes. An explicit legacy sidebar choice wins on later reopen; the command palette creates another real Outline tab.");
  report.outlinePanes = { fixturePlugin: "outline-pane-probe 1.0.0; host contracts only", originalBytesPreserved: true, actualReadOwnership: true, independentStateRestored: true };
  await readonlyOutline({ evaluate, command, click, wait, report, afterReload, capture }); assert.deepEqual(await readFile(originalPath), sourceBytes);
}

async function readonlyOutline({ evaluate, command, click, wait, report, afterReload, capture }) {
  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href");
  const original = { main: { id: "readonly-outline-main", type: "split", direction: "vertical", children: [
    { id: "readonly-outline-tabs", type: "tabs", dimension: 40, children: [{ id: "readonly-outline", type: "leaf", state: { type: "outline", state: { file: "Folder/Note.md", followActiveFile: false } } }] },
    { id: "readonly-outline-note-tabs", type: "tabs", dimension: 60, children: [{ id: "readonly-outline-note", type: "leaf", state: { type: "markdown", state: { file: "Folder/Note.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-outline-note" };
  const fixture = await mountCachedGitHub(evaluate, "readonly-outline", [["Folder/Note.md", "# Cached outline\n\n## Remote target\n\nRead-only text.\n"], [".obsidian/workspace.json", JSON.stringify(original)], [".obsidian/core-plugins.json", '["outline","command-palette"]'], [".obsidian/community-plugins.json", "[]"]]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&document.querySelectorAll('[data-outline-pane="readonly-outline"] .outline-heading').length===2`, "genuine cached GitHub Outline import"); assert.equal(await evaluate("app.vault.readOnly"), true);
  await click('[data-outline-pane=readonly-outline] [data-outline-line="2"]'); await wait('app.workspace.getLeafById("readonly-outline-note").view.editor.getCursor().line===2'); assert.equal(await evaluate('app.workspace.getLeafById("readonly-outline-note").view.editor.cm.contentDOM.contentEditable'), "false");
  await click('[data-outline-pane=readonly-outline] [data-outline-action=collapse]'); await evaluate("app.workspace.flushLayout()"); assert.equal(await evaluate('app.workspace.getLeafById("readonly-outline").view.getState().foldedHeadings.length'), 1);
  const state = await evaluate("app.githubVaults.state()"); assert.equal(state.counters.api, 0); assert.equal(state.counters.raw, 0); await assertCachedBlobsUnchanged(evaluate, fixture.blobs); await capture("readonly");
  await command("Page.navigate", { url: pageUrl }); await afterReload(); assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  report.outlinePanes.readOnly = { genuineCacheOnlyMount: true, exactHeadingNavigation: true, preferencesIndependent: true, zeroNetwork: true, allBlobsUnchanged: true, returnedToLocal: true };
  report.checks.push("A genuine cache-only GitHub vault imports a real Outline, reveals an exact read-only heading and saves view folds independently, with zero network requests and every content/configuration blob unchanged through return to the local vault.");
}
