import assert from "node:assert/strict";
import { openExplorerOptions } from "./explorer-options-scenarios.mjs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text);
const pane = id => `[data-file-explorer=${q(id)}]`, row = (id, path) => `${pane(id)} [data-explorer-path=${q(path)}]`;
const action = (id, name) => `${pane(id)} [data-explorer-action=${q(name)}]`;
const modal = "[data-explorer-rename]", control = name => `${modal} [data-explorer-rename-${name}]`;
const selected = id => `(()=>[...document.querySelectorAll(${q(pane(id) + ' [data-explorer-selected="true"]')})].map(row=>row.dataset.explorerPath))()`;
const live = id => `app.workspace.getLeafById(${q(id)})?.view.getViewType()==="file-explorer"&&!document.querySelector(${q(pane(id) + " select")})?.disabled`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
async function fill(tools, name, value) {
  await tools.click(control(name)); await key(tools.command, "a", "KeyA", 65, 2);
  if (value) await tools.command("Input.insertText", { text: value }); else await key(tools.command, "Backspace", "Backspace", 8);
  await tools.wait(`document.querySelector(${q(control(name))})?.value===${q(value)}`, "trusted rename field input is exact");
}
async function selectGroup(tools, id, paths) {
  if (await tools.evaluate(`document.querySelector(${q(action(id, "select-notes"))})?.getAttribute("aria-pressed")!=="true"`)) { await openExplorerOptions(tools, pane(id)); await tools.click(action(id, "select-notes")); }
  await tools.wait(`document.querySelector(${q(pane(id) + " [role=tree]")})?.getAttribute("aria-multiselectable")==="true"`, "the real Files pane enters note selection mode");
  if ((await tools.evaluate(selected(id))).length) await tools.click(action(id, "clear-selection"));
  for (let index = 0; index < paths.length; index++) await tools.click(row(id, paths[index]), index ? 2 : 0);
  await tools.wait(`${selected(id)}.join("\\0")===${q(paths.join("\0"))}`, "the exact visible Markdown rename group is selected");
  assert.deepEqual(await tools.evaluate(selected(id)), paths);
}
async function openReview(tools, id, paths) {
  await selectGroup(tools, id, paths); await tools.click(action(id, "rename-selected"));
  await tools.wait(`Boolean(document.querySelector(${q(modal)}))`, "the actual Rename selected notes dialog opens");
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
  await fill(tools, "find", "Old"); await fill(tools, "replace", "New"); await tools.click(control("review"));
}
async function exactPreview(tools, paths, prefix = "", suffix = "") {
  const expected = paths.map(path => { const slash = path.lastIndexOf("/"), name = path.slice(slash + 1); return path + " → " + path.slice(0, slash + 1) + prefix + name.slice(0, -3).replaceAll("Old", "New") + suffix + name.slice(-3); });
  assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(control("preview") + " li")})].map(row=>row.textContent))()`), expected);
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), false);
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("links"))}).checked`), true);
}

/** Trusted Files selection, literal filename review and normal FileManager renames in a disposable local vault. */
export async function checkExplorerRename(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const base = "Files rename", incoming = base + "/In", taken = base + "/Taken", partial = base + "/Partial";
  const a = incoming + "/Old Alpha λ.md", b = incoming + "/Old Beta.md", renamedA = incoming + "/New Alpha λ.md", renamedB = incoming + "/New Beta.md";
  const anchor = base + "/Anchor.md", canvas = base + "/Board.canvas", collision = taken + "/Old.md", occupied = taken + "/New.md", partialA = partial + "/Old A.md", partialB = partial + "/Old B.md";
  const id = "explorer-rename-files", note = "explorer-rename-note";
  const alphaText = '# Alpha λ\r\n\r\n[Peer](./Old%20Beta.md#Beta) [[./Old Beta#Beta]]\r\n[Anchor](../Anchor.md#Anchor)\r\n\r\nOriginal Alpha prose λ 😀 stays exact.\r\n';
  const betaText = '# Beta\r\n\r\n[Peer](./Old%20Alpha%20%CE%BB.md#Alpha%20%CE%BB) [[./Old Alpha λ#Alpha λ]]\r\n[Anchor](../Anchor.md#Anchor)\r\n\r\nOriginal Beta prose Ω stays exact.\r\n';
  const anchorText = '# Anchor\r\n\r\n[[In/Old Alpha λ#Alpha λ]] [[In/Old Beta#Beta]]\r\n[Alpha](./In/Old%20Alpha%20%CE%BB.md#Alpha%20%CE%BB) [Beta](./In/Old%20Beta.md#Beta)\r\n\r\nUnrelated anchor λ 😀.\r\n';
  const board = { nodes: [
    { id: "alpha", type: "file", x: 0, y: 0, width: 240, height: 160, file: a, subpath: "#Alpha λ", opaque: { retain: "λ 😀" } },
    { id: "beta", type: "file", x: 280, y: 0, width: 240, height: 160, file: b, subpath: "#Beta" },
    { id: "text", type: "text", x: 0, y: 200, width: 520, height: 160, text: '[[In/Old Alpha λ#Alpha λ]] [Beta](./In/Old%20Beta.md#Beta) `[[In/Old Alpha λ]]`' }
  ], edges: [{ id: "edge", fromNode: "alpha", toNode: "beta", label: "Retain connection λ 😀" }], opaque: { future: ["unchanged", "Ω"] } };
  const serialize = value => JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const fixture = new Map([[a, bytes(alphaText)], [b, bytes(betaText)], [anchor, bytes(anchorText)], [canvas, bytes(serialize(board))],
    [collision, bytes("# Collision source λ\r\n")], [occupied, bytes("# Occupied name Ω\r\n\r\nThis note must stay exact.\r\n")],
    [partialA, bytes("# Partial A\r\n\r\nKeep the acknowledged first rename λ 😀.\r\n")], [partialB, bytes("# Partial B\r\n\r\nKeep the failed second source Ω.\r\n")]]);
  const expected = new Map(fixture), absent = new Set();
  const exact = async () => {
    for (const [path, content] of expected) assert.deepEqual(await readFile(join(directory, path)), content, "exact fixture bytes at " + path);
    for (const path of absent) assert.equal(await stat(join(directory, path)).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; }), false, "only the acknowledged old filename is absent");
  };
  const inventory = () => evaluate(`app.vault.getFiles().map(file=>file.path).filter(path=>path.startsWith(${q(base + "/")})).sort()`);
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const previous = await evaluate("app.workspace.getLayout()"), sidebar = await evaluate('app.workspace.getViewOptions("sidebars")'), enabled = await evaluate('app.core.isEnabled("file-explorer")'), autosave = await evaluate("app.markdownAutosave.enabled");
  const layout = { version: 1, main: { id: "explorer-rename-main", type: "split", direction: "vertical", children: [
    { id: "explorer-rename-files-tabs", type: "tabs", dimension: 45, currentTab: 0, children: [{ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true, searchQuery: base, sortOrder: "alphabetical", opaque: { retain: "rename review λ" } } } }] },
    { id: "explorer-rename-note-tabs", type: "tabs", dimension: 55, currentTab: 0, children: [{ id: note, type: "leaf", state: { type: "markdown", pinned: true, state: { file: a, mode: "source", source: true } } }] }
  ] }, active: id };
  const restoreProbe = '(()=>{const t=globalThis.explorerRenameTrace;if(!t)return;t.release?.();if(t.info)app.vault.getFileInfo=t.info;t.abort?.abort();delete t.info;return true})()';
  let failure, stage = "fixture";
  try {
    if (!enabled) await evaluate('app.core.setEnabled("file-explorer",true)'); if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    for (const folder of [incoming, taken, partial]) await mkdir(join(directory, folder), { recursive: true });
    for (const [path, content] of fixture) await writeFile(join(directory, path), content, { flag: "wx" });
    await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
    await wait(live(id), "the actual writable Files rename toolbar is interactive");
    await wait(`Boolean(document.querySelector(${q(row(id, b))}))&&Boolean(document.querySelector(${q(row(id, partialB))}))`, "the real Files tree renders the rename fixtures");
    await evaluate(`(()=>{const t=globalThis.explorerRenameTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",event=>{const button=event.target.closest?.("[data-explorer-action],[data-explorer-rename-review],[data-explorer-rename-confirm],[data-explorer-rename-cancel]");if(button)t.trusted.push({trusted:event.isTrusted,action:button.dataset.explorerAction??(button.hasAttribute("data-explorer-rename-review")?"review":button.hasAttribute("data-explorer-rename-confirm")?"confirm":"cancel")})},{capture:true,signal:t.abort.signal});return true})()`);

    stage = "literal review and cancellation";
    const initialInventory = await inventory(); await openReview(tools, id, [a, b]); await exactPreview(tools, [a, b]); await exact();
    await fill(tools, "prefix", "Reviewed "); assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
    assert.equal(await evaluate(`document.querySelector(${q(control("preview"))}).children.length`), 0);
    await fill(tools, "suffix", " λ"); await click(control("review")); await exactPreview(tools, [a, b], "Reviewed ", " λ"); await exact();
    await capture?.("explorer-rename-review"); await click(control("cancel")); await wait(`!document.querySelector(${q(modal)})`, "Cancel closes the explicit rename review");
    await exact(); assert.deepEqual(await inventory(), initialInventory); assert.deepEqual(await evaluate(selected(id)), [a, b]);
    pass(report, "Actual Select notes/Ctrl-click/Rename controls review literal in-place filename replacements with optional prefix/suffix and exact old → new rows. Editing a rename field invalidates confirmation; review and cancellation keep all original filenames and BOM/CRLF/Unicode bytes exact.");

    stage = "occupied name refusal";
    await openReview(tools, id, [collision]);
    assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
    assert.equal(await evaluate(`document.querySelector(${q(control("preview"))}).children.length`), 0);
    assert.equal(await evaluate(`document.querySelector(${q(control("status"))}).textContent`), 'The destination "' + occupied + '" is occupied or duplicated. Change the rename fields or selection.');
    await exact(); assert.deepEqual(await inventory(), initialInventory); await capture?.("explorer-rename-collision");
    await click(control("cancel")); await wait(`!document.querySelector(${q(modal)})`, "the occupied-name review closes without generated names");
    pass(report, "A genuinely occupied note filename is refused in Review names with no enabled Rename action, generated name, overwritten collision, source rename or Markdown/Canvas edit.");

    stage = "normal renames and link rewrites";
    await openReview(tools, id, [a, b]); await exactPreview(tools, [a, b]);
    await click(control("links")); assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
    await click(control("links")); await click(control("review")); await exactPreview(tools, [a, b]);
    await evaluate(`(()=>{const view=app.workspace.getLeafById(${q(note)}).view;explorerRenameTrace.editor=view.editor;explorerRenameTrace.cm=view.editor.cm;return true})()`);
    await click(control("confirm"));
    await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&document.querySelector(${q(pane(id) + " [role=status]")})?.textContent==="Renamed 2 of 2 notes."`, "two real normal FileManager renames finish in reviewed order");
    const alphaRenamed = alphaText.replace("./Old%20Beta.md", "./New%20Beta.md").replace("[[./Old Beta#", "[[./New Beta#");
    const betaRenamed = betaText.replace("./Old%20Alpha%20%CE%BB.md", "./New%20Alpha%20%CE%BB.md").replace("[[./Old Alpha λ#", "[[./New Alpha λ#");
    const anchorRenamed = anchorText.replace("[[In/Old Alpha λ#", "[[" + incoming + "/New Alpha λ#").replace("[[In/Old Beta#", "[[" + incoming + "/New Beta#").replace("./In/Old%20Alpha%20%CE%BB.md", "./In/New%20Alpha%20%CE%BB.md").replace("./In/Old%20Beta.md", "./In/New%20Beta.md");
    const renamedBoard = structuredClone(board); renamedBoard.nodes[0].file = renamedA; renamedBoard.nodes[1].file = renamedB;
    renamedBoard.nodes[2].text = '[[Files rename/In/New Alpha λ#Alpha λ]] [Beta](./In/New%20Beta.md#Beta) `[[In/Old Alpha λ]]`';
    expected.delete(a); expected.delete(b); absent.add(a); absent.add(b); expected.set(renamedA, bytes(alphaRenamed)); expected.set(renamedB, bytes(betaRenamed)); expected.set(anchor, bytes(anchorRenamed)); expected.set(canvas, bytes(serialize(renamedBoard))); await exact();
    assert.deepEqual(await inventory(), [...expected.keys()].sort()); assert.deepEqual(await evaluate(selected(id)), []);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.file.path`), renamedA);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor===explorerRenameTrace.editor&&app.workspace.getLeafById(${q(note)}).view.editor.cm===explorerRenameTrace.cm`), true);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), alphaRenamed); await capture?.("explorer-rename-complete");
    pass(report, "Rename notes performs two actual normal FileManager renames, preserving folders, Markdown extensions and the open editor while updating peer/inbound Markdown/wiki links and Canvas file/text cards. Exact BOM/CRLF/Unicode and unrelated body, literal-code text, edges and unknown Canvas data survive.");

    stage = "partial second rename failure";
    await openReview(tools, id, [partialA, partialB]); await exactPreview(tools, [partialA, partialB]);
    const partialFailure = "Files rename fixture second-item version read failed";
    await evaluate(`(()=>{const t=explorerRenameTrace;t.info=app.vault.getFileInfo;t.waiting=false;t.armed=true;t.gate=new Promise(resolve=>t.release=resolve);app.vault.getFileInfo=async function(file,...args){const info=await t.info.call(this,file,...args);if(t.armed&&file.path===${q(partialB)}){t.armed=false;t.waiting=true;await t.gate;throw Error(${q(partialFailure)})}return info};return true})()`);
    await click(control("confirm")); await wait("explorerRenameTrace.waiting", "the real second rename is held after the first acknowledgement");
    const partialRenamedA = partial + "/New A.md"; expected.delete(partialA); absent.add(partialA); expected.set(partialRenamedA, fixture.get(partialA)); await exact();
    assert.equal(await evaluate(`app.vault.getFileByPath(${q(partialRenamedA)})?.path`), partialRenamedA); assert.equal(await evaluate(`app.vault.getFileByPath(${q(partialB)})?.path`), partialB);
    assert.equal(await evaluate(`document.querySelector(${q(control("cancel"))}).disabled&&document.querySelector(${q(control("confirm"))}).disabled`), true);
    await key(command, "Escape", "Escape", 27); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), true);
    await evaluate("app.vault.getFileInfo=explorerRenameTrace.info;explorerRenameTrace.release()");
    const partialMessage = "Renamed 1 of 2 notes. " + partialFailure + " Check the current names before retrying; completed renames were kept.";
    await wait(`!app.workspace.isChangingFiles&&document.querySelector(${q(control("status"))})?.textContent===${q(partialMessage)}&&!document.querySelector(${q(control("cancel"))})?.disabled`, "the visible partial result keeps its first completed rename");
    assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled&&document.querySelector(${q(control("review"))}).disabled`), true);
    assert.equal(await evaluate(`document.querySelector(${q(control("cancel"))}).textContent`), "Close"); await exact(); await capture?.("explorer-rename-partial");
    await click(control("cancel")); await wait(`!document.querySelector(${q(modal)})&&${live(id)}`, "a partial result closes into a fresh Files selection");
    assert.deepEqual(await evaluate(selected(id)), []); assert.deepEqual(await inventory(), [...expected.keys()].sort());
    pass(report, "A held failure inside the real second rename retains the acknowledged first filename and untouched second source. Busy Escape/Cancel cannot dismiss it; Renamed 1 of 2 explains the retained result, disables replay/review and requires a fresh selection.");

    const trusted = await evaluate("explorerRenameTrace.trusted"); assert.ok(trusted.length > 10 && trusted.every(item => item.trusted)); assert.ok(trusted.some(item => item.action === "rename-selected") && trusted.some(item => item.action === "confirm")); report.explorerRenameInputs = trusted;
    await evaluate(restoreProbe); const saved = await evaluate(`app.workspace.getLeafById(${q(id)}).view.getState()`); assert.equal(saved.selectedNotes, undefined); assert.equal(saved.selectionMode, undefined);
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); await exact();
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await wait(live(id), "fresh Files rename controls restore after restart/reconnection");
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${q(id)}).view.getState()`), saved);
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "select-notes"))}).getAttribute("aria-pressed")`), "false"); assert.equal(await evaluate(`document.querySelector(${q(action(id, "rename-selected"))}).hidden`), true); assert.deepEqual(await evaluate(selected(id)), []);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.file.path`), renamedA); assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), alphaRenamed); await exact(); assert.deepEqual(await inventory(), [...expected.keys()].sort());
    await selectGroup(tools, id, [renamedA, renamedB]); assert.equal(await evaluate(`document.querySelector(${q(action(id, "rename-selected"))}).disabled`), false); await capture?.("explorer-rename-restored"); await click(action(id, "clear-selection"));
    report.explorerRename = { actualToolbarAndTrustedFields: true, exactInPlaceReview: true, optionalPrefixSuffix: true, fieldAndLinkChangesRevokeReview: true, cancellationExact: true, occupiedNameRefused: true, twoNormalRenames: true, markdownAndCanvasReferencesUpdated: true, exactBomCrlfUnicode: true, sameOpenEditor: true, secondRenamePartialFailure: true, completedRenameKept: true, partialReplayDisabled: true, restartExactNamesAndBytes: true, freshTransientSelection: true };
    pass(report, "Full native restart or actual-folder browser reconnection retains exact reviewed filenames and reference bytes, preserves the open note's new path, restores Files preferences with no transient selection, and leaves fresh Rename selected notes controls usable.");
  } catch (error) {
    failure = error; report.explorerRenameFailure = { stage, error: String(error?.stack ?? error) };
    try { report.explorerRenameFailure.state = await evaluate(`(()=>({active:app.workspace.activeLeaf?.id,changingFiles:app.workspace.isChangingFiles,files:app.vault.getFiles().map(file=>file.path).filter(path=>path.startsWith(${q(base + "/")})).sort(),selected:${selected(id)},status:document.querySelector(${q(pane(id) + " [role=status]")})?.textContent,modal:document.querySelector(${q(modal)})?.textContent,waiting:globalThis.explorerRenameTrace?.waiting??false,inputs:globalThis.explorerRenameTrace?.trusted??[]}))()`); await capture?.("explorer-rename-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    const cleanup = [];
    try { await evaluate(restoreProbe); await wait("!app.workspace.isChangingFiles", "held Files rename cleanup settles"); await evaluate(`(()=>{app.workspace.getLeafById(${q(id)})?.view.selectionModal?.dispose();delete globalThis.explorerRenameTrace;return true})()`); } catch (error) { cleanup.push(error); }
    try { await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(previous)});app.workspace.setViewOptions("sidebars",${q(sidebar)});app.sidebars.restore();await app.workspace.flushLayout();if(app.core.isEnabled("file-explorer")!==${enabled})await app.core.setEnabled("file-explorer",${enabled});await app.markdownAutosave.setEnabled(${autosave})})()`); } catch (error) { cleanup.push(error); }
    if (!failure && cleanup.length) throw new AggregateError(cleanup, "Could not restore the Files rename runtime fixture.");
  }
}

/** The caller owns cache blobs and audits exact bytes and zero network after returning to the local vault. */
export async function checkExplorerRenameReadOnly(tools) {
  const { evaluate, command, click, wait, report, capture } = tools, id = "explorer-rename-readonly";
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate('app.core.isEnabled("file-explorer")'), true);
  const previous = await evaluate("app.workspace.getLayout()"), sidebar = await evaluate('app.workspace.getViewOptions("sidebars")');
  const snapshots = () => evaluate('(async()=>{const output=[];for(const path of["Known target.md","Read only.md"]){const d=await app.vault.readDocument(path);output.push({path,content:d.content,version:d.version,hasBom:d.hasBom})}return output})()');
  const before = await snapshots(), inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()"); assert.ok(before.every(item => typeof item.content === "string" && item.content.length > 0));
  const layout = { version: 1, main: { id: "explorer-rename-ro-main", type: "split", direction: "vertical", children: [
    { id: "explorer-rename-ro-files-tabs", type: "tabs", dimension: 50, currentTab: 0, children: [{ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true } } }] },
    { id: "explorer-rename-ro-note-tabs", type: "tabs", dimension: 50, currentTab: 0, children: [{ id: "explorer-rename-ro-note", type: "leaf", state: { type: "markdown", pinned: true, state: { file: "Read only.md", mode: "source", source: true } } }] }
  ] }, active: id };
  try {
    await evaluate(`app.workspace.changeLayout(${q(layout)})`); await wait(live(id), "the cached read-only Files toolbar permits selection"); await selectGroup(tools, id, ["Known target.md", "Read only.md"]);
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "rename-selected"))}).hidden`), false); assert.equal(await evaluate(`document.querySelector(${q(action(id, "rename-selected"))}).disabled`), true); assert.equal(await evaluate(`document.querySelector(${q(action(id, "open-selected"))}).disabled`), false);
    const point = await evaluate(`(()=>{const b=document.querySelector(${q(action(id, "rename-selected"))});b.scrollIntoView({block:"nearest"});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,visible:b.checkVisibility()&&r.width>0&&r.height>0}})()`); assert.equal(point.visible, true); await command("Page.bringToFront");
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
    await wait(`!document.querySelector(${q(modal)})`, "trusted input on the disabled Rename action cannot open a review"); assert.deepEqual(await snapshots(), before); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory); assert.deepEqual(await evaluate(selected(id)), ["Known target.md", "Read only.md"]); await capture?.("explorer-rename-readonly");
    report.explorerRenameReadOnly = { genuineCacheOnly: true, actualMarkdownSelection: true, renameVisibleAndDisabled: true, openingStillAllowed: true, actualDisabledPointerRefused: true, cachedBytesVersionsAndInventoryExact: true };
    pass(report, "A genuine cached read-only Files pane selects actual Markdown notes and permits opening, while Rename selected notes remains visibly disabled. Trusted pointer input cannot open a review or change exact cached source/version/BOM snapshots or inventory for the parent's blob/zero-network audit.");
  } catch (error) {
    try { report.explorerRenameReadOnlyFailure = await evaluate(`(()=>({active:app.workspace.activeLeaf?.id,changingLayout:app.workspace.isChangingLayout,changingFiles:app.workspace.isChangingFiles,selected:${selected(id)},controls:[...document.querySelectorAll(${q(pane(id) + " [data-explorer-action]")})].map(button=>({action:button.dataset.explorerAction,hidden:button.hidden,disabled:button.disabled}))}))()`); await capture?.("explorer-rename-readonly-precleanup-failure"); } catch { /* Preserve the original assertion. */ }
    throw error;
  } finally { await evaluate(`(async()=>{await app.workspace.changeLayout(${q(previous)});app.workspace.setViewOptions("sidebars",${q(sidebar)});app.sidebars.restore();await app.workspace.flushLayout()})()`); }
}
