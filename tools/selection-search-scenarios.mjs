import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const panel = '[data-selection-search-fixture] [data-editor-search="true"]';
const query = panel + ' [data-editor-search-query]';
const replacement = panel + ' [data-editor-search-replace]';
const scoped = panel + ' [name="in-selection"]';
const status = panel + ' .editor-search-status';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function fill({ click, press, command }, selector, value) {
  await click(selector); await press("a", "KeyA", 65, 2);
  if (value) { await command("Input.insertText", { text: value }); }
  else { await press("Backspace", "Backspace", 8); }
}
async function prepare(tools, from, to, search, replace = "") {
  const { evaluate, press, wait, click } = tools;
  await evaluate(`(()=>{app.editor.closeSearch();app.editor.cm.dom.dataset.selectionSearchFixture="true";app.editor.setSelection(${JSON.stringify(from)},${JSON.stringify(to)});app.editor.focus()})()`);
  await press("h", "KeyH", 72, 2);
  await wait(`Boolean(document.querySelector(${JSON.stringify(query)}))`, "selection-search panel from application shortcut");
  await fill(tools, query, search); await fill(tools, replacement, replace);
  for (const name of ["case", "regexp"]) {
    const selector = panel + ` [name="${name}"]`;
    if (await evaluate(`document.querySelector(${JSON.stringify(selector)}).checked`)) { await click(selector); }
  }
  if (!await evaluate(`document.querySelector(${JSON.stringify(panel + ' [name="word"]')}).checked`)) { await click(panel + ' [name="word"]'); }
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(scoped)}).checked`), false, "a newly opened Find panel starts with the whole-note scope");
  await click(scoped);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(scoped)}).checked`), true);
}
async function geometry({ evaluate, capture }) {
  const before = await evaluate('({value:app.editor.cm.dom.style.getPropertyValue("max-width"),priority:app.editor.cm.dom.style.getPropertyPriority("max-width")})');
  try {
    await evaluate('app.editor.cm.dom.style.setProperty("max-width","320px");app.editor.refresh();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const layout = await evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(panel)}),r=p.getBoundingClientRect(),children=[...p.querySelector(".editor-search-options").children].filter(e=>e.getBoundingClientRect().width).map(e=>{const c=e.getBoundingClientRect();return {text:e.textContent,left:c.left,right:c.right,top:c.top,bottom:c.bottom,width:c.width,height:c.height}});return {left:r.left,right:r.right,width:r.width,children}})()`);
    assert.ok(layout.width <= 321, "the actual search panel is narrowed to 320 CSS pixels");
    for (const item of layout.children) {
      assert.ok(item.left >= layout.left - 1 && item.right <= layout.right + 1 && item.width > 0 && item.height > 0, "selection option stays usable inside its narrow panel: " + JSON.stringify(layout));
    }
    for (let i = 0; i < layout.children.length; i++) { for (let j = i + 1; j < layout.children.length; j++) {
      const a = layout.children[i], b = layout.children[j];
      assert.equal(Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5, false, "selection search option rows do not overlap: " + JSON.stringify(layout));
    } }
    await capture?.("selection-search-narrow");
  } finally {
    await evaluate(`(()=>{const previous=${JSON.stringify(before)},style=app.editor.cm.dom.style;if(previous.value)style.setProperty("max-width",previous.value,previous.priority);else style.removeProperty("max-width");app.editor.refresh()})()`);
  }
}

/** Actual Source/LP controls keep the captured source range independent of found selections. */
export async function checkSelectionSearch(tools) {
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const path = "Selection search/Scoped.md";
  const original = "# Selection search\r\n\r\nalpha outside\r\nBEGIN α😀\r\nalpha alpha alphabet\r\nalpha\r\nEND\r\nalpha outside\r\n";
  const expected = original.replace("alpha alpha alphabet\r\nalpha\r\nEND", "beta beta alphabet\r\nbeta\r\nEND");
  const final = expected.replace("beta beta alphabet\r\nbeta\r\nEND", "gamma gamma alphabet\r\ngamma\r\nEND");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  await evaluate("app.saveAll()"); if (autosave) { await evaluate("app.markdownAutosave.setEnabled(false)"); }
  await mkdir(join(directory, "Selection search"), { recursive: true }); await writeFile(join(directory, path), Buffer.from("\ufeff" + original));
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setEditingMode("source")})()`);
    await prepare(tools, { line: 4, ch: 0 }, { line: 5, ch: 5 }, "alpha", "beta");
    await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("3 matches in selection")`, "Source count excludes the two outside matches and alphabet");
    await click(panel + ' [name="next"]'); assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 4, ch: 0 });
    await press("F3", "F3", 114); assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 4, ch: 6 });
    await press("F3", "F3", 114, 8); assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 4, ch: 0 });
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(status)}).textContent.includes("3 matches in selection")`), true, "navigation does not shrink the captured source range to its current match");
    await evaluate("app.editor.setMutationLock(true)");
    try {
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' [name="replaceAll"]')}).disabled`), true);
      assert.equal(await evaluate("app.editor.replaceAll()"), false); await press("F3", "F3", 114);
      assert.equal(await evaluate("app.editor.getSelection()"), "alpha"); assert.equal(await evaluate("app.editor.getValue()"), original);
    } finally { await evaluate("app.editor.setMutationLock(false)"); }
    pass(report, "Source In selection uses the original multi-line range for counts and wrapped F3/Shift+F3; a mutation lock leaves scoped navigation available and refuses replacement.");

    await evaluate("app.editor.setCursor({line:4,ch:2});app.editor.focus()"); await command("Input.insertText", { text: "z" });
    await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("selected source changed")`, "actual in-range typing invalidates the stale search scope");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' [name="replaceAll"]')}).disabled`), true);
    assert.equal(await evaluate("app.editor.replaceAll()"), false);
    await press("z", "KeyZ", 90, 2); await wait(`app.editor.getValue()===${JSON.stringify(original)}`, "real Undo restores the source and its original search range");
    await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("3 matches in selection")`, "Undo restores the selection search identity");
    await geometry(tools);
    await click(panel + ' [name="replaceAll"]'); await wait(`app.editor.getValue()===${JSON.stringify(expected)}`, "only the three in-range whole-word matches change");
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), expected);
    pass(report, "Actual note typing invalidates a stale source scope; keyboard Undo restores it. Scoped Replace all preserves both outside matches, exact Unicode/CRLF and isolated Undo/Redo, with usable controls at 320px.");

    await evaluate("app.editor.setSelection({line:7,ch:0},{line:7,ch:5})"); await click(panel + ' [name="capture-selection"]');
    await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("1 match in selection")`, "explicit recapture selects a different source range");
    await click(panel + ' button[name="replace"]');
    assert.equal(await evaluate("app.editor.getValue()"), expected.replace(/alpha outside\r\n$/, "beta outside\r\n"));
    await evaluate("app.editor.undo();app.editor.closeSearch();app.editor.setCursor(0);app.editor.focus()");
    assert.equal(await evaluate("app.editor.getValue()"), expected); await press("f", "KeyF", 70, 2); await fill(tools, query, "alpha");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(scoped)}).checked`), false);
    await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("2 matches")`, "closing Find removes its hidden source scope");
    await evaluate('app.editor.closeSearch();app.workspace.activeLeaf.view.setEditingMode("live-preview")');
    pass(report, "Use current selection explicitly chooses another range for Replace next; one Undo preserves the earlier note, and closing/reopening Find starts with the whole-note scope.");

    await prepare(tools, { line: 4, ch: 0 }, { line: 5, ch: 4 }, "beta", "gamma");
    await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("3 matches in selection")`, "Live Preview uses the captured underlying source range");
    await click(panel + ' button[name="replace"]'); assert.equal(await evaluate("app.editor.getValue()"), expected, "Replace next first selects an in-range match");
    await click(panel + ' button[name="replace"]'); assert.equal(await evaluate("app.editor.getValue()"), expected.replace("beta beta", "gamma beta"));
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), expected);
    await click(panel + ' [name="replaceAll"]'); assert.equal(await evaluate("app.editor.getValue()"), final);
    await evaluate("app.editor.closeSearch();app.saveAll();app.workspace.flushLayout()"); assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + final));
    await capture?.("selection-search-saved");
    pass(report, "Live Preview scoped Replace next selects before changing one match, then Replace all changes the remaining selected text; physical saving preserves exact UTF-8 BOM/CRLF and every outside byte.");
    if (afterReload) {
      if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload();
      await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&!app.changingVault`, "selection-search note restores after restart/reconnection");
      assert.equal(await evaluate("app.editor.getValue()"), final); assert.equal(await evaluate('app.workspace.activeLeaf.view.getEditingMode()'), "live-preview");
      await evaluate('app.editor.cm.dom.dataset.selectionSearchFixture="true";app.editor.setCursor(0);app.editor.focus()');
      await press("f", "KeyF", 70, 2); await fill(tools, query, "gamma");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(scoped)}).checked`), false);
      await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("3 matches")`, "fresh-owner whole-note search after restart");
      await evaluate("app.editor.closeSearch()"); assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + final));
      pass(report, "Native restart or browser reload/reconnection retains exact saved source and Live Preview; a fresh Find panel has no persisted hidden selection restriction.");
    }
  } finally {
    await evaluate(`(async()=>{const v=app.workspace.activeLeaf?.view;if(v?.editor){v.editor.setMutationLock(false);v.editor.closeSearch()}await app.saveAll();await app.workspace.changeLayout(${JSON.stringify(layout)});await app.workspace.flushLayout()})()`);
    if (autosave && !await evaluate("app.markdownAutosave.enabled")) { await evaluate("app.markdownAutosave.setEnabled(true)"); }
  }
}

/** Parent owns the genuine cached GitHub fixture and asserts zero network and exact blobs. */
export async function checkSelectionSearchReadOnly(tools) {
  const { evaluate, press, wait, click, report } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true); const original = await evaluate("app.editor.getValue()");
  await evaluate('(()=>{app.editor.closeSearch();app.editor.cm.dom.dataset.selectionSearchFixture="true";const from=app.editor.cm.state.doc.toString().lastIndexOf("alpha alpha");if(from<0)throw Error("Missing read-only alpha fixture");app.editor.setSelection(app.editor.offsetToPos(from),app.editor.offsetToPos(from+5));app.editor.focus()})()');
  await press("f", "KeyF", 70, 2); await wait(`Boolean(document.querySelector(${JSON.stringify(query)}))`, "read-only selection-search panel");
  await fill(tools, query, "alpha"); await click(scoped);
  await wait(`document.querySelector(${JSON.stringify(status)}).textContent.includes("1 match in selection")`, "read-only search filters its two matches to the captured first word");
  await click(panel + ' [name="next"]'); await press("F3", "F3", 114); assert.equal(await evaluate("app.editor.getSelection()"), "alpha");
  await click(panel + ' [name="show-replace"]');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(replacement)}).disabled&&document.querySelector(${JSON.stringify(panel + ' button[name="replace"]')}).disabled&&document.querySelector(${JSON.stringify(panel + ' [name="replaceAll"]')}).disabled`), true);
  assert.equal(await evaluate("app.editor.replaceNext()||app.editor.replaceAll()"), false); assert.equal(await evaluate("app.editor.getValue()"), original);
  await evaluate("app.editor.closeSearch()");
  pass(report, "A genuine cached read-only note supports bounded selection search/navigation while disabled replacement controls and direct calls preserve all source bytes.");
}
