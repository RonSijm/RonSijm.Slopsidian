import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, Menu, MenuItem, WorkspaceTabDrag, FileManager, FileExplorerView, TFile, TFolder, doc, win;
const globals = ["window", "document", "Node", "Element", "HTMLElement", "menuErrors"], saved = new Map();

class Surface {
  listeners = new Map();
  addEventListener(type, callback, options = {}) {
    const item = { callback, signal: options?.signal, capture: options === true || Boolean(options?.capture) };
    if (!item.signal?.aborted) { const list = this.listeners.get(type) ?? []; list.push(item); this.listeners.set(type, list); }
  }
  fire(type, event = {}, bubble = true) {
    event.type = type; event.target ??= this; event.preventDefault ??= function () { this.defaultPrevented = true; };
    event.stopPropagation ??= function () { this.stopped = true; };
    for (const item of this.listeners.get(type) ?? []) { if (!item.signal?.aborted) { item.callback(event); } }
    if (bubble && !event.stopped) { this.parentElement?.fire(type, event); }
    return event;
  }
}
class Element extends Surface {
  nodeType = 1; parentElement = null; children = []; dataset = {}; style = {}; attributes = new Map(); disabled = false; hidden = false;
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; }
  get className() { return [...this.classes ?? []].join(" "); }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get classList() { return { add: value => (this.classes ??= new Set()).add(value), remove: value => this.classes?.delete(value), contains: value => Boolean(this.classes?.has(value)), toggle: (value, enabled) => { enabled ??= !this.classes?.has(value); if (enabled) { (this.classes ??= new Set()).add(value); } else { this.classes?.delete(value); } return enabled; } }; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join("") : this.text ?? ""; }
  set textContent(value) { this.replaceChildren(); this.text = value; }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); child.adopt(this.ownerDocument); } }
  adopt(ownerDocument) { this.ownerDocument = ownerDocument; for (const child of this.children) { child.adopt(ownerDocument); } }
  replaceChildren(...children) { for (const child of this.children) { child.parentElement = null; } this.children = []; this.text = ""; this.append(...children); }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  closest(selector) { if (selector === "dialog[open]" && this.tagName === "DIALOG" && this.attributes.has("open")) { return this; } return this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(selector === "button:not(:disabled)" && child.tagName === "BUTTON" && !child.disabled ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() { if (this.disabled || !this.isConnected || this.ownerDocument.activeElement === this) { return; } this.ownerDocument.activeElement = this; this.fire("focus", {}, false); }
  getBoundingClientRect() { const left = Number.parseFloat(this.style.left) || 0, top = Number.parseFloat(this.style.top) || 0, width = this.classList.contains("menu") ? 210 : 180, height = this.classList.contains("menu") ? this.children.length * 26 + 12 : 26; return { left, top, width, height, right: left + width, bottom: top + height }; }
}
function documentFixture() {
  let now = 0, sequence = 0;
  const timers = new Map(), window = Object.assign(new Surface(), { innerWidth: 800, innerHeight: 600,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) { const until = now + ms; for (;;) { const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) { break; } now = next[1].at; timers.delete(next[0]); next[1].callback(); } now = until; }, timers,
  });
  const document = Object.assign(new Surface(), { defaultView: window, activeElement: null, createElement(tag) { return new Element(tag, this); } });
  document.body = document.createElement("body"); document.activeElement = document.body; window.document = document;
  return { document, window };
}
const items = menu => menu.entries.filter(entry => entry instanceof MenuItem);
const named = (menu, title) => items(menu).find(item => item.dom.dataset.menuTitle === title);
const rows = menu => menu.dom.children.map(child => child.dataset.menuTitle ?? "|");
const selected = menu => items(menu).filter(item => item.dom.classList.contains("selected")).map(item => item.dom.dataset.menuTitle);
const key = (menu, value) => menu.dom.fire("keydown", { key: value });
const pointer = item => item.dom.fire("pointermove");
const drain = async () => { await Promise.resolve(); await Promise.resolve(); };
const event = target => ({ target, detail: 1, clientX: 40, clientY: 60, preventDefault() { this.defaultPrevented = true; } });

before(async () => {
  for (const name of globals) { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); }
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime/menu-ux-tests-"));
  const output = join(directory, "menus.mjs");
  const noop = names => names.map(name => `export function ${name}(){}`).join("\n");
  const stubs = {
    "./plugin": "export class Component {}",
    "./dom": "export function reportError(error){globalThis.menuErrors.push(error)}",
    "./icons": 'export function icon(name){const svg=document.createElement("svg");svg.dataset.icon=name;return svg}',
    "./realm": "export function activeDoc(){return document} export function ownerDoc(event){return event.target?.ownerDocument??document}",
    "./markdown": noop(["composerFragment", "composerHeading", "composerTemplate", "insertMarkdown", "parseMarkdown", "renameFrontmatterProperty", "updateFrontmatter"]),
    "./property-types": noop(["propertyName"]),
    "./contracts": "export const copyViewData=value=>structuredClone(value)",
    "./vault": 'export const normalizePath=value=>value; export class TAbstractFile{constructor(path){this.path=path}} export class TFile extends TAbstractFile{extension="md"} export class TFolder extends TAbstractFile{isRoot(){return this.path==="/"}}',
    "./views": "export class FileView{} export class TextFileView{} export class ItemView{}",
    "./workspace": "export class MarkdownView{}",
    "./links": noop(["createLinkResolver", "fileLinktext", "linkTextFormat", "newLinkedNotePath", "relocateMarkdownLinks", "resolveSubpath", "rewriteFileLinks", "rewriteFolderLinks", "rewriteSectionLinks"]),
    "./ui": "export class Modal{} export class Notice{}",
    "./canvas-model": noop(["rewriteCanvasFolderReferences", "rewriteCanvasReferences"]),
    "./explorer-move-modal": "export class ExplorerMoveModal{}", "./explorer-rename-modal": "export class ExplorerRenameModal{}",
    "./explorer-trash-modal": "export class ExplorerTrashModal{}", "./explorer-trash-recovery-modal": "export class ExplorerTrashRecoveryModal{}",
  };
  await build({ stdin: { contents: 'export {Menu,MenuItem} from "./client/menu"; export {WorkspaceTabDrag} from "./client/workspace-tab-drag"; export {FileManager} from "./client/file-manager"; export {FileExplorerView} from "./client/file-explorer-view"; export {TFile,TFolder} from "./client/vault";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "menu-boundaries", setup(plugin) {
    plugin.onResolve({ filter: /^\.\// }, args => {
      const name = args.path === "./client/vault" ? "./vault" : args.path;
      if (Object.hasOwn(stubs, name)) { return { path: name, namespace: "menu-boundary" }; }
    });
    plugin.onLoad({ filter: /.*/, namespace: "menu-boundary" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }] });
  ({ Menu, MenuItem, WorkspaceTabDrag, FileManager, FileExplorerView, TFile, TFolder } = await import(pathToFileURL(output).href));
});
beforeEach(() => {
  ({ document: doc, window: win } = documentFixture());
  for (const [name, value] of Object.entries({ document: doc, window: win, Node: Element, Element, HTMLElement: Element, menuErrors: [] })) { Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); }
});
afterEach(() => { Menu.dismiss(); assert.deepEqual(globalThis.menuErrors, []); assert.equal(win.timers.size, 0); });
after(async () => {
  for (const [name, descriptor] of saved) { if (descriptor) { Object.defineProperty(globalThis, name, descriptor); } else { delete globalThis[name]; } }
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/menu-ux-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

test("pointer opens are neutral; keyboard intent and first arrows select enabled edge rows", () => {
  const menu = new Menu().addItem(item => item.setTitle("Heading").setIsLabel(true)).addItem(item => item.setTitle("Unavailable").setDisabled(true).onClick(() => {}))
    .addItem(item => item.setTitle("First").onClick(() => {})).addItem(item => item.setTitle("Last").onClick(() => {}));
  menu.showAtMouseEvent(event(doc.body)); assert.equal(doc.activeElement, menu.dom); assert.deepEqual(selected(menu), []);
  key(menu, "ArrowUp"); assert.deepEqual(selected(menu), ["Last"]); key(menu, "ArrowDown"); assert.deepEqual(selected(menu), ["First"]);
  menu.showAtPosition({ x: 30, y: 40 }); key(menu, "ArrowDown"); assert.deepEqual(selected(menu), ["First"]);
  menu.showAtMouseEvent({ ...event(doc.body), detail: 0, clientX: 0, clientY: 0 }); assert.deepEqual(selected(menu), ["First"]);
  assert.equal(named(menu, "Heading").dom.getAttribute("role"), "presentation"); assert.equal(named(menu, "Heading").dom.classList.contains("is-disabled"), false);
  assert.equal(named(menu, "Unavailable").dom.classList.contains("is-disabled"), true);
});

test("checks use SVG, toggle independently of submenu arrows, and retain checkbox ARIA", () => {
  const item = new MenuItem().setTitle("Checked parent").setIcon("file").setChecked(true); item.setSubmenu();
  const check = item.dom.children.find(child => child.className === "menu-item-check"), arrow = item.dom.children.find(child => child.className === "menu-item-submenu");
  assert.equal(check.firstElementChild.tagName, "SVG"); assert.equal(check.firstElementChild.dataset.icon, "check"); assert.equal(arrow.firstElementChild.dataset.icon, "chevron-right");
  assert.equal(item.dom.getAttribute("role"), "menuitemcheckbox"); assert.equal(item.dom.getAttribute("aria-checked"), "true");
  item.setChecked(false); assert.equal(check.hidden, true); assert.equal(check.children.length, 0); assert.equal(arrow.hidden, false); assert.equal(item.dom.getAttribute("aria-checked"), "false");
  item.setChecked(true); assert.equal(check.hidden, false); assert.equal(check.children.length, 1); item.setChecked(null); assert.equal(item.dom.getAttribute("aria-checked"), null);
});

test("section order keeps extensions before destructive actions and removes edge or duplicate separators", () => {
  const menu = new Menu().addSections(["open", "action", "", "danger"]).addSections(["plugin", "plugin"]).addSeparator().addSeparator();
  for (const [title, section] of [["Delete", "danger"], ["Rename", "action"], ["Ordinary", ""], ["Plugin", "plugin"], ["Open", "open"], ["Open again", "open"]]) { menu.addItem(item => item.setTitle(title).setSection(section).onClick(() => {})); }
  menu.addSeparator().addSeparator().addItem(item => item.setTitle("Final").onClick(() => {})).addSeparator().addSeparator().showAtPosition({ x: 10, y: 10 });
  assert.deepEqual(rows(menu), ["Open", "Open again", "|", "Rename", "|", "Plugin", "|", "Ordinary", "|", "Delete", "|", "Final"]);
  assert.throws(() => menu.addSections(["late"]), /before showing/);
});

function nested() {
  const menu = new Menu(); let child;
  menu.addItem(item => { item.setTitle("Parent"); child = item.setSubmenu().addItem(row => row.setTitle("Child").onClick(() => {})); });
  menu.addItem(item => item.setTitle("Sibling").onClick(() => {})); menu.showAtPosition({ x: 20, y: 20 });
  return { menu, child, parent: named(menu, "Parent"), sibling: named(menu, "Sibling") };
}
test("submenu hover waits once for 250ms while keyboard navigation opens immediately", () => {
  const f = nested(); pointer(f.parent); win.tick(200); pointer(f.parent); win.tick(49); assert.equal(f.child.dom.isConnected, false);
  win.tick(1); assert.equal(f.child.dom.isConnected, true); assert.equal(doc.activeElement, f.parent.dom); assert.deepEqual(selected(f.menu), ["Parent"]);
  key(f.menu, "ArrowRight"); assert.equal(doc.activeElement, named(f.child, "Child").dom); assert.equal(f.parent.dom.getAttribute("aria-expanded"), "true");
  key(f.child, "ArrowLeft"); assert.equal(f.child.dom.isConnected, false); assert.equal(doc.activeElement, f.parent.dom); assert.equal(f.parent.dom.getAttribute("aria-expanded"), "false");
  key(f.menu, "ArrowRight"); assert.equal(f.child.dom.isConnected, true); assert.equal(win.timers.size, 0);
});
test("crossing a sibling into the child preserves its owner highlight and cancels delayed closure", () => {
  const f = nested(); pointer(f.parent); win.tick(250); pointer(f.sibling); win.tick(100); assert.equal(f.child.dom.isConnected, true);
  f.child.dom.fire("pointerenter", {}, false); pointer(named(f.child, "Child")); win.tick(500);
  assert.equal(f.child.dom.isConnected, true); assert.deepEqual(selected(f.menu), ["Parent"]); assert.deepEqual(selected(f.child), ["Child"]);
  pointer(f.sibling); win.tick(249); assert.equal(f.child.dom.isConnected, true); win.tick(1); assert.equal(f.child.dom.isConnected, false);
  assert.deepEqual(selected(f.menu), ["Sibling"]);
});
test("handled and composing menu keys preserve pending hover, selection and callbacks", async () => {
  for (const guard of [{ defaultPrevented: true }, { isComposing: true }]) {
    const f = nested(); let calls = 0; named(f.child, "Child").onClick(() => calls++);
    pointer(f.parent);
    for (const value of ["ArrowDown", "Enter", "ArrowRight", "Escape"]) { f.menu.dom.fire("keydown", { key: value, ...guard }); }
    assert.equal(f.menu.dom.isConnected, true); assert.equal(f.child.dom.isConnected, false); assert.deepEqual(selected(f.menu), ["Parent"]); assert.equal(win.timers.size, 1);
    win.tick(250); assert.equal(f.child.dom.isConnected, true); named(f.child, "Child").dom.focus();
    f.child.dom.fire("keydown", { key: "Enter", ...guard }); await drain(); assert.equal(calls, 0); assert.equal(f.child.dom.isConnected, true); f.menu.hide();
  }
});
test("entering submenu padding restores its visually selected owner without stealing child focus", async () => {
  const f = nested(), calls = []; f.sibling.onClick(() => calls.push("sibling")); named(f.child, "Child").onClick(() => calls.push("child"));
  pointer(f.parent); win.tick(250); pointer(f.sibling); win.tick(100); f.child.dom.fire("pointerenter", {}, false);
  assert.deepEqual(selected(f.menu), ["Parent"]); assert.equal(doc.activeElement, f.parent.dom); assert.equal(win.timers.size, 0);
  key(f.menu, "Enter"); await drain(); assert.deepEqual(calls, []); assert.equal(doc.activeElement, named(f.child, "Child").dom);
  f.child.dom.fire("pointerenter", {}, false); assert.equal(doc.activeElement, named(f.child, "Child").dom, "a focused child row retains ownership when the pointer reenters its container");
});
test("an asynchronously disabled or label ancestor retires child activation without a callback", async () => {
  for (const block of [item => item.setDisabled(true), item => item.setIsLabel(true)]) { for (const depth of [1, 2]) { for (const input of ["keyboard", "pointer"]) {
    const f = nested(); let calls = 0, targetMenu = f.child, target = named(f.child, "Child");
    if (depth === 2) { targetMenu = target.setSubmenu().addItem(item => item.setTitle("Grandchild").onClick(() => calls++)); target = named(targetMenu, "Grandchild"); }
    else { target.onClick(() => calls++); }
    pointer(f.parent); win.tick(250); key(f.menu, "ArrowRight"); if (depth === 2) { key(f.child, "ArrowRight"); }
    await Promise.resolve(); block(f.parent); if (input === "keyboard") { key(targetMenu, "Enter"); } else { target.dom.fire("click"); }
    await drain(); assert.equal(calls, 0); assert.equal(targetMenu.dom.isConnected, false);
  } } }
});
test("pending hover is retired on leave, keyboard, hide/reopen, disable and window dismissal", () => {
  for (const retire of [f => f.menu.dom.fire("pointerleave", {}, false), f => key(f.menu, "ArrowDown"), f => { f.menu.hide(); f.menu.showAtPosition({ x: 10, y: 10 }); }, f => f.parent.setDisabled(true), () => win.fire("blur"), () => win.fire("resize")]) {
    const f = nested(); pointer(f.parent); retire(f); win.tick(500); assert.equal(f.child.dom.isConnected, false); f.menu.hide();
  }
});
test("activation dismisses the whole tree before invoking once, restores focus, and ignores blocked actions", async () => {
  const anchor = doc.createElement("button"); doc.body.append(anchor); anchor.focus(); let count = 0, child;
  const menu = new Menu().addItem(item => { item.setTitle("Parent"); child = item.setSubmenu().addItem(row => row.setTitle("Run").onClick(() => { assert.equal(menu.dom.isConnected, false); assert.equal(child.dom.isConnected, false); count++; })); })
    .addItem(item => item.setTitle("Blocked").setDisabled(true).onClick(() => { count += 100; }));
  menu.showAtPosition({ x: 10, y: 10 }); named(menu, "Blocked").dom.fire("click"); await drain(); assert.equal(count, 0);
  key(menu, "ArrowDown"); key(menu, "ArrowRight"); key(child, "Enter"); await drain(); assert.equal(count, 1); assert.equal(doc.activeElement, anchor);
  named(child, "Run").dom.fire("click"); await drain(); assert.equal(count, 1, "aborted listeners cannot invoke a retired row");
});
test("outside dismissal, Escape, Tab, history and unload retain cleanup and focus restoration", () => {
  for (const dismiss of [menu => doc.fire("pointerdown", { target: doc.body }), menu => key(menu, "Escape"), menu => key(menu, "Tab"), menu => menu.onHistoryBack(), menu => menu.onunload()]) {
    const anchor = doc.createElement("button"); doc.body.append(anchor); anchor.focus(); const f = nested(); pointer(f.parent); win.tick(250); let hidden = 0; f.menu.onHide(() => hidden++);
    dismiss(f.menu); assert.equal(f.menu.dom.isConnected, false); assert.equal(f.child.dom.isConnected, false); assert.equal(doc.activeElement, anchor); assert.equal(hidden, 1);
  }
});
test("a menu hosted in another document uses that owner's hover clock, dismissal and focus", () => {
  const foreign = documentFixture(), anchor = foreign.document.createElement("button"); foreign.document.body.append(anchor); anchor.focus();
  let child; const menu = new Menu().setParentElement(foreign.document.body).addItem(item => { item.setTitle("Parent"); child = item.setSubmenu().addItem(row => row.setTitle("Child").onClick(() => {})); });
  menu.showAtPosition({ x: 10, y: 10 }, doc); pointer(named(menu, "Parent")); win.tick(500); assert.equal(child.dom.isConnected, false);
  assert.equal(menu.dom.ownerDocument, foreign.document); foreign.window.tick(250); assert.equal(child.dom.ownerDocument, foreign.document); assert.equal(child.dom.isConnected, true);
  foreign.document.fire("pointerdown", { target: foreign.document.body }); assert.equal(menu.dom.isConnected, false); assert.equal(child.dom.isConnected, false); assert.equal(foreign.document.activeElement, anchor); assert.equal(foreign.window.timers.size, 0); assert.equal(doc.activeElement, doc.body);
});
test("shared pending event menus retire before their microtask and still reject invalid or detached placement", async () => {
  const invocation = event(doc.body), menu = Menu.forEvent(invocation); assert.equal(Menu.forEvent(invocation), menu); assert.equal(invocation.defaultPrevented, true);
  menu.addItem(item => item.setTitle("Retired").onClick(() => {})); menu.onHistoryBack(); await drain(); assert.equal(menu.dom.isConnected, false);
  assert.throws(() => new Menu().showAtPosition({ x: NaN, y: 0 }), /finite/);
  assert.throws(() => new Menu().showAtPosition({ x: 0, y: 0, width: -1 }), /finite/);
  assert.throws(() => new Menu().setParentElement(doc.createElement("div")).showAtPosition({ x: 0, y: 0 }), /no longer attached/);
});

function tabFixture() {
  const calls = [], group = { children: [] }, leaf = { parent: group, view: {}, pinned: false, tabHeaderEl: doc.createElement("button"), togglePinned() { this.pinned = !this.pinned; calls.push("pin"); } }; group.children.push(leaf); doc.body.append(leaf.tabHeaderEl);
  const workspace = { rootSplit: {}, app: { vault: { rootPath: "vault-a" } }, on() {}, canMoveLeaf: () => true, tabDestination: (_leaf, direction, pane) => direction < 0 && !pane ? null : ({ parent: group, index: 0 }),
    rootDestination: (_leaf, area) => area === "main" ? null : group, canDockLeaf: (_leaf, _group, edge) => edge !== "top", moveLeaf: () => { calls.push("move"); return true; }, moveLeafToRoot: () => { calls.push("root"); return true; }, dockLeaf: () => { calls.push("dock"); return true; }, closeLeaf: () => { calls.push("close"); return true; } };
  new WorkspaceTabDrag(workspace).installLeaf(leaf);
  const open = async () => { const invocation = event(leaf.tabHeaderEl); leaf.tabHeaderEl.fire("contextmenu", invocation); const menu = Menu.forEvent(invocation); await drain(); return menu; };
  return { workspace, leaf, group, calls, open };
}
test("tab inventory starts with Close and Pin, with every existing move/dock action and icon in one submenu", async () => {
  const f = tabFixture(), menu = await f.open(); assert.deepEqual(rows(menu), ["Close", "|", "Pin", "|", "Move tab"]);
  for (const item of items(menu)) { assert.equal(item.dom.children[0].firstElementChild.tagName, "SVG"); }
  const movement = named(menu, "Move tab").submenu; assert.deepEqual(items(movement).map(item => item.dom.dataset.tabMove ?? item.dom.dataset.tabDock), ["left", "right", "previous-pane", "next-pane", "to-left-sidebar", "to-right-sidebar", "to-main", "dock-left", "dock-right", "dock-top", "dock-bottom"]);
  assert.deepEqual(items(movement).filter(item => item.dom.disabled).map(item => item.dom.dataset.tabMove ?? item.dom.dataset.tabDock), ["left", "to-main", "dock-top"]);
  for (const item of items(movement)) { assert.equal(item.dom.children[0].firstElementChild.tagName, "SVG"); }
  named(menu, "Pin").dom.fire("click"); await drain(); assert.deepEqual(f.calls, ["pin"]); assert.equal(f.leaf.pinned, true);
  const pinned = await f.open(); assert.equal(named(pinned, "Unpin").dom.children[0].firstElementChild.dataset.icon, "pin-off");
});
test("tab actions keep source/order/view/vault and current-destination guards after regrouping", async () => {
  for (const change of [f => { f.workspace.rootSplit = {}; }, f => { f.workspace.app.vault.rootPath = "vault-b"; }, f => { f.leaf.view = {}; }, f => { f.leaf.parent = { children: [f.leaf] }; }, f => { f.group.children.push({}); }, f => { f.workspace.canMoveLeaf = () => false; }]) {
    const f = tabFixture(), menu = await f.open(), movement = named(menu, "Move tab").submenu; change(f);
    for (const item of [named(menu, "Close"), named(menu, "Pin"), ...items(movement)]) { assert.throws(() => item.callback(), /changed/); }
    assert.deepEqual(f.calls, []); menu.hide();
  }
  const f = tabFixture(), menu = await f.open(), movement = named(menu, "Move tab").submenu;
  f.workspace.tabDestination = () => null; items(movement).find(item => item.dom.dataset.tabMove === "right").callback(); assert.deepEqual(f.calls, []);
  f.workspace.canDockLeaf = () => false; assert.throws(() => items(movement).find(item => item.dom.dataset.tabDock === "dock-right").callback(), /changed/); assert.deepEqual(f.calls, []);
});

function fileFixture(folder = false, system = true) {
  const calls = [], file = new (folder ? TFolder : TFile)(folder ? "Folder" : "Note.md"), app = { changingVault: false, vault: { rootPath: "vault-a", supportsSystemTrash: system, readOnly: false, getAbstractFileByPath: path => path === file.path ? file : null }, workspace: { isChangingFiles: false, viewTypeForExtension: () => "markdown", trigger(_name, menu) { menu.addItem(item => item.setTitle("Plugin action").setSection("plugin").onClick(() => calls.push("plugin"))); } } };
  const manager = new FileManager(app); manager.editDialog = (...args) => calls.push(args); app.fileManager = manager;
  return { app, file, calls, manager, menu: () => manager.fileMenu(file.path, new Menu(), "test") };
}
test("file icons and sections preserve every supported removal choice with destructive actions last", () => {
  for (const folder of [false, true]) { const f = fileFixture(folder), menu = f.menu().showAtPosition({ x: 10, y: 10 });
    assert.deepEqual(rows(menu), folder ? ["New folder", "Rename or move folder", "|", "Plugin action", "|", "Move folder to system trash", "Delete folder permanently"] : ["Rename or move", "|", "Plugin action", "|", "Move to vault trash", "Move to system trash"]);
    for (const item of items(menu).filter(item => item.dom.dataset.fileAction)) { assert.equal(item.dom.children[0].firstElementChild.tagName, "SVG"); assert.equal(item.dom.classList.contains("is-warning"), ["trash", "system-trash", "delete"].includes(item.dom.dataset.fileAction)); }
    menu.hide();
  }
  const f = fileFixture(false, false); assert.deepEqual(items(f.menu()).map(item => item.dom.dataset.fileAction).filter(Boolean), ["rename", "trash"]);
});
test("file menu callbacks keep identity, path, vault and transition guards", () => {
  for (const change of [f => { f.app.vault.rootPath = "vault-b"; }, f => { f.file.path = "Moved.md"; }, f => { f.app.vault.getAbstractFileByPath = () => new TFile("Note.md"); }, f => { f.app.changingVault = true; }]) {
    const f = fileFixture(), menu = f.menu(); change(f); for (const item of items(menu).filter(item => item.dom.dataset.fileAction)) { assert.throws(() => item.callback(), /changed/); } assert.deepEqual(f.calls, []);
  }
  const f = fileFixture(); f.app.workspace.isChangingFiles = true; assert.throws(() => f.menu(), /Wait/); assert.deepEqual(f.calls, []);
});
test("explorer Open actions retain icons, shared sections, readonly availability and live-file refusal", async () => {
  for (const readOnly of [false, true]) {
    const f = fileFixture(), view = Object.create(FileExplorerView.prototype), row = doc.createElement("button"); row.dataset.explorerPath = f.file.path; doc.body.append(row); f.app.vault.readOnly = readOnly;
    const originalTrigger = f.app.workspace.trigger; f.app.workspace.trigger = (...args) => { originalTrigger(...args); };
    let live = true; Object.assign(view, { app: f.app, interactive: () => live, activate: (path, tab) => f.calls.push([path, tab]) });
    const invocation = event(row); view.menu(invocation, row); const menu = Menu.forEvent(invocation); await drain();
    assert.deepEqual(rows(menu).slice(0, 3), ["Open", "Open in new tab", "|"]); assert.equal(named(menu, "Open").dom.children[0].firstElementChild.dataset.icon, "file"); assert.equal(named(menu, "Open in new tab").dom.children[0].firstElementChild.dataset.icon, "file-plus");
    assert.equal(items(menu).some(item => item.dom.dataset.fileAction), !readOnly); named(menu, "Open in new tab").callback(); assert.deepEqual(f.calls, [["Note.md", true]]);
    live = false; named(menu, "Open").callback(); f.app.vault.getAbstractFileByPath = () => new TFile("Note.md"); live = true; named(menu, "Open").callback(); assert.deepEqual(f.calls, [["Note.md", true]]); menu.hide();
  }
});

async function movementScenario(kind, failure = "") {
  const config = kind === "move" ? { file: "tab-movement-scenarios.mjs", name: "menu", next: "unchangedFiles", attribute: "data-tab-move", action: "next-pane" }
    : { file: "workspace-docking-scenarios.mjs", name: "menuDock", next: "run", attribute: "data-tab-dock", action: "to-left-sidebar" };
  const source = await readFile(new URL("../tools/" + config.file, import.meta.url), "utf8"), start = source.indexOf(`  async function ${config.name}(id, action) {`), end = source.indexOf(`  async function ${config.next}(`, start);
  assert.ok(start >= 0 && end > start, "Execute the actual scoped scenario helper, without reproducing its body in the test.");
  const calls = []; let menus = 0, expanded = false, settled = 0;
  const owner = { getAttribute: name => name === "aria-expanded" ? String(expanded) : null };
  const document = {
    querySelectorAll(selector) { assert.equal(selector, ".menu"); return Array(menus).fill({}); },
    querySelector(selector) {
      if (selector === '.menu [data-menu-title="Move tab"]:not(:disabled)' || selector === '.menu [data-menu-title="Move tab"]') { return menus ? owner : null; }
      if (selector === `.menu [${config.attribute}]`) { return menus === 2 ? {} : null; }
      throw Error("Unexpected scenario query: " + selector);
    },
  };
  const context = vm.createContext({ document, Boolean, point: async selector => { calls.push(["point", selector]); return { x: 30, y: 40 }; }, header: id => "header:" + id,
    command: async (method, parameters) => { calls.push([method, parameters.type, parameters.button]); if (parameters.type === "mouseReleased" && failure !== "root") { menus = 1; } },
    click: async selector => {
      calls.push(["click", selector]);
      if (selector === '.menu [data-menu-title="Move tab"]') { assert.equal(menus, 1); expanded = failure !== "child"; if (expanded) { menus = 2; } }
      else { assert.equal(selector, `[${config.attribute}="${config.action}"]`); assert.equal(menus, 2, "An action can only be clicked after its visible submenu opens."); }
    },
    wait: async (expression, label) => { calls.push(["wait", label]); if (!vm.runInContext(expression, context)) { throw Error("Not ready: " + label); } },
    settled: async () => { settled++; },
  });
  const helper = vm.runInContext("(" + source.slice(start, end).trim() + ")", context);
  return { run: () => helper("owned-tab", config.action), calls, config, settled: () => settled };
}
test("actual tab/docking scenario helpers reveal Move tab through the supplied pointer helper before action dispatch", async () => {
  for (const kind of ["move", "dock"]) {
    const f = await movementScenario(kind); await f.run();
    assert.deepEqual(f.calls.filter(call => call[0] === "click"), [["click", '.menu [data-menu-title="Move tab"]'], ["click", `[${f.config.attribute}="${f.config.action}"]`]]);
    assert.deepEqual(f.calls.filter(call => call[0] === "Input.dispatchMouseEvent").map(call => call.slice(1)), [["mousePressed", "right"], ["mouseReleased", "right"]]);
    assert.equal(f.calls.filter(call => call[0] === "wait").length, 2); assert.equal(f.settled(), 1);
  }
});
test("actual tab/docking scenario helpers refuse missing roots and unrevealed children before movement", async () => {
  for (const kind of ["move", "dock"]) { for (const failure of ["root", "child"]) {
    const f = await movementScenario(kind, failure); await assert.rejects(f.run(), /Not ready/);
    assert.deepEqual(f.calls.filter(call => call[0] === "click"), failure === "root" ? [] : [["click", '.menu [data-menu-title="Move tab"]']]); assert.equal(f.settled(), 0);
  } }
});
