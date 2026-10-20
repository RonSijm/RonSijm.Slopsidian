import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const panel = '[data-reading-search="true"]';
const query = panel + ' [data-reading-search-query]';
const q = JSON.stringify;
const root = 'app.workspace.activeLeaf.view.previewEl';
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
async function fill({ click, press, command }, value) {
  await click(query); await press("a", "KeyA", 65, 2);
  if (value) await command("Input.insertText", { text: value }); else await press("Backspace", "Backspace", 8);
}
async function count({ evaluate, wait }, value) {
  await wait(`document.querySelector(${q(panel)})?.dataset.readingSearchCount===${q(String(value))}`, "actual Reading match count " + value);
  assert.equal(await evaluate(`Number(document.querySelector(${q(panel)}).dataset.readingSearchCount)`), value);
}
async function open(tools) {
  await tools.evaluate(`${root}.focus()`); await tools.press("f", "KeyF", 70, 2);
  await tools.wait(`Boolean(document.querySelector(${q(query)}))`, "Reading Find through the application command");
}
async function narrow({ evaluate, capture }) {
  const original = await evaluate(`document.querySelector(${q(panel)}).style.maxWidth`);
  try {
    await evaluate(`document.querySelector(${q(panel)}).style.maxWidth="320px";new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
    const layout = await evaluate(`(()=>{const p=document.querySelector(${q(panel)}),r=p.getBoundingClientRect(),rows=[...p.children].map(row=>({rect:row.getBoundingClientRect().toJSON(),items:[...row.children].map(e=>({name:e.name||e.textContent,rect:e.getBoundingClientRect().toJSON()}))}));return{rect:r.toJSON(),rows}})()`);
    assert.ok(layout.rect.width <= 321);
    for (const row of layout.rows) {
      for (const item of row.items) { assert.ok(item.rect.width > 0 && item.rect.height >= 16 && item.rect.left >= layout.rect.left - 1 && item.rect.right <= layout.rect.right + 1, "Reading control remains inside the narrow panel: " + JSON.stringify(item)); }
      for (let i = 0; i < row.items.length; i++) for (let j = i + 1; j < row.items.length; j++) {
        const a = row.items[i].rect, b = row.items[j].rect;
        assert.equal(Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5, false, "Reading controls never overlap");
      }
    }
    await capture?.("reading-search-narrow");
  } finally { await evaluate(`document.querySelector(${q(panel)}).style.maxWidth=${q(original)}`); }
}

/** Real rendered text, native Range paint, manager-owned commands and exact source. */
export async function checkReadingSearch(tools) {
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const folder = "Reading search", path = folder + "/Reading.md", embedded = folder + "/Embedded.md";
  const embeddedText = "# Embedded\r\n\r\nneedle from another note.\r\n";
  const original = '---\r\nsearch-hidden: needle\r\n---\r\n# Reading search\r\n\r\nNeedle **needle** needled.\r\n\r\nNEEDLE\r\n\r\n[needle](https://example.invalid)\r\n\r\n```text\r\nneedle\r\n```\r\n\r\n<span aria-hidden="true">needle</span>\r\n\r\n<div hidden>needle</div>\r\n\r\n$\\text{needle}$\r\n\r\n![[Embedded]]\r\n\r\nalpha  \r\nbeta\r\n\r\nin**line**joined\r\n\r\nsoft\r\nbreak and spaced   words.\r\n\r\nleft $\\text{widget}$ right\r\n\r\n'
    + "Flowing paragraph text. ".repeat(1_500) + 'LONG_TARGET\r\n\r\n```text\r\n' + "x".repeat(4_000) + 'HORIZONTAL_TARGET\r\n```\r\n';
  const bytes = text => Buffer.from("\ufeff" + text);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, path), bytes(original), { flag: "wx" }); await writeFile(join(directory, embedded), bytes(embeddedText), { flag: "wx" });
  const ids = ["editor:open-search", "editor:find-next"];
  const hotkeys = await evaluate(`${q(ids)}.map(id=>({id,value:app.hotkeyManager.getHotkeys(id)??null}))`);
  try {
    await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview");await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
    await wait(`${root}.querySelector('.markdown-embed')?.textContent.includes("another note")`, "actual nested Reading embed loaded");
    await evaluate(`(()=>{const body=${root};globalThis.readingSearchProbe={body,html:body.innerHTML,node:body.querySelector('strong'),clicks:0};readingSearchProbe.node.addEventListener('click',()=>readingSearchProbe.clicks++)})()`);
    await open(tools); await fill(tools, "needle"); await count(tools, 6);
    assert.equal(await evaluate('Boolean(CSS.highlights?.get("slopsidian-reading-search"))&&[...CSS.highlights.get("slopsidian-reading-search")].filter(r=>r.toString().toLowerCase()==="needle").length===6'), true, "native CSS Highlight ranges retain actual rendered text");
    await click(panel + ' [name="word"]'); await count(tools, 5);
    await click(panel + ' [name="case"]'); await count(tools, 3);
    await click(panel + ' [name="case"]'); await count(tools, 5);
    const first = await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`);
    await press("F3", "F3", 114); await press("F3", "F3", 114, 8);
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), first);
    for (let i = 0; i < 5; i++) await press("F3", "F3", 114);
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), first, "F3 wraps within rendered matches");
    assert.deepEqual(await evaluate('["editor:open-search-replace","editor:replace-next","editor:replace-all"].map(id=>app.commands.executeCommandById(id))'), [false, false, false]);
    assert.equal(await evaluate("readingSearchProbe.body.innerHTML===readingSearchProbe.html&&readingSearchProbe.body.contains(readingSearchProbe.node)"), true);
    await evaluate("readingSearchProbe.node.click()"); assert.equal(await evaluate("readingSearchProbe.clicks"), 1);
    assert.equal(await evaluate("app.editor.getValue()"), original); assert.deepEqual(await readFile(join(directory, path)), bytes(original));
    pass(report, "Reading Ctrl+F uses actual rendered literal/case/Unicode-word matches and native CSS Highlight ranges; F3/Shift+F3 wrap, replacement commands refuse, and original DOM nodes/listeners plus exact BOM/CRLF source remain intact. Hidden frontmatter/HTML, math and nested-note text stay outside the search.");

    await click(panel + ' [name="word"]');
    for (const [value, expected] of [["Needle needle", 1], ["alphabeta", 0], ["inlinejoined", 1], ["soft break", 1], ["spaced words", 1], ["left  right", 0]]) { await fill(tools, value); await count(tools, expected); }
    for (const value of ["LONG_TARGET", "HORIZONTAL_TARGET"]) {
      await fill(tools, value); await count(tools, 1); await click(panel + ' button[name="next"]');
      const visible = await evaluate(`(()=>{const range=[...CSS.highlights.get("slopsidian-reading-search-active")].find(r=>r.toString()===${q(value)}),r=range.getClientRects()[0],root=${root},box=root.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,box:box.toJSON(),horizontal:range.startContainer.parentElement.closest("pre")?.scrollLeft??0}})()`);
      assert.ok(visible.top >= visible.box.top - 1 && visible.bottom <= visible.box.bottom + 1 && visible.left >= visible.box.left - 1 && visible.right <= visible.box.right + 1, "the actual matched rectangle is visible after scrolling: " + JSON.stringify(visible));
      if (value === "HORIZONTAL_TARGET") assert.ok(visible.horizontal > 0, "the long code line scrolls its own pre element horizontally");
    }
    await fill(tools, "needle"); await narrow(tools); await capture?.("reading-search");
    pass(report, "Reading matching joins normal inline formatting and collapsed prose whitespace, separates hard breaks and omitted visible math, and reveals actual match rectangles in a long paragraph and horizontally overflowing code. Real Find controls remain usable without overlap at 320px.");

    await evaluate('app.hotkeyManager.disableHotkeys("editor:find-next")');
    const active = await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`); await press("F3", "F3", 114);
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), active);
    await evaluate('app.hotkeyManager.setHotkeys("editor:find-next",[{modifiers:["Alt"],key:"F3"}])'); await press("F3", "F3", 114, 1);
    assert.notEqual(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchActive`), active);
    await evaluate(`globalThis.readingSearchHeld={next:document.querySelector(${q(panel + ' button[name="next"]')}),query:document.querySelector(${q(query)})};app.workspace.activeLeaf.view.setEditingMode("source")`);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))||CSS.highlights.has("slopsidian-reading-search")||CSS.highlights.has("slopsidian-reading-search-active")`), false);
    await evaluate('readingSearchHeld.next.click();readingSearchHeld.query.value="obsolete";readingSearchHeld.query.dispatchEvent(new Event("input",{bubbles:true}));app.editor.focus()');
    await press("f", "KeyF", 70, 2); await wait('Boolean(app.editor.cm.dom.querySelector("[data-editor-search-query]"))', "Source still owns its original Find surface");
    await evaluate('app.editor.closeSearch();app.workspace.activeLeaf.view.setEditingMode("preview")');
    await open(tools); await fill(tools, "needle"); await count(tools, 6);
    assert.equal(await evaluate("app.editor.getValue()"), original);
    pass(report, "Disabled/remapped Reading F3 obeys HotkeyManager, Source/Reading mode changes close the correct search surface and release highlights, and detached controls cannot revive or mutate an obsolete renderer.");

    await evaluate(`readingSearchHeld={next:document.querySelector(${q(panel + ' button[name="next"]')}),query:document.querySelector(${q(query)})}`);
    const external = original + "\r\nObserved external needle.\r\n";
    await writeFile(join(directory, path), bytes(external));
    await wait(`${root}.textContent.includes("Observed external needle.")&&!document.querySelector(${q(panel)})`, "external source rerender closes the old search owner");
    await evaluate('readingSearchHeld.next.click();readingSearchHeld.query.dispatchEvent(new Event("input",{bubbles:true}));delete globalThis.readingSearchHeld');
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))||CSS.highlights.has("slopsidian-reading-search")`), false);
    await open(tools); await fill(tools, "needle"); await count(tools, 7);
    await press("Escape", "Escape", 27); assert.equal(await evaluate(`Boolean(document.querySelector(${q(panel)}))`), false);
    await writeFile(join(directory, path), bytes(original)); await wait(`app.editor.getValue()===${q(original)}&&!${root}.textContent.includes("Observed external")`, "original external bytes restored");
    await evaluate('delete globalThis.readingSearchProbe;app.workspace.flushLayout()');
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&!app.changingVault`, "Reading note restores after restart/reconnection");
    await open(tools); await fill(tools, "needle"); await count(tools, 6); await click(panel + ' button[name="close"]');
    assert.equal(await evaluate("app.editor.getValue()"), original); assert.deepEqual(await readFile(join(directory, path)), bytes(original)); assert.deepEqual(await readFile(join(directory, embedded)), bytes(embeddedText));
    report.readingSearch = { renderedText: true, caseWholeWord: true, nativeRanges: true, sourceAndDomUnchanged: true, inlineAndWidgetBoundaries: true, actualMatchVisible: true, managedHotkeys: true, staleControls: true, restart: true };
    pass(report, "External note changes invalidate the entire Reading search owner and detached controls, fresh Find observes the replacement text, and full native restart/browser reconnection restores Reading with fresh exact matches and unchanged source/embed bytes.");
  } finally {
    await evaluate(`(()=>{for(const row of ${q(hotkeys)}){if(row.value===null)app.hotkeyManager.removeHotkeys(row.id);else app.hotkeyManager.setHotkeys(row.id,row.value)}app.workspace.activeLeaf?.view?.currentMode?.closeSearch?.();delete globalThis.readingSearchProbe;delete globalThis.readingSearchHeld})()`);
    await writeFile(join(directory, path), bytes(original));
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent owns the genuine cache-only mount and its all-blob/network audit. */
export async function checkReadingSearchReadOnly(tools) {
  const { evaluate, wait, press, click, report } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true); const before = await evaluate("app.editor.getValue()");
  await evaluate('app.workspace.activeLeaf.view.setEditingMode("preview")'); await open(tools); await fill(tools, "needle"); await count(tools, 2);
  await click(panel + ' button[name="next"]'); await press("F3", "F3", 114, 8);
  assert.deepEqual(await evaluate('["editor:open-search-replace","editor:replace-next","editor:replace-all"].map(id=>app.commands.executeCommandById(id))'), [false, false, false]);
  await press("Escape", "Escape", 27); await wait(`!document.querySelector(${q(panel)})&&!CSS.highlights.has("slopsidian-reading-search")`, "read-only Reading Find removes its panel and native paints");
  assert.equal(await evaluate("app.editor.getValue()"), before);
  report.readingSearch = { ...(report.readingSearch ?? {}), readOnlyFind: true, readOnlyNoMutations: true };
  pass(report, "A genuine cached read-only note supports Reading Find/counts/native highlights and next/previous navigation while every replacement command refuses; Escape removes the owned surface and exact note text remains intact.");
}
