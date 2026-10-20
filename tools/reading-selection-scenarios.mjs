import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const panel = '[data-reading-search="true"]';
const query = panel + ' [data-reading-search-query]';
const restrict = panel + ' [data-reading-search-selection]';
const useSelection = panel + ' [data-reading-search-use-selection]';
const addSelection = panel + ' [data-reading-search-add-selection]';
const root = "app.workspace.activeLeaf.view.previewEl";
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };

/** This is a genuine DOM Selection/Range, not a synthetic search-scope effect. */
function selectParagraph(text, index) {
  const root = app.workspace.activeLeaf.view.previewEl;
  const paragraphs = [...root.querySelectorAll("p")].filter(p => p.closest(".markdown-preview-view") === root && p.textContent === text);
  const paragraph = paragraphs[index];
  if (!paragraph || !paragraph.checkVisibility()) { throw Error("Missing visible owned Reading paragraph: " + text + " #" + index); }
  paragraph.scrollIntoView({ block: "center" }); root.focus({ preventScroll: true });
  const range = root.ownerDocument.createRange(); range.selectNodeContents(paragraph);
  const selection = root.ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  return { text: range.toString(), renderedText: selection.toString(), rangeCount: selection.rangeCount, startOwned: root.contains(range.startContainer), endOwned: root.contains(range.endContainer) };
}

function nativePaint() {
  const root = app.workspace.activeLeaf.view.previewEl, ranges = [...(CSS.highlights?.get("slopsidian-reading-search") ?? [])].filter(range => root.contains(range.startContainer));
  const paragraphs = [...root.querySelectorAll("p")].filter(p => p.closest(".markdown-preview-view") === root && p.textContent === "alpha alpha");
  return { count: ranges.length, values: ranges.map(range => range.toString()), paragraphs: ranges.map(range => paragraphs.findIndex(p => p.contains(range.startContainer))),
    active: [...(CSS.highlights?.get("slopsidian-reading-search-active") ?? [])].filter(range => root.contains(range.startContainer)).map(range => ({ text: range.toString(), paragraph: paragraphs.findIndex(p => p.contains(range.startContainer)) })) };
}

async function select(tools, text = "alpha alpha", index = 0) {
  const selection = await tools.evaluate(invoke(selectParagraph, text, index));
  const { renderedText, ...native } = selection;
  assert.deepEqual(native, { text, rangeCount: 1, startOwned: true, endOwned: true });
  assert.equal(renderedText.replace(/\s+/gu, " ").trim(), text.replace(/\s+/gu, " ").trim(), "native visible selection retains the passage across collapsed prose whitespace");
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  return selection;
}
async function fill({ click, press, command }, value) {
  await click(query); await press("a", "KeyA", 65, 2);
  if (value) await command("Input.insertText", { text: value }); else await press("Backspace", "Backspace", 8);
}
async function count({ evaluate, wait }, value, ranges = null) {
  await wait(`document.querySelector(${q(panel)})?.dataset.readingSearchCount===${q(String(value))}`, "Reading captured-passage count " + value);
  if (ranges !== null) {
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchSelectionRanges`), String(ranges));
    assert.equal(await evaluate(`document.querySelector(${q(restrict)}).checked`), true);
    assert.match(await evaluate(`document.querySelector(${q(panel + " .reading-search-status")}).textContent`), /in selection/);
  }
}
async function open(tools) {
  await tools.press("f", "KeyF", 70, 2);
  await tools.wait(`Boolean(document.querySelector(${q(query)}))`, "Reading Find from a native selected passage");
}
async function close(tools) {
  if (await tools.evaluate(`Boolean(document.querySelector(${q(panel)}))`)) await tools.click(panel + ' button[name="close"]');
  await tools.wait(`!document.querySelector(${q(panel)})`, "captured Reading Find closes");
}
async function narrow(tools) {
  const original = await tools.evaluate(`document.querySelector(${q(panel)}).style.maxWidth`);
  try {
    await tools.evaluate(`document.querySelector(${q(panel)}).style.maxWidth="320px";new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
    const geometry = await tools.evaluate(`(()=>{const p=document.querySelector(${q(panel)}),rect=e=>e.getBoundingClientRect().toJSON();return{panel:rect(p),rows:[...p.children].map(row=>({rect:rect(row),children:[...row.children].map(rect)}))}})()`);
    assert.ok(geometry.panel.width <= 321);
    for (const row of geometry.rows) {
      for (const child of row.children) assert.ok(child.width > 0 && child.height >= 16 && child.left >= geometry.panel.left - 1 && child.right <= geometry.panel.right + 1, "captured Reading controls fit320px: " + JSON.stringify(geometry));
      for (let i = 0; i < row.children.length; i++) for (let j = i + 1; j < row.children.length; j++) {
        const a = row.children[i], b = row.children[j]; assert.equal(Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5, false, "captured Reading controls never overlap");
      }
    }
    await tools.capture?.("reading-selection-narrow");
  } finally { await tools.evaluate(`document.querySelector(${q(panel)}).style.maxWidth=${q(original)}`); }
}

/** Real Reading selections and controls; no note mutations, persisted scopes or DOM wrappers. */
export async function checkReadingSelection(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture } = tools;
  const folder = "Reading selected passages", path = folder + "/Passages.md", other = folder + "/Other.md";
  const original = "---\r\nhidden-scope: alpha\r\n---\r\n# Reading selected passages λ\r\n\r\nalpha **alpha**\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\nΩ ω alphaβ alpha\r\n\r\nsoft\r\nbreak and spaced   words.\r\n\r\nleft  \r\nright\r\n\r\nleft $\\text{alpha}$ right\r\n\r\n```text\r\nalpha alpha\r\n```\r\n";
  const otherText = "# Other Reading note\r\n\r\nalpha stays separate.\r\n", bytes = text => Buffer.from("\ufeff" + text);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled"), localRoot = await evaluate("app.vault.rootPath");
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder), { recursive: true }); await writeFile(join(directory, path), bytes(original), { flag: "wx" }); await writeFile(join(directory, other), bytes(otherText), { flag: "wx" });
  let stage = "prepare Reading fixture";
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "History marker Ω" }); await evaluate("app.editor.undo();globalThis.readingSelectionSource={editor:app.editor,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection};true");
    assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate('(async()=>{app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()');
    await select(tools); await open(tools);
    assert.equal(await evaluate(`document.querySelector(${q(query)}).value`), "alpha alpha");
    assert.equal(await evaluate(`document.querySelector(${q(restrict)}).checked`), false);
    await fill(tools, "alpha"); await click(restrict); await count(tools, 2, 1);
    await select(tools, "alpha alpha", 2); await wait(`!document.querySelector(${q(addSelection)}).disabled`, "Add selection owns a fresh native Reading passage"); await click(addSelection); await count(tools, 4, 2);
    const paint = await evaluate(invoke(nativePaint)); assert.equal(paint.count, 4); assert.deepEqual(paint.paragraphs, [0, 0, 2, 2]); assert.deepEqual(paint.values, ["alpha", "alpha", "alpha", "alpha"]);
    const active = await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`);
    await press("F3", "F3", 114); await press("F3", "F3", 114, 8); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), active);
    for (let i = 0; i < 4; i++) await press("F3", "F3", 114);
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), active); await count(tools, 4, 2);
    await narrow(tools); await capture?.("reading-selection");
    assert.equal(await evaluate("app.editor===readingSelectionSource.editor&&app.editor.cm.state.doc===readingSelectionSource.doc&&app.editor.cm.state.selection.eq(readingSelectionSource.selection)"), true);
    assert.deepEqual(await readFile(join(directory, path)), bytes(original));
    pass(report, "Native Reading selections and actual In selection/Add selection controls capture two disjoint passages; four painted/native Range matches and wrapped F3/ShiftF3 exclude the middle paragraph, preserve the hidden editor/document/selection and exact BOM/CRLF, and all controls fit320px without overlap.");

    stage = "explicit recapture, Unicode and visible barriers";
    await select(tools, "Ω ω alphaβ alpha"); await click(useSelection); await fill(tools, "ω"); await count(tools, 2, 1);
    await click(panel + ' [name="case"]'); await count(tools, 1, 1); await click(panel + ' [name="case"]');
    await fill(tools, "alpha"); await click(panel + ' [name="word"]'); await count(tools, 1, 1); await click(panel + ' [name="word"]'); await count(tools, 2, 1);
    await select(tools, "alpha alpha", 0); await click(useSelection); await fill(tools, "alpha alpha"); await count(tools, 1, 1);
    const whitespace = await evaluate(`(()=>{const r=${root},p=[...r.querySelectorAll("p")].find(p=>p.closest(".markdown-preview-view")===r&&p.textContent.startsWith("soft"));return p.textContent})()`);
    await select(tools, whitespace); await click(useSelection); await fill(tools, "soft break"); await count(tools, 1, 1); await fill(tools, "spaced words"); await count(tools, 1, 1);
    await evaluate(`(()=>{const r=${root},p=[...r.querySelectorAll("p")].find(p=>p.closest(".markdown-preview-view")===r&&p.querySelector("br"));if(!p)throw Error("Missing hard-break paragraph");p.scrollIntoView({block:"center"});r.focus();const range=document.createRange();range.selectNodeContents(p);const s=document.getSelection();s.removeAllRanges();s.addRange(range)})()`);
    await wait(`!document.querySelector(${q(useSelection)}).disabled`, "native hard-break passage captured"); await click(useSelection); await fill(tools, "leftright"); await count(tools, 0, 1); await fill(tools, "left"); await count(tools, 1, 1);
    assert.equal(await evaluate("app.editor.getValue()"), original);
    pass(report, "Use current selection explicitly replaces the union; scoped Unicode case/whole-word checks retain original boundaries, inline formatting and collapsed prose whitespace remain searchable, and even a selected hard-break passage cannot create a cross-barrier match.");

    stage = "stale DOM and owner cleanup";
    await select(tools); await click(useSelection); await fill(tools, "alpha"); await select(tools, "alpha alpha", 2); await click(addSelection); await count(tools, 4, 2);
    await evaluate(`(()=>{const r=${root},p=[...r.querySelectorAll("p")].find(p=>p.closest(".markdown-preview-view")===r&&p.textContent==="alpha alpha");globalThis.readingSelectionHeld={add:document.querySelector(${q(addSelection)}),use:document.querySelector(${q(useSelection)}),query:document.querySelector(${q(query)}),node:p.firstChild,text:p.firstChild.data};p.firstChild.data="omega ";readingSelectionHeld.add.dispatchEvent(new MouseEvent("click",{bubbles:true}))})()`);
    await count(tools, 0); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchScope`), "stale");
    await evaluate("readingSelectionHeld.node.data=readingSelectionHeld.text"); await fill(tools, "alpha"); await count(tools, 0);
    await select(tools); await click(useSelection); await count(tools, 2, 1);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");readingSelectionHeld.add.dispatchEvent(new MouseEvent("click",{bubbles:true}));readingSelectionHeld.query.value="obsolete";readingSelectionHeld.query.dispatchEvent(new Event("input",{bubbles:true}))');
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))||CSS.highlights.has("slopsidian-reading-search")||CSS.highlights.has("slopsidian-reading-search-active")`), false);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), original + "History marker Ω"); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate('(async()=>{app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()'); await select(tools); await open(tools); await fill(tools, "alpha");
    assert.equal(await evaluate(`document.querySelector(${q(restrict)}).checked`), false); await click(restrict); await count(tools, 2, 1);
    await evaluate(`globalThis.readingSelectionHeldAdd=document.querySelector(${q(addSelection)});app.openFile(${q(other)})`);
    await wait(`app.workspace.getActiveFile()?.path===${q(other)}&&!app.workspace.isChangingFiles`, "another note invalidates the captured Reading owner");
    await evaluate('readingSelectionHeldAdd.dispatchEvent(new MouseEvent("click",{bubbles:true}))'); assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))`), false);
    assert.deepEqual(await readFile(join(directory, path)), bytes(original)); assert.deepEqual(await readFile(join(directory, other)), bytes(otherText));
    pass(report, "Changed rendered text invalidates the captured union before queued observer callbacks; restoring text cannot revive it without explicit recapture. Mode/file changes discard held controls/paint, a fresh Find has no restriction, and the original Source redo/undo history plus exact note bytes remain intact.");

    stage = "restart without persisted scope";
    await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()`); await select(tools); await open(tools); await fill(tools, "alpha"); await click(restrict); await count(tools, 2, 1);
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&!app.changingVault`, "Reading mode returns after restart/reconnection");
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))`), false); await evaluate(`${root}.focus()`); await open(tools);
    assert.equal(await evaluate(`document.querySelector(${q(restrict)}).checked`), false); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchSelectionRanges`), "0");
    await fill(tools, "alpha"); assert.ok(await evaluate(`Number(document.querySelector(${q(panel)}).dataset.readingSearchCount)`) >= 6); await close(tools);
    assert.equal(await evaluate("app.editor.getValue()"), original); assert.deepEqual(await readFile(join(directory, path)), bytes(original));
    report.readingSelection = { nativeDomRanges: true, explicitTwoPassages: true, noGapMatches: true, queryAndNavigationRetainScope: true, unicodeAndWhitespace: true, barriers: true, staleDomRefusal: true, ownerCleanup: true, historyAndExactBytes: true, narrowControls: true, restartWithoutPersistedScope: true };
    pass(report, "Full native restart or actual-folder browser reconnection restores Reading and exact source while closing the old Find and dropping its capture; a fresh unrestricted search sees all ordinary body matches without any persisted hidden restriction.");
  } catch (error) {
    try { report.readingSelectionFailure = { stage, ...await evaluate(`(()=>{const p=document.querySelector(${q(panel)});return{file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),root:app.vault.rootPath,panel:p?.outerHTML.slice(0,5000),selection:document.getSelection()?.toString(),sourceLength:app.editor.getValue().length,paint:${invoke(nativePaint)},focus:document.activeElement?.outerHTML.slice(0,400)}})()`) }; await capture?.("reading-selection-precleanup-failure"); } catch (diagnostic) { report.readingSelectionFailure = { stage, diagnostic: String(diagnostic) }; }
    throw error;
  } finally {
    if (await evaluate("app.vault.rootPath").catch(() => null) === localRoot) {
      await close(tools); await evaluate(`(async()=>{delete globalThis.readingSelectionSource;delete globalThis.readingSelectionHeld;delete globalThis.readingSelectionHeldAdd;await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");const text=app.editor.getValue();if(text!==${q(original)})app.editor.replaceExpected(text,0,text.length,${q(original)},"input.reading-selection-cleanup");await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();await app.markdownAutosave.setEnabled(${q(autosave)})})()`);
    }
  }
}

/** Parent supplies and hashes a genuine cache-only note containing three alpha paragraphs. */
export async function checkReadingSelectionReadOnly(tools) {
  const { evaluate, wait, click, press, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()');
  const original = await evaluate("app.editor.getValue()");
  try {
    await select(tools); await open(tools); await fill(tools, "alpha"); await click(restrict); await count(tools, 2, 1);
    await select(tools, "alpha alpha", 2); await wait(`!document.querySelector(${q(addSelection)}).disabled`, "cache-only Reading passage is capturable"); await click(addSelection); await count(tools, 4, 2);
    const paint = await evaluate(invoke(nativePaint)); assert.deepEqual(paint.paragraphs, [0, 0, 2, 2]);
    await press("F3", "F3", 114); await press("F3", "F3", 114, 8); await count(tools, 4, 2);
    assert.deepEqual(await evaluate('["editor:open-search-replace","editor:replace-next","editor:replace-all"].map(id=>app.commands.executeCommandById(id))'), [false, false, false]);
    assert.equal(await evaluate("app.editor.getValue()"), original); await capture?.("reading-selection-readonly"); await close(tools);
    assert.equal(await evaluate('CSS.highlights.has("slopsidian-reading-search")||CSS.highlights.has("slopsidian-reading-search-active")'), false);
    report.readingSelection = { ...(report.readingSelection ?? {}), cachedReadOnly: true };
    pass(report, "A genuine cache-only read-only Reading note captures two real native passages and paints/navigates exactly four union matches while excluding the middle paragraph; all replacement commands refuse, Close releases ranges, and source stays exact while the parent audits zero requests and cached blobs.");
  } catch (error) {
    try { report.readingSelectionReadOnlyFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),readOnly:app.vault.readOnly,panel:document.querySelector(${q(panel)})?.outerHTML.slice(0,5000),selection:document.getSelection()?.toString()}))()`); await capture?.("reading-selection-readonly-precleanup-failure"); } catch { /* Preserve the actual assertion failure. */ }
    throw error;
  } finally {
    await close(tools); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); assert.equal(await evaluate("app.editor.getValue()"), original);
  }
}
