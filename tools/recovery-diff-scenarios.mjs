import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, modal = ".recovery-modal", api = 'app.core.getEnabledPluginById("file-recovery")';
const action = name => modal + ' [data-recovery-action=' + q(name) + ']';
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
async function key(tools, value, code = value, number = 65, modifiers = 0) {
  const event = { key: value, code, windowsVirtualKeyCode: number, nativeVirtualKeyCode: number, modifiers };
  await tools.command("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
  await tools.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}
async function fill(tools, selector, value) { await tools.click(selector); await key(tools, "a", "KeyA", 65, 2); await tools.command("Input.insertText", { text: value }); }
async function disabledPointer(tools, selector) {
  const point = await tools.evaluate(`(()=>{const node=document.querySelector(${q(selector)});node.scrollIntoView({block:"center"});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node}})()`);
  assert.equal(point.hit, true);
  for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
}

// These private probe functions are also exercised against real CodeMirror states
// by the private red/green follow-up. They never filter or suppress transactions.
function recoveryDraftState(app, path, commands) {
  const leaf = app.workspace.activeLeaf, view = leaf?.view, editor = view?.editor, cm = editor?.cm, session = app.workspace.sessions.get(path), file = view?.file, saved = session?.document;
  const history = cm?.state.field(commands.historyField, false);
  const serialized = history ? cm.state.toJSON({ history: commands.historyField }).history : null;
  // Selection-only history metadata may legitimately follow a browser focus change.
  // Preserve every document event, mapping and its original Undo selection.
  const branch = events => events.filter(event => event.changes !== undefined || event.mapped !== undefined).map(({ selectionsAfter, ...event }) => event);
  const documentEvents = events => events.filter(event => event.changes || event.mapped || event.effects.length).map(event => ({ changes: event.changes, mapped: event.mapped, startSelection: event.startSelection, effects: event.effects }));
  return { root: app.vault.rootPath, leaf, view, editor, cm, session, file, saved, doc: cm?.state.doc, state: cm?.state, history,
    text: editor?.getValue(), sessionText: session?.text, version: saved?.version, savedContent: saved?.content, hasBom: saved?.hasBom,
    dirty: app.dirty, sessionDirty: session?.dirty, undoDepth: cm ? commands.undoDepth(cm.state) : null, redoDepth: cm ? commands.redoDepth(cm.state) : null,
    documentHistory: serialized ? JSON.stringify({ done: branch(serialized.done), undone: branch(serialized.undone) }) : null,
    documentEvents: history ? { done: documentEvents(history.done), undone: documentEvents(history.undone) } : null,
    selection: cm?.state.selection.toJSON(), focused: cm?.hasFocus ?? false };
}
function recoveryDraftProbeResult(app, path, probe, commands, phase) {
  const before = probe.before, after = recoveryDraftState(app, path, commands), comparison = probe.comparison;
  const sameEvents = branch => before.documentEvents !== null && after.documentEvents !== null && before.documentEvents[branch].length === after.documentEvents[branch].length && before.documentEvents[branch].every((event, index) => Object.entries(event).every(([key, value]) => after.documentEvents[branch][index][key] === value));
  return { phase, predicates: {
    sameRoot: after.root === before.root, sameOwner: after.leaf === before.leaf && app.workspace.getLeafById(before.leaf.id) === before.leaf,
    sameView: after.view === before.view, sameEditor: after.editor === before.editor && app.editor === before.editor, sameEditorOwner: after.editor?.editorComponent === before.view, sameCM: after.cm === before.cm && before.cm.dom.isConnected,
    sameSession: after.session === before.session && after.session?.originRoot === before.root && after.view?.session === before.session && after.leaf?.session === before.session,
    sameTFile: after.file === before.file && app.vault.getFileByPath(path) === before.file && before.file.path === path,
    sameImmutableDocument: after.doc === before.doc, exactDraft: after.text === probe.expected && after.sessionText === probe.expected,
    sameSavedDocument: after.saved === before.saved && after.view?.savedDocument === before.saved, sameSavedVersion: after.version === before.version, sameSavedContent: after.savedContent === before.savedContent, sameSavedBom: after.hasBom === before.hasBom,
    remainsDirty: after.dirty === true && after.sessionDirty === true, sameUndoDepth: after.undoDepth === before.undoDepth, sameRedoDepth: after.redoDepth === before.redoDepth,
    sameDocumentHistory: after.documentHistory === before.documentHistory && sameEvents("done") && sameEvents("undone"), noDocumentTransactions: probe.docChanged === 0, noStateReset: probe.resets === 0,
    ...(comparison ? { sameCompareDocument: after.doc === comparison.doc, sameCompareHistoryField: after.history === comparison.history } : {})
  }, diagnostics: { sameEditorState: after.state === before.state, sameHistoryFieldBeforeOpening: after.history === before.history,
    before: { text: before.text, sessionText: before.sessionText, version: before.version, savedContent: before.savedContent, hasBom: before.hasBom, undoDepth: before.undoDepth, redoDepth: before.redoDepth, documentHistory: before.documentHistory, selection: before.selection, focused: before.focused },
    after: { text: after.text, sessionText: after.sessionText, version: after.version, savedContent: after.savedContent, hasBom: after.hasBom, undoDepth: after.undoDepth, redoDepth: after.redoDepth, documentHistory: after.documentHistory, selection: after.selection, focused: after.focused },
    transactions: probe.transactions.slice(), totalTransactions: probe.totalTransactions, docChanged: probe.docChanged, resets: probe.resets, truncated: probe.truncated } };
}
function assertRecoveryDraftProbe(result) {
  const failed = Object.entries(result.predicates).filter(([, passed]) => passed !== true).map(([name]) => name);
  assert.deepEqual(failed, [], result.phase + ": " + JSON.stringify(result));
}
function observeRecoveryDraft(probe, modules) {
  const cm = probe.before.cm, commands = modules.commands, Transaction = modules.state.Transaction;
  const dispatchDescriptor = Object.getOwnPropertyDescriptor(cm, "dispatchTransactions"), resetDescriptor = Object.getOwnPropertyDescriptor(cm, "setState");
  const dispatch = cm.dispatchTransactions, setState = cm.setState;
  probe.transactions = []; probe.totalTransactions = probe.docChanged = probe.resets = 0; probe.truncated = false; probe.observing = true;
  const record = entry => { if (probe.transactions.length < 128) probe.transactions.push(entry); else probe.truncated = true; };
  cm.dispatchTransactions = function (...args) {
    const before = this.state, transactions = args[0], rows = [];
    for (const tr of transactions) {
      probe.totalTransactions++; if (tr.docChanged) probe.docChanged++;
      rows.push({ kind: "transaction", phase: probe.phase, docChanged: tr.docChanged, selectionSet: Boolean(tr.selection), selection: tr.selection?.toJSON() ?? null,
        effectKinds: tr.effects.map(effect => modules.language?.Language?.setState && effect.is(modules.language.Language.setState) ? "parser-state" : effect.is(modules.state.StateEffect.reconfigure) ? "reconfigure" : effect.is(modules.state.StateEffect.appendConfig) ? "append-config" : "other-state-effect"),
        userEvent: tr.annotation(Transaction.userEvent) ?? null, addToHistory: tr.annotation(Transaction.addToHistory) ?? null,
        sameStartDocument: tr.startState.doc === probe.before.doc });
    }
    try { return dispatch.apply(this, args); }
    finally { for (const row of rows) record({ ...row, sameEndDocument: this.state.doc === probe.before.doc, stateRevised: this.state !== before, historyFieldRetained: this.state.field(commands.historyField, false) === before.field(commands.historyField, false) }); }
  };
  cm.setState = function (...args) {
    probe.resets++; record({ kind: "setState", phase: probe.phase, sameDocument: args[0]?.doc === probe.before.doc });
    return setState.apply(this, args);
  };
  return () => {
    if (!probe.observing) return;
    if (dispatchDescriptor) Object.defineProperty(cm, "dispatchTransactions", dispatchDescriptor); else delete cm.dispatchTransactions;
    if (resetDescriptor) Object.defineProperty(cm, "setState", resetDescriptor); else delete cm.setState;
    probe.observing = false;
  };
}

export const recoveryDiffReadOnlyFixture = Object.freeze({ sourceAddition: "", files: [] });

/** Parent owns builds, the genuine prepared readonly mount, final logs and shutdown. */
export async function checkRecoveryDiffs(tools) {
  const { directory, evaluate, click, wait, report, capture, restart, afterReload, command } = tools;
  const folder = "Recovery visual diffs", path = folder + "/Compare.md", missingPath = folder + "/Missing.md", limitPath = folder + "/Limit.md";
  const original = '# Recovery comparison\r\n\r\nKept λ.\r\nOld text.\r\n<img src=x onerror="window.recoveryDiffExecuted=true">\r\n';
  const newer = original.replace("Old text.", "New text 😀."), lf = newer.replaceAll("\r\n", "\n"), external = "# External replacement Ω\r\n\r\nKeep this exact text before restore.\r\n";
  const source = 'app.workspace.sessions.get(' + q(path) + ')', editor = '.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]';
  const historyPath = join(directory, ".obsidian", "vault-dotnet-recovery.json"), configPath = join(directory, ".obsidian", "app.json");
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("file-recovery")'), configBytes = await readFile(configPath);
  const config = JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, ""));
  const parsed = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  const exact = async (name, value) => assert.deepEqual(await readFile(join(directory, name)), Buffer.from(value), name + " exact physical UTF-8 bytes");
  let stage = "fixture", failure, firstSnapshot, secondSnapshot;
  report.recoveryDiffInputs = [];
  async function idle() {
    await wait(`(()=>{const r=${api};return r&&!r.draining&&r.timer===null})()`, "recovery capture queue has settled");
    await evaluate(`${api}.whenIdle()`);
    await wait(`!document.querySelector(${q(modal + " [data-recovery-status]")})?.textContent.includes("Working")`, "recovery dialog operation has settled");
  }
  async function refresh() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function toggle(value) {
    await click("#open-settings"); await click("#core-plugins-tab");
    if (await evaluate('app.core.isEnabled("file-recovery")') !== value) await click('[data-core-toggle="file-recovery"]');
    await wait(`app.core.isEnabled("file-recovery")===${value}&&!app.core.busy`, "actual File recovery enable control settles");
    await click(".settings-close");
  }
  async function open(name = path) {
    await click('[data-note-path=' + q(name) + ']');
    await wait('app.workspace.getActiveFile()?.path===' + q(name), "the real file tree opens the recovery comparison fixture");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)');
    await idle();
  }
  async function history(name = path, id) {
    await evaluate('app.commands.execute("file-recovery:open")'); await wait(`Boolean(document.querySelector(${q(modal)}))`, "real recovery history dialog opens"); await idle();
    await click(modal + ' [data-recovery-path=' + q(name) + ']'); await idle();
    if (id) { await click(modal + ' [data-recovery-id=' + q(id) + ']'); await idle(); }
  }
  async function close() { await click(modal + " .modal-close-button"); await wait(`!document.querySelector(${q(modal)})`, "recovery history closes"); }
  async function select(id) { await click(modal + ' [data-recovery-id=' + q(id) + ']'); await idle(); }
  async function compare() { await click(action("compare")); await idle(); }
  async function review(id = firstSnapshot.id) { await select(id); await click(action("review")); await idle(); }
  async function startTrace() {
    await evaluate(`(()=>{const t=globalThis.recoveryDiffTrace={events:[],abort:new AbortController()};for(const type of["pointerdown","keydown"])document.addEventListener(type,event=>{if(event.target.closest?.(${q(modal)})||event.target.closest?.(".cm-content"))t.events.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()`);
  }
  async function stopTrace() {
    const events = await evaluate('(()=>{const t=globalThis.recoveryDiffTrace;t?.abort.abort();return t?.events.splice(0)??[]})()'); report.recoveryDiffInputs.push(...events);
  }
  async function holdRead() {
    await evaluate(`(()=>{const t=recoveryDiffTrace;t.read=app.vault.readDocument;t.waiting=false;t.gate=new Promise(resolve=>t.release=resolve);app.vault.readDocument=async function(name,...args){if(name===${q(path)}){t.waiting=true;await t.gate;}return t.read.call(this,name,...args)};return true})()`);
  }
  async function releaseRead() { await evaluate('(()=>{const t=globalThis.recoveryDiffTrace;if(t?.read){app.vault.readDocument=t.read;delete t.read;t.release();}return true})()'); }
  async function unchanged(historyBytes, bytes) { await exact(path, bytes); assert.deepEqual(await readFile(historyPath), historyBytes, "comparison does not change physical recovery history"); }
  const draftProbeDeclarations = recoveryDraftState.toString() + "\n" + recoveryDraftProbeResult.toString();
  async function beginDraftProbe(expected) {
    await evaluate(`(()=>{${recoveryDraftState.toString()}\n${observeRecoveryDraft.toString()}
      const commands=app.plugins.modules["@codemirror/commands"],p=recoveryDiffTrace.draftProbe={expected:${q(expected)},phase:"opening history"};p.before=recoveryDraftState(app,${q(path)},commands);
      p.stop=observeRecoveryDraft(p,{commands,state:app.plugins.modules["@codemirror/state"],language:app.plugins.modules["@codemirror/language"]});return true})()`);
    report.recoveryDiffDirtyProbe = { snapshots: [], undoRedo: [] };
    await recordDraftProbe("Dirty Source baseline before opening history");
  }
  async function recordDraftProbe(phase) {
    const result = await evaluate(`(()=>{${draftProbeDeclarations}\nreturn recoveryDraftProbeResult(app,${q(path)},recoveryDiffTrace.draftProbe,app.plugins.modules["@codemirror/commands"],${q(phase)})})()`);
    report.recoveryDiffDirtyProbe.snapshots.push(result); assertRecoveryDraftProbe(result);
  }
  async function stopDraftProbe() { await evaluate("(()=>{globalThis.recoveryDiffTrace?.draftProbe?.stop?.();return true})()"); }
  async function assertUndoRedoState(phase, expected, dirty, undoDelta, redoDelta) {
    const result = await evaluate(`(()=>{${recoveryDraftState.toString()}
      const p=recoveryDiffTrace.draftProbe,b=p.before,a=recoveryDraftState(app,${q(path)},app.plugins.modules["@codemirror/commands"]);
      return{phase:${q(phase)},predicates:{sameRoot:a.root===b.root,sameOwner:a.leaf===b.leaf&&app.workspace.getLeafById(b.leaf.id)===b.leaf,sameView:a.view===b.view,sameEditor:a.editor===b.editor&&app.editor===b.editor,sameEditorOwner:a.editor?.editorComponent===b.view,sameCM:a.cm===b.cm&&b.cm.dom.isConnected,sameSession:a.session===b.session&&a.session.originRoot===b.root&&a.view.session===b.session&&a.leaf.session===b.session,sameTFile:a.file===b.file&&app.vault.getFileByPath(${q(path)})===b.file,
      exactText:a.text===${q(expected)},exactSessionText:a.sessionText===${q(expected)},expectedDirty:a.dirty===${dirty}&&a.sessionDirty===${dirty},sameSavedDocument:a.saved===b.saved&&a.view.savedDocument===b.saved,sameSavedVersion:a.version===b.version,sameSavedContent:a.savedContent===b.savedContent,sameSavedBom:a.hasBom===b.hasBom,expectedUndoDepth:a.undoDepth===b.undoDepth+${undoDelta},expectedRedoDepth:a.redoDepth===b.redoDepth+${redoDelta},observerStopped:p.observing===false},diagnostics:{text:a.text,sessionText:a.sessionText,dirty:a.dirty,undoDepth:a.undoDepth,redoDepth:a.redoDepth,selection:a.selection}}})()`);
    report.recoveryDiffDirtyProbe.undoRedo.push(result); assertRecoveryDraftProbe(result);
  }
  async function narrowGeometry(selector) {
    return evaluate(`(()=>{
      const m=document.querySelector(${q(modal)}),content=m.querySelector(".recovery-content"),grid=m.querySelector(".recovery-grid"),scroll=m.querySelector(".modal-content"),target=document.querySelector(${q(selector)});
      target.scrollIntoView({block:"center",inline:"nearest"});
      const rect=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},r=rect(m),c=rect(content),s=rect(scroll),t=rect(target),hit=document.elementFromPoint(t.left+t.width/2,t.top+t.height/2);
      return{viewport:{width:innerWidth,height:innerHeight},viewportNarrow:matchMedia("(max-width:700px)").matches,container:getComputedStyle(m).containerName,gridColumns:getComputedStyle(grid).gridTemplateColumns,modal:r,content:c,scroll:s,scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,gridScrollWidth:grid.scrollWidth,gridClientWidth:grid.clientWidth,target:t,targetVisible:target.checkVisibility(),targetHit:hit===target||target.contains(hit)};
    })()`);
  }
  function assertNarrowGeometry(geometry, label) {
    const detail = label + ": " + JSON.stringify(geometry);
    assert.ok(geometry.modal.width > 0 && geometry.modal.width <= 361, detail);
    assert.ok(geometry.content.width > 0 && geometry.content.right <= geometry.modal.right && geometry.content.left >= geometry.modal.left, detail);
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1 && geometry.gridScrollWidth <= geometry.gridClientWidth + 1, detail);
    assert.ok(geometry.targetVisible && geometry.targetHit && geometry.target.width > 0 && geometry.target.height > 0, detail);
    assert.ok(geometry.target.left >= geometry.scroll.left && geometry.target.right <= geometry.scroll.right && geometry.target.top >= geometry.scroll.top && geometry.target.bottom <= geometry.scroll.bottom, detail);
  }

  try {
    await writeFile(configPath, Buffer.from((configBytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? "\ufeff" : "") + JSON.stringify({ ...config, markdownAutosave: false })));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure()})()');
    await mkdir(join(directory, folder), { recursive: true });
    await writeFile(join(directory, path), "\ufeff" + original, { flag: "wx" });
    await writeFile(join(directory, missingPath), "\ufeffMissing fixture λ.\r\n", { flag: "wx" });
    await writeFile(join(directory, limitPath), "Line\n".repeat(4001), { flag: "wx" });
    await refresh(); if (!enabled) await toggle(true); await startTrace(); await open(); await history();
    await click(action("snapshot")); await idle();
    firstSnapshot = (await parsed()).snapshots.find(item => item.path === path && item.content === original); assert.ok(firstSnapshot); assert.equal(firstSnapshot.hasBom, true);
    await close(); await writeFile(join(directory, path), "\ufeff" + newer); await refresh();
    await wait(source + '?.text===' + q(newer) + '&&!'+ source + '.dirty', "clean note receives actual newer disk text");
    await history(path, firstSnapshot.id); let historyBytes = await readFile(historyPath); await compare();
    assert.equal(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff] h3")}).textContent`), "Snapshot → current saved file");
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-summary]")}).textContent`), /1 added, 1 removed, 4 unchanged/);
    assert.equal(await evaluate(`document.querySelectorAll(${q(modal + ' [data-recovery-diff-kind="added"]')}).length`), 1);
    assert.equal(await evaluate(`document.querySelectorAll(${q(modal + " [data-recovery-diff] img," + modal + " [data-recovery-diff] script")}).length`), 0);
    assert.equal(await evaluate("Boolean(window.recoveryDiffExecuted)"), false);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(action("confirm-restore"))}))`), false); await unchanged(historyBytes, "\ufeff" + newer);
    await capture?.("recovery-diff-lines");
    stage = "narrow comparison layout";
    await evaluate(`(()=>{const m=document.querySelector(${q(modal)});m.style.width="360px";return true})()`);
    report.recoveryDiffNarrowGeometry = { compare: await narrowGeometry(action("compare")) };
    assertNarrowGeometry(report.recoveryDiffNarrowGeometry.compare, "Narrow Compare is contained and pointer reachable");
    await compare();
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-summary]")}).textContent`), /1 added, 1 removed, 4 unchanged/);
    await unchanged(historyBytes, "\ufeff" + newer);
    report.recoveryDiffNarrowGeometry.diff = await narrowGeometry(modal + " .recovery-diff-lines");
    assertNarrowGeometry(report.recoveryDiffNarrowGeometry.diff, "Narrow diff is contained and scroll reachable");
    await capture?.("recovery-diff-narrow"); await close();
    stage = "BOM and EOL metadata";
    await history(); await click(action("snapshot")); await idle();
    secondSnapshot = (await parsed()).snapshots.find(item => item.path === path && item.content === newer); assert.ok(secondSnapshot); await close();
    await writeFile(join(directory, path), lf); await refresh(); await wait(source + '?.text===' + q(lf) + '&&!'+ source + '.dirty', "saved BOM/EOL-only replacement reaches the clean editor");
    await history(path, secondSnapshot.id); historyBytes = await readFile(historyPath); await compare();
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-summary]")}).textContent`), /0 added, 0 removed, 5 unchanged.*5 line-ending changes; BOM changed/);
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-metadata]")}).textContent`), /BOM present.*CRLF 5.*BOM absent.*LF 5/);
    await unchanged(historyBytes, lf);
    pass(report, "Actual recovery snapshots compare snapshot → current saved text with readable added/removed/unchanged lines, inert HTML-looking content, exact BOM/EOL-only metadata and reachable narrow controls. Comparison leaves physical saved bytes and recovery history unchanged.");

    stage = "dirty draft and guarded restoration"; await close(); await fill(tools, editor, lf + "Unsaved comparison draft λ.\n");
    await wait('app.dirty&&'+source+'.text==='+q(lf + "Unsaved comparison draft λ.\n"), "real dirty Source draft is present");
    await beginDraftProbe(lf + "Unsaved comparison draft λ.\n");
    await history(path, secondSnapshot.id); historyBytes = await readFile(historyPath);
    await evaluate(`(()=>{${recoveryDraftState.toString()}\nconst p=recoveryDiffTrace.draftProbe;p.comparison=recoveryDraftState(app,${q(path)},app.plugins.modules["@codemirror/commands"]);p.phase="comparing saved text";return true})()`);
    await recordDraftProbe("History and snapshot selection retain dirty document and Undo history");
    await compare();
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-summary]")}).textContent`), /0 added, 0 removed, 5 unchanged/);
    await recordDraftProbe("Actual Compare retains the immutable document and comparison history field");
    await unchanged(historyBytes, lf);
    await click(action("review")); await idle(); assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-status]")}).textContent`), /unsaved views/); await unchanged(historyBytes, lf);
    await recordDraftProbe("Dirty restore refusal retains draft, saved version and Undo history");
    await stopDraftProbe(); await close(); await click(editor); await key(tools, "z", "KeyZ", 90, 2); await wait(source + '.text===' + q(lf) + '&&!app.dirty', "one trusted Undo retains the pre-comparison saved note");
    await assertUndoRedoState("Trusted Undo restores exact saved LF on the same editor", lf, false, -1, 1); await unchanged(historyBytes, lf);
    await key(tools, "y", "KeyY", 89, 2); await wait(source + '.text===' + q(lf + "Unsaved comparison draft λ.\n") + '&&app.dirty', "trusted Redo retains the exact dirty comparison draft");
    await assertUndoRedoState("Trusted Redo restores exact dirty draft on the same editor", lf + "Unsaved comparison draft λ.\n", true, 0, 0); await unchanged(historyBytes, lf);
    await key(tools, "z", "KeyZ", 90, 2); await wait(source + '.text===' + q(lf) + '&&!app.dirty', "trusted second Undo retains the saved note before restoration");
    await assertUndoRedoState("Trusted second Undo restores saved LF without writing", lf, false, -1, 1); await unchanged(historyBytes, lf);
    await history(); await review(); await writeFile(join(directory, path), external); await click(action("confirm-restore")); await idle();
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-status]")}).textContent`), /changed after the restore review/); await exact(path, external);
    await close(); await refresh(); await wait(source + '.text===' + q(external) + '&&!app.dirty', "clean editor receives retained physical external version");
    await history(); await review(); await click(action("confirm-restore")); await idle(); await exact(path, original);
    assert.equal(await evaluate(source + ".text"), original); assert.ok((await parsed()).snapshots.some(item => item.path === path && item.content === external), "replaced saved bytes have durable safety history");
    assert.equal((await parsed()).snapshots.find(item => item.id === firstSnapshot.id).content, original);
    pass(report, "Comparison excludes unsaved Source text and retains the original CodeMirror document/history; restore review still refuses dirty drafts. A physical replacement invalidates review, and separately confirmed restoration preserves the current BOM while durably retaining replaced saved text.");

    stage = "cancelled detached and disabled pending comparisons"; await review();
    await evaluate(`recoveryDiffTrace.staleRestore=document.querySelector(${q(action("confirm-restore"))})`); historyBytes = await readFile(historyPath);
    await holdRead(); await click(action("compare")); await wait("recoveryDiffTrace.waiting", "comparison is held inside the real saved-file read");
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(action("confirm-restore"))}))`), false);
    await click(action("cancel-compare")); await evaluate("recoveryDiffTrace.staleRestore.disabled=false;recoveryDiffTrace.staleRestore.click()"); await releaseRead(); await idle();
    assert.equal(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff]")}).hidden`), true); await unchanged(historyBytes, original);
    await holdRead(); await click(action("compare")); await wait("recoveryDiffTrace.waiting", "a second saved-file comparison is held"); await close(); await releaseRead(); await idle();
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false); await unchanged(historyBytes, original);
    await history(); await holdRead(); await click(action("compare")); await wait("recoveryDiffTrace.waiting", "disable races a real pending comparison");
    await evaluate('recoveryDiffTrace.disabling=app.core.setEnabled("file-recovery",false);true'); await wait(`!document.querySelector(${q(modal)})`, "disable closes the owned pending dialog");
    await releaseRead(); await evaluate("recoveryDiffTrace.disabling"); assert.equal(await evaluate('app.core.isEnabled("file-recovery")'), false); await unchanged(historyBytes, original);
    assert.equal(await evaluate('app.commands.listCommands().some(item=>item.id.startsWith("file-recovery:"))'), false); await toggle(true); await idle();
    pass(report, "Starting a held comparison immediately retires its previous restore review. Trusted Cancel, dialog close and plugin disable discard late real-read results, detached restore controls cannot write, commands are removed, and every saved/history byte remains exact.");

    stage = "missing files bounds and restart"; await open(missingPath); await history(missingPath); await click(action("snapshot")); await idle();
    const missingSnapshot = (await parsed()).snapshots.find(item => item.path === missingPath); assert.ok(missingSnapshot); await close(); await open(path);
    await unlink(join(directory, missingPath)); await refresh(); await history(missingPath, missingSnapshot.id); await compare();
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-missing]")}).textContent`), /missing.*no current text/);
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(action("confirm-restore"))}))`), false);
    await click(action("review")); await idle(); await click(action("confirm-restore")); await idle(); await exact(missingPath, "\ufeffMissing fixture λ.\r\n"); await close();
    await open(limitPath); await history(limitPath); await compare();
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-refused]")}).textContent`), /line limit.*Copy snapshot.*Review restore/);
    assert.equal(await evaluate(`document.querySelector(${q(modal + " [data-recovery-preview]")}).value.length`), "Line\n".repeat(4001).length);
    await click(action("review")); await idle(); assert.equal(await evaluate(`Boolean(document.querySelector(${q(action("confirm-restore"))}))`), true); await click(action("cancel")); await idle(); await close();
    await open(); await stopTrace(); await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await startTrace(); await open(); await history(path, firstSnapshot.id); await compare();
    assert.match(await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff-summary]")}).textContent`), /0 added, 0 removed, 5 unchanged.*BOM changed/);
    await exact(path, original); await exact(missingPath, "\ufeffMissing fixture λ.\r\n"); await exact(limitPath, "Line\n".repeat(4001)); await capture?.("recovery-diff-restored"); await close(); await stopTrace();
    assert.ok(report.recoveryDiffInputs.length > 10 && report.recoveryDiffInputs.every(event => event.trusted));
    report.recoveryDiffs = { snapshotToSavedDirection: true, lineCounts: true, inertText: true, bomEolMetadata: true, compareOnlyBytesExact: true, dirtyDraftHistoryExact: true, independentRestoreReview: true, staleVersionRefused: true, exactRestore: true, pendingCancelRefused: true, detachedResultIgnored: true, disableResultIgnored: true, missingCurrentExplicit: true, budgetFallbackAvailable: true, narrowControls: true, restart: true, trustedInputs: true };
    pass(report, "Missing saved files are explicit and only the separate restore review recreates them. Over-budget diffs retain normal preview/restore controls. Full restart or actual-folder reconnection retains immutable snapshots, exact saved bytes and a fresh working comparison with trusted input.");
  } catch (error) {
    failure = error; report.recoveryDiffFailure = { stage, error: String(error?.stack ?? error) };
    try { report.recoveryDiffFailure.state = await evaluate(`(()=>({root:app.vault.rootPath,file:app.workspace.getActiveFile()?.path,dirty:app.dirty,status:document.querySelector(${q(modal + " [data-recovery-status]")})?.textContent,summary:document.querySelector(${q(modal + " [data-recovery-diff-summary]")})?.textContent,buttons:[...document.querySelectorAll(${q(modal + " [data-recovery-action]")})].map(node=>({action:node.dataset.recoveryAction,disabled:node.disabled}))}))()`); await capture?.("recovery-diff-precleanup-failure"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    try {
      await stopDraftProbe(); await releaseRead(); await stopTrace(); await evaluate(`document.querySelector(${q(modal + " .modal-close-button")})?.click()`);
      await evaluate('(async()=>{await app.workspace.saveAll();await app.core.whenIdle()})()');
      await writeFile(configPath, configBytes);
      await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout('+q(layout)+');await app.workspace.flushLayout();delete globalThis.recoveryDiffTrace})()');
      if (await evaluate('app.core.isEnabled("file-recovery")') !== enabled) await toggle(enabled);
    } catch (error) { if (!failure) throw error; report.recoveryDiffFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** Genuine cache-only mount supplied and blob-audited by the parent; no replacement fixture here. */
export async function checkRecoveryDiffsReadOnly(tools) {
  const { evaluate, click, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()");
  const documents = await evaluate("app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))");
  const counters = await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()");
  assert.equal(await evaluate('app.core.isEnabled("file-recovery")'), false);
  assert.equal(await evaluate('app.core.state("file-recovery").implemented'), false);
  assert.equal(await evaluate('app.commands.listCommands().some(item=>item.id.startsWith("file-recovery:"))'), false);
  await click("#open-settings"); await click("#core-plugins-tab");
  const toggle = '[data-core-toggle="file-recovery"]';
  try {
    assert.equal(await evaluate(`document.querySelector(${q(toggle)}).disabled`), true);
    await evaluate(`(()=>{const t=globalThis.recoveryDiffReadonlyTrace={events:[],abort:new AbortController()};document.addEventListener("pointerdown",event=>{if(event.target.closest?.(${q(toggle)}))t.events.push({trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()`);
    await disabledPointer(tools, toggle);
    const refusals = await evaluate('(async()=>{const r=app.core.getPluginById("file-recovery").instance,errors=[];for(const action of[()=>r.compareSaved("forged"),()=>r.prepareRestore("forged"),()=>r.restore({}),()=>r.list(),()=>r.capture("Read only.md"),()=>r.openModal("Read only.md")]){try{await action();throw Error("Recovery unexpectedly accepted a readonly mount")}catch(error){if(!error.message.includes("read-only vault"))throw error;errors.push(error.message)}}return errors})()');
    assert.equal(refusals.length, 6); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false);
    assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory);
    assert.deepEqual(await evaluate("app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))"), documents);
    assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), counters);
    report.recoveryDiffReadOnlyInputs = await evaluate("recoveryDiffReadonlyTrace.events"); assert.ok(report.recoveryDiffReadOnlyInputs.length && report.recoveryDiffReadOnlyInputs.every(event => event.trusted));
    await capture?.("recovery-diff-readonly");
    report.recoveryDiffReadOnly = { genuineCacheOnly: true, moduleUnavailable: true, disabledTrustedPointer: true, noCommandsOrDialog: true, directCompareRestoreRefused: true, inventoryExact: true, documentsExact: true, zeroAdditionalApiRaw: true };
    pass(report, "The genuine cache-only GitHub mount keeps File recovery unavailable, with no commands or dialog. Trusted disabled-pointer input and six direct compare/review/restore/list/capture/open probes refuse before a host read, preserve every cached document/version and inventory, and add zero API/raw requests.");
  } finally { await evaluate("globalThis.recoveryDiffReadonlyTrace?.abort.abort();delete globalThis.recoveryDiffReadonlyTrace"); await click(".settings-close"); }
}
