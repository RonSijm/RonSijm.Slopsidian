import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";
const q = JSON.stringify;
const control = key => `[data-editor-settings] [data-setting-key=${q(key)}]`;
const toggle = key => control(key) + ' [role="switch"]';
const attribute = key => ({ autoPairMarkdown: "editorMarkdownPairs", autoPairBrackets: "editorAutoPairs", smartIndentList: "editorSmartLists" })[key];
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function openSettings({ evaluate, click, wait }) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) await click("#open-settings");
  await click("#editor-settings-tab"); await wait(`Boolean(document.querySelector(${q(toggle("autoPairMarkdown"))}))`, "real Automatic Markdown pairs control");
}
async function closeSettings({ evaluate, click, wait }) {
  if (await evaluate('document.querySelector("#settings-dialog").open')) await click(".settings-close");
  await wait('(()=>{const dialog=document.querySelector("#settings-dialog");return !dialog.open&&!document.querySelector("[data-editor-settings]")&&!dialog.contains(document.activeElement)})()', "Markdown pairing settings close and retire their focused page");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))');
}
async function choose({ evaluate, click, wait }, key, value) {
  const checked = await evaluate(`document.querySelector(${q(toggle(key))}).getAttribute("aria-checked")==="true"`), stored = await evaluate(`app.configuration.get("app",${q(key)})??null`);
  if (checked === value && stored !== value) {
    await click(toggle(key)); await wait(`app.configuration.get("app",${q(key)})===${!value}`, "an explicit Markdown pairing choice replaces its imported/default value"); await click(toggle(key));
  } else if (checked !== value) await click(toggle(key));
  await wait(`app.configuration.get("app",${q(key)})===${value}&&app.editor.cm.dom.dataset.${attribute(key)}===${q(String(value))}`, "accepted " + key + " reaches the current editor");
}
async function flags(tools, markdown, brackets = null, lists = null) {
  await openSettings(tools); await choose(tools, "autoPairMarkdown", markdown);
  if (brackets !== null) await choose(tools, "autoPairBrackets", brackets);
  if (lists !== null) await choose(tools, "smartIndentList", lists);
  await closeSettings(tools);
}
async function position(tools, line, ch = 0) {
  await tools.evaluate(`(()=>{app.editor.exec("unfoldAll");app.editor.setCursor(${line},${ch});app.editor.scrollIntoView({from:{line:${line},ch:${ch}},to:{line:${line},ch:${ch}}},true);app.editor.focus()})()`);
}
async function reset(tools, path, text) {
  await tools.evaluate(`(async()=>{const editor=app.editor;if(editor.getValue()!==${q(text)})editor.replaceExpected(editor.getValue(),0,editor.getValue().length,${q(text)},"input.markdown-pairing-fixture");editor.exec("unfoldAll");await app.saveAll()})()`);
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + text));
}
async function exact(tools, path, text) {
  assert.equal(await tools.evaluate("app.editor.getValue()"), text); await tools.evaluate("app.saveAll()");
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + text));
}

async function extraPairs(tools, path, text, mode) {
  const { evaluate, command, press, report, capture } = tools, lines = text.split("\r\n"), blank = lines.indexOf("Body λ 😀.") + 1,
    selectionLine = lines.indexOf("Selection field: λ 😀 keep."), selectionCh = "Selection field: ".length;
  let filled = text;
  await reset(tools, path, text);
  for (const [marker, field, word] of [["~", "Strike field: ", "strike λ"], ["=", "Highlight field: ", "highlight λ"]]) {
    const line = lines.indexOf(field), ch = field.length;
    await position(tools, line, ch); await command("Input.insertText", { text: marker }); assert.equal(await evaluate("app.editor.getValue()"), filled.replace(field, field + marker));
    await command("Input.insertText", { text: marker }); assert.equal(await evaluate("app.editor.getValue()"), filled.replace(field, field + marker.repeat(4)));
    assert.deepEqual(await evaluate("app.editor.getCursor()"), { line, ch: ch + 2 });
    await command("Input.insertText", { text: word }); const expected = filled.replace(field, field + marker.repeat(2) + word + marker.repeat(2));
    await command("Input.insertText", { text: marker }); assert.equal(await evaluate("app.editor.getValue()"), expected);
    await command("Input.insertText", { text: marker }); await exact(tools, path, expected); assert.deepEqual(await evaluate("app.editor.getCursor()"), { line, ch: ch + 4 + word.length }); filled = expected;
  }
  await capture?.("markdown-extra-pairs-" + mode);
  for (const marker of ["~", "="]) {
    const field = marker === "~" ? "Strike field: " : "Highlight field: ", line = lines.indexOf(field), ch = field.length;
    await reset(tools, path, text); await position(tools, line, ch); await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: marker });
    await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text.replace(field, field + marker.repeat(2)));
    await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text);
    await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: " " }); assert.equal(await evaluate("app.editor.getValue()"), text.replace(field, field + marker + " "));
    await reset(tools, path, text); await position(tools, line, ch); await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: " " });
    assert.equal(await evaluate("app.editor.getValue()"), text.replace(field, field + marker.repeat(2) + " "));
    await reset(tools, path, text); await position(tools, line, ch); for (let index = 0; index < 3; index++) await command("Input.insertText", { text: marker });
    assert.equal(await evaluate("app.editor.getValue()"), text.replace(field, field + marker.repeat(3)));
    for (const prefix of ["", "- - ", "- > ", "1. - ", "> - > ", "+ * 2) > ", "\t- > "]) {
      await reset(tools, path, text); await position(tools, blank, 0); if (prefix) await command("Input.insertText", { text: prefix });
      for (let index = 0; index < 3; index++) await command("Input.insertText", { text: marker });
      assert.equal(await evaluate("app.editor.getValue()"), lines.map((value, index) => index === blank ? prefix + marker.repeat(3) : value).join("\r\n"));
    }
    for (const reversed of [false, true]) {
      await reset(tools, path, text);
      const from = selectionCh, to = selectionCh + "λ 😀".length, anchor = reversed ? to : from, head = reversed ? from : to;
      await evaluate(`(()=>{app.editor.setSelection({line:${selectionLine},ch:${anchor}},{line:${selectionLine},ch:${head}});app.editor.focus()})()`);
      await command("Input.insertText", { text: marker }); const single = text.replace("Selection field: λ 😀 keep.", "Selection field: " + marker + "λ 😀" + marker + " keep.");
      assert.equal(await evaluate("app.editor.getValue()"), single); await command("Input.insertText", { text: marker });
      const doubled = text.replace("Selection field: λ 😀 keep.", "Selection field: " + marker.repeat(2) + "λ 😀" + marker.repeat(2) + " keep."); await exact(tools, path, doubled);
      assert.deepEqual(await evaluate("app.editor.listSelections()[0]"), { anchor: { line: selectionLine, ch: anchor + 2 }, head: { line: selectionLine, ch: head + 2 } });
      await evaluate("app.editor.undo()"); await exact(tools, path, single); await evaluate("app.editor.undo()"); await exact(tools, path, text);
      await evaluate("app.editor.redo()"); await exact(tools, path, single); await evaluate("app.editor.redo()"); await exact(tools, path, doubled);
    }
    for (const [lineText, ch] of [["Literal field: ", "Literal field: ".length], ["Inline field: `code `", "Inline field: `code ".length], ["Escape field: \\", "Escape field: \\".length], ["Identifier: file_name", "Identifier: file_name".length]]) {
      await reset(tools, path, text); const line = lines.indexOf(lineText); await position(tools, line, ch);
      await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: marker });
      assert.equal(await evaluate("app.editor.getValue()"), lines.map((value, index) => index === line ? value.slice(0, ch) + marker.repeat(2) + value.slice(ch) : value).join("\r\n"));
    }
    await reset(tools, path, text); await flags(tools, false); await position(tools, line, ch);
    await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: marker }); assert.equal(await evaluate("app.editor.getValue()"), text.replace(field, field + marker.repeat(2)));
    await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text.replace(field, field + marker)); await flags(tools, true);
  }
  await reset(tools, path, text);
  report.extraMarkdownPairs = { ...(report.extraMarkdownPairs ?? {}), [mode === "source" ? "source" : "livePreview"]: true,
    firstMarkerLiteral: true, inlineDoubleTrigger: true, generatedDoubleOvertype: true, symmetricBackspace: true, spacedOperatorsLiteral: true, thirdMarkerLiteral: true,
    structuralFenceAndUnderlineLiteral: true, directionalUnicodeWrapping: true, isolatedWrappingUndoRedo: true, exactBomCrLf: true, codeEscapeIdentifierGuards: true, disabledLiteral: true };
  pass(report, `${mode}: physical single tildes/equals stay literal; only a second inline prose-boundary marker creates an owned double strike/highlight closer. Physical input and Source caret positions prove overtype, paired Backspace and exact BOM/CRLF; literal spacing/third markers/bare fences/underlines stay exact. Repeated single-marker Unicode selection wrapping preserves both directions and isolated Undo/Redo, while protected or disabled input remains literal.`);
}

/** Real Source/Live Preview input and settings; root owns serial native/browser GUI acceptance. */
export async function checkMarkdownPairing(tools) {
  const { directory, evaluate, command, click, press, wait, report, capture, restart, afterReload } = tools;
  const path = "Markdown pairs/Emphasis.md", text = ['---', 'status: Open', 'opaque: "Keep Markdown pairs λ"', '---', '# Markdown pairs', '', 'Body λ 😀.', '', 'Pair field: ', '', 'Strike field: ', '', 'Highlight field: ', '', 'Selection field: λ 😀 keep.', '', 'Identifier: file_name', '', 'Escape field: \\', '', 'Inline field: `code `', '', '```md', 'Literal field: ', '```', ''].join("\r\n");
  const lines = text.split("\r\n"), at = value => lines.indexOf(value), pairLine = at("Pair field: "), pairCh = "Pair field: ".length,
    selectionLine = at("Selection field: λ 😀 keep."), selectionCh = "Selection field: ".length, bulletLine = at("Body λ 😀.") + 1;
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath), config = JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, ""));
  const fixture = { ...config, markdownAutosave: false, autoPairMarkdown: true, autoPairBrackets: true, smartIndentList: true, __markdownPairingOpaque: { keep: ["中文", 42, true] } };
  await mkdir(join(directory, "Markdown pairs"), { recursive: true }); await writeFile(join(directory, path), Buffer.from("\ufeff" + text), { flag: "wx" });
  try {
    await writeFile(configPath, encode(fixture)); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source")})()`);
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)})`); await flags(tools, true, true, true); await reset(tools, path, text);
      for (const [marker, width, word] of [["*", 2, "strong λ"], ["_", 1, "emphasis λ"], ["*", 3, "both λ"]]) {
        await reset(tools, path, text); await position(tools, pairLine, pairCh);
        for (let index = 0; index < width; index++) await command("Input.insertText", { text: marker });
        assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: " + marker.repeat(width * 2)));
        await command("Input.insertText", { text: word });
        for (let index = 0; index < width; index++) await command("Input.insertText", { text: marker });
        const expected = text.replace("Pair field: ", "Pair field: " + marker.repeat(width) + word + marker.repeat(width)); await exact(tools, path, expected);
        assert.deepEqual(await evaluate("app.editor.getCursor()"), { line: pairLine, ch: pairCh + width * 2 + word.length });
        if (marker === "*" && width === 2) await capture?.("markdown-pairing-" + mode);
      }
      await reset(tools, path, text); await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "*" }); await command("Input.insertText", { text: "*" });
      await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: **"));
      await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text);
      await evaluate(`(()=>{app.editor.setSelection({line:${selectionLine},ch:${selectionCh + "λ 😀".length}},{line:${selectionLine},ch:${selectionCh}});app.editor.focus()})()`);
      await command("Input.insertText", { text: "*" }); const wrapped = text.replace("Selection field: λ 😀 keep.", "Selection field: *λ 😀* keep.");
      await exact(tools, path, wrapped); assert.deepEqual(await evaluate("app.editor.listSelections()[0]"), { anchor: { line: selectionLine, ch: selectionCh + "λ 😀".length + 1 }, head: { line: selectionLine, ch: selectionCh + 1 } });
      await evaluate("app.editor.undo()"); await exact(tools, path, text); await evaluate("app.editor.redo()"); await exact(tools, path, wrapped); await evaluate("app.editor.undo()");
      await position(tools, bulletLine, 0); await command("Input.insertText", { text: "*" }); await command("Input.insertText", { text: " " }); await command("Input.insertText", { text: "[ ] Task λ" });
      assert.equal(await evaluate("app.editor.getValue()"), lines.map((line, index) => index === bulletLine ? "* [ ] Task λ" : line).join("\r\n"));
      await reset(tools, path, text); await position(tools, bulletLine, 0); for (let index = 0; index < 3; index++) await command("Input.insertText", { text: "*" }); await command("Input.insertText", { text: " " });
      assert.equal(await evaluate("app.editor.getValue()"), lines.map((line, index) => index === bulletLine ? "*** " : line).join("\r\n"));
      for (const [line, ch, marker] of [[at("Literal field: "), "Literal field: ".length, "*"], [at("Inline field: `code `"), "Inline field: `code ".length, "*"], [at("Escape field: \\"), "Escape field: \\".length, "*"], [at("Identifier: file_name"), "Identifier: file_name".length, "_"]]) {
        await reset(tools, path, text); await position(tools, line, ch); await command("Input.insertText", { text: marker });
        assert.equal(await evaluate("app.editor.getValue()"), lines.map((value, index) => index === line ? value.slice(0, ch) + marker + value.slice(ch) : value).join("\r\n"));
      }
      await reset(tools, path, text); await flags(tools, false); await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "*" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: *"));
      await command("Input.insertText", { text: "*" }); await position(tools, pairLine, pairCh + 1); await press("Backspace", "Backspace", 8); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: *"));
      await reset(tools, path, text); await exact(tools, path, text);
      pass(report, `${mode}: actual asterisk/underscore input grows strong/triple emphasis, overtypes only owned closers and deletes empty pairs symmetrically. Reversed Unicode selection wrapping has isolated exact Undo/Redo; bullet/task/rule spacing keeps no stray closer, code/escapes/identifiers stay literal, and turning the control off gives ordinary typing/deletion with exact BOM/CRLF bytes.`);
      await flags(tools, true); await extraPairs(tools, path, text, mode);
    }

    await flags(tools, true, false, false); await evaluate(`(async()=>{const leaf=app.workspace.getLeaf("split");await leaf.openFile(app.vault.getFileByPath(${q(path)}));leaf.view.setEditingMode("source");app.workspace.setActiveLeaf(leaf,{focus:true})})()`);
    await wait(`app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).length===2&&app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${q(path)}).every(leaf=>leaf.view.editor.cm.dom.dataset.editorMarkdownPairs==="true"&&leaf.view.editor.cm.dom.dataset.editorAutoPairs==="false"&&leaf.view.editor.cm.dom.dataset.editorSmartLists==="false")`, "existing and new Markdown panes share independent pairing preferences");
    await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "_" }); await command("Input.insertText", { text: "kept" });
    assert.deepEqual(await evaluate("app.editor.getCursor()"), { line: pairLine, ch: pairCh + 5 });
    await evaluate("(()=>{globalThis.markdownPairingRetained={leaf:app.workspace.activeLeaf,editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection}})()");
    await flags(tools, true, true, true); assert.equal(await evaluate("app.editor===markdownPairingRetained.editor&&app.editor.cm===markdownPairingRetained.cm&&app.editor.cm.state.doc===markdownPairingRetained.doc&&app.editor.cm.state.selection.eq(markdownPairingRetained.selection)"), true);
    assert.deepEqual(await evaluate("app.editor.getCursor()"), { line: pairLine, ch: pairCh + 5 });
    await evaluate("app.editor.focus()");
    await wait('(()=>{const kept=markdownPairingRetained,cm=kept.cm,native=cm.contentDOM.ownerDocument.getSelection(),selection=cm.state.selection.main;return app.workspace.activeLeaf===kept.leaf&&app.editor===kept.editor&&cm.state.doc===kept.doc&&cm.state.selection.eq(kept.selection)&&cm.hasFocus&&Boolean(native?.anchorNode&&native.focusNode)&&cm.contentDOM.contains(native.anchorNode)&&cm.contentDOM.contains(native.focusNode)&&cm.posAtDOM(native.anchorNode,native.anchorOffset)===selection.anchor&&cm.posAtDOM(native.focusNode,native.focusOffset)===selection.head})()', "settings return synchronizes the retained Source caret and native selection");
    await command("Input.insertText", { text: "_" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: _kept_"));
    await reset(tools, path, text); await flags(tools, false, true); await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "(" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: ()")); await reset(tools, path, text);
    pass(report, "Existing Live Preview and a new Source pane share the Markdown switch independently of brackets and Enter continuation. Reconfiguring those other controls retains the same editor/document/selection and owned underscore closer; disabling Markdown pairs leaves bracket pairing active and exact note bytes intact.");

    await openSettings(tools); const style = await evaluate('(()=>{const root=document.querySelector("[data-editor-settings]"),style=root.getAttribute("style");root.style.maxWidth="320px";return style})()');
    try {
      await evaluate(`document.querySelector(${q(control("autoPairMarkdown"))}).scrollIntoView({block:"start"})`);
      const geometry = await evaluate('(()=>{const root=document.querySelector("[data-editor-settings]"),outer=root.getBoundingClientRect(),row=root.querySelector("[data-setting-key=autoPairMarkdown]"),box=row.getBoundingClientRect(),switchBox=row.querySelector("[role=switch]").getBoundingClientRect(),info=row.querySelector(".setting-item-info").getBoundingClientRect();return{width:outer.width,label:row.querySelector(".setting-item-name").textContent,description:row.querySelector(".setting-item-description").textContent,inside:box.left>=outer.left-1&&box.right<=outer.right+1&&switchBox.left>=box.left&&switchBox.right<=box.right+1,noOverlap:info.right<=switchBox.left,height:box.height}})()');
      assert.ok(geometry.width <= 321 && geometry.inside && geometry.noOverlap && geometry.height > 0); assert.equal(geometry.label, "Automatic Markdown pairs"); assert.ok(geometry.description.includes("asterisks and underscores")); await capture?.("markdown-pairing-settings-narrow");
    } finally { await evaluate(`(()=>{const root=document.querySelector("[data-editor-settings]");if(${q(style)}===null)root.removeAttribute("style");else root.setAttribute("style",${q(style)})})()`); }
    await closeSettings(tools); pass(report, "The actual Automatic Markdown pairs label, switch and complete description wrap within a measured320px Editor settings column without overlap or clipping.");

    await writeFile(configPath, encode({ ...fixture, autoPairMarkdown: null })); await evaluate('app.configuration.refresh("app")'); await wait('app.editor.cm.dom.dataset.editorMarkdownPairs==="true"', "malformed imported Markdown pairing uses its true default");
    await openSettings(tools); assert.equal(await evaluate(`document.querySelector(${q(control("autoPairMarkdown"))}).textContent.includes("saved value is invalid; the default is used")`), true);
    assert.equal(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).autoPairMarkdown, null); await choose(tools, "autoPairMarkdown", false); await choose(tools, "autoPairMarkdown", true);
    assert.equal(await evaluate(`(()=>{const field=document.querySelector(${q(toggle("autoPairMarkdown"))});field.focus();return document.activeElement===field})()`), true);
    const saved = JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")), external = encode({ ...saved, autoPairMarkdown: false, __markdownPairingExternal: { newer: true } });
    await writeFile(configPath, external); await wait('app.vault.getConfig("autoPairMarkdown")===false', "global Markdown pairing adopts external config while focused page retains old version");
    assert.equal(await evaluate(`document.querySelector(${q(toggle("autoPairMarkdown"))}).getAttribute("aria-checked")`), "true");
    const conflict = "The configuration changed on disk. Reload it before saving; the existing file was retained.", message = await evaluate('document.body.classList.contains("is-browser")') ? "Host 409: " + conflict : "Host 409: " + JSON.stringify({ error: conflict });
    await expectErrors({ evaluate, report }, [{ source: "notification", message }], async () => {
      await click(toggle("autoPairMarkdown")); await wait(`document.querySelector(${q(control("autoPairMarkdown") + ' [role="alert"]')})?.textContent.includes("changed on disk")`, "stale Markdown switch refuses a newer disk config");
    }, "Retain a newer app.json rather than rebasing an old Markdown pairing switch");
    assert.deepEqual(await readFile(configPath), external); await click('[data-editor-settings] [role="button"]');
    await wait(`document.querySelector(${q(toggle("autoPairMarkdown"))}).getAttribute("aria-checked")==="false"&&document.querySelector(${q(control("autoPairMarkdown") + ' [role="alert"]')})?.hidden===true`, "explicit Reload rebases the Markdown pairing control");
    await choose(tools, "autoPairMarkdown", true); await choose(tools, "autoPairMarkdown", false); await closeSettings(tools); await exact(tools, path, text);
    assert.deepEqual(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).__markdownPairingExternal, { newer: true });
    pass(report, "A malformed Markdown value falls back visibly without rewriting its raw import. A focused real switch refuses a newer configuration with audited409, retains every external byte, and accepts fresh versioned choices only after explicit Reload.");

    await evaluate("app.workspace.flushLayout()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.editor.cm.dom.dataset.editorMarkdownPairs==="false"`, "native restart or browser reconnection restores Markdown pairing choice");
    assert.deepEqual(await evaluate('app.vault.getConfig("__markdownPairingOpaque")'), fixture.__markdownPairingOpaque); assert.deepEqual(await evaluate('app.vault.getConfig("__markdownPairingExternal")'), { newer: true });
    await position(tools, pairLine, pairCh); await command("Input.insertText", { text: "_" }); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Pair field: ", "Pair field: _")); await reset(tools, path, text);
    report.markdownPairing = { sourceAndLivePreview: true, ownedClosers: true, strongTripleGrowth: true, emptyPairBackspace: true, unicodeSelectionWrapping: true, reversedSelection: true, bulletTaskHorizontalRules: true, codeEscapesIntrawordLiteral: true, isolatedUndoExactBomCrLf: true, disabledLiteral: true, independentControls: true, existingAndNewPanes: true, retainsCmDocumentSelection: true, narrow320Column: true, malformedImportUnchanged: true, staleConfigRefusal: true, explicitReload: true, restart: true };
    pass(report, "Full native restart or actual-folder browser reconnection restores the saved disabled Markdown pairing control and unknown settings. Fresh physical underscore input stays literal, while exact original note bytes and shared pane state remain intact.");
  } catch (error) {
    try { report.markdownPairingFailure = await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode(),source:app.editor.getValue(),cursor:app.editor.getCursor(),selection:app.editor.listSelections(),markdown:app.editor.cm.dom.dataset.editorMarkdownPairs,brackets:app.editor.cm.dom.dataset.editorAutoPairs,focus:document.activeElement?.outerHTML.slice(0,600),settings:document.querySelector("[data-editor-settings]")?.textContent.slice(0,5000)}))()'); await capture?.("markdown-pairing-precleanup-failure"); } catch { /* Keep the original assertion. */ }
    throw error;
  } finally {
    await closeSettings(tools); await evaluate("delete globalThis.markdownPairingRetained");
    if (await evaluate(`app.workspace.getActiveFile()?.path===${q(path)}`)) await reset(tools, path, text);
    await writeFile(configPath, originalConfig); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
  }
}

/** The parent audits all exact cached blobs and zero GitHub API/raw requests through local return. */
export async function checkMarkdownPairingReadOnly(tools) {
  const { evaluate, command, press, wait, report, capture } = tools; assert.equal(await evaluate("app.vault.readOnly"), true);
  await evaluate('(async()=>{await app.openFile("Read only.md");app.workspace.activeLeaf.view.setEditingMode("source")})()');
  const text = await evaluate("app.editor.getValue()"), before = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  const line = text.split(/\r?\n/).indexOf("Pair field: "); assert.ok(line > 0, "actual cached note contains an eligible prose pairing field");
  await flags(tools, true); await position(tools, line, "Pair field: ".length);
  await command("Input.insertText", { text: "*" }); await command("Input.insertText", { text: "word" }); await command("Input.insertText", { text: "*" }); await press("Backspace", "Backspace", 8);
  await evaluate('app.editor.replaceSelection("_");app.editor.replaceExpected(app.editor.getValue(),0,0,"*","input.readonly-markdown-probe")'); assert.equal(await evaluate("app.editor.getValue()"), text);
  for (const marker of ["~", "="]) {
    await position(tools, line, "Pair field: ".length);
    await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: "word" });
    await command("Input.insertText", { text: marker }); await command("Input.insertText", { text: marker }); await press("Backspace", "Backspace", 8);
    await evaluate(`app.editor.replaceSelection(${q(marker.repeat(2))});app.editor.replaceExpected(app.editor.getValue(),0,0,${q(marker.repeat(2))},"input.readonly-extra-markdown-probe")`);
    assert.equal(await evaluate("app.editor.getValue()"), text);
  }
  await flags(tools, false); const after = await evaluate('(async()=>(await app.configuration.read("app")).data)()'), unrelated = ({ autoPairMarkdown, ...rest }) => rest;
  assert.deepEqual(unrelated(after), unrelated(before)); assert.equal(after.autoPairMarkdown, false); assert.equal(await evaluate("app.editor.getValue()"), text);
  await capture?.("markdown-pairing-readonly"); report.markdownPairing = { ...(report.markdownPairing ?? {}), cachedReadOnlyLocalOverlay: true, readOnlyTypingAndDirectWritesRefused: true, readOnlyExactSource: true };
  report.extraMarkdownPairs = { ...(report.extraMarkdownPairs ?? {}), cachedReadOnlyDelimitersRefused: true };
  pass(report, "A genuine cache-only read-only note saves Automatic Markdown pairs only in its local overlay. Actual asterisk, tilde and equals typing/Backspace and direct source replacements refuse changes at a real eligible prose field, preserving exact source and unrelated configuration while the parent audits every cached blob and zero requests.");
}
