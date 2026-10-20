import assert from "node:assert/strict";
import { checkEditorPreferences, checkEditorPreferencesReadOnly } from "./editor-preference-scenarios.mjs";
import { checkPropertyValues, checkPropertyValuesReadOnly } from "./property-value-scenarios.mjs";
import { checkSelectionSearch, checkSelectionSearchReadOnly } from "./selection-search-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** One source-bound collection exercises settings, completion and scoped search. */
export async function checkEditorProductivity(tools) {
  await checkEditorPreferences(tools);
  await checkPropertyValues(tools);
  await checkSelectionSearch(tools);

  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-productivity-main", type: "split", direction: "vertical", children: [
      { id: "readonly-productivity-tabs", type: "tabs", children: [
        { id: "readonly-productivity", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-productivity",
  };
  const fixture = await mountCachedGitHub(evaluate, "editor-productivity", [
    ["Read only.md", "\uFEFF---\r\nstatus: Op\r\ntags:\r\n  - pro\r\n---\r\n# Read only\r\n\r\nalpha alpha\r\n"],
    ["Value source.md", "---\r\nstatus: Open\r\ntags: [project, shared]\r\n---\r\n"],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":true,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"opaque":{"retain":"cached preference"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-productivity"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("alpha alpha")`, "genuine cached read-only productivity note");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkEditorPreferencesReadOnly(tools);
  await checkPropertyValuesReadOnly(tools);
  await checkSelectionSearchReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl });
  await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.editorProductivity = { ...(report.editorProductivity ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub vault retains local Editor preferences and selection search while refusing source/property completion changes; API/raw counters stay zero and cached blobs remain exact through return to the writable vault.");
}
