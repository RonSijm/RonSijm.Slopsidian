import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, bytes = text => Buffer.from("\ufeff" + text);
const folder = "Mention authoring", sourcePath = folder + "/Source.md", targetPath = folder + "/Targets/Destination.md", shadowPath = folder + "/Other/Destination.md";
const original = '---\r\n# Keep source comment λ\r\nopaque: { exact: true }\r\n---\r\n# Mention authoring\r\n\r\nBefore TARGET λ then Target λ. Keep 😀.\r\n\r\n`TARGET λ` and \\TARGET λ stay literal.\r\n';
const targetText = '---\r\naliases: ["Target λ"] # preserve target comment\r\n---\r\n# Destination Ω\r\n', shadowText = targetText.replace("Ω", "shadow 😀");
const sourceId = "mention-source", mainId = "mention-main", sideId = "mention-side", source = "app.workspace.getLeafById(" + q(sourceId) + ").view";
const pane = id => '[data-outgoing-pane=' + q(id) + ']', link = (id, path = targetPath) => pane(id) + ' [data-outgoing-mention-link=' + q(path) + ']', reveal = (id, path = targetPath) => pane(id) + ' [data-outgoing-mention-row=' + q(path) + '] [data-outgoing-pane-mention]';
const editor = '[data-leaf-id=' + q(sourceId) + '] .cm-content[contenteditable=true]';
const readiness = expected => `(()=>{const source=${source},expected=${expected===undefined?'source?.editor.getValue()':q(expected)};const inspect=id=>{const view=app.workspace.getLeafById(id)?.view,button=view?.contentEl.querySelector(${q('[data-outgoing-mention-link='+q(targetPath)+']')}),review=button&&view.mentionActions?.get(button.dataset.outgoingKey);return{enabled:Boolean(button&&!button.disabled),snapshotTextCurrent:view?.snapshot?.text===expected,reviewTextCurrent:review?.text===expected,sourceEditorCurrent:review?.editor===source?.editor,sourceCmCurrent:review?.cm===source?.editor.cm,sourceDocumentCurrent:review?.cmDocument===source?.editor.cm.state.doc,sourceSessionCurrent:review?.session===source?.session,savedDocumentCurrent:review?.document===source?.savedDocument,savedVersionCurrent:review?.savedVersion===source?.savedDocument?.version,targetIdentityCurrent:Boolean(review&&app.vault.getFileByPath(review.targetPath)===review.target),targetVersionCurrent:Boolean(review&&app.metadataCache.getDocument(review.targetPath)?.document.version===review.targetVersion),preferencesCurrent:Boolean(review&&review.preferences.every(([key,value])=>app.vault.getConfig(key)===value))}};const main=inspect(${q(mainId)}),side=inspect(${q(sideId)}),metadataCurrent=app.metadataCache.getDocument(${q(sourcePath)})?.text===expected;return{sourceLength:source?.editor.getValue().length,metadataCurrent,main,side,ready:metadataCurrent&&Object.values(main).every(Boolean)&&Object.values(side).every(Boolean)}})()`;
export const outgoingMentionReadOnlyFixture = { sourceAddition: "\r\nA Cached mention λ stays unlinked.\r\n", files: [["Cached mention target.md", '---\r\naliases: ["Cached mention λ"]\r\n---\r\n# Cached destination\r\n']] };
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const layout = { version: 1, main: { id: "mention-root", type: "split", direction: "vertical", children: [
  { id: "mention-source-tabs", type: "tabs", currentTab: 0, dimension: 58, children: [{ id: sourceId, type: "leaf", state: { type: "markdown", state: { file: sourcePath, mode: "source", source: true } } }] },
  { id: "mention-main-tabs", type: "tabs", currentTab: 0, dimension: 42, children: [{ id: mainId, type: "leaf", state: { type: "outgoing-link", state: { file: sourcePath, followActiveFile: false, unlinkedCollapsed: false } } }] },
] }, right: { width: 310, collapsed: false, root: { id: "mention-right", type: "split", direction: "horizontal", children: [{ id: "mention-side-tabs", type: "tabs", currentTab: 0, children: [{ id: sideId, type: "leaf", state: { type: "outgoing-link", state: { file: sourcePath, followActiveFile: false, unlinkedCollapsed: false } } }] }] } }, active: sourceId };

export async function checkOutgoingMentionAuthoring(tools) {
  const { directory, evaluate, wait, click, press, command, report, restart, afterReload, capture } = tools;
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const oldLayout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("outgoing-link")');
  const configPath = join(directory, ".obsidian/app.json"), configBytes = await readFile(configPath), config = JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, ""));
  const corePath = join(directory, ".obsidian/core-plugins.json"), coreBytes = await readFile(corePath).catch(error => { if (error.code === "ENOENT") { return null; } throw error; });
  let failure, stage = "fixture", finalText = original, events = [], witnesses = [];
  const working = markdown => Buffer.from(JSON.stringify({ ...config, markdownAutosave: false, useMarkdownLinks: markdown, newLinkFormat: markdown ? "relative" : "shortest" }));
  const setPreferences = async markdown => { await writeFile(configPath, working(markdown)); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();app.metadataCache.updateOpenDocuments()})()'); };
  const refresh = () => evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  const exact = async text => { assert.deepEqual(await readFile(join(directory, sourcePath)), bytes(text)); assert.deepEqual(await readFile(join(directory, targetPath)), bytes(targetText)); assert.deepEqual(await readFile(join(directory, shadowPath)), bytes(shadowText)); };
  const focusSource = async () => { await click(editor); await wait(`app.workspace.activeLeaf.id===${q(sourceId)}`, "visible source editor receives trusted focus without a tab save"); };
  const value = () => evaluate(source + ".editor.getValue()");
  const save = async expected => { await focusSource(); await press("s", "KeyS", 83, 2); await wait(source + ".session.text===" + q(expected) + "&&!" + source + ".session.dirty&&!" + source + ".session.isSaving", "normal guarded mention save"); await exact(expected); };
  const undo = async expected => { await focusSource(); await press("z", "KeyZ", 90, 2); await wait(source + ".editor.getValue()===" + q(expected), "isolated mention Undo"); };
  const ready = async expected => { if(expected===undefined)expected=await value();const expression=readiness(expected),entry={stage,initial:await evaluate(expression)};(report.outgoingMentionReadiness??=[]).push(entry);await wait('('+expression+').ready',"metadata, pane snapshots and exact current authoring witnesses on both panes");entry.settled=await evaluate(expression); };
  const conflictState = () => evaluate(`(()=>{const p=app.workspace.getLeafById(${q(mainId)}).view,s=${source};return{root:app.vault.rootPath,path:s.file?.path,text:s.editor.getValue(),dirty:s.session?.dirty,pending:app.core.pending.size,token:p.navigationToken,opening:p.opening,status:p.contentEl.querySelector('[data-outgoing-status]')?.textContent,currentOwners:p.isLoaded&&p.leaf.view===p&&s.isLoaded&&s.leaf.view===s&&s.file===app.vault.getFileByPath(${q(sourcePath)})&&p.file===s.file,editorCurrent:s.editor===mentionOriginalEditor}})()`);
  const conflict = async (label, expected, changedPath, changedText) => {
    const entry={stage,before:await conflictState(),review:await evaluate(readiness(expected))};(report.outgoingMentionConflicts??=[]).push(entry);assert.equal(entry.review.ready,true);
    await evaluate('(()=>{const p=globalThis.mentionConflictRead={original:app.vault.readDocument,reads:[]};app.vault.readDocument=async function(path){const document=await p.original.call(this,path);p.reads.push({path,content:document.content,version:document.version,hasBom:document.hasBom});return document};return true})()');
    try {
      await click(link(mainId));entry.afterClick=await conflictState();await evaluate("app.core.whenIdle()");entry.settled=await conflictState();entry.reads=await evaluate("mentionConflictRead.reads");
      assert.equal(entry.settled.pending,0);assert.equal(entry.settled.opening,false);assert.ok(entry.settled.token>entry.before.token,"The current conflict action actually entered its guarded controller");assert.equal(entry.settled.currentOwners,true);assert.equal(entry.settled.editorCurrent,true);assert.equal(entry.settled.root,entry.before.root);assert.equal(entry.settled.path,sourcePath);assert.equal(entry.settled.text,expected);
      assert.ok(entry.reads.some(read=>read.path===changedPath&&read.content===changedText&&read.hasBom===true),"The settled action actually read the retained changed physical document");
      await wait('document.querySelector(' + q(pane(mainId) + " [data-outgoing-status]") + ').textContent.includes("changed")',label);
    } finally { await evaluate('(()=>{const p=globalThis.mentionConflictRead;if(p)app.vault.readDocument=p.original;delete globalThis.mentionConflictRead;return true})()'); }
  };
  const trace = () => evaluate(`(()=>{const t=globalThis.mentionInputTrace={events:[],witnesses:[],abort:new AbortController()};for(const type of ['pointerdown','keydown'])document.addEventListener(type,event=>{if(event.target.closest?.('[data-outgoing-pane],.outgoing-link-pane,[data-leaf-id="${sourceId}"]'))t.events.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});document.addEventListener('click',event=>{if(event.target.closest?.('[data-outgoing-mention-link]'))t.witnesses.push({trusted:event.isTrusted,key:event.target.closest('[data-outgoing-mention-link]').dataset.outgoingKey??null,state:${readiness()}})},{capture:true,signal:t.abort.signal});return true})()`);
  const restoreRead = () => evaluate('(()=>{const h=globalThis.mentionHeldRead;if(h){h.released=true;app.vault.readDocument=h.original;for(const release of h.releases.splice(0))release();delete globalThis.mentionHeldRead;}return true})()');
  try {
    if (!enabled) await evaluate('app.core.setEnabled("outgoing-link",true)');
    await mkdir(join(directory, folder)); await mkdir(join(directory, folder, "Targets")); await mkdir(join(directory, folder, "Other"));
    for (const [path, text] of [[sourcePath, original], [targetPath, targetText], [shadowPath, shadowText]]) await writeFile(join(directory, path), bytes(text), { flag: "wx" });
    await setPreferences(false); await refresh(); await evaluate("app.workspace.changeLayout(" + q(layout) + ")");
    if (await evaluate('document.querySelector(\'[data-sidebar-view="workspace-right"]\')?.getAttribute("aria-selected")!=="true"')) await click('[data-sidebar-view="workspace-right"]');
    await ready(); await trace();
    await evaluate('globalThis.mentionOriginalEditor=' + source + '.editor;true');
    await click(reveal(mainId)); await wait(source + '.editor.getSelection()==="TARGET λ"', "ordinary exact mention reveal"); await exact(original);
    assert.equal(await evaluate('document.querySelectorAll(' + q(pane(mainId) + " img, " + pane(mainId) + " script") + ').length'), 0); await capture?.("mention-choices");
    pass(report, "Outgoing links keeps a separate exact Source reveal and explicit Link mention buttons. Shared aliases/basenames show full destination paths in independent main/sidebar panes, without changing either note or interpreting label text as HTML.");

    stage = "dirty shared history"; await focusSource(); await press("End", "End", 35, 2); await command("Input.insertText", { text: "Earlier dirty prose Ω.\n" });
    const dirty = original + "Earlier dirty prose Ω.\r\n"; await wait(source + ".editor.getValue()===" + q(dirty), "trusted earlier dirty prose"); await ready();
    const linkedDirty = dirty.replace("TARGET λ", "[[Mention authoring/Targets/Destination|TARGET λ]]"); await click(link(mainId)); await wait(source + ".editor.getValue()===" + q(linkedDirty), "explicit wiki mention insertion");
    assert.equal(await evaluate(source + ".session.dirty"), true); assert.equal(await evaluate(source + ".editor===mentionOriginalEditor"), true); await exact(original);
    await undo(dirty); await press("y", "KeyY", 89, 2); await wait(source + ".editor.getValue()===" + q(linkedDirty), "mention Redo"); await undo(dirty); await undo(original); await exact(original);
    pass(report, "A trusted mention action edits only the selected occurrence through the original shared CodeMirror owner. One Undo restores unlinked wording while retaining earlier dirty prose; Redo and a separate earlier Undo work, with original BOM/CRLF/Unicode physical files unchanged.");

    stage = "wiki save"; await ready(); await click(link(mainId)); const wiki = original.replace("TARGET λ", "[[Mention authoring/Targets/Destination|TARGET λ]]"); await wait(source + ".editor.getValue()===" + q(wiki), "unique reviewed wiki link"); await save(wiki); await undo(original); await save(original);
    pass(report, "Normal Ctrl+S saves the uniquely resolving preference-aware wiki link with exact original casing. The unselected duplicate alias, other mentions, comments, target notes and BOM/CRLF/Unicode bytes remain intact; source Undo restores only that occurrence.");

    stage = "sidebar Markdown preference"; await setPreferences(true); await evaluate("app.metadataCache.refresh()"); await ready();
    const markdown = original.replace("TARGET λ", "[TARGET λ](Targets/Destination.md)"); await click(link(sideId)); await wait(source + ".editor.getValue()===" + q(markdown), "sidebar relative Markdown mention link"); await save(markdown); await capture?.("mention-markdown"); await undo(original); await save(original);
    assert.deepEqual(await readFile(configPath), working(true));
    pass(report, "An independent fixed sidebar links the same explicit destination using actual relative Markdown-link preferences. Its exact display wording, URI target and normal saved bytes are retained without silently choosing another note with the same alias.");

    stage = "legacy sidebar"; await focusSource(); await click('[data-sidebar-view="outgoing-link"]');
    if (await evaluate('document.querySelector(".outgoing-link-pane [data-outgoing-source]")?.dataset.outgoingSource!==' + q(sourcePath))) await click('.outgoing-link-pane [data-outgoing-pin]');
    const legacy = '.outgoing-link-pane [data-outgoing-mention-link=' + q(targetPath) + ']';
    if (!await evaluate('Boolean(document.querySelector(' + q(legacy) + '))')) await click('.outgoing-link-pane [data-outgoing-section="unlinked"] > summary');
    await wait('Boolean(document.querySelector(' + q(legacy) + ')&&!document.querySelector(' + q(legacy) + ').disabled)', "legacy explicit mention action");
    await click(legacy); await wait(source + ".editor.getValue()===" + q(markdown), "legacy sidebar mention link"); await save(markdown); await undo(original); await save(original); await click('[data-sidebar-view="workspace-right"]');
    pass(report, "The legacy Outgoing sidebar exposes the same separate explicit action and guarded shared-editor behavior. It follows the current Markdown preferences and preserves exact saved bytes and one-step source Undo.");

    stage = "physical source conflict"; await focusSource(); await press("End", "End", 35, 2); await command("Input.insertText", { text: "Earlier dirty prose Ω.\n" }); await wait(source + ".editor.getValue()===" + q(dirty)); await ready();
    await evaluate("app.metadataCache.pause()"); const external = original + "External newer bytes retained Ω.\r\n"; await writeFile(join(directory, sourcePath), bytes(external));
    await conflict("physical source replacement refusal", dirty, sourcePath, external);
    assert.equal(await value(), dirty); assert.equal(await evaluate(source + ".session.dirty"), true); assert.deepEqual(await readFile(join(directory, sourcePath)), bytes(external));
    await undo(original); await evaluate("app.metadataCache.resume()"); await refresh(); await wait(source + ".editor.getValue()===" + q(external));
    await writeFile(join(directory, sourcePath), bytes(original)); await refresh(); await wait(source + ".editor.getValue()===" + q(original)); await ready(original);
    pass(report, "A physical source replacement unseen by metadata refuses a retained mention action before any editor mutation. The earlier dirty draft and its Undo remain, the newer physical file is retained, and ordinary refresh adopts it only after the disposable dirty edit is undone.");

    stage = "target physical conflict"; await evaluate("app.metadataCache.pause()"); const newerTarget = targetText + "Newer destination content 😀.\r\n"; await writeFile(join(directory, targetPath), bytes(newerTarget));
    await conflict("physical destination replacement refusal", original, targetPath, newerTarget);
    assert.equal(await value(), original); assert.deepEqual(await readFile(join(directory, targetPath)), bytes(newerTarget)); assert.deepEqual(await readFile(join(directory, sourcePath)), bytes(original));
    await writeFile(join(directory, targetPath), bytes(targetText)); await evaluate("app.metadataCache.resume()"); await refresh(); assert.equal(await value(),original);await ready(original);
    pass(report, "A destination physically replaced after its mention was displayed also refuses before source mutation. The newer destination and untouched source retain exact bytes; no target save or implicit alias retargeting occurs.");

    stage = "held real read"; assert.equal(await value(),original);await ready(original);await evaluate("app.metadataCache.pause()");
    await evaluate(`(()=>{const h=globalThis.mentionHeldRead={original:app.vault.readDocument,pending:false,releases:[],released:false};app.vault.readDocument=async function(path){const value=await h.original.call(this,path);if(path===${q(sourcePath)}&&!h.released){h.pending=true;await new Promise(resolve=>h.releases.push(resolve))}return value};return true})()`);
    await click(link(mainId)); await wait("mentionHeldRead.pending", "actual checked source read is held"); await focusSource(); await press("End", "End", 35, 2); await command("Input.insertText", { text: "Earlier dirty prose Ω.\n" });
    await restoreRead(); await evaluate("app.core.whenIdle()"); await wait(source + ".editor.getValue()===" + q(dirty)); assert.equal((await value()).includes("[TARGET λ]"), false); await exact(original); await undo(original);
    await evaluate("app.metadataCache.resume()"); await refresh(); await ready();
    pass(report, "A real read held after transport cannot apply after trusted source typing changes the original document. Releasing the read leaves only that dirty prose, preserves physical files, and requires a fresh current mention action.");

    stage = "restart"; await click(link(mainId)); finalText = markdown; await wait(source + ".editor.getValue()===" + q(finalText)); await save(finalText); await evaluate("app.workspace.flushLayout()");
    events.push(...await evaluate("mentionInputTrace.events"));witnesses.push(...await evaluate("mentionInputTrace.witnesses")); await evaluate("mentionInputTrace.abort.abort();true");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(source + ".editor.getValue()===" + q(finalText), "saved mention after fresh runtime"); await ready(); await trace(); await click(reveal(mainId)); await wait(source + '.editor.getSelection()==="Target λ"', "fresh exact remaining mention reveal"); await exact(finalText); assert.deepEqual(await readFile(configPath), working(true)); await capture?.("mention-restored");
    events.push(...await evaluate("mentionInputTrace.events"));witnesses.push(...await evaluate("mentionInputTrace.witnesses")); assert.ok(events.length > 20 && events.every(event => event.trusted)); report.outgoingMentionInputs = events;report.outgoingMentionWitnesses=witnesses;
    report.outgoingMentionAuthoring = { explicitAction: true, separateReveal: true, explicitDuplicateDestination: true, mainAndSidebar: true, legacySidebar: true, wikiPreferences: true, markdownPreferences: true, exactWording: true, sharedEditor: true, dirtyHistoryUndoRedo: true, sourcePhysicalConflict: true, targetPhysicalConflict: true, heldReadRefused: true, exactBomCrlfUnicode: true, restartReconnection: true, trustedInputs: true };
    pass(report, "Full native restart or actual-folder reconnection retains exact linked source, preferences and independent pane targets. Fresh trusted reveal selects only the remaining current unlinked occurrence; every recorded main/sidebar/legacy input is trusted.");
  } catch (error) {
    failure = error; report.outgoingMentionFailure = { stage, error: String(error?.stack ?? error) };
    try { report.outgoingMentionFailure.state = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,source:${source}?.editor.getValue(),main:document.querySelector(${q(pane(mainId))})?.textContent,side:document.querySelector(${q(pane(sideId))})?.textContent,witnesses:globalThis.mentionInputTrace?.witnesses??[],readiness:${readiness()},layout:app.workspace.getLayout(),sidebars:Array.from(document.querySelectorAll('[data-sidebar-view]'),node=>({id:node.dataset.sidebarView,disabled:node.disabled,selected:node.getAttribute('aria-selected'),visible:node.checkVisibility()}))}))()`); await capture?.("mention-failure"); } catch {}
    throw error;
  } finally {
    try {
      await restoreRead(); await evaluate("app.metadataCache.resume();globalThis.mentionInputTrace?.abort.abort();delete globalThis.mentionInputTrace;delete globalThis.mentionOriginalEditor;true");
      await evaluate("app.saveAll()"); await writeFile(configPath, configBytes); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(' + q(oldLayout) + ');await app.workspace.flushLayout()})()');
      if (!enabled) await evaluate('app.core.setEnabled("outgoing-link",false)'); if (coreBytes !== null) await writeFile(corePath, coreBytes); else await unlink(corePath).catch(error => { if (error.code !== "ENOENT") { throw error; } });
    } catch (error) { if (!failure) throw error; report.outgoingMentionFailure.cleanupError = String(error?.stack ?? error); }
  }
}

export async function checkOutgoingMentionAuthoringReadOnly(tools) {
  const { evaluate, click, wait, command, capture, report } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const before = await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
  const id = await evaluate('(async()=>{const leaf=app.workspace.getLeaf("split");await leaf.setViewState({type:"outgoing-link",state:{file:"Read only.md",followActiveFile:false,unlinkedCollapsed:false}});return leaf.id})()');
  const selector = link(id, "Cached mention target.md"); await wait('Boolean(document.querySelector(' + q(selector) + '))', "genuine cached unlinked mention"); assert.equal(await evaluate('document.querySelector(' + q(selector) + ').disabled'), true);
  await evaluate('globalThis.mentionReadOnlyProbe={original:app.vault.readDocument,reads:0};app.vault.readDocument=function(...args){mentionReadOnlyProbe.reads++;return mentionReadOnlyProbe.original.apply(this,args)};true');
  try {
    const point = await evaluate('(()=>{const node=document.querySelector(' + q(selector) + ');node.scrollIntoView({block:"center"});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node}})()'); assert.equal(point.hit, true);
    for (const type of ["mousePressed", "mouseReleased"]) await command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    await evaluate('(()=>{const node=document.querySelector(' + q(selector) + ');node.disabled=false;node.click();node.disabled=true;return true})()'); await evaluate("app.core.whenIdle()");
    assert.equal(await evaluate("mentionReadOnlyProbe.reads"), 0); assert.equal(await evaluate('document.querySelector(' + q(selector) + ').disabled'), true); await capture?.("mention-readonly");
    pass(report, "A genuine cache-only Outgoing pane keeps Link mention disabled. Trusted disabled-pointer input and a forced enabled handler cannot reach a source/target read or insert a link.");
    await click(reveal(id, "Cached mention target.md")); await wait('app.workspace.activeLeaf.view.editor?.getSelection()==="Cached mention λ"', "read-only exact mention reveal");
    assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'), before);
    assert.deepEqual(await evaluate('(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), { api: 0, raw: 0 });
    report.outgoingMentionReadOnly = { genuineCachedReadOnly: true, actionDisabled: true, forcedHandlerRefused: true, noAuthoringReads: true, exactReveal: true, sourceAndVersionsUnchanged: true, zeroApiRaw: true, localStateOnly: true };
    pass(report, "Read-only mention reveal still selects the exact full Unicode source wording. Cached documents, versions and BOM flags remain unchanged with zero API/raw requests; the parent separately audits every stored blob.");
  } finally { await evaluate('(()=>{const p=globalThis.mentionReadOnlyProbe;if(p)app.vault.readDocument=p.original;delete globalThis.mentionReadOnlyProbe;return true})()'); }
}
