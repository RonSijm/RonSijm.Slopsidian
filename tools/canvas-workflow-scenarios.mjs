import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepareCanvasPreviewSplit, assertCanvasPreviewSplit, focusCanvasPreviewSource, restoreCanvasPreviewSplit } from "./canvas-scenarios.mjs";

const q = JSON.stringify, folder = "Canvas authoring workflows", boardPath = folder + "/Board.canvas", targetPath = folder + "/Target α.md", imagePath = folder + "/Pixel.png";
const targetText = "# Top\r\nOutside before.\r\n\r\n## Chosen\r\nChosen body 😀.\r\n### Nested\r\nNested body.\r\n\r\n## Other\r\nOther outside.\r\n\r\nExact block λ. ^picked\r\n\r\nAfter block.\r\n";
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqkAAAAASUVORK5CYII=", "base64");
const fixture = (base = folder) => ({ future: { retained: [null, "😀", 1.25] }, nodes: [
  { id: "group", type: "group", x: -20, y: -20, width: 1020, height: 600, label: "Resource group", background: base + "/Pixel.png", backgroundStyle: "repeat", future: "keep" },
  { id: "heading", type: "file", x: 0, y: 0, width: 280, height: 240, file: base + "/Target α.md", subpath: "#Chosen", future: ["heading"] },
  { id: "block", type: "file", x: 340, y: 0, width: 280, height: 240, file: base + "/Target α.md", subpath: "#^picked" },
  { id: "text", type: "text", x: 0, y: 300, width: 280, height: 240, text: "Canvas text 😀.", future: { keep: true } },
  { id: "image", type: "file", x: 340, y: 300, width: 280, height: 240, file: base + "/Pixel.png" },
  { id: "web", type: "link", x: 680, y: 300, width: 280, height: 240, url: "https://example.invalid/not-loaded" },
  { id: "future", type: "future-card", x: 680, y: 0, width: 280, height: 240, payload: { untouched: true } },
], edges: [{ id: "original-edge", fromNode: "text", toNode: "heading", fromSide: "right", toSide: "left", future: [1, 2] }] });
const boardText = JSON.stringify(fixture(), null, 2).replaceAll("\n", "\r\n") + "\r\n";
const pane = id => '[data-leaf-id=' + q(id) + ']';
const action = (id, name) => pane(id) + ' [data-canvas-action=' + q(name) + ']';
const card = (id, name) => pane(id) + ' [data-canvas-node=' + q(name) + ']';
const canvas = id => 'app.workspace.getLeafById(' + q(id) + ').view.canvas';
const dialog = '[data-canvas-file-chooser]';
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const documents = 'app.metadataCache.getDocuments().map(e=>({path:e.document.file.path,text:e.text,version:e.document.version,bom:e.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))';
const pass = (tools, message) => { tools.report.checks.push(message); console.log("PASS " + message); };
async function optional(path) { try { return await readFile(path); } catch (error) { if (error.code !== "ENOENT") throw error; return null; } }
async function restore(path, bytes) { if (bytes !== null) await writeFile(path, bytes); else await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }

async function captureOwner(tools) {
  return tools.evaluate('(()=>{const w=app.workspace,leaf=w.activeLeaf,view=leaf.view,e=view.editor,s=view.session;if(!e?.cm||!s)throw Error("A live Source owner is required");const cm=e.cm,m=app.plugins.modules["@codemirror/commands"];globalThis.canvasWorkflowOwner={leaf,view,editor:e,cm,doc:cm.state.doc,session:s,saved:s.document,text:s.text,dirty:s.dirty,history:JSON.stringify(leaf.history),historyIndex:leaf.historyIndex,selection:JSON.stringify(cm.state.selection.toJSON()),undo:m.undoDepth(cm.state),redo:m.redoDepth(cm.state),layout:JSON.stringify(w.getLayout()),restore:w.snapshotTree(),lastFile:w.lastFile,recent:w.recentFiles.serialize(),left:w.leftSplit.serializeSidebar(),right:w.rightSplit.serializeSidebar(),sidebarOptionPresent:w.viewOptions.has("sidebars"),sidebarOption:w.viewOptions.get("sidebars"),sidebarPreferred:{...app.sidebars.preferred},mode:view.getEditingMode(),root:app.vault.rootPath,file:view.file};return{id:leaf.id,path:view.file.path,text:s.text,dirty:s.dirty,version:s.document.version,bom:s.document.hasBom}})()');
}
async function restoreOwner(tools) {
  const result = await tools.evaluate('(async()=>{const o=canvasWorkflowOwner,w=app.workspace,m=app.plugins.modules["@codemirror/commands"];if(o.sidebarOptionPresent)w.viewOptions.set("sidebars",o.sidebarOption);else w.viewOptions.delete("sidebars");Object.assign(app.sidebars.preferred,o.sidebarPreferred);w.leftSplit.restore(o.left);w.rightSplit.restore(o.right);app.sidebars.update();o.restore();w.lastFile=o.lastFile;w.recentFiles.load(o.recent);await w.flushLayout();const r={sameLeaf:w.getLeafById(o.leaf.id)===o.leaf,sameView:o.leaf.view===o.view,sameEditor:o.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:o.view.session===o.session,sameSavedDocument:o.session.document===o.saved,sameRoot:app.vault.rootPath===o.root,sameFile:o.view.file===o.file&&app.vault.getFileByPath(o.file.path)===o.file,sameMode:o.view.getEditingMode()===o.mode,sourceExact:o.session.text===o.text,dirtyExact:o.session.dirty===o.dirty,selectionExact:JSON.stringify(o.cm.state.selection.toJSON())===o.selection,historyExact:JSON.stringify(o.leaf.history)===o.history&&o.leaf.historyIndex===o.historyIndex,undoRedoExact:m.undoDepth(o.cm.state)===o.undo&&m.redoDepth(o.cm.state)===o.redo,layoutExact:JSON.stringify(w.getLayout())===o.layout};delete globalThis.canvasWorkflowOwner;return r})()');
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, "Original Source owner retained: " + name);
  return result;
}
async function fill(tools, selector, value) {
  await tools.click(selector);
  await tools.wait('(()=>{const n=document.querySelector(' + q(selector) + ');return n?.isConnected&&document.activeElement===n})()', "current Canvas input owns focus before typing");
  await tools.press("a", "KeyA", 65, 2);
  assert.equal(await tools.evaluate('document.activeElement===document.querySelector(' + q(selector) + ')'), true);
  await tools.command("Input.insertText", { text: value });
  assert.equal(await tools.evaluate('document.querySelector(' + q(selector) + ').value'), value);
}
async function choose(tools, selector, value) {
  const values = await tools.evaluate('Array.from(document.querySelector(' + q(selector) + ').options,o=>o.value)'), index = values.indexOf(value);
  assert.ok(index >= 0, "Actual Canvas select contains requested value");
  await tools.click(selector);
  await tools.wait('document.activeElement===document.querySelector(' + q(selector) + ')', "real select has trusted focus");
  await tools.press("Home", "Home", 36);
  for (let step = 0; step < index; step++) await tools.press("ArrowDown", "ArrowDown", 40);
  await tools.press("Tab", "Tab", 9);
  assert.equal(await tools.evaluate('document.querySelector(' + q(selector) + ').value'), value);
}
async function point(tools, selector) {
  const result = await tools.evaluate('(()=>{const n=document.querySelector(' + q(selector) + ');if(!n)throw Error("Missing Canvas pointer target");n.scrollIntoView({block:"center",inline:"nearest"});const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return{x,y,reachable:n===h||n.contains(h)}})()');
  assert.equal(result.reachable, true, "Canvas pointer reaches its actual owned control"); return { x: result.x, y: result.y };
}
async function openBoard(tools, path = boardPath) {
  const id = await tools.evaluate('(async()=>{const leaf=app.workspace.getLeaf("tab");await leaf.openFile(app.vault.getFileByPath(' + q(path) + '));return leaf.id})()');
  await tools.wait(canvas(id) + '?.getData().nodes.length===7', "actual existing Canvas opens in its own tab");
  await tools.click(action(id, "fit"));
  for (let step = 0; step < 40 && await tools.evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-surface]') + ').dataset.canvasDetails!=="visible"'); step++) await tools.click(action(id, "zoom-in"));
  await previews(tools, id); return id;
}
async function previews(tools, id) {
  await tools.wait('(()=>{const p=' + q(pane(id)) + ';return["heading","block"].every(id=>document.querySelector(p+" [data-canvas-node="+JSON.stringify(id)+"] [data-canvas-preview]")?.dataset.canvasPreview==="ready")})()', "owned heading and block previews finish");
  const text = await tools.evaluate('(()=>{const p=' + q(pane(id)) + ';return Object.fromEntries(["heading","block"].map(id=>[id,document.querySelector(p+" [data-canvas-node="+JSON.stringify(id)+"] .canvas-node-content").textContent]))})()');
  assert.match(text.heading, /Chosen body/); assert.match(text.heading, /Nested body/); assert.doesNotMatch(text.heading, /Outside before|Other outside|After block/);
  assert.match(text.block, /Exact block λ/); assert.doesNotMatch(text.block, /Chosen body|After block|\^picked/);
}
async function resourcesReady(tools, id) {
  await tools.wait('document.querySelector(' + q(card(id, "image") + ' img') + ')?.naturalWidth===1&&document.querySelector(' + q(card(id, "group") + ' .canvas-node-content') + ').style.backgroundImage.includes("url(")', "actual image and repeating background resources finish mounting");
}
async function closeLeaf(tools, id) {
  if (!id || !await tools.evaluate('Boolean(app.workspace.getLeafById(' + q(id) + '))')) return;
  await tools.click('[data-tab-id=' + q(id) + '] .workspace-tab-header-inner-close-button');
  await tools.wait('!app.workspace.getLeafById(' + q(id) + ')', "only the owned Canvas workflow tab closes");
}
async function clean(tools, id) { await tools.wait('!app.workspace.getLeafById(' + q(id) + ').view.isDirty&&!app.workspace.getLeafById(' + q(id) + ').view.isSaving', "Canvas changes complete their normal guarded save"); }
async function captureClean(tools, ids, expectedRoot, label) {
  const expected = { [boardPath]: boardText, [targetPath]: targetText };
  const inspect = '(id)=>{const leaf=app.workspace.getLeafById(id),view=leaf?.view,file=view?.file,saved=view?.savedDocument,path=file?.path,type=view?.getViewType(),session=view?.session,cm=view?.editor?.cm,model=view?.canvas,entry=path&&app.metadataCache.getDocument(path),snapshot=type==="canvas"?view.captureDraft():null,text=type==="canvas"?view.getViewData():session?.text;const checks={liveOwnedView:Boolean(leaf&&view&&view.isLoaded&&file&&app.vault.getFileByPath(path)===file),supportedOwnedPath:Object.hasOwn(expected,path),exactLiveAndSavedText:Boolean(saved&&text===expected[path]&&saved.content===expected[path]&&saved.file.path===path&&saved.hasBom===true),cleanAndNotSaving:type==="canvas"?!view.isDirty&&!view.isSaving:session?.dirty===false&&!session.isSaving,coherentOwner:type==="canvas"?Boolean(snapshot&&snapshot.provider==="core:canvas"&&snapshot.state==="clean"&&!snapshot.saving&&snapshot.path===path&&snapshot.root===expectedRoot&&snapshot.version===saved?.version&&snapshot.hasBom===true):Boolean(session&&cm&&app.workspace.sessions.get(path)===session&&session.document===saved&&view.editor.getValue()===text),coherentMetadata:type==="canvas"||Boolean(entry&&entry.text===text&&entry.document.content===saved?.content&&entry.document.version===saved?.version&&entry.document.hasBom===saved?.hasBom)};return{id,leaf,view,file,saved,path,type,session,cm,doc:cm?.state.doc,model,revision:model?.revision,modelDocument:model?.document,past:model?JSON.stringify(model.document.past):null,future:model?JSON.stringify(model.document.future):null,history:JSON.stringify(leaf?.history),historyIndex:leaf?.historyIndex,checks}}';
  const declarations = 'const expected=' + q(expected) + ',expectedRoot=' + q(expectedRoot) + ',ids=' + q(ids) + ',inspect=' + inspect + ';';
  const exactBytes = async () => { for (const [path, bytes] of [[boardPath, Buffer.from("\ufeff" + boardText)], [targetPath, Buffer.from("\ufeff" + targetText)], [imagePath, imageBytes]]) assert.deepEqual(await readFile(join(tools.directory, path)), bytes, "Capture synchronization preserves exact fixture bytes: " + path); };
  await exactBytes();
  await tools.evaluate('(async()=>{await app.workspace.whenIdle();await app.notifyEditor()})()');
  await tools.wait('(()=>{' + declarations + 'return app.vault.rootPath===expectedRoot&&!app.metadataCache.pending&&!app.workspace.hasUnsavedChanges&&ids.map(inspect).every(owner=>Object.values(owner.checks).every(value=>value===true))})()', "all owned fixture views remain live, clean and coherent before " + label);
  const result = await tools.evaluate('(async()=>{' + declarations + 'const api=globalThis.slopsidianDraftCapture;if(!api?.flush||!api.status)throw Error("The genuine persistent capture API is required");const before=ids.map(inspect);if(app.vault.rootPath!==expectedRoot||app.workspace.hasUnsavedChanges||!before.every(owner=>Object.values(owner.checks).every(value=>value===true)))throw Error("The clean capture owner changed before flush");const flushed=await api.flush(),status=api.status(),after=ids.map(inspect);return{label:' + q(label) + ',rootCurrent:app.vault.rootPath===expectedRoot,captureApiCurrent:globalThis.slopsidianDraftCapture===api,globalClean:!app.workspace.hasUnsavedChanges,flushed,status,owners:after.map((owner,index)=>{const old=before[index];return{id:owner.id,path:owner.path,type:owner.type,version:owner.saved?.version,bom:owner.saved?.hasBom,checks:{...owner.checks,sameLeaf:owner.leaf===old.leaf,sameView:owner.view===old.view,sameFile:owner.file===old.file,sameSavedDocument:owner.saved===old.saved,sameSessionAndCM:owner.session===old.session&&owner.cm===old.cm&&owner.doc===old.doc,sameCanvasModelAndHistory:owner.model===old.model&&owner.modelDocument===old.modelDocument&&owner.revision===old.revision&&owner.past===old.past&&owner.future===old.future,sameNavigationHistory:owner.history===old.history&&owner.historyIndex===old.historyIndex}}})}})()');
  (tools.report.canvasWorkflowsCaptureFlushes ??= []).push(result);
  for (const key of ["rootCurrent", "captureApiCurrent", "globalClean"]) assert.equal(result[key], true, "Genuine capture synchronization: " + key);
  assert.equal(result.owners.length, ids.length); for (const owner of result.owners) for (const [key, value] of Object.entries(owner.checks)) assert.equal(value, true, "Clean capture retains " + owner.path + ": " + key);
  for (const health of [result.flushed, result.status]) { assert.equal(health.protecting, 0); assert.deepEqual(health.failures, []); assert.deepEqual(health.retained, []); assert.equal(health.storageError, null); assert.ok(Number.isFinite(health.lastPassAt) && health.lastPassAt > 0); }
  assert.deepEqual(result.status, result.flushed, "Actual status matches the completed genuine capture pass");
  await exactBytes(); return result;
}
async function chooseTarget(tools, kind, subpath = "#Chosen") {
  await tools.wait('document.querySelector(' + q(dialog) + ')?.open', "owned existing-file review is open");
  await fill(tools, dialog + ' [data-canvas-file-search]', "Target α");
  await choose(tools, dialog + ' [data-canvas-create-input=' + q(kind) + ']', targetPath);
  await choose(tools, dialog + ' [data-canvas-subpath]', subpath);
}
async function trace(tools) {
  await tools.evaluate('(()=>{const abort=new AbortController(),inputs=[];for(const type of["pointerdown","keydown","input","change","submit"])document.addEventListener(type,e=>{const n=e.target;if(n instanceof Element){const leaf=n.closest("[data-leaf-id]"),ownCanvas=n.closest(".canvas-view,.canvas-file-chooser"),ownTarget=app.workspace.getLeafById(leaf?.dataset.leafId)?.view.file?.path==="Canvas authoring workflows/Target α.md";if(ownCanvas||ownTarget)inputs.push({type,trusted:e.isTrusted,tag:n.tagName,kind:ownCanvas?"canvas":"target"})}},{capture:true,signal:abort.signal});globalThis.canvasWorkflowTrace={abort,inputs}})()');
}
async function untrace(tools) { const inputs = await tools.evaluate('(()=>{const t=canvasWorkflowTrace;t.abort.abort();delete globalThis.canvasWorkflowTrace;return t.inputs})()'); assert.ok(inputs.length > 10 && inputs.every(event => event.trusted)); return inputs; }

export async function checkCanvasWorkflows(tools) {
  const { evaluate, click, command, press, wait, directory, report, capture, restart, afterReload } = tools;
  const owned = new Set(), backups = new Map(), configNames = [".obsidian/app.json", ".obsidian/core-plugins.json", ".obsidian/vault-dotnet-recovery.json"];
  const inputs = [[boardPath, Buffer.from("\ufeff" + boardText)], [targetPath, Buffer.from("\ufeff" + targetText)], [imagePath, imageBytes]];
  let ownerLive = false, traced = false, narrow = false, madeFolder = false, id, targetId, failure, stage = "setup";
  const enabled = await evaluate('app.core.isEnabled("canvas")'), autosave = await evaluate('app.markdownAutosave.enabled'), captureRoot = await evaluate('app.vault.rootPath');
  const flushCapture = label => captureClean(tools, [...owned], captureRoot, label);
  const closeOwned = async leaf => { await flushCapture("before owned tab close " + leaf); await closeLeaf(tools, leaf); owned.delete(leaf); };
  for (const [path] of inputs) backups.set(path, await optional(join(directory, path)));
  for (const path of configNames) backups.set(path, await optional(join(directory, path)));
  try {
    const originalOwner = await captureOwner(tools); ownerLive = true;
    assert.equal(originalOwner.dirty, false, "The combined fixture supplies a clean original Source before a real restart");
    madeFolder = !await stat(join(directory, folder)).catch(error => { if (error.code === "ENOENT") return null; throw error; }); await mkdir(join(directory, folder), { recursive: true });
    for (const [path, bytes] of inputs) await writeFile(join(directory, path), bytes);
    await evaluate('(async()=>{await app.vault.refresh();await app.metadataCache.refresh();if(!app.core.isEnabled("canvas"))await app.core.setEnabled("canvas",true)})()');
    if (autosave) await evaluate('app.commands.execute("editor:toggle-markdown-autosave")');
    id = await openBoard(tools); owned.add(id); await resourcesReady(tools, id); await trace(tools); traced = true;
    assert.deepEqual(await readFile(join(directory, boardPath)), inputs[0][1]);
    await capture?.("canvas-workflows-exact-sections");
    stage = "dirty section refresh";
    targetId = await evaluate('(async()=>{const leaf=app.workspace.getLeaf("tab");await leaf.setViewState({type:"markdown",state:{file:' + q(targetPath) + ',mode:"source",source:true}});return leaf.id})()'); owned.add(targetId);
    await prepareCanvasPreviewSplit(tools, id, targetId, "heading");
    await focusCanvasPreviewSource(tools);
    await wait('app.workspace.getLeafById(' + q(targetId) + ').view.editor.cm.hasFocus', "owned target Source has trusted text focus");
    await press("Home", "Home", 36, 2); for (let line = 0; line < 4; line++) await press("ArrowDown", "ArrowDown", 40); await press("End", "End", 35);
    assert.equal(await evaluate('app.workspace.getLeafById(' + q(targetId) + ').view.editor.getCursor().line'), 4);
    await command("Input.insertText", { text: " Dirty Canvas section λ." });
    await wait('app.workspace.getLeafById(' + q(targetId) + ').view.session.dirty&&app.metadataCache.getDocument(' + q(targetPath) + ').text.includes("Dirty Canvas section λ.")', "actual dirty target reaches metadata");
    await wait('document.querySelector(' + q(card(id, "heading") + ' .canvas-node-content') + ')?.textContent.includes("Dirty Canvas section λ.")', "exact section follows actual dirty target");
    await assertCanvasPreviewSplit(tools, "simultaneous dirty section Source and Canvas preview");
    assert.deepEqual(await readFile(join(directory, targetPath)), inputs[1][1]);
    await press("z", "KeyZ", 90, 2);
    await wait('app.workspace.getLeafById(' + q(targetId) + ').view.session.text===' + q(targetText), "trusted Undo restores target source exactly");
    await wait('Boolean(document.querySelector(' + q(card(id, "heading") + ' .canvas-node-content') + '))&&!document.querySelector(' + q(card(id, "heading") + ' .canvas-node-content') + ').textContent.includes("Dirty Canvas section λ.")', "exact section follows target Undo");
    await assertCanvasPreviewSplit(tools, "simultaneous exact Source Undo and Canvas section preview");
    assert.deepEqual(await readFile(join(directory, targetPath)), inputs[1][1]);
    await restoreCanvasPreviewSplit(tools);
    await closeOwned(targetId); targetId = null; await click('[data-tab-id=' + q(id) + ']'); await click(action(id, "fit"));
    for (let step = 0; step < 40 && await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-surface]') + ').dataset.canvasDetails!=="visible"'); step++) await click(action(id, "zoom-in"));
    await previews(tools, id);
    stage = "existing-file creation and replacement";
    await click(action(id, "add-note")); await chooseTarget(tools, "note"); await capture?.("canvas-workflows-file-section-review");
    await click(dialog + ' [data-canvas-create-submit]');
    await wait(canvas(id) + '.getData().nodes.length===8', "trusted existing-note chooser creates exactly one card");
    let data = await evaluate(canvas(id) + '.getData()'); const added = data.nodes.find(node => !fixture().nodes.some(old => old.id === node.id));
    assert.equal(added.file, targetPath); assert.equal(added.subpath, "#Chosen");
    await click(action(id, "undo")); assert.equal(await evaluate(canvas(id) + '.getText()'), boardText);
    await click(action(id, "redo")); assert.equal(await evaluate(canvas(id) + '.getData().nodes.length'), 8); await click(action(id, "undo"));
    await click(action(id, "add-media")); await wait('document.querySelector(' + q(dialog) + ')?.open', "real media chooser opens"); await fill(tools, dialog + ' [data-canvas-file-search]', "Pixel.png"); await choose(tools, dialog + ' [data-canvas-create-input="media"]', imagePath);
    assert.equal(await evaluate('document.querySelector(' + q(dialog + ' [data-canvas-subpath]') + ').disabled'), true); await click(dialog + ' [data-canvas-create-submit]'); await wait(canvas(id) + '.getData().nodes.length===8', "actual media chooser creates one real file card"); await click(action(id, "undo")); assert.equal(await evaluate(canvas(id) + '.getText()'), boardText);
    await click(card(id, "heading") + ' > .canvas-node-label');
    if (!await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-inspector]') + ').checkVisibility()')) await click(action(id, "inspector"));
    await click(pane(id) + ' [data-canvas-choose-file="heading"]'); await chooseTarget(tools, "replace", "#^picked"); await click(dialog + ' [data-canvas-create-submit]');
    assert.equal(await evaluate(canvas(id) + '.getData().nodes.find(n=>n.id==="heading").subpath'), "#^picked");
    await click(action(id, "undo")); assert.equal(await evaluate(canvas(id) + '.getText()'), boardText); await clean(tools, id);
    stage = "stale reviewed owner";
    await click(action(id, "add-note")); await chooseTarget(tools, "note");
    await evaluate('(()=>{const c=' + canvas(id) + ',d=c.getData();d.future.held=true;c.setData(d)})()');
    const held = await evaluate(canvas(id) + '.getText()'); await click(dialog + ' [data-canvas-create-submit]');
    await wait('document.querySelector(' + q(dialog + ' [role=alert]') + ').textContent.includes("no longer current")', "stale review refuses before changing a card");
    assert.equal(await evaluate(canvas(id) + '.getText()'), held); await capture?.("canvas-workflows-stale-review"); await click(dialog + ' [data-canvas-create-cancel]'); await click(action(id, "undo")); await clean(tools, id);
    stage = "provider retirement";
    await click(action(id, "add-note")); await chooseTarget(tools, "note");
    await evaluate('globalThis.canvasWorkflowRetiredSubmit=document.querySelector("[data-canvas-file-chooser] [data-canvas-create-submit]")');
    await flushCapture("before Canvas provider retirement");
    await evaluate('app.core.setEnabled("canvas",false)'); await wait('!app.core.busy&&!document.querySelector("[data-canvas-file-chooser]")', "provider disposal retires the actual pending chooser");
    await evaluate('canvasWorkflowRetiredSubmit.click();delete globalThis.canvasWorkflowRetiredSubmit');
    assert.deepEqual(await readFile(join(directory, boardPath)), inputs[0][1]);
    await evaluate('app.core.setEnabled("canvas",true)'); await wait('!app.core.busy&&app.workspace.getLeafById(' + q(id) + ').view.getViewType()==="canvas"', "fresh provider restores the owned Canvas view"); await previews(tools, id); await resourcesReady(tools, id);
    stage = "connection preview";
    if (await evaluate('document.querySelector(' + q(pane(id)) + ').classList.contains("is-compact")&&document.querySelector(' + q(pane(id) + ' [data-canvas-inspector]') + ').checkVisibility()')) await click(action(id, "inspector"));
    await click(action(id, "fit")); await click(card(id, "text") + ' > .canvas-node-label');
    if (!await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-inspector]') + ').checkVisibility()')) await click(action(id, "inspector"));
    const from = await point(tools, card(id, "text") + ' [data-canvas-connect="top"]'), to = await point(tools, card(id, "heading") + ' > .canvas-node-label');
    await click(pane(id) + ' [data-canvas-field="text"]');
    await wait('document.activeElement===document.querySelector(' + q(pane(id) + ' [data-canvas-field="text"]') + ')', "the actual inspector textarea owns focus before the connection handle gesture");
    const connectionHistory = await evaluate('(()=>{const c=' + canvas(id) + ';return{text:c.getText(),past:c.document.past,future:c.document.future,revision:c.revision}})()');
    const dragStart = async () => { await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...from }); await command("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 }); assert.equal(await evaluate('document.activeElement===' + canvas(id) + '.stage'), true, "the genuine connection gesture transfers Escape ownership to its Canvas stage"); await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...to, button: "left", buttons: 1 }); };
    await dragStart(); await wait('document.querySelector(' + q(pane(id) + ' [data-canvas-connection-preview]') + ')?.dataset.canvasConnectionTarget==="heading"', "actual pointer displays valid transient connection preview");
    assert.equal(await evaluate(canvas(id) + '.getData().edges.length'), 1); await capture?.("canvas-workflows-connection-preview");
    await press("Escape", "Escape", 27); await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 });
    assert.equal(await evaluate('Boolean(document.querySelector(' + q(pane(id) + ' [data-canvas-connection-preview]') + '))'), false); assert.equal(await evaluate(canvas(id) + '.getText()'), boardText);
    assert.deepEqual(await evaluate('(()=>{const c=' + canvas(id) + ';return{text:c.getText(),past:c.document.past,future:c.document.future,revision:c.revision}})()'), connectionHistory);
    await dragStart(); await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 });
    await wait(canvas(id) + '.getData().edges.length===2', "release creates one actual undoable connection"); await click(action(id, "undo")); assert.equal(await evaluate(canvas(id) + '.getText()'), boardText);
    stage = "low-zoom resource lifecycle";
    await click(card(id, "text") + ' > .canvas-node-label'); if (!await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-inspector]') + ').checkVisibility()')) await click(action(id, "inspector"));
    await fill(tools, pane(id) + ' [data-canvas-field="text"]', "Retained Canvas draft 😀.");
    const beforeZoom = await evaluate('(()=>{const c=' + canvas(id) + ';return{text:c.getText(),past:c.document.past,future:c.document.future,revision:c.revision}})()');
    await evaluate('(()=>{const c=' + canvas(id) + ',urls=new Set([...c.readings.values()].flatMap(r=>[...r.urls])),original=URL.revokeObjectURL;const t={urls:[...urls],revoked:[],original};t.wrapper=function(...args){const result=Reflect.apply(original,this,args);if(urls.has(args[0]))t.revoked.push(args[0]);return result};URL.revokeObjectURL=t.wrapper;globalThis.canvasWorkflowResources=t})()');
    for (let step = 0; step < 40 && await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-surface]') + ').dataset.canvasDetails!=="hidden"'); step++) await click(action(id, "zoom-out"));
    await wait('(()=>{const c=' + canvas(id) + ';return c.readings.size===0&&c.filePreviews.size===0&&[...c.views.values()].every(n=>n.querySelector(".canvas-node-content").dataset.canvasContent==="suspended")})()', "low zoom retires every actual resource owner");
    assert.equal(await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-field="text"]') + ').value'), "Retained Canvas draft 😀.");
    assert.deepEqual(await evaluate('(()=>{const c=' + canvas(id) + ';return{text:c.getText(),past:c.document.past,future:c.document.future,revision:c.revision}})()'), beforeZoom);
    report.canvasWorkflowsResources = await evaluate('(()=>{const t=canvasWorkflowResources;return{urls:t.urls,revoked:t.revoked,noImageOrFrame:document.querySelector(' + q(pane(id)) + ').querySelector(".canvas-node-content img,.canvas-node-content iframe")===null}})()');
    assert.equal(report.canvasWorkflowsResources.noImageOrFrame, true); assert.ok(report.canvasWorkflowsResources.urls.every(url => report.canvasWorkflowsResources.revoked.includes(url)));
    await capture?.("canvas-workflows-suspended-resources");
    for (let step = 0; step < 40 && await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-surface]') + ').dataset.canvasDetails!=="visible"'); step++) await click(action(id, "zoom-in"));
    await previews(tools, id); await resourcesReady(tools, id); assert.equal(await evaluate('document.querySelector(' + q(card(id, "web")) + ').querySelector("iframe")===null'), true);
    await evaluate('URL.revokeObjectURL=canvasWorkflowResources.original;delete globalThis.canvasWorkflowResources'); await click(action(id, "undo")); await clean(tools, id);
    stage = "narrow existing-file review";
    await click(action(id, "add-note")); await command("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: false }); narrow = true;
    await wait('(()=>{const n=document.querySelector(' + q(dialog + ' [data-canvas-file-search]') + ');n.scrollIntoView({block:"center"});const r=n.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>=100&&(h===n||n.contains(h))})()', "narrow search is physically reachable and uncovered"); await capture?.("canvas-workflows-narrow-files");
    await wait('(()=>{const n=document.querySelector(' + q(dialog + ' [data-canvas-create-cancel]') + ');n.scrollIntoView({block:"center"});const r=n.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&(h===n||n.contains(h))})()', "narrow Cancel is physically reachable and uncovered"); await capture?.("canvas-workflows-narrow-actions"); await click(dialog + ' [data-canvas-create-cancel]');
    await command("Emulation.clearDeviceMetricsOverride"); narrow = false;
    report.canvasWorkflowsInputs = await untrace(tools); traced = false;
    assert.equal(await evaluate(canvas(id) + '.getText()'), boardText); await clean(tools, id);
    for (const [path, bytes] of inputs) assert.deepEqual(await readFile(join(directory, path)), bytes);
    await closeOwned(id); report.canvasWorkflowsSourceBeforeRestart = await restoreOwner(tools); ownerLive = false;
    stage = "real restart and fresh preview";
    await flushCapture("before real Canvas restart"); await evaluate('app.workspace.flushLayout()'); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById(' + q(originalOwner.id) + '),{focus:false})');
    const renewedOwner = await captureOwner(tools); ownerLive = true; assert.equal(renewedOwner.text, originalOwner.text); assert.equal(renewedOwner.dirty, originalOwner.dirty); assert.equal(renewedOwner.path, originalOwner.path);
    id = await openBoard(tools); owned.add(id); await previews(tools, id); assert.equal(await evaluate(canvas(id) + '.getText()'), boardText); await capture?.("canvas-workflows-restarted-sections");
    await closeOwned(id); report.canvasWorkflowsSourceAfterRestart = await restoreOwner(tools); ownerLive = false;
    report.canvasWorkflows = { exactHeadingAndBlockSections: true, dirtyTargetAndUndoRefresh: true, existingFileAndSubpathChooser: true, replacementAndSingleStepUndoRedo: true, staleReviewedOwnerRefused: true, providerRetiredReviewCannotPublish: true, transientPointerPreview: true, escapeCancelsWithoutHistory: true, releaseCreatesOneConnection: true, resourcesActuallyRetiredAndRemounted: true, inspectorDraftAndHistoryRetained: true, websiteDoesNotReloadImplicitly: true, narrowControlsReachable: true, sourceOwnerRetainedBeforeAndAfterRestart: true, restartFreshPreviews: true, exactBOMCRLFUnknownJSONAndReferences: true, trustedPositiveInputs: true, supplementalStaleModelProbeSeparate: true };
    pass(tools, "Canvas exact heading/block previews follow real dirty text and Undo. Searchable existing-file/section creation and replacement, revision-refusing review, real cancellable connection previews and actual low-zoom retirement/remount preserve history, unknown JSON and referenced bytes through narrow layouts and a fresh runtime.");
  } catch (error) { failure = error; report.canvasWorkflowsFailure = { stage, error: String(error?.stack ?? error) }; try { await capture?.("canvas-workflows-precleanup-failure"); } catch {} throw error; }
  finally {
    const errors = [];
    try { if (narrow) await command("Emulation.clearDeviceMetricsOverride"); if (traced) await untrace(tools); await evaluate('(()=>{const t=globalThis.canvasWorkflowResources;if(t){URL.revokeObjectURL=t.original;delete globalThis.canvasWorkflowResources}document.querySelector("[data-canvas-file-chooser] [data-canvas-create-cancel]")?.click();delete globalThis.canvasScenarioPreviewOwner})()'); } catch (error) { errors.push(error); }
    try { for (const leaf of [...owned].reverse()) await closeOwned(leaf); if (ownerLive) { report.canvasWorkflowsSourceCleanup = await restoreOwner(tools); ownerLive = false; } if (await evaluate('app.core.isEnabled("canvas")') !== enabled) { await flushCapture("before Canvas provider cleanup"); await evaluate('app.core.setEnabled("canvas",' + enabled + ')'); } await evaluate('(async()=>{await app.workspace.whenIdle();await app.core.getEnabledPluginById("file-recovery")?.whenIdle();await app.configuration.whenIdle()})()'); } catch (error) { errors.push(error); }
    try { for (const [path] of inputs) await restore(join(directory, path), backups.get(path)); if (madeFolder) await rmdir(join(directory, folder)).catch(error => { if (error.code !== "ENOTEMPTY") throw error; }); await evaluate('(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.core.getEnabledPluginById("file-recovery")?.whenIdle()})()'); for (const path of configNames) await restore(join(directory, path), backups.get(path)); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()'); for (const [path, bytes] of backups) assert.deepEqual(await optional(join(directory, path)), bytes); } catch (error) { errors.push(error); }
    if (errors.length) { report.canvasWorkflowsCleanupErrors = errors.map(error => String(error?.stack ?? error)); if (!failure) throw new AggregateError(errors, "Canvas workflow cleanup failed"); }
  }
}

const cachedFolder = "Cached Canvas authoring", cachedBoard = cachedFolder + "/Board.canvas";
const cachedData = fixture(cachedFolder); cachedData.nodes = cachedData.nodes.filter(node => ["heading", "block", "text", "future"].includes(node.id)); cachedData.edges = [];
export const canvasWorkflowsReadOnlyFixture = Object.freeze({ source: "\n\n## Cached Canvas authoring\nThe existing Canvas is available from Files.\n", files: [[cachedBoard, "\ufeff" + JSON.stringify(cachedData, null, 2) + "\n"], [cachedFolder + "/Target α.md", "\ufeff" + targetText]] });

async function readOnlyNavigationState(tools, filesId) {
  return tools.evaluate('(()=>{const w=app.workspace,o=globalThis.canvasWorkflowOwner,files=app.vault.getFiles(),board=app.vault.getFileByPath(' + q(cachedBoard) + '),leaf=w.getLeafById(' + q(filesId ?? null) + '),view=leaf?.view,panel=view?.contentEl,legacy=document.querySelector("#file-explorer-view"),rows=panel?[...panel.querySelectorAll("[data-explorer-path]")]:[],rect=n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,left:r.left,top:r.top}},row=n=>({path:n.dataset.explorerPath??n.dataset.notePath??n.dataset.folderPath,notePath:n.dataset.notePath??null,disabled:n.disabled,ariaDisabled:n.getAttribute("aria-disabled"),expanded:n.getAttribute("aria-expanded"),visible:n.checkVisibility(),bounds:rect(n)});return{root:app.vault.rootPath,readOnly:app.vault.readOnly,boardPresent:Boolean(board&&files.includes(board)),boardExtension:board?.extension,canvasViewType:w.viewTypeForExtension("canvas"),canvasCreator:typeof w.registeredViewCreators.canvas==="function",filesCreator:typeof w.registeredViewCreators["file-explorer"]==="function",canvasEnabled:app.core.isEnabled("canvas"),filesEnabled:app.core.isEnabled("file-explorer"),sourceOwnerAlive:Boolean(o&&w.getLeafById(o.leaf.id)===o.leaf&&o.leaf.view===o.view&&o.view.isLoaded&&o.view.editor===o.editor&&o.editor.cm===o.cm&&o.cm.state.doc===o.doc&&o.view.session===o.session&&o.session.document===o.saved&&o.session.text===o.text&&o.session.dirty===o.dirty),inventory:{count:files.length,truncated:files.length>250,files:files.slice(0,250).map(f=>({path:f.path,extension:f.extension,viewType:w.viewTypeForExtension(f.extension)}))},registry:[...w.extensions].map(([extension,binding])=>({extension,owner:binding.owner,type:binding.type})),index:{complete:app.vault.indexComplete,count:app.metadataCache.getDocuments().length,issueCount:app.metadataCache.getIssues().length,pending:Boolean(app.metadataCache.pending)},legacy:{visible:Boolean(legacy?.checkVisibility()),folders:[...legacy?.querySelectorAll("details[data-folder-path]")??[]].filter(n=>n.dataset.folderPath===' + q(cachedFolder) + ').map(n=>({path:n.dataset.folderPath,open:n.open,visible:n.checkVisibility()})),rows:[...legacy?.querySelectorAll("[data-note-path]")??[]].filter(n=>n.dataset.notePath.startsWith(' + q(cachedFolder + "/") + ')).map(row)},registered:{id:leaf?.id,type:view?.getViewType(),loaded:view?.isLoaded,currentRoot:view?.sourceRoot===app.vault.rootPath,visible:Boolean(panel?.checkVisibility()),queued:Boolean(view?.queued),rows:rows.slice(0,250).map(row),rowCount:rows.length,truncated:rows.length>250},leaves:w.leaves().map(l=>({id:l.id,type:l.view.getViewType(),path:l.view.file?.path??null,visible:l.containerEl.checkVisibility()})),counters:(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()}})()');
}

export async function checkCanvasWorkflowsReadOnly(tools) {
  const { evaluate, click, wait, report, capture } = tools; let id, filesId, ownerLive = false, failure;
  assert.equal(await evaluate('app.vault.readOnly'), true);
  const before = await evaluate(documents), originalDocument = await evaluate('(async()=>{const d=await app.vault.readDocument(' + q(cachedBoard) + ');return{content:d.content,version:d.version,bom:d.hasBom}})()'), bytes = originalDocument.content;
  try {
    await captureOwner(tools); ownerLive = true;
    report.canvasWorkflowsReadOnlyNavigationBefore = await readOnlyNavigationState(tools);
    for (const key of ["boardPresent", "canvasCreator", "filesCreator", "canvasEnabled", "filesEnabled", "sourceOwnerAlive"]) assert.equal(report.canvasWorkflowsReadOnlyNavigationBefore[key], true, "Genuine cached Files prerequisite: " + key);
    assert.equal(report.canvasWorkflowsReadOnlyNavigationBefore.canvasViewType, "canvas");
    filesId = await evaluate('app.workspace.getLeaf("tab").id');
    await evaluate('app.workspace.getLeafById(' + q(filesId) + ').setViewState({type:"file-explorer",state:{showSearch:false,searchQuery:"",collapsedFolders:[' + q(cachedFolder) + '],autoReveal:false},active:true})');
    const filesPane = '[data-file-explorer=' + q(filesId) + ']', folderRow = filesPane + ' [data-explorer-path=' + q(cachedFolder) + ']', boardRow = filesPane + ' [data-explorer-path=' + q(cachedBoard) + ']';
    await wait('(()=>{const leaf=app.workspace.getLeafById(' + q(filesId) + '),n=document.querySelector(' + q(folderRow) + ');return leaf?.view.getViewType()==="file-explorer"&&leaf.view.isLoaded&&!leaf.view.queued&&!app.core.busy&&n?.checkVisibility()&&!n.disabled&&n.getAttribute("aria-expanded")==="false"})()', "the actual registered Files view exposes its collapsed cached folder");
    await click(folderRow);
    await wait('(()=>{const n=document.querySelector(' + q(boardRow) + '),folder=document.querySelector(' + q(folderRow) + ');return folder?.getAttribute("aria-expanded")==="true"&&n?.checkVisibility()&&!n.disabled&&n.getAttribute("aria-disabled")!=="true"&&app.workspace.viewTypeForExtension("canvas")==="canvas"&&!app.core.busy})()', "genuine folder expansion exposes the current enabled cached Canvas row");
    report.canvasWorkflowsReadOnlyNavigationReady = await readOnlyNavigationState(tools, filesId);
    assert.equal(report.canvasWorkflowsReadOnlyNavigationReady.sourceOwnerAlive, true);
    await evaluate('(()=>{if(globalThis.canvasWorkflowReadOnlyPointer)throw Error("Cached Canvas pointer observer already exists");const leaf=app.workspace.getLeafById(' + q(filesId) + '),view=leaf.view,row=document.querySelector(' + q(boardRow) + '),file=app.vault.getFileByPath(' + q(cachedBoard) + '),root=app.vault.rootPath,t=globalThis.canvasWorkflowReadOnlyPointer={abort:new AbortController(),events:[]};document.addEventListener("click",event=>{t.events.push({trusted:event.isTrusted,ctrlKey:event.ctrlKey,targetOwned:event.target===row||row.contains(event.target),currentFilesOwner:app.workspace.getLeafById(' + q(filesId) + ')===leaf&&leaf.view===view&&view.contentEl.contains(row),currentRoot:app.vault.rootPath===root,currentFile:app.vault.getFileByPath(' + q(cachedBoard) + ')===file,path:event.target.closest?.("[data-explorer-path]")?.dataset.explorerPath??null})},{capture:true,signal:t.abort.signal})})()');
    try { await click(boardRow, 2); }
    finally { report.canvasWorkflowsReadOnlyNavigationPointer = await evaluate('(()=>{const t=canvasWorkflowReadOnlyPointer;t.abort.abort();delete globalThis.canvasWorkflowReadOnlyPointer;return t.events})()'); }
    assert.equal(report.canvasWorkflowsReadOnlyNavigationPointer.length, 1);
    for (const [key, value] of Object.entries(report.canvasWorkflowsReadOnlyNavigationPointer[0])) if (key !== "path") assert.equal(value, true, "Actual cached Files Ctrl-click: " + key);
    assert.equal(report.canvasWorkflowsReadOnlyNavigationPointer[0].path, cachedBoard);
    await wait('app.workspace.activeLeaf.view.getViewType()==="canvas"&&app.workspace.getActiveFile()?.path===' + q(cachedBoard), "one trusted modified registered Files click opens cached Canvas in its own tab"); id = await evaluate('app.workspace.activeLeaf.id'); assert.notEqual(id, filesId); assert.notEqual(id, await evaluate('canvasWorkflowOwner.leaf.id'));
    await previews(tools, id);
    const modelBefore = await evaluate(canvas(id) + '.getText()');
    const controls = await evaluate('(()=>{const p=document.querySelector(' + q(pane(id)) + ');return["text-card","file-card","add-note","add-media","connect","delete","undo","redo"].map(a=>({action:a,disabled:p.querySelector("[data-canvas-action="+JSON.stringify(a)+"]").disabled}))})()'); assert.ok(controls.every(control => control.disabled));
    const disabled = await point(tools, action(id, "add-note")); for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, ...disabled, button: "left", clickCount: 1 });
    assert.equal(await evaluate('document.querySelector("[data-canvas-file-chooser]")===null'), true);
    const refusal = await evaluate('(()=>{const c=' + canvas(id) + ';let refusal;try{c.setData({...c.getData(),future:{forbidden:true}})}catch(e){refusal=e.message}c.undo();c.redo();return{refusal,source:c.getText(),canUndo:c.document.canUndo,canRedo:c.document.canRedo}})()');
    assert.match(refusal.refusal, /read-only/); assert.equal(refusal.source, modelBefore); assert.equal(refusal.canUndo, false); assert.equal(refusal.canRedo, false);
    await capture?.("canvas-workflows-readonly-sections");
    for (let step = 0; step < 40 && await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-surface]') + ').dataset.canvasDetails!=="hidden"'); step++) await click(action(id, "zoom-out"));
    assert.equal(await evaluate(canvas(id) + '.filePreviews.size'), 0);
    for (let step = 0; step < 40 && await evaluate('document.querySelector(' + q(pane(id) + ' [data-canvas-surface]') + ').dataset.canvasDetails!=="visible"'); step++) await click(action(id, "zoom-in")); await previews(tools, id);
    assert.equal(await evaluate(canvas(id) + '.getText()'), modelBefore); assert.equal(modelBefore, bytes); assert.deepEqual(await evaluate(documents), before);
    assert.deepEqual(await evaluate('(async()=>{const d=await app.vault.readDocument(' + q(cachedBoard) + ');return{content:d.content,version:d.version,bom:d.hasBom}})()'), originalDocument);
    assert.deepEqual(await evaluate('(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), { api: 0, raw: 0 });
    await closeLeaf(tools, id); id = null; await closeLeaf(tools, filesId); filesId = null; report.canvasWorkflowsReadOnlyOwnerRestored = await restoreOwner(tools); ownerLive = false;
    report.canvasWorkflowsReadOnly = { genuineCachedMount: true, exactHeadingBlockSections: true, mutationControlsDisabled: true, trustedDisabledPointer: true, supplementalDirectMutationRefused: true, noHistoryMutation: true, realLowZoomRetirementAndRemount: true, noSourceMutation: true, exactDocumentsVersionsBOM: true, zeroApiRaw: true, originalSourceOwnerRetained: true };
    report.canvasWorkflowsReadOnlyProof = { controls, sourceSha256: hash(Buffer.from(modelBefore)), sourceBytes: Buffer.byteLength(modelBefore) };
    pass(tools, "A genuine complete cached read-only Canvas renders exact heading/block sections and retires/remounts preview resources without API/raw fetches. Actual disabled controls and separate direct-method probes refuse edits/history while the original Source leaf, CM, document/session and cached bytes remain exact.");
  } catch (error) { failure = error; report.canvasWorkflowsReadOnlyFailure = { error: String(error?.stack ?? error) }; try { report.canvasWorkflowsReadOnlyFailure.navigation = await readOnlyNavigationState(tools, filesId); } catch (diagnosticError) { report.canvasWorkflowsReadOnlyFailure.navigationError = String(diagnosticError?.stack ?? diagnosticError); } throw error; }
  finally { try { await closeLeaf(tools, id); await closeLeaf(tools, filesId); if (ownerLive) report.canvasWorkflowsReadOnlyOwnerRestored = await restoreOwner(tools); } catch (error) { if (!failure) throw error; report.canvasWorkflowsReadOnlyFailure.cleanupError = String(error?.stack ?? error); } }
}
