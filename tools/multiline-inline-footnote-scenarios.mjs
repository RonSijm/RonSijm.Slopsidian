import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text), hash = data => createHash("sha256").update(data).digest("hex");
const firstBody = "**First λ** [self](Source.md#After) and [bracket [nested]]\r\nSecond 😀 with `]`, $x+1$ and [^named]";
const sourceText = ["---", "title: Multiline inline notes", 'opaque: { keep: "λ 😀" }', "---", "# Before", "", "Keep source Ω.", "", "Before ^[" + firstBody + "] then [^named] and [^named].", "", "Later ^[Later first", "Later second].", "", 'Safe ^[<span onclick="globalThis.multilineInlineInjected=true">Safe HTML</span>', "Second safe line].", "", "Escaped \\^[literal], code `^[code]`.", "%% ^[comment", "comment body] %%", "", "Unfinished ^[open", "", "Unrelated ] stays literal.", "", "# After", "", "[^named]: **Named λ**", "    Named continued.", ""].join("\r\n");
const cachedBody = "**Cached multiline λ**\r\nSecond 😀 [bracket] and `]`, $x+1$";
export const multilineInlineFootnoteReadOnlyFixture = {
  sourceAddition: "\r\n\r\nBefore cached ^[" + cachedBody + "] and [^multiline-cached].\r\n\r\n[^multiline-cached]: **Cached named**\r\n    Continued cached.\r\n\r\n# Cached footnote after\r\n\r\nRetain cached footnote suffix Ω.\r\n",
  files: [],
};
async function key(command, value, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode, modifiers });
}
async function disabledPointer(tools, selector) {
  const point = await tools.evaluate(`(()=>{const node=document.querySelector(${q(selector)});node.scrollIntoView({block:"center"});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node,disabled:node.disabled}})()`);
  assert.equal(point.hit, true); assert.equal(point.disabled, true);
  for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
}
const normalize = text => text.replace(/\r\n?/g, "\n");
const optionalBytes = path => readFile(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
const restoreBytes = async (path, data) => { if (data) await writeFile(path, data); else await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); };
const logicalHeading = element => [...element.childNodes].filter(node => node.nodeType !== 1 || !node.matches("button.reading-fold-toggle")).map(node => node.textContent).join("");
const workspace = (path, prefix, peer = true) => ({ version: 1, main: { id: prefix + "-main", type: "split", direction: "vertical", children: [
  { id: prefix + "-source-tabs", type: "tabs", currentTab: 0, dimension: peer ? 38 : 62, children: [{ id: prefix + "-source", type: "leaf", state: { type: "markdown", state: { file: path, mode: "source", source: true } } }] },
  { id: prefix + "-foot-tabs", type: "tabs", currentTab: 0, dimension: peer ? 30 : 38, children: [{ id: prefix + "-foot", type: "leaf", state: { type: "footnotes", state: { file: path, followActiveFile: false } } }] },
  ...(peer ? [{ id: prefix + "-peer-tabs", type: "tabs", currentTab: 0, dimension: 32, children: [{ id: prefix + "-peer", type: "leaf", state: { type: "markdown", state: { file: path, mode: "preview" } } }] }] : []),
] }, active: prefix + "-source" });

/** Actual trusted controls and physical bytes; the parent owns builds and host/error/shutdown audits. */
export async function checkMultilineInlineFootnotes(tools) {
  const { directory, evaluate, command, click, wait, report, restart, afterReload, capture } = tools;
  const path = "Multiline inline notes/Source.md", prefix = "multiline-inline", source = "globalThis.multilineInlineSource", peer = "globalThis.multilineInlinePeer";
  const pane = '[data-footnotes-pane="' + prefix + '-foot"]', entries = pane + " [data-inline-footnote]", first = entries + ":first-child", reading = '[data-multiline-inline-reading="true"]', other = '[data-multiline-inline-peer="true"]';
  const editor = "[data-footnote-edit-dialog] .cm-content", apply = '[data-footnote-edit-dialog] [data-footnote-edit-action="apply"]', cancel = '[data-footnote-edit-dialog] [data-footnote-edit-action="cancel"]';
  const configPath = join(directory, ".obsidian/app.json"), corePath = join(directory, ".obsidian/core-plugins.json");
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("footnotes")');
  const configBytes = await optionalBytes(configPath), coreBytes = await optionalBytes(corePath), options = configBytes ? JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, "")) : {};
  let stage = "fixture", checks = 0, captures = 0, finalText = sourceText, failure;
  const pass = message => { checks++; report.checks.push(message); console.log("PASS " + message); };
  const snap = async name => { if (capture) { await capture(name); captures++; } };
  const exact = async text => assert.deepEqual(await readFile(join(directory, path)), bytes(text));
  const bind = async () => {
    await wait(`Boolean(app.workspace.getLeafById(${q(prefix + "-source")})?.view.editor&&app.workspace.getLeafById(${q(prefix + "-peer")})?.view.editor)`, "current multiline source and peer owners");
    return evaluate(`(()=>{${source}=app.workspace.getLeafById(${q(prefix + "-source")});${peer}=app.workspace.getLeafById(${q(prefix + "-peer")});${source}.view.previewEl.dataset.multilineInlineReading="true";${peer}.view.previewEl.dataset.multilineInlinePeer="true";return true})()`);
  };
  const activatePane = () => evaluate(`app.workspace.setActiveLeaf(app.workspace.getLeafById(${q(prefix + "-foot")}))`);
  const sourceMode = () => evaluate(`(()=>{app.workspace.setActiveLeaf(${source});${source}.view.setEditingMode("source",false);${source}.view.editor.focus()})()`);
  const readySource = text => wait(`${source}.view.editor.getValue()===${q(text)}&&app.metadataCache.getDocument(${q(path)})?.text===${q(text)}`, "current multiline source and metadata");
  const openEdit = async () => { await activatePane(); await click(first + " [data-footnote-edit]"); await wait(`Boolean(document.querySelector(${q(editor)}))`, "multiline definition draft"); };
  const fill = async text => { await click(editor); await key(command, "a", "KeyA", 65, 2); await command("Input.insertText", { text }); };
  const draft = () => evaluate('Array.from(document.querySelectorAll("[data-footnote-edit-dialog] .cm-line"),line=>line.textContent).join("\\n")');
  const closed = () => wait('!document.querySelector("[data-footnote-edit-dialog]")', "multiline definition dialog closed");
  const save = async text => { await sourceMode(); await key(command, "s", "KeyS", 83, 2); await wait(`${source}.view.editor.getValue()===${q(text)}&&!${source}.view.session.dirty&&!${source}.view.session.isSaving`, "normal multiline source save"); await exact(text); };
  try {
    await mkdir(join(directory, "Multiline inline notes"), { recursive: true }); await writeFile(join(directory, path), bytes(sourceText));
    await writeFile(configPath, JSON.stringify({ ...options, markdownAutosave: false }, null, 2));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.core.setEnabled("footnotes",true);await app.vault.refresh();await app.metadataCache.refresh()})()');
    await evaluate(`app.workspace.changeLayout(${q(workspace(path, prefix))})`); await bind(); await activatePane();
    await wait(`document.querySelectorAll(${q(entries)}).length===3`, "bounded multiline footnote entries");
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(${q(pane + " .footnotes-pane-title")}),node=>node.textContent)`), ["1. Inline footnote", "2. [^named]", "3. Inline footnote", "4. Inline footnote"]);
    await click(first + " [data-pane-footnote-definition]");
    await wait(`${source}.view.editor.getSelection()===${q("^[" + firstBody + "]")}&&app.workspace.activeLeaf===${source}&&${source}.view.getMode()==="source"`, "actual exact multiline source selection");
    const target = await evaluate(`app.metadataCache.getDocument(${q(path)}).cache.footnotes.find(note=>note.inline).position`);
    assert.deepEqual(await evaluate(`${source}.view.editor.listSelections()[0]`), { anchor: { line: target.start.line, ch: target.start.ch }, head: { line: target.end.line, ch: target.end.ch } });
    await exact(sourceText);
    pass("Multiline inline Footnotes entries share named numbering and reveal the entire exact CRLF/Unicode source token through a trusted pane control, excluding code, escaped syntax, comments and cross-paragraph lookalikes without changing BOM/source bytes.");

    stage = "Reading and source maps";
    await evaluate(`(()=>{app.workspace.setActiveLeaf(${source});${source}.view.setMode("preview",false)})()`);
    await wait(`document.querySelectorAll(${q(reading + " .footnotes li[data-footnote-number]")}).length===4&&document.querySelectorAll(${q(reading + " .footnote-ref")}).length===6`, "mixed multiline Reading references and endnotes");
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(${q(reading + " .footnotes li[data-footnote-number]")}),node=>Number(node.dataset.footnoteNumber))`), [1, 2, 3, 4]);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(reading + ' .footnotes li[data-footnote-number="1"] .katex')}))`), true);
    const reference = reading + ' .footnote-ref[data-footnote-reference="1"] a', back = reading + ' .footnotes li[data-footnote-number="1"] .footnote-backref', url = await evaluate("location.href");
    await click(reference); await wait(`document.activeElement===document.querySelector(${q(reading + ' .footnotes li[data-footnote-number="1"]')})`, "trusted multiline reference reaches its owned endnote");
    await click(back); await wait(`document.activeElement===document.querySelector(${q(reference)})`, "trusted multiline endnote returns to its exact reference");
    await click(reading + ' .footnotes li[data-footnote-number="4"] span');
    assert.equal(await evaluate("globalThis.multilineInlineInjected===true"), false);
    assert.equal(await evaluate(`document.querySelector(${q(reading + ' .footnotes li[data-footnote-number="4"] span')}).hasAttribute("onclick")`), false);
    assert.equal(await evaluate("location.href"), url); assert.equal(await evaluate(`${source}.view.getMode()`), "preview");
    const afterLine = sourceText.slice(0, sourceText.indexOf("# After")).split("\r\n").length - 1;
    assert.equal(await evaluate(`Array.from(${source}.view.previewEl.querySelectorAll("h1")).find(node=>(${logicalHeading.toString()})(node)==="After").dataset.sourceLine`), String(afterLine));
    await evaluate(`app.workspace.setActiveLeaf(${peer})`);
    await wait(`document.querySelectorAll(${q(other + " .footnote-ref")}).length===6`, "independent multiline Reading peer");
    const identities = await evaluate(`[${source}.view,${peer}.view].map(view=>Array.from(view.previewEl.querySelectorAll(".footnote-ref a,.footnotes li[data-footnote-number]"),node=>node.id))`);
    assert.equal(new Set(identities.flat()).size, identities.flat().length);
    await click(other + ' .footnote-ref[data-footnote-reference="1"] a');
    await wait(`${peer}.view.previewEl.contains(document.activeElement)&&document.activeElement.dataset.footnoteNumber==="1"`, "peer link focuses its own multiline note");
    await exact(sourceText); await snap("multiline-inline-footnotes-reading");
    pass("Reading renders multiline Markdown/math and named dependencies with authenticated endnotes, physical reference/back navigation, sanitized bodies, distinct peer identities and unchanged later heading source lines; mode, URL and source bytes stay exact.");

    stage = "dirty source and unsupported draft";
    await sourceMode();
    await evaluate(`${source}.view.editor.setCursor(6,${q("Keep source Ω.".length)});${source}.view.editor.focus()`);
    await wait(`${source}.view.editor.cm.hasFocus`, "dirty multiline source editor focus");
    await command("Input.insertText", { text: " Dirty kept 😀." });
    const dirty = sourceText.replace("Keep source Ω.", "Keep source Ω. Dirty kept 😀."); await readySource(dirty); await exact(sourceText);
    assert.equal(await evaluate(`${source}.view.session.dirty`), true);
    await openEdit(); assert.equal(await draft(), normalize(firstBody));
    await fill("First paragraph\n\nUnsupported second paragraph"); await click(apply);
    await wait('Boolean(document.querySelector("[data-footnote-edit-error]")?.textContent)', "cross-paragraph inline draft refused");
    assert.match(await evaluate('document.querySelector("[data-footnote-edit-error]").textContent'), /parses/);
    assert.equal(await draft(), "First paragraph\n\nUnsupported second paragraph"); assert.equal(await evaluate(`${source}.view.editor.getValue()`), dirty); await exact(sourceText);
    await snap("multiline-inline-footnotes-refused-draft"); await click(cancel); await closed();
    pass("A trusted real-editor prose edit remains dirty and unsaved while a multiple-paragraph inline draft refuses Apply without truncating source, closing the dialog or losing its draft; Cancel retains the original multiline spelling and every physical byte.");

    stage = "multiline Apply Undo Redo save";
    const editedBody = "**Edited multiline λ** [ordinary]\nSecond 😀 and `]`\nThird $x+1$ [^named]", inserted = normalize(editedBody).replaceAll("\n", "\r\n"), edited = dirty.replace("^[" + firstBody + "]", "^[" + inserted + "]");
    await openEdit(); await fill(editedBody); await click(apply); await closed();
    await wait(`${source}.view.editor.getValue()===${q(edited)}&&${peer}.view.editor.getValue()===${q(edited)}`, "shared multiline source update"); await exact(sourceText);
    await sourceMode(); await key(command, "z", "KeyZ", 90, 2); await readySource(dirty);
    await key(command, "y", "KeyY", 89, 2); await readySource(edited);
    await save(edited); await activatePane(); await snap("multiline-inline-footnotes-edited");
    pass("Trusted multiline Apply grows one inline body, keeps later generated/named notes intact and refreshes a real peer. One source Undo restores the prior multiline body while retaining dirty prose, Redo reapplies it, and normal saving preserves exact BOM/CRLF bytes.");

    stage = "unchanged spelling and stale source target";
    await openEdit(); assert.equal(await draft(), normalize(inserted)); await click(apply); await closed(); await exact(edited);
    assert.equal(await evaluate(`${source}.view.session.dirty`), false);
    await activatePane();
    await evaluate(`(()=>{const old=document.querySelector(${q(first + " [data-pane-footnote-definition]")}),view=${source}.view;view.editor.replaceRange("Prefix shift\\n",{line:4,ch:0});globalThis.multilineInlineShiftCursor=view.editor.getCursor();old.click();})()`);
    const shifted = edited.replace("# Before", "Prefix shift\r\n# Before"); await readySource(shifted);
    assert.deepEqual(await evaluate(`${source}.view.editor.getCursor()`), await evaluate("globalThis.multilineInlineShiftCursor")); await save(shifted);
    pass("Applying an unchanged normalized multiline dialog preserves its original source spelling without dirtying the note. A preceding source edit invalidates the old full-token target and cannot move the real editor caret to stale positions.");

    stage = "external version refusal";
    await openEdit(); await fill("Retain stale\nmultiline draft"); await evaluate("app.metadataCache.pause()");
    finalText = shifted.replace("^[" + inserted + "]", "^[**External multiline λ**\r\nExternally replaced 😀]");
    await writeFile(join(directory, path), bytes(finalText)); await click(apply);
    await wait('Boolean(document.querySelector("[data-footnote-edit-error]")?.textContent)', "unobserved external multiline source refuses Apply");
    assert.equal(await draft(), "Retain stale\nmultiline draft"); await exact(finalText);
    await click(cancel); await closed(); await evaluate("(async()=>{await app.metadataCache.refresh();app.metadataCache.resume()})()");
    await wait(`${source}.view.editor.getValue()===${q(finalText)}&&${peer}.view.editor.getValue()===${q(finalText)}`, "external multiline source refresh reaches both real editors");
    pass("A physical external multiline replacement unseen by metadata polling refuses Apply through the real version guard, retains the full draft and external bytes, and refreshes both source owners after cancellation.");

    stage = "restart or reconnection";
    await evaluate("app.workspace.flushLayout()");
    if (restart) await restart(); else { await command("Page.reload"); await afterReload(); }
    await bind();
    await wait(`${source}?.view.editor?.getValue()===${q(finalText)}&&app.workspace.getLeafById(${q(prefix + "-foot")})?.view.getState().file===${q(path)}`, "restored multiline note and independent Footnotes state");
    await activatePane(); await click(first + " [data-pane-footnote-definition]");
    await wait(`${source}.view.editor.getSelection()===${q("^[**External multiline λ**\r\nExternally replaced 😀]")}&&app.workspace.activeLeaf===${source}`, "restored exact multiline source target");
    await exact(finalText); await snap("multiline-inline-footnotes-restored");
    report.multilineInlineFootnotes = { boundedMultilineGrammar: true, mixedNamedNumbering: true, exactSourceOffsetsAndNavigation: true, renderedMarkdownMathAndDependencies: true, trustedReferenceBackNavigation: true,
      sanitizedBodies: true, perViewOwnership: true, laterSourceLineMapping: true, unsupportedDraftRetained: true, priorDirtyProseRetained: true, isolatedUndoRedo: true,
      laterDefinitionsRetained: true, originalSpellingNoop: true, exactBomCrLfSave: true, staleRangeRefused: true, externalVersionRefused: true, restartOrReconnection: true };
    pass("Full native restart or actual-folder reconnection restores the edited multiline source and independent Footnotes file state; a fresh trusted pane click selects the entire current multiline token and physical BOM/CRLF bytes remain exact.");
    report.multilineInlineFootnoteCoverage = { checks, flags: Object.keys(report.multilineInlineFootnotes).length, captures, path, originalSha256: hash(bytes(sourceText)), finalSha256: hash(bytes(finalText)), originalBytes: bytes(sourceText).length, finalBytes: bytes(finalText).length };
  } catch (error) {
    failure = error; report.multilineInlineFootnoteFailure = { stage, error: String(error?.stack ?? error) };
    try { await snap("multiline-inline-footnotes-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    const cleanup = [];
    try { if (await evaluate(`Boolean(document.querySelector(${q(cancel)}))`)) { await click(cancel); await closed(); } await evaluate("app.metadataCache.resume()"); } catch (error) { cleanup.push(error); }
    try { await evaluate("app.saveAll()"); await evaluate(`app.workspace.changeLayout(${q(layout)})`); await evaluate(`app.core.setEnabled("footnotes",${q(enabled)})`); } catch (error) { cleanup.push(error); }
    try { await restoreBytes(configPath, configBytes); await restoreBytes(corePath, coreBytes); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.flushLayout();delete globalThis.multilineInlineSource;delete globalThis.multilineInlinePeer;delete globalThis.multilineInlineShiftCursor;delete globalThis.multilineInlineInjected})()'); assert.deepEqual(await optionalBytes(configPath), configBytes); assert.deepEqual(await optionalBytes(corePath), coreBytes); } catch (error) { cleanup.push(error); }
    if (cleanup.length) { report.multilineInlineFootnoteCleanupErrors = cleanup.map(error => String(error?.stack ?? error)); if (!failure) throw new AggregateError(cleanup, "Multiline inline footnote cleanup failed"); }
  }
}

/** Parent supplies the genuine merged cached mount and audits requests, blobs and local-vault return. */
export async function checkMultilineInlineFootnotesReadOnly(tools) {
  const { evaluate, click, wait, report, capture } = tools, path = "Read only.md", prefix = "readonly-multiline-inline";
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate('app.core.isEnabled("footnotes")'), true);
  const layout = await evaluate("app.workspace.getLayout()"), before = await evaluate('app.metadataCache.getDocuments().map(item=>({path:item.document.file.path,text:item.text,version:item.document.version,hasBom:item.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
  const source = "app.workspace.getLeafById(" + q(prefix + "-source") + ")", foot = "app.workspace.getLeafById(" + q(prefix + "-foot") + ")", pane = '[data-footnotes-pane="' + prefix + '-foot"]';
  let stage = "cached layout", checks = 0, captures = 0;
  const pass = message => { checks++; report.checks.push(message); console.log("PASS " + message); };
  try {
    await evaluate(`app.workspace.changeLayout(${q(workspace(path, prefix, false))})`);
    await wait(`${source}?.view.editor?.getValue().includes(${q("^[" + cachedBody + "]")})&&document.querySelector(${q(pane + " [data-inline-footnote]")})`, "cached multiline source and genuine Footnotes provider");
    const definition = await evaluate(`app.metadataCache.getDocument(${q(path)}).cache.footnotes.find(note=>note.inline&&note.content.startsWith("**Cached multiline λ**"))`);
    assert.ok(definition); const entry = pane + " [data-footnotes-entry=" + q(definition.id) + "]", target = entry + " [data-pane-footnote-definition]", edit = entry + " [data-footnote-edit]";
    await evaluate(`app.workspace.setActiveLeaf(${foot})`); await click(target);
    await wait(`app.workspace.activeLeaf===${source}&&${source}.view.getMode()==="source"&&${source}.view.editor.getSelection()===${q("^[" + cachedBody + "]")}`, "cached trusted multiline exact source selection");
    await evaluate(`app.workspace.setActiveLeaf(${foot})`); assert.equal(await evaluate(`document.querySelector(${q(edit)}).disabled`), true);
    await disabledPointer(tools, edit); assert.equal(await evaluate('Boolean(document.querySelector("[data-footnote-edit-dialog]"))'), false);
    const refusal = await evaluate(`(()=>{const button=document.querySelector(${q(edit)});try{${foot}.view.editDefinition(button.dataset.footnoteEditTarget,Number(button.dataset.footnotesGeneration));return null}catch(error){return error.message}})()`);
    assert.match(refusal, /read-only/);
    pass("A genuine cached read-only multiline inline Footnotes entry still selects the exact complete CRLF/Unicode source token. Its real Edit control is disabled; a physical pointer attempt and forced handler invocation cannot open a draft or edit the cached source.");

    stage = "cached owned Reading navigation";
    const number = Number(await evaluate(`document.querySelector(${q(entry + " .footnotes-pane-title")}).textContent.split(".")[0]`)); assert.ok(number > 0);
    await evaluate(`(()=>{app.workspace.setActiveLeaf(${source});${source}.view.setMode("preview",false);${source}.view.previewEl.dataset.multilineInlineCached="true"})()`);
    const root = '[data-multiline-inline-cached="true"]', reference = root + ' .footnote-ref[data-footnote-reference="' + number + '"] a', note = root + ' .footnotes li[data-footnote-number="' + number + '"]', back = note + " .footnote-backref";
    await wait(`Boolean(document.querySelector(${q(reference)}))&&Boolean(document.querySelector(${q(note + " .katex")}))`, "cached multiline Markdown/math endnote");
    await evaluate(`${source}.view.revealLine(${definition.position.start.line})`);
    await wait(`document.querySelector(${q(reference)})?.checkVisibility()`, "cached multiline reference is visibly revealed");
    await click(reference); await wait(`document.activeElement===document.querySelector(${q(note)})`, "cached trusted reference focuses owned endnote");
    await click(back); await wait(`document.activeElement===document.querySelector(${q(reference)})`, "cached trusted back link focuses exact reference");
    assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(item=>({path:item.document.file.path,text:item.text,version:item.document.version,hasBom:item.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'), before);
    assert.equal(await evaluate("app.vault.readOnly"), true);
    if (capture) { await capture("multiline-inline-footnotes-readonly"); captures++; }
    report.multilineInlineFootnotesReadOnly = { genuineCachedReadOnly: true, exactRawSourceNavigation: true, disabledEditing: true, trustedPointerRefusal: true, forcedHandlerRefusal: true, renderedMarkdownAndMath: true, trustedOwnedReferenceAndBack: true, cachedDocumentsVersionsAndBomExact: true };
    pass("Cached read-only Reading renders the multiline body, Markdown and math; trusted reference/back clicks focus only their owned nodes. Every cached document, version and BOM flag stays exact while the parent verifies zero requests and unchanged blobs.");
    report.multilineInlineFootnoteReadOnlyCoverage = { checks, flags: Object.keys(report.multilineInlineFootnotesReadOnly).length, captures };
  } catch (error) {
    report.multilineInlineFootnotesReadOnlyFailure = { stage, error: String(error?.stack ?? error) };
    try { await capture?.("multiline-inline-footnotes-readonly-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally { await evaluate(`app.workspace.changeLayout(${q(layout)})`); }
}
