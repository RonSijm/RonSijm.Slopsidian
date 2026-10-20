import assert from "node:assert/strict";
import { checkOutgoingMentionAuthoring, checkOutgoingMentionAuthoringReadOnly, outgoingMentionReadOnlyFixture } from "./outgoing-mention-authoring-scenarios.mjs";
import { checkBasesGroups, checkBasesGroupsReadOnly, basesGroupsReadOnlyFixture } from "./bases-group-scenarios.mjs";
import { checkAudioPauseResume, checkAudioPauseResumeReadOnly, audioPauseResumeReadOnlyFixture } from "./audio-pause-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Actual input and owned fixtures; runners bind source/artifacts and final teardown. */
export async function checkAuthoringControls(hostTools) {
  const noticeWaits = hostTools.report.authoringControlsNoticeWaits = [];
  const tools = { ...hostTools, click: async (selector, modifiers = 0) => {
    // Preserve ordinary physical hit-testing while a real temporary notice expires.
    const covered = `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.scrollIntoView({block:"center",inline:"nearest"});const r=Array.from(node.getClientRects()).find(rect=>rect.width>0&&rect.height>0);if(!r)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(hit?.closest(".notice")&&!node.contains(hit))})()`;
    if (await hostTools.evaluate(covered)) {
      const entry = { selector, startedAt: new Date().toISOString() }; noticeWaits.push(entry);
      await hostTools.wait(`!(${covered})`, "the actual transient notice stops covering the control");
      entry.completedAt = new Date().toISOString();
    }
    await hostTools.click(selector, modifiers);
  } };
  const failures = tools.report.authoringControlFailures = [];
  for (const [name, check] of [["bases", checkBasesGroups], ["audio", checkAudioPauseResume], ["mentions", checkOutgoingMentionAuthoring]]) {
    try { await check(tools); }
    catch (error) { failures.push({ name, error: String(error?.stack ?? error) }); }
  }
  // Helpers own separate disposable fixtures and restore their layout/settings.
  // Complete every independent main workflow, while retaining a failed collection.
  if (failures.length) { throw new AggregateError(failures.map(item => new Error(item.name + ": " + item.error)), "Authoring controls failed: " + failures.map(item => item.name).join(", ")); }

  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()");
  const workspace = { version: 1, main: { id: "readonly-controls-main", type: "split", direction: "vertical", children: [
    { id: "readonly-controls-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-controls", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-controls" };
  const files = new Map([["Read only.md", "# Cached authoring controls\r\n\r\nRetain cached source λ 😀.\r\n" + (outgoingMentionReadOnlyFixture.sourceAddition ?? "")]]);
  for (const fixture of [outgoingMentionReadOnlyFixture, basesGroupsReadOnlyFixture, audioPauseResumeReadOnlyFixture]) {
    for (const [path, content] of fixture.files ?? []) { assert.equal(files.has(path), false, "Unique cached fixture path: " + path); files.set(path, content); }
  }
  for (const [path, content] of [
    [".obsidian/app.json", '{"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"authoring controls cache"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","file-explorer","outgoing-link","bases","audio-recorder"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]) { assert.equal(files.has(path), false); files.set(path, content); }
  const fixture = await mountCachedGitHub(evaluate, "authoring-controls", [...files]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-controls"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cached authoring-controls mount");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click("#github-vault-offline");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "initial cached index state");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "complete genuine cached Markdown index");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "cached index dialog closes");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), [...files.keys()].filter(path => /\.md$/i.test(path)).length);
  const reset = () => evaluate('(async()=>{const leaf=app.workspace.getLeafById("readonly-controls");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false);await app.core.whenIdle()})()');
  await reset(); await checkOutgoingMentionAuthoringReadOnly(tools);
  await reset(); await checkBasesGroupsReadOnly(tools);
  await reset(); await checkAudioPauseResumeReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly-combined");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.authoringControls = { readOnly: { genuineCachedMount: true, completeIndex: true, zeroApiRaw: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("The combined genuine cached vault keeps mention authoring and microphone capture unavailable while local Bases folds remain usable, with a complete index, zero API/raw requests and unchanged cached blobs through local-vault return.");
}
