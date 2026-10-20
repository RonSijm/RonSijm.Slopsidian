import assert from "node:assert/strict";
import { checkSetextAuthoring, checkSetextAuthoringReadOnly, setextAuthoringReadOnlyFixture } from "./setext-authoring-scenarios.mjs";
import { checkCalloutAuthoring, checkCalloutAuthoringReadOnly, calloutAuthoringReadOnlyFixture } from "./callout-authoring-scenarios.mjs";
import { checkPropertyHeadingCreation, checkPropertyHeadingCreationReadOnly } from "./property-heading-creation-scenarios.mjs";
import { checkExplorerDrops, checkExplorerDropsReadOnly, explorerDropReadOnlyFixture } from "./explorer-drop-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export async function checkAuthoringTransfers(tools) {
  await checkSetextAuthoring(tools);
  await checkCalloutAuthoring(tools);
  await checkPropertyHeadingCreation(tools);
  await checkExplorerDrops(tools);
  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = { main: { id: "readonly-authoring-main", type: "split", direction: "vertical", children: [
    { id: "readonly-authoring-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-authoring", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-authoring" };
  const text = ["\ufeff---", 'related: ""', "links: [kept]", "status: Open", 'opaque: "Retain cached authoring source"', "---", "", "# Read only", "",
    ...setextAuthoringReadOnlyFixture.sourcePrefixes, "", ...calloutAuthoringReadOnlyFixture.sourcePrefixes, "", "Original cached source λ 😀.", ""].join("\r\n");
  const files = [["Read only.md", text], ["Known target.md", '---\r\naliases: [Cached alias]\r\n---\r\n\r\n# Existing heading\r\n\r\nCached paragraph λ 😀.\r\n' + setextAuthoringReadOnlyFixture.targetAddition + calloutAuthoringReadOnlyFixture.targetAddition],
    ...explorerDropReadOnlyFixture.files,
    [".obsidian/app.json", '{"spellcheck":true,"foldHeading":true,"foldIndent":true,"autoPairBrackets":true,"smartIndentList":true,"autoPairMarkdown":true,"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"cached authoring configuration"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)], [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer"]'], [".obsidian/community-plugins.json", "[]"]];
  const fixture = await mountCachedGitHub(evaluate, "authoring-transfers", files);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-authoring"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cache-only authoring/transfer fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click("#github-vault-offline");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "initial cache-only index status loaded");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "all actual cached Markdown notes are verified and indexed");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "cache-only index controls closed");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), files.filter(([path]) => /\.md$/i.test(path)).length);
  const reset = () => evaluate('(()=>{app.workspace.setActiveLeaf(app.workspace.getLeafById("readonly-authoring"));app.workspace.activeLeaf.view.setEditingMode("source",false)})()');
  await reset(); await checkSetextAuthoringReadOnly(tools);
  await reset(); await checkCalloutAuthoringReadOnly(tools);
  await reset(); await checkPropertyHeadingCreationReadOnly(tools);
  await reset(); await checkExplorerDropsReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs); await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.authoringTransfers = { readOnly: { genuineCacheOnly: true, preparedCompleteIndex: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("Genuine prepared cache-only Setext/callout/Properties heading authoring and selected-note folder drops refuse every mutation; all original blobs and zero API/raw counters remain exact through local-vault return.");
}
