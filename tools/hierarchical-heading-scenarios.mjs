import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const q = JSON.stringify, popup = '[data-builtin-suggest="source"]:popover-open';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const invoke = (body, ...args) => `(${body.toString()})(${args.map(q).join(",")})`;

function rememberMissingHeading(path, target, mode, typed, saved, targetText) {
  if (globalThis.hierarchicalNegativeOwner) throw Error("A hierarchical negative owner is already retained");
  const leaf = app.workspace.activeLeaf, view = leaf.view, editor = view.editor, cm = editor.cm, session = view.session, file = view.file, indexed = app.metadataCache.getDocument(target), targetFile = app.vault.getFileByPath(target), builtin = app.editorSuggestions.suggests.find(value => value.containerEl.dataset.builtinSuggest === "source");
  if (!builtin || view.getEditingMode() !== mode || file?.path !== path || app.workspace.activeEditor !== view || !cm.hasFocus || !cm.state.selection.main.empty || session.text !== typed || editor.getValue() !== typed || session.document.content !== saved || !session.dirty || indexed?.text !== targetText || !targetFile) throw Error("The real typed Source and target must be current before the hierarchy probe");
  const commands = app.plugins.modules["@codemirror/commands"], select = builtin.selectSuggestion, targetSession = app.workspace.sessions.get(target);
  const owner = globalThis.hierarchicalNegativeOwner = { leaf, view, editor, cm, document:cm.state.doc, session, saved:session.document, sourceVersion:session.document.version, sourceBOM:session.document.hasBom, file, root:app.vault.rootPath, mode, typed, savedText:saved, targetFile, targetText, targetVersion:indexed.document.version, targetBOM:indexed.document.hasBom, targetSession, targetSessionText:targetSession?.text, targetSessionDocument:targetSession?.document, targetSessionDirty:targetSession?.dirty, selection:JSON.stringify(cm.state.selection.toJSON()), undo:commands.undoDepth(cm.state), redo:commands.redoDepth(cm.state), history:JSON.stringify(leaf.history), historyIndex:leaf.historyIndex, inventory:JSON.stringify(app.vault.getFiles().map(file => file.path).sort()), builtin, select, selectDescriptor:Object.getOwnPropertyDescriptor(builtin,"selectSuggestion"), accepted:0 };
  owner.selectObserver = function(...args) { owner.accepted++; return Reflect.apply(select, this, args); };
  builtin.selectSuggestion = owner.selectObserver;
  return { sourceVersion:session.document.version,sourceBOM:session.document.hasBom,targetVersion:owner.targetVersion,targetBOM:owner.targetBOM,undo:owner.undo,redo:owner.redo };
}
function enumerateMissingHeading() {
  const owner = hierarchicalNegativeOwner, hooks = [], calls = [], result = {calls,choices:[],hookCount:0,hooksRestored:false};
  const wrap = (receiver, name, label) => { const original = receiver[name], descriptor = Object.getOwnPropertyDescriptor(receiver,name); if (typeof original !== "function") throw Error("Missing observed completion boundary " + label); const observer = function(...args) { calls.push(label); return Reflect.apply(original, this, args); }; receiver[name] = observer; hooks.push({receiver,name,original,descriptor,observer}); };
  try {
    for (const name of ["read", "cachedRead", "readDocument", "readBinary", "writeDocument", "create", "modify", "process", "rename", "delete"]) wrap(app.vault, name, "vault." + name);
    for (const name of ["read", "write"]) wrap(app.configuration, name, "configuration." + name);
    wrap(globalThis, "fetch", "fetch");
    const cursor = owner.editor.getCursor(), values = owner.builtin.getSuggestions({editor:owner.editor,file:owner.file,start:cursor,end:cursor,query:""});
    if (!Array.isArray(values)) throw Error("The builtin heading enumeration must remain synchronous");
    result.choices = values.map(value => ({payload:{kind:value.kind,path:value.path,heading:value.heading,subpath:value.subpath,parents:value.parents},keys:Object.keys(value).sort(),targetIdentity:value.target === owner.targetFile,targetTextExact:value.targetText === owner.targetText})); return result;
  } finally {
    const changed = hooks.some(hook => hook.receiver[hook.name] !== hook.observer);
    for (const hook of hooks.reverse()) if (hook.receiver[hook.name] === hook.observer) { if (hook.descriptor) Object.defineProperty(hook.receiver,hook.name,hook.descriptor); else delete hook.receiver[hook.name]; }
    result.hookCount = hooks.length; result.hooksRestored = hooks.every(hook => hook.receiver[hook.name] === hook.original && Boolean(Object.getOwnPropertyDescriptor(hook.receiver,hook.name)) === Boolean(hook.descriptor));
    if (changed) throw Error("A completion IO observer changed ownership");
  }
}
function missingHeadingOwner() {
  const o = hierarchicalNegativeOwner, w = app.workspace, m = app.plugins.modules["@codemirror/commands"], indexed = app.metadataCache.getDocument(o.targetFile.path);
  return {activeOwner:w.activeLeaf === o.leaf && w.activeEditor === o.view,sameLeaf:w.getLeafById(o.leaf.id) === o.leaf,sameView:o.leaf.view === o.view,sameEditor:o.view.editor === o.editor,sameCM:o.editor.cm === o.cm,sameDocument:o.cm.state.doc === o.document,sameSession:o.view.session === o.session,sameSavedDocument:o.session.document === o.saved,sourceFileExact:o.view.file === o.file && app.vault.getFileByPath(o.file.path) === o.file,rootCurrent:app.vault.rootPath === o.root,modeExact:o.view.getEditingMode() === o.mode,focusRetained:o.cm.hasFocus,sourceTextExact:o.editor.getValue() === o.typed && o.session.text === o.typed,savedTextExact:o.session.document.content === o.savedText,dirtyRetained:o.session.dirty === true,selectionExact:JSON.stringify(o.cm.state.selection.toJSON()) === o.selection,undoRedoExact:m.undoDepth(o.cm.state) === o.undo && m.redoDepth(o.cm.state) === o.redo,navigationHistoryExact:JSON.stringify(o.leaf.history) === o.history && o.leaf.historyIndex === o.historyIndex,sourceVersionExact:o.session.document.version === o.sourceVersion,sourceBOMRetained:o.saved.hasBom === true && o.saved.hasBom === o.sourceBOM,targetFileExact:app.vault.getFileByPath(o.targetFile.path) === o.targetFile,targetTextExact:indexed?.text === o.targetText,targetVersionExact:indexed?.document.version === o.targetVersion,targetBOMExact:indexed?.document.hasBom === o.targetBOM,targetSessionExact:app.workspace.sessions.get(o.targetFile.path) === o.targetSession && o.targetSession?.text === o.targetSessionText && o.targetSession?.document === o.targetSessionDocument && o.targetSession?.dirty === o.targetSessionDirty,inventoryExact:JSON.stringify(app.vault.getFiles().map(file => file.path).sort()) === o.inventory,noAcceptedSuggestion:o.accepted === 0,selectionObserverCurrent:o.builtin.selectSuggestion === o.selectObserver};
}
function releaseMissingHeading() {
  const owner = globalThis.hierarchicalNegativeOwner;
  if (!owner) return true;
  const current = owner.builtin.selectSuggestion === owner.selectObserver;
  if (current) { if (owner.selectDescriptor) Object.defineProperty(owner.builtin,"selectSuggestion",owner.selectDescriptor); else delete owner.builtin.selectSuggestion; }
  delete globalThis.hierarchicalNegativeOwner;
  if (!current) throw Error("The hierarchical selection observer changed ownership");
  return true;
}

function visibleHeading(line, duplicateLine) {
  const view = app.workspace.activeLeaf.view, root = view.previewEl, rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
  const heading = root.querySelector(`h1[data-source-line="${line}"],h2[data-source-line="${line}"],h3[data-source-line="${line}"],h4[data-source-line="${line}"],h5[data-source-line="${line}"],h6[data-source-line="${line}"]`);
  let bounds = { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
  for (let owner = root; owner; owner = owner.parentElement) {
    const style = getComputedStyle(owner), box = rect(owner);
    if (owner === root || /auto|scroll|hidden|clip/.test(style.overflowY)) { bounds.top = Math.max(bounds.top, box.top); bounds.bottom = Math.min(bounds.bottom, box.bottom); }
    if (owner === root || /auto|scroll|hidden|clip/.test(style.overflowX)) { bounds.left = Math.max(bounds.left, box.left); bounds.right = Math.min(bounds.right, box.right); }
  }
  const target = heading ? rect(heading) : null, duplicate = duplicateLine == null ? null : root.querySelector(`[data-source-line="${duplicateLine}"]`);
  return { file: view.file?.path, mode: view.getMode(), cursor: view.editor.getCursor(), bounds, target, heading: heading?.textContent, duplicate: duplicate ? rect(duplicate) : null,
    visible: Boolean(target && target.top >= bounds.top - 2 && target.bottom <= bounds.bottom + 2 && target.left >= bounds.left - 2 && target.right <= bounds.right + 2),
    duplicateOutside: !duplicate || rect(duplicate).top > bounds.bottom };
}
async function clickVisible(tools, selector) {
  await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "real hierarchical link is rendered");
  await tools.evaluate(`document.querySelector(${q(selector)}).scrollIntoView({block:"center",inline:"nearest"});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
  const point = await tools.evaluate(`(()=>{const r=document.querySelector(${q(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,windowWidth:innerWidth,windowHeight:innerHeight}})()`);
  assert.ok(point.width > 0 && point.height > 0 && point.x >= 0 && point.y >= 0 && point.x < point.windowWidth && point.y < point.windowHeight);
  await tools.click(selector);
}
async function assertNavigation(tools, file, line, duplicateLine = null) {
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(file)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&app.workspace.activeLeaf.view.editor.getCursor().line===${line}`, "hierarchical Reading link reaches the exact chosen source line");
  await tools.wait(`(${visibleHeading.toString()})(${line},${q(duplicateLine)}).visible`, "chosen hierarchical heading is fully visible in the clipped Reading pane");
  const state = await tools.evaluate(invoke(visibleHeading, line, duplicateLine));
  assert.equal(state.visible, true); assert.deepEqual(state.cursor, { line, ch: 0 }); assert.equal(state.duplicateOutside, true);
  tools.report.hierarchicalHeadingNavigation ??= []; tools.report.hierarchicalHeadingNavigation.push(state);
}

/** Actual popup, retained source/history, hierarchy-safe destinations and real Reading clicks. */
export async function checkHierarchicalHeadings(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture } = tools;
  const folder = "Hierarchical headings", target = folder + "/Targets/Nested target.md", duplicate = folder + "/Other/Nested target.md";
  const parent = "Parent Ω", child = "Shared child λ", leaf = "Leaf 😀", localParent = "Local parent Ω";
  const prelude = Array.from({ length: 30 }, (_, index) => `Hierarchy prelude ${index + 1}: the correct parent is beyond the opening viewport.`).join("\r\n\r\n");
  const trailing = Array.from({ length: 40 }, (_, index) => `Hierarchy trailing paragraph ${index + 1}: the later normalized child stays outside the destination viewport.`).join("\r\n\r\n");
  const targetText = `# Wrong parent\r\n\r\n## ${child}\r\n\r\n` + prelude + `\r\n\r\n# ${parent}\r\n\r\n## ${child}\r\n\r\n### ${leaf}\r\n\r\n` + trailing + `\r\n\r\n## **${child}**\r\n\r\n### ${leaf}\r\n\r\n# Outside parent\r\n\r\n## Outside child\r\n\r\n# ${parent}\r\n\r\n## Later-only child\r\n`;
  const targetLines = targetText.split("\r\n"), parentLine = targetLines.indexOf("# " + parent), childLine = targetLines.indexOf("## " + child, parentLine), leafLine = targetLines.indexOf("### " + leaf, childLine), duplicateLine = targetLines.indexOf("## **" + child + "**");
  const original = `# Hierarchy links Ω\r\n\r\n# ${localParent}\r\n\r\n## ${child}\r\n\r\nUnicode 😀 surrounding text.\r\n\r\nLinks: \r\n`;
  const duplicateText = "# Different note\r\n\r\nNo requested ancestor exists here.\r\n", bytes = value => Buffer.from("\ufeff" + value), saved = new Map();
  const negativeFiles = async () => { const result = []; for (const [path,text] of [...saved,[target,targetText],[duplicate,duplicateText]]) { const raw = await readFile(join(directory,path)); assert.deepEqual(raw,bytes(text),"An unselected hierarchical suggestion must not write any fixture note"); result.push({path,bytes:raw.length,sha256:createHash("sha256").update(raw).digest("hex"),bom:raw.subarray(0,3).equals(Buffer.from([239,187,191]))}); } return result; };
  assert.ok(parentLine > 30 && childLine > parentLine && leafLine > childLine && duplicateLine > leafLine + 60);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder, "Targets"), { recursive: true }); await mkdir(join(directory, folder, "Other"), { recursive: true });
  await writeFile(join(directory, target), bytes(targetText), { flag: "wx" }); await writeFile(join(directory, duplicate), bytes(duplicateText), { flag: "wx" });
  for (const mode of ["source", "live-preview"]) { const path = folder + "/" + mode + ".md"; saved.set(path, original); await writeFile(join(directory, path), bytes(original), { flag: "wx" }); }
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await wait(`app.metadataCache.getCache(${q(target)})?.headings.length===11`, "complete hierarchical target is indexed");
  const open = async (path, mode) => {
    await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.workspace.activeLeaf.view.previewEl.dataset.hierarchicalReadingRoot="true";app.editor.setCursor(8,app.editor.getLine(8).length);app.editor.focus()})()`);
    await command("Page.bringToFront");
  };
  const row = (path, chain) => `${popup} [data-builtin-link=${q(path)}][data-builtin-heading-path=${q(chain)}]`;
  const choose = async (path, prefix, chain, token, keyboard = false) => {
    await evaluate("app.editor.setCursor(8,app.editor.getLine(8).length);app.editor.focus()");
    const before = saved.get(path); await command("Input.insertText", { text: prefix });
    const typed = before.replace(/\r\n$/, prefix + "\r\n"), selector = row(chain.startsWith(localParent + "#") ? path : target, chain);
    await wait(`Boolean(document.querySelector(${q(selector)}))`, "ancestor-scoped heading popup row");
    assert.equal(await evaluate(`document.querySelectorAll(${q(selector)}).length`), 1, "normalized duplicate children cannot create a second addressable row");
    assert.equal(await evaluate(`document.querySelector(${q(selector)}).querySelector(".suggestion-note").textContent.includes(${q("#" + chain)})`), true, "visible suggestion context includes the full canonical ancestor chain");
    assert.equal(await evaluate("app.editor.getValue()"), typed);
    if (capture && prefix.includes("#Parent Ω#Shared")) await capture("hierarchical-heading-popup");
    if (keyboard) await press("Enter", "Enter", 13); else await click(selector);
    const next = before.replace(/\r\n$/, token + "\r\n"); await wait(`app.editor.getValue()===${q(next)}`, "one safe hierarchical wiki token is inserted");
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), typed);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), next);
    saved.set(path, next); await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(next));
  };
  try {
    for (const mode of ["source", "live-preview"]) {
      const path = folder + "/" + mode + ".md"; await open(path, mode);
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target)}),${q(path)})`);
      assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${q(linktext)},${q(path)})===app.vault.getFileByPath(${q(target)})`), true);
      await choose(path, "[[" + target.slice(0, -3) + "#" + parent + "#Shared", parent + "#" + child, "[[" + linktext + "#" + parent + "#" + child + "]]");
      await choose(path, " [[#" + localParent + "#Shared", localParent + "#" + child, " [[#" + localParent + "#" + child + "]]");
      await choose(path, " [[" + target.slice(0, -3) + "#" + parent + "#" + child + "#Le", parent + "#" + child + "#" + leaf, " [[" + linktext + "#" + parent + "#" + child + "#" + leaf + "]]", true);
      for (const missing of ["Outside", "Later-only"]) {
        const before = saved.get(path), prefix = " [[" + target.slice(0, -3) + "#" + parent + "#" + missing;
        const record = {mode,missing,path,target,chain:parent + "#" + missing,physicalBefore:await negativeFiles()}; (report.hierarchicalHeadingMissingDestinations ??= []).push(record);
        await command("Input.insertText", { text: prefix });
        record.owner = await evaluate(invoke(rememberMissingHeading,path,target,mode,before.replace(/\r\n$/,prefix + "\r\n"),before,targetText));
        assert.equal(record.owner.sourceBOM,true); assert.equal(record.owner.targetBOM,true); assert.equal(record.owner.sourceVersion,record.physicalBefore.find(file=>file.path===path).sha256); assert.equal(record.owner.targetVersion,record.physicalBefore.find(file=>file.path===target).sha256);
        record.enumeration = await evaluate(invoke(enumerateMissingHeading)); assert.deepEqual(record.enumeration.calls,[]); assert.equal(record.enumeration.hookCount,13); assert.equal(record.enumeration.hooksRestored,true);
        assert.equal(record.enumeration.choices.length,1,"No sibling or later duplicate may supply an existing descendant; only an explicit missing-heading link remains");
        const choice = record.enumeration.choices[0]; assert.deepEqual(choice.payload,{kind:"unresolved-heading",path:target,heading:missing,subpath:record.chain,parents:[parent]}); assert.deepEqual(choice.keys,["heading","kind","parents","path","subpath","target","targetText"]); assert.equal(choice.targetIdentity,true); assert.equal(choice.targetTextExact,true);
        const unresolved = `${popup} [data-builtin-unresolved-heading=${q(target)}][data-builtin-unresolved-subpath=${q(record.chain)}]`;
        await wait(`document.querySelectorAll(${q(popup + " .suggestion-item")}).length===1&&Boolean(document.querySelector(${q(unresolved)}))`,"the real popup offers only the exact source-only missing-heading row");
        record.popup = await evaluate(`(()=>{const p=document.querySelector(${q(popup)}),o=hierarchicalNegativeOwner,row=p.querySelector('.suggestion-item');return{ownedPopup:p===o.builtin.containerEl,currentContext:o.builtin.context?.editor===o.editor&&o.builtin.context?.file===o.file&&o.builtin.context?.query===${q(missing)},rows:p.querySelectorAll('.suggestion-item').length,existingHeadingRows:p.querySelectorAll('[data-builtin-heading],[data-builtin-global-heading]').length,createHeadingRows:p.querySelectorAll('[data-builtin-create-heading]').length,path:row.dataset.builtinUnresolvedHeading,subpath:row.dataset.builtinUnresolvedSubpath,title:row.querySelector('.suggestion-title').textContent,note:row.querySelector('.suggestion-note').textContent}})()`);
        assert.deepEqual(record.popup,{ownedPopup:true,currentContext:true,rows:1,existingHeadingRows:0,createHeadingRows:0,path:target,subpath:record.chain,title:"Link to missing heading: " + record.chain,note:target + "#" + record.chain});
        record.afterPopup = await evaluate(invoke(missingHeadingOwner)); for (const value of Object.values(record.afterPopup)) assert.equal(value,true);
        await press("Escape","Escape",27); await wait(`!document.querySelector(${q(popup)})`,"trusted Escape dismisses the unselected missing-heading row");
        record.afterEscape = await evaluate(invoke(missingHeadingOwner)); for (const value of Object.values(record.afterEscape)) assert.equal(value,true);
        record.physicalAfter = await negativeFiles(); assert.deepEqual(record.physicalAfter,record.physicalBefore); record.selectionObserverRestored = await evaluate(invoke(releaseMissingHeading)); assert.equal(record.selectionObserverRestored,true);
        await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(before)},"input.hierarchy-cleanup");app.editor.setCursor(8,app.editor.getLine(8).length);app.editor.focus()`);
      }
      for (const [chain, file, line, later] of [[parent + "#" + child, target, childLine, duplicateLine], [parent + "#" + child + "#" + leaf, target, leafLine, duplicateLine], [localParent + "#" + child, path, 4, null]]) {
        await evaluate('app.workspace.activeLeaf.view.setMode("preview")');
        await clickVisible(tools, `[data-hierarchical-reading-root] a.internal-link[data-slopsidian-link=${q((file === path ? "" : linktext) + "#" + chain)}]`);
        await assertNavigation(tools, file, line, later);
        await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)})`); assert.deepEqual(await evaluate("app.editor.getCursor()"), { line, ch: 0 });
        await open(path, mode);
      }
      assert.deepEqual(await readFile(join(directory, path)), bytes(saved.get(path))); assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      pass(report, `${mode}: real ancestor-scoped popup choices insert destination-safe cross/current-note and three-part heading chains, retain isolated Undo/Redo and exact BOM/CRLF, and real Reading clicks reach the nonzero intended child/leaf while inactive and returned carets agree and normalized duplicates stay outside the clipped viewport.`);

      const prefix = " [[" + target.slice(0, -3) + "#" + parent + "#Shared", selector = row(target, parent + "#" + child);
      await command("Input.insertText", { text: prefix }); await wait(`Boolean(document.querySelector(${q(selector)}))`, "held hierarchical popup before physical ancestor change");
      await evaluate(`globalThis.heldHierarchyCompletion=document.querySelector(${q(selector)})`); const typed = await evaluate("app.editor.getValue()");
      await writeFile(join(directory, target), bytes(targetText.replaceAll(parent, "Changed parent Ω"))); await evaluate("app.metadataCache.refresh()");
      await wait(`!app.metadataCache.getCache(${q(target)}).headings.some(value=>value.heading===${q(parent)})`, "physical ancestor change observed by ordinary metadata");
      await evaluate("heldHierarchyCompletion.click();delete globalThis.heldHierarchyCompletion"); assert.equal(await evaluate("app.editor.getValue()"), typed);
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(saved.get(path))},"input.hierarchy-cleanup");app.editor.setCursor(8,app.editor.getLine(8).length);app.editor.focus();app.saveAll()`);
      await writeFile(join(directory, target), bytes(targetText)); await evaluate("app.metadataCache.refresh()");
      await wait(`app.metadataCache.getCache(${q(target)}).headings.filter(value=>value.heading===${q(parent)}).length===2`, "exact hierarchy target restored");
      assert.deepEqual(await readFile(join(directory, path)), bytes(saved.get(path))); assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      pass(report, `${mode}: a held hierarchical row refuses an independently changed physical ancestor even after its control was captured; restoring the fixture retains every source/target byte and creates no note or block ID.`);
    }
    const path = folder + "/live-preview.md"; await open(path, "live-preview");
    const peer = await evaluate(`(async()=>{const owner=app.workspace.activeLeaf,peer=app.workspace.createLeafBySplit(owner);await peer.openFile(app.vault.getFileByPath(${q(target)}));peer.view.setEditingMode("source",false);app.workspace.setActiveLeaf(peer,{focus:true});peer.view.editor.setCursor(${parentLine},2);peer.view.editor.focus();return{owner:owner.id,peer:peer.id}})()`);
    await command("Input.insertText", { text: "Dirty " });
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(peer.peer)}).view.session.dirty`), true); assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
    await evaluate(`app.workspace.setActiveLeaf(app.workspace.getLeafById(${q(peer.owner)}),{focus:true});app.editor.setCursor(8,app.editor.getLine(8).length);app.editor.focus()`);
    const dirtyPrefix = " [[" + target.slice(0, -3) + "#Dirty " + parent + "#Shared", dirtyRow = row(target, "Dirty " + parent + "#" + child);
    await command("Input.insertText", { text: dirtyPrefix }); await wait(`Boolean(document.querySelector(${q(dirtyRow)}))`, "real dirty target supplies its unsaved ancestor chain");
    const typed = await evaluate("app.editor.getValue()"); await click(dirtyRow); assert.ok((await evaluate("app.editor.getValue()")).includes("#Dirty " + parent + "#" + child + "]]"));
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), typed);
    await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(saved.get(path))},"input.hierarchy-cleanup");app.workspace.getLeafById(${q(peer.peer)}).view.editor.undo()`);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(peer.peer)}).view.editor.getValue()`), targetText); assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
    await evaluate(`(async()=>{await app.workspace.closeLeaf(app.workspace.getLeafById(${q(peer.peer)}));await app.saveAll();await app.workspace.flushLayout()})()`);
    pass(report, "An actual unsaved target editor supplies a new ancestor chain while its physical file stays unchanged; inserting/Undoing that choice and undoing the target edit retains both documents, peer ownership and exact saved bytes.");
    await open(path, "live-preview"); await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"&&!app.changingVault`, "hierarchical fixtures restore after full restart/reconnection");
    assert.equal(await evaluate("app.editor.getValue()"), saved.get(path));
    const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target)}),${q(path)})`);
    await choose(path, " [[" + target.slice(0, -3) + "#" + parent + "#Shared", parent + "#" + child, " [[" + linktext + "#" + parent + "#" + child + "]]", true);
    for (const [file, text] of [...saved, [target, targetText], [duplicate, duplicateText]]) assert.deepEqual(await readFile(join(directory, file)), bytes(text));
    assert.equal(await evaluate(`app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(${q(folder + "/")})).length`), 4);
    report.hierarchicalHeadings = { sourceAndLivePreview: true, exactAncestorScope: true, crossAndCurrentNotes: true, threePartChains: true, normalizedDuplicates: true, safeDestinationPreferences: true, realClippedNavigation: true, stalePhysicalParentRefusal: true, dirtyTargets: true, isolatedUndoExactBytes: true, restart: true };
    pass(report, "Full native restart or browser reload/reconnection restores exact saved hierarchical links, Live Preview and fresh ancestor completion; a new real keyboard choice retains exact bytes, isolated history and the original four-note fixture inventory.");
  } catch (error) {
    try { report.hierarchicalHeadingFailure = await evaluate(`(()=>{const view=app.workspace.activeLeaf?.view;return{file:view?.file?.path,mode:view?.getEditingMode?.(),cursor:view?.editor?.getCursor?.(),source:view?.editor?.getValue?.(),rows:[...document.querySelectorAll(${q(popup + " [data-builtin-heading]")})].slice(0,10).map(row=>({heading:row.dataset.builtinHeading,chain:row.dataset.builtinHeadingPath,text:row.textContent})),targetHeadings:app.metadataCache.getCache(${q(target)})?.headings.map(heading=>({heading:heading.heading,level:heading.level,line:heading.position.start.line})),focus:document.activeElement?.outerHTML.slice(0,500)}})()`); await capture?.("hierarchical-heading-precleanup-failure"); }
    catch (diagnosticError) { report.hierarchicalHeadingFailure = { diagnosticError: String(diagnosticError) }; }
    throw error;
  } finally {
    await evaluate(invoke(releaseMissingHeading));
    await evaluate("delete globalThis.heldHierarchyCompletion");
    for (const [file, text] of [...saved, [target, targetText], [duplicate, duplicateText]]) {
      await evaluate(`(async()=>{await app.openFile(${q(file)});app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(text)},"input.hierarchy-final-cleanup");await app.saveAll()})()`);
      await writeFile(join(directory, file), bytes(text));
    }
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();await app.markdownAutosave.setEnabled(${q(autosave)})})()`);
  }
}

/** Parent owns cache-only mounting and the exact cached-blob/zero-network audit. */
export async function checkHierarchicalHeadingsReadOnly(tools) {
  const { evaluate, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("source")})()');
  const before = await evaluate("app.editor.getValue()");
  try {
    const result = await evaluate(String.raw`(()=>{const editor=app.editor,file=app.workspace.getActiveFile(),line=editor.getValue().split(/\r?\n/).findIndex(text=>text==="[[#Cached parent#Ch");if(line<0)throw Error("Missing cached hierarchical prefix");editor.setCursor(line,editor.getLine(line).length);editor.focus();const builtin=app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source"),cursor=editor.getCursor();if(!builtin)throw Error("Missing built-in provider");return{trigger:builtin.onTrigger(cursor,editor,file),choices:builtin.getSuggestions({editor,file,start:cursor,end:cursor,query:"Ch"}).length}})()`);
    assert.deepEqual(result, { trigger: null, choices: 0 }); await wait(`!document.querySelector(${q(popup)})`, "read-only hierarchical suggestion remains closed");
    const line = await evaluate('app.metadataCache.getCache("Read only.md").headings.find(value=>value.heading==="Cached child").position.start.line'); assert.ok(line > 0);
    await evaluate('app.workspace.activeLeaf.view.previewEl.dataset.hierarchicalReadingRoot="true";app.workspace.activeLeaf.view.setMode("preview")');
    await clickVisible(tools, '[data-hierarchical-reading-root] a.internal-link[data-slopsidian-link="#Cached parent#Cached child"]');
    await assertNavigation(tools, "Read only.md", line); await capture?.("hierarchical-heading-readonly");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); assert.deepEqual(await evaluate("app.editor.getCursor()"), { line, ch: 0 }); assert.equal(await evaluate("app.editor.getValue()"), before);
    report.hierarchicalHeadings = { ...(report.hierarchicalHeadings ?? {}), cachedReadOnlyRefusal: true, cachedReadOnlyNavigation: true };
    pass(report, "A genuine cache-only read-only note refuses hierarchical completion triggering/enumeration yet its real current-note hierarchical Reading link reaches the exact child and retained Source caret without changing any source.");
  } catch (error) {
    try { report.hierarchicalHeadingReadOnlyFailure = await evaluate('(()=>{const view=app.workspace.activeLeaf?.view;return{file:view?.file?.path,mode:view?.getEditingMode?.(),cursor:view?.editor?.getCursor?.(),source:view?.editor?.getValue?.(),headings:app.metadataCache.getCache("Read only.md")?.headings.map(value=>({heading:value.heading,level:value.level,line:value.position.start.line}))}})()'); await capture?.("hierarchical-heading-readonly-precleanup-failure"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); }
}
