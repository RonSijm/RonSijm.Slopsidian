import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text), id = "selected-trash-files", note = "selected-trash-note";
const pane = `[data-file-explorer=${q(id)}]`, modal = "[data-explorer-trash]", control = name => `${modal} [data-explorer-trash-${name}]`;
const action = name => `${pane} [data-explorer-action=${q(name)}]`, row = path => `${pane} [data-explorer-path=${q(path)}]`;
const pass = (tools, message) => { tools.report.checks.push(message); console.log("PASS " + message); };
async function key(tools, value, code, number, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await tools.command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode: number, modifiers });
}
async function select(tools, paths) {
  if (await tools.evaluate(`document.querySelector(${q(action("select-notes"))})?.getAttribute("aria-pressed")!=="true"`)) await tools.click(action("select-notes"));
  if (await tools.evaluate(`document.querySelector(${q(action("clear-selection"))})?.disabled===false`)) await tools.click(action("clear-selection"));
  for (const [index, path] of paths.entries()) await tools.click(row(path), index ? 2 : 0);
  assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(pane + ' [data-explorer-selected="true"]')})].map(row=>row.dataset.explorerPath))()`), paths);
}
async function open(tools, paths) {
  await select(tools, paths); await tools.click(action("trash-selected")); await tools.wait(`Boolean(document.querySelector(${q(modal)}))`, "the explicit vault-trash dialog opens");
  assert.equal(await tools.evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true);
  await tools.click(control("review"));
}
async function reviewed(tools, paths) {
  await tools.wait(`document.querySelector(${q(control("confirm"))})?.disabled===false`, "current saved note versions were reviewed");
  assert.deepEqual(await tools.evaluate(`(()=>[...document.querySelectorAll(${q(control("preview") + " li")})].map(row=>row.textContent))()`), paths.map(path => path + " → .trash"));
}
async function trashContents(directory) {
  const entries = [];
  async function visit(path) {
    for (const item of await readdir(path, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; })) {
      const full = join(path, item.name); if (item.isDirectory()) await visit(full); else if (item.isFile()) entries.push(await readFile(full));
    }
  }
  await visit(join(directory, ".trash")); return entries;
}

/** Physical file, history/view lifetime and actual Files controls on both hosts. */
export async function checkExplorerTrash(tools) {
  const { directory, evaluate, wait, click, command, capture, restart, afterReload, report } = tools;
  const base = "Files trash", a = base + "/A λ.md", b = base + "/B.md", c = base + "/C.md", d = base + "/D.md", links = base + "/Links.md", asset = base + "/kept.bin";
  const texts = new Map([[a, bytes("# Alpha λ\r\n\r\nKeep exact 😀 source.\r\n")], [b, bytes("# Beta\r\n\r\nSecond Ω source.\r\n")], [c, bytes("# Partial first\r\n")], [d, bytes("# Partial second\r\n")], [links, bytes("# Links\r\n\r\n[[A λ]] [[B]] ![[kept.bin]]\r\n")], [asset, Buffer.from([0,255,13,10])]]);
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const previous = await evaluate("app.workspace.getLayout()"), sidebar = await evaluate('app.workspace.getViewOptions("sidebars")'), enabled = await evaluate('app.core.isEnabled("file-explorer")'), autosave = await evaluate("app.markdownAutosave.enabled");
  const layout = { version: 1, main: { id: "selected-trash-main", type: "split", direction: "vertical", children: [
    { id: "selected-trash-files-tabs", type: "tabs", dimension: 45, currentTab: 0, children: [{ id, type: "leaf", state: { type: "file-explorer", pinned: true, state: { showSearch: true, searchQuery: base, opaque: { keep: "trash review" } } } }] },
    { id: "selected-trash-note-tabs", type: "tabs", dimension: 55, currentTab: 0, children: [{ id: note, type: "leaf", state: { type: "markdown", pinned: true, state: { file: a, mode: "source", source: true } } }] },
  ] }, active: id };
  const exact = async paths => { for (const path of paths) assert.deepEqual(await readFile(join(directory, path)), texts.get(path), path); };
  const sameTrash = async before => assert.deepEqual((await trashContents(directory)).map(value => value.toString("hex")).sort(), before.map(value => value.toString("hex")).sort());
  const oldTrash = await trashContents(directory); let failure, stage = "fixture";
  const restore = '(()=>{const t=globalThis.selectedTrashTrace;if(t?.info)app.vault.getFileInfo=t.info;t?.release?.();t?.abort?.abort();return true})()';
  try {
    if (!enabled) await evaluate('app.core.setEnabled("file-explorer",true)'); if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
    await mkdir(join(directory, base)); for (const [path, content] of texts) await writeFile(join(directory, path), content, { flag: "wx" });
    await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
    await wait(`app.workspace.getLeafById(${q(id)})?.view.getViewType()==="file-explorer"&&document.querySelector(${q(pane + " select")})?.disabled===false`, "the actual Files pane is interactive");
    await evaluate('(()=>{const t=globalThis.selectedTrashTrace={trusted:[],abort:new AbortController()};document.addEventListener("click",e=>{const el=e.target.closest?.("[data-explorer-action=trash-selected],[data-explorer-trash-review],[data-explorer-trash-confirm],[data-explorer-trash-cancel]");if(el)t.trusted.push({trusted:e.isTrusted,action:el.dataset.explorerAction??el.textContent})},{capture:true,signal:t.abort.signal});return true})()');
    stage = "review and cancel"; await open(tools, [a,b]); await reviewed(tools, [a,b]); await exact([...texts.keys()]); await sameTrash(oldTrash); await capture?.("explorer-trash-review");
    await click(control("cancel")); await wait(`!document.querySelector(${q(modal)})`, "cancel closes vault trash without mutations"); await exact([...texts.keys()]); await sameTrash(oldTrash);
    pass(tools, "Trusted Files selection and review list exact saved Markdown paths to vault-local .trash. Review and cancellation neither save drafts nor change source/attachments/inventory/trash bytes.");

    stage = "dirty selected note";
    await command("Page.bringToFront"); await evaluate(`(()=>{const leaf=app.workspace.getLeafById(${q(note)});app.workspace.setActiveLeaf(leaf);leaf.view.setEditingMode("source",false);leaf.view.editor.setCursor(0,0);leaf.view.editor.focus()})()`);
    await wait(`app.workspace.getLeafById(${q(note)})?.view.editor.cm.hasFocus`, "the real selected-note source editor is focused"); await command("Input.insertText", { text: "Dirty " });
    assert.equal(await evaluate(`app.workspace.sessions.get(${q(a)}).dirty`), true);
    await open(tools, [a,b]); await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("Save the selected notes")`, "dirty selected notes refuse review");
    assert.equal(await evaluate(`document.querySelector(${q(control("confirm"))}).disabled`), true); await exact([a,b]); await click(control("cancel"));
    await evaluate(`(async()=>{const leaf=app.workspace.getLeafById(${q(note)});leaf.view.editor.undo();await app.saveAll();await app.workspace.whenIdle();await app.metadataCache.refresh()})()`); await exact([a,b]);
    pass(tools, "A genuinely dirty selected editor refuses trash review and keeps its physical saved bytes. Normal source Undo/Save restores the draft before a fresh review; no hidden autosave or deletion is used to make review succeed.");

    stage = "reviewed version replacement"; await open(tools,[a,b]); await reviewed(tools,[a,b]);
    const external = bytes("# Newer external λ\r\n\r\nExternal replacement 😀 must remain.\r\n"); await writeFile(join(directory,a),external);
    await click(control("confirm")); await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("Confirmed 0 of 2")&&!app.workspace.isChangingFiles`, "stale reviewed versions refuse before trash");
    assert.deepEqual(await readFile(join(directory,a)),external); await exact([b,links,asset]); await sameTrash(oldTrash); await capture?.("explorer-trash-stale"); await click(control("cancel"));
    await writeFile(join(directory,a),texts.get(a)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.workspace.whenIdle()})()");
    pass(tools, "An independent physical replacement after review makes the real FileManager refuse the saved version before moving any note. Its newer BOM/CRLF/Unicode bytes, remaining note, attachments and incoming references are retained.");

    stage = "two normal vault removals"; await open(tools,[a,b]); await reviewed(tools,[a,b]); await click(control("confirm"));
    await wait(`!document.querySelector(${q(modal)})&&!app.workspace.isChangingFiles&&!app.vault.getFileByPath(${q(a)})&&!app.vault.getFileByPath(${q(b)})`, "two genuine vault-trash operations finish");
    await exact([c,d,links,asset]); const firstTrash = await trashContents(directory);
    for (const path of [a,b]) { await assert.rejects(readFile(join(directory,path)),{code:"ENOENT"}); assert.ok(firstTrash.some(value=>value.equals(texts.get(path))), "the exact selected note is recoverable in real .trash"); }
    assert.equal(await evaluate(`app.workspace.leaves().some(leaf=>[${q(a)},${q(b)}].includes(leaf.view.file?.path))`),false);
    assert.ok(await evaluate(`document.querySelector(${q(pane + " [role=status]")})?.textContent.includes("Confirmed 2 of 2")`)); await capture?.("explorer-trash-complete");
    pass(tools, "Two genuine versioned FileManager removals put exact BOM/CRLF/Unicode note bytes in the physical .trash folder and close removed-note views. Incoming links, other notes and binary attachments stay exact; the actual Files pane reports both acknowledgements.");

    stage = "later partial refusal"; await open(tools,[c,d]); await reviewed(tools,[c,d]);
    await evaluate(`(()=>{const t=selectedTrashTrace;t.info=app.vault.getFileInfo;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.getFileInfo=async function(file){if(file.path===${q(d)}){t.waiting=true;await t.gate;throw Error("Second selected trash version read refused")}return t.info.call(this,file)};return true})()`);
    await click(control("confirm")); await wait("selectedTrashTrace.waiting", "the actual second removal waits after the first acknowledgement");
    assert.equal(await evaluate(`Boolean(app.vault.getFileByPath(${q(c)}))`),false); assert.equal(await evaluate(`Boolean(app.vault.getFileByPath(${q(d)}))`),true);
    for (const name of ["review","confirm","cancel"]) assert.equal(await evaluate(`document.querySelector(${q(control(name))}).disabled`),true);
    await key(tools,"Escape","Escape",27); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`),true);
    await evaluate("app.vault.getFileInfo=selectedTrashTrace.info;selectedTrashTrace.release();delete selectedTrashTrace.info");
    await wait(`document.querySelector(${q(control("status"))})?.textContent.includes("Confirmed 1 of 2")&&!app.workspace.isChangingFiles&&!document.querySelector(${q(control("cancel"))}).disabled`, "partial removal report is settled and closable");
    await exact([d,links,asset]); assert.ok((await trashContents(directory)).some(value=>value.equals(texts.get(c))));
    for (const name of ["review","confirm"]) assert.equal(await evaluate(`document.querySelector(${q(control(name))}).disabled`),true); await capture?.("explorer-trash-partial"); await click(control("cancel"));
    pass(tools, "A held real second-removal version read fails after the first acknowledged trash. Busy controls/Escape cannot dismiss it; the dialog reports 1 of 2, preserves the first exact trash copy and second original, disables replay, and leaves attachments/links untouched.");

    stage = "restart"; report.explorerTrashTrusted = await evaluate("selectedTrashTrace.trusted"); assert.ok(report.explorerTrashTrusted.length>=10 && report.explorerTrashTrusted.every(event=>event.trusted));
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getLeafById(${q(id)})?.view.getViewType()==="file-explorer"&&!app.workspace.isChangingLayout`, "Files returns after actual process restart/reconnection"); await exact([d,links,asset]);
    for (const path of [a,b,c]) { assert.equal(await evaluate(`Boolean(app.vault.getFileByPath(${q(path)}))`),false); assert.ok((await trashContents(directory)).some(value=>value.equals(texts.get(path)))); }
    assert.equal(await evaluate(`document.querySelector(${q(action("select-notes"))}).getAttribute("aria-pressed")`),"false"); await capture?.("explorer-trash-restored");
    report.explorerTrash = { actualReviewCancelAndConfirm:true, exactSavedVersions:true, reviewDoesNotSaveDrafts:true, dirtySelectionRefused:true, physicalReplacementRetained:true, twoRealVaultTrashOperations:true, removedViewsClosed:true, exactTrashBytes:true, incomingLinksAndAttachmentsKept:true, partialRealSecondFailure:true, busyEscapeRefused:true, noPlanReplay:true, restart:true, transientSelectionReset:true };
    pass(tools, "Full native restart or real-folder browser reconnection retains completed removals, each exact recoverable trash copy and the remaining note/attachments/links. Files preferences restore with no old selection or reviewed trash plan.");
  } catch (error) {
    failure=error; report.explorerTrashFailure={stage,error:String(error?.stack??error)};
    try { report.explorerTrashFailure.state=await evaluate(`({active:app.workspace.activeLeaf?.id,changingFiles:app.workspace.isChangingFiles,modal:document.querySelector(${q(modal)})?.textContent,inventory:app.vault.getFiles().map(file=>file.path).filter(path=>path.startsWith(${q(base+"/")}))})`); await capture?.("explorer-trash-precleanup-failure"); } catch { /* Keep the first failure. */ } throw error;
  } finally {
    const errors=[];
    try { await evaluate(restore); await wait("!app.workspace.isChangingFiles","trash cleanup releases its file operation"); await evaluate(`app.workspace.getLeafById(${q(id)})?.view.selectionModal?.dispose()`); } catch(error) { errors.push(error); }
    try { await evaluate(`(async()=>{await app.saveAll();await app.workspace.changeLayout(${q(previous)});app.workspace.setViewOptions("sidebars",${q(sidebar)});app.sidebars.restore();await app.workspace.flushLayout();if(app.core.isEnabled("file-explorer")!==${enabled})await app.core.setEnabled("file-explorer",${enabled});await app.markdownAutosave.setEnabled(${autosave});delete globalThis.selectedTrashTrace})()`); } catch(error) { errors.push(error); }
    if (!failure && errors.length) throw new AggregateError(errors,"Could not restore the selected vault-trash runtime fixture.");
  }
}

/** Real cache-only mounting, index and blob audits belong to the combined scope. */
export async function checkExplorerTrashReadOnly(tools) {
  await tools.evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)');
  const previous=await tools.evaluate("app.workspace.getLayout()"), ro="selected-trash-readonly";
  const layout={version:1,main:{id:"selected-trash-ro-main",type:"split",direction:"vertical",children:[{id:"selected-trash-ro-tabs",type:"tabs",currentTab:0,children:[{id:ro,type:"leaf",state:{type:"file-explorer",state:{}}}]}]},active:ro};
  const inventory=await tools.evaluate("app.vault.getFiles().map(file=>file.path).sort()"); assert.equal(await tools.evaluate("app.vault.readOnly"),true);
  try {
    await tools.evaluate(`app.workspace.changeLayout(${q(layout)})`); const base=`[data-file-explorer=${q(ro)}]`;
    await tools.wait(`document.querySelector(${q(base+" select")})?.disabled===false`,"cache-only Files is interactive"); await tools.click(base+' [data-explorer-action="select-notes"]');
    for (const [index,path] of ["Known target.md","Read only.md"].entries()) await tools.click(base+` [data-explorer-path=${q(path)}]`,index?2:0);
    const selector=base+' [data-explorer-action="trash-selected"]'; assert.equal(await tools.evaluate(`document.querySelector(${q(selector)}).disabled`),true);
    const point=await tools.evaluate(`(()=>{const el=document.querySelector(${q(selector)});el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===el}})()`); assert.equal(point.hit,true);
    for(const type of ["mousePressed","mouseReleased"]) await tools.command("Input.dispatchMouseEvent",{type,x:point.x,y:point.y,button:"left",clickCount:1});
    assert.equal(await tools.evaluate(`Boolean(document.querySelector(${q(modal)}))`),false); assert.deepEqual(await tools.evaluate("app.vault.getFiles().map(file=>file.path).sort()"),inventory); await tools.capture?.("explorer-trash-readonly");
    tools.report.explorerTrashReadOnly={genuineCacheOnly:true,actualSelection:true,disabledTrash:true,trustedPointerRefused:true,inventoryExact:true};
    pass(tools,"Actual cache-only Markdown selection keeps vault trash disabled; trusted pointer input opens no review and leaves the real inventory exact. The combined fixture audits every cached blob and zero network requests.");
  } finally { await tools.evaluate(`app.workspace.changeLayout(${q(previous)})`); }
}
