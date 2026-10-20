import assert from "node:assert/strict";
import { openExplorerOptions } from "./explorer-options-scenarios.mjs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const pane = id => `[data-file-explorer=${q(id)}]`;
const row = (id, path) => pane(id) + ` [data-explorer-path=${q(path)}]`;
const action = (id, name) => pane(id) + ` [data-explorer-action=${q(name)}]`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
const selected = id => `(()=>[...document.querySelectorAll(${q(pane(id) + ' [data-explorer-selected="true"]')})].map(row=>row.dataset.explorerPath))()`;
const sourcePaths = "app.workspace.getLeavesOfType('markdown').map(leaf=>({id:leaf.id,path:leaf.view.file?.path}))";
const live = id => `app.workspace.getLeafById(${q(id)})?.view.getViewType()==="file-explorer"&&!document.querySelector(${q(pane(id) + " select")})?.disabled`;
const readOnlyState = id => `(()=>{const leaf=app.workspace.getLeafById(${q(id)}),view=leaf?.view,root=document.querySelector(${q(pane(id))}),sort=root?.querySelector("select");return{core:{enabled:app.core.isEnabled("file-explorer"),busy:app.core.busy,provider:typeof app.workspace.registeredViewCreators?.["file-explorer"]==="function"},workspace:{changingVault:app.changingVault,changingFiles:app.workspace.isChangingFiles,changingLayout:app.workspace.isChangingLayout,restoring:app.workspace.restoring,layoutReady:app.workspace.layoutReady,active:app.workspace.activeLeaf?.id},owner:{leaf:leaf?.id,type:view?.getViewType(),state:view?.getState(),loaded:view?.isLoaded,connected:view?.containerEl.isConnected,sourceRoot:view?.sourceRoot,currentRoot:app.vault.rootPath,currentDocument:view?.containerEl.ownerDocument===document,refreshing:view?.refreshing,openingSelection:Boolean(view?.openingSelection)},dom:{root:Boolean(root),sort:Boolean(sort),sortDisabled:sort?.disabled,containerInert:leaf?.containerEl.inert,ancestorInert:Boolean(root?.closest("[inert]")),rows:root?.querySelectorAll("[data-explorer-path]").length,controls:[...root?.querySelectorAll("[data-explorer-action]")??[]].map(button=>({action:button.dataset.explorerAction,disabled:button.disabled,hidden:button.hidden})),status:root?.querySelector("[role=status]")?.textContent},clientErrors:document.querySelector("#client-errors")?.textContent?.slice(0,2000),metadataError:String(app.metadataCache.error??""),layout:app.workspace.getLayout()}})()`;

async function filter(tools, id, text) {
  const selector = pane(id) + " [data-explorer-search]";
  await tools.click(selector); await tools.press("a", "KeyA", 65, 2);
  if (text) await tools.command("Input.insertText", { text }); else await tools.press("Backspace", "Backspace", 8);
  await tools.wait(`document.querySelector(${q(selector)})?.value===${q(text)}`, "Files filter reaches the requested visible paths");
}
async function mode(tools, id, expected = true) {
  if (await tools.evaluate(`document.querySelector(${q(action(id, "select-notes"))})?.getAttribute("aria-pressed")!==${q(String(expected))}`)) { await openExplorerOptions(tools, pane(id)); await tools.click(action(id, "select-notes")); }
  await tools.wait(`document.querySelector(${q(pane(id) + " [role=tree]")})?.getAttribute("aria-multiselectable")===${q(String(expected))}`, "Files note selection mode");
}
async function expectSelection(tools, id, paths) {
  await tools.wait(`${selected(id)}.join("\\0")===${q(paths.join("\0"))}`, "exact visible selected-note group");
  assert.deepEqual(await tools.evaluate(selected(id)), paths);
}
async function clear(tools, id) {
  if ((await tools.evaluate(selected(id))).length) { await tools.click(action(id, "clear-selection")); }
  await expectSelection(tools, id, []);
}

/** Real Files panes select visible Markdown identities, then open a reviewed group without writes. */
export async function checkFileSelection(tools) {
  const { directory, evaluate, click, press, command, wait, report, capture, restart, afterReload } = tools;
  const folder = "File selection", base = folder + "/Notes", main = "file-selection-main", peer = "file-selection-peer", side = "file-selection-side", note = "file-selection-note";
  const paths = [base + "/Note 2.md", base + "/Note 10.md", base + "/Note 30.md"], hidden = base + "/Nested/Hidden.md", renamed = base + "/Renamed.md";
  const sources = new Map(paths.map((path, index) => [path, Buffer.from("\ufeff# Note " + [2, 10, 30][index] + "\r\n\r\nOriginal λ 😀 prose.\r\n")]));
  sources.set(hidden, Buffer.from("\ufeff# Hidden\r\n\r\nRetain nested prose.\r\n")); sources.set(base + "/Unsupported.bin", Buffer.from([0, 1, 255, 3]));
  const bounds = Array.from({ length: 65 }, (_, index) => folder + "/Bounds/Note " + String(index).padStart(2, "0") + ".md");
  for (const path of bounds) { sources.set(path, Buffer.from("# Bounded note\r\n")); }
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const previous = await evaluate("app.workspace.getLayout()"), sidebar = await evaluate('app.workspace.getViewOptions("sidebars")'), enabled = await evaluate('app.core.isEnabled("file-explorer")'), autosave = await evaluate("app.markdownAutosave.enabled");
  if (!enabled) await evaluate('app.core.setEnabled("file-explorer",true)');
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  for (const path of sources.keys()) { await mkdir(join(directory, path.slice(0, path.lastIndexOf("/"))), { recursive: true }); await writeFile(join(directory, path), sources.get(path), { flag: "wx" }); }
  const explorer = id => ({ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true, searchQuery: base, opaque: { retain: id } } } });
  const layout = { version: 1, main: { id: "file-selection-root", type: "split", direction: "vertical", children: [
    { id: "file-selection-files-tabs", type: "tabs", dimension: 55, currentTab: 0, children: [explorer(main), explorer(peer)] },
    { id: "file-selection-note-tabs", type: "tabs", dimension: 45, currentTab: 0, children: [{ id: note, type: "leaf", state: { type: "markdown", pinned: true, state: { file: paths[0], mode: "source", source: true } } }] },
  ] }, active: main, left: { width: 280, collapsed: false, root: { id: "file-selection-left", type: "split", direction: "horizontal", children: [{ id: "file-selection-side-tabs", type: "tabs", currentTab: 0, children: [explorer(side)] }] } } };
  const mount = async () => {
    await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});app.sidebars.show("workspace-left");await app.workspace.flushLayout()})()`);
    await wait(live(main), "three actual Files views and a live Source note");
    await wait(`Boolean(document.querySelector(${q(row(main, paths[2]))}))`, "visible selection note fixtures");
  };
  let failure;
  try {
    await mount();
    assert.equal(await evaluate(`document.querySelector(${q(action(main, "select-notes"))}).getAttribute("aria-pressed")`), "false");
    assert.equal(await evaluate(`document.querySelector(${q(action(main, "open-selected"))}).hidden`), true);
    const beforeOrdinary = await evaluate(sourcePaths);
    await click(row(main, paths[1]), 2); await wait(`app.workspace.getActiveFile()?.path===${q(paths[1])}`, "ordinary Ctrl-click keeps opening a new tab");
    assert.equal((await evaluate(sourcePaths)).length, beforeOrdinary.length + 1);
    await click('[data-tab-id="file-selection-main"]');
    await evaluate(`document.querySelector(${q(row(main, paths[2]))}).focus()`); await press("Enter", "Enter", 13);
    await wait(`app.workspace.getActiveFile()?.path===${q(paths[2])}`, "ordinary Enter keeps opening the focused file");
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(main)}).view.getViewType()`), "file-explorer");
    await click('[data-tab-id="file-selection-main"]');
    pass(report, "Normal Files navigation retains Ctrl-click new-tab opening and Enter activation outside the explicit Select notes mode, with the pinned Files owner and exact source fixtures intact.");

    await mode(tools, main); await click(row(main, paths[0])); await click(row(main, paths[1]), 2); await expectSelection(tools, main, paths.slice(0, 2));
    await click(row(main, paths[0]), 2); await expectSelection(tools, main, [paths[1]]);
    await click(row(main, paths[0])); await click(row(main, paths[2]), 8); await expectSelection(tools, main, paths);
    await evaluate(`document.querySelector(${q(row(main, paths[0]))}).focus()`); await press(" ", "Space", 32); await expectSelection(tools, main, paths.slice(1));
    await press(" ", "Space", 32); await expectSelection(tools, main, paths);
    await press("ArrowDown", "ArrowDown", 40, 8); await expectSelection(tools, main, paths.slice(0, 2));
    await click('[data-tab-id="file-selection-peer"]'); await mode(tools, peer); await click(row(peer, paths[2])); await expectSelection(tools, peer, [paths[2]]);
    await click('[data-tab-id="file-selection-main"]'); await expectSelection(tools, main, paths.slice(0, 2));
    await mode(tools, side); await click(row(side, hidden)); await expectSelection(tools, side, [hidden]); await expectSelection(tools, main, paths.slice(0, 2));
    assert.equal(await evaluate(`document.querySelector(${q(pane(main) + ' [data-explorer-path="' + base + '/Unsupported.bin"]')}).getAttribute("aria-selected")`), "false");
    await capture?.("file-selection");
    pass(report, "Actual main, peer-tab and sidebar Files panes retain isolated transient choices. Click/Ctrl-click, Space and Shift-arrow select/toggle exact visible Markdown ranges; folders and attachments stay outside the note group and tree selection is accessible.");

    const originalText = sources.get(paths[0]).toString("utf8").slice(1), dirty = "Dirty " + originalText;
    await evaluate(`(()=>{const leaf=app.workspace.getLeafById(${q(note)}),editor=leaf.view.editor;editor.replaceRange("Dirty ",{line:0,ch:0});globalThis.__fileSelectionSource={leaf:leaf.id,cm:editor.cm}})()`);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), dirty);
    const beforeOpen = await evaluate(sourcePaths);
    await click(action(main, "open-selected"));
    await wait(`document.querySelector(${q(pane(main) + " [role=status]")})?.textContent==="Opened 2 Markdown notes in new tabs."`, "two selected identities open as two new tabs");
    const opened = (await evaluate(sourcePaths)).filter(item => !beforeOpen.some(old => old.id === item.id));
    assert.deepEqual(opened.map(item => item.path), paths.slice(0, 2)); await expectSelection(tools, main, []);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.cm===__fileSelectionSource.cm`), true);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), dirty); assert.deepEqual(await readFile(join(directory, paths[0])), sources.get(paths[0]));
    await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.undo()`); assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), originalText);
    await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.redo()`); assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), dirty);
    await evaluate(`(async()=>{app.workspace.getLeafById(${q(note)}).view.editor.undo();delete globalThis.__fileSelectionSource;await app.saveAll()})()`);
    await click('[data-tab-id="file-selection-main"]');
    pass(report, "Open selected notes preflights the whole visible group and opens distinct new Markdown tabs without replacing the dirty Source editor, its CodeMirror identity or isolated Undo/Redo; physical BOM/CRLF bytes remain exact.");

    await click(row(main, paths[0])); await click(row(main, paths[1]), 2); await filter(tools, main, base + "/Note 2"); await expectSelection(tools, main, [paths[0]]);
    await filter(tools, main, base); await expectSelection(tools, main, [paths[0]]);
    await click(row(main, hidden)); await click(row(main, base + "/Nested")); await expectSelection(tools, main, []);
    await click(row(main, base + "/Nested")); assert.equal(await evaluate(`document.querySelector(${q(row(main, hidden))}).getAttribute("aria-selected")`), "false");
    await openExplorerOptions(tools, pane(main)); await click(pane(main) + " select"); await press("Home", "Home", 36); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13);
    await wait(`app.workspace.getLeafById(${q(main)}).view.getState().sortOrder==="alphabeticalReverse"`, "reversed visible note ordering");
    await click(row(main, paths[2])); await click(row(main, paths[0]), 8); await expectSelection(tools, main, paths.toReversed());
    await openExplorerOptions(tools, pane(main)); await click(pane(main) + " select"); await press("Home", "Home", 36); await press("Enter", "Enter", 13);
    await filter(tools, main, folder + "/Bounds/"); await expectSelection(tools, main, []);
    await click(row(main, bounds[0])); await click(row(main, bounds[64]), 8); await expectSelection(tools, main, [bounds[0]]);
    assert.match(await evaluate(`document.querySelector(${q(pane(main) + " [role=status]")}).textContent`), /up to 64/);
    await click(row(main, bounds[63]), 8); assert.equal((await evaluate(selected(main))).length, 64); assert.equal(await evaluate(`document.querySelector(${q(action(main, "open-selected"))}).disabled`), true);
    await click(row(main, bounds[19]), 8); assert.equal((await evaluate(selected(main))).length, 20); assert.equal(await evaluate(`document.querySelector(${q(action(main, "open-selected"))}).disabled`), false);
    await click(row(main, bounds[20]), 2); assert.equal((await evaluate(selected(main))).length, 21);
    const beforeLimit = await evaluate(sourcePaths); await evaluate(`app.workspace.getLeafById(${q(main)}).view.openSelected()`); assert.deepEqual(await evaluate(sourcePaths), beforeLimit);
    assert.equal(await evaluate(`document.querySelector(${q(action(main, "open-selected"))}).disabled`), true);
    pass(report, "Filtering/folding removes hidden selections permanently, reversed sorting determines real Shift ranges, 65-note selection refuses without truncation, and a 21-note open refuses before creating a tab while a 20-note group remains available.");

    await filter(tools, main, base); await click(row(main, paths[0])); await click(row(main, paths[1]), 2);
    await evaluate(`(()=>{globalThis.__fileSelectionOldTarget=app.vault.getFileByPath(${q(paths[1])});globalThis.__fileSelectionHeldRow=document.querySelector(${q(row(main, paths[1]))})})()`);
    await unlink(join(directory, paths[1])); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); await expectSelection(tools, main, [paths[0]]);
    await writeFile(join(directory, paths[1]), sources.get(paths[1]), { flag: "wx" }); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    assert.equal(await evaluate(`__fileSelectionOldTarget===app.vault.getFileByPath(${q(paths[1])})`), false);
    await evaluate("__fileSelectionHeldRow.click()"); await expectSelection(tools, main, [paths[0]]);
    await click(row(main, paths[1]), 2);
    await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${q(paths[1])}),${q(renamed)},false)`); await expectSelection(tools, main, [paths[0]]);
    await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${q(renamed)}),${q(paths[1])},false)`); await expectSelection(tools, main, [paths[0]]);
    const beforeDisable = await evaluate(sourcePaths);
    await evaluate(`(()=>{globalThis.__fileSelectionOldOwner=app.workspace.getLeafById(${q(main)}).view;globalThis.__fileSelectionHeldOpen=document.querySelector(${q(action(main, "open-selected"))})})()`);
    await evaluate('app.core.setEnabled("file-explorer",false)'); await evaluate("(async()=>{__fileSelectionHeldOpen.click();await __fileSelectionOldOwner.openSelected()})()"); assert.deepEqual(await evaluate(sourcePaths), beforeDisable);
    await evaluate('app.core.setEnabled("file-explorer",true)'); await wait(live(main), "fresh Files owners after provider disable/re-enable");
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(main)}).view===__fileSelectionOldOwner`), false); await mode(tools, main, false);
    assert.deepEqual(await evaluate(selected(main)), []);
    pass(report, "Real delete/recreate with identical bytes cannot inherit a selected identity or reactivate its held row; guarded renames revoke the old path. Provider teardown leaves held controls/direct APIs inert and recreates fresh unselected owners with the original opaque state.");

    await mode(tools, main); await click(row(main, paths[0])); await click(row(main, paths[1]), 2);
    await evaluate(`(()=>{const owner=app.workspace.getLeafById(${q(main)}).view,hold={owner,workspace:app.workspace,previous:app.workspace.openInLeaf,open:owner.openSelected,held:false,done:false};app.workspace.openInLeaf=async function(...args){await hold.previous.apply(this,args);if(!hold.held&&args[1]?.path===${q(paths[0])}){hold.held=true;await new Promise(resolve=>hold.release=resolve)}};owner.openSelected=function(...args){return hold.open.apply(this,args).finally(()=>{hold.done=true})};globalThis.__fileSelectionPending=hold})()`);
    const beforePending = await evaluate(sourcePaths); await click(action(main, "open-selected")); await wait("__fileSelectionPending.held", "first genuine file open is held after completion");
    await evaluate(`(async()=>{await app.workspace.closeLeaf(app.workspace.getLeafById(${q(main)}));__fileSelectionPending.release()})()`); await wait("__fileSelectionPending.done", "closed Files owner cancels the remaining reviewed opens");
    const partial = (await evaluate(sourcePaths)).filter(item => !beforePending.some(old => old.id === item.id)); assert.deepEqual(partial.map(item => item.path), [paths[0]]);
    await evaluate("__fileSelectionPending.workspace.openInLeaf=__fileSelectionPending.previous;delete globalThis.__fileSelectionPending");
    pass(report, "A controlled fixture holds the real completed first open, closes its Files owner and then releases it. The remaining selected note never opens; the first completed tab remains, with no rollback of unrelated panes or file writes.");

    await mount(); await mode(tools, main); await click(row(main, paths[0])); await click(row(main, paths[1]), 2);
    const width = await evaluate(`(()=>{const root=document.querySelector(${q(pane(main))}),old=root.style.maxWidth;root.style.maxWidth="320px";return old})()`);
    try {
      await openExplorerOptions(tools, pane(main));
      const geometry = await evaluate(`(()=>{const root=document.querySelector(${q(pane(main))}),r=root.getBoundingClientRect(),controls=[...root.querySelectorAll(".file-explorer-controls button:not([hidden])")].map(button=>button.getBoundingClientRect().toJSON()),labels=["select-notes","open-selected"].map(action=>{const button=root.querySelector('[data-explorer-action="'+action+'"]'),bounds=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);const text=range.getBoundingClientRect();return{action,text:button.textContent,visible:button.checkVisibility(),inside:text.width>0&&text.height>0&&text.left>=bounds.left-1&&text.right<=bounds.right+1&&text.top>=bounds.top-1&&text.bottom<=bounds.bottom+1}});return{width:r.width,inside:controls.every(c=>c.width>0&&c.height>0&&c.left>=r.left-1&&c.right<=r.right+1),overlap:controls.some((a,i)=>controls.some((b,j)=>j>i&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5)),labels,status:root.querySelector("[role=status]").getBoundingClientRect().width}})()`);
      assert.ok(geometry.width <= 321 && geometry.inside && !geometry.overlap && geometry.status > 0);
      assert.deepEqual(geometry.labels.map(label => label.text), ["Select notes", "Open selected notes"]); assert.ok(geometry.labels.every(label => label.visible && label.inside)); await capture?.("file-selection-narrow");
    } finally { await evaluate(`document.querySelector(${q(pane(main))}).style.maxWidth=${q(width)}`); }
    const saved = await evaluate(`app.workspace.getLeafById(${q(main)}).view.getState()`); assert.equal(saved.selectionMode, undefined); assert.equal(saved.selectedNotes, undefined);
    await evaluate("app.workspace.flushLayout()"); if (restart) await restart(); else await command("Page.reload"); await afterReload(); await wait(live(main), "fresh host restores Files preferences without transient selection");
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${q(main)}).view.getState()`), saved); await mode(tools, main, false); await expectSelection(tools, main, []); await capture?.("file-selection-restored");
    for (const [path, bytes] of sources) { assert.deepEqual(await readFile(join(directory, path)), bytes); }
    report.fileSelection = { normalClickAndModOpen: true, mainSidebarAndPeerIsolation: true, keyboardAndPointerRanges: true, visibleOnlySelection: true, sixtyFourSelectionLimit: true, twentyOpenLimit: true, newTabsAndExactSource: true, dirtyEditorAndUndoRetained: true, staleIdentityRefusal: true, deletedRecreatedRenamedRefusal: true, disposedControlRefusal: true, asyncOwnerStopsRemainder: true, accessibleNarrow320: true, ephemeralAfterRestart: true };
    pass(report, "Selection controls and help wrap within320px without overlap. Full native restart or actual-folder browser reconnection restores sort/filter/folds and opaque Files state but drops Select notes mode and choices; all fixture source/config-independent bytes remain exact.");
  } catch (error) {
    failure = error;
    try { report.fileSelectionFailure = await evaluate(`(()=>({active:app.workspace.activeLeaf?.id,file:app.workspace.getActiveFile()?.path,panes:[${q(main)},${q(peer)},${q(side)}].map(id=>({id,view:app.workspace.getLeafById(id)?.view.getViewType(),selected:[...document.querySelectorAll('[data-file-explorer="'+id+'"] [data-explorer-selected="true"]')].map(row=>row.dataset.explorerPath),status:document.querySelector('[data-file-explorer="'+id+'"] [role=status]')?.textContent})),pending:globalThis.__fileSelectionPending&&{held:__fileSelectionPending.held,done:__fileSelectionPending.done}}))()`); await capture?.("file-selection-precleanup-failure"); } catch { /* Preserve the original assertion. */ }
    throw error;
  } finally {
    const cleanup = [];
    try { await evaluate('(async()=>{const hold=globalThis.__fileSelectionPending;if(hold){hold.release?.();hold.workspace.openInLeaf=hold.previous;hold.owner.openSelected=hold.open;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}for(const key of["__fileSelectionPending","__fileSelectionSource","__fileSelectionOldTarget","__fileSelectionHeldRow","__fileSelectionOldOwner","__fileSelectionHeldOpen"])delete globalThis[key];await app.core.whenIdle()})()'); } catch (error) { cleanup.push(error); }
    try { await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(previous)});app.workspace.setViewOptions("sidebars",${q(sidebar)});app.sidebars.restore();await app.workspace.flushLayout();if(app.core.isEnabled("file-explorer")!==${enabled})await app.core.setEnabled("file-explorer",${enabled});await app.markdownAutosave.setEnabled(${autosave})})()`); } catch (error) { cleanup.push(error); }
    if (!failure && cleanup.length) { throw new AggregateError(cleanup, "Could not restore the Files note selection fixtures."); }
  }
}

/** Parent supplies two genuine cached notes and audits all cache blobs/counters after return. */
export async function checkFileSelectionReadOnly(tools) {
  const { evaluate, click, wait, report, capture } = tools, id = "file-selection-readonly";
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const previous = await evaluate("app.workspace.getLayout()"), sidebar = await evaluate('app.workspace.getViewOptions("sidebars")');
  const texts = await evaluate('(async()=>{const texts=[];for(const path of["Read only.md","Known target.md"])texts.push((await app.vault.readDocument(path)).content);await app.metadataCache.refresh();return texts})()');
  assert.equal(texts.length, 2); assert.ok(texts.every(text => typeof text === "string" && text.length > 0), "cached source snapshots are actual Markdown strings");
  const layout = { version: 1, main: { id: "file-selection-ro-main", type: "split", direction: "vertical", children: [
    { id: "file-selection-ro-tabs", type: "tabs", dimension: 50, currentTab: 0, children: [{ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true } } }] },
    { id: "file-selection-ro-note-tabs", type: "tabs", dimension: 50, currentTab: 0, children: [{ id: "file-selection-ro-note", type: "leaf", state: { type: "markdown", pinned: true, state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: id };
  try {
    await evaluate(`app.workspace.changeLayout(${q(layout)})`);
    report.fileSelectionReadOnlyMounted = await evaluate(readOnlyState(id));
    await wait(live(id), "genuine cached read-only Files owner");
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "new-note"))}).disabled&&document.querySelector(${q(action(id, "new-folder"))}).disabled`), true);
    await mode(tools, id); await click(row(id, "Known target.md")); await click(row(id, "Read only.md"), 2); await expectSelection(tools, id, ["Known target.md", "Read only.md"]);
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "open-selected"))}).disabled`), false); await capture?.("file-selection-readonly");
    const before = await evaluate(sourcePaths); await click(action(id, "open-selected"));
    await wait(`document.querySelector(${q(pane(id) + " [role=status]")})?.textContent==="Opened 2 Markdown notes in new tabs."`, "read-only selected cached notes open normally");
    const opened = (await evaluate(sourcePaths)).filter(item => !before.some(old => old.id === item.id)); assert.deepEqual(opened.map(item => item.path), ["Known target.md", "Read only.md"]);
    assert.equal(await evaluate(`app.workspace.getLeavesOfType("markdown").every(leaf=>leaf.view.editor.cm.contentDOM.contentEditable==="false")`), true);
    assert.deepEqual(await evaluate('(async()=>{const texts=[];for(const path of["Read only.md","Known target.md"])texts.push((await app.vault.readDocument(path)).content);return texts})()'), texts);
    report.fileSelection = { ...(report.fileSelection ?? {}), cachedReadOnlyOpening: true, cachedReadOnlyBytesUnchanged: true };
    pass(report, "A genuine cache-only read-only Files pane permits selecting and opening two cached Markdown notes in distinct noneditable tabs while creation stays disabled, all source text stays exact and the parent audits zero requests/unchanged cached blobs.");
  } catch (error) {
    try { report.fileSelectionReadOnlyFailure = await evaluate(readOnlyState(id)); await capture?.("file-selection-readonly-precleanup-failure"); } catch (diagnostic) { report.fileSelectionReadOnlyFailure = { diagnostic: String(diagnostic) }; }
    throw error;
  } finally {
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(previous)});app.workspace.setViewOptions("sidebars",${q(sidebar)});app.sidebars.restore();await app.workspace.flushLayout()})()`);
  }
}
