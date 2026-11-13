import assert from "node:assert/strict";
import { checkCursorHandoff, checkCursorHandoffReadOnly } from "./cursor-handoff-scenarios.mjs";
import { checkMultiRangeSearch, checkMultiRangeSearchReadOnly } from "./multi-range-search-scenarios.mjs";
import { checkSpellcheckManagement, checkSpellcheckManagementReadOnly } from "./spellcheck-management-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** One source-bound collection combines navigation, selected-range search and host spelling controls. */
export async function checkEditorWorkflows(tools) {
  await checkCursorHandoff(tools);
  await checkMultiRangeSearch(tools);
  await checkSpellcheckManagement(tools);

  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-workflows-main", type: "split", direction: "vertical", children: [
      { id: "readonly-workflows-tabs", type: "tabs", children: [
        { id: "readonly-workflows", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-workflows",
  };
  const cachedTarget = Array.from({ length: 30 }, (_, index) => `Cached navigation prelude ${index + 1}.`).join("\r\n\r\n")
    + "\r\n\r\n# Cached destination\r\n\r\nTarget prose.\r\n";
  const fixture = await mountCachedGitHub(evaluate, "editor-workflows", [
    ["Read only.md", "\uFEFF# Read only\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\n[[Cursor target#Cached destination]]\r\n"],
    ["Cursor target.md", cachedTarget],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":false,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"opaque":{"retain":"cached editing preference"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-workflows"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("alpha alpha")`, "genuine cached read-only editing fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkCursorHandoffReadOnly(tools);
  await checkMultiRangeSearchReadOnly(tools);
  await checkSpellcheckManagementReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl });
  await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.editorWorkflows = { ...(report.editorWorkflows ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub vault preserves navigation, selected-range search and the host spelling boundary while source mutations refuse; API/raw counters remain zero and every cached blob stays exact through return to the writable vault.");
}
