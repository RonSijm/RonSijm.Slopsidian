import assert from "node:assert/strict";
import { checkBasesExport, checkBasesExportReadOnly, basesExportReadOnlyFixture } from "./bases-export-scenarios.mjs";
import { checkStructuredPropertyHandoff, checkStructuredPropertyHandoffReadOnly, structuredPropertyHandoffReadOnlyFixture } from "./structured-property-handoff-scenarios.mjs";
import { checkRecoveryLineage, checkRecoveryLineageReadOnly, recoveryLineageReadOnlyFixture } from "./recovery-lineage-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Actual host workflows are serial. Every slice restores its own local fixtures. */
export async function checkExportHandoffHistory(hostTools) {
  const leases = [], sections = new Set(); let accepting = true, failure;
  const tools = { ...hostTools, deferClipboardPermissionCleanup(lease, section) {
    assert.ok(accepting, "The collection is still accepting owned permission leases");
    assert.ok(["basesExport", "basesExportReadOnly"].includes(section));
    assert.equal(sections.has(section), false, "One owned lease per export workflow");
    assert.equal(typeof lease?.release, "function"); assert.ok(lease.receipt);
    sections.add(section); leases.push({ lease, section });
  } };
  try { await runExportHandoffHistory(tools); } catch (error) { failure = error; }
  accepting = false;
  const cleanup = hostTools.report.exportHandoffHistoryPermissionCleanup = [], errors = [];
  // CDP reset is global to the disposable browser context. Keep its permissions
  // until every fixture, directory handle and reconnect has finished using it.
  if (leases.length) {
    try { await hostTools.evaluate('(async()=>{await app.workspace.whenIdle();if(app.metadataCache.pending)await app.metadataCache.pending;await app.configuration.whenIdle()})()'); }
    catch (error) { errors.push(error); }
  }
  for (const { lease, section } of leases) {
    try {
      await lease.release();
      assert.equal(lease.receipt.resetAcknowledged, true); assert.equal(lease.receipt.released, true);
      if (hostTools.report[section]) hostTools.report[section].temporaryClipboardPermissionsReleased = true;
      cleanup.push({ section, acknowledged: true, receipt: { ...lease.receipt } });
    } catch (error) { cleanup.push({ section, acknowledged: false, error: String(error?.message ?? error) }); errors.push(error); }
  }
  if (errors.length) throw new AggregateError([...(failure ? [failure] : []), ...errors], "The collection or its owned browser-permission cleanup failed");
  if (failure) throw failure;
}

async function runExportHandoffHistory(hostTools) {
  const noticeWaits = hostTools.report.exportHandoffHistoryNoticeWaits = [];
  const tools = { ...hostTools, click: async (selector, modifiers = 0) => {
    const covered = `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.scrollIntoView({block:"center",inline:"nearest"});const r=Array.from(node.getClientRects()).find(rect=>rect.width>0&&rect.height>0);if(!r)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(hit?.closest(".notice")&&!node.contains(hit))})()`;
    if (await hostTools.evaluate(covered)) {
      const entry = { selector, startedAt: new Date().toISOString() }; noticeWaits.push(entry);
      await hostTools.wait(`!(${covered})`, "the transient notice no longer covers the real control");
      entry.completedAt = new Date().toISOString();
    }
    await hostTools.click(selector, modifiers);
  } };
  const failures = tools.report.exportHandoffHistoryFailures = [];
  for (const [name, check] of [["basesExport", checkBasesExport], ["propertiesHandoff", checkStructuredPropertyHandoff], ["recoveryLineage", checkRecoveryLineage]]) {
    try { await check(tools); }
    catch (error) { failures.push({ name, error: String(error?.stack ?? error) }); }
  }
  if (failures.length) throw new AggregateError(failures.map(item => new Error(item.name + ": " + item.error)), "Bases export, closed-note Properties and rename-aware recovery workflows failed");

  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()");
  const workspace = { version: 1, main: { id: "readonly-export-handoff-history-main", type: "split", direction: "vertical", children: [
    { id: "readonly-export-handoff-history-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-export-handoff-history", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-export-handoff-history" };
  const recoveryFixture = typeof recoveryLineageReadOnlyFixture === "function" ? await recoveryLineageReadOnlyFixture(report) : recoveryLineageReadOnlyFixture;
  const fixtures = [basesExportReadOnlyFixture, structuredPropertyHandoffReadOnlyFixture, recoveryFixture];
  assert.equal(typeof structuredPropertyHandoffReadOnlyFixture.source, "string");
  const source = structuredPropertyHandoffReadOnlyFixture.source + [basesExportReadOnlyFixture, recoveryFixture].map(fixture => fixture.sourceAddition ?? "").join("");
  const files = new Map([["Read only.md", source]]);
  for (const fixture of fixtures) for (const [path, content] of fixture.files ?? []) {
    assert.equal(files.has(path), false, "Unique cached fixture path: " + path); files.set(path, content);
  }
  for (const [path, content] of [
    [".obsidian/app.json", '{"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"Bases export, Properties handoff and recovery history"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","file-explorer","bases","properties"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]) { assert.equal(files.has(path), false); files.set(path, content); }
  const fixture = await mountCachedGitHub(evaluate, "export-handoff-history", [...files]);
  await wait('app.vault.rootPath===' + JSON.stringify(fixture.mount.id) + '&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-export-handoff-history"&&app.workspace.getActiveFile()?.path==="Read only.md"', "genuine cached export/handoff/history mount");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click("#github-vault-offline");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "initial genuine cached index state");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "complete genuine cached Markdown index");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "cached index dialog closes");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), [...files.keys()].filter(path => /\.md$/i.test(path)).length);
  await evaluate('(()=>{const leaf=app.workspace.getLeafById("readonly-export-handoff-history"),view=leaf.view,editor=view.editor,cm=editor.cm,session=app.workspace.sessions.get("Read only.md");globalThis.exportHandoffHistoryCachedOwner={leaf,view,editor,cm,doc:cm.state.doc,session,savedDocument:session.document,text:session.text,dirty:session.dirty,root:app.vault.rootPath,file:view.file}})()');
  const ownerChecks = report.exportHandoffHistoryCachedOwnerChecks = [];
  const reset = () => evaluate('(async()=>{const leaf=app.workspace.getLeafById("readonly-export-handoff-history");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false);await app.core.whenIdle()})()');
  for (const [name, check] of [["basesExportReadOnly", checkBasesExportReadOnly], ["propertiesHandoffReadOnly", checkStructuredPropertyHandoffReadOnly], ["recoveryLineageReadOnly", checkRecoveryLineageReadOnly]]) {
    try {
      await reset(); await check(tools);
      const observed = await evaluate('(()=>{const o=exportHandoffHistoryCachedOwner,leaf=app.workspace.getLeafById("readonly-export-handoff-history");return{sameLeaf:leaf===o.leaf,sameView:leaf?.view===o.view,sameEditor:leaf?.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:app.workspace.sessions.get("Read only.md")===o.session,sameSavedDocument:o.session.document===o.savedDocument,sourceExact:o.session.text===o.text,dirtyExact:o.session.dirty===o.dirty,sameRoot:app.vault.rootPath===o.root,sameFile:o.view.file===o.file&&app.vault.getFileByPath("Read only.md")===o.file}})()');
      ownerChecks.push({ name, observed });
      for (const [field, value] of Object.entries(observed)) assert.equal(value, true, name + " retained cached owner: " + field);
    }
    catch (error) { failures.push({ name, error: String(error?.stack ?? error) }); }
  }
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly-combined");
  await evaluate('delete globalThis.exportHandoffHistoryCachedOwner');
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  if (failures.length) throw new AggregateError(failures.map(item => new Error(item.name + ": " + item.error)), "Cached Bases export, closed-note Properties and rename-aware recovery workflows failed");
  report.exportHandoffHistory = { readOnly: { genuineCachedMount: true, completeIndex: true, zeroApiRaw: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("The combined genuine cached vault displays read-only Bases exports while Properties handoff and File recovery refuse before host operations; complete indexing, zero API/raw requests and exact cached blobs survive local-vault return.");
}
