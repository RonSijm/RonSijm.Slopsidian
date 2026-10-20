import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkBasesNoteCreation, checkBasesNoteCreationReadOnly, basesNoteCreationReadOnlyFixture } from "./bases-note-creation-scenarios.mjs";
import { checkNestedPropertyReorder, checkNestedPropertyReorderReadOnly, nestedPropertyReorderReadOnlyFixture } from "./nested-property-reorder-scenarios.mjs";
import { checkCanvasNavigation, checkCanvasNavigationReadOnly, canvasNavigationReadOnlyFixture } from "./canvas-navigation-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

/** Real host controls, mutations and restarts run serially against one source generation. */
export async function checkNavigationCreation(hostTools) {
  const report = hostTools.report, noticeWaits = report.navigationCreationNoticeWaits = [];
  const tools = { ...hostTools, click: async (selector, modifiers = 0) => {
    const covered = `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.scrollIntoView({block:"nearest",inline:"nearest"});const rect=Array.from(node.getClientRects()).find(r=>r.width>0&&r.height>0);if(!rect)return false;const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return Boolean(hit?.closest(".notice")&&!node.contains(hit))})()`;
    if (await hostTools.evaluate(covered)) {
      const entry = { selector, startedAt: new Date().toISOString() }; noticeWaits.push(entry);
      await hostTools.wait(`!(${covered})`, "the transient notice no longer covers the actual control");
      entry.completedAt = new Date().toISOString();
    }
    await hostTools.click(selector, modifiers);
  } };
  const { evaluate, wait, command, click, afterReload } = tools;
  await evaluate("app.workspace.whenIdle()");
  assert.equal(await evaluate("app.workspace.hasUnsavedChanges"), false, "New fixture setup must not save an existing draft");
  const parentPath = tools.host === "desktop" ? "CRLF note.md" : "Navigation creation parent.md";
  if (tools.host === "web") {
    await writeFile(join(tools.directory, parentPath), "\ufeff# Navigation and creation parent\r\n\r\nKeep the saved parent Ω.\r\n", { flag: "wx" });
    await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  }
  await evaluate('(async()=>{const file=app.vault.getFileByPath(' + JSON.stringify(parentPath) + ');if(!file)throw Error("The saved parent fixture is missing");await app.workspace.activeLeaf.openFile(file);app.workspace.activeLeaf.view.setEditingMode("source",false);await app.workspace.whenIdle();await app.notifyEditor();await app.core.whenIdle()})()');
  await wait('app.workspace.activeLeaf.view.file?.path===' + JSON.stringify(parentPath) + '&&app.workspace.activeLeaf.view.getEditingMode()==="source"&&app.workspace.activeLeaf.view.sourceEl.checkVisibility()&&!app.workspace.hasUnsavedChanges', "the saved parent is visible in normal Source");
  report.navigationCreationParentSetup = await evaluate('(()=>{const v=app.workspace.activeLeaf.view;return{path:v.file.path,leafId:v.leaf.id,mode:v.getEditingMode(),text:v.session.text,version:v.savedDocument.version,bom:v.savedDocument.hasBom===true,dirty:v.session.dirty}})()');
  for (const check of [checkBasesNoteCreation, checkNestedPropertyReorder, checkCanvasNavigation]) await check(tools);

  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  await evaluate("(async()=>{await app.workspace.whenIdle();await app.workspace.flushLayout();await app.core.whenIdle()})()");
  assert.equal(await evaluate("app.workspace.hasUnsavedChanges"), false, "Each feature cleans only its own fixtures before the cached-vault boundary");
  const fixtures = [];
  for (const exported of [nestedPropertyReorderReadOnlyFixture, basesNoteCreationReadOnlyFixture, canvasNavigationReadOnlyFixture]) {
    const fixture = typeof exported === "function" ? await exported(report) : exported;
    assert.ok(fixture && Array.isArray(fixture.files)); fixtures.push(fixture);
  }
  assert.equal(typeof fixtures[0].source, "string");
  const fragments = [fixtures[0].source, ...fixtures.slice(1).map(fixture => fixture.sourceAddition ?? "")];
  for (const fragment of fragments) assert.equal(fragment.replaceAll("\r\n", "").includes("\n"), false, "Cached fixture fragments retain their declared CRLF separator");
  const files = new Map([["Read only.md", fragments.join("")]]);
  for (const fixture of fixtures) for (const [path, content] of fixture.files) {
    assert.equal(files.has(path), false, "Unique cached fixture path: " + path); files.set(path, content);
  }
  const workspace = { version: 1, main: { id: "readonly-navigation-creation-main", type: "split", direction: "vertical", children: [{ id: "readonly-navigation-creation-tabs", type: "tabs", currentTab: 0, children: [{ id: "readonly-navigation-creation", type: "leaf", state: { type: "markdown", state: { file: "Read only.md", mode: "source", source: true } } }] }] }, active: "readonly-navigation-creation" };
  for (const [path, content] of [
    [".obsidian/app.json", '{"newFileLocation":"root","newLinkFormat":"shortest","useMarkdownLinks":false,"opaque":{"retain":"Navigation and creation"}}'],
    [".obsidian/workspace.json", JSON.stringify(workspace)],
    [".obsidian/core-plugins.json", '["command-palette","file-explorer","bases","properties","canvas"]'],
    [".obsidian/community-plugins.json", "[]"],
  ]) { assert.equal(files.has(path), false); files.set(path, content); }
  const fixture = await mountCachedGitHub(evaluate, "navigation-creation", [...files]);
  await wait('app.vault.rootPath===' + JSON.stringify(fixture.mount.id) + '&&!app.changingVault&&app.workspace.activeLeaf.id==="readonly-navigation-creation"', "genuine cached navigation and creation vault");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  await click("#github-vault-offline");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="none"', "fresh cached index state");
  await click("[data-github-offline-dialog] [data-github-index-prepare]");
  await wait('document.querySelector("[data-github-index-state]")?.dataset.githubIndexState==="complete"', "complete genuine cached index");
  for (const type of ["rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("[data-github-offline-dialog]")', "the cached index dialog closes");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate("app.vault.indexComplete"), true);
  assert.equal(await evaluate("app.metadataCache.getDocuments().length"), [...files.keys()].filter(path => /\.md$/i.test(path)).length);
  await evaluate('(()=>{const leaf=app.workspace.getLeafById("readonly-navigation-creation"),view=leaf.view,editor=view.editor,cm=editor.cm,session=app.workspace.sessions.get("Read only.md");globalThis.navigationCreationCachedOwner={leaf,view,editor,cm,doc:cm.state.doc,session,saved:session.document,text:session.text,dirty:session.dirty,root:app.vault.rootPath,file:view.file}})()');
  const checks = report.navigationCreationCachedOwnerChecks = [];
  for (const [name, check] of [["basesNoteCreationReadOnly", checkBasesNoteCreationReadOnly], ["nestedPropertyReorderReadOnly", checkNestedPropertyReorderReadOnly], ["canvasNavigationReadOnly", checkCanvasNavigationReadOnly]]) {
    await evaluate('(async()=>{const leaf=app.workspace.getLeafById("readonly-navigation-creation");app.workspace.setActiveLeaf(leaf);leaf.view.setEditingMode("source",false);await app.core.whenIdle()})()');
    await check(tools);
    const observed = await evaluate('(()=>{const o=navigationCreationCachedOwner,leaf=app.workspace.getLeafById("readonly-navigation-creation");return{sameLeaf:leaf===o.leaf,sameView:leaf?.view===o.view,sameEditor:leaf?.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:app.workspace.sessions.get("Read only.md")===o.session,sameSavedDocument:o.session.document===o.saved,sourceExact:o.session.text===o.text,dirtyExact:o.session.dirty===o.dirty,sameRoot:app.vault.rootPath===o.root,sameFile:o.view.file===o.file&&app.vault.getFileByPath("Read only.md")===o.file}})()');
    checks.push({ name, observed }); for (const [key, value] of Object.entries(observed)) assert.equal(value, true, name + " preserves the original cached owner: " + key);
  }
  const network = await evaluate("(()=>{const{api,raw}=app.githubVaults.state().counters;return{api,raw}})()");
  assert.deepEqual(network, { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await tools.capture?.("readonly-combined");
  await evaluate("delete globalThis.navigationCreationCachedOwner");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.navigationCreation = { readOnly: { genuineCachedMount: true, completeIndex: true, zeroApiRaw: true, exactBlobsBeforeAndAfterLocalReturn: true }, cachedNetwork: network };
  report.checks.push("A genuine complete cached vault permits Canvas Jump navigation while Bases note creation and nested reordering refuse; original Source owners and cached bytes remain exact through local return.");
}
