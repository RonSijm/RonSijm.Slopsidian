import assert from "node:assert/strict";
import { checkCodeHighlighting } from "./code-highlighting-scenarios.mjs";
import { checkEditorSearch, checkEditorSearchReadOnly } from "./editor-search-scenarios.mjs";
import { checkBuiltinSuggestions, checkBuiltinSuggestionsReadOnly } from "./builtin-suggestion-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

// One source-frozen host collection exercises the new features together.
// Each scenario owns disposable fixture notes and restores its application state.
export async function checkEditorImprovements(tools) {
  await checkCodeHighlighting(tools);
  await checkEditorSearch(tools);
  await checkBuiltinSuggestions(tools);

  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-editor-main", type: "split", direction: "vertical", children: [
      { id: "readonly-editor-tabs", type: "tabs", children: [
        { id: "readonly-editor", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-editor",
  };
  const fixture = await mountCachedGitHub(evaluate, "editor-improvements", [
    ["Read only.md", "# Read only\n\nalpha alpha\n\n[[Completion\n"],
    ["Completion target.md", "---\nproject: Cached\n---\n# Completion target\n"],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-editor"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("alpha alpha")`, "real cached read-only editor");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkEditorSearchReadOnly(tools);
  await checkBuiltinSuggestionsReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl });
  await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.editorImprovements = { ...(report.editorImprovements ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub note remains searchable while replacements and built-in completion mutations refuse; API/raw counters stay zero and cached blobs remain exact through return to the writable vault.");
}
