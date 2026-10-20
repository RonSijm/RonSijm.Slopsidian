import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { expectErrors } from "./error-log-audit.mjs";

const note = (id, file) => ({ id, type: "leaf", state: { type: "markdown", state: { file, mode: "source", source: true } } });
const probe = `const {Plugin,ItemView}=require("obsidian");module.exports=class extends Plugin{onload(){this.addCommand({id:"set-note",name:"Set Properties pane note",callback:()=>{const v=this.app.workspace.getLeafById("properties-a").view;v.setFile(this.app.vault.getFileByPath("Property panes/Alpha.md"));globalThis.propertiesProbe={sameApp:v.app===this.app,isItemView:v instanceof ItemView,sameFile:v.file===this.app.vault.getFileByPath("Property panes/Alpha.md"),factory:typeof this.app.internalPlugins.getPluginById("properties").views["file-properties"]==="function",editor:!!v.metadataEditor};}});}};`;

export async function checkPropertiesPanes(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const fill = async (selector, text) => {
    // Metadata can be current while the previous field commit is still read-only.
    await wait(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return input&&!input.disabled&&!input.readOnly&&!input.closest('[inert],[aria-busy="true"]');})()`, "editable Properties control");
    await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text });
  };
  const pane = id => `[data-properties-pane="${id}"]`;
  const alpha = "Property panes/Alpha.md", beta = "Property panes/Beta.md", moved = "Property panes/Moved.md";
  const alphaText = "---\r\n# Preserved comment\r\ntitle: Alpha\r\nproject: Shared\r\ntags: [work, work/nested]\r\namount: 9007199254740993\r\nstructured: {keep: true}\r\n---\r\n# Alpha body\r\n", betaText = "---\nTitle: Beta\nproject: Shared\n---\n# Beta body\n";
  const originalPath = join(directory, ".obsidian", "workspace.json"), savedPath = join(directory, ".obsidian", "vault-dotnet-workspace.json");
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  await mkdir(join(directory, "Property panes"));
  await writeFile(join(directory, alpha), "\ufeff" + alphaText); await writeFile(join(directory, beta), betaText);
  const probeDirectory = join(directory, ".obsidian", "plugins", "properties-pane-probe"); await mkdir(probeDirectory, { recursive: true });
  await writeFile(join(probeDirectory, "manifest.json"), JSON.stringify({ id: "properties-pane-probe", name: "Properties pane probe", version: "1.0.0", minAppVersion: "1.0.0", author: "Slopsidian smoke", description: "Disposable actual pane host probe.", isDesktopOnly: false }));
  await writeFile(join(probeDirectory, "main.js"), probe);
  const propertyLeaf = (id, type, state) => ({ id, type: "leaf", pinned: true, state: { type, state: { opaque: { keep: id }, ...state } } });
  const original = {
    main: { id: "properties-main", type: "split", direction: "vertical", children: [
      { id: "properties-tabs", type: "tabs", dimension: 45, children: [propertyLeaf("properties-a", "file-properties", { file: alpha, followActiveFile: true }), propertyLeaf("properties-b", "file-properties", { file: beta, query: "title", sort: "nameReverse" })] },
      { id: "properties-note-tabs", type: "tabs", dimension: 55, children: [note("properties-alpha", alpha), note("properties-beta", beta)] },
    ] }, active: "properties-alpha",
    left: { id: "properties-left", type: "split", direction: "horizontal", width: 220, collapsed: true, children: [] },
    right: { id: "properties-right", type: "split", direction: "horizontal", width: 340, collapsed: false, children: [{ id: "properties-catalog-tabs", type: "tabs", children: [propertyLeaf("properties-catalog", "all-properties", { query: "project", sort: "frequency", expandedProperties: ["project"] })] }] },
  };
  const originalBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await restart(async () => {
    const configPath = join(directory, ".obsidian", "core-plugins.json"), config = JSON.parse((await readFile(configPath, "utf8")).replace(/^\ufeff/, ""));
    if (Array.isArray(config)) { for (const id of ["properties", "outgoing-link", "command-palette", "switcher"]) { if (!config.includes(id)) { config.push(id); } } }
    else { Object.assign(config, { properties: true, "outgoing-link": true, "command-palette": true, switcher: true }); }
    await writeFile(configPath, JSON.stringify(config)); await writeFile(originalPath, originalBytes);
    await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } });
  });
  const state = id => evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).view.getState()`);
  const activate = async id => { await click(`[data-tab-id="${id}"]`); await wait(`app.workspace.activeLeaf.id===${JSON.stringify(id)}`); };
  await wait(`document.querySelector(${JSON.stringify(pane("properties-a") + ' [data-property-key="title"] input')})`, "imported inline File properties pane");
  assert.equal((await state("properties-a")).followActiveFile, true);
  assert.equal((await state("properties-b")).followActiveFile, false);
  assert.equal((await state("properties-b")).query, "title");
  assert.deepEqual((await state("properties-a")).opaque, { keep: "properties-a" });
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-right]").getAttribute("aria-selected")'), "true");
  assert.equal(await evaluate(`${JSON.stringify(["file-properties", "all-properties"])}.flatMap(type=>app.workspace.getLeavesOfType(type)).every(leaf=>leaf.session===null&&!leaf.containerEl.querySelector(".cm-editor"))`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pane("properties-catalog") + ' [data-property-value]')}).textContent`), "2 notes");
  await capture("imported");
  pass("Imported main/sidebar Properties panes retain independent targets, legacy pinning, follow mode, filters, sorts, catalog folds, tab pins and opaque state without hidden editors.");

  await activate("properties-a");
  const titleInput = pane("properties-a") + ' [data-property-key="title"] input';
  await fill(titleInput, "Inline title"); await press("Enter", "Enter", 13);
  await wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(alpha)})).frontmatter.title==="Inline title"`, "inline workspace property save");
  assert.match(await readFile(join(directory, alpha), "utf8"), /amount: 9007199254740993/);
  assert.ok((await readFile(join(directory, alpha), "utf8")).startsWith("\ufeff"));
  await fill(titleInput, "Retained draft"); await evaluate(`globalThis.propertyDraft=document.querySelector(${JSON.stringify(titleInput)});true`);
  const newer = (await readFile(join(directory, alpha), "utf8")).replace("title: Inline title", "title: External title");
  await writeFile(join(directory, alpha), newer); await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(titleInput)})===propertyDraft&&propertyDraft.value==="Retained draft"`), true);
  await press("Enter", "Enter", 13);
  await wait(`document.querySelector(${JSON.stringify(pane("properties-a") + ' [data-property-key="title"] [role=alert]')}).textContent.includes("changed")`, "focused draft retains its original conflict baseline");
  assert.equal(await readFile(join(directory, alpha), "utf8"), newer);
  await press("Escape", "Escape", 27);
  await wait(`document.querySelector(${JSON.stringify(titleInput)}).value==="External title"`, "explicit draft cancellation shows newer metadata");
  const filter = pane("properties-a") + " [data-properties-filter]", sort = pane("properties-a") + " [data-properties-sort]";
  await fill(filter, "project");
  await wait(`document.querySelectorAll(${JSON.stringify(pane("properties-a") + " [data-property-key]")}).length===1`, "actual local property filtering");
  await evaluate(`(()=>{app.metadataTypeManager.trigger("changed");const input=document.querySelector(${JSON.stringify(filter)});input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));})()`);
  await wait(`document.querySelectorAll(${JSON.stringify(pane("properties-a") + " [data-property-key]")}).length===5`, "a queued unchanged-metadata refresh cannot discard the filter redraw");
  await click(sort); await press("Home", "Home", 36); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13);
  await wait(`document.querySelector(${JSON.stringify(pane("properties-a") + " [data-property-key]")}).dataset.propertyKey==="title"`, "actual reverse property sorting");
  assert.equal((await state("properties-b")).query, "title");
  pass("Real workspace inline fields preserve precise YAML/BOM/body bytes. A focused draft survives external metadata refresh and refuses to overwrite a newer value instead of silently rebasing.");

  await click(pane("properties-catalog") + ` [data-property-note="${beta}"]`, 2);
  await wait(`app.workspace.activeLeaf.view.getViewType()==="markdown"&&app.workspace.activeLeaf.view.file?.path===${JSON.stringify(beta)}&&app.workspace.activeLeaf.view.editor.getSelection()==="project"`, "catalog opens and selects the exact YAML key in a new tab");
  assert.equal((await state("properties-a")).file, beta);
  assert.equal((await state("properties-b")).file, beta);
  await setCommunityPluginEnabled({ evaluate, click, wait }, "properties-pane-probe", true); await click(".settings-close");
  await evaluate('app.commands.execute("properties-pane-probe:set-note")');
  assert.deepEqual(await evaluate("propertiesProbe"), { sameApp: true, isItemView: true, sameFile: true, factory: true, editor: true });
  assert.deepEqual(await evaluate('(async()=>{const v=app.workspace.getLeafById("properties-a").view,before=JSON.stringify(v.getState());let refused=false;try{await v.setState({...v.getState(),sort:"invalid"},{})}catch{refused=true}return{refused,same:before===JSON.stringify(v.getState())};})()'), { refused: true, same: true });
  pass("Expanded catalog entries open actual notes and select exact top-level YAML key ranges. A real enabled plugin exercises ItemView/App/file/factory, metadataEditor and guarded setFile; invalid state is atomic.");

  await evaluate('globalThis.oldProperties=app.workspace.getLeafById("properties-a").view;globalThis.oldPropertyControl=oldProperties.contentEl.querySelector("[data-properties-follow]");true');
  const retained = await state("properties-a");
  await evaluate('app.core.setEnabled("properties",false)');
  assert.equal(await evaluate('!oldProperties.isLoaded&&!oldProperties.containerEl.isConnected&&app.workspace.getLeafById("properties-a").view.getViewType()==="unavailable"'), true);
  await evaluate('oldPropertyControl.checked=true;oldPropertyControl.dispatchEvent(new Event("change",{bubbles:true}));true');
  assert.deepEqual(await state("properties-a"), retained);
  assert.equal(await evaluate(`(()=>{try{oldProperties.setFile(app.vault.getFileByPath(${JSON.stringify(beta)}));return false}catch{return true}})()`), true);
  await evaluate('app.core.setEnabled("properties",true)');
  await wait('app.workspace.getLeafById("properties-a").view!==oldProperties&&app.workspace.getLeafById("properties-a").view.isLoaded');
  const betaBytes = await readFile(join(directory, beta));
  await unlink(join(directory, beta)); await evaluate("app.metadataCache.refresh()");
  await wait(`document.querySelector(${JSON.stringify(pane("properties-b") + " [data-properties-status]")}).textContent.includes("missing")`, "deleted fixed target remains explicit");
  assert.equal((await state("properties-b")).file, beta);
  await writeFile(join(directory, beta), betaBytes); await evaluate("app.metadataCache.refresh()");
  await wait(`app.workspace.getLeafById("properties-b").view.file?.path===${JSON.stringify(beta)}`, "recreated fixed target recovers");
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(alpha)}),${JSON.stringify(moved)},true)`);
  await wait(`!app.workspace.isChangingFiles&&app.workspace.getLeafById("properties-a").view.file?.path===${JSON.stringify(moved)}`, "fixed note rename follows actual file identity");
  await evaluate("app.workspace.flushLayout()");
  const ids = ["properties-a", "properties-b", "properties-catalog"], expected = await evaluate(`${JSON.stringify(ids)}.map(id=>app.workspace.getLeafById(id).view.getState())`);
  await restart();
  assert.deepEqual(await evaluate(`${JSON.stringify(ids)}.map(id=>app.workspace.getLeafById(id).view.getState())`), expected);
  assert.deepEqual(await readFile(originalPath), originalBytes);
  await capture("restored");
  pass("Disable/re-enable disposes actual owners and stale controls/APIs cannot retarget replacements. Fixed deleted notes remain missing rather than switching targets; recreation, rename and full restart/reconnection retain independent state and original workspace bytes.");

  await checkPropertyEditing({ ...tools, fill, pass, pane });
  await checkFilePreferences({ ...tools, fill, pass });
  await readonlyProperties({ ...tools, pass });
  report.propertiesPanes = { importedIndependentState: true, inlineConflictGuards: true, exactCatalogNavigation: true, providerCleanup: true, filePreferences: true, cachedReadonly: true };
}

async function checkPropertyEditing({ directory, evaluate, command, click, press, wait, report, fill, pass, pane }) {
  const path = "Property panes/Numbers.md", full = join(directory, path), view = 'app.workspace.getLeafById("properties-a").view';
  const bytes = "\ufeff---\r\nhex: 0x1F\r\noct: 0o17\r\nbig: 12345678901234567890\r\ndec: 1.50\r\ntitle: Num\r\ndone: false\r\nwhen: 2026-01-02\r\ntags:\r\n  - a\r\n  - b\r\n---\r\n# Numbers\r\n";
  await writeFile(full, bytes); await evaluate("app.metadataCache.refresh()");
  await wait(`!!app.vault.getFileByPath(${JSON.stringify(path)})&&!!app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}))?.frontmatter`, "numbers fixture indexed");
  await evaluate(`${view}.setFile(app.vault.getFileByPath(${JSON.stringify(path)}))`);
  const input = key => `${pane("properties-a")} [data-property-key="${key}"] input`, alert = key => `${pane("properties-a")} [data-property-key="${key}"] [role=alert]`;
  const value = key => evaluate(`document.querySelector(${JSON.stringify(input(key))}).value`);
  await click('[data-tab-id="properties-a"]'); await wait(`app.workspace.activeLeaf.id==="properties-a"`);
  await wait(`document.querySelector(${JSON.stringify(input("hex"))})`, "numbers fixture rendered");
  assert.deepEqual([await value("hex"), await value("oct"), await value("big"), await value("dec")], ["0x1F", "0o17", "12345678901234567890", "1.50"]);
  const disk = () => readFile(full, "utf8");
  const saved = async (expected, condition) => {
    await wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}))?.frontmatter?.${condition}`, condition);
    assert.equal(await disk(), expected);
  };

  await click(input("big")); await press("Enter", "Enter", 13); await press("Tab", "Tab", 9);
  assert.equal(await disk(), bytes);
  await fill(input("hex"), "0xZZ"); await press("Enter", "Enter", 13);
  await wait(`document.querySelector(${JSON.stringify(alert("hex"))}).textContent.length>0`, "invalid hex refused");
  assert.equal(await value("hex"), "0xZZ"); assert.equal(await disk(), bytes);
  await fill(input("big"), "12345678901234567891"); await press("Enter", "Enter", 13);
  await wait(`document.querySelector(${JSON.stringify(alert("big"))}).textContent.length>0`, "lossy decimal refused");
  assert.equal(await disk(), bytes);
  await press("Escape", "Escape", 27);
  await wait(`document.querySelector(${JSON.stringify(input("big"))}).value==="12345678901234567890"`, "Escape restores the original literal");
  await press("Escape", "Escape", 27);
  await fill(input("hex"), "0x20"); await press("Enter", "Enter", 13);
  const afterHex = bytes.replace("0x1F", "0x20");
  await saved(afterHex, "hex===32");

  await fill(input("title"), "Composing");
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(input("title"))});el.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));for(const key of ["Enter","Escape"]){el.dispatchEvent(new KeyboardEvent("keydown",{key,keyCode:229,isComposing:true,bubbles:true,cancelable:true}));}return true})()`);
  assert.equal(await value("title"), "Composing"); assert.equal(await disk(), afterHex);
  await evaluate(`document.querySelector(${JSON.stringify(input("title"))}).dispatchEvent(new Event("blur"))`);
  assert.equal(await disk(), afterHex);
  await evaluate(`document.querySelector(${JSON.stringify(input("title"))}).dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}))`);
  await press("Enter", "Enter", 13);
  const afterTitle = afterHex.replace("title: Num", "title: Composing");
  await saved(afterTitle, 'title==="Composing"');
  await fill(input("title"), "Discarded"); await press("Escape", "Escape", 27);
  await wait(`document.querySelector(${JSON.stringify(input("title"))}).value==="Composing"`, "Escape discards text");
  assert.equal(await disk(), afterTitle);
  await fill(input("title"), "Tabbed"); await press("Tab", "Tab", 9);
  const afterTab = afterTitle.replace("title: Composing", "title: Tabbed");
  await saved(afterTab, 'title==="Tabbed"');

  await click(input("done")); const afterDone = afterTab.replace("done: false", "done: true");
  await saved(afterDone, "done===true");
  await fill(input("when"), "2026-02-30"); await press("Enter", "Enter", 13);
  await wait(`document.querySelector(${JSON.stringify(alert("when"))}).textContent.length>0`, "impossible date refused");
  assert.equal(await disk(), afterDone); await press("Escape", "Escape", 27);
  await fill(input("when"), "2026-02-03"); await press("Enter", "Enter", 13);
  const afterDate = afterDone.replace("2026-01-02", "2026-02-03");
  await saved(afterDate, 'when==="2026-02-03"');
  await click(input("tags")); await command("Input.insertText", { text: "c" }); await press("Enter", "Enter", 13);
  await wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)})).frontmatter.tags.includes("c")`, "list entry added");
  assert.ok((await disk()).startsWith("\ufeff---\r\n") && !(await disk()).replaceAll("\r\n", "").includes("\n") && (await disk()).endsWith("# Numbers\r\n"));

  const external = (await disk()).replace("dec: 1.50", "dec: 1.500");
  await writeFile(full, external); await evaluate("app.metadataCache.refresh()");
  await wait(`document.querySelector(${JSON.stringify(input("dec"))}).value==="1.500"`, "literal-only external change refreshes the control");
  await fill(input("title"), "Stale draft");
  await writeFile(full, external.replace("title: Tabbed", "title: Newer")); await evaluate("app.metadataCache.refresh()");
  assert.equal(await value("title"), "Stale draft"); await press("Enter", "Enter", 13);
  await wait(`document.querySelector(${JSON.stringify(alert("title"))}).textContent.includes("changed")`, "stale draft refused");
  assert.ok((await disk()).includes("title: Newer")); await press("Escape", "Escape", 27);

  await fill(input("title"), "Deleted draft"); const before = await disk();
  await unlink(full); await evaluate("app.metadataCache.refresh()");
  await press("Enter", "Enter", 13);
  assert.equal(await evaluate(`app.vault.getFileByPath(${JSON.stringify(path)})`), null);
  await writeFile(full, before); await evaluate("app.vault.refresh().then(()=>app.metadataCache.refresh())");
  await wait(`!!app.vault.getFileByPath(${JSON.stringify(path)})`, "recreated owner");
  await evaluate(`${view}.setFile(app.vault.getFileByPath(${JSON.stringify(path)}))`);
  await wait(`document.querySelector(${JSON.stringify(input("title"))})&&!document.querySelector(${JSON.stringify(input("title"))}).disabled`, "recreated note rendered");
  const renamed = "Property panes/Numbers renamed.md";
  await evaluate(`app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(renamed)},true)`);
  await wait(`!app.workspace.isChangingFiles&&!app.vault.getFileByPath(${JSON.stringify(path)})`, "renamed owner");
  await wait(`document.querySelector(${JSON.stringify(input("title"))})`, "renamed note rendered");
  await fill(input("title"), "After rename"); await press("Enter", "Enter", 13);
  await wait(`app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(renamed)}))?.frontmatter?.title==="After rename"`, "rename follows the file identity");
  assert.equal(await evaluate(`app.vault.getFileByPath(${JSON.stringify(path)})`), null);
  report.propertiesEditing = { literals: true, nonDecimalEdit: true, enterEscapeTabBlur: true, syntheticCompositionGuards: true, physicalImeVerified: false, externalStaleDeletedRenamed: true, scalarListDateCheckbox: true };
  pass("Real scalar/list/date/checkbox Properties controls retain original numeric literals and exact bytes; Enter/Escape/Tab/blur, invalid input, hex edits, literal-only refresh and stale/deleted/renamed owners behave. Composition checks are synthetic, not physical IME.");
}

async function checkFilePreferences({ directory, evaluate, command, click, press, wait, restart, capture, report, fill, pass }) {
  const source = "Preference source/Source.md", inbox = "Preference inbox", appPath = join(directory, ".obsidian", "app.json");
  await mkdir(join(directory, "Preference source")); await mkdir(join(directory, inbox));
  const sourceBytes = Buffer.from("\ufeff# Preferences\r\n\r\n[[Preference missing]]\r\n[[Reading preference missing]]\r\n");
  await writeFile(join(directory, source), sourceBytes); await writeFile(join(directory, inbox, "Untitled.md"), "# Existing name\n");
  const imported = JSON.parse((await readFile(appPath, "utf8")).replace(/^\ufeff/, ""));
  await writeFile(appPath, "\ufeff" + JSON.stringify({ ...imported, newFileLocation: "root", newFileFolderPath: "/", useMarkdownLinks: false, newLinkFormat: "shortest", attachmentFolderPath: "/", futureFilesSetting: { keep: [true, 42] } }, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await evaluate(`(async()=>{await app.vault.refresh();await app.metadataCache.refresh();await app.openFile(${JSON.stringify(source)})})()`);
  const open = async () => { await click("#open-settings"); await click("#files-links-tab"); await wait('document.querySelector("[data-file-settings] [data-setting-key=newFileLocation] select")'); };
  const control = key => `[data-file-settings] [data-setting-key="${key}"]`;
  const choose = async (key, value) => {
    const selector = control(key) + " select", index = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(option=>option.value===${JSON.stringify(value)})`);
    assert.ok(index >= 0); await click(selector); await press("Home", "Home", 36);
    for (let i = 0; i < index; i++) { await press("ArrowDown", "ArrowDown", 40); }
    await press("Enter", "Enter", 13); await wait(`app.vault.getConfig(${JSON.stringify(key)})===${JSON.stringify(value)}`, "preference saved");
  };
  await open(); await choose("newFileLocation", "folder"); await fill(control("newFileFolderPath") + " input", inbox);
  await wait(`app.vault.getConfig("newFileFolderPath")===${JSON.stringify(inbox)}`, "configured note folder");
  await choose("newLinkFormat", "relative"); await click(control("useMarkdownLinks") + " [role=switch]");
  await wait('app.vault.getConfig("useMarkdownLinks")===true');
  await fill(control("attachmentFolderPath") + " input", "./Attachments"); await wait('app.vault.getConfig("attachmentFolderPath")==="./Attachments"');
  await capture("preferences"); await click(".settings-close");
  await press("n", "KeyN", 78, 2); await wait('document.querySelector("#new-note-dialog").open');
  assert.equal(await evaluate('document.querySelector("#new-note-name").value'), "Untitled 1");
  await fill("#new-note-name", "Preference created"); await click("#create-note");
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(inbox + "/Preference created.md")}`, "New note uses configured folder");
  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(source)});await app.commands.execute("outgoing-links:open-view")})()`);
  await wait('document.querySelector("[data-outgoing-reference=\'Preference missing\']")');
  await click('[data-outgoing-reference="Preference missing"]');
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(inbox + "/Preference missing.md")}`, "Outgoing creation uses shared placement");
  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(source)});app.workspace.activeLeaf.view.setMode("preview")})()`);
  await wait('document.querySelector(".workspace-leaf:not([hidden]) [data-slopsidian-link=\'Reading preference missing\']")');
  await click('.workspace-leaf:not([hidden]) [data-slopsidian-link="Reading preference missing"]');
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(inbox + "/Reading preference missing.md")}`, "actual Reading missing-link creation");
  await press("o", "KeyO", 79, 2); await wait('document.querySelector("#desktop-picker").open');
  await command("Input.insertText", { text: "Switcher preference created" }); await click('[data-switcher-create="Switcher preference created"]');
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(inbox + "/Switcher preference created.md")}`, "actual Quick switcher creation uses shared placement");
  await evaluate(`app.workspace.openLinkText("API preference created",${JSON.stringify(source)})`);
  assert.equal(await evaluate("app.workspace.getActiveFile().path"), inbox + "/API preference created.md");
  const generated = await evaluate(`app.fileManager.generateMarkdownLink(app.vault.getFileByPath(${JSON.stringify(inbox + "/Preference created.md")}),${JSON.stringify(source)})`);
  assert.equal(generated, "[Preference created](../Preference%20inbox/Preference%20created.md)");
  assert.deepEqual(await readFile(join(directory, source)), sourceBytes);
  const attachmentNote = "Preference source/Attachment note.md", incoming = join(directory, "Preference input.bin"), attachmentBytes = Buffer.from([0, 255, 128, 13, 10, 7]);
  await writeFile(join(directory, attachmentNote), "# Attachment preference\n\n"); await writeFile(incoming, attachmentBytes);
  await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${JSON.stringify(attachmentNote)});app.workspace.activeLeaf.view.setMode("source");app.editor.setCursor({line:2,ch:0});})()`);
  await command("Page.setInterceptFileChooserDialog", { enabled: true }); await click("#attach-files");
  const { root: document } = await command("DOM.getDocument");
  const { nodeId } = await command("DOM.querySelector", { nodeId: document.nodeId, selector: "[data-attachment-input]" }); assert.ok(nodeId);
  await command("DOM.setFileInputFiles", { nodeId, files: [incoming] }); await wait("!app.attachments.busy", "actual attachment import uses saved preference");
  await evaluate("app.saveAll()");
  assert.deepEqual(await readFile(join(directory, "Preference source/Attachments/Preference input.bin")), attachmentBytes);
  assert.match(await readFile(join(directory, attachmentNote), "utf8"), /\[Preference input\.bin\]\(\.\/Attachments\/Preference%20input\.bin\)/);
  const saved = JSON.parse((await readFile(appPath, "utf8")).replace(/^\ufeff/, ""));
  assert.deepEqual(saved.futureFilesSetting, { keep: [true, 42] }); assert.equal(saved.markdownAutosave, imported.markdownAutosave);
  assert.ok((await readFile(appPath, "utf8")).startsWith("\ufeff"));
  pass("Files and links settings preserve unknown configuration/BOM and drive real New note collision naming, Outgoing, Reading, Quick switcher and workspace API creation, destination-safe Markdown links and exact-byte Attach files placement; original source bytes remain unchanged.");

  await open();
  // Focus inside the page holds its baseline, so the settings poll cannot adopt the external write first.
  assert.equal(await evaluate(`(()=>{const control=document.querySelector(${JSON.stringify(control("useMarkdownLinks") + " [role=switch]")});control.focus();return document.activeElement===control&&document.querySelector("[data-file-settings]").contains(document.activeElement)})()`), true);
  const external = { ...saved, externalFilesSetting: { newer: true }, newLinkFormat: "absolute" }, externalBytes = Buffer.from("\ufeff" + JSON.stringify(external, null, 2) + "\r\n");
  await writeFile(appPath, externalBytes);
  const conflict = "The configuration changed on disk. Reload it before saving; the existing file was retained.";
  const message = await evaluate('document.body.classList.contains("is-browser")') ? "Host 409: " + conflict : "Host 409: " + JSON.stringify({ error: conflict });
  await expectErrors({ evaluate, report }, [{ source: "notification", message }], async () => {
    await click(control("useMarkdownLinks") + " [role=switch]");
    await wait(`document.querySelector(${JSON.stringify(control("useMarkdownLinks") + " [role=alert]")}).textContent.includes("changed on disk")`, "stale settings version refused");
  }, "Retain externally changed Files and links configuration");
  assert.deepEqual(await readFile(appPath), externalBytes);
  await click('[data-file-settings] [role=button]');
  await wait('document.querySelector("[data-setting-key=newLinkFormat] select").value==="absolute"', "explicit settings reload accepts external values");
  await choose("newFileLocation", "current"); await click(".settings-close");
  await evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await evaluate('app.vault.getConfig("newFileLocation")'), "current");
  assert.equal(await evaluate('app.vault.getConfig("newLinkFormat")'), "absolute");
  assert.deepEqual(await evaluate('app.vault.getConfig("externalFilesSetting")'), { newer: true });
  await evaluate(`app.openFile(${JSON.stringify(source)})`); await press("n", "KeyN", 78, 2); await wait('document.querySelector("#new-note-dialog").open');
  await fill("#new-note-name", "Current preference created"); await click("#create-note"); await wait('app.workspace.getActiveFile()?.path==="Preference source/Current preference created.md"');
  pass("Version-guarded Files and links writes refuse external app.json replacements. Explicit Reload recovers, preserves newer unknown data and both-host restart/reconnection restores saved preferences.");
}

async function readonlyProperties({ evaluate, command, click, wait, afterReload, capture, pass }) {
  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href"), browser = await evaluate('document.body.classList.contains("is-browser")');
  const original = {
    main: { id: "ro-properties-main", type: "split", direction: "vertical", children: [
      { id: "ro-properties-tabs", type: "tabs", children: [{ id: "ro-properties", type: "leaf", state: { type: "file-properties", state: { file: "Folder/Source.md", followActiveFile: false } } }] },
      { id: "ro-properties-notes", type: "tabs", children: [note("ro-property-note", "Folder/Source.md")] },
    ] }, active: "ro-property-note",
    right: { id: "ro-property-right", type: "split", direction: "horizontal", width: 320, collapsed: false, children: [{ id: "ro-property-catalog-tabs", type: "tabs", children: [{ id: "ro-property-catalog", type: "leaf", state: { type: "all-properties", state: { query: "title", expandedProperties: ["title"] } } }] }] },
  };
  const fixture = await mountCachedGitHub(evaluate, "readonly-properties", [
    ["Folder/Source.md", "---\ntitle: Remote\nproject: Keep\n---\n# Remote note\n"],
    [".obsidian/workspace.json", JSON.stringify(original)], [".obsidian/core-plugins.json", '["properties","command-palette"]'],
    [".obsidian/community-plugins.json", "[]"], [".obsidian/app.json", '{"useMarkdownLinks":false,"newLinkFormat":"shortest","futureRemote":{"keep":true}}'], [".obsidian/types.json", '{"types":{"title":"text"}}'],
  ]);
  await wait('app.vault.readOnly&&document.querySelector("[data-properties-pane=ro-properties] [data-property-key=title] input")', "real read-only Properties mount");
  assert.equal(await evaluate('document.querySelector("[data-properties-pane=ro-properties] [data-property-key=title] input").disabled'), true);
  assert.equal(await evaluate('document.querySelector("[data-properties-pane=ro-properties] [data-metadata-property-action=add]").disabled'), true);
  assert.equal(await evaluate('document.querySelector("[data-properties-pane=ro-property-catalog] select[data-property-type]").disabled'), true);
  await click('[data-properties-pane="ro-property-catalog"] [data-property-note="Folder/Source.md"]');
  await wait('app.workspace.activeLeaf.view.getViewType()==="markdown"&&app.workspace.activeLeaf.view.editor.getSelection()==="title"', "read-only catalog exact source navigation");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.editor.cm.contentDOM.contentEditable"), "false");
  await click("#open-settings"); await click("#files-links-tab"); await wait('document.querySelector("[data-file-settings] [data-setting-key=useMarkdownLinks] [role=switch]")');
  await click('[data-file-settings] [data-setting-key="useMarkdownLinks"] [role=switch]'); await wait('app.vault.getConfig("useMarkdownLinks")===true'); await click(".settings-close");
  await evaluate("app.workspace.flushLayout()"); await command("Page.reload");
  if (browser) {
    await wait(`document.querySelector("main[data-ready=true]")&&app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&app.workspace.layoutReady&&!app.changingVault`, "cache-only GitHub link reopens without a network request");
  } else { await afterReload(); }
  if (await evaluate("app.vault.rootPath") !== fixture.mount.id) {
    await evaluate(`app.githubVaults.open({url:${JSON.stringify(fixture.mount.repository)},cached:true})`);
    await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault`, "cached Properties preferences reopen");
  }
  assert.equal(await evaluate('app.vault.getConfig("useMarkdownLinks")'), true);
  assert.deepEqual(await evaluate('app.vault.getConfig("futureRemote")'), { keep: true });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  assert.deepEqual(await evaluate('(()=>{const s=app.githubVaults.state();return{api:s.counters.api,raw:s.counters.raw}})()'), { api: 0, raw: 0 });
  await capture("readonly");
  pass("Genuine cache-only GitHub Properties panes expose disabled file/type writes and exact read-only Source navigation. Files and links changes persist only in the local overlay across reload with zero API/raw requests and unchanged cached content/configuration blobs.");
  await command("Page.navigate", { url: pageUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
}
