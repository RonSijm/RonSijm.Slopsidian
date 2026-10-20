import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import { errorLogStub } from "./error-log-stub.mjs";

// Execute the production picker methods, Modal shell, focus policy and HotkeyManager.
// This light DOM model supplies events/ownership, not browser layout or native UI.
const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
const directory = await mkdtemp(join(runtime, "picker-modal-polish-tests-"));
let DesktopUI, Modal, HotkeyManager, pickerMatchRanges, appendPickerText, renderPickerInstructions;
try {
  const outfile = join(directory, "picker.mjs");
  await build({
    stdin: { contents: 'export {DesktopUI} from "./client/desktop-ui"; export {Modal} from "./client/ui"; export {HotkeyManager} from "./client/hotkeys"; export {pickerMatchRanges,appendPickerText,renderPickerInstructions} from "./client/picker-presentation";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
    outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub],
  });
  ({ DesktopUI, Modal, HotkeyManager, pickerMatchRanges, appendPickerText, renderPickerInstructions } = await import(pathToFileURL(outfile).href));
} finally {
  assert.equal(resolve(dirname(directory)), resolve(runtime), "Only remove this test's owned runtime directory.");
  await rm(directory, { recursive: true, force: true });
}

const globals = ["document", "window", "Node", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLDialogElement", "SVGSVGElement"];
const previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => { for (const key of globals) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; } });

class ModelNode {}
class ModelText extends ModelNode {
  constructor(text, document) { super(); this.textContent = String(text); this.ownerDocument = document; this.parentElement = null; }
}
class ModelElement extends ModelNode {
  constructor(tag, document) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.parentElement = null;
    this.childNodes = []; this.attributes = new Map(); this.dataset = {}; this.listeners = new Map();
    this.className = ""; this.type = tag === "input" ? "text" : ""; this.value = ""; this.hidden = false; this.disabled = false; this.readOnly = false;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(" "); },
      toggle: (name, value) => { const active = value ?? !this.classList.contains(name); this.classList[active ? "add" : "remove"](name); return active; },
    };
  }
  get children() { return this.childNodes.filter(node => node instanceof ModelElement); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(""); }
  set textContent(text) { this.replaceChildren(new ModelText(text, this.ownerDocument)); }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get tabIndex() { return this.attributes.has("tabindex") ? Number(this.attributes.get("tabindex")) : ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(this.tagName) ? 0 : -1; }
  set tabIndex(value) { this.setAttribute("tabindex", String(value)); }
  get isContentEditable() { return this.attributes.has("contenteditable") && this.attributes.get("contenteditable") !== "false"; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  contains(node) { return this === node || this.childNodes.some(child => child instanceof ModelElement && child.contains(node)); }
  adopt(document) { this.ownerDocument = document; for (const child of this.childNodes) { if (child instanceof ModelElement) child.adopt(document); else child.ownerDocument = document; } }
  appendChild(node) {
    if (node.parentElement) { node.parentElement.childNodes = node.parentElement.childNodes.filter(child => child !== node); }
    node.parentElement = this;
    if (node instanceof ModelElement) node.adopt(this.ownerDocument); else node.ownerDocument = this.ownerDocument;
    this.childNodes.push(node); return node;
  }
  append(...nodes) { for (const node of nodes) this.appendChild(typeof node === "string" ? new ModelText(node, this.ownerDocument) : node); }
  replaceChildren(...nodes) { for (const child of this.childNodes) child.parentElement = null; this.childNodes = []; this.append(...nodes); }
  remove() {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this);
    this.parentElement = null;
  }
  matches(selector) {
    return selector.split(",").some(part => {
      part = part.trim();
      if (part === ":disabled") return this.disabled;
      if (part.includes(":popover-open")) return false;
      const tag = /^[a-z]+/i.exec(part)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = /\.([\w-]+)/.exec(part)?.[1];
      if (cls && !this.classList.contains(cls)) return false;
      for (const [, key, value] of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
        const present = key === "open" ? this.open : key === "hidden" ? this.hidden || this.hasAttribute(key) : this.hasAttribute(key);
        if (!present || value !== undefined && this.getAttribute(key) !== value) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...child.matches(selector) ? [child] : [], ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  checkVisibility() { return !this.closest("[hidden],[inert]") && this.layout !== false; }
  getClientRects() { return this.layout === false ? [] : [{}]; }
  focus(options) { if (this.refuseFocus) return; this.ownerDocument.activeElement = this; this.focusOptions = options; this.ownerDocument.defaultView.fire("focusin", { target: this }); }
  scrollIntoView(options) { this.scrollOptions = options; }
  addEventListener(type, callback) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(callback); this.listeners.set(type, listeners); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event = {}) { event.target ??= this; for (const callback of [...this.listeners.get(type) ?? []]) callback(event); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire("close"); }
}
class ModelInput extends ModelElement {}
class ModelTextArea extends ModelElement {}
class ModelSelect extends ModelElement {}
class ModelDialog extends ModelElement {}
class ModelSvg extends ModelElement {}
function modelDocument() {
  const document = {
    createElement(tag) { const Constructor = { input: ModelInput, textarea: ModelTextArea, select: ModelSelect, dialog: ModelDialog }[tag] ?? ModelElement; return new Constructor(tag, this); },
    createElementNS(namespace, tag) { const element = new ModelSvg(tag, this); element.namespaceURI = namespace; return element; },
    createTextNode(text) { return new ModelText(text, this); },
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); }, querySelector(selector) { return this.body.querySelector(selector); },
    getElementById(id) { return this.body.querySelectorAll("*").find(element => element.id === id) ?? null; },
  };
  document.body = document.createElement("body"); document.activeElement = document.body;
  document.defaultView = { document, listeners: new Map(), addEventListener: ModelElement.prototype.addEventListener, removeEventListener: ModelElement.prototype.removeEventListener, fire: ModelElement.prototype.fire };
  return document;
}
function environment() {
  const document = modelDocument();
  const constructors = { Node: ModelNode, HTMLElement: ModelElement, HTMLInputElement: ModelInput, HTMLTextAreaElement: ModelTextArea, HTMLSelectElement: ModelSelect, HTMLDialogElement: ModelDialog, SVGSVGElement: ModelSvg };
  for (const [key, value] of Object.entries({ ...constructors, document, window: document.defaultView })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return document;
}
function key(key, options = {}) { return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...options }; }
function pickerFixture(commands = []) {
  const document = environment(), executed = [], created = [];
  const hotkeyManager = new HotkeyManager({ dispatch: () => false });
  const picker = Object.create(DesktopUI.prototype);
  Object.assign(picker, {
    app: { hotkeyManager, commands: { status: () => commands.map(command => ({ enabled: true, ...command })), execute: async id => executed.push(id) }, core: { state: () => ({ settings: { pinned: [] } }) } },
    picker: document.createElement("dialog"), input: document.createElement("input"), results: document.createElement("div"), caption: document.createElement("h2"), instructions: document.createElement("div"),
    items: [], visible: [], selection: 0, createSwitcherNote: async (...args) => created.push(args),
  });
  const errors = document.createElement("div"); errors.id = "client-errors"; document.body.append(errors, picker.picker);
  picker.picker.append(picker.caption, picker.input, picker.results, picker.instructions);
  return { document, picker, hotkeyManager, executed, created };
}

test("Picker composition, handled events and closed owners cannot navigate, choose or create", async () => {
  const f = pickerFixture([{ id: "one", name: "One" }, { id: "two", name: "Two" }]); f.picker.openPicker("commands");
  for (const input of [key("ArrowDown", { isComposing: true }), key("ArrowUp", { isComposing: true }), key("Enter", { isComposing: true }), key("Enter", { defaultPrevented: true })]) f.picker.onPickerKeyDown(input);
  assert.equal(f.picker.selection, 0); assert.deepEqual(f.executed, []); assert.equal(f.picker.picker.open, true);
  f.picker.picker.dataset.picker = "files"; f.picker.onPickerKeyDown(key("Enter", { shiftKey: true, isComposing: true }));
  assert.deepEqual(f.created, []); assert.equal(f.picker.picker.open, true);
  f.picker.picker.close(); f.picker.onPickerKeyDown(key("Enter")); assert.deepEqual(f.executed, []);
});

test("Ordinary picker arrows wrap and Enter retains command, new-tab and explicit creation actions", async () => {
  const f = pickerFixture([{ id: "one", name: "One" }, { id: "two", name: "Two" }]); f.picker.openPicker("commands");
  f.picker.onPickerKeyDown(key("ArrowUp")); assert.equal(f.picker.selection, 1);
  f.picker.onPickerKeyDown(key("ArrowDown")); assert.equal(f.picker.selection, 0);
  f.picker.onPickerKeyDown(key("Enter")); assert.deepEqual(f.executed, ["one"]); assert.equal(f.picker.picker.open, false);
  let newTab; f.picker.picker.dataset.picker = "files"; f.picker.picker.showModal(); f.picker.visible = [{ action: async value => { newTab = value; } }];
  f.picker.onPickerKeyDown(key("Enter", { ctrlKey: true })); assert.equal(newTab, true);
  f.picker.picker.showModal(); f.picker.input.value = "New <literal>"; f.picker.onPickerKeyDown(key("Enter", { shiftKey: true }));
  assert.deepEqual(f.created, [["New <literal>", false]]);
});

test("Current custom, disabled, restored and plugin hotkeys are rendered from the real manager", () => {
  const f = pickerFixture([{ id: "command", name: "Command" }, { id: "plugin:run", name: "Plugin action" }]);
  f.hotkeyManager.addDefaultHotkeys("command", [{ modifiers: ["Ctrl"], key: "P" }]); f.hotkeyManager.addDefaultHotkeys("plugin:run", [{ modifiers: ["Alt"], key: "K" }]);
  f.picker.openPicker("commands");
  const labels = id => f.picker.results.children.find(row => row.dataset.commandId === id).querySelectorAll("kbd").map(node => node.textContent);
  assert.deepEqual(labels("command"), ["Ctrl+P"]); assert.deepEqual(labels("plugin:run"), ["Alt+K"]);
  f.hotkeyManager.setHotkeys("command", [{ modifiers: ["Ctrl", "Shift"], key: "L" }, { modifiers: ["Alt"], key: "Q" }]); f.picker.renderResults();
  assert.deepEqual(labels("command"), ["Ctrl+Shift+L", "Alt+Q"]);
  f.picker.input.value = "shift"; f.picker.renderResults();
  assert.deepEqual(f.picker.results.querySelectorAll(".suggestion-highlight").map(node => node.textContent), ["Shift"]);
  f.picker.input.value = "";
  f.hotkeyManager.disableHotkeys("command"); f.picker.renderResults(); assert.deepEqual(labels("command"), []);
  f.hotkeyManager.removeHotkeys("command"); f.picker.renderResults(); assert.deepEqual(labels("command"), ["Ctrl+P"]);
  f.hotkeyManager.removeDefaultHotkeys("plugin:run"); f.picker.renderResults(); assert.deepEqual(labels("plugin:run"), []);
});

test("Longest accepted plugin shortcut remains literal and has bounded wrapping group/pill contracts", async () => {
  const f = pickerFixture([{ id: "plugin:long", name: "Plugin long key" }]);
  const longKey = "VeryLongPluginKey".padEnd(64, "X");
  f.hotkeyManager.addDefaultHotkeys("plugin:long", [{ modifiers: ["Ctrl", "Alt", "Shift"], key: longKey }, { modifiers: ["Ctrl"], key: "Q" }]);
  f.picker.openPicker("commands");
  const labels = f.picker.results.querySelectorAll("kbd").map(node => node.textContent);
  assert.deepEqual(labels, ["Ctrl+Alt+Shift+" + longKey, "Ctrl+Q"]);
  assert.equal(f.picker.results.querySelector(".suggestion-hotkeys").title, labels.join(" / "));

  // Default verification reads the merged production stylesheet. The component
  // owner can select its not-yet-merged private fragment for focused checks.
  const cssPath = process.env.SLOPSIDIAN_PICKER_CSS ?? fileURLToPath(new URL("../src/RonSijm.Slopsidian/wwwroot/app.css", import.meta.url));
  const { code } = await transform(await readFile(cssPath, "utf8"), { loader: "css", logLevel: "silent" });
  const declarations = name => {
    const block = code.match(new RegExp("^#desktop-picker \\." + name + "\\s*\\{([^}]+)\\}", "m"))?.[1];
    assert.ok(block, "The merged picker must declare its base " + name + " layout.");
    return new Map(block.split(";").flatMap(part => { const colon = part.indexOf(":"); return colon < 0 ? [] : [[part.slice(0, colon).trim(), part.slice(colon + 1).trim()]]; }));
  };
  const group = declarations("suggestion-hotkeys"), pill = declarations("suggestion-hotkey");
  for (const [name, style] of [["group", group], ["pill", pill]]) {
    const bound = style.get("max-inline-size") ?? style.get("max-width") ?? "";
    assert.match(bound, /^\d+(?:\.\d+)?%$/, name + " must fit its available inline size.");
    assert.ok(Number.parseFloat(bound) > 0 && Number.parseFloat(bound) <= 100);
    assert.equal(Number.parseFloat(style.get("min-inline-size") ?? style.get("min-width")), 0, name + " must be able to shrink below its long token's intrinsic width.");
  }
  assert.ok(Number.parseFloat(group.get("flex-shrink")) > 0, "The group must yield space rather than force clipping.");
  assert.match(pill.get("white-space") ?? "", /^(normal|pre-wrap|break-spaces)$/, "A long accepted key must be able to wrap.");
  assert.match(pill.get("overflow-wrap") ?? "", /^(anywhere|break-word)$/, "An unbroken key token must have a wrapping opportunity.");
});

test("Picker instruction modes are honest and result options preserve input focus and stale-row refusal", () => {
  const f = pickerFixture([{ id: "workspace:save-file", name: "Save file" }]); f.picker.openPicker("commands");
  assert.match(f.picker.instructions.textContent, /run command/); assert.doesNotMatch(f.picker.instructions.textContent, /Ctrl\+Enter|Shift\+Enter|create/);
  const row = f.picker.results.children[0]; assert.equal(row.tabIndex, -1); const down = key("", { button: 0 }); row.fire("mousedown", down);
  assert.equal(down.defaultPrevented, true); assert.equal(f.document.activeElement, f.picker.input);
  f.picker.renderResults(); row.fire("click", { ctrlKey: false }); assert.deepEqual(f.executed, []);
  f.picker.openPicker("pane"); assert.match(f.picker.instructions.textContent, /run action/); assert.doesNotMatch(f.picker.instructions.textContent, /create|new tab/);
  renderPickerInstructions(f.picker.instructions, "files"); assert.match(f.picker.instructions.textContent, /Ctrl\+Enter.*new tab/); assert.match(f.picker.instructions.textContent, /Shift\+Enter.*create/);
});

test("Literal highlighting preserves ranking, complete labels, file paths and selection ownership", () => {
  const f = pickerFixture([{ id: "long", name: "Open daily note" }, { id: "short", name: "Open note" }, { id: "literal", name: "<img src=x onerror=alert(1)>" }]);
  f.picker.openPicker("commands"); f.picker.input.value = "open note"; f.picker.renderResults();
  assert.deepEqual(f.picker.visible.map(item => item.id), ["short", "long"]);
  assert.deepEqual(f.picker.results.children[0].querySelectorAll(".suggestion-highlight").map(node => node.textContent), ["Open", "note"]);
  f.picker.input.value = "<img"; f.picker.renderResults(); const literal = f.picker.results.children[0];
  assert.equal(literal.querySelector(".suggestion-title").textContent, "<img src=x onerror=alert(1)>"); assert.equal(literal.querySelectorAll("img,script").length, 0);
  f.picker.picker.dataset.picker = "files"; f.picker.items = [{ id: "path", name: "Note", detail: "Folder/Note.md", action: async () => {} }];
  f.picker.input.value = "folder note"; f.picker.renderResults();
  assert.equal(f.picker.results.children[0].querySelector(".suggestion-note").textContent, "Folder/Note.md"); assert.equal(f.picker.input.getAttribute("aria-activedescendant"), "desktop-suggestion-0");
});

test("Unicode folded matches stay on original code points and overlapping words merge safely", () => {
  const document = environment(), target = document.createElement("div"), text = "İ 😀 <b>literal</b>";
  const ranges = pickerMatchRanges(text, "i 😀"); appendPickerText(target, text, ranges);
  assert.equal(target.textContent, text); assert.deepEqual(target.querySelectorAll(".suggestion-highlight").map(node => node.textContent), ["İ", "😀"]);
  assert.deepEqual(pickerMatchRanges("banana", "ban ana"), [[0, 4]]); assert.deepEqual(pickerMatchRanges("name", "missing"), []);
  const split = document.createElement("span"), combined = "Name Folder/Name.md"; appendPickerText(split, "Folder/Name.md", pickerMatchRanges(combined, "folder"), 5);
  assert.equal(split.textContent, "Folder/Name.md"); assert.equal(split.querySelector(".suggestion-highlight").textContent, "Folder");
});

test("Shared Modal exposes a compact labelled X and focuses an available editable input after onOpen", () => {
  const document = environment(), before = document.createElement("button"); document.body.append(before); before.focus();
  const modal = new Modal({}); let input;
  modal.onOpen = () => { input = document.createElement("input"); modal.contentEl.append(input); }; modal.open();
  const close = modal.modalEl.querySelector(".modal-close-button"); assert.equal(close.type, "button"); assert.equal(close.getAttribute("aria-label"), "Close dialog");
  assert.equal(close.classList.contains("clickable-icon"), true); assert.equal(close.textContent, ""); assert.equal(close.querySelector("svg").getAttribute("aria-hidden"), "true");
  assert.equal(document.activeElement, input); assert.deepEqual(input.focusOptions, { preventScroll: true });
  close.fire("click"); assert.equal(modal.isOpen, false); assert.equal(document.activeElement, before);
});

test("Modal initial focus skips unavailable/readonly/negative stops and respects autofocus and explicit onOpen focus", () => {
  const document = environment(), modal = new Modal({}); let available;
  modal.onOpen = () => {
    for (const configure of [node => { node.disabled = true; }, node => { node.hidden = true; }, node => { node.readOnly = true; }, node => { node.tabIndex = -1; }, node => { node.setAttribute("inert", ""); }, node => { node.layout = false; }]) { const node = document.createElement("input"); configure(node); modal.contentEl.append(node); }
    available = document.createElement("textarea"); modal.contentEl.append(available);
  }; modal.open(); assert.equal(document.activeElement, available); modal.close();
  const explicit = new Modal({}); let button; explicit.onOpen = () => { const input = document.createElement("input"); button = document.createElement("button"); explicit.contentEl.append(input, button); button.focus(); };
  explicit.open(); assert.equal(document.activeElement, button); explicit.close();
  const autofocus = new Modal({}); autofocus.onOpen = () => { const input = document.createElement("input"); button = document.createElement("button"); button.setAttribute("autofocus", ""); autofocus.contentEl.append(input, button); };
  autofocus.open(); assert.equal(document.activeElement, button); autofocus.close();
});

test("Nested, self-closing and failed onOpen dialogs retain focus/disposal ownership without backdrop dismissal", () => {
  const document = environment(), parent = new Modal({}), child = new Modal({}); let childInput;
  child.onOpen = () => { childInput = document.createElement("input"); child.contentEl.append(childInput); };
  parent.onOpen = () => { parent.contentEl.append(document.createElement("input")); child.open(); };
  parent.open(); assert.equal(document.activeElement, childInput); assert.equal(parent.isOpen, true);
  parent.containerEl.fire("click", { target: parent.containerEl }); assert.equal(parent.isOpen, true);
  child.close(); parent.close(); assert.ok([...document.defaultView.listeners.values()].every(listeners => !listeners.size));
  const closed = new Modal({}); closed.onOpen = () => { closed.contentEl.append(document.createElement("input")); closed.close(); }; closed.open(); assert.equal(closed.isOpen, false); assert.equal(document.activeElement, document.body);
  const failed = new Modal({}); failed.onOpen = () => { throw new Error("Open failed"); }; assert.throws(() => failed.open(), /Open failed/); assert.equal(failed.isOpen, false);
  assert.ok([...document.defaultView.listeners.values()].every(listeners => !listeners.size));
});

test("A read-only review without an editable field keeps dialog focus and its actions unchanged", () => {
  const document = environment(), modal = new Modal({}); let preview, apply;
  modal.onOpen = () => {
    preview = document.createElement("textarea"); preview.readOnly = true; preview.value = "Exact review text";
    apply = document.createElement("button"); apply.disabled = true; apply.textContent = "Apply";
    modal.contentEl.append(preview, apply);
  };
  modal.open(); assert.equal(document.activeElement, modal.modalEl); assert.equal(preview.value, "Exact review text"); assert.equal(apply.disabled, true);
  modal.close(); assert.equal(preview.value, "Exact review text"); assert.equal(apply.disabled, true);
});

test("Modal initial focus uses the adopted active document and keeps existing keyboard trapping/restoration", () => {
  const original = environment(), modal = new Modal({}), active = modelDocument(); let input;
  globalThis.window = active.defaultView;
  const before = active.createElement("button"); active.body.append(before); before.focus();
  modal.onOpen = () => { input = active.createElement("input"); modal.contentEl.append(input); }; modal.open();
  assert.equal(modal.modalEl.ownerDocument, active); assert.equal(active.activeElement, input); assert.equal(original.activeElement, original.body);
  const tab = key("Tab"); active.defaultView.fire("keydown", tab); assert.equal(tab.defaultPrevented, true); assert.equal(active.activeElement, modal.modalEl.querySelector(".modal-close-button"));
  modal.close(); assert.equal(active.activeElement, before); assert.ok([...active.defaultView.listeners.values()].every(listeners => !listeners.size));
});
