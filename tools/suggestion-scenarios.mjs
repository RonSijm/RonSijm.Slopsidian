import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pluginId = "suggestion-host-probe";
const failureId = "suggestion-failure-probe";
const pluginSource = String.raw`
const { Plugin, Modal, SuggestModal, FuzzySuggestModal, AbstractInputSuggest, EditorSuggest, TFile } = require("obsidian");
const { EditorView } = require("@codemirror/view");
class Picker extends FuzzySuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.state = plugin.state;
    this.containerEl.dataset.suggestionProbeModal = "picker";
    this.limit = 2;
    this.emptyStateText = "Nothing matched this probe.";
    this.setPlaceholder("Find a probe item");
    this.setInstructions([{ command: "Shift+Enter", purpose: "Choose with the plugin scope" }]);
    this.scope.register(["Shift"], "Enter", (event, context) => {
      this.state.scope.push({ key: context.key, modifiers: context.modifiers, type: event.type });
      this.selectActiveSuggestion(event);
      return false;
    });
  }
  getItems() { return this.state.items; }
  getItemText(item) { return item.label; }
  getSuggestions(query) {
    if (query === "slow") return new Promise(resolve => { this.state.resolveModal = resolve; });
    if (query === "error") return Promise.reject(new Error("Expected suggestion provider failure"));
    return super.getSuggestions(query);
  }
  onChooseItem(item, event) { this.state.modalChosen.push({ value: item.value, same: this.state.items.includes(item), type: event.type }); }
  onNoSuggestion() { this.state.empty++; super.onNoSuggestion(); }
  onClose() { this.state.modalClosed++; }
}
class InputSuggestions extends AbstractInputSuggest {
  constructor(plugin, input) { super(plugin.app, input); this.state = plugin.state; this.input = input; }
  getSuggestions(query) {
    this.state.inputRequests.push(query);
    if (query === "slow") return new Promise(resolve => { this.state.resolveInput = resolve; });
    return this.state.items.filter(item => item.value.startsWith(query.toLowerCase()));
  }
  renderSuggestion(item, element) { element.setText(item.label); }
  selectSuggestion(item, event) {
    this.setValue(item.value);
    this.input.trigger("input");
    return super.selectSuggestion(item, event);
  }
}
class Completions extends EditorSuggest {
  constructor(plugin) { super(plugin.app); this.state = plugin.state; this.setInstructions([{ command: "Enter / Tab", purpose: "Complete the current marker" }]); }
  onTrigger(cursor, editor, file) {
    const match = /@([a-z]*)$/.exec(editor.getLine(cursor.line).slice(0, cursor.ch));
    if (!match) return null;
    if (this.state.badTrigger) return { start: { line: 999, ch: 0 }, end: cursor, query: match[1] };
    return { start: { line: cursor.line, ch: cursor.ch - match[0].length }, end: cursor, query: match[1] };
  }
  getSuggestions(context) {
    this.state.editorContexts.push({ query: context.query, path: context.file.path, sharedFile: context.file instanceof TFile, sharedEditor: context.editor === this.app.workspace.activeEditor.editor });
    if (context.query === "slow") return new Promise(resolve => { this.state.resolveEditor = resolve; });
    return this.state.items.filter(item => item.value.startsWith(context.query));
  }
  renderSuggestion(item, element) { element.createEl("strong", { text: item.label }); }
  selectSuggestion(item, event) {
    const context = this.context;
    this.state.editorChosen.push({ value: item.value, query: context.query, path: context.file.path, type: event.type });
    context.editor.replaceRange(item.value, context.start, context.end);
    context.editor.setCursor({ line: context.start.line, ch: context.start.ch + item.value.length });
  }
}
module.exports = class extends Plugin {
  onload() {
    this.state = {
      items: [{ label: "Alpha", value: "alpha" }, { label: "Alpine", value: "alpine" }, { label: "Beta <img src=x onerror=alert(1)>", value: "beta" }, { label: "Gamma", value: "gamma" }, { label: "\u0130tem\u{1f680}Value", value: "unicode" }],
      modalChosen: [], inputChosen: [], editorChosen: [], editorContexts: [], inputRequests: [], scope: [], empty: 0, modalClosed: 0, inputEvents: 0, cleaned: 0
    };
    const completion = this.completion = new Completions(this);
    this.registerEditorSuggest(completion);
    this.registerEditorExtension(EditorView.editorAttributes.of({ "data-suggestion-probe": "active" }));
    this.forms = [];
    this.register(() => {
      this.picker?.close();
      this.forms.forEach(form => form.close());
      this.state.cleaned++;
    });
    if (this.manifest.id === "suggestion-failure-probe") {
      this.picker = new Picker(this);
      this.picker.open();
      throw new Error("Expected suggestion registration failure");
    }
    globalThis.suggestionProbe = this.state;
    this.state.completion = completion;
    this.state.shared = completion instanceof EditorSuggest;
    this.addCommand({ id: "picker", name: "Open suggestion picker probe", callback: () => {
      this.picker = new Picker(this);
      this.state.picker = this.picker;
      this.state.shared = this.state.shared && this.picker instanceof SuggestModal && this.picker instanceof Modal;
      this.picker.open();
    } });
    this.addCommand({ id: "input", name: "Open input suggestion probe", callback: () => {
      const modal = new Modal(this.app);
      modal.containerEl.dataset.suggestionProbeModal = "input";
      modal.setTitle("Input suggestion ownership");
      const input = modal.contentEl.createEl("input", { attr: { "aria-label": "Probe text input", "data-suggestion-input": "text" } });
      const editable = modal.contentEl.createDiv({ attr: { contenteditable: "true", "aria-label": "Probe editable input", "data-suggestion-input": "editable" } });
      const suggestions = new InputSuggestions(this, input).onSelect((item, event) => this.state.inputChosen.push({ value: item.value, type: event.type }));
      const editableSuggestions = new InputSuggestions(this, editable).onSelect((item, event) => this.state.inputChosen.push({ value: item.value, editable: true, type: event.type }));
      input.addEventListener("input", () => this.state.inputEvents++);
      modal.onClose = () => { suggestions.close(); editableSuggestions.close(); };
      this.forms.push(modal);
      Object.assign(this.state, { inputModal: modal, input, editable, inputSuggestions: suggestions, editableSuggestions });
      modal.open();
      input.focus();
    } });
  }
};
`;

export async function checkPluginSuggestions(tools) {
  const { directory, evaluate, command, click, press, wait, restart, afterReload, report, capture } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const note = "Plugin suggestions/Editor.md";
  const text = "# Plugin suggestions\r\n\r\nStart: ";
  const original = Buffer.from("\ufeff" + text);
  const pickerInput = '[data-suggestion-probe-modal="picker"] .prompt-input';
  const pickerRows = '[data-suggestion-probe-modal="picker"] .suggestion-item';
  const popupRows = '.suggestion-popover:popover-open .suggestion-item';
  const input = '[data-suggestion-input="text"]';
  const editable = '[data-suggestion-input="editable"]';
  const communityPath = join(directory, ".obsidian", "community-plugins.json");
  let originalCommunity = null;
  try { originalCommunity = await readFile(communityPath); }
  catch (error) { if (error.code !== "ENOENT") { throw error; } }
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  await mkdir(join(directory, "Plugin suggestions"), { recursive: true });
  await writeFile(join(directory, note), original);
  for (const id of [pluginId, failureId]) {
    const folder = join(directory, ".obsidian", "plugins", id);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "manifest.json"), JSON.stringify({ id, name: id === pluginId ? "Suggestion host probe" : "Suggestion failure probe", version: "1.0.0", description: "Independent real plugin suggestion API fixture", isDesktopOnly: false }));
    await writeFile(join(folder, "main.js"), pluginSource);
  }
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();

  async function toggle(enabled, id = pluginId) {
    await click("#open-settings");
    await click("#community-plugins-tab");
    await click(`[data-toggle-plugin="${id}"]`);
    if (id === failureId) {
      await wait(`document.querySelector('.plugin-card[data-plugin-id="${id}"]').textContent.includes("Expected suggestion registration failure")`, "visible suggestion registration failure");
      assert.equal(await evaluate(`document.querySelector('.plugin-card[data-plugin-id="${id}"]').dataset.loaded`), "false");
    } else {
      await wait(`document.querySelector('.plugin-card[data-plugin-id="${id}"]').dataset.loaded==="${enabled}"`, "suggestion provider plugin toggled");
    }
    await click(".settings-close");
  }
  async function openCommand(id) {
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker").open', "suggestion probe palette");
    const name = await evaluate(`app.commands.listCommands().find(item=>item.id===${JSON.stringify(pluginId + ":" + id)}).name`);
    await command("Input.insertText", { text: name });
    await click(`[data-command-id="${pluginId}:${id}"]`);
    await wait(`Boolean(document.querySelector('[data-suggestion-probe-modal="${id}"]'))`, "real plugin suggestion dialog");
  }
  async function fill(selector, value) {
    await click(selector);
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: value });
  }
  async function focusEditor() {
    await evaluate("(()=>{const e=app.editor;const p=e.getCursor();e.scrollIntoView({from:p,to:p},true);e.cm.coordsAtPos(e.cm.state.selection.main.head);e.focus();return true})()");
    await wait("app.editor.cm.hasFocus", "real focused CodeMirror editor");
  }
  const noPopup = () => wait('!document.querySelector(".suggestion-popover:popover-open")', "suggestion popover closed");
  await toggle(true);
  assert.equal(await evaluate("suggestionProbe.shared"), true);
  await evaluate(`app.openFile(${JSON.stringify(note)},"tab")`);
  await evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:"source",source:true}})})()');

  await openCommand("picker");
  await wait(`document.querySelectorAll(${JSON.stringify(pickerRows)}).length===2`, "bounded initial picker results");
  await fill(pickerInput, "gm");
  await wait(`document.querySelectorAll(${JSON.stringify(pickerRows)}).length===1&&document.querySelector(${JSON.stringify(pickerRows)}).textContent==="Gamma"`, "real fuzzy subsequence result");
  assert.equal(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(pickerRows + " .suggestion-highlight")})).map(el=>el.textContent).join("")`), "Gm");
  await press("Enter", "Enter", 13, 8);
  await wait('!document.querySelector("[data-suggestion-probe-modal]")', "plugin scope chooses and closes picker");
  assert.deepEqual(await evaluate("suggestionProbe.modalChosen"), [{ value: "gamma", same: true, type: "keydown" }]);
  assert.deepEqual(await evaluate("suggestionProbe.scope"), [{ key: "Enter", modifiers: "Shift", type: "keydown" }]);
  await openCommand("picker");
  await fill(pickerInput, "i\u0307tem\u{1f680}");
  await wait(`document.querySelectorAll(${JSON.stringify(pickerRows)}).length===1`, "Unicode expansion and surrogate-pair result");
  assert.equal(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(pickerRows + " .suggestion-highlight")})).map(el=>el.textContent).join("")`), "\u0130tem\u{1f680}");
  await press("Escape", "Escape", 27);
  await openCommand("picker");
  await fill(pickerInput, "be");
  await wait(`document.querySelectorAll(${JSON.stringify(pickerRows)}).length===1`, "pointer picker result");
  assert.equal(await evaluate('Boolean(document.querySelector("[data-suggestion-probe-modal] img"))'), false);
  await click(pickerRows);
  assert.equal(await evaluate("suggestionProbe.modalChosen.at(-1).value"), "beta");
  assert.equal(await evaluate("suggestionProbe.modalChosen.at(-1).type"), "click");
  assert.deepEqual(await readFile(join(directory, note)), original);
  pass("Real shared SuggestModal/FuzzySuggestModal pickers filter typed queries, retain typed object identity and exact Unicode ranges, render inert labels, honor limits and choose through pointer, keyboard and plugin Scope bindings without writing notes.");

  await openCommand("picker");
  await wait(`document.querySelectorAll(${JSON.stringify(pickerRows)}).length===2`, "picker before async query");
  await evaluate(`suggestionProbe.retainedRow=document.querySelector(${JSON.stringify(pickerRows)});true`);
  await fill(pickerInput, "slow");
  await wait("typeof suggestionProbe.resolveModal==='function'", "pending modal query");
  await fill(pickerInput, "be");
  await wait(`document.querySelectorAll(${JSON.stringify(pickerRows)}).length===1&&document.querySelector(${JSON.stringify(pickerRows)}).textContent.startsWith("Beta")`, "newer modal query");
  await evaluate("suggestionProbe.resolveModal([suggestionProbe.items[0]]);true");
  await evaluate("suggestionProbe.retainedRow.click();true");
  assert.equal(await evaluate("suggestionProbe.modalChosen.length"), 2);
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(pickerRows)}).textContent`), /^Beta/);
  await fill(pickerInput, "nothing-matches");
  await wait('document.querySelector("[data-suggestion-probe-modal] .suggestion-results").textContent==="Nothing matched this probe."', "real empty-state override");
  await fill(pickerInput, "error");
  await wait('document.querySelector("#client-errors").textContent.includes("Expected suggestion provider failure")', "visible provider rejection");
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-suggestion-probe-modal]"))'), false);
  await evaluate('document.querySelector("#client-errors").replaceChildren();true');
  await openCommand("picker");
  await fill(pickerInput, "slow");
  await press("Escape", "Escape", 27);
  await evaluate("suggestionProbe.resolveModal([suggestionProbe.items[0]]);true");
  assert.equal(await evaluate('Boolean(document.querySelector("[data-suggestion-probe-modal]"))'), false);
  pass("Newer queries supersede pending modal results, retained old rows are inert, empty states run and provider failures are visible; Escape/closed dialogs cannot be resurrected by late async completion.");

  await openCommand("input");
  await fill(input, "al");
  await wait(`document.querySelectorAll(${JSON.stringify(popupRows)}).length===2`, "input suggestions in the actual modal");
  await press("ArrowDown", "ArrowDown", 40);
  await press("Enter", "Enter", 13);
  await noPopup();
  assert.equal(await evaluate("suggestionProbe.input.value"), "alpine");
  assert.deepEqual(await evaluate("suggestionProbe.inputChosen"), [{ value: "alpine", type: "keydown" }]);
  assert.ok(await evaluate("suggestionProbe.inputEvents>=2"));
  await fill(editable, "be");
  await wait(`document.querySelectorAll(${JSON.stringify(popupRows)}).length===1`, "contenteditable suggestions");
  await click(popupRows);
  assert.equal(await evaluate("suggestionProbe.editable.textContent"), "beta");
  assert.deepEqual(await evaluate("suggestionProbe.inputChosen.at(-1)"), { value: "beta", editable: true, type: "click" });
  await fill(input, "al");
  await wait(`document.querySelectorAll(${JSON.stringify(popupRows)}).length===2`, "input Escape target");
  await press("Escape", "Escape", 27);
  await noPopup();
  assert.equal(await evaluate('Boolean(document.querySelector("[data-suggestion-probe-modal=input]"))'), true);
  await evaluate("suggestionProbe.inputSuggestions.limit=0;suggestionProbe.inputRequestCount=suggestionProbe.inputRequests.length;true");
  await fill(input, "alpha");
  await noPopup();
  assert.equal(await evaluate("suggestionProbe.inputRequests.length===suggestionProbe.inputRequestCount"), true);
  await press("Escape", "Escape", 27);
  await wait('!document.querySelector("[data-suggestion-probe-modal]")', "parent input modal closes separately");
  assert.deepEqual(await readFile(join(directory, note)), original);
  pass("AbstractInputSuggest works on real input and contenteditable controls, including selected values, input events, pointer/arrow/Enter selection, top-layer placement, disabled limits and Escape dismissing the popover before its parent modal.");

  await evaluate("app.editor.setCursor({line:2,ch:7});true");
  await focusEditor();
  await command("Input.insertText", { text: "@al" });
  await wait(`document.querySelectorAll(${JSON.stringify(popupRows)}).length===2`, "real CodeMirror suggestions");
  assert.equal(await evaluate("suggestionProbe.editorContexts.at(-1).sharedFile&&suggestionProbe.editorContexts.at(-1).sharedEditor"), true);
  assert.equal(await evaluate("suggestionProbe.editorContexts.at(-1).path"), note);
  await press("ArrowDown", "ArrowDown", 40);
  await press("Enter", "Enter", 13);
  await noPopup();
  assert.equal(await evaluate("app.editor.getValue()"), text + "alpine");
  await press("z", "KeyZ", 90, 2);
  assert.equal(await evaluate("app.editor.getValue()"), text + "@al");
  await press("y", "KeyY", 89, 2);
  assert.equal(await evaluate("app.editor.getValue()"), text + "alpine");
  await noPopup();
  await evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:"source",source:false}})})()');
  await focusEditor();
  await press("Enter", "Enter", 13);
  await command("Input.insertText", { text: "LP: @be" });
  await wait(`document.querySelectorAll(${JSON.stringify(popupRows)}).length===1`, "real Live Preview suggestions");
  await click(popupRows);
  let expected = text + "alpine\r\nLP: beta";
  assert.equal(await evaluate("app.editor.getValue()"), expected);
  assert.deepEqual(await readFile(join(directory, note)), original);
  await focusEditor();
  await command("Input.insertText", { text: " @slow" });
  await wait("typeof suggestionProbe.resolveEditor==='function'", "pending editor query");
  await evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:"preview"}})})()');
  await noPopup();
  await evaluate("suggestionProbe.resolveEditor([suggestionProbe.items[0]]);true");
  assert.equal(await evaluate("suggestionProbe.completion.context"), null);
  await evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:"source",source:false}});app.editor.setValue(' + JSON.stringify(expected) + ')})()');
  await focusEditor();
  await evaluate("suggestionProbe.badTrigger=true;true");
  await command("Input.insertText", { text: " @a" });
  await wait('document.querySelector("#client-errors").textContent.includes("valid ordered source positions")', "invalid source trigger rejected visibly");
  await noPopup();
  expected += " @a";
  assert.equal(await evaluate("app.editor.getValue()"), expected);
  await evaluate('suggestionProbe.badTrigger=false;document.querySelector("#client-errors").replaceChildren();true');
  if (capture) { await capture(); }
  pass("Registered EditorSuggest receives real TFile/editor/source context and completes actual Source/Live Preview typing with isolated undo/redo and exact dirty BOM/CRLF preservation; Reading and malformed triggers reject stale completion without changing unrelated text.");

  await openCommand("input");
  await fill(input, "slow");
  await wait("typeof suggestionProbe.resolveInput==='function'", "pending input before plugin unload");
  await press(",", "Comma", 188, 2);
  await wait('Boolean(document.querySelector(".settings-close"))', "settings above the plugin-owned input dialog");
  await click("#community-plugins-tab");
  await click(`[data-toggle-plugin="${pluginId}"]`);
  await wait(`document.querySelector('.plugin-card[data-plugin-id="${pluginId}"]').dataset.loaded==="false"`, "real plugin unload with pending suggestions");
  await click(".settings-close");
  await evaluate("suggestionProbe.resolveInput([suggestionProbe.items[0]]);suggestionProbe.retainedRow.click();true");
  await noPopup();
  assert.equal(await evaluate('Boolean(document.querySelector("[data-suggestion-probe-modal]"))'), false);
  assert.equal(await evaluate("suggestionProbe.cleaned"), 1);
  assert.equal(await evaluate('app.editor.cm.dom.hasAttribute("data-suggestion-probe")'), false);
  await focusEditor();
  await command("Input.insertText", { text: "x" });
  expected += "x";
  await noPopup();
  await toggle(true, failureId);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-suggestion-probe-modal]"))'), false);
  assert.equal(await evaluate('app.editor.cm.dom.hasAttribute("data-suggestion-probe")'), false);
  await toggle(true);
  assert.equal(await evaluate('app.editor.cm.dom.getAttribute("data-suggestion-probe")'), "active");
  await focusEditor();
  await press("Backspace", "Backspace", 8);
  expected = expected.slice(0, -1);
  await wait(`document.querySelectorAll(${JSON.stringify(popupRows)}).length===2`, "fresh completion provider after re-enable");
  await press("Tab", "Tab", 9);
  expected = expected.slice(0, -2) + "alpha";
  await noPopup();
  assert.equal(await evaluate("app.editor.getValue()"), expected);
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty", "explicit completion save");
  assert.deepEqual(await readFile(join(directory, note)), Buffer.from("\ufeff" + expected));
  await evaluate("app.workspace.flushLayout()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  assert.equal(await evaluate("app.markdownView.getEditingMode()"), "live-preview");
  assert.equal(await evaluate('app.editor.cm.dom.hasAttribute("data-suggestion-probe")'), false);
  assert.equal(await evaluate("Boolean(window.suggestionProbe)"), false);
  await toggle(true);
  await openCommand("picker");
  await press("Escape", "Escape", 27);
  await toggle(false);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(layout)},false)`);
  if (originalCommunity === null) { await assert.rejects(readFile(communityPath), { code: "ENOENT" }); }
  else { assert.deepEqual(await readFile(communityPath), originalCommunity); }
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  pass("Plugin unload and failed-load rollback remove owned suggestions, editor extensions, dialogs and pending results; re-enable creates fresh controls, and full restart/reconnect retains exact text/mode without silently persisting plugin trust or rewriting community configuration.");
  report.pluginSuggestions = {
    fixture: pluginId, sha256: createHash("sha256").update(pluginSource).digest("hex"), thirdPartyPlugin: false,
    scope: "independently authored public suggestion/modal/input/editor subset",
    nativeFuzzyRankingAndPrivateAbi: "not established",
    actualTemplaterAndExcalidraw: "not exercised by this fixture",
  };
}
