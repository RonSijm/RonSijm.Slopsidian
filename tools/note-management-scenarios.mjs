import assert from "node:assert/strict";
import { checkHeadingChains, checkHeadingChainsReadOnly, headingChainsReadOnlyFixture } from "./heading-chain-scenarios.mjs";
import { checkExtendedBlocks, checkExtendedBlocksReadOnly, extendedBlocksReadOnlyFixture } from "./block-extended-scenarios.mjs";
import { checkExplorerRename, checkExplorerRenameReadOnly } from "./explorer-rename-scenarios.mjs";
import { checkExplorerTrash, checkExplorerTrashReadOnly } from "./explorer-trash-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

export async function checkNoteManagement(tools) {
  await checkHeadingChains(tools);
  await checkExtendedBlocks(tools);
  await checkExplorerRename(tools);
  await checkExplorerTrash(tools);
  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = { main: { id: "readonly-authoring-main", type: "split", direction: "vertical", children: [
    { id: "readonly-authoring-tabs", type: "tabs", children: [{ id: "readonly-authoring", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-authoring" };
  const text = ["\ufeff---", "related: \"\"", "links: [kept]", "status: Open", 'opaque: "Retain cached authoring source"', "---", "", "# Read only", "",
    "[[Known target#Future cached heading", "", "Block field: [[Known target#^Cached paragraph", "", ...headingChainsReadOnlyFixture.sourcePrefixes, ...extendedBlocksReadOnlyFixture.sourcePrefixes, "", "Original cached source λ 😀.", ""].join("\r\n");
  const fixture = await mountCachedGitHub(evaluate, "note-management", [
    ["Read only.md", text], ["Known target.md", '---\r\naliases: [Cached alias]\r\n---\r\n\r\n# Existing heading\r\n\r\nCached paragraph λ 😀.\r\n' + extendedBlocksReadOnlyFixture.targetAddition],
    [".obsidian/app.json", '{"spellcheck":true,"foldHeading":true,"foldIndent":true,"autoPairBrackets":true,"smartIndentList":true,"autoPairMarkdown":true,"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"cached authoring configuration"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)], [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer"]'], [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-authoring"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cache-only link authoring fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  // Cached GitHub mounts deliberately open lazily. Prepare the genuine local
  // index through its UI before proving the known target is eligible.
  await tools.click("#github-vault-offline");
  await wait('Boolean(document.querySelector("[data-github-offline-dialog] [data-github-index-prepare]"))', "cache-only index controls");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "initial cache-only index status loaded");
  await tools.click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "both cached Markdown notes are verified and indexed");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "cache-only index controls closed");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), 2);
  await wait('Boolean(app.metadataCache.getDocument("Known target.md"))&&!app.metadataCache.getDocument("Known target.md").missing', "the real cached target is indexed before authoring refusals");
  await checkHeadingChainsReadOnly(tools);
  await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)');
  await checkExtendedBlocksReadOnly(tools);
  await checkExplorerRenameReadOnly(tools);
  await checkExplorerTrashReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs); await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.noteManagement = { readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("Genuine cache-only heading chains, extended block IDs, selected-note rename and vault trash refuse mutations; all cached bytes and zero API/raw counters remain exact through local-vault return.");
}
