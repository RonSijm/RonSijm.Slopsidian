import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };

function sourceSnapshot() {
  const view = app.workspace.activeLeaf.view, editor = view.editor;
  return { text: editor.getValue(), selections: editor.listSelections(), main: editor.cm.state.selection.mainIndex, dirty: view.session.dirty };
}

async function stablePointer(selector) {
  await app.workspace.activeLeaf.view.reading.whenReady();
  const link = document.querySelector(selector);
  if (!link) throw new Error("Missing cursor-handoff Reading link: " + selector);
  link.scrollIntoView({ block: "nearest", inline: "nearest" });
  const measure = () => {
    const r = [...link.getClientRects()].find(r => r.width > 0 && r.height > 0);
    if (!r) throw new Error("Cursor-handoff link has no client rectangle");
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  await new Promise(resolve => requestAnimationFrame(resolve)); const first = measure();
  await new Promise(resolve => requestAnimationFrame(resolve));
  return { sameNode: link.isConnected && document.querySelector(selector) === link, first, second: measure() };
}

function readingSnapshot(line, duplicateLine = null) {
  const view = app.workspace.activeLeaf.view, root = view.previewEl;
  const rect = element => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const win = root.ownerDocument.defaultView, box = rect(root);
  let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(win.innerWidth, box.right), bottom = Math.min(win.innerHeight, box.bottom);
  for (let element = root.parentElement; element; element = element.parentElement) {
    const style = win.getComputedStyle(element), r = rect(element);
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
  }
  const viewport = { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  const block = root.querySelector(`[data-source-line="${line}"]`), target = rect(block), duplicate = duplicateLine === null ? null : rect(root.querySelector(`[data-source-line="${duplicateLine}"]`));
  const visible = !!(block?.checkVisibility() && target && viewport.width > 0 && viewport.height > 0 && target.width > 0 && target.height > 0
    && target.left >= left - 2 && target.right <= right + 2 && target.top >= top - 2 && target.bottom <= bottom + 2);
  return { file: view.file?.path, mode: view.getEditingMode(), cursor: view.editor.getCursor(), scroll: view.contentEl.scrollTop, viewport, target, duplicate, visible,
    text: block?.textContent ?? null, focusInReading: root === root.ownerDocument.activeElement || root.contains(root.ownerDocument.activeElement) };
}

/** Exercise the installed CodeMirror DOM observer with a real, stale native Range. */
async function staleNativeSelection() {
  const view = app.workspace.activeLeaf.view, cm = view.editor.cm, doc = cm.contentDOM.ownerDocument, before = cm.state.selection.main.head;
  const walker = doc.createTreeWalker(cm.contentDOM, NodeFilter.SHOW_TEXT); let node, candidate;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest(".cm-line") || !node.nodeValue.length) continue;
    try { const offset = node.nodeValue.length, position = cm.posAtDOM(node, offset); if (position !== before) { candidate = { node, offset, position }; break; } } catch {}
  }
  if (!candidate) throw new Error("No retained Source text node can exercise the native selection observer");
  const attempts = [], dispatch = cm.dispatch;
  cm.dispatch = function (...specs) {
    for (const spec of specs) if (spec?.selection) attempts.push({ event: spec.userEvent ?? null, from: this.state.selection.main.head });
    return dispatch.apply(this, specs);
  };
  try {
    const native = doc.getSelection(); native.collapse(candidate.node, candidate.offset);
    const owned = cm.contentDOM.contains(native.anchorNode);
    doc.dispatchEvent(new Event("selectionchange"));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before, stalePosition: candidate.position, owned, attempts, after: cm.state.selection.main.head, mode: view.getEditingMode(), sourceFocused: cm.hasFocus };
  } finally { cm.dispatch = dispatch; view.editor.releaseReadingSelection(); }
}

/** Retain the cancelled callback as a hostile late delivery, rather than trusting cancelAnimationFrame alone. */
function explicitRevealAfterRestore(line) {
  const view = app.workspace.activeLeaf.view, win = view.contentEl.ownerDocument.defaultView, original = win.requestAnimationFrame, callbacks = [];
  win.requestAnimationFrame = function (callback) { callbacks.push(callback); return original.call(this, () => {}); };
  try { view.setEphemeralState({ scroll: 240 }); } finally { win.requestAnimationFrame = original; }
  view.revealLine(line); const before = view.contentEl.scrollTop;
  for (const callback of callbacks) callback(performance.now());
  return { callbacks: callbacks.length, before, after: view.contentEl.scrollTop, cursor: view.editor.getCursor() };
}

async function assertPointer(tools, selector) {
  const state = await tools.evaluate(invoke(stablePointer, selector));
  assert.equal(state.sameNode, true, "Reading link identity stays stable before pointer input");
  for (const key of ["left", "top", "width", "height"]) assert.ok(Math.abs(state.first[key] - state.second[key]) <= 1, "Reading link geometry settles before pointer input: " + q(state));
  tools.report.cursorHandoffPointers ??= []; tools.report.cursorHandoffPointers.push(state);
  await tools.click(selector);
}

async function assertReading(tools, path, line, duplicateLine = null) {
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"`, "cursor-handoff destination opens in Reading");
  await tools.evaluate("app.workspace.activeLeaf.view.reading.whenReady()");
  await tools.wait(`(${invoke(readingSnapshot, line, duplicateLine)}).visible`, "the requested nonzero destination is inside the clipped Reading viewport");
  const state = await tools.evaluate(invoke(readingSnapshot, line, duplicateLine));
  assert.deepEqual(state.cursor, { line, ch: 0 }, "inactive Source state matches the visible Reading destination: " + q(state));
  assert.equal(state.focusInReading, true, "explicit Reading navigation focuses the visible surface");
  if (duplicateLine !== null) assert.ok(state.duplicate?.top > state.viewport.bottom, "the later normalized duplicate is outside the actual clipped viewport: " + q(state));
  tools.report.cursorHandoffNavigation ??= []; tools.report.cursorHandoffNavigation.push(state);
  return state;
}

async function assertNativeRefusal(tools) {
  const state = await tools.evaluate(invoke(staleNativeSelection));
  tools.report.cursorHandoffNativeSelections ??= []; tools.report.cursorHandoffNativeSelections.push(state);
  assert.equal(state.owned, true, "the stale browser Range really belongs to the hidden Source DOM");
  assert.notEqual(state.stalePosition, state.before);
  assert.ok(state.attempts.some(value => ["select", "select.pointer", "select.keyboard"].includes(value.event)), "installed CodeMirror observer attempted the obsolete native selection: " + q(state));
  assert.equal(state.after, state.before, "native DOM selection cannot overwrite deliberate Reading navigation");
  assert.equal(state.sourceFocused, false, "a stale Source selection cannot steal Reading focus");
}

/** Source/Live Preview/Reading handoff with real links, exact physical bytes and installed CM history. */
export async function checkCursorHandoff(tools) {
  const { directory, evaluate, command, press, wait, report, afterReload, restart, capture } = tools;
  const folder = "Cursor handoff", path = folder + "/Links.md", target = folder + "/Target.md", heading = "Navigation destination λ";
  const link = "Target#" + heading, blockLink = "Target#^cursor-block";
  const original = `# Cursor links Ω\r\n\r\nUnicode 😀 surrounding text.\r\n\r\n[[${link}]]\r\n\r\n[[${blockLink}]]\r\n`;
  const prelude = Array.from({ length: 30 }, (_, index) => `Navigation prelude ${index + 1}: a real destination must scroll away from the opening viewport.`).join("\r\n\r\n");
  const between = Array.from({ length: 40 }, (_, index) => `Navigation trailing paragraph ${index + 1}: keep the normalized duplicate below the first destination.`).join("\r\n\r\n");
  const targetText = prelude + `\r\n\r\n## ${heading}\r\n\r\nBlock destination 😀 prose. ^cursor-block\r\n\r\n` + between + `\r\n\r\n### **${heading}**\r\n`;
  const targetLines = targetText.split("\r\n"), headingLine = targetLines.indexOf("## " + heading), blockLine = targetLines.findIndex(value => value.includes("^cursor-block")), duplicateLine = targetLines.indexOf(`### **${heading}**`);
  const bytes = value => Buffer.from("\ufeff" + value);
  assert.ok(headingLine > 30 && blockLine > headingLine && duplicateLine > blockLine + 60);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, path), bytes(original), { flag: "wx" }); await writeFile(join(directory, target), bytes(targetText), { flag: "wx" });
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await wait(`app.metadataCache.getCache(${q(target)})?.blocks?.["cursor-block"]&&app.metadataCache.getCache(${q(target)})?.headings.length===2`, "far heading and explicit block are indexed");
  const open = (file, mode) => evaluate(`(async()=>{await app.openFile(${q(file)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.workspace.activeLeaf.view.previewEl.dataset.cursorHandoffRoot="true"})()`);
  const navigate = async (mode, kind, native = false) => {
    // Seed a distant saved state so explicit link navigation must beat an old editor/session location.
    await open(target, mode); await evaluate("app.editor.setCursor(app.editor.lastLine(),app.editor.getLine(app.editor.lastLine()).length);app.editor.focus()");
    await open(path, mode); await evaluate('app.editor.setCursor(2,4);app.editor.focus();app.workspace.activeLeaf.view.setMode("preview")');
    const selector = `[data-cursor-handoff-root] a.internal-link[data-slopsidian-link=${q(kind === "heading" ? link : blockLink)}]`, line = kind === "heading" ? headingLine : blockLine;
    await assertPointer(tools, selector); await assertReading(tools, target, line, kind === "heading" ? duplicateLine : null);
    if (native) { await assertNativeRefusal(tools); await assertReading(tools, target, line, kind === "heading" ? duplicateLine : null); }
    const restored = await evaluate(invoke(explicitRevealAfterRestore, line));
    assert.ok(restored.callbacks > 0); assert.equal(restored.after, restored.before, "a retained cancelled restore cannot defeat the newer explicit reveal"); assert.deepEqual(restored.cursor, { line, ch: 0 });
    await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)})`);
    await wait(`app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}&&app.workspace.activeLeaf.view.editor.getCursor().line===${line}`, "Source/Live Preview handback retains the requested destination");
    assert.deepEqual(await evaluate("app.editor.getCursor()"), { line, ch: 0 }); assert.equal(await evaluate("app.editor.getValue()"), targetText);
  };
  try {
    for (const mode of ["source", "live-preview"]) {
      await open(path, mode); await evaluate("app.editor.setCursor(2,4);app.editor.focus()"); await command("Page.bringToFront");
      await command("Input.insertText", { text: "temporary-" });
      await evaluate('app.editor.setSelections([{anchor:{line:2,ch:2},head:{line:2,ch:7}},{anchor:{line:4,ch:2},head:{line:4,ch:6}}],1);app.editor.focus();(()=>{const session=app.workspace.activeLeaf.view.session,save=session.save,probe={session,save,calls:0};session.save=function(...args){probe.calls++;return save.apply(this,args)};globalThis.cursorHandoffSaveProbe=probe})()');
      const before = await evaluate(invoke(sourceSnapshot)); assert.equal(before.dirty, true);
      await press("e", "KeyE", 69, 2); await wait('app.workspace.activeLeaf.view.getMode()==="preview"', "physical mode shortcut opens Reading");
      assert.deepEqual(await evaluate(invoke(sourceSnapshot)), before, "ordinary Reading handoff keeps dirty source and both selections");
      await press("e", "KeyE", 69, 2); await wait(`app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "physical mode shortcut returns to the prior editor mode");
      assert.deepEqual(await evaluate(invoke(sourceSnapshot)), before);
      assert.equal(await evaluate("(()=>{const p=globalThis.cursorHandoffSaveProbe;p.session.save=p.save;delete globalThis.cursorHandoffSaveProbe;return p.calls})()"), 0, "mode-only handoff never invokes a note save");
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
      await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), before.text);
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
      assert.deepEqual(await readFile(join(directory, path)), bytes(original));
      for (const kind of ["heading", "block"]) await navigate(mode, kind, kind === "heading");
      assert.deepEqual(await readFile(join(directory, path)), bytes(original)); assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      pass(report, `${mode}: physical Reading round trips retain dirty text, both selections and native Undo/Redo without saving; real far-heading/block links align visible Reading and inactive Source carets, reject installed-CM stale native selection and cancelled scroll restores, and retain the destination after handback with exact BOM/CRLF bytes.`);
    }
    const peers = await evaluate(`(async()=>{const main=app.workspace.activeLeaf,peer=app.workspace.createLeafBySplit(main);await peer.openFile(app.vault.getFileByPath(${q(target)}));peer.view.setEditingMode("source",false);peer.view.editor.setCursor(2,4);app.workspace.setActiveLeaf(main,{focus:true});return{main:main.id,peer:peer.id,cursor:peer.view.editor.getCursor()}})()`);
    await navigate("source", "heading");
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${q(peers.peer)}).view.editor.getCursor()`), peers.cursor, "another leaf retains its independent selection during explicit navigation");
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(peers.peer)}).view.session===app.workspace.activeLeaf.view.session`), true);
    await evaluate("app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()"); await command("Input.insertText", { text: "Shared temporary 😀" });
    const dirty = await evaluate("app.editor.getValue()"); assert.notEqual(dirty, targetText);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(peers.peer)}).view.editor.getValue()`), dirty);
    const selection = await evaluate(invoke(sourceSnapshot));
    await evaluate('app.workspace.activeLeaf.view.setMode("preview");app.workspace.activeLeaf.view.setEditingMode("source")'); assert.deepEqual(await evaluate(invoke(sourceSnapshot)), selection);
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), targetText);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(peers.peer)}).view.editor.getValue()`), targetText);
    assert.deepEqual(await evaluate(`app.workspace.getLeafById(${q(peers.peer)}).view.editor.getCursor()`), peers.cursor);
    await evaluate(`app.workspace.closeLeaf(app.workspace.getLeafById(${q(peers.peer)}))`);
    assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
    pass(report, "Two leaves share dirty document text while retaining separate carets; a Reading round trip preserves the owner history, and one Undo restores both documents without rewriting the BOM/CRLF target.");
    if (afterReload) {
      await open(path, "live-preview"); await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
      if (restart) await restart(); else await command("Page.reload"); await afterReload();
      await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&!app.changingVault`, "cursor links restore after restart/reconnection");
      assert.equal(await evaluate("app.editor.getValue()"), original); await navigate("live-preview", "heading", true);
      assert.deepEqual(await readFile(join(directory, path)), bytes(original)); assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      pass(report, "A full host restart/browser reconnection restores the exact saved links, then another real far-heading click retains Reading/Live Preview caret alignment and rejects a fresh obsolete native selection.");
    }
    await capture?.("cursor-handoff");
    report.cursorHandoff = { dirtyModeHistory: true, noModeSave: true, sourceAndLivePreview: true, realFarHeadingAndBlock: true, inactiveAndReturnedCarets: true, nativeSelectionRefused: true, staleRestoreRefused: true, sharedLeaves: true, exactBomCrLf: true, restart: !!afterReload };
  } catch (error) {
    try { report.cursorHandoffFailure = await evaluate(`(()=>({snapshot:(${sourceSnapshot.toString()})(),navigation:(${readingSnapshot.toString()})(${headingLine},${duplicateLine}),active:app.workspace.activeLeaf.id,focus:document.activeElement?.outerHTML.slice(0,500)}))()`); await capture?.("cursor-handoff-precleanup-failure"); }
    catch (diagnosticError) { report.cursorHandoffFailure = { diagnosticError: String(diagnosticError) }; }
    throw error;
  } finally {
    await evaluate("(()=>{const p=globalThis.cursorHandoffSaveProbe;if(p){p.session.save=p.save;delete globalThis.cursorHandoffSaveProbe}})()");
    for (const [file, text] of [[path, original], [target, targetText]]) {
      await evaluate(`(async()=>{await app.openFile(${q(file)});app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(text)},"input.cursor-handoff-cleanup");await app.saveAll()})()`);
      await writeFile(join(directory, file), bytes(text));
    }
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();await app.markdownAutosave.setEnabled(${q(autosave)})})()`);
  }
}

/** The parent mounts and hashes this genuine cache-only fixture and audits its network counters. */
export async function checkCursorHandoffReadOnly(tools) {
  const { evaluate, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("source")})()');
  const before = await evaluate("app.editor.getValue()"), target = "Cursor target.md";
  let stage = "load cached target metadata", line = null;
  try {
    // GitHub mounts are lazy: metadata enumerates documents read through the host,
    // not every blob in the mounted inventory. Read this known cached fixture without
    // opening a leaf, then let the normal metadata parser index its transport result.
    const indexed = await evaluate(`(async()=>{const target=${q(target)},before=app.githubVaults.state(),file=app.workspace.getActiveFile(),sessionBefore=app.workspace.sessions.has(target),document=await app.vault.readDocument(target);await app.metadataCache.refresh();const cache=app.metadataCache.getCache(target);return{content:document.content,version:document.version,activeUnchanged:app.workspace.getActiveFile()===file,sessionBefore,sessionAfter:app.workspace.sessions.has(target),before,after:app.githubVaults.state(),headings:cache?.headings.map(value=>({heading:value.heading,line:value.position.start.line}))??[],metadataError:app.metadataCache.error}})()`);
    const { content: targetText, ...indexEvidence } = indexed; report.cursorHandoffReadOnlyIndex = indexEvidence;
    assert.equal(indexed.activeUnchanged, true, "cached target preparation does not navigate a leaf");
    assert.equal(indexed.sessionBefore, false); assert.equal(indexed.sessionAfter, false, "cached target preparation does not seed an editor session or caret");
    assert.deepEqual({ api: indexed.after.counters.api, raw: indexed.after.counters.raw }, { api: 0, raw: 0 });
    assert.ok(indexed.after.counters.cacheHits > indexed.before.counters.cacheHits, "known target metadata comes from a verified cached blob");
    line = indexed.headings.find(value => value.heading === "Cached destination")?.line;
    assert.ok(Number.isInteger(line) && line > 30, "normal metadata parsing exposes the far cached heading immediately after its explicit read: " + q(indexEvidence));
    stage = "click cached target link";
    await evaluate('app.editor.setCursor(2,3);app.editor.focus();app.workspace.activeLeaf.view.previewEl.dataset.cursorHandoffRoot="true";app.workspace.activeLeaf.view.setMode("preview")');
    await assertPointer(tools, '[data-cursor-handoff-root] a.internal-link[data-slopsidian-link="Cursor target#Cached destination"]');
    await assertReading(tools, target, line); assert.equal(await evaluate("app.workspace.activeLeaf.view.editor.getValue()"), targetText);
    stage = "reject stale native Source selection";
    await assertNativeRefusal(tools); await assertReading(tools, target, line);
    stage = "return cached target to Source and refuse edits";
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); assert.deepEqual(await evaluate("app.editor.getCursor()"), { line, ch: 0 });
    const refusal = await evaluate('(()=>{const editor=app.editor,document=editor.cm.state.doc,selection=editor.cm.state.selection,text=editor.getValue();editor.replaceExpected(text,0,0,"refused","input.cached-handoff");return{documentSame:editor.cm.state.doc===document,selectionSame:editor.cm.state.selection.eq(selection),textSame:editor.getValue()===text,dirty:app.workspace.activeLeaf.view.session.dirty}})()');
    report.cursorHandoffReadOnlyRefusal = refusal;
    assert.deepEqual(refusal, { documentSame: true, selectionSame: true, textSame: true, dirty: false }, "the real void-returning mutation attempt retains the cached document, selection and clean session");
    assert.equal(await evaluate("app.editor.getValue()"), targetText);
    await capture?.("cursor-handoff-readonly");
    report.cursorHandoff = { ...(report.cursorHandoff ?? {}), cachedReadOnly: true };
    pass(report, "A real cached read-only link scrolls to a distant heading, aligns inactive and returned Source carets, rejects a stale native DOM selection and refuses mutation while the parent verifies every cached blob and zero API/raw requests.");
  } catch (error) {
    try {
      const diagnostic = await evaluate(`(()=>{const view=app.workspace.activeLeaf?.view;return{root:app.vault.rootPath,readOnly:app.vault.readOnly,activeFile:app.workspace.getActiveFile()?.path,mode:view?.getEditingMode?.(),cursor:view?.editor?.getCursor?.(),sourceLength:view?.editor?.getValue?.().length,metadataError:app.metadataCache.error,metadataFiles:app.metadataCache.getCachedFiles().slice(0,12),targetHeadings:app.metadataCache.getCache(${q(target)})?.headings.map(value=>({heading:value.heading,line:value.position.start.line}))??[],issues:app.metadataCache.getIssues().slice(0,6),transport:app.githubVaults.state(),focus:document.activeElement?.outerHTML.slice(0,500)}})()`);
      report.cursorHandoffReadOnlyFailure = { stage, expectedLine: line, ...diagnostic };
      await capture?.("cursor-handoff-readonly-precleanup-failure");
    } catch (diagnosticError) { report.cursorHandoffReadOnlyFailure = { stage, expectedLine: line, diagnosticError: String(diagnosticError) }; }
    throw error;
  } finally {
    await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("source")})()');
    assert.equal(await evaluate("app.editor.getValue()"), before);
  }
}
