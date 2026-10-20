import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkBases({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const folder = "Base workflows", path = folder + "/Catalog.base", a = folder + "/Alpha.md", b = folder + "/Beta.md";
  const source = '\ufeff# Keep the base comment\r\nfuture: &opaque\r\n  integer: 9007199254740993\r\n  decimal: 0.123456789012345678901\r\ncopy: *opaque\r\nfilters:\r\n  and:\r\n    - file.inFolder("Base workflows")\r\n    - file.ext == "md"\r\nformulas:\r\n  total: price * qty\r\nproperties:\r\n  note.price:\r\n    displayName: Cost\r\nviews:\r\n  - type: table\r\n    name: Active\r\n    futureView: {keep: true}\r\n    filters: status != "archived"\r\n    order: [file.name, note.status, note.price, note.qty, formula.total, note.done, note.due]\r\n    sort:\r\n      - property: note.price\r\n        direction: ASC\r\n  - type: table\r\n    name: All\r\n    order: [file.name, note.price, formula.total]\r\n  - type: cards\r\n    name: Gallery\r\n';
  let aText = '\ufeff---\r\n# Keep note metadata\r\nstatus: open\r\nprice: 4\r\nqty: 3\r\ndone: false\r\ndue: 2025-03-04\r\nopaque: 9007199254740993\r\n---\r\n# Alpha\r\n\r\nOriginal body, λ and 中文.\r\n';
  const bText = '---\nstatus: done\nprice: 9\nqty: 2\ndone: true\ndue: 2025-04-05\n---\n# Beta\n';
  const settings = '{"futureNativeSetting":{"preserve":true}}\n';
  const ownSettings = join(directory, ".obsidian", "bases.json");
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  let id;
  const leaf = () => `app.workspace.getLeafById(${JSON.stringify(id)})`;
  const view = () => leaf() + ".view";
  const root = () => `[data-bases-view="${id}"]`;
  const row = note => `${root()} [data-bases-row="${note}"]`;
  const cell = (note, property) => row(note) + ` [data-bases-cell="${property}"]`;
  const action = name => root() + ` [data-bases-action="${name}"]`;
  const dialog = '.modal[data-core-dialog="bases"]';
  const field = selector => dialog + " " + selector;
  const complete = () => wait(`document.querySelector('${root()}')?.dataset.basesComplete==="true"`, "base worker rendered current results");
  const clean = () => wait(`!${view()}.isDirty&&!${view()}.isSaving`, "base configuration persisted to its original file");
  async function refreshFiles() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function fill(selector, text) {
    await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text });
  }
  async function choose(selector, value) {
    const index = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();return [...e.options].findIndex(option=>option.value===${JSON.stringify(value)})})()`);
    assert.ok(index >= 0, "The actual select contains " + value);
    await press("Home", "Home", 36);
    for (let count = 0; count < index; count++) { await press("ArrowDown", "ArrowDown", 40); }
    await press("Enter", "Enter", 13);
    await wait(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`, "real selection of " + value);
  }
  async function toggle(enabled) {
    await click("#open-settings"); await click("#core-plugins-tab");
    if (await evaluate('app.core.isEnabled("bases")') !== enabled) { await click('[data-core-toggle="bases"]'); }
    await wait(`!app.core.busy&&app.core.isEnabled("bases")===${enabled}`, "Bases toggled");
    assert.equal(await evaluate('Boolean(document.querySelector("[data-core-settings=bases]"))'), false, "Bases has no invented settings page");
    await click(".settings-close");
  }
  async function reveal() { await click(`[data-tab-id="${id}"]`); await complete(); }
  async function exact(note, text) {
    assert.equal(await readFile(join(directory, note), "utf8"), text, note + " exact bytes");
  }
  async function restartAndRestore() {
    await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); }
    else { await command("Page.reload"); }
    await afterReload();
  }

  await evaluate("app.workspace.saveAll()"); await toggle(false);
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, a), aText); await writeFile(join(directory, b), bText);
  await writeFile(join(directory, folder, "Archived.md"), '---\nstatus: archived\nprice: 12\nqty: 1\n---\n# Archived\n');
  await writeFile(join(directory, path), source); await writeFile(ownSettings, settings);
  await refreshFiles(); await toggle(true);
  await click(`[data-note-path="${path}"]`);
  await wait('app.workspace.activeLeaf.view.getViewType()==="bases"', "file tree opens a real Bases TextFileView");
  id = await evaluate("app.workspace.activeLeaf.id"); await complete();
  assert.equal(await evaluate(`document.querySelectorAll('${root()} [data-bases-row]').length`), 2);
  assert.equal(await evaluate(`document.querySelector('${cell(a, "formula.total")}').textContent`), "12");
  assert.equal(await evaluate(`document.querySelector('${cell(b, "formula.total")}').textContent`), "18");
  assert.match(await evaluate(`document.querySelector('${root()} thead').textContent`), /Cost/);
  assert.equal(await evaluate(`${leaf()}.session===null`), true);
  await exact(path, source);
  await click(`${row(a)} [data-bases-link]`);
  await wait(`app.workspace.activeLeaf.view.file?.path===${JSON.stringify(a)}&&app.workspace.activeEditor`, "row link opens the actual Markdown note");
  const originalEditor = await evaluate("app.editor.getValue()");
  await click(".workspace-leaf:not([hidden]) .cm-content[contenteditable=true]");
  await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: originalEditor.replace("price: 4", "price: 7") });
  await wait(`document.querySelector('${cell(a, "formula.total")}').textContent==="21"`, "worker follows dirty note metadata");
  await exact(a, aText);
  await press("z", "KeyZ", 90, 2);
  await wait(`document.querySelector('${cell(a, "formula.total")}').textContent==="12"`, "worker follows actual editor undo");
  await press("s", "KeyS", 83, 2); await reveal();
  await exact(a, aText);
  pass("Existing BOM/CRLF .base tables filter real note properties, evaluate formulas, navigate files and follow dirty edits/undo without rewriting source data.");

  await click(`${cell(a, "note.price")} button`);
  await fill(field("[data-bases-property-value]"), "5"); await click(field('[data-bases-action="save-property"]'));
  await wait(`!document.querySelector('${dialog}')&&document.querySelector('${cell(a, "formula.total")}').textContent==="15"`, "typed numeric property saved and formula refreshed");
  aText = aText.replace("price: 4", "price: 5"); await exact(a, aText);
  await click(`${cell(a, "note.done")} button`); await click(field("[data-bases-property-checked]")); await click(field('[data-bases-action="save-property"]'));
  await wait(`!document.querySelector('${dialog}')&&document.querySelector('${cell(a, "note.done")}').textContent==="true"`, "typed checkbox property saved");
  aText = aText.replace("done: false", "done: true"); await exact(a, aText);
  await click(`${cell(a, "note.price")} button`);
  await fill(field("[data-bases-property-value]"), "99"); await click(field('[data-bases-action="cancel-property"]')); await exact(a, aText);
  await click(`${cell(a, "note.price")} button`);
  aText = aText.replace("price: 5", "price: 6"); await writeFile(join(directory, a), aText); await refreshFiles();
  await fill(field("[data-bases-property-value]"), "7"); await click(field('[data-bases-action="save-property"]'));
  await wait(`document.querySelector('${dialog} [data-bases-dialog-error]').textContent.includes("changed while")`, "stale property dialog refuses external replacement");
  await exact(a, aText); await click(field('[data-bases-action="cancel-property"]'));
  await complete();
  await restartAndRestore(); await reveal();
  assert.equal(await evaluate(`document.querySelector('${cell(a, "formula.total")}').textContent`), "18");
  pass("Real numeric/checkbox edits preserve note body, comments, exact large numeric tokens and BOM/CRLF; cancellation and concurrent external property changes cannot overwrite data.");

  await click(root() + ' [data-bases-sort="note.price"]'); await clean();
  assert.equal(await evaluate(`document.querySelector('${root()} [data-bases-row]').dataset.basesRow`), b);
  await choose(root() + " [data-bases-group]", "note.status"); await clean();
  assert.equal(await evaluate(`document.querySelectorAll('${root()} [data-bases-group-label]').length`), 2);
  let saved = await readFile(join(directory, path), "utf8");
  for (const fragment of ["# Keep the base comment", "&opaque", "*opaque", "integer: 9007199254740993", "decimal: 0.123456789012345678901", "futureView:"]) { assert.ok(saved.includes(fragment), fragment); }
  assert.ok(saved.startsWith("\ufeff")); assert.ok(!/(?<!\r)\n/.test(saved));
  await fill(root() + " [data-bases-search]", "Alpha.md");
  await wait(`document.querySelectorAll('${root()} [data-bases-row]').length===1`, "search filters displayed values");
  await click(action("refresh"));
  await fill(root() + " [data-bases-search]", "Beta.md");
  await wait(`document.querySelectorAll('${root()} [data-bases-row]').length===1&&document.querySelector('${root()} [data-bases-row]').dataset.basesRow===${JSON.stringify(b)}`, "a worker result cannot cancel newer search input");
  await fill(root() + " [data-bases-search]", ""); await complete();
  await actionSource("broken: [", false);
  await exact(path, saved);
  await actionSource(saved.replace("total: price * qty", 'total: price.unavailable()'), true);
  await wait(`document.querySelector('${cell(a, "formula.total")}').textContent==="#ERROR"&&!document.querySelector('${root()} [data-bases-issues]').hidden`, "unsupported formula reports a visible cell/query error");
  await actionSource(saved, true); await complete();
  await choose(root() + " [data-bases-select]", "Gallery");
  await wait(`document.querySelector('${root()} [data-bases-error]').textContent.includes("retained but not implemented")`, "unsupported view stays explicit");
  await exact(path, saved);
  await choose(root() + " [data-bases-select]", "Active"); await complete();
  await click(action("source"));
  await fill(field("[data-bases-source]"), saved.replace(/^\ufeff/, "") + "# Draft text must remain in this dialog\r\n");
  saved += "# External base edit\r\n"; await writeFile(join(directory, path), saved); await refreshFiles();
  await wait(`${view()}.getViewData().includes("External base edit")`, "clean base reloads an actual external change");
  assert.equal(await evaluate(`document.querySelector('${dialog} [data-bases-source]').value.includes("Draft text must remain")`), true);
  await click(field('[data-bases-action="apply-source"]'));
  await wait(`document.querySelector('${dialog} [data-bases-dialog-error]').textContent.includes("changed")`, "source draft cannot replace a newer base");
  await exact(path, saved); await click(field('[data-bases-action="cancel-source"]'));
  pass("Sorting/grouping and validated source edits persist with unknown YAML intact; search works, unsupported formulas/views are explicit, and external config changes retain the open draft without stale writes.");

  await choose(root() + " [data-bases-select]", "All"); await complete();
  await evaluate(`(async()=>{const leaf=${leaf()};await leaf.setViewState({...leaf.getViewState(),state:{...leaf.view.getState(),future:{retained:[true,42]}}});await app.workspace.flushLayout()})()`);
  await restartAndRestore(); await reveal();
  assert.equal(await evaluate(`${view()}.getState().view`), "All");
  assert.deepEqual(await evaluate(`${view()}.getState().future`), { retained: [true, 42] });
  await capture?.();
  await toggle(false);
  assert.equal(await evaluate(`${view()}.getViewType()`), "unavailable");
  assert.equal(await evaluate('app.commands.listCommands().some(command=>command.id==="bases:new-file")'), false);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-core-ribbon=bases]"))'), false);
  await restartAndRestore(); assert.equal(await evaluate('app.core.isEnabled("bases")'), false);
  await toggle(true); await reveal();
  assert.equal(await evaluate(`${view()}.getState().view`), "All");
  await click('[data-core-ribbon="bases"]');
  await wait('app.workspace.activeLeaf.view.getViewType()==="bases"&&app.workspace.activeLeaf.view.file?.path.startsWith("Untitled")&&document.querySelector(".workspace-leaf:not([hidden]) [data-bases-status]")?.textContent.includes("rows")', "Create new base command opens a real .base file");
  const created = await evaluate("app.workspace.activeLeaf.view.file.path");
  assert.ok((await readFile(join(directory, created), "utf8")).includes("type: table"));
  await exact(path, saved); await exact(a, aText); assert.equal(await readFile(ownSettings, "utf8"), settings);
  if (originalWorkspace) { assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace); }
  pass("Selected view and opaque leaf state survive host restarts; disable/re-enable removes/restores owned views, extension/command/ribbon, and Create new base writes a real file while original configuration survives.");
  if (report.coreChecks) {
    for (const id of ["bases:view", "bases:edit-roundtrip", "bases:settings"]) {
      assert.ok(!report.coreChecks.some(check => check.id === id), "Duplicate Bases observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  }

  async function actionSource(text, success) {
    await click(action("source")); await fill(field("[data-bases-source]"), text.replace(/^\ufeff/, "")); await click(field('[data-bases-action="apply-source"]'));
    if (success) { await wait(`!document.querySelector('${dialog}')`, "validated base source saved"); await clean(); }
    else { await wait(`document.querySelector('${dialog} [data-bases-dialog-error]').textContent.length>0`, "invalid source rejected visibly"); await click(field('[data-bases-action="cancel-source"]')); }
  }
}
