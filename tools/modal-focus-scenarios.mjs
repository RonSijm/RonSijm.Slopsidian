import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertCommunityPluginConfiguration, setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";

const pluginId = "modal-focus-probe";
const pluginSource = "(" + function fixture() {
  const { Plugin, Modal, Menu, AbstractInputSuggest } = require("obsidian");
  class Suggestions extends AbstractInputSuggest {
    getSuggestions(query) { return query ? ["Alpha", "Alpine"] : []; }
    renderSuggestion(item, el) { el.textContent = item; }
  }
  module.exports = class extends Plugin {
    onload() {
      const state = this.state = globalThis.modalFocusProbe = { closed: 0, scope: 0, selected: 0, cleaned: 0, forms: [] };
      const make = mode => {
        const modal = new Modal(this.app);
        state.forms.push(modal);
        modal.containerEl.dataset.modalProbe = mode;
        modal.setTitle(mode === "child" ? "" : "Keyboard focus · 中文");
        const control = (tag, id, parent = modal.contentEl) => {
          const el = document.createElement(tag); el.dataset.focusId = id; el.setAttribute("aria-label", id);
          if (tag === "button") { el.type = "button"; el.textContent = id; }
          parent.append(el); return el;
        };
        const first = control("input", "first");
        if (mode !== "child") {
          const two = control("button", "positive-two"); two.tabIndex = 2;
          const one = control("button", "positive-one"); one.tabIndex = 1;
          const disabled = control("button", "disabled"); disabled.disabled = true;
          const hidden = control("button", "hidden"); hidden.hidden = true;
          const invisible = control("button", "invisible"); invisible.style.visibility = "hidden";
          const inert = control("div", "inert-parent"); inert.inert = true; control("button", "inert", inert);
          const fieldset = control("fieldset", "disabled-fieldset"); fieldset.disabled = true; control("input", "fieldset", fieldset);
          const readonly = control("input", "readonly"); readonly.readOnly = true; readonly.value = "Retained readonly text";
          const a = control("input", "radio-a"), b = control("input", "radio-b");
          a.type = b.type = "radio"; a.name = b.name = "choice"; b.checked = true;
          const editable = control("div", "editable"); editable.contentEditable = "true"; editable.setAttribute("role", "textbox"); editable.textContent = "Editable content";
          const editor = control("textarea", "editor"); editor.value = "Retained editor text";
          editor.addEventListener("keydown", event => { if (event.key === "Tab" && !event.shiftKey) { event.preventDefault(); editor.value += "\t"; } });
          const nested = control("button", "nested");
          nested.addEventListener("click", () => { state.child = make("child"); state.child.open(); });
          const menu = control("button", "menu");
          menu.addEventListener("click", () => {
            state.menu = new Menu().addItem(item => item.setTitle("Choose probe action").onClick(() => state.selected++));
            state.menu.showAtPosition({ x: 160, y: 150 });
          });
          const suggest = control("input", "suggest");
          state.suggestions = new Suggestions(this.app, suggest);
          const scoped = control("button", "scoped");
          modal.scope.register([], "Tab", () => { if (document.activeElement === scoped) { state.scope++; return false; } });
        }
        const last = control("button", "last"); last.textContent = "Last control";
        modal.onClose = () => { state.closed++; state.suggestions?.close(); };
        if (mode === "child") { modal.onOpen = () => { modal.titleEl.textContent = "Nested focus dialog"; first.focus(); }; }
        state.current = modal; return modal;
      };
      state.open = mode => { state.parent = make(mode || "parent"); state.parent.open(); };
      state.makeEmpty = () => {
        const modal = new Modal(this.app); modal.setTitle("No available controls"); modal.containerEl.dataset.modalProbe = "empty";
        state.forms.push(modal); modal.modalEl.querySelector("button").disabled = true; state.empty = modal; modal.open();
      };
      state.makeScroll = () => {
        const modal = new Modal(this.app); modal.setTitle("Keyboard scrolling"); modal.containerEl.dataset.modalProbe = "scroll";
        modal.contentEl.style.cssText = "height:160px;overflow:auto";
        const first = document.createElement("button"); first.dataset.focusId = "scroll-first"; first.textContent = "First scrolling control";
        const space = document.createElement("div"); space.style.height = "450px";
        const last = document.createElement("button"); last.dataset.focusId = "scroll-last"; last.textContent = "Last scrolling control";
        modal.contentEl.append(first, space, last); state.forms.push(modal); state.scroll = modal; modal.open(); first.focus();
      };
      state.failOpen = () => {
        class Broken extends Modal {
          close() {}
          onOpen() { throw new Error("Expected opening failure"); }
        }
        const modal = new Broken(this.app); state.broken = modal;
        try { modal.open(); } catch (error) { state.openError = error.message; }
      };
      state.failClose = () => {
        const modal = new Modal(this.app); state.forms.push(modal); state.brokenClose = modal;
        modal.onClose = () => { throw new Error("Expected closing failure"); }; modal.open();
        try { modal.close(); } catch (error) { state.closeError = error.message; }
      };
      const opener = state.opener = document.createElement("button"); opener.dataset.modalProbeOpener = "";
      opener.textContent = "Open keyboard focus probe"; opener.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:1000";
      opener.addEventListener("click", () => state.open()); document.body.append(opener);
      this.register(() => {
        state.menu?.hide(); state.suggestions?.close();
        for (const modal of state.forms.toReversed()) { if (modal.isOpen) { modal.close(); } }
        opener.remove(); state.cleaned++;
      });
    }
  };
}.toString() + ")();";

export async function checkModalFocus({ directory, evaluate, command, click, press, wait, restart, afterReload, report, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const selector = id => '[data-modal-probe="parent"] [data-focus-id="' + id + '"]';
  const active = () => evaluate('document.activeElement?.dataset.focusId ?? document.activeElement?.className');
  async function dialogName(selector) {
    const { root } = await command("DOM.getDocument");
    const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { nodes } = await command("Accessibility.getPartialAXTree", { nodeId });
    return nodes.find(node => node.role?.value === "dialog")?.name?.value;
  }
  async function tab(expected, backwards = false) {
    await press("Tab", "Tab", 9, backwards ? 8 : 0);
    assert.equal(await active(), expected, "Actual " + (backwards ? "Shift+Tab" : "Tab") + " focus");
  }
  const communityPath = join(directory, ".obsidian", "community-plugins.json");
  let originalCommunity = null;
  try { originalCommunity = await readFile(communityPath); } catch (error) { if (error.code !== "ENOENT") { throw error; } }
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const note = "Modal keyboard preservation.md", original = Buffer.from("\ufeff# Retained 中文\r\n\r\nModal focus must preserve these bytes.\r\n");
  await writeFile(join(directory, note), original);
  const folder = join(directory, ".obsidian", "plugins", pluginId); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "manifest.json"), JSON.stringify({ id: pluginId, name: "Modal keyboard probe", version: "1.0.0", description: "Real shared Modal keyboard consumer", isDesktopOnly: false }));
  await writeFile(join(folder, "main.js"), pluginSource);
  async function reload() { if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload(); }
  await reload();
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true); await click(".settings-close");
  await wait("Boolean(globalThis.modalFocusProbe)", "real modal fixture plugin enabled");
  await click("[data-modal-probe-opener]");
  assert.equal(await evaluate("modalFocusProbe.parent.isOpen"), true);
  const parentDialog = '[data-modal-probe="parent"] .modal';
  assert.equal(await dialogName(parentDialog), "Keyboard focus · 中文", "Computed accessible dialog name");
  await evaluate('modalFocusProbe.parent.setTitle("Changed dialog title");true'); assert.equal(await dialogName(parentDialog), "Changed dialog title");
  await evaluate('modalFocusProbe.parent.setTitle("");modalFocusProbe.parent.modalEl.setAttribute("aria-label","Custom fallback")');
  assert.equal(await dialogName(parentDialog), "Custom fallback");
  await evaluate('modalFocusProbe.parent.setTitle("Keyboard focus · 中文");true');
  pass("real plugin Modal exposes its visible title, live title changes and an untitled custom fallback as computed accessible names");
  await tab("positive-one"); await tab("positive-two"); await tab("modal-close-button");
  await tab("first"); await tab("readonly"); await tab("radio-b"); await tab("editable"); await tab("editor");
  pass("actual Tab respects positive indexes, readonly/editable controls and checked radio groups while skipping hidden/inert/disabled controls");
  await tab("editor"); assert.equal(await evaluate("modalFocusProbe.parent.contentEl.querySelector('textarea').value"), "Retained editor text\t");
  await tab("editable", true); await tab("radio-b", true); await tab("readonly", true);
  pass("textarea consumes Tab for its own editing and native reverse navigation remains available");
  await click(selector("last")); await tab("positive-one"); await tab("last", true);
  await evaluate("document.querySelector('[data-modal-probe-opener]').focus()");
  assert.equal(await active(), "last", "Escaped background focus returns to the current backward edge.");
  await tab("positive-one");
  await evaluate("document.querySelector('[data-modal-probe-opener]').focus()");
  assert.equal(await active(), "positive-one");
  pass("Tab and Shift+Tab wrap at the current dialog edges and escaped background focus returns to the dialog");
  await click(selector("last")); await evaluate('modalFocusProbe.parent.contentEl.querySelector(\'[data-focus-id="last"]\').disabled=true');
  await tab("positive-one");
  await evaluate('modalFocusProbe.parent.contentEl.querySelector(\'[data-focus-id="scoped"]\').remove()');
  await click(selector("suggest")); await tab("positive-one");
  pass("disabling or removing the final controls updates the active focus boundary immediately");
  await click(selector("nested")); await wait("modalFocusProbe.child?.isOpen", "nested dialog open");
  assert.equal(await dialogName('[data-modal-probe="child"] .modal'), "Nested focus dialog", "Title written directly during onOpen is associated.");
  assert.equal(await active(), "first"); await tab("last"); await tab("modal-close-button");
  await tab("last", true); await press("Escape", "Escape", 27);
  assert.equal(await active(), "nested"); assert.equal(await evaluate("modalFocusProbe.parent.isOpen"), true);
  pass("only the top nested Modal traps keys and closing it restores the invoking parent control");
  await capture?.("nested-return");
  await click(selector("menu")); await wait('Boolean(document.querySelector(".menu[role=menu]"))', "owned menu open");
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate("modalFocusProbe.parent.isOpen"), true);
  assert.equal(await evaluate('Boolean(document.querySelector(".menu[role=menu]"))'), false); assert.equal(await active(), "menu");
  await click(selector("menu")); await press("Enter", "Enter", 13);
  assert.equal(await evaluate("modalFocusProbe.selected"), 1); assert.equal(await active(), "menu");
  pass("owned Menu handles Escape and Enter before the containing dialog and restores its trigger");
  await click(selector("suggest")); await command("Input.insertText", { text: "Al" });
  await wait('Boolean(document.querySelector(".suggestion-popover:popover-open"))', "owned suggestion popup open");
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate("modalFocusProbe.parent.isOpen"), true);
  await wait('!document.querySelector(".suggestion-popover:popover-open")', "suggestion Escape owns only popup");
  await command("Input.insertText", { text: "p" }); await wait('Boolean(document.querySelector(".suggestion-popover:popover-open"))', "suggestions reopened");
  await press("Tab", "Tab", 9); assert.equal(await active(), "suggest"); await wait('!document.querySelector(".suggestion-popover:popover-open")', "suggestion consumes Tab selection");
  pass("input suggestions retain Escape and Tab selection without closing or escaping the containing Modal");
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate("document.activeElement===modalFocusProbe.opener"), true);
  await click("[data-modal-probe-opener]"); await click(selector("scoped")); await tab("scoped");
  assert.equal(await evaluate("modalFocusProbe.scope"), 1);
  await evaluate('document.querySelector(\'[data-focus-id="scoped"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,isComposing:true}))');
  assert.equal(await evaluate("modalFocusProbe.scope"), 1);
  await evaluate('document.querySelector(\'[data-focus-id="scoped"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,ctrlKey:true}))');
  assert.equal(await evaluate("modalFocusProbe.parent.isOpen&&modalFocusProbe.parent.modalEl.contains(document.activeElement)"), true);
  await click(selector("scoped"));
  await evaluate('document.querySelector(\'[data-focus-id="scoped"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,altKey:true}))');
  assert.equal(await active(), "scoped"); await press("Escape", "Escape", 27);
  pass("plugin Scope consumes Tab, composing events stay with the widget and modified Tab preserves app shortcut handling with dialog containment");
  await click("[data-modal-probe-opener]"); await click(selector("nested"));
  await evaluate("modalFocusProbe.parent.close()");
  assert.equal(await evaluate("modalFocusProbe.child.isOpen&&modalFocusProbe.child.modalEl.contains(document.activeElement)"), true);
  await press("Escape", "Escape", 27);
  assert.equal(await evaluate('document.querySelectorAll("[data-modal-probe]").length'), 0);
  pass("closing a lower dialog preserves the active child and a removed return control never steals focus");
  await evaluate("modalFocusProbe.opener.focus();modalFocusProbe.makeEmpty()");
  await tab("modal"); await tab("modal", true);
  await evaluate("modalFocusProbe.opener.focus()"); assert.equal(await active(), "modal");
  await capture?.("empty"); await press("Escape", "Escape", 27);
  assert.equal(await evaluate("document.activeElement===modalFocusProbe.opener"), true);
  pass("dialogs without available controls retain focus on the named dialog in both directions and restore the opener");
  await evaluate("modalFocusProbe.makeScroll()"); await tab("scroll-last");
  assert.equal(await evaluate("(()=>{const p=modalFocusProbe.scroll.contentEl,a=document.activeElement.getBoundingClientRect(),b=p.getBoundingClientRect();return p.scrollTop>0&&a.top>=b.top&&a.bottom<=b.bottom})()"), true);
  await tab("scroll-first", true);
  assert.equal(await evaluate("modalFocusProbe.scroll.contentEl.scrollTop"), 0);
  await capture?.("scroll"); await press("Escape", "Escape", 27);
  pass("Tab reveals offscreen dialog controls by scrolling their own container and reverse traversal returns to its top");
  await evaluate("modalFocusProbe.opener.focus();modalFocusProbe.failOpen()");
  assert.deepEqual(await evaluate("[modalFocusProbe.openError,modalFocusProbe.broken.isOpen,modalFocusProbe.broken.containerEl.isConnected,document.activeElement===modalFocusProbe.opener]"),
    ["Expected opening failure", false, false, true]);
  await evaluate("modalFocusProbe.failClose()");
  assert.deepEqual(await evaluate("[modalFocusProbe.closeError,modalFocusProbe.brokenClose.isOpen,document.activeElement===modalFocusProbe.opener]"),
    ["Expected closing failure", false, true]);
  pass("opening/closing failures remove the dialog and listeners and restore focus even when a subclass declines close");
  await click("[data-modal-probe-opener]");
  await evaluate("modalFocusProbe.opener.disabled=true"); await press("Escape", "Escape", 27);
  assert.equal(await evaluate("document.activeElement===modalFocusProbe.opener"), false);
  await evaluate("modalFocusProbe.opener.disabled=false");
  for (let index = 0; index < 3; index++) {
    await evaluate("modalFocusProbe.parent.open()"); await tab("positive-one"); await press("Escape", "Escape", 27);
  }
  await evaluate("modalFocusProbe.opener.focus()");
  assert.equal(await evaluate("document.activeElement===modalFocusProbe.opener"), true);
  pass("disabled return controls are skipped and repeated open/close leaves no active focus guard");
  await click("[data-modal-probe-opener]"); await capture?.("controls");
  await press("Escape", "Escape", 27);
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, false); await click(".settings-close");
  assert.equal(await evaluate("modalFocusProbe.cleaned"), 1);
  assert.equal(await evaluate('document.querySelectorAll("[data-modal-probe],[data-modal-probe-opener]").length'), 0);
  await assertCommunityPluginConfiguration(communityPath, originalCommunity, { [pluginId]: false });
  assert.deepEqual(await readFile(join(directory, note)), original);
  await reload();
  assert.equal(await evaluate('document.querySelectorAll("[data-modal-probe],[data-modal-probe-opener]").length'), 0);
  assert.deepEqual(await readFile(join(directory, note)), original);
  await assertCommunityPluginConfiguration(communityPath, originalCommunity, { [pluginId]: false });
  report.modalFocus = { pluginId, noteSha256: createHash("sha256").update(original).digest("hex"), lifecycle: restart ? "full-desktop-restart" : "WASM-renderer-reload-and-real-folder-reconnect", actualKeyboard: true, computedAccessibleName: true, retainedNoteBytes: true, onlyFixturePluginToggled: true, transientDialogsRestored: false };
  pass("plugin disable and full host restart/reconnect remove transient focus state while preserving note bytes and unrelated plugin configuration");
}
