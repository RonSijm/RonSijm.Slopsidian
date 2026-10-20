import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, root = "app.workspace.activeLeaf.view.previewEl", key = "fold-state-v1";
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (report, text) => { report.checks.push(text); console.log("PASS " + text); };
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
const search = '[data-reading-search="true"]', searchQuery = search + ' [data-reading-search-query]';

function state() {
  const root = app.workspace.activeLeaf.view.previewEl, owned = selector => [...root.querySelectorAll(selector)].filter(node => node.closest(".markdown-preview-view") === root);
  return {
    headings: owned("[data-reading-fold-toggle]").map(button => ({ line: Number(button.dataset.readingFoldToggle), expanded: button.getAttribute("aria-expanded"), visible: button.checkVisibility() })),
    lists: owned("[data-reading-list-fold-toggle]").map(button => ({ line: Number(button.dataset.readingListFoldToggle), expanded: button.getAttribute("aria-expanded"), visible: button.checkVisibility() })),
    callouts: owned("[data-reading-callout-toggle]").map(summary => ({ line: Number(summary.dataset.readingCalloutToggle), open: summary.parentElement.open })),
    embeddedControls: root.querySelectorAll('.markdown-embed [data-reading-fold-toggle],.markdown-embed [data-reading-list-fold-toggle],.markdown-embed [data-reading-callout-toggle]').length,
    rawDetails: owned("details:not(.callout)").map(node => node.open),
  };
}
function remembered(path) {
  return (app.loadLocalStorage("fold-state-v1")?.records ?? []).filter(record => record.path === path && record.channel.startsWith("reading-"))
    .sort((a, b) => a.channel.localeCompare(b.channel));
}
function expected(current, collapse) {
  return [["reading-callouts", collapse ? current.callouts.map(item => item.line) : []], ["reading-headings", collapse ? current.headings.map(item => item.line) : []], ["reading-lists", collapse ? current.lists.map(item => item.line) : []]];
}
async function assertIntent(tools, path, value) {
  const records = await tools.evaluate(invoke(remembered, path));
  assert.deepEqual(records.map(record => [record.channel, record.value]), value);
  assert.equal(new Set(records.map(record => record.source)).size, 1); assert.ok(records.every(record => /^[a-f0-9]{64}$/.test(record.source)));
  return records;
}
async function assertVisual(tools, collapse) {
  const current = await tools.evaluate(invoke(state));
  assert.ok(current.headings.length && current.lists.length && current.callouts.length);
  assert.ok(current.headings.every(item => item.expanded === String(!collapse)));
  assert.ok(current.lists.every(item => item.expanded === String(!collapse)));
  assert.ok(current.callouts.every(item => item.open === !collapse));
  assert.equal(current.embeddedControls, 0); assert.ok(current.rawDetails.every(value => value === false));
  return current;
}
async function reading(tools, path) {
  await tools.evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&app.workspace.activeLeaf.view.currentMode.canFoldAll()`, "active original-main Reading bulk fold inventory");
}
async function palette(tools, collapse, capture) {
  const id = collapse ? "editor:fold-all" : "editor:unfold-all", name = collapse ? "Fold all" : "Unfold all", selector = `[data-command-id=${q(id)}]`;
  await tools.evaluate(`(()=>{globalThis.__readingBulkInputs??=[];if(globalThis.__readingBulkKey)document.removeEventListener('keydown',__readingBulkKey,true);globalThis.__readingBulkKey=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'){__readingBulkInputs.push({kind:'palette-key',trusted:e.isTrusted});document.removeEventListener('keydown',__readingBulkKey,true);delete globalThis.__readingBulkKey}};document.addEventListener('keydown',__readingBulkKey,true)})()`);
  await tools.press("p", "KeyP", 80, 2);
  await tools.wait('document.querySelector("#desktop-picker[data-picker=commands]")?.open', "trusted Ctrl+P opens command palette");
  await tools.command("Input.insertText", { text: name });
  await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "current " + name + " palette action");
  await tools.evaluate(`document.querySelector(${q(selector)}).addEventListener('click',e=>__readingBulkInputs.push({kind:'palette-choice',id:${q(id)},trusted:e.isTrusted}),{once:true})`);
  if (capture) {
    assert.equal(await tools.evaluate("['editor:fold-all','editor:unfold-all'].every(id=>document.querySelector('[data-command-id=\"'+id+'\"]')?.checkVisibility())"), true);
    await tools.capture?.(capture);
  }
  await tools.click(selector); await tools.wait('!document.querySelector("#desktop-picker").open', "bulk fold palette selection completes");
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}
async function takeInputs(tools) {
  const values = await tools.evaluate("globalThis.__readingBulkInputs??[]"); assert.ok(values.length >= 2 && values.every(value => value.trusted));
  await tools.evaluate("delete globalThis.__readingBulkInputs"); return values;
}
async function closeFind(tools) { if (await tools.evaluate(`Boolean(document.querySelector(${q(search)}))`)) await tools.click(search + ' button[name="close"]'); }
async function flags(tools, heading, list) {
  if (!await tools.evaluate('document.querySelector("#settings-dialog").open')) await tools.click("#open-settings");
  await tools.click("#editor-settings-tab");
  for (const [name, value] of [["foldHeading", heading], ["foldIndent", list]]) {
    const selector = `[data-editor-settings] [data-setting-key=${q(name)}] [role="switch"]`;
    await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "real " + name + " control");
    if (await tools.evaluate(`document.querySelector(${q(selector)}).getAttribute('aria-checked')==='true'`) !== value) await tools.click(selector);
    await tools.wait(`app.configuration.get('app',${q(name)})===${value}`, "accepted independent " + name + " setting");
  }
  await tools.click(".settings-close"); await tools.wait('!document.querySelector("#settings-dialog").open', "bulk fold settings closed");
}

/** Current Source/LP and original-main Reading commands use real palette input. */
export async function checkReadingBulkFolds(tools) {
  const { directory, evaluate, command, wait, report, capture, restart, afterReload } = tools;
  const folder = "Reading bulk folds", path = folder + "/Bulk.md", other = folder + "/Other.md", embedded = folder + "/Embedded.md";
  const text = ["---", 'opaque: "Bulk intent λ"', "---", "[[Bulk#Child heading|Reveal child heading]] [[Bulk#^list-deep|Reveal list block]] [[Bulk#^callout-target|Reveal callout block]]", "", "# Bulk root λ", "Root body.", "", "## Child heading", "Child body.", "",
    "- [ ] Parent list", "  - Child list", "    - Deep list target 😀 ^list-deep", "  - Sibling list", "- Other list", "  - Last child", "",
    "> [!note]+ Bulk outer", "> calloutbulkneedle outer.", ">", "> > [!tip]- Bulk nested", "> > calloutbulkneedle nested 😀 ^callout-target", "", "> [!warning]- Bulk separate", "> calloutbulkneedle separate.", "",
    "# End", "", '<details><summary>Raw details</summary><p>calloutbulkneedle raw-hidden.</p></details>', "", "![[Embedded]]", "", "```js", "const retained = 42;", "```", ""].join("\r\n");
  const bytes = Buffer.from("\ufeff" + text), otherBytes = Buffer.from("\ufeffOther bulk workflow.\r\n"), embedBytes = Buffer.from("\ufeff# Embedded\r\n\r\n- Parent\r\n  - Child\r\n\r\n> [!note]- Embedded default\r\n> retained embedded body.\r\n");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), localRoot = await evaluate("app.vault.rootPath"), originalProfile = await evaluate(`app.loadLocalStorage(${q(key)})`);
  const configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath), config = { ...JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, "")), markdownAutosave: false, foldHeading: true, foldIndent: true };
  await mkdir(join(directory, folder), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" }); await writeFile(join(directory, other), otherBytes, { flag: "wx" }); await writeFile(join(directory, embedded), embedBytes, { flag: "wx" });
  let stage = "Source/Live Preview palette commands";
  report.readingBulkFoldInputs ??= [];
  try {
    await writeFile(configPath, encode(config));
    await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode('source',false);app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()})()`);
    await command("Input.insertText", { text: "Bulk history Ω" }); await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    for (const mode of ["source", "live-preview"]) {
      await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false);app.editor.focus()`);
      await palette(tools, true); assert.ok((await evaluate("app.editor.getFoldInfo().folds")).length > 0);
      await palette(tools, false); assert.deepEqual(await evaluate("app.editor.getFoldInfo().folds"), []);
      assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await readFile(join(directory, path)), bytes);
    }
    pass(report, "Trusted command-palette Fold all/Unfold all preserves existing Source and Live Preview Editor.exec folding, independent controls, source history and exact BOM/CRLF/Unicode note bytes.");

    stage = "Reading complete bulk intent and retained owners";
    await reading(tools, path); await wait(`${root}.querySelector('.markdown-embed-content.markdown-preview-view')`, "real embedded Reading body");
    const initial = await evaluate(invoke(state));
    report.readingBulkInventory = await evaluate(`(()=>{const reading=app.workspace.activeLeaf.view.currentMode,context=reading.foldingContext;return {foldHeading:app.configuration.get('app','foldHeading'),headingInventory:context?.inventory,headingController:reading.folding?{disposed:reading.folding.isDisposed,canSetAll:reading.folding.canSetAll()}:null,headings:app.metadataCache.getDocument(${q(path)})?.cache.headings,blocks:context?[...context.section.children].map(node=>({tag:node.tagName,line:node.dataset.sourceLine,text:node.textContent.slice(0,100)})):[]}})()`);
    assert.ok(initial.headings.length >= 2 && initial.lists.length >= 3 && initial.callouts.length === 3); assert.equal(initial.embeddedControls, 0);
    await evaluate(`(()=>{const r=${root};globalThis.__readingBulkRetained={reading:app.workspace.activeLeaf.view.currentMode,editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,selection:app.editor.cm.state.selection,section:r.firstElementChild,nodes:[...r.querySelectorAll('h1,h2,li,input,details,summary,.callout-content,.markdown-embed-content')]}})()`);
    await palette(tools, true, "reading-bulk-palette"); await assertVisual(tools, true);
    const closed = await assertIntent(tools, path, expected(initial, true)); await capture?.("reading-bulk-folded");
    assert.equal(await evaluate(`(()=>{const s=__readingBulkRetained,r=${root};return app.editor===s.editor&&app.editor.cm===s.cm&&app.editor.cm.state.doc===s.doc&&app.editor.cm.state.selection.eq(s.selection)&&r.firstElementChild===s.section&&s.nodes.every(node=>r.contains(node))})()`), true);
    await palette(tools, false); await assertVisual(tools, false); await assertIntent(tools, path, expected(initial, false)); await capture?.("reading-bulk-unfolded");
    assert.deepEqual(await readFile(configPath), encode(config)); assert.deepEqual(await readFile(join(directory, path)), bytes);
    pass(report, "Reading bulk commands fold every supported heading/list/callout and explicitly open Markdown-minus defaults. Each kind saves a complete exact-source local snapshot while original task/embed/rendered nodes, hidden editor document/selection/history and note/configuration bytes stay intact.");

    stage = "reread and heading/list/callout navigation";
    await evaluate(`app.openFile(${q(other)})`); await reading(tools, path); await assertVisual(tools, false); await assertIntent(tools, path, expected(initial, false));
    await palette(tools, true); const beforeNavigation = await assertIntent(tools, path, expected(initial, true));
    await tools.click('[data-slopsidian-link="Bulk#Child heading"]'); await wait("app.editor.getCursor().line===" + text.split("\r\n").indexOf("## Child heading"), "bulk-folded heading resolves exact Source caret");
    assert.deepEqual(await evaluate(invoke(remembered, path)), beforeNavigation);
    await tools.click('[data-slopsidian-link="Bulk#^list-deep"]');
    await wait(`${root}.querySelector('li[data-source-line=${q(String(text.split("\r\n").indexOf("    - Deep list target 😀 ^list-deep")))}]')?.checkVisibility()`, "bulk-folded nested list block reveals its ancestors");
    await tools.click('[data-slopsidian-link="Bulk#^callout-target"]');
    await wait(`(()=>{const entries=${invoke(state)}.callouts;return entries.length===3&&entries.slice(0,2).every(item=>item.open)&&entries.at(-1).open===false})()`, "bulk-folded callout block navigation finishes revealing only its two owners");
    const revealed = await evaluate(invoke(state)); assert.ok(revealed.callouts.slice(0, 2).every(item => item.open)); assert.equal(revealed.callouts.at(-1).open, false);
    assert.deepEqual(await evaluate(invoke(remembered, path)), beforeNavigation); await palette(tools, true); await assertVisual(tools, true);
    pass(report, "Rereading restores explicit Unfold all, including minus defaults. Actual heading, deep-list and nested-callout block links temporarily reveal only their owning ancestors and preserve every bulk intent record; another Fold all reapplies the complete collapsed state.");

    stage = "independent disabled controls and Find reveal";
    await flags(tools, false, true); await palette(tools, false); let scoped = await evaluate(invoke(state)); assert.deepEqual(scoped.headings, []); assert.ok(scoped.lists.every(item => item.expanded === "true"));
    assert.deepEqual((await evaluate(invoke(remembered, path))).find(record => record.channel === "reading-headings"), closed.find(record => record.channel === "reading-headings"));
    await flags(tools, false, false); await palette(tools, true); scoped = await evaluate(invoke(state)); assert.deepEqual(scoped.headings, []); assert.deepEqual(scoped.lists, []); assert.ok(scoped.callouts.every(item => !item.open));
    const beforeFind = await evaluate(invoke(remembered, path));
    await evaluate(`${root}.focus()`); await tools.press("f", "KeyF", 70, 2); await wait(`Boolean(document.querySelector(${q(searchQuery)}))`, "Reading Find over bulk-closed callouts");
    await tools.click(searchQuery); await command("Input.insertText", { text: "calloutbulkneedle" }); await wait(`document.querySelector(${q(search)}).dataset.readingSearchCount==='3'`, "Find indexes captured closed callouts but excludes raw details and embeds");
    await tools.click(search + ' button[name="next"]'); await tools.click(search + ' button[name="next"]'); await wait(`document.querySelector(${q(search)}).dataset.readingSearchActive==='3'`, "Find reveals separate bulk-folded callout");
    assert.ok((await evaluate(invoke(state))).callouts.every(item => item.open)); assert.deepEqual(await evaluate(invoke(remembered, path)), beforeFind); await closeFind(tools);
    await flags(tools, true, true); await palette(tools, false); await assertVisual(tools, false);
    pass(report, "Fold headings and Fold lists independently gate bulk commands and preserve disabled-kind records. With both disabled, callout bulk folds still work; real Find includes only captured closed bodies, reveals nested/separate results and leaves bulk intent unchanged.");

    stage = "stale hidden or remapped renderer refusal";
    await evaluate(`globalThis.__readingBulkHeld=app.workspace.activeLeaf.view.currentMode;app.workspace.activeLeaf.view.setEditingMode('source',false)`);
    const beforeHidden = await evaluate(invoke(remembered, path)); assert.equal(await evaluate("__readingBulkHeld.foldAll()"), false); assert.deepEqual(await evaluate(invoke(remembered, path)), beforeHidden);
    await reading(tools, path); await evaluate(`(()=>{const heading=${root}.querySelector('[data-reading-fold-toggle]').parentElement;heading.dataset.sourceLine='999999'})()`);
    assert.equal(await evaluate("app.workspace.activeLeaf.view.currentMode.foldAll()"), false); assert.equal(await evaluate("app.commands.isRunnable('editor:fold-all')"), false);
    assert.deepEqual(await evaluate(invoke(remembered, path)), beforeHidden);
    await evaluate(`app.openFile(${q(other)})`); await reading(tools, path); await palette(tools, true); await assertVisual(tools, true);
    pass(report, "Hidden Reading instances and synchronously remapped original owners refuse held bulk calls before any profile write. The palette disables invalid Reading inventories; a fresh current render restores normal availability without source edits.");

    stage = "fresh document restores all bulk channels";
    await evaluate("app.workspace.activeLeaf.view.setEditingMode('source',false);app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), text + "Bulk history Ω");
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    await reading(tools, path); await palette(tools, true); await assertVisual(tools, true);
    const finalIntent = await assertIntent(tools, path, expected(initial, true)), configBeforeRestart = await readFile(configPath);
    report.readingBulkFoldInputs.push(...await takeInputs(tools));
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload(); await reading(tools, path);
    await assertVisual(tools, true); assert.deepEqual(await evaluate(invoke(remembered, path)), finalIntent);
    await palette(tools, false); await assertVisual(tools, false); await capture?.("reading-bulk-restored"); report.readingBulkFoldInputs.push(...await takeInputs(tools));
    assert.deepEqual(await readFile(join(directory, path)), bytes); assert.deepEqual(await readFile(join(directory, other)), otherBytes); assert.deepEqual(await readFile(join(directory, embedded)), embedBytes); assert.deepEqual(await readFile(configPath), configBeforeRestart);
    report.readingBulkFolds = { sourceAndLivePreviewPalette: true, trustedPaletteInput: true, allSupportedKinds: true, explicitMinusExpansion: true, completeExactSourceSnapshots: true, originalNodesAndHiddenEditor: true, exactBomCrLfUnicode: true, reread: true, temporaryHeadingListCalloutReveal: true, disabledKindsIndependent: true, calloutFindTemporaryReveal: true, rawDetailsAndEmbedsExcluded: true, staleHiddenAndRemappedRefusal: true, freshDocumentRestore: true, retainedEditorHistory: true, profileOnlyBulkActions: true };
    pass(report, "Live editor redo/Undo remains intact after bulk folds and note switches. A full native restart or fresh browser document/reconnection then restores all three local Reading snapshots with a usable palette and exact note/embed/configuration bytes.");
  } catch (error) {
    try { report.readingBulkFoldsFailure = { stage, ...await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getMode(),source:app.editor.getValue(),folds:${invoke(state)},profile:${invoke(remembered, path)},palette:document.querySelector('#desktop-picker')?.outerHTML.slice(0,3000)}))()`) }; await capture?.("reading-bulk-precleanup-failure"); } catch { report.readingBulkFoldsFailure ??= { stage }; }
    throw error;
  } finally {
    if (await evaluate("app.vault.rootPath").catch(() => null) === localRoot) {
      await closeFind(tools);
      await evaluate("(()=>{if(globalThis.__readingBulkKey)document.removeEventListener('keydown',__readingBulkKey,true);delete globalThis.__readingBulkKey;delete globalThis.__readingBulkInputs;delete globalThis.__readingBulkRetained;delete globalThis.__readingBulkHeld;document.querySelector('#desktop-picker')?.close()})()");
      await writeFile(join(directory, path), bytes); await writeFile(configPath, originalConfig);
      await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.vault.refresh();await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode('source',false);const text=app.editor.getValue();if(text!==${q(text)})app.editor.replaceExpected(text,0,text.length,${q(text)},'input.bulk-fold-cleanup');await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();app.saveLocalStorage(${q(key)},${q(originalProfile)})})()`);
    }
  }
}

export const readingBulkFoldsReadOnlyFixture = { sourceAddition: ["", "# Cached bulk root", "Cached bulk body.", "", "## Cached bulk child", "", "- Cached bulk parent", "  - Cached bulk child", "    - Cached deep λ", "",
  "> [!note]+ Cached bulk outer", "> Cached bulk outer body.", ">", "> > [!tip]- Cached bulk nested", "> > Cached bulk nested body.", "", "> [!warning]- Cached bulk separate", "> Cached separate body.", "", "# Cached bulk end", ""].join("\r\n") };

/** Parent owns the actual prepared cached vault and byte/network audits. */
export async function checkReadingBulkFoldsReadOnly(tools) {
  const { evaluate, wait, command, afterReload, report, capture } = tools, path = "Read only.md";
  report.readingBulkFoldInputs ??= [];
  assert.equal(await evaluate("app.vault.readOnly"), true); await reading(tools, path);
  const cachedRoot = await evaluate("app.vault.rootPath"), [repository, ref, folder] = JSON.parse(decodeURIComponent(cachedRoot.slice("github-vault:".length)));
  const text = await evaluate("app.editor.getValue()"), beforeConfig = await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeProfile = await evaluate(`app.loadLocalStorage(${q(key)})`), initial = await evaluate(invoke(state));
  try {
    await palette(tools, true); await assertVisual(tools, true); const closed = await assertIntent(tools, path, expected(initial, true));
    await evaluate("app.workspace.activeLeaf.view.setEditingMode('source',false);app.workspace.activeLeaf.view.setEditingMode('preview',false)");
    await wait("app.workspace.activeLeaf.view.currentMode.canFoldAll()", "cached Reading bulk inventory returns"); await assertVisual(tools, true); assert.deepEqual(await evaluate(invoke(remembered, path)), closed);
    await palette(tools, false); await assertVisual(tools, false); const expanded = await assertIntent(tools, path, expected(initial, false));
    await capture?.("reading-bulk-readonly"); report.readingBulkFoldInputs.push(...await takeInputs(tools));
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeConfig);
    assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
    pass(report, "A genuine cache-only read-only note permits trusted palette Fold all/Unfold all over heading/list/callout owners and complete local snapshots, including expanded minus defaults. Rereading retains intent without changing cached text/configuration or API/raw counters.");
    await evaluate("app.workspace.flushLayout()"); await command("Page.reload"); await afterReload({ cachedRoot });
    await evaluate(`app.githubVaults.open(${q({ url: repository, ref, folder, cached: true })})`); await wait(`app.vault.rootPath===${q(cachedRoot)}&&!app.changingVault`, "fresh document reopens same cached bulk-fold vault"); await reading(tools, path);
    await assertVisual(tools, false); assert.deepEqual(await evaluate(invoke(remembered, path)), expanded);
    await palette(tools, true); await assertVisual(tools, true); await palette(tools, false); await assertVisual(tools, false); report.readingBulkFoldInputs.push(...await takeInputs(tools));
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), beforeConfig);
    report.readingBulkFoldsReadOnly = { genuineCacheOnly: true, trustedPalette: true, allThreeKinds: true, completeProfileOnlyIntent: true, minusDefaultsExplicitlyExpanded: true, rereadAndFreshDocumentRestore: true, exactTextAndConfiguration: true };
    pass(report, "A fresh cached-vault document restores Unfold all and both bulk commands remain immediately usable. The parent retains exact cached blobs and zero API/raw requests through local-vault return.");
  } catch (error) {
    try { report.readingBulkFoldsReadOnlyFailure = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,folds:${invoke(state)},profile:${invoke(remembered, path)}}))()`); await capture?.("reading-bulk-readonly-precleanup-failure"); } catch { /* Retain first failure. */ }
    throw error;
  } finally {
    await closeFind(tools); await evaluate(`if(globalThis.__readingBulkKey)document.removeEventListener('keydown',__readingBulkKey,true);delete globalThis.__readingBulkKey;app.saveLocalStorage(${q(key)},${q(beforeProfile)});delete globalThis.__readingBulkInputs;app.workspace.activeLeaf.view.setEditingMode('source',false)`);
    assert.equal(await evaluate("app.editor.getValue()"), text);
  }
}
