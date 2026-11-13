import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const row = key => `[data-editor-settings] [data-setting-key="${key}"]`;
const toggle = key => row(key) + ' [role="switch"]';
const number = row("tabSize") + ' input[type="number"]';
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
const encode = data => Buffer.from("\ufeff" + JSON.stringify(data, null, 2).replaceAll("\n", "\r\n") + "\r\n");
async function openSettings({ evaluate, click, wait }) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) await click("#open-settings");
  await click("#editor-settings-tab");
  await wait(`Boolean(document.querySelector(${q(toggle("showLineNumber"))}))`, "visible Editor text preferences");
}
async function closeSettings({ evaluate, click, wait }) {
  if (await evaluate('document.querySelector("#settings-dialog").open')) await click(".settings-close");
  await wait('!document.querySelector("#settings-dialog").open', "Editor settings closed");
}
async function choose(tools, key, value) {
  const { evaluate, click, wait } = tools;
  if (await evaluate(`document.querySelector(${q(toggle(key))}).getAttribute("aria-checked")==="true"`) !== value) await click(toggle(key));
  await wait(`app.configuration.get("app",${q(key)})===${value}`, "versioned " + key + " saved");
}
async function key(tools, value, code, id, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await tools.command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode: id, modifiers });
}
async function chooseSize(tools, value) {
  await tools.click(number); await key(tools, "a", "KeyA", 65, 2);
  await tools.command("Input.insertText", { text: String(value) });
  await key(tools, "Tab", "Tab", 9);
  await tools.wait(`app.configuration.get("app","tabSize")===${value}`, "integer indentation width saved from the real numeric control");
}
const attributes = () => `(e=>({numbers:e.cm.dom.dataset.editorLineNumbers,wrap:e.cm.dom.dataset.editorLineWrap,width:e.cm.dom.dataset.editorReadableWidth,tabs:e.cm.dom.dataset.editorUseTabs,size:e.cm.state.tabSize}))(app.editor)`;

/** Real Editor controls, shared open views, layout/history retention and exact persisted note/configuration data. */
export async function checkEditorPreferences(tools) {
  const { directory, evaluate, command, wait, report, capture, restart, afterReload } = tools;
  const folder = "Editor preferences", path = folder + "/Preferences.md", configPath = join(directory, ".obsidian", "app.json");
  const original = "# Preferences λ\r\n\r\nKeep existing indentation and Unicode λ.\r\n" + "A long readable source line with words and tabs\t".repeat(45) + "\r\n";
  const bytes = Buffer.from("\ufeff" + original);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  const originalConfig = await readFile(configPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const config = originalConfig ? JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, "")) : {};
  const fixture = { ...config, spellcheck: true, showLineNumber: true, lineWrap: true, readableLineLength: true, tabSize: 4, useTab: false, __textPreferenceOpaque: { keep: ["中文", 42, true] } };
  await mkdir(join(directory, folder), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" });
  try {
    await writeFile(configPath, encode(fixture));
    await evaluate(`(async()=>{await app.configuration.read("app");await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(2,0);app.editor.focus()})()`);
    await wait('app.editor.cm.dom.dataset.editorLineNumbers==="true"&&Boolean(app.editor.cm.dom.querySelector(".cm-lineNumbers"))', "source line numbers use the accepted preference");
    await command("Input.insertText", { text: "Typed " });
    await evaluate('app.editor.undo();app.editor.setSelection({line:2,ch:0},{line:2,ch:4});globalThis.textPreferenceRetained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection};true');
    await openSettings(tools);
    for (const name of ["showLineNumber", "lineWrap", "readableLineLength"]) await choose(tools, name, false);
    await chooseSize(tools, 2);
    await wait('app.editor.cm.dom.dataset.editorLineNumbers==="false"&&!app.editor.cm.dom.querySelector(".cm-lineNumbers")&&!app.editor.cm.contentDOM.classList.contains("cm-lineWrapping")&&app.editor.cm.state.tabSize===2', "display and tab preferences reach the existing real editor");
    assert.equal(await evaluate('getComputedStyle(app.editor.cm.contentDOM).maxWidth'), "none");
    assert.equal(await evaluate('app.editor===textPreferenceRetained.editor&&app.editor.cm===textPreferenceRetained.cm&&app.editor.cm.state.doc===textPreferenceRetained.doc&&app.editor.cm.state.selection.eq(textPreferenceRetained.selection)'), true);
    await capture?.("editor-preferences"); await closeSettings(tools);
    assert.equal(await evaluate('getComputedStyle(app.editor.cm.contentDOM).whiteSpace'), "pre");
    assert.equal(await evaluate('app.editor.cm.contentDOM.scrollWidth>app.editor.cm.dom.clientWidth'), true, "the actual unwrapped line can exceed its editor viewport");
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), original.replace("Keep existing", "Typed Keep existing"));
    await evaluate("app.editor.undo();app.editor.setCursor(2,0);app.editor.exec('indentMore')");
    assert.equal(await evaluate("app.editor.getValue()"), original.replace("Keep existing", "  Keep existing"));
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    assert.deepEqual(await readFile(join(directory, path)), bytes);
    pass(report, "Visible Editor controls remove line numbers, disable wrapping/readable width and save an integer space width on the same CodeMirror instance; document, selection and prior Undo/Redo survive, actual long lines overflow horizontally, and exact BOM/CRLF note bytes remain intact.");

    await evaluate(`(async()=>{globalThis.textPreferenceFirst=app.workspace.activeLeaf.view;const leaf=app.workspace.getLeaf("split");await leaf.openFile(app.vault.getFileByPath(${q(path)}));leaf.view.setEditingMode("live-preview");app.workspace.setActiveLeaf(leaf,{focus:true})})()`);
    await openSettings(tools);
    for (const name of ["showLineNumber", "lineWrap", "readableLineLength", "useTab"]) await choose(tools, name, true);
    await chooseSize(tools, 8); await closeSettings(tools);
    await wait(`app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).length===2&&app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).every(leaf=>leaf.view.editor.cm.dom.dataset.editorLineNumbers==="true"&&leaf.view.editor.cm.state.tabSize===8&&leaf.view.editor.cm.contentDOM.classList.contains("cm-lineWrapping"))`, "shared Source and Live Preview editors adopt the accepted controls");
    assert.equal(await evaluate('Boolean(app.editor.cm.dom.querySelector(".cm-lineNumbers"))&&getComputedStyle(app.editor.cm.dom.querySelector(".cm-lineNumbers")).display!=="none"&&getComputedStyle(app.editor.cm.dom.querySelector(".cm-gutters")).display!=="none"'), true, "line numbers are actually visible in Live Preview");
    assert.notEqual(await evaluate('getComputedStyle(app.editor.cm.contentDOM).maxWidth'), "none");
    await evaluate("app.editor.setCursor(2,0);app.editor.exec('indentMore')");
    assert.equal(await evaluate("app.editor.getValue()"), original.replace("Keep existing", "\tKeep existing"));
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate("app.editor.setMutationLock(true);app.editor.exec('indentMore')"); assert.equal(await evaluate("app.editor.getValue()"), original);
    await evaluate("app.editor.setMutationLock(false);app.saveAll()"); assert.deepEqual(await readFile(join(directory, path)), bytes);
    assert.deepEqual(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).__textPreferenceOpaque, fixture.__textPreferenceOpaque);
    pass(report, "Source and Live Preview panes, including a newly created editor, adopt shared line-number/wrapping/width/tab preferences; the actual Live Preview gutter is visible, new indentation uses a tab, Undo preserves existing text and mutation barriers refuse edits.");

    await writeFile(configPath, encode({ ...fixture, lineWrap: false, showLineNumber: false, tabSize: 6, useTab: true }));
    await wait('app.editor.cm.dom.dataset.editorLineWrap==="false"&&app.editor.cm.dom.dataset.editorLineNumbers==="false"&&app.editor.cm.state.tabSize===6', "external app.json changes reach open source editors");
    await writeFile(configPath, encode({ ...fixture, lineWrap: "false", showLineNumber: null, tabSize: "8", useTab: "true" }));
    await evaluate('app.configuration.refresh("app")');
    await wait('app.editor.cm.dom.dataset.editorLineWrap==="true"&&app.editor.cm.dom.dataset.editorLineNumbers==="false"&&app.editor.cm.state.tabSize===4&&app.editor.cm.dom.dataset.editorUseTabs==="false"', "malformed imported settings use bounded defaults");
    await openSettings(tools);
    assert.equal(await evaluate('document.querySelector("[data-editor-settings]").textContent.includes("saved value is invalid; the default is used")'), true);
    await choose(tools, "lineWrap", false); await choose(tools, "showLineNumber", true); await choose(tools, "showLineNumber", false); await choose(tools, "readableLineLength", false); await choose(tools, "useTab", true); await chooseSize(tools, 6);
    await closeSettings(tools); await evaluate("app.workspace.flushLayout()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&!app.changingVault&&app.editor.cm.state.tabSize===6`, "note and text preferences restored after restart/reconnection");
    assert.deepEqual(await evaluate(attributes()), { numbers: "false", wrap: "false", width: "false", tabs: "true", size: 6 });
    assert.equal(await evaluate("app.editor.getValue()"), original); assert.deepEqual(await readFile(join(directory, path)), bytes);
    await openSettings(tools); assert.equal(await evaluate(`document.querySelector(${q(number)}).value`), "6"); await closeSettings(tools);
    pass(report, "External and malformed Editor settings are adopted without rewriting imported data; visible corrections persist through full restart/browser reconnection with split panes, exact source bytes, unrelated app.json data and matching numeric/toggle controls.");
    report.editorPreferences = { sourceAndLivePreview: true, retainedEditorHistory: true, visibleLineNumberGutter: true, indentationAndMutationBarrier: true, externalMalformedDefaults: true, restart: true };
  } finally {
    await closeSettings(tools);
    await evaluate('delete globalThis.textPreferenceRetained;delete globalThis.textPreferenceFirst;app.editor.setMutationLock(false);app.saveAll()');
    if (originalConfig) await writeFile(configPath, originalConfig); else await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await evaluate(`(async()=>{await app.configuration.read("app");await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent owns the actual cache-only mount and audits every blob/network counter through local return. */
export async function checkEditorPreferencesReadOnly(tools) {
  const { evaluate, report, command, wait } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const before = await evaluate("app.editor.getValue()"), data = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  await openSettings(tools);
  for (const key of ["showLineNumber", "lineWrap", "readableLineLength"]) await choose(tools, key, false);
  await choose(tools, "useTab", true); await chooseSize(tools, 8); await closeSettings(tools);
  await wait('app.editor.cm.dom.dataset.editorLineNumbers==="false"&&app.editor.cm.dom.dataset.editorLineWrap==="false"&&app.editor.cm.state.tabSize===8', "read-only source editor adopts its local preference overlay");
  await evaluate("app.editor.focus();app.editor.exec('indentMore')"); await command("Input.insertText", { text: "Blocked preference mutation" });
  assert.equal(await evaluate("app.editor.getValue()"), before);
  const after = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  assert.deepEqual({ ...after, showLineNumber: data.showLineNumber, lineWrap: data.lineWrap, readableLineLength: data.readableLineLength, useTab: data.useTab, tabSize: data.tabSize }, data);
  report.editorPreferences = { ...(report.editorPreferences ?? {}), readOnlyOverlay: true, readOnlyMutationsRefused: true };
  pass(report, "A genuine cache-only read-only note adopts Editor text preferences only through its local settings overlay; actual input and indentation remain refused and unrelated settings plus exact note text stay intact.");
}

