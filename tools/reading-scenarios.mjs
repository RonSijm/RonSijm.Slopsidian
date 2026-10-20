import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

export function pixel(width = 1, height = 1) {
  const chunk = (name, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const content = Buffer.concat([Buffer.from(name), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(content));
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) { row.set([0, 190, 140, 255], 1 + x * 4); }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function checkReadingView({ directory, evaluate, command, click, press, wait, afterReload, report }) {
  const path = "Reading check.md";
  const image = "Reading pixel.png";
  const content = [
    "---", "title: Hidden reading metadata", "---",
    "# Reading heading", "",
    "A **bold** *emphasis* ~~removed~~ and `inline` text. Unicode \u03bb \u4e2d\u6587. ==A **highlight**== and `==literal code==`.", "",
    "> A quotation", "",
    "- First item", "- [x] Finished task", "", "1. Ordered item", "",
    "| Item | Value |", "| --- | --- |", "| One | Two |", "",
    "```javascript", 'const example = "<safe>";', "```", "",
    "[Jump to heading](#Second%20heading)", "",
    "[Linked note](Linked%20reading.md#Destination)", "",
    "[[Linked reading#Destination|Wiki alias]]", "",
    "![Local pixel](Reading%20pixel.png)", "", "![[Reading pixel.png]]", "",
    ...Array.from({ length: 12 }, (_, index) => [`Paragraph ${index + 1} before the anchor destination.`, ""]).flat(),
    "## Second heading", "", "Second section.", "",
    "<script>globalThis.readingUnsafe=true</script>",
    '<a href="javascript:globalThis.readingUnsafe=true">Unsafe link</a>',
    '<img src="https://example.invalid/slopsidian-reading-test.png" onerror="globalThis.readingUnsafe=true">',
    '<svg onload="globalThis.readingUnsafe=true"></svg>', "",
  ].join("\r\n");
  const original = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(content)]);
  await writeFile(join(directory, path), original);
  await writeFile(join(directory, "Linked reading.md"), "# Destination\r\n\r\nThe linked note.\r\n");
  await writeFile(join(directory, image), pixel());
  await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setMode("source")})()`);
  await wait(`app.current?.file.path===${JSON.stringify(path)}&&!app.changingVault`, "reading fixture is open");
  assert.equal(await evaluate("document.title"), "Slopsidian");
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#blazor-error-ui")).display'), "none", "The framework error banner should be hidden in a working workspace.");
  assert.equal(await evaluate("app.editor.getValue()"), content);
  const active = ".workspace-tabs.mod-active .workspace-leaf:not([hidden])";
  const preview = active + " .markdown-preview-view";
  const toggle = active + ' [data-workspace-action="toggle-reading-view"]';
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const visibleClick = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center"})`);
    await click(selector);
  };

  await click(toggle);
  await wait('app.workspace.activeLeaf.view.getMode()==="preview"', "reading view button");
  await wait(`document.querySelectorAll(${JSON.stringify(preview + " img")}).length===2&&[...document.querySelectorAll(${JSON.stringify(preview + " img")})].every(image=>image.complete&&image.naturalWidth===1)`, "actual local Markdown and wiki image pixels");
  const rendered = await evaluate(`(()=>{const view=document.querySelector(${JSON.stringify(preview)});return {
    heading:view.querySelector("h1")?.textContent,bold:view.querySelector("strong")?.textContent,
    emphasis:view.querySelector("em")?.textContent,removed:view.querySelector("del")?.textContent,
    highlight:view.querySelector("mark")?.textContent,highlightBold:view.querySelector("mark strong")?.textContent,
    literalHighlight:[...view.querySelectorAll("code")].some(code=>code.textContent==="==literal code=="&&!code.querySelector("mark")),
    code:view.querySelector("pre code")?.textContent,table:view.querySelector("td")?.textContent,
    quote:view.querySelector("blockquote")?.textContent,ordered:!!view.querySelector("ol li"),
    task:view.querySelector('input[type="checkbox"]')?.checked,taskDisabled:view.querySelector("input")?.disabled,
    leakedFrontmatter:view.textContent.includes("Hidden reading metadata"),
    unsafe:!!view.querySelector("script,iframe,svg,[onerror],[onload]"),
    unsafeHref:!!view.querySelector('a[href^="javascript:"]'),
    sourceHidden:app.workspace.activeLeaf.view.sourceEl.hidden,
    imageUrls:[...view.querySelectorAll("img")].map(image=>image.src)
  }})()`);
  assert.equal(rendered.heading, "Reading heading");
  assert.equal(rendered.bold, "bold");
  assert.equal(rendered.emphasis, "emphasis");
  assert.equal(rendered.removed, "removed");
  assert.equal(rendered.highlight, "A highlight");
  assert.equal(rendered.highlightBold, "highlight");
  assert.equal(rendered.literalHighlight, true);
  assert.ok(rendered.code.includes('const example = "<safe>";'));
  assert.equal(rendered.table, "One");
  assert.match(rendered.quote, /A quotation/);
  assert.ok(rendered.ordered && rendered.task && rendered.taskDisabled && rendered.sourceHidden);
  assert.equal(rendered.leakedFrontmatter, false);
  assert.equal(rendered.unsafe, false);
  assert.equal(rendered.unsafeHref, false);
  assert.ok(rendered.imageUrls.every(url => url.startsWith("blob:")));
  assert.equal(await evaluate("globalThis.readingUnsafe"), undefined);
  assert.equal(await evaluate("app.dirty"), false);
  assert.deepEqual(await readFile(join(directory, path)), original);
  pass("Reading view renders real headings, formatting, nested highlights, literal code, lists/tasks, tables and local images without executing note HTML or changing its bytes.");

  await evaluate('app.commands.addCommand({id:"reading-test:editor",name:"Reading test editor callback",editorCallback:()=>{globalThis.readingEditorRan=true}})');
  assert.equal(await evaluate('app.commands.status().find(command=>command.id==="reading-test:editor").enabled'), false);
  await evaluate(`globalThis.readingClicks=[];document.addEventListener("click",event=>{const link=event.target instanceof Element?event.target.closest("a"):null;if(link)readingClicks.push({href:link.getAttribute("href"),wiki:link.dataset.slopsidianLink,button:event.button,prevented:event.defaultPrevented,connected:link.isConnected,path:app.current?.file.path})},true)`);
  await visibleClick(preview + ' a[href="#Second%20heading"]');
  await wait(`(()=>{const view=document.querySelector(${JSON.stringify(preview)});const heading=view.querySelector("h2").getBoundingClientRect();const bounds=view.getBoundingClientRect();return heading.top>=bounds.top&&heading.bottom<=bounds.bottom})()`, "same-note heading has actually been revealed");
  assert.equal(await evaluate('app.workspace.activeLeaf.view.getMode()'), "preview");
  await visibleClick(preview + ' a[href="Linked%20reading.md#Destination"]');
  try {
    await wait('app.current?.file.path==="Linked reading.md"&&app.workspace.activeLeaf.view.getMode()==="preview"', "normal Markdown link navigation");
  } catch (error) {
    const state = await evaluate('({clicks:globalThis.readingClicks,path:app.current?.file.path,mode:app.workspace.activeLeaf.view.getMode(),history:app.workspace.activeLeaf.history,errors:document.querySelector("#client-errors")?.textContent,files:app.vault.getFiles().map(file=>({path:file.path,extension:file.extension})),links:[...app.workspace.activeLeaf.containerEl.querySelectorAll("a")].map(link=>({href:link.getAttribute("href"),wiki:link.dataset.slopsidianLink,element:link instanceof Element}))})');
    throw new Error("Reading link navigation failed: " + JSON.stringify(state), { cause: error });
  }
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(preview + " h1")}).textContent`), "Destination");
  await click(active + ' button[aria-label="Back (Alt+Left)"]');
  await wait(`app.current?.file.path===${JSON.stringify(path)}`, "reading link history");
  await visibleClick(preview + " a[data-slopsidian-link]");
  await wait('app.current?.file.path==="Linked reading.md"', "wiki-link navigation");
  await click(active + ' button[aria-label="Back (Alt+Left)"]');
  await wait(`app.current?.file.path===${JSON.stringify(path)}`, "return to reading fixture");
  pass("Markdown links, heading anchors and wiki aliases navigate actual vault notes; editor-only commands are disabled in reading view.");

  await press("e", "KeyE", 69, 2);
  await wait('app.workspace.activeLeaf.view.getMode()==="source"', "Ctrl+E returns to editing");
  assert.equal(await evaluate('app.commands.status().find(command=>command.id==="reading-test:editor").enabled'), true);
  await evaluate('app.commands.removeCommand("reading-test:editor")');
  await press("End", "End", 35, 2);
  await press("Enter", "Enter", 13);
  await command("Input.insertText", { text: "**Unsaved preview text**" });
  await wait("app.dirty", "reading fixture is dirty");
  await press("e", "KeyE", 69, 2);
  await wait(`app.workspace.activeLeaf.view.getMode()==="preview"&&[...document.querySelectorAll(${JSON.stringify(preview + " strong")})].some(element=>element.textContent==="Unsaved preview text")`, "reading view uses the unsaved document");
  assert.equal(await evaluate("app.dirty"), true);
  assert.deepEqual(await readFile(join(directory, path)), original);
  await press("e", "KeyE", 69, 2);
  await wait('app.workspace.activeLeaf.view.getMode()==="source"');
  await press("z", "KeyZ", 90, 2);
  await wait('!app.editor.getValue().includes("Unsaved preview text")', "mode toggling preserves undo");
  await press("y", "KeyY", 89, 2);
  await wait('app.editor.getValue().includes("Unsaved preview text")', "mode toggling preserves redo");
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving", "reading fixture is saved");
  assert.equal(await readFile(join(directory, path), "utf8"), "\ufeff" + await evaluate("app.editor.getValue()"));
  pass("Ctrl+E renders unsaved edits without saving them, retains undo/redo, and Ctrl+S preserves UTF-8 BOM and CRLF.");

  await press("e", "KeyE", 69, 2);
  await wait('app.workspace.activeLeaf.view.getMode()==="preview"');
  const readingLeaf = await evaluate("app.workspace.activeLeaf.id");
  const groups = await evaluate('document.querySelectorAll(".workspace-tabs").length');
  await evaluate('app.commands.execute("workspace:split-vertical")');
  await wait(`document.querySelectorAll(".workspace-tabs").length===${groups + 1}`, "reading-view split");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.getMode()"), "preview");
  assert.equal(await evaluate("document.activeElement===app.workspace.activeLeaf.view.previewEl"), true);
  await press("e", "KeyE", 69, 2);
  await wait('app.workspace.activeLeaf.view.getMode()==="source"');
  await press("End", "End", 35, 2);
  await press("Enter", "Enter", 13);
  await command("Input.insertText", { text: "**Mirrored pane**" });
  await wait(`(()=>{const leaf=app.workspace.getLeafById(${JSON.stringify(readingLeaf)});return leaf.view.getMode()==="preview"&&[...leaf.containerEl.querySelectorAll(".markdown-preview-view strong")].some(element=>element.textContent==="Mirrored pane")})()`, "a source pane updates the other reading pane");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.getMode()"), "source");
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving");
  pass("Split panes keep independent source/reading modes while a shared document updates rendered output live.");

  const sourceLeaf = await evaluate("app.workspace.activeLeaf.id");
  const expectedText = await evaluate("app.editor.getValue()");
  const layout = await evaluate("(async()=>{await app.workspace.flushLayout();return app.workspace.getLayout()})()");
  await command("Page.reload");
  await afterReload();
  await wait(`app.workspace.getLeafById(${JSON.stringify(readingLeaf)})?.view.getMode()==="preview"&&app.workspace.getLeafById(${JSON.stringify(sourceLeaf)})?.view.getMode()==="source"`, "per-pane view modes after a real reload");
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), layout);
  assert.equal(await evaluate("app.editor.getValue()"), expectedText);
  await click(toggle);
  await wait('app.workspace.activeLeaf.view.getMode()==="preview"');
  assert.equal(await evaluate("document.title"), "Slopsidian");
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#blazor-error-ui")).display'), "none", "The framework error banner should remain hidden after reload.");
  assert.equal(await evaluate("globalThis.readingUnsafe"), undefined);
  pass("Real page reload preserves both reading/source pane modes and exact note content under the Slopsidian display name.");
  const external = "# External rendered\r\n\r\n**Updated disk**\r\n";
  await writeFile(join(directory, path), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(external)]));
  await wait(`app.editor.getValue()===${JSON.stringify(external)}&&document.querySelector(${JSON.stringify(preview + " strong")})?.textContent==="Updated disk"`, "clean reading pane receives an external disk edit");
  assert.equal(await evaluate("app.dirty"), false);
  await writeFile(join(directory, path), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(expectedText)]));
  await wait(`app.editor.getValue()===${JSON.stringify(expectedText)}&&document.querySelectorAll(${JSON.stringify(preview + " img")}).length===2&&[...document.querySelectorAll(${JSON.stringify(preview + " img")})].every(image=>image.complete&&image.naturalWidth===1)`, "restored rich reading fixture");
  pass("External changes to a clean note refresh its actual rendered reading panes without creating unsaved edits.");
}
