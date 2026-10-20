import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const popup = '[data-builtin-suggest="source"]:popover-open';
const q = JSON.stringify;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };

/** Real raw-YAML popup workflows; root owns frozen builds and final shutdown. */
export async function checkPropertyValues({ directory, evaluate, command, click, wait, report, capture }) {
  const folder = "Property value completions", target = folder + "/Value source.md";
  const targetText = '---\r\nstatus: "Open λ"\r\ntags: [project, shared]\r\naliases: ["Useful alias"]\r\n---\r\n# Existing values\r\n';
  const original = '---\r\nstatus: \r\ntags:\r\n  - shared\r\n  - \r\n---\r\n# Property values λ\r\n\r\nUntouched 😀 body.\r\n';
  const bytes = text => Buffer.from("\ufeff" + text);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), properties = await evaluate('app.core.isEnabled("properties")');
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, target), bytes(targetText), { flag: "wx" });
  const path = folder + "/Raw properties.md";
  await writeFile(join(directory, path), bytes(original), { flag: "wx" });
  await evaluate("app.vault.refresh()");
  await wait(`app.metadataCache.getCache(${q(target)})?.frontmatter?.status==="Open λ"`, "existing property strings indexed");
  const scalarRow = `${popup} [data-builtin-property-key="status"][data-builtin-property-value="Open λ"]`;
  const tagRow = `${popup} [data-builtin-property-key="tags"][data-builtin-property-value="project"]`;
  const sharedRow = `${popup} [data-builtin-property-key="tags"][data-builtin-property-value="shared"]`;
  try {
    for (const mode of ["source", "live-preview"]) {
      if (mode === "live-preview" && properties) await evaluate('app.core.setEnabled("properties",false)');
      await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(original)},"input.property-value-fixture");app.editor.setCursor(1,8);app.editor.focus()})()`);
      await command("Page.bringToFront");
      await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "visible raw YAML editing mode");
      let completed = original;
      const choose = async (line, ch, input, row, expected) => {
        await evaluate(`app.editor.setCursor(${line},${ch});app.editor.focus()`);
        await command("Input.insertText", { text: input });
        await wait(`Boolean(document.querySelector(${q(row)}))`, "actual property-value popup choice");
        const before = await evaluate("app.editor.getValue()");
        if (mode === "source" && line === 1 && capture) await capture("property-value-popup");
        if (line !== 1) assert.equal(await evaluate(`Boolean(document.querySelector(${q(sharedRow)}))`), false, "existing list value is omitted");
        await click(row);
        await wait(`app.editor.getValue()===${q(expected)}`, "one YAML string slot completed");
        await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), before);
        await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), expected);
        await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(expected));
        completed = expected;
      };
      await choose(1, 8, "Op", scalarRow, completed.replace("status: \r\n", 'status: "Open λ"\r\n'));
      await choose(4, 4, "pro", tagRow, completed.replace("  - \r\n", '  - "project"\r\n'));

      // A flow-list item is another visible scalar slot; leave its punctuation
      // and an adjacent, already-present value completely outside the edit.
      const flow = completed.replace('tags:\r\n  - shared\r\n  - "project"', 'tags: [shared, p]');
      await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(flow)},"input.property-value-fixture")`);
      completed = flow;
      await choose(2, 16, "ro", tagRow, flow.replace("[shared, p]", '[shared, "project"]'));
      assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      pass(report, `${mode}: actual scalar, block-list and flow-list property-value choices preserve string identity, surrounding YAML/BOM/CRLF and isolated Undo/Redo; an existing list value is excluded and the contributor note stays exact.`);

      // Retain the actual row before an independent physical contributor edit.
      const partial = completed.replace('status: "Open λ"', "status: Op");
      const reset = async text => {
        await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(text)},"input.property-value-fixture");app.editor.setCursor(1,10);app.editor.focus()`);
      };
      await reset(partial);
      await wait(`Boolean(document.querySelector(${q(scalarRow)}))`, "held property-value contributor row");
      await evaluate(`globalThis.heldPropertyValue=document.querySelector(${q(scalarRow)})`);
      await writeFile(join(directory, target), bytes(targetText.replace('"Open λ"', '"Closed λ"')));
      await evaluate("app.metadataCache.refresh()");
      await wait(`app.metadataCache.getCache(${q(target)})?.frontmatter?.status==="Closed λ"`, "physical contributor change indexed");
      await evaluate("heldPropertyValue.click();delete globalThis.heldPropertyValue");
      assert.equal(await evaluate("app.editor.getValue()"), partial, "a stale value cannot use a changed contributor");
      await writeFile(join(directory, target), bytes(targetText));
      await evaluate("app.metadataCache.refresh()");
      await wait(`app.metadataCache.getCache(${q(target)})?.frontmatter?.status==="Open λ"`, "exact contributor restored");

      await reset(completed);
      await reset(partial);
      await wait(`Boolean(document.querySelector(${q(scalarRow)}))`, "held property-value source row");
      await evaluate(`globalThis.heldPropertyValue=document.querySelector(${q(scalarRow)})`);
      await command("Input.insertText", { text: "!" });
      const newer = await evaluate("app.editor.getValue()");
      assert.equal(newer, partial.replace("status: Op", "status: Op!"));
      await evaluate("heldPropertyValue.click();delete globalThis.heldPropertyValue");
      assert.equal(await evaluate("app.editor.getValue()"), newer, "a held row cannot rewrite newer source");
      await reset(completed);
      await evaluate("app.saveAll()");
      assert.deepEqual(await readFile(join(directory, path)), bytes(completed));
      assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      pass(report, `${mode}: actual held value rows refuse independently changed contributor metadata/source and newer editor text; restoring and saving the fixtures retains exact source and contributor bytes.`);
    }
  } finally {
    await evaluate("delete globalThis.heldPropertyValue;app.saveAll()");
    await writeFile(join(directory, target), bytes(targetText));
    if (await evaluate('app.core.isEnabled("properties")') !== properties) await evaluate(`app.core.setEnabled("properties",${properties})`);
    await evaluate(`app.workspace.changeLayout(${q(layout)})`);
    await evaluate("app.workspace.flushLayout()");
  }
}

/** Root mounts a genuine cache-only note with raw status and tags prefixes. */
export async function checkPropertyValuesReadOnly({ evaluate, wait, report }) {
  const before = await evaluate("app.editor.getValue()");
  const results = await evaluate(String.raw`(()=>{
    const editor=app.editor,file=app.workspace.getActiveFile(),lines=editor.getValue().split(/\r?\n/);
    const builtin=app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source");
    if(!builtin)throw new Error("Missing built-in completion provider");
    return ["status: Op","  - pro"].map(prefix=>{
      const line=lines.findIndex(value=>value===prefix);
      if(line<0)throw new Error("Missing read-only property-value prefix "+prefix);
      editor.setCursor(line,lines[line].length);editor.focus();
      const cursor=editor.getCursor();
      return {trigger:builtin.onTrigger(cursor,editor,file),choices:builtin.getSuggestions({editor,file,start:cursor,end:cursor,query:prefix}).length};
    });
  })()`);
  assert.deepEqual(results, [{ trigger: null, choices: 0 }, { trigger: null, choices: 0 }]);
  await wait(`!document.querySelector(${q(popup)})`, "read-only property-value completion remains closed");
  assert.equal(await evaluate("app.editor.getValue()"), before);
  pass(report, "Genuine cached read-only scalar and list-item YAML prefixes refuse property-value triggering and direct candidate enumeration, preserving the original note exactly.");
}
