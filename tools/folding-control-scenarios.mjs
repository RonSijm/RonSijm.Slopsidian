import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";

const q = JSON.stringify, current = "[data-folding-controls-current]";
const control = key => `[data-editor-settings] [data-setting-key=${q(key)}]`;
const toggle = key => control(key) + ' [role="switch"]';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
async function openSettings({ evaluate, click, wait }) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) await click("#open-settings");
  await click("#editor-settings-tab");
  await wait(`Boolean(document.querySelector(${q(toggle("foldHeading"))}))`, "real heading/list folding settings");
}
async function closeSettings({ evaluate, click, wait }) {
  if (await evaluate('document.querySelector("#settings-dialog").open')) await click(".settings-close");
  await wait('!document.querySelector("#settings-dialog").open', "folding settings closed");
}
async function choose({ evaluate, click, wait }, key, value) {
  const checked = await evaluate(`document.querySelector(${q(toggle(key))}).getAttribute("aria-checked")==="true"`), stored = await evaluate(`app.configuration.get("app",${q(key)})??null`);
  if (checked === value && stored !== value) {
    await click(toggle(key)); await wait(`app.configuration.get("app",${q(key)})===${!value}`, "an explicit choice replaces an imported/default folding value");
    await click(toggle(key));
  } else if (checked !== value) await click(toggle(key));
  await wait(`app.configuration.get("app",${q(key)})===${value}&&app.editor.cm.dom.dataset.${key === "foldHeading" ? "editorFoldHeadings" : "editorFoldLists"}===${q(String(value))}`, "accepted " + key + " preference reaches the real editor");
}
async function flags(tools, heading, list) {
  await openSettings(tools); await choose(tools, "foldHeading", heading); await choose(tools, "foldIndent", list); await closeSettings(tools);
}
async function sourceLine(tools, line) {
  await tools.evaluate(`(()=>{app.editor.setCursor(${line},0);app.editor.scrollIntoView({from:{line:${line},ch:0},to:{line:${line},ch:0}},true);app.editor.cm.requestMeasure()})()`);
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
}
async function marker(tools, line, open) {
  const selector = current + ` [data-editor-fold-line=${q(String(line + 1))}][data-editor-fold-open=${q(String(open))}]`;
  await tools.wait(`(()=>{const marker=document.querySelector(${q(selector)});return !!marker&&marker.checkVisibility()})()`, "visible actual fold gutter marker");
  return selector;
}
async function noteExact(tools, path, text) {
  assert.equal(await tools.evaluate("app.editor.getValue()"), text);
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + text));
}
async function assertFolds(tools, { headingLines, listLines, codeLine }, headings, lists) {
  const folds = await tools.evaluate("app.editor.getFoldInfo().folds");
  assert.equal(folds.some(fold => headingLines.includes(fold.from)), headings);
  assert.equal(folds.some(fold => listLines.includes(fold.from)), lists);
  if (codeLine !== undefined) assert.ok(folds.some(fold => fold.from === codeLine), "independent fenced code remains folded");
  return folds;
}

/** Actual Source/LP controls and folds, with exact physical bytes and guarded configuration writes. */
export async function checkFoldingControls(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture } = tools;
  const path = "Folding controls/Controls.md";
  const text = '---\r\nstatus: Open\r\nopaque: "keep λ"\r\n---\r\n# Folding controls\r\nKeep body 😀.\r\n\r\n## Section λ\r\nHeading body.\r\n### Nested heading\r\nNested body.\r\n\r\n- Parent\r\n  - Child\r\n    - Grandchild\r\n\r\n```go\r\npackage main\r\n// # not a heading\r\nfunc note() string { return "kept λ" }\r\n```\r\n\r\n## Last section\r\nLast body.\r\n';
  const lines = text.split("\r\n"), heading = lines.indexOf("## Section λ"), list = lines.indexOf("- Parent"), code = lines.indexOf("```go"), body = lines.indexOf("Keep body 😀.");
  const positions = { headingLines: lines.flatMap((line, index) => /^#{1,6} /.test(line) ? [index] : []), listLines: [list, list + 1], codeLine: code };
  const bytes = Buffer.from("\ufeff" + text), configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath), originalOptions = JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, ""));
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), autosave = await evaluate("app.markdownAutosave.enabled");
  if (autosave) await evaluate("app.markdownAutosave.setEnabled(false)");
  const fixture = { ...originalOptions, markdownAutosave: false, foldHeading: true, foldIndent: true, __foldingOpaque: { keep: ["中文", 42] } };
  await mkdir(join(directory, "Folding controls"), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" });
  try {
    await writeFile(configPath, encode(fixture));
    await evaluate(`(async()=>{await app.configuration.read("app");await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source")})()`);
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`(()=>{app.workspace.activeLeaf.view.setEditingMode(${q(mode)});app.editor.cm.dom.dataset.foldingControlsCurrent="true";app.editor.exec("unfoldAll")})()`);
      await flags(tools, true, true); await sourceLine(tools, body); await evaluate("app.editor.focus()"); await command("Input.insertText", { text: "Typed " });
      await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
      await evaluate("(()=>{globalThis.foldingRetained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection}})()");
      await flags(tools, false, true);
      assert.equal(await evaluate("app.editor===foldingRetained.editor&&app.editor.cm===foldingRetained.cm&&app.editor.cm.state.doc===foldingRetained.doc&&app.editor.cm.state.selection.eq(foldingRetained.selection)"), true);
      await evaluate('app.editor.exec("foldAll")'); await assertFolds(tools, positions, false, true);
      await flags(tools, false, false); await assertFolds(tools, positions, false, false);
      assert.equal(await evaluate("app.editor.cm.dom.querySelectorAll('[data-editor-fold-marker=heading],[data-editor-fold-marker=list]').length===0"), true);
      await evaluate('app.editor.exec("unfoldAll")'); await flags(tools, true, true); await sourceLine(tools, heading);
      assert.notEqual(await evaluate("getComputedStyle(app.editor.cm.dom.querySelector('.cm-editor-fold-gutter')).display"), "none");
      await click(await marker(tools, heading, true)); await wait(`app.editor.getFoldInfo().folds.some(fold=>fold.from===${heading})`, "genuine heading pointer collapse");
      await capture?.("folding-controls-" + mode); await click(await marker(tools, heading, false));
      await wait(`!app.editor.getFoldInfo().folds.some(fold=>fold.from===${heading})`, "genuine heading pointer expansion");
      await sourceLine(tools, list); await click(await marker(tools, list, true));
      await wait(`app.editor.getFoldInfo().folds.some(fold=>fold.from===${list})`, "genuine nested-list pointer collapse");
      await sourceLine(tools, code); await evaluate('app.editor.exec("toggleFold")');
      await flags(tools, false, false); await assertFolds(tools, positions, false, false);
      await evaluate('app.editor.exec("unfoldAll");app.editor.redo()'); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Keep body", "Typed Keep body"));
      await evaluate("app.editor.undo();app.saveAll()"); await noteExact(tools, path, text);
      pass(report, `${mode}: real independent heading/list toggles expand only their class, omit disabled gutter markers and preserve fenced-code folds. Actual pointer fold/unfold, commands, same CodeMirror/document/selection and prior dirty Undo/Redo retain exact BOM/CRLF/Unicode source.`);
    }

    await flags(tools, true, true); await evaluate(`(async()=>{delete app.editor.cm.dom.dataset.foldingControlsCurrent;const leaf=app.workspace.getLeaf("split");await leaf.openFile(app.vault.getFileByPath(${q(path)}));leaf.view.setEditingMode("source");app.workspace.setActiveLeaf(leaf,{focus:true});app.editor.cm.dom.dataset.foldingControlsCurrent="true"})()`);
    await flags(tools, false, true);
    await wait(`app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).length===2&&app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).every(leaf=>leaf.view.editor.cm.dom.dataset.editorFoldHeadings==="false"&&leaf.view.editor.cm.dom.dataset.editorFoldLists==="true")`, "shared existing/new panes adopt the folding preferences");
    await evaluate('app.editor.focus()'); await press("[", "BracketLeft", 219, 3); await assertFolds(tools, positions, false, true);
    await evaluate('app.editor.exec("unfoldAll")'); await noteExact(tools, path, text);
    pass(report, "Existing Live Preview and a newly created Source pane share the accepted fold controls; an actual Ctrl+Alt+[ uses filtered fold-all traversal to reach list and code folds beneath disabled headings without changing source or replacing either pane.");

    await openSettings(tools);
    const oldStyle = await evaluate('(()=>{const root=document.querySelector("[data-editor-settings]"),style=root.getAttribute("style");root.style.maxWidth="320px";return style})()');
    try {
      await evaluate(`document.querySelector(${q(control("foldHeading"))}).scrollIntoView({block:"start"})`);
      const geometry = await evaluate(`(()=>{const root=document.querySelector("[data-editor-settings]"),outer=root.getBoundingClientRect();return{width:outer.width,rows:["foldHeading","foldIndent"].map(key=>{const row=root.querySelector('[data-setting-key="'+key+'"]'),box=row.getBoundingClientRect(),toggle=row.querySelector('[role="switch"]').getBoundingClientRect();return{label:row.querySelector('.setting-item-name').textContent,inside:box.left>=outer.left-1&&box.right<=outer.right+1&&toggle.left>=box.left&&toggle.right<=box.right+1,height:box.height}})}})()`);
      assert.ok(geometry.width <= 321 && geometry.rows.every(row => row.inside && row.height > 0)); assert.deepEqual(geometry.rows.map(row => row.label), ["Fold headings", "Fold lists"]); await capture?.("folding-controls-narrow");
    } finally { await evaluate(`(()=>{const root=document.querySelector("[data-editor-settings]");if(${q(oldStyle)}===null)root.removeAttribute("style");else root.setAttribute("style",${q(oldStyle)})})()`); }
    await closeSettings(tools);
    pass(report, "The real Editor page labels Fold headings/Fold lists accurately and keeps both switches and wrapped descriptions inside a320px container without overlap.");

    await writeFile(configPath, encode({ ...fixture, foldHeading: "false", foldIndent: null })); await evaluate('app.configuration.refresh("app")');
    await wait('app.editor.cm.dom.dataset.editorFoldHeadings==="true"&&app.editor.cm.dom.dataset.editorFoldLists==="true"', "malformed imported fold controls use true defaults");
    await openSettings(tools);
    assert.equal(await evaluate(`document.querySelector(${q(control("foldHeading"))}).textContent.includes("saved value is invalid; the default is used")&&document.querySelector(${q(control("foldIndent"))}).textContent.includes("saved value is invalid; the default is used")`), true);
    assert.equal(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).foldHeading, "false");
    await choose(tools, "foldHeading", false); await choose(tools, "foldHeading", true); await choose(tools, "foldIndent", false); await choose(tools, "foldIndent", true);
    assert.equal(await evaluate(`(()=>{const control=document.querySelector(${q(toggle("foldHeading"))});control.focus();return document.activeElement===control})()`), true);
    const accepted = JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")), external = encode({ ...accepted, foldHeading: false, __foldingExternal: { newer: true } });
    await writeFile(configPath, external); await wait('app.vault.getConfig("foldHeading")===false', "global settings cache adopts external fold controls while focused page keeps its baseline");
    assert.equal(await evaluate(`document.querySelector(${q(toggle("foldHeading"))}).getAttribute("aria-checked")`), "true");
    const conflict = "The configuration changed on disk. Reload it before saving; the existing file was retained.", message = await evaluate('document.body.classList.contains("is-browser")') ? "Host 409: " + conflict : "Host 409: " + JSON.stringify({ error: conflict });
    await expectErrors({ evaluate, report }, [{ source: "notification", message }], async () => {
      await click(toggle("foldHeading")); await wait(`document.querySelector(${q(control("foldHeading") + ' [role="alert"]')})?.textContent.includes("changed on disk")`, "focused folding control refuses a stale config version");
    }, "Retain external folding preferences instead of rebasing a focused old control");
    assert.deepEqual(await readFile(configPath), external); await click('[data-editor-settings] [role="button"]');
    await wait(`document.querySelector(${q(toggle("foldHeading"))}).getAttribute("aria-checked")==="false"&&document.querySelector(${q(control("foldHeading") + ' [role="alert"]')})?.hidden===true`, "explicit Reload rebases folding controls");
    await choose(tools, "foldIndent", false); await choose(tools, "foldIndent", true);
    assert.deepEqual(JSON.parse((await readFile(configPath,"utf8")).replace(/^\ufeff/,"")).__foldingExternal, { newer: true });
    await closeSettings(tools); await noteExact(tools, path, text);
    pass(report, "External malformed folding preferences use visible Boolean defaults without rewriting imported values. A focused real switch keeps its prior baseline, refuses the newer disk version with an audited409 and leaves every external byte intact until explicit Reload.");

    await evaluate('app.editor.exec("unfoldAll");app.workspace.flushLayout()'); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.editor.cm.dom.dataset.editorFoldHeadings==="false"&&app.editor.cm.dom.dataset.editorFoldLists==="true"`, "full restart restores independent fold controls");
    assert.deepEqual(await evaluate('app.vault.getConfig("__foldingOpaque")'), fixture.__foldingOpaque); assert.deepEqual(await evaluate('app.vault.getConfig("__foldingExternal")'), { newer: true });
    await evaluate('app.editor.exec("foldAll")'); await assertFolds(tools, positions, false, true); await evaluate('app.editor.exec("unfoldAll")'); await noteExact(tools, path, text);
    report.foldingControls = { sourceAndLivePreview: true, independentHeadingAndListToggles: true, immediateDisabledExpansion: true, visiblePointerGutter: true, filteredKeyboardFoldAll: true, codeAndOpaqueFoldsIndependent: true, sameEditorDocumentSelection: true, dirtyUndoRedoExactBytes: true, existingAndNewPanes: true, narrow320: true, malformedImportsUnchanged: true, staleConfigRefusal: true, explicitReload: true, restart: true };
    pass(report, "Full native restart or actual-folder browser reconnection restores the two fold controls, both panes and unrelated configuration. Fresh fold-all still skips headings and reaches nested lists/code; exact note bytes survive.");
  } catch (error) {
    try { report.foldingControlsFailure = await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode(),folds:app.editor.getFoldInfo(),headings:app.editor.cm.dom.dataset.editorFoldHeadings,lists:app.editor.cm.dom.dataset.editorFoldLists,source:app.editor.getValue(),markers:[...app.editor.cm.dom.querySelectorAll("[data-editor-fold-marker]")].map(node=>({kind:node.dataset.editorFoldMarker,line:node.dataset.editorFoldLine,open:node.dataset.editorFoldOpen,visible:node.checkVisibility()})),settings:document.querySelector("[data-editor-settings]")?.textContent.slice(0,5000)}))()'); await capture?.("folding-controls-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    await closeSettings(tools); await evaluate('(()=>{delete globalThis.foldingRetained;delete app.editor.cm.dom.dataset.foldingControlsCurrent;app.editor.exec("unfoldAll")})()');
    await writeFile(configPath, originalConfig); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent audits the genuine cached GitHub blobs and zero API/raw counters through local return. */
export async function checkFoldingControlsReadOnly(tools) {
  const { evaluate, command, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("source")})()');
  const text = await evaluate("app.editor.getValue()"), before = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  const lines = text.split(/\r?\n/), headingLines = lines.flatMap((line, index) => /^#{1,6} /.test(line) ? [index] : []), listLines = lines.flatMap((line, index) => /^\s*- /.test(line) ? [index] : []), codeLine = lines.findIndex(line => line === "```go");
  assert.ok(headingLines.length >= 2 && listLines.length >= 2 && codeLine >= 0, "cached fixture includes independent headings, nested lists and code");
  await flags(tools, false, true); await evaluate('app.editor.exec("foldAll")');
  await assertFolds(tools, { headingLines, listLines, codeLine }, false, true); await capture?.("folding-controls-readonly");
  await evaluate('app.editor.exec("unfoldAll");app.editor.focus();app.editor.exec("indentMore")'); await command("Input.insertText", { text: "Blocked folding fixture edit" });
  assert.equal(await evaluate("app.editor.getValue()"), text);
  const after = await evaluate('(async()=>(await app.configuration.read("app")).data)()'), unrelated = ({ foldHeading, foldIndent, ...rest }) => rest;
  assert.deepEqual(unrelated(after), unrelated(before)); assert.equal(after.foldHeading,false); assert.equal(after.foldIndent,true);
  await wait('app.editor.cm.dom.dataset.editorFoldHeadings==="false"&&app.editor.cm.dom.dataset.editorFoldLists==="true"', "cached note keeps its independent local folding overlay");
  report.foldingControls = { ...(report.foldingControls ?? {}), cachedReadOnlyFolding: true, readOnlyLocalOverlay: true, readOnlyMutationsRefused: true };
  pass(report, "A genuine cached read-only Source note saves folding preferences only in its local overlay: headings stay expanded, nested lists and code fold, while actual typing/indentation refuse and the exact cached note plus unrelated configuration remain intact.");
}
