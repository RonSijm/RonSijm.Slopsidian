import assert from "node:assert/strict";
import { checkHierarchicalHeadings, checkHierarchicalHeadingsReadOnly } from "./hierarchical-heading-scenarios.mjs";
import { checkPropertiesCompletion, checkPropertiesCompletionReadOnly } from "./properties-completion-scenarios.mjs";
import { checkReadingSelection, checkReadingSelectionReadOnly } from "./reading-selection-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Bounded note discovery and editing share one current-source host collection. */
export async function checkNoteWorkflows(tools) {
  await checkHierarchicalHeadings(tools);
  await checkPropertiesCompletion(tools);
  await checkReadingSelection(tools);

  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-note-main", type: "split", direction: "vertical", children: [
      { id: "readonly-note-tabs", type: "tabs", children: [
        { id: "readonly-note", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-note",
  };
  const fixture = await mountCachedGitHub(evaluate, "note-workflows", [
    ["Read only.md", '\ufeff---\r\nstatus: Open\r\ntags: [ shared ]\r\nlabels: [ kept ]\r\nopaque: "Retain cached YAML"\r\n---\r\n\r\n# Read only\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\n[[#Cached parent#Ch\r\n\r\n[[#Cached parent#Cached child]]\r\n\r\n# Cached parent\r\n\r\n## Cached child\r\n\r\nCached destination prose.\r\n'],
    ["Completion values.md", '---\r\nstatus: Completed\r\ntags: [ shared, project ]\r\nlabels: [ candidate ]\r\n---\r\n\r\n# Cached values\r\n'],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":false,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"opaque":{"retain":"cached note preferences"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-note"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("alpha alpha")`, "genuine cached read-only note workflows fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkHierarchicalHeadingsReadOnly(tools);
  await checkPropertiesCompletionReadOnly(tools);
  await checkReadingSelectionReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl });
  await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.noteWorkflows = { ...(report.noteWorkflows ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub vault permits hierarchical navigation and captured-passage Reading Find while Properties/completion mutations refuse; API/raw counters remain zero and every cached blob stays exact through return to the writable vault.");
}
