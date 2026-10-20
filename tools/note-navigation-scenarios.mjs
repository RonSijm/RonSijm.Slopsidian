import assert from "node:assert/strict";
import { checkFoldingControls, checkFoldingControlsReadOnly } from "./folding-control-scenarios.mjs";
import { checkPropertiesSubpaths, checkPropertiesSubpathsReadOnly } from "./properties-subpath-scenarios.mjs";
import { checkFileSelection, checkFileSelectionReadOnly } from "./file-selection-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Main-window folding, existing property destinations and selected-note browsing. */
export async function checkNoteNavigation(tools) {
  await checkFoldingControls(tools);
  await checkPropertiesSubpaths(tools);
  await checkFileSelection(tools);
  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-navigation-main", type: "split", direction: "vertical", children: [
      { id: "readonly-navigation-tabs", type: "tabs", children: [
        { id: "readonly-navigation", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-navigation",
  };
  const cachedText = [
    "\ufeff---", "status: Open", 'related: ""', "links: [ kept ]", "labels: [ kept ]", "tags: [ shared ]", "aliases: [ Existing ]", 'opaque: "Retain cached note navigation"', "---", "",
    "# Read only", "", "alpha alpha", "", "alpha alpha", "", "alpha alpha", "",
    "## Folded heading", "", "Heading body.", "", "### Nested heading", "", "Nested body.", "",
    "- Parent", "  - Child", "    - Grandchild", "", "Known cached paragraph ^cached-block", "",
    "```go", "package main", 'func note() string { return "readonly λ" }', "```", "",
    "```toml", "[owner]", 'name = "readonly λ"', "count = 42 # kept", "```", "",
    "```xml", '<root name="readonly λ"><note>kept</note></root><!-- kept -->', "```", "",
  ].join("\r\n");
  const fixture = await mountCachedGitHub(evaluate, "note-navigation", [
    ["Read only.md", cachedText],
    ["Known target.md", '---\r\naliases: [ "Cached alias" ]\r\n---\r\n\r\n# Existing heading\r\n\r\nKnown cached paragraph ^cached-block\r\n'],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":false,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"foldHeading":true,"foldIndent":true,"opaque":{"retain":"cached navigation preferences"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties","file-explorer"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-navigation"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("alpha alpha")`, "genuine cached read-only note navigation fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkFoldingControlsReadOnly(tools);
  await checkPropertiesSubpathsReadOnly(tools);
  await checkFileSelectionReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.noteNavigation = { ...(report.noteNavigation ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub vault permits nonmutating folding and selected-note browsing while Properties subpath mutations refuse; API/raw counters stay zero and every cached source/configuration blob stays exact through return to the writable vault.");
}
