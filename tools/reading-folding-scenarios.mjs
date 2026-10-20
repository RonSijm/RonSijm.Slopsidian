import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify;
const root = "app.workspace.activeLeaf.view.previewEl";
const panel = '[data-reading-search="true"]', query = panel + " [data-reading-search-query]";
const setting = '[data-editor-settings] [data-setting-key="foldHeading"] [role="switch"]';
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");

function headingState() {
  const root = app.workspace.activeLeaf.view.previewEl;
  return [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(h => h.closest(".markdown-preview-view") === root).map(h => {
    const button = h.querySelector(":scope > .reading-fold-toggle");
    return { line: Number(h.dataset.sourceLine), text: [...h.childNodes].filter(n => n !== button).map(n => n.textContent).join(""),
      visible: h.checkVisibility(), expanded: button?.getAttribute("aria-expanded") ?? null, label: button?.getAttribute("aria-label") ?? null };
  });
}
function foldInfo() {
  const root = app.workspace.activeLeaf.view.previewEl, owned = selector => [...root.querySelectorAll(selector)].filter(e => e.closest(".markdown-preview-view") === root);
  return { headings: [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(h => h.closest(".markdown-preview-view") === root).map(h => ({ line: Number(h.dataset.sourceLine), visible: h.checkVisibility(), expanded: h.querySelector(":scope > .reading-fold-toggle")?.getAttribute("aria-expanded") ?? null })),
    alpha: owned("p").filter(p => p.textContent === "alpha alpha").map(p => p.checkVisibility()), hidden: owned("[hidden]").map(e => Number(e.dataset.sourceLine)),
    controls: owned(".reading-fold-toggle").length, embeddedControls: [...root.querySelectorAll(".markdown-embed .reading-fold-toggle")].length };
}
async function installed(tools, path = null) {
  await tools.wait(`app.workspace.activeLeaf.view.getMode()==="preview"&&${path ? `app.workspace.getActiveFile()?.path===${q(path)}&&` : ""}${root}.querySelectorAll(":scope > .markdown-preview-section > h1 > .reading-fold-toggle").length===1`, "installed current main Reading heading controls");
}
async function pointer(tools, line) {
  const selector = `[data-reading-fold-toggle=${q(String(line))}]`;
  await tools.evaluate(`${root}.querySelector(${q(selector)}).scrollIntoView({block:"center"})`);
  await tools.click(selector);
}
async function explicitlyExpandAll(tools) {
  const lines = await tools.evaluate(`${root}.querySelectorAll('.reading-fold-toggle').length&&[...${root}.querySelectorAll('.reading-fold-toggle')].filter(button=>button.closest('.markdown-preview-view')===${root}).map(button=>Number(button.dataset.readingFoldToggle))`);
  for (const line of lines) {
    // Navigation can have temporarily revealed an intended fold. Activating an
    // expanded button twice makes the expanded preference explicit too.
    if (await tools.evaluate(`${root}.querySelector('[data-reading-fold-toggle="${line}"]').getAttribute('aria-expanded')==="true"`)) await pointer(tools, line);
    await pointer(tools, line);
  }
}
async function keyboard(tools, line, key = "Enter") {
  assert.ok(key === "Enter" || key === " ");
  const selector = `[data-reading-fold-toggle=${q(String(line))}]`;
  await tools.command("Page.bringToFront");
  const before = await tools.evaluate(`(()=>{const r=${root},button=r.querySelector(${q(selector)});if(!button)throw Error("Missing Reading keyboard fold button");button.scrollIntoView({block:"center"});button.focus({preventScroll:true});const before={focused:r.ownerDocument.activeElement===button,documentFocused:r.ownerDocument.hasFocus(),expanded:button.getAttribute("aria-expanded"),label:button.getAttribute("aria-label"),active:r.ownerDocument.activeElement?.outerHTML.slice(0,600)};globalThis.__readingFoldingKeyboard={line:${line},key:${q(key)},before};return before})()`);
  assert.equal(before.focused, true, "physical folding key targets the focused button: " + JSON.stringify(before));
  assert.ok(before.expanded === "true" || before.expanded === "false");
  const event = { key, code: key === " " ? "Space" : "Enter", windowsVirtualKeyCode: key === " " ? 32 : 13, nativeVirtualKeyCode: key === " " ? 32 : 13, modifiers: 0 };
  const text = key === " " ? " " : "\r";
  // keyDown with text emits Chromium's physical keypress/default activation;
  // rawKeyDown alone omits that character step for native HTML buttons.
  await tools.command("Input.dispatchKeyEvent", { type: "keyDown", ...event, text, unmodifiedText: text });
  await tools.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  await tools.wait(`(()=>{const r=${root},button=r.querySelector(${q(selector)}),after={focused:r.ownerDocument.activeElement===button,documentFocused:r.ownerDocument.hasFocus(),expanded:button?.getAttribute("aria-expanded"),active:r.ownerDocument.activeElement?.outerHTML.slice(0,600)};globalThis.__readingFoldingKeyboard.after=after;return after.expanded===${q(before.expanded === "true" ? "false" : "true")}})()`, "physical " + (key === " " ? "Space" : "Enter") + " changes the focused heading button's aria-expanded state");
}
async function findOpen(tools) {
  await tools.evaluate(`${root}.focus()`); await tools.press("f", "KeyF", 70, 2);
  await tools.wait(`Boolean(document.querySelector(${q(query)}))`, "Reading Find opens over the folded current note");
}
async function findClose(tools) {
  if (await tools.evaluate(`Boolean(document.querySelector(${q(panel)}))`)) await tools.click(panel + ' button[name="close"]');
}
async function findFill(tools, text) {
  await tools.click(query); await tools.press("a", "KeyA", 65, 2); await tools.command("Input.insertText", { text });
}
async function findCount(tools, value) {
  await tools.wait(`document.querySelector(${q(panel)})?.dataset.readingSearchCount===${q(String(value))}`, "folded Reading Find count " + value);
  assert.equal(await tools.evaluate(`(()=>{const r=${root};return [...(CSS.highlights?.get("slopsidian-reading-search")??[])].filter(range=>r.contains(range.startContainer)).length})()`), value);
}
async function selectedAlpha(tools, index = 0) {
  assert.equal(await tools.evaluate(`(()=>{const root=${root},p=[...root.querySelectorAll("p")].filter(p=>p.closest(".markdown-preview-view")===root&&p.textContent==="alpha alpha")[${index}];if(!p?.checkVisibility())throw Error("Expected visible alpha passage");p.scrollIntoView({block:"center"});root.focus();const range=document.createRange();range.selectNodeContents(p);const selection=root.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);return range.toString()})()`), "alpha alpha");
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
}
async function headingPreference(tools, value) {
  if (!await tools.evaluate('document.querySelector("#settings-dialog").open')) await tools.click("#open-settings");
  await tools.click("#editor-settings-tab"); await tools.wait(`Boolean(document.querySelector(${q(setting)}))`, "real Fold headings preference");
  if (await tools.evaluate(`document.querySelector(${q(setting)}).getAttribute("aria-checked")==="true"`) !== value) await tools.click(setting);
  await tools.wait(`app.configuration.get("app","foldHeading")===${value}`, "real preference accepts Reading heading folding " + value);
  await tools.click(".settings-close");
}
async function reading(tools, path) {
  await tools.evaluate(`(async()=>{${path ? `await app.openFile(${q(path)});` : ""}app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
  await installed(tools, path);
}

/** Actual current-view buttons, source-owned rendered nodes and host lifecycles. */
export async function checkReadingFolding(tools) {
  const { directory, evaluate, command, press, wait, report, restart, afterReload, capture } = tools;
  const folder = "Reading heading folds", path = folder + "/Headings.md", embedded = folder + "/Embedded.md", other = folder + "/Other.md";
  const text = ["---", 'opaque: "Retain folding λ"', "---", "# Reading folding λ", "", "Overview stays visible.", "", "## Parent A", "", "alpha alpha", "", "### Child A", "", "alpha alpha", "", "Known nested paragraph ^fold-block", "", "Plugin anchor.", "", "$x^2 + 1$", "", "```go", "package main", 'func note() string { return "kept λ" }', "```", "", "![[Embedded]]", "", "Footnote anchor.[^fold-note]", "", "## Parent B", "", "alpha alpha", "", "- Parent list", "  - Child list", "", "[^fold-note]: Footnote target stays a rendered node.", ""].join("\r\n");
  const bytes = Buffer.from("\ufeff" + text), embedBytes = Buffer.from("\ufeff# Embedded heading\r\n\r\nEmbedded body.\r\n"), otherBytes = Buffer.from("\ufeff# Other heading\r\n\r\nOther body.\r\n");
  const lines = text.split("\r\n"), a = lines.indexOf("## Parent A"), child = lines.indexOf("### Child A"), b = lines.indexOf("## Parent B"), block = lines.indexOf("Known nested paragraph ^fold-block");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), localRoot = await evaluate("app.vault.rootPath"), configPath = join(directory, ".obsidian", "app.json"), config = await readFile(configPath);
  const fixture = { ...JSON.parse(config.toString("utf8").replace(/^\ufeff/, "")), markdownAutosave: false, foldHeading: true };
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, path), bytes, { flag: "wx" }); await writeFile(join(directory, embedded), embedBytes, { flag: "wx" }); await writeFile(join(directory, other), otherBytes, { flag: "wx" });
  let stage = "initial render";
  try {
    await writeFile(configPath, encode(fixture));
    await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "History marker Ω" }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    await evaluate(`(()=>{const api=app.plugins.modules.obsidian,state=globalThis.__readingFoldingProbe={api,clicks:0,loaded:0,unloaded:0};state.processor=(element,context)=>{if(context.sourcePath!==${q(path)})return;const p=[...element.querySelectorAll("p")].find(p=>p.textContent==="Plugin anchor.");if(!p)return;const button=document.createElement("button");button.type="button";button.dataset.readingFoldingPlugin="";button.textContent="Plugin action";p.append(button);const child=new api.MarkdownRenderChild(button);child.onload=()=>{state.loaded++};child.onunload=()=>{state.unloaded++};child.registerDomEvent(button,"click",()=>state.clicks++);context.addChild(child)};api.MarkdownPreviewRenderer.registerPostProcessor(state.processor,10)})()`);
    await reading(tools, path);
    await wait(`${root}.querySelector('[data-reading-folding-plugin]')?.checkVisibility()&&${root}.querySelector('.markdown-embed-content.markdown-preview-view h1')?.textContent==="Embedded heading"`, "installed plugin-owned child and nested embed before folding");
    const headings = await evaluate(invoke(headingState)); assert.deepEqual(headings.map(h => [h.text, h.expanded]), [["Reading folding λ", "true"], ["Parent A", "true"], ["Child A", "true"], ["Parent B", "true"]]);
    assert.equal((await evaluate(invoke(foldInfo))).embeddedControls, 0);
    await evaluate(`(()=>{const state=__readingFoldingProbe,r=${root};state.retained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection,blocks:[...r.firstElementChild.children],plugin:r.querySelector('[data-reading-folding-plugin]'),math:r.querySelector('.math-inline'),code:r.querySelector('pre>code'),embed:r.querySelector('.markdown-embed-content.markdown-preview-view'),loaded:state.loaded,unloaded:state.unloaded};for(const key of ["plugin","math","code","embed"])if(!state.retained[key])throw Error("Missing retained Reading node: "+key)})()`);
    await pointer(tools, child); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, false, true]);
    await keyboard(tools, a); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [false, false, true]);
    await pointer(tools, b); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [false, false, false]);
    await keyboard(tools, a, " "); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, false, false]);
    assert.equal((await evaluate(invoke(headingState))).find(h => h.line === child).expanded, "false");
    await pointer(tools, child); await pointer(tools, b);
    assert.equal(await evaluate(`(()=>{const state=__readingFoldingProbe,s=state.retained,r=${root};return Boolean(s.plugin&&s.math&&s.code&&s.embed)&&app.editor===s.editor&&app.editor.cm===s.cm&&app.editor.cm.state.doc===s.doc&&app.editor.cm.state.selection.eq(s.selection)&&s.blocks.every((node,index)=>r.firstElementChild.children[index]===node)&&r.querySelector('[data-reading-folding-plugin]')===s.plugin&&r.querySelector('.math-inline')===s.math&&r.querySelector('pre>code')===s.code&&r.querySelector('.markdown-embed-content.markdown-preview-view')===s.embed&&state.loaded===s.loaded&&state.unloaded===s.unloaded})()`), true);
    await tools.click("[data-reading-folding-plugin]"); assert.equal(await evaluate("__readingFoldingProbe.clicks"), 1);
    await evaluate(`(async()=>{const state=__readingFoldingProbe;state.owner=new state.api.Component();await state.owner.load();state.staticHost=document.createElement("div");document.body.append(state.staticHost);await state.api.MarkdownRenderer.render(app,"# Static heading\\n\\nStatic body.",state.staticHost,${q(path)},state.owner)})()`);
    assert.equal(await evaluate("__readingFoldingProbe.staticHost.querySelectorAll('.reading-fold-toggle').length"), 0);
    await evaluate("(async()=>{await __readingFoldingProbe.owner.unloadAndWait();__readingFoldingProbe.staticHost.remove()})()");
    assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(join(directory, embedded)), embedBytes);
    pass(report, "Real pointer and Enter/Space heading buttons fold nested and disjoint sections, retain the child state after parent expansion, and preserve exact rendered code/math/embed/plugin nodes, plugin listeners and child ownership, hidden Source CodeMirror/document/selection/history and BOM/CRLF source. Embedded and public static renderers have no fold controls.");

    stage = "Find visibility and selected regex passages";
    await findOpen(tools); await findFill(tools, "alpha"); await findCount(tools, 6);
    await pointer(tools, a); await findCount(tools, 2); await pointer(tools, b); await findCount(tools, 0);
    await pointer(tools, a); await pointer(tools, b); await findCount(tools, 6);
    await tools.click(panel + ' [name="regexp"]'); await findFill(tools, "[a]lpha"); await findCount(tools, 6);
    await selectedAlpha(tools); await tools.click(panel + " [data-reading-search-use-selection]"); await findCount(tools, 2);
    await pointer(tools, a); await findCount(tools, 0); assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchScope`), "stale");
    assert.equal(await evaluate(`document.querySelector(${q(query)}).value`), "[a]lpha"); assert.equal(await evaluate(`document.querySelector(${q(panel + ' [name="regexp"]')}).checked`), true);
    await tools.click(panel + ' [name="selection"]'); await findCount(tools, 2); await findClose(tools);
    await findOpen(tools); await findFill(tools, "alpha"); await findCount(tools, 2); await findClose(tools);
    pass(report, "Reading Find immediately removes hidden text and caret glyphs from literal/regex paint and counts. Folding invalidates an explicitly captured passage without changing the query/regex choice or revealing hidden matches; fresh Ctrl+F sees only the visible disjoint section.");

    stage = "heading, block and footnote navigation";
    await evaluate(`app.workspace.activeLeaf.view.revealHeading("#Child A")`);
    assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, true]);
    await pointer(tools, child); await pointer(tools, a);
    await evaluate(`app.workspace.openLinkText(${q(path + "#^fold-block")},${q(path)})`);
    await wait(`app.editor.getCursor().line===${block}`, "collapsed block link keeps its resolved hidden Source caret");
    assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, true]);
    assert.equal(await evaluate(`(()=>{const p=[...${root}.querySelectorAll("p")].find(p=>p.textContent.includes("Known nested paragraph"));return p.checkVisibility()&&p.getBoundingClientRect().height>0})()`), true);
    await pointer(tools, child); await pointer(tools, a);
    await evaluate(`app.workspace.openLinkText(${q(path + "#Parent A#Child A")},${q(path)})`);
    await wait(`app.editor.getCursor().line===${child}`, "collapsed hierarchical heading link keeps its resolved Source caret");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)'); assert.equal(await evaluate("app.editor.getCursor().line"), child);
    await evaluate('app.editor.redo()'); assert.equal(await evaluate("app.editor.getValue()"), text + "History marker Ω"); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    await reading(tools, path);
    await explicitlyExpandAll(tools);
    await tools.click('.footnote-ref [role="doc-noteref"]'); await wait('document.activeElement?.getAttribute("role")!=="doc-noteref"&&document.activeElement?.dataset.footnoteNumber==="1"', "forward footnote navigation focuses its visible note");
    await pointer(tools, child); await pointer(tools, a); await tools.click(".footnote-backref");
    assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, true]);
    assert.equal(await evaluate('document.activeElement?.getAttribute("role")'), "doc-noteref");
    pass(report, "Direct heading navigation, real hierarchical heading/block links and footnote return links expand owning collapsed ancestors before scrolling/focusing. Explicit subpaths retain the resolved Source return caret; Source redo/undo history and exact note content survive.");

    stage = "preference, external config and narrow layout";
    const sectionStyle = await evaluate(`${root}.firstElementChild.getAttribute("style")`);
    try {
      await evaluate(`${root}.firstElementChild.style.maxWidth="320px";${root}.firstElementChild.style.width="320px"`);
      await pointer(tools, a);
      const geometry = await evaluate(`(()=>{const r=${root}.firstElementChild,box=r.getBoundingClientRect();return {width:box.width,controls:[...r.querySelectorAll('.reading-fold-toggle')].filter(e=>e.checkVisibility()).map(e=>{const a=e.getBoundingClientRect(),h=e.parentElement.getBoundingClientRect();return a.width>0&&a.height>0&&a.left>=box.left-1&&a.right<=box.right+1&&a.top>=h.top-2&&a.bottom<=h.bottom+2})}})()`);
      assert.ok(geometry.width <= 321 && geometry.controls.length === 3 && geometry.controls.every(Boolean)); await capture?.("reading-folding-narrow");
    } finally { await evaluate(`(()=>{const section=${root}.firstElementChild;if(${q(sectionStyle)}===null)section.removeAttribute("style");else section.setAttribute("style",${q(sectionStyle)})})()`); }
    await headingPreference(tools, false); await wait(`${root}.querySelectorAll('.reading-fold-toggle').length===0&&!${root}.querySelector('[hidden]')`, "turning off Fold headings expands all Reading sections and removes controls");
    await headingPreference(tools, true); await installed(tools, path);
    await explicitlyExpandAll(tools);
    await pointer(tools, a); await writeFile(configPath, encode({ ...fixture, foldHeading: false })); await evaluate('app.configuration.refresh("app")');
    await wait(`${root}.querySelectorAll('.reading-fold-toggle').length===0&&!${root}.querySelector('[hidden]')`, "accepted external foldHeading false clears the current Reading layer");
    await writeFile(configPath, encode({ ...fixture, foldHeading: "false" })); await evaluate('app.configuration.refresh("app")'); await installed(tools, path);
    assert.equal(await evaluate('app.configuration.get("app","foldHeading")'), "false");
    await writeFile(configPath, encode(fixture)); await evaluate('app.configuration.refresh("app")');
    await explicitlyExpandAll(tools);
    pass(report, "Actual Fold headings preference changes and accepted external configuration updates expand current Reading sections and remove controls immediately. Invalid imported values use the Boolean default without rewriting them; visible keyboard/pointer caret buttons remain inside a320px Reading section.");

    stage = "stale render and retained control ownership";
    await evaluate(`(()=>{const state=__readingFoldingProbe;state.held=${root}.querySelector('[data-reading-fold-toggle="${a}"]');state.blocking=(element,context)=>{if(context.sourcePath!==${q(path)}||state.pending)return;state.pending={element};return new Promise(resolve=>state.resume=resolve)};state.api.MarkdownPreviewRenderer.registerPostProcessor(state.blocking,0)})()`);
    await wait("Boolean(__readingFoldingProbe.resume)", "a real pending postprocessor owns the obsolete Reading generation");
    await writeFile(join(directory, path), Buffer.from("\ufeff" + text.replace("## Parent A", "## External Parent A")));
    await wait(`${root}.querySelector('[data-reading-fold-toggle="${a}"]')?.getAttribute('aria-label').includes('External Parent A')`, "physical note refresh installs controls for the new render");
    await evaluate("__readingFoldingProbe.held.click();__readingFoldingProbe.resume();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, true]);
    await evaluate("__readingFoldingProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__readingFoldingProbe.blocking)");
    await writeFile(join(directory, path), bytes); await wait(`app.editor.getValue()===${q(text)}&&${root}.querySelector('[data-reading-fold-toggle="${a}"]')?.getAttribute('aria-label')==='Collapse heading Parent A'`, "exact physical note restores a current fold generation");
    await evaluate(`(()=>{const held=${root}.querySelector('[data-reading-fold-toggle="${a}"]'),text=app.editor.getValue();__readingFoldingProbe.dirtyHeld=held;app.editor.replaceExpected(text,0,text.length,text+"Dirty render Ω","input.reading-folding-probe");held.click()})()`);
    await wait(`${root}.textContent.includes("Dirty render Ω")`, "dirty hidden Source document receives its current Reading render"); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, true]);
    await evaluate("app.editor.undo()"); await wait(`app.editor.getValue()===${q(text)}&&Boolean(${root}.querySelector('[data-reading-fold-toggle="${a}"]'))`, "dirty Reading update undone exactly");
    await evaluate(`(()=>{__readingFoldingProbe.modeHeld=${root}.querySelector('[data-reading-fold-toggle="${a}"]');app.workspace.activeLeaf.view.setEditingMode("source",false);__readingFoldingProbe.modeHeld.click()})()`);
    await reading(tools, path); await evaluate("__readingFoldingProbe.modeHeld.click()"); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, true]);
    await evaluate(`(()=>{__readingFoldingProbe.fileHeld=${root}.querySelector('[data-reading-fold-toggle="${a}"]')})()`); await reading(tools, other);
    await evaluate("__readingFoldingProbe.fileHeld.click()"); assert.equal((await evaluate(invoke(foldInfo))).hidden.length, 0);
    await reading(tools, path); await pointer(tools, a);
    await evaluate("__readingFoldingProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__readingFoldingProbe.processor)");
    await wait(`!${root}.querySelector('[data-reading-folding-plugin]')&&Boolean(${root}.querySelector('[data-reading-fold-toggle="${a}"]'))`, "real processor unload refreshes the current render");
    await explicitlyExpandAll(tools);
    assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(join(directory, other)), otherBytes);
    pass(report, "Physical edits supersede an actually pending postprocessor; retained controls and resumed obsolete jobs cannot collapse the replacement. Dirty renders, Source/Reading transitions, note switches and provider unload retire old controls without touching current content or exact source bytes.");

    stage = "restored initial Reading controls";
    await pointer(tools, a); await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await installed(tools, path); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [false, false, true]);
    await pointer(tools, a); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, true]); await keyboard(tools, a); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [false, false, true]); await pointer(tools, a);
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await readFile(join(directory, path)), bytes);
    report.readingFolding = { visibleAccessibleButtons: true, pointerAndKeyboard: true, nestedAndDisjoint: true, retainsRenderedNodesAndPluginChildren: true, mainViewOnly: true,
      hiddenEditorHistoryAndExactBytes: true, headingBlockAndFootnoteNavigation: true, sourceReturnCaret: true, findVisibilityAndCapturedRegex: true,
      preferenceOffAndExternalRefresh: true, stalePendingDirtyModeFileOwners: true, narrow320: true, restoredInitialReadingControls: true, persistedHeadingChoice: true };
    pass(report, "Full native restart or actual-folder browser reconnection restores initial Reading with the user's persisted heading fold and immediately usable buttons. Actual pointer/keyboard expansion and recollapse retain exact physical source.");
  } catch (error) {
    try { report.readingFoldingFailure = { stage, ...await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),source:app.editor.getValue(),folds:${invoke(foldInfo)},headingState:${invoke(headingState)},focus:{documentFocused:document.hasFocus(),active:document.activeElement?.outerHTML.slice(0,800)},keyboard:globalThis.__readingFoldingKeyboard,panel:document.querySelector(${q(panel)})?.outerHTML.slice(0,4000),plugin:globalThis.__readingFoldingProbe?{loaded:__readingFoldingProbe.loaded,unloaded:__readingFoldingProbe.unloaded,clicks:__readingFoldingProbe.clicks,pending:!!__readingFoldingProbe.pending}:null}))()`) }; await capture?.("reading-folding-precleanup-failure"); } catch { report.readingFoldingFailure ??= { stage }; }
    throw error;
  } finally {
    if (await evaluate("app.vault.rootPath").catch(() => null) === localRoot) {
      await findClose(tools);
      await evaluate('(()=>{const state=globalThis.__readingFoldingProbe;if(state){state.resume?.();if(state.blocking)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.blocking);if(state.processor)state.api.MarkdownPreviewRenderer.unregisterPostProcessor(state.processor);state.staticHost?.remove();state.owner?.unload();delete globalThis.__readingFoldingProbe}delete globalThis.__readingFoldingKeyboard})()');
      await writeFile(join(directory, path), bytes); await writeFile(configPath, config);
      await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source",false);const current=app.editor.getValue();if(current!==${q(text)})app.editor.replaceExpected(current,0,current.length,${q(text)},"input.reading-folding-cleanup");await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
    }
  }
}

/** Parent supplies/hashes the genuine cache-only fixture and audits zero requests. */
export async function checkReadingFoldingReadOnly(tools) {
  const { evaluate, wait, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  assert.notEqual(await evaluate('app.configuration.get("app","foldHeading")??null'), false, "cache-only folding starts with its true default and performs no configuration writes");
  await reading(tools, "Read only.md");
  const text = await evaluate("app.editor.getValue()"), lines = text.split(/\r?\n/), a = lines.indexOf("## Parent A"), child = lines.indexOf("### Child A"), b = lines.indexOf("## Parent B");
  assert.ok(a >= 0 && child > a && b > child);
  const before = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  try {
    await pointer(tools, child); await keyboard(tools, a); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [false, false, true]);
    await keyboard(tools, a, " "); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, false, true]); await pointer(tools, child);
    await findOpen(tools); await findFill(tools, "alpha"); await findCount(tools, 6);
    await pointer(tools, a); await findCount(tools, 2); await pointer(tools, b); await findCount(tools, 0);
    await findClose(tools); await evaluate('app.workspace.activeLeaf.view.revealHeading("#Child A")'); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, false]);
    const childState = (await evaluate(invoke(headingState))).find(heading => heading.line === child);
    assert.equal(childState?.visible, true); assert.equal(childState?.expanded, "true", "direct reveal preserves an already expanded target heading");
    await pointer(tools, child); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, false, false]);
    const collapsedChild = (await evaluate(invoke(headingState))).find(heading => heading.line === child);
    assert.equal(collapsedChild?.visible, true); assert.equal(collapsedChild?.expanded, "false");
    await pointer(tools, a); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [false, false, false]);
    await evaluate('app.workspace.openLinkText("Read only.md#Parent A#Child A","Read only.md")');
    await wait(`app.editor.getCursor().line===${child}`, "cache-only collapsed heading expands with resolved Source caret");
    assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, false, false]);
    const linkedChild = (await evaluate(invoke(headingState))).find(heading => heading.line === child);
    assert.equal(linkedChild?.visible, true); assert.equal(linkedChild?.expanded, "false", "hierarchical navigation expands ancestors and preserves the target's own collapsed body");
    await pointer(tools, child); assert.deepEqual((await evaluate(invoke(foldInfo))).alpha, [true, true, false]);
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), before);
    await capture?.("reading-folding-readonly");
    report.readingFolding = { ...(report.readingFolding ?? {}), cachedReadOnly: true, readOnlySourceAndConfigurationUnchanged: true };
    pass(report, "A genuine cache-only read-only Reading note uses actual pointer/keyboard nested folds and visible-text Find; collapsed heading navigation expands the right ancestors and retains its Source caret. Source and all configuration remain exact while the parent audits unchanged blobs and zero API/raw requests.");
  } catch (error) {
    try { report.readingFoldingReadOnlyFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),readOnly:app.vault.readOnly,folds:${invoke(foldInfo)},headings:${invoke(headingState)},focus:{documentFocused:document.hasFocus(),active:document.activeElement?.outerHTML.slice(0,800)},keyboard:globalThis.__readingFoldingKeyboard,panel:document.querySelector(${q(panel)})?.outerHTML.slice(0,4000)}))()`); await capture?.("reading-folding-readonly-precleanup-failure"); } catch { /* Keep the original assertion. */ }
    throw error;
  } finally {
    await findClose(tools); await evaluate('delete globalThis.__readingFoldingKeyboard;app.workspace.activeLeaf.view.setEditingMode("source",false)'); assert.equal(await evaluate("app.editor.getValue()"), text);
  }
}
