import assert from "node:assert/strict";
import { checkReadingFolding, checkReadingFoldingReadOnly } from "./reading-folding-scenarios.mjs";
import { checkTypingControls, checkTypingControlsReadOnly } from "./typing-control-scenarios.mjs";
import { checkFuzzyCompletion, checkFuzzyCompletionReadOnly } from "./fuzzy-completion-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Current-view Reading folds, configurable typing and existing-target fuzzy suggestions. */
export async function checkEditorAssistance(tools) {
  await checkReadingFolding(tools);
  await checkTypingControls(tools);
  await checkFuzzyCompletion(tools);
  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-assistance-main", type: "split", direction: "vertical", children: [
      { id: "readonly-assistance-tabs", type: "tabs", children: [
        { id: "readonly-assistance", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-assistance",
  };
  const cachedText = [
    "\ufeff---", "status: Open", 'related: ""', "links: [ kept ]", "labels: [ kept ]", "tags: [ shared ]", "aliases: [ Existing ]", 'opaque: "Retain cached editor assistance"', "---", "",
    "# Read only", "", "## Parent A", "", "alpha alpha", "", "### Child A", "", "alpha alpha", "",
    "Known cached paragraph ^cached-block", "", "- Parent", "  - Child", "    - Grandchild", "", "> Quoted paragraph.", "", "Inline math $a^2$.", "",
    "```go", "package main", 'func note() string { return "readonly λ" }', "```", "",
    "```toml", "[owner]", 'name = "readonly λ"', "count = 42 # kept", "```", "",
    "```xml", '<root name="readonly λ"><note>kept</note></root><!-- kept -->', "```", "",
    "## Parent B", "", "alpha alpha", "", "[[PrjNt", "",
  ].join("\r\n");
  const fixture = await mountCachedGitHub(evaluate, "editor-assistance", [
    ["Read only.md", cachedText],
    ["Known target.md", '---\r\naliases: [ "Cached alias" ]\r\n---\r\n\r\n# Existing heading\r\n\r\nKnown cached paragraph ^cached-block\r\n'],
    ["Project Notes.md", '---\r\naliases: [ "Planning journal" ]\r\n---\r\n\r\n# Design overview\r\n\r\nRelease paragraph ^release-id\r\n'],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":false,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"foldHeading":true,"foldIndent":true,"autoPairBrackets":true,"smartIndentList":true,"opaque":{"retain":"cached assistance preferences"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-assistance"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("alpha alpha")`, "genuine cached read-only editor assistance fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkReadingFoldingReadOnly(tools);
  await checkTypingControlsReadOnly(tools);
  await checkFuzzyCompletionReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.editorAssistance = { ...(report.editorAssistance ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cache-only GitHub vault permits nonmutating Reading heading folds and local typing preferences while typing/completion writes refuse; API/raw counters stay zero and every cached note/configuration blob remains exact through local-vault return.");
}
