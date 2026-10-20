import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Native/WASM scenario for per-leaf navigation history. It drives the real header buttons,
// commands and keyboard through CDP, then restarts. It has not been run without a UI lease.
export async function checkWorkspaceHistory({ directory, evaluate, command, click, press, wait, afterReload, restart, report, capture }) {
  const folder = "History nav", names = ["A", "B", "C", "D"], originals = new Map();
  const path = name => folder + "/" + name + ".md";
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const automatic = await readFile(join(directory, ".obsidian/workspace.json")).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  const settled = async () => { await evaluate("app.workspace.whenIdle()"); await wait("!app.workspace.isChangingLayout&&!app.workspace.isChangingFiles", "workspace settled"); };
  const frames = () => evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))");
  const leafExpr = id => `app.workspace.getLeafById(${JSON.stringify(id)})`;
  const where = id => evaluate(`(()=>{const l=${leafExpr(id)},v=l.view,e=v.getEphemeralState?.()??{};return{file:l.getViewState().state.file,mode:v.mode,index:l.historyIndex,length:l.history.length,scroll:Math.round(v.contentEl.scrollTop),
    selection:v.editor?JSON.stringify([v.editor.getCursor("from"),v.editor.getCursor("to")]):null,eState:e}})()`);
  const settleScroll = async (id, expected) => {
    try { await wait(`Math.abs(${leafExpr(id)}.view.contentEl.scrollTop-${expected})<=2`, "scroll restored to " + expected); }
    catch (error) {
      const detail = await evaluate(`(()=>{const l=${leafExpr(id)};return JSON.stringify({scrollTop:l.view.contentEl.scrollTop,scrollHeight:l.view.contentEl.scrollHeight,clientHeight:l.view.contentEl.clientHeight,cmScroll:l.view.editor.cm.scrollDOM.scrollTop,cmSame:l.view.editor.cm.scrollDOM===l.view.contentEl,index:l.historyIndex,entries:l.history.map(e=>({file:e.state?.file,mode:e.state?.mode,eState:e.eState}))})})()`);
      const probe = await evaluate(`(async()=>{const c=${leafExpr(id)}.view.contentEl;c.scrollTop=${expected};const a=c.scrollTop;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return JSON.stringify({afterSet:a,afterFrames:c.scrollTop,cls:c.className,ov:getComputedStyle(c).overflowY,anchor:getComputedStyle(c).overflowAnchor})})()`);
      throw new Error(error.message + " | probe " + probe + " | actual " + detail);
    }
  };
  const nearly = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 2, `${label}: ${actual} must be within 2px of ${expected}`);
  async function walk(id, direction) {
    const button = `${leafExpr(id)}.${direction < 0 ? "backButton" : "forwardButton"}`;
    await evaluate(`app.workspace.setActiveLeaf(${leafExpr(id)},{focus:true})`);
    const point = await evaluate(`(()=>{const b=${button};b.scrollIntoView({block:"nearest"});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    await settled(); await frames();
  }

  await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder), { recursive: true });
  for (const name of names) {
    const bytes = Buffer.from("\ufeff# " + name + "\r\n\r\n" + Array.from({ length: 220 }, (_, n) => `${name} line ${n}: history λ and 中文.`).join("\r\n") + "\r\n");
    originals.set(path(name), bytes); await writeFile(join(directory, path(name)), bytes);
  }
  await command("Page.reload"); await afterReload();

  const leaf = (id, name) => ({ id, type: "leaf", state: { type: "markdown", state: { file: path(name), mode: "source", source: true, futureHistory: { keep: [id] } } } });
  const main = { id: "history-main", type: "split", direction: "vertical", children: [
    { id: "history-left-tabs", type: "tabs", currentTab: 0, children: [leaf("history-left", "A")] },
    { id: "history-right-tabs", type: "tabs", currentTab: 0, children: [leaf("history-right", "D")] },
  ] };
  await evaluate(`(async()=>{const value=app.workspace.getLayout();value.main=${JSON.stringify(main)};value.active="history-left";await app.workspace.changeLayout(value)})()`);
  await settled();
  await wait('Boolean(app.workspace.getLeafById("history-left")?.view?.editor)&&Boolean(app.workspace.getLeafById("history-right")?.view?.editor)', "history leaves loaded");

  // A: selection + scroll, B: caret, C: Reading mode + scroll. The right leaf must stay untouched.
  await evaluate(`(async()=>{const l=${leafExpr("history-left")};app.workspace.setActiveLeaf(l);l.view.editor.setSelection({line:3,ch:1},{line:3,ch:7})})()`); await frames();
  await evaluate(`${leafExpr("history-left")}.view.contentEl.scrollTop=420`); await frames();
  const rightBefore = await where("history-right");
  const selectionA = (await where("history-left")).selection; const scrollA = (await where("history-left")).scroll;
  assert.ok(scrollA > 300, "A really scrolled before navigating");
  await evaluate(`(async()=>{const l=${leafExpr("history-left")};await l.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("B"))}))})()`); await settled(); await frames();
  await evaluate(`${leafExpr("history-left")}.view.editor.setCursor({line:9,ch:4})`); await frames();
  await evaluate(`${leafExpr("history-left")}.view.contentEl.scrollTop=150`); await frames();
  const stateB = await where("history-left");
  await evaluate(`(async()=>{const l=${leafExpr("history-left")};await l.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("C"))}));l.view.setMode("preview")})()`); await settled(); await frames();
  await evaluate(`${leafExpr("history-left")}.view.contentEl.scrollTop=260`); await frames();
  const stateC = await where("history-left");
  assert.equal(stateC.mode, "preview"); assert.ok(stateC.scroll > 150, "Reading view really scrolled");
  assert.deepEqual(await where("history-right"), rightBefore, "navigating the left leaf leaves the right leaf's history and state untouched");

  // Real header Back button: C(reading) -> B(source) -> A(source) restoring exact locations.
  await walk("history-left", -1);
  let now = await where("history-left");
  assert.equal(now.file, path("B")); assert.equal(now.mode, "source"); assert.equal(now.selection, stateB.selection); await settleScroll("history-left", stateB.scroll);
  await walk("history-left", -1);
  now = await where("history-left");
  assert.equal(now.file, path("A")); assert.equal(now.selection, selectionA); await settleScroll("history-left", scrollA);
  assert.deepEqual((await where("history-right")).index, rightBefore.index, "Right leaf history index is independent");
  await capture("back-to-a");
  pass("The real header Back button restores source selection, caret and scroll per entry on one leaf while the sibling leaf's history stays untouched.");

  // Forward through the real command, including Reading mode and its scroll.
  await evaluate('app.commands.executeCommandById("app:go-forward")'); await settled(); await frames();
  await evaluate('app.commands.executeCommandById("app:go-forward")'); await settled(); await frames();
  now = await where("history-left");
  assert.equal(now.file, path("C")); assert.equal(now.mode, "preview"); await settleScroll("history-left", stateC.scroll);
  assert.equal(now.index, now.length - 1);
  pass("Forward via the app:go-forward command returns to Reading mode at the stored scroll offset.");

  async function tooltip(id, direction) {
    const target = `${leafExpr(id)}.${direction < 0 ? "backButton" : "forwardButton"}`;
    await evaluate(`(()=>{const b=${target};b.dispatchEvent(new PointerEvent("pointerleave"))})()`);
    const point = await evaluate(`(()=>{const r=${target}.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 200, y: point.y + 200 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    return evaluate(`${target}.title`);
  }
  const urlState = () => evaluate("({href:location.href,length:history.length})");
  async function mouseButton(id, button) {
    const point = await evaluate(`(()=>{const r=${leafExpr(id)}.view.contentEl.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button, buttons: button === "back" ? 8 : 16, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button, buttons: 0, clickCount: 1 });
    await settled(); await frames();
  }

  // Hotkeys go through the manager-owned override model: default Alt+Left, then customised, then removed.
  await evaluate(`app.workspace.setActiveLeaf(${leafExpr("history-left")},{focus:true})`);
  assert.equal(await tooltip("history-left", -1), "Back (Alt+ArrowLeft)", "Tooltip shows the manager's default binding");
  await press("ArrowLeft", "ArrowLeft", 37, 1); await settled();
  assert.equal((await where("history-left")).file, path("B"), "Default Alt+Left goes back");
  await evaluate('app.hotkeyManager.setHotkeys("app:go-forward",[{modifiers:["Mod","Shift"],key:"j"}])'); await frames();
  await press("J", "KeyJ", 74, 10); await settled();
  assert.equal((await where("history-left")).file, path("C"), "A customised hotkey on app:go-forward is honoured through the manager");
  await evaluate('app.hotkeyManager.setHotkeys("workspace:go-back",[])'); await frames();
  assert.equal(await tooltip("history-left", -1), "Back", "A cleared override removes the shortcut from the tooltip");
  await evaluate('app.hotkeyManager.setHotkeys("workspace:go-forward",[{modifiers:["Mod","Shift"],key:"k"}])'); await frames();
  assert.equal(await tooltip("history-left", 1), "Forward (Ctrl+Shift+K)", "A rebinding is shown in the tooltip");
  await evaluate('app.hotkeyManager.removeHotkeys("workspace:go-forward")');
  const before = await where("history-left");
  await press("ArrowLeft", "ArrowLeft", 37, 1); await settled();
  assert.equal((await where("history-left")).file, before.file, "A cleared override must disable the default shortcut");
  await evaluate('app.hotkeyManager.removeHotkeys("workspace:go-back");app.hotkeyManager.removeHotkeys("app:go-forward")'); await frames();
  assert.equal(await tooltip("history-left", -1), "Back (Alt+ArrowLeft)", "Restoring the default restores the tooltip");
  pass("Alt+Left, a customised app:go-forward shortcut and a cleared override follow app.hotkeyManager, and header tooltips show the manager's live bindings rather than fixed text.");

  // Trusted mouse back/forward buttons change only the pressed pane's target and never navigate the page.
  const url = await urlState(), rightMouse = await where("history-right");
  await mouseButton("history-left", "back");
  assert.equal((await where("history-left")).file, path("B"), "Mouse Back button navigates the pane");
  await mouseButton("history-left", "forward");
  assert.equal((await where("history-left")).file, path("C"), "Mouse Forward button navigates the pane");
  assert.deepEqual(await urlState(), url, "Mouse buttons must not navigate the browser/app URL");
  assert.deepEqual(await where("history-right"), rightMouse, "The other pane is unaffected by mouse buttons");
  pass("Trusted CDP mouse back/forward buttons move only the pressed leaf through its own history with no URL or browser-history change.");

  // Undo across file and state swaps on the same leaf: edit A, leave, come back, undo exactly once.
  await walk("history-left", -1); await walk("history-left", -1);
  assert.equal((await where("history-left")).file, path("A"));
  await evaluate(`(()=>{const l=${leafExpr("history-left")};l.view.editor.setCursor({line:2,ch:0});l.view.editor.focus()})()`);
  await command("Input.insertText", { text: "History edit λ " });
  const edited = await evaluate(`${leafExpr("history-left")}.view.editor.getValue()`);
  assert.notEqual(edited, originals.get(path("A")).toString("utf8").slice(1));
  await evaluate(`(async()=>{const l=${leafExpr("history-left")};await l.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("D"))}))})()`); await settled();
  await walk("history-left", -1);
  assert.equal(await evaluate(`${leafExpr("history-left")}.view.editor.getValue()`), edited, "Returning keeps the unsaved edit");
  await evaluate(`${leafExpr("history-left")}.view.editor.focus()`); await press("z", "KeyZ", 90, 2);
  assert.equal(await evaluate(`${leafExpr("history-left")}.view.editor.getValue()`), originals.get(path("A")).toString("utf8").slice(1), "Undo history survives the file swap");
  await press("y", "KeyY", 89, 2);
  assert.equal(await evaluate(`${leafExpr("history-left")}.view.editor.getValue()`), edited, "Redo survives too");
  assert.ok((await readFile(join(directory, path("A")), "utf8")).includes("History edit λ "), "Leaving a dirty note saves it as usual, while its undo history stays in the live editor");
  pass("Edits, undo and redo survive leaving and returning to a note through Back; undo history stays in the live editor across the swap (the note is saved on leaving, as for any file swap).");

  // Docked identity: moving the leaf into the other pane keeps its history array and entries.
  const identity = await evaluate(`(()=>{const l=${leafExpr("history-left")};globalThis.historyDock={leaf:l,history:l.history,view:l.view,index:l.historyIndex};return l.history.length})()`);
  await evaluate(`app.workspace.moveLeaf(${leafExpr("history-left")},${leafExpr("history-right")}.parent,1)`); await settled(); await frames();
  assert.deepEqual(await evaluate(`(()=>{const l=${leafExpr("history-left")};return[l===historyDock.leaf,l.history===historyDock.history,l.view===historyDock.view,l.historyIndex===historyDock.index,l.history.length,l.parent===${leafExpr("history-right")}.parent]})()`), [true, true, true, true, identity, true]);
  const dockStep = await evaluate(`${leafExpr("history-left")}.canGoBack?-1:1`);
  await walk("history-left", dockStep);
  assert.notEqual((await where("history-left")).index, await evaluate("historyDock.index"), "Back/Forward works after docking");
  assert.equal((await where("history-right")).file, path("D"), "The other leaf's file is untouched by the move");
  await walk("history-left", -dockStep);
  pass("A moved tab keeps leaf identity, history array, live view and independence, and Back/Forward keep working in the new pane.");

  // Rename remaps, delete (in-app and external) is skipped and pruned, vault changes are refused.
  await evaluate(`app.workspace.setActiveLeaf(${leafExpr("history-left")});(async()=>{const l=${leafExpr("history-left")};await l.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("B"))}));await l.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("C"))}))})()`); await settled();
  await evaluate(`app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("B"))}),${JSON.stringify(folder + "/B renamed.md")}).then(()=>true)`); await settled();
  assert.ok(await evaluate(`${leafExpr("history-left")}.history.every(entry=>entry.state?.file!==${JSON.stringify(path("B"))})&&${leafExpr("history-left")}.history.some(entry=>entry.state?.file===${JSON.stringify(folder + "/B renamed.md")})`), "Rename remaps entries");
  await walk("history-left", -1);
  assert.equal((await where("history-left")).file, folder + "/B renamed.md");
  await evaluate(`app.workspace.setActiveLeaf(${leafExpr("history-left")});(async()=>{await ${leafExpr("history-left")}.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("C"))}))})()`); await settled();
  await rm(join(directory, path("A")));
  await wait(`!app.vault.getAbstractFileByPath(${JSON.stringify(path("A"))})`, "external delete observed");
  const stale = await where("history-left");
  for (let step = 0; step < 6; step++) await evaluate(`${leafExpr("history-left")}.goBack().catch(()=>null)`);
  await settled();
  assert.ok(await evaluate(`${leafExpr("history-left")}.history.every(entry=>entry.state?.file!==${JSON.stringify(path("A"))})`), "Deleted target pruned");
  assert.ok((await where("history-left")).file !== path("A"), "Never navigates to a deleted file");
  assert.ok(stale.length >= (await where("history-left")).length);
  assert.deepEqual((await where("history-right")).file, path("D"));
  const frozen = await where("history-left");
  await evaluate("app.changingVault=true");
  await evaluate(`${leafExpr("history-left")}.goBack().then(()=>"moved",()=>"refused")`).then(value => assert.equal(value, "refused"));
  await evaluate("app.changingVault=false");
  assert.deepEqual(await where("history-left"), frozen, "A refused navigation changes nothing");
  pass("Rename remaps history; in-app/external deletion is skipped and pruned without navigating elsewhere; navigation during a vault change is refused without touching history.");

  // Restart: location history, selection and scroll are restored through the guarded layout path.
  await evaluate(`(async()=>{const l=${leafExpr("history-left")};app.workspace.setActiveLeaf(l);await l.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path("C"))}));l.view.setMode("source");const s=l.getViewState();await l.setViewState({...s,state:{...s.state,futureHistory:{keep:["history-left"]}}})})()`); await settled();
  await evaluate(`${leafExpr("history-left")}.view.editor.setSelection({line:7,ch:2},{line:7,ch:9})`); await frames();
  await evaluate(`${leafExpr("history-left")}.view.contentEl.scrollTop=333`); await frames();
  const persisted = await where("history-left");
  await evaluate("new Promise(resolve=>setTimeout(resolve,1500))");
  await evaluate("app.workspace.requestSaveLayout().then(()=>true)");
  if (restart) await restart(); else await command("Page.reload");
  await afterReload(); await settled();
  await wait('Boolean(app.workspace.getLeafById("history-left")?.view?.editor)', "history leaf restored");
  await settleScroll("history-left", persisted.scroll);
  const restored = await where("history-left");
  assert.equal(restored.file, persisted.file); assert.equal(restored.selection, persisted.selection);
  assert.equal(restored.length, persisted.length); assert.equal(restored.index, persisted.index);
  await walk("history-left", -1);
  assert.ok(await evaluate(`${leafExpr("history-left")}.history.some(entry=>entry.state.futureHistory?.keep?.[0]==="history-left")`), "Opaque Markdown state keys survive in restored history entries");
  assert.notEqual((await where("history-left")).file, undefined);
  assert.ok((await where("history-left")).index < persisted.index, "Restored history is navigable");
  await walk("history-left", 1);
  assert.equal((await where("history-left")).selection, persisted.selection); await settleScroll("history-left", persisted.scroll);
  await capture("restarted");
  assert.deepEqual(await readFile(join(directory, path("C"))), originals.get(path("C")), "Notes keep exact bytes");
  assert.deepEqual(await readFile(join(directory, ".obsidian/workspace.json")).catch(error => { if (error.code !== "ENOENT") throw error; return null; }), automatic, "Obsidian's own workspace.json is not rewritten");
  pass("Per-leaf entries, index, selection and scroll persist across restart, stay navigable and leave note bytes and the original workspace untouched.");
}
