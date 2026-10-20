import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, preview = "app.workspace.activeLeaf.view.previewEl", key = "fold-state-v1";
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const pass = (tools, text) => { tools.report.checks.push(text); console.log("PASS " + text); };
const search = '[data-reading-search="true"]', query = search + ' [data-reading-search-query]';
const bytes = text => Buffer.from("\ufeff" + text);
const configBytes = value => bytes(JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");

function snapshot(path) {
  const entry = app.metadataCache.getDocument(path), text = entry?.text;
  if (!entry || text === undefined) return null;
  return { text, version: entry.document.version, bom: entry.document.hasBom,
    headings: entry.cache.headings.map(heading => ({ heading: heading.heading, level: heading.level, position: heading.position })),
    blocks: entry.cache.blocks, links: entry.cache.links, embeds: entry.cache.embeds, tags: entry.cache.tags, sections: entry.cache.sections,
    listItems: entry.cache.listItems, footnotes: entry.cache.footnotes, footnoteRefs: entry.cache.footnoteRefs };
}
function visible() {
  const root = app.workspace.activeLeaf.view.previewEl, own = node => node.closest(".markdown-preview-view") === root;
  return { headings: [...root.querySelectorAll('[data-reading-fold-toggle]')].filter(own).map(node => ({ line: Number(node.dataset.readingFoldToggle), expanded: node.getAttribute("aria-expanded"), visible: node.checkVisibility() })),
    rawOpen: [...root.querySelectorAll('details:not(.callout)')].filter(own).map(node => node.open),
    embeddedControls: root.querySelectorAll('.markdown-embed [data-reading-fold-toggle],.markdown-embed [data-reading-list-fold-toggle]').length };
}
function intent(path) { return (app.loadLocalStorage("fold-state-v1")?.records ?? []).filter(record => record.path === path).sort((left, right) => left.channel.localeCompare(right.channel)); }
function assertCoordinates(text, cache) {
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (value.start && value.end && Number.isInteger(value.start.offset)) for (const point of [value.start, value.end]) {
      assert.ok(point.offset >= 0 && point.offset <= text.length); assert.equal(point.line, text.slice(0, point.offset).split("\n").length - 1);
      assert.equal(point.ch, point.offset - text.lastIndexOf("\n", point.offset - 1) - 1);
    }
    for (const entry of Object.values(value)) if (entry && typeof entry === "object") { if (Array.isArray(entry)) for (const item of entry) visit(item); else visit(entry); }
  };
  visit(cache);
}
async function inputTrace(tools) {
  await tools.evaluate(`(()=>{globalThis.__crlfInputTrace?.abort?.abort();const trace=globalThis.__crlfInputTrace={events:[],abort:new AbortController()};for(const type of ['click','keydown','beforeinput'])document.addEventListener(type,event=>{if(event.target.closest?.('.cm-editor,[data-command-id],.reading-fold-toggle,.reading-list-fold-toggle,a[data-slopsidian-link],[data-reading-search-query]'))trace.events.push({type,trusted:event.isTrusted,key:event.key??null})},{capture:true,signal:trace.abort.signal});return true})()`);
}
async function takeInputs(tools) { const events = await tools.evaluate("__crlfInputTrace.events"); assert.ok(events.length >= 4 && events.every(event => event.trusted)); await tools.evaluate("__crlfInputTrace.abort.abort();delete globalThis.__crlfInputTrace"); return events; }
async function reading(tools, path) {
  await tools.evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode('preview',false);await app.workspace.activeLeaf.view.currentMode.whenReady()})()`);
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==='preview'&&app.workspace.activeLeaf.view.currentMode.canFoldAll()`, "current CRLF Reading inventory is ready");
}
async function palette(tools, collapse) {
  const id = collapse ? "editor:fold-all" : "editor:unfold-all";
  await tools.press("p", "KeyP", 80, 2); await tools.wait('document.querySelector("#desktop-picker[data-picker=commands]")?.open', "trusted Ctrl+P opens CRLF fold commands");
  await tools.command("Input.insertText", { text: collapse ? "Fold all" : "Unfold all" });
  await tools.wait(`Boolean(document.querySelector('[data-command-id="${id}"]'))`, "current bulk fold command");
  await tools.click(`[data-command-id="${id}"]`); await tools.wait('!document.querySelector("#desktop-picker").open', "CRLF fold palette closes");
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}
async function closeFind(tools) { if (await tools.evaluate(`Boolean(document.querySelector(${q(search)}))`)) await tools.click(search + ' button[name="close"]'); }
async function link(tools, href, line) {
  await tools.click(`[data-slopsidian-link=${q(href)}]`);
  await tools.wait(`!app.workspace.isChangingFiles&&app.editor.getCursor().line===${line}`, "CRLF link finishes exact source-caret navigation");
}

export async function checkMarkdownCrlf(tools) {
  const { directory, evaluate, wait, command, capture, restart, afterReload, report } = tools;
  const folder = "CRLF metadata", path = folder + "/CRLF.md", other = folder + "/Other.md", embedded = folder + "/Embedded.md";
  const text = ["---", 'status: "Keep exact CRLF metadata"', 'opaque: { retain: "λ 😀" }', "---",
    "[[CRLF#After CRLF HTML λ|Open post-HTML heading]] [[CRLF#^crlf-paragraph|Open post-HTML paragraph]] [[CRLF#^crlf-table|Open post-HTML table]]", "",
    "# Before CRLF HTML", "Original root body λ.", "", '<details><summary>Closed raw HTML</summary><p>crlfSearchNeedle hidden [[Hidden HTML]]</p><h2>Hidden HTML heading</h2></details>', "",
    "## After CRLF HTML λ", "", "crlfSearchNeedle visible 😀 [[Other]] #crlf-after ^crlf-paragraph", "",
    "- [ ] CRLF parent task", "  - CRLF child Ω ^crlf-child", "", "| First | Second |", "| --- | --- |  ", "| λ | 😀 |", "", "^crlf-table", "",
    "```md", "# Hidden code heading", "[[Hidden code]] #hidden-code ^hidden-code", "```", "", "## After CRLF fence Ω", "", "Visible [other](Other.md) and note [^crlf].", "",
    "![[Embedded]]", "", "[^crlf]: Definition after HTML Ω.", "", "# CRLF end", "Final retained body λ.", ""].join("\r\n");
  const otherText = "# Other\r\n\r\nKeep other source 😀.\r\n", embedText = "# Embedded only\r\n\r\ncrlfSearchNeedle embedded.\r\n\r\n- Embedded parent\r\n  - Embedded child\r\n";
  const line = value => text.split("\r\n").indexOf(value), afterLine = line("## After CRLF HTML λ"), paragraphLine = line("crlfSearchNeedle visible 😀 [[Other]] #crlf-after ^crlf-paragraph"), tableLine = line("| First | Second |");
  const configPath = join(directory, ".obsidian", "app.json"), beforeConfig = await readFile(configPath), config = { ...JSON.parse(beforeConfig.toString("utf8").replace(/^\ufeff/, "")), markdownAutosave: false, foldHeading: true, foldIndent: true };
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), profile = await evaluate(`app.loadLocalStorage(${q(key)})`), root = await evaluate("app.vault.rootPath");
  await mkdir(join(directory, folder)); for (const [name, content] of [[path, text], [other, otherText], [embedded, embedText]]) await writeFile(join(directory, name), bytes(content), { flag: "wx" });
  let stage = "post-HTML metadata", failure;
  const exact = async () => { assert.deepEqual(await readFile(join(directory, path)), bytes(text)); assert.deepEqual(await readFile(join(directory, other)), bytes(otherText)); assert.deepEqual(await readFile(join(directory, embedded)), bytes(embedText)); };
  report.markdownCrlfInputs ??= [];
  try {
    await writeFile(configPath, configBytes(config)); await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${q(path)})})()`);
    await wait(`app.metadataCache.getDocument(${q(path)})?.text===${q(text)}`, "exact source reaches the live metadata cache");
    const cache = await evaluate(invoke(snapshot, path)); assert.equal(cache.bom, true); assert.equal(cache.text, text);
    assert.deepEqual(cache.headings.map(item => item.heading), ["Before CRLF HTML", "After CRLF HTML λ", "After CRLF fence Ω", "CRLF end"]);
    assert.equal(cache.headings[1].position.start.offset, text.indexOf("## After CRLF HTML λ"));
    assert.equal(cache.blocks["crlf-paragraph"].position.start.line, paragraphLine); assert.equal(cache.blocks["crlf-table"].position.start.line, tableLine);
    assert.deepEqual(cache.tags.map(item => item.tag), ["#crlf-after"]); assert.equal(cache.links.some(item => /Hidden/.test(item.link)), false);
    assert.ok(cache.links.some(item => item.link === "Other.md")); assert.ok(cache.embeds.some(item => item.link === "Embedded")); assert.ok(cache.footnotes.some(item => item.id === "crlf"));
    assertCoordinates(text, cache); await exact();
    pass(tools, "The original CRLF raw-HTML boundary now leaves later headings, paragraphs, tasks, tables, links, embeds and footnotes in the real metadata cache. Every raw UTF-16 offset/line/column and BOM/CRLF/Unicode byte stays exact; HTML/code lookalikes remain excluded.");

    stage = "Reading folding and post-HTML navigation"; await reading(tools, path); await wait(`${preview}.querySelector('.markdown-embed-content.markdown-preview-view')`, "real excluded embedded Reading content"); await inputTrace(tools);
    let controls = await evaluate(invoke(visible)); assert.equal(controls.headings.length, 4); assert.ok(controls.headings.some(item => item.line === afterLine)); assert.equal(controls.embeddedControls, 0); assert.deepEqual(controls.rawOpen, [false]);
    await capture?.("markdown-crlf-metadata"); await palette(tools, true); controls = await evaluate(invoke(visible)); assert.ok(controls.headings.every(item => item.expanded === "false"));
    const collapsed = await evaluate(invoke(intent, path)); await capture?.("markdown-crlf-folded");
    await link(tools, "CRLF#After CRLF HTML λ", afterLine); await wait(`${preview}.querySelector('[data-reading-fold-toggle="${afterLine}"]')?.checkVisibility()`, "post-HTML heading is revealed under its folded parent");
    await link(tools, "CRLF#^crlf-paragraph", paragraphLine); await wait(`${preview}.querySelector('[data-source-line="${paragraphLine}"]')?.checkVisibility()`, "post-HTML paragraph opens its owning heading");
    await palette(tools, true); await link(tools, "CRLF#^crlf-table", tableLine); await wait(`${preview}.querySelector('table[data-source-line="${tableLine}"]')?.checkVisibility()`, "post-HTML table resolves its complete original owner");
    assert.deepEqual(await evaluate(invoke(intent, path)), collapsed); await exact(); await capture?.("markdown-crlf-navigation");
    pass(tools, "Real Reading fold controls now include headings after raw HTML. Trusted heading/paragraph/table links reach exact source carets and reveal folded ancestors while saved fold intent, original metadata ranges and note bytes remain unchanged; embedded controls and closed raw HTML stay excluded.");

    stage = "Reading Find exclusions"; await palette(tools, false); await evaluate(`${preview}.focus()`); await tools.press("f", "KeyF", 70, 2); await wait(`Boolean(document.querySelector(${q(query)}))`, "real Reading Find opens after the corrected HTML boundary");
    await tools.click(query); await command("Input.insertText", { text: "crlfSearchNeedle" }); await wait(`document.querySelector(${q(search)})?.dataset.readingSearchCount==='1'`, "Find includes post-HTML prose but excludes closed raw HTML and embeds");
    assert.equal(await evaluate("app.editor.getValue()"), text); await capture?.("markdown-crlf-find"); await closeFind(tools);
    pass(tools, "Trusted Reading Find sees the indexed post-HTML passage and excludes the same word inside closed raw HTML and the real embed. Searching changes no source or metadata bytes.");

    stage = "Source and Live Preview edits and Undo";
    for (const mode of ["source", "live-preview"]) {
      const addition = " " + mode + " edit Ω", edited = text.replace("Final retained body λ.", "Final retained body λ." + addition);
      await evaluate(`(()=>{app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false);app.editor.setCursor(${line("Final retained body λ.")},${"Final retained body λ.".length});app.editor.focus();return true})()`);
      await command("Input.insertText", { text: addition }); await wait(`app.editor.getValue()===${q(edited)}`, "trusted post-HTML source input reaches the active editor"); await evaluate("app.saveAll()");
      assert.deepEqual(await readFile(join(directory, path)), bytes(edited)); assert.equal((await evaluate(invoke(snapshot, path))).headings[1].position.start.line, afterLine);
      await evaluate("app.editor.undo();app.saveAll()"); await wait(`app.editor.getValue()===${q(text)}&&!app.workspace.sessions.get(${q(path)})?.dirty`, "one Undo restores the exact CRLF source"); await exact();
    }
    await capture?.("markdown-crlf-source");
    pass(tools, "Trusted Source and Live Preview edits after HTML use normal saving and a single editor Undo. Physical BOM/CRLF/Unicode bytes, stable post-HTML metadata coordinates, other notes and the real embed remain exact.");

    stage = "stale owner refusal"; await reading(tools, path); await palette(tools, true); const beforeStale = await evaluate(invoke(intent, path));
    await evaluate(`globalThis.__crlfHeld=app.workspace.activeLeaf.view.currentMode;app.workspace.activeLeaf.view.setEditingMode('source',false)`); assert.equal(await evaluate("__crlfHeld.unfoldAll()"), false); assert.deepEqual(await evaluate(invoke(intent, path)), beforeStale);
    await reading(tools, path); await evaluate(`${preview}.querySelector('[data-reading-fold-toggle="${afterLine}"]').parentElement.dataset.sourceLine='999999'`);
    assert.equal(await evaluate("app.workspace.activeLeaf.view.currentMode.unfoldAll()"), false); assert.equal(await evaluate("app.commands.isRunnable('editor:fold-all')"), false); assert.deepEqual(await evaluate(invoke(intent, path)), beforeStale);
    await evaluate(`app.openFile(${q(other)})`); await reading(tools, path); await palette(tools, true); await exact();
    pass(tools, "Correcting metadata does not weaken original Reading ownership: hidden renderers and synchronously remapped post-HTML headings refuse held bulk actions without changing profile intent, source or metadata. A fresh current render restores ordinary controls.");

    stage = "restart/reconnection"; const remembered = await evaluate(invoke(intent, path)); report.markdownCrlfInputs.push(...await takeInputs(tools));
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload(); await reading(tools, path);
    assert.deepEqual(await evaluate(invoke(intent, path)), remembered); assert.ok((await evaluate(invoke(visible))).headings.every(item => item.expanded === "false"));
    const restarted = await evaluate(invoke(snapshot, path)); assert.deepEqual(restarted, cache); await exact(); await palette(tools, false); await capture?.("markdown-crlf-restored");
    report.markdownCrlf = { originalHtmlBoundaryFixed: true, postHtmlHeadings: true, postHtmlBlocksAndTables: true, postHtmlLinksEmbedsFootnotes: true, literalLookalikesExcluded: true, originalUtf16LineColumns: true, exactBomCrLfUnicode: true, actualReadingFolds: true, trustedHeadingParagraphTableNavigation: true, temporaryRevealKeepsIntent: true, rawHtmlAndEmbedsExcluded: true, readingFind: true, sourceAndLivePreviewInput: true, normalSavingAndUndo: true, hiddenAndRemappedRefusal: true, freshDocumentMetadataAndIntent: true, unrelatedFilesExact: true };
    pass(tools, "Full restart or actual-folder browser reconnection restores the corrected post-HTML metadata, exact versions/bytes and saved Reading folds. Fresh bulk controls remain usable and unrelated source/embed files stay unchanged.");
  } catch (issue) {
    failure = issue; try { report.markdownCrlfFailure = { stage, error: String(issue?.stack ?? issue), cache: await evaluate(invoke(snapshot, path)), visible: await evaluate(invoke(visible)) }; await capture?.("markdown-crlf-precleanup-failure"); } catch { report.markdownCrlfFailure ??= { stage }; } throw issue;
  } finally {
    if (await evaluate("app.vault.rootPath").catch(() => null) === root) {
      await closeFind(tools); await evaluate("globalThis.__crlfInputTrace?.abort?.abort();delete globalThis.__crlfInputTrace;delete globalThis.__crlfHeld;document.querySelector('#desktop-picker')?.close()");
      try { await writeFile(configPath, beforeConfig); await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.saveAll();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();app.saveLocalStorage(${q(key)},${q(profile)})})()`); } catch (issue) { if (!failure) throw issue; }
    }
  }
}

export const markdownCrlfReadOnlyFixture = {
  sourceAddition: ["", "[[Read only#Cached CRLF after HTML λ|Open cached post-HTML heading]] [[Read only#^cached-crlf-block|Open cached post-HTML block]]", "", "# Cached CRLF before HTML", "Cached root body.", "",
    '<details><summary>Cached raw HTML</summary><p>[[Hidden cached HTML]] #hidden-cached</p></details>', "", "## Cached CRLF after HTML λ", "", "Cached post-HTML body 😀 ^cached-crlf-block", "", "- Cached CRLF parent", "  - Cached CRLF child", "", "# Cached CRLF end", "Cached final body.", ""].join("\r\n"),
  files: [],
};

export async function checkMarkdownCrlfReadOnly(tools) {
  const { evaluate, wait, command, afterReload, report, capture } = tools, path = "Read only.md";
  report.markdownCrlfInputs ??= [];
  assert.equal(await evaluate("app.vault.readOnly"), true); const before = await evaluate("app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,bom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))");
  const text = await evaluate("app.editor.getValue()"), cache = await evaluate(invoke(snapshot, path)), line = text.split(/\r?\n/).indexOf("## Cached CRLF after HTML λ"), blockLine = text.split(/\r?\n/).indexOf("Cached post-HTML body 😀 ^cached-crlf-block");
  const profile = await evaluate(`app.loadLocalStorage(${q(key)})`), cachedRoot = await evaluate("app.vault.rootPath"), [repository, ref, folder] = JSON.parse(decodeURIComponent(cachedRoot.slice("github-vault:".length)));
  assert.equal(cache.headings.find(item => item.heading === "Cached CRLF after HTML λ").position.start.offset, text.indexOf("## Cached CRLF after HTML λ")); assert.equal(cache.blocks["cached-crlf-block"].position.start.line, blockLine); assertCoordinates(text, cache);
  try {
    await reading(tools, path); await inputTrace(tools); await palette(tools, true); const remembered = await evaluate(invoke(intent, path));
    await link(tools, "Read only#Cached CRLF after HTML λ", line); await link(tools, "Read only#^cached-crlf-block", blockLine); await wait(`${preview}.querySelector('[data-source-line="${blockLine}"]')?.checkVisibility()`, "cached post-HTML block reveals its actual Reading owners");
    assert.deepEqual(await evaluate(invoke(intent, path)), remembered); await palette(tools, false); await capture?.("markdown-crlf-readonly");
    await evaluate("app.workspace.activeLeaf.view.setEditingMode('source',false);app.editor.focus()"); await command("Input.insertText", { text: "MUST NOT CHANGE CACHED CRLF SOURCE" }); assert.equal(await evaluate("app.editor.getValue()"), text);
    assert.deepEqual(await evaluate("app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,bom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))"), before);
    report.markdownCrlfInputs.push(...await takeInputs(tools));
    pass(tools, "A genuine prepared cache-only vault indexes post-HTML CRLF headings/blocks at their original offsets. Trusted local folds and heading/block navigation remain usable while actual Source input is refused and every cached document/version/BOM and saved fold intent stays exact.");

    await reading(tools, path); await palette(tools, true); const saved = await evaluate(invoke(intent, path)); await evaluate("app.workspace.flushLayout()"); await command("Page.reload"); await afterReload({ cachedRoot });
    await evaluate(`app.githubVaults.open(${q({ url: repository, ref, folder, cached: true })})`); await wait(`app.vault.rootPath===${q(cachedRoot)}&&!app.changingVault`, "same genuine cache-only CRLF vault reopens in a fresh document"); await reading(tools, path);
    assert.deepEqual(await evaluate(invoke(snapshot, path)), cache); assert.deepEqual(await evaluate(invoke(intent, path)), saved); assert.ok((await evaluate(invoke(visible))).headings.every(item => item.expanded === "false"));
    assert.equal(await evaluate("app.editor.getValue()"), text); assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 }); await palette(tools, false); await capture?.("markdown-crlf-readonly-restored");
    report.markdownCrlfReadOnly = { genuineCacheOnly: true, originalPostHtmlCoordinates: true, trustedLocalFoldsAndNavigation: true, typingRefused: true, exactDocumentsAndVersions: true, temporaryRevealKeepsIntent: true, freshDocumentMetadataAndFolds: true, zeroApiRaw: true };
    pass(tools, "A fresh cached-vault document restores the corrected CRLF metadata and exact local fold snapshot with unchanged source and zero API/raw requests. The parent audits original cached blobs through local-vault return.");
  } finally {
    await closeFind(tools); await evaluate(`globalThis.__crlfInputTrace?.abort?.abort();delete globalThis.__crlfInputTrace;app.saveLocalStorage(${q(key)},${q(profile)});app.workspace.activeLeaf.view.setEditingMode('source',false)`);
    assert.equal(await evaluate("app.editor.getValue()"), text);
  }
}
