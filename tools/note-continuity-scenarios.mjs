import assert from "node:assert/strict";
import { checkEditorFoldState, checkEditorFoldStateReadOnly } from "./editor-fold-state-scenarios.mjs";
import { checkReadingFoldState, checkReadingFoldStateReadOnly } from "./reading-fold-state-scenarios.mjs";
import { checkNoteCreationSuggestions, checkNoteCreationSuggestionsReadOnly } from "./note-creation-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Remember local fold preferences and explicitly create missing linked notes. */
export async function checkNoteContinuity(tools) {
  await checkEditorFoldState(tools);
  await checkReadingFoldState(tools);
  await checkNoteCreationSuggestions(tools);
  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = { main: { id: "readonly-continuity-main", type: "split", direction: "vertical", children: [
    { id: "readonly-continuity-tabs", type: "tabs", children: [
      { id: "readonly-continuity", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
    ] },
  ] }, active: "readonly-continuity" };
  const cachedText = ["\ufeff---", "status: Open", 'opaque: "Retain cached fold preferences"', "---", "", "# Read only", "", "## Folded lists", "",
    "- [ ] Parent A", "  - Child A", "    - foldneedle cached ^list-block", "  - foldneedle sibling", "",
    "1. Parent B", "   1. foldneedle independent", "", "## Other heading", "", "Body λ 😀.", "",
    "```md", "# Literal code", "- Literal list", "retained", "```", "", "Create field: [[Cached missing creation", "", "![[Known target]]", "",
  ].join("\r\n");
  const fixture = await mountCachedGitHub(evaluate, "note-continuity", [
    ["Read only.md", cachedText], ["Known target.md", "# Existing target\r\n\r\nOriginal cached content.\r\n"],
    [".obsidian/app.json", '{"spellcheck":true,"foldHeading":true,"foldIndent":true,"autoPairBrackets":true,"smartIndentList":true,"autoPairMarkdown":true,"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"cached continuity preferences"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)], [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer"]'], [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-continuity"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cached read-only note continuity fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkEditorFoldStateReadOnly(tools);
  await checkReadingFoldStateReadOnly(tools);
  await checkNoteCreationSuggestionsReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.noteContinuity = { readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cache-only GitHub vault persists local Source and Reading fold preferences while explicit note creation and typing refuse; API/raw counters remain zero and all cached source/configuration blobs stay exact through local-vault return.");
}
