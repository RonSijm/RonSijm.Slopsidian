import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const control = '[data-editor-settings] [data-setting-key="spellcheck"] [role="switch"]';
const q = JSON.stringify;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
async function openSettings({ evaluate, click, wait }) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) await click("#open-settings");
  await click("#editor-settings-tab");
  await wait(`Boolean(document.querySelector(${q(control)}))`, "visible Editor spellcheck preference");
}
async function closeSettings({ evaluate, click, wait }) {
  if (await evaluate('document.querySelector("#settings-dialog").open')) await click(".settings-close");
  await wait('!document.querySelector("#settings-dialog").open', "Editor settings closed");
}
async function choose(tools, value) {
  const { evaluate, click, wait } = tools;
  if (await evaluate(`document.querySelector(${q(control)}).getAttribute("aria-checked")==="true"`) !== value) await click(control);
  await wait(`app.configuration.get("app","spellcheck")===${value}`, "versioned spellcheck preference saved");
}
async function rightClick({ evaluate, command }, ch, alt = false) {
  const point = await evaluate(`(()=>{const e=app.editor,offset=e.cm.state.doc.line(3).from+${ch},r=e.cm.coordsAtPos(offset);if(!r)throw new Error("Missing actual editor word geometry");return{x:r.left+1,y:(r.top+r.bottom)/2}})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1, modifiers: alt ? 1 : 0 });
}
async function checkNativeContextOwnership(tools) {
  const { evaluate, wait, command } = tools;
  await evaluate(`(()=>{const ipc=require("electron").ipcRenderer;globalThis.spellingNativeInvokeBefore=ipc.invoke;let count=0;ipc.invoke=async function(channel,operation,...args){const result=await spellingNativeInvokeBefore.call(this,channel,operation,...args);if(channel==="slopsidian:spellcheck"&&operation==="context"&&++count===1){spellingFirstContextReady=true;await new Promise(resolve=>{globalThis.releaseSpellingFirstContext=resolve})}return result};globalThis.spellingFirstContextReady=false;})()`);
  try {
    await rightClick(tools, 3);
    await wait("globalThis.spellingFirstContextReady===true", "first actual native spelling response held");
    await rightClick(tools, 13);
    await wait('Boolean(document.querySelector(".menu[data-editor-menu]"))', "second native context opens the current shared menu");
    await evaluate('globalThis.spellingNewestContextMenu=document.querySelector(".menu[data-editor-menu]");true');
    await evaluate('(async()=>{releaseSpellingFirstContext();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))})()');
    assert.equal(await evaluate('spellingNewestContextMenu.isConnected&&spellingNewestContextMenu===document.querySelector(".menu[data-editor-menu]")'), true, "the superseded first native response cannot replace or dismiss the newer menu");
  } finally {
    await evaluate('(()=>{globalThis.releaseSpellingFirstContext?.();require("electron").ipcRenderer.invoke=spellingNativeInvokeBefore;delete globalThis.spellingNativeInvokeBefore;delete globalThis.releaseSpellingFirstContext;delete globalThis.spellingFirstContextReady;delete globalThis.spellingNewestContextMenu})()');
    for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
}
async function openNativeSpellingMenu(tools, ch) {
  const { evaluate, command, wait } = tools;
  const rootItem = '[data-editor-menu] [data-spelling-menu]';
  // The native checker runs asynchronously after typing/Undo. Request fresh
  // actual contexts while it settles; a generic menu is not engine acceptance.
  for (let attempt = 0; attempt < 20; attempt++) {
    await rightClick(tools, ch);
    await wait('Boolean(document.querySelector(".menu[data-editor-menu]"))', "actual editor context menu opened");
    if (await evaluate(`(()=>{const e=document.querySelector(${q(rootItem)});return Boolean(e&&!e.disabled)})()`)) return rootItem;
    for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await evaluate("new Promise(resolve=>setTimeout(()=>resolve(true),250))");
  }
  throw new Error("The real native spelling context did not provide a correction menu after trusted typing.");
}

/** Real settings, retained editors/history, native dictionary context when available, and both-host restoration. */
export async function checkSpellcheck(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const folder = "Spellcheck", path = folder + "/Spelling.md", configPath = join(directory, ".obsidian", "app.json");
  const original = "# Spelling λ\r\n\r\nmispelled helllo teh recieve exampel café λ\r\nKeep the original bytes.\r\n";
  const bytes = Buffer.from("\ufeff" + original), typed = original.replace("mispelled", "Typed mispelled");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  const originalConfig = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  const config = originalConfig ? JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, "")) : {};
  const fixtureConfig = { ...config, spellcheck: true, __spellcheckOpaque: { keep: ["中文", 42, true] } };
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, path), bytes, { flag: "wx" });
  try {
    await writeFile(configPath, encode(fixtureConfig));
    await evaluate(`(async()=>{await app.configuration.read("app");await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(2,3);app.editor.focus()})()`);
    await command("Page.bringToFront");
    await wait('app.editor.cm.contentDOM.getAttribute("spellcheck")==="true"', "accepted spelling reaches the actual CodeMirror contenteditable");
    await evaluate('app.editor.replaceRange("Typed ",{line:2,ch:0},undefined,"input.type");app.editor.undo();app.editor.setSelection({line:2,ch:0},{line:2,ch:9});globalThis.spellingRetained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection};true');
    await openSettings(tools); assert.equal(await evaluate(`document.querySelector(${q(control)}).getAttribute("aria-checked")==="true"`), true);
    for (const value of [false, true]) {
      await choose(tools, value);
      await wait(`app.editor.cm.contentDOM.getAttribute("spellcheck")===${q(String(value))}`, "actual spelling attribute follows the visible toggle");
      assert.equal(await evaluate("app.editor===spellingRetained.editor&&app.editor.cm===spellingRetained.cm&&app.editor.cm.state.doc===spellingRetained.doc&&app.editor.cm.state.selection.eq(spellingRetained.selection)"), true);
    }
    await capture?.("spellcheck-settings");
    await closeSettings(tools);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), typed);
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    assert.deepEqual(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).__spellcheckOpaque, fixtureConfig.__spellcheckOpaque);
    assert.deepEqual(await readFile(join(directory, path)), bytes);
    pass(report, "The visible Editor spellcheck toggle saves versioned app.json data, updates the same real CodeMirror editor without changing its document/selection/Undo history, and preserves opaque settings plus exact BOM/CRLF note bytes.");

    await evaluate('app.workspace.activeLeaf.view.setEditingMode("live-preview");app.editor.focus();app.editor.setMutationLock(true)');
    assert.equal(await evaluate('app.editor.cm.contentDOM.getAttribute("spellcheck")'), "false");
    await command("Input.insertText", { text: "blocked" }); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate("app.editor.setMutationLock(false)");
    await wait('app.editor.cm.contentDOM.getAttribute("spellcheck")==="true"', "Live Preview spelling returns after the mutation barrier");
    const browser = await evaluate('document.body.classList.contains("is-browser")');
    if (browser) {
      await rightClick(tools, 3, true);
      assert.equal(await evaluate('Boolean(document.querySelector(".menu[data-editor-menu]"))'), false, "Alt+right-click is left to the actual host browser");
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      report.spellcheck = { browserDictionary: "host-controlled; native browser menu routing exercised, dictionary UI is outside this Electron-hosted browser harness" };
    } else {
      // Synchronous webFrame Hunspell queries are not a readiness gate on this
      // runtime: real native context events can contain corrections while those
      // queries return false/empty. Trigger genuine editing, retain its isolated
      // Undo/Redo, and require the actual native menu and correction below.
      const warm = original.replace("café λ", "café λ ");
      await evaluate("app.editor.setCursor(2,app.editor.getLine(2).length);app.editor.focus()");
      await command("Input.insertText", { text: " " });
      await wait(`app.editor.getValue()===${q(warm)}`, "trusted spelling input reaches the actual editable note");
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
      await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), warm);
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
      await checkNativeContextOwnership(tools);
      const native = await evaluate('(async()=>{const {ipcRenderer,webFrame}=require("electron"),state=await ipcRenderer.invoke("slopsidian:spellcheck","state",{}),words=["mispelled","helllo","teh","recieve","exampel"],synchronousProbe=words.map(word=>({word,misspelled:webFrame.isWordMisspelled(word),suggestions:webFrame.getWordSuggestions(word)}));return{...state,synchronousProbeReady:synchronousProbe.some(value=>value.misspelled&&value.suggestions.length),synchronousProbe}})()');
      assert.equal(native.enabled, true); assert.equal(native.error, null); assert.ok(native.languages.length);
      report.spellcheck = { native: { ...native, newerContextOwnsMenu: true } };
      {
        const word = "mispelled", ch = original.split("\r\n")[2].indexOf(word) + 2;
        const row = '.menu [data-spelling-replacement]';
        const rootItem = await openNativeSpellingMenu(tools, ch);
        await click(rootItem); await wait(`Boolean(document.querySelector(${q(row)}))`, "actual dictionary correction control");
        const replacement = await evaluate(`document.querySelector(${q(row)}).dataset.spellingReplacement`);
        await click(row);
        const corrected = original.replace(word, replacement);
        await wait(`app.editor.getValue()===${q(corrected)}`, "actual native spelling choice uses a guarded editor transaction");
        await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
        await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), corrected);
        await evaluate("app.editor.undo()");
        await openNativeSpellingMenu(tools, ch);
        await click(rootItem);
        await evaluate(`globalThis.spellingHeld=document.querySelector(${q(row)});app.editor.replaceRange("Prefix ",{line:2,ch:0},undefined,"input.type")`);
        const shifted = await evaluate("app.editor.getValue()");
        await evaluate("spellingHeld.click();delete globalThis.spellingHeld");
        assert.equal(await evaluate("app.editor.getValue()"), shifted, "a spelling row cannot edit a newer document generation");
        await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
        Object.assign(report.spellcheck.native, { dictionaryReady: true, word, replacement, actualContextMenuAndGuardedCorrection: true });
      }
    }
    await capture?.("spellcheck-live-preview");
    await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes);
    pass(report, "Live Preview retains spelling after a mutation barrier, while held input remains blocked. Native acceptance requires genuine typing, owned real context events, an actual correction, isolated Undo/Redo and stale-row refusal; the browser route preserves its own spelling menu without replacing the host dictionary engine.");

    await writeFile(configPath, encode({ ...fixtureConfig, spellcheck: false }));
    await wait('app.configuration.get("app","spellcheck")===false&&app.editor.cm.contentDOM.getAttribute("spellcheck")==="false"', "configuration watching adopts an external spellcheck preference");
    await writeFile(configPath, encode({ ...fixtureConfig, spellcheck: "false" }));
    await evaluate('app.configuration.refresh("app")');
    await openSettings(tools);
    assert.equal(await evaluate(`document.querySelector(${q(control)}).getAttribute("aria-checked")==="true"`), false);
    assert.equal(await evaluate('document.querySelector("[data-editor-settings]").textContent.includes("saved value is invalid")'), true);
    await choose(tools, true); await closeSettings(tools);
    await evaluate('app.commands.execute("editor:toggle-spellcheck")');
    await wait('app.configuration.get("app","spellcheck")===false&&app.editor.cm.contentDOM.getAttribute("spellcheck")==="false"', "toggle command saves the next preference");
    await evaluate("app.workspace.flushLayout()");
    if (restart) await restart(); else await command("Page.reload");
    await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&!app.changingVault`, "spellcheck note restored after restart/reconnection");
    assert.equal(await evaluate("app.editor.getValue()"), original);
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getEditingMode()'), "live-preview");
    assert.equal(await evaluate('app.editor.cm.contentDOM.getAttribute("spellcheck")'), "false");
    await openSettings(tools); assert.equal(await evaluate(`document.querySelector(${q(control)}).getAttribute("aria-checked")==="true"`), false);
    await closeSettings(tools); assert.deepEqual(await readFile(join(directory, path)), bytes);
    pass(report, "External spellcheck changes reach the live editor; malformed saved values are visibly disabled and can be corrected, the command persists a Boolean choice, and full restart/reconnection retains that choice plus Live Preview mode and exact note bytes.");
  } finally {
    await closeSettings(tools);
    await evaluate("delete globalThis.spellingHeld;delete globalThis.spellingRetained;app.editor.setMutationLock(false);app.saveAll()");
    if (originalConfig) await writeFile(configPath, originalConfig); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await evaluate(`(async()=>{await app.configuration.read("app");await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent owns the actual cache-only mount and audits all blobs and network counters. */
export async function checkSpellcheckReadOnly(tools) {
  const { evaluate, report } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const before = await evaluate("app.editor.getValue()"), data = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  assert.equal(await evaluate('app.editor.cm.contentDOM.getAttribute("spellcheck")'), "false");
  await openSettings(tools); await choose(tools, false); await closeSettings(tools);
  const after = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  assert.deepEqual({ ...after, spellcheck: data.spellcheck }, data);
  assert.equal(await evaluate("app.editor.getValue()"), before);
  assert.equal(await evaluate('app.editor.cm.contentDOM.getAttribute("spellcheck")'), "false");
  pass(report, "A genuine cache-only read-only note disables spelling mutations, while the visible preference saves only its local configuration overlay and retains unknown data and exact note text.");
}
