import assert from "node:assert/strict";
import { checkSubpathSuggestions, checkSubpathSuggestionsReadOnly } from "./subpath-suggestion-scenarios.mjs";
import { checkSpellcheck, checkSpellcheckReadOnly } from "./spellcheck-scenarios.mjs";
import { checkPrintExport, checkPrintExportReadOnly } from "./print-export-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** One frozen collection combines the three new note-authoring workflows. */
export async function checkNoteAuthoring(tools) {
  await checkSubpathSuggestions(tools);
  await checkSpellcheck(tools);
  await checkPrintExport(tools);
  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-authoring-main", type: "split", direction: "vertical", children: [
      { id: "readonly-authoring-tabs", type: "tabs", children: [
        { id: "readonly-authoring", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-authoring",
  };
  const fixture = await mountCachedGitHub(evaluate, "note-authoring", [
    ["Read only.md", "# Cached heading\n\nA cached paragraph. ^cached-block\n\n[[#Cached\n\n[[#^cached\n\n[[Completion\n"],
    ["Completion target.md", "# Target heading\n\nTarget paragraph. ^target-block\n"],
    [".obsidian/app.json", '{"spellcheck":true,"opaque":{"retain":"cached preference"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-authoring"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("Cached heading")`, "genuine cached read-only authoring note");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkSubpathSuggestionsReadOnly(tools);
  await checkSpellcheckReadOnly(tools);
  await checkPrintExportReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl });
  await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.noteAuthoring = { ...(report.noteAuthoring ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub vault permits local spelling preferences and export preview while refusing completion/source mutations; API/raw counters remain zero and every cached blob stays exact through return to the writable vault.");
}
