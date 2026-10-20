import assert from "node:assert/strict";
import { checkMultilineProperties, checkMultilinePropertiesReadOnly, multilinePropertiesReadOnlyFixture } from "./multiline-properties-scenarios.mjs";
import { checkMarkdownCrlf, checkMarkdownCrlfReadOnly, markdownCrlfReadOnlyFixture } from "./markdown-crlf-scenarios.mjs";
import { checkTrashRecovery, checkTrashRecoveryReadOnly, trashRecoveryReadOnlyFixture } from "./trash-recovery-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export async function checkStructuredRecovery(tools) {
  await checkMarkdownCrlf(tools);
  await checkMultilineProperties(tools);
  await checkTrashRecovery(tools);
  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = { main: { id: "readonly-recovery-main", type: "split", direction: "vertical", children: [
    { id: "readonly-recovery-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-recovery", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-recovery" };
  assert.equal(typeof multilinePropertiesReadOnlyFixture.source, "string");
  assert.equal(typeof markdownCrlfReadOnlyFixture.sourceAddition, "string");
  const propertySource = multilinePropertiesReadOnlyFixture.source;
  const frontmatterEnd = propertySource.indexOf("\r\n---\r\n", 5);
  assert.ok(frontmatterEnd > 0, "The combined fixture has a closed CRLF frontmatter header");
  const bodyStart = frontmatterEnd + "\r\n---\r\n".length;
  // Navigation remains outside every foldable heading while both helpers share the same source.
  const cachedSource = propertySource.slice(0, bodyStart) + markdownCrlfReadOnlyFixture.sourceAddition + propertySource.slice(bodyStart);
  const entries = [
    ["Read only.md", cachedSource],
    ["Known target.md", "---\r\naliases: [Cached alias]\r\n---\r\n# Existing heading\r\n\r\nCached target λ 😀.\r\n" + (multilinePropertiesReadOnlyFixture.targetAddition ?? "")],
    ...(multilinePropertiesReadOnlyFixture.files ?? []),
    ...(markdownCrlfReadOnlyFixture.files ?? []),
    ...(trashRecoveryReadOnlyFixture.files ?? []),
    [".obsidian/app.json", '{"foldHeading":true,"foldIndent":true,"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"cached multiline and recovery configuration"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer","outline"]'],
    [".obsidian/community-plugins.json", "[]"],
  ];
  assert.equal(new Set(entries.map(([path]) => path)).size, entries.length, "Cache fixture paths are unique");
  const fixture = await mountCachedGitHub(evaluate, "structured-recovery", entries);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-recovery"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cached multiline, metadata and recovery fixture");
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
  const reset = () => evaluate('(()=>{const leaf=app.workspace.getLeafById("readonly-recovery");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false)})()');
  await reset(); await checkMultilinePropertiesReadOnly(tools);
  await reset(); await checkTrashRecoveryReadOnly(tools);
  await reset(); await checkMarkdownCrlfReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.structuredRecovery = { readOnly: { genuineCacheOnly: true, completeIndex: true, zeroNetwork: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("Prepared cache-only multiline Properties and local-trash restoration refuse mutations; corrected CRLF metadata and local Reading folds remain usable with unchanged cached blobs and zero API/raw requests through local-vault return.");
}
