import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

/**
 * Real-host Outline reorder workflow: trusted pointer drag, Alt+Arrow keys, the row context menu, one-step undo,
 * peer editors, stale/conflict refusal and exact note bytes. Bytes are checked after an explicit save only.
 */
export async function checkOutlineReorder({ directory, evaluate, command, click, press, wait, report, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const path = "Outline panes/Reorder.md", file = join(directory, path), paneId = "outline-reorder", noteId = "outline-reorder-note", peerId = "outline-reorder-peer";
  const pane = `[data-outline-pane="${paneId}"]`, view = id => `app.workspace.getLeafById(${JSON.stringify(id)}).view`;
  const bomBytes = Buffer.from([0xef, 0xbb, 0xbf]), withBom = value => Buffer.concat([bomBytes, Buffer.from(value)]);
  const pre = "---\r\ntitle: '# Not a heading'\r\n---\r\n";
  const one = "# One\r\nbody λ 中文\r\n\r\n## Child\r\n```md\r\n# Literal code\r\n```\r\n\r\n", two = "# Two\r\nTwo body\r\n<!--\r\n# Hidden comment\r\n-->\r\n\r\n";
  const three = "Three\r\n=====\r\nSetext body\r\n\r\n", dupA = "# Dup\r\nfirst\r\n\r\n", dupB = "# Dup\r\nsecond\r\n";
  const original = pre + one + two + three + dupA + dupB, originalBytes = withBom(original);
  await evaluate("app.markdownAutosave.setEnabled(false)"); await evaluate("app.saveAll()");
  await writeFile(file, originalBytes); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await evaluate(`(async()=>{
    const note=app.workspace.getLeaf("tab");note.id=${JSON.stringify(noteId)};await note.openFile(app.vault.getFileByPath(${JSON.stringify(path)}));
    const outline=app.workspace.getLeaf("split");outline.id=${JSON.stringify(paneId)};await outline.setViewState({type:"outline",state:{file:${JSON.stringify(path)},followActiveFile:false}});
    app.workspace.setActiveLeaf(note,{focus:true});
  })()`);
  const text = () => evaluate(`${view(noteId)}.editor.getValue()`), disk = () => readFile(file);
  const titles = () => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(pane + " .outline-heading")}),e=>e.textContent)`);
  const status = () => evaluate(`document.querySelector(${JSON.stringify(pane + " [data-outline-status]")})?.textContent??""`);
  const withStatus = async (label, action) => {
    try { return await action(); }
    catch (error) { throw new Error(label + " (Outline status: " + JSON.stringify(await status().catch(statusError => "unavailable: " + statusError.message)) + "): " + (error?.message ?? error), { cause: error }); }
  };
  const settle = expected => withStatus("reorder did not apply", async () => { await wait(`${view(noteId)}.editor.getValue()===${JSON.stringify(expected)}`, "exact reordered editor text"); await wait(`document.querySelector(${JSON.stringify(pane + " [data-outline-status]")}).textContent!==""&&app.metadataCache.getDocument(${JSON.stringify(path)}).text===${JSON.stringify(expected)}`, "refreshed metadata"); });
  const rowSelector = async (title, occurrence = 0) => {
    await wait(`document.querySelectorAll(${JSON.stringify(pane + " .outline-heading")}).length>0`, "Outline rows");
    const index = await evaluate(`(()=>{let seen=-1;const rows=[...document.querySelectorAll(${JSON.stringify(pane + " .outline-heading")})];return rows.findIndex(r=>r.textContent===${JSON.stringify(title)}&&++seen===${occurrence})})()`);
    assert.ok(index >= 0, "Outline row " + title + "#" + occurrence);
    await evaluate(`document.querySelectorAll(${JSON.stringify(pane + " .outline-heading")})[${index}].closest("[data-outline-node]").dataset.outlineTest="row"`);
    return `${pane} [data-outline-node][data-outline-test="row"]`;
  };
  const clearMarks = () => evaluate(`document.querySelectorAll("[data-outline-test]").forEach(e=>delete e.dataset.outlineTest)`);
  const point = async (selector, edge = "middle") => { const rect = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,top:r.top,height:r.height}})()`); return { x: rect.x, y: edge === "before" ? rect.top + 3 : edge === "after" ? rect.top + rect.height - 3 : rect.top + rect.height / 2 }; };
  const nativeDrag = async (sourceTitle, sourceOccurrence, targetTitle, targetOccurrence, edge) => {
    await clearMarks(); const from = await rowSelector(sourceTitle, sourceOccurrence); const start = await point(from);
    await clearMarks(); const to = await rowSelector(targetTitle, targetOccurrence); const end = await point(to, edge);
    await command("Page.bringToFront"); await command("Input.setInterceptDrags", { enabled: true }); await evaluate("globalThis.outlineDragStart=null;document.addEventListener('dragstart',e=>{globalThis.outlineDragStart={trusted:e.isTrusted,types:[...e.dataTransfer.types]}},{once:true,capture:true})");
    try {
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + 12, y: start.y + 2, button: "left", buttons: 1 });
      await wait("globalThis.outlineDragStart!==null", "trusted Outline dragstart"); const data = await evaluate("globalThis.outlineDragStart"); assert.equal(data.trusted, true, "A native pointer gesture must start the Outline drag");
      const items = [{ mimeType: "text/plain", data: sourceTitle }];
      for (const type of ["dragEnter", "dragOver", "drop"]) { await command("Input.dispatchDragEvent", { type, ...end, data: { items, dragOperationsMask: 16 } }); }
    } finally { await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", clickCount: 1 }); await command("Input.setInterceptDrags", { enabled: false }); await clearMarks(); }
  };
  const paneState = `(()=>{const p=${view(paneId)},active=document.activeElement,rows=p.rows();return{generation:p.snapshot?.id,connected:active?.isConnected===true,inPane:!!active?.closest(${JSON.stringify(pane)}),node:active?.dataset?.outlineNode,focusKey:p.focusKey,member:rows.includes(active),heading:active?.querySelector(".outline-heading")?.textContent,occurrence:rows.filter(r=>r.querySelector(".outline-heading")?.textContent===active?.querySelector(".outline-heading")?.textContent).indexOf(active)}})()`;
  const focusRow = async (title, occurrence = 0) => {
    await clearMarks(); const selector = await rowSelector(title, occurrence); await click(selector); await clearMarks();
    const focused = await evaluate(`(()=>{const p=${view(paneId)},rows=p.rows().filter(r=>r.querySelector(".outline-heading")?.textContent===${JSON.stringify(title)}),row=rows[${occurrence}];if(!row){return null}row.focus();return{generation:p.snapshot?.id,same:document.activeElement===row}})()`);
    assert.ok(focused?.same, "The current " + title + "#" + occurrence + " Outline row must accept focus");
    return focused.generation;
  };

  await wait(`JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(pane + " .outline-heading")}),e=>e.textContent))===${JSON.stringify(JSON.stringify(["One", "Child", "Two", "Three", "Dup", "Dup"]))}`, "ATX/Setext/duplicate headings excluding metadata, code and comment lines");
  assert.equal(await text(), original); assert.deepEqual(await disk(), originalBytes);
  await capture("reorder-before");

  // Pointer drag: Setext section before the first section; folded sibling identity is retained.
  await click(await (async () => { await clearMarks(); const row = await rowSelector("One"); await evaluate(`document.querySelector(${JSON.stringify(row)}).dataset.outlineTest="row"`); return row + " [data-outline-fold]"; })()); await clearMarks();
  const folds = await evaluate(`${view(paneId)}.getState().foldedHeadings`); assert.equal(folds.length, 1);
  await nativeDrag("Three", 0, "One", 0, "before"); await settle(pre + three + one + two + dupA + dupB);
  assert.deepEqual(await disk(), originalBytes, "Dragging must not save implicitly"); assert.equal(await evaluate(`${view(noteId)}.isDirty`), true);
  assert.deepEqual(await evaluate(`${view(paneId)}.getState().foldedHeadings`), folds, "Folds follow the moved sibling by heading identity");
  assert.deepEqual(await titles(), ["Three", "One", "Two", "Dup", "Dup"].filter(title => title !== "Child"), "Folded child stays hidden after the move");
  pass("A trusted pointer drag reorders a Setext section before an ATX section with its content, code and comments intact in one editor edit, keeps fold identity and leaves the file unsaved.");

  await evaluate(`${view(noteId)}.editor.focus()`); await press("z", "KeyZ", 90, 2); await settle(original);
  assert.equal(await evaluate(`${view(noteId)}.isDirty`), false);
  await press("y", "KeyY", 89, 2); await settle(pre + three + one + two + dupA + dupB); await press("z", "KeyZ", 90, 2); await settle(original);
  pass("One Undo restores the exact original text and one Redo repeats the whole subtree move.");

  // Keyboard alternative.
  await focusRow("Two"); await press("ArrowDown", "ArrowDown", 40, 1); await settle(pre + one + three + two + dupA + dupB);
  await wait(`document.activeElement?.closest("[data-outline-node]")?.textContent.includes("Two")`, "Moved heading keeps keyboard focus");
  await press("ArrowUp", "ArrowUp", 38, 1); await settle(original);
  await focusRow("One"); await press("ArrowUp", "ArrowUp", 38, 1); await wait(`document.querySelector(${JSON.stringify(pane + " [data-outline-status]")}).textContent.includes("already first")`, "boundary message"); assert.equal(await text(), original);
  pass("Alt+ArrowDown/Alt+ArrowUp move a heading among its siblings with keyboard focus retained, and the first sibling reports a boundary without editing.");

  // Menu alternative with duplicate headings.
  await clearMarks(); const dup = await rowSelector("Dup", 0); const menuPoint = await point(dup);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...menuPoint, button: "right", clickCount: 1 }); await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...menuPoint, button: "right", clickCount: 1 }); await clearMarks();
  await wait(`[...document.querySelectorAll(".menu .menu-item")].some(i=>i.textContent.includes("Move heading down"))`, "accessible Outline move menu");
  await evaluate(`[...document.querySelectorAll(".menu .menu-item")].find(i=>i.textContent.includes("Move heading down")).dataset.outlineTest="menu"`); await click('.menu [data-outline-test="menu"]'); await clearMarks();
  await settle(pre + one + two + three + dupB + dupA);
  assert.deepEqual(await titles(), ["One", "Two", "Three", "Dup", "Dup"].filter(title => title !== "Child"));
  await evaluate(`${view(noteId)}.editor.focus()`); await press("z", "KeyZ", 90, 2); await settle(original);
  pass("The Outline context menu moves one duplicate heading section past another; Undo restores the exact bytes.");

  // Peer editor and metadata.
  await evaluate(`(async()=>{const peer=app.workspace.getLeaf("split");peer.id=${JSON.stringify(peerId)};await peer.openFile(app.vault.getFileByPath(${JSON.stringify(path)}))})()`);
  await focusRow("Two"); await press("ArrowDown", "ArrowDown", 40, 1); await settle(pre + one + three + two + dupA + dupB);
  await wait(`${view(peerId)}.editor.getValue()===${view(noteId)}.editor.getValue()&&${view(noteId)}.session===${view(peerId)}.session&&${view(noteId)}.session.leaves.size===2`, "peer editor and shared session text");
  assert.deepEqual(await evaluate(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)})).headings.map(h=>h.heading)`), ["One", "Child", "Three", "Two", "Dup", "Dup"]);
  await evaluate("app.saveAll()"); await wait(`!${view(noteId)}.isDirty`, "explicit save"); const savedBytes = await disk(); assert.deepEqual([...savedBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "Physical BOM bytes survive the save"); assert.equal(savedBytes.indexOf(Buffer.from("\ufeff"), 3), -1, "No second BOM is written"); assert.equal(savedBytes.toString("latin1").replace(/\r\n/g, "").includes("\n"), false, "Every line ending stays CRLF"); assert.deepEqual(savedBytes, withBom(pre + one + three + two + dupA + dupB));
  pass("A reorder updates every peer editor, parsed headings and the explicit save writes exactly the moved BOM/CRLF bytes (BOM is physical file bytes; the editor text has none).");

  // Rename keeps the pane target; stale and externally changed notes refuse without edits.
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify("Outline panes/Reorder renamed.md")})`);
  await wait(`${view(paneId)}.file?.path==="Outline panes/Reorder renamed.md"`, "renamed Outline target"); const renamed = join(directory, "Outline panes/Reorder renamed.md");
  const saved = await readFile(renamed), external = Buffer.concat([saved, Buffer.from("external\r\n")]);
  await evaluate(`${view(noteId)}.editor.replaceRange("x",{line:0,ch:0})`);
  await writeFile(renamed, external); await evaluate("(async()=>{await app.vault.refresh()})()");
  await wait(`${view(noteId)}.isDirty`, "dirty edit retained after the external change");
  const generation = await focusRow("Dup", 0);
  const current = await evaluate(paneState);
  assert.deepEqual({ ...current, node: current.node === current.focusKey }, { generation, connected: true, inPane: true, node: true, focusKey: current.focusKey, member: true, heading: "Dup", occurrence: 0 }, "The CURRENT-generation Dup row must be the active element in this pane before the conflicting key");
  const before = await text(), previousStatus = await status(), conflictMessage = "The note changed, was renamed or has a save conflict. Save or reload it before reordering; no heading was moved.";
  await expectErrors({ evaluate, report }, [{ source: "notification", message: conflictMessage, stackIncludes: "OutlineView.reorder" }], async () => {
    await press("ArrowDown", "ArrowDown", 40, 1);
    await withStatus("conflict refusal not reported", () => wait(`document.querySelector(${JSON.stringify(pane + " [data-outline-status]")}).textContent===${JSON.stringify(conflictMessage)}`, "new conflict refusal status"));
  }, "Alt+ArrowDown on a dirty, externally changed note must reach the reorder guard and refuse");
  assert.notEqual(await status(), previousStatus, "The refusal status must be new, not the previous Moved message");
  assert.equal(await text(), before, "A dirty externally changed note must not be reordered"); assert.deepEqual(await readFile(renamed), external);
  await evaluate(`${view(noteId)}.session.reload(true)`);
  await wait(`!${view(noteId)}.isDirty`, "conflicting fixture edit discarded after the refusal assertions");
  assert.deepEqual(await readFile(renamed), external);
  pass("A renamed note remains the Outline target; a dirty note changed on disk refuses the move before any text or disk byte changes.");

  await evaluate("app.workspace.flushLayout()"); await capture("reorder-after");
  report.outlinePanes.reorder = { trustedPointerDrag: true, keyboard: true, contextMenu: true, singleUndo: true, peers: true, renameAndConflict: true, readOnlyGitHub: "see outlinePanes.readOnly.reorderRefused", privateTreeOriginalVisualPhysicalImeScale: "not claimed" };
}
