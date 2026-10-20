import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const panel = '[data-reading-search="true"]';
const query = panel + ' [data-reading-search-query]';
const regexp = panel + ' [data-reading-search-regexp]';
const restrict = panel + ' [data-reading-search-selection]';
const useSelection = panel + ' [data-reading-search-use-selection]';
const addSelection = panel + ' [data-reading-search-add-selection]';
const root = "app.workspace.activeLeaf.view.previewEl";
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };

function selectParagraph(text, index) {
  const root = app.workspace.activeLeaf.view.previewEl;
  const paragraph = [...root.querySelectorAll("p")].filter(p => p.closest(".markdown-preview-view") === root && p.textContent === text)[index];
  if (!paragraph?.checkVisibility()) throw Error("Missing visible owned Reading regex paragraph: " + text + " #" + index);
  paragraph.scrollIntoView({ block: "center" }); root.focus({ preventScroll: true });
  const range = root.ownerDocument.createRange(); range.selectNodeContents(paragraph);
  const selection = root.ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  return { text: range.toString(), rendered: selection.toString(), count: selection.rangeCount, owned: root.contains(range.startContainer) && root.contains(range.endContainer) };
}

function nativePaint() {
  const root = app.workspace.activeLeaf.view.previewEl;
  const ranges = [...(CSS.highlights?.get("slopsidian-reading-search") ?? [])].filter(range => root.contains(range.startContainer));
  const paragraphs = [...root.querySelectorAll("p")].filter(p => p.closest(".markdown-preview-view") === root && p.textContent === "alpha alpha");
  return { count: ranges.length, values: ranges.map(range => range.toString()), paragraphs: ranges.map(range => paragraphs.findIndex(p => p.contains(range.startContainer))),
    active: [...(CSS.highlights?.get("slopsidian-reading-search-active") ?? [])].filter(range => root.contains(range.startContainer)).map(range => range.toString()) };
}

async function select(tools, text = "alpha alpha", index = 0) {
  const native = await tools.evaluate(invoke(selectParagraph, text, index));
  assert.equal(native.text, text); assert.equal(native.count, 1); assert.equal(native.owned, true);
  assert.equal(native.rendered.replace(/\s+/gu, " ").trim(), text.replace(/\s+/gu, " ").trim());
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
}
async function fill({ click, press, command }, value) {
  await click(query); await press("a", "KeyA", 65, 2);
  if (value) await command("Input.insertText", { text: value }); else await press("Backspace", "Backspace", 8);
}
async function count({ evaluate, wait }, value, ranges = null) {
  await wait(`document.querySelector(${q(panel)})?.dataset.readingSearchCount===${q(String(value))}`, "Reading regex count " + value);
  if (ranges !== null) {
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchSelectionRanges`), String(ranges));
    assert.equal(await evaluate(`document.querySelector(${q(restrict)}).checked`), true);
  }
}
async function open(tools) {
  await tools.press("f", "KeyF", 70, 2);
  await tools.wait(`Boolean(document.querySelector(${q(query)}))`, "managed CtrlF opens Reading regex Find");
}
async function close(tools) {
  if (await tools.evaluate(`Boolean(document.querySelector(${q(panel)}))`)) await tools.click(panel + ' button[name="close"]');
  await tools.wait(`!document.querySelector(${q(panel)})`, "Reading regex Find closes");
}
async function narrow(tools) {
  const original = await tools.evaluate(`document.querySelector(${q(panel)}).style.maxWidth`);
  try {
    await tools.evaluate(`document.querySelector(${q(panel)}).style.maxWidth="320px";new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
    const geometry = await tools.evaluate(`(()=>{const p=document.querySelector(${q(panel)}),rect=e=>e.getBoundingClientRect().toJSON();return{panel:rect(p),rows:[...p.children].map(row=>[...row.children].map(rect))}})()`);
    assert.ok(geometry.panel.width <= 321);
    for (const row of geometry.rows) {
      for (const child of row) assert.ok(child.width > 0 && child.height >= 16 && child.left >= geometry.panel.left - 1 && child.right <= geometry.panel.right + 1, "Reading regex controls fit320px: " + JSON.stringify(geometry));
      for (let i = 0; i < row.length; i++) for (let j = i + 1; j < row.length; j++) {
        const a = row[i], b = row[j]; assert.equal(Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5, false, "Reading regex controls never overlap");
      }
    }
    await tools.capture?.("reading-regex-narrow");
  } finally { await tools.evaluate(`document.querySelector(${q(panel)}).style.maxWidth=${q(original)}`); }
}

/** Native DOM selections, actual Find controls, exact bytes, ownership and restart. */
export async function checkReadingRegex(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture } = tools;
  const folder = "Reading regex", path = folder + "/Patterns.md", other = folder + "/Other.md";
  const original = "---\r\nhidden-regex: alpha\r\n---\r\n# Reading regular expressions λ\r\n\r\nalpha **alpha**\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\nΩ ω Kelvin KELVIN 😀\r\n\r\nλ λx xλ (λ)\r\n\r\nsoft\r\nbreak and spaced   words.\r\n\r\nleft  \r\nright\r\n\r\nleft $\\text{omitted}$ right\r\n\r\n```text\r\nanchor\r\nbeta\r\nanchor\r\n```\r\n";
  const otherText = "# Other regex note\r\n\r\nAnother owned renderer.\r\n", bytes = text => Buffer.from("\ufeff" + text);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled"), localRoot = await evaluate("app.vault.rootPath");
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, folder), { recursive: true }); await writeFile(join(directory, path), bytes(original), { flag: "wx" }); await writeFile(join(directory, other), bytes(otherText), { flag: "wx" });
  let stage = "prepare Reading regex fixture";
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "Regex history Ω" });
    await evaluate("app.editor.undo();globalThis.readingRegexSource={editor:app.editor,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection};true");
    assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate('(async()=>{app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()');
    await evaluate(`(()=>{const r=${root},p=[...r.querySelectorAll("p")].find(p=>p.textContent==="alpha alpha"),walker=document.createTreeWalker(r,4),nodes=[];for(let n;(n=walker.nextNode());)nodes.push({node:n,text:n.data});globalThis.readingRegexDom={root:r,p,nodes,html:r.innerHTML,hits:0};p.addEventListener("reading-regex-probe",()=>readingRegexDom.hits++);return true})()`);
    await select(tools); await open(tools);
    assert.equal(await evaluate(`document.querySelector(${q(regexp)}).checked`), false);
    await fill(tools, "[a]lpha"); await count(tools, 0); await click(regexp); await count(tools, 6);
    assert.deepEqual((await evaluate(invoke(nativePaint))).values, Array(6).fill("alpha"));
    await click(restrict); await count(tools, 2, 1);
    await select(tools, "alpha alpha", 2); await wait(`!document.querySelector(${q(addSelection)}).disabled`, "fresh native Reading passage is addable"); await click(addSelection); await count(tools, 4, 2);
    const paint = await evaluate(invoke(nativePaint)); assert.deepEqual(paint.paragraphs, [0, 0, 2, 2]); assert.deepEqual(paint.values, Array(4).fill("alpha"));
    const active = await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`);
    await press("F3", "F3", 114); await press("F3", "F3", 114, 8); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), active);
    await click(query); await press("Enter", "Enter", 13); await press("Enter", "Enter", 13, 8); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), active);
    await evaluate(`document.querySelector(${q(query)}).dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}))`); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), active);
    await fill(tools, "^(alpha) [a]lpha$"); await count(tools, 2, 2); assert.deepEqual((await evaluate(invoke(nativePaint))).paragraphs, [0, 2]);
    await narrow(tools); await capture?.("reading-regex");
    pass(report, "Actual CtrlF, regex toggle, classes/captures/anchors and native CSS Highlight ranges distinguish literal syntax and capture two disjoint Reading passages without painting the middle paragraph; F3/ShiftF3, Enter/ShiftEnter and composing Enter retain the scope, and controls fit320px.");

    stage = "rejected patterns and empty matches";
    for (const pattern of ["(a+)+$", "a|b", "(?=alpha)", "(alpha)\\1"]) {
      await fill(tools, pattern); await count(tools, 0, 2);
      assert.equal(await evaluate(`document.querySelector(${q(query)}).getAttribute("aria-invalid")`), "true");
      assert.match(await evaluate(`document.querySelector(${q(panel + " .reading-search-status")}).textContent`), /Fixed-width/);
      assert.equal((await evaluate(invoke(nativePaint))).count, 0); await press("F3", "F3", 114); await count(tools, 0, 2);
    }
    await click(regexp); assert.equal(await evaluate(`document.querySelector(${q(query)}).getAttribute("aria-invalid")`), "false"); await click(regexp);
    for (const pattern of ["()", "^", "$", "\\b"]) {
      await fill(tools, pattern); await count(tools, 0, 2); assert.equal((await evaluate(invoke(nativePaint))).count, 0);
      assert.equal(await evaluate(`document.querySelector(${q(query)}).getAttribute("aria-invalid")`), "false");
    }
    await fill(tools, "[a]lpha"); await count(tools, 4, 2);
    pass(report, "Unsupported repetition, branching, lookaround and backreferences show the shared fixed-width validation error and remove all old paint. Empty captures, anchors and word boundaries terminate with zero painted/countable matches; editing back to a valid pattern retains the two captured passages.");

    stage = "Unicode and rendered whitespace semantics";
    await select(tools, "Ω ω Kelvin KELVIN 😀"); await click(useSelection); await fill(tools, "[ω]"); await count(tools, 2, 1);
    await click(panel + ' [name="case"]'); await count(tools, 1, 1); await click(panel + ' [name="case"]'); await count(tools, 2, 1);
    await fill(tools, "[k]elvin"); await count(tools, 2, 1); assert.deepEqual((await evaluate(invoke(nativePaint))).values, ["Kelvin", "KELVIN"]);
    await fill(tools, "(😀)$"); await count(tools, 1, 1); assert.deepEqual((await evaluate(invoke(nativePaint))).values, ["😀"]);
    await select(tools, "λ λx xλ (λ)"); await click(useSelection); await fill(tools, "[λ]"); await count(tools, 4, 1); await click(panel + ' [name="word"]'); await count(tools, 2, 1); await click(panel + ' [name="word"]');
    await select(tools, "soft\nbreak and spaced   words."); await click(useSelection); await fill(tools, "(soft)\\s(break)"); await count(tools, 1, 1);
    assert.deepEqual((await evaluate(invoke(nativePaint))).values, ["soft\nbreak"]);
    await fill(tools, "spaced   words"); await count(tools, 0, 1); await fill(tools, "spaced words"); await count(tools, 1, 1); assert.deepEqual((await evaluate(invoke(nativePaint))).values, ["spaced   words"]);
    await click(restrict); await fill(tools, "^(anchor)$"); await count(tools, 2); assert.deepEqual((await evaluate(invoke(nativePaint))).values, ["anchor", "anchor"]);
    await fill(tools, "anchor\\nbeta"); await count(tools, 1); assert.deepEqual((await evaluate(invoke(nativePaint))).values, ["anchor\nbeta"]);
    for (const pattern of ["soft\\nbreak", "leftright", "alphaalpha"]) { await fill(tools, pattern); await count(tools, 0); }
    assert.equal(await evaluate(`(()=>{const d=readingRegexDom,r=${root};d.p.dispatchEvent(new Event("reading-regex-probe"));return r===d.root&&d.hits===1&&d.p.isConnected&&d.nodes.every(({node,text})=>r.contains(node)&&node.data===text)&&r.innerHTML===d.html})()`), true);
    assert.equal(await evaluate("app.editor===readingRegexSource.editor&&app.editor.cm.state.doc===readingRegexSource.doc&&app.editor.cm.state.selection.eq(readingRegexSource.selection)"), true);
    assert.deepEqual(await readFile(join(directory, path)), bytes(original));
    pass(report, "Regex preserves Unicode case folds, emoji ranges and whole-word boundaries. Rendered prose collapses whitespace while returning exact raw DOM ranges; code retains spaces/newlines and multiline anchors. Block/widget gaps do not match, original DOM nodes/listeners remain intact, and hidden Source state plus BOM/CRLF bytes stay exact.");

    stage = "stale renderer and held regex controls";
    await select(tools); await click(useSelection); await fill(tools, "[a]lpha"); await select(tools, "alpha alpha", 2); await click(addSelection); await count(tools, 4, 2);
    await evaluate(`(()=>{const p=readingRegexDom.p;globalThis.readingRegexHeld={regexp:document.querySelector(${q(regexp)}),query:document.querySelector(${q(query)}),node:p.firstChild,text:p.firstChild.data};p.firstChild.data="omega ";readingRegexHeld.regexp.dispatchEvent(new Event("change",{bubbles:true}))})()`);
    await count(tools, 0); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchScope`), "stale"); assert.equal((await evaluate(invoke(nativePaint))).count, 0);
    await evaluate("readingRegexHeld.node.data=readingRegexHeld.text"); await fill(tools, "[a]lpha"); await count(tools, 0);
    await select(tools); await click(useSelection); await count(tools, 2, 1);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");readingRegexHeld.regexp.dispatchEvent(new Event("change",{bubbles:true}));readingRegexHeld.query.dispatchEvent(new Event("input",{bubbles:true}))');
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))||CSS.highlights.has("slopsidian-reading-search")||CSS.highlights.has("slopsidian-reading-search-active")`), false);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), original + "Regex history Ω"); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate('(async()=>{app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()'); await select(tools); await open(tools);
    assert.equal(await evaluate(`document.querySelector(${q(regexp)}).checked`), false); assert.equal(await evaluate(`document.querySelector(${q(restrict)}).checked`), false);
    await fill(tools, "[a]lpha"); await click(regexp); await count(tools, 6);
    await evaluate(`globalThis.readingRegexHeldControl=document.querySelector(${q(regexp)});app.openFile(${q(other)})`);
    await wait(`app.workspace.getActiveFile()?.path===${q(other)}&&!app.workspace.isChangingFiles`, "file change releases Reading regex owner");
    await evaluate('readingRegexHeldControl.dispatchEvent(new Event("change",{bubbles:true}))'); assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))||CSS.highlights.has("slopsidian-reading-search")`), false);
    assert.deepEqual(await readFile(join(directory, path)), bytes(original)); assert.deepEqual(await readFile(join(directory, other)), bytes(otherText));
    pass(report, "Changed Reading text invalidates all selected regex results before observer delivery and requires explicit recapture. Held regex/query controls cannot revive paint after mode/file changes; a fresh Find resets regex and restriction, while original Source redo/undo and exact files survive.");

    stage = "restart drops regex mode and scope";
    await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()`); await select(tools); await open(tools); await fill(tools, "[a]lpha"); await click(regexp); await click(restrict); await count(tools, 2, 1);
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&!app.changingVault`, "Reading regex note returns after restart/reconnection");
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))`), false); await evaluate(`${root}.focus()`); await open(tools);
    assert.equal(await evaluate(`document.querySelector(${q(regexp)}).checked`), false); assert.equal(await evaluate(`document.querySelector(${q(restrict)}).checked`), false);
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchSelectionRanges`), "0");
    await fill(tools, "[a]lpha"); await count(tools, 0); await click(regexp); await count(tools, 6); await press("Escape", "Escape", 27); await wait(`!document.querySelector(${q(panel)})`, "Escape closes restarted Reading regex Find");
    assert.equal(await evaluate('CSS.highlights.has("slopsidian-reading-search")||CSS.highlights.has("slopsidian-reading-search-active")'), false);
    assert.equal(await evaluate("app.editor.getValue()"), original); assert.deepEqual(await readFile(join(directory, path)), bytes(original));
    report.readingRegex = { literalOptIn: true, boundedValidation: true, capturesClassesAnchors: true, zeroWidthTerminates: true, nativeRanges: true, disjointPassages: true, unicodeCaseAndWords: true, proseAndExactCode: true, noGapMatches: true, originalDomAndListeners: true, historyAndExactBytes: true, staleQueryClearsPaint: true, ownerCleanup: true, narrowControls: true, restartWithoutPersistedModeOrScope: true };
    pass(report, "Native restart or actual-folder browser reconnection restores Reading and exact source while dropping the old Find, regex mode and captured union. A fresh Find defaults to literal, explicit regex still finds six body matches, and Escape releases all ranges.");
  } catch (error) {
    try { report.readingRegexFailure = { stage, ...await evaluate(`(()=>{const p=document.querySelector(${q(panel)});return{file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),panel:p?.outerHTML.slice(0,5000),selection:document.getSelection()?.toString(),paint:${invoke(nativePaint)},sourceLength:app.editor.getValue().length,focus:document.activeElement?.outerHTML.slice(0,400)}})()`) }; await capture?.("reading-regex-precleanup-failure"); }
    catch (diagnostic) { report.readingRegexFailure = { stage, diagnostic: String(diagnostic) }; }
    throw error;
  } finally {
    if (await evaluate("app.vault.rootPath").catch(() => null) === localRoot) {
      await close(tools); await evaluate(`(async()=>{delete globalThis.readingRegexSource;delete globalThis.readingRegexDom;delete globalThis.readingRegexHeld;delete globalThis.readingRegexHeldControl;await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");const text=app.editor.getValue();if(text!==${q(original)})app.editor.replaceExpected(text,0,text.length,${q(original)},"input.reading-regex-cleanup");await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();await app.markdownAutosave.setEnabled(${q(autosave)})})()`);
    }
  }
}

/** Parent supplies/hashes a cache-only note with three alpha alpha paragraphs. */
export async function checkReadingRegexReadOnly(tools) {
  const { evaluate, click, wait, press, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()');
  const original = await evaluate("app.editor.getValue()");
  try {
    await select(tools); await open(tools); await fill(tools, "[a]lpha"); await click(regexp); await click(restrict); await count(tools, 2, 1);
    await select(tools, "alpha alpha", 2); await wait(`!document.querySelector(${q(addSelection)}).disabled`, "cache-only native regex passage is addable"); await click(addSelection); await count(tools, 4, 2);
    const paint = await evaluate(invoke(nativePaint)); assert.deepEqual(paint.paragraphs, [0, 0, 2, 2]); assert.deepEqual(paint.values, Array(4).fill("alpha"));
    await press("F3", "F3", 114); await press("F3", "F3", 114, 8); await count(tools, 4, 2);
    await fill(tools, "(a+)+$"); await count(tools, 0, 2); assert.equal((await evaluate(invoke(nativePaint))).count, 0);
    await fill(tools, "()"); await count(tools, 0, 2); await fill(tools, "^(alpha) [a]lpha$"); await count(tools, 2, 2);
    assert.deepEqual(await evaluate('["editor:open-search-replace","editor:replace-next","editor:replace-all"].map(id=>app.commands.executeCommandById(id))'), [false, false, false]);
    assert.equal(await evaluate("app.editor.getValue()"), original); await capture?.("reading-regex-readonly"); await close(tools);
    assert.equal(await evaluate('CSS.highlights.has("slopsidian-reading-search")||CSS.highlights.has("slopsidian-reading-search-active")'), false);
    report.readingRegex = { ...(report.readingRegex ?? {}), cachedReadOnly: true };
    pass(report, "A genuine cache-only Reading note supports regex classes/captures/anchors, two native captured passages and exactly four word ranges excluding the middle paragraph. Unsupported and empty patterns clear paint, all replacement commands refuse, Close releases ranges and source stays exact while the parent audits requests/cache bytes.");
  } catch (error) {
    try { report.readingRegexReadOnlyFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),readOnly:app.vault.readOnly,panel:document.querySelector(${q(panel)})?.outerHTML.slice(0,5000),selection:document.getSelection()?.toString()}))()`); await capture?.("reading-regex-readonly-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally { await close(tools); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")'); assert.equal(await evaluate("app.editor.getValue()"), original); }
}
