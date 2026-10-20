import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setCommunityPluginEnabled, assertCommunityPluginConfiguration } from "./community-plugin-test-helpers.mjs";

const pluginId = "workspace-tab-probe", type = "workspace-tab-probe-view", mime = "application/x-slopsidian-workspace-tab";
const source = String.raw`
const {Plugin,ItemView}=require("obsidian");
module.exports=class extends Plugin {
  onload(){
    const counts=globalThis.tabMoveCounts={opened:0,closed:0,cleaned:0,events:0,ticks:0,frames:0};
    this.registerView("workspace-tab-probe-view",leaf=>new class extends ItemView {
      getViewType(){return "workspace-tab-probe-view"} getDisplayText(){return "Tab movement probe"}
      onOpen(){counts.opened++;this.input=this.contentEl.createEl("input",{attr:{"aria-label":"Plugin tab state"}});
        this.frame=this.contentEl.createEl("iframe",{attr:{title:"Preserved plugin frame"}});
        this.frame.style.height="70px";this.frame.addEventListener("load",()=>{counts.frames++;if(counts.frames===1){this.frame.contentWindow.tabMoveMarker={preserved:true};this.frame.contentDocument.body.textContent="Plugin frame state"}});
        this.frame.src="about:blank";
        this.registerDomEvent(window,"tab-move-probe",()=>counts.events++);this.registerInterval(setInterval(()=>counts.ticks++,20));this.register(()=>counts.cleaned++);
      }
      async setState(state,result){await super.setState(state,result);this.input.value=typeof state.value==="string"?state.value:""}
      getState(){return {...super.getState(),value:this.input?.value??""}}
      onClose(){counts.closed++}
    }(leaf));
  }
};`;

export async function checkTabMovement({ directory, evaluate, command, click, press, wait, afterReload, restart, report, capture }) {
  const folder = "Tab movement", names = ["Alpha", "Beta", "Gamma", "Delta"], originals = new Map();
  const alpha = folder + "/Alpha.md", beta = folder + "/Beta.md";
  const automatic = await readFile(join(directory, ".obsidian/workspace.json")).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  const communityPath = join(directory, ".obsidian/community-plugins.json"), originalCommunity = await readFile(communityPath).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const header = id => `[data-tab-id="${id}"]`;
  const order = async () => evaluate('(()=>{const ids=[];app.workspace.iterateRootLeaves(leaf=>ids.push(leaf.id));return ids})()');
  async function settled() { await evaluate("app.workspace.whenIdle()"); await wait('!app.workspace.isChangingLayout&&!app.workspace.isChangingFiles', "workspace movement settled"); }
  async function point(selector, edge = "middle") {
    return evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:"nearest",inline:"nearest"});const b=el.getBoundingClientRect();return{x:${edge === "before" ? "b.left+3" : edge === "after" ? "b.right-3" : "b.left+Math.min(35,b.width/2)"},y:b.top+b.height/2}})()`);
  }
  async function beginDrag(id) {
    assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).tabHeaderEl.draggable`), true, "Restored live main tabs must be draggable");
    await command("Input.setInterceptDrags", { enabled: true });
    await evaluate('globalThis.tabMovementDrag=null');
    const p = await point(header(id));
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + 18, y: p.y + 2, button: "left", buttons: 1 });
    await wait('Boolean(tabMovementDrag?.items.some(item=>item.mimeType===' + JSON.stringify(mime) + '))', "trusted tab dragstart payload");
    const data = await evaluate('tabMovementDrag'); assert.equal(data.trusted, true, "A native pointer gesture must start the drag");
    return { items: data.items, dragOperationsMask: 16 };
  }
  async function endDrag(data, p, drop = true) {
    try {
      for (const type of ["dragEnter", "dragOver", ...(drop ? ["drop"] : [])]) await command("Input.dispatchDragEvent", { type, ...p, data });
    } finally {
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
      await command("Input.setInterceptDrags", { enabled: false });
    }
    await settled();
  }
  async function drag(id, target, edge = "before") { const data = await beginDrag(id); await endDrag(data, await point(target, edge)); }
  async function menu(id, action) {
    const p = await point(header(id));
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "right", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "right", clickCount: 1 });
    await click(`[data-tab-move="${action}"]`); await settled();
  }
  async function unchangedFiles() { for (const [path, bytes] of originals) assert.deepEqual(await readFile(join(directory, path)), bytes, path + " must not be saved implicitly by tab movement"); }
  async function retained() {
    assert.deepEqual(await evaluate(`(()=>{const s=tabMovementState,a=app.workspace.getLeafById("tab-alpha"),b=app.workspace.getLeafById("tab-beta"),p=app.workspace.getLeafById("tab-probe");return{
      alpha:a===s.alpha&&a.view===s.view&&a.session===s.session&&a.view.editor===s.editor,
      beta:b===s.beta&&b.session===s.betaSession&&b.session.dirty,
      shared:app.workspace.getLeafById("tab-reading").session===s.session&&s.session.leaves.size===2,
      selection:JSON.stringify([a.view.editor.getCursor("from"),a.view.editor.getCursor("to")])===JSON.stringify(s.selection),
      history:a.history===s.history&&a.historyIndex===s.historyIndex,pinned:a.pinned,
      plugin:p===s.probe&&p.view===s.probeView&&p.view.frame.contentWindow.tabMoveMarker===s.frameMarker,
      ownership:tabMoveCounts.opened===1&&tabMoveCounts.closed===0&&tabMoveCounts.cleaned===0&&tabMoveCounts.frames===1
    }})()`), { alpha: true, beta: true, shared: true, selection: true, history: true, pinned: true, plugin: true, ownership: true });
    await unchangedFiles();
  }

  await evaluate("app.workspace.saveAll()"); await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder), { recursive: true });
  for (const name of names) {
    const path = folder + "/" + name + ".md", text = "# " + name + "\r\n\r\n" + Array.from({ length: 90 }, (_, n) => "Line " + n + ": kept λ and 中文.").join("\r\n") + "\r\n";
    const bytes = Buffer.from("\ufeff" + text); originals.set(path, bytes); await writeFile(join(directory, path), bytes);
  }
  const plugin = join(directory, ".obsidian/plugins", pluginId); await mkdir(plugin, { recursive: true });
  await writeFile(join(plugin, "manifest.json"), JSON.stringify({ id: pluginId, name: "Workspace tab movement probe", description: "Independent tab and view preservation fixture", author: "Independent test fixture", version: "1.0.0", minAppVersion: "1.0.0", isDesktopOnly: false }));
  await writeFile(join(plugin, "main.js"), source);
  await command("Page.reload"); await afterReload();
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true); await click(".settings-close");
  const leaf = (id, name, mode = "source") => ({ id, type: "leaf", state: { type: "markdown", pinned: id === "tab-alpha", state: { file: folder + "/" + name + ".md", mode, source: true, futureTab: { keep: [id] } } } });
  const main = { id: "tab-main", type: "split", direction: "vertical", children: [
    { id: "tab-left", type: "tabs", currentTab: 0, children: [leaf("tab-alpha", "Alpha"), leaf("tab-beta", "Beta"), leaf("tab-gamma", "Gamma")] },
    { id: "tab-nested", type: "split", direction: "horizontal", children: [{ id: "tab-right", type: "tabs", currentTab: 0, children: [leaf("tab-delta", "Delta"), leaf("tab-reading", "Alpha", "preview"), { id: "tab-probe", type: "leaf", state: { type, pinned: true, state: { value: "Plugin state λ", opaque: { keep: [true, 42] } } } }] }] },
  ] };
  await evaluate(`(async()=>{const value=app.workspace.getLayout();value.main=${JSON.stringify(main)};value.active="tab-alpha";await app.workspace.changeLayout(value)})()`);
  await settled(); await wait('tabMoveCounts.frames===1&&Boolean(app.workspace.getLeafById("tab-probe").view.frame.contentWindow.tabMoveMarker)', "owned iframe initialized");
  await evaluate(`(()=>{const a=app.workspace.getLeafById("tab-alpha"),b=app.workspace.getLeafById("tab-beta"),p=app.workspace.getLeafById("tab-probe");
    globalThis.tabMovementState={alpha:a,beta:b,view:a.view,session:a.session,editor:a.view.editor,betaSession:b.session,probe:p,probeView:p.view,frameMarker:p.view.frame.contentWindow.tabMoveMarker,history:a.history,historyIndex:a.historyIndex};
    document.addEventListener("dragstart",event=>{if(event.dataTransfer?.types.includes(${JSON.stringify(mime)}))tabMovementDrag={trusted:event.isTrusted,items:Array.from(event.dataTransfer.types,mimeType=>({mimeType,data:event.dataTransfer.getData(mimeType)}))}});
    document.addEventListener("drop",event=>{if(event.dataTransfer?.types.includes(${JSON.stringify(mime)}))globalThis.tabMovementDropTrusted=event.isTrusted},true);
    app.workspace.setActiveLeaf(b);b.view.editor.setCursor({line:2,ch:0});b.view.editor.focus();
  })()`);
  await command("Input.insertText", { text: "Beta unsaved " });
  await evaluate('app.workspace.setActiveLeaf(tabMovementState.alpha);app.editor.setCursor({line:2,ch:0});app.editor.focus()');
  await command("Input.insertText", { text: "Alpha unsaved λ " });
  await evaluate('app.editor.setSelection({line:3,ch:1},{line:3,ch:7});tabMovementState.selection=[app.editor.getCursor("from"),app.editor.getCursor("to")];tabMovementState.expected=app.editor.getValue();tabMovementState.betaExpected=tabMovementState.beta.view.editor.getValue();tabMovementState.view.contentEl.scrollTop=180');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  const scroll = await evaluate('tabMovementState.view.contentEl.scrollTop'); assert.ok(scroll > 100, "The note really scrolls before tab movement");
  await drag("tab-alpha", header("tab-gamma"), "after");
  assert.deepEqual(await order(), ["tab-beta", "tab-gamma", "tab-alpha", "tab-delta", "tab-reading", "tab-probe"]);
  assert.equal(await evaluate("tabMovementDropTrusted"), true);
  assert.equal(await evaluate('tabMovementState.view.contentEl.scrollTop'), scroll);
  await retained();
  await evaluate('tabMovementState.alpha.view.editor.focus()'); await press("z", "KeyZ", 90, 2);
  assert.equal(await evaluate('tabMovementState.alpha.view.editor.getValue()'), originals.get(alpha).toString("utf8").slice(1));
  await press("y", "KeyY", 89, 2);
  assert.equal(await evaluate('tabMovementState.alpha.view.editor.getValue()'), await evaluate('tabMovementState.expected'));
  await evaluate('tabMovementState.alpha.view.editor.setSelection(tabMovementState.selection[0],tabMovementState.selection[1]);tabMovementState.alpha.tabHeaderEl.focus()');
  await press("PageUp", "PageUp", 33, 10); await settled();
  assert.deepEqual(await order(), ["tab-beta", "tab-alpha", "tab-gamma", "tab-delta", "tab-reading", "tab-probe"]);
  await press("PageDown", "PageDown", 34, 10); await settled();
  assert.deepEqual(await order(), ["tab-beta", "tab-gamma", "tab-alpha", "tab-delta", "tab-reading", "tab-probe"]);
  await press("PageUp", "PageUp", 33, 10); await settled();
  pass("Trusted tab drags and Ctrl+Shift+PageUp reorder the actual headers while retaining both dirty buffers, shared Reading peers, editor selection/undo, pin, scroll, history and plugin ownership without saving notes.");

  await menu("tab-alpha", "next-pane"); await drag("tab-beta", header("tab-delta"));
  assert.deepEqual(await order(), ["tab-gamma", "tab-beta", "tab-delta", "tab-reading", "tab-probe", "tab-alpha"]);
  await drag("tab-gamma", header("tab-alpha"), "after");
  assert.equal(await evaluate('app.workspace.rootSplit.containerEl.querySelectorAll(".workspace-tabs").length'), 1);
  await retained();
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("tab-gamma"))');
  await evaluate('app.commands.execute("workspace:split-vertical")'); await settled();
  const newId = await evaluate('app.workspace.activeLeaf.id');
  await drag("tab-probe", header(newId), "after");
  await retained();
  await evaluate('window.dispatchEvent(new Event("tab-move-probe"))'); assert.equal(await evaluate('tabMoveCounts.events'), 1);
  await capture("moved");
  pass("Tab actions and real cross-pane drags move the same note/plugin views, prune an emptied nested pane, and keep the plugin iframe document, state and single owned event subscription alive.");

  let data = await beginDrag("tab-beta"), before = await order();
  await press("Escape", "Escape", 27); await endDrag(data, await point(header("tab-delta")));
  assert.deepEqual(await order(), before);
  data = await beginDrag("tab-gamma");
  await evaluate('app.workspace.closeLeaf(app.workspace.getLeafById("tab-gamma"))'); before = await order();
  await endDrag(data, await point(header("tab-delta")));
  assert.deepEqual(await order(), before); assert.equal(await evaluate('app.workspace.getLeafById("tab-gamma")'), null);
  data = await beginDrag("tab-beta"); before = await order();
  await evaluate('app.changingVault=true');
  try { await endDrag(data, await point(header("tab-delta"))); } finally { await evaluate('app.changingVault=false'); }
  assert.deepEqual(await order(), before);
  await endDrag({ items: [{ mimeType: mime, data: "foreign-or-stale-drag" }], dragOperationsMask: 16 }, await point(header("tab-delta")));
  assert.deepEqual(await order(), before); await retained();
  pass("Escape, removed source tabs, an in-progress vault transition and foreign/stale drag payloads cannot move a tab, retain drag markers, save a dirty buffer or duplicate a view.");

  const extra = await evaluate('Array.from({length:18},()=>app.workspace.createTab(app.workspace.getLeafById("tab-probe").parent).id)');
  const last = extra.at(-1), group = await evaluate(`app.workspace.getLeafById(${JSON.stringify(last)}).parent.id`);
  data = await beginDrag(last);
  const edge = await evaluate(`(()=>{const bar=document.querySelector('[data-tab-group-id="${group}"] .workspace-tab-header-container'),b=bar.getBoundingClientRect();return{x:b.left+4,y:b.top+18,scroll:bar.scrollLeft}})()`);
  assert.ok(edge.scroll > 0, "Overflowing tabs were genuinely scrolled to the source");
  await command("Input.dispatchDragEvent", { type: "dragEnter", x: edge.x, y: edge.y, data });
  await command("Input.dispatchDragEvent", { type: "dragOver", x: edge.x, y: edge.y, data });
  await wait(`document.querySelector('[data-tab-group-id="${group}"] .workspace-tab-header-container').scrollLeft===0`, "drag edge autoscroll reveals offscreen tabs");
  await endDrag(data, { x: edge.x, y: edge.y });
  assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(last)}).parent.children[0].id`), last);
  assert.equal(await evaluate('document.querySelectorAll("[data-tab-drop], .is-tab-dragging").length'), 0);
  await capture("overflow");
  for (const id of extra) await evaluate(`app.workspace.closeLeaf(app.workspace.getLeafById(${JSON.stringify(id)}))`);
  await retained();
  pass("A real drag auto-scrolls an overflowing tab strip to reveal an offscreen insertion point; dropping there retains the source instance and cleans up all insertion and drag styling.");

  await evaluate('app.workspace.setActiveLeaf(tabMovementState.probe);app.workspace.saveAll()');
  const savedAlpha = Buffer.from("\ufeff" + await evaluate('tabMovementState.expected')), savedBeta = Buffer.from("\ufeff" + await evaluate('tabMovementState.betaExpected'));
  assert.deepEqual(await readFile(join(directory, alpha)), savedAlpha); assert.deepEqual(await readFile(join(directory, beta)), savedBeta);
  const expectedLayout = await evaluate('(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()');
  if (restart) await restart(); else await command("Page.reload");
  await afterReload(); await settled();
  assert.deepEqual(await evaluate('app.workspace.getLayout()'), expectedLayout);
  assert.equal(await evaluate('app.workspace.getLeafById("tab-probe").view.input.value'), "Plugin state λ");
  assert.equal(await evaluate('app.workspace.getLeafById("tab-alpha").pinned'), true);
  assert.deepEqual(await readFile(join(directory, alpha)), savedAlpha); assert.deepEqual(await readFile(join(directory, beta)), savedBeta);
  if (automatic) assert.deepEqual(await readFile(join(directory, ".obsidian/workspace.json")), automatic);
  assert.equal(await readFile(join(plugin, "main.js"), "utf8"), source);
  await capture("restored");
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, false); await click(".settings-close");
  await assertCommunityPluginConfiguration(communityPath, originalCommunity, { [pluginId]: false });
  pass("Explicitly saved rearranged layouts retain order, panes, active tab, modes, pins and opaque plugin state after a full desktop restart or real-folder WASM reconnect, preserving exact BOM/CRLF note bytes and the original Obsidian workspace.");
  report.tabMovement = { pointerDragTrusted: true, movedViewsRecreated: false, syntheticPluginOnly: true, physicalTouchTested: false, expectedLayout };
}
