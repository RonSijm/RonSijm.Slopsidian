import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pixel } from "./reading-scenarios.mjs";

export async function checkEditorModes({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const folder = "Editor modes", path = folder + "/Mixed.md", target = folder + "/Target.md", image = folder + "/Pixel.png";
  const text = [
    "---", "title: Preserved metadata", "---", "# Live heading", "",
    "**Strong** *Emphasis* ~~Removed~~ ==Highlighted== and `Literal ==code==`.", "",
    "- [ ] Task one", "- [x] Task two", "",
    `[[${target}#Destination|A real alias]] and [Markdown target](Target.md#Destination).`, "",
    `![[${image}]]`, "",
    "| Name | Value |", "| --- | --- |", "| Source | Kept |", "",
    "```mermaid", "flowchart LR", "  A[Local preview] --> B[Done]", "```", "",
    "````md", "# Literal heading", "**Literal formatting**", "````", "",
    "<!-- **Hidden markup** -->", "", "End of fixture.", "",
  ].join("\r\n");
  const bytes = value => Buffer.from("\ufeff" + value);
  const original = bytes(text);
  const pluginId = "editor-mode-host-probe";
  const active = ".workspace-tabs.mod-active .workspace-leaf:not([hidden])";
  const source = active + " .markdown-source-view";
  const status = "[data-editor-status]";
  const labels = { source: "Source mode", preview: "Reading view", "live-preview": "Live Preview" };
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const optionalRead = name => readFile(join(directory, ".obsidian", name)).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const originalWorkspace = await optionalRead("workspace.json");
  const originalCommunity = await optionalRead("community-plugins.json");
  const originalApp = await optionalRead("app.json");
  const originalLayout = await evaluate("app.workspace.getLayout()");
  const initiallyEnabled = await evaluate('app.core.isEnabled("editor-status")');
  const preferences = bytes(JSON.stringify({
    ...originalApp ? JSON.parse(originalApp.toString("utf8").replace(/^\ufeff/, "")) : {},
    livePreview: true,
    futureEditorPreference: { retained: [true, "opaque", 19] },
  }, null, 2));
  const modeState = id => `app.workspace.getLeafById(${JSON.stringify(id)}).getViewState()`;
  async function settings(tab) {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click(tab);
  }
  async function toggleStatus(enabled) {
    await settings("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
    if (await evaluate('app.core.isEnabled("editor-status")') !== enabled) { await click('[data-core-toggle="editor-status"]'); }
    await wait(`!app.core.busy&&app.core.isEnabled("editor-status")===${enabled}`, "Editor status enabled state");
    await click(".settings-close");
  }
  async function togglePlugin(enabled) {
    await settings("#community-plugins-tab");
    const selector = `.plugin-card[data-plugin-id="${pluginId}"]`;
    if (await evaluate(`document.querySelector(${JSON.stringify(selector)}).dataset.loaded`) !== String(enabled)) { await click(`[data-toggle-plugin="${pluginId}"]`); }
    await wait(`document.querySelector(${JSON.stringify(selector)}).dataset.loaded===${JSON.stringify(String(enabled))}`, "real editor-extension probe enabled state");
    await click(".settings-close");
  }
  async function restoreUrlObserver() {
    await evaluate('(()=>{if(globalThis.editorModeOriginalRevoke){URL.revokeObjectURL=globalThis.editorModeOriginalRevoke;delete globalThis.editorModeOriginalRevoke}delete globalThis.editorModeRevoked})()');
  }
  async function reload() {
    await restoreUrlObserver();
    await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }
  async function open(note) {
    if (await evaluate("app.workspace.leftSplit.collapsed")) { await click('[aria-label="Toggle left sidebar"]'); }
    await click('[data-sidebar-view="file-explorer"]');
    await click(`[data-note-path="${note}"]`);
    await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "real file opened: " + note);
  }
  async function choose(mode, keyboard = false) {
    const before = await evaluate("app.workspace.activeLeaf.view.getEditingMode()");
    await click(status);
    await wait('Boolean(document.querySelector("[data-editor-mode-menu]"))', "actual checked editor-mode menu");
    assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-editor-mode-menu] .menu-item")].map(item=>({label:item.dataset.menuTitle,checked:item.getAttribute("aria-checked")}))'),
      ["preview", "source", "live-preview"].map(value => ({ label: labels[value], checked: String(value === before) })));
    if (keyboard) {
      await press("Home", "Home", 36);
      for (let index = 0; index < ["preview", "source", "live-preview"].indexOf(mode); index++) { await press("ArrowDown", "ArrowDown", 40); }
      await press("Enter", "Enter", 13);
    } else {
      await click(`[data-editor-mode-menu] [data-menu-title="${labels[mode]}"]`);
    }
    await wait(`!document.querySelector("[data-editor-mode-menu]")&&app.workspace.activeLeaf.view.getEditingMode()===${JSON.stringify(mode)}&&document.querySelector(${JSON.stringify(status)}).dataset.editorStatus===${JSON.stringify(mode)}`, "selected actual " + labels[mode]);
  }
  async function scrollTo(needle) {
    await evaluate(`(()=>{const editor=app.editor,at=editor.cm.state.doc.toString().indexOf(${JSON.stringify(needle)});if(at<0)throw new Error("Missing editor-mode fixture text");const position=editor.offsetToPos(at);editor.scrollIntoView({from:position,to:position},true);editor.cm.coordsAtPos(at)})()`);
  }
  async function activate(id) {
    await click(`[data-tab-id="${id}"]`);
    await wait(`app.workspace.activeLeaf.id===${JSON.stringify(id)}`, "actual note tab activated");
  }
  const extensionPresent = () => evaluate('getComputedStyle(app.editor.cm.dom).getPropertyValue("--editor-mode-probe").trim()==="enabled"');
  await evaluate("app.workspace.saveAll()");
  await mkdir(join(directory, folder), { recursive: true });
  const pluginDirectory = join(directory, ".obsidian", "plugins", pluginId);
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(join(directory, path), original);
  await writeFile(join(directory, target), "# Destination\r\n\r\nActual linked destination.\r\n");
  await writeFile(join(directory, image), pixel(2, 3));
  await writeFile(join(directory, ".obsidian", "app.json"), preferences);
  await writeFile(join(pluginDirectory, "manifest.json"), JSON.stringify({ id: pluginId, name: "Editor mode host probe", version: "1.0.0", description: "Independent shared-editor extension fixture", isDesktopOnly: false }));
  await writeFile(join(pluginDirectory, "main.js"), `
const { Plugin } = require("obsidian");
const { EditorView } = require("@codemirror/view");
module.exports = class extends Plugin {
  onload() {
    const state = globalThis.editorModeHostProbe = { changes: 0, cleaned: 0 };
    this.registerEditorExtension([
      EditorView.theme({ "&": { "--editor-mode-probe": "enabled" } }),
      EditorView.updateListener.of(update => { if (update.docChanged) { state.changes++; } })
    ]);
    this.register(() => { state.cleaned++; });
  }
};
`);
  try {
    await reload();
    await toggleStatus(true);
    await togglePlugin(true);
    await click('.workspace-tabs.mod-active [data-workspace-action="new-tab"]');
    await wait('app.workspace.activeLeaf.view.getViewType()==="empty"', "real empty tab");
    assert.equal(await evaluate('document.querySelector("[data-editor-status]").checkVisibility()'), false);
    await open(image);
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getViewType()'), "image");
    assert.equal(await evaluate('document.querySelector("[data-editor-status]").checkVisibility()'), false);
    await click('.workspace-tabs.mod-active [data-workspace-action="new-tab"]');
    await open(path);
    const firstId = await evaluate("app.workspace.activeLeaf.id");
    await wait('app.workspace.activeLeaf.view.getEditingMode()==="live-preview"', "explicit global Live Preview preference");
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getMode()'), "source");
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getState().source'), false);
    assert.equal(await extensionPresent(), true);
    await choose("source");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(source)}).classList.contains("is-live-preview")`), false);
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(source + " .cm-live-widget")}).length`), 0);
    await choose("preview", true);
    await wait(`document.querySelector(${JSON.stringify(active + " .markdown-preview-view h1")})?.textContent==="Live heading"`, "actual Reading heading");
    await choose("live-preview", true);
    await scrollTo("**Strong**");
    await wait(`document.querySelector(${JSON.stringify(source + " .cm-live-strong")})?.textContent==="Strong"`, "actual in-place strong formatting");
    assert.deepEqual(await evaluate(`(()=>{const source=document.querySelector(${JSON.stringify(source)});return {
      strong:Number(getComputedStyle(source.querySelector(".cm-live-strong")).fontWeight)>=700,
      emphasis:getComputedStyle(source.querySelector(".cm-live-emphasis")).fontStyle==="italic",
      strike:getComputedStyle(source.querySelector(".cm-live-strike")).textDecorationLine.includes("line-through"),
      highlight:getComputedStyle(source.querySelector(".cm-live-highlight")).backgroundColor!=="rgba(0, 0, 0, 0)",
      literal:source.querySelector(".cm-live-inline-code").textContent,
      hidden:!source.textContent.includes("**Strong**")
    }})()`), { strong: true, emphasis: true, strike: true, highlight: true, literal: "Literal ==code==", hidden: true });
    assert.deepEqual(await readFile(join(directory, path)), original);
    pass("The real status control hides for empty/image leaves, honors explicit app.json Live Preview, offers checked keyboard/pointer Source/Reading/Live Preview choices and applies actual in-place Markdown styles without changing native getMode semantics or file bytes.");

    await click(source + " .cm-live-strong");
    await wait(`document.querySelector(${JSON.stringify(source)}).textContent.includes("**Strong**")`, "selected formatting reveals its actual source markers");
    const cursor = await evaluate("app.editor.getCursor()");
    const editedLines = text.split("\r\n");
    editedLines[cursor.line] = editedLines[cursor.line].slice(0, cursor.ch) + "Edited" + editedLines[cursor.line].slice(cursor.ch);
    const edited = editedLines.join("\r\n");
    await command("Input.insertText", { text: "Edited" });
    await wait(`app.editor.getValue()===${JSON.stringify(edited)}&&app.dirty`, "actual typing edits formatted Markdown");
    await choose("preview");
    await choose("source");
    assert.equal(await evaluate("app.editor.getValue()"), edited);
    assert.deepEqual(await readFile(join(directory, path)), original, "mode changes must not save unsaved Markdown");
    assert.equal(await extensionPresent(), true);
    await press("z", "KeyZ", 90, 2);
    await wait(`app.editor.getValue()===${JSON.stringify(text)}&&!app.dirty`, "undo survives actual mode switches");
    await press("y", "KeyY", 89, 2);
    await wait(`app.editor.getValue()===${JSON.stringify(edited)}`, "redo survives actual mode switches");
    await press("z", "KeyZ", 90, 2);
    await choose("live-preview");
    await press("End", "End", 35, 2);
    await scrollTo("- [ ] Task one");
    const taskCursor = await evaluate("app.editor.getCursor()");
    const checked = text.replace("- [ ] Task one", "- [x] Task one");
    await evaluate(`(()=>{
      globalThis.editorModeTaskEvents=[];globalThis.editorModeTaskAbort=new AbortController();
      for(const type of ["mousedown","mouseup","click","change","focusin","selectionchange"]){
        document.addEventListener(type,event=>{
          const view=app.workspace.activeLeaf.view;
          editorModeTaskEvents.push({type,target:event.target.outerHTML?.slice(0,180),checked:event.target.checked,connected:event.target.isConnected,mode:view.getEditingMode(),loaded:view.isLoaded,changing:app.workspace.isChangingFiles,cursor:view.editor.cm.state.selection.main.head});
        },{capture:true,signal:editorModeTaskAbort.signal});
      }
    })()`);
    try {
      await click(source + ' .cm-live-task[aria-label="Complete task"]');
      await wait(`app.editor.getValue()===${JSON.stringify(checked)}&&app.dirty`, "real checkbox changes only the actual Markdown marker");
      assert.deepEqual(await evaluate("app.editor.getCursor()"), taskCursor, "clicking a rendered task must not displace the source caret");
    } catch (error) {
      const details = await evaluate('({events:editorModeTaskEvents.slice(-15),text:app.editor.getValue(),error:document.querySelector("#client-errors").textContent})');
      throw new Error("Actual Live Preview task input failed: " + JSON.stringify(details), { cause: error });
    } finally {
      await evaluate('(()=>{editorModeTaskAbort.abort();delete globalThis.editorModeTaskAbort;delete globalThis.editorModeTaskEvents})()');
    }
    assert.deepEqual(await readFile(join(directory, path)), original);
    await press("z", "KeyZ", 90, 2);
    await wait(`app.editor.getValue()===${JSON.stringify(text)}&&!app.dirty`, "task checkbox undo");
    await press("y", "KeyY", 89, 2);
    await wait(`app.editor.getValue()===${JSON.stringify(checked)}`, "task checkbox redo");
    await press("s", "KeyS", 83, 2);
    await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving", "explicit Live Preview save");
    assert.deepEqual(await readFile(join(directory, path)), bytes(checked));
    pass("Real formatted-text typing and task-checkbox input preserve selections, undo/redo, dirty buffers and community editor extensions across all three modes; only explicit save writes the exact original BOM/CRLF with the intended task marker changed.");

    await evaluate('(()=>{globalThis.editorModeOriginalRevoke=URL.revokeObjectURL;globalThis.editorModeRevoked=[];URL.revokeObjectURL=url=>{editorModeRevoked.push(url);editorModeOriginalRevoke(url)}})()');
    await scrollTo(`![[${image}]]`);
    await wait(`(()=>{const image=document.querySelector(${JSON.stringify(source + " .cm-live-embed img")});return image?.complete&&image.naturalWidth===2&&image.naturalHeight===3})()`, "actual decoded Live Preview vault image");
    const imageUrl = await evaluate(`document.querySelector(${JSON.stringify(source + " .cm-live-embed img")}).src`);
    await click(source + " .cm-live-embed > .cm-live-edit");
    await wait(`app.editor.cm.state.doc.sliceString(app.editor.cm.state.selection.main.from).startsWith(${JSON.stringify(`![[${image}]]`)})&&!document.querySelector(${JSON.stringify(source + " .cm-live-embed")})`, "image Edit reveals exact editable source");
    assert.ok((await evaluate("editorModeRevoked")).includes(imageUrl), "revealing an image releases its owned resource URL");
    await press("End", "End", 35, 2);
    await scrollTo("| Name | Value |");
    await wait(`document.querySelector(${JSON.stringify(source + " .cm-live-block table td")})?.textContent==="Source"`, "actual in-place rendered table");
    assert.equal(await evaluate(`(()=>{const table=document.querySelector(${JSON.stringify(source + " .cm-live-block table")});return Math.abs(table.querySelector("tbody tr").getBoundingClientRect().top-table.querySelector("thead tr").getBoundingClientRect().bottom)<=2})()`), true, "rendered table rows must not inherit CodeMirror's preserved markup whitespace");
    await click(source + " .cm-live-block:has(table) > .cm-live-edit");
    await wait('app.editor.cm.state.doc.sliceString(app.editor.cm.state.selection.main.from).startsWith("| Name | Value |")', "table Edit reveals original cells");
    await press("End", "End", 35, 2);
    await scrollTo("```mermaid");
    await wait(`(()=>{const block=document.querySelector(${JSON.stringify(source + ' [data-mermaid-status="ready"]')});return block?.querySelector("img")?.naturalWidth>0})()`, "actual local Mermaid diagram inside CodeMirror");
    const diagramUrl = await evaluate(`document.querySelector(${JSON.stringify(source + " .mermaid-image")}).src`);
    await click(source + " .cm-live-block:has(.mermaid-image) > .cm-live-edit");
    await wait('app.editor.cm.state.doc.sliceString(app.editor.cm.state.selection.main.from).startsWith("```mermaid")', "diagram Edit reveals the actual fence");
    assert.ok((await evaluate("editorModeRevoked")).includes(diagramUrl), "revealing a diagram releases its owned resource URL");
    await press("End", "End", 35, 2);
    await scrollTo("- [x] Task one");
    await evaluate(`(()=>{globalThis.editorModeRetainedTask=document.querySelector(${JSON.stringify(source + " .cm-live-task")})})()`);
    await choose("source");
    await evaluate('(()=>{editorModeRetainedTask.checked=!editorModeRetainedTask.checked;editorModeRetainedTask.dispatchEvent(new Event("change",{bubbles:true}));delete globalThis.editorModeRetainedTask})()');
    assert.equal(await evaluate("app.editor.getValue()"), checked);
    assert.equal(await evaluate("app.dirty"), false);
    await wait('document.querySelectorAll("[data-mermaid-sandbox]").length===0', "owned preview renderers release all work");
    await choose("live-preview");
    await press("End", "End", 35, 2);
    await scrollTo("A real alias");
    await click(source + ' [data-live-wiki="true"]', 2);
    await wait(`app.current?.file.path===${JSON.stringify(target)}&&app.workspace.activeLeaf.view.getMode()==="preview"`, "actual Ctrl-click navigation from a styled wiki alias");
    assert.equal(await evaluate("app.workspace.activeLeaf.id!== " + JSON.stringify(firstId)), true);
    assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(firstId)}).view.getEditingMode()`), "live-preview");
    await activate(firstId);
    await restoreUrlObserver();
    if (capture) { await capture(); }
    pass("CodeMirror displays an actually decoded local image, rendered table and local Mermaid image; their real Edit buttons reveal original source and revoke resources, detached task controls are inert, and Ctrl-clicking a wiki alias opens the resolved heading in a separate real Reading leaf.");

    await press("\\", "Backslash", 220, 2);
    await wait(`app.workspace.activeLeaf.id!==${JSON.stringify(firstId)}&&app.workspace.activeLeaf.view.file?.path===${JSON.stringify(path)}`, "actual Split right shortcut");
    const secondId = await evaluate("app.workspace.activeLeaf.id");
    await choose("source");
    assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(firstId)}).session===app.workspace.activeLeaf.session`), true);
    assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(firstId)}).view.getEditingMode()`), "live-preview");
    await press("End", "End", 35, 2);
    await command("Input.insertText", { text: "Shared edit." });
    const shared = checked + "Shared edit.";
    await wait(`app.editor.getValue()===${JSON.stringify(shared)}&&app.workspace.getLeafById(${JSON.stringify(firstId)}).view.editor.getValue()===${JSON.stringify(shared)}`, "shared buffer across independent Source and Live Preview panes");
    assert.equal(await extensionPresent(), true);
    await evaluate('(async()=>{const leaf=app.workspace.activeLeaf,state=leaf.getViewState();delete state.state.source;await leaf.setViewState({...state,state:{...state.state,mode:"preview"}})})()');
    assert.equal(await evaluate("app.workspace.activeLeaf.view.getState().source"), true, "omitting source on a loaded leaf must retain its per-leaf choice, not reapply the global preference");
    assert.equal(await evaluate("app.dirty"), true);
    assert.deepEqual(await readFile(join(directory, path)), bytes(checked));
    await evaluate(`(async()=>{const leaf=app.workspace.activeLeaf,state=leaf.getViewState();await leaf.setViewState({...state,state:{...state.state,mode:"preview",source:false,editorModesOpaque:{future:[17,true,"keep"]}}})})()`);
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getEditingMode()'), "preview");
    assert.equal(await evaluate("app.editor.getValue()"), shared);
    assert.equal(await evaluate("app.dirty"), true);
    assert.deepEqual(await readFile(join(directory, path)), bytes(checked), "same-file public setViewState must not save a dirty buffer");
    const beforeInvalid = await evaluate("app.workspace.activeLeaf.getViewState()");
    for (const invalid of ["false", 0]) {
      const error = await evaluate(`(async()=>{const leaf=app.workspace.activeLeaf,state=leaf.getViewState();try{await leaf.setViewState({...state,state:{...state.state,source:${JSON.stringify(invalid)}}});return null}catch(error){return error.message}})()`);
      assert.match(error, /source flag must be Boolean/);
      assert.deepEqual(await evaluate("app.workspace.activeLeaf.getViewState()"), beforeInvalid);
      assert.equal(await evaluate("app.editor.getValue()"), shared);
      assert.equal(await evaluate("app.dirty"), true);
    }
    await choose("source");
    await press("z", "KeyZ", 90, 2);
    await wait(`app.editor.getValue()===${JSON.stringify(checked)}&&!app.dirty`, "public mode transitions preserve undo and the shared dirty baseline");
    await press("y", "KeyY", 89, 2);
    await press("s", "KeyS", 83, 2);
    await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving", "shared note saved explicitly");
    assert.deepEqual(await readFile(join(directory, path)), bytes(shared));
    pass("Real split panes retain independent per-leaf modes with a shared document and community extensions; public same-file setViewState preserves unsaved text/history, rejects malformed source flags without disturbing the view, and retains opaque state.");

    const external = shared.replace("**Strong**", "**External strong**");
    await writeFile(join(directory, path), bytes(external));
    await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    await wait(`app.editor.getValue()===${JSON.stringify(external)}&&app.workspace.getLeafById(${JSON.stringify(firstId)}).view.editor.getValue()===${JSON.stringify(external)}`, "actual clean external change refreshes both editing modes");
    await press("End", "End", 35, 2);
    await press("Enter", "Enter", 13);
    await command("Input.insertText", { text: "Local pending." });
    const pending = external + "\r\nLocal pending.";
    const conflicting = external.replace("External strong", "External conflict");
    await writeFile(join(directory, path), bytes(conflicting));
    await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
    assert.equal(await evaluate("app.editor.getValue()"), pending);
    const conflict = await evaluate('(async()=>{try{await app.saveAll();return null}catch(error){return error.message}})()');
    assert.match(conflict, /changed|conflict/i);
    assert.equal(await evaluate("app.editor.getValue()"), pending);
    assert.deepEqual(await readFile(join(directory, path)), bytes(conflicting));
    await evaluate("app.reloadFromDisk()");
    await wait(`app.editor.getValue()===${JSON.stringify(conflicting)}&&!app.dirty`, "explicit discard/reload accepts the real external bytes");
    assert.equal(await extensionPresent(), true);
    pass("Actual external writes refresh clean Source/Live Preview peers, but conflicting saved bytes cannot overwrite a dirty shared buffer; the guarded save rejects visibly to its caller and explicit discard/reload retains the external BOM/CRLF document.");

    await activate(firstId);
    await click(status);
    await evaluate('(()=>{globalThis.editorModeRetainedStatus=document.querySelector("[data-editor-status]");globalThis.editorModeRetainedItem=document.querySelector(\'[data-editor-mode-menu] [data-menu-title="Source mode"]\')})()');
    await evaluate('app.core.setEnabled("editor-status",false)');
    assert.equal(await evaluate('document.querySelector("[data-editor-status], [data-editor-mode-menu]")'), null);
    await evaluate('(()=>{editorModeRetainedStatus.click();editorModeRetainedItem.click();delete globalThis.editorModeRetainedStatus;delete globalThis.editorModeRetainedItem})()');
    assert.equal(await evaluate('document.querySelector("[data-editor-mode-menu]")'), null);
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getEditingMode()'), "live-preview");
    await press("e", "KeyE", 69, 2);
    await wait('app.workspace.activeLeaf.view.getMode()==="preview"', "Reading still works without the status core module");
    await press("e", "KeyE", 69, 2);
    await wait('app.workspace.activeLeaf.view.getEditingMode()==="live-preview"', "Live Preview still works without the status core module");
    const savedStates = await evaluate(`[${modeState(firstId)},${modeState(secondId)}]`);
    await reload();
    assert.equal(await evaluate('app.core.isEnabled("editor-status")'), false);
    assert.equal(await evaluate('document.querySelector("[data-editor-status]")'), null);
    assert.deepEqual(await evaluate(`[${modeState(firstId)},${modeState(secondId)}]`), savedStates);
    assert.equal(await extensionPresent(), false, "community plugins still require explicit trust after a fresh host start");
    await togglePlugin(true);
    assert.equal(await extensionPresent(), true);
    await toggleStatus(true);
    assert.equal(await evaluate('document.querySelectorAll("[data-editor-status]").length'), 1);
    await choose("preview");
    await choose("live-preview");
    await togglePlugin(false);
    assert.equal(await extensionPresent(), false);
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getEditingMode()'), "live-preview");
    await reload();
    assert.equal(await evaluate('app.core.isEnabled("editor-status")&&document.querySelectorAll("[data-editor-status]").length===1'), true);
    assert.deepEqual(await evaluate(`[${modeState(firstId)},${modeState(secondId)}]`), savedStates);
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getEditingMode()'), "live-preview");
    assert.deepEqual(await optionalRead("app.json"), preferences);
    assert.deepEqual(await optionalRead("community-plugins.json"), originalCommunity);
    assert.deepEqual(await optionalRead("workspace.json"), originalWorkspace);
    assert.deepEqual(await readFile(join(directory, path)), bytes(conflicting));
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === "editor-status:modes"), "Duplicate Editor-status functional observation");
      report.coreChecks.push({ id: "editor-status:modes", status: "passed" });
    }
    pass("Disabling Editor status removes its open menu, status button and retained listeners without disabling editing modes; full native restarts or actual-folder WASM reconnects preserve independent source flags, opaque leaf state, enabled/disabled ownership and untouched app/workspace/community configuration.");
    await evaluate(`app.workspace.changeLayout(${JSON.stringify(originalLayout)})`);
    await evaluate("app.workspace.flushLayout()");
  } finally {
    await restoreUrlObserver();
    if (await evaluate(`Boolean(app.plugins.plugins[${JSON.stringify(pluginId)}])`)) { await togglePlugin(false); }
    if (!initiallyEnabled && await evaluate('app.core.isEnabled("editor-status")')) { await toggleStatus(false); }
    if (originalApp) { await writeFile(join(directory, ".obsidian", "app.json"), originalApp); }
    else { await unlink(join(directory, ".obsidian", "app.json")); }
  }
}

export async function checkEditorChrome({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const folder = "Editor chrome";
  const countPath = folder + "/Counts.md";
  const outlinePath = folder + "/Headings.md";
  const lastLine = "3.14 don't --";
  const unicode = "\u4e2d\u6587 \u65e5\u672c\u8a9e \u304b\u306a \u30ab\u30bf\u30ab\u30ca \ud55c\uae00 \u0ba4\u0bae\u0bbf\u0bb4\u0bcd \u0f56\u0f7c\u0f51 \u{1f600}";
  const body = "# Count\r\n\r\nAlpha beta.\r\n" + unicode + "\r\n\r\n" + lastLine;
  const countedText = "---\r\ntitle: Hidden words\r\n---\r\n" + body;
  let text = [
    "---", "notes: |", "  # Hidden YAML", "---",
    "# Root", "", "Root paragraph.", "",
    "````md", "# Hidden fence", "```", "## Still fenced", "````", "",
    "~~~md", "# Hidden tilde", "~~~", "",
    "    # Hidden indentation", "",
    "<!--", "# Hidden comment", "-->", "",
    "Underlined section", "------------------", "",
    "#### Deep child", "",
    ...Array.from({ length: 32 }, (_, index) => `Long paragraph ${index + 1} keeps actual Reading headings independently scrollable.\r\n`),
    "## Sibling", "", "Sibling paragraph.", "",
    "# Final heading", "", "Final paragraph.", "",
  ].join("\r\n");
  const names = ["Root", "Underlined section", "Deep child", "Sibling", "Final heading"];
  const line = name => text.split("\r\n").findIndex(value => value.replace(/^#{1,6} /, "") === name);
  const heading = name => `.outline-heading[data-outline-line="${line(name)}"]`;
  const fold = name => `[data-outline-fold="${line(name)}"]`;
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate editor-chrome observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  async function readConfiguration(name) {
    try { return await readFile(join(directory, ".obsidian", name)); }
    catch (error) {
      if (error.code !== "ENOENT") { throw error; }
      return null;
    }
  }
  const originalWorkspace = await readConfiguration("workspace.json");
  const originalCommunity = await readConfiguration("community-plugins.json");
  const initialEnabled = await evaluate('Object.fromEntries(["outline","word-count"].map(id=>[id,app.core.isEnabled(id)]))');
  async function toggle(id, enabled) {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
    if (await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`) !== enabled) { await click(`[data-core-toggle="${id}"]`); }
    await wait(`!app.core.busy&&app.core.isEnabled(${JSON.stringify(id)})===${enabled}`, id + " state");
    await click(".settings-close");
  }
  async function open(path) {
    if (await evaluate("app.workspace.leftSplit.collapsed")) { await click('[aria-label="Toggle left sidebar"]'); }
    await click('[data-sidebar-view="file-explorer"]');
    await click(`[data-note-path="${path}"]`);
    await wait(`app.current?.file.path===${JSON.stringify(path)}`, "real file opened: " + path);
    if (await evaluate('app.workspace.activeLeaf.view.getMode()!=="source"')) { await press("e", "KeyE", 69, 2); }
  }
  async function focus() {
    await click(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]");
  }
  async function statistics(words, content) {
    await wait(`document.querySelector("#editor-statistics").textContent===${JSON.stringify(`${words} words   ${content.length} characters`)}`, `exact ${words}-word / ${content.length}-UTF-16-character status`);
  }
  async function headings(expected = names) {
    await wait(`JSON.stringify([...document.querySelectorAll(".outline-heading")].map(button=>button.textContent))===${JSON.stringify(JSON.stringify(expected))}`, "exact metadata-backed outline headings");
  }
  async function active(name) {
    await wait(`document.querySelector(".outline-heading.is-active")?.textContent===${JSON.stringify(name)}`, "active heading: " + name);
  }

  await evaluate("app.workspace.saveAll()");
  await toggle("outline", true);
  await toggle("word-count", true);
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, countPath), "\ufeff" + countedText);
  await writeFile(join(directory, outlinePath), "\ufeff" + text);
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await evaluate(`(()=>{
    globalThis.chromeEvents={selection:0,scroll:0,valid:true};
    globalThis.chromeEventRefs=[
      app.workspace.on("editor-selection-change",(editor,view)=>{
        chromeEvents.selection++;chromeEvents.valid&&=editor===view.editor&&view.getMode()==="source";
      }),
      app.workspace.on("markdown-scroll",view=>{
        chromeEvents.scroll++;chromeEvents.valid&&=view.getMode()==="preview"&&Boolean(view.file);
      })
    ];
  })()`);
  try {
    await open(countPath);
    await statistics(21, body);
    await focus();
    await press("a", "KeyA", 65, 2);
    await wait(`app.editor.getSelection()===${JSON.stringify(countedText)}`, "actual keyboard selection includes frontmatter");
    await statistics(26, countedText);
    await press("ArrowRight", "ArrowRight", 39);
    await statistics(21, body);
    await press("Home", "Home", 36);
    await press("End", "End", 35, 8);
    await wait(`app.editor.getSelection()===${JSON.stringify(lastLine)}`, "numeric/apostrophe/hyphen source selection");
    await statistics(3, lastLine);
    await command("Input.insertText", { text: "Changed" });
    const editedBody = body.slice(0, -lastLine.length) + "Changed";
    await statistics(19, editedBody);
    assert.equal(await evaluate("app.dirty"), true);
    assert.equal(await readFile(join(directory, countPath), "utf8"), "\ufeff" + countedText);
    await press("z", "KeyZ", 90, 2);
    await press("ArrowRight", "ArrowRight", 39);
    await statistics(21, body);
    await press("y", "KeyY", 89, 2);
    await wait('app.editor.getSelection()==="Changed"', "redo restores its actual replacement selection");
    await statistics(1, "Changed");
    await press("ArrowRight", "ArrowRight", 39);
    await statistics(19, editedBody);
    await press("z", "KeyZ", 90, 2);
    await press("ArrowRight", "ArrowRight", 39);
    await statistics(21, body);
    assert.equal(await evaluate("app.dirty"), false);
    await press("a", "KeyA", 65, 2);
    await statistics(26, countedText);
    await press("e", "KeyE", 69, 2);
    await wait('app.workspace.activeLeaf.view.getMode()==="preview"&&app.workspace.activeLeaf.view.previewEl.textContent.includes("Alpha beta.")', "actual Reading view");
    await statistics(21, body);
    assert.equal(await evaluate("chromeEvents.selection>0&&chromeEvents.valid"), true);
    accept("word-count:selection-unicode");
    pass("Real source selections, edits/undo/redo and Reading mode count frontmatter only when selected, use reference numeric/punctuation/CJK/kana/Korean/Tamil/Tibetan rules and UTF-16 emoji/CRLF lengths without writing the note.");

    await open(outlinePath);
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker")?.open', "outline command palette");
    await command("Input.insertText", { text: "Show outline" });
    await click('[data-command-id="outline:open"]');
    await wait('!document.querySelector("#desktop-picker").open&&!app.workspace.rightSplit.collapsed', "Outline command opens its actual sidebar");
    await headings();
    assert.deepEqual(await evaluate(`(()=>{
      return [...document.querySelectorAll(".outline-heading")].map(button=>({
        name:button.textContent,
        parent:button.closest("li").parentElement.closest("li")?.querySelector(":scope>.outline-row>.outline-heading")?.textContent??null
      }));
    })()`), [
      { name: "Root", parent: null },
      { name: "Underlined section", parent: "Root" },
      { name: "Deep child", parent: "Underlined section" },
      { name: "Sibling", parent: "Root" },
      { name: "Final heading", parent: null },
    ]);
    await click(fold("Root"));
    assert.equal(await evaluate(`document.querySelector('${heading("Underlined section")}').checkVisibility()`), false);
    assert.equal(await evaluate(`document.querySelector('${heading("Final heading")}').checkVisibility()`), true);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('${fold("Root")}')`), true);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await wait(`document.querySelector('${heading("Deep child")}').checkVisibility()`, "keyboard expansion restores nested headings");
    await click(fold("Underlined section"));
    assert.equal(await evaluate(`document.querySelector('${heading("Deep child")}').checkVisibility()`), false);
    assert.equal(await evaluate(`document.querySelector('${heading("Sibling")}').checkVisibility()`), true);
    await click('[data-outline-action="collapse-all"]');
    assert.equal(await evaluate(`document.querySelector('${heading("Sibling")}').checkVisibility()`), false);
    await click('[data-outline-action="expand-all"]');
    await wait(`document.querySelector('${heading("Deep child")}').checkVisibility()`, "all actual heading groups expand");
    await click(heading("Underlined section"));
    await wait(`app.editor.getCursor().line===${line("Underlined section")}`, "Setext navigation uses exact raw source line");
    await active("Underlined section");
    await press("End", "End", 35, 2);
    await active("Final heading");
    pass("Outline uses actual ATX/Setext metadata, excludes YAML/comments/indented and nested-length fences, nests skipped levels correctly, folds by pointer/keyboard/all controls and follows real source-cursor navigation.");

    await press("Enter", "Enter", 13);
    await command("Input.insertText", { text: "## Live heading" });
    await headings([...names, "Live heading"]);
    assert.equal(await readFile(join(directory, outlinePath), "utf8"), "\ufeff" + text);
    await press("z", "KeyZ", 90, 2);
    await headings();
    await press("y", "KeyY", 89, 2);
    await headings([...names, "Live heading"]);
    await press("s", "KeyS", 83, 2);
    await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving", "outline dirty text saved normally");
    text += "\r\n## Live heading";
    assert.equal(await readFile(join(directory, outlinePath), "utf8"), "\ufeff" + text);
    text = text.replace("# Root\r\n", "# External root\r\n");
    await writeFile(join(directory, outlinePath), "\ufeff" + text);
    const finalNames = ["External root", ...names.slice(1), "Live heading"];
    await headings(finalNames);
    await click(heading("Deep child"));
    await press("e", "KeyE", 69, 2);
    await wait('app.workspace.activeLeaf.view.getMode()==="preview"', "outline Reading mode");
    await click(heading("Sibling"));
    await click(heading("Deep child"));
    await active("Deep child");
    assert.equal(await evaluate("chromeEvents.scroll>0&&chromeEvents.valid"), true);
    accept("outline:markdown-semantics");
    if (capture) { await capture(); }
    pass("Dirty heading edits, undo/redo and external saved replacements refresh the real Outline; Reading heading navigation/scroll changes active highlighting and emits the actual public Markdown scroll event.");

    await evaluate('globalThis.retainedOutlineButton=document.querySelector(".outline-heading")');
    await toggle("outline", false);
    assert.equal(await evaluate('document.querySelector("#outline-content").childElementCount'), 0);
    const cursor = await evaluate("app.editor.getCursor()");
    await evaluate("globalThis.retainedOutlineButton.click()");
    assert.deepEqual(await evaluate("app.editor.getCursor()"), cursor);
    await evaluate("delete globalThis.retainedOutlineButton");
    await toggle("outline", true);
    await headings(finalNames);
    await toggle("word-count", false);
    assert.equal(await evaluate('document.querySelector("#editor-statistics").textContent'), "");
    await toggle("word-count", true);
    await evaluate("app.workspace.flushLayout()");
    if (restart) { await restart(); }
    else { await command("Page.reload"); await afterReload(); }
    await wait(`app.current?.file.path===${JSON.stringify(outlinePath)}&&app.workspace.activeLeaf.view.getMode()==="preview"`, "real host restores note and Reading mode");
    await headings(finalNames);
    assert.equal(await evaluate('app.core.isEnabled("outline")&&app.core.isEnabled("word-count")'), true);
    await open(countPath);
    await statistics(21, body);
    assert.equal(await readFile(join(directory, countPath), "utf8"), "\ufeff" + countedText);
    assert.deepEqual(await readConfiguration("community-plugins.json"), originalCommunity);
    assert.deepEqual(await readConfiguration("workspace.json"), originalWorkspace);
    pass("Disable/re-enable removes owned Outline controls and retained listeners, restores counts, and full native restart or real-folder WASM reconnect retains the real files/mode without rewriting original workspace/community configuration.");
  } finally {
    await evaluate('globalThis.chromeEventRefs?.forEach(ref=>ref.emitter.offref(ref));delete globalThis.chromeEventRefs;delete globalThis.chromeEvents;delete globalThis.retainedOutlineButton');
    for (const [id, enabled] of Object.entries(initialEnabled)) {
      if (!enabled) { await toggle(id, false); }
    }
  }
}
