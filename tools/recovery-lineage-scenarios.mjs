import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const q = JSON.stringify, modal = ".recovery-modal", api = 'app.core.getEnabledPluginById("file-recovery")';
const action = name => modal + " [data-recovery-action=" + q(name) + "]";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
function documentHistory(cm, commands) {
  const history = cm.state.toJSON({ history: commands.historyField }).history;
  const branch = events => events.filter(event => event.changes !== undefined || event.mapped !== undefined).map(({ selectionsAfter, ...event }) => event);
  return JSON.stringify({ done: branch(history.done), undone: branch(history.undone) });
}
async function optional(path) { try { return await readFile(path); } catch (error) { if (error.code !== "ENOENT") throw error; return null; } }
async function restore(path, bytes) { if (bytes !== null) await writeFile(path, bytes); else await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }
async function pointer(tools, selector, button = "left") {
  const point = await tools.evaluate(`(()=>{const n=document.querySelector(${q(selector)});if(!n)throw Error("Missing trusted pointer target");n.scrollIntoView({block:"center",inline:"nearest"});const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return{x,y,hit:n===h||n.contains(h)}})()`);
  assert.equal(point.hit, true, "actual control is hit-testable: " + selector);
  for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button, clickCount: 1 });
}
async function fill(tools, selector, text) {
  await tools.click(selector); await tools.press("a", "KeyA", 65, 2); await tools.command("Input.insertText", { text });
}

// An independent vault-file fixture. File recovery deliberately remains unavailable
// on the genuine cached mount; the parent audits every exact cached blob.
export const recoveryLineageReadOnlyFixture = Object.freeze({
  sourceAddition: "",
  files: [
    ["readonly-export-handoff-history/Recovery current.md", "\ufeff# Cached recovery current\r\n\r\nSaved λ.\r\n"],
    [".obsidian/vault-dotnet-recovery.json", JSON.stringify({ version: 1, opaque: { retain: "cached-history" }, snapshots: [{ id: "cached_lineage", path: "readonly-export-handoff-history/Recovery captured.md", ts: 1, content: "# Cached recovery captured\r\n", hasBom: true, sourceVersion: null, reason: "manual", opaque: ["immutable", 42] }], slopsidianRenames: { version: 1, opaque: { retain: true }, lineages: [{ id: "cached_association", origin: "readonly-export-handoff-history/Recovery captured.md", snapshotIds: ["cached_lineage"], moves: [{ from: "readonly-export-handoff-history/Recovery captured.md", to: "readonly-export-handoff-history/Recovery current.md", ts: 2 }] }] } })],
  ],
});

/** Parent alone builds, starts each actual host, captures and shuts it down. */
export async function checkRecoveryLineage(tools) {
  const { directory, evaluate, click, wait, command, report, capture, restart, afterReload } = tools;
  const folder = "Recovery rename history validation", a = folder + "/Captured original.md", b = folder + "/Renamed note.md", c = folder + "/Moved/Current target.md", collision = folder + "/Historical destination.md";
  const original = "# Captured before rename\r\n\r\nImmutable λ, 中文 and 😀.\r\n", replacement = "# Saved at current target\r\n\r\nRetain this Ω before the reviewed restore.\r\n";
  const configNames = ["file-recovery.json", "vault-dotnet-recovery.json", "core-plugins.json", "workspace.json"];
  const files = configNames.map(name => join(directory, ".obsidian", name));
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("file-recovery")');
  const backups = await Promise.all(files.map(optional));
  const fixtureDirectory = resolve(directory, folder), rootDirectory = resolve(directory);
  assert.equal(dirname(fixtureDirectory), rootDirectory); assert.ok(fixtureDirectory.startsWith(rootDirectory + sep));
  assert.equal(await stat(fixtureDirectory).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false; }), false, "validation folder must be new");
  const historyPath = files[1], settingsPath = files[0];
  const parsed = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  const exact = async (name, text) => assert.deepEqual(await readFile(join(directory, name)), Buffer.from(text), "exact UTF-8/BOM/CRLF at " + name);
  const absent = async name => assert.equal(await optional(join(directory, name)), null, "no ghost file at " + name);
  let stage = "fixture", failure, created = false;
  report.recoveryLineageInputs = []; report.recoveryLineageNegativeProbes = [];
  async function refresh() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function idle() {
    await wait(`(()=>{const r=${api};return r&&!r.draining&&r.timer===null})()`, "recovery automatic capture settles");
    await evaluate(`${api}.whenIdle()`);
    await wait(`!document.querySelector(${q(modal + " [data-recovery-status]")})?.textContent.includes("Working")`, "recovery dialog operation settles");
  }
  async function toggle(value) {
    await click("#open-settings"); await click("#core-plugins-tab");
    if (await evaluate('app.core.isEnabled("file-recovery")') !== value) await click('[data-core-toggle="file-recovery"]');
    await wait(`app.core.isEnabled("file-recovery")===${value}&&!app.core.busy`, "actual File recovery toggle settles"); await click(".settings-close");
  }
  async function explorer(path) {
    if (await evaluate("app.workspace.leftSplit.collapsed")) await click('[aria-label="Toggle left sidebar"]');
    await click('[data-sidebar-view="file-explorer"]');
    const segments = path.split("/").slice(0, -1);
    for (let index = 1; index <= segments.length; index++) {
      const selector = '#file-explorer-view details[data-folder-path=' + q(segments.slice(0, index).join("/")) + ']';
      if (await evaluate(`Boolean(document.querySelector(${q(selector)})&&!document.querySelector(${q(selector)}).open)`)) await click(selector + " > summary");
    }
  }
  async function open(path) { await explorer(path); await click('[data-note-path=' + q(path) + ']'); await wait("app.workspace.getActiveFile()?.path===" + q(path), "real file tree opens " + path); await idle(); }
  async function close() { await click(modal + " .modal-close-button"); await wait(`!document.querySelector(${q(modal)})`, "recovery dialog closes"); }
  async function history(path, id) {
    await evaluate('app.commands.execute("file-recovery:open")'); await wait(`Boolean(document.querySelector(${q(modal)}))`, "real history command opens recovery"); await idle();
    const entry = id ? await evaluate(`(async()=>{const x=(await ${api}.entries()).find(x=>x.snapshot.id===${q(id)});return x?{group:x.target.group,path:x.target.path}:null})()`) : null;
    const selector = modal + (entry ? ' [data-recovery-group=' + q(entry.group) + ']' : ' [data-recovery-path=' + q(path) + ']');
    await click(selector); await idle();
    if (id) { await click(modal + ' [data-recovery-id=' + q(id) + ']'); await idle(); }
  }
  async function rename(from, to) {
    await explorer(from); await pointer(tools, '[data-note-path=' + q(from) + ']', "right");
    await wait('Boolean(document.querySelector(\'[data-menu-title="Rename or move"]\'))', "actual file context menu opens");
    await click('[data-menu-title="Rename or move"]'); await wait('Boolean(document.querySelector(\'[data-file-dialog="rename"]\'))', "actual rename dialog opens");
    await fill(tools, '[data-file-dialog="rename"] [data-file-field="path"]', to);
    if (await evaluate('document.querySelector(\'[data-file-dialog="rename"] [data-file-field="update-links"]\').checked')) await click('[data-file-dialog="rename"] [data-file-field="update-links"]');
    await click('[data-file-dialog="rename"] [data-file-action="rename"]');
    await wait('!document.querySelector(\'[data-file-dialog="rename"]\')&&Boolean(app.vault.getFileByPath(' + q(to) + '))&&!app.workspace.isChangingFiles&&!app.core.busy', "acknowledged trusted rename completes"); await idle();
  }
  async function startTrace() {
    await evaluate(`(()=>{const t=globalThis.recoveryLineageTrace={events:[],abort:new AbortController()};for(const type of["pointerdown","keydown"])document.addEventListener(type,event=>{if(event.target.closest?.(${q(modal + ',[data-file-dialog="rename"],[data-menu-title],[data-note-path]')}))t.events.push({type,key:event.key??null,trusted:event.isTrusted,action:event.target.closest?.("[data-recovery-action]")?.dataset.recoveryAction??null})},{capture:true,signal:t.abort.signal});return true})()`);
  }
  async function stopTrace() { report.recoveryLineageInputs.push(...await evaluate("(()=>{const t=globalThis.recoveryLineageTrace;t?.abort.abort();return t?.events.splice(0)??[]})()")); }
  try {
    await toggle(false); await mkdir(join(directory, folder, "Moved"), { recursive: true }); created = true; await writeFile(join(directory, a), "\ufeff" + original);
    const destination = { id: "unrelated_destination", path: collision, ts: Date.now(), content: "Unrelated older destination text.\r\n", hasBom: false, sourceVersion: null, reason: "manual", future: { doNotMerge: true } };
    await writeFile(settingsPath, JSON.stringify({ intervalMinutes: 10080, keepDays: 3650, future: { retain: "settings" } }));
    await writeFile(historyPath, "\ufeff" + JSON.stringify({ version: 1, future: { retain: ["opaque", 42] }, snapshots: [destination], slopsidianRenames: { version: 1, future: { retain: "lineage" }, lineages: [] } }));
    await refresh(); await toggle(true); await wait(`${api}.lineageArmed===true`, "recovery waits for stable-root initialization"); await open(a); await startTrace();
    await history(a); await click(action("snapshot")); await idle();
    const first = (await parsed()).snapshots.find(snapshot => snapshot.path === a && snapshot.content === original); assert.ok(first); assert.equal(first.hasBom, true); assert.match(first.sourceVersion, /^[a-f0-9]{64}$/);
    await evaluate(`globalThis.recoveryLineageStalePlan=${api}.prepareRestore(${q(first.id)})`); await close();
    stage = "trusted rename chain"; await rename(a, b); await rename(b, c); await absent(a); await absent(b); await exact(c, "\ufeff" + original);
    let entries = await evaluate(`${api}.entries()`), selected = entries.find(entry => entry.snapshot.id === first.id);
    assert.equal(selected.target.path, c); assert.deepEqual(selected.snapshot, first);
    const stale = await evaluate(`(async()=>{try{await ${api}.restore(await recoveryLineageStalePlan);return{refused:false,error:""}}catch(error){return{refused:true,error:error.message}}finally{delete globalThis.recoveryLineageStalePlan}})()`);
    assert.equal(stale.refused, true); assert.match(stale.error, /renamed target|association/); report.recoveryLineageNegativeProbes.push({ name: "pre-rename restore plan", ...stale }); await absent(a); await exact(c, "\ufeff" + original);
    await history(c, first.id);
    const caption = await evaluate(`document.querySelector(${q(modal + " [data-recovery-lineage]")}).textContent`); assert.ok(caption.includes(a) && caption.includes(c));
    await evaluate(`document.querySelector(${q(modal + " [data-recovery-lineage]")}).scrollIntoView({block:"center"})`); await capture?.("recovery-lineage-current-target"); await close();
    stage = "compare and reviewed current-target restore"; await writeFile(join(directory, c), "\ufeff" + replacement); await refresh(); await idle(); await history(c, first.id);
    const beforeCompare = await readFile(historyPath); await click(action("compare")); await idle();
    const comparison = await evaluate(`document.querySelector(${q(modal + " [data-recovery-diff]")}).textContent`);
    assert.ok(comparison.includes(a) && comparison.includes(c)); assert.ok(comparison.includes("Retain this Ω")); assert.deepEqual(await readFile(historyPath), beforeCompare, "comparison leaves history exact");
    await click(action("review")); await idle();
    const review = await evaluate(`document.querySelector(${q(modal + " [data-recovery-restore-target]")}).textContent`); assert.ok(review.includes(a) && review.includes(c));
    assert.equal(await evaluate(`document.querySelector(${q(modal + ' [aria-label="Current saved text before restore"]')}).value`), replacement.replaceAll("\r\n", "\n"));
    await evaluate(`document.querySelector(${q(modal + " [data-recovery-restore-target]")}).scrollIntoView({block:"center"})`); await capture?.("recovery-lineage-restore-review");
    await click(action("confirm-restore")); await idle(); await exact(c, "\ufeff" + original); await absent(a); await absent(b);
    const stored = await parsed(); assert.deepEqual(stored.snapshots.find(snapshot => snapshot.id === first.id), first);
    assert.ok(stored.snapshots.some(snapshot => snapshot.path === c && snapshot.content === replacement && snapshot.reason === "before-restore" && snapshot.hasBom));
    assert.deepEqual(stored.future, { retain: ["opaque", 42] }); assert.deepEqual(stored.slopsidianRenames.future, { retain: "lineage" });
    assert.deepEqual(stored.snapshots.find(snapshot => snapshot.id === destination.id), destination); await close(); await stopTrace();
    report.recoveryLineage = { trustedRenameMoveChain: true, immutableSnapshotProvenance: true, explicitCapturedAndCurrentPaths: true, compareReadsCurrentTarget: true, compareLeavesHistoryExact: true, reviewedRestoreTargetsCurrentPath: true, safetySnapshotAtCurrentPath: true, exactUtf8BomCrlf: true, noGhostOriginalOrIntermediate: true, preRenamePlanRefused: true, unknownStoreAndSnapshotFieldsRetained: true };
    pass(report, "Trusted File Explorer rename/move dialogs preserve immutable captured snapshots across two names. Compare and explicit restore show the captured and current paths, restore only the confirmed current target, and retain its exact prior UTF-8/BOM/CRLF text before replacement; stale original-name plans refuse.");
    stage = "real restart and persisted target resolution";
    await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await wait(`${api}?.lineageArmed===true`, "persisted recovery re-arms after real host restart/reconnect"); await idle(); await startTrace();
    selected = (await evaluate(`${api}.entries()`)).find(entry => entry.snapshot.id === first.id); assert.deepEqual(selected.snapshot, first); assert.equal(selected.target.path, c);
    const plan = await evaluate(`${api}.prepareRestore(${q(first.id)})`); assert.equal(plan.targetPath, c); assert.equal(plan.snapshot.path, a);
    await history(c, first.id); await click(action("review")); await idle(); assert.ok((await evaluate(`document.querySelector(${q(modal + " [data-recovery-restore-target]")}).textContent`)).includes(c));
    await evaluate(`document.querySelector(${q(modal + " [data-recovery-restore-target]")}).scrollIntoView({block:"center"})`); await capture?.("recovery-lineage-restarted"); await click(action("cancel")); await idle(); await close();
    report.recoveryLineageRestart = { realHostRestartOrReconnect: true, startupInventoryRetainedAssociation: true, immutableSnapshotRetained: true, currentTargetResolves: true, currentTargetReviewWorks: true, noGhostOriginal: true }; await absent(a);
    pass(report, "A real host restart or browser reload/reconnect retains the renamed group through initial inventory materialization, and a fresh restore review resolves the persisted current target.");
    stage = "destination collision and known path reuse"; await rename(c, collision); await exact(collision, "\ufeff" + original); await absent(c);
    entries = await evaluate(`${api}.entries()`); selected = entries.find(entry => entry.snapshot.id === first.id); const other = entries.find(entry => entry.snapshot.id === destination.id);
    assert.equal(selected.target.path, null); assert.equal(other.target.path, null); assert.notEqual(selected.target.group, other.target.group); assert.deepEqual(selected.snapshot, first); assert.deepEqual(other.snapshot, destination);
    await history(null, first.id);
    const blocked = await evaluate(`(()=>{const m=document.querySelector(${q(modal)});return{caption:m.querySelector("[data-recovery-lineage]").textContent,copy:!m.querySelector('[data-recovery-action="copy"]').disabled,compare:m.querySelector('[data-recovery-action="compare"]').disabled,review:m.querySelector('[data-recovery-action="review"]').disabled}})()`);
    assert.ok(blocked.caption.includes("Unresolved") && blocked.caption.includes(a) && blocked.caption.includes(collision)); assert.equal(blocked.copy, true); assert.equal(blocked.compare, true); assert.equal(blocked.review, true);
    const refusal = await evaluate(`(async()=>{try{await ${api}.prepareRestore(${q(first.id)});return{refused:false,error:""}}catch(error){return{refused:true,error:error.message}}})()`); assert.equal(refusal.refused, true); report.recoveryLineageNegativeProbes.push({ name: "unresolved destination association", ...refusal });
    await evaluate(`document.querySelector(${q(modal + " [data-recovery-lineage]")}).scrollIntoView({block:"center"})`); await capture?.("recovery-lineage-conflicting-destination"); await close();
    // A subsequent explicitly observed creation at an old name is independent.
    await writeFile(join(directory, a), "# New file reusing the captured name\r\n"); await refresh(); await open(a); await history(a); await click(action("snapshot")); await idle(); await close();
    entries = await evaluate(`${api}.entries()`); const reused = entries.find(entry => entry.snapshot.path === a && entry.snapshot.id !== first.id && entry.target.path === a);
    assert.ok(reused); assert.equal(entries.find(entry => entry.snapshot.id === first.id).target.path, null); assert.notEqual(reused.target.group, selected.target.group); await exact(collision, "\ufeff" + original);
    assert.deepEqual((await parsed()).snapshots.find(snapshot => snapshot.id === first.id), first); assert.deepEqual((await parsed()).snapshots.find(snapshot => snapshot.id === destination.id), destination);
    report.recoveryLineageConflicts = { destinationHistoriesNotMerged: true, bothOriginalHistoriesRetained: true, unresolvedTargetsRefuseRestore: true, copyRemainsAvailable: true, currentTargetExact: true, knownPathReuseIndependent: true };
    await stopTrace(); assert.ok(report.recoveryLineageInputs.length > 8 && report.recoveryLineageInputs.every(event => event.trusted === true));
    report.recoveryLineageEvidence = { originalSnapshot: first, sourceSnapshotSha256: digest(Buffer.from(JSON.stringify(first))), finalHistorySha256: digest(await readFile(historyPath)), capturedPath: a, intermediatePath: b, confirmedPath: c, conflictingPath: collision };
    pass(report, "An acknowledged move into an unrelated historical destination keeps both original histories separate and visible as unresolved, retains Copy, refuses restore, and leaves a later known new-file reuse of the old captured name independent.");
  } catch (error) { failure = error; report.recoveryLineageFailure = { stage, error: String(error?.stack ?? error) }; throw error; }
  finally {
    try {
      await evaluate(`(()=>{globalThis.recoveryLineageTrace?.abort.abort();delete globalThis.recoveryLineageTrace;delete globalThis.recoveryLineageStalePlan;document.querySelector(${q(modal + " .modal-close-button")})?.click();document.querySelector('[data-file-dialog="rename"] [data-file-action="cancel"]')?.click()})()`);
      if (await evaluate('app.core.isEnabled("file-recovery")')) await toggle(false);
      await evaluate("app.workspace.saveAll()"); await evaluate("app.workspace.changeLayout(" + q(layout) + ")");
      if (created) { assert.equal(dirname(fixtureDirectory), rootDirectory); assert.ok(fixtureDirectory.startsWith(rootDirectory + sep)); await rm(fixtureDirectory, { recursive: true }); }
      for (let index = 0; index < files.length; index++) await restore(files[index], backups[index]);
      await refresh();
      if (enabled) { await toggle(true); await wait(`${api}.lineageArmed===true`, "original recovery lifecycle restored"); await idle(); }
      // Startup capture may inspect the restored layout: put every pre-existing
      // history/config blob back exactly after its bounded initialization.
      for (let index = 0; index < files.length; index++) await restore(files[index], backups[index]);
      await evaluate('app.configuration.read("file-recovery")');
      for (let index = 0; index < files.length; index++) assert.deepEqual(await optional(files[index]), backups[index], "original config/history bytes restored: " + configNames[index]);
    } catch (error) { if (!failure) throw error; report.recoveryLineageFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** The parent supplies a genuine complete cached index and checks every blob. */
export async function checkRecoveryLineageReadOnly(tools) {
  const { evaluate, click, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const inventory = await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), documents = await evaluate("app.metadataCache.getDocuments().map(x=>({path:x.document.file.path,text:x.text,version:x.document.version,hasBom:x.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))"), counters = await evaluate("(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), layout = await evaluate("app.workspace.getLayout()");
  await evaluate(`(()=>{${documentHistory.toString()}\nconst l=app.workspace.getLeafById("readonly-export-handoff-history"),v=l.view,e=v.editor,c=e.cm,s=app.workspace.sessions.get("Read only.md"),commands=app.plugins.modules["@codemirror/commands"];globalThis.recoveryLineageReadonlyOwner={leaf:l,view:v,editor:e,cm:c,doc:c.state.doc,session:s,saved:s.document,file:v.file,text:s.text,dirty:s.dirty,history:documentHistory(c,commands)}})()`);
  assert.equal(await evaluate('app.core.isEnabled("file-recovery")'), false); assert.equal(await evaluate('app.core.state("file-recovery").implemented'), false);
  assert.equal(await evaluate('app.commands.listCommands().some(x=>x.id.startsWith("file-recovery:"))'), false);
  const toggle = '[data-core-toggle="file-recovery"]'; await click("#open-settings"); await click("#core-plugins-tab");
  try {
    assert.equal(await evaluate("document.querySelector(" + q(toggle) + ").disabled"), true);
    await evaluate(`(()=>{const t=globalThis.recoveryLineageReadonlyTrace={events:[],abort:new AbortController()};document.addEventListener("pointerdown",event=>{if(event.target.closest?.(${q(toggle)}))t.events.push({trusted:event.isTrusted})},{capture:true,signal:t.abort.signal})})()`);
    await pointer(tools, toggle);
    const probes = await evaluate('(async()=>{const r=app.core.getPluginById("file-recovery").instance,counts={configurationRead:0,configurationWrite:0,documentRead:0,documentWrite:0},methods=[[app.configuration,"read","configurationRead"],[app.configuration,"write","configurationWrite"],[app.vault,"readDocument","documentRead"],[app.vault,"writeDocument","documentWrite"]],saved=methods.map(([owner,key])=>owner[key]),results=[];for(let i=0;i<methods.length;i++){const[owner,key,count]=methods[i];owner[key]=function(...args){counts[count]++;return saved[i].apply(this,args)}}try{for(const[name,action]of[["entries",()=>r.entries()],["compare",()=>r.compareSaved("cached_lineage")],["prepare",()=>r.prepareRestore("cached_lineage")],["restore",()=>r.restore({})],["list",()=>r.list()],["capture",()=>r.capture("Read only.md")],["open",()=>r.openModal("Read only.md")]]){let error="";try{await action()}catch(reason){error=reason.message}results.push({name,refused:error.includes("read-only vault"),error})}return{results,counts}}finally{for(let i=0;i<methods.length;i++)methods[i][0][methods[i][1]]=saved[i]}})()');
    assert.equal(probes.results.length, 7); assert.ok(probes.results.every(probe => probe.refused === true)); assert.deepEqual(probes.counts, { configurationRead: 0, configurationWrite: 0, documentRead: 0, documentWrite: 0 });
    assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false);
    assert.deepEqual(await evaluate("app.vault.getFiles().map(file=>file.path).sort()"), inventory);
    assert.deepEqual(await evaluate("app.metadataCache.getDocuments().map(x=>({path:x.document.file.path,text:x.text,version:x.document.version,hasBom:x.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))"), documents);
    assert.deepEqual(await evaluate("(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), counters);
    report.recoveryLineageReadOnlyInputs = await evaluate("recoveryLineageReadonlyTrace.events"); assert.ok(report.recoveryLineageReadOnlyInputs.length && report.recoveryLineageReadOnlyInputs.every(event => event.trusted === true)); report.recoveryLineageReadOnlyProbes = probes;
    await capture?.("recovery-lineage-readonly");
  } finally { await evaluate("globalThis.recoveryLineageReadonlyTrace?.abort.abort();delete globalThis.recoveryLineageReadonlyTrace"); await click(".settings-close"); }
  const owner = await evaluate(`(()=>{${documentHistory.toString()}\nconst o=recoveryLineageReadonlyOwner,l=app.workspace.getLeafById("readonly-export-handoff-history"),s=app.workspace.sessions.get("Read only.md"),commands=app.plugins.modules["@codemirror/commands"];return{sameLeaf:l===o.leaf,sameView:l.view===o.view,sameEditor:l.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:s===o.session,sameSavedDocument:s.document===o.saved,sameFile:o.view.file===o.file,exactText:s.text===o.text,exactDirty:s.dirty===o.dirty,exactHistory:documentHistory(o.cm,commands)===o.history}})()`);
  for (const [field, value] of Object.entries(owner)) assert.equal(value, true, "cached Source owner preserved: " + field);
  assert.deepEqual(await evaluate("app.workspace.getLayout()"), layout); await evaluate("delete globalThis.recoveryLineageReadonlyOwner");
  report.recoveryLineageReadOnly = { genuineCachedMount: true, moduleUnavailable: true, disabledTrustedPointer: true, noCommandsOrDialog: true, sevenForcedProbesRefused: true, zeroConfigurationAndDocumentIo: true, inventoryExact: true, documentsExact: true, sourceOwnerAndHistoryExact: true, layoutExact: true, zeroAdditionalApiRaw: true };
  pass(report, "The genuine cached read-only vault keeps File recovery unavailable. A trusted disabled-pointer action and seven separately labelled direct probes refuse before configuration/document I/O, preserving exact inventory, documents, Source owner and history, layout and API/raw counters.");
}
