import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

export async function checkBaseSummaries({ directory, evaluate, command, click, press, wait, restart, afterReload, capture, report }) {
  const folder = "Base summaries", path = folder + "/Catalog.base", first = folder + "/Item 1.md", last = folder + "/Item 125.md";
  const initial = '\ufeff# Keep the summary comment\r\nfuture: &opaque\r\n  integer: 9007199254740993\r\n  decimal: 0.123456789012345678901\r\ncopy: *opaque\r\nfilters:\r\n  and:\r\n    - file.inFolder("Base summaries")\r\n    - file.ext == "md"\r\nformulas:\r\n  doubled: price * 2\r\nsummaries:\r\n  literal: \'"<img src=x onerror=alert(1)>"\'\r\nviews:\r\n  - type: table\r\n    name: All\r\n    futureView: {preserved: true}\r\n    order: [file.name, note.price, formula.doubled, note.done, note.due, note.status]\r\n    sort: [{property: note.price, direction: ASC}]\r\n    summaries:\r\n      note.price: Sum\r\n      formula.doubled: Average\r\n      note.done: Checked\r\n      note.due: Earliest\r\n      note.status: Unique\r\n  - type: table\r\n    name: Limited\r\n    order: [file.name, note.price]\r\n    sort: [{property: note.price, direction: ASC}]\r\n    limit: 110\r\n    summaries: {note.price: Sum}\r\n  - type: table\r\n    name: Plain\r\n    order: [file.name, note.price]\r\n';
  const text = index => `---\r\n# Preserve note metadata\r\nprice: ${index}\r\ndone: ${index % 2 === 0}\r\ndue: 2025-03-0${index % 2 ? 1 : 3}\r\nstatus: ${index % 2 ? "Open" : "Closed"}\r\nopaque: 9007199254740993\r\n---\r\n# Item ${index}\r\n\r\nOriginal body λ.\r\n`;
  let firstText = text(1), lastText = text(125);
  const originalAutomatic = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const settingsPath = join(directory, ".obsidian", "bases.json"), settings = '{"futureNativeOption":{"retained":true}}\n';
  let id;
  const root = () => `[data-bases-view="${id}"]`, leaf = () => `app.workspace.getLeafById(${JSON.stringify(id)})`, view = () => leaf() + ".view";
  const dialog = '[data-core-dialog="bases"]', field = name => `${dialog} [data-bases-summary-${name}]`;
  const action = name => `${root()} [data-bases-action="${name}"]`, all = key => `${root()} tfoot [data-bases-summary="${key}"] [data-bases-summary-value]`;
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const exact = async (name, content, bom = true) => assert.deepEqual(await readFile(join(directory, name)), Buffer.from((bom ? "\ufeff" : "") + content.replace(/^\ufeff/, "")), name + " exact bytes");
  async function refreshFiles() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function fill(selector, value) { await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: value }); }
  async function choose(selector, value) {
    const index = await evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});select.focus();return [...select.options].findIndex(option=>option.value===${JSON.stringify(value)})})()`);
    assert.ok(index >= 0, "The actual select contains " + value);
    await press("Home", "Home", 36); for (let i = 0; i < index; i++) { await press("ArrowDown", "ArrowDown", 40); } await press("Enter", "Enter", 13);
    await wait(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`, "selected " + value);
  }
  async function complete() { await wait(`document.querySelector('${root()}')?.dataset.basesComplete==="true"`, "current summary worker result"); }
  async function clean() { await wait(`!${view()}.isDirty&&!${view()}.isSaving`, "summary configuration saved"); }
  async function total(key, value) { await wait(`document.querySelector(${JSON.stringify(all(key))})?.textContent===${JSON.stringify(value)}`, "all-row " + key + " summary = " + value); }
  async function reveal() { await click(`[data-tab-id="${id}"]`); await complete(); }
  async function openSummary(key) { await click(`${root()} [data-bases-summarize="${key}"]`); await wait(`Boolean(document.querySelector('${field("function")}'))`, "real column summary dialog"); }
  async function applySummary(key, name) { await openSummary(key); await choose(field("function"), name); await click(dialog + ' [data-bases-action="apply-summary"]'); await wait(`!document.querySelector('${dialog}')`, "summary dialog applied"); await clean(); await complete(); }
  async function selectView(name) { await choose(root() + " [data-bases-select]", name); await complete(); }
  async function restartAndRestore() { await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()"); if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload(); }
  async function originalFiles() { await exact(first, firstText); await exact(last, lastText); assert.equal(await readFile(settingsPath, "utf8"), settings); assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; }), originalAutomatic); }
  async function source(text) {
    await click(action("source")); await fill(dialog + " [data-bases-source]", text.replace(/^\ufeff/, "")); await click(dialog + ' [data-bases-action="apply-source"]');
    await wait(`!document.querySelector('${dialog}')`, "source applied"); await clean(); await complete();
  }

  await evaluate("app.workspace.saveAll()"); await mkdir(join(directory, folder), { recursive: true }); await mkdir(join(directory, ".obsidian"), { recursive: true });
  for (let index = 1; index <= 125; index++) { await writeFile(join(directory, folder, `Item ${index}.md`), Buffer.from("\ufeff" + text(index))); }
  await writeFile(join(directory, path), initial); await writeFile(settingsPath, settings); await refreshFiles();
  if (!await evaluate('app.core.isEnabled("bases")')) { await evaluate('app.core.setEnabled("bases",true)'); }
  await click(`[data-note-path="${path}"]`); await wait('app.workspace.activeLeaf.view.getViewType()==="bases"', "real base opened"); id = await evaluate("app.workspace.activeLeaf.id"); await complete();
  await total("note.price", "7875"); await total("formula.doubled", "126"); await total("note.done", "62"); await total("note.status", "2");
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(all("note.due"))}).textContent`), /^2025-03-01/);
  assert.equal(await evaluate(`document.querySelectorAll('${root()} [data-bases-row]').length`), 100); await exact(path, initial);
  await click(action("next-page")); await complete(); assert.equal(await evaluate(`document.querySelectorAll('${root()} [data-bases-row]').length`), 25); await total("note.price", "7875");
  await click(action("previous-page")); await complete();
  await openSummary("formula.doubled"); assert.match(await evaluate(`document.querySelector('${dialog} [data-bases-summary-hint]').textContent`), /all rows/); await click(dialog + ' [data-bases-action="cancel-summary"]');
  await applySummary("note.price", "Median"); await total("note.price", "63"); await applySummary("note.price", "Sum"); await total("note.price", "7875");
  await fill(root() + " [data-bases-search]", "Item 125.md"); await total("note.price", "125"); await fill(root() + " [data-bases-search]", ""); await total("note.price", "7875");
  await choose(root() + " [data-bases-group]", "note.status"); await clean(); await complete();
  const groupSummary = (label, key) => `(()=>{const row=[...document.querySelectorAll('${root()} [data-bases-group-label]')].find(n=>n.dataset.basesGroupLabel===${JSON.stringify(label)})?.parentElement?.nextElementSibling;return row?.querySelector('[data-bases-summary="${key}"] [data-bases-summary-value]')?.textContent})()`;
  await wait(groupSummary("Open", "note.price") + '==="3969"', "full Open group summary"); await wait(groupSummary("Closed", "note.price") + '==="3906"', "full Closed group summary");
  await click(action("next-page")); await complete(); await wait(groupSummary("Open", "note.price") + '==="3969"', "continued group spans pages without partial totals");
  await choose(root() + " [data-bases-group]", ""); await clean(); await complete();
  await selectView("Limited"); await total("note.price", "6105"); await selectView("All"); await total("note.price", "7875");
  let saved = await readFile(join(directory, path), "utf8");
  for (const value of ["# Keep the summary comment", "&opaque", "*opaque", "9007199254740993", "0.123456789012345678901", "futureView:"]) { assert.ok(saved.includes(value), value); }
  assert.ok(saved.startsWith("\ufeff")); assert.ok(!/(?<!\r)\n/.test(saved)); await originalFiles(); await capture?.();
  pass("Real table summaries load compatible YAML and report full 125-row totals/statistics, date/checkbox/count values, unchanged totals across pages, whole-group results, live search and view limits; actual column controls preserve opaque YAML, numeric tokens, BOM and CRLF.");

  await click(`${root()} [data-bases-row="${first}"] [data-bases-link]`);
  await wait(`app.workspace.activeLeaf.view.file?.path===${JSON.stringify(first)}&&app.workspace.activeEditor`, "open summary source note");
  const editor = '.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]';
  assert.equal(await evaluate("app.workspace.activeEditor.editor.getValue()"), firstText);
  await click(editor + " .cm-line");
  await evaluate("app.workspace.activeEditor.editor.setSelection({line:2,ch:7},{line:2,ch:8})");
  assert.equal(await evaluate("app.workspace.activeEditor.editor.getSelection()"), "1");
  await command("Input.insertText", { text: "501" }); await total("note.price", "8375"); await exact(first, firstText);
  await press("z", "KeyZ", 90, 2); await total("note.price", "7875"); await press("y", "KeyY", 89, 2); await total("note.price", "8375");
  await press("s", "KeyS", 83, 2); await wait("!app.dirty", "explicit note save completed"); firstText = firstText.replace("price: 1\r\n", "price: 501\r\n"); await exact(first, firstText);
  lastText = lastText.replace("price: 125\r\n", "price: 225\r\n"); await writeFile(join(directory, last), Buffer.from("\ufeff" + lastText)); await refreshFiles(); await total("note.price", "8475");
  await reveal();
  await fill(root() + " [data-bases-search]", "Item 1.md"); await total("note.price", "501");
  await click(action("refresh")); await fill(root() + " [data-bases-search]", "Item 125.md"); await total("note.price", "225");
  await fill(root() + " [data-bases-search]", ""); await total("note.price", "8475");
  await originalFiles();
  pass("Summaries follow actual unsaved CodeMirror edits, Undo/Redo and explicit saves without prematurely writing notes; external changes and rapidly superseded search/worker requests update the totals from current metadata.");

  await openSummary("note.price"); await click(field("custom")); await fill(field("name"), "Double λ"); await fill(field("formula"), "values.filter(value.isType(\"number\")).reduce(acc + value * 2, 0)");
  await click(dialog + ' [data-bases-action="apply-summary"]'); await wait(`!document.querySelector('${dialog}')`, "custom summary saved"); await clean(); await total("note.price", "16950");
  saved = await readFile(join(directory, path), "utf8"); const definition = parseDocument(saved).getIn(["summaries", "Double λ"]); assert.match(definition, /reduce/);
  await selectView("Limited"); await applySummary("note.price", "Double λ");
  // Price 1 moved out of this 110-row sorted view; its new first 110 values are 2..111.
  await total("note.price", "12430"); await selectView("All"); await total("note.price", "16950");
  await openSummary("note.price"); await click(field("custom")); await fill(field("name"), "Broken"); await fill(field("formula"), "values.reduce(");
  const beforeInvalid = await readFile(join(directory, path)); await click(dialog + ' [data-bases-action="apply-summary"]');
  await wait(`document.querySelector('${dialog} [data-bases-dialog-error]').textContent.length>0`, "invalid custom expression rejected"); assert.deepEqual(await readFile(join(directory, path)), beforeInvalid); await click(dialog + ' [data-bases-action="cancel-summary"]');
  await openSummary("note.price"); await choose(field("function"), "Max");
  saved = await readFile(join(directory, path), "utf8"); saved += "# External writer while summary is open\r\n"; await writeFile(join(directory, path), saved); await refreshFiles();
  await wait(`${view()}.getViewData().includes("External writer while summary")`, "external base change refreshed");
  await click(dialog + ' [data-bases-action="apply-summary"]'); await wait(`document.querySelector('${dialog} [data-bases-dialog-error]').textContent.includes("changed")`, "stale summary dialog rejected"); await exact(path, saved); await click(dialog + ' [data-bases-action="cancel-summary"]');
  await applySummary("note.status", "literal"); await total("note.status", "<img src=x onerror=alert(1)>"); assert.equal(await evaluate(`document.querySelectorAll('${root()} tfoot img, ${root()} tfoot script').length`), 0);
  const valid = await readFile(join(directory, path), "utf8");
  await source(valid.replace('values.filter(value.isType("number")).reduce(acc + value * 2, 0)', 'values.constructor()'));
  await total("note.price", "#ERROR"); await total("formula.doubled", "135.6");
  assert.equal(await evaluate(`document.querySelector('${root()} [data-bases-issues]').hidden`), false); assert.equal(await evaluate(`document.querySelectorAll('${root()} [data-bases-row]').length`), 100);
  await source(valid); await total("note.price", "16950");
  await selectView("Plain"); assert.equal(await evaluate(`document.querySelectorAll('${root()} tfoot').length`), 0);
  await applySummary("note.price", "Sum"); await total("note.price", "8475");
  await click(`${root()} tfoot [data-bases-summary="note.price"] button`); await choose(field("function"), ""); await click(dialog + ' [data-bases-action="apply-summary"]'); await wait(`!document.querySelector('${dialog}')`, "summary removed from footer control"); await clean(); await complete();
  assert.equal(await evaluate(`document.querySelectorAll('${root()} tfoot').length`), 0); await selectView("All"); await total("note.price", "16950");
  await originalFiles(); saved = await readFile(join(directory, path), "utf8");
  pass("Actual controls create/reuse a bounded custom values/filter/reduce formula, reject invalid and stale dialogs, render HTML-like output as inert text and isolate formula errors from rows/other totals; removing the last selected summary hides its footer.");

  await openSummary("note.price"); await choose(field("function"), "Min");
  await evaluate(`window.oldSummaryForm=document.querySelector('${dialog} form');true`);
  await evaluate('app.core.setEnabled("bases",false)');
  assert.equal(await evaluate(`${view()}.getViewType()`), "unavailable");
  await evaluate('oldSummaryForm.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}));true'); await evaluate("app.core.whenIdle().catch(()=>{})"); await exact(path, saved);
  await evaluate('app.core.setEnabled("bases",true)'); await reveal(); await total("note.price", "16950");
  await restartAndRestore(); await reveal(); await total("note.price", "16950");
  assert.equal(await evaluate(`${view()}.getState().view`), "All");
  assert.equal(parseDocument(await readFile(join(directory, path), "utf8")).getIn(["summaries", "Double λ"]), definition);
  await exact(path, saved); await originalFiles();
  pass("Disabling Bases closes summary dialogs/workers and rejects a retained submit without writes; shared custom definitions, selected view and actual totals survive re-enable and a full desktop restart or actual-folder browser reconnect.");
}
