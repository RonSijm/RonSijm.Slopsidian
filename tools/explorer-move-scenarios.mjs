import assert from "node:assert/strict";
import { openExplorerOptions } from "./explorer-options-scenarios.mjs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text);
const pane = id => `[data-file-explorer=${q(id)}]`;
const row = (id, path) => `${pane(id)} [data-explorer-path=${q(path)}]`;
const action = (id, name) => `${pane(id)} [data-explorer-action=${q(name)}]`;
const modal = "[data-explorer-move]", control = name => `${modal} [data-explorer-move-${name}]`;
const selected = id => `(()=>[...document.querySelectorAll(${q(pane(id) + ' [data-explorer-selected="true"]')})].map(row=>row.dataset.explorerPath))()`;
const live = id => `app.workspace.getLeafById(${q(id)})?.view.getViewType()==="file-explorer"&&!document.querySelector(${q(pane(id) + " select")})?.disabled`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function key(command, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}
async function selectGroup(tools, id, paths) {
  if (await tools.evaluate(`document.querySelector(${q(action(id, "select-notes"))})?.getAttribute("aria-pressed")!=="true"`)) { await openExplorerOptions(tools, pane(id)); await tools.click(action(id, "select-notes")); }
  await tools.wait(`document.querySelector(${q(pane(id) + " [role=tree]")})?.getAttribute("aria-multiselectable")==="true"`, "the real Files pane enters note selection mode");
  if ((await tools.evaluate(selected(id))).length) await tools.click(action(id, "clear-selection"));
  for (let index = 0; index < paths.length; index++) await tools.click(row(id, paths[index]), index ? 2 : 0);
  await tools.wait(`${selected(id)}.join("\\0")===${q(paths.join("\0"))}`, "the exact visible Markdown group is selected");
  assert.deepEqual(await tools.evaluate(selected(id)), paths);
}
async function chooseFolder(tools, path) {
  const index = await tools.evaluate(`(()=>{const s=document.querySelector(${q(control("folder"))});return [...s.options].findIndex(option=>option.value===${q(path)})})()`);
  assert.ok(index >= 0 && index < 5000, "the destination is an actual existing folder option");
  const focused = `document.activeElement===document.querySelector(${q(control("folder"))})`;
  // Native popup menus can keep a hovered option independently of CDP's key
  // stream. Use the real modal Tab order and select while its popup is closed.
  for (let step = 0; step < 12 && !await tools.evaluate(focused); step++) await key(tools.command, "Tab", "Tab", 9);
  assert.equal(await tools.evaluate(focused), true, "trusted Tab input focuses the actual destination select");
  await key(tools.command, "Home", "Home", 36);
  await tools.wait(`document.querySelector(${q(control("folder"))}).selectedIndex===0`, "trusted Home selects the first actual folder");
  for (let step = 0; step < index; step++) {
    await key(tools.command, "ArrowDown", "ArrowDown", 40);
    await tools.wait(`document.querySelector(${q(control("folder"))}).selectedIndex===${step + 1}`, "trusted ArrowDown selects the next actual folder");
  }
  await key(tools.command, "Tab", "Tab", 9);
  await tools.wait(`document.querySelector(${q(control("folder"))})?.value===${q(path)}`, "trusted select input chooses the exact destination folder");
}
async function openReview(tools, id, paths, folder) {
  await selectGroup(tools, id, paths); await tools.click(action(id, "move-selected"));
  await tools.wait(`Boolean(document.querySelector(${q(modal)}))`, "the actual Move selected notes dialog opens");
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
  await chooseFolder(tools, folder); await tools.click(control("review"));
}
async function exactPreview(tools, paths, folder) {
  const expected = paths.map(path => path + " → " + folder + "/" + path.split("/").at(-1));
  assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(control("preview") + " li")})].map(row=>row.textContent))()`), expected);
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), false);
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("links"))}).checked`), true);
}

/** Actual toolbar, folder select and reviewed FileManager moves against a disposable local vault. */
export async function checkExplorerMoves(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const base = "Files moves", incoming = base + "/In", destination = base + "/Archive/Deep", occupied = base + "/Taken", partial = base + "/Partial", partialDestination = base + "/Partial moved";
  const a = incoming + "/Alpha λ.md", b = incoming + "/Beta.md", movedA = destination + "/Alpha λ.md", movedB = destination + "/Beta.md";
  const anchor = base + "/Anchor.md", canvas = base + "/Board.canvas", partialA = partial + "/A.md", partialB = partial + "/B.md";
  const id = "explorer-moves-files", note = "explorer-moves-note";
  const alphaText = '# Alpha λ\r\n\r\n[Peer](./Beta.md#Beta) [[./Beta#Beta]]\r\n[Anchor](../Anchor.md#Anchor) [[../Anchor#Anchor]]\r\n\r\nOriginal Alpha prose λ 😀 stays exact.\r\n';
  const betaText = '# Beta\r\n\r\n[Peer](./Alpha%20%CE%BB.md#Alpha%20%CE%BB) [[./Alpha λ#Alpha λ]]\r\n[Anchor](../Anchor.md#Anchor) [[../Anchor#Anchor]]\r\n\r\nOriginal Beta prose Ω stays exact.\r\n';
  const anchorText = '# Anchor\r\n\r\n[[In/Alpha λ#Alpha λ]] [[In/Beta#Beta]]\r\n[Alpha](./In/Alpha%20%CE%BB.md#Alpha%20%CE%BB) [Beta](./In/Beta.md#Beta)\r\n\r\nUnrelated anchor λ 😀.\r\n';
  const boardText = '[[In/Alpha λ#Alpha λ]] [Beta](./In/Beta.md#Beta) `[[In/Alpha λ]]`';
  const board = { nodes: [
    { id: "alpha", type: "file", x: 0, y: 0, width: 240, height: 160, file: a, subpath: "#Alpha λ", opaque: { retain: "λ 😀" } },
    { id: "beta", type: "file", x: 280, y: 0, width: 240, height: 160, file: b, subpath: "#Beta" },
    { id: "text", type: "text", x: 0, y: 200, width: 520, height: 160, text: boardText },
  ], edges: [{ id: "edge", fromNode: "alpha", toNode: "beta", label: "Retain connection λ 😀" }], opaque: { future: ["unchanged", "Ω"] } };
  const serialize = value => JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const fixture = new Map([[a, bytes(alphaText)], [b, bytes(betaText)], [anchor, bytes(anchorText)], [canvas, bytes(serialize(board))],
    [occupied + "/Alpha λ.md", bytes("# Collision λ\r\n\r\nThis occupied destination must stay exact.\r\n")],
    [partialA, bytes("# Partial A\r\n\r\nKeep the acknowledged first move λ 😀.\r\n")], [partialB, bytes("# Partial B\r\n\r\nKeep the failed second source Ω.\r\n")]]);
  const expected = new Map(fixture), absent = new Set();
  const exact = async () => {
    for (const [path, content] of expected) assert.deepEqual(await readFile(join(directory, path)), content, "exact fixture bytes at " + path);
    for (const path of absent) assert.equal(await stat(join(directory, path)).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; }), false, "the completed move removed only its old path");
  };
  const inventory = () => evaluate(`app.vault.getFiles().map(file=>file.path).filter(path=>path.startsWith(${q(base + "/")})).sort()`);
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const previous = await evaluate("app.workspace.getLayout()"), sidebar = await evaluate('app.workspace.getViewOptions("sidebars")'), enabled = await evaluate('app.core.isEnabled("file-explorer")'), autosave = await evaluate("app.markdownAutosave.enabled");
  const layout = { version: 1, main: { id: "explorer-moves-main", type: "split", direction: "vertical", children: [
    { id: "explorer-moves-files-tabs", type: "tabs", dimension: 45, currentTab: 0, children: [{ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true, searchQuery: base, sortOrder: "alphabetical", opaque: { retain: "move review λ" } } } }] },
    { id: "explorer-moves-note-tabs", type: "tabs", dimension: 55, currentTab: 0, children: [{ id: note, type: "leaf", state: { type: "markdown", pinned: true, state: { file: a, mode: "source", source: true } } }] },
  ] }, active: id };
  let failure, stage = "fixture";
  const restoreProbe = '(()=>{const t=globalThis.explorerMovesTrace;if(!t)return;t.release?.();if(t.info)app.vault.getFileInfo=t.info;t.abort?.abort();delete t.info;return true})()';
  try {
    if (!enabled) await evaluate('app.core.setEnabled("file-explorer",true)');
    if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    for (const path of [incoming, destination, occupied, partial, partialDestination]) await mkdir(join(directory, path), { recursive: true });
    for (const [path, content] of fixture) await writeFile(join(directory, path), content, { flag: "wx" });
    await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
    await wait(live(id), "the actual writable Files selection toolbar is interactive");
    await wait(`Boolean(document.querySelector(${q(row(id, b))}))&&Boolean(document.querySelector(${q(row(id, partialB))}))`, "the real Files pane renders every selected fixture path");
    await evaluate(`(()=>{const t=globalThis.explorerMovesTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",event=>{const button=event.target.closest?.("[data-explorer-action],[data-explorer-move-review],[data-explorer-move-confirm],[data-explorer-move-cancel]");if(button)t.trusted.push({trusted:event.isTrusted,action:button.dataset.explorerAction??(button.hasAttribute("data-explorer-move-review")?"review":button.hasAttribute("data-explorer-move-confirm")?"confirm":"cancel")})},{capture:true,signal:t.abort.signal});return true})()`);

    stage = "review and cancellation";
    const initialInventory = await inventory(); await openReview(tools, id, [a, b], destination); await exactPreview(tools, [a, b], destination); await exact();
    await capture?.("explorer-moves-review"); await click(control("cancel")); await wait(`!document.querySelector(${q(modal)})`, "cancelling the reviewed move closes its dialog");
    await exact(); assert.deepEqual(await inventory(), initialInventory); assert.deepEqual(await evaluate(selected(id)), [a, b]);
    pass(report, "The actual Select notes/Ctrl-click/Move toolbar opens an explicit existing-folder review with exact source → destination rows and link updates enabled. Review and Cancel preserve every fixture byte, path and selected-note identity.");

    stage = "occupied destination refusal";
    await openReview(tools, id, [a, b], occupied);
    assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
    assert.deepEqual(await evaluate(`(()=>[...document.querySelectorAll(${q(control("preview") + " li")})].map(row=>row.textContent))()`), []);
    assert.equal(await evaluate(`document.querySelector(${q(control("status"))}).textContent`), 'The destination "' + occupied + '/Alpha λ.md" is occupied or duplicated. Choose another folder.');
    await exact(); assert.deepEqual(await inventory(), initialInventory); await capture?.("explorer-moves-collision");
    await click(control("cancel")); await wait(`!document.querySelector(${q(modal)})`, "the collision review cancels without generated destination names");
    pass(report, "A genuinely occupied destination is refused during Review destinations, with Move notes disabled and no generated names, source moves or changes to the colliding note or referring Markdown/Canvas bytes.");

    stage = "narrow Files controls";
    await selectGroup(tools, id, [a, b]);
    const width = await evaluate(`(()=>{const r=document.querySelector(${q(pane(id))}),old=r.style.maxWidth;r.style.maxWidth="320px";return old})()`);
    try {
      const geometry = await evaluate(`(()=>{const root=document.querySelector(${q(pane(id))}),bounds=root.getBoundingClientRect(),buttons=[...root.querySelectorAll(".file-explorer-controls button:not([hidden])")].map(button=>button.getBoundingClientRect().toJSON()),button=root.querySelector("[data-explorer-action=move-selected]"),r=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);const text=range.getBoundingClientRect();return{width:bounds.width,inside:buttons.every(r=>r.width>0&&r.height>0&&r.left>=bounds.left-1&&r.right<=bounds.right+1),overlap:buttons.some((a,i)=>buttons.some((b,j)=>j>i&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5)),label:button.textContent,visible:button.checkVisibility(),textInside:text.width>0&&text.height>0&&text.left>=r.left-1&&text.right<=r.right+1&&text.top>=r.top-1&&text.bottom<=r.bottom+1}})()`);
      assert.ok(geometry.width <= 321 && geometry.inside && !geometry.overlap && geometry.visible && geometry.textInside); assert.equal(geometry.label, "Move selected notes");
      await capture?.("explorer-moves-narrow"); report.explorerMovesNarrow = geometry;
    } finally { await evaluate(`document.querySelector(${q(pane(id))}).style.maxWidth=${q(width)}`); }

    stage = "two normal reviewed moves and reference rewrites";
    await openReview(tools, id, [a, b], destination); await exactPreview(tools, [a, b], destination);
    await click(control("links")); assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
    assert.deepEqual(await evaluate(`(()=>[...document.querySelectorAll(${q(control("preview") + " li")})].map(row=>row.textContent))()`), []);
    await click(control("links")); await click(control("review")); await exactPreview(tools, [a, b], destination);
    await evaluate(`(()=>{const view=app.workspace.getLeafById(${q(note)}).view;explorerMovesTrace.noteEditor=view.editor;explorerMovesTrace.noteCm=view.editor.cm;return true})()`);
    await click(control("confirm"));
    await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&document.querySelector(${q(pane(id) + " [role=status]")})?.textContent==="Moved 2 of 2 notes."`, "two actual FileManager renames complete in selection order");
    const alphaMoved = alphaText.replaceAll("../Anchor", "../../Anchor"), betaMoved = betaText.replaceAll("../Anchor", "../../Anchor");
    const anchorMoved = anchorText.replace("[[In/Alpha λ#", "[[" + destination + "/Alpha λ#").replace("[[In/Beta#", "[[" + destination + "/Beta#")
      .replace("./In/Alpha%20%CE%BB.md", "./Archive/Deep/Alpha%20%CE%BB.md").replace("./In/Beta.md", "./Archive/Deep/Beta.md");
    const movedBoard = structuredClone(board); movedBoard.nodes[0].file = movedA; movedBoard.nodes[1].file = movedB;
    movedBoard.nodes[2].text = '[[Files moves/Archive/Deep/Alpha λ#Alpha λ]] [Beta](./Archive/Deep/Beta.md#Beta) `[[In/Alpha λ]]`';
    expected.delete(a); expected.delete(b); absent.add(a); absent.add(b); expected.set(movedA, bytes(alphaMoved)); expected.set(movedB, bytes(betaMoved));
    expected.set(anchor, bytes(anchorMoved)); expected.set(canvas, bytes(serialize(movedBoard))); await exact();
    assert.deepEqual(await inventory(), [...expected.keys()].sort()); assert.deepEqual(await evaluate(selected(id)), []);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.file.path`), movedA);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor===explorerMovesTrace.noteEditor&&app.workspace.getLeafById(${q(note)}).view.editor.cm===explorerMovesTrace.noteCm`), true);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), alphaMoved);
    await capture?.("explorer-moves-complete");
    pass(report, "Move notes performs two genuine normal FileManager moves, preserves the open note's editor and updates both moved notes' relative Markdown/wiki destinations, inbound Markdown references and Canvas file/text cards. Exact BOM/CRLF/Unicode bytes and unrelated source, literal-code text, connection and unknown Canvas fields are retained.");

    stage = "real second-rename failure after first acknowledgement";
    await openReview(tools, id, [partialA, partialB], partialDestination); await exactPreview(tools, [partialA, partialB], partialDestination);
    const partialFailure = "Files move fixture second-item version read failed";
    await evaluate(`(()=>{const t=explorerMovesTrace;t.info=app.vault.getFileInfo;t.waiting=false;t.armed=true;t.gate=new Promise(resolve=>t.release=resolve);app.vault.getFileInfo=async function(file,...args){const info=await t.info.call(this,file,...args);if(t.armed&&file.path===${q(partialB)}){t.armed=false;t.waiting=true;await t.gate;throw Error(${q(partialFailure)})}return info};return true})()`);
    await click(control("confirm")); await wait("explorerMovesTrace.waiting", "the actual second FileManager rename is held at its real version read after the first completed move");
    const partialMovedA = partialDestination + "/A.md";
    expected.delete(partialA); absent.add(partialA); expected.set(partialMovedA, fixture.get(partialA)); await exact();
    assert.equal(await evaluate(`app.vault.getFileByPath(${q(partialMovedA)})?.path`), partialMovedA); assert.equal(await evaluate(`app.vault.getFileByPath(${q(partialB)})?.path`), partialB);
    assert.equal(await evaluate(`document.querySelector(${q(control("cancel"))}).disabled&&document.querySelector(${q(control("confirm"))}).disabled`), true);
    await key(command, "Escape", "Escape", 27); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), true);
    await evaluate("app.vault.getFileInfo=explorerMovesTrace.info;explorerMovesTrace.release()");
    const partialMessage = "Moved 1 of 2 notes. " + partialFailure + " Check the current locations before retrying; completed moves were kept.";
    await wait(`!app.workspace.isChangingFiles&&document.querySelector(${q(control("status"))})?.textContent===${q(partialMessage)}&&!document.querySelector(${q(control("cancel"))})?.disabled`, "the partial result visibly retains the completed first move");
    assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled&&document.querySelector(${q(control("review"))}).disabled`), true);
    assert.equal(await evaluate(`document.querySelector(${q(control("cancel"))}).textContent`), "Close"); await exact(); await capture?.("explorer-moves-partial");
    await click(control("cancel")); await wait(`!document.querySelector(${q(modal)})&&${live(id)}`, "closing a partial result requires a fresh selection before retry");
    assert.deepEqual(await evaluate(selected(id)), []); assert.deepEqual(await inventory(), [...expected.keys()].sort());
    pass(report, "A controlled failure is held inside the real second rename's version read after the first move completed. Busy Cancel/Escape cannot dismiss the operation; the dialog reports Moved 1 of 2, keeps the acknowledged destination and unmoved second source, disables replay/review and closes into a fresh empty selection without rolling data back.");

    stage = "restart exact moved locations and fresh selection";
    const trusted = await evaluate("explorerMovesTrace.trusted"); assert.ok(trusted.length >= 10 && trusted.every(item => item.trusted));
    assert.ok(trusted.filter(item => item.action === "confirm").length === 2); assert.ok(trusted.some(item => item.action === "review")); assert.ok(trusted.some(item => item.action === "cancel"));
    report.explorerMoveInputs = trusted; await evaluate(restoreProbe);
    const saved = await evaluate(`app.workspace.getLeafById(${q(id)}).view.getState()`); assert.equal(saved.selectionMode, undefined); assert.equal(saved.selectedNotes, undefined);
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); await exact();
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await wait(live(id), "fresh Files controls restore after native restart/browser reconnection");
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${q(id)}).view.getState()`), saved);
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "select-notes"))}).getAttribute("aria-pressed")`), "false");
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "move-selected"))}).hidden`), true); assert.deepEqual(await evaluate(selected(id)), []);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.file.path`), movedA); assert.equal(await evaluate(`app.workspace.getLeafById(${q(note)}).view.editor.getValue()`), alphaMoved);
    await exact(); assert.deepEqual(await inventory(), [...expected.keys()].sort());
    await selectGroup(tools, id, [movedA, movedB]); assert.equal(await evaluate(`document.querySelector(${q(action(id, "move-selected"))}).disabled`), false);
    await capture?.("explorer-moves-restored"); await click(action(id, "clear-selection"));
    report.explorerMoves = { actualToolbarSelectionAndFolderSelect: true, exactDestinationsReview: true, cancelKeepsFixtureBytes: true, occupiedDestinationRefused: true, linkOptionInvalidatesReview: true, twoRealSequentialMoves: true, relativeMarkdownAndWikiRetargeted: true, canvasFileAndTextCardsRetargeted: true, unrelatedAndUnknownCanvasFieldsRetained: true, exactBomCrlfUnicode: true, sameOpenEditor: true, actualSecondRenamePartialFailure: true, completedMoveKept: true, partialReplayDisabled: true, narrow320: true, restartExactDestinations: true, freshTransientSelection: true };
    pass(report, "Files move controls fit a 320px pane without overlap. Full native restart or actual-folder browser reconnection retains exact moved/reference bytes and the open note's new path, restores Files preferences while dropping the transient selection, and leaves fresh Move selected notes controls usable.");
  } catch (error) {
    failure = error; report.explorerMovesFailure = { stage, error: String(error?.stack ?? error) };
    try { report.explorerMovesFailure.state = await evaluate(`(()=>({active:app.workspace.activeLeaf?.id,changingFiles:app.workspace.isChangingFiles,files:app.vault.getFiles().map(file=>file.path).filter(path=>path.startsWith(${q(base + "/")})).sort(),selected:${selected(id)},status:document.querySelector(${q(pane(id) + " [role=status]")})?.textContent,modal:document.querySelector(${q(modal)})?.textContent,waiting:globalThis.explorerMovesTrace?.waiting??false,inputs:globalThis.explorerMovesTrace?.trusted??[]}))()`); await capture?.("explorer-moves-precleanup-failure"); } catch { /* Keep the original failure. */ }
    throw error;
  } finally {
    const cleanup = [];
    try { await evaluate(restoreProbe); await wait("!app.workspace.isChangingFiles", "held Files move cleanup settles"); await evaluate(`(()=>{app.workspace.getLeafById(${q(id)})?.view.selectionModal?.dispose();delete globalThis.explorerMovesTrace;return true})()`); } catch (error) { cleanup.push(error); }
    try { await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(previous)});app.workspace.setViewOptions("sidebars",${q(sidebar)});app.sidebars.restore();await app.workspace.flushLayout();if(app.core.isEnabled("file-explorer")!==${enabled})await app.core.setEnabled("file-explorer",${enabled});await app.markdownAutosave.setEnabled(${autosave})})()`); } catch (error) { cleanup.push(error); }
    if (!failure && cleanup.length) throw new AggregateError(cleanup, "Could not restore the Files move runtime fixture.");
  }
}

/** The caller owns genuine cached source blobs/index and audits them after returning to the local vault. */
export async function checkExplorerMovesReadOnly(tools) {
  const { evaluate, command, click, wait, report, capture } = tools, id = "explorer-moves-readonly";
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate('app.core.isEnabled("file-explorer")'), true);
  const previous = await evaluate("app.workspace.getLayout()"), sidebar = await evaluate('app.workspace.getViewOptions("sidebars")');
  const snapshots = () => evaluate('(async()=>{const output=[];for(const path of["Known target.md","Read only.md"]){const d=await app.vault.readDocument(path);output.push({path,content:d.content,version:d.version,hasBom:d.hasBom})}return output})()');
  const before = await snapshots(), inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  assert.ok(before.every(item => typeof item.content === "string" && item.content.length > 0));
  const layout = { version: 1, main: { id: "explorer-moves-ro-main", type: "split", direction: "vertical", children: [
    { id: "explorer-moves-ro-files-tabs", type: "tabs", dimension: 50, currentTab: 0, children: [{ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true } } }] },
    { id: "explorer-moves-ro-note-tabs", type: "tabs", dimension: 50, currentTab: 0, children: [{ id: "explorer-moves-ro-note", type: "leaf", state: { type: "markdown", pinned: true, state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: id };
  try {
    await evaluate(`app.workspace.changeLayout(${q(layout)})`); await wait(live(id), "the actual cached read-only Files toolbar is interactive for selection");
    await selectGroup(tools, id, ["Known target.md", "Read only.md"]);
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "move-selected"))}).hidden`), false);
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "move-selected"))}).disabled`), true);
    assert.equal(await evaluate(`document.querySelector(${q(action(id, "open-selected"))}).disabled`), false);
    const point = await evaluate(`(()=>{const b=document.querySelector(${q(action(id, "move-selected"))});b.scrollIntoView({block:"nearest"});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,visible:b.checkVisibility()&&r.width>0&&r.height>0}})()`);
    assert.equal(point.visible, true); await command("Page.bringToFront");
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
    await wait(`!document.querySelector(${q(modal)})`, "a genuine input click on the disabled Move control cannot open a mutation review");
    assert.deepEqual(await snapshots(), before); assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory);
    assert.deepEqual(await evaluate(selected(id)), ["Known target.md", "Read only.md"]); await capture?.("explorer-moves-readonly");
    report.explorerMovesReadOnly = { genuineCacheOnly: true, knownActualMarkdownSelection: true, moveVisibleAndDisabled: true, openingStillAllowed: true, actualDisabledPointerRefused: true, cachedDocumentsAndVersionsExact: true, inventoryExact: true };
    pass(report, "A genuine cached read-only Files pane selects both actual indexed Markdown notes and keeps ordinary opening available, while Move selected notes is visibly disabled. Trusted pointer input cannot open a move review; exact cached source/version/BOM snapshots and inventory remain intact for the parent's blob/zero-network audit.");
  } catch (error) {
    try { report.explorerMovesReadOnlyFailure = await evaluate(`(()=>({core:app.core.isEnabled("file-explorer"),busy:app.core.busy,changingLayout:app.workspace.isChangingLayout,changingFiles:app.workspace.isChangingFiles,active:app.workspace.activeLeaf?.id,owner:app.workspace.getLeafById(${q(id)})?.view.getViewType(),selected:${selected(id)},controls:[...document.querySelectorAll(${q(pane(id) + " [data-explorer-action]")})].map(button=>({action:button.dataset.explorerAction,hidden:button.hidden,disabled:button.disabled})),status:document.querySelector(${q(pane(id) + " [role=status]")})?.textContent}))()`); await capture?.("explorer-moves-readonly-precleanup-failure"); } catch { /* Preserve the original assertion. */ }
    throw error;
  } finally {
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(previous)});app.workspace.setViewOptions("sidebars",${q(sidebar)});app.sidebars.restore();await app.workspace.flushLayout()})()`);
  }
}
