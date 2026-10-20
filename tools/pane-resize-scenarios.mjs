import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { setCommunityPluginEnabled, assertCommunityPluginConfiguration } from "./community-plugin-test-helpers.mjs";

const pluginId = "pane-resize-probe", type = "pane-resize-probe-view";
const probe = String.raw`
const {Plugin,ItemView}=require("obsidian");
module.exports=class extends Plugin{onload(){
  const counts=globalThis.paneResizeCounts={opened:0,closed:0,cleaned:0,frames:0,resizes:0};
  this.registerView("pane-resize-probe-view",leaf=>new class extends ItemView{
    getViewType(){return "pane-resize-probe-view"}getDisplayText(){return "Resize preservation probe"}
    onOpen(){counts.opened++;this.input=this.contentEl.createEl("input",{attr:{"aria-label":"Resize plugin state"}});
      this.frame=this.contentEl.createEl("iframe",{attr:{title:"Resize preservation frame"}});this.frame.style.width="100%";this.frame.style.height="100px";
      this.frame.addEventListener("load",()=>{counts.frames++;this.frame.contentWindow.resizeMarker={preserved:true};this.frame.contentDocument.body.textContent="Live plugin frame"});this.frame.src="about:blank";
      this.register(()=>counts.cleaned++);
    }
    async setState(state,result){await super.setState(state,result);this.input.value=state.value??""}
    getState(){return {...super.getState(),value:this.input?.value??""}}
    onResize(){counts.resizes++}onClose(){counts.closed++}
  }(leaf));
}};`;

export async function checkPaneResize({ directory, evaluate, command, click, press, wait, report, afterReload, restart, capture }) {
  const pass = text => report.checks.push(text), folder = "Pane resizing", originals = new Map();
  await evaluate("app.saveAll()"); await evaluate("app.markdownAutosave.setEnabled(false)");
  const originalLayout = await evaluate("app.workspace.getLayout()");
  const workspacePath = join(directory, ".obsidian/workspace.json");
  const enabledPath = join(directory, ".obsidian/community-plugins.json");
  const originalWorkspace = await readFile(workspacePath).catch(error => { if (error.code === "ENOENT") { return null; } throw error; });
  const originalEnabled = await readFile(enabledPath).catch(error => { if (error.code === "ENOENT") { return null; } throw error; });
  await mkdir(join(directory, folder));
  for (const name of ["Alpha", "Beta"]) {
    const path = folder + "/" + name + ".md", bytes = Buffer.from("\ufeff# " + name + "\r\n\r\n" + Array.from({ length: 80 }, (_, index) => `Line ${index}: preserved λ and 中文.`).join("\r\n") + "\r\n");
    originals.set(path, bytes); await writeFile(join(directory, path), bytes);
  }
  const plugin = join(directory, ".obsidian/plugins", pluginId); await mkdir(plugin, { recursive: true });
  await writeFile(join(plugin, "manifest.json"), JSON.stringify({ id: pluginId, name: "Pane resize preservation probe", version: "1.0.0", author: "Independent fixture", description: "Observe actual view/frame ownership through resizing", minAppVersion: "1.0.0", isDesktopOnly: false }));
  await writeFile(join(plugin, "main.js"), probe);
  await command("Page.reload"); await afterReload();
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, true); await click(".settings-close");
  const leaf = (id, name, mode = "source") => ({ id, type: "leaf", state: { type: "markdown", pinned: id === "resize-alpha", state: { file: folder + "/" + name + ".md", mode, source: true, futurePane: { preserve: id } } } });
  const main = { id: "resize-main", type: "split", direction: "vertical", children: [
    { id: "resize-left", type: "tabs", dimension: 40, currentTab: 0, children: [leaf("resize-alpha", "Alpha")] },
    { id: "resize-middle", type: "split", dimension: 40, direction: "horizontal", children: [
      { id: "resize-top", type: "tabs", dimension: 55, currentTab: 0, children: [leaf("resize-beta", "Beta")] },
      { id: "resize-bottom", type: "tabs", dimension: 45, currentTab: 0, children: [{ id: "resize-probe", type: "leaf", state: { type, pinned: true, state: { value: "Live plugin λ", opaque: { keep: [true, 42] } } } }] },
    ] },
    { id: "resize-reading", type: "tabs", dimension: 20, currentTab: 0, children: [leaf("resize-reader", "Alpha", "preview")] },
  ] };
  await evaluate(`(async()=>{const state=app.workspace.getLayout();state.main=${JSON.stringify(main)};state.active="resize-alpha";await app.workspace.changeLayout(state)})()`);
  const settled = async () => { await evaluate("app.workspace.flushLayout()"); await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))"); };
  await settled(); await wait("paneResizeCounts.frames===1", "real plugin frame loads once");
  await evaluate(`(()=>{const a=app.workspace.getLeafById("resize-alpha"),b=app.workspace.getLeafById("resize-beta"),p=app.workspace.getLeafById("resize-probe");
    globalThis.resizeRefs={a,b,p,view:a.view,editor:a.view.editor,session:a.session,history:a.history,probe:p.view,frame:p.view.frame.contentWindow,marker:p.view.frame.contentWindow.resizeMarker};
    app.workspace.setActiveLeaf(b);b.view.editor.setCursor({line:2,ch:0});b.view.editor.focus();
  })()`);
  await command("Input.insertText", { text: "Beta unsaved " });
  await evaluate('app.workspace.setActiveLeaf(resizeRefs.a);app.editor.setCursor({line:2,ch:0});app.editor.focus()');
  await command("Input.insertText", { text: "Alpha unsaved λ " });
  await evaluate('app.editor.setSelection({line:3,ch:1},{line:3,ch:5});resizeRefs.selection=[app.editor.getCursor("from"),app.editor.getCursor("to")];resizeRefs.alpha=app.editor.getValue();resizeRefs.beta=resizeRefs.b.view.editor.getValue()');
  const columns = '[data-pane-resize="resize-main"][data-pane-before="resize-left"]';
  const rows = '[data-pane-resize="resize-middle"]';
  const dimensions = () => evaluate("app.workspace.getLayout().main.children.map(child=>child.dimension)");
  const sizes = () => evaluate('(()=>{const r=id=>{const b=document.querySelector(`[data-tab-group-id="${id}"],[data-split-id="${id}"]`).getBoundingClientRect();return{width:b.width,height:b.height}};return{left:r("resize-left"),middle:r("resize-middle"),reading:r("resize-reading"),top:r("resize-top"),bottom:r("resize-bottom")}})()');
  const pointer = (type, point, down = false) => command("Input.dispatchMouseEvent", { type, ...point, button: down || type === "mouseReleased" ? "left" : "none", buttons: down ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
  async function begin(selector, dx, dy) {
    await settled();
    const point = await evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(selector)}),b=h.getBoundingClientRect(),frame=resizeRefs.probe.frame.getBoundingClientRect();const p={x:b.x+b.width/2,y:b.height>10?Math.max(b.top+2,Math.min(b.bottom-2,frame.top+30)):b.y+b.height/2};if(document.elementFromPoint(p.x,p.y)!==h)throw new Error("The actual splitter is not reachable");return p})()`);
    await pointer("mouseMoved", point); await pointer("mousePressed", point, true);
    assert.equal(await evaluate("app.workspace.paneResize.active"), true);
    const end = { x: point.x + dx, y: point.y + dy };
    for (let step = 1; step <= 4; step++) { await pointer("mouseMoved", { x: point.x + dx * step / 4, y: point.y + dy * step / 4 }, true); }
    return end;
  }
  async function drag(selector, dx, dy) { const end = await begin(selector, dx, dy); await pointer("mouseReleased", end); await settled(); }
  async function retained() {
    assert.deepEqual(await evaluate(`(()=>{const s=resizeRefs;return{
      alpha:app.workspace.getLeafById("resize-alpha")===s.a&&s.a.view===s.view&&s.a.view.editor===s.editor&&s.a.session===s.session&&s.a.view.editor.getValue()===s.alpha,
      beta:s.b.view.editor.getValue()===s.beta,selection:JSON.stringify([s.editor.getCursor("from"),s.editor.getCursor("to")])===JSON.stringify(s.selection),
      history:s.a.history===s.history,pinned:s.a.pinned,shared:app.workspace.getLeafById("resize-reader").session===s.session,
      frame:s.p.view===s.probe&&s.probe.frame.contentWindow===s.frame&&s.frame.resizeMarker===s.marker,
      ownership:paneResizeCounts.opened===1&&paneResizeCounts.closed===0&&paneResizeCounts.cleaned===0&&paneResizeCounts.frames===1
    }})()`), { alpha: true, beta: true, selection: true, history: true, pinned: true, shared: true, frame: true, ownership: true });
    for (const [path, bytes] of originals) { assert.deepEqual(await readFile(join(directory, path)), bytes); }
    assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  }
  let before = await sizes(); await drag(columns, 75, 0); let after = await sizes();
  assert.ok(Math.abs(after.left.width - before.left.width - 75) < 2); assert.ok(Math.abs(after.middle.width - before.middle.width + 75) < 2);
  assert.ok(Math.abs(after.reading.width - before.reading.width) < 1); assert.equal((await dimensions())[2], 20);
  await retained(); await capture("columns");
  pass("Trusted divider dragging changes only adjacent main-pane widths, preserving the third pane, two dirty buffers, shared Reading, pin/selection/history and the actual plugin iframe without saving notes.");

  before = await sizes(); await drag(rows, 0, 45); after = await sizes();
  assert.ok(Math.abs(after.top.height - before.top.height - 45) < 2); assert.ok(Math.abs(after.bottom.height - before.bottom.height + 45) < 2);
  await retained(); assert.ok(await evaluate("paneResizeCounts.resizes>0"));
  await evaluate("resizeRefs.editor.focus()"); await press("z", "KeyZ", 90, 2);
  assert.equal(await evaluate("resizeRefs.editor.getValue()"), originals.get(folder + "/Alpha.md").toString("utf8").slice(1));
  await press("y", "KeyY", 89, 2); await evaluate("resizeRefs.editor.setSelection(resizeRefs.selection[0],resizeRefs.selection[1])"); await retained();
  pass("A nested horizontal divider resizes real upper/lower views; plugin resize callbacks run while its frame remains intact, and the original editor undo/redo still works.");

  const committed = await dimensions(); before = await sizes();
  const end = await begin(columns, 35, 0);
  assert.deepEqual(await dimensions(), committed);
  assert.equal(await evaluate('getComputedStyle(resizeRefs.probe.frame).pointerEvents'), "none");
  await evaluate("app.workspace.flushLayout()");
  const saved = JSON.parse(await readFile(join(directory, ".obsidian/vault-dotnet-workspace.json"), "utf8"));
  assert.deepEqual(saved.main.children.map(child => child.dimension), committed);
  await press("Escape", "Escape", 27); await pointer("mouseReleased", end); await settled(); after = await sizes();
  assert.ok(Math.abs(after.left.width - before.left.width) < 1); assert.deepEqual(await dimensions(), committed);
  assert.equal(await evaluate('document.body.classList.contains("is-workspace-resizing")'), false);
  assert.notEqual(await evaluate('getComputedStyle(resizeRefs.probe.frame).pointerEvents'), "none");
  await retained(); pass("Drag previews never enter saved layouts; Escape restores committed geometry, releases pointer/frame guards and retains all dirty data.");

  await evaluate(`document.querySelector(${JSON.stringify(columns)}).focus()`); before = await sizes();
  await press("ArrowLeft", "ArrowLeft", 37); await settled(); after = await sizes(); assert.ok(Math.abs(after.left.width - before.left.width + 10) < 2);
  before = after; await press("ArrowRight", "ArrowRight", 39, 8); await settled(); after = await sizes(); assert.ok(Math.abs(after.left.width - before.left.width - 50) < 2);
  await press("Home", "Home", 36); await settled(); assert.ok(Math.abs((await sizes()).left.width - 120) < 2);
  await press("End", "End", 35); await settled(); assert.ok(Math.abs((await sizes()).middle.width - 120) < 2);
  await evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(columns)});h.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));})()`); await settled();
  assert.deepEqual(await dimensions(), [40, 40, 20]);
  const semantics = await evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(columns)}),r=document.querySelector(${JSON.stringify(rows)});return{role:h.getAttribute("role"),orientation:h.getAttribute("aria-orientation"),value:h.getAttribute("aria-valuenow"),focus:h.tabIndex,rowOrientation:r.getAttribute("aria-orientation")}})()`);
  assert.deepEqual(semantics, { role: "separator", orientation: "vertical", value: "50", focus: 0, rowOrientation: "horizontal" });
  await retained(); pass("Focusable separators expose orientation/value semantics; arrows and Shift adjust 10/50 pixels, Home/End honor nested minimum sizes, and balance restores equal adjacent shares.");

  await press("End", "End", 35); await settled();
  const sidebarPreferences = await dimensions(), sidebarBefore = await sizes();
  const sidebarWidth = await evaluate('app.workspace.leftSplit.width');
  await evaluate('app.workspace.leftSplit.setWidth(600)'); await settled();
  assert.ok((await sizes()).middle.width >= 119);
  assert.ok((await sizes()).left.width < sidebarBefore.left.width - 10);
  assert.deepEqual(await dimensions(), sidebarPreferences);
  await evaluate(`app.workspace.leftSplit.setWidth(${sidebarWidth})`); await settled();
  assert.deepEqual(await dimensions(), sidebarPreferences);
  await evaluate(`document.querySelector(${JSON.stringify(columns)}).dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))`); await settled();
  assert.deepEqual(await dimensions(), [40, 40, 20]);
  await retained(); pass("Changing the existing sidebar width refits a minimum-sized main pane without replacing its saved proportions, dirty editors or plugin frame.");

  const viewport = await evaluate("({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio,mobile:false})");
  const resizeEnd = await begin(columns, 20, 0);
  await command("Emulation.setDeviceMetricsOverride", { width: 540, height: 480, deviceScaleFactor: 1, mobile: false });
  await wait("!app.workspace.paneResize.active", "viewport change cancels a live resize");
  await pointer("mouseReleased", resizeEnd); assert.deepEqual(await dimensions(), [40, 40, 20]);
  const narrow = await sizes(); assert.ok(Object.values(narrow).every(size => size.width > 0 && size.height > 0));
  await capture("narrow"); await command("Emulation.setDeviceMetricsOverride", viewport); await settled();
  await retained(); pass("Narrow CSS viewports keep nested panes measurable without changing stored proportions; resizing the window cancels an in-flight drag and restores normal pointer behavior.");

  await evaluate('globalThis.resizeExtraPanes=Array.from({length:3},()=>app.workspace.createLeafBySplit(resizeRefs.b,"vertical"));true');
  await settled();
  assert.equal(await evaluate('Array.from(app.workspace.rootSplit.containerEl.querySelectorAll(".workspace-tabs")).every(group=>group.getBoundingClientRect().width>=119)'), true);
  await capture("nested-minimums");
  await evaluate('(async()=>{for(const leaf of resizeExtraPanes.toReversed())await app.workspace.closeLeaf(leaf);})()'); await settled();
  await retained();
  pass("Repeated splits respect recursive minimum widths throughout the visible tree; closing the extra panes retains the original editors and plugin frame without saving dirty notes.");

  await evaluate("app.saveAll()");
  const physical = new Map(); for (const path of originals.keys()) { physical.set(path, await readFile(join(directory, path))); }
  let nativeGuestPreserved = null;
  if (restart) {
    const enabled = await evaluate('app.core.isEnabled("webviewer")');
    if (!enabled) { await evaluate('app.core.setEnabled("webviewer",true)'); }
    const readingState = await evaluate('app.workspace.getLeafById("resize-reader").getViewState()');
    await evaluate('app.workspace.getLeafById("resize-reader").setViewState({type:"webviewer",state:{url:"about:blank"},active:false})');
    await wait('app.workspace.getLeafById("resize-reader").view.created', "the actual native WebContentsView");
    await evaluate('(()=>{const view=app.workspace.getLeafById("resize-reader").view,request=view.request;globalThis.resizeNativeView=view;globalThis.resizeNativeBounds=[];view.request=async function(action,values){const result=await request.call(this,action,values);if(action==="bounds")resizeNativeBounds.push(values.bounds);return result;};view.scheduleBounds();})()');
    const targets = async () => (await command("Target.getTargets")).targetInfos.filter(target => target.type === "page" && target.url === "about:blank").map(target => target.targetId).sort();
    let beforeTargets = await targets();
    for (let attempt = 0; !beforeTargets.length && attempt < 60; attempt++) { await delay(50); beforeTargets = await targets(); }
    assert.ok(beforeTargets.length > 0);
    const nativeEnd = await begin('[data-pane-resize="resize-main"][data-pane-before="resize-middle"]', 20, 0);
    await wait('resizeNativeBounds.some(bounds=>bounds.visible===false)', "native guest hidden while pointer belongs to the splitter");
    assert.equal(await evaluate("app.workspace.paneResize.active"), true);
    await pointer("mouseReleased", nativeEnd); await settled();
    await wait('resizeNativeBounds.at(-1)?.visible===true', "native guest restored at its new bounds");
    assert.deepEqual(await targets(), beforeTargets);
    assert.equal(await evaluate('app.workspace.getLeafById("resize-reader").view===resizeNativeView'), true);
    await evaluate(`app.workspace.getLeafById("resize-reader").setViewState(${JSON.stringify(readingState)})`);
    if (!enabled) { await evaluate('app.core.setEnabled("webviewer",false)'); }
    nativeGuestPreserved = true;
    pass("The actual native browser guest yields pointer input during a divider drag and returns at its new bounds with the same native page target and view instance.");
  }
  const finalLayout = await evaluate("app.workspace.getLayout()");
  const finalDimensions = await dimensions();
  const expectedRows = finalLayout.main.children[1].children.map(child => child.dimension);
  await evaluate('globalThis.oldResizeHandle=document.querySelector("[data-pane-resize=resize-main]");globalThis.oldResizeSplit=app.workspace.rootSplit;true');
  await evaluate(`(async()=>{const state=app.workspace.getLayout();state.main=${JSON.stringify(main)};state.active="resize-alpha";await app.workspace.changeLayout(state)})()`); await settled();
  assert.equal(await evaluate('(()=>{oldResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}));oldResizeHandle.dispatchEvent(new PointerEvent("pointerdown",{button:0,isPrimary:true,pointerId:1,bubbles:true}));return app.workspace.paneResize.active})()'), false);
  assert.deepEqual(await dimensions(), [40, 40, 20]);
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(finalLayout)})`); await settled();
  pass("Replaced layout trees invalidate retained divider controls; stale keyboard/pointer callbacks cannot resize the replacement or reacquire pointer capture.");

  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload(); await wait('app.workspace.getLeavesOfType("pane-resize-probe-view").some(leaf=>leaf.view.getViewType()==="pane-resize-probe-view")', "saved actual plugin view restored");
  assert.deepEqual(await dimensions(), finalDimensions);
  assert.deepEqual(await evaluate("app.workspace.getLayout().main.children[1].children.map(child=>child.dimension)"), expectedRows);
  assert.equal(await evaluate('app.workspace.getLeafById("resize-alpha").pinned'), true);
  assert.deepEqual(await evaluate('app.workspace.getLeafById("resize-probe").view.getState().opaque'), { keep: [true, 42] });
  for (const [path, bytes] of physical) { assert.deepEqual(await readFile(join(directory, path)), bytes); }
  await capture("restored");
  pass(`A ${restart ? "full desktop process restart" : "real-folder browser reload/reconnection"} restores both axes' dimensions, pinned note and opaque plugin state with exact saved BOM/CRLF/Unicode note bytes.`);
  await setCommunityPluginEnabled({ evaluate, click, wait }, pluginId, false); await click(".settings-close");
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(originalLayout)},false)`); await settled();
  await assertCommunityPluginConfiguration(enabledPath, originalEnabled, { [pluginId]: false });
  if (originalWorkspace === null) { await assert.rejects(readFile(workspacePath), { code: "ENOENT" }); }
  else { assert.deepEqual(await readFile(workspacePath), originalWorkspace); }
  report.paneResize = { host: restart ? "desktop" : "browser-wasm", mainDimensions: finalDimensions, nestedDimensions: expectedRows,
    liveEditorsAndFramePreserved: true, previewExcludedFromPersistence: true, keyboardAndMinimumSizes: true, nativeGuestPreserved, staleControlsRejected: true, restartOrReconnect: true };
}
