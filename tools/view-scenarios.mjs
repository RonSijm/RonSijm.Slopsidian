import assert from "node:assert/strict";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pluginId = "view-host-probe";
const panelType = "view-host-panel";
const fileType = "view-host-file";
const note = "View host/Reference.md";
const noteText = "# View host\n\nOriginal editable content.\n";
const opaque = { nested: [null, true, 3, { text: "Preserved" }], mode: { pluginOwned: true } };

const pluginSource = String.raw`
const { Plugin, View, ItemView, FileView, EditableFileView, TextFileView, MarkdownView, Notice } = require("obsidian");
const { EditorView } = require("@codemirror/view");
const counts = globalThis.viewHostCounts = { opened: 0, closed: 0, active: 0, ticks: 0, events: 0, cleaned: 0, fileLoads: 0, fileUnloads: 0, nestedNavigation: 0, validContainers: true, lifecycle: [] };
class Panel extends ItemView {
  constructor(leaf) { super(leaf); this.label = "Initial"; this.count = 0; this.wasOpened = false; }
  getViewType() { return "view-host-panel"; }
  getDisplayText() { return "View host panel"; }
  async onOpen() {
    counts.opened++; counts.active++; this.wasOpened = true;
    counts.validContainers &&= this instanceof View && this.leaf.view === this && this.containerEl.isConnected && this.containerEl.children[1] === this.contentEl;
    this.contentEl.dataset.viewHostPanel = this.leaf.id;
    this.input = this.contentEl.createEl("input", { attr: { "aria-label": "Panel label", "data-view-host-label": this.leaf.id } });
    this.output = this.contentEl.createEl("p", { attr: { "data-view-host-count": this.leaf.id } });
    this.action = this.addAction("plus", "Increment panel counter", () => { this.count++; this.render(); this.app.workspace.requestSaveLayout().catch(error => new Notice(error.message)); });
    this.action.dataset.viewHostIncrement = this.leaf.id;
    this.registerDomEvent(this.input, "input", () => { this.label = this.input.value; this.app.workspace.requestSaveLayout().catch(error => new Notice(error.message)); });
    this.registerDomEvent(window, "view-host-event", () => { counts.events++; });
    this.registerInterval(window.setInterval(() => { counts.ticks++; }, 20));
    this.register(() => { counts.cleaned++; });
    this.render();
    if (globalThis.viewHostNestedNavigation) {
      const path = globalThis.viewHostNestedNavigation;
      delete globalThis.viewHostNestedNavigation;
      const file = this.app.vault.getAbstractFileByPath(path);
      await this.app.workspace.getLeaf("tab").openFile(file);
      counts.nestedNavigation++;
    }
  }
  render() { this.input.value = this.label; this.output.textContent = String(this.count); }
  getState() { return { ...super.getState(), label: this.label, count: this.count }; }
  async setState(state, result) {
    if (state.fail) { throw new Error("Expected panel state failure"); }
    await super.setState(state, result);
    this.label = typeof state.label === "string" ? state.label : "Initial";
    this.count = typeof state.count === "number" ? state.count : 0;
    this.render();
  }
  async onBeforeClose() {
    if (globalThis.viewHostBlockClose) { throw new Error("Expected blocked view close"); }
  }
  async onClose() {
    counts.closed++;
  }
  onunload() { if (this.wasOpened) { counts.active--; this.wasOpened = false; } }
}
class FailedPanel extends Panel {
  getViewType() { return "view-host-failed"; }
  async onOpen() { await super.onOpen(); throw new Error("Expected view open failure"); }
}
class FilePanel extends FileView {
  getViewType() { return "view-host-file"; }
  async onOpen() { this.contentEl.dataset.viewHostFile = this.leaf.id; }
  async onLoadFile(file) {
    counts.fileLoads++;
    if (file.basename === "Fail") { throw new Error("Expected file load failure"); }
    this.contentEl.setText(file.extension.toLowerCase() === "md" ? await this.app.vault.read(file) : "Inventory bytes: " + file.stat.size);
  }
  async onUnloadFile() {
    counts.fileUnloads++;
    this.contentEl.replaceChildren();
    if (globalThis.viewHostFailUnload === this.leaf.id) { throw new Error("Expected file unload failure"); }
  }
  async onBeforeClose() {
    if (globalThis.viewHostBlockFileClose === this.leaf.id || globalThis.viewHostBlockFileView === this) { throw new Error("Expected blocked file-view close"); }
    if (globalThis.viewHostPauseFileClose === this.leaf.id) {
      delete globalThis.viewHostPauseFileClose;
      globalThis.viewHostCloseWaiting = true;
      await new Promise(resolve => { globalThis.viewHostContinueClose = resolve; });
    }
  }
  unload() { super.unload(); }
  async onunload() {
    await new Promise(resolve => setTimeout(resolve, 20));
    this.unloadFinished = true;
    counts.lifecycle.push({id:this.leaf.id,phase:"unload",loaded:this._loaded,connected:this.containerEl.isConnected});
  }
  async onClose() {
    if(!this.unloadFinished||this._loaded||this.containerEl.isConnected)throw new Error("The native close phase ran before detached asynchronous unload completed");
    counts.lifecycle.push({id:this.leaf.id,phase:"close",loaded:this._loaded,connected:this.containerEl.isConnected});
    if(globalThis.viewHostFailLateClose===this.leaf.id){
      delete globalThis.viewHostFailLateClose;
      throw new Error("Expected post-teardown close failure");
    }
  }
}
class TextPanel extends TextFileView {
  getViewType() { return "view-host-text"; }
  async onOpen() {
    this.input = this.contentEl.createEl("textarea", { attr: { "aria-label": "Editable plugin file", "data-view-host-text": this.leaf.id } });
    this.input.style.cssText = "width:100%;height:80%;resize:none";
    this.registerDomEvent(this.input, "input", () => this.requestSave());
  }
  getViewData() { return this.input.value.replace(/\r?\n/g, this.newline || "\n"); }
  setViewData(data, clear) {
    if (clear) { this.clear(); }
    this.newline = data.includes("\r\n") ? "\r\n" : "\n";
    this.input.value = data;
  }
  clear() { this.input.value = ""; }
  onunload() {
    if (globalThis.viewHostClearTextOnUnload === this.leaf.id) {
      this.clear();
      globalThis.viewHostTextModelCleared = true;
    }
  }
}
module.exports = class extends Plugin {
  onload() {
    this.types = { View, ItemView, FileView, EditableFileView, TextFileView, MarkdownView, Panel, FilePanel, TextPanel };
    this.registerView("view-host-panel", leaf => new Panel(leaf));
    this.registerView("view-host-file", leaf => new FilePanel(leaf));
    this.registerView("view-host-failed", leaf => new FailedPanel(leaf));
    this.registerView("view-host-invalid", leaf => new Panel(leaf));
    this.registerView("view-host-text", leaf => new TextPanel(leaf));
    this.registerExtensions(["probeview"], "view-host-file");
    this.registerExtensions(["probeedit"], "view-host-text");
    for (const [id, name, side, split] of [
      ["open-main", "Open main view probe", "main", false],
      ["open-left", "Open left view probe", "left", false],
      ["open-right", "Open right view probe", "right", false],
      ["split-right", "Split right view probe", "right", true],
    ]) {
      this.addCommand({ id, name, callback: async () => {
        const leaf = side === "main" ? this.app.workspace.getLeaf("tab") : side === "left" ? this.app.workspace.getLeftLeaf(split) : this.app.workspace.getRightLeaf(split);
        await leaf.setViewState({ type: "view-host-panel", state: { label: name, count: 0, opaque: { nested: [null, true, 3, { text: "Preserved" }], mode: { pluginOwned: true } } }, active: true });
      } });
    }
    this.addCommand({ id: "editor-extension", name: "Add editor extension with custom panes open", callback: () => {
      this.registerEditorExtension(EditorView.theme({ "&": { "--view-host-probe": "enabled" } }));
    } });
  }
};
`;

export async function checkViewHost({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const pluginDirectory = join(directory, ".obsidian", "plugins", pluginId);
  await mkdir(pluginDirectory, { recursive: true });
  await mkdir(join(directory, "View host"), { recursive: true });
  await writeFile(join(directory, note), noteText);
  await writeFile(join(directory, "View host", "Fail.md"), "Must not replace an open file view.\n");
  await writeFile(join(directory, "View host", "Inventory.probeview"), Buffer.from([255, 0, 128, 9]));
  const mutationPath = "View host/Mutation.probeview";
  const mutationBytes = Buffer.from([255, 0, 128, 7]);
  await writeFile(join(directory, mutationPath), mutationBytes);
  const textPath = "View host/Editable.probeedit";
  const textBytes = text => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
  const initialText = "# Editable plugin file\r\n\r\nOriginal data.\r\n";
  await writeFile(join(directory, textPath), textBytes(initialText));
  await writeFile(join(pluginDirectory, "manifest.json"), JSON.stringify({ id: pluginId, name: "View host probe", version: "1.0.0", description: "Independent custom-view acceptance fixture", isDesktopOnly: false }));
  await writeFile(join(pluginDirectory, "main.js"), pluginSource);
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json"), "utf8").catch(error => {
    if (error.code !== "ENOENT") { throw error; }
    return null;
  });
  const reload = async () => {
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) {
      await restart();
    } else {
      await command("Page.reload");
    }
    await afterReload();
  };
  await reload();

  async function toggle(enabled) {
    await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, enabled);
    await click(".settings-close");
  }
  async function run(id) {
    const name = await evaluate(`app.commands.listCommands().find(command=>command.id===${JSON.stringify(pluginId + ":" + id)})?.name`);
    assert.equal(typeof name, "string");
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker").open', "view-host command palette");
    await command("Input.insertText", { text: name });
    await click(`[data-command-id="${pluginId}:${id}"]`);
    await wait('!document.querySelector("#desktop-picker").open', "view-host command executed");
    await evaluate("app.workspace.whenIdle()");
  }
  const activeId = () => evaluate("app.workspace.activeLeaf.id");
  const paneIds = () => evaluate(`app.workspace.getLeavesOfType(${JSON.stringify(panelType)}).map(leaf=>leaf.id)`);
  const states = () => evaluate(`Object.fromEntries(app.workspace.leaves().filter(leaf=>[${JSON.stringify(panelType)},${JSON.stringify(fileType)}].includes(leaf.getViewState().type)).map(leaf=>[leaf.id,leaf.getViewState()]))`);
  const reject = async (expression, pattern) => {
    const error = await evaluate(`(async()=>{try{await (${expression});return null}catch(error){return error.message}})()`);
    assert.equal(typeof error, "string", "The invalid operation must reject.");
    assert.match(error, pattern);
  };

  await toggle(true);
  await evaluate(`globalThis.viewHostNestedNavigation=${JSON.stringify(note)}`);
  await run("open-main");
  const main = await activeId();
  assert.equal(await evaluate("viewHostCounts.nestedNavigation"), 1);
  assert.equal(await evaluate(`app.workspace.activeLeaf.view instanceof app.plugins.plugins[${JSON.stringify(pluginId)}].types.Panel`), true);
  assert.equal(await evaluate(`app.workspace.getActiveViewOfType(app.plugins.plugins[${JSON.stringify(pluginId)}].types.ItemView)===app.workspace.activeLeaf.view&&app.workspace.activeEditor===null`), true);
  await click(`[data-view-host-label="${main}"]`);
  await press("a", "KeyA", 65, 2);
  await command("Input.insertText", { text: "Retained panel label" });
  await click(`[data-view-host-increment="${main}"]`);
  await wait(`app.workspace.getLeafById(${JSON.stringify(main)}).view.getState().count===1`, "view-owned action callback");
  await evaluate("app.workspace.activeLeaf.setPinned(true)");
  await run("open-left");
  const left = await activeId();
  await run("open-right");
  const right = await activeId();
  await run("split-right");
  const splitRight = await activeId();
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(left)}).getRoot()===app.workspace.leftSplit&&app.workspace.getLeafById(${JSON.stringify(right)}).getRoot()===app.workspace.rightSplit&&app.workspace.getLeafById(${JSON.stringify(splitRight)}).parent!==app.workspace.getLeafById(${JSON.stringify(right)}).parent`), true);
  assert.equal(await evaluate("app.workspace.getMostRecentLeaf().getRoot()===app.workspace.rootSplit"), true);
  await run("editor-extension");
  assert.equal(await evaluate('app.workspace.getLeavesOfType("markdown").every(leaf=>getComputedStyle(leaf.view.editor.cm.dom).getPropertyValue("--view-host-probe").trim()==="enabled")'), true);
  assert.equal(await evaluate(`app.workspace.getLeavesOfType(${JSON.stringify(panelType)}).every(leaf=>!("editor" in leaf.view)&&!leaf.session&&!leaf.containerEl.querySelector(".cm-editor"))`), true);
  assert.equal(await evaluate("viewHostCounts.validContainers"), true);
  const expected = await states();
  assert.deepEqual(expected[main].state.opaque, opaque);
  await evaluate(`app.openFile(${JSON.stringify(note)})`);
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(main)}).view.getViewType()`), panelType);
  pass("Real shared ItemView panes open in main/left/right/split sidedocks, own working controls, and coexist with editor extensions without hidden Markdown editors.");

  await evaluate("globalThis.viewHostOriginalEditor=app.editor;globalThis.viewHostOriginalLeaf=app.workspace.activeLeaf;true");
  await evaluate("app.editor.focus()");
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: "Saved before a failed view transition." });
  const savedText = noteText + "Saved before a failed view transition.";
  await reject(`app.workspace.activeLeaf.setViewState({type:"view-host-failed"})`, /Expected view open failure/);
  assert.equal(await evaluate("app.editor===viewHostOriginalEditor&&app.workspace.activeLeaf===viewHostOriginalLeaf"), true);
  assert.equal(await readFile(join(directory, note), "utf8"), savedText);
  await reject(`app.workspace.activeLeaf.setViewState({type:"view-host-invalid"})`, /creator must return a new shared View/);
  await reject(`app.workspace.activeLeaf.setViewState({type:${JSON.stringify(panelType)},state:{fail:true}})`, /Expected panel state failure/);
  await reject(`app.workspace.activeLeaf.setViewState({type:"unknown-view"})`, /No enabled plugin/);
  await reject(`app.workspace.activeLeaf.setViewState({type:"markdown",state:{file:${JSON.stringify(note)},mode:"invalid"}})`, /source or preview/);
  await reject(`Promise.resolve().then(()=>{const state={};state.cycle=state;return app.workspace.activeLeaf.setViewState({type:${JSON.stringify(panelType)},state})})`, /JSON values without cycles/);
  await evaluate("app.editor.focus()");
  await press("z", "KeyZ", 90, 2);
  assert.equal(await evaluate("app.editor.getValue()"), noteText);
  await evaluate("app.saveAll()");
  assert.equal(await readFile(join(directory, note), "utf8"), noteText);
  assert.deepEqual((await states())[main], expected[main]);
  await reject(`app.plugins.plugins[${JSON.stringify(pluginId)}].registerExtensions(["atomic-probe","probeview"],${JSON.stringify(fileType)})`, /unique, unregistered/);
  assert.equal(await evaluate('app.workspace.viewTypeForExtension("atomic-probe")'), null);
  assert.equal(await evaluate('app.workspace.viewTypeForExtension("md")'), "markdown");
  pass("Invalid/throwing view creators and invalid state reject explicitly, preserve the previous real editor and undo stack, and do not partially install extension mappings.");

  assert.equal(await evaluate(`app.workspace.activeLeaf.view instanceof app.plugins.plugins[${JSON.stringify(pluginId)}].types.TextFileView`), true);
  await evaluate(`app.openFile(${JSON.stringify(textPath)},"tab")`);
  const textLeaf = await activeId();
  assert.equal(await evaluate(`app.workspace.activeLeaf.view instanceof app.plugins.plugins[${JSON.stringify(pluginId)}].types.TextFileView&&app.workspace.activeLeaf.view instanceof app.plugins.plugins[${JSON.stringify(pluginId)}].types.EditableFileView&&!app.workspace.activeLeaf.containerEl.querySelector(".cm-editor")&&!app.dirty`), true);
  const editedText = "# Editable plugin file\r\n\r\nA real debounced edit.\r\n";
  await click(`[data-view-host-text="${textLeaf}"]`);
  await press("a", "KeyA", 65, 2);
  await command("Input.insertText", { text: editedText.replaceAll("\r\n", "\n") });
  await wait("app.dirty", "custom text view dirty state");
  assert.deepEqual(await readFile(join(directory, textPath)), textBytes(initialText));
  await wait("!app.dirty&&!app.workspace.activeLeaf.view.isSaving", "real two-second plugin text autosave");
  assert.deepEqual(await readFile(join(directory, textPath)), textBytes(editedText));
  const externalText = "# External plugin file\r\n\r\nChanged outside the app.\r\n";
  await writeFile(join(directory, textPath), textBytes(externalText));
  await wait(`app.workspace.activeLeaf.view.getViewData()===${JSON.stringify(externalText)}`, "clean custom text view external refresh");
  const unsavedText = "# Unsaved plugin file\r\n\r\nDo not discard this text.\r\n";
  await evaluate(`app.workspace.activeLeaf.view.input.value=${JSON.stringify(unsavedText.replaceAll("\r\n", "\n"))};app.workspace.activeLeaf.view.requestSave()`);
  const conflictingText = "# Conflicting external file\r\n\r\nKeep these external bytes.\r\n";
  await writeFile(join(directory, textPath), textBytes(conflictingText));
  await reject("app.saveCurrent()", /changed on disk/);
  await reject("app.workspace.closeLeaf(app.workspace.activeLeaf)", /changed on disk/);
  assert.equal(await evaluate("app.workspace.activeLeaf.view.getViewData()"), unsavedText);
  assert.equal(await evaluate("app.dirty"), true);
  assert.deepEqual(await readFile(join(directory, textPath)), textBytes(conflictingText));
  await evaluate("app.workspace.activeLeaf.view.reload()");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.getViewData()"), conflictingText);
  assert.equal(await evaluate("app.dirty"), false);
  const closingText = "# Saved on close\r\n\r\nPlugin file close is awaited.\r\n";
  await evaluate(`globalThis.viewHostClearTextOnUnload=app.workspace.activeLeaf.id;app.workspace.activeLeaf.view.input.value=${JSON.stringify(closingText.replaceAll("\r\n", "\n"))};app.workspace.activeLeaf.view.requestSave()`);
  await evaluate("app.workspace.closeLeaf(app.workspace.activeLeaf)");
  assert.equal(await evaluate("globalThis.viewHostTextModelCleared"), true);
  assert.deepEqual(await readFile(join(directory, textPath)), textBytes(closingText));
  await evaluate("delete globalThis.viewHostClearTextOnUnload;delete globalThis.viewHostTextModelCleared");
  pass("Real shared TextFileView subclasses debounce actual BOM/CRLF saves, refresh clean external changes, preserve dirty data on save/close conflicts, and flush before owned unload clears the model without writing its cleared data.");

  await evaluate(`(async()=>{const leaf=app.workspace.getLeaf("tab");await leaf.setViewState({type:${JSON.stringify(fileType)},state:{file:${JSON.stringify(note)},opaque:{retain:true}},active:true})})()`);
  const fileLeaf = await activeId();
  assert.equal(await evaluate(`app.workspace.activeLeaf.view instanceof app.plugins.plugins[${JSON.stringify(pluginId)}].types.FileView&&app.workspace.getActiveFile().path===${JSON.stringify(note)}&&app.workspace.activeLeaf.session===null&&!app.workspace.activeLeaf.containerEl.querySelector(".cm-editor")`), true);
  assert.equal(await evaluate(`document.querySelector('[data-view-host-file="${fileLeaf}"]').textContent`), noteText);
  await reject(`app.workspace.activeLeaf.setViewState({type:${JSON.stringify(fileType)},state:{file:"View host/Fail.md"}})`, /Expected file load failure/);
  assert.equal(await evaluate("app.workspace.activeLeaf.view.file.path"), note);
  assert.equal(await evaluate(`document.querySelector('[data-view-host-file="${fileLeaf}"]').textContent`), noteText);
  await evaluate(`globalThis.viewHostFailUnload=${JSON.stringify(fileLeaf)}`);
  await reject(`app.workspace.activeLeaf.setViewState({type:${JSON.stringify(fileType)},state:{file:"View host/Inventory.probeview"}})`, /Expected file unload failure/);
  assert.equal(await evaluate("app.workspace.activeLeaf.view.file.path"), note);
  assert.equal(await evaluate(`document.querySelector('[data-view-host-file="${fileLeaf}"]').textContent`), noteText);
  await evaluate("delete globalThis.viewHostFailUnload");
  await evaluate('app.openFile("View host/Inventory.probeview","tab")');
  assert.equal(await evaluate("app.workspace.activeLeaf.view.getViewType()"), fileType);
  assert.equal(await evaluate('app.workspace.activeLeaf.view.contentEl.textContent'), "Inventory bytes: 4");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.canAcceptExtension('PROBEVIEW')"), true);
  assert.equal(await evaluate("app.commands.status().find(command=>command.id==='markdown:toggle-preview').enabled"), false);
  const inventoryLeaf = await activeId();
  pass("FileView panes load real note bytes, route registered non-Markdown extensions to real files, and restore the previous file after a failed file-load hook.");

  const emptyLeaf = await evaluate('(async()=>{const leaf=app.workspace.getLeaf("tab");await leaf.setViewState({type:"empty",state:{futureEmpty:{retain:[true,42]}},active:false});return leaf.id})()');
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(emptyLeaf)}).view.isLoaded`), true, "An explicitly configured empty pane must enter the normal view lifecycle");
  const mutationLeaves = await evaluate(`(async()=>{const ids=[];for(let index=0;index<2;index++){const leaf=app.workspace.getLeaf("tab");await leaf.setViewState({type:${JSON.stringify(fileType)},state:{file:${JSON.stringify(mutationPath)},opaque:{retain:index}},active:true});ids.push(leaf.id)}globalThis.viewHostMutationViews=app.workspace.leaves().map(leaf=>[leaf.id,leaf.view]);return ids})()`);
  await evaluate(`globalThis.viewHostBlockFileView=app.workspace.getLeafById(${JSON.stringify(mutationLeaves[1])}).view;true`);
  try {
    await reject("app.workspace.changeLayout(app.workspace.getLayout())", /Expected blocked file-view close/);
    assert.deepEqual(await evaluate("viewHostMutationViews.map(([id,view])=>({id,type:view.getViewType(),same:app.workspace.getLeafById(id)?.view===view,loaded:view.isLoaded,connected:view.containerEl.isConnected})).filter(view=>!view.same||!view.loaded||!view.connected)"), [], "A later close veto must not recreate or abandon any earlier pane");
    await reject(`app.fileManager.trashFile(app.vault.getFileByPath(${JSON.stringify(mutationPath)}))`, /Expected blocked file-view close/);
    await reject(`app.vault.delete(app.vault.getFileByPath(${JSON.stringify(mutationPath)}))`, /Expected blocked file-view close/);
    assert.equal(await evaluate("viewHostMutationViews.every(([id,view])=>app.workspace.getLeafById(id)?.view===view&&view.isLoaded)"), true);
    assert.deepEqual(await readFile(join(directory, mutationPath)), mutationBytes);
  } finally {
    await evaluate("delete globalThis.viewHostBlockFileView");
  }
  await reject(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(mutationPath)}),"View host/Inventory.probeview",false)`, /already exists/);
  assert.equal(await evaluate("viewHostMutationViews.every(([id,view])=>app.workspace.getLeafById(id)?.view===view&&view.isLoaded)"), true);
  pass("A later custom FileView close veto preserves every original pane during layout replacement, trash or permanent Vault.delete; rename collision preflight leaves the same live views and file bytes intact.");

  const lateState = await evaluate(`app.workspace.getLeafById(${JSON.stringify(fileLeaf)}).getViewState()`);
  const lateEphemeral = { restoredAfterClose: { preserve: [0, false, "exact"] } };
  for (const detach of [false, true]) {
    await evaluate(`(()=>{
      const leaf=app.workspace.getLeafById(${JSON.stringify(fileLeaf)});
      leaf.setEphemeralState(${JSON.stringify(lateEphemeral)});
      globalThis.viewHostLateView=leaf.view;
      globalThis.viewHostFailLateClose=leaf.id;
      return true;
    })()`);
    await reject(detach
      ? `app.workspace.closeLeaf(app.workspace.getLeafById(${JSON.stringify(fileLeaf)}))`
      : `app.workspace.getLeafById(${JSON.stringify(fileLeaf)}).setViewState({type:"empty",active:false})`, /Expected post-teardown close failure/);
    assert.equal(await evaluate(`(()=>{
      const leaf=app.workspace.getLeafById(${JSON.stringify(fileLeaf)});
      return Boolean(leaf)&&leaf.view!==viewHostLateView&&leaf.view.isLoaded&&!viewHostLateView._loaded&&!viewHostLateView.containerEl.isConnected;
    })()`), true);
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(fileLeaf)}).getViewState()`), lateState);
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(fileLeaf)}).getEphemeralState()`), lateEphemeral);
    assert.equal(await readFile(join(directory, note), "utf8"), noteText);
  }
  await evaluate("delete globalThis.viewHostLateView");
  pass("Native close detaches and awaits asynchronous owned unload before onClose, including a void unload override; real transition and tab-close failures reconstruct a new loaded view with exact saved and ephemeral state, retaining file bytes.");

  const mutationStates = await states();
  await evaluate(`globalThis.viewHostPauseFileClose=${JSON.stringify(mutationLeaves[0])};globalThis.viewHostTrashResult=app.fileManager.trashFile(app.vault.getFileByPath(${JSON.stringify(mutationPath)})).then(()=>"unexpected success",error=>error.message);true`);
  await wait("globalThis.viewHostCloseWaiting===true", "actual trash close preflight barrier");
  let replacementBytes = Buffer.from([9, 0, 128, 255, 6]);
  await writeFile(join(directory, mutationPath), replacementBytes);
  const trashError = await evaluate("(async()=>{viewHostContinueClose();delete globalThis.viewHostContinueClose;delete globalThis.viewHostCloseWaiting;return await viewHostTrashResult})()");
  assert.match(trashError, /changed/i);
  assert.deepEqual(await readFile(join(directory, mutationPath)), replacementBytes);
  assert.deepEqual(await states(), mutationStates);
  assert.deepEqual(await evaluate(`${JSON.stringify(mutationLeaves)}.map(id=>{const view=app.workspace.getLeafById(id).view;return {fileView:view instanceof app.plugins.plugins[${JSON.stringify(pluginId)}].types.FileView,loaded:view.isLoaded,text:view.contentEl.textContent,size:view.file.stat.size}})`), mutationLeaves.map(() => ({ fileView: true, loaded: true, text: "Inventory bytes: 5", size: 5 })));
  pass("An actual external byte replacement during trash preflight rejects the stale mutation, preserves newer disk bytes and restores all staged custom FileView panes with their opaque state.");

  await evaluate(`globalThis.viewHostPauseFileClose=${JSON.stringify(mutationLeaves[0])};globalThis.viewHostDeleteResult=app.vault.delete(app.vault.getFileByPath(${JSON.stringify(mutationPath)})).then(()=>"unexpected success",error=>error.message);true`);
  await wait("globalThis.viewHostCloseWaiting===true", "actual permanent-delete close preflight barrier");
  replacementBytes = Buffer.from([8, 0, 129, 254, 7, 6]);
  await writeFile(join(directory, mutationPath), replacementBytes);
  const deleteError = await evaluate("(async()=>{viewHostContinueClose();delete globalThis.viewHostContinueClose;delete globalThis.viewHostCloseWaiting;return await viewHostDeleteResult})()");
  assert.match(deleteError, /changed/i);
  assert.deepEqual(await readFile(join(directory, mutationPath)), replacementBytes);
  assert.deepEqual(await states(), mutationStates);
  assert.equal(await evaluate(`${JSON.stringify(mutationLeaves)}.every(id=>{const view=app.workspace.getLeafById(id).view;return view.isLoaded&&view.contentEl.textContent==="Inventory bytes: 6"&&view.file.stat.size===6})`), true);
  await evaluate("delete globalThis.viewHostDeleteResult");
  pass("Permanent Vault.delete rejects a real external replacement during close preflight, retains its exact newer bytes and restores both custom FileView panes and opaque state.");

  await evaluate(`globalThis.viewHostLateFileViews=${JSON.stringify(mutationLeaves)}.map(id=>app.workspace.getLeafById(id).view);globalThis.viewHostFailLateClose=${JSON.stringify(mutationLeaves[1])};true`);
  await reject(`app.vault.delete(app.vault.getFileByPath(${JSON.stringify(mutationPath)}))`, /Expected post-teardown close failure/);
  assert.deepEqual(await readFile(join(directory, mutationPath)), replacementBytes);
  assert.deepEqual(await states(), mutationStates);
  assert.equal(await evaluate(`${JSON.stringify(mutationLeaves)}.every((id,index)=>{const leaf=app.workspace.getLeafById(id),old=viewHostLateFileViews[index];return leaf.view!==old&&leaf.view.isLoaded&&!old._loaded&&!old.containerEl.isConnected&&leaf.view.contentEl.textContent==="Inventory bytes: 6"})`), true);
  await evaluate("delete globalThis.viewHostLateFileViews");
  pass("A later post-teardown close failure aborts permanent deletion before file removal and reconstructs every affected custom pane with its saved state and unchanged binary bytes.");

  await evaluate(`(async()=>{const leaf=app.workspace.getLeafById(${JSON.stringify(main)});await leaf.setViewState({...leaf.getViewState(),state:{...leaf.view.getState(),file:${JSON.stringify(mutationPath)}}})})()`);
  const renamedPath = "View host/Renamed mutation.probeview";
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(mutationPath)}),${JSON.stringify(renamedPath)},false)`);
  assert.equal(await evaluate(`${JSON.stringify(mutationLeaves)}.every(id=>app.workspace.getLeafById(id).view.file.path===${JSON.stringify(renamedPath)})`), true);
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(main)}).view.getState().file`), mutationPath, "An ItemView's field named file is opaque, not a FileView path");
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(main)}).history.filter(state=>state.type===${JSON.stringify(panelType)}&&state.state?.file).every(state=>state.state.file===${JSON.stringify(mutationPath)})`), true);
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(renamedPath)}),${JSON.stringify(mutationPath)},false)`);
  assert.deepEqual(await readFile(join(directory, mutationPath)), replacementBytes);
  await evaluate(`(async()=>{for(const id of ${JSON.stringify(mutationLeaves)}){await app.workspace.closeLeaf(app.workspace.getLeafById(id))}app.workspace.setActiveLeaf(app.workspace.getLeafById(${JSON.stringify(inventoryLeaf)}));delete globalThis.viewHostMutationViews;delete globalThis.viewHostTrashResult})()`);
  pass("File rename remaps real FileView paths and history while retaining unrelated ItemView data named file, without changing binary contents.");

  const referencePath = "View host/Delete references.md";
  const referenceText = "[[View host/Deleted.probeview]]\r\n[[View host/Unconfirmed.probeview]]\r\n";
  await evaluate(`(async()=>{await app.vault.create(${JSON.stringify(referencePath)},${JSON.stringify(referenceText)})})()`);
  for (const unconfirmed of [false, true]) {
    const path = `View host/${unconfirmed ? "Unconfirmed" : "Deleted"}.probeview`;
    const removedLeaves = await evaluate(`(async()=>{
      const file=await app.vault.createBinary(${JSON.stringify(path)},Uint8Array.of(255,0,128).buffer);
      const probe=globalThis.viewHostDeletion={file,views:[],events:[]};
      app.plugins.plugins[${JSON.stringify(pluginId)}].registerEvent(app.vault.on("delete",deleted=>{
        if(deleted===file)probe.events.push({same:deleted===probe.file,absent:app.vault.getAbstractFileByPath(deleted.path)===null,cacheRemoved:app.metadataCache.getFileCache(deleted)===null});
      }));
      for(let index=0;index<2;index++){
        const leaf=app.workspace.getLeaf("tab");
        await leaf.setViewState({type:${JSON.stringify(fileType)},state:{file:file.path,opaque:{deleteProbe:index}},active:true});
        probe.views.push(leaf.view);
      }
      await app.metadataCache.refresh();
      return probe.views.map(view=>view.leaf.id);
    })()`);
    assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${JSON.stringify(path)},${JSON.stringify(referencePath)})===viewHostDeletion.file`), true);
    if (unconfirmed) {
      assert.equal(await evaluate('Object.hasOwn(app.vault,"deleteFile")'), false);
      await evaluate('globalThis.viewHostDeleteTransport=app.vault.deleteFile;app.vault.deleteFile=async function(...args){await viewHostDeleteTransport.apply(this,args);throw new Error("Expected lost deletion acknowledgement")};true');
      try {
        await reject("app.vault.delete(viewHostDeletion.file,true)", /removal response could not be confirmed/);
      } finally {
        await evaluate("delete app.vault.deleteFile;delete globalThis.viewHostDeleteTransport;true");
      }
    } else {
      await evaluate("app.vault.delete(viewHostDeletion.file,true)");
    }
    await assert.rejects(readFile(join(directory, path)), { code: "ENOENT" });
    await assert.rejects(readFile(join(directory, ".trash", path.split("/").at(-1))), { code: "ENOENT" });
    assert.deepEqual(await evaluate("viewHostDeletion.events"), [{ same: true, absent: true, cacheRemoved: true }]);
    assert.equal(await evaluate(`${JSON.stringify(removedLeaves)}.every(id=>{const leaf=app.workspace.getLeafById(id);return leaf.view.getViewType()==="empty"&&!leaf.history.some(state=>state.type===${JSON.stringify(fileType)}&&state.state?.file===${JSON.stringify(path)})})`), true);
    assert.equal(await evaluate("viewHostDeletion.views.every(view=>!view.isLoaded&&!view.containerEl.isConnected)"), true);
    assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${JSON.stringify(path)},${JSON.stringify(referencePath)})`), null);
    await reject("app.vault.delete(viewHostDeletion.file)", /no longer in the selected vault/);
    assert.deepEqual(await readFile(join(directory, referencePath)), Buffer.from(referenceText));
    await evaluate(`(async()=>{for(const id of ${JSON.stringify(removedLeaves)}){await app.workspace.closeLeaf(app.workspace.getLeafById(id))}app.workspace.setActiveLeaf(app.workspace.getLeafById(${JSON.stringify(inventoryLeaf)}));delete globalThis.viewHostDeletion})()`);
  }
  pass("Actual permanent deletion closes both owned views, invalidates only file history and metadata, preserves incoming-link bytes, emits one identity-correct delete and leaves no trash copy; injected acknowledgement loss still rejects without reopening deleted files or duplicating events.");

  const beforeLateLayout = await states();
  const beforeLateActive = await activeId();
  await evaluate(`globalThis.viewHostFailLateClose=${JSON.stringify(inventoryLeaf)};true`);
  await reject("app.workspace.changeLayout(app.workspace.getLayout())", /Expected post-teardown close failure/);
  assert.deepEqual(await states(), beforeLateLayout);
  assert.equal(await activeId(), beforeLateActive);
  assert.equal(await evaluate(`app.workspace.leaves().filter(leaf=>[${JSON.stringify(panelType)},${JSON.stringify(fileType)}].includes(leaf.view.getViewType())).every(leaf=>leaf.view.isLoaded&&leaf.view.containerEl.isConnected)`), true);
  assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(fileLeaf)}).getEphemeralState()`), lateEphemeral);
  assert.deepEqual(await readFile(join(directory, mutationPath)), replacementBytes);
  assert.deepEqual(await readFile(join(directory, referencePath)), Buffer.from(referenceText));
  pass("A saved-layout replacement that fails after native teardown restores all original leaf IDs, active selection, custom/ephemeral state and live components without changing note or attachment bytes.");

  const workspacesEnabled = await evaluate('app.core.isEnabled("workspaces")');
  await evaluate('app.core.setEnabled("workspaces",true)');
  await evaluate('(async()=>{const pending=app.workspace.activeLeaf.run(()=>new Promise(resolve=>setTimeout(resolve,80)));const manager=app.core.getEnabledPluginById("workspaces");await manager.save("View lifecycle probe");await pending;const next=app.workspace.activeLeaf.run(()=>new Promise(resolve=>setTimeout(resolve,80)));await manager.load("View lifecycle probe");await next;await manager.remove("View lifecycle probe")})()');
  assert.equal(await activeId(), inventoryLeaf);
  if (!workspacesEnabled) { await evaluate('app.core.setEnabled("workspaces",false)'); }
  const expectedFiles = await states();
  pass("Named profile save/load waits for real pending leaf tasks without awaiting its own operation, and restores actual custom panes before removing the temporary profile.");

  await evaluate("globalThis.viewHostBlockFileClose=app.workspace.activeLeaf.id;globalThis.viewHostOriginalFileView=app.workspace.activeLeaf.view;true");
  const unloadedFiles = await evaluate("viewHostCounts.fileUnloads");
  await reject('app.workspace.activeLeaf.setViewState({type:"empty"})', /Expected blocked file-view close/);
  assert.equal(await evaluate("app.workspace.activeLeaf.view===viewHostOriginalFileView"), true);
  assert.equal(await evaluate("app.workspace.activeLeaf.view.contentEl.textContent"), "Inventory bytes: 4");
  assert.equal(await evaluate("viewHostCounts.fileUnloads"), unloadedFiles);
  await reject(`app.plugins.disable(${JSON.stringify(pluginId)})`, /Expected blocked file-view close/);
  assert.equal(await evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].isLoaded`), true);
  assert.deepEqual(await states(), expectedFiles);
  assert.equal(await evaluate(`app.workspace.leaves().filter(leaf=>[${JSON.stringify(panelType)},${JSON.stringify(fileType)}].includes(leaf.getViewState().type)).every(leaf=>!leaf.isDeferred&&leaf.view.isLoaded)`), true);
  assert.equal(await evaluate(`document.querySelector('[data-view-host-file="${fileLeaf}"]').textContent`), noteText);
  assert.equal(await evaluate("app.workspace.activeLeaf.view.contentEl.textContent"), "Inventory bytes: 4");
  await evaluate("delete globalThis.viewHostBlockFileClose");
  await evaluate("globalThis.viewHostBlockClose=true");
  await reject(`app.plugins.disable(${JSON.stringify(pluginId)})`, /Expected blocked view close/);
  assert.equal(await evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].isLoaded`), true);
  assert.deepEqual(await states(), expectedFiles);
  const ownerIds = Object.keys(expectedFiles);
  await evaluate(`(()=>{
    globalThis.viewHostBlockClose=false;
    for(const id of ${JSON.stringify(ownerIds)}){
      app.workspace.getLeafById(id).setEphemeralState({ownerRollback:{id,preserve:[0,false,"exact"]}});
    }
    globalThis.viewHostFailLateClose=${JSON.stringify(inventoryLeaf)};
  })()`);
  const ownerEphemeral = await evaluate(`Object.fromEntries(${JSON.stringify(ownerIds)}.map(id=>[id,app.workspace.getLeafById(id).getEphemeralState()]))`);
  await reject(`app.plugins.disable(${JSON.stringify(pluginId)})`, /Expected post-teardown close failure/);
  assert.equal(await evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].isLoaded`), true);
  assert.deepEqual(await states(), expectedFiles);
  assert.deepEqual(await evaluate(`Object.fromEntries(${JSON.stringify(ownerIds)}.map(id=>[id,app.workspace.getLeafById(id).getEphemeralState()]))`), ownerEphemeral);
  assert.equal(await activeId(), inventoryLeaf);
  assert.equal(await evaluate(`${JSON.stringify(ownerIds)}.every(id=>{const view=app.workspace.getLeafById(id).view;return view.isLoaded&&view.containerEl.isConnected})`), true);
  assert.deepEqual(await readFile(join(directory, "View host", "Inventory.probeview")), Buffer.from([255, 0, 128, 9]));
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from(noteText));
  pass("A later post-teardown failure during plugin disable restores every earlier owned pane's saved and ephemeral state, keeps the plugin loaded and retains the active leaf and exact disk bytes.");
  await evaluate(`globalThis.viewHostOldView=app.workspace.getLeafById(${JSON.stringify(main)}).view;globalThis.viewHostOldAction=viewHostOldView.action;true`);
  await toggle(false);
  assert.deepEqual(await states(), expectedFiles);
  assert.equal(await evaluate(`app.workspace.leaves().filter(leaf=>[${JSON.stringify(panelType)},${JSON.stringify(fileType)}].includes(leaf.getViewState().type)).every(leaf=>leaf.isDeferred&&leaf.view.getViewType()==="unavailable"&&!leaf.containerEl.querySelector(".cm-editor"))`), true);
  assert.equal(await evaluate('app.workspace.viewTypeForExtension("probeview")'), null);
  assert.equal(await evaluate('app.workspace.viewTypeForExtension("probeedit")'), null);
  assert.equal(await evaluate("viewHostCounts.active"), 0);
  const stopped = await evaluate("({...viewHostCounts})");
  assert.equal(await evaluate("(async()=>{viewHostOldAction.click();window.dispatchEvent(new Event('view-host-event'));await new Promise(resolve=>setTimeout(resolve,120));return viewHostCounts.ticks})()"), stopped.ticks);
  assert.equal(await evaluate("viewHostCounts.events"), stopped.events);
  assert.equal(await evaluate("viewHostOldView.count"), 1);
  await toggle(true);
  assert.equal(await evaluate('app.workspace.viewTypeForExtension("probeview")==="view-host-file"&&app.workspace.viewTypeForExtension("probeedit")==="view-host-text"'), true);
  assert.deepEqual(await states(), expectedFiles);
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(main)}).view!==viewHostOldView`), true);
  assert.equal((await paneIds()).length, 4);
  pass("Plugin unload removes owned timers, handlers, actions, and extension mappings; unavailable panes retain their exact state and re-enable creates fresh real views.");

  await evaluate(`app.workspace.setActiveLeaf(app.workspace.getLeafById(${JSON.stringify(left)}),{focus:false})`);
  const mainContext = await evaluate("app.workspace.getMostRecentLeaf().id");
  const fileContext = await evaluate("app.workspace.getActiveFile().path");
  const layout = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
  const configuredBeforeRestart = await readFile(join(directory, ".obsidian", "community-plugins.json"));
  await reload();
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(emptyLeaf)}).view.isLoaded`), true, "Restored empty panes must enter the normal view lifecycle");
  assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(emptyLeaf)}).view.getState().futureEmpty`), { retain: [true, 42] });
  assert.deepEqual(await states(), expectedFiles);
  assert.equal(await activeId(), left);
  assert.equal(await evaluate("app.workspace.getMostRecentLeaf().id"), mainContext);
  assert.equal(await evaluate("app.workspace.getActiveFile().path"), fileContext);
  assert.equal(await evaluate(`Boolean(app.plugins.plugins[${JSON.stringify(pluginId)}])`), true);
  assert.equal(await evaluate(`${JSON.stringify(Object.keys(expectedFiles))}.every(id=>{const leaf=app.workspace.getLeafById(id);return !leaf.isDeferred&&leaf.view.isLoaded})`), true, "Configured providers must restore real loaded views without another enable action.");
  assert.deepEqual(await readFile(join(directory, ".obsidian", "community-plugins.json")), configuredBeforeRestart);
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), layout);
  assert.deepEqual(await states(), expectedFiles);
  await evaluate(`app.workspace.revealLeaf(app.workspace.getLeafById(${JSON.stringify(right)}))`);
  await wait(`document.querySelector('[data-view-host-label="${right}"]').getBoundingClientRect().height>0`, "restored right-sidedock pane revealed");
  assert.equal(await evaluate('document.querySelector("#desktop-shell").classList.contains("right-collapsed")'), false);
  await capture?.();
  await evaluate(`app.workspace.closeLeaf(app.workspace.getLeafById(${JSON.stringify(splitRight)}))`);
  assert.equal((await paneIds()).length, 3);
  await evaluate(`app.workspace.detachLeavesOfType(${JSON.stringify(panelType)})`);
  await evaluate("app.workspace.whenIdle()");
  assert.equal((await paneIds()).length, 0);
  await toggle(false);
  await evaluate(`(async()=>{for(const leaf of app.workspace.getLeavesOfType(${JSON.stringify(fileType)})){await app.workspace.closeLeaf(leaf)}await app.openFile(${JSON.stringify(note)});await app.workspace.flushLayout()})()`);
  if (originalWorkspace !== null) {
    assert.equal(await readFile(join(directory, ".obsidian", "workspace.json"), "utf8"), originalWorkspace);
  } else {
    await assert.rejects(readFile(join(directory, ".obsidian", "workspace.json")), error => error.code === "ENOENT");
  }
  assert.deepEqual(await readFile(join(directory, "View host", "Inventory.probeview")), Buffer.from([255, 0, 128, 9]));
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  assert.equal(await evaluate('Boolean(document.querySelector(".error-banner"))'), false);
  pass(`Custom view state, pins, sidedock groups, and active selection survive ${restart ? "a full desktop-process restart" : "real-folder browser reload/reconnect"} without rewriting Obsidian workspace.json or binary file bytes.`);
  report.customViewLimitations = [
    "Independent ItemView/FileView host probe; no original bundled core module or actual Templater/Excalidraw bundle is exercised.",
    "The binary extension fixture displays real inventory, not a generic binary editor. Editable TextFileView has a separate exercised subset; broad adapter/binary APIs, shared custom-text document sessions, drag docking and popouts remain unfinished.",
    "Existing independently implemented core sidebar panels have not yet been migrated into generic workspace leaves.",
  ];
}
