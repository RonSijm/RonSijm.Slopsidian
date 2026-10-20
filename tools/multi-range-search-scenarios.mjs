import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const panel = '[data-multi-range-search-fixture] [data-editor-search="true"]';
const query = panel + ' [data-editor-search-query]';
const replacement = panel + ' [data-editor-search-replace]';
const scoped = panel + ' [data-editor-search-selection]';
const status = panel + ' .editor-search-status';
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };

async function fill({ click, press, command }, selector, value) {
  await click(selector); await press("a", "KeyA", 65, 2);
  if (value) await command("Input.insertText", { text: value });
  else await press("Backspace", "Backspace", 8);
}
async function checked({ evaluate, click }, name, value) {
  const selector = panel + ` [name="${name}"]`;
  if (await evaluate(`document.querySelector(${q(selector)}).checked`) !== value) await click(selector);
}
async function count({ wait }, matches, ranges = 2) {
  await wait(`(()=>{const value=document.querySelector(${q(status)})?.textContent??"";return value.includes(${q(`${matches} matches in selection (${ranges} ranges)`)})})()`, "captured union has exact matches and range count");
}
async function select(tools, firstLine = 2, lastLine = 6) {
  await tools.evaluate(`(()=>{const editor=app.editor;editor.cm.dom.dataset.multiRangeSearchFixture="true";editor.setSelections([{anchor:{line:${firstLine},ch:0},head:{line:${firstLine},ch:editor.getLine(${firstLine}).length}},{anchor:{line:${lastLine},ch:0},head:{line:${lastLine},ch:editor.getLine(${lastLine}).length}}],1);editor.focus()})()`);
}
async function prepare(tools, search, replace) {
  await tools.evaluate('app.editor.closeSearch();app.editor.cm.dom.dataset.multiRangeSearchFixture="true";app.editor.setCursor(0);app.editor.focus()');
  await tools.press("h", "KeyH", 72, 2); await tools.wait(`Boolean(document.querySelector(${q(query)}))`, "visible Find/Replace panel");
  await fill(tools, query, "Retained query"); await tools.click(panel + ' button[name="close"]');
  await select(tools);
  await tools.press("h", "KeyH", 72, 2); await tools.wait(`Boolean(document.querySelector(${q(query)}))`, "Find/Replace opened from two native selections");
  assert.equal(await tools.evaluate(`document.querySelector(${q(query)}).value`), "Retained query", "a multiple selection does not seed an arbitrary primary range as the query");
  assert.equal(await tools.evaluate(`document.querySelector(${q(scoped)}).checked`), false);
  await fill(tools, query, search); await fill(tools, replacement, replace);
  await checked(tools, "case", false); await checked(tools, "regexp", false); await checked(tools, "word", true);
  await tools.click(scoped); await count(tools, 4);
}
async function geometry({ evaluate, capture }) {
  const before = await evaluate('({value:app.editor.cm.dom.style.getPropertyValue("max-width"),priority:app.editor.cm.dom.style.getPropertyPriority("max-width")})');
  try {
    await evaluate('app.editor.cm.dom.style.setProperty("max-width","320px");app.editor.refresh();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const layout = await evaluate(`(()=>{const p=document.querySelector(${q(panel)}),bounds=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return{panel:bounds(p),rows:[...p.querySelectorAll(".editor-search-row,.editor-search-options")].filter(e=>!e.hidden).map(row=>({bounds:bounds(row),children:[...row.children].map(bounds)}))}})()`);
    assert.ok(layout.panel.width <= 321);
    for (const row of layout.rows) {
      for (const child of row.children) assert.ok(child.width > 0 && child.height > 0 && child.left >= row.bounds.left - 1 && child.right <= row.bounds.right + 1, "multi-range controls fit the wrapped narrow panel: " + JSON.stringify(layout));
      for (let i = 0; i < row.children.length; i++) for (let j = i + 1; j < row.children.length; j++) {
        const a = row.children[i], b = row.children[j];
        assert.equal(Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5, false, "multi-range controls do not overlap: " + JSON.stringify(layout));
      }
    }
    await capture?.("multi-range-search-narrow");
  } finally {
    await evaluate(`(()=>{const previous=${q(before)},style=app.editor.cm.dom.style;if(previous.value)style.setProperty("max-width",previous.value,previous.priority);else style.removeProperty("max-width");app.editor.refresh()})()`);
  }
}

/** Actual Source/Live Preview controls operate on a captured union while preserving every gap byte. */
export async function checkMultiRangeSearch(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture } = tools;
  const path = "Multi-range search/Selections.md", original = "# Multiple ranges λ\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\nKeep 😀 tail.\r\n";
  const beta = original.replace("alpha alpha", "beta beta").replace(/alpha alpha\r\n\r\nKeep/, "beta beta\r\n\r\nKeep");
  const final = beta.replaceAll("beta", "tabe"), bytes = value => Buffer.from("\ufeff" + value);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  await mkdir(join(directory, "Multi-range search"), { recursive: true }); await writeFile(join(directory, path), bytes(original), { flag: "wx" });
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source")})()`);
    await prepare(tools, "alpha", "beta");
    await click(panel + ' button[name="next"]'); assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 2, ch: 0 });
    await press("F3", "F3", 114); assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 2, ch: 6 });
    await press("F3", "F3", 114, 8); assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 2, ch: 0 });
    await evaluate("app.editor.setMutationLock(true)");
    try {
      assert.equal(await evaluate(`document.querySelector(${q(panel + ' button[name="replaceAll"]')}).disabled`), true);
      assert.equal(await evaluate("app.editor.replaceAll()"), false); await press("F3", "F3", 114);
      assert.equal(await evaluate("app.editor.getSelection()"), "alpha"); assert.equal(await evaluate("app.editor.getValue()"), original);
    } finally { await evaluate("app.editor.setMutationLock(false)"); }
    assert.deepEqual(await readFile(join(directory, path)), bytes(original)); await capture?.("multi-range-search");
    pass(report, "Source Find retains its prior query when opened from two selections, counts only four union matches, navigates both regions in source order and refuses locked replacement while preserving the unselected middle paragraph and exact source bytes.");

    await evaluate("app.editor.setCursor(6,2);app.editor.focus()"); await command("Input.insertText", { text: "z" });
    await wait(`document.querySelector(${q(status)}).textContent.includes("selected source changed")`, "trusted typing invalidates the entire captured union");
    assert.equal(await evaluate("app.editor.replaceAll()"), false);
    await press("z", "KeyZ", 90, 2); await wait(`app.editor.getValue()===${q(original)}`, "keyboard Undo restores the original source"); await count(tools, 4);
    await geometry(tools); await click(panel + ' button[name="replaceAll"]'); await wait(`app.editor.getValue()===${q(beta)}`, "Replace all changes only the first and last selected paragraphs");
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate("app.editor.redo();app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(beta));
    pass(report, "An edit in either selected region invalidates union matching, keyboard Undo restores it, and one isolated Replace all/Undo/Redo preserves exact BOM/CRLF and every gap/outside byte; real controls and the two-range status remain usable at 320px.");

    await evaluate('app.editor.closeSearch();app.workspace.activeLeaf.view.setEditingMode("live-preview")'); await prepare(tools, "beta", "gamma");
    await click(panel + ' button[name="replace"]'); assert.equal(await evaluate("app.editor.getValue()"), beta, "Replace next first selects one eligible match");
    assert.equal(await evaluate("app.editor.getSelection()"), "beta");
    await click(panel + ' button[name="replace"]'); assert.equal(await evaluate("app.editor.getValue()"), beta.replace(/beta beta\r\n\r\nKeep/, "gamma beta\r\n\r\nKeep"));
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), beta);
    await fill(tools, query, "(be)(ta)"); await checked(tools, "regexp", true); await fill(tools, replacement, "$2$1"); await count(tools, 4);
    await click(panel + ' button[name="replaceAll"]'); await wait(`app.editor.getValue()===${q(final)}`, "fixed-width captures replace only union matches in Live Preview");
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), beta);
    await evaluate("app.editor.redo();app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(final));
    pass(report, "Live Preview keeps the same two-range union for actual Replace next and fixed-width capture substitutions; next selects before editing, isolated history remains exact and the unselected alpha paragraph is never changed.");

    await evaluate('app.editor.setSelections([{anchor:{line:4,ch:0},head:{line:4,ch:5}},{anchor:{line:4,ch:6},head:{line:4,ch:11}}],1)'); await click(panel + ' [data-editor-search-capture-selection]');
    await checked(tools, "regexp", false); await fill(tools, query, "alpha"); await fill(tools, replacement, "X"); await count(tools, 2);
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), beta); await count(tools, 2);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), final); await count(tools, 2);
    await click(scoped); await evaluate("app.editor.undo()"); assert.equal(await evaluate(`document.querySelector(${q(scoped)}).checked`), false);
    await evaluate("app.editor.redo()"); await click(scoped); await count(tools, 2);
    await click(panel + ' button[name="replaceAll"]'); assert.equal(await evaluate("app.editor.getValue()"), final.replace("alpha alpha", "X X"));
    await click(panel + ' button[name="close"]'); await evaluate("app.editor.undo();app.editor.setCursor(0);app.editor.focus()");
    assert.equal(await evaluate("app.editor.getValue()"), final); await press("f", "KeyF", 70, 2); await fill(tools, query, "tabe");
    assert.equal(await evaluate(`document.querySelector(${q(scoped)}).checked`), false);
    await wait(`document.querySelector(${q(status)}).textContent.includes("4 matches")&&!document.querySelector(${q(status)}).textContent.includes("in selection")`, "Close revokes the old union even after Undo");
    await click(panel + ' button[name="close"]'); await evaluate("app.saveAll();app.workspace.flushLayout()"); assert.deepEqual(await readFile(join(directory, path)), bytes(final));
    pass(report, "Explicit recapture chooses another two-range union; Undo/Redo maps it without restoring the previous capture, later unchecked choices stay off, and Close followed by Undo cannot resurrect a hidden selection restriction.");

    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"&&!app.changingVault`, "multi-range fixture restored after restart/reconnection");
    assert.equal(await evaluate("app.editor.getValue()"), final); await prepare(tools, "tabe", "unused"); await count(tools, 4);
    await press("F3", "F3", 114); assert.equal(await evaluate("app.editor.getSelection()"), "tabe"); await click(panel + ' button[name="close"]');
    assert.deepEqual(await readFile(join(directory, path)), bytes(final));
    report.multiRangeSearch = { sourceAndLivePreview: true, retainedQuery: true, disjointUnion: true, staleTypingAndUndo: true, historyOwnership: true, narrowControls: true, exactSavedBytes: true, restart: true };
    pass(report, "Full native restart or browser reload/reconnection restores exact BOM/CRLF source and Live Preview; a fresh captured union works with real Find/F3 controls and no persisted hidden search restriction.");
  } catch (error) {
    report.multiRangeSearchFailure = await evaluate(`(()=>{const editor=app.workspace.activeLeaf?.view?.editor,p=document.querySelector(${q(panel)});return{activeFile:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf?.view?.getEditingMode?.(),text:editor?.getValue(),selections:editor?.cm.state.selection.ranges.map(range=>({from:range.from,to:range.to})),status:p?.querySelector(".editor-search-status")?.textContent,query:p?.querySelector("[data-editor-search-query]")?.value,replacement:p?.querySelector("[data-editor-search-replace]")?.value,inSelection:p?.querySelector("[data-editor-search-selection]")?.checked,focus:document.activeElement?.outerHTML.slice(0,500)}})()`).catch(diagnostic => ({ error: String(diagnostic) }));
    try { await capture?.("multi-range-search-precleanup-failure"); } catch { /* Retain the original failure if the renderer already exited. */ }
    throw error;
  } finally {
    await evaluate(`(async()=>{const editor=app.workspace.activeLeaf?.view?.editor;if(editor){editor.setMutationLock(false);editor.closeSearch()}await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
    if (autosave && !await evaluate("app.markdownAutosave.enabled")) await evaluate("app.markdownAutosave.setEnabled(true)");
  }
}

/** Parent supplies three alpha paragraphs in a genuine cache-only note and audits every blob/request. */
export async function checkMultiRangeSearchReadOnly(tools) {
  const { evaluate, wait, click, press, command, report } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('app.workspace.activeLeaf.view.setEditingMode("source");app.editor.closeSearch();app.editor.cm.dom.dataset.multiRangeSearchFixture="true"');
  const original = await evaluate("app.editor.getValue()");
  await evaluate('(()=>{const editor=app.editor,lines=editor.getValue().split(/\\r?\\n/).map((text,line)=>({text,line})).filter(row=>row.text==="alpha alpha");if(lines.length<3)throw Error("Missing three read-only alpha paragraphs");const a=lines[0].line,b=lines.at(-1).line;editor.setSelections([{anchor:{line:a,ch:0},head:{line:a,ch:11}},{anchor:{line:b,ch:0},head:{line:b,ch:11}}],1);editor.focus()})()');
  await press("f", "KeyF", 70, 2); await wait(`Boolean(document.querySelector(${q(query)}))`, "read-only multi-range Find panel");
  await fill(tools, query, "alpha"); await checked(tools, "regexp", false); await checked(tools, "word", true); await checked(tools, "case", false); await click(scoped); await count(tools, 4);
  await click(panel + ' button[name="next"]'); await press("F3", "F3", 114, 8); assert.equal(await evaluate("app.editor.getSelection()"), "alpha");
  await click(panel + ' button[name="show-replace"]');
  assert.equal(await evaluate(`document.querySelector(${q(replacement)}).disabled&&document.querySelector(${q(panel + ' button[name="replace"]')}).disabled&&document.querySelector(${q(panel + ' button[name="replaceAll"]')}).disabled`), true);
  assert.equal(await evaluate("app.editor.replaceNext()||app.editor.replaceAll()"), false);
  await evaluate("app.editor.focus()"); await command("Input.insertText", { text: "Refused union edit" });
  assert.equal(await evaluate("app.editor.getValue()"), original); await evaluate("app.editor.closeSearch()");
  report.multiRangeSearch = { ...(report.multiRangeSearch ?? {}), readOnlyFind: true, readOnlyNoMutations: true };
  pass(report, "A genuine cache-only read-only note searches/navigates four matches in two selected paragraphs while leaving the middle paragraph outside the union; actual input, replacement buttons and direct replacement calls cannot alter its exact source.");
}
