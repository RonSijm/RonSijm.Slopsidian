import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, root = "app.workspace.activeLeaf.view.previewEl", scope = '[data-reading-fold-state-probe="current"]', key = "fold-state-v1";
const panel = '[data-reading-search="true"]', query = panel + " [data-reading-search-query]";
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
function state() {
  const root = app.workspace.activeLeaf.view.previewEl, own = element => element.closest(".markdown-preview-view") === root;
  return { headings: [...root.querySelectorAll(".reading-fold-toggle")].filter(own).map(button => ({ line: Number(button.dataset.readingFoldToggle), expanded: button.getAttribute("aria-expanded"), visible: button.checkVisibility() })),
    lists: [...root.querySelectorAll(".reading-list-fold-toggle")].filter(own).map(button => ({ line: Number(button.dataset.readingListFoldToggle), expanded: button.getAttribute("aria-expanded"), visible: button.checkVisibility() })),
    hidden: [...root.querySelectorAll("[hidden]")].filter(own).map(element => Number(element.dataset.sourceLine)),
    embeddedControls: root.querySelectorAll(".markdown-embed .reading-fold-toggle,.markdown-embed .reading-list-fold-toggle").length };
}
function remembered(path) {
  return (app.loadLocalStorage("fold-state-v1")?.records ?? []).filter(record => record.path === path && record.channel.startsWith("reading-"))
    .sort((a, b) => a.channel.localeCompare(b.channel));
}
const selector = (kind, line) => scope + ` [data-reading-${kind === "headings" ? "fold" : "list-fold"}-toggle=${q(String(line))}]`;
async function installed(tools, path) {
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&${root}.querySelector('.reading-fold-toggle')&&${root}.querySelector('.reading-list-fold-toggle')`, "current Reading heading and list fold persistence controls");
  await tools.evaluate(`(()=>{for(const old of document.querySelectorAll('[data-reading-fold-state-probe]'))delete old.dataset.readingFoldStateProbe;${root}.dataset.readingFoldStateProbe="current"})()`);
}
async function reading(tools, path) {
  await tools.evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
  await installed(tools, path);
}
async function pointer(tools, kind, line) {
  await tools.evaluate(`document.querySelector(${q(selector(kind, line))}).scrollIntoView({block:"center"})`);
  await tools.click(selector(kind, line));
}
async function expanded(tools, kind, line, value) { assert.equal(await tools.evaluate(`document.querySelector(${q(selector(kind, line))})?.getAttribute('aria-expanded')`), String(value)); }
async function setExpanded(tools, kind, line, value) {
  if (await tools.evaluate(`document.querySelector(${q(selector(kind, line))})?.getAttribute('aria-expanded')==="true"`) !== value) await pointer(tools, kind, line);
  await expanded(tools, kind, line, value);
}
async function keyboard(tools, kind, line, space = false) {
  const selected = selector(kind, line), before = await tools.evaluate(`(()=>{const button=document.querySelector(${q(selected)});button.scrollIntoView({block:"center"});button.focus({preventScroll:true});return {focused:document.activeElement===button,expanded:button.getAttribute('aria-expanded')}})()`);
  assert.equal(before.focused, true); await tools.command("Page.bringToFront");
  const event = { key: space ? " " : "Enter", code: space ? "Space" : "Enter", windowsVirtualKeyCode: space ? 32 : 13, nativeVirtualKeyCode: space ? 32 : 13, modifiers: 0 }, text = space ? " " : "\r";
  await tools.command("Input.dispatchKeyEvent", { type: "keyDown", ...event, text, unmodifiedText: text }); await tools.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  await tools.wait(`document.querySelector(${q(selected)})?.getAttribute('aria-expanded')===${q(before.expanded === "true" ? "false" : "true")}`, "physical Reading " + (space ? "Space" : "Enter") + " changes persisted " + kind);
}
async function assertRemembered(tools, path, headings, lists) {
  const records = await tools.evaluate(invoke(remembered, path));
  assert.deepEqual(records.map(record => [record.channel, record.value]), [["reading-headings", headings], ["reading-lists", lists]]);
  assert.ok(records.every(record => /^[a-f0-9]{64}$/.test(record.source) && Number.isSafeInteger(record.length)));
  assert.equal(records[0].source, records[1].source); return records;
}
async function closeFind(tools) { if (await tools.evaluate(`Boolean(document.querySelector(${q(panel)}))`)) await tools.click(panel + ' button[name="close"]'); }
async function preference(tools, name, value) {
  const target = `[data-editor-settings] [data-setting-key=${q(name)}] [role="switch"]`;
  if (!await tools.evaluate('document.querySelector("#settings-dialog").open')) await tools.click("#open-settings");
  await tools.click("#editor-settings-tab"); await tools.wait(`Boolean(document.querySelector(${q(target)}))`, "real " + name + " preference");
  if (await tools.evaluate(`document.querySelector(${q(target)}).getAttribute('aria-checked')==="true"`) !== value) await tools.click(target);
  await tools.wait(`app.configuration.get("app",${q(name)})===${value}`, "accepted " + name + " preference"); await tools.click(".settings-close");
}

/** Actual original controls persist independent Reading choices in the profile. */
export async function checkReadingFoldState(tools) {
  const { directory, evaluate, command, wait, report, restart, afterReload, capture } = tools;
  const folder = "Reading persisted folds", path = folder + "/State.md", other = folder + "/Other.md", embedded = folder + "/Embedded.md";
  const text = ["---", 'opaque: "Remember only local folds λ"', "---", "# Persisted Reading", "", "Introduction.", "", "## Parent A", "", "- [ ] Parent list", "  - Child list", "    - persistneedle deep ^persist-block", "  - persistneedle sibling", "", "### Nested heading", "", "persistneedle nested body.", "", "Plugin anchor.", "", "$x^2$", "", "![[Embedded]]", "", "## Parent B", "", "1. Other list", "   1. persistneedle independent", "", "persistneedle outside.", ""].join("\r\n");
  const bytes = Buffer.from("\ufeff" + text), otherBytes = Buffer.from("\ufeff# Other\r\n\r\n- Other parent\r\n  - Other child\r\n"), embedBytes = Buffer.from("\ufeff# Embedded\r\n\r\n- Embedded parent\r\n  - Embedded child\r\n");
  const lines = text.split("\r\n"), a = lines.indexOf("## Parent A"), childHeading = lines.indexOf("### Nested heading"), list = lines.indexOf("- [ ] Parent list"), child = lines.indexOf("  - Child list"), bList = lines.indexOf("1. Other list"), deep = lines.indexOf("    - persistneedle deep ^persist-block");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), localRoot = await evaluate("app.vault.rootPath"), originalProfile = await evaluate(`app.loadLocalStorage(${q(key)})`), configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath);
  const config = { ...JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, "")), markdownAutosave: false, foldHeading: true, foldIndent: true };
  await mkdir(join(directory, folder), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" }); await writeFile(join(directory, other), otherBytes, { flag: "wx" }); await writeFile(join(directory, embedded), embedBytes, { flag: "wx" });
  let stage = "original controls and explicit intent";
  const collapse = async () => {
    await setExpanded(tools, "headings", a, true); await setExpanded(tools, "lists", list, true);
    await setExpanded(tools, "lists", child, false); await setExpanded(tools, "headings", childHeading, false); await setExpanded(tools, "lists", bList, false);
    await setExpanded(tools, "lists", list, false); await setExpanded(tools, "headings", a, false);
  };
  try {
    await writeFile(configPath, encode(config)); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "Remembered history Ω" }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    await evaluate(`(()=>{const api=app.plugins.modules.obsidian,p=globalThis.__readingFoldStateProbe={api,loads:0,unloads:0,clicks:0};p.processor=(element,context)=>{if(context.sourcePath!==${q(path)})return;const host=[...element.querySelectorAll('p')].find(p=>p.textContent==='Plugin anchor.');if(!host)return;const button=document.createElement('button');button.type='button';button.dataset.readingFoldStatePlugin='';button.textContent='Retained fold plugin';host.append(button);const child=new api.MarkdownRenderChild(button);child.onload=()=>p.loads++;child.onunload=()=>p.unloads++;child.registerDomEvent(button,'click',()=>p.clicks++);context.addChild(child)};api.MarkdownPreviewRenderer.registerPostProcessor(p.processor,10)})()`);
    await reading(tools, path); await wait(`${root}.querySelector('[data-reading-fold-state-plugin]')&&${root}.querySelector('.math-inline')&&${root}.querySelector('.markdown-embed-content.markdown-preview-view li')`, "original plugin math task and embed ready");
    assert.equal((await evaluate(invoke(state))).embeddedControls, 0);
    await evaluate(`(()=>{const p=__readingFoldStateProbe,r=${root};p.retained={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection,blocks:[...r.firstElementChild.children],lists:[...r.querySelectorAll('ul,ol,li')],task:r.querySelector('input[type="checkbox"]'),plugin:r.querySelector('[data-reading-fold-state-plugin]'),math:r.querySelector('.math-inline'),embed:r.querySelector('.markdown-embed-content.markdown-preview-view'),loads:p.loads,unloads:p.unloads}})()`);
    await keyboard(tools, "lists", child); await pointer(tools, "headings", childHeading); await keyboard(tools, "lists", bList, true); await pointer(tools, "lists", list); await keyboard(tools, "headings", a);
    const initial = await assertRemembered(tools, path, [a, childHeading], [list, child, bList]);
    assert.equal(await evaluate(`(()=>{const p=__readingFoldStateProbe,s=p.retained,r=${root};return app.editor===s.editor&&app.editor.cm===s.cm&&app.editor.cm.state.doc===s.doc&&app.editor.cm.state.selection.eq(s.selection)&&s.blocks.every((node,index)=>r.firstElementChild.children[index]===node)&&s.lists.every(node=>r.contains(node))&&r.querySelector('input[type="checkbox"]')===s.task&&r.querySelector('[data-reading-fold-state-plugin]')===s.plugin&&r.querySelector('.math-inline')===s.math&&r.querySelector('.markdown-embed-content.markdown-preview-view')===s.embed&&p.loads===s.loads&&p.unloads===s.unloads})()`), true);
    assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(configPath), encode(config)); await capture?.("reading-fold-state-collapsed");
    pass(report, "Actual pointer, Enter and Space heading/list buttons persist independent nested and disjoint user choices while original rendered blocks, lists, tasks, plugin listeners, math/embeds, hidden Source document/selection/history and exact BOM/CRLF note/configuration bytes remain intact.");

    stage = "reread temporary reveal Find and preferences";
    await reading(tools, other); await reading(tools, path); await expanded(tools, "headings", a, false); await expanded(tools, "headings", childHeading, false); await expanded(tools, "lists", list, false); await expanded(tools, "lists", child, false); await expanded(tools, "lists", bList, false);
    await evaluate(`app.workspace.openLinkText(${q(path + "#^persist-block")},${q(path)})`); await wait(`app.editor.getCursor().line===${deep}`, "persisted collapsed block resolves the exact hidden Source caret");
    await expanded(tools, "headings", a, true); await expanded(tools, "headings", childHeading, false); await expanded(tools, "lists", list, true); await expanded(tools, "lists", child, true); await expanded(tools, "lists", bList, false);
    assert.deepEqual(await evaluate(invoke(remembered, path)), initial);
    await evaluate(`${root}.focus()`); await tools.press("f", "KeyF", 70, 2); await wait(`Boolean(document.querySelector(${q(query)}))`, "Find opens after temporary persisted-fold reveal");
    await tools.click(query); await command("Input.insertText", { text: "persistneedle" }); await wait(`document.querySelector(${q(panel)}).dataset.readingSearchCount==="3"`, "Find counts only temporarily visible deep sibling and outside text");
    await closeFind(tools); assert.deepEqual(await evaluate(invoke(remembered, path)), initial); await capture?.("reading-fold-state-revealed");
    await preference(tools, "foldHeading", false); await preference(tools, "foldIndent", false); assert.equal((await evaluate(invoke(state))).headings.length, 0); assert.equal((await evaluate(invoke(state))).lists.length, 0); assert.equal((await evaluate(invoke(state))).hidden.length, 0);
    assert.deepEqual(await evaluate(invoke(remembered, path)), initial); await preference(tools, "foldHeading", true); await preference(tools, "foldIndent", true); await installed(tools, path);
    const rememberedConfiguration = await readFile(configPath);
    await expanded(tools, "headings", a, false); await expanded(tools, "lists", list, false); assert.deepEqual(await evaluate(invoke(remembered, path)), initial);
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.redo()'); assert.equal(await evaluate("app.editor.getValue()"), text + "Remembered history Ω"); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text); await reading(tools, path);
    await expanded(tools, "headings", a, false); await expanded(tools, "lists", list, false);
    pass(report, "Rereading restores exact-source heading/list choices. Block navigation temporarily reveals only ancestors and retains its Source caret; Find sees visible text without rewriting intent. Turning both preferences off expands/removes controls, and turning them on restores remembered choices without disturbing Source redo/undo.");

    stage = "duplicate panes hidden and stale controls";
    await evaluate(`(async()=>{const p=__readingFoldStateProbe;p.first=app.workspace.activeLeaf;p.second=await app.workspace.duplicateLeaf(p.first,"split");app.workspace.setActiveLeaf(p.second,{focus:false});p.second.view.setEditingMode("preview",false);await p.second.view.currentMode.whenReady()})()`); await installed(tools, path);
    await expanded(tools, "headings", a, false); await evaluate("app.workspace.setActiveLeaf(__readingFoldStateProbe.first,{focus:false})"); await installed(tools, path); await pointer(tools, "headings", a);
    assert.equal(await evaluate(`__readingFoldStateProbe.second.view.previewEl.querySelector('[data-reading-fold-toggle="${a}"]').getAttribute('aria-expanded')`), "false");
    await evaluate("app.workspace.setActiveLeaf(__readingFoldStateProbe.second,{focus:false})"); await installed(tools, path); await pointer(tools, "lists", bList);
    assert.equal(await evaluate(`__readingFoldStateProbe.first.view.previewEl.querySelector('[data-reading-list-fold-toggle="${bList}"]').getAttribute('aria-expanded')`), "false");
    const lastView = await assertRemembered(tools, path, [childHeading], [list, child]);
    await evaluate(`(async()=>{await __readingFoldStateProbe.second.detach();app.workspace.setActiveLeaf(__readingFoldStateProbe.first,{focus:false});const p=__readingFoldStateProbe;p.hiddenHeld=p.first.view.previewEl.querySelector('[data-reading-fold-toggle="${a}"]');p.first.view.setEditingMode("source",false);p.hiddenHeld.click()})()`);
    assert.deepEqual(await evaluate(invoke(remembered, path)), lastView); await reading(tools, path); await evaluate("__readingFoldStateProbe.hiddenHeld.click()"); assert.deepEqual(await evaluate(invoke(remembered, path)), lastView);
    await expanded(tools, "headings", a, true); await expanded(tools, "headings", childHeading, false); await expanded(tools, "lists", bList, true);
    await evaluate(`void (__readingFoldStateProbe.fileHeld=document.querySelector(${q(selector("lists", list))}))`); await reading(tools, other); await evaluate("__readingFoldStateProbe.fileHeld.click()"); await reading(tools, path); assert.deepEqual(await evaluate(invoke(remembered, path)), lastView);
    await collapse(); await assertRemembered(tools, path, [a, childHeading], [list, child, bList]);
    pass(report, "Two real split Reading panes keep independent visible controls. The last explicit action wins each heading/list profile channel; closing a pane, hidden Source-mode controls and held controls from an earlier file never overwrite the chosen state. Rereading applies those choices without live pane mirroring.");

    stage = "same-line source mismatch and profile fallback";
    const intended = await evaluate(invoke(remembered, path)), fullProfile = await evaluate(`app.loadLocalStorage(${q(key)})`), changed = text.replace("## Parent A", "## Parent Z");
    assert.equal(changed.length, text.length); assert.equal(changed.split("\r\n").length, lines.length);
    await writeFile(join(directory, path), Buffer.from("\ufeff" + changed)); await wait(`app.editor.getValue()===${q(changed)}&&${root}.querySelector('[data-reading-fold-toggle="${a}"]')?.getAttribute('aria-label')==='Collapse heading Parent Z'`, "same-length same-line-count external edit refuses old folds");
    assert.ok((await evaluate(invoke(state))).headings.every(button => button.expanded === "true")); assert.ok((await evaluate(invoke(state))).lists.every(button => button.expanded === "true")); assert.deepEqual(await evaluate(invoke(remembered, path)), intended);
    await writeFile(join(directory, path), bytes); await wait(`app.editor.getValue()===${q(text)}&&${root}.querySelector('[data-reading-fold-toggle="${a}"]')?.getAttribute('aria-expanded')==='false'`, "exact original source regains its remembered folds");
    await evaluate(`app.saveLocalStorage(${q(key)},{version:1,records:[{channel:"reading-headings",path:${q(path)},source:"corrupt",length:1,value:[${a}]}]})`); await reading(tools, other); await reading(tools, path);
    assert.ok((await evaluate(invoke(state))).headings.every(button => button.expanded === "true")); assert.ok((await evaluate(invoke(state))).lists.every(button => button.expanded === "true")); await pointer(tools, "headings", a); await pointer(tools, "headings", a);
    assert.equal(await evaluate(`app.loadLocalStorage(${q(key)}).records.every(record=>/^[a-f0-9]{64}$/.test(record.source))`), true);
    await evaluate(`app.saveLocalStorage(${q(key)},${q(fullProfile)})`); await reading(tools, other); await reading(tools, path);
    await evaluate(`(()=>{const p=__readingFoldStateProbe;p.save=app.saveLocalStorage;app.saveLocalStorage=function(name,value){if(name===${q(key)})throw Error("Expected denied fold profile");return p.save.call(this,name,value)}})()`);
    try { await pointer(tools, "headings", a); await expanded(tools, "headings", a, true); assert.deepEqual(await evaluate(invoke(remembered, path)), intended); }
    finally { await evaluate("app.saveLocalStorage=__readingFoldStateProbe.save;delete __readingFoldStateProbe.save"); }
    await reading(tools, other); await reading(tools, path); await expanded(tools, "headings", a, false); assert.deepEqual(await evaluate(invoke(remembered, path)), intended);
    assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(join(directory, other)), otherBytes); assert.deepEqual(await readFile(join(directory, embedded)), embedBytes); assert.deepEqual(await readFile(configPath), rememberedConfiguration);
    pass(report, "A same-length, same-line-count physical source edit refuses prior folds, and restoring the exact source restores them. Corrupt profile records fall back expanded and genuine controls repair them; a denied profile write still permits folding without changing saved intent, note bytes or configuration.");

    stage = "full restart restoration";
    await evaluate("__readingFoldStateProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__readingFoldStateProbe.processor)"); await wait(`!${root}.querySelector('[data-reading-fold-state-plugin]')&&${root}.querySelector('[data-reading-fold-toggle="${a}"]')?.getAttribute('aria-expanded')==='false'`, "processor cleanup retains exact-source preferences");
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload(); await installed(tools, path);
    await expanded(tools, "headings", a, false); await expanded(tools, "headings", childHeading, false); await expanded(tools, "lists", list, false); await expanded(tools, "lists", child, false); await expanded(tools, "lists", bList, false);
    await assertRemembered(tools, path, [a, childHeading], [list, child, bList]); assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(configPath), rememberedConfiguration); await capture?.("reading-fold-state-restored");
    await keyboard(tools, "headings", a); await expanded(tools, "headings", a, true); await pointer(tools, "headings", a); await expanded(tools, "headings", a, false);
    report.readingFoldState = { actualPointerEnterSpace: true, headingsAndNestedLists: true, originalDomAndHiddenSourceHistory: true, exactBomCrLfBytes: true, reread: true, temporaryRevealIntent: true, visibleFind: true, independentPreferences: true, lastViewWinsWithoutMirroring: true, hiddenAndStaleRefusal: true, sameLineCountSourceRefusal: true, corruptProfileFallback: true, storageFailureStillFolds: true, restartRestoration: true, profileOnly: true };
    pass(report, "Full native restart or fresh browser document/reconnection restores both original Reading heading and nested-list choices with immediately usable controls, exact note/embed/configuration bytes and profile-only state. Processor cleanup cannot replace the explicit user preference.");
  } catch (error) {
    try { report.readingFoldStateFailure = { stage, ...await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),source:app.editor.getValue(),folds:${invoke(state)},profile:${invoke(remembered, path)}}))()`) }; await capture?.("reading-fold-state-precleanup-failure"); } catch { report.readingFoldStateFailure ??= { stage }; }
    throw error;
  } finally {
    if (await evaluate("app.vault.rootPath").catch(() => null) === localRoot) {
      await closeFind(tools); await evaluate("(()=>{const p=globalThis.__readingFoldStateProbe;if(p){if(p.save)app.saveLocalStorage=p.save;if(p.processor)p.api.MarkdownPreviewRenderer.unregisterPostProcessor(p.processor)}delete globalThis.__readingFoldStateProbe;for(const element of document.querySelectorAll('[data-reading-fold-state-probe]'))delete element.dataset.readingFoldStateProbe})()");
      await writeFile(join(directory, path), bytes); await writeFile(configPath, originalConfig); await evaluate(`(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();app.saveLocalStorage(${q(key)},${q(originalProfile)})})()`);
    }
  }
}

/** Parent audits genuine cached blobs and API/raw counters through local return. */
export async function checkReadingFoldStateReadOnly(tools) {
  const { evaluate, wait, command, afterReload, report, capture } = tools, path = "Read only.md";
  assert.equal(await evaluate("app.vault.readOnly"), true); await reading(tools, path);
  const cachedRoot = await evaluate("app.vault.rootPath"), [repository, ref, folder] = JSON.parse(decodeURIComponent(cachedRoot.slice("github-vault:".length)));
  const text = await evaluate("app.editor.getValue()"), beforeConfig = await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeProfile = await evaluate(`app.loadLocalStorage(${q(key)})`), initial = await evaluate(invoke(state));
  assert.ok(initial.headings.length && initial.lists.length >= 2, "cached fixture supplies original headings and nested lists");
  const heading = initial.headings[0].line, list = initial.lists[0].line;
  try {
    // Expand top-level headings before reaching a potentially restored list.
    for (const item of initial.headings) await setExpanded(tools, "headings", item.line, true);
    await setExpanded(tools, "lists", list, true); await keyboard(tools, "lists", list); await setExpanded(tools, "headings", heading, true); await keyboard(tools, "headings", heading, true);
    const records = await evaluate(invoke(remembered, path)); assert.equal(records.length, 2); assert.ok(records.find(record => record.channel === "reading-headings").value.includes(heading)); assert.ok(records.find(record => record.channel === "reading-lists").value.includes(list));
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)'); await reading(tools, path); await expanded(tools, "headings", heading, false); await expanded(tools, "lists", list, false);
    assert.deepEqual(await evaluate(invoke(remembered, path)), records); assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeConfig);
    pass(report, "A genuine cache-only read-only vault persists actual Enter/Space Reading heading and list choices in its local profile. Source-mode return and rereading restore those choices without changing cached note/configuration text or writing remote data.");
    assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
    await evaluate("app.workspace.flushLayout()"); await command("Page.reload"); await afterReload({ cachedRoot });
    await evaluate(`app.githubVaults.open(${q({ url: repository, ref, folder, cached: true })})`); await wait(`app.vault.rootPath===${q(cachedRoot)}&&!app.changingVault`, "fresh document reopens the same genuine cached vault"); await reading(tools, path); assert.equal(await evaluate("app.vault.readOnly"), true);
    await expanded(tools, "headings", heading, false); await expanded(tools, "lists", list, false); assert.deepEqual(await evaluate(invoke(remembered, path)), records);
    await keyboard(tools, "headings", heading); await expanded(tools, "headings", heading, true); await expanded(tools, "lists", list, false); await capture?.("reading-fold-state-readonly");
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeConfig);
    report.readingFoldStateReadOnly = { genuineCacheOnly: true, profileOnly: true, headingsAndLists: true, actualEnterSpace: true, reread: true, freshDocumentRestore: true, sourceAndConfigExact: true };
    pass(report, "A fresh document reopens the same genuine cache-only vault with both Reading fold kinds restored and usable keyboard controls. Cached source/configuration remain exact while the parent verifies zero API/raw requests and unchanged blobs through local-vault return.");
  } catch (error) {
    try { report.readingFoldStateReadOnlyFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),source:app.editor.getValue(),readOnly:app.vault.readOnly,folds:${invoke(state)}}))()`); await capture?.("reading-fold-state-readonly-precleanup-failure"); } catch { /* Preserve the first failure. */ }
    throw error;
  } finally {
    await closeFind(tools); await evaluate(`app.saveLocalStorage(${q(key)},${q(beforeProfile)})`); await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);delete app.workspace.activeLeaf.view.previewEl.dataset.readingFoldStateProbe');
    assert.equal(await evaluate("app.editor.getValue()"), text);
  }
}
