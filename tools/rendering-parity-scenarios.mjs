import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkRenderingParity({ directory, evaluate, command, click, press, wait, afterReload, capture, report }) {
  const path = "Rendering parity.md";
  const body = "# Tags\r\n\r\nPlain #project and #project/nested. (#bracket) [#label](https://example.invalid/#fragment).\r\n\r\n**#bold** *#italic* `#code`.\r\n";
  const text = "---\r\ntags: [project, project/nested] # keep tags\r\nstatus: review\r\nuntouched: 9007199254740993 # exact\r\n---\r\n" + body;
  const original = Buffer.from("\ufeff" + text);
  const active = ".workspace-tabs.mod-active .workspace-leaf:not([hidden])";
  const metadata = active + " .metadata-container";
  const status = metadata + ' [data-property-key="status"] input.metadata-input';
  const addTag = metadata + ' input[aria-label="Add tag to tags"]';
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const mode = async name => { await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${JSON.stringify(name)});true`); };
  const values = () => evaluate("app.properties.values(app.workspace.getActiveFile())");
  const fill = async (selector, value) => {
    await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: value });
  };
  const enter = () => press("Enter", "Enter", 13);
  const checkBody = async () => {
    const bytes = await readFile(join(directory, path)), saved = bytes.toString("utf8");
    assert.ok(saved.startsWith("\ufeff---\r\n"));
    assert.ok(saved.endsWith("---\r\n" + body));
    assert.ok(saved.includes("untouched: 9007199254740993 # exact\r\n"));
    assert.equal(/(?<!\r)\n/.test(saved), false);
    return bytes;
  };
  await writeFile(join(directory, path), original);
  await evaluate(`(async()=>{await app.configuration.update("app",data=>{data.showInlineTitle=false;data.livePreview=true});await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setEditingMode("preview")})()`);
  await wait(`app.current?.file.path===${JSON.stringify(path)}&&!app.dirty`, "parity note ready");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(active + " .inline-title")}).hidden`), true);
  report.renderingParity = await evaluate(`(()=>{const panel=document.querySelector(${JSON.stringify(metadata)});return{height:panel.getBoundingClientRect().height,rows:[...panel.querySelectorAll(".metadata-property")].map(row=>({name:row.dataset.propertyKey,height:row.getBoundingClientRect().height})),tag:getComputedStyle(panel.querySelector(".metadata-tag")).fontSize}})()`);
  assert.ok(report.renderingParity.rows.every(row => row.height <= 36));
  assert.ok(report.renderingParity.height < 170);
  assert.equal(report.renderingParity.tag, "13px");
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(metadata + ' [aria-label^="Remove tag "]')}).length`), 2);
  assert.deepEqual(await readFile(join(directory, path)), original);
  if (capture) { await capture("properties-before"); }
  await mode("live-preview");
  await wait(`!document.querySelector(${JSON.stringify(active + " .cm-content")}).innerText.includes("status: review")`, "Live Preview hides YAML");
  assert.equal(await evaluate("app.editor.getValue()"), text);
  await mode("source");
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(active + " .cm-content")}).innerText.includes("status: review")`));
  await mode("preview");
  assert.equal((await evaluate("app.metadataCache.getFileCache(app.workspace.getActiveFile()).tags.map(tag=>tag.tag)")).includes("#bracket"), false);
  pass("Compact property rows and removable tag chips respect hidden inline titles; Live Preview hides the original YAML while Source retains its exact text.");

  await click(metadata + ' [aria-label="Remove tag project/nested"]');
  await wait('JSON.stringify(app.properties.values(app.workspace.getActiveFile()).tags)===JSON.stringify(["project"])&&!app.dirty', "one tag removed");
  await checkBody();
  await fill(addTag, "123"); await enter();
  await wait(`document.querySelector(${JSON.stringify(metadata + " .metadata-property-error")}).textContent.includes("numeric-only")`, "invalid tag explained");
  assert.deepEqual((await values()).tags, ["project"]);
  await fill(addTag, "new/日本語"); await enter();
  await wait('JSON.stringify(app.properties.values(app.workspace.getActiveFile()).tags)===JSON.stringify(["project","new/日本語"])&&!app.dirty', "tag added inline");
  await evaluate(`globalThis.renderingOldStatusInput=document.querySelector(${JSON.stringify(status)});true`);
  await fill(status, "ready"); await enter();
  await wait('app.properties.values(app.workspace.getActiveFile()).status==="ready"&&!app.dirty', "text property saved inline");
  await evaluate("app.core.whenIdle()");
  await wait(`!document.querySelector(${JSON.stringify(metadata + ' [data-property-key="status"]')}).hasAttribute("aria-busy")`, "inline property commit settled");
  await evaluate('(()=>{if(renderingOldStatusInput.isConnected)throw new Error("The committed field should have been replaced");renderingOldStatusInput.value="late disconnected edit";renderingOldStatusInput.dispatchEvent(new FocusEvent("blur"));delete globalThis.renderingOldStatusInput})()');
  await evaluate("app.core.whenIdle()");
  assert.equal((await values()).status, "ready");
  await checkBody();
  if (capture) { await capture("properties-edited"); }
  pass("Trusted tag removal, invalid-tag correction, Unicode/nested tag entry and inline text editing retain BOM, CRLF, comments, body and exact unknown numbers.");

  await fill(status, "stale draft");
  await evaluate(`globalThis.renderingStaleInput=document.querySelector(${JSON.stringify(status)});true`);
  await evaluate('app.fileManager.processFrontMatter(app.workspace.getActiveFile(),values=>{values.status="external"})');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(status)}).value`), "stale draft");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(status)})===renderingStaleInput`), true, "Metadata-type refresh must keep the focused field and its original comparison value together");
  await evaluate("delete globalThis.renderingStaleInput;true");
  report.renderingParity.staleBefore = await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(status)});return{busy:input.closest("[data-property-key]").getAttribute("aria-busy"),focused:document.activeElement===input,value:input.value,stored:app.properties.values(app.workspace.getActiveFile()).status}})()`);
  await enter();
  try {
    await wait(`document.querySelector(${JSON.stringify(metadata + ' [data-property-key="status"] .metadata-property-error')}).textContent.includes("changed while")`, "stale inline edit rejected");
  } catch (issue) {
    report.renderingParity.staleFailure = await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(status)});return{row:input.closest("[data-property-key]").outerHTML,focused:document.activeElement===input,stored:app.properties.values(app.workspace.getActiveFile()).status,dirty:app.dirty,pending:app.core.pending?.size}})()`);
    throw issue;
  }
  assert.equal((await values()).status, "external");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(status)}).value`), "stale draft");
  await press("Escape", "Escape", 27);
  await wait(`document.querySelector(${JSON.stringify(status)}).value==="external"`, "cancel reveals current property");
  await checkBody();
  pass("Inline edits retain a focused draft and reject a stale submission instead of overwriting newer frontmatter; Escape reveals the current value.");

  const scrollPath = "Garden scrolling.md";
  const scrollText = "---\r\ntags: [garden, project/nested]\r\naliases: [Seed project]\r\nstatus: active\r\npriority: medium\r\nhours: 8\r\ncompleted: 3\r\ndue: 2026-11-13\r\ntype: project\r\nowner: gardener\r\nrelated: Observatory\r\n---\r\n# Garden\r\n\r\n" + Array.from({ length: 80 }, (_, index) => `## Section ${index}\r\n\r\nGarden paragraph ${index} with #garden and [[Rendering parity]].\r\n\r\n`).join("");
  const scrollBytes = Buffer.from("\ufeff" + scrollText);
  await writeFile(join(directory, scrollPath), scrollBytes);
  await evaluate(`(async()=>{await app.configuration.update("app",data=>{data.showInlineTitle=true});await app.vault.refresh();await app.openFile(${JSON.stringify(scrollPath)})})()`);
  report.renderingParity.scrolling = {};
  for (const name of ["preview", "live-preview", "source"]) {
    await mode(name);
    await evaluate("app.workspace.activeLeaf.view.contentEl.scrollTop=0;app.editor.cm.requestMeasure();true");
    const before = await evaluate(`(()=>{const v=app.workspace.activeLeaf.view,r=v.contentEl,p=v.metadataEditor.contentEl;return{top:r.scrollTop,height:r.clientHeight,scrollHeight:r.scrollHeight,propertiesTop:p.getBoundingClientRect().top,propertiesHeight:p.clientHeight,propertiesScrollHeight:p.scrollHeight,propertiesOverflow:getComputedStyle(p).overflowY,propertiesMaxHeight:getComputedStyle(p).maxHeight,point:{x:r.getBoundingClientRect().x+r.clientWidth/2,y:r.getBoundingClientRect().y+100}}})()`);
    assert.ok(before.scrollHeight > before.height + 500, name + " has a scrollable document");
    if (name !== "source") {
      assert.equal(before.propertiesMaxHeight, "none");
      assert.equal(before.propertiesOverflow, "visible");
      assert.ok(before.propertiesHeight >= 320, "All ten property rows occupy their full height");
      assert.ok(before.propertiesScrollHeight <= before.propertiesHeight + 1);
    }
    if (capture) { await capture("scroll-" + name + "-top"); }
    await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...before.point, deltaX: 0, deltaY: 420 });
    await wait("app.workspace.activeLeaf.view.contentEl.scrollTop>200", name + " outer document wheel scrolling");
    const after = await evaluate("(()=>{const v=app.workspace.activeLeaf.view;return{top:v.contentEl.scrollTop,propertiesTop:v.metadataEditor.contentEl.getBoundingClientRect().top,propertiesScroll:v.metadataEditor.contentEl.scrollTop,previewScroll:v.previewEl.scrollTop,editorScroll:v.editor.cm.scrollDOM.scrollTop}})()");
    assert.equal(after.propertiesScroll, 0); assert.equal(after.previewScroll, 0); assert.equal(after.editorScroll, 0);
    if (name !== "source") { assert.ok(after.propertiesTop < before.propertiesTop - 200); }
    report.renderingParity.scrolling[name] = { before, after };
    if (capture) { await capture("scroll-" + name); }
  }
  await evaluate("app.editor.focus();true");
  await press("End", "End", 35, 2);
  await wait("app.editor.getCursor().line===app.editor.lastLine()&&app.workspace.activeLeaf.view.contentEl.scrollTop>1000", "CodeMirror reveals the last line through the outer scroller");
  const scrollBeforeSync = await evaluate("app.workspace.activeLeaf.view.contentEl.scrollTop");
  await evaluate('(()=>{const text=app.editor.getValue();app.editor.syncValue(text.replace("paragraph 0","updated 0"));app.editor.syncValue(text)})()');
  assert.ok(Math.abs(await evaluate("app.workspace.activeLeaf.view.contentEl.scrollTop") - scrollBeforeSync) < 3);
  assert.deepEqual(await readFile(join(directory, scrollPath)), scrollBytes);
  pass("Reading, Live Preview and Source use one outer document scrollbar: all ten properties expand, wheel input moves metadata and note together, nested scroll positions stay zero, and editor end-of-document navigation/synchronization retain the outer scroll without writing the file.");

  // A read-only model fixture exercises the disabled field layout used by the
  // GitHub host; it does not claim a new remote-fetch or backend-write test.
  await evaluate(`(async()=>{globalThis.renderingScrollLeaf=app.workspace.activeLeaf;globalThis.renderingReadOnly=app.vault.readOnly;globalThis.renderingSplitLeaf=app.workspace.getLeaf("split");await renderingSplitLeaf.openFile(app.vault.getFileByPath(${JSON.stringify(scrollPath)}));app.vault.readOnly=true;renderingSplitLeaf.view.setEditingMode("preview");renderingSplitLeaf.view.metadataEditor.render(true);renderingSplitLeaf.view.contentEl.scrollTop=0;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()`);
  try {
    const before = await evaluate("(()=>{const v=renderingSplitLeaf.view,r=v.contentEl,p=v.metadataEditor.contentEl;return{width:r.clientWidth,otherTop:renderingScrollLeaf.view.contentEl.scrollTop,propertiesHeight:p.clientHeight,propertiesScrollHeight:p.scrollHeight,disabled:[...p.querySelectorAll('button,input')].every(control=>control.disabled),point:{x:r.getBoundingClientRect().x+r.clientWidth/2,y:r.getBoundingClientRect().y+100}}})()");
    assert.equal(before.disabled, true);
    assert.ok(before.propertiesHeight >= 320);
    assert.ok(before.propertiesScrollHeight <= before.propertiesHeight + 1);
    if (capture) { await capture("scroll-readonly-split-top"); }
    await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...before.point, deltaX: 0, deltaY: 420 });
    await wait("renderingSplitLeaf.view.contentEl.scrollTop>200", "read-only split document scrolling");
    assert.equal(await evaluate("renderingSplitLeaf.view.metadataEditor.contentEl.scrollTop"), 0);
    assert.equal(await evaluate("renderingScrollLeaf.view.contentEl.scrollTop"), before.otherTop);
    report.renderingParity.readOnlySplit = { scope: "disabled/read-only UI model fixture", ...before, top: await evaluate("renderingSplitLeaf.view.contentEl.scrollTop") };
    if (capture) { await capture("scroll-readonly-split"); }
  } finally {
    await evaluate("(async()=>{app.vault.readOnly=renderingReadOnly;await app.workspace.closeLeaf(renderingSplitLeaf);app.workspace.setActiveLeaf(renderingScrollLeaf,{focus:false});delete globalThis.renderingSplitLeaf;delete globalThis.renderingScrollLeaf;delete globalThis.renderingReadOnly})()");
  }
  assert.deepEqual(await readFile(join(directory, scrollPath)), scrollBytes);
  pass("A narrow split with disabled read-only property controls expands all rows and scrolls as one document, while the adjacent note keeps its own scroll position and both panes retain exact note bytes.");

  const renderPath = "Rendering sample.md";
  await writeFile(join(directory, renderPath), "# Rendering comparison\n\n**Bold**, *italic* and ==highlight==.\n\n> [!note] **Same callout**\n> A short note with [a link](Rendering%20parity.md).\n\n> [!tip]- Folded\n> Hidden body.\n\n> \\[!note] Literal escaped marker.\n\n- [ ] Unchecked task\n- [x] Checked task\n\n| Column | Value |\n| --- | --- |\n| One | Two |\n\n```mermaid\nflowchart LR\n A[Note] --> B[Review]\n```\n");
  await evaluate(`(async()=>{await app.configuration.update("app",data=>{data.showInlineTitle=false});await app.vault.refresh();await app.openFile(${JSON.stringify(renderPath)});app.workspace.activeLeaf.view.setEditingMode("preview")})()`);
  await wait(`document.querySelector(${JSON.stringify(active + " .mermaid-image")})?.naturalWidth>0`, "Mermaid still decodes");
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(active + " .markdown-preview-view .callout")}).length`), 2);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(active + ' .callout[data-callout="note"] .callout-title-inner')}).innerHTML`), "<strong>Same callout</strong>");
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(active + " .markdown-preview-view")}).textContent.includes("[!note] Literal escaped marker.")`));
  const folded = active + ' details.callout[data-callout="tip"]';
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(folded)}).open`), false);
  await click(folded + " summary");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(folded)}).open`), true);
  report.renderingParity.sample = await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(active + " .markdown-preview-view")}),task=root.querySelector("li.is-checked"),h1=root.querySelector("h1");return{h1:{font:getComputedStyle(h1).fontSize,weight:getComputedStyle(h1).fontWeight},task:{marker:getComputedStyle(task).listStyleType,decoration:getComputedStyle(task).textDecorationLine},callouts:root.querySelectorAll(".callout").length,tables:root.querySelectorAll("table").length}})()`);
  assert.equal(report.renderingParity.sample.h1.font, "25.888px");
  assert.equal(report.renderingParity.sample.h1.weight, "700");
  assert.equal(report.renderingParity.sample.task.marker, "none");
  assert.equal(report.renderingParity.sample.task.decoration, "line-through");
  assert.equal(report.renderingParity.sample.tables, 1);
  if (capture) { await capture("sample"); }
  pass("Reading callouts retain rich titles/body links and real collapse controls, escaped markers stay literal, and task/heading styling follows the reference while tables and Mermaid still render.");
  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setEditingMode("live-preview");await app.workspace.flushLayout()})()`);
  await command("Page.reload"); await afterReload();
  await wait(`app.current?.file.path===${JSON.stringify(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="live-preview"`, "property rendering after reload");
  assert.deepEqual((await values()).tags, ["project", "new/日本語"]);
  assert.equal((await values()).status, "external");
  await checkBody();
  if (capture) { await capture("properties-restored"); }
  pass("Reload/reconnect restores edited properties, compact rendering, hidden-title preference and Live Preview with unchanged saved bytes.");
}
