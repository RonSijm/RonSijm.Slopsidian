import assert from "node:assert/strict";
import { checkReadingListFolding, checkReadingListFoldingReadOnly } from "./reading-list-folding-scenarios.mjs";
import { checkMarkdownPairing, checkMarkdownPairingReadOnly } from "./markdown-pairing-scenarios.mjs";
import { checkReadingTasks, checkReadingTasksReadOnly } from "./reading-task-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Current Reading list/task interactions and configurable source emphasis pairs. */
export async function checkMarkdownInteraction(tools) {
  await checkReadingListFolding(tools);
  await checkMarkdownPairing(tools);
  await checkReadingTasks(tools);
  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-interaction-main", type: "split", direction: "vertical", children: [
      { id: "readonly-interaction-tabs", type: "tabs", children: [
        { id: "readonly-interaction", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-interaction",
  };
  const cachedText = [
    "\ufeff---", "status: Open", "labels: [ kept ]", "tags: [ shared ]", "aliases: [ Existing ]", 'opaque: "Retain cached Markdown interactions"', "---", "",
    "# Read only", "", "## Folded lists", "",
    "- [ ] Parent A", "  - Child A", "    - listneedle cached ^list-block", "  - listneedle sibling", "",
    "1. Parent B", "   1. listneedle independent", "",
    "## Tasks", "", "- [ ] Open task", "- [x] Completed task", "- [X] Upper task", "- [x] Parent task", "  - [ ] Nested task", "",
    "## Pairing", "", "Pair field: ", "", "*Existing emphasis* and _kept_.", "",
    "> - [ ] Quoted task stays read-only.", "", "![[Known target]]", "",
  ].join("\r\n");
  const fixture = await mountCachedGitHub(evaluate, "markdown-interaction", [
    ["Read only.md", cachedText],
    ["Known target.md", "# Existing target\r\n\r\n- [ ] Embedded task stays read-only.\r\n"],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":false,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"foldHeading":true,"foldIndent":true,"autoPairBrackets":true,"smartIndentList":true,"autoPairMarkdown":true,"opaque":{"retain":"cached interaction preferences"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-interaction"&&app.workspace.getActiveFile()?.path==="Read only.md"`, "genuine cached read-only Markdown interaction fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkReadingListFoldingReadOnly(tools);
  await checkReadingTasksReadOnly(tools);
  await checkMarkdownPairingReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.markdownInteraction = { readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cache-only GitHub vault permits Reading list folds and local Markdown pairing preferences while task edits, typing and direct writes refuse; API/raw counters remain zero and every cached note/configuration blob stays exact through local-vault return.");
}
