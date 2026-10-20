import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";

const fixturePlugin = `const {Plugin,FileView}=require("obsidian");
module.exports=class extends Plugin{onload(){
 this.registerView("explorer-probe",leaf=>new class extends FileView{
  getViewType(){return "explorer-probe";}getDisplayText(){return this.file?.name||"Explorer probe";}
  async onLoadFile(file){this.bodyEl.textContent=await this.app.vault.read(file);}
 }(leaf));this.registerExtensions(["explorerprobe"],"explorer-probe");
 this.registerEvent(this.app.workspace.on("file-menu",(menu,file)=>menu.addItem(item=>item.setTitle("Explorer menu probe").onClick(()=>{globalThis.explorerMenuPath=file.path;}))));
}};`;

export async function checkFileExplorer({ directory, evaluate, command, click, press, wait, report, restart, afterReload, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const root = fileURLToPath(new URL("../", import.meta.url)), prefix = "Explorer demo", project = prefix + "/Projects";
  const originalPath = join(directory, ".obsidian/workspace.json"), savedPath = join(directory, ".obsidian/vault-dotnet-workspace.json");
  const notePath = project + "/Note 2.md", otherPath = project + "/Note 10.md", attachmentPath = prefix + "/Attachment.explorerprobe";
  const noteBytes = Buffer.from("\ufeff# Note 2\r\n\r\nUnicode λ and 中文.\r\n"), otherBytes = Buffer.from("# Note 10\n\n[[Note 2]]\n"), attachmentBytes = Buffer.from("A file view registered after the explorer opened.\n");
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  await mkdir(join(directory, project), { recursive: true }); await mkdir(join(directory, prefix, "Empty"));
  await writeFile(join(directory, notePath), noteBytes); await writeFile(join(directory, otherPath), otherBytes);
  await writeFile(join(directory, attachmentPath), attachmentBytes); await writeFile(join(directory, prefix, "Notes & λ.md"), "# Safe label\n");
  const probe = join(directory, ".obsidian/plugins/explorer-probe"); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, "manifest.json"), JSON.stringify({ id: "explorer-probe", name: "Explorer probe", version: "1.0.0", minAppVersion: "1.0.0", author: "Slopsidian smoke", description: "Disposable extension and context-menu lifecycle probe.", isDesktopOnly: false }));
  await writeFile(join(probe, "main.js"), fixturePlugin);
  const iconize = join(directory, ".obsidian/plugins/obsidian-icon-folder");
  await cp(join(root, "Example/.obsidian/plugins/obsidian-icon-folder"), iconize, { recursive: true, force: false, errorOnExist: true });
  const iconizeManifest = JSON.parse(await readFile(join(iconize, "manifest.json"), "utf8")); assert.equal(iconizeManifest.version, "2.14.7");
  const iconizeSettings = JSON.parse(await readFile(join(iconize, "data.json"), "utf8"));
  Object.assign(iconizeSettings.settings, { rules: [], iconInTabsEnabled: false, iconInTitleEnabled: false, iconsBackgroundCheckEnabled: false });
  iconizeSettings[project] = "🌱"; iconizeSettings[notePath] = "📝";
  await writeFile(join(iconize, "data.json"), JSON.stringify(iconizeSettings));
  const iconizeInputs = {}; for (const name of ["main.js", "manifest.json", "styles.css"]) { iconizeInputs[name] = createHash("sha256").update(await readFile(join(iconize, name))).digest("hex"); }
  const explorer = (id, state = {}) => ({ id, type: "leaf", pinned: true, state: { type: "file-explorer", state: { sortOrder: "alphabetical", opaque: { kept: id }, ...state } } });
  const original = { main: { id: "explorer-main", type: "split", direction: "vertical", children: [
    { id: "explorer-tabs", type: "tabs", dimension: 37, currentTab: 0, children: [explorer("explorer-a", { collapsedFolders: [project] }), explorer("explorer-b", { sortOrder: "alphabeticalReverse", showSearch: true, searchQuery: "Note 10" })] },
    { id: "explorer-note-tabs", type: "tabs", dimension: 63, children: [{ id: "explorer-note", type: "leaf", pinned: true, state: { type: "markdown", state: { file: notePath, mode: "source", source: true } } }] },
  ] }, active: "explorer-note", left: { id: "explorer-left", type: "split", direction: "horizontal", width: 295, children: [{ id: "explorer-side-tabs", type: "tabs", children: [explorer("explorer-side")] }] },
  right: { id: "explorer-right", type: "split", direction: "horizontal", width: 240, collapsed: true, children: [] } };
  const originalBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  await restart(async () => { await writeFile(originalPath, originalBytes); await unlink(savedPath).catch(error => { if (error.code !== "ENOENT") { throw error; } }); });
  const pane = id => `[data-file-explorer="${id}"]`, row = (id, path) => `${pane(id)} [data-explorer-path=${JSON.stringify(path)}]`;
  const state = id => evaluate(`app.workspace.getLeafById(${JSON.stringify(id)}).view.getState()`);
  await wait('app.workspace.getLeafById("explorer-side")?.view.getViewType()==="file-explorer"&&app.workspace.getLeafById("explorer-a")?.view.getViewType()==="file-explorer"&&!app.core.busy', "real imported Files panes");
  await wait(`${JSON.stringify(pane("explorer-a"))}&&document.querySelector(${JSON.stringify(pane("explorer-a") + " select")})?.disabled===false`, "interactive Files controls");
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-left]").getAttribute("aria-selected")'), "true");
  assert.equal(await evaluate('app.workspace.getLeafById("explorer-a").pinned'), true);
  assert.equal(await evaluate('app.workspace.getLeafById("explorer-note").view.editor.getValue()'), noteBytes.toString("utf8").slice(1));
  assert.deepEqual((await state("explorer-a")).opaque, { kept: "explorer-a" });
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(row("explorer-a", otherPath))}))`), false);
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(row("explorer-side", otherPath))}))`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row("explorer-side", prefix + "/Empty"))}).hasAttribute("aria-expanded")`), false);
  pass("A first-open original layout restores real, pinned Files views in main tabs and a visible sidebar, independent folding/filter/sort and opaque state, alongside an intact Source note.");
  await capture("imported");
  await evaluate('app.workspace.getLeafById("explorer-note").setPinned(false)');
  await click('[data-tab-id="explorer-b"]'); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pane("explorer-b") + " input")}).value`), "Note 10");
  await click('[data-tab-id="explorer-a"]');

  await click(row("explorer-a", project));
  await wait(`Boolean(document.querySelector(${JSON.stringify(row("explorer-a", otherPath))}))`, "unfolded project");
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(pane("explorer-a") + ' [data-explorer-path]')})).map(e=>e.dataset.explorerPath).filter(p=>p.startsWith(${JSON.stringify(project + "/")}))`), [notePath, otherPath]);
  await click(`${pane("explorer-a")} select`); await press("Home", "Home", 36); await press("ArrowDown", "ArrowDown", 40); await press("Enter", "Enter", 13);
  await wait('app.workspace.getLeafById("explorer-a").view.getState().sortOrder==="alphabeticalReverse"');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(pane("explorer-a") + ' [data-explorer-path]')})).map(e=>e.dataset.explorerPath).filter(p=>p.startsWith(${JSON.stringify(project + "/")}))`), [otherPath, notePath]);
  await click(`${pane("explorer-a")} select`); await press("Home", "Home", 36); await press("Enter", "Enter", 13);
  await wait('app.workspace.getLeafById("explorer-a").view.getState().sortOrder==="alphabetical"');
  await evaluate(`document.querySelector(${JSON.stringify(row("explorer-a", project))}).focus()`);
  await press("ArrowRight", "ArrowRight", 39); assert.equal(await evaluate("document.activeElement.dataset.explorerPath"), notePath);
  await press("ArrowLeft", "ArrowLeft", 37); assert.equal(await evaluate("document.activeElement.dataset.explorerPath"), project);
  await press("ArrowLeft", "ArrowLeft", 37); await wait(`document.querySelector(${JSON.stringify(row("explorer-a", project))}).getAttribute("aria-expanded")==="false"`);
  await press("ArrowRight", "ArrowRight", 39);
  await click(`${pane("explorer-a")} [data-explorer-action=search]`);
  await command("Input.insertText", { text: "NOTE 10" }); await wait(`document.querySelector(${JSON.stringify(pane("explorer-a") + ' [data-explorer-search]')}).value==="NOTE 10"`);
  await wait(`!document.querySelector(${JSON.stringify(row("explorer-a", notePath))})&&document.querySelector(${JSON.stringify(row("explorer-a", otherPath))})`);
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(row("explorer-side", notePath))}))`), true);
  await click(row("explorer-a", otherPath)); await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(otherPath)}`);
  assert.equal(await evaluate('app.workspace.getLeafById("explorer-a").view.getViewType()'), "file-explorer");
  await click(`${pane("explorer-a")} [data-explorer-action=reveal]`);
  assert.equal((await state("explorer-a")).searchQuery, "");
  await click(`${pane("explorer-a")} [data-explorer-action=auto-reveal]`);
  await evaluate(`app.workspace.getLeafById("explorer-note").openFile(app.vault.getFileByPath(${JSON.stringify(notePath)}))`);
  await evaluate('app.workspace.getLeafById("explorer-note").view.focus()');
  await wait(`document.querySelector(${JSON.stringify(row("explorer-a", notePath))}).getAttribute("aria-selected")==="true"`);
  assert.equal(await evaluate('Boolean(document.activeElement.closest(".cm-editor"))'), true);
  pass("Real pointer and keyboard navigation unfolds folders, filters paths case-insensitively without changing another pane, opens files without replacing a pinned explorer, and reveals the active note without stealing editor focus.");

  await click(row("explorer-a", attachmentPath));
  await wait(`document.querySelector(${JSON.stringify(pane("explorer-a") + ' [role=status]')}).textContent.includes("compatible view plugin")`, "unsupported extension explanation stays visible");
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(pane("explorer-a") + ' [role=status]')}).textContent`), /compatible view plugin/);
  assert.equal(await evaluate('app.workspace.getActiveFile().path'), notePath);
  await setCommunityPluginEnabled({ evaluate, click, wait }, "explorer-probe", true); await click(".settings-close");
  await wait(`!document.querySelector(${JSON.stringify(row("explorer-a", attachmentPath))}).hasAttribute("aria-disabled")`, "late extension provider updates rows");
  await click(row("explorer-a", attachmentPath), 2);
  await wait('app.workspace.activeLeaf.view.getViewType()==="explorer-probe"', "registered attachment view");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.bodyEl.textContent"), attachmentBytes.toString());
  assert.equal(await evaluate('app.workspace.getLeafById("explorer-note").view.file.path'), notePath);
  await click('[data-tab-id="explorer-a"]');
  await evaluate(`document.querySelector(${JSON.stringify(row("explorer-a", attachmentPath))}).focus()`); await press("F10", "F10", 121, 8);
  await wait('Array.from(document.querySelectorAll(".menu-item")).some(e=>e.textContent.includes("Explorer menu probe"))', "file-menu plugin contribution");
  await evaluate('document.querySelectorAll(".menu-item").forEach(e=>{if(e.textContent.includes("Explorer menu probe"))e.dataset.explorerMenuProbe="true"})');
  await click("[data-explorer-menu-probe]"); assert.equal(await evaluate("globalThis.explorerMenuPath"), attachmentPath);
  pass("Unsupported attachments remain browsable without errors; enabling an actual fixture plugin updates existing panes and opens its FileView through Ctrl-click. Keyboard context menus deliver the real file-menu event.");

  await click(`${pane("explorer-a")} [data-explorer-action=new-folder]`); await wait('document.querySelector("[data-file-dialog=folder]")');
  await click('[data-file-field=path]'); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: prefix + "/Created in Files" }); await click('[data-file-dialog=folder] [data-file-action=folder]');
  await wait(`app.vault.getFolderByPath(${JSON.stringify(prefix + "/Created in Files")})&&!app.workspace.isChangingFiles`);
  await wait(`!document.querySelector(${JSON.stringify(pane("explorer-a") + " select")}).disabled`, "file operation releases controls");
  await writeFile(join(directory, project, "External.md"), "# External\n");
  await click(`${pane("explorer-a")} [data-explorer-action=refresh]`);
  await wait(`Boolean(document.querySelector(${JSON.stringify(row("explorer-a", project + "/External.md"))}))`, "genuine external filesystem refresh");
  await evaluate('app.workspace.setActiveLeaf(app.workspace.getLeafById("explorer-note"));app.workspace.activeLeaf.view.focus()');
  await command("Input.insertText", { text: "Dirty " });
  const dirty = await evaluate('app.workspace.getLeafById("explorer-note").view.editor.getValue()');
  await click(`${pane("explorer-a")} [data-explorer-action=collapse]`); await click(`${pane("explorer-a")} [data-explorer-action=expand]`);
  assert.equal(await evaluate('app.workspace.getLeafById("explorer-note").view.editor.getValue()'), dirty); assert.deepEqual(await readFile(join(directory, notePath)), noteBytes);
  await evaluate('app.saveAll()');
  pass("Files creates a real folder through the guarded dialog, re-enables controls after mutation, observes an external file on Refresh, and leaves a live unsaved editor and its disk bytes intact while folding panes.");

  await setCommunityPluginEnabled({ evaluate, click, wait }, "obsidian-icon-folder", true); await click(".settings-close");
  await wait(`document.querySelector(${JSON.stringify(row("explorer-a", project) + " .iconize-icon")})?.textContent.includes("🌱")&&document.querySelector(${JSON.stringify(row("explorer-a", notePath) + " .iconize-icon")})?.textContent.includes("📝")`, "unchanged Iconize renders configured folder and file emoji");
  await click(`${pane("explorer-a")} [data-explorer-action=collapse]`); await click(`${pane("explorer-a")} [data-explorer-action=expand]`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row("explorer-a", notePath) + " .iconize-icon")}).textContent.includes("📝")`), true);
  await wait('!app.plugins.isManaging');
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  for (const [name, sha] of Object.entries(iconizeInputs)) { assert.equal(createHash("sha256").update(await readFile(join(iconize, name))).digest("hex"), sha); }
  report.fileExplorer = { iconize: { version: iconizeManifest.version, sha256: iconizeInputs, scope: "unchanged package startup and configured file/folder emoji retained through fold/expand; broader private tree, rule and icon-assignment workflows remain unverified" } };
  pass("Unchanged Iconize 2.14.7 renders configured folder/file emoji on real materialized rows and retains them through folding with clean diagnostics; broader private tree and assignment workflows remain unverified.");

  await evaluate('globalThis.closedExplorer=app.workspace.getLeafById("explorer-a").view;globalThis.closedExplorerSort=closedExplorer.contentEl.querySelector("select");true');
  const beforeDisable = await state("explorer-a");
  await evaluate('app.core.setEnabled("file-explorer",false)');
  assert.equal(await evaluate('app.workspace.getLeafById("explorer-a").view.getViewType()'), "unavailable");
  assert.equal(await evaluate('app.workspace.getLeavesOfType("file-explorer").length'), 0);
  assert.deepEqual(await state("explorer-a"), beforeDisable);
  assert.equal(await evaluate('Boolean(app.commands.listCommands().find(c=>c.id==="file-explorer:open-view"))'), false);
  assert.equal(await evaluate('!closedExplorer.isLoaded&&!closedExplorer.containerEl.isConnected'), true);
  await evaluate('closedExplorerSort.value="byCreatedTime";closedExplorerSort.dispatchEvent(new Event("change",{bubbles:true}));true');
  assert.deepEqual(await state("explorer-a"), beforeDisable);
  await evaluate('app.core.setEnabled("file-explorer",true)');
  await wait('app.workspace.getLeafById("explorer-a").view.getViewType()==="file-explorer"&&!app.core.busy');
  assert.equal(await evaluate('app.workspace.getLeafById("explorer-a").view!==closedExplorer'), true);
  assert.deepEqual(await state("explorer-a"), beforeDisable);
  pass("Disabling Files closes and unloads its real views, retains exact saved/opaque state in unavailable panes and removes commands. Detached controls are inert; re-enabling creates fresh live owners with restored state.");

  await evaluate('app.workspace.flushLayout()');
  const states = await evaluate('["explorer-a","explorer-b","explorer-side"].map(id=>app.workspace.getLeafById(id).view.getState())');
  await restart();
  assert.deepEqual(await evaluate('["explorer-a","explorer-b","explorer-side"].map(id=>app.workspace.getLeafById(id).view.getState())'), states);
  assert.deepEqual(await readFile(originalPath), originalBytes);
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=workspace-left]").getAttribute("aria-selected")'), "true");
  await click('[data-sidebar-view=file-explorer]'); await evaluate('app.workspace.flushLayout()'); await restart();
  assert.equal(await evaluate('document.querySelector("[data-sidebar-view=file-explorer]").getAttribute("aria-selected")'), "true");
  await click('[data-sidebar-view=workspace-left]');
  await press("p", "KeyP", 80, 2); await wait('document.querySelector("#desktop-picker").open'); await command("Input.insertText", { text: "Open Files in a tab" }); await click('[data-command-id="file-explorer:open-view"]');
  await wait('app.workspace.activeLeaf.view.getViewType()==="file-explorer"', "actual Open Files command");
  await capture("restored");
  pass("A full restart/reconnect restores independent states, pins, late providers and original source bytes; an explicit legacy sidebar choice wins on later reconnect. The command palette opens a fresh Files tab.");
  await checkReadOnly({ evaluate, command, click, press, wait, report, afterReload, capture });
  assert.deepEqual(await readFile(join(directory, otherPath)), otherBytes); assert.deepEqual(await readFile(join(directory, attachmentPath)), attachmentBytes); assert.deepEqual(await readFile(originalPath), originalBytes);
}

async function checkReadOnly({ evaluate, command, click, wait, report, afterReload, capture }) {
  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href"), repository = "slopsidian-fixtures/readonly-files-" + Date.now();
  const mount = { repository, ref: "main", folder: "", commit: "b".repeat(40), savedAt: Date.now(), files: [], configurationFiles: [] };
  mount.id = "github-vault:" + encodeURIComponent(JSON.stringify([repository, "main", ""]));
  const original = { main: { id: "readonly-main", type: "split", direction: "vertical", children: [{ id: "readonly-tabs", type: "tabs", children: [{ id: "readonly-files", type: "leaf", state: { type: "file-explorer", state: {} } }] }] }, active: "readonly-files" };
  const inputs = [["Folder/Read me.md", "# Cached note\n"], [".obsidian/core-plugins.json", '["file-explorer","command-palette"]'], [".obsidian/community-plugins.json", "[]"], [".obsidian/workspace.json", JSON.stringify(original)]];
  const blobs = inputs.map(([path, text]) => { const bytes = Buffer.from(text), sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); (path.startsWith(".obsidian/") ? mount.configurationFiles : mount.files).push({ path, repositoryPath: path, sha, size: bytes.length }); return { key: "blob:" + sha, base64: bytes.toString("base64") }; });
  await evaluate(`(async()=>{const r=indexedDB.open("slopsidian-github-vault-v1",1);r.onupgradeneeded=()=>r.result.createObjectStore("entries",{keyPath:"key"});const db=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});try{await new Promise((ok,no)=>{const tx=db.transaction("entries","readwrite"),s=tx.objectStore("entries");for(const b of ${JSON.stringify(blobs)})s.put({key:b.key,value:Uint8Array.from(atob(b.base64),c=>c.charCodeAt(0)).buffer});s.put({key:${JSON.stringify("mount:" + mount.id)},value:${JSON.stringify(mount)}});tx.oncomplete=()=>ok();tx.onerror=tx.onabort=()=>no(tx.error);});}finally{db.close();}await app.githubVaults.open({url:${JSON.stringify(repository)},cached:true});})()`);
  await wait(`app.vault.rootPath===${JSON.stringify(mount.id)}&&!app.changingVault&&app.workspace.getLeafById("readonly-files")?.view.getViewType()==="file-explorer"`, "genuine read-only cache-only GitHub Files import");
  assert.equal(await evaluate("app.vault.readOnly"), true);
  assert.equal(await evaluate('document.querySelector("[data-file-explorer=readonly-files] [data-explorer-action=new-note]").disabled&&document.querySelector("[data-file-explorer=readonly-files] [data-explorer-action=new-folder]").disabled'), true);
  await click('[data-file-explorer=readonly-files] [data-explorer-path="Folder/Read me.md"]'); await wait('app.workspace.getActiveFile()?.path==="Folder/Read me.md"');
  assert.equal(await evaluate("app.workspace.activeLeaf.view.editor.getValue()"), "# Cached note\n");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.editor.cm.contentDOM.contentEditable"), "false");
  await click('[data-tab-id="readonly-files"]');
  await click('[data-file-explorer=readonly-files] [data-explorer-action=collapse]');
  await evaluate("app.workspace.flushLayout()");
  assert.deepEqual(await evaluate('app.workspace.getLeafById("readonly-files").view.getState().collapsedFolders'), ["Folder"]);
  const state = await evaluate("app.githubVaults.state()"); assert.equal(state.counters.api, 0); assert.equal(state.counters.raw, 0);
  for (const blob of blobs) {
    const saved = await evaluate(`(async()=>{const r=indexedDB.open("slopsidian-github-vault-v1",1),db=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});try{const r=db.transaction("entries").objectStore("entries").get(${JSON.stringify(blob.key)}),v=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result.value);r.onerror=()=>no(r.error);});return btoa(String.fromCharCode(...new Uint8Array(v)));}finally{db.close();}})()`);
    assert.equal(saved, blob.base64);
  }
  await capture("readonly");
  await command("Page.navigate", { url: pageUrl }); await afterReload(); assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  report.fileExplorer.readOnly = { genuineCacheOnlyMount: true, importedFilesPane: true, noteOpened: true, mutationControlsDisabled: true, viewPreferencesPersisted: true, allBlobsUnchanged: true, counters: state.counters, returnedToLocal: true };
  report.checks.push("A genuine cache-only GitHub vault imports a live Files pane, opens cached Markdown read-only, disables mutations, saves folder preferences independently with zero network requests, and preserves every remote blob through return to the local vault.");
}
