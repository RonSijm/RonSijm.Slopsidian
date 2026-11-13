import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, root = "app.workspace.activeLeaf.view.previewEl", scope = '[data-reading-lists-probe="current"]';
const panel = '[data-reading-search="true"]', query = panel + " [data-reading-search-query]";
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
function state() {
  const root = app.workspace.activeLeaf.view.previewEl, own = element => element.closest(".markdown-preview-view") === root;
  return { controls: [...root.querySelectorAll(".reading-list-fold-toggle")].filter(own).map(button => ({ line: Number(button.dataset.readingListFoldToggle), expanded: button.getAttribute("aria-expanded"), label: button.getAttribute("aria-label"), visible: button.checkVisibility() })),
    bodies: [...root.querySelectorAll("li > ul,li > ol")].filter(own).map(body => ({ line: Number(body.dataset.sourceLine), hidden: body.hasAttribute("hidden"), visible: body.checkVisibility() })),
    headings: [...root.querySelectorAll(".reading-fold-toggle")].filter(own).length, embedded: root.querySelectorAll(".markdown-embed .reading-list-fold-toggle").length,
    fixture: { processorCalls: globalThis.__readingListsProbe?.processorCalls, processorHosts: globalThis.__readingListsProbe?.processorHosts,
      loads: globalThis.__readingListsProbe?.loads, unloads: globalThis.__readingListsProbe?.unloads,
      plugins: [...root.querySelectorAll('[data-reading-lists-plugin]')].map(button => ({ visible: button.checkVisibility(), host: button.parentElement?.tagName, line: button.closest('li')?.dataset.sourceLine })),
      embeds: [...root.querySelectorAll('.markdown-embed-content.markdown-preview-view')].map(element => ({ visible: element.checkVisibility(), text: element.textContent.slice(0, 200) })) } };
}
async function installed(tools, path) {
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${root}.querySelectorAll('.reading-list-fold-toggle').length>=3`, "current main Reading nested-list controls");
  await tools.evaluate(`${root}.dataset.readingListsProbe="current"`);
}
async function reading(tools, path) {
  await tools.evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
  await installed(tools, path);
}
const control = line => scope + ` [data-reading-list-fold-toggle=${q(String(line))}]`;
async function pointer(tools, line) { await tools.click(control(line)); }
async function explicitlyExpandAll(tools) {
  const headings = await tools.evaluate(`[...${root}.querySelectorAll('.reading-fold-toggle')].filter(button=>button.closest('.markdown-preview-view')===${root}).map(button=>Number(button.dataset.readingFoldToggle))`);
  for (const line of headings) {
    const selector = scope + ` [data-reading-fold-toggle=${q(String(line))}]`;
    if (await tools.evaluate(`document.querySelector(${q(selector)}).getAttribute('aria-expanded')==="true"`)) await tools.click(selector);
    await tools.click(selector);
  }
  const lines = await tools.evaluate(`[...${root}.querySelectorAll('.reading-list-fold-toggle')].filter(button=>button.closest('.markdown-preview-view')===${root}).map(button=>Number(button.dataset.readingListFoldToggle))`);
  for (const line of lines) {
    if (await tools.evaluate(`document.querySelector(${q(control(line))}).getAttribute('aria-expanded')==="true"`)) await pointer(tools, line);
    await pointer(tools, line);
  }
}
async function keyboard(tools, line, key = "Enter") {
  await tools.command("Page.bringToFront");
  const before = await tools.evaluate(`(()=>{const button=document.querySelector(${q(control(line))});if(!button)throw Error("Missing current list fold control");button.scrollIntoView({block:"center"});button.focus({preventScroll:true});return{focused:document.activeElement===button,expanded:button.getAttribute("aria-expanded")}})()`);
  assert.equal(before.focused, true); assert.ok(["true", "false"].includes(before.expanded));
  const event = { key, code: key === " " ? "Space" : "Enter", windowsVirtualKeyCode: key === " " ? 32 : 13, nativeVirtualKeyCode: key === " " ? 32 : 13, modifiers: 0 }, text = key === " " ? " " : "\r";
  await tools.command("Input.dispatchKeyEvent", { type: "keyDown", ...event, text, unmodifiedText: text }); await tools.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  await tools.wait(`document.querySelector(${q(control(line))})?.getAttribute("aria-expanded")===${q(before.expanded === "true" ? "false" : "true")}`, "physical " + (key === " " ? "Space" : "Enter") + " toggles the actual list button");
}
async function expanded(tools, line, value) { assert.equal(await tools.evaluate(`document.querySelector(${q(control(line))})?.getAttribute("aria-expanded")`), String(value)); }
async function openFind(tools, text = "listneedle") {
  await tools.evaluate(`${root}.focus()`); await tools.press("f", "KeyF", 70, 2); await tools.wait(`Boolean(document.querySelector(${q(query)}))`, "Reading Find opens on list content");
  await tools.click(query); await tools.press("a", "KeyA", 65, 2); await tools.command("Input.insertText", { text });
}
async function count(tools, value) {
  await tools.wait(`document.querySelector(${q(panel)})?.dataset.readingSearchCount===${q(String(value))}`, "visible list Find count " + value);
  assert.equal(await tools.evaluate(`(()=>{const r=${root};return [...(CSS.highlights?.get("slopsidian-reading-search")??[])].filter(range=>r.contains(range.startContainer)).length})()`), value);
}
async function closeFind(tools) { if (await tools.evaluate(`Boolean(document.querySelector(${q(panel)}))`)) await tools.click(panel + ' button[name="close"]'); }
async function preference(tools, key, value) {
  const selector = `[data-editor-settings] [data-setting-key=${q(key)}] [role="switch"]`;
  if (!await tools.evaluate('document.querySelector("#settings-dialog").open')) await tools.click("#open-settings");
  await tools.click("#editor-settings-tab"); await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "real Editor folding control " + key);
  if (await tools.evaluate(`document.querySelector(${q(selector)}).getAttribute("aria-checked")==="true"`) !== value) await tools.click(selector);
  await tools.wait(`app.configuration.get("app",${q(key)})===${value}`, "accepted folding preference " + key); await tools.click(".settings-close");
}
function selectedPassage(line) {
  const root = app.workspace.activeLeaf.view.previewEl, li = [...root.querySelectorAll("li[data-source-line]")].find(element => element.closest(".markdown-preview-view") === root && Number(element.dataset.sourceLine) === line),
    paragraph = li && [...li.children].find(element => element.tagName === "P"), target = paragraph ?? li;
  if (!target?.checkVisibility()) throw Error("Expected a visible list passage");
  target.scrollIntoView({ block: "center" }); root.focus(); const range = root.ownerDocument.createRange();
  if (paragraph) range.selectNodeContents(paragraph);
  else { const text = [...li.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes("listneedle")); if (!text) throw Error("Missing list passage text node"); range.selectNodeContents(text); }
  const selection = root.ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(range); return range.toString();
}

/** Original nested lists fold in the current Reading view without editing text. */
export async function checkReadingListFolding(tools) {
  const { directory, evaluate, command, wait, report, restart, afterReload, capture } = tools;
  const folder = "Reading list folds", path = folder + "/Lists.md", embedded = folder + "/Embedded.md", other = folder + "/Other.md";
  const text = ["---", 'opaque: "Keep list folds λ"', "---", "# Reading lists", "", "- [ ] Parent A", "  - Child A", "    - grand listneedle ^list-block", "", "      ### Nested destination", "", "      leaf listneedle[^list-ref] and $a^2$.", "  - sibling listneedle", "", "1. Parent B", "   1. independent listneedle", "", "Outside listneedle.", "", "![[Embedded]]", "", "[^list-ref]: Endnote target remains outside the list.", ""].join("\r\n"),
    bytes = Buffer.from("\ufeff" + text), embeddedBytes = Buffer.from("\ufeff# Embedded\r\n\r\n- Embedded parent\r\n  - Embedded child\r\n"), otherBytes = Buffer.from("\ufeff# Other\r\n\r\n- Other parent\r\n  - Other child\r\n");
  const lines = text.split("\r\n"), a = lines.indexOf("- [ ] Parent A"), child = lines.indexOf("  - Child A"), b = lines.indexOf("1. Parent B"), deep = lines.indexOf("    - grand listneedle ^list-block"), target = lines.indexOf("      ### Nested destination"), sibling = lines.indexOf("  - sibling listneedle");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath),
    config = { ...JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, "")), markdownAutosave: false, foldHeading: true, foldIndent: true };
  await mkdir(join(directory, folder), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" }); await writeFile(join(directory, embedded), embeddedBytes, { flag: "wx" }); await writeFile(join(directory, other), otherBytes, { flag: "wx" });
  let stage = "pointer/keyboard/list identities";
  try {
    await writeFile(configPath, encode(config)); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source");app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "List history Ω" }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    await evaluate(`(()=>{const api=app.plugins.modules.obsidian,p=globalThis.__readingListsProbe={api,clicks:0,loads:0,unloads:0,processorCalls:0,processorHosts:0};p.processor=(element,context)=>{if(context.sourcePath!==${q(path)})return;p.processorCalls++;const item=element.querySelector('li[data-source-line="${sibling}"]');if(!item)return;const host=[...item.children].find(node=>node.tagName==='P')??item;p.processorHosts++;const button=document.createElement('button');button.type='button';button.textContent='List plugin';button.dataset.readingListsPlugin='';host.append(button);const child=new api.MarkdownRenderChild(button);child.onload=()=>p.loads++;child.onunload=()=>p.unloads++;child.registerDomEvent(button,'click',()=>p.clicks++);context.addChild(child)};api.MarkdownPreviewRenderer.registerPostProcessor(p.processor,10)})()`);
    await reading(tools, path); await wait(`${root}.querySelector('[data-reading-lists-plugin]')?.checkVisibility()&&${root}.querySelector('.markdown-embed-content.markdown-preview-view li')?.textContent.includes('Embedded parent')`, "original task/math/plugin/nested embed ready before list folding");
    const initial = await evaluate(invoke(state)); assert.equal(initial.controls.length, 3); assert.equal(initial.embedded, 0); assert.ok(initial.controls.every(item => item.expanded === "true" && item.label.startsWith("Collapse list item ")));
    await evaluate(`(()=>{const p=__readingListsProbe,r=${root};p.retained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection,lists:[...r.querySelectorAll('ul,ol,li')],task:r.querySelector('li.task-list-item input[type="checkbox"]'),plugin:r.querySelector('[data-reading-lists-plugin]'),math:r.querySelector('.math-inline'),embed:r.querySelector('.markdown-embed-content.markdown-preview-view'),loads:p.loads,unloads:p.unloads};if(!p.retained.task||!p.retained.plugin||!p.retained.math||!p.retained.embed)throw Error('Missing original list task/plugin/math/embed identity')})()`);
    await pointer(tools, child); await keyboard(tools, a); await pointer(tools, b); await keyboard(tools, a, " ");
    await expanded(tools, child, false); await expanded(tools, a, true); await expanded(tools, b, false); await pointer(tools, child); await pointer(tools, b);
    assert.equal(await evaluate(`(()=>{const p=__readingListsProbe,s=p.retained,r=${root};return app.editor===s.editor&&app.editor.cm===s.cm&&app.editor.cm.state.doc===s.doc&&app.editor.cm.state.selection.eq(s.selection)&&s.lists.every(node=>r.contains(node))&&r.querySelector('li.task-list-item input[type="checkbox"]')===s.task&&r.querySelector('[data-reading-lists-plugin]')===s.plugin&&r.querySelector('.math-inline')===s.math&&r.querySelector('.markdown-embed-content.markdown-preview-view')===s.embed&&p.loads===s.loads&&p.unloads===s.unloads})()`), true);
    await tools.click(scope + ' [data-reading-lists-plugin]'); assert.equal(await evaluate("__readingListsProbe.clicks"), 1); assert.deepEqual(await readFile(join(directory, path)), bytes);
    await evaluate(`(async()=>{const p=__readingListsProbe;p.staticOwner=new p.api.Component();await p.staticOwner.load();p.staticHost=document.createElement('div');document.body.append(p.staticHost);await p.api.MarkdownRenderer.render(app,${q("- Static parent\n  - Static child\n")},p.staticHost,${q(path)},p.staticOwner)})()`);
    assert.equal(await evaluate("__readingListsProbe.staticHost.querySelectorAll('.reading-list-fold-toggle').length"), 0); await evaluate("(async()=>{await __readingListsProbe.staticOwner.unloadAndWait();__readingListsProbe.staticHost.remove()})()");
    pass(report, "Actual pointer and full Enter/Space list buttons fold nested bullet/ordered bodies independently, keep a child choice across parent expansion, and retain original list/task/math/embed/plugin nodes and listeners, hidden Source CodeMirror/document/selection/history and exact BOM/CRLF bytes. Embedded lists have no controls.");

    stage = "Find visibility and captured passages";
    await openFind(tools); await count(tools, 5); await pointer(tools, child); await count(tools, 3); await pointer(tools, a); await count(tools, 2); await pointer(tools, b); await count(tools, 1);
    await pointer(tools, a); await count(tools, 2); await pointer(tools, child); await count(tools, 4); await pointer(tools, b); await count(tools, 5);
    assert.ok((await evaluate(invoke(selectedPassage, deep))).includes("listneedle")); await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    await tools.click(panel + ' [data-reading-search-use-selection]'); await count(tools, 1); await pointer(tools, child); await count(tools, 0);
    assert.equal(await evaluate(`document.querySelector(${q(panel)}).dataset.readingSearchScope`), "stale"); assert.equal(await evaluate(`document.querySelector(${q(query)}).value`), "listneedle");
    await tools.click(panel + ' [name="selection"]'); await count(tools, 3); await pointer(tools, child); await count(tools, 5); await closeFind(tools);
    pass(report, "Reading Find synchronously prunes collapsed list text and native paint while retaining outside/independent matches. Folding makes an explicitly captured list passage stale without changing its query or expanding hidden bodies; disabling In selection and explicit expansion recover the correct counts.");

    stage = "list/heading/block/footnote reveal";
    await pointer(tools, child); await pointer(tools, a); await evaluate(`app.workspace.openLinkText(${q(path + "#^list-block")},${q(path)})`);
    await wait(`app.editor.getCursor().line===${deep}`, "collapsed nested block link keeps its resolved Source caret"); await expanded(tools, a, true); await expanded(tools, child, true);
    await pointer(tools, child); await pointer(tools, a); const heading = await evaluate(`Number(${root}.querySelector('h1 .reading-fold-toggle').dataset.readingFoldToggle)`); await tools.click(scope + ` [data-reading-fold-toggle=${q(String(heading))}]`);
    await evaluate(`app.workspace.activeLeaf.view.revealHeading("#Nested destination")`); await expanded(tools, a, true); await expanded(tools, child, true);
    assert.equal(await evaluate(`${root}.querySelector('h3[data-source-line="${target}"]').checkVisibility()`), true);
    await tools.click(scope + ' .footnote-ref [role="doc-noteref"]'); await wait('document.activeElement?.dataset.footnoteNumber==="1"', "forward footnote reaches appended endnote");
    await pointer(tools, child); await pointer(tools, a); await tools.click(scope + " .footnote-backref"); await expanded(tools, a, true); await expanded(tools, child, true);
    assert.equal(await evaluate('document.activeElement?.getAttribute("role")'), "doc-noteref");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.redo()'); assert.equal(await evaluate("app.editor.getValue()"), text + "List history Ω"); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text); await reading(tools, path); await explicitlyExpandAll(tools);
    pass(report, "Block and heading destinations reveal owning list and heading ancestors before scroll geometry; a footnote return expands the nested reference list. Explicit block navigation retains its Source caret and Source redo/undo history remains exact without saving note edits.");

    stage = "independent settings and narrow controls";
    await preference(tools, "foldHeading", false); assert.equal((await evaluate(invoke(state))).headings, 0); assert.equal((await evaluate(invoke(state))).controls.length, 3);
    await pointer(tools, a); await preference(tools, "foldIndent", false); await wait(`${root}.querySelectorAll('.reading-list-fold-toggle').length===0&&!${root}.querySelector('li>ul[hidden],li>ol[hidden]')`, "Fold lists off removes Reading controls and expands owned bodies");
    await preference(tools, "foldHeading", true); assert.equal((await evaluate(invoke(state))).controls.length, 0); await preference(tools, "foldIndent", true); await installed(tools, path);
    await explicitlyExpandAll(tools);
    await pointer(tools, a); await writeFile(configPath, encode({ ...config, foldIndent: false })); await evaluate('app.configuration.refresh("app")'); await wait(`${root}.querySelectorAll('.reading-list-fold-toggle').length===0`, "external accepted Fold lists false clears Reading layer");
    await writeFile(configPath, encode({ ...config, foldIndent: "false" })); await evaluate('app.configuration.refresh("app")'); await installed(tools, path); assert.equal(await evaluate('app.configuration.get("app","foldIndent")'), "false");
    assert.equal(JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, "")).foldIndent, "false"); await writeFile(configPath, encode(config)); await evaluate('app.configuration.refresh("app")');
    await explicitlyExpandAll(tools);
    const sectionStyle = await evaluate(`${root}.firstElementChild.getAttribute("style")`);
    try {
      await evaluate(`${root}.firstElementChild.style.width="320px";${root}.firstElementChild.style.maxWidth="320px"`); await pointer(tools, a);
      const geometry = await evaluate(`(()=>{const r=${root}.firstElementChild,box=r.getBoundingClientRect(),overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;return{width:box.width,controls:[...r.querySelectorAll('.reading-list-fold-toggle')].filter(button=>button.checkVisibility()).map(button=>{const item=button.parentElement,b=button.getBoundingClientRect(),li=item.getBoundingClientRect(),task=item.querySelector(':scope>input[type="checkbox"],:scope>p>input[type="checkbox"]'),walker=item.ownerDocument.createTreeWalker(item,NodeFilter.SHOW_TEXT);let text=null;while(walker.nextNode()){const node=walker.currentNode;if(node.textContent.trim()&&node.parentElement.closest('li')===item&&!node.parentElement.closest('button')){text=node;break}}const range=item.ownerDocument.createRange();if(text)range.selectNodeContents(text);const label=text?[...range.getClientRects()].find(rect=>rect.width>0&&rect.height>0):null;return b.width>0&&b.height>0&&b.left>=box.left-1&&b.right<=box.right+1&&b.top>=li.top-2&&b.bottom<=li.bottom+2&&Boolean(label)&&!overlap(b,label)&&(!task||!overlap(b,task.getBoundingClientRect()))})}})()`);
      assert.ok(geometry.width <= 321 && geometry.controls.length === 2 && geometry.controls.every(Boolean), JSON.stringify(geometry)); await capture?.("reading-lists-narrow");
    } finally { await evaluate(`(()=>{const section=${root}.firstElementChild;if(${q(sectionStyle)}===null)section.removeAttribute("style");else section.setAttribute("style",${q(sectionStyle)})})()`); }
    await pointer(tools, a);
    pass(report, "Real Fold headings and Fold lists settings act independently in Reading; disabling lists expands bodies without changing text/history. Accepted external false removes controls and malformed imports use the true default without rewriting raw values. Visible list buttons remain readable within a320px section.");

    stage = "pending/external/stale owners";
    await evaluate(`(()=>{const p=__readingListsProbe;p.held=document.querySelector(${q(control(a))});p.blocking=(element,context)=>{if(context.sourcePath!==${q(path)}||p.pending)return;p.pending=true;return new Promise(resolve=>p.resume=resolve)};p.api.MarkdownPreviewRenderer.registerPostProcessor(p.blocking,0)})()`);
    await wait("Boolean(__readingListsProbe.resume)", "real pending processor owns obsolete list render");
    await writeFile(join(directory, path), Buffer.from("\ufeff" + text.replace("Parent A", "External Parent A")));
    await wait(`${root}.querySelector('[data-reading-list-fold-toggle="${a}"]')?.getAttribute('aria-label').includes('External Parent A')`, "external source creates fresh list controls while old processor remains pending");
    await evaluate("__readingListsProbe.held.click();__readingListsProbe.resume();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))"); assert.ok((await evaluate(invoke(state))).controls.every(item => item.expanded === "true"));
    await evaluate("__readingListsProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__readingListsProbe.blocking)"); await writeFile(join(directory, path), bytes);
    await wait(`app.editor.getValue()===${q(text)}&&${root}.querySelector('[data-reading-list-fold-toggle="${a}"]')?.getAttribute('aria-label')==='Collapse list item Parent A'`, "exact source refresh restores fresh list ownership");
    await evaluate(`(()=>{__readingListsProbe.modeHeld=document.querySelector(${q(control(a))});app.workspace.activeLeaf.view.setEditingMode("source",false);__readingListsProbe.modeHeld.click()})()`); await reading(tools, path); await evaluate("__readingListsProbe.modeHeld.click()"); assert.ok((await evaluate(invoke(state))).controls.every(item => item.expanded === "true"));
    await evaluate(`(()=>{__readingListsProbe.fileHeld=document.querySelector(${q(control(a))})})()`); await evaluate(`(async()=>{await app.openFile(${q(other)});app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
    await evaluate("__readingListsProbe.fileHeld.click()"); assert.equal((await evaluate(invoke(state))).bodies.some(body => body.hidden), false); await reading(tools, path);
    await evaluate("__readingListsProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__readingListsProbe.processor)"); await wait(`!${root}.querySelector('[data-reading-lists-plugin]')&&${root}.querySelectorAll('.reading-list-fold-toggle').length===3`, "processor unload installs current list layer");
    pass(report, "An actual pending processor cannot revive controls after physical source refresh. Retained controls from obsolete source/mode/file owners and resumed jobs cannot hide the replacement; plugin unload preserves current list ownership and exact source bytes.");

    stage = "restored initial Reading";
    await pointer(tools, a); await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload(); await installed(tools, path);
    await expanded(tools, a, false); await pointer(tools, a); assert.ok((await evaluate(invoke(state))).controls.every(item => item.expanded === "true")); await keyboard(tools, a); await expanded(tools, a, false); await pointer(tools, a);
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(join(directory, embedded)), embeddedBytes); assert.deepEqual(await readFile(join(directory, other)), otherBytes);
    report.readingListFolding = { pointerAndEnterSpace: true, nestedAndDisjointBulletOrdered: true, originalDomTasksPluginsMathEmbeds: true, hiddenSourceSelectionHistoryExactBytes: true, mainViewOnly: true, findVisibleCountsAndPaint: true, capturedScopeInvalidation: true, headingBlockFootnoteReveal: true, sourceCaret: true, independentHeadingListPreferences: true, invalidExternalDefaultNoRewrite: true, narrow320: true, pendingExternalModeFileOwnership: true, startupRestart: true, persistedListChoice: true };
    pass(report, "Full native restart or actual-folder reconnection restores initial Reading with the user's persisted nested-list fold and immediately usable controls. Exact physical note/embed bytes plus fresh pointer/keyboard expansion and recollapse remain intact.");
  } catch (error) {
    try { report.readingListFoldingFailure = { stage, ...await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),source:app.editor.getValue(),state:${invoke(state)},panel:document.querySelector(${q(panel)})?.outerHTML.slice(0,3000)}))()`) }; await capture?.("reading-lists-precleanup-failure"); } catch { report.readingListFoldingFailure ??= { stage }; }
    throw error;
  } finally {
    await closeFind(tools); if (await evaluate("Boolean(globalThis.__readingListsProbe)")) await evaluate("(async()=>{const p=__readingListsProbe;p.resume?.();if(p.blocking)p.api.MarkdownPreviewRenderer.unregisterPostProcessor(p.blocking);p.api.MarkdownPreviewRenderer.unregisterPostProcessor(p.processor);await p.staticOwner?.unloadAndWait();p.staticHost?.remove();delete globalThis.__readingListsProbe})()");
    await writeFile(join(directory, path), bytes); await writeFile(configPath, originalConfig);
    await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();for(const root of document.querySelectorAll('[data-reading-lists-probe]'))delete root.dataset.readingListsProbe})()`);
  }
}

/** Parent owns zero-request and exact cached blob audits through local return. */
export async function checkReadingListFoldingReadOnly(tools) {
  const { evaluate, wait, report, capture } = tools; assert.equal(await evaluate("app.vault.readOnly"), true); assert.notEqual(await evaluate('app.configuration.get("app","foldIndent")??null'), false);
  await reading(tools, "Read only.md"); const text = await evaluate("app.editor.getValue()"), lines = text.split(/\r?\n/), a = lines.indexOf("- [ ] Parent A"), child = lines.indexOf("  - Child A"), b = lines.indexOf("1. Parent B"), deep = lines.findIndex(line => line.includes("listneedle cached ^list-block"));
  assert.ok(a >= 0 && child > a && b > child && deep > child); assert.equal((text.match(/\blistneedle\b/g) ?? []).length, 3);
  const before = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  try {
    await pointer(tools, child); await keyboard(tools, a); await keyboard(tools, a, " "); await expanded(tools, child, false); await pointer(tools, child);
    await openFind(tools); await count(tools, 3); await pointer(tools, a); await count(tools, 1); await pointer(tools, b); await count(tools, 0); await closeFind(tools);
    await evaluate('app.workspace.openLinkText("Read only.md#^list-block","Read only.md")'); await wait(`app.editor.getCursor().line===${deep}`, "cached nested block reveal retains resolved Source caret"); await expanded(tools, a, true); await expanded(tools, child, true); await expanded(tools, b, false);
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), before); await capture?.("reading-lists-readonly");
    report.readingListFolding = { ...(report.readingListFolding ?? {}), cachedReadOnly: true, readOnlySourceAndConfigExact: true };
    pass(report, "A genuine cache-only read-only Reading note permits actual nested pointer/Enter/Space folding, visible-text Find and collapsed block navigation with its exact Source return caret. Source/configuration stay unchanged while the parent audits every cached blob and zero API/raw traffic.");
  } catch (error) {
    try { report.readingListFoldingReadOnlyFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),readOnly:app.vault.readOnly,state:${invoke(state)},panel:document.querySelector(${q(panel)})?.outerHTML.slice(0,3000)}))()`); await capture?.("reading-lists-readonly-precleanup-failure"); } catch { /* Keep original assertion. */ }
    throw error;
  } finally { await closeFind(tools); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);delete app.workspace.activeLeaf.view.previewEl.dataset.readingListsProbe'); assert.equal(await evaluate("app.editor.getValue()"), text); }
}
