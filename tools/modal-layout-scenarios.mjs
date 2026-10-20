import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertCommunityPluginConfiguration, setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";

const pluginId = "modal-layout-probe";
const pluginSource = "(" + function fixture() {
  const { Plugin, Modal, ConfirmationModal, Menu, AbstractInputSuggest } = require("obsidian");
  class Suggestions extends AbstractInputSuggest {
    getSuggestions(query) { return query ? ["Alpha", "Alpine"] : []; }
    renderSuggestion(value, element) { element.textContent = value; }
  }
  module.exports = class extends Plugin {
    onload() {
      const state = this.state = globalThis.modalLayoutProbe = { forms: [], accepted: [], chosen: 0, cleaned: 0 };
      const make = mode => {
        const modal = mode === "confirmation" ? new ConfirmationModal(this.app) : new Modal(this.app);
        modal.containerEl.dataset.layoutProbe = mode; state.forms.push(modal);
        modal.setTitle(mode === "long" ? "Long dialog · 中文 · " + "UnbrokenTitle".repeat(10) : "Responsive " + mode + " dialog");
        const control = (tag, id, parent = modal.contentEl) => {
          const el = document.createElement(tag); el.dataset.layoutId = id; el.setAttribute("aria-label", id);
          if (tag === "button") { el.type = "button"; el.textContent = id; }
          parent.append(el); return el;
        };
        if (mode === "wide") {
          const pre = control("pre", "wide-code"); pre.textContent = "Exact whitespace  \t中文 " + "0123456789".repeat(80);
          const table = control("table", "wide-table"); table.style.width = "1200px";
          const row = table.insertRow(); row.insertCell().textContent = "Left edge";
          const last = row.insertCell(); last.style.width = "180px"; const edge = control("button", "wide-edge", last);
          edge.addEventListener("click", () => state.chosen++);
          control("button", "wide-end"); return modal;
        }
        const label = control("label", "draft-label"); label.textContent = "Draft text";
        const input = control("input", "draft", label); input.style.width = "100%"; input.value = "Initial draft";
        state.input = input;
        if (mode !== "child") {
          modal.contentEl.style.display = "flex"; modal.contentEl.style.flexDirection = "column"; modal.contentEl.style.gap = "12px";
          for (let index = 0; index < 10; index++) {
            const row = control("label", "row-" + index); row.textContent = "Setting " + index;
            const field = control("input", "field-" + index, row); field.value = "Retained value " + index; field.style.width = "100%";
          }
          const textarea = control("textarea", "body"); textarea.value = "Retained multiline\r\n中文"; textarea.style.cssText = "width:100%;min-height:120px";
          const nested = control("button", "nested");
          nested.addEventListener("click", () => { state.child = make("child"); state.child.open(); });
          const menu = control("button", "menu");
          menu.addEventListener("click", () => {
            const rect = menu.getBoundingClientRect(); state.menu = new Menu().addItem(item => item.setTitle("Select owned layout action").onClick(() => state.chosen++));
            state.menu.showAtPosition({ x: rect.left, y: rect.bottom });
          });
          const suggest = control("input", "suggest"); state.suggest = new Suggestions(this.app, suggest);
        }
        if (mode === "confirmation") {
          modal.addButton(button => button.setButtonText("Accept draft").onClick(() => { state.accepted.push(input.value); }));
          modal.buttonContainerEl.querySelector("button").dataset.layoutId = "accept";
          modal.addCancelButton();
        } else {
          const action = control("button", "accept"); action.textContent = "Accept draft";
          action.addEventListener("click", () => { state.accepted.push(input.value); modal.close(); });
        }
        modal.onClose = () => state.suggest?.close();
        return modal;
      };
      state.open = mode => { state.current = make(mode); state.current.open(); };
      const opener = document.createElement("button"); opener.dataset.layoutProbeOpener = "";
      opener.textContent = "Open responsive dialog"; opener.style.cssText = "position:fixed;top:10px;left:10px;z-index:80";
      opener.addEventListener("click", () => state.open("long")); document.body.append(opener); state.opener = opener;
      this.register(() => {
        state.menu?.hide(); state.suggest?.close();
        for (const modal of state.forms.toReversed()) { modal.close(); }
        opener.remove(); state.cleaned++;
      });
    }
  };
}.toString() + ")();";

export async function checkModalLayout({ directory, evaluate, command, click, press, wait, restart, afterReload, report, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const communityPath = join(directory, ".obsidian", "community-plugins.json");
  let originalCommunity = null;
  try { originalCommunity = await readFile(communityPath); } catch (error) { if (error.code !== "ENOENT") { throw error; } }
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const note = "Modal viewport preservation.md", original = Buffer.from("\ufeff# Viewport 中文\r\n\r\nKeep every original byte.\r\n");
  await writeFile(join(directory, note), original);
  const folder = join(directory, ".obsidian", "plugins", pluginId); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "manifest.json"), JSON.stringify({ id: pluginId, name: "Modal viewport probe", version: "1.0.0", description: "Shared Modal viewport and draft fixture", isDesktopOnly: false }));
  await writeFile(join(folder, "main.js"), pluginSource);
  async function reload() { if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload(); }
  await reload();
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true); await click(".settings-close");
  const originalViewport = await evaluate("({width:innerWidth,height:innerHeight})");
  const viewports = [];
  async function viewport(width, height) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await wait("innerWidth===" + width + "&&innerHeight===" + height, "actual CSS viewport");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    viewports.push({ width, height });
  }
  async function bounds(mode) {
    const result = await evaluate("(()=>{const m=document.querySelector('[data-layout-probe=\"" + mode + "\"] .modal'),r=m.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollWidth:m.scrollWidth,clientWidth:m.clientWidth,scrollHeight:m.scrollHeight,clientHeight:m.clientHeight}})()");
    assert.ok(result.left >= -1 && result.top >= -1 && result.right <= result.viewportWidth + 1 && result.bottom <= result.viewportHeight + 1, "Dialog must stay within the CSS viewport: " + JSON.stringify(result));
    return result;
  }
  async function visible(selector) {
    assert.equal(await evaluate("(()=>{const e=document.querySelector(" + JSON.stringify(selector) + "),r=e.getBoundingClientRect(),m=e.closest('.modal'),b=m.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return r.top>=b.top&&r.bottom<=b.bottom&&r.left>=b.left&&r.right<=b.right&&y>=0&&y<=innerHeight&&x>=0&&x<=innerWidth&&(hit===e||e.contains(hit))})()"), true, "Reachable control: " + selector);
  }
  const target = (mode, id) => '[data-layout-probe="' + mode + '"] [data-layout-id="' + id + '"]';
  try {
    await click("[data-layout-probe-opener]");
    await viewport(320, 568);
    await capture?.("narrow");
    const narrow = await bounds("long"); assert.ok(narrow.scrollHeight > narrow.clientHeight, "Long form should scroll inside its dialog.");
    const title = await evaluate("(()=>{const m=modalLayoutProbe.current,t=m.titleEl.getBoundingClientRect(),r=m.modalEl.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(m.titleEl);return {titleWidth:t.width,dialogWidth:r.width,text:m.titleEl.textContent,wrapped:[...range.getClientRects()].every(part=>part.left>=r.left-1&&part.right<=r.right+1)}})()");
    assert.ok(title.titleWidth < title.dialogWidth); assert.equal(title.wrapped, true, "Actual title text must wrap inside its dialog.");
    assert.equal(title.text, "Long dialog · 中文 · " + "UnbrokenTitle".repeat(10));
    await evaluate('(()=>{const m=modalLayoutProbe.current;m.titleEl.dir="rtl";m.setTitle("כותרת ארוכה בעברית " + "UnbrokenTitle".repeat(10));m.titleEl.getBoundingClientRect();m.modalEl.scrollTop=0;return true})()');
    await capture?.("rtl");
    assert.equal(await evaluate('(()=>{const m=modalLayoutProbe.current,c=m.modalEl.querySelector(".modal-close-button").getBoundingClientRect(),b=m.modalEl.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(m.titleEl);return [...range.getClientRects()].every(r=>r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom&&(r.right<=c.left||r.left>=c.right||r.bottom<=c.top||r.top>=c.bottom))})()'), true, "RTL title text must remain visible and leave the fixed close control clear.");
    await evaluate('(()=>{const m=modalLayoutProbe.current;m.titleEl.dir="";m.setTitle("Long dialog · 中文 · " + "UnbrokenTitle".repeat(10));m.titleEl.getBoundingClientRect();m.modalEl.scrollTop=0;return true})()');
    await press("Tab", "Tab", 9); await visible('[data-layout-probe="long"] .modal-close-button');
    await press("Tab", "Tab", 9);
    assert.equal(await evaluate("document.activeElement.dataset.layoutId"), "draft");
    await visible(target("long", "draft"));
    await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: "Unsaved draft · 中文 🚀" });
    pass("narrow 320px viewport contains long LTR/RTL titles clear of the close control, with keyboard access to the editable draft");

    for (const [width, height] of [[640, 240], [320, 240], [1280, 800], [320, 568]]) {
      await viewport(width, height); await bounds("long");
      assert.equal(await evaluate("modalLayoutProbe.current.contentEl.querySelector('[data-layout-id=\"draft\"]').value"), "Unsaved draft · 中文 🚀");
      assert.equal(await evaluate("modalLayoutProbe.current.contentEl.querySelector('[data-layout-id=\"field-9\"]').value"), "Retained value 9");
    }
    await click(target("long", "accept"));
    assert.deepEqual(await evaluate("modalLayoutProbe.accepted"), ["Unsaved draft · 中文 🚀"]);
    pass("live narrow/short/large viewport changes preserve unsaved draft and form values and leave the final action reachable");

    await viewport(640, 240); await evaluate('modalLayoutProbe.open("confirmation")'); await bounds("confirmation");
    await click(target("confirmation", "draft")); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: "Confirmed short-window draft" });
    await capture?.("short-confirmation");
    await click(target("confirmation", "accept"));
    await wait("!modalLayoutProbe.current.isOpen", "actual ConfirmationModal action completes");
    assert.deepEqual(await evaluate("modalLayoutProbe.accepted"), ["Unsaved draft · 中文 🚀", "Confirmed short-window draft"]);
    pass("short-window ConfirmationModal retains its separately appended action footer and accepts the current draft");

    await viewport(320, 568); await evaluate('modalLayoutProbe.open("wide")');
    const wide = await bounds("wide"); assert.ok(wide.scrollWidth > wide.clientWidth, "Oversized code/table should remain horizontally scrollable.");
    assert.equal(await evaluate("modalLayoutProbe.current.contentEl.querySelector('pre').textContent"), "Exact whitespace  \t中文 " + "0123456789".repeat(80));
    await click(target("wide", "wide-edge")); await visible(target("wide", "wide-edge"));
    assert.equal(await evaluate("modalLayoutProbe.chosen"), 1);
    await press("Tab", "Tab", 9); await press("Tab", "Tab", 9);
    assert.equal(await evaluate("document.activeElement.classList.contains('modal-close-button')"), true);
    await visible('[data-layout-probe="wide"] .modal-close-button');
    await capture?.("wide"); await press("Escape", "Escape", 27);
    pass("oversized code/table content scrolls within the dialog without altering literal text, hiding actions or losing the close control");

    await evaluate('modalLayoutProbe.open("long")'); await click(target("long", "draft"));
    await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: "Parent draft retained" });
    await click(target("long", "nested")); await bounds("child"); await capture?.("nested");
    await press("Escape", "Escape", 27);
    assert.equal(await evaluate("document.activeElement.dataset.layoutId"), "nested");
    await visible(target("long", "nested"));
    assert.equal(await evaluate("modalLayoutProbe.current.contentEl.querySelector('[data-layout-id=\"draft\"]').value"), "Parent draft retained");
    pass("a nested dialog stays within the narrow viewport and returns focus to a reachable parent control without losing the parent draft");

    await click(target("long", "menu")); await wait('Boolean(document.querySelector(".menu[role=menu]"))', "owned menu open");
    await press("Enter", "Enter", 13); assert.equal(await evaluate("modalLayoutProbe.chosen"), 2);
    await click(target("long", "suggest")); await command("Input.insertText", { text: "Al" });
    await wait('Boolean(document.querySelector(".suggestion-popover:popover-open"))', "owned suggestion popup");
    await press("Escape", "Escape", 27); assert.equal(await evaluate("modalLayoutProbe.current.isOpen"), true);
    await wait('!document.querySelector(".suggestion-popover:popover-open")', "only popup dismissed");
    await capture?.("scrolled"); await press("Escape", "Escape", 27);
    await wait("!modalLayoutProbe.current.isOpen", "last layout dialog closed");
    pass("owned menus and top-layer input suggestions retain actual keyboard interaction after scrolling in a narrow dialog");
  } finally {
    await command("Emulation.clearDeviceMetricsOverride");
    await wait("innerWidth===" + originalViewport.width + "&&innerHeight===" + originalViewport.height, "original CSS viewport restored");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  }
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, false); await click(".settings-close");
  assert.equal(await evaluate("modalLayoutProbe.cleaned"), 1);
  assert.equal(await evaluate('document.querySelectorAll("[data-layout-probe],[data-layout-probe-opener]").length'), 0);
  await assertCommunityPluginConfiguration(communityPath, originalCommunity, { [pluginId]: false });
  assert.deepEqual(await readFile(join(directory, note)), original);
  await reload();
  assert.equal(await evaluate('document.querySelectorAll("[data-layout-probe],[data-layout-probe-opener]").length'), 0);
  assert.deepEqual(await readFile(join(directory, note)), original);
  await assertCommunityPluginConfiguration(communityPath, originalCommunity, { [pluginId]: false });
  report.modalLayout = { pluginId, viewports, originalViewport, restoredViewport: true, actualInput: true, directionalTitles: true, deviceMetrics: "CDP CSS viewport emulation; not OS-window/physical-device or browser-zoom acceptance", lifecycle: restart ? "full-desktop-restart" : "WASM-renderer-reload-and-real-folder-reconnect", noteSha256: createHash("sha256").update(original).digest("hex"), retainedNoteBytes: true, onlyFixturePluginToggled: true };
  pass("plugin cleanup and host restart/reconnect discard temporary dialogs and retain exact note bytes and unrelated plugin configuration");
}
