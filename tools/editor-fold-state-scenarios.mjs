import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, current = "[data-fold-continuity-current]", storageKey = "fold-state-v1";
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
const folded = tools => tools.evaluate("app.editor.getFoldInfo().folds");
async function mark({ evaluate }) {
  await evaluate(`(()=>{for(const node of document.querySelectorAll(${q(current)}))delete node.dataset.foldContinuityCurrent;app.editor.cm.dom.dataset.foldContinuityCurrent="true"})()`);
}
async function fresh(tools, path, mode = "source") {
  await tools.evaluate(`(async()=>{const leaf=app.workspace.getLeaf("tab");await leaf.openFile(app.vault.getFileByPath(${q(path)}));leaf.view.setEditingMode(${q(mode)},false);app.workspace.setActiveLeaf(leaf,{focus:false})})()`);
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getEditingMode()===${q(mode)}`, "a fresh owned Markdown editor");
  await mark(tools);
}
async function sourceLine(tools, line) {
  await tools.evaluate(`(()=>{app.editor.setCursor(${line},0);app.editor.scrollIntoView({from:{line:${line},ch:0},to:{line:${line},ch:0}},true);app.editor.cm.requestMeasure()})()`);
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
}
async function pointer(tools, line, open = true) {
  await sourceLine(tools, line);
  const selector = current + ` [data-editor-fold-line=${q(String(line + 1))}][data-editor-fold-open=${q(String(open))}]`;
  await tools.wait(`(()=>{const marker=document.querySelector(${q(selector)});return Boolean(marker?.checkVisibility())})()`, "the visible current fold gutter marker");
  await tools.click(selector);
  await tools.wait(`app.editor.getFoldInfo().folds.some(fold=>fold.from===${line})===${open}`, "the real gutter action changes its current fold");
}
async function preference(tools, key, value) {
  const selector = `[data-editor-settings] [data-setting-key=${q(key)}] [role="switch"]`;
  if (!await tools.evaluate('document.querySelector("#settings-dialog").open')) await tools.click("#open-settings");
  await tools.click("#editor-settings-tab"); await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "the real folding preference switch");
  if (await tools.evaluate(`document.querySelector(${q(selector)}).getAttribute("aria-checked")!==${q(String(value))}`)) await tools.click(selector);
  await tools.wait(`app.configuration.get("app",${q(key)})===${value}`, "the accepted folding preference");
  await tools.click(".settings-close");
}
async function exact(tools, path, text) {
  assert.equal(await tools.evaluate("app.editor.getValue()"), text);
  assert.deepEqual(await readFile(join(tools.directory, path)), Buffer.from("\ufeff" + text));
}
async function closeNotePanes(tools, path) {
  await tools.evaluate(`(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("markdown")])if(leaf.view.file?.path===${q(path)})await app.workspace.closeLeaf(leaf)})()`);
}
const record = (tools, path) => tools.evaluate(`app.loadLocalStorage(${q(storageKey)})?.records.find(record=>record.channel==="editor"&&record.path===${q(path)})??null`);
async function retainedRenameOwner(tools, path) {
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&!app.workspace.isChangingFiles&&app.workspace.sessions.get(${q(path)})===__editorFoldRenameProbe.session`, "the confirmed renamed note retains its remapped session");
  assert.equal(await tools.evaluate("app.editor===__editorFoldRenameProbe.editor&&app.editor.cm===__editorFoldRenameProbe.cm&&app.editor.cm.state.doc===__editorFoldRenameProbe.doc&&app.workspace.getActiveFile()===__editorFoldRenameProbe.file"), true);
  await mark(tools);
}
async function checkRenamedEditorFolds(tools) {
  const { directory, evaluate, command, report } = tools;
  const folder = "Fold continuity/Rename old", movedFolder = "Fold continuity/Rename moved";
  const oldPath = folder + "/Sub/Before.md", directPath = folder + "/Sub/After.md", movedPath = movedFolder + "/Sub/After.md";
  const text = ['---', 'opaque: [ kept, λ ]', '---', '# Rename continuity', 'Intro before move.', '', '## Renamed heading', 'Heading body.', '',
    '## Lists', '', '- Parent', '  - Child', '    - Grandchild', '', '## Code', '', '```js', 'const kept = "λ 😀";', '```', '', '## Last', 'Last body.', ''].join("\r\n");
  const lines = text.split("\r\n"), heading = lines.indexOf("## Renamed heading"), list = lines.indexOf("- Parent"), code = lines.indexOf("```js"), intro = lines.indexOf("Intro before move.");
  await mkdir(join(directory, folder, "Sub"), { recursive: true }); await writeFile(join(directory, oldPath), Buffer.from("\ufeff" + text), { flag: "wx" }); await evaluate("app.vault.refresh()");
  await fresh(tools, oldPath); await sourceLine(tools, intro); await evaluate("app.editor.focus()"); await command("Input.insertText", { text: "Rename history " });
  await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text); await pointer(tools, heading); await sourceLine(tools, 0);
  await evaluate("(()=>{globalThis.__editorFoldRenameProbe={leaf:app.workspace.activeLeaf,editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc,file:app.workspace.getActiveFile(),session:app.workspace.activeLeaf.view.session};return true})()");
  const initial = await record(tools, oldPath), initialFolds = await folded(tools); assert.ok(initial); assert.deepEqual(initialFolds.map(fold => fold.from), [heading]);

  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${q(oldPath)}),${q(directPath)},false)`); await retainedRenameOwner(tools, directPath);
  assert.equal(await record(tools, oldPath), null); assert.deepEqual(await record(tools, directPath), { ...initial, path: directPath });
  assert.deepEqual(await folded(tools), initialFolds); await exact(tools, directPath, text); await assert.rejects(readFile(join(directory, oldPath)), { code: "ENOENT" });
  await fresh(tools, directPath); assert.deepEqual(await folded(tools), initialFolds, "the confirmed note rename migrates the existing profile folds before another fold action");
  await evaluate('(async()=>{await app.workspace.closeLeaf(app.workspace.activeLeaf);app.workspace.setActiveLeaf(__editorFoldRenameProbe.leaf,{focus:false})})()'); await retainedRenameOwner(tools, directPath);
  await pointer(tools, list); await sourceLine(tools, 0);
  const afterFile = await record(tools, directPath), fileFolds = await folded(tools); assert.equal(afterFile.value.length, 2); assert.equal(await record(tools, oldPath), null);

  await evaluate(`app.fileManager.renameFile(app.vault.getFolderByPath(${q(folder)}),${q(movedFolder)},false)`); await retainedRenameOwner(tools, movedPath);
  assert.equal(await record(tools, directPath), null); assert.deepEqual(await record(tools, movedPath), { ...afterFile, path: movedPath });
  assert.deepEqual(await folded(tools), fileFolds); await exact(tools, movedPath, text); await assert.rejects(readFile(join(directory, directPath)), { code: "ENOENT" });
  await fresh(tools, movedPath); assert.deepEqual(await folded(tools), fileFolds, "the confirmed ancestor-folder move migrates the descendant's profile folds");
  await evaluate('(async()=>{await app.workspace.closeLeaf(app.workspace.activeLeaf);app.workspace.setActiveLeaf(__editorFoldRenameProbe.leaf,{focus:false})})()'); await retainedRenameOwner(tools, movedPath);
  await pointer(tools, code); await sourceLine(tools, 0);
  const movedFolds = await folded(tools); assert.deepEqual(movedFolds.map(fold => fold.from), [heading, list, code]); assert.equal((await record(tools, movedPath)).value.length, 3);
  assert.equal(await record(tools, oldPath), null); assert.equal(await record(tools, directPath), null);
  await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Intro before move.", "Rename history Intro before move."));
  await evaluate("app.editor.undo()"); await exact(tools, movedPath, text); assert.equal(await evaluate("app.workspace.activeLeaf.view.hasUnsavedChanges"), false);
  await fresh(tools, movedPath); assert.deepEqual(await folded(tools), movedFolds); await exact(tools, movedPath, text); await tools.capture?.("editor-fold-continuity-renamed");
  pass(report, "Confirmed FileManager note and ancestor-folder renames migrate existing profile folds and retire both old paths. The same editor/document/session and prior real typing Undo/Redo survive; trusted new-path list/code gutter actions persist under the moved path and a fresh pane restores them with exact BOM/CRLF/Unicode bytes.");
}

/** Per-file Source/Live Preview folds through real local storage and owned host restart. */
export async function checkEditorFoldState(tools) {
  const { directory, evaluate, wait, command, afterReload, restart, report, capture } = tools;
  const path = "Fold continuity/Remember.md", other = "Fold continuity/Other.md";
  const text = ['---', 'opaque: "keep λ 😀"', '---', '# Fold continuity', 'Intro body.', '', '## Heading λ', 'Heading body.', '', '### Nested', 'Nested body.', '',
    '## List container', '', '- Parent', '  - Child', '    - Grandchild', '', '## Code container', '', '```js', 'function kept() {', '  return "λ 😀";', '}', '```', '', '## Last', 'Last body.', ''].join("\r\n");
  const lines = text.split("\r\n"), heading = lines.indexOf("## Heading λ"), list = lines.indexOf("- Parent"), code = lines.indexOf("```js"), intro = lines.indexOf("Intro body.");
  const bytes = Buffer.from("\ufeff" + text), otherText = text.replace("# Fold continuity", "# Other continuity").replace("Heading body.", "Another body."), otherBytes = Buffer.from("\ufeff" + otherText);
  const configPath = join(directory, ".obsidian", "app.json"), originalConfig = await readFile(configPath), originalOptions = JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, ""));
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), stored = await evaluate(`app.loadLocalStorage(${q(storageKey)})`);
  await mkdir(join(directory, "Fold continuity"), { recursive: true }); await writeFile(join(directory, path), bytes, { flag: "wx" }); await writeFile(join(directory, other), otherBytes, { flag: "wx" });
  let stage = "initial real folds";
  try {
    await writeFile(configPath, encode({ ...originalOptions, markdownAutosave: false, foldHeading: true, foldIndent: true }));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh()})()');
    await fresh(tools, path); await sourceLine(tools, intro); await evaluate("app.editor.focus()"); await command("Input.insertText", { text: "History " });
    await evaluate("app.editor.undo()"); assert.equal(await evaluate("app.editor.getValue()"), text);
    await evaluate("(()=>{globalThis.__editorFoldStateProbe={editor:app.editor,cm:app.editor.cm,doc:app.editor.cm.state.doc};return true})()");
    for (const line of [heading, list, code]) await pointer(tools, line);
    const saved = await folded(tools); assert.deepEqual(saved.map(fold => fold.from), [heading, list, code]);
    await sourceLine(tools, 0);
    for (const mode of ["live-preview", "source"]) {
      await evaluate(`app.workspace.activeLeaf.view.setEditingMode(${q(mode)},false)`); assert.deepEqual(await folded(tools), saved);
      assert.equal(await evaluate("app.editor===__editorFoldStateProbe.editor&&app.editor.cm===__editorFoldStateProbe.cm&&app.editor.cm.state.doc===__editorFoldStateProbe.doc"), true);
    }
    await evaluate("app.editor.redo()"); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Intro body.", "History Intro body."));
    await evaluate("app.editor.undo()"); await exact(tools, path, text);
    assert.equal(await evaluate(`app.loadLocalStorage(${q(storageKey)}).records.some(record=>record.channel==="editor"&&record.path===${q(path)}&&record.value.length===3)`), true);
    await capture?.("editor-fold-continuity-source");
    pass(report, "Actual Source gutter pointers persist separate heading/list/code folds locally. Source/Live Preview transitions retain the same editor/document, and prior real typing Undo/Redo retains exact BOM/CRLF/Unicode note bytes.");

    stage = "per-file fresh panes and duplicate writers";
    await evaluate(`app.openFile(${q(other)})`); assert.deepEqual(await folded(tools), []); assert.equal(await evaluate("app.editor.getValue()"), otherText);
    await fresh(tools, path); assert.deepEqual(await folded(tools), saved);
    await evaluate("(()=>{__editorFoldStateProbe.peer=app.workspace.activeLeaf;return true})()");
    await fresh(tools, path, "live-preview"); assert.deepEqual(await folded(tools), saved);
    await evaluate('app.editor.exec("unfoldAll")'); assert.deepEqual(await folded(tools), []);
    assert.deepEqual(await evaluate("__editorFoldStateProbe.peer.view.editor.getFoldInfo().folds"), saved);
    await evaluate("app.workspace.closeLeaf(__editorFoldStateProbe.peer)"); await fresh(tools, path);
    assert.deepEqual(await folded(tools), [], "an idle closing peer cannot overwrite the last user's expansion");
    for (const line of [heading, list, code]) await pointer(tools, line); await sourceLine(tools, 0);
    pass(report, "A fresh Source/Live Preview pane restores only its actual file's saved folds. Duplicate panes keep independent views; the last user expansion wins for the next pane, and closing an idle folded peer does not overwrite it.");

    stage = "owned full restart";
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.editor.getValue()===${q(text)}`, "the remembered note after owned host restart/reconnection");
    await mark(tools); assert.deepEqual(await folded(tools), saved); await exact(tools, path, text); await capture?.("editor-fold-continuity-restarted");
    pass(report, "Full native restart or actual-folder browser reconnection restores the exact-source heading/list/code folds from vault-local profile storage; saved note bytes remain unchanged.");

    stage = "dirty shared text and preference-off folds";
    await evaluate("(()=>{globalThis.__editorFoldStateProbe={origin:app.workspace.activeLeaf};return true})()");
    await sourceLine(tools, intro); await evaluate("app.editor.focus()"); await command("Input.insertText", { text: "Dirty " });
    await wait("app.workspace.activeLeaf.view.hasUnsavedChanges", "the genuine unsaved shared document");
    await fresh(tools, path); assert.equal(await evaluate("app.editor.getValue()"), text.replace("Intro body.", "Dirty Intro body."));
    assert.deepEqual(await folded(tools), [], "opening a dirty shared document does not replay a stored view over it");
    await evaluate("(()=>{app.workspace.setActiveLeaf(__editorFoldStateProbe.origin,{focus:true});__editorFoldStateProbe.origin.view.editor.focus();return true})()");
    await wait("app.workspace.activeLeaf===__editorFoldStateProbe.origin&&app.editor===__editorFoldStateProbe.origin.view.editor&&app.editor.cm.hasFocus&&app.editor.cm.dom.getClientRects().length>0", "the original dirty pane is active, visible and focused before Undo"); await mark(tools);
    await evaluate("app.editor.undo()"); await wait(`app.editor.getValue()===${q(text)}&&!app.workspace.activeLeaf.view.hasUnsavedChanges`, "the original editor undoes the exact shared dirty edit");
    assert.deepEqual(await folded(tools), saved); const cleanRecord = await record(tools, path); assert.equal(cleanRecord.length, text.length); assert.equal(cleanRecord.value.length, saved.length);
    await fresh(tools, path); assert.deepEqual(await folded(tools), saved);
    await preference(tools, "foldHeading", false); await preference(tools, "foldIndent", false);
    assert.deepEqual((await folded(tools)).map(fold => fold.from), [code]); await fresh(tools, path);
    assert.deepEqual((await folded(tools)).map(fold => fold.from), [code]);
    await preference(tools, "foldHeading", true); await preference(tools, "foldIndent", true);
    assert.deepEqual((await folded(tools)).map(fold => fold.from), [code]);
    await evaluate('app.editor.exec("unfoldAll")'); for (const line of [heading, list, code]) await pointer(tools, line); await sourceLine(tools, 0); await exact(tools, path, text);
    pass(report, "A new peer of a genuinely dirty note receives shared text without replaying saved folds; Undo in its original editor restores exact clean text. Disabling headings/lists saves only the independent code fold, and reenabling controls does not silently recollapse them.");

    stage = "same-line-count source mismatch and corrupt local state";
    await evaluate(`app.openFile(${q(other)})`); await closeNotePanes(tools, path);
    const changed = text.replace("Heading body.", "Changed body."); assert.equal(changed.split("\r\n").length, lines.length);
    await writeFile(join(directory, path), Buffer.from("\ufeff" + changed)); await evaluate("app.vault.refresh()"); await fresh(tools, path);
    assert.equal(await evaluate("app.editor.getValue()"), changed); assert.deepEqual(await folded(tools), [], "equal line counts do not prove source identity");
    await evaluate(`app.openFile(${q(other)})`); await closeNotePanes(tools, path); await writeFile(join(directory, path), bytes); await evaluate("app.vault.refresh()"); await fresh(tools, path);
    assert.deepEqual(await folded(tools), saved);
    const valid = await evaluate(`app.loadLocalStorage(${q(storageKey)})`);
    await evaluate(`app.saveLocalStorage(${q(storageKey)},{version:1,records:[{channel:"editor",path:${q(path)},source:"broken",value:[{from:-1,to:999999}]}]})`);
    await fresh(tools, path); assert.deepEqual(await folded(tools), []); await pointer(tools, heading);
    assert.equal(await evaluate(`app.loadLocalStorage(${q(storageKey)}).records.some(record=>record.channel==="editor"&&record.path===${q(path)}&&record.value.length===1)`), true);
    await evaluate(`app.saveLocalStorage(${q(storageKey)},${q(valid)})`); await exact(tools, path, text); assert.deepEqual(await readFile(join(directory, other)), otherBytes);
    pass(report, "A physical same-line-count source replacement refuses stale folds; restoring the exact source permits them again. Corrupt local fold records are ignored and a real new fold repairs the bounded catalog without changing either note or vault configuration.");
    stage = "confirmed note and descendant-folder rename"; await checkRenamedEditorFolds(tools);
    report.editorFoldState = { sourceAndLivePreview: true, exactSourceAndFile: true, realPointer: true, documentAndHistoryRetained: true, freshPane: true, duplicatePanesIndependent: true, lastUserActionWins: true, idleCloseDoesNotWrite: true, restart: true, dirtyPeerNoReplay: true, preferenceOff: true, codeIndependent: true, sameLineCountMismatch: true, corruptStateIgnored: true, confirmedNoteRename: true, confirmedAncestorFolderRename: true, movedProfileState: true, newPathPointerAndFreshRestore: true, exactBytes: true };
  } catch (error) {
    try { report.editorFoldStateFailure = { stage, ...(await evaluate('(()=>({file:app.workspace.getActiveFile()?.path,mode:app.workspace.activeLeaf.view.getEditingMode?.(),folds:app.editor?.getFoldInfo?.(),source:app.editor?.getValue?.(),stored:app.loadLocalStorage("fold-state-v1"),dirty:app.workspace.activeLeaf.view.hasUnsavedChanges}))()')) }; await capture?.("editor-fold-continuity-precleanup-failure"); } catch { /* Keep the original failure. */ }
    throw error;
  } finally {
    if (await evaluate('document.querySelector("#settings-dialog").open')) await tools.click(".settings-close");
    await writeFile(configPath, originalConfig);
    await evaluate(`(async()=>{delete globalThis.__editorFoldStateProbe;delete globalThis.__editorFoldRenameProbe;await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});app.saveLocalStorage(${q(storageKey)},${q(stored)});await app.workspace.flushLayout()})()`);
  }
}

/** Parent owns the genuine cache-only mount and verifies every remote blob and request counter. */
export async function checkEditorFoldStateReadOnly(tools) {
  const { evaluate, report, command } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const stored = await evaluate(`app.loadLocalStorage(${q(storageKey)})`);
  try {
    await fresh(tools, "Read only.md"); const text = await evaluate("app.editor.getValue()");
    await evaluate('app.editor.exec("unfoldAll");app.editor.setCursor(0,0);app.editor.exec("foldAll")'); const saved = await folded(tools); assert.ok(saved.length > 0);
    await fresh(tools, "Read only.md"); assert.deepEqual(await folded(tools), saved);
    await evaluate("app.editor.focus()"); await command("Input.insertText", { text: "Refused fold continuity input" }); assert.equal(await evaluate("app.editor.getValue()"), text);
    await tools.capture?.("editor-fold-continuity-readonly");
    report.editorFoldState = { ...(report.editorFoldState ?? {}), cachedReadOnlyFreshPane: true, readOnlyLocalStorage: true, readOnlyTypingRefused: true };
    pass(report, "A genuine cached read-only Markdown note restores folds in a fresh Source pane using only local view preferences; actual typing refuses and exact cached source remains intact.");
  } finally { await evaluate(`app.saveLocalStorage(${q(storageKey)},${q(stored)})`); }
}
