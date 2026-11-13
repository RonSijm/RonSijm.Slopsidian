import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

const q = JSON.stringify;
const control = key => `[data-editor-settings] [data-setting-key=${q(key)}]`;
const toggle = key => control(key) + ' [role="switch"]';
const attribute = key => key === "autoPairBrackets" ? "editorAutoPairs" : "editorSmartLists";
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function openSettings({ evaluate, click, wait }) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) await click("#open-settings");
  await click("#editor-settings-tab"); await wait(`Boolean(document.querySelector(${q(toggle("autoPairBrackets"))}))`, "real automatic bracket/Markdown continuation controls");
}
async function closeSettings({ evaluate, click, wait }) {
  if (await evaluate('document.querySelector("#settings-dialog").open')) await click(".settings-close");
  await wait('!document.querySelector("#settings-dialog").open', "typing settings closed");
}
async function choose({ evaluate, click, wait }, key, value) {
  const checked = await evaluate(`document.querySelector(${q(toggle(key))}).getAttribute("aria-checked")==="true"`), stored = await evaluate(`app.configuration.get("app",${q(key)})??null`);
  if (checked === value && stored !== value) {
    await click(toggle(key)); await wait(`app.configuration.get("app",${q(key)})===${!value}`, "explicit choice replaces an imported/default typing value"); await click(toggle(key));
  } else if (checked !== value) await click(toggle(key));
  await wait(`app.configuration.get("app",${q(key)})===${value}&&app.editor.cm.dom.dataset.${attribute(key)}===${q(String(value))}`, "accepted " + key + " reaches the current editor");
}
async function flags(tools, pairs, lists) {
  await openSettings(tools); await choose(tools, "autoPairBrackets", pairs); await choose(tools, "smartIndentList", lists); await closeSettings(tools);
}
async function position(tools, line, ch = 0) {
  await tools.evaluate(`(()=>{app.editor.exec("unfoldAll");app.editor.setCursor(${line},${ch});app.editor.scrollIntoView({from:{line:${line},ch:${ch}},to:{line:${line},ch:${ch}}},true);app.editor.focus()})()`);
}
async function reset(tools, path, text) {
  await tools.evaluate(`(async()=>{const editor=app.editor;if(editor.getValue()!==${q(text)})editor.replaceExpected(editor.getValue(),0,editor.getValue().length,${q(text)},"input.typing-fixture-reset");editor.exec("unfoldAll");await app.saveAll()})()`);
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + text));
}
async function exact(tools, path, text) {
  assert.equal(await tools.evaluate("app.editor.getValue()"), text); assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + text));
}

/** Actual CodeMirror typing and Editor controls, shared by native and actual-folder WASM hosts. */
export async function checkTypingControls(tools) {
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const path = "Typing controls/Controls.md", text = '---\r\nstatus: Open\r\nopaque: "Keep typing λ"\r\n---\r\n# Typing controls\r\n\r\nBody λ 😀.\r\n\r\nPair field: \r\n\r\n- Item λ\r\n\r\n> Quote λ\r\n\r\n1. Ordered\r\n2. Following\r\n\r\n- [x] Task\r\n\r\n- Parent\r\n  - Child\r\n\r\n```md\r\n- literal\r\n```\r\n';
  const lines = text.split("\r\n"), at = value => lines.indexOf(value), pairLine = at("Pair field: "), pairCh = "Pair field: ".length, itemLine = at("- Item λ"), bodyLine = at("Body λ 😀.");
  const original = Buffer.from("\ufeff" + text), configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath), config = JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, ""));
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  const fixture = { ...config, markdownAutosave: false, autoPairBrackets: true, smartIndentList: true, tabSize: 4, useTab: false, __typingOpaque: { keep: ["中文", 42, true] } };
  await mkdir(join(directory, "Typing controls"), { recursive: true }); await writeFile(join(directory, path), original, { flag: "wx" });
  try {
    await writeFile(configPath, encode(fixture)); await evaluate(`(async()=>{await app.configuration.read("app");await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source")})()`);
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)})`); await flags(tools, true, true); await reset(tools, path, text);
      await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "(" });
      const pairText = text.replace("Pair field: ", "Pair field: ()"); assert.equal(await evaluate("app.editor.getValue()"), pairText);
      await command("Input.insertText", { text: ")" }); assert.equal(await evaluate("app.editor.getValue()"), pairText); assert.deepEqual(await evaluate("app.editor.getCursor()"), { line: pairLine, ch: pairCh + 2 });
      await position(tools, itemLine, "- Item λ".length); await press("Enter", "Enter", 13);
      const combined = pairText.replace("- Item λ", "- Item λ\r\n- "); assert.equal(await evaluate("app.editor.getValue()"), combined); await capture?.("typing-controls-" + mode);
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), pairText);
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
      await evaluate("app.editor.redo();app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), combined);
      await evaluate("app.editor.undo();app.editor.undo();app.saveAll()"); await exact(tools, path, text);

      await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "[" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: []"));
      await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text);
      await position(tools, pairLine, pairCh); await command("Input.insertText", { text: '"' }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", 'Pair field: ""'));
      await command("Input.insertText", { text: '"' }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", 'Pair field: ""')); await reset(tools, path, text);
      // The task and following Parent item form a loose list; installed Markdown
      // Enter preserves its blank separator while resetting the new checkbox.
      for (const [lineText, expected] of [["> Quote λ", text.replace("> Quote λ", "> Quote λ\r\n> ")], ["1. Ordered", text.replace("1. Ordered\r\n2. Following", "1. Ordered\r\n2. \r\n3. Following")], ["- [x] Task", text.replace("- [x] Task", "- [x] Task\r\n\r\n- [ ] ")], ["  - Child", text.replace("  - Child", "  - Child\r\n  - ")], ["- literal", text.replace("- literal", "- literal\r\n")]]) {
        await reset(tools, path, text); await position(tools, at(lineText), lineText.length); await press("Enter", "Enter", 13); assert.equal(await evaluate("app.editor.getValue()"), expected);
      }
      await reset(tools, path, text); await position(tools, bodyLine, 0); await command("Input.insertText", { text: "Kept " }); await evaluate("app.editor.undo()");
      await evaluate("(()=>{globalThis.typingRetained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection}})()");
      await flags(tools, false, false);
      assert.equal(await evaluate("app.editor===typingRetained.editor&&app.editor.cm===typingRetained.cm&&app.editor.cm.state.doc===typingRetained.doc&&app.editor.cm.state.selection.eq(typingRetained.selection)"), true);
      await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Body λ", "Kept Body λ")); await evaluate("app.editor.undo()");
      await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "(" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: ("));
      await command("Input.insertText", { text: ")" }); await position(tools, pairLine, pairCh + 1); await command("Input.insertText", { text: ")" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: ())"));
      await position(tools, pairLine, pairCh + 1); await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: ))"));
      for (const lineText of ["- Item λ", "> Quote λ"]) {
        await reset(tools, path, text); await position(tools, at(lineText), lineText.length); await press("Enter", "Enter", 13); assert.equal(await evaluate("app.editor.getValue()"), text.replace(lineText, lineText + "\r\n"));
      }
      await reset(tools, path, text); await exact(tools, path, text);
      pass(report, `${mode}: actual typing pairs and overtypes generated brackets, Backspace deletes an empty pair, and Enter continues bullet/ordered/task/nested/quote markers while code stays literal. Turning both controls off gives ordinary insertion/deletion/newlines; reconfiguration keeps the same editor/document/selection and prior Undo/Redo, with exact BOM/CRLF source restored.`);
    }

    await flags(tools, true, false); await evaluate(`(async()=>{const leaf=app.workspace.getLeaf("split");await leaf.openFile(app.vault.getFileByPath(${q(path)}));leaf.view.setEditingMode("source");app.workspace.setActiveLeaf(leaf,{focus:true})})()`);
    await wait(`app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).length===2&&app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).every(leaf=>leaf.view.editor.cm.dom.dataset.editorAutoPairs==="true"&&leaf.view.editor.cm.dom.dataset.editorSmartLists==="false")`, "shared/new Source and Live Preview panes adopt independent typing controls");
    await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "{" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: {}"));
    await reset(tools, path, text); await position(tools, itemLine, "- Item λ".length); await press("Enter", "Enter", 13); assert.equal(await evaluate("app.editor.getValue()"), text.replace("- Item λ", "- Item λ\r\n")); await reset(tools, path, text);
    await flags(tools, false, true); await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "{" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: {"));
    await reset(tools, path, text); await position(tools, itemLine, "- Item λ".length); await press("Enter", "Enter", 13); assert.equal(await evaluate("app.editor.getValue()"), text.replace("- Item λ", "- Item λ\r\n- ")); await reset(tools, path, text);
    pass(report, "Existing Live Preview and a new Source pane share independent controls: bracket pairs can stay enabled while list continuation is off, and continuation can stay enabled while bracket typing is ordinary. Exact source and unrelated configuration survive both combinations.");

    await openSettings(tools); const style = await evaluate('(()=>{const root=document.querySelector("[data-editor-settings]"),style=root.getAttribute("style");root.style.maxWidth="320px";return style})()');
    try {
      await evaluate(`document.querySelector(${q(control("autoPairBrackets"))}).scrollIntoView({block:"start"})`);
      const geometry = await evaluate('(()=>{const root=document.querySelector("[data-editor-settings]"),outer=root.getBoundingClientRect();return{width:outer.width,rows:["autoPairBrackets","smartIndentList"].map(key=>{const row=root.querySelector(`[data-setting-key="${key}"]`),box=row.getBoundingClientRect(),toggle=row.querySelector("[role=switch]").getBoundingClientRect();return{label:row.querySelector(".setting-item-name").textContent,inside:box.left>=outer.left-1&&box.right<=outer.right+1&&toggle.left>=box.left&&toggle.right<=box.right+1,height:box.height}})}})()');
      assert.ok(geometry.width <= 321 && geometry.rows.every(row => row.inside && row.height > 0)); assert.deepEqual(geometry.rows.map(row => row.label), ["Automatic bracket pairs", "Continue lists and quotes"]); await capture?.("typing-controls-narrow");
    } finally { await evaluate(`(()=>{const root=document.querySelector("[data-editor-settings]");if(${q(style)}===null)root.removeAttribute("style");else root.setAttribute("style",${q(style)})})()`); }
    await closeSettings(tools); pass(report, "The real Editor page labels automatic bracket pairs and Enter continuation explicitly; both switches and wrapped descriptions fit a320px column without overlap.");

    await writeFile(configPath, encode({ ...fixture, autoPairBrackets: null, smartIndentList: "false" })); await evaluate('app.configuration.refresh("app")');
    await wait('app.editor.cm.dom.dataset.editorAutoPairs==="true"&&app.editor.cm.dom.dataset.editorSmartLists==="true"', "malformed imported typing controls use true defaults");
    await openSettings(tools);
    for (const key of ["autoPairBrackets", "smartIndentList"]) assert.equal(await evaluate(`document.querySelector(${q(control(key))}).textContent.includes("saved value is invalid; the default is used")`), true);
    assert.equal(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).smartIndentList, "false");
    await choose(tools, "autoPairBrackets", false); await choose(tools, "autoPairBrackets", true); await choose(tools, "smartIndentList", false); await choose(tools, "smartIndentList", true);
    assert.equal(await evaluate(`(()=>{const field=document.querySelector(${q(toggle("autoPairBrackets"))});field.focus();return document.activeElement===field})()`), true);
    const saved = JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")), external = encode({ ...saved, autoPairBrackets: false, smartIndentList: false, __typingExternal: { newer: true } });
    await writeFile(configPath, external); await wait('app.vault.getConfig("autoPairBrackets")===false&&app.vault.getConfig("smartIndentList")===false', "global cache adopts external typing controls while the focused page keeps its old baseline");
    assert.equal(await evaluate(`document.querySelector(${q(toggle("autoPairBrackets"))}).getAttribute("aria-checked")`), "true");
    const conflict = "The configuration changed on disk. Reload it before saving; the existing file was retained.", message = await evaluate('document.body.classList.contains("is-browser")') ? "Host 409: " + conflict : "Host 409: " + JSON.stringify({ error: conflict });
    await expectErrors({ evaluate, report }, [{ source: "notification", message }], async () => {
      await click(toggle("autoPairBrackets")); await wait(`document.querySelector(${q(control("autoPairBrackets") + ' [role="alert"]')})?.textContent.includes("changed on disk")`, "stale focused typing control refuses external config version");
    }, "Retain external typing preferences instead of rebasing a focused old switch");
    assert.deepEqual(await readFile(configPath), external); await click('[data-editor-settings] [role="button"]');
    await wait(`document.querySelector(${q(toggle("autoPairBrackets"))}).getAttribute("aria-checked")==="false"&&document.querySelector(${q(control("autoPairBrackets") + ' [role="alert"]')})?.hidden===true`, "explicit Reload rebases typing controls");
    await choose(tools, "smartIndentList", true); await choose(tools, "smartIndentList", false); await closeSettings(tools);
    assert.deepEqual(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).__typingExternal, { newer: true }); await exact(tools, path, text);
    pass(report, "External malformed typing controls fall back visibly without rewriting raw imports. A focused real switch refuses a newer app.json version with an audited409, preserves every external byte and only accepts a fresh guarded write after explicit Reload.");

    await evaluate("app.workspace.flushLayout()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.editor.cm.dom.dataset.editorAutoPairs==="false"&&app.editor.cm.dom.dataset.editorSmartLists==="false"`, "native restart or actual-folder reconnection restores typing preferences");
    assert.deepEqual(await evaluate('app.vault.getConfig("__typingOpaque")'), fixture.__typingOpaque); assert.deepEqual(await evaluate('app.vault.getConfig("__typingExternal")'), { newer: true });
    await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "(" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: ("));
    await reset(tools, path, text); await position(tools, itemLine, "- Item λ".length); await press("Enter", "Enter", 13); assert.equal(await evaluate("app.editor.getValue()"), text.replace("- Item λ", "- Item λ\r\n")); await reset(tools, path, text);
    report.typingControls = { sourceAndLivePreview: true, actualPairsAndQuotes: true, generatedCloserOvertype: true, enabledEmptyPairBackspace: true, disabledLiteralInputAndDeletion: true, listQuoteOrderedTaskNestedEnter: true, literalCodeEnter: true, disabledOrdinaryNewline: true, independentSettings: true, existingAndNewPanes: true, sameEditorDocumentSelection: true, dirtyUndoRedoExactBomCrLf: true, narrow320: true, malformedImportsUnchanged: true, staleConfigRefusal: true, explicitReload: true, restart: true };
    pass(report, "Full native restart or actual-folder browser reconnection restores both typing preferences, shared panes and unknown configuration. Fresh actual bracket/Enter input obeys the saved disabled controls and exact original note bytes are restored.");
  } catch (error) {
    try { report.typingControlsFailure = await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode(),source:app.editor.getValue(),cursor:app.editor.getCursor(),pairs:app.editor.cm.dom.dataset.editorAutoPairs,lists:app.editor.cm.dom.dataset.editorSmartLists,focus:document.activeElement?.outerHTML.slice(0,500),settings:document.querySelector("[data-editor-settings]")?.textContent.slice(0,5000)}))()'); await capture?.("typing-controls-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    await closeSettings(tools); await evaluate("delete globalThis.typingRetained");
    if (await evaluate(`app.workspace.getActiveFile()?.path===${q(path)}`)) await reset(tools, path, text);
    await writeFile(configPath, originalConfig); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent audits actual cached repository blobs and zero GitHub API/raw traffic through local return. */
export async function checkTypingControlsReadOnly(tools) {
  const { evaluate, command, press, report, capture } = tools; assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("source")})()');
  const text = await evaluate("app.editor.getValue()"), before = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  await flags(tools, false, false); await evaluate('app.editor.exec("unfoldAll");app.editor.setCursor(0,0);app.editor.focus()');
  await command("Input.insertText", { text: "(" }); await press("Enter", "Enter", 13); await press("Backspace", "Backspace", 8); await evaluate('app.editor.exec("newlineAndIndent")');
  assert.equal(await evaluate("app.editor.getValue()"), text); const after = await evaluate('(async()=>(await app.configuration.read("app")).data)()'), unrelated = ({ autoPairBrackets, smartIndentList, ...rest }) => rest;
  assert.deepEqual(unrelated(after), unrelated(before)); assert.equal(after.autoPairBrackets, false); assert.equal(after.smartIndentList, false); await capture?.("typing-controls-readonly");
  report.typingControls = { ...(report.typingControls ?? {}), cachedReadOnlyLocalOverlay: true, readOnlyTypingAndCommandsRefused: true };
  pass(report, "A genuine cached read-only note saves typing choices only in the local overlay. Actual bracket input/Enter/Backspace and direct newline commands refuse note changes; exact source and unrelated settings remain intact while the parent audits every blob and zero API/raw requests.");
}
