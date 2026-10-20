import { expectErrors, saveConflictMessage } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkCanvases({ directory, evaluate, command, click, press, wait, handleDialog, afterReload, restart, capture, report }) {
  const folder = "Canvas workflows";
  const path = folder + "/Board.canvas";
  const target = folder + "/Target.md";
  const renamed = folder + "/Renamed.md";
  const image = folder + "/Image.png";
  const movedImage = folder + "/Moved image.png";
  const configuration = join(directory, ".obsidian", "canvas.json");
  const readWorkspace = () => readFile(join(directory, ".obsidian", "workspace.json")).catch(error => {
    if (error.code !== "ENOENT") { throw error; }
    return null;
  });
  const originalWorkspace = await readWorkspace();
  const targetText = "# Target\r\n\r\n## Heading\r\n\r\nTarget preview from disk.\r\n";
  const initial = {
    future: { retained: [null, 42, "Canvas data"] },
    nodes: [
      { id: "group", type: "group", x: -80, y: -60, width: 820, height: 540, label: "Existing group", background: image, backgroundStyle: "repeat", futureGroup: true },
      { id: "text", type: "text", x: 0, y: 0, width: 260, height: 180, text: `# Card heading\n**Important Markdown**\n[[${target.replace(/\.md$/, "")}#Heading|Open target]]`, futureCard: { keep: true }, color: "6" },
      { id: "file", type: "file", x: 380, y: 0, width: 260, height: 180, file: target, subpath: "#Heading", futureFile: ["retained"] },
      { id: "website", type: "link", x: 0, y: 260, width: 260, height: 180, url: "https://example.invalid/canvas" },
      { id: "image", type: "file", x: 380, y: 260, width: 260, height: 180, file: image },
      { id: "future", type: "future-card", x: 800, y: 0, width: 200, height: 180, futurePayload: { keep: true } },
    ],
    edges: [{ id: "existing-edge", fromNode: "text", toNode: "file", fromSide: "right", toSide: "left", toEnd: "arrow", label: "Related", futureEdge: [1, 2] }],
  };
  const source = JSON.stringify(initial, null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const original = Buffer.from("\ufeff" + source);
  const settings = { newFileLocation: "folder", newFileFolderPath: folder + "/Created", defaultWheelBehavior: "pan", cardLabelVisibility: "always", snapToGrid: true, snapToObjects: false, defaultModDragBehavior: "webpage", zoomBreakpoint: 2.4, futureSetting: { keep: true } };
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate Canvas observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  let id;
  const leaf = () => `app.workspace.getLeafById(${JSON.stringify(id)})`;
  const view = () => leaf() + ".view";
  const root = () => `.canvas-view:has([data-canvas-surface="${id}"])`;
  const action = name => `${root()} [data-canvas-action="${name}"]`;
  const card = name => `${root()} [data-canvas-node="${name}"]`;
  const header = name => card(name) + " > .canvas-node-label";
  const field = key => `${root()} [data-canvas-field="${key}"]`;
  const data = () => evaluate(view() + ".canvas.getData()");
  const node = async name => (await data()).nodes.find(node => node.id === name);
  const camera = () => evaluate(view() + ".getState().slopsidianViewport");
  async function checkTransform(camera) {
    const values = await evaluate(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('${root()} .canvas')).transform);return[m.a,m.b,m.c,m.d,m.e,m.f]})()`);
    [camera.scale, 0, 0, camera.scale, camera.x, camera.y].forEach((expected, index) => {
      assert.ok(Math.abs(values[index] - expected) < 0.001, `Canvas DOM matrix entry ${index}: ${values[index]} does not match ${expected}`);
    });
  }
  const clean = () => wait(`!${view()}.isDirty&&!${view()}.isSaving`, "Canvas changes actually reach the original file");
  async function settingsPage() {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
  }
  async function toggle(enabled) {
    await settingsPage();
    if (await evaluate('app.core.isEnabled("canvas")') !== enabled) { await click('[data-core-toggle="canvas"]'); }
    await wait(`!app.core.busy&&app.core.isEnabled("canvas")===${enabled}`, "Canvas provider toggled");
    await click(".settings-close");
  }
  async function reveal() {
    await click(`[data-tab-id="${id}"]`);
    await wait(`${view()}.getViewType()==="canvas"&&document.querySelector('${root()} [data-canvas-status]')?.dataset.canvasComplete==="true"`, "actual Canvas pane");
  }
  async function fill(selector, text) {
    await click(selector);
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, "Canvas inspector receives real keyboard input");
    await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text });
  }
  async function choose(selector, value) {
    const options = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options,option=>option.value)`);
    const index = options.indexOf(value);
    assert.ok(index >= 0, "The real select offers " + value);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    const fromEnd = index > options.length / 2;
    await press(fromEnd ? "End" : "Home", fromEnd ? "End" : "Home", fromEnd ? 35 : 36);
    for (let step = 0; step < (fromEnd ? options.length - 1 - index : index); step++) {
      await press(fromEnd ? "ArrowUp" : "ArrowDown", fromEnd ? "ArrowUp" : "ArrowDown", fromEnd ? 38 : 40);
    }
    await press("Tab", "Tab", 9);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value);
  }
  async function saveSetting(key, value) {
    await settingsPage(); await click('[data-core-settings="canvas"]');
    await choose(`[data-core-field="${key}"]`, value);
    await click('[data-core-save="canvas"]');
    await wait(`!app.core.busy&&app.core.state("canvas").settings[${JSON.stringify(key)}]===${JSON.stringify(value)}`, "Canvas setting " + key);
    await click(".settings-close");
  }
  async function rectangleDrag(reverse = false) {
    await closeInspector();
    const bounds = await evaluate(`(()=>{const surface=document.querySelector('${root()} [data-canvas-surface]'),box=surface.getBoundingClientRect(),width=Math.min(100,box.width-32),height=70;for(let y=box.top+20;y+height<box.bottom-12;y+=80){for(let x=box.left+16;x+width<box.right-12;x+=110){if([0,.5,1].every(dx=>[0,.5,1].every(dy=>{const hit=document.elementFromPoint(x+dx*width,y+dy*height);return hit&&surface.contains(hit)&&!hit.closest("[data-canvas-node]")})))return{x,y,width,height,left:box.left,top:box.top}}}throw new Error("No empty Canvas rectangle is reachable")})()`);
    const viewport = await camera();
    const from = reverse ? { x: bounds.x + bounds.width, y: bounds.y + bounds.height } : { x: bounds.x, y: bounds.y };
    const to = reverse ? { x: bounds.x, y: bounds.y } : { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1, modifiers: 2 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...to, button: "left", buttons: 1, modifiers: 2 });
    await wait(`!document.querySelector('${root()} .canvas-selection-region').hidden`, "real modifier drag displays its selection rectangle");
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1, modifiers: 2 });
    return { x: Math.round((bounds.x - bounds.left - viewport.x) / viewport.scale), y: Math.round((bounds.y - bounds.top - viewport.y) / viewport.scale), width: Math.max(40, Math.round(bounds.width / viewport.scale)), height: Math.max(40, Math.round(bounds.height / viewport.scale)) };
  }
  async function inspector() {
    if (!await evaluate(`document.querySelector('${root()} [data-canvas-inspector]').checkVisibility()`)) { await click(action("inspector")); }
  }
  async function closeInspector() {
    if (await evaluate(`document.querySelector('${root()}').classList.contains("is-compact")&&document.querySelector('${root()} [data-canvas-inspector]').checkVisibility()`)) {
      await click(action("inspector"));
      await wait(`!document.querySelector('${root()} [data-canvas-inspector]').checkVisibility()`, "Canvas popover actually closes");
    }
  }
  async function point(selector) {
    return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.checkVisibility())throw new Error("Canvas target is hidden");const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw new Error("Canvas target is unreachable: "+JSON.stringify({bounds:b.toJSON(),hit:hit?.outerHTML.slice(0,160)}));return{x,y}})()`);
  }
  async function select(name, modifiers = 0) {
    await closeInspector();
    const p = await point(header(name));
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1, modifiers });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1, modifiers });
    await wait(`${view()}.canvas.selection.has(${JSON.stringify(name)})`, "real card selection");
  }
  async function drag(selector, dx, dy, destination, modifiers = 0) {
    await closeInspector();
    const from = await point(selector), to = destination ? await point(destination) : { x: from.x + dx, y: from.y + dy };
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1, modifiers });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...to, button: "left", buttons: 1, modifiers });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1, modifiers });
  }
  async function reload(accept) {
    await Promise.all([handleDialog(accept), click(action("reload"))]);
  }

  await evaluate("app.workspace.saveAll()");
  await toggle(false);
  await mkdir(join(directory, folder, "Created"), { recursive: true });
  await writeFile(join(directory, target), targetText);
  await writeFile(join(directory, path), original);
  await writeFile(join(directory, image), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqkAAAAASUVORK5CYII=", "base64"));
  await writeFile(join(directory, folder, "Created", "Untitled.canvas"), '{"nodes":[],"edges":[]}\n');
  await writeFile(configuration, "\ufeff" + JSON.stringify(settings, null, 2));
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await toggle(true);
  const start = await evaluate("app.workspace.leaves().filter(leaf=>leaf.containerEl.checkVisibility()).sort((a,b)=>b.containerEl.clientWidth-a.containerEl.clientWidth)[0].id");
  await click(`[data-tab-id="${start}"]`);
  await click('[data-sidebar-view="file-explorer"]');
  await click(`[data-note-path="${path}"]`);
  await wait('app.workspace.activeLeaf.view.getViewType()==="canvas"', "tree opens a real Canvas FileView");
  id = await evaluate("app.workspace.activeLeaf.id");
  await reveal();
  assert.equal(await evaluate(`${leaf()}.session===null&&!${leaf()}.containerEl.querySelector(".cm-editor")`), true);
  assert.deepEqual(await data(), initial);
  assert.equal(await evaluate(`document.querySelector('${card("text")} h1')?.textContent`), "Card heading");
  assert.equal(await evaluate(`document.querySelector('${card("text")} strong')?.textContent`), "Important Markdown");
  await wait(`document.querySelector('${card("image")} img')?.naturalWidth===1&&document.querySelector('${card("group")} .canvas-node-content').style.backgroundImage.includes("url(")`, "real image and tiled group background");
  assert.equal(await evaluate(`document.querySelector('${card("website")} iframe')===null`), true);
  assert.match(await evaluate(`document.querySelector('${card("future")}').textContent`), /not implemented.*retained/);
  assert.deepEqual(await readFile(join(directory, path)), original);
  await click(`${card("file")} [data-canvas-open-file]`);
  await wait(`app.current?.file.path===${JSON.stringify(target)}&&app.editor.getCursor().line===2`, "file card opens its actual heading");
  await press("End", "End", 35, 2);
  await command("Input.insertText", { text: "\r\nLive unsaved Canvas preview." });
  await wait(`document.querySelector('${card("file")}').textContent.includes("Live unsaved Canvas preview.")`, "file card follows a dirty note");
  assert.equal(await readFile(join(directory, target), "utf8"), targetText);
  await press("z", "KeyZ", 90, 2);
  await wait(`!document.querySelector('${card("file")}').textContent.includes("Live unsaved Canvas preview.")`, "file card follows undo");
  await press("s", "KeyS", 83, 2);
  await writeFile(join(directory, target), targetText + "External Canvas preview.\r\n");
  await evaluate("app.metadataCache.refresh()");
  await wait(`document.querySelector('${card("file")}').textContent.includes("External Canvas preview.")`, "file card refreshes an actual external write");
  await reveal();
  await click(`${card("text")} a`);
  await wait(`app.current?.file.path===${JSON.stringify(target)}&&app.editor.getCursor().line===2`, "Markdown inside a text card follows its real vault link");
  assert.equal(await evaluate(`${view()}.file.path`), path, "following a card link keeps the Canvas open");
  await reveal();
  assert.deepEqual(await readFile(join(directory, path)), original);
  pass("Existing Canvas text/file/web/group/unknown cards and edges open through the file explorer, render real Markdown/images and live dirty/undo/external file previews, and navigate actual headings without modifying original BOM/CRLF data or implicitly loading websites.");

  await select("text");
  await press("Enter", "Enter", 13);
  const edited = initial.nodes[1].text + "\nEdited through the actual inspector.";
  await fill(field("text"), edited);
  await clean();
  let bytes = await readFile(join(directory, path));
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  assert.ok(!/(?<!\r)\n/.test(bytes.toString("utf8")));
  assert.equal(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")).nodes[1].text, edited);
  await select("text");
  await press("z", "KeyZ", 90, 2);
  assert.equal((await node("text")).text, initial.nodes[1].text);
  await press("y", "KeyY", 89, 2);
  assert.equal((await node("text")).text, edited);
  await clean();
  pass("Actual Canvas inspector typing autosaves the original versioned UTF-8 file; keyboard undo/redo works across saves while preserving BOM, CRLF and unknown JSON fields.");

  const beforeMove = await node("text"), scale = (await camera()).scale;
  await drag(header("text"), 42 * scale, 22 * scale);
  assert.equal((await node("text")).x, beforeMove.x + 40);
  assert.equal((await node("text")).y, beforeMove.y + 20);
  const beforeResize = await node("text");
  await drag(`${card("text")} [data-canvas-resize]`, 40 * scale, 20 * scale);
  assert.equal((await node("text")).width, beforeResize.width + 40);
  assert.equal((await node("text")).height, beforeResize.height + 20);
  const gridResize = await node("text");
  await drag(`${card("text")} [data-canvas-resize]`, 25 * scale, 25 * scale);
  assert.equal((await node("text")).width, gridResize.width + 20, "resize edges follow the same enabled grid as movement");
  assert.equal((await node("text")).height, gridResize.height + 20);
  await select("file", 8);
  assert.equal(await evaluate(view() + ".canvas.selection.size"), 2);
  const edges = (await data()).edges.length;
  await click(action("connect"));
  await wait(`${view()}.canvas.getData().edges.length===${edges + 1}`, "two selected cards connect through the toolbar");
  await select("text");
  await drag(`${card("text")} [data-canvas-connect=bottom]`, 0, 0, header("image"));
  await wait(`${view()}.canvas.getData().edges.length===${edges + 2}`, "a real handle drag connects cards");
  const editedEdge = (await data()).edges.at(-1).id;
  await click(`${root()} [data-canvas-edge="${editedEdge}"] .canvas-edge-hit`);
  await inspector();
  await fill(field("label"), "Edited connection");
  await clean();
  assert.equal((await data()).edges.find(edge => edge.id === editedEdge).label, "Edited connection");
  const originalWidth = (await node("text")).width;
  await select("text"); await inspector();
  await fill(field("width"), "-1"); await press("Tab", "Tab", 9);
  await wait(`document.querySelector('${root()} [data-canvas-error]').textContent.includes("integer")`, "invalid card dimensions reject visibly");
  assert.equal((await node("text")).width, originalWidth);
  await fill(field("width"), String(originalWidth)); await press("Tab", "Tab", 9);
  assert.equal(await evaluate(`document.querySelector('${root()} [data-canvas-error]').textContent`), "");
  await select("group");
  const beforeGroup = await data();
  await drag(header("group"), 40 * scale, 20 * scale);
  const afterGroup = await data();
  const groupDx = afterGroup.nodes[0].x - beforeGroup.nodes[0].x, groupDy = afterGroup.nodes[0].y - beforeGroup.nodes[0].y;
  assert.ok(groupDx || groupDy);
  for (const name of ["text", "file", "website", "image"]) {
    const before = beforeGroup.nodes.find(node => node.id === name), after = afterGroup.nodes.find(node => node.id === name);
    assert.equal(after.x - before.x, groupDx); assert.equal(after.y - before.y, groupDy);
  }
  assert.deepEqual(afterGroup.nodes.find(node => node.id === "future"), beforeGroup.nodes.find(node => node.id === "future"));
  await press("ArrowRight", "ArrowRight", 39);
  assert.equal((await node("group")).x, afterGroup.nodes[0].x + 1);
  assert.equal((await node("file")).x, afterGroup.nodes.find(node => node.id === "file").x + 1);
  await select("future");
  const beforeDelete = await data();
  await press("Delete", "Delete", 46);
  assert.ok(!(await data()).nodes.some(node => node.id === "future"));
  await press("z", "KeyZ", 90, 2);
  assert.deepEqual(await data(), beforeDelete);
  const beforePan = await camera();
  await drag(header("group"), 20, 10, undefined, 1);
  assert.equal((await camera()).x, beforePan.x + 20);
  assert.equal((await camera()).y, beforePan.y + 10);
  await press("Tab", "Tab", 9);
  assert.equal(await evaluate("document.activeElement.dataset.canvasEdge"), "existing-edge");
  for (let index = 0; index < (await data()).edges.length; index++) { await press("Tab", "Tab", 9); }
  assert.equal(await evaluate("document.activeElement.dataset.canvasNode"), "group");
  assert.equal(await evaluate(view() + '.canvas.selection.has("group")'), true);
  await clean();
  accept("canvas:interaction");
  pass("Real Canvas pointer/keyboard input selects and grid-snaps cards, resizes, connects by toolbar and handle drag, edits edge labels, moves groups with contained cards, rejects invalid geometry and retains deletion undo.");

  await select("text"); await inspector();
  const beforeConflict = await evaluate(view() + ".getViewData()");
  await fill(field("text"), edited + "\nUnsaved conflict text.");
  const external = JSON.stringify({ ...initial, future: { external: true } }, null, 2) + "\n";
  await expectErrors({ evaluate, report }, [{ source: "notification", message: await saveConflictMessage({ evaluate }) }], async () => { await writeFile(join(directory, path), "\ufeff" + external); }, "Check Canvas autosave conflict without losing dirty text");
  await wait(`document.querySelector('${root()} [data-canvas-error]').textContent.includes("could not be saved")`, "stale Canvas autosave is visibly rejected");
  assert.match((await node("text")).text, /Unsaved conflict text/);
  assert.equal(await readFile(join(directory, path), "utf8"), "\ufeff" + external);
  await reload(false);
  assert.match((await node("text")).text, /Unsaved conflict text/);
  await writeFile(join(directory, path), "\ufeff" + beforeConflict);
  await reload(true);
  await wait(`!${view()}.isDirty&&${view()}.getViewData()===${JSON.stringify(beforeConflict)}`, "explicit accepted reload restores newer disk data");
  assert.equal(await evaluate(`document.querySelector('${root()} [data-canvas-error]').textContent`), "");
  pass("Stale Canvas autosaves retain external disk bytes and the dirty board; actual native reload confirmations honor cancellation and explicit discard before installing a clean document.");

  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(target)}),${JSON.stringify(renamed)})`);
  await wait(`${view()}.canvas.getData().nodes.find(node=>node.id==="file").file===${JSON.stringify(renamed)}`, "open Canvas file references follow a guarded rename");
  assert.ok((await node("text")).text.includes(renamed.replace(/\.md$/, "")));
  const imageBytes = await readFile(join(directory, image));
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(image)}),${JSON.stringify(movedImage)})`);
  await wait(`${view()}.canvas.getData().nodes.find(node=>node.id==="group").background===${JSON.stringify(movedImage)}`, "Canvas group background follows an actual binary move");
  assert.equal((await node("image")).file, movedImage);
  assert.deepEqual(await readFile(join(directory, movedImage)), imageBytes);
  assert.deepEqual((await data()).nodes.find(node => node.id === "future"), initial.nodes[5]);
  assert.deepEqual((await data()).future, initial.future);
  pass("Guarded note and binary renames update stored Canvas file cards, real text-card Markdown and group backgrounds together, retaining unknown card data and every attachment byte.");

  await evaluate('app.commands.execute("canvas:new-file")');
  await wait(`app.workspace.activeLeaf.view.file?.path===${JSON.stringify(folder + "/Created/Untitled 1.canvas")}`, "Canvas creation uses its configured existing folder and avoids collisions");
  assert.deepEqual(JSON.parse(await readFile(join(directory, folder, "Created", "Untitled 1.canvas"), "utf8")), { nodes: [], edges: [] });
  const createdId = await evaluate("app.workspace.activeLeaf.id");
  await click('.canvas-view:has([data-canvas-surface="' + await evaluate("app.workspace.activeLeaf.id") + '"]) [data-canvas-action="text-card"]');
  await wait('app.workspace.activeLeaf.view.canvas.getData().nodes.length===1', "real Text card control creates an editable card");
  await evaluate("app.workspace.saveAll()");
  await reveal();
  await settingsPage(); await click('[data-core-settings="canvas"]');
  await choose('[data-core-field="defaultWheelBehavior"]', "zoom");
  await choose('[data-core-field="cardLabelVisibility"]', "never");
  if (await evaluate('app.core.state("canvas").settings.snapToGrid')) { await click('[data-core-field="snapToGrid"]'); }
  await click('[data-core-save="canvas"]');
  await wait('!app.core.busy&&app.core.state("canvas").settings.defaultWheelBehavior==="zoom"&&!app.core.state("canvas").settings.snapToGrid', "actual Canvas settings saved");
  await click(".settings-close");
  assert.equal(await evaluate(`document.querySelector('${root()}').dataset.canvasLabels`), "never");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${header("file")}')).display`), "none");
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('${header("group")}')).display`), "none");
  const previousCamera = await camera();
  const surface = await point(`${root()} [data-canvas-surface]`);
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...surface, deltaX: 0, deltaY: -100 });
  await wait(`${view()}.getState().slopsidianViewport.scale>${previousCamera.scale}`, "configured mouse wheel actually zooms Canvas");
  const zoomed = await camera();
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...surface, deltaX: 0, deltaY: 80, modifiers: 2 });
  await wait(`${view()}.getState().slopsidianViewport.y===${zoomed.y - 80}`, "modifier wheel inverts a zoom preference into panning");
  assert.equal((await camera()).scale, zoomed.scale);
  const panned = await camera();
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...surface, deltaX: 0, deltaY: 60, modifiers: 10 });
  await wait(`${view()}.getState().slopsidianViewport.x===${panned.x - 60}`, "Shift pans horizontally with the inverted wheel");
  assert.equal((await camera()).y, panned.y);
  await evaluate(view() + ".canvas.stage.focus()");
  await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  try {
    const beforeSpace = await camera();
    await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...surface, deltaX: 0, deltaY: 40 });
    await wait(`${view()}.getState().slopsidianViewport.y===${beforeSpace.y - 40}`, "held Space inverts the configured wheel preference");
    assert.equal((await camera()).scale, beforeSpace.scale);
  } finally {
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  }
  const savedSettings = await readFile(configuration, "utf8");
  assert.ok(savedSettings.startsWith("\ufeff"));
  assert.equal(JSON.parse(savedSettings.slice(1)).defaultModDragBehavior, "webpage");
  assert.deepEqual(JSON.parse(savedSettings.slice(1)).futureSetting, { keep: true });
  await settingsPage(); await click('[data-core-settings="canvas"]');
  await choose('[data-core-field="cardLabelVisibility"]', "always");
  await click('[data-core-field="snapToObjects"]');
  await click('[data-core-save="canvas"]'); await wait('!app.core.busy', "Canvas labels restored");
  await click(".settings-close");
  // The wheel checks deliberately pan cards outside compact panes. Use the
  // actual Fit control before the subsequent pointer-based snapping checks.
  await click(action("fit"));
  await select("text");
  const moving = await node("text"), aligned = await node("file"), snapScale = (await camera()).scale;
  await drag(header("text"), (aligned.x - moving.x - moving.width - 2) * snapScale, (aligned.y - moving.y + 2) * snapScale);
  const snapped = await node("text");
  assert.equal(snapped.x + snapped.width, aligned.x);
  assert.equal(snapped.y, aligned.y);
  pass("Canvas commands create collision-safe files in the configured folder; actual wheel/modifier/Shift, label and snapping settings apply while BOM and future configuration survive.");

  await clean();
  const beforeThreshold = await readFile(join(directory, path));
  await click(action("fit"));
  await saveSetting("cardLabelVisibility", "hover");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await point(action("fit")) });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${header("file")}')).visibility`), "hidden");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await point(card("file")) });
  await wait(`getComputedStyle(document.querySelector('${header("file")}')).visibility==="visible"`, "hover label becomes visible under the real pointer");
  await saveSetting("cardLabelVisibility", "always");
  while ((await camera()).scale > 0.25) { await click(action("zoom-out")); }
  await settingsPage(); await click('[data-core-settings="canvas"]');
  await evaluate('document.querySelector(\'[data-core-field="zoomBreakpoint"]\').focus()');
  await press("Home", "Home", 36);
  assert.equal(await evaluate('document.querySelector(\'[data-core-field="zoomBreakpoint"]\').value'), "-0.7");
  await click('[data-core-save="canvas"]'); await wait('!app.core.busy', "minimum detail threshold saved");
  await click(".settings-close");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${card("text")} .canvas-node-content')).visibility`), "hidden");
  await settingsPage(); await click('[data-core-settings="canvas"]');
  await click('[data-core-reset="zoomBreakpoint"]');
  assert.equal(await evaluate('document.querySelector(\'[data-core-field="zoomBreakpoint"]\').value'), "0");
  await evaluate('document.querySelector(\'[data-core-field="zoomBreakpoint"]\').focus()');
  await press("End", "End", 35);
  await click('[data-core-save="canvas"]'); await wait('!app.core.busy&&app.core.state("canvas").settings.zoomBreakpoint===2.4', "maximum detail threshold saved");
  await click(".settings-close");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${card("text")} .canvas-node-content')).visibility`), "visible");
  assert.deepEqual(await readFile(join(directory, path)), beforeThreshold, "viewport/detail preferences do not rewrite board data");
  await saveSetting("newFileLocation", "current");
  await evaluate('app.commands.execute("canvas:new-file")');
  await wait(`app.workspace.activeLeaf.view.file?.parent.path===${JSON.stringify(folder)}`, "current-folder preference creates beside the active board");
  assert.deepEqual(JSON.parse(await readFile(join(directory, await evaluate("app.workspace.activeLeaf.view.file.path")), "utf8")), { nodes: [], edges: [] });
  await saveSetting("newFileLocation", "root");
  await settingsPage(); await click('[data-core-settings="canvas"]');
  assert.equal(await evaluate('document.querySelector(\'[data-core-field="newFileFolderPath"]\').closest("label").hidden'), true);
  assert.equal(await evaluate('document.querySelector(\'[data-core-field="newFileFolderPath"]\').checkVisibility()'), false);
  assert.equal(await evaluate('document.querySelector(\'[data-core-field="newFileFolderPath"]\').value'), settings.newFileFolderPath, "hidden folder input retains its configured path");
  await click(".settings-close");
  await evaluate('app.commands.execute("canvas:new-file")');
  await wait('(()=>{const file=app.workspace.activeLeaf.view.file;return file?.parent===app.vault.getRoot()&&file.parent.isRoot()&&file.parent.path==="/"&&!file.path.includes("/")})()', "root preference creates at the actual native-shaped vault root");
  assert.deepEqual(JSON.parse(await readFile(join(directory, await evaluate("app.workspace.activeLeaf.view.file.path")), "utf8")), { nodes: [], edges: [] });
  await saveSetting("newFileLocation", "folder");
  pass("Actual Canvas selects and slider cover folder/current/root placement, retained conditional folder values, detail thresholds at both bounds and Restore default without modifying the existing board.");

  const originalId = id;
  id = createdId; await reveal();
  const noteBytes = await readFile(join(directory, renamed));
  const attachments = await readFile(join(directory, movedImage));
  const baseline = await data();
  for (const behavior of ["card", "note", "media", "webpage", "group", "menu"]) {
    await saveSetting("defaultModDragBehavior", behavior);
    const rectangle = await rectangleDrag(behavior === "card");
    if (behavior === "menu") { await click('[data-menu-title="Add text card"]'); }
    if (["note", "media", "webpage"].includes(behavior)) {
      await wait(`document.querySelector('[data-canvas-create-dialog="${behavior}"]')?.open`, "actual Canvas creation prompt");
      if (behavior === "note") {
        await evaluate('(()=>{window.retainedCanvasCreate=document.querySelector("[data-canvas-create-submit]")})()');
        await click("[data-canvas-create-cancel]");
        await evaluate("window.retainedCanvasCreate.click();delete window.retainedCanvasCreate");
        assert.deepEqual(await data(), baseline, "cancelled and detached file pickers cannot create a card");
        await rectangleDrag();
      }
      if (behavior === "webpage") {
        await fill('[data-canvas-create-input="webpage"]', "javascript:window.canvasUnsafe=true");
        await click("[data-canvas-create-submit]");
        await wait('document.querySelector(".canvas-create-dialog [role=alert]").textContent.includes("HTTP")', "unsafe website creation rejects visibly");
        assert.deepEqual(await data(), baseline);
        assert.equal(await evaluate("window.canvasUnsafe"), undefined);
        await fill('[data-canvas-create-input="webpage"]', "https://example.invalid/new-canvas-card");
      } else {
        await choose(`[data-canvas-create-input="${behavior}"]`, behavior === "note" ? renamed : movedImage);
      }
      await click("[data-canvas-create-submit]");
    }
    await wait(`${view()}.canvas.getData().nodes.length===${baseline.nodes.length + 1}`, "configured modifier-drag action creates a real card");
    const added = (await data()).nodes.find(node => !baseline.nodes.some(old => old.id === node.id));
    assert.equal(added.type, behavior === "group" ? "group" : ["note", "media"].includes(behavior) ? "file" : behavior === "webpage" ? "link" : "text");
    assert.deepEqual({ x: added.x, y: added.y, width: added.width, height: added.height }, rectangle);
    if (behavior === "note" || behavior === "media") { assert.equal(added.file, behavior === "note" ? renamed : movedImage); }
    if (behavior === "webpage") { assert.equal(added.url, "https://example.invalid/new-canvas-card"); }
    await clean();
    await click(action("undo")); await clean();
    assert.deepEqual(await data(), baseline, "each rectangle creation remains undoable after saving");
  }
  assert.deepEqual(await readFile(join(directory, renamed)), noteBytes);
  assert.deepEqual(await readFile(join(directory, movedImage)), attachments);
  assert.equal(await evaluate('document.querySelector(".canvas-create-dialog,.menu")'), null);
  id = originalId; await reveal();
  const completeSettings = await evaluate('app.core.state("canvas").settings');
  pass("All six modifier-drag preferences run through real rectangle input, including reverse geometry, shared menu, note/media selection, safe website errors, cancel/detached controls and saved undo without writing referenced files.");

  await clean();
  const state = await evaluate(leaf() + ".getViewState()");
  bytes = await readFile(join(directory, path));
  await toggle(false);
  await wait(`${view()}.getViewType()==="unavailable"&&app.workspace.viewTypeForExtension("canvas")===null`, "disabling Canvas releases actual extension and view providers");
  assert.equal(await evaluate('app.commands.commands["canvas:new-file"]===undefined'), true);
  await toggle(true);
  await reveal();
  assert.deepEqual(await evaluate(leaf() + ".getViewState()"), state);
  const expectedTransform = state.state.slopsidianViewport;
  await checkTransform(expectedTransform);
  await evaluate("app.workspace.flushLayout()");
  if (capture) { await capture(); }
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload(); await reveal();
  assert.deepEqual(await evaluate(leaf() + ".getViewState()"), state);
  await checkTransform(expectedTransform);
  assert.deepEqual(await readFile(join(directory, path)), bytes);
  assert.deepEqual(await readWorkspace(), originalWorkspace);
  assert.equal(await evaluate('app.core.state("canvas").settings.defaultWheelBehavior'), "zoom");
  assert.deepEqual(await evaluate('app.core.state("canvas").settings'), completeSettings);
  accept("canvas:settings");
  accept("canvas:roundtrip");
  pass("Canvas disable/re-enable and a fresh runtime restore its actual file, camera DOM transform, settings and unknown JSON without hidden editors, leaked providers or original workspace rewrites.");
}
