import assert from "node:assert/strict";
import { checkPropertyWorkflows, checkPropertyWorkflowsReadOnly, propertyWorkflowsReadOnlyFixture } from "./property-workflows-scenarios.mjs";
import { checkCrosspaneDrops, checkCrosspaneDropsReadOnly, crosspaneDropReadOnlyFixture } from "./crosspane-drop-scenarios.mjs";
import { checkReadingCallouts, checkReadingCalloutsReadOnly, readingCalloutReadOnlyFixture } from "./reading-callout-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export async function checkPropertiesReading(tools) {
  await checkReadingCallouts(tools);
  await checkCrosspaneDrops(tools);
  await checkPropertyWorkflows(tools);
  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = { main: { id: "readonly-workflows-main", type: "split", direction: "vertical", children: [
    { id: "readonly-workflows-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-workflows", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-workflows" };
  assert.equal(typeof propertyWorkflowsReadOnlyFixture.source, "string");
  assert.equal(typeof readingCalloutReadOnlyFixture.sourceAddition, "string");
  const entries = [
    ["Read only.md", propertyWorkflowsReadOnlyFixture.source + readingCalloutReadOnlyFixture.sourceAddition],
    ["Known target.md", "---\r\naliases: [Cached alias]\r\n---\r\n# Existing heading\r\n\r\nCached target λ 😀.\r\n" + (propertyWorkflowsReadOnlyFixture.targetAddition ?? "")],
    ["Drop folder/Kept.md", "# Keep cached destination\r\n"],
    ...crosspaneDropReadOnlyFixture.files,
    [".obsidian/app.json", '{"foldHeading":true,"foldIndent":true,"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"cached workflow configuration"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer","outline"]'],
    [".obsidian/community-plugins.json", "[]"],
  ];
  assert.equal(new Set(entries.map(([path]) => path)).size, entries.length, "Cache fixture paths are unique");
  const fixture = await mountCachedGitHub(evaluate, "properties-reading", entries);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-workflows"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cache-only Properties, Files and Reading fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click("#github-vault-offline");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "initial cache-only index status");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "every actual cached Markdown file is indexed");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "cache-only index dialog closed");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), entries.filter(([path]) => /\.md$/i.test(path)).length);
  const reset = () => evaluate('(()=>{const leaf=app.workspace.getLeafById("readonly-workflows");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false)})()');
  await reset(); await checkPropertyWorkflowsReadOnly(tools);
  await reset(); await checkCrosspaneDropsReadOnly(tools);
  await reset(); await checkReadingCalloutsReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.propertiesReading = { readOnly: { genuineCacheOnly: true, completeIndex: true, zeroNetwork: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("Prepared cache-only Properties and cross-pane moves refuse mutation; Reading callouts retain local fold intent without changing any cached blob or API/raw request counter, including local-vault return.");
}
