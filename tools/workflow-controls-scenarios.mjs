import assert from "node:assert/strict";
import { checkPropertyLinkAuthoring, checkPropertyLinkAuthoringReadOnly, propertyLinkAuthoringReadOnlyFixture } from "./property-link-authoring-scenarios.mjs";
import { checkReadingBulkFolds, checkReadingBulkFoldsReadOnly, readingBulkFoldsReadOnlyFixture } from "./reading-bulk-fold-scenarios.mjs";
import { checkExplorerRemovalChoices, checkExplorerRemovalChoicesReadOnly, explorerRemovalChoicesReadOnlyFixture } from "./explorer-removal-choices-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export async function checkWorkflowControls(tools) {
  await checkReadingBulkFolds(tools);
  await checkPropertyLinkAuthoring(tools);
  await checkExplorerRemovalChoices(tools);
  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = { main: { id: "readonly-controls-main", type: "split", direction: "vertical", children: [
    { id: "readonly-controls-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-controls", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-controls" };
  assert.equal(typeof propertyLinkAuthoringReadOnlyFixture.source, "string");
  assert.equal(typeof readingBulkFoldsReadOnlyFixture.sourceAddition, "string");
  const entries = [
    ["Read only.md", propertyLinkAuthoringReadOnlyFixture.source + readingBulkFoldsReadOnlyFixture.sourceAddition],
    ["Known target.md", "---\r\naliases: [Cached alias]\r\n---\r\n# Existing heading\r\n\r\nCached target λ 😀.\r\n" + (propertyLinkAuthoringReadOnlyFixture.targetAddition ?? "")],
    ...(propertyLinkAuthoringReadOnlyFixture.files ?? []),
    ...(explorerRemovalChoicesReadOnlyFixture.files ?? []),
    [".obsidian/app.json", '{"foldHeading":true,"foldIndent":true,"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"cached workflow controls"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer","outline"]'],
    [".obsidian/community-plugins.json", "[]"],
  ];
  assert.equal(new Set(entries.map(([path]) => path)).size, entries.length, "Cache fixture paths are unique");
  const fixture = await mountCachedGitHub(evaluate, "workflow-controls", entries);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-controls"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cached workflow controls fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click("#github-vault-offline");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "initial cache-only index status");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "complete cached Markdown index");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "cache-only index dialog closed");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), entries.filter(([path]) => /\.md$/i.test(path)).length);
  const reset = () => evaluate('(()=>{const leaf=app.workspace.getLeafById("readonly-controls");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false)})()');
  await reset(); await checkPropertyLinkAuthoringReadOnly(tools);
  await reset(); await checkExplorerRemovalChoicesReadOnly(tools);
  await reset(); await checkReadingBulkFoldsReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.workflowControls = { readOnly: { genuineCacheOnly: true, completeIndex: true, zeroNetwork: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("Prepared cache-only Properties and reviewed removal refuse mutation; Reading bulk folds retain local intent with unchanged cached blobs and zero API/raw requests through local-vault return.");
}
