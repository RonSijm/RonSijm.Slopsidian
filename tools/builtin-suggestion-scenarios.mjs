import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Actual shared-editor completion workflows; root owns builds, artifact binding and full shutdown audits. */
export async function checkBuiltinSuggestions({ directory, evaluate, command, click, wait, report, capture }) {
  const folder = "Builtin completions", target = folder + "/Builtin completion target.md", alias = "Builtin completion alias";
  const original = ["---", "title: Completion source", "", "---", "# Built-in completions", "", "Insert here: ", ""].join("\r\n");
  const popup = '[data-builtin-suggest="source"]:popover-open';
  const q = JSON.stringify;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  async function editingMode(mode) {
    if (await evaluate(`app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`)) { return; }
    const before = await evaluate("app.editor.getValue()");
    await click("[data-editor-status]");
    const label = mode === "source" ? "Source mode" : "Live Preview";
    await wait(`Boolean(document.querySelector('[data-editor-mode-menu] [data-menu-title=${q(label)}]'))`, "visible editor mode choice");
    await click(`[data-editor-mode-menu] [data-menu-title=${q(label)}]`);
    await wait(`app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "visible editor mode transition");
    assert.equal(await evaluate("app.editor.getValue()"), before, "mode changes preserve raw YAML and document text");
  }
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, target), '---\r\nstatus: open\r\naliases: ["' + alias + '"]\r\n---\r\n# Target\r\n', { flag: "wx" });
  for (const mode of ["source", "live-preview"]) { await writeFile(join(directory, folder, mode + ".md"), Buffer.from("\ufeff" + original), { flag: "wx" }); }
  await evaluate("app.vault.refresh()");
  await wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${q(target)}))?.frontmatter?.status==="open"`, "completion target metadata is indexed");
  try {
    for (const mode of ["source", "live-preview"]) {
      const path = folder + "/" + mode + ".md";
      await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.setCursor(6,13);app.editor.focus()})()`);
      await command("Page.bringToFront");
      await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "completion note mode opened");
      await command("Input.insertText", { text: "[[Builtin completion t" });
      const row = `${popup} .suggestion-item[data-builtin-link=${q(target)}]:not([data-builtin-alias])`;
      await wait(`Boolean(document.querySelector(${q(row)}))`, "actual known-note completion popup");
      if (mode === "source" && capture) { await capture("builtin-completion-popup"); }
      const before = await evaluate("app.editor.getValue()");
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target)}),${q(path)})`);
      await click(row);
      const expected = original.replace("Insert here: ", "Insert here: [[" + linktext + "]]");
      await wait(`app.editor.getValue()===${q(expected)}`, "known note chosen without duplicating delimiters");
      assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${q(linktext)},${q(path)})===app.vault.getFileByPath(${q(target)})`), true);
      await evaluate("app.editor.undo()"); await wait(`app.editor.getValue()===${q(before)}`, "completion undo retains typed opener");
      await evaluate("app.editor.redo()"); await wait(`app.editor.getValue()===${q(expected)}`, "completion redo restores one insertion");
      await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + expected));

      // With Properties enabled, Live Preview replaces valid frontmatter with
      // its separate property editor. Select the visible Source mode control
      // before typing a raw YAML key; forcing a caret into hidden YAML redirects
      // native input to the first visible Markdown line.
      await editingMode("source");
      await evaluate("app.editor.setCursor(2,0);app.editor.focus()");
      await command("Input.insertText", { text: "sta" });
      const propertyRow = `${popup} .suggestion-item[data-builtin-property="status"]`;
      await wait(`Boolean(document.querySelector(${q(propertyRow)}))`, "known top-level property completion popup");
      await click(propertyRow);
      await wait('app.editor.getLine(2)==="status: "', "property insertion retains a value cursor");
      assert.deepEqual(await evaluate("app.editor.getCursor()"), { line: 2, ch: 8 });
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getLine(2)"), "sta");
      await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getLine(2)"), "status: ");

      await editingMode(mode);
      await evaluate("app.editor.setCursor(6,app.editor.getLine(6).length);app.editor.focus()");
      await command("Input.insertText", { text: " [[Builtin completion a" });
      const aliasRow = `${popup} .suggestion-item[data-builtin-link=${q(target)}][data-builtin-alias=${q(alias)}]`;
      await wait(`Boolean(document.querySelector(${q(aliasRow)}))`, "actual metadata-alias completion");
      await click(aliasRow);
      const completed = expected.replace("title: Completion source\r\n\r\n", "title: Completion source\r\nstatus: \r\n").replace("]]\r\n", "]] [[" + linktext + "|" + alias + "]]\r\n");
      await wait(`app.editor.getValue()===${q(completed)}`, "alias is an explicit label for the selected existing file");
      await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + completed));
      pass(`${mode}: real wiki-link and alias controls insert known notes; raw YAML key completion uses visible Source mode and returns to the requested mode, preserving exact BOM/CRLF bytes and one-step Undo/Redo without creating a note.`);

      // A second occurrence must not create a case-duplicate property key.
      await editingMode("source");
      await evaluate("app.editor.setCursor(2,8);app.editor.focus()");
      await command("Input.insertText", { text: "\nsta" });
      await wait(`!document.querySelector(${q(propertyRow)})`, "existing property is omitted from completion");
      const duplicateProbe = await evaluate("app.editor.getValue()");
      assert.equal(duplicateProbe.includes("status: \r\nsta\r\n"), true);
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(completed)},"input.completion-fixture");app.editor.setCursor(6,app.editor.getLine(6).length);app.editor.focus()`);
      await editingMode(mode);
      await evaluate("app.editor.setCursor(6,app.editor.getLine(6).length);app.editor.focus()");

      // Held controls must not apply after their document generation has changed.
      await command("Input.insertText", { text: " [[Builtin completion t" });
      await wait(`Boolean(document.querySelector(${q(row)}))`, "stale-control source popup");
      await evaluate(`globalThis.heldBuiltinCompletion=document.querySelector(${q(row)})`);
      await command("Input.insertText", { text: "!" });
      await wait(`!document.querySelector(${q(row)})`, "changed source retires the old existing-target completion");
      assert.equal(await evaluate("heldBuiltinCompletion.isConnected"), false);
      const changed = await evaluate("app.editor.getValue()");
      const inventory = await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()");
      await evaluate("heldBuiltinCompletion.click();delete globalThis.heldBuiltinCompletion");
      assert.equal(await evaluate("app.editor.getValue()"), changed);
      // An independently revalidated Create note choice may keep the new query
      // popup open. Dismiss it without accepting or creating a file.
      assert.equal(await evaluate(`Array.from(document.querySelectorAll(${q(popup + " .suggestion-item")})).every(element=>Boolean(element.dataset.builtinCreateNote))`), true);
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await wait(`!document.querySelector(${q(popup)})`, "dismiss the independent missing-note choice without creating a note");
      assert.equal(await evaluate("app.editor.getValue()"), changed);
      assert.deepEqual(await evaluate("app.vault.getMarkdownFiles().map(file=>file.path).sort()"), inventory);
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(completed)},"input.completion-fixture")`);
      await evaluate("app.saveAll()");
      assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + completed));
      pass(`${mode}: existing-property duplicates stay absent, and a held completion row cannot mutate a newer source generation.`);
    }
  } finally {
    await evaluate("delete globalThis.heldBuiltinCompletion;app.saveAll()");
    await evaluate(`app.workspace.changeLayout(${q(layout)})`);
    await evaluate("app.workspace.flushLayout()");
  }
}

/** Root mounts and audits the genuine cache-only read-only fixture around this check. */
export async function checkBuiltinSuggestionsReadOnly({ evaluate, wait, report }) {
  const before = await evaluate("app.editor.getValue()");
  const result = await evaluate(`(()=>{
    const editor=app.editor,lines=editor.getValue().split(/\\r?\\n/),line=lines.findIndex(value=>value.startsWith("[[Completion"));
    if(line<0)throw new Error("Missing read-only completion fixture");
    editor.setCursor(line,lines[line].length);editor.focus();
    const builtin=app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source");
    return {registered:Boolean(builtin),trigger:builtin?.onTrigger(editor.getCursor(),editor,app.workspace.getActiveFile())};
  })()`);
  assert.deepEqual(result, { registered: true, trigger: null });
  await wait('!document.querySelector(\'[data-builtin-suggest="source"]:popover-open\')', "read-only source has no mutation completion popup");
  assert.equal(await evaluate("app.editor.getValue()"), before);
  const text = "Genuine cached read-only Source retains navigation but refuses built-in completion triggering and preserves exact text.";
  report.checks.push(text); console.log("PASS " + text);
}
