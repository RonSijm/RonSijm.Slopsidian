import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setCommunityPluginEnabled, assertCommunityPluginConfiguration } from "./community-plugin-test-helpers.mjs";

const pluginId = "workspace-dock-probe", type = "workspace-dock-probe-view", mime = "application/x-slopsidian-workspace-tab";
const source = String.raw`
const {Plugin,ItemView}=require("obsidian");
module.exports=class extends Plugin {
  onload(){
    const counts=globalThis.dockCounts={opened:0,closed:0,cleaned:0,events:0,frames:0};
    this.registerView("workspace-dock-probe-view",leaf=>new class extends ItemView {
      getViewType(){return "workspace-dock-probe-view"} getDisplayText(){return "Docking probe"}
      onOpen(){counts.opened++;this.input=this.contentEl.createEl("input",{attr:{"aria-label":"Plugin dock state"}});
        this.frame=this.contentEl.createEl("iframe",{attr:{title:"Preserved dock frame"}});
        this.frame.style.height="70px";this.frame.addEventListener("load",()=>{counts.frames++;if(counts.frames===1){this.frame.contentWindow.dockMarker={preserved:true};this.frame.contentDocument.body.textContent="Dock frame state"}});
        this.frame.src="about:blank";
        this.registerDomEvent(window,"dock-probe",()=>counts.events++);this.register(()=>counts.cleaned++);
      }
      async setState(state,result){await super.setState(state,result);this.input.value=typeof state.value==="string"?state.value:""}
      getState(){return {...super.getState(),value:this.input?.value??""}}
      onClose(){counts.closed++}
    }(leaf));
  }
};`;

export async function checkWorkspaceDocking({ directory, evaluate, command, click, press, wait, afterReload, restart, report, capture }) {
  const folder = "Workspace docking", names = ["Alpha", "Beta", "Gamma", "Delta"], originals = new Map();
  const alpha = folder + "/Alpha.md", beta = folder + "/Beta.md";
  const automatic = await readFile(join(directory, ".obsidian/workspace.json")).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  const communityPath = join(directory, ".obsidian/community-plugins.json"), originalCommunity = await readFile(communityPath).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const header = id => `[data-tab-id="${id}"]`;
  const js = JSON.stringify;
  const roots = async () => ({ main: (await groupsIn("rootSplit")).flat(), left: (await groupsIn("leftSplit")).flat(), right: (await groupsIn("rightSplit")).flat() });
  const where = id => evaluate(`(()=>{const l=app.workspace.getLeafById(${js(id)});const r=l.getRoot();return r===app.workspace.leftSplit?"left":r===app.workspace.rightSplit?"right":"main"})()`);
  const groupsIn = root => evaluate(`(()=>{const out=[];const walk=n=>n.children.forEach(c=>"currentTab" in c?out.push(c.children.map(l=>l.id)):walk(c));walk(app.workspace.${root});return out})()`);
  async function settled() { await evaluate("app.workspace.whenIdle()"); await wait('!app.workspace.isChangingLayout&&!app.workspace.isChangingFiles', "workspace docking settled"); }
  async function point(selector, edge = "middle") {
    return evaluate(`(()=>{const el=document.querySelector(${js(selector)});el.scrollIntoView({block:"nearest",inline:"nearest"});const b=el.getBoundingClientRect();return{x:${edge === "before" ? "b.left+3" : edge === "after" ? "b.right-3" : "b.left+Math.min(35,b.width/2)"},y:b.top+b.height/2}})()`);
  }
  // Points inside a pane's content area: outer quarter edges dock, the centre merges as a tab.
  async function bodyPoint(id, zone) {
    return evaluate(`(()=>{const g=app.workspace.getLeafById(${js(id)}).parent.containerEl,b=g.getBoundingClientRect(),h=g.querySelector(".workspace-tab-header-container").getBoundingClientRect();
      const z=${js(zone)};return{x:z==="left"?b.left+Math.max(50,b.width*0.12):z==="right"?b.right-Math.max(50,b.width*0.12):b.left+b.width/2,y:z==="top"?h.bottom+10:z==="bottom"?b.bottom-10:Math.max(h.bottom+60,b.top+b.height/2)}})()`);
  }
  async function beginDrag(id) {
    assert.equal(await evaluate(`app.workspace.getLeafById(${js(id)}).tabHeaderEl.draggable`), true, "Live tabs in every area must be draggable");
    await command("Input.setInterceptDrags", { enabled: true });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 });
    await evaluate("globalThis.dockDrag=null");
    const p = await point(header(id));
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + 18, y: p.y + 2, button: "left", buttons: 1 });
    await wait("Boolean(dockDrag?.items.some(item=>item.mimeType===" + js(mime) + "))", "trusted tab dragstart payload");
    const data = await evaluate("dockDrag"); assert.equal(data.trusted, true, "A native pointer gesture must start the drag");
    return { items: data.items, dragOperationsMask: 16 };
  }
  async function endDrag(data, p, { drop = true, inspect } = {}) {
    try {
      for (const kind of ["dragEnter", "dragOver"]) await command("Input.dispatchDragEvent", { type: kind, ...p, data });
      if (inspect) await inspect();
      if (drop) await command("Input.dispatchDragEvent", { type: "drop", ...p, data });
      else await command("Input.dispatchDragEvent", { type: "dragCancel", ...p, data });
    } finally {
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
      await command("Input.setInterceptDrags", { enabled: false });
      await command("Input.cancelDragging", {}).catch(() => {});
    }
    if (!drop) await evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await settled();
  }
  const preview = zone => async () => {
    assert.equal(await evaluate(`document.querySelector("[data-dock-preview]")?.dataset.dockPreview`), zone, "The drop preview names the " + zone + " zone");
    const box = await evaluate(`(()=>{const b=document.querySelector("[data-dock-preview]").getBoundingClientRect();return[b.width,b.height]})()`);
    assert.ok(box[0] > 40 && box[1] > 40, "The preview is a visible region");
  };
  async function dragTo(id, p, options) { const data = await beginDrag(id); await endDrag(data, p, options); }
  async function dragToBand(id, side) {
    const data = await beginDrag(id);
    await wait(`Boolean(document.querySelector('[data-dock-band="${side}"]'))`, side + " sidebar drop band appears during the drag");
    const p = await point(`[data-dock-band="${side}"]`);
    await endDrag(data, p);
  }
  async function menuDock(id, action) {
    const p = await point(header(id));
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "right", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "right", clickCount: 1 });
    await click(`[data-tab-dock="${action}"]`); await settled();
  }
  async function run(commandId) { assert.equal(await evaluate(`app.commands.executeCommandById(${js(commandId)})`), true, commandId + " runs"); await settled(); }
  async function clean() {
    assert.equal(await evaluate('document.querySelectorAll("[data-tab-drop],[data-dock-preview],[data-dock-band],.is-tab-dragging").length'), 0, "Docking leaves no preview, band or drag styling");
  }
  async function unchangedFiles() { for (const [path, bytes] of originals) assert.deepEqual(await readFile(join(directory, path)), bytes, path + " must not be saved implicitly by docking"); }
  async function retained() {
    assert.deepEqual(await evaluate(`(()=>{const s=dockState,w=app.workspace,a=w.getLeafById("dock-alpha"),b=w.getLeafById("dock-beta"),p=w.getLeafById("dock-probe");return{
      alpha:a===s.alpha&&a.view===s.view&&a.session===s.session&&a.view.editor===s.editor,
      beta:b===s.beta&&b.session===s.betaSession&&b.session.dirty,
      shared:w.getLeafById("dock-reading").session===s.session&&s.session.leaves.size===2,
      text:a.view.editor.getValue()===s.expected&&b.view.editor.getValue()===s.betaExpected,
      selection:JSON.stringify([a.view.editor.getCursor("from"),a.view.editor.getCursor("to")])===JSON.stringify(s.selection),
      history:a.history===s.history&&a.historyIndex===s.historyIndex,pinned:a.pinned,
      plugin:p===s.probe&&p.view===s.probeView&&p.view.frame.contentWindow.dockMarker===s.frameMarker&&p.view.input.value==="Plugin dock λ",
      ownership:dockCounts.opened===1&&dockCounts.closed===0&&dockCounts.cleaned===0&&dockCounts.frames===1,
      connected:[a,b,p].every(l=>l.view.containerEl.isConnected&&l.tabHeaderEl.isConnected)
    }})()`), { alpha: true, beta: true, shared: true, text: true, selection: true, history: true, pinned: true, plugin: true, ownership: true, connected: true });
    await unchangedFiles();
  }
  const layoutOf = () => evaluate("JSON.stringify(app.workspace.getLayout())");

  await evaluate("app.workspace.saveAll()"); await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder), { recursive: true });
  for (const name of names) {
    const path = folder + "/" + name + ".md", text = "# " + name + "\r\n\r\n" + Array.from({ length: 90 }, (_, n) => "Line " + n + ": kept λ and 中文.").join("\r\n") + "\r\n";
    const bytes = Buffer.from("\ufeff" + text); originals.set(path, bytes); await writeFile(join(directory, path), bytes);
  }
  const plugin = join(directory, ".obsidian/plugins", pluginId); await mkdir(plugin, { recursive: true });
  await writeFile(join(plugin, "manifest.json"), JSON.stringify({ id: pluginId, name: "Workspace docking probe", description: "Independent docking and view preservation fixture", author: "Independent test fixture", version: "1.0.0", minAppVersion: "1.0.0", isDesktopOnly: false }));
  await writeFile(join(plugin, "main.js"), source);
  await command("Page.reload"); await afterReload();
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true); await click(".settings-close");
  const leaf = (id, name, mode = "source") => ({ id, type: "leaf", state: { type: "markdown", pinned: id === "dock-alpha", state: { file: folder + "/" + name + ".md", mode, source: true, futureTab: { keep: [id] } } } });
  const main = { id: "dock-main", type: "split", direction: "vertical", children: [
    { id: "dock-group", type: "tabs", currentTab: 0, children: [leaf("dock-alpha", "Alpha"), leaf("dock-beta", "Beta"), leaf("dock-gamma", "Gamma"), leaf("dock-delta", "Delta"), leaf("dock-reading", "Alpha", "preview"),
      { id: "dock-probe", type: "leaf", state: { type, pinned: true, state: { value: "Plugin dock λ", opaque: { keep: [true, 42] } } } }] },
  ] };
  await evaluate(`(async()=>{const value=app.workspace.getLayout();value.main=${js(main)};value.active="dock-alpha";await app.workspace.changeLayout(value)})()`);
  await settled(); await wait('dockCounts.frames===1&&Boolean(app.workspace.getLeafById("dock-probe").view.frame.contentWindow.dockMarker)', "owned iframe initialized");
  await evaluate(`(()=>{const a=app.workspace.getLeafById("dock-alpha"),b=app.workspace.getLeafById("dock-beta"),p=app.workspace.getLeafById("dock-probe");
    globalThis.dockState={alpha:a,beta:b,view:a.view,session:a.session,editor:a.view.editor,betaSession:b.session,probe:p,probeView:p.view,frameMarker:p.view.frame.contentWindow.dockMarker,history:a.history,historyIndex:a.historyIndex};
    document.addEventListener("dragstart",event=>{if(event.dataTransfer?.types.includes(${js(mime)}))dockDrag={trusted:event.isTrusted,items:Array.from(event.dataTransfer.types,mimeType=>({mimeType,data:event.dataTransfer.getData(mimeType)}))}});
    app.workspace.setActiveLeaf(b);b.view.editor.setCursor({line:2,ch:0});b.view.editor.focus();
  })()`);
  await command("Input.insertText", { text: "Beta unsaved " });
  await evaluate('app.workspace.setActiveLeaf(dockState.alpha);app.editor.setCursor({line:2,ch:0});app.editor.focus()');
  await command("Input.insertText", { text: "Alpha unsaved λ " });
  await evaluate('app.editor.setSelection({line:3,ch:1},{line:3,ch:7});dockState.selection=[app.editor.getCursor("from"),app.editor.getCursor("to")];dockState.expected=app.editor.getValue();dockState.betaExpected=dockState.beta.view.editor.getValue()');
  await retained();

  // Edge docking by real pointer drags.
  await dragTo("dock-alpha", await bodyPoint("dock-alpha", "right"), { inspect: preview("right") });
  let main1 = await groupsIn("rootSplit");
  assert.deepEqual(main1, [["dock-beta", "dock-gamma", "dock-delta", "dock-reading", "dock-probe"], ["dock-alpha"]]);
  const ratio = await evaluate(`(()=>{const [a,b]=app.workspace.rootSplit.children.map(g=>g.containerEl.getBoundingClientRect().width);return a/b})()`);
  assert.ok(ratio > 0.85 && ratio < 1.18, "A new right dock splits the pane proportionally, got " + ratio);
  assert.equal(await evaluate("app.workspace.getLeafById('dock-alpha').parent.parent===app.workspace.rootSplit&&app.workspace.rootSplit.direction"), "vertical");
  await clean(); await retained();
  await dragTo("dock-beta", await bodyPoint("dock-gamma", "bottom"), { inspect: preview("bottom") });
  main1 = await groupsIn("rootSplit");
  assert.deepEqual(main1, [["dock-gamma", "dock-delta", "dock-reading", "dock-probe"], ["dock-beta"], ["dock-alpha"]]);
  assert.equal(await evaluate("app.workspace.getLeafById('dock-beta').parent.parent.direction"), "horizontal");
  await clean(); await retained();
  await capture("edges");
  pass("Trusted pointer drags show an edge preview and dock live dirty notes to a new right pane and a nested lower pane, with proportional sizes and every editor, shared session, selection, undo history, pin and plugin frame retained.");

  // Undo history survives the moves and the editor still edits.
  await evaluate("dockState.alpha.view.editor.focus()"); await press("z", "KeyZ", 90, 2);
  assert.equal(await evaluate("dockState.alpha.view.editor.getValue()"), originals.get(alpha).toString("utf8").slice(1));
  await press("y", "KeyY", 89, 2);
  assert.equal(await evaluate("dockState.alpha.view.editor.getValue()"), await evaluate("dockState.expected"));
  await evaluate("dockState.alpha.view.editor.setSelection(dockState.selection[0],dockState.selection[1])");
  await retained();
  pass("Undo and redo in a docked editor still operate on the original editor history.");

  // Sidebars: pointer band drag, tab-menu and command paths.
  await dragToBand("dock-probe", "right");
  assert.equal(await where("dock-probe"), "right");
  assert.equal(await evaluate("app.workspace.rightSplit.collapsed"), false, "The destination sidebar becomes visible");
  assert.equal(await evaluate("document.querySelector('[data-tab-group-id]')&&app.workspace.getLeafById('dock-probe').view.containerEl.getBoundingClientRect().width>40"), true);
  await clean(); await retained();
  await menuDock("dock-gamma", "to-left-sidebar");
  assert.equal(await where("dock-gamma"), "left");
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("dock-delta"))');
  await run("workspace:move-tab-to-left-sidebar");
  assert.deepEqual((await roots()).left.sort(), ["dock-delta", "dock-gamma"]);
  await capture("sidebars");
  await retained();
  pass("A real band drag, the tab menu and the command create/use right and left sidebar groups, expose the sidebar and keep the live plugin iframe, dirty text and ownership intact.");

  // Sidebar reorder, sidebar -> main (pane centre) and command returns.
  await dragTo("dock-delta", await point(header("dock-gamma"), "before"));
  assert.deepEqual((await groupsIn("leftSplit"))[0], ["dock-delta", "dock-gamma"]);
  await dragTo("dock-gamma", await bodyPoint("dock-alpha", "center"));
  assert.equal(await where("dock-gamma"), "main");
  assert.deepEqual((await groupsIn("rootSplit")).at(-1), ["dock-alpha", "dock-gamma"]);
  await dragTo("dock-gamma", await point(header("dock-probe"), "after"));
  assert.equal(await where("dock-gamma"), "right");
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("dock-probe"))');
  await run("workspace:move-tab-to-main");
  assert.equal(await where("dock-probe"), "main");
  await run("workspace:dock-tab-top");
  assert.equal(await where("dock-probe"), "main");
  assert.equal(await evaluate("app.workspace.getLeafById('dock-probe').parent.children.length"), 1);
  await retained(); await clean();
  pass("Sidebar tabs reorder, move between sidebars, return to main by pointer or command and dock above a pane; emptied sidebar/main groups are pruned.");

  // Failed, vetoed, cancelled and stale movements.
  let before = await layoutOf();
  let data = await beginDrag("dock-delta");
  // CDP key events are not delivered while a native drag is intercepted, so dispatch the page-level Escape the drag listens for.
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await endDrag(data, await bodyPoint("dock-alpha", "left"));
  assert.equal(await layoutOf(), before, "stale step 1"); await clean();
  data = await beginDrag("dock-delta");
  await endDrag(data, await bodyPoint("dock-alpha", "left"), { drop: false, inspect: preview("left") });
  data = await beginDrag("dock-delta");
  await evaluate('app.workspace.closeLeaf(app.workspace.getLeafById("dock-delta"))');
  before = await layoutOf();
  await endDrag(data, await bodyPoint("dock-alpha", "left"));
  assert.equal(await layoutOf(), before, "stale step 2"); assert.equal(await evaluate('app.workspace.getLeafById("dock-delta")'), null);
  data = await beginDrag("dock-gamma"); before = await layoutOf();
  await evaluate("app.changingVault=true");
  try { await endDrag(data, await bodyPoint("dock-alpha", "left")); } finally { await evaluate("app.changingVault=false"); }
  assert.equal(await layoutOf(), before, "stale step 3");
  await endDrag({ items: [{ mimeType: mime, data: "foreign-or-stale-drag" }], dragOperationsMask: 16 }, await bodyPoint("dock-alpha", "left"));
  assert.equal(await layoutOf(), before, "stale step 4");
  // Destination removed while the drag is live.
  const scratchId = await evaluate('app.workspace.getLeaf("split","vertical").id');
  await settled();
  data = await beginDrag("dock-gamma");
  const target = await bodyPoint(scratchId, "left");
  await evaluate(`(()=>{const w=app.workspace;w.closeLeaf(w.getLeafById(${js(scratchId)}))})()`);
  await settled();
  before = await layoutOf();
  await endDrag(data, target);
  assert.equal(await layoutOf(), before, "stale step 5");
  // A throwing render is rolled back completely.
  const failure = await evaluate(`(()=>{const w=app.workspace,orig=w.render,l=w.getLeafById("dock-gamma"),g=w.getLeafById("dock-beta").parent,snapshot=JSON.stringify(w.getLayout());let n=0,message="";
    w.render=function(){if(n++===0)throw new Error("simulated veto");return orig.apply(this,arguments)};
    try{w.dockLeaf(l,g,"left")}catch(error){message=error.message}finally{w.render=orig}
    return{message,unchanged:JSON.stringify(w.getLayout())===snapshot,parent:l.parent.children.includes(l)}})()`);
  assert.deepEqual(failure, { message: "simulated veto", unchanged: true, parent: true });
  assert.equal(await evaluate("app.workspace.activeLeaf.view.containerEl.isConnected"), true);
  await clean();
  pass("Escape, a closed source, a closed destination, an in-progress vault transition, foreign payloads and a vetoed/throwing transition leave the exact layout and live views unchanged and remove every preview/band.");

  // The main area always keeps one pane; docks can be emptied and recreated.
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("dock-probe"))');
  await run("workspace:move-tab-to-right-sidebar");
  for (const id of (await roots()).main.filter(id => !["dock-probe"].includes(id))) {
    await evaluate(`app.workspace.setActiveLeaf(app.workspace.getLeafById(${js(id)}))`);
    await run("workspace:move-tab-to-left-sidebar");
  }
  assert.equal((await roots()).main.length, 1, "Moving the last main tab leaves one empty main leaf");
  assert.equal(await evaluate("app.workspace.rootSplit.children.length"), 1);
  for (const id of ["dock-alpha", "dock-beta", "dock-gamma", "dock-reading"]) {
    if ((await roots()).left.includes(id) || (await roots()).right.includes(id)) {
      await evaluate(`app.workspace.setActiveLeaf(app.workspace.getLeafById(${js(id)}))`); await run("workspace:move-tab-to-main");
    }
  }
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("dock-probe"))'); await run("workspace:move-tab-to-main");
  assert.deepEqual((await roots()).left.concat((await roots()).right), []);
  await retained();
  pass("Moving every main tab into sidebars keeps one live empty main pane; moving them back empties and unregisters both sidebars without losing a view.");

  // Final persisted arrangement: split pane, left and right sidebar content.
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("dock-reading"))'); await run("workspace:dock-tab-right");
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("dock-beta"))'); await run("workspace:move-tab-to-left-sidebar");
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("dock-probe"))'); await run("workspace:move-tab-to-right-sidebar");
  await evaluate("app.workspace.leftSplit.setWidth(300)");
  await evaluate("app.workspace.setActiveLeaf(dockState.alpha)");
  await retained();
  const layout = await evaluate("app.workspace.getLayout()");
  assert.equal(layout.left.width, 300); assert.ok(layout.left.root && layout.right.root);
  await evaluate("app.workspace.saveAll()");
  const savedAlpha = Buffer.from("\ufeff" + await evaluate("dockState.expected")), savedBeta = Buffer.from("\ufeff" + await evaluate("dockState.betaExpected"));
  assert.deepEqual(await readFile(join(directory, alpha)), savedAlpha); assert.deepEqual(await readFile(join(directory, beta)), savedBeta);
  const expectedLayout = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
  if (restart) await restart(); else await command("Page.reload");
  await afterReload(); await settled();
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), expectedLayout);
  assert.equal(await where("dock-probe"), "right"); assert.equal(await where("dock-beta"), "left");
  assert.equal(await evaluate('app.workspace.getLeafById("dock-probe").view.input.value'), "Plugin dock λ");
  assert.equal(await evaluate('app.workspace.getLeafById("dock-alpha").pinned'), true);
  assert.deepEqual(await readFile(join(directory, alpha)), savedAlpha); assert.deepEqual(await readFile(join(directory, beta)), savedBeta);
  if (automatic) assert.deepEqual(await readFile(join(directory, ".obsidian/workspace.json")), automatic);
  assert.equal(await readFile(join(plugin, "main.js"), "utf8"), source);
  await capture("restored");
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, false); await click(".settings-close");
  await assertCommunityPluginConfiguration(communityPath, originalCommunity, { [pluginId]: false });
  pass("A docked split plus left/right sidebar tabs, sidebar width, pins and opaque plugin state persist exactly across a full desktop restart or real-folder WASM reconnect, preserving note bytes and the original Obsidian workspace.");
  report.workspaceDocking = { pointerDragTrusted: true, movedViewsRecreated: false, syntheticPluginOnly: true, physicalTouchTested: false, popouts: false, expectedLayout };
}
