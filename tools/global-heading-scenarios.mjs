import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const popup = '[data-builtin-suggest="source"]:popover-open';
const q = JSON.stringify;
// Controls are UI; exact navigation assertions compare the rendered heading content.
const headingText = element => [...element.childNodes].filter(node => node.nodeType !== 1 || !node.matches("button.reading-fold-toggle")).map(node => node.textContent).join("");
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };

/** Source and Live Preview global heading choices; root owns frozen builds and final host audits. */
export async function checkGlobalHeadings(tools) {
  const { directory, evaluate, command, click, wait, report, capture, restart, afterReload } = tools;
  const folder = "Global heading completions", path = folder + "/Links.md", target = folder + "/Targets/Global target.md", other = folder + "/Other/Global target.md";
  const original = "# Local global heading Ω\r\n\r\nUnicode 😀 surrounding text.\r\n\r\nLinks: \r\n";
  const betweenHeadings = Array.from({ length: 40 }, (_, index) => `Navigation spacer paragraph ${index + 1}: the later normalized duplicate remains outside the first-heading viewport.`).join("\r\n\r\n");
  const targetText = "# Global heading λ\r\n\r\nTarget prose.\r\n\r\n" + betweenHeadings + "\r\n\r\n## **Global heading λ**\r\n";
  const otherText = "# Secondary global heading\r\n\r\nOther destination prose.\r\n";
  const bytes = text => Buffer.from("\ufeff" + text), layout = await evaluate("app.workspace.getLayout()");
  await evaluate("app.saveAll()");
  await mkdir(join(directory, folder, "Targets"), { recursive: true }); await mkdir(join(directory, folder, "Other"), { recursive: true });
  await writeFile(join(directory, path), bytes(original), { flag: "wx" });
  await writeFile(join(directory, target), bytes(targetText), { flag: "wx" });
  await writeFile(join(directory, other), bytes(otherText), { flag: "wx" });
  await evaluate("app.vault.refresh()");
  await wait(`app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Global heading λ")&&app.metadataCache.getCache(${q(other)})?.headings.length===1`, "global heading target notes indexed");
  const row = `${popup} [data-builtin-global-heading="true"][data-builtin-link=${q(target)}][data-builtin-heading="Global heading λ"]`;
  // A scrollable Reading content box may be taller than the actual pane.
  // Intersect the window and every clipping ancestor before asserting visibility.
  const visibleViewport = `(root=>{const win=root.ownerDocument.defaultView,r=root.getBoundingClientRect();let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(win.innerWidth,r.right),bottom=Math.min(win.innerHeight,r.bottom);for(let e=root.parentElement;e;e=e.parentElement){const style=win.getComputedStyle(e),box=e.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right)}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom)}}return{left,top,right,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)}})`;
  let saved = original;
  try {
    for (const mode of ["source", "live-preview"]) {
      const open = async () => {
        await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(original)},"input.global-heading-fixture");app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()})()`);
        await command("Page.bringToFront");
        await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "global heading editing mode");
      };
      await open();
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target)}),${q(path)})`);
      let completed = original;
      const choose = async (input, selector, token) => {
        await evaluate("app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()");
        await command("Input.insertText", { text: input });
        const typed = completed.replace(/\r\n$/, input + "\r\n");
        await wait(`Boolean(document.querySelector(${q(selector)}))`, "actual global heading popup row");
        assert.equal(await evaluate("app.editor.getValue()"), typed);
        assert.equal(await evaluate(`document.querySelectorAll(${q(selector)}).length`), 1, "only the resolver-addressable first normalized heading is offered");
        if (mode === "source" && selector === row) await capture?.("global-heading-popup");
        await click(selector); completed = completed.replace(/\r\n$/, token + "\r\n");
        await wait(`app.editor.getValue()===${q(completed)}`, "global query becomes one known ordinary wiki heading link");
        await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), typed);
        await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), completed);
        await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(completed));
      };
      await choose("[[##Global head", row, "[[" + linktext + "#Global heading λ]]");
      const selfLinktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(path)}),${q(path)})`);
      await choose(" [[##Local global", `${popup} [data-builtin-global-heading="true"][data-builtin-link=${q(path)}][data-builtin-heading="Local global heading Ω"]`, " [[" + selfLinktext + "#Local global heading Ω]]");
      assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${q(linktext)},${q(path)})===app.vault.getFileByPath(${q(target)})`), true);
      // Duplicate target basenames force the shared destination-safe spelling.
      assert.notEqual(linktext, "Global target");
      await evaluate('app.workspace.activeLeaf.view.previewEl.dataset.globalHeadingSourceReading="true";app.workspace.activeLeaf.view.setMode("preview")');
      const rendered = `[data-global-heading-source-reading] a.internal-link[data-slopsidian-link=${q(linktext + "#Global heading λ")}]`;
      await wait(`Boolean(document.querySelector(${q(rendered)}))`, "completed global heading link rendered");
      const pointerState = await evaluate(`(async()=>{await app.workspace.activeLeaf.view.reading.whenReady();const link=document.querySelector(${q(rendered)});if(!link)throw new Error("Missing rendered global heading link");link.scrollIntoView({block:"nearest",inline:"nearest"});const measure=()=>{const r=[...link.getClientRects()].find(r=>r.width>0&&r.height>0);if(!r)throw new Error("Global heading link has no visible client rectangle");return{left:r.left,top:r.top,width:r.width,height:r.height}};await new Promise(resolve=>requestAnimationFrame(resolve));const first=measure();await new Promise(resolve=>requestAnimationFrame(resolve));return{sameNode:link.isConnected&&document.querySelector(${q(rendered)})===link,first,second:measure()}})()`);
      assert.equal(pointerState.sameNode, true, "the rendered link keeps its identity before real pointer input");
      for (const key of ["left", "top", "width", "height"]) assert.ok(Math.abs(pointerState.first[key] - pointerState.second[key]) <= 1, "global heading link layout is stable before real pointer input: " + JSON.stringify(pointerState));
      report.globalHeadingPointer ??= []; report.globalHeadingPointer.push({ sourceMode: mode, target, ...pointerState });
      await click(rendered);
      await wait(`(()=>{const view=app.workspace.activeLeaf?.view,root=view?.previewEl;if(app.workspace.getActiveFile()?.path!==${q(target)}||view?.getMode()!=="preview"||!root)return false;const heading=root.querySelector('h1[data-source-line="0"]');if(!heading||(${headingText.toString()})(heading).trim()!=="Global heading λ"||!heading.checkVisibility())return false;const h=heading.getBoundingClientRect(),r=${visibleViewport}(root),later=root.querySelector("h2"),d=later?.getBoundingClientRect();return r.width>0&&r.height>0&&h.width>0&&h.height>0&&h.top>=r.top-2&&h.bottom<=r.bottom+2&&h.left>=r.left-2&&h.right<=r.right+2&&d&&d.top>r.bottom})()`, "actual global link pointer reveals the first normalized heading in the target Reading viewport");
      const navigation = await evaluate(`(()=>{const view=app.workspace.activeLeaf.view,root=view.previewEl,rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};return{activeFile:app.workspace.getActiveFile()?.path,viewFile:view.file?.path,mode:view.getMode(),hiddenCursor:view.editor.getCursor(),scrollTop:root.scrollTop,viewport:rect(root),visibleViewport:${visibleViewport}(root),windowSize:{width:innerWidth,height:innerHeight},headings:[...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(e=>({text:(${headingText.toString()})(e),line:e.dataset.sourceLine,rect:rect(e)}))}})()`);
      report.globalHeadingNavigation ??= []; report.globalHeadingNavigation.push({ sourceMode: mode, ...navigation });
      await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()})()`);
      assert.equal(await evaluate("app.editor.getValue()"), completed);
      assert.deepEqual(await readFile(join(directory, target)), bytes(targetText)); assert.deepEqual(await readFile(join(directory, other)), bytes(otherText));
      pass(report, `${mode}: real double-hash global choices find remote/current headings, omit normalized duplicates, use safe paths for duplicate basenames and retain isolated Undo/Redo plus exact BOM/CRLF; actual Reading pointer navigation reaches the first heading without creating notes or IDs.`);

      const partial = completed.replace(/\r\n$/, " [[##Global head\r\n");
      const hold = async () => {
        await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(partial)},"input.global-heading-fixture");app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()`);
        await wait(`Boolean(document.querySelector(${q(row)}))`, "held global heading popup row");
        await evaluate(`globalThis.heldGlobalHeading=document.querySelector(${q(row)})`);
      };
      await hold();
      await writeFile(join(directory, target), bytes(targetText.replaceAll("Global heading λ", "Removed heading λ")));
      await evaluate("app.metadataCache.refresh()"); await wait(`!app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Global heading λ")`, "independent physical target-heading removal indexed");
      await evaluate("heldGlobalHeading.click();delete globalThis.heldGlobalHeading"); assert.equal(await evaluate("app.editor.getValue()"), partial);
      await writeFile(join(directory, target), bytes(targetText)); await evaluate("app.metadataCache.refresh()");
      await wait(`app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Global heading λ")`, "exact target heading restored");
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(completed)},"input.global-heading-fixture")`);
      await hold();
      await unlink(join(directory, target)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
      await wait(`!app.vault.getFileByPath(${q(target)})`, "independent physical target deletion observed");
      await writeFile(join(directory, target), bytes(targetText)); await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
      await wait(`Boolean(app.vault.getFileByPath(${q(target)}))&&app.metadataCache.getCache(${q(target)})?.headings.some(value=>value.heading==="Global heading λ")`, "same-path target restored with its new live identity");
      await evaluate("heldGlobalHeading.click();delete globalThis.heldGlobalHeading"); assert.equal(await evaluate("app.editor.getValue()"), partial);
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(completed)},"input.global-heading-fixture")`);
      await hold(); await command("Input.insertText", { text: "!" });
      const newer = partial.replace(" [[##Global head\r\n", " [[##Global head!\r\n");
      assert.equal(await evaluate("app.editor.getValue()"), newer);
      await evaluate("heldGlobalHeading.click();delete globalThis.heldGlobalHeading"); assert.equal(await evaluate("app.editor.getValue()"), newer);
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(completed)},"input.global-heading-fixture");app.saveAll()`);
      assert.deepEqual(await readFile(join(directory, path)), bytes(completed)); assert.deepEqual(await readFile(join(directory, target)), bytes(targetText)); assert.deepEqual(await readFile(join(directory, other)), bytes(otherText));
      assert.equal(await evaluate(`app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(${q(folder + "/")})).length`), 3);
      pass(report, `${mode}: held global heading rows refuse observed physical heading removal, target deletion/recreation and newer source; restoring and saving fixtures preserves every original target byte and creates no extra notes or block IDs.`);
      saved = completed;
    }
    if (afterReload) {
      await evaluate("app.workspace.flushLayout()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
      await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&!app.changingVault`, "global links restored after restart/reconnection");
      assert.equal(await evaluate("app.editor.getValue()"), saved); assert.deepEqual(await readFile(join(directory, path)), bytes(saved));
      await evaluate("app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()"); await command("Input.insertText", { text: " [[##Secondary" });
      const otherRow = `${popup} [data-builtin-global-heading="true"][data-builtin-link=${q(other)}][data-builtin-heading="Secondary global heading"]`;
      await wait(`Boolean(document.querySelector(${q(otherRow)}))`, "fresh global heading provider after restart/reconnection");
      const typed = await evaluate("app.editor.getValue()"), linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(other)}),${q(path)})`);
      await click(otherRow);
      await wait(`app.editor.getValue()===${q(saved.replace(/\r\n$/, " [[" + linktext + "#Secondary global heading]]\r\n"))}`, "post-restart global choice inserts the exact known destination");
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), typed);
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(saved)},"input.global-heading-fixture");app.saveAll()`);
      assert.deepEqual(await readFile(join(directory, path)), bytes(saved));
      pass(report, "Full native restart/browser reconnection retains exact saved global links and registers a fresh Source/Live Preview global-heading provider; another actual choice and Undo preserve the expected source and destination bytes.");
    }
    report.globalHeadings = { sourceAndLivePreview: true, knownAddressableTargets: true, destinationPreferences: true, isolatedUndoExactBytes: true, observedTargetAndSourceRefusal: true, ...(afterReload ? { restart: true } : {}) };
  } catch (error) {
    try {
      report.globalHeadingFailure = await evaluate(`(()=>{const view=app.workspace.activeLeaf?.view,root=view?.previewEl,rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};return{expectedTarget:${q(target)},expectedHeadingLine:0,activeFile:app.workspace.getActiveFile()?.path??null,viewFile:view?.file?.path??null,mode:view?.getMode?.()??null,hiddenCursor:view?.editor?.getCursor?.()??null,scrollTop:root?.scrollTop??null,viewport:rect(root),headings:[...(root?.querySelectorAll("h1,h2,h3,h4,h5,h6")??[])].slice(0,12).map(e=>({text:e.textContent,line:e.dataset.sourceLine,visible:e.checkVisibility(),rect:rect(e)})),links:[...(root?.querySelectorAll("a.internal-link")??[])].slice(0,12).map(e=>({text:e.textContent,link:e.dataset.slopsidianLink,rect:rect(e)})),focus:document.activeElement?.outerHTML.slice(0,500),heldRowConnected:globalThis.heldGlobalHeading?.isConnected??null,sourcePrefix:view?.editor?.getValue?.().slice(0,500)}})()`);
      await capture?.("global-heading-precleanup-failure");
    } catch (diagnosticError) {
      report.globalHeadingFailure = { ...(report.globalHeadingFailure ?? {}), diagnosticError: String(diagnosticError) };
    }
    throw error;
  } finally {
    await evaluate("delete globalThis.heldGlobalHeading;app.saveAll()"); await writeFile(join(directory, target), bytes(targetText));
    await evaluate(`(async()=>{await app.vault.refresh();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent owns the cache-only fixture, exact blob hashes and zero-network audit. */
export async function checkGlobalHeadingsReadOnly({ evaluate, wait, report }) {
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('app.workspace.activeLeaf.view.setEditingMode("source")');
  const before = await evaluate("app.editor.getValue()");
  const result = await evaluate(String.raw`(()=>{
    const editor=app.editor,file=app.workspace.getActiveFile(),lines=editor.getValue().split(/\r?\n/),line=lines.findIndex(value=>value.startsWith("[[##Cached"));
    if(line<0)throw new Error("Missing read-only global heading prefix");
    editor.setCursor(line,lines[line].length);editor.focus();
    const builtin=app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source");
    if(!builtin)throw new Error("Missing built-in completion provider");
    const cursor=editor.getCursor();return{trigger:builtin.onTrigger(cursor,editor,file),choices:builtin.getSuggestions({editor,file,start:cursor,end:cursor,query:"Cached"}).length};
  })()`);
  assert.deepEqual(result, { trigger: null, choices: 0 });
  await wait(`!document.querySelector(${q(popup)})`, "read-only global heading popup remains closed");
  assert.equal(await evaluate("app.editor.getValue()"), before);
  report.globalHeadings = { ...(report.globalHeadings ?? {}), readOnlyRefusal: true };
  pass(report, "Genuine cache-only read-only double-hash prefixes refuse global-heading triggering and direct candidate enumeration, preserving the source exactly while the parent audits all blobs and network counters.");
}
