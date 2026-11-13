import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const popup = '[data-builtin-suggest="source"]:popover-open';
const q = JSON.stringify;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };

/** Real popup insertion and actual link navigation; root owns build binding and shutdown. */
export async function checkSubpathSuggestions(tools) {
  const { directory, evaluate, command, click, wait, report, capture } = tools;
  const folder = "Subpath completions", target = folder + "/Subpath target.md";
  const targetText = "# Heading λ\r\n\r\nTarget paragraph **text**. ^target-block\r\n\r\n## **Heading λ**\r\n";
  const original = "# Local heading Ω\r\n\r\nLocal paragraph. ^local-block\r\n\r\nLinks: \r\n";
  const bytes = text => Buffer.from("\ufeff" + text);
  const layout = await evaluate("app.workspace.getLayout()");
  await evaluate("app.saveAll()");
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, target), bytes(targetText), { flag: "wx" });
  for (const mode of ["source", "live-preview"]) await writeFile(join(directory, folder, mode + ".md"), bytes(original), { flag: "wx" });
  await evaluate("app.vault.refresh()");
  await wait(`Boolean(app.metadataCache.getCache(${q(target)})?.blocks["target-block"])`, "known heading/block destination indexed");
  try {
    for (const mode of ["source", "live-preview"]) {
      const path = folder + "/" + mode + ".md";
      const openSource = async () => {
        await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()})()`);
        await command("Page.bringToFront");
        await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "subpath completion editor mode");
      };
      await openSource();
      const linktext = await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${q(target)}),${q(path)})`);
      let completed = original;
      const choose = async (input, token, selector) => {
        await evaluate("app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()");
        await command("Input.insertText", { text: input });
        await wait(`Boolean(document.querySelector(${q(selector)}))`, "known subpath popup control");
        const typed = completed.replace(/\r\n$/, input + "\r\n");
        assert.equal(await evaluate("app.editor.getValue()"), typed);
        if (mode === "source" && input.includes("#He") && capture) await capture("subpath-heading-popup");
        await click(selector);
        completed = completed.replace(/\r\n$/, token + "\r\n");
        await wait(`app.editor.getValue()===${q(completed)}`, "complete known subpath token without duplicating delimiters");
        await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), typed);
        await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), completed);
        await evaluate("app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes(completed));
      };
      const headingRow = `${popup} [data-builtin-link=${q(target)}][data-builtin-heading="Heading λ"]`;
      const blockRow = `${popup} [data-builtin-link=${q(target)}][data-builtin-block="target-block"]`;
      await choose("[[Subpath target#He", "[[" + linktext + "#Heading λ]]", headingRow);
      await choose(" [[Subpath target#^target", " [[" + linktext + "#^target-block]]", blockRow);
      await choose(" [[#Local", " [[#Local heading Ω]]", `${popup} [data-builtin-link=${q(path)}][data-builtin-heading="Local heading Ω"]`);
      await choose(" [[#^local", " [[#^local-block]]", `${popup} [data-builtin-link=${q(path)}][data-builtin-block="local-block"]`);
      assert.equal(await evaluate(`app.metadataCache.getFirstLinkpathDest(${q(linktext)},${q(path)})===app.vault.getFileByPath(${q(target)})`), true);

      // The inserted links also pass through the ordinary Reading pointer path.
      for (const [subpath, line] of [["#Heading λ", 0], ["#^target-block", 2]]) {
        await evaluate('app.workspace.activeLeaf.view.previewEl.dataset.subpathSourceReading="true";app.workspace.activeLeaf.view.setMode("preview")');
        const link = `[data-subpath-source-reading] a.internal-link[data-slopsidian-link=${q(linktext + subpath)}]`;
        await wait(`Boolean(document.querySelector(${q(link)}))`, "inserted subpath link rendered");
        await click(link);
        await wait(`app.workspace.getActiveFile()?.path===${q(target)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&app.workspace.activeLeaf.view.editor.getCursor().line===${line}`, "real Reading pointer reaches the chosen heading/block source line");
        await openSource();
      }
      assert.deepEqual(await readFile(join(directory, path)), bytes(completed));
      assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      pass(report, `${mode}: real known heading/block and current-note popup choices retain destination link preferences, isolated Undo/Redo and exact BOM/CRLF; actual Reading pointer navigation reaches their existing source lines without creating notes or IDs.`);

      for (const [input, row, altered, ready] of [
        [" [[Subpath target#He", headingRow, targetText.replaceAll("Heading λ", "Replacement heading"), `!app.metadataCache.getCache(${q(target)}).headings.some(value=>value.heading==="Heading λ")`],
        [" [[Subpath target#^target", blockRow, targetText.replace(" ^target-block", ""), `!app.metadataCache.getCache(${q(target)}).blocks["target-block"]`],
      ]) {
        await command("Input.insertText", { text: input });
        await wait(`Boolean(document.querySelector(${q(row)}))`, "held destination popup");
        await evaluate(`globalThis.heldSubpathCompletion=document.querySelector(${q(row)})`);
        const before = await evaluate("app.editor.getValue()");
        await writeFile(join(directory, target), bytes(altered));
        await evaluate("app.metadataCache.refresh()"); await wait(ready, "physical destination change observed by metadata");
        await evaluate("heldSubpathCompletion.click();delete globalThis.heldSubpathCompletion");
        assert.equal(await evaluate("app.editor.getValue()"), before, "a held subpath cannot insert a removed destination");
        await evaluate(`app.editor.replaceExpected(app.editor.getValue(),0,app.editor.getValue().length,${q(completed)},"input.subpath-fixture");app.editor.setCursor(4,app.editor.getLine(4).length);app.editor.focus()`);
        await writeFile(join(directory, target), bytes(targetText));
        await evaluate("app.metadataCache.refresh()");
        await wait(`app.metadataCache.getCache(${q(target)}).headings.some(value=>value.heading==="Heading λ")&&Boolean(app.metadataCache.getCache(${q(target)}).blocks["target-block"])`, "original destinations restored");
      }
      await evaluate("app.saveAll()");
      assert.deepEqual(await readFile(join(directory, path)), bytes(completed));
      assert.deepEqual(await readFile(join(directory, target)), bytes(targetText));
      assert.equal(await evaluate(`app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(${q(folder + "/")})).length`), 3);
      pass(report, `${mode}: held heading and block rows refuse physically removed destinations after metadata refresh; restoring the exact fixtures leaves all source bytes intact and creates no additional note or block ID.`);
    }
  } finally {
    await evaluate("delete globalThis.heldSubpathCompletion;app.saveAll()");
    await writeFile(join(directory, target), bytes(targetText));
    await evaluate(`app.workspace.changeLayout(${q(layout)})`);
    await evaluate("app.workspace.flushLayout()");
  }
}

/** Root supplies a genuine cached read-only note containing current heading/block prefixes. */
export async function checkSubpathSuggestionsReadOnly({ evaluate, wait, report }) {
  const before = await evaluate("app.editor.getValue()");
  const results = await evaluate(String.raw`(()=>{
    const editor=app.editor,file=app.workspace.getActiveFile(),lines=editor.getValue().split(/\r?\n/);
    const builtin=app.editorSuggestions.suggests.find(value=>value.containerEl.dataset.builtinSuggest==="source");
    if(!builtin)throw new Error("Missing built-in completion provider");
    return ["[[#Cached","[[#^cached"].map(prefix=>{
      const line=lines.findIndex(value=>value.startsWith(prefix));
      if(line<0)throw new Error("Missing read-only subpath prefix "+prefix);
      editor.setCursor(line,lines[line].length);editor.focus();
      const cursor=editor.getCursor();
      return {trigger:builtin.onTrigger(cursor,editor,file),choices:builtin.getSuggestions({editor,file,start:cursor,end:cursor,query:prefix}).length};
    });
  })()`);
  assert.deepEqual(results, [{ trigger: null, choices: 0 }, { trigger: null, choices: 0 }]);
  await wait(`!document.querySelector(${q(popup)})`, "read-only heading/block completion remains closed");
  assert.equal(await evaluate("app.editor.getValue()"), before);
  pass(report, "Genuine cached read-only current-note heading/block prefixes refuse both completion triggering and direct candidate enumeration, preserving the original note exactly.");
}
