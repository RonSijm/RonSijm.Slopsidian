import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkTagRendering({ directory, evaluate, command, click, press, wait, afterReload, capture, report }) {
  const path = "Native tags.md";
  const content = [
    "---", "tags: [project, project/nested]", "---",
    "# Native tags", "",
    "Plain #project and #project/nested plus #hello-world and #under_score.", "",
    "Unicode #\u65e5\u672c\u8a9e #\u00e9cole #caf\u00e9; numeric #123 #123abc.", "",
    "Boundaries foo#word \\#escaped `#code` [#label](https://example.invalid/#fragment).", "",
    "**#bold** (#bracket) ##double #trailing/ #double//slash #_ #a-b.", "",
    "```text", "#fenced", "```", "",
  ].join("\r\n");
  const original = Buffer.from("\ufeff" + content);
  const readingTags = ["#project", "#project/nested", "#hello-world", "#under_score", "#\u65e5\u672c\u8a9e", "#\u00e9cole", "#caf\u00e9", "#123abc", "#label", "#bold", "#trailing/", "#double//slash", "#_", "#a-b"];
  const editorTags = readingTags.filter(tag => tag !== "#label" && tag !== "#bold");
  const active = ".workspace-tabs.mod-active .workspace-leaf:not([hidden])";
  const preview = active + " .markdown-preview-view";
  const tag = preview + ' a.tag[href="#project"]';
  const sourceTag = active + ' .cm-hashtag-end[data-markdown-tag="#project"]';
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .02, `${label}: ${actual} != ${expected}`);
  async function mode(value) {
    await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${JSON.stringify(value)});true`);
    await wait(`app.workspace.activeLeaf.view.getEditingMode()===${JSON.stringify(value)}`, value + " mode");
  }
  async function snapshot(mode) {
    return evaluate(`(()=>{
      const container=app.workspace.activeLeaf.view.containerEl;
      const elements=[...container.querySelectorAll(${JSON.stringify(mode === "reading" ? ".markdown-preview-view a.tag" : ".cm-hashtag")})];
      return elements.map(element=>{
        const style=getComputedStyle(element),parent=getComputedStyle(element.parentElement);
        return {text:element.textContent,tag:element.dataset.markdownTag??element.getAttribute("href"),className:element.className,
          font:parseFloat(style.fontSize),parentFont:parseFloat(parent.fontSize),color:style.color,background:style.backgroundColor,
          start:parseFloat(style.paddingInlineStart),end:parseFloat(style.paddingInlineEnd),top:parseFloat(style.paddingTop),
          firstRadius:parseFloat(style.borderTopLeftRadius),lastRadius:parseFloat(style.borderBottomRightRadius),
          border:style.borderTopWidth,decoration:style.textDecorationLine,lineHeight:style.lineHeight};
      });
    })()`);
  }
  async function query(value) {
    await wait(`document.querySelector("[data-search-status]")?.dataset.completedQuery===${JSON.stringify(value)}&&document.querySelector("[data-search-status]")?.dataset.searchComplete==="true"`, "real tag search completion");
    assert.equal(await evaluate('document.querySelector("[data-search-query]").value'), value);
    const matches = await evaluate('[...document.querySelectorAll("[data-search-file]")].map(element=>element.dataset.searchFile)');
    assert.ok(matches.includes(path), "The tag must find its actual vault note.");
    assert.equal(matches.includes("Unrelated tags.md"), false, "A tag click must not become an ordinary text/file search.");
    assert.equal(await evaluate("app.current.file.path"), path);
    assert.equal(await evaluate("app.dirty"), false);
    assert.deepEqual(await readFile(join(directory, path)), original);
  }
  async function sentinel() {
    await evaluate('app.core.getEnabledPluginById("global-search").openGlobalSearch("tag:sentinel");true');
    await wait('document.querySelector("[data-search-status]")?.dataset.completedQuery==="tag:sentinel"', "sentinel search finished");
  }

  await writeFile(join(directory, path), original);
  await writeFile(join(directory, "Unrelated tags.md"), "# Unrelated\r\n\r\n#other\r\n");
  await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${JSON.stringify(path)});})()`);
  assert.equal(await evaluate("app.editor.getValue()"), content);
  await mode("preview");
  const reading = await snapshot("reading");
  assert.deepEqual(reading.map(entry => entry.text), readingTags);
  const first = reading[0];
  closeTo(first.font / first.parentFont, .875, "native relative tag size");
  closeTo(first.start / first.font, .65, "native horizontal padding");
  closeTo(first.top / first.font, .25, "native vertical padding");
  closeTo(first.firstRadius / first.font, 2, "native pill radius");
  assert.equal(first.decoration, "none");
  assert.equal(first.border, "0px");
  assert.equal(first.background, "rgba(138, 92, 245, 0.1)");
  closeTo(parseFloat(first.lineHeight), first.font, "Reading tag line height");
  report.tagRendering = { reference: "native-tags-reference-v3.json", reading };
  if (capture) { await capture("reading"); }
  await click(tag);
  await query("tag:#project");
  const point = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(tag)});element.scrollIntoView({block:"center"});const rect=element.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, modifiers: 2 });
  await wait(`document.querySelector(${JSON.stringify(tag)}).matches(":hover")&&getComputedStyle(document.querySelector(${JSON.stringify(tag)})).backgroundColor==="rgba(138, 92, 245, 0.2)"`, "native tag hover fill");
  report.tagRendering.hover = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(tag)}),style=getComputedStyle(element);return{matches:element.matches(":hover"),color:style.color,background:style.backgroundColor,decoration:style.textDecorationLine}})()`);
  await delay(400);
  assert.equal(await evaluate('Boolean(document.querySelector(".page-preview-popover"))'), false, "Hovering a tag must not open a broken heading/file preview.");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, modifiers: 0 });
  pass("Reading uses native-shaped hash-visible tag chips and real tag search, including nested/Unicode tags, inline contexts and native literal exclusions; hovering tags never opens a file preview.");

  const properties = active + ' [data-property-type="tags"] .metadata-tag';
  assert.deepEqual(await evaluate(`[...document.querySelectorAll(${JSON.stringify(properties)})].map(element=>element.textContent)`), ["project", "project/nested"]);
  report.tagRendering.properties = await evaluate(`[...document.querySelectorAll(${JSON.stringify(properties)})].map(element=>({text:element.textContent,href:element.getAttribute("href"),className:element.className,background:getComputedStyle(element).backgroundColor,color:getComputedStyle(element).color}))`);
  await click(properties);
  await query("tag:project");
  pass("Properties render separate hash-free tag chips instead of newline text, using the native property-tag search query without rewriting YAML.");

  for (const value of ["source", "live-preview"]) {
    await mode(value);
    const entries = await snapshot("editor");
    assert.deepEqual(entries.filter(entry => entry.className.includes("cm-hashtag-end")).map(entry => entry.tag), editorTags);
    const begin = entries[0], end = entries[1];
    assert.equal(begin.text, "#");
    assert.equal(end.text, "project");
    closeTo(begin.font / begin.parentFont, .875, value + " tag font");
    closeTo(begin.start / begin.font, .65, value + " first padding");
    closeTo(end.end / end.font, .65, value + " last padding");
    assert.equal(begin.end, 0);
    assert.equal(end.start, 0);
    closeTo(begin.firstRadius / begin.font, 2, value + " first radius");
    closeTo(end.lastRadius / end.font, 2, value + " last radius");
    assert.equal(begin.lastRadius, 0);
    assert.equal(end.firstRadius, 0);
    assert.equal(begin.background, first.background);
    report.tagRendering[value] = entries;
    if (capture) { await capture(value); }
    await sentinel();
    await click(sourceTag);
    if (value === "source") {
      assert.equal(await evaluate('document.querySelector("[data-search-query]").value'), "tag:sentinel");
      assert.equal(await evaluate("document.activeElement===app.editor.cm.contentDOM"), true, "Source tags remain ordinary editable text.");
      await click(sourceTag, 2);
    }
    await query("tag:#project");
  }
  pass("Source and Live Preview retain native split hash/name chips; Source primary-click edits and Ctrl-click searches, while Live Preview primary-click searches. Original BOM/CRLF bytes remain exact.");

  await mode("source");
  await evaluate(`(()=>{const editor=app.editor,from=editor.cm.state.doc.toString().indexOf("Plain #project")+7;editor.setSelection(editor.offsetToPos(from),editor.offsetToPos(from+7));editor.focus()})()`);
  assert.equal(await evaluate("app.editor.getSelection()"), "project");
  await command("Input.insertText", { text: "renamed" });
  const changed = content.replace("Plain #project ", "Plain #renamed ");
  await wait(`app.editor.getValue()===${JSON.stringify(changed)}&&app.dirty`, "actual tag text edit");
  assert.deepEqual(await readFile(join(directory, path)), original);
  await mode("preview");
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(preview + ' a.tag[href="#renamed"]')}))`), true);
  await mode("source");
  await press("z", "KeyZ", 90, 2);
  await wait(`app.editor.getValue()===${JSON.stringify(content)}&&!app.dirty`, "tag text undo");
  await press("y", "KeyY", 89, 2);
  await wait(`app.editor.getValue()===${JSON.stringify(changed)}&&app.dirty`, "tag text redo");
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty&&!app.workspace.activeLeaf.session.isSaving", "tag text save");
  assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + changed));
  pass("Real trusted tag typing, unsaved Reading refresh, undo/redo and Ctrl+S preserve the exact UTF-8 BOM and CRLF source rather than replacing tags with widgets.");

  await mode("live-preview");
  await evaluate("app.workspace.flushLayout()");
  await command("Page.reload");
  await afterReload();
  await wait(`app.current?.file.path===${JSON.stringify(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"`, "tag mode after real reload/reconnect");
  assert.equal(await evaluate("app.editor.getValue()"), changed);
  await click(active + ' .cm-hashtag-end[data-markdown-tag="#renamed"]');
  await wait('document.querySelector("[data-search-query]")?.value==="tag:#renamed"', "tag event ownership after reload");
  assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + changed));
  pass("Actual renderer reload/browser reconnect restores Live Preview tag styling and live search handlers with unchanged saved bytes.");
}
