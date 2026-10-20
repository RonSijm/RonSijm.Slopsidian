import { expectErrors } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { assertCommunityPluginConfiguration, setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pluginId = "menu-host-probe";
const pluginSource = String.raw`
const { Component, Plugin, Menu, MenuItem, MenuSeparator, MarkdownView, TFile } = require("obsidian");
const { EditorSelection } = require("@codemirror/state");
module.exports = class extends Plugin {
  onload() {
    const state = globalThis.menuHostProbe = { hidden: 0, selected: [], files: [], editors: [], cleaned: 0 };
    this.state = state;
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source) => {
      state.files.push({ menu: menu instanceof Menu, file: file instanceof TFile, path: file.path, source });
      menu.addItem(item => item.setTitle("Plugin file action").setSection("probe").onClick(event => {
        state.fileAction = { path: file.path, event: event.type };
      }));
    }));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      state.editors.push({ menu: menu instanceof Menu, view: info instanceof MarkdownView, editor: editor === info.editor, path: info.file.path });
      menu.addItem(item => item.setTitle("Plugin editor action").setSection("probe").onClick(event => {
        state.editorAction = { text: editor.getSelection(), path: info.file.path, event: event.type };
      }));
    }));
    this.addCommand({ id: "open-menu", name: "Open shared menu probe", callback: () => this.openMenu(false) });
    this.addCommand({ id: "event-menu", name: "Open event menu probe", callback: () => this.openMenu(true) });
    this.register(() => {
      state.cleaned++;
      if (this.clipboardReplaced) {
        if (this.clipboardDescriptor) { Object.defineProperty(navigator, "clipboard", this.clipboardDescriptor); }
        else { delete navigator.clipboard; }
        state.clipboardRestored = true;
      }
    });
  }
  openMenu(forEvent) {
    const state = this.state;
    const event = new MouseEvent("contextmenu", { clientX: innerWidth - 1, clientY: innerHeight - 1, cancelable: true });
    const menu = forEvent ? Menu.forEvent(event) : new Menu();
    this.addChild(menu);
    state.menu = menu;
    state.sharedTypes = menu instanceof Component && new MenuItem() instanceof MenuItem && new MenuSeparator() instanceof MenuSeparator;
    if (forEvent) { state.sharedEvent = Menu.forEvent(event) === menu && event.defaultPrevented; }
    const fragment = document.createDocumentFragment();
    const label = document.createElement("strong");
    label.textContent = "Menu probe label";
    fragment.append(label);
    menu.addItem(item => item.setTitle(fragment).setIsLabel(true).setSection("information"));
    menu.addItem(item => item.setTitle("Disabled action").setDisabled(true).setSection("information").onClick(() => state.selected.push("disabled")));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Checked option").setIcon("file").setChecked(true).setSection("actions").onClick(event => state.selected.push(event.type)));
    menu.addItem(item => item.setTitle("Pointer action").setWarning(true).setSection("actions").onClick(event => state.selected.push(event.type)));
    menu.onHide(() => { state.hidden++; });
    try { menu.setUseNativeMenu(true); } catch (error) { state.nativeError = error.message; }
    if (!forEvent) { menu.showAtPosition({ x: innerWidth - 1, y: innerHeight - 1 }); }
  }
  addSecondarySelection() {
    const cm = this.app.workspace.activeLeaf.view.editor.cm;
    cm.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 1), cm.state.selection.main], 1) });
  }
  replaceClipboard() {
    if (this.clipboardReplaced) { return; }
    this.clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    this.clipboardReplaced = true;
    const state = this.state;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      readText: () => {
        if (state.denyClipboard) { return Promise.reject(new Error("Expected clipboard permission rejection")); }
        if (state.pendingClipboard) {
          state.pendingClipboard = false;
          return new Promise(resolve => { state.resolveClipboard = resolve; });
        }
        return Promise.resolve(state.clipboardText);
      },
      writeText: value => {
        if (state.denyClipboard) { return Promise.reject(new Error("Expected clipboard permission rejection")); }
        state.clipboardText = value;
        return Promise.resolve();
      }
    } });
  }
};
`;

async function dispatchRightClick({ evaluate, command, wait }, pointExpression) {
  await command("Page.bringToFront");
  const point = await evaluate(pointExpression);
  assert.ok(point.reachable, "The real context target must be pointer-reachable: " + point.hit);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "right", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "right", clickCount: 1 });
  await wait('document.querySelectorAll(".menu").length===1', "one actual context menu");
}

export async function rightClickFileMenu(tools, path) {
  await tools.click('[data-sidebar-view="file-explorer"]');
  const selector = JSON.stringify(`[data-note-path="${path}"]`);
  await dispatchRightClick(tools, `(()=>{
    const element=document.querySelector(${selector});if(!element)throw new Error("Missing actual file tree entry");
    element.scrollIntoView({block:"center"});const b=element.getBoundingClientRect();const x=b.left+b.width/2,y=b.top+b.height/2;
    const hit=document.elementFromPoint(x,y);return{x,y,reachable:b.width>0&&b.height>0&&(hit===element||element.contains(hit)),hit:hit?.outerHTML.slice(0,200)};
  })()`);
}

export async function rightClickEditorMenu(tools) {
  await tools.evaluate('(()=>{const editor=app.editor;editor.scrollIntoView({from:editor.getCursor("from"),to:editor.getCursor("to")},true);editor.focus();return true})()');
  await tools.wait('(()=>{const c=app.editor.cm.coordsAtPos(app.editor.cm.state.selection.main.from);return c&&c.top>=0&&c.bottom<=innerHeight})()', "selected editor text is visible");
  await dispatchRightClick(tools, `(()=>{
    const view=app.workspace.activeLeaf.view;const c=view.editor.cm.coordsAtPos(view.editor.cm.state.selection.main.from);
    if(!c)throw new Error("No actual CodeMirror cursor coordinates");const x=c.left+2,y=(c.top+c.bottom)/2;
    const hit=document.elementFromPoint(x,y);return{x,y,reachable:view.sourceEl.contains(hit),hit:hit?.outerHTML.slice(0,200)};
  })()`);
}

export async function checkMenuApi(tools) {
  const { directory, evaluate, command, click, press, wait, afterReload, restart, report } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const note = "Menu compatibility/Editor.md";
  const otherNote = "Menu compatibility/Other.md";
  const text = "# Context menus\r\n\r\nAlpha beta.\r\n";
  const bytes = Buffer.from("\ufeff" + text);
  const item = title => `.menu [data-menu-title="${title}"]`;
  const optionalRead = path => readFile(path).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const communityPath = join(directory, ".obsidian", "community-plugins.json");
  const originalCommunity = await optionalRead(communityPath);
  const pluginDirectory = join(directory, ".obsidian", "plugins", pluginId);
  await mkdir(pluginDirectory, { recursive: true });
  await mkdir(join(directory, "Menu compatibility"), { recursive: true });
  await writeFile(join(directory, note), bytes);
  await writeFile(join(directory, otherNote), "# Other context\n\nNot the source editor.\n");
  await writeFile(join(pluginDirectory, "manifest.json"), JSON.stringify({ id: pluginId, name: "Menu host probe", version: "1.0.0", description: "Independent shared-menu compatibility fixture", isDesktopOnly: false }));
  await writeFile(join(pluginDirectory, "main.js"), pluginSource);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();

  async function toggle(enabled) {
    await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, enabled);
    await click(".settings-close");
  }
  async function openMenu(event = false) {
    const id = pluginId + (event ? ":event-menu" : ":open-menu");
    const name = await evaluate(`app.commands.listCommands().find(command=>command.id===${JSON.stringify(id)}).name`);
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker").open', "menu probe command palette");
    await command("Input.insertText", { text: name });
    await click(`[data-command-id="${id}"]`);
    await wait('Boolean(document.querySelector(".menu"))&&!document.querySelector("#desktop-picker").open', "plugin-created menu");
  }
  const select = () => evaluate('app.editor.setSelection({line:2,ch:0},{line:2,ch:5});true');
  await toggle(true);
  await evaluate(`app.openFile(${JSON.stringify(note)},"tab")`);
  await select();
  await openMenu();
  assert.equal(await evaluate("menuHostProbe.sharedTypes"), true);
  assert.match(await evaluate("menuHostProbe.nativeError"), /Native Electron context menus are not implemented/);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(item("Menu probe label"))}).disabled&&document.querySelector(${JSON.stringify(item("Disabled action"))}).disabled`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(item("Checked option"))}).getAttribute("aria-checked")`), "true");
  assert.equal(await evaluate('(()=>{const b=document.querySelector(".menu").getBoundingClientRect();return b.left>=7&&b.top>=7&&b.right<=innerWidth-7&&b.bottom<=innerHeight-7})()'), true);
  assert.equal(await evaluate("document.activeElement.dataset.menuTitle"), "Checked option");
  await press("ArrowDown", "ArrowDown", 40);
  assert.equal(await evaluate("document.activeElement.dataset.menuTitle"), "Pointer action");
  await press("Home", "Home", 36);
  await press("Enter", "Enter", 13);
  await wait('!document.querySelector(".menu")&&menuHostProbe.selected.length===1', "keyboard menu action");
  assert.deepEqual(await evaluate("menuHostProbe.selected"), ["keydown"]);
  assert.equal(await evaluate("menuHostProbe.hidden"), 1);
  await openMenu(true);
  assert.equal(await evaluate("menuHostProbe.sharedEvent"), true);
  await click(item("Pointer action"));
  await wait("menuHostProbe.selected.length===2", "pointer menu action");
  assert.deepEqual(await evaluate("menuHostProbe.selected"), ["keydown", "click"]);
  await openMenu();
  await press("Escape", "Escape", 27);
  await wait('!document.querySelector(".menu")', "Escape dismisses the plugin menu");
  await openMenu();
  await evaluate('globalThis.navigationMenuItem=document.querySelector(".menu [data-menu-title=\'Pointer action\']");true');
  await evaluate(`app.openFile(${JSON.stringify(otherNote)},"tab")`);
  assert.equal(await evaluate('Boolean(document.querySelector(".menu"))'), false, "Actual file navigation must dismiss an obsolete menu");
  await evaluate("navigationMenuItem.click();delete globalThis.navigationMenuItem;true");
  assert.deepEqual(await evaluate("menuHostProbe.selected"), ["keydown", "click"]);
  await evaluate(`app.openFile(${JSON.stringify(note)})`);
  await select();
  await openMenu();
  await click("#file-actions");
  await wait('Boolean(document.querySelector("[data-file-menu]"))', "outside click replaces the plugin menu with current-file actions");
  await click(item("Plugin file action"));
  await wait("Boolean(menuHostProbe.fileAction)", "real file-menu plugin action");
  assert.deepEqual(await evaluate("menuHostProbe.fileAction"), { path: note, event: "click" });
  assert.deepEqual(await evaluate("menuHostProbe.files.at(-1)"), { menu: true, file: true, path: note, source: "more-options" });
  await rightClickFileMenu(tools, note);
  await press("Escape", "Escape", 27);
  assert.deepEqual(await evaluate("menuHostProbe.files.at(-1)"), { menu: true, file: true, path: note, source: "file-explorer" });
  await select();
  await rightClickEditorMenu(tools);
  await click(item("Plugin editor action"));
  await wait("Boolean(menuHostProbe.editorAction)", "real editor-menu plugin action");
  assert.deepEqual(await evaluate("menuHostProbe.editorAction"), { text: "Alpha", path: note, event: "click" });
  assert.deepEqual(await evaluate("menuHostProbe.editors.at(-1)"), { menu: true, view: true, editor: true, path: note });
  pass("An actual CommonJS plugin uses shared Menu/Item/Separator types, rich labels, checked/disabled rows, sections, viewport placement, pointer/keyboard actions and dismissal; real file/editor events carry the current TFile, MarkdownView and CodeMirror editor.");

  await evaluate(`app.plugins.plugins["${pluginId}"].replaceClipboard();true`);
  await select();
  await rightClickEditorMenu(tools);
  await click(item("Copy"));
  await wait('menuHostProbe.clipboardText==="Alpha"', "copy into the bounded clipboard fixture");
  assert.equal(await evaluate("app.editor.getValue()"), text);
  await rightClickEditorMenu(tools);
  await click(item("Cut"));
  const cut = text.replace("Alpha", "");
  await wait(`app.editor.getValue()===${JSON.stringify(cut)}`, "real editor cut");
  await evaluate('menuHostProbe.clipboardText="Line one\\nLine two";true');
  await rightClickEditorMenu(tools);
  await click(item("Paste"));
  await wait(`app.editor.getValue()===${JSON.stringify(cut.replace(" beta.", "Line one\r\nLine two beta."))}`, "paste normalizes LF into the actual CRLF editor");
  await press("z", "KeyZ", 90, 2);
  await wait(`app.editor.getValue()===${JSON.stringify(cut)}`, "paste remains undoable");
  await rightClickEditorMenu(tools);
  await click(item("Select all"));
  assert.equal(await evaluate("app.editor.getSelection()"), cut);
  await evaluate('menuHostProbe.clipboardText="";true');
  await rightClickEditorMenu(tools);
  await click(item("Paste"));
  await wait('!document.querySelector(".menu")', "empty paste completed");
  assert.equal(await evaluate("app.editor.getValue()"), cut, "An empty clipboard must not delete the selection");
  await evaluate('app.editor.setSelection({line:2,ch:1},{line:2,ch:5});menuHostProbe.pendingClipboard=true;true');
  await rightClickEditorMenu(tools);
  await click(item("Paste"));
  await wait('typeof menuHostProbe.resolveClipboard==="function"', "clipboard read is pending");
  await command("Input.insertText", { text: "Concurrent" });
  const concurrent = cut.replace("beta", "Concurrent");
  await expectErrors({ evaluate, report }, [{ source: "notification", message: "The editor or selection changed during clipboard access. No text was replaced." }], async () => { await evaluate('menuHostProbe.resolveClipboard("Must not replace concurrent text");delete menuHostProbe.resolveClipboard;true'); }, "Reject an obsolete clipboard result");
  await wait('document.querySelector("#client-errors").textContent.includes("changed during clipboard access")', "visible stale clipboard rejection");
  assert.equal(await evaluate("app.editor.getValue()"), concurrent);
  await evaluate(`app.editor.setValue(${JSON.stringify(text)});document.querySelector("#client-errors").replaceChildren();menuHostProbe.clipboardText="Keep bounded clipboard";true`);
  await select();
  await evaluate(`app.plugins.plugins["${pluginId}"].addSecondarySelection();true`);
  assert.equal(await evaluate("app.editor.cm.state.selection.ranges.length"), 2);
  await rightClickEditorMenu(tools);
  await expectErrors({ evaluate, report }, [{ source: "notification", message: "Clipboard actions with multiple selections are not supported. Select a single range first." }], async () => { await click(item("Cut"));
  await wait('document.querySelector("#client-errors").textContent.includes("multiple selections are not supported")', "visible unsupported multi-selection rejection"); }, "Reject unsupported clipboard multi-selection");
  assert.equal(await evaluate("app.editor.getValue()"), text);
  assert.equal(await evaluate("menuHostProbe.clipboardText"), "Keep bounded clipboard", "Unsupported multi-selection cut must not replace the clipboard or delete uncopied text");
  await select();
  await evaluate('document.querySelector("#client-errors").replaceChildren();menuHostProbe.pendingClipboard=true;true');
  await rightClickEditorMenu(tools);
  await click(item("Paste"));
  await wait('typeof menuHostProbe.resolveClipboard==="function"', "clipboard read before an additional selection");
  await expectErrors({ evaluate, report }, [{ source: "notification", message: "The editor or selection changed during clipboard access. No text was replaced." }], async () => { await evaluate(`app.plugins.plugins["${pluginId}"].addSecondarySelection();menuHostProbe.resolveClipboard("Must not replace either selection");delete menuHostProbe.resolveClipboard;true`); }, "Reject a paste after selection changes");
  await wait('document.querySelector("#client-errors").textContent.includes("changed during clipboard access")', "additional selection invalidates a pending paste");
  assert.equal(await evaluate("app.editor.getValue()"), text);
  await evaluate(`app.editor.setValue(${JSON.stringify(text)});document.querySelector("#client-errors").replaceChildren();menuHostProbe.denyClipboard=true;true`);
  await select();
  await rightClickEditorMenu(tools);
  await expectErrors({ evaluate, report }, [{ source: "notification", message: "Expected clipboard permission rejection" }], async () => { await click(item("Copy"));
  await wait('document.querySelector("#client-errors").textContent.includes("Expected clipboard permission rejection")', "visible clipboard permission failure"); }, "Check the owned clipboard permission-denial fixture");
  assert.equal(await evaluate("app.editor.getValue()"), text);
  await evaluate('menuHostProbe.denyClipboard=false;document.querySelector("#client-errors").replaceChildren();app.saveAll()');
  assert.deepEqual(await readFile(join(directory, note)), bytes);
  pass("Actual editor context actions retain copy/cut/select-all, undoable CRLF-aware paste, empty-paste preservation and visible permission/stale/multiple-selection errors using a bounded clipboard API fixture; the system clipboard is never read or changed.");

  await rightClickEditorMenu(tools);
  await evaluate('globalThis.retainedEditorMenu=document.querySelector(".menu [data-menu-title=\'Paste\']");app.workspace.activeLeaf.detach()');
  await wait('!document.querySelector(".menu")', "closing a MarkdownView dismisses its owned menu");
  await evaluate('retainedEditorMenu.click();delete globalThis.retainedEditorMenu;true');
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  await openMenu();
  const selected = await evaluate("menuHostProbe.selected.length");
  await evaluate('globalThis.retainedPluginMenu=document.querySelector(".menu [data-menu-title=\'Pointer action\']");true');
  await evaluate(`app.plugins.disable("${pluginId}")`);
  assert.equal(await evaluate(`!document.querySelector(".menu")&&!app.commands.listCommands().some(command=>command.id.startsWith("${pluginId}:"))&&menuHostProbe.cleaned===1&&menuHostProbe.clipboardRestored`), true);
  await evaluate("retainedPluginMenu.click();delete globalThis.retainedPluginMenu;true");
  assert.equal(await evaluate("menuHostProbe.selected.length"), selected);
  await toggle(true);
  await evaluate(`app.openFile(${JSON.stringify(note)},"tab")`);
  await click("#file-actions");
  await wait('Boolean(document.querySelector(".menu [data-menu-title=\'Plugin file action\']"))', "the reenabled plugin extends the actual file menu");
  assert.equal(await evaluate("menuHostProbe.files.length"), 1, "Re-enable must not duplicate the previous plugin listener");
  await press("Escape", "Escape", 27);
  await toggle(false);
  await assertCommunityPluginConfiguration(communityPath, originalCommunity, { [pluginId]: false });
  assert.deepEqual(await readFile(join(directory, note)), bytes);
  pass("Closing the actual source view or disabling the plugin removes owned menus and retained button listeners; re-enable has exactly one event subscriber, and only explicit plugin toggles change community enablement.");
  report.menuApi = { fixture: pluginId, sha256: createHash("sha256").update(pluginSource).digest("hex"), thirdPartyPlugin: false, clipboard: "bounded API fixture only; OS clipboard and permission prompts not accessed", nativeElectronMenus: "explicitly unsupported", originalRuntimeEquivalence: "not established" };
}
