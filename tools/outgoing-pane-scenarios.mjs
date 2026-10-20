import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pixel } from "./reading-scenarios.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";

const note = (id, file) => ({ id, type: "leaf", state: { type: "markdown", state: { file, mode: "source", source: true } } });
const probeCode = `const {Plugin,ItemView}=require("obsidian");module.exports=class extends Plugin{onload(){this.addCommand({id:"set-note",name:"Set an Outgoing pane note",callback:()=>{const v=this.app.workspace.getLeafById("outgoing-b").view;v.setFile(this.app.vault.getFileByPath("Outgoing panes/Renamed.md"));globalThis.outgoingPaneProbe={sameApp:v.app===this.app,isItemView:v instanceof ItemView,sameFile:v.file===this.app.vault.getFileByPath("Outgoing panes/Renamed.md"),factory:typeof this.app.internalPlugins.getPluginById("outgoing-link").views["outgoing-link"]==="function"};}});}};`;

export async function checkOutgoingPanes({ directory, evaluate, command, click, press, wait, report, restart, afterReload, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const prefix = "Outgoing panes", alpha = prefix + "/Alpha.md", beta = prefix + "/Beta.md", target = prefix + "/Target.md", moved = prefix + "/Moved.md", renamed = prefix + "/Renamed.md", image = prefix + "/Image.png", board = prefix + "/Board.canvas";
  const targetText = "---\r\naliases: [Seed]\r\n---\r\n# Target\r\n\r\n## Section\r\n\r\nBlock text. ^block\r\n";
  const alphaText = '---\r\nrelated: "[[Target#Section]]"\r\n---\r\n# Alpha\r\n\r\n[[Target#Section|Shown]]\r\n[Heading](Target.md#Section)\r\n[[Target#^block]]\r\n[[Pane missing note]]\r\n[[../../Outside]]\r\n[[Unsupported.bin]]\r\n[[Image.png]]\r\n[[Board.canvas]]\r\n\r\nA Seed alias and <img src=x> here.\r\n';
  const betaText = "# Beta\n\n[[Target]]\n", originalPath = join(directory, ".obsidian", "workspace.json"), savedPath = join(directory, ".obsidian", "vault-dotnet-workspace.json");
  const moduleBytes = Buffer.from('\ufeff{\r\n "futureSetting": [true,42]\r\n}\r\n'), alphaBytes = Buffer.from("\ufeff" + alphaText), imageBytes = pixel(400, 200), boardBytes = Buffer.from('{"nodes":[],"edges":[],"future":{"keep":true}}\r\n');
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()"); await mkdir(join(directory, prefix));
  for (const [path, content] of [[alpha, alphaBytes], [beta, betaText], [target, targetText], [image, imageBytes], [board, boardBytes], [prefix + "/Unsupported.bin", Buffer.from([0, 255, 129])]]) { await writeFile(join(directory, path), content); }
  const probe = join(directory, ".obsidian", "plugins", "outgoing-pane-probe"); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, "manifest.json"), JSON.stringify({ id: "outgoing-pane-probe", name: "Outgoing pane probe", version: "1.0.0", minAppVersion: "1.0.0", author: "Slopsidian smoke", description: "Disposable real Outgoing ItemView/file/factory probe.", isDesktopOnly: false })); await writeFile(join(probe, "main.js"), probeCode);
  const outgoing = (id, state = {}) => ({ id, type: "leaf", pinned: true, state: { type: "outgoing-link", state: { file: alpha, linksCollapsed: false, unlinkedCollapsed: true, opaque: { keep: id }, ...state } } });
  const original = {
    main: { id: "outgoing-main", type: "split", direction: "vertical", children: [
      { id: "outgoing-tabs", type: "tabs", dimension: 40, children: [outgoing("outgoing-a"), outgoing("outgoing-b", { file: beta, followActiveFile: false, linksCollapsed: true })] },
      { id: "outgoing-note-tabs", type: "tabs", dimension: 60, children: [note("outgoing-alpha", alpha), note("outgoing-target", target), note("outgoing-beta", beta)] },
    ] }, active: "outgoing-alpha",
    left: { id: "outgoing-left", type: "split", direction: "horizontal", width: 220, collapsed: true, children: [] },
    right: { id: "outgoing-right", type: "split", direction: "horizontal", width: 330, children: [{ id: "outgoing-side-tabs", type: "tabs", children: [outgoing("outgoing-side", { followActiveFile: false, unlinkedCollapsed: false })] }] },
  };
  const sourceBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await restart(async () => {
    const path = join(directory, ".obsidian", "core-plugins.json"), config = JSON.parse((await readFile(path, "utf8").catch(error => { if (error.code !== "ENOENT") { throw error; } return "{}"; })).replace(/^\ufeff/, ""));
    if (Array.isArray(config)) { for (const id of ["outgoing-link", "canvas", "command-palette"]) { if (!config.includes(id)) { config.push(id); } } } else { Object.assign(config, { "outgoing-link": true, canvas: true, "command-palette": true }); }
    await writeFile(path, JSON.stringify(config)); await writeFile(join(directory, ".obsidian", "outgoing-link.json"), moduleBytes); await writeFile(originalPath, sourceBytes);
    await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } });
  });
  const pane = id => `[data-outgoing-pane="${id}"]`, row = (id, reference) => pane(id) + ` [data-outgoing-reference=${JSON.stringify(reference)}]`, state = id => evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).view.getState()`);
  const activate = async id => { await click(`[data-tab-id="${id}"]`); await wait(`app.workspace.activeLeaf.id===${JSON.stringify(id)}`); };
  const palette = async (name, id) => { await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open'); await command("Input.insertText", { text: name }); await click(`[data-command-id="${id}"]`); };
  await wait('document.querySelectorAll(\'[data-outgoing-pane="outgoing-a"] [data-outgoing-pane-link]\').length===7', "imported main Outgoing links");
  await wait('document.querySelector(\'[data-outgoing-pane="outgoing-side"] [data-outgoing-pane-mention]\')', "imported fixed sidebar aliases");
  assert.equal((await state("outgoing-a")).file, alpha); assert.equal((await state("outgoing-b")).file, beta); assert.equal((await state("outgoing-b")).linksCollapsed, true);
  assert.deepEqual((await state("outgoing-a")).opaque, { keep: "outgoing-a" }); assert.equal(await evaluate('app.workspace.getLeafById("outgoing-a").pinned'), true);
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-right]").getAttribute("aria-selected")'), "true");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row("outgoing-a", "Target#Section") + " .outgoing-count")}).textContent`), "3");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row("outgoing-a", "../../Outside"))}).disabled`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row("outgoing-a", "Unsupported.bin"))}).disabled`), true);
  assert.equal(await evaluate('document.querySelector("[data-outgoing-pane=outgoing-side] img")===null'), true); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await capture("imported");
  pass("First-open original layouts restore genuine main/sidebar Outgoing ItemViews with independent targets, follow/folds, pins and opaque state. Wiki/Markdown/property occurrences group by destination/subpath, unsafe actions refuse and literal aliases do not inject HTML.");

  await click(row("outgoing-a", "Target#Section")); await wait(`app.workspace.activeLeaf.view.getViewType()==="markdown"&&app.workspace.activeLeaf.view.file?.path===${JSON.stringify(target)}&&app.workspace.activeLeaf.view.editor.getCursor().line===5`, "heading navigation while the pane follows its new target");
  assert.equal((await state("outgoing-a")).file, target); assert.equal((await state("outgoing-side")).file, alpha);
  await click(row("outgoing-side", "Target#^block")); await wait('app.workspace.activeLeaf.view.getViewType()==="markdown"&&app.workspace.activeLeaf.view.editor.getCursor().line===7', "block navigation");
  const tabs = await evaluate("app.workspace.leaves().length"); await click(row("outgoing-side", "Image.png"), 2);
  await wait(`app.workspace.activeLeaf.view.getViewType()==="image"&&app.workspace.leaves().length===${tabs + 1}&&app.workspace.activeLeaf.view.contentEl.querySelector("img")?.naturalWidth===400`, "registered raster target in a new tab");
  await click(row("outgoing-side", "Board.canvas")); await wait(`app.workspace.activeLeaf.view.file?.path===${JSON.stringify(board)}&&app.workspace.activeLeaf.view.getViewType()==="canvas"`, "registered Canvas target");
  await evaluate('app.core.setEnabled("canvas",false)'); await wait(`document.querySelector(${JSON.stringify(row("outgoing-side", "Board.canvas"))}).disabled`, "provider removal disables only its target");
  await evaluate('app.core.setEnabled("canvas",true)'); await wait(`!document.querySelector(${JSON.stringify(row("outgoing-side", "Board.canvas"))}).disabled`, "provider registration restores its target");
  await click(row("outgoing-side", "Pane missing note")); await wait('app.workspace.activeLeaf.view.file?.path==="Pane missing note.md"', "guarded creation of a missing note");
  assert.equal(await readFile(join(directory, "Pane missing note.md"), "utf8"), ""); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  assert.deepEqual(await readFile(join(directory, image)), imageBytes); assert.deepEqual(await readFile(join(directory, board)), boardBytes);
  await click(pane("outgoing-side") + " [data-outgoing-pane-mention]"); await wait('app.workspace.activeLeaf.view.getViewType()==="markdown"&&app.workspace.activeLeaf.view.editor.getSelection()==="Seed"', "exact unlinked source selection");
  pass("Real links retain heading/block navigation while following changes target, modified clicks open actual image tabs, Canvas provider changes refresh availability, missing-note creation preserves its source and aliases select exact Source text.");

  await evaluate(`(()=>{const v=app.workspace.activeLeaf.view;globalThis.oldOutgoingMention=document.querySelector('[data-outgoing-pane=outgoing-side] [data-outgoing-pane-mention]');v.editor.replaceRange("Dirty prefix\\r\\n",{line:3,ch:0});globalThis.outgoingCaret=v.editor.getCursor();oldOutgoingMention.click();})()`);
  await wait('document.querySelector("[data-outgoing-pane=outgoing-side] [data-outgoing-status]").textContent.includes("changed")', "stale source click refreshes rather than selecting old offsets");
  assert.deepEqual(await evaluate("app.workspace.activeLeaf.view.editor.getCursor()"), await evaluate("outgoingCaret")); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await evaluate("app.workspace.activeLeaf.view.focus()"); await press("z", "KeyZ", 90, 2); await wait(`app.workspace.activeLeaf.view.editor.getValue()===${JSON.stringify(alphaText)}`, "dirty source undo");
  await press("End", "End", 35, 2); await command("Input.insertText", { text: "[[Live pane target]]" });
  await wait(`document.querySelector(${JSON.stringify(row("outgoing-side", "Live pane target"))})`, "unsaved source link appears");
  await press("z", "KeyZ", 90, 2); await wait(`!document.querySelector(${JSON.stringify(row("outgoing-side", "Live pane target"))})`, "undo removes live link");
  await press("y", "KeyY", 89, 2); await wait(`document.querySelector(${JSON.stringify(row("outgoing-side", "Live pane target"))})`, "redo restores live link");
  await evaluate("app.saveAll()"); const externalBytes = Buffer.concat([await readFile(join(directory, alpha)), Buffer.from("\r\n[[External pane target]]\r\n")]); await writeFile(join(directory, alpha), externalBytes);
  await evaluate("app.metadataCache.refresh()"); await wait(`document.querySelector(${JSON.stringify(row("outgoing-side", "External pane target"))})`, "external source refresh");
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(alpha)}),${JSON.stringify(moved)},true)`); await wait(`!app.workspace.isChangingFiles&&app.workspace.getLeafById("outgoing-side").view.getState().file===${JSON.stringify(moved)}`, "fixed source rename");
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(target)}),${JSON.stringify(renamed)},true)`); await wait(`!app.workspace.isChangingFiles&&document.querySelector(${JSON.stringify(pane("outgoing-side") + ` [data-outgoing-target="${renamed}"]`)})`, "renamed destination refresh");
  assert.equal(await readFile(join(directory, renamed), "utf8"), targetText);
  pass("Stale immediate clicks cannot select old offsets. Dirty edits, undo/redo, actual external writes and source/destination renames refresh real panes while preserving exact attachment and destination bytes.");

  await evaluate(`(async()=>{const v=app.workspace.getLeafById("outgoing-b").view;globalThis.outgoingGetDocument=app.metadataCache.getDocument;globalThis.outgoingRead=app.vault.read;globalThis.outgoingReads=[];app.metadataCache.getDocument=function(path){return path===${JSON.stringify(moved)}?undefined:outgoingGetDocument.call(this,path)};app.vault.read=function(file){if(file.path===${JSON.stringify(moved)})return new Promise(resolve=>outgoingReads.push(()=>outgoingRead.call(this,file).then(resolve)));return outgoingRead.call(this,file)};await v.setState({...v.getState(),file:${JSON.stringify(moved)},linksCollapsed:false},{});})()`);
  await wait("outgoingReads.length>0", "held real fallback source read");
  await evaluate(`(async()=>{const v=app.workspace.getLeafById("outgoing-b").view;await v.setState({...v.getState(),file:${JSON.stringify(beta)}},{});app.metadataCache.getDocument=outgoingGetDocument;app.vault.read=outgoingRead;outgoingReads.forEach(release=>release());})()`);
  await wait(`document.querySelectorAll('[data-outgoing-pane=outgoing-b] [data-outgoing-pane-link]').length===1&&app.workspace.getLeafById("outgoing-b").view.getState().file===${JSON.stringify(beta)}`, "late source read cannot replace the new target");
  await setCommunityPluginEnabled({ evaluate, click, wait }, "outgoing-pane-probe", true); await click(".settings-close");
  await palette("Set an Outgoing pane note", "outgoing-pane-probe:set-note"); await wait("Boolean(globalThis.outgoingPaneProbe)"); assert.deepEqual(await evaluate("outgoingPaneProbe"), { sameApp: true, isItemView: true, sameFile: true, factory: true });
  assert.deepEqual(await evaluate('(async()=>{const v=app.workspace.getLeafById("outgoing-b").view,s=JSON.stringify(v.getState());let refused=false;try{await v.setState({...v.getState(),linksCollapsed:"bad"},{})}catch{refused=true}return{refused,same:s===JSON.stringify(v.getState())};})()'), { refused: true, same: true });
  await evaluate('globalThis.oldOutgoing=app.workspace.getLeafById("outgoing-side").view;globalThis.oldOutgoingFollow=oldOutgoing.contentEl.querySelector("[data-outgoing-follow]");true');
  const beforeDisable = await state("outgoing-side"); await evaluate('app.core.setEnabled("outgoing-link",false)');
  assert.equal(await evaluate('app.workspace.getLeavesOfType("outgoing-link").length'), 0); assert.equal(await evaluate("!oldOutgoing.isLoaded&&!oldOutgoing.containerEl.isConnected"), true); assert.deepEqual(await state("outgoing-side"), beforeDisable);
  await evaluate('oldOutgoingFollow.checked=true;oldOutgoingFollow.dispatchEvent(new Event("change",{bubbles:true}));true'); assert.deepEqual(await state("outgoing-side"), beforeDisable);
  assert.equal(await evaluate(`(()=>{try{oldOutgoing.setFile(app.vault.getFileByPath(${JSON.stringify(beta)}));return false}catch{return true}})()`), true);
  await evaluate('app.core.setEnabled("outgoing-link",true)'); await wait('app.workspace.getLeafById("outgoing-side").view!==oldOutgoing&&document.querySelector("[data-outgoing-pane=outgoing-side] [data-outgoing-pane-mention]")');
  pass("Held reads cannot overwrite changed targets. A real enabled plugin exercises ItemView/App/file/factory and setFile; invalid state is atomic, disable/re-enable retains pane state and unloaded API owners and controls refuse reuse.");

  const retained = await readFile(join(directory, moved)); await evaluate('globalThis.obsoleteOutgoingButton=document.querySelector("[data-outgoing-pane=outgoing-side] [data-outgoing-pane-mention]");true');
  await unlink(join(directory, moved)); await evaluate("app.metadataCache.refresh()"); await wait('app.workspace.getLeafById("outgoing-side").view.file===null&&document.querySelector("[data-outgoing-pane=outgoing-side] [data-outgoing-status]").textContent.includes("missing or unavailable")');
  const active = await evaluate("app.workspace.activeLeaf.id"); await evaluate("obsoleteOutgoingButton.click();true"); assert.equal(await evaluate("app.workspace.activeLeaf.id"), active);
  await writeFile(join(directory, moved), retained); await evaluate("app.metadataCache.refresh()"); await wait('document.querySelector("[data-outgoing-pane=outgoing-side] [data-outgoing-pane-mention]")');
  await click(pane("outgoing-side") + " [data-outgoing-pane-section=links]"); await wait('app.workspace.getLeafById("outgoing-side").view.getState().linksCollapsed');
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  const ids = ["outgoing-a", "outgoing-b", "outgoing-side"], states = await evaluate(`${JSON.stringify(ids)}.map(id=>app.workspace.getLeafById(id).view.getState())`);
  await restart(); assert.deepEqual(await evaluate(`${JSON.stringify(ids)}.map(id=>app.workspace.getLeafById(id).view.getState())`), states);
  assert.equal(await evaluate('document.querySelector("[data-outgoing-pane=outgoing-side] [data-outgoing-pane-section=links]").getAttribute("aria-expanded")'), "false");
  await click('[data-sidebar-view="outgoing-link"]'); await evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=outgoing-link]").getAttribute("aria-selected")'), "true"); await click('[data-sidebar-view=workspace-right]');
  await palette("Open Outgoing links in a tab", "outgoing-links:open-view"); await wait('app.workspace.activeLeaf.view.getViewType()==="outgoing-link"');
  assert.equal(await evaluate("app.workspace.activeLeaf.view.navigation"), false); assert.deepEqual(await readFile(originalPath), sourceBytes); assert.deepEqual(await readFile(join(directory, ".obsidian", "outgoing-link.json")), moduleBytes);
  await capture("restored");
  pass("Deleted sources clear with explicit status and detached results cannot navigate. Restart/reconnection restores independent section folds, pins and unknown state; a saved legacy sidebar choice wins and the palette creates an actual non-navigating pane without rewriting original configuration.");
  report.outgoingPanes = { importedPanes: true, independentStateRestored: true, exactNavigationWhileFollowing: true, staleOwnersRefused: true, originalBytesPreserved: true };
  await readonlyOutgoing({ evaluate, command, click, wait, report, afterReload, capture });
}

async function readonlyOutgoing({ evaluate, command, click, wait, report, afterReload, capture }) {
  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href");
  await evaluate('globalThis.localOutgoing=app.workspace.getLeafById("outgoing-side").view;true');
  const original = { main: { id: "ro-outgoing-main", type: "split", direction: "vertical", children: [
    { id: "ro-outgoing-tabs", type: "tabs", dimension: 40, children: [{ id: "ro-outgoing", type: "leaf", state: { type: "outgoing-link", state: { file: "Folder/Source.md", followActiveFile: false, unlinkedCollapsed: false } } }] },
    { id: "ro-outgoing-notes", type: "tabs", dimension: 60, children: [note("ro-outgoing-source", "Folder/Source.md"), note("ro-outgoing-target", "Folder/Target.md")] },
  ] }, active: "ro-outgoing-source" };
  const fixture = await mountCachedGitHub(evaluate, "readonly-outgoing", [
    ["Folder/Source.md", "# Source\n\n[[Target#Heading]] and Seed.\n[[Missing remote note]]\n"], ["Folder/Target.md", "---\naliases: [Seed]\n---\n# Target\n\n## Heading\n"],
    [".obsidian/workspace.json", JSON.stringify(original)], [".obsidian/core-plugins.json", '["outgoing-link","command-palette"]'], [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&document.querySelectorAll('[data-outgoing-pane=ro-outgoing] [data-outgoing-pane-link]').length===2`, "genuine cached GitHub Outgoing import");
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate("localOutgoing.isLoaded"), false);
  assert.equal(await evaluate('document.querySelector("[data-outgoing-pane=ro-outgoing] [data-outgoing-reference=\'Missing remote note\']").disabled'), true);
  await click('[data-outgoing-pane=ro-outgoing] [data-outgoing-reference="Target#Heading"]'); await wait('app.workspace.activeLeaf.view.getViewType()==="markdown"&&app.workspace.activeLeaf.view.file?.path==="Folder/Target.md"&&app.workspace.activeLeaf.view.editor.getCursor().line===5');
  assert.equal(await evaluate("app.workspace.activeLeaf.view.editor.cm.contentDOM.contentEditable"), "false");
  await click('[data-outgoing-pane=ro-outgoing] [data-outgoing-pane-mention]'); await wait('app.workspace.activeLeaf.view.getViewType()==="markdown"&&app.workspace.activeLeaf.view.editor.getSelection()==="Seed"');
  assert.equal(await evaluate("app.workspace.activeLeaf.view.editor.cm.contentDOM.contentEditable"), "false"); await click('[data-outgoing-pane=ro-outgoing] [data-outgoing-pane-section=links]'); await evaluate("app.workspace.flushLayout()");
  const state = await evaluate("app.githubVaults.state()"); assert.equal(state.counters.api, 0); assert.equal(state.counters.raw, 0); await assertCachedBlobsUnchanged(evaluate, fixture.blobs); await capture("readonly");
  await command("Page.navigate", { url: pageUrl }); await afterReload(); assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  report.outgoingPanes.readOnly = { genuineCacheOnlyMount: true, exactSourceSelection: true, missingCreationRefused: true, zeroNetwork: true, blobsUnchanged: true, returnedToLocal: true };
  report.checks.push("A genuine cache-only GitHub mount restores Outgoing panes, navigates headings and exact aliases in read-only editors, refuses missing-note creation and saves local folds with zero network and unchanged remote content/configuration before returning to the local vault.");
}
