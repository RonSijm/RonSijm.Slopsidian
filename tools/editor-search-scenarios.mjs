import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const panel = '[data-search-fixture] [data-editor-search="true"]';
const query = panel + ' [data-editor-search-query]';
const replacement = panel + ' [data-editor-search-replace]';

async function markEditor(evaluate) {
  await evaluate('app.editor.cm.dom.dataset.searchFixture="true"');
}
async function fill({ click, press, command }, selector, value) {
  await click(selector); await press("a", "KeyA", 65, 2);
  if (value) { await command("Input.insertText", { text: value }); }
  else { await press("Backspace", "Backspace", 8); }
}
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };

async function checkSearchControlGeometry({ evaluate, capture }) {
  const measure = () => evaluate(`(()=>{const editor=app.editor.cm.dom,panel=document.querySelector(${JSON.stringify(panel)}),row=panel.querySelector(".editor-search-row"),rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return{editor:rect(editor),row:rect(row),controls:[...row.children].map(e=>({name:e.name,...rect(e)}))}})()`);
  const check = (layout, label) => {
    assert.equal(layout.controls.length, 5, label + " includes Find, Previous, Next, Replace and Close");
    for (const control of layout.controls) {
      assert.ok(control.width >= 16 && control.height >= 16, label + " has a visible usable " + control.name);
      assert.ok(control.left >= layout.row.left - 1 && control.right <= layout.row.right + 1 && control.top >= layout.row.top - 1 && control.bottom <= layout.row.bottom + 1,
        label + " keeps " + control.name + " inside the wrapped top row: " + JSON.stringify(layout));
    }
    for (let left = 0; left < layout.controls.length; left++) {
      for (let right = left + 1; right < layout.controls.length; right++) {
        const a = layout.controls[left], b = layout.controls[right];
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
        assert.equal(overlap, false, label + " controls do not overlap (" + a.name + "/" + b.name + "): " + JSON.stringify(layout));
      }
    }
  };
  check(await measure(), "Ordinary search panel");
  const previous = await evaluate('({value:app.editor.cm.dom.style.getPropertyValue("max-width"),priority:app.editor.cm.dom.style.getPropertyPriority("max-width")})');
  try {
    await evaluate('app.editor.cm.dom.style.setProperty("max-width","320px");app.editor.refresh()');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const narrow = await measure();
    assert.ok(narrow.editor.width <= 321, "The real editor container is narrowed to 320 CSS pixels: " + JSON.stringify(narrow));
    check(narrow, "Narrow search panel");
    if (capture) { await capture("editor-search-panel-narrow"); }
  } finally {
    await evaluate(`(()=>{const previous=${JSON.stringify(previous)},style=app.editor.cm.dom.style;if(previous.value)style.setProperty("max-width",previous.value,previous.priority);else style.removeProperty("max-width");app.editor.refresh()})()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  }
  check(await measure(), "Restored search panel");
}

async function checkManagedSearchHotkeys(tools, path) {
  const { evaluate, press, wait, report } = tools;
  const ids = ["editor:open-search", "editor:open-search-replace", "editor:find-next", "editor:find-previous"];
  const saved = await evaluate(`${JSON.stringify(ids)}.map(id=>({id,value:app.hotkeyManager.getHotkeys(id)??null}))`);
  const mode = await evaluate("app.workspace.activeLeaf.view.getEditingMode()");
  try {
    await evaluate(`(()=>{app.editor.closeSearch();app.editor.setCursor(0);app.editor.focus();for(const id of ${JSON.stringify(ids)})app.hotkeyManager.disableHotkeys(id)})()`);
    await press("f", "KeyF", 70, 2); await press("h", "KeyH", 72, 2);
    assert.equal(await evaluate("app.editor.searchIsOpen()"), false, "disabled bindings cannot fall back to fixed CodeMirror Find/Replace");
    const cursor = await evaluate("app.editor.getCursor()");
    await press("F3", "F3", 114); await press("F3", "F3", 114, 8);
    assert.deepEqual(await evaluate("app.editor.getCursor()"), cursor, "disabled F3 cannot fall back to CodeMirror navigation");
    await evaluate('app.hotkeyManager.setHotkeys("editor:open-search",[{modifiers:["Ctrl","Shift"],key:"y"}]);app.hotkeyManager.setHotkeys("editor:open-search-replace",[{modifiers:["Ctrl","Shift"],key:"u"}]);app.hotkeyManager.setHotkeys("editor:find-next",[{modifiers:["Alt"],key:"F3"}]);app.hotkeyManager.setHotkeys("editor:find-previous",[{modifiers:["Alt","Shift"],key:"F3"}])');
    await press("f", "KeyF", 70, 2); assert.equal(await evaluate("app.editor.searchIsOpen()"), false);
    await press("y", "KeyY", 89, 10);
    await wait(`Boolean(document.querySelector(${JSON.stringify(query)}))`, "remapped Find opens through the application manager");
    await fill(tools, query, "beta");
    await press("u", "KeyU", 85, 10);
    await wait(`!document.querySelector(${JSON.stringify(panel + " .editor-search-replacement")}).hidden`, "remapped Replace opens through the application manager");
    await press("F3", "F3", 114); assert.deepEqual(await evaluate("app.editor.getCursor()"), cursor);
    await press("F3", "F3", 114, 1); assert.equal(await evaluate("app.editor.getSelection()"), "beta");
    const first = await evaluate("app.editor.getCursor('from')");
    await press("F3", "F3", 114, 1); await press("F3", "F3", 114, 9);
    assert.deepEqual(await evaluate("app.editor.getCursor('from')"), first);
    await evaluate("app.editor.closeSearch();app.editor.focus()");
    if (await evaluate('app.commands.isRunnable("graph:open")')) {
      await press("g", "KeyG", 71, 2);
      await wait('app.workspace.activeLeaf.view.getViewType()==="graph"', "Ctrl+G retains the application Graph meaning");
      await evaluate(`(async()=>{await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setEditingMode(${JSON.stringify(mode)})})()`);
      await markEditor(evaluate);
      pass(report, "Disabled and remapped Find/Replace/F3 bindings obey HotkeyManager without CodeMirror fallback; Ctrl+G still opens Graph.");
    } else {
      await press("g", "KeyG", 71, 2);
      assert.equal(await evaluate("app.editor.searchIsOpen()"), false);
      pass(report, "Disabled and remapped Find/Replace/F3 bindings obey HotkeyManager without CodeMirror fallback; unavailable Graph does not silently become Find.");
    }
  } finally {
    await evaluate(`(()=>{for(const row of ${JSON.stringify(saved)}){if(row.value===null)app.hotkeyManager.removeHotkeys(row.id);else app.hotkeyManager.setHotkeys(row.id,row.value)}})()`);
  }
}

/** Real input, match controls, protected replace/Undo, exact bytes and restart on the shared editor. */
export async function checkEditorSearch(tools) {
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const path = "Editor search/Search.md";
  const tail = "a".repeat(40) + "!\r\n";
  const original = "# Search fixture\r\n\r\n😀 Alpha alpha alphabet\r\nalpha\r\nKeep\r\n" + tail;
  const expected = "# Search fixture\r\n\r\n😀 beta beta alphabet\r\nbeta\r\nKeep\r\n" + tail;
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  await evaluate("app.saveAll()");
  if (autosave) { await evaluate("app.markdownAutosave.setEnabled(false)"); }
  await mkdir(join(directory, "Editor search"), { recursive: true });
  await writeFile(join(directory, path), Buffer.from("\ufeff" + original));
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setSelection({line:2,ch:3},{line:2,ch:8});app.editor.focus()})()`);
    await markEditor(evaluate);
    await press("f", "KeyF", 70, 2);
    await wait(`Boolean(document.querySelector(${JSON.stringify(query)}))`, "Ctrl+F opens the note search panel");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(query)}).value`), "Alpha", "the current selection seeds Find literally");
    await fill(tools, query, "alpha");
    await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("4 matches")`, "case-insensitive match count");
    await click(panel + ' [name="word"]');
    await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("3 matches")`, "whole-word search excludes alphabet");
    await click(panel + ' [name="case"]');
    await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("2 matches")`, "match-case search excludes Alpha");
    await click(panel + ' [name="next"]');
    assert.equal(await evaluate("app.editor.getSelection()"), "alpha");
    await press("F3", "F3", 114);
    assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 3, ch: 0 });
    await press("F3", "F3", 114, 8);
    assert.deepEqual(await evaluate("app.editor.getCursor('from')"), { line: 2, ch: 9 });
    assert.equal(await evaluate("app.editor.getValue()"), original);
    pass(report, "Ctrl+F seeds the selection; real search inputs, case/whole-word controls, counts and F3/Shift+F3 navigate Unicode/CRLF text without edits.");

    await click(panel + ' [name="case"]');
    await press("h", "KeyH", 72, 2);
    await wait(`!document.querySelector(${JSON.stringify(panel + " .editor-search-replacement")}).hidden`, "Ctrl+H exposes replacement controls");
    await fill(tools, replacement, "beta");
    if (capture) { await capture("editor-search-panel"); }
    await checkSearchControlGeometry(tools);
    await click(panel + ' [name="replaceAll"]');
    await wait(`app.editor.getValue()===${JSON.stringify(expected)}`, "replace all changes only the whole-word matches");
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), expected);
    await evaluate(`globalThis.closedSearchReplaceButton=document.querySelector(${JSON.stringify(panel + ' [name="replaceAll"]')})`);
    await press("Escape", "Escape", 27);
    await wait(`!document.querySelector(${JSON.stringify(panel)})`, "Escape closes Find and retains the editor");
    await evaluate("closedSearchReplaceButton.click();delete globalThis.closedSearchReplaceButton");
    assert.equal(await evaluate("app.editor.getValue()"), expected, "a detached replace button cannot mutate its former editor");
    pass(report, "Ctrl+H and real Replace all preserve nonmatches and Unicode/CRLF; top-row controls stay visible without overlap at ordinary and 320px editor widths, one Undo/Redo isolates the replacement, and detached controls refuse edits.");

    await evaluate('app.workspace.activeLeaf.view.setEditingMode("live-preview");app.editor.focus()');
    await press("f", "KeyF", 70, 2); await fill(tools, query, "beta");
    await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("3 matches")`, "Find operates on the Live Preview source document");
    await evaluate("app.editor.showSearch(true);app.editor.setMutationLock(true)");
    try {
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(replacement)}).disabled&&document.querySelector(${JSON.stringify(panel + ' [name="replaceAll"]')}).disabled`), true);
      assert.equal(await evaluate("app.editor.replaceAll()"), false);
      await press("F3", "F3", 114); assert.equal(await evaluate("app.editor.getSelection()"), "beta");
      assert.equal(await evaluate("app.editor.getValue()"), expected);
    } finally { await evaluate("app.editor.setMutationLock(false)"); }
    await fill(tools, query, "["); await click(panel + ' [name="regexp"]');
    await wait(`document.querySelector(${JSON.stringify(query)}).getAttribute("aria-invalid")==="true"`, "invalid regex remains explicit");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel + ' [name="replaceAll"]')}).disabled`), true);
    assert.equal(await evaluate("app.editor.replaceAll()"), false); assert.equal(await evaluate("app.editor.getValue()"), expected);
    await fill(tools, query, "^(a+)+$");
    await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("Fixed-width regex")`, "unsafe regex is rejected before native matching");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(query)}).value`), "^(a+)+$", "rejected input stays visible for correction");
    assert.equal(await evaluate("app.editor.findNext()||app.editor.replaceAll()"), false); assert.equal(await evaluate("app.editor.getValue()"), expected);
    await fill(tools, query, "(b)(e)(t)(a)");
    await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("3 matches")`, "supported fixed-width captures recover normally");
    await evaluate("app.editor.closeSearch();app.saveAll()");
    assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + expected));
    pass(report, "Live Preview retains Find; a held mutation lock permits navigation but refuses replacement; invalid/unsafe regex is explicit without execution, fixed-width captures work, and saving preserves exact UTF-8 BOM/CRLF bytes.");
    await checkManagedSearchHotkeys(tools, path);

    await evaluate("app.workspace.flushLayout()");
    if (capture) { await capture("editor-search-saved"); }
    if (afterReload) {
      if (restart) { await restart(); } else { await command("Page.reload"); }
      await afterReload();
      await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&!app.changingVault`, "saved search fixture restored after restart/reconnection");
      assert.equal(await evaluate("app.editor.getValue()"), expected);
      assert.equal(await evaluate('app.workspace.activeLeaf.view.getEditingMode()'), "live-preview");
      await markEditor(evaluate); await evaluate("app.editor.focus()");
      await press("f", "KeyF", 70, 2); await fill(tools, query, "beta");
      await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("3 matches")`, "fresh-owner Find works after restart");
      await evaluate("app.editor.closeSearch()");
      assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + expected));
      pass(report, "A full native restart or browser reload/reconnection preserves exact saved text and Live Preview mode; a fresh search owner works afterward.");
    }
  } finally {
    await evaluate(`(async()=>{const v=app.workspace.activeLeaf?.view;if(v?.editor){v.editor.setMutationLock(false);v.editor.closeSearch()}await app.saveAll();await app.workspace.changeLayout(${JSON.stringify(layout)});await app.workspace.flushLayout()})()`);
    if (autosave && !await evaluate("app.markdownAutosave.enabled")) { await evaluate("app.markdownAutosave.setEnabled(true)"); }
  }
}

/** The parent mounts a genuine cache-only GitHub vault and verifies its blobs/network after this check. */
export async function checkEditorSearchReadOnly(tools) {
  const { evaluate, press, wait, click, report } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const original = await evaluate("app.editor.getValue()");
  await markEditor(evaluate);
  assert.equal(await evaluate('app.commands.isRunnable("editor:open-search")'), true);
  assert.equal(await evaluate('app.commands.isRunnable("editor:open-search-replace")'), false);
  await evaluate("app.editor.setCursor(0);app.editor.focus()"); await press("f", "KeyF", 70, 2);
  await wait(`Boolean(document.querySelector(${JSON.stringify(query)}))`, "read-only Find opens from the real keyboard command");
  await fill(tools, query, "alpha");
  await wait(`document.querySelector(${JSON.stringify(panel + " .editor-search-status")}).textContent.includes("2 matches")`, "read-only cached note is searchable");
  await click(panel + ' [name="next"]'); await press("F3", "F3", 114);
  assert.equal(await evaluate("app.editor.getSelection()"), "alpha");
  await click(panel + ' [name="show-replace"]');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(replacement)}).disabled&&document.querySelector(${JSON.stringify(panel + ' button[name="replace"]')}).disabled&&document.querySelector(${JSON.stringify(panel + ' [name="replaceAll"]')}).disabled`), true);
  assert.equal(await evaluate("app.editor.canReplace()||app.editor.replaceNext()||app.editor.replaceAll()"), false);
  assert.equal(await evaluate("app.editor.getValue()"), original);
  await evaluate("app.editor.closeSearch()");
  pass(report, "Genuine cache-only read-only Source permits Find/F3 with exact match counts while replace commands, controls and direct calls refuse without changing text.");
}
