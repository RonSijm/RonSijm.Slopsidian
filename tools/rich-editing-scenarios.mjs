import assert from "node:assert/strict";
import { checkStructuredProperties, checkStructuredPropertiesReadOnly, structuredPropertiesReadOnlyFixture } from "./structured-properties-scenarios.mjs";
import { checkMultilineInlineFootnotes, checkMultilineInlineFootnotesReadOnly, multilineInlineFootnoteReadOnlyFixture } from "./multiline-inline-footnote-scenarios.mjs";
import { checkRecoveryDiffs, checkRecoveryDiffsReadOnly, recoveryDiffReadOnlyFixture } from "./recovery-diff-scenarios.mjs";
import { checkBulkSystemTrash, checkBulkSystemTrashReadOnly } from "./bulk-system-trash-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** One owned host collection; the parent runner binds full source/artifacts and final error/shutdown audits. */
export async function checkRichEditing(tools) {
  const hostTools = tools, noticeWaits = tools.report.richEditingNoticeWaits = [];
  tools = { ...tools, click: async (selector, modifiers = 0) => {
    // The unchanged sample plugin in the browser fixture emits a five-second
    // notice on every click. Keep normal hit-testing: wait for a covering notice
    // to expire rather than deleting it or clicking through an obstruction.
    const covered = `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.scrollIntoView({block:"center",inline:"nearest"});const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(hit?.closest(".notice")&&!node.contains(hit))})()`;
    if (await hostTools.evaluate(covered)) {
      noticeWaits.push({ selector, startedAt: new Date().toISOString() });
      await hostTools.wait(`!(${covered})`, "the actual transient notice stops covering the control");
      noticeWaits.at(-1).completedAt = new Date().toISOString();
    }
    await hostTools.click(selector, modifiers);
  } };
  await checkStructuredProperties(tools);
  await checkMultilineInlineFootnotes(tools);
  await checkRecoveryDiffs(tools);
  await checkBulkSystemTrash(tools);
  const { evaluate, wait, command, click, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()");
  assert.equal(typeof structuredPropertiesReadOnlyFixture.source, "string");
  const source = structuredPropertiesReadOnlyFixture.source
    + (multilineInlineFootnoteReadOnlyFixture.sourceAddition ?? "")
    + (recoveryDiffReadOnlyFixture.sourceAddition ?? "");
  const workspace = { main: { id: "readonly-rich-main", type: "split", direction: "vertical", children: [
    { id: "readonly-rich-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-rich", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] },
  ] }, active: "readonly-rich" };
  const files = new Map([["Read only.md", source]]);
  for (const fixture of [structuredPropertiesReadOnlyFixture, multilineInlineFootnoteReadOnlyFixture, recoveryDiffReadOnlyFixture]) {
    for (const [path, content] of fixture.files ?? []) { assert.equal(files.has(path), false, "Each readonly fixture path is unique"); files.set(path, content); }
  }
  if (!files.has("Known target.md")) files.set("Known target.md", "---\r\naliases: [Cached alias]\r\n---\r\n# Existing heading\r\n\r\nRetain cached target λ 😀.\r\n");
  for (const [path, content] of [
    [".obsidian/app.json", '{"foldHeading":true,"foldIndent":true,"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"rich editing cache"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties","footnotes","file-explorer","file-recovery"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]) { assert.equal(files.has(path), false); files.set(path, content); }
  const fixture = await mountCachedGitHub(evaluate, "rich-editing", [...files]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-rich"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cached rich-editing mount");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click("#github-vault-offline");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "initial cache index state");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "complete genuine cached Markdown index");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "cache index dialog closes");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), [...files.keys()].filter(path => /\.md$/i.test(path)).length);
  const reset = () => evaluate('(async()=>{const leaf=app.workspace.getLeafById("readonly-rich");app.workspace.setActiveLeaf(leaf);leaf.view.setMode("source");leaf.view.setEditingMode("source",false);await app.core.whenIdle()})()');
  await reset(); await checkStructuredPropertiesReadOnly(tools);
  await reset(); await checkMultilineInlineFootnotesReadOnly(tools);
  await reset(); await checkRecoveryDiffsReadOnly(tools);
  await reset(); await checkBulkSystemTrashReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.richEditing = { readOnly: { genuineCachedMount: true, completeIndex: true, zeroApiRaw: true, exactBlobsBeforeAndAfterLocalReturn: true } };
  report.checks.push("The combined prepared cache-only note permits inspection and multiline footnote navigation while nested edits, recovery comparison/restore and bulk removal refuse. Cached blobs remain exact and API/raw traffic stays zero through returning to the local vault.");
}
