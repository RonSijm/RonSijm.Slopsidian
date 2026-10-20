import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { pixel } from "./reading-scenarios.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const id = "obsidian-excalidraw-plugin";
const source = join(root, ".runtime", "compatibility", "excalidraw-2.29.0");
const expected = {
  "main.js": "4da2084a4eafe7d328484fa5742004b9fb990346c4c84fde924b885a5ecc1c17",
  "manifest.json": "4880b885c50643ef848d31cea829776ca2e96747353aee334d71e875f79d31c0",
  "styles.css": "173e9c161a01c53b3c173344e023de4d327fd0658e476961b46b0e6a93117ded",
};

export async function checkExcalidraw(tools) {
  const { directory, evaluate, command, click, press, wait, restart, afterReload, report } = tools;
  const assets = [];
  for (const [name, sha256] of Object.entries(expected)) {
    assert.equal(createHash("sha256").update(await readFile(join(source, name))).digest("hex"), sha256, "Refuse a modified Excalidraw release asset: " + name);
    assets.push({ name, sha256 });
  }
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  assert.equal(manifest.id, id);
  assert.equal(manifest.version, "2.29.0");
  assert.equal(manifest.minAppVersion, "1.8.7");
  report.excalidraw = {
    id, version: manifest.version, host: restart ? "desktop" : "browser-wasm",
    unmodifiedReleaseAssets: assets,
    referenceRuntimeComparison: "not-performed", workflows: "in-progress",
  };
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const originalLayout = await evaluate("app.workspace.getLayout()");
  const workspacePath = join(directory, ".obsidian", "workspace.json");
  let originalWorkspace = null;
  try { originalWorkspace = await readFile(workspacePath); }
  catch (error) { if (error.code !== "ENOENT") { throw error; } }
  const imagePath = "Excalidraw assets/Existing image.png";
  const imageBytes = pixel(24, 16);
  await mkdir(join(directory, "Excalidraw assets"));
  await writeFile(join(directory, imagePath), imageBytes, { flag: "wx" });
  const target = join(directory, ".obsidian", "plugins", id);
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  await evaluate(`(()=>{
    globalThis.excalidrawOriginalEnable=app.plugins.enable;
    globalThis.excalidrawLoadError=null;
    app.plugins.enable=async function(id){
      try { return await globalThis.excalidrawOriginalEnable.call(this,id); }
      catch(error){globalThis.excalidrawLoadError={message:error.message,stack:error.stack};throw error;}
    };
  })()`);
  try {
    await click("#open-settings");
    await click("#community-plugins-tab");
    await click(`[data-toggle-plugin="${id}"]`);
    await wait(`(()=>{const card=document.querySelector('.plugin-card[data-plugin-id="${id}"]');return document.querySelector("#desktop-shell").getAttribute("aria-busy")==="false"&&(card?.dataset.loaded==="true"||Boolean(card?.querySelector(".plugin-error")?.textContent))})()`, "unchanged Excalidraw operation completed or visible failure");
    report.excalidraw.startupError = await evaluate("globalThis.excalidrawLoadError");
    assert.equal(await evaluate(`document.querySelector('.plugin-card[data-plugin-id="${id}"]').dataset.loaded`), "true", await evaluate(`document.querySelector('.plugin-card[data-plugin-id="${id}"]').textContent`));
    await click(".settings-close");
  } finally {
    await evaluate("app.plugins.enable=globalThis.excalidrawOriginalEnable;delete globalThis.excalidrawOriginalEnable;delete globalThis.excalidrawLoadError");
  }
  assert.equal(await evaluate(`app.plugins.plugins["${id}"].isLoaded`), true);
  async function toggle(enabled) {
    await click("#open-settings");
    await click("#community-plugins-tab");
    await click(`[data-toggle-plugin="${id}"]`);
    await wait(`(()=>{
      const card=document.querySelector('.plugin-card[data-plugin-id="${id}"]');
      return document.querySelector("#desktop-shell").getAttribute("aria-busy")==="false"&&
        (card?.dataset.loaded===${JSON.stringify(String(enabled))}||Boolean(card?.querySelector(".plugin-error")?.textContent));
    })()`, "actual Excalidraw trust/disable operation and view restoration");
    assert.equal(await evaluate(`document.querySelector('.plugin-card[data-plugin-id="${id}"]').dataset.loaded`), String(enabled), await evaluate(`document.querySelector('.plugin-card[data-plugin-id="${id}"]').textContent`));
    await click(".settings-close");
    if (enabled) {
      await wait(`app.plugins.plugins["${id}"]?.isReady&&app.plugins.plugins["${id}"].settingsReady||Boolean(document.querySelector("#client-errors").textContent)`, "real Excalidraw asynchronous startup after session trust");
    }
    assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  }
  await wait(`(()=>{const plugin=app.plugins.plugins["${id}"];return plugin?.isReady&&plugin.settingsReady&&app.settingsTabs.has("${id}")&&app.commands.listCommands().some(item=>item.id.startsWith("${id}:"))||Boolean(document.querySelector("#client-errors")?.textContent)})()`, "the genuine Excalidraw asynchronous startup and command registration");
  report.excalidraw.startupState = await evaluate(`(()=>{const plugin=app.plugins.plugins["${id}"];return {ready:plugin.isReady,settingsReady:plugin.settingsReady,clientError:document.querySelector("#client-errors")?.textContent,notices:[...document.querySelectorAll(".notice")].map(item=>item.textContent)}})()`);
  assert.equal(report.excalidraw.startupState.ready, true, JSON.stringify(report.excalidraw.startupState));
  assert.equal(report.excalidraw.startupState.settingsReady, true, JSON.stringify(report.excalidraw.startupState));
  assert.ok(!report.excalidraw.startupState.clientError, JSON.stringify(report.excalidraw.startupState));
  assert.ok(!report.excalidraw.startupState.notices.some(notice => /^Error\b/.test(notice)), JSON.stringify(report.excalidraw.startupState));
  assert.equal(await evaluate(`app.settingsTabs.has("${id}")`), true);
  report.excalidraw.commands = await evaluate(`app.commands.listCommands().filter(item=>item.id.startsWith("${id}:")).map(item=>item.id)`);
  for (const suffix of ["excalidraw-autocreate-on-current", "save", "toggle-lock"]) {
    assert.ok(report.excalidraw.commands.includes(id + ":" + suffix), "Actual Excalidraw command registration must finish: " + suffix);
  }
  report.checks.push("The unchanged pinned Excalidraw plugin loads through actual session trust and registers its real settings and commands.");
  for (let index = 0; index < 5 && await evaluate('Boolean(document.querySelector(".modal-container"))'); index++) {
    await press("Escape", "Escape", 27);
  }
  assert.equal(await evaluate('Boolean(document.querySelector(".modal-container"))'), false, "First-run plugin dialogs must close through their real Escape handlers.");
  async function run(suffix) {
    const commandId = id + ":" + suffix;
    const name = await evaluate(`app.commands.listCommands().find(item=>item.id===${JSON.stringify(commandId)})?.name`);
    assert.equal(typeof name, "string", "The unchanged plugin must register its real command: " + suffix);
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker").open', "real command palette for " + suffix);
    await command("Input.insertText", { text: name });
    await click(`[data-command-id="${commandId}"]`);
  }
  await run("excalidraw-autocreate-on-current");
  try {
    await wait('app.workspace.activeLeaf.view.getViewType()==="excalidraw"&&app.workspace.activeLeaf.view.isLoaded&&Boolean(app.workspace.activeLeaf.view.excalidrawAPI)&&!app.workspace.activeLeaf.view.excalidrawAPI.getAppState().isLoading||Boolean(document.querySelector("#client-errors").textContent)', "the unchanged drawing view and real canvas API");
  } finally {
    report.excalidraw.drawingState = await evaluate(`(()=>{const view=app.workspace.activeLeaf.view;return {type:view.getViewType(),file:view.file?.path,hasCanvasAPI:Boolean(view.excalidrawAPI),clientError:document.querySelector("#client-errors").textContent,notices:[...document.querySelectorAll(".notice")].map(item=>item.textContent),canvases:[...document.querySelectorAll("canvas")].map(item=>({className:item.className,width:item.width,height:item.height})),modals:[...document.querySelectorAll(".modal-container")].map(item=>item.textContent.slice(0,1500))}})()`);
  }
  assert.ok(!report.excalidraw.drawingState.clientError, JSON.stringify(report.excalidraw.drawingState));
  assert.equal(report.excalidraw.drawingState.hasCanvasAPI, true, JSON.stringify(report.excalidraw.drawingState));
  assert.ok(report.excalidraw.drawingState.canvases.some(canvas => canvas.width > 0 && canvas.height > 0));
  report.checks.push("The real Excalidraw creation command opens its unchanged drawing view and a nonzero-size canvas.");
  const drawingPath = report.excalidraw.drawingState.file;
  const initialDrawing = await readFile(join(directory, drawingPath), "utf8");
  const scene = () => evaluate("app.workspace.activeLeaf.view.excalidrawAPI.getSceneElements()");
  let imageElement;
  async function loadedImage() {
    await wait(`Boolean(app.workspace.activeLeaf.view.excalidrawAPI?.getFiles()[${JSON.stringify(imageElement.fileId)}]?.dataURL)`, "the original plugin loads its actual linked image file");
    const decoded = await evaluate(`(async()=>{
      const data=app.workspace.activeLeaf.view.excalidrawAPI.getFiles()[${JSON.stringify(imageElement.fileId)}];
      const image=await new Promise((resolve,reject)=>{
        const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("The actual plugin image data could not decode"));image.src=data.dataURL;
      });
      const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext("2d");context.drawImage(image,0,0);
      return {width:image.naturalWidth,height:image.naturalHeight,pixel:[...context.getImageData(12,8,1,1).data]};
    })()`);
    assert.deepEqual(decoded, { width: 24, height: 16, pixel: [0, 190, 140, 255] });
    assert.deepEqual(await readFile(join(directory, imagePath)), imageBytes);
  }
  const pointer = (type, point, buttons = 0) => command("Input.dispatchMouseEvent", { type, ...point, button: buttons || type === "mouseReleased" ? "left" : "none", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
  async function decodedDrawing(text) {
    const match = text.match(/```(compressed-json|json)\r?\n([\s\S]*?)```/);
    assert.ok(match, "The physical drawing must contain a complete original-plugin scene payload.");
    const json = match[1] === "json" ? match[2] : await evaluate(`app.plugins.plugins["${id}"].ea.decompressFromBase64(${JSON.stringify(match[2].replace(/\s+/g, ""))})`);
    return JSON.parse(json);
  }
  async function savedScene(expected) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      let text;
      try { text = await readFile(join(directory, drawingPath), "utf8"); }
      catch (error) { if (error.code !== "ENOENT") { throw error; } }
      if (text && text !== initialDrawing) {
        const data = await decodedDrawing(text);
        if (expected.every(element => data.elements.some(saved => saved.id === element.id && saved.type === element.type && saved.x === element.x && saved.y === element.y && saved.width === element.width && saved.height === element.height))) {
          return { text, data };
        }
      }
      await delay(100);
    }
    throw new Error("The original plugin did not persist the expected edited scene to the physical drawing.");
  }
  try {
    await click("canvas.excalidraw__canvas.interactive");
    await press("r", "KeyR", 82);
    await wait('app.workspace.activeLeaf.view.excalidrawAPI.getAppState().activeTool.type==="rectangle"', "the real Rectangle keyboard tool");
    const bounds = await evaluate('(()=>{const canvas=document.querySelector("canvas.excalidraw__canvas.interactive"),b=canvas.getBoundingClientRect(),from={x:b.left+b.width*.45,y:b.top+b.height*.4},to={x:from.x+140,y:from.y+90};for(const point of [from,to]){if(document.elementFromPoint(point.x,point.y)!==canvas)throw new Error("The real drawing surface is not reachable");}return{from,to}})()');
    await pointer("mouseMoved", bounds.from);
    await pointer("mousePressed", bounds.from, 1);
    for (let step = 1; step <= 8; step++) {
      await pointer("mouseMoved", { x: bounds.from.x + 140 * step / 8, y: bounds.from.y + 90 * step / 8 }, 1);
    }
    await pointer("mouseReleased", bounds.to);
    await wait('app.workspace.activeLeaf.view.excalidrawAPI.getSceneElements().some(element=>element.type==="rectangle"&&element.width>=100&&element.height>=60)', "a real pointer-created rectangle");
    assert.equal(await evaluate("app.dirty&&app.workspace.hasUnsavedChanges"), true, "A real unsaved plugin drawing must retain the host's unload guard");
    const rectangle = (await scene()).find(element => element.type === "rectangle");
    assert.ok(rectangle);
    await press("z", "KeyZ", 90, 2);
    await wait(`!app.workspace.activeLeaf.view.excalidrawAPI.getSceneElements().some(element=>element.id===${JSON.stringify(rectangle.id)})`, "native canvas undo removes the actual rectangle");
    await press("z", "KeyZ", 90, 10);
    await wait(`app.workspace.activeLeaf.view.excalidrawAPI.getSceneElements().some(element=>element.id===${JSON.stringify(rectangle.id)})`, "native canvas redo restores the actual rectangle");
    await press("v", "KeyV", 86);
    const selectionPoint = await evaluate(`(()=>{
      const api=app.workspace.activeLeaf.view.excalidrawAPI;
      const element=api.getSceneElements().find(element=>element.id===${JSON.stringify(rectangle.id)}),state=api.getAppState();
      return {x:(element.x+element.width/2+state.scrollX)*state.zoom.value+state.offsetLeft,y:(element.y+state.scrollY)*state.zoom.value+state.offsetTop};
    })()`);
    await pointer("mouseMoved", selectionPoint);
    await pointer("mousePressed", selectionPoint, 1);
    await pointer("mouseReleased", selectionPoint);
    await wait(`app.workspace.activeLeaf.view.excalidrawAPI.getAppState().selectedElementIds[${JSON.stringify(rectangle.id)}]===true`, "real pointer selection of the restored rectangle");
    await press("ArrowRight", "ArrowRight", 39);
    await wait(`app.workspace.activeLeaf.view.excalidrawAPI.getSceneElements().some(element=>element.id===${JSON.stringify(rectangle.id)}&&element.x>${rectangle.x})`, "real keyboard editing changes the selected rectangle");
    let edited = await scene();
    report.excalidraw.editedElements = edited.map(({ id, type, x, y, width, height }) => ({ id, type, x, y, width, height }));
    report.checks.push("Real pointer/keyboard input creates and moves a rectangle; the original canvas undo and redo restore it.");
    await run("insert-image");
    await click(".modal-container .prompt-input");
    await command("Input.insertText", { text: imagePath });
    await wait(`(()=>{const rows=[...document.querySelectorAll(".modal-container .suggestion-item")];return rows.length===1&&rows[0].textContent===${JSON.stringify(imagePath)}})()`, "the unchanged image picker resolves the real vault PNG");
    await press("Enter", "Enter", 13);
    await wait('app.workspace.activeLeaf.view.excalidrawAPI.getSceneElements().some(element=>element.type==="image")||Boolean(document.querySelector("#client-errors").textContent)', "the real plugin image insertion callback and canvas");
    assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
    imageElement = (await scene()).find(element => element.type === "image");
    assert.ok(imageElement, "The original plugin's image command must add an actual scene element");
    await loadedImage();
    edited = await scene();
    report.excalidraw.imageAsset = { path: imagePath, sha256: createHash("sha256").update(imageBytes).digest("hex"), fileId: imageElement.fileId, input: "original-command-and-fuzzy-picker", decodedWidth: 24, decodedHeight: 16, exactCenterPixel: true };
    report.checks.push("The original Insert image command and fuzzy picker add a real vault PNG; the actual canvas file data decodes to the exact dimensions and center pixel while the source asset bytes remain unchanged.");
    await click("canvas.excalidraw__canvas.interactive");
    await press("a", "KeyA", 65, 2);
    await wait(`Object.keys(app.workspace.activeLeaf.view.excalidrawAPI.getAppState().selectedElementIds).length===${edited.length}`, "real canvas selection of the shape and linked image");
    await press("ArrowDown", "ArrowDown", 40);
    await wait(`app.workspace.activeLeaf.view.excalidrawAPI.getSceneElements().some(element=>element.id===${JSON.stringify(rectangle.id)}&&element.y>${rectangle.y})`, "a real unsaved edit after image insertion");
    edited = await scene();
    assert.equal(await evaluate("app.dirty&&app.workspace.hasUnsavedChanges"), true);
    report.excalidraw.editedElements = edited.map(({ id, type, x, y, width, height }) => ({ id, type, x, y, width, height }));
    await press("s", "KeyS", 83, 2);
    const saved = await savedScene(edited);
    await wait("!app.workspace.hasUnsavedChanges", "the actual saved custom drawing is no longer blocked by a false text-buffer comparison");
    assert.equal(saved.data.type, "excalidraw");
    const imageLink = saved.text.match(new RegExp("^" + imageElement.fileId + ":\\s*\\[\\[([^\\]]+)\\]\\]", "m"));
    assert.ok(imageLink, "The physical drawing must retain the original plugin's linked image reference");
    assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${JSON.stringify(imageLink[1])},${JSON.stringify(drawingPath)})?.path`), imagePath);
    report.excalidraw.savedDrawing = { path: drawingPath, sha256: createHash("sha256").update(saved.text).digest("hex"), elements: saved.data.elements.length, compressed: saved.text.includes("```compressed-json") };
    report.checks.push("The actual plugin Ctrl+S path persists the edited element identities, geometry and compressed scene to the real vault file.");
    try {
      await evaluate('(async()=>{globalThis.excalidrawClosedView=app.workspace.activeLeaf.view;await app.workspace.activeLeaf.setViewState({type:"empty",active:true})})()');
    } catch (error) {
      report.excalidraw.closeFailure = await evaluate(`({
        error:${JSON.stringify(error.message)},type:app.workspace.activeLeaf.view.getViewType(),
        loaded:excalidrawClosedView._loaded,hasPlugin:Boolean(excalidrawClosedView._plugin),
        hasCanvasAPI:Boolean(excalidrawClosedView.excalidrawAPI),
        clientError:document.querySelector("#client-errors").textContent
      })`);
      assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text, "Failed cleanup must not corrupt the already-saved scene");
      throw error;
    }
    report.excalidraw.closedDrawing = await evaluate('({unloaded:!excalidrawClosedView._loaded,disconnected:!excalidrawClosedView.containerEl.isConnected,clientError:document.querySelector("#client-errors").textContent})');
    assert.deepEqual(report.excalidraw.closedDrawing, { unloaded: true, disconnected: true, clientError: "" });
    assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text, "Normal cleanup must retain the saved scene bytes");
    await evaluate(`app.workspace.activeLeaf.setViewState({type:"excalidraw",state:{file:${JSON.stringify(drawingPath)}},active:true})`);
    await wait('Boolean(app.workspace.activeLeaf.view.excalidrawAPI)&&!app.workspace.activeLeaf.view.excalidrawAPI.getAppState().isLoading', "the unchanged plugin reopens its physically saved drawing");
    const geometry = elements => elements.map(({ id, type, x, y, width, height }) => ({ id, type, x, y, width, height }));
    assert.deepEqual(geometry(await scene()), geometry(edited));
    await loadedImage();
    assert.equal(await evaluate("app.dirty||app.workspace.hasUnsavedChanges"), false, "A clean reopened custom drawing must not be mistaken for an unsaved text buffer");
    report.excalidraw.reopenedDrawing = { path: drawingPath, elements: edited.length, exactGeometry: true };
    report.checks.push("The real plugin view closes without cleanup errors and reopens its physical compressed scene with the same element identities and edited geometry.");
    await evaluate('app.workspace.activeLeaf.setViewState({type:"empty",active:true})');
    try {
      await click(`[data-note-path=${JSON.stringify(drawingPath)}]`);
      await wait('app.workspace.activeLeaf.view.getViewType()==="excalidraw"&&Boolean(app.workspace.activeLeaf.view.excalidrawAPI)&&!app.workspace.activeLeaf.view.excalidrawAPI.getAppState().isLoading||Boolean(document.querySelector("#client-errors").textContent)', "normal File explorer navigation opens the original drawing plugin");
    } finally {
      report.excalidraw.navigationState = await evaluate('({type:app.workspace.activeLeaf.view.getViewType(),file:app.workspace.getActiveFile()?.path,clientError:document.querySelector("#client-errors").textContent})');
    }
    assert.equal(report.excalidraw.navigationState.type, "excalidraw", JSON.stringify(report.excalidraw.navigationState));
    assert.equal(report.excalidraw.navigationState.file, drawingPath);
    assert.equal(report.excalidraw.navigationState.clientError, "");
    assert.deepEqual(geometry(await scene()), geometry(edited));
    await loadedImage();
    assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text);
    report.checks.push("Actual File explorer input reopens the saved drawing through the unchanged plugin's normal navigation interception, not only a direct custom-view request.");
    const drawingLeaf = await evaluate("app.workspace.activeLeaf.id");
    const drawingState = await evaluate("app.workspace.activeLeaf.getViewState()");
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
    assert.equal(await evaluate(`Boolean(app.plugins.plugins["${id}"])`), false, "A fresh application session must require renewed plugin trust");
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(drawingLeaf)}).getViewState()`), drawingState);
    assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(drawingLeaf)}).view.getViewType()`), "unavailable");
    assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text);
    await toggle(true);
    await wait('app.workspace.activeLeaf.view.getViewType()==="excalidraw"&&Boolean(app.workspace.activeLeaf.view.excalidrawAPI)&&!app.workspace.activeLeaf.view.excalidrawAPI.getAppState().isLoading||Boolean(document.querySelector("#client-errors").textContent)', "real plugin trust restores the saved drawing leaf");
    assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
    assert.equal(await evaluate("app.workspace.activeLeaf.id"), drawingLeaf);
    assert.deepEqual(geometry(await scene()), geometry(edited));
    await loadedImage();
    assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text);
    report.excalidraw.persistence = { kind: restart ? "full-desktop-process-restart" : "real-folder-browser-reload-reconnect", renewedSessionTrust: true, restoredLeaf: drawingLeaf, exactGeometry: true, exactDrawingBytes: true };
    report.checks.push(`A ${restart ? "full desktop-process restart" : "real-folder WASM reload/reconnect"} retains the edited compressed scene and saved leaf, requires fresh session trust and restores the actual drawing with unchanged element identities, geometry and file bytes.`);
    await evaluate("globalThis.excalidrawDisabledView=app.workspace.activeLeaf.view;true");
    await toggle(false);
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${JSON.stringify(drawingLeaf)}).getViewState()`), drawingState);
    assert.equal(await evaluate(`app.workspace.getLeafById(${JSON.stringify(drawingLeaf)}).view.getViewType()`), "unavailable");
    assert.equal(await evaluate("!excalidrawDisabledView._loaded&&!excalidrawDisabledView.containerEl.isConnected"), true);
    assert.equal(await evaluate(`app.commands.listCommands().some(command=>command.id.startsWith("${id}:"))||app.settingsTabs.has("${id}")||Boolean(document.querySelector('style[data-plugin-id="${id}"]'))`), false);
    assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text);
    await toggle(true);
    await wait('app.workspace.activeLeaf.view.getViewType()==="excalidraw"&&Boolean(app.workspace.activeLeaf.view.excalidrawAPI)&&!app.workspace.activeLeaf.view.excalidrawAPI.getAppState().isLoading||Boolean(document.querySelector("#client-errors").textContent)', "real drawing restored after owned plugin re-enable");
    assert.equal(await evaluate("app.workspace.activeLeaf.view!==excalidrawDisabledView&&app.workspace.activeLeaf.view._loaded"), true);
    assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
    assert.deepEqual(geometry(await scene()), geometry(edited));
    await loadedImage();
    assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text);
    report.excalidraw.ownedCleanup = { unloadedDetachedView: true, removedCommandsSettingsStyles: true, restoredFreshView: true, exactDrawingBytes: true };
    report.checks.push("Disabling the actual plugin closes and unloads its live drawing without cleanup errors, removes owned commands/settings/styles and retains unavailable pane state; re-enable creates a fresh real canvas with the same physical saved scene.");
    const embedPath = "Excalidraw assets/Drawing embed.md";
    const embedBytes = Buffer.from("\ufeff# Embedded drawing\r\n\r\n![[" + drawingPath + "|400]]\r\n");
    await writeFile(join(directory, embedPath), embedBytes, { flag: "wx" });
    await evaluate("app.metadataCache.refresh()");
    await evaluate(`app.openFile(${JSON.stringify(embedPath)},"tab")`);
    async function readingEmbed() {
      await wait(`(()=>{
        const view=app.markdownView,element=view?.previewEl.querySelector(".excalidraw-embedded-img");
        return view?.getMode()==="preview"&&element&&element.getBoundingClientRect().width>0&&
          (element instanceof HTMLImageElement?element.complete&&element.naturalWidth>0:Boolean(element.querySelector("svg")))||
          Boolean(document.querySelector("#client-errors").textContent);
      })()`, "the unchanged plugin's actual embedded drawing renderer");
      assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
      const svgText = await evaluate(`(async()=>{
        const element=app.markdownView.previewEl.querySelector(".excalidraw-embedded-img");
        if(element instanceof HTMLImageElement){
          if(!/^(?:blob:|data:image\\/svg\\+xml)/.test(element.src))throw new Error("The actual drawing embed must use a locally generated SVG");
          const response=await fetch(element.src);if(!response.ok)throw new Error("The drawing embed SVG could not be read");return response.text();
        }
        const svg=element?.querySelector("svg");if(!svg)throw new Error("The original plugin did not render an SVG drawing");return svg.outerHTML;
      })()`);
      const rendered = await evaluate(`(async()=>{
        const svg=new DOMParser().parseFromString(${JSON.stringify(svgText)},"image/svg+xml");
        if(svg.querySelector("parsererror"))throw new Error("The actual embedded SVG is malformed");
        const embedded=svg.querySelector("image");
        if(!embedded)throw new Error("The drawing embed lost its linked image");
        const url=embedded.getAttribute("href")??embedded.getAttributeNS("http://www.w3.org/1999/xlink","href");
        if(!url?.startsWith("data:image/png;base64,"))throw new Error("The drawing embed must contain the real local PNG");
        const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("The embedded drawing asset could not decode"));image.src=url});
        const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext("2d");context.drawImage(image,0,0);
        return {paths:svg.querySelectorAll("path[d]").length,width:image.naturalWidth,height:image.naturalHeight,pixel:[...context.getImageData(12,8,1,1).data]};
      })()`);
      assert.ok(rendered.paths > 0, "The real drawing export must contain its rectangle paths, not just an image placeholder");
      assert.deepEqual({ width: rendered.width, height: rendered.height, pixel: rendered.pixel }, { width: 24, height: 16, pixel: [0, 190, 140, 255] });
      assert.deepEqual(await readFile(join(directory, embedPath)), embedBytes);
      assert.equal(await readFile(join(directory, drawingPath), "utf8"), saved.text);
      assert.deepEqual(await readFile(join(directory, imagePath)), imageBytes);
      return { svgSha256: createHash("sha256").update(svgText).digest("hex"), paths: rendered.paths, decodedImage: true };
    }
    await evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:"preview",source:true}})})()');
    const embedded = await readingEmbed();
    await evaluate('globalThis.excalidrawRetainedEmbed=app.markdownView.previewEl.querySelector(".excalidraw-embedded-img");true');
    await press("e", "KeyE", 69, 2);
    await wait('app.markdownView.getMode()==="source"', "real Source transition disposes the original drawing embed");
    assert.equal(await evaluate("excalidrawRetainedEmbed.isConnected"), false);
    assert.deepEqual(await readFile(join(directory, embedPath)), embedBytes);
    await press("e", "KeyE", 69, 2);
    await readingEmbed();
    await toggle(false);
    await wait('!app.markdownView.previewEl.querySelector(".excalidraw-embedded-img")', "plugin disable removes its rendered drawing from unchanged Reading content");
    assert.equal(await evaluate("app.dirty||app.workspace.hasUnsavedChanges"), false);
    await toggle(true);
    await readingEmbed();
    report.excalidraw.markdownEmbed = { path: embedPath, ...embedded, originalPostprocessor: true, sourceAndDisableCleanup: true, reenableRefresh: true, exactSourceDrawingAssetBytes: true };
    report.checks.push("The unchanged Markdown postprocessor renders the real saved drawing and linked PNG inside a BOM/CRLF note; actual SVG paths and decoded image pixels are verified, Source and plugin disable remove the embed, and re-enable refreshes it without rewriting the note, drawing or asset.");
  } finally {
    report.excalidraw.editingState = await evaluate(`(()=>{const view=app.workspace.activeLeaf.view;return {type:view.getViewType(),loaded:view._loaded,drawingLoaded:view.isLoaded,dirty:typeof view.isDirty==="function"?view.isDirty():view.isDirty,hostDirty:app.dirty,clientError:document.querySelector("#client-errors").textContent,notices:[...document.querySelectorAll(".notice")].map(item=>item.textContent),elements:view.excalidrawAPI?.getSceneElements().map(({id,type,x,y,width,height})=>({id,type,x,y,width,height})),tool:view.excalidrawAPI?.getAppState().activeTool?.type}})()`);
  }
  assert.ok(!report.excalidraw.editingState.clientError, JSON.stringify(report.excalidraw.editingState));
  await toggle(false);
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(originalLayout)},false)`);
  for (const [name, sha256] of Object.entries(expected)) {
    assert.equal(createHash("sha256").update(await readFile(join(target, name))).digest("hex"), sha256, "Executed Excalidraw asset changed: " + name);
  }
  if (originalWorkspace === null) { await assert.rejects(readFile(workspacePath), { code: "ENOENT" }); }
  else { assert.deepEqual(await readFile(workspacePath), originalWorkspace); }
  assert.deepEqual(await readFile(join(directory, imagePath)), imageBytes);
  report.excalidraw.workflows = restart ? "passed-bounded-desktop-subset" : "passed-bounded-wasm-subset";
}
