import assert from "node:assert/strict";
import { checkBasesCards, checkBasesCardsReadOnly, basesCardsReadOnlyFixture } from "./bases-card-scenarios.mjs";
import { checkAudioWaveform, checkAudioWaveformReadOnly, audioWaveformReadOnlyFixture } from "./audio-waveform-scenarios.mjs";
import { checkOutgoingBulkMentions, checkOutgoingBulkMentionsReadOnly, outgoingBulkMentionsReadOnlyFixture } from "./outgoing-bulk-mention-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Serial real-host workflows; each feature owns and restores its isolated local fixtures. */
export async function checkCardsAudioBulk(hostTools) {
  const noticeWaits = hostTools.report.cardsAudioBulkNoticeWaits = [];
  const tools = { ...hostTools, click: async (selector, modifiers = 0) => {
    const covered = `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.scrollIntoView({block:"center",inline:"nearest"});const r=Array.from(node.getClientRects()).find(rect=>rect.width>0&&rect.height>0);if(!r)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(hit?.closest(".notice")&&!node.contains(hit))})()`;
    if (await hostTools.evaluate(covered)) {
      const entry = { selector, startedAt: new Date().toISOString() }; noticeWaits.push(entry);
      await hostTools.wait(`!(${covered})`, "the real transient notice no longer covers this control");
      entry.completedAt = new Date().toISOString();
    }
    await hostTools.click(selector, modifiers);
  } };
  const failures = tools.report.cardsAudioBulkFailures = [];
  for (const [name, check] of [["cards", checkBasesCards], ["waveforms", checkAudioWaveform], ["bulkMentions", checkOutgoingBulkMentions]]) {
    try { await check(tools); }
    catch (error) { failures.push({ name, error: String(error?.stack ?? error) }); }
  }
  if (failures.length) throw new AggregateError(failures.map(item => new Error(item.name + ": " + item.error)), "Cards, waveforms and bulk mention workflows failed");

  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()");
  const workspace = { version: 1, main: { id: "readonly-cards-audio-bulk-main", type: "split", direction: "vertical", children: [
    { id: "readonly-cards-audio-bulk-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-cards-audio-bulk", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-cards-audio-bulk" };
  const fixtures = [basesCardsReadOnlyFixture, audioWaveformReadOnlyFixture, outgoingBulkMentionsReadOnlyFixture];
  const files = new Map([["Read only.md", "# Cached Cards, waveforms and reviewed mentions\r\n\r\nRetain exact cached source λ 😀.\r\n" + fixtures.map(fixture => fixture.sourceAddition ?? "").join("")]]);
  for (const fixture of fixtures) for (const [path, content] of fixture.files ?? []) {
    assert.equal(files.has(path), false, "Unique cached fixture path: " + path); files.set(path, content);
  }
  for (const [path, content] of [
    [".obsidian/app.json", '{"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"cards waveforms and bulk mentions"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","file-explorer","outgoing-link","bases","audio-recorder"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]) { assert.equal(files.has(path), false); files.set(path, content); }
  const fixture = await mountCachedGitHub(evaluate, "cards-audio-bulk", [...files]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-cards-audio-bulk"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cached Cards/waveform/bulk mount");
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
  const reset = () => evaluate('(async()=>{const leaf=app.workspace.getLeafById("readonly-cards-audio-bulk");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false);await app.core.whenIdle()})()');
  for (const [name, check] of [["cardsReadOnly", checkBasesCardsReadOnly], ["waveformReadOnly", checkAudioWaveformReadOnly], ["bulkMentionsReadOnly", checkOutgoingBulkMentionsReadOnly]]) {
    try { await reset(); await check(tools); }
    catch (error) { failures.push({ name, error: String(error?.stack ?? error) }); }
  }
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly-combined");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  if (failures.length) throw new AggregateError(failures.map(item => new Error(item.name + ": " + item.error)), "Cached Cards, waveforms and bulk mention workflows failed");
  report.cardsAudioBulk = { readOnly: { genuineCachedMount: true, completeIndex: true, zeroApiRaw: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("The combined genuine cached vault retains usable Cards and explicit local waveform playback while bulk source mutations refuse, with a complete index, zero API/raw requests and exact cached blobs through local-vault return.");
}
