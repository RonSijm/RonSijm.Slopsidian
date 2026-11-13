import assert from "node:assert/strict";
import { checkInlineFootnotes } from "./inline-footnote-scenarios.mjs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

const probeCode = `const {Plugin,ItemView,FileView}=require("obsidian");module.exports=class extends Plugin{onload(){this.addCommand({id:"probe",name:"Probe discovery pane contracts",callback:async()=>{const t=this.app.workspace.getLeafById("tags-b").view,l=this.app.workspace.getLeafById("foot-b"),f=l.view;await t.setState({...t.getState(),sortOrder:"alphabetical"},{});t.showSearch();await l.openFile(this.app.vault.getFileByPath("Discovery panes/Alpha.md"),{active:false});const kept=l.view===f;await f.setFile(this.app.vault.getFileByPath("Discovery panes/Beta.md"));globalThis.discoveryPaneProbe={sameApp:t.app===this.app&&f.app===this.app,tagItem:t instanceof ItemView,footFile:f instanceof FileView,acceptsMarkdown:f.canAcceptExtension("md"),navigation:f.navigation,allowNoFile:f.allowNoFile,sameProvider:kept,sameFile:f.file===this.app.vault.getFileByPath("Discovery panes/Beta.md"),tagFactory:typeof this.app.internalPlugins.getPluginById("tag-pane").views.tag==="function",footFactory:typeof this.app.internalPlugins.getPluginById("footnotes").views.footnotes==="function"};}});}};`;

export async function checkDiscoveryPanes({ directory, evaluate, command, click, press, wait, report, restart, afterReload, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); }, prefix = "Discovery panes", alpha = prefix + "/Alpha.md", beta = prefix + "/Beta.md", moved = prefix + "/Moved.md", delayed = prefix + "/Delayed.md";
  const alphaText = ["---", "tags: [pane, pane/yaml]", "---", "# Alpha", "", "Tags #pane/alpha #pane/solo #pane/repeat #pane/repeat.", "", "First [^b], next [^a], repeat [^b], missing [^gone].", "", "[^unused]: **Unused** definition.", "[^a]: A body.", "    Continued \u4e2d\u6587.", "[^b]: **B body** and *emphasis*.", "[^twice]: First duplicate.", "[^twice]: Second duplicate.", ""].join("\r\n");
  const betaText = "# Beta\n\n#pane/beta\n\nBeta [^beta].\n\n[^beta]: **Beta body**.\n", alphaBytes = Buffer.from("\ufeff" + alphaText), betaBytes = Buffer.from(betaText);
  const originalPath = join(directory, ".obsidian", "workspace.json"), savedPath = join(directory, ".obsidian", "vault-dotnet-workspace.json");
  const settingsBytes = Buffer.from('\ufeff{\r\n  "futureSetting": {"keep": [1, false]}\r\n}\r\n');
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()"); await mkdir(join(directory, prefix));
  await writeFile(join(directory, alpha), alphaBytes); await writeFile(join(directory, beta), betaBytes); await writeFile(join(directory, delayed), "Old [^old].\n\n[^old]: Old slow result.\n");
  const probe = join(directory, ".obsidian", "plugins", "discovery-pane-probe"); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, "manifest.json"), JSON.stringify({ id: "discovery-pane-probe", name: "Discovery pane probe", version: "1.0.0", minAppVersion: "1.0.0", author: "Slopsidian smoke", description: "Disposable actual Tags/Footnotes provider contracts.", isDesktopOnly: false })); await writeFile(join(probe, "main.js"), probeCode);
  const tag = (id, state = {}) => ({ id, type: "leaf", state: { type: "tag", state: { showSearch: true, searchQuery: "pane", opaque: { keep: id }, ...state } } });
  const foot = (id, state = {}, pinned = false) => ({ id, type: "leaf", pinned, state: { type: "footnotes", state: { file: alpha, opaque: { keep: id }, ...state } } });
  const note = (id, file, mode) => ({ id, type: "leaf", state: { type: "markdown", state: { file, mode, source: mode === "source" } } });
  const original = { main: { id: "discovery-main", type: "split", direction: "vertical", children: [
    { id: "tag-tabs", type: "tabs", dimension: 28, children: [tag("tags-a"), tag("tags-b", { useHierarchy: false, searchQuery: "pane/solo", sortOrder: "alphabeticalReverse" })] },
    { id: "foot-tabs", type: "tabs", dimension: 33, children: [foot("foot-a"), foot("foot-b", { file: beta, followActiveFile: false })] },
    { id: "discovery-note-tabs", type: "tabs", dimension: 39, children: [note("discovery-alpha", alpha, "source"), note("discovery-beta", beta, "preview")] },
  ] }, active: "discovery-alpha",
  left: { id: "discovery-left", type: "split", direction: "horizontal", width: 220, children: [{ id: "discovery-search-tabs", type: "tabs", children: [{ id: "discovery-search", type: "leaf", state: { type: "search", state: { query: "path:Discovery" } } }] }] },
  right: { id: "discovery-right", type: "split", direction: "horizontal", width: 310, children: [{ id: "discovery-side-tabs", type: "tabs", children: [tag("tags-side"), foot("foot-side", { file: beta }, true)] }] } };
  const sourceBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await restart(async () => {
    const configPath = join(directory, ".obsidian", "core-plugins.json"), config = JSON.parse((await readFile(configPath, "utf8").catch(error => { if (error.code !== "ENOENT") { throw error; } return "{}"; })).replace(/^\ufeff/, ""));
    if (Array.isArray(config)) { for (const id of ["tag-pane", "footnotes", "global-search", "command-palette"]) { if (!config.includes(id)) { config.push(id); } } }
    else { Object.assign(config, { "tag-pane": true, footnotes: true, "global-search": true, "command-palette": true }); }
    await writeFile(configPath, JSON.stringify(config)); await writeFile(join(directory, ".obsidian", "tag-pane.json"), settingsBytes); await writeFile(join(directory, ".obsidian", "footnotes.json"), settingsBytes);
    await writeFile(originalPath, sourceBytes); await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } });
  });
  const pane = id => `[data-tags-pane="${id}"]`, footPane = id => `[data-footnotes-pane="${id}"]`, state = id => evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).view.getState()`);
  const tagButton = (id, name) => pane(id) + " [data-pane-tag=" + JSON.stringify(name) + "]", fold = (id, name) => pane(id) + " [data-tags-pane-fold=" + JSON.stringify(name) + "]";
  const entries = id => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(footPane(id) + " [data-footnotes-entry]")}),e=>e.dataset.footnotesEntry)`);
  const expectEntries = (id, values) => wait(`JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(footPane(id) + " [data-footnotes-entry]")}),e=>e.dataset.footnotesEntry))===${JSON.stringify(JSON.stringify(values))}`, "owned footnotes " + id);
  const activate = async id => { await click(`[data-tab-id="${id}"]`); await wait(`app.workspace.activeLeaf.id===${JSON.stringify(id)}`); };
  const fill = async (selector, value) => { await click(selector); await press("a", "KeyA", 65, 2); if (value) { await command("Input.insertText", { text: value }); } else { await press("Backspace", "Backspace", 8); } };
  const palette = async (name, id) => { await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open'); await command("Input.insertText", { text: name }); await click(`[data-command-id="${id}"]`); };
  const query = value => wait(`app.workspace.getLeafById("discovery-search").view.getQuery()===${JSON.stringify(value)}&&document.querySelector('[data-search-pane="discovery-search"] [data-search-status]').dataset.completedQuery===${JSON.stringify(value)}&&document.querySelector('[data-search-pane="discovery-search"] [data-search-status]').dataset.searchComplete==="true"`, "actual registered Search " + value);
  await wait(`document.querySelector(${JSON.stringify(tagButton("tags-a", "#pane/alpha"))})&&document.querySelector(${JSON.stringify(tagButton("tags-b", "#pane/solo"))})`, "imported actual Tags providers");
  await expectEntries("foot-a", ["b", "a", "unused", "twice", "gone"]); await expectEntries("foot-b", ["beta"]); await expectEntries("foot-side", ["beta"]);
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-right]").getAttribute("aria-selected")'), "true");
  assert.equal((await state("tags-a")).useHierarchy, true); assert.deepEqual((await state("tags-a")).opaque, { keep: "tags-a" }); assert.equal((await state("foot-side")).file, beta);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(footPane("foot-side") + " [data-footnotes-follow]")}).disabled`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pane("tags-a") + ' [data-pane-tag-count="#pane"]')}).textContent`), "7");
  await wait(`document.querySelector(${JSON.stringify(footPane("foot-a") + ' [data-pane-footnote-content="b"] strong')})?.textContent==="B body"`, "owned Markdown footnote previews");
  assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes); await capture("imported");
  pass("An original workspace imports real main/sidebar Tags and FileView-backed Footnotes, retaining independent state, unknown fields, native nested defaults and pinned-note targeting. Numbered Markdown previews follow first references; missing/duplicate/unused definitions are explicit and original BOM/CRLF bytes stay exact.");

  await fill(pane("tags-a") + " [data-tags-pane-search]", ""); await click(fold("tags-a", "#pane")); assert.deepEqual((await state("tags-a")).foldedTags, ["#pane"]);
  await fill(pane("tags-a") + " [data-tags-pane-search]", "pane/alpha"); await wait(`Boolean(document.querySelector(${JSON.stringify(tagButton("tags-a", "#pane/alpha"))}))`);
  assert.deepEqual((await state("tags-a")).foldedTags, ["#pane"]); await click(pane("tags-a") + " [data-tags-pane-action=filter]");
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(tagButton("tags-a", "#pane/alpha"))}))`), false);
  await evaluate(`document.querySelector(${JSON.stringify(pane("tags-a") + ' [data-tag-key="#pane"]')}).focus()`); await press("ArrowRight", "ArrowRight", 39); await wait(`Boolean(document.querySelector(${JSON.stringify(tagButton("tags-a", "#pane/alpha"))}))`);
  await press("ArrowRight", "ArrowRight", 39); assert.equal(await evaluate("document.activeElement.dataset.tagKey"), "#pane/repeat"); await press("Home", "Home", 36); await press("End", "End", 35);
  assert.equal(await evaluate("document.activeElement.getAttribute('role')"), "treeitem"); assert.deepEqual((await state("tags-b")).searchQuery, "pane/solo");
  await click(pane("tags-a") + " [data-tags-pane-hierarchy]");
  for (const [index, order] of ["frequency", "frequencyReverse", "alphabetical", "alphabeticalReverse"].entries()) {
    await click(pane("tags-a") + " [data-tags-pane-sort]"); await press("Home", "Home", 36); for (let step = 0; step < index; step++) { await press("ArrowDown", "ArrowDown", 40); } await press("Enter", "Enter", 13);
    await wait(`app.workspace.getLeafById("tags-a").view.getState().sortOrder===${JSON.stringify(order)}`, "actual sort " + order);
  }
  await click(pane("tags-a") + " [data-tags-pane-hierarchy]"); await capture("tags");
  pass("Real tag controls preserve independent ordinary/temporary folds, expose all four sort choices and switch flat/nested layout. Arrow/Home/End keys traverse the actual tree while another pane's filter remains unchanged.");

  await click(tagButton("tags-a", "#pane/alpha")); await query("tag:#pane/alpha");
  await click(tagButton("tags-a", "#pane/solo"), 2); await query("tag:#pane/alpha tag:#pane/solo");
  await click(tagButton("tags-a", "#pane/solo"), 2); await query("tag:#pane/alpha");
  await fill('[data-search-pane="discovery-search"] [data-search-query]', "path:Discovery tag:#pane/alpha tag:#pane/alpha"); await query("path:Discovery tag:#pane/alpha tag:#pane/alpha");
  await evaluate(`document.querySelector(${JSON.stringify(pane("tags-a") + ' [data-tag-key="#pane/alpha"]')}).focus()`); await press("Enter", "Enter", 13, 2); await query("path:Discovery  tag:#pane/alpha");
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-left]").getAttribute("aria-selected")'), "true"); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  pass("Pointer and Ctrl+Enter activation drive an actual registered, worker-backed Search pane rather than stale legacy query state. Modified activation appends or removes the first literal fragment without normalizing the remaining query or changing notes.");

  const reference = footPane("foot-a") + ' [data-pane-footnote-reference="b"]';
  await click(reference); await wait('app.workspace.activeLeaf.id==="discovery-alpha"&&app.workspace.activeLeaf.view.editor.getSelection()==="[^b]"');
  await activate("foot-side"); await click(footPane("foot-side") + ' [data-pane-footnote-definition="beta"]'); await wait('app.workspace.activeLeaf.id==="discovery-beta"&&app.workspace.activeLeaf.view.getMode()==="source"&&app.workspace.activeLeaf.view.editor.getSelection()==="[^beta]"');
  await expectEntries("foot-a", ["beta"]); await click(footPane("foot-a") + " [data-footnotes-follow]"); await activate("discovery-alpha"); await expectEntries("foot-a", ["beta"]);
  await click(footPane("foot-a") + " [data-footnotes-follow]"); await expectEntries("foot-a", ["b", "a", "unused", "twice", "gone"]); await expectEntries("foot-side", ["beta"]);
  await evaluate(`document.querySelector(${JSON.stringify(reference)}).focus()`); await press("ArrowDown", "ArrowDown", 40); assert.equal(await evaluate("document.activeElement.dataset.footnoteTarget"), JSON.stringify(["b", "reference", 1])); await press("Enter", "Enter", 13);
  assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes); assert.deepEqual(await readFile(join(directory, beta)), betaBytes); await capture("footnotes");
  pass("Footnote definition/reference buttons reveal exact Source ranges in existing note panes, including an explicit Reading-to-Source transition. Follow controls switch or retain a note independently; a pinned sidebar keeps its file and browsing never writes note bytes.");

  await checkFootnoteEditing({ directory, evaluate, command, click, press, wait, report, capture, activate, alpha, alphaText, alphaBytes, beta, betaText, betaBytes });
  await checkInlineFootnotes({ directory, evaluate, command, click, press, wait, report, restart, capture, activate });

  await setCommunityPluginEnabled({ evaluate, click, wait }, "discovery-pane-probe", true); await click(".settings-close"); await palette("Probe discovery pane contracts", "discovery-pane-probe:probe"); await wait("Boolean(globalThis.discoveryPaneProbe)");
  assert.deepEqual(await evaluate("discoveryPaneProbe"), { sameApp: true, tagItem: true, footFile: true, acceptsMarkdown: true, navigation: false, allowNoFile: true, sameProvider: true, sameFile: true, tagFactory: true, footFactory: true });
  for (const [id, invalid] of [["tags-a", { foldedTags: null }], ["foot-a", { followActiveFile: "yes" }]]) {
    const result = await evaluate(`(async()=>{const v=app.workspace.getLeafById(${JSON.stringify(id)}).view,before=JSON.stringify(v.getState());let refused=false;try{await v.setState({...v.getState(),...${JSON.stringify(invalid)}},{})}catch{refused=true}return{refused,same:JSON.stringify(v.getState())===before}})()`); assert.deepEqual(result, { refused: true, same: true });
  }
  pass("An enabled fixture plugin exercises real ItemView/FileView/App/file identities, actual provider factories, showSearch/setFile and leaf.openFile retaining the Footnotes provider. Malformed state refuses atomically without replacing a pane.");

  await activate("discovery-alpha"); await evaluate("app.workspace.activeLeaf.view.focus()");
  const changedText = alphaText.replace("Tags #pane/alpha #pane/solo #pane/repeat #pane/repeat.", "Inserted #pane/live.\r\nTags #pane/changed #pane/solo #pane/repeat #pane/repeat.");
  await evaluate(`(()=>{const v=app.workspace.getLeafById("discovery-alpha").view,tag=app.metadataCache.getDocument(${JSON.stringify(alpha)}).cache.tags.find(t=>t.tag==="#pane/alpha"),line=tag.position.start.line,old=v.editor.getLine(line),f=document.querySelector(${JSON.stringify(reference)}),t=document.querySelector(${JSON.stringify(tagButton("tags-a", "#pane/alpha"))});globalThis.discoveryQueryBefore=app.workspace.getLeafById("discovery-search").view.getQuery();v.editor.replaceRange("Inserted #pane/live.\\n"+old.replace("#pane/alpha","#pane/changed"),{line,ch:0},{line,ch:old.length});globalThis.discoveryCursorAfter=v.editor.getCursor();f.click();t.click();})()`);
  await wait(`app.workspace.getLeafById("discovery-alpha").view.editor.getValue()===${JSON.stringify(changedText)}&&Boolean(document.querySelector(${JSON.stringify(tagButton("tags-a", "#pane/changed"))}))`, "dirty metadata updates");
  assert.deepEqual(await evaluate('app.workspace.getLeafById("discovery-alpha").view.editor.getCursor()'), await evaluate("discoveryCursorAfter")); assert.equal(await evaluate('app.workspace.getLeafById("discovery-search").view.getQuery()'), await evaluate("discoveryQueryBefore"));
  assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await evaluate('app.workspace.getLeafById("discovery-alpha").view.focus()'); await press("z", "KeyZ", 90, 2); await wait(`app.workspace.getLeafById("discovery-alpha").view.editor.getValue()===${JSON.stringify(alphaText)}`);
  await press("y", "KeyY", 89, 2); await wait(`app.workspace.getLeafById("discovery-alpha").view.editor.getValue()===${JSON.stringify(changedText)}`);
  await press("s", "KeyS", 83, 2); await wait('!app.dirty&&!app.workspace.getLeafById("discovery-alpha").view.session.isSaving'); assert.deepEqual(await readFile(join(directory, alpha)), Buffer.from("\ufeff" + changedText));
  await writeFile(join(directory, alpha), Buffer.from("\ufeff" + changedText + "\r\n[^external]: External #pane/external definition.\r\n")); await evaluate("app.metadataCache.refresh()");
  await wait(`Boolean(document.querySelector(${JSON.stringify(footPane("foot-a") + ' [data-footnotes-entry="external"]')}))&&Boolean(document.querySelector(${JSON.stringify(tagButton("tags-a", "#pane/external"))}))`, "genuine external note update");
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(beta)}),${JSON.stringify(moved)},true)`); await wait(`app.workspace.getLeafById("foot-side").view.getState().file===${JSON.stringify(moved)}&&app.workspace.getLeafById("foot-b").view.getState().file===${JSON.stringify(moved)}&&!app.workspace.isChangingFiles`);
  pass("Immediate obsolete controls after a real editor transaction cannot select an old footnote range or search a removed tag. Dirty edits, actual undo/redo/save, external physical writes and guarded rename refresh both provider types while keeping fixed-note identities.");

  await evaluate(`(()=>{globalThis.oldDiscoveryFoot=app.workspace.getLeafById("foot-a").view;globalThis.oldDiscoveryTag=app.workspace.getLeafById("tags-a").view;globalThis.oldDiscoveryFollow=oldDiscoveryFoot.contentEl.querySelector("[data-footnotes-follow]");globalThis.oldDiscoveryHierarchy=oldDiscoveryTag.contentEl.querySelector("[data-tags-pane-hierarchy]");globalThis.discoveryGetDocument=app.metadataCache.getDocument;globalThis.discoveryRead=app.vault.read;globalThis.discoveryReadReleases=[];globalThis.discoveryReadsCompleted=0;app.metadataCache.getDocument=function(path){return path===${JSON.stringify(delayed)}?null:discoveryGetDocument.call(this,path)};app.vault.read=async function(file){const text=await discoveryRead.call(this,file);if(file.path===${JSON.stringify(delayed)}){await new Promise(resolve=>discoveryReadReleases.push(resolve));discoveryReadsCompleted++;}return text;};})()`);
  await evaluate(`oldDiscoveryFoot.setFile(app.vault.getFileByPath(${JSON.stringify(delayed)}))`); await wait("discoveryReadReleases.length>0", "held actual old-owner file reads");
  const beforeDisable = await evaluate("[oldDiscoveryTag.getState(),oldDiscoveryFoot.getState()]");
  await evaluate('app.core.setEnabled("tag-pane",false)'); await evaluate('app.core.setEnabled("footnotes",false)');
  assert.equal(await evaluate('app.workspace.getLeavesOfType("tag").length+app.workspace.getLeavesOfType("footnotes").length'), 0); assert.equal(await evaluate("!oldDiscoveryTag.isLoaded&&!oldDiscoveryFoot.isLoaded&&!oldDiscoveryFoot.containerEl.isConnected"), true);
  await evaluate('oldDiscoveryFollow.checked=true;oldDiscoveryFollow.dispatchEvent(new Event("change",{bubbles:true}));oldDiscoveryHierarchy.checked=false;oldDiscoveryHierarchy.dispatchEvent(new Event("change",{bubbles:true}));app.metadataCache.getDocument=discoveryGetDocument;app.vault.read=discoveryRead;true');
  assert.deepEqual(await evaluate("[oldDiscoveryTag.getState(),oldDiscoveryFoot.getState()]"), beforeDisable);
  await writeFile(join(directory, delayed), "Fresh [^fresh].\n\n[^fresh]: Fresh physical content.\n"); await evaluate("app.metadataCache.refresh()");
  await evaluate('app.core.setEnabled("tag-pane",true)'); await evaluate('app.core.setEnabled("footnotes",true)'); await expectEntries("foot-a", ["fresh"]);
  await evaluate("discoveryReadReleases.forEach(release=>release());true"); await wait("discoveryReadsCompleted===discoveryReadReleases.length"); await expectEntries("foot-a", ["fresh"]);
  const obsolete = await evaluate(`(async()=>{let refused=0;for(const action of [()=>oldDiscoveryFoot.setFile(app.vault.getFileByPath(${JSON.stringify(alpha)})),()=>oldDiscoveryFoot.loadFile(app.vault.getFileByPath(${JSON.stringify(alpha)})),()=>oldDiscoveryTag.setState({},{} )]){try{await action()}catch{refused++}}return refused})()`); assert.equal(obsolete, 3);
  pass("Real provider disable/re-enable unloads owners and handlers without waiting for held file reads. Fresh owners render newer physical content; releasing every old read, detached controls and stale public API calls cannot replace them.");

  await activate("tags-a"); if ((await state("tags-a")).showSearch) { await click(pane("tags-a") + " [data-tags-pane-action=filter]"); }
  await click(fold("tags-a", "#pane")); await evaluate("app.workspace.flushLayout()");
  const ids = ["tags-a", "tags-b", "tags-side", "foot-a", "foot-b", "foot-side"], states = await evaluate(`${JSON.stringify(ids)}.map(id=>app.workspace.getLeafById(id).view.getState())`);
  await restart(); assert.deepEqual(await evaluate(`${JSON.stringify(ids)}.map(id=>app.workspace.getLeafById(id).view.getState())`), states); await expectEntries("foot-a", ["fresh"]); assert.deepEqual(await readFile(originalPath), sourceBytes);
  await click('[data-sidebar-view=tag]'); await evaluate("app.workspace.flushLayout()"); await restart(); assert.equal(await evaluate('document.querySelector("[data-sidebar-view=tag]").getAttribute("aria-selected")'), "true");
  await click('[data-sidebar-view=workspace-right]'); await palette("Open Tags in a tab", "tag-pane:open-view"); await wait('app.workspace.activeLeaf.view.getViewType()==="tag"'); await palette("Open Footnotes in a tab", "footnotes:open-view"); await wait('app.workspace.activeLeaf.view.getViewType()==="footnotes"'); await capture("restored");
  for (const id of ["tag-pane", "footnotes"]) { assert.deepEqual(await readFile(join(directory, ".obsidian", id + ".json")), settingsBytes); }
  assert.deepEqual(await readFile(originalPath), sourceBytes);
  pass("Full restart or actual-folder reconnection restores independent targets, sorts, filters, folds, opaque state and pinned notes. Explicit legacy sidebar preference wins on reopen; real palette commands create additional providers without rewriting the original workspace or per-module configuration.");
  report.discoveryPanes = { fixturePlugin: "discovery-pane-probe 1.0.0; host contracts only", originalWorkspacePreserved: true, moduleConfigurationPreserved: true, actualReadOwnership: true, independentStateRestored: true, nativeEditableFootnoteEmbeds: false };
  await readonlyDiscovery({ evaluate, command, click, press, wait, report, afterReload, capture }); assert.deepEqual(await readFile(originalPath), sourceBytes);
}

async function checkFootnoteEditing({ directory, evaluate, command, click, press, wait, report, capture, activate, alpha, alphaText, alphaBytes, beta, betaText, betaBytes }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const dialog = "[data-footnote-edit-dialog]", draft = dialog + " .cm-content", apply = dialog + ' [data-footnote-edit-action="apply"]', cancel = dialog + ' [data-footnote-edit-action="cancel"]';
  const noteText = () => evaluate('app.workspace.getLeafById("discovery-alpha").view.editor.getValue()');
  const draftText = () => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(dialog + " .cm-line")}),line=>line.textContent).join("\\n")`);
  const open = async (id = "a", leaf = "foot-a") => {
    await activate(leaf); await click(`[data-footnotes-pane="${leaf}"] [data-footnote-edit="${id}"]`);
    await wait(`Boolean(document.querySelector(${JSON.stringify(draft)}))`, "footnote definition editor");
  };
  const type = async text => { await click(draft); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text }); };
  const closed = () => wait(`!document.querySelector(${JSON.stringify(dialog)})`, "footnote editor closed");
  const saveAlpha = async () => {
    await activate("discovery-alpha"); await evaluate('app.workspace.getLeafById("discovery-alpha").view.focus()'); await press("s", "KeyS", 83, 2);
    await wait('!app.workspace.getLeafById("discovery-alpha").view.session.dirty&&!app.workspace.getLeafById("discovery-alpha").view.session.isSaving', "exact note save");
  };
  assert.equal(await evaluate('Array.from(document.querySelectorAll(\'[data-footnotes-pane="foot-a"] [data-footnote-edit="twice"]\')).every(button=>button.disabled)'), true);
  await open(); assert.equal(await draftText(), "A body.\nContinued 中文.");
  await type("Cancelled draft λ\nOnly local text."); assert.equal(await draftText(), "Cancelled draft λ\nOnly local text.");
  await press("z", "KeyZ", 90, 2); assert.equal(await draftText(), "A body.\nContinued 中文.");
  await press("y", "KeyY", 89, 2); assert.equal(await draftText(), "Cancelled draft λ\nOnly local text.");
  assert.equal(await noteText(), alphaText); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await click(cancel); await closed(); assert.equal(await noteText(), alphaText); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  await open(); await click(apply); await closed(); assert.equal(await noteText(), alphaText);
  pass("Actual Footnotes Edit definition opens a local Markdown editor; Cancel and unchanged Apply preserve the exact note, and duplicate definitions cannot be edited ambiguously.");

  await activate("discovery-alpha");
  await evaluate('(()=>{const v=app.workspace.getLeafById("discovery-alpha").view,e=v.editor;e.setCursor({line:e.lastLine(),ch:e.getLine(e.lastLine()).length});v.focus()})()');
  await command("Input.insertText", { text: "Independent dirty edit.\n" });
  const dirtyText = alphaText + "Independent dirty edit.\r\n";
  await wait(`app.metadataCache.getDocument(${JSON.stringify(alpha)}).text===${JSON.stringify(dirtyText)}`, "dirty footnote source baseline");
  await evaluate(`(async()=>{const leaf=app.workspace.getLeaf("tab");await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(alpha)}),{active:false});globalThis.footnoteEditingPeer=leaf})()`);
  const body = "**Edited** first.\nChanged λ.\n\nA second paragraph.";
  const edited = dirtyText.replace("[^a]: A body.\r\n    Continued 中文.", "[^a]: **Edited** first.\r\n    Changed λ.\r\n    \r\n    A second paragraph.");
  await open(); await type(body); await capture("footnote-edit"); await click(apply); await closed();
  await wait(`app.workspace.getLeafById("discovery-alpha").view.editor.getValue()===${JSON.stringify(edited)}&&footnoteEditingPeer.view.editor.getValue()===${JSON.stringify(edited)}`, "shared definition edit");
  await activate("discovery-alpha"); await evaluate('app.workspace.getLeafById("discovery-alpha").view.focus()');
  await press("z", "KeyZ", 90, 2); await wait(`footnoteEditingPeer.view.editor.getValue()===${JSON.stringify(dirtyText)}`, "one-step definition Undo");
  assert.equal(await noteText(), dirtyText);
  await press("z", "KeyZ", 90, 2); await wait(`footnoteEditingPeer.view.editor.getValue()===${JSON.stringify(alphaText)}`, "prior dirty edit retained in history");
  await press("y", "KeyY", 89, 2); await wait(`footnoteEditingPeer.view.editor.getValue()===${JSON.stringify(dirtyText)}`);
  await press("y", "KeyY", 89, 2); await wait(`footnoteEditingPeer.view.editor.getValue()===${JSON.stringify(edited)}`);
  await saveAlpha(); assert.deepEqual(await readFile(join(directory, alpha)), Buffer.from("\ufeff" + edited));
  await press("z", "KeyZ", 90, 2); await press("z", "KeyZ", 90, 2); await wait(`app.workspace.getLeafById("discovery-alpha").view.editor.getValue()===${JSON.stringify(alphaText)}`);
  await saveAlpha(); await evaluate("footnoteEditingPeer.detach()"); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  pass("Applying a multiline Unicode definition preserves BOM/CRLF and its references, refreshes a real shared note peer, and contributes one isolated Undo/Redo step in the source editor without erasing the preceding dirty edit; Ctrl+S saves exact physical bytes.");

  for (const indexed of [false, true]) {
    if (!indexed) { await evaluate("app.metadataCache.pause()"); }
    await open("b"); await type("Retained stale draft λ.");
    const external = alphaText + "External " + indexed + "\r\n";
    await writeFile(join(directory, alpha), Buffer.from("\ufeff" + external));
    if (indexed) { await evaluate("app.metadataCache.refresh()"); await wait(`app.workspace.getLeafById("discovery-alpha").view.editor.getValue()===${JSON.stringify(external)}`); }
    else { assert.equal(await noteText(), alphaText); }
    await click(apply); await wait(`Boolean(document.querySelector(${JSON.stringify(dialog + " [data-footnote-edit-error]")})?.textContent)`, "stale definition refusal");
    assert.match(await evaluate(`document.querySelector(${JSON.stringify(dialog + " [data-footnote-edit-error]")}).textContent`), /changed|saving|reloading/i);
    assert.equal(await draftText(), "Retained stale draft λ."); assert.deepEqual(await readFile(join(directory, alpha)), Buffer.from("\ufeff" + external));
    await click(cancel); await closed(); await writeFile(join(directory, alpha), alphaBytes); await evaluate("app.metadataCache.refresh();app.metadataCache.resume()");
    await wait(`app.workspace.getLeafById("discovery-alpha").view.editor.getValue()===${JSON.stringify(alphaText)}`);
  }
  pass("Indexed source changes and an unobserved physical external replacement both refuse Apply while retaining the typed draft and exact external bytes; the disk-version check is exercised with metadata polling paused.");

  const holdRead = () => evaluate(`(()=>{const trace=globalThis.footnoteEditRead={held:false,resumed:false,applyDepth:0};globalThis.footnoteEditOriginalRead=app.vault.readDocument;trace.owner=app.workspace.getLeafById("foot-a").view;trace.apply=trace.owner.applyDefinition;trace.owner.applyDefinition=function(...args){trace.applyDepth++;try{return trace.apply.apply(this,args)}finally{trace.applyDepth--}};app.vault.readDocument=async function(path){const selected=trace.applyDepth>0&&path===${JSON.stringify(alpha)},value=await footnoteEditOriginalRead.call(this,path);if(selected&&!trace.held){trace.held=true;await new Promise(resolve=>trace.release=resolve);trace.resumed=true}return value;};})()`);
  const releaseRead = () => evaluate("app.vault.readDocument=footnoteEditOriginalRead;footnoteEditRead.owner.applyDefinition=footnoteEditRead.apply;footnoteEditRead.release();true");
  await open("b"); await type("Cancelled held draft."); await holdRead();
  await click(apply); await wait("footnoteEditRead.held", "held real source version read");
  await click(draft); await press("z", "KeyZ", 90, 2); await command("Input.insertText", { text: "Blocked edit" });
  assert.equal(await draftText(), "Cancelled held draft.", "Pending Apply must block draft input and history commands while Cancel stays available.");
  await click(cancel); await closed(); await releaseRead(); await wait("footnoteEditRead.resumed");
  assert.equal(await noteText(), alphaText); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  pass("Cancel remains available during a held real version read; releasing the cancelled Apply cannot change the note or reopen its disposed draft editor.");

  await open("b"); await type("Disposed owner draft."); await holdRead(); await click(apply); await wait("footnoteEditRead.held");
  await evaluate('globalThis.footnoteEditingOldOwner=app.workspace.getLeafById("foot-a").view;true');
  await evaluate('app.core.setEnabled("footnotes",false)'); await closed(); assert.equal(await evaluate("footnoteEditingOldOwner.isLoaded"), false);
  await releaseRead(); await wait("footnoteEditRead.resumed"); await evaluate('app.core.setEnabled("footnotes",true)');
  await wait('app.workspace.getLeafById("foot-a").view.getViewType()==="footnotes"&&app.workspace.getLeafById("foot-a").view!==footnoteEditingOldOwner');
  assert.equal(await noteText(), alphaText); assert.deepEqual(await readFile(join(directory, alpha)), alphaBytes);
  pass("Disabling Footnotes disposes its real draft editor while Apply is held; a fresh provider cannot be changed by the old callback after re-enabling.");

  await evaluate('app.workspace.getLeafById("discovery-beta").detach()');
  assert.equal(await evaluate(`app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.view.file?.path===${JSON.stringify(beta)}).length`), 0);
  await open("beta", "foot-side"); await type("Revised Beta λ."); await click(apply); await closed();
  const editedBeta = betaText.replace("**Beta body**.", "Revised Beta λ.");
  await wait(`app.workspace.getLeavesOfType("markdown").some(leaf=>leaf.view.file?.path===${JSON.stringify(beta)}&&leaf.view.editor.getValue()===${JSON.stringify(editedBeta)})`, "new source note created for Apply");
  assert.equal(await evaluate('app.workspace.getLeafById("foot-side").view.getViewType()'), "footnotes");
  await evaluate(`(()=>{const leaf=app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.view.file?.path===${JSON.stringify(beta)});globalThis.footnoteEditingBeta=leaf;app.workspace.setActiveLeaf(leaf);leaf.view.focus()})()`);
  await press("z", "KeyZ", 90, 2); await wait(`footnoteEditingBeta.view.editor.getValue()===${JSON.stringify(betaText)}`); await press("s", "KeyS", 83, 2);
  await wait("!footnoteEditingBeta.view.session.dirty&&!footnoteEditingBeta.view.session.isSaving"); assert.deepEqual(await readFile(join(directory, beta)), betaBytes);
  await activate("discovery-alpha"); await wait(`app.workspace.getLeafById("foot-a").view.getState().file===${JSON.stringify(alpha)}`);
  report.footnoteEditing = { localDraftCancel: true, unchangedApply: true, sourcePreservation: true, sharedUndoRedo: true, dirtyHistoryRetained: true, exactPhysicalSave: true, indexedAndUnobservedExternalRefusal: true, heldApplyCancellation: true, ownedTeardown: true, unopenedTarget: true };
  pass("Editing a fixed Footnotes target with no open note creates a real source tab at Apply, retains the Footnotes provider, and supports Undo plus an exact save of the original LF note.");
}

async function readonlyDiscovery({ evaluate, command, click, press, wait, report, afterReload, capture }) {
  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href");
  await evaluate('globalThis.localDiscoveryTag=app.workspace.getLeafById("tags-a").view;globalThis.localDiscoveryControl=localDiscoveryTag.contentEl.querySelector("[data-tags-pane-hierarchy]");globalThis.localFootnoteEdit=app.workspace.getLeafById("foot-b").view.contentEl.querySelector("[data-footnote-edit]");true');
  const original = { main: { id: "ro-discovery-main", type: "split", direction: "vertical", children: [
    { id: "ro-tags-tabs", type: "tabs", dimension: 28, children: [{ id: "ro-tags", type: "leaf", state: { type: "tag", state: { showSearch: true, searchQuery: "remote" } } }] },
    { id: "ro-foot-tabs", type: "tabs", dimension: 33, children: [{ id: "ro-foot", type: "leaf", state: { type: "footnotes", state: { file: "Folder/Note.md", followActiveFile: false } } }] },
    { id: "ro-discovery-note-tabs", type: "tabs", dimension: 39, children: [{ id: "ro-discovery-note", type: "leaf", state: { type: "markdown", state: { file: "Folder/Note.md", mode: "source", source: true } } }] },
  ] }, active: "ro-discovery-note" };
  const fixture = await mountCachedGitHub(evaluate, "readonly-discovery", [["Folder/Note.md", "# Cached discovery\n\n#remote/work [^remote] and ^[**Cached inline**].\n\n[^remote]: **Cached footnote**.\n"], [".obsidian/workspace.json", JSON.stringify(original)], [".obsidian/core-plugins.json", '["tag-pane","footnotes","global-search","command-palette"]'], [".obsidian/community-plugins.json", "[]"]]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault&&Boolean(document.querySelector('[data-tags-pane="ro-tags"] [data-pane-tag="#remote/work"]'))&&Boolean(document.querySelector('[data-footnotes-pane="ro-foot"] [data-pane-footnote-reference="remote"]'))`, "genuine cache-only discovery providers");
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate("!localDiscoveryTag.isLoaded"), true);
  await evaluate('localDiscoveryControl.checked=false;localDiscoveryControl.dispatchEvent(new Event("change",{bubbles:true}));true'); assert.equal(await evaluate('app.workspace.getLeafById("ro-tags").view.getState().useHierarchy'), true);
  await click('[data-tags-pane="ro-tags"] [data-pane-tag="#remote/work"]'); await wait('app.workspace.getLeavesOfType("search").some(l=>l.view.getQuery()==="tag:#remote/work"&&l.view.contentEl.querySelector("[data-search-status]").dataset.searchComplete==="true")');
  await click('[data-footnotes-pane="ro-foot"] [data-pane-footnote-reference="remote"]'); await wait('app.workspace.getLeafById("ro-discovery-note").view.editor.getSelection()==="[^remote]"');
  assert.equal(await evaluate('app.workspace.getLeafById("ro-discovery-note").view.editor.cm.contentDOM.contentEditable'), "false");
  assert.equal(await evaluate('document.querySelector(\'[data-footnotes-pane="ro-foot"] [data-footnote-edit="remote"]\').disabled'), true);
  assert.equal(await evaluate('document.querySelector(\'[data-footnotes-pane="ro-foot"] [data-inline-footnote] [data-footnote-edit]\').disabled'), true);
  await evaluate('localFootnoteEdit.click();document.querySelector(\'[data-footnotes-pane="ro-foot"] [data-footnote-edit="remote"]\').click();true');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-footnote-edit-dialog]"))'), false);
  await evaluate('(()=>{const view=app.workspace.getLeafById("ro-discovery-note").view;view.setMode("preview",false);view.previewEl.dataset.readonlyInlineFootnote="true"})()');
  await wait('document.querySelectorAll("[data-readonly-inline-footnote] .footnote-ref").length===2', "read-only inline footnote rendering");
  await click('[data-readonly-inline-footnote] .footnote-ref[data-footnote-reference="2"] a');
  assert.equal(await evaluate('document.activeElement.dataset.footnoteNumber'), "2");
  await click('[data-readonly-inline-footnote] [data-footnote-number="2"] .footnote-backref');
  assert.equal(await evaluate('document.activeElement.closest("sup")?.dataset.footnoteReference'), "2");
  await click('[data-tags-pane="ro-tags"] [data-tags-pane-action=filter]'); await click('[data-tags-pane="ro-tags"] [data-tags-pane-action=collapse]'); await evaluate("app.workspace.flushLayout()"); assert.deepEqual(await evaluate('app.workspace.getLeafById("ro-tags").view.getState().foldedTags'), ["#remote"]);
  const state = await evaluate("app.githubVaults.state()"); assert.equal(state.counters.api, 0); assert.equal(state.counters.raw, 0); await assertCachedBlobsUnchanged(evaluate, fixture.blobs); await capture("readonly");
  await command("Page.navigate", { url: pageUrl }); await afterReload(); assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false); await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  report.discoveryPanes.readOnly = { genuineCacheOnlyMount: true, actualSearchProvider: true, exactFootnoteSelection: true, footnoteEditingDisabled: true, inlineFootnoteEditingDisabled: true, inlineFootnoteNavigation: true, staleLocalEditorControlInert: true, localFoldPersistence: true, zeroNetwork: true, allBlobsUnchangedBeforeAndAfterReturn: true };
  report.checks.push("A genuine cache-only GitHub vault imports both provider types, creates actual Search results and selects an exact read-only footnote. Local fold preferences remain writable, stale local controls are inert, network counters stay zero and every remote blob remains exact before and after return.");
}
