import assert from "node:assert/strict";
import { checkExpandedHighlighting, checkExpandedHighlightingReadOnly } from "./expanded-highlighting-scenarios.mjs";
import { checkGlobalHeadings, checkGlobalHeadingsReadOnly } from "./global-heading-scenarios.mjs";
import { checkReadingSearch, checkReadingSearchReadOnly } from "./reading-search-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** One source-bound collection combines local rendering, discovery and Reading search. */
export async function checkReadingDiscovery(tools) {
  await checkExpandedHighlighting(tools);
  await checkGlobalHeadings(tools);
  await checkReadingSearch(tools);

  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-reading-main", type: "split", direction: "vertical", children: [
      { id: "readonly-reading-tabs", type: "tabs", children: [
        { id: "readonly-reading", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-reading",
  };
  const fixture = await mountCachedGitHub(evaluate, "reading-discovery", [
    ["Read only.md", "\uFEFF# Read only\r\n\r\n[[##Cached\r\n\r\nNeedle needle\r\n\r\n```csharp\r\npublic class Cached { string Value = \"readonly λ\"; }\r\n```\r\n\r\n```python\r\ndef cached():\r\n    return \"readonly λ\"\r\n```\r\n"],
    ["Global target.md", "# Cached global heading\r\n\r\nTarget prose.\r\n"],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":false,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"opaque":{"retain":"cached reading preference"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-reading"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("Needle needle")`, "genuine cached read-only Reading fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkGlobalHeadingsReadOnly(tools);
  await checkExpandedHighlightingReadOnly(tools);
  await checkReadingSearchReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl });
  await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.readingDiscovery = { ...(report.readingDiscovery ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub vault renders and searches local Reading content while refusing global-heading source mutations; API/raw counters stay zero and every cached blob stays exact through return to the writable vault.");
}
