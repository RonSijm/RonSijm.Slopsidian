import assert from "node:assert/strict";
import { checkBasesCodeBlocks, checkBasesCodeBlocksReadOnly, basesCodeBlocksReadOnlyFixture } from "./bases-code-block-scenarios.mjs";
import { checkStructuredPropertyOperations, checkStructuredPropertyOperationsReadOnly, structuredPropertyOperationsReadOnlyFixture } from "./structured-property-operations-scenarios.mjs";
import { checkSavedAudioWaveform, checkSavedAudioWaveformReadOnly, savedAudioWaveformReadOnlyFixture } from "./saved-audio-waveform-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Actual host workflows are serial. Every slice restores its own local fixtures. */
export async function checkInlineStructureAudio(hostTools) {
  const noticeWaits = hostTools.report.inlineStructureAudioNoticeWaits = [];
  const tools = { ...hostTools, click: async (selector, modifiers = 0) => {
    const covered = `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.scrollIntoView({block:"center",inline:"nearest"});const r=Array.from(node.getClientRects()).find(rect=>rect.width>0&&rect.height>0);if(!r)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(hit?.closest(".notice")&&!node.contains(hit))})()`;
    if (await hostTools.evaluate(covered)) {
      const entry = { selector, startedAt: new Date().toISOString() }; noticeWaits.push(entry);
      await hostTools.wait(`!(${covered})`, "the transient notice no longer covers the real control");
      entry.completedAt = new Date().toISOString();
    }
    await hostTools.click(selector, modifiers);
  } };
  const failures = tools.report.inlineStructureAudioFailures = [];
  for (const [name, check] of [["basesCodeBlocks", checkBasesCodeBlocks], ["structuredOperations", checkStructuredPropertyOperations], ["savedAudio", checkSavedAudioWaveform]]) {
    try { await check(tools); }
    catch (error) { failures.push({ name, error: String(error?.stack ?? error) }); }
  }
  if (failures.length) throw new AggregateError(failures.map(item => new Error(item.name + ": " + item.error)), "Inline Bases, structural Properties and saved-audio workflows failed");

  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()");
  const workspace = { version: 1, main: { id: "readonly-inline-structure-audio-main", type: "split", direction: "vertical", children: [
    { id: "readonly-inline-structure-audio-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-inline-structure-audio", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-inline-structure-audio" };
  const audioFixture = await savedAudioWaveformReadOnlyFixture(report);
  const fixtures = [basesCodeBlocksReadOnlyFixture, structuredPropertyOperationsReadOnlyFixture, audioFixture];
  assert.equal(typeof structuredPropertyOperationsReadOnlyFixture.source, "string");
  const source = structuredPropertyOperationsReadOnlyFixture.source + [basesCodeBlocksReadOnlyFixture, audioFixture].map(fixture => fixture.sourceAddition ?? "").join("");
  const files = new Map([["Read only.md", source]]);
  for (const fixture of fixtures) for (const [path, content] of fixture.files ?? []) {
    assert.equal(files.has(path), false, "Unique cached fixture path: " + path); files.set(path, content);
  }
  for (const [path, content] of [
    [".obsidian/app.json", '{"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"inline Bases, nested structure and saved audio"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","file-explorer","bases","properties","audio-recorder"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]) { assert.equal(files.has(path), false); files.set(path, content); }
  const fixture = await mountCachedGitHub(evaluate, "inline-structure-audio", [...files]);
  await wait('app.vault.rootPath===' + JSON.stringify(fixture.mount.id) + '&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-inline-structure-audio"&&app.workspace.getActiveFile()?.path==="Read only.md"', "genuine cached inline/structure/audio mount");
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
  await evaluate('(()=>{const leaf=app.workspace.getLeafById("readonly-inline-structure-audio"),view=leaf.view,editor=view.editor,cm=editor.cm,session=app.workspace.sessions.get("Read only.md");globalThis.inlineStructureAudioCachedOwner={leaf,view,editor,cm,doc:cm.state.doc,session,savedDocument:session.document,text:session.text,dirty:session.dirty,root:app.vault.rootPath,file:view.file}})()');
  const ownerChecks = report.inlineStructureAudioCachedOwnerChecks = [];
  const reset = () => evaluate('(async()=>{const leaf=app.workspace.getLeafById("readonly-inline-structure-audio");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false);await app.core.whenIdle()})()');
  for (const [name, check] of [["basesCodeBlocksReadOnly", checkBasesCodeBlocksReadOnly], ["structuredOperationsReadOnly", checkStructuredPropertyOperationsReadOnly], ["savedAudioReadOnly", checkSavedAudioWaveformReadOnly]]) {
    try {
      await reset(); await check(tools);
      const observed = await evaluate('(()=>{const o=inlineStructureAudioCachedOwner,leaf=app.workspace.getLeafById("readonly-inline-structure-audio");return{sameLeaf:leaf===o.leaf,sameView:leaf?.view===o.view,sameEditor:leaf?.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:app.workspace.sessions.get("Read only.md")===o.session,sameSavedDocument:o.session.document===o.savedDocument,sourceExact:o.session.text===o.text,dirtyExact:o.session.dirty===o.dirty,sameRoot:app.vault.rootPath===o.root,sameFile:o.view.file===o.file&&app.vault.getFileByPath("Read only.md")===o.file}})()');
      ownerChecks.push({ name, observed });
      for (const [field, value] of Object.entries(observed)) assert.equal(value, true, name + " retained cached owner: " + field);
    }
    catch (error) { failures.push({ name, error: String(error?.stack ?? error) }); }
  }
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly-combined");
  await evaluate('delete globalThis.inlineStructureAudioCachedOwner');
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  if (failures.length) throw new AggregateError(failures.map(item => new Error(item.name + ": " + item.error)), "Cached inline Bases, structural Properties and saved-audio workflows failed");
  report.inlineStructureAudio = { readOnly: { genuineCachedMount: true, completeIndex: true, zeroApiRaw: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("The combined genuine cached vault displays inline Bases and explicit supported saved-audio waveforms while structural Properties authoring refuses before host operations; complete indexing, zero API/raw requests and exact cached blobs survive local-vault return.");
}
