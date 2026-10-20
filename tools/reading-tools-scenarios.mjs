import assert from "node:assert/strict";
import { checkReadingRegex, checkReadingRegexReadOnly } from "./reading-regex-scenarios.mjs";
import { checkLanguageHighlighting, checkLanguageHighlightingReadOnly } from "./language-highlighting-scenarios.mjs";
import { checkPropertiesLinks, checkPropertiesLinksReadOnly } from "./properties-link-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Shared host acceptance of bounded Reading search/grammars and Properties wiki links. */
export async function checkReadingTools(tools) {
  await checkReadingRegex(tools);
  await checkLanguageHighlighting(tools);
  await checkPropertiesLinks(tools);
  const { evaluate, wait, command, afterReload, report } = tools;
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  const workspace = {
    main: { id: "readonly-tools-main", type: "split", direction: "vertical", children: [
      { id: "readonly-tools-tabs", type: "tabs", children: [
        { id: "readonly-tools", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } },
      ] },
    ] }, active: "readonly-tools",
  };
  const fixture = await mountCachedGitHub(evaluate, "reading-tools", [
    ["Read only.md", '\ufeff---\r\nstatus: Open\r\nrelated: ""\r\nlinks: [ kept ]\r\nlabels: [ kept ]\r\ntags: [ shared ]\r\naliases: [ Existing ]\r\nopaque: "Retain cached reading tools"\r\n---\r\n\r\n# Read only\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\nalpha alpha\r\n\r\n```go\r\npackage main\r\nfunc note() string { return "readonly λ" }\r\n```\r\n\r\n```toml\r\n[owner]\r\nname = "readonly λ"\r\ncount = 42 # kept\r\n```\r\n\r\n```xml\r\n<root name="readonly λ"><note>kept</note></root><!-- kept -->\r\n```\r\n'],
    ["Known target.md", '---\r\naliases: [ "Cached alias" ]\r\n---\r\n\r\n# Cached destination\r\n\r\nTarget prose.\r\n'],
    [".obsidian/app.json", '{"spellcheck":true,"showLineNumber":false,"lineWrap":true,"readableLineLength":true,"tabSize":4,"useTab":false,"opaque":{"retain":"cached tool preferences"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","properties"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-tools"&&app.workspace.activeEditor?.file?.path==="Read only.md"&&app.workspace.activeEditor.editor.getValue().includes("alpha alpha")`, "genuine cached read-only Reading tools fixture");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await checkReadingRegexReadOnly(tools);
  await checkLanguageHighlightingReadOnly(tools);
  await checkPropertiesLinksReadOnly(tools);
  assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return {api,raw}})()"), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.readingTools = { ...(report.readingTools ?? {}), readOnly: { genuineCacheOnly: true, zeroNetwork: true, blobsUnchangedBeforeAndAfterReturn: true } };
  report.checks.push("A genuine cached GitHub vault permits bounded Reading regex, captured-passage search and local code highlighting while Properties wiki-link mutations refuse; API/raw counters remain zero and every cached blob stays exact through return to the writable vault.");
}
