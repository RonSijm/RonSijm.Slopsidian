import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

// Real native/WASM acceptance for reviewed theme management: lifecycle-owned external watching with safe adoption,
// explicit reviewed catalog install/update, and in-place re-theming of Mermaid diagrams.
// The catalog transport is a page-level fixture (`app.appearance.fetcher`): the real CORS download from
// raw.githubusercontent.com is a documented external/browser limitation and is not claimed by this scenario.
export const appearanceThemeVerificationPaths = [
  join("tools", "appearance-theme-scenarios.mjs"), join("tools", "appearance-reader-theme-scenarios.mjs"), join("tools", "cached-github-fixture.mjs"), join("tools", "appearance-live-fetch.mjs"), join("tools", "smoke.mjs"), join("tools", "web-smoke.mjs"), join("tools", "error-log-audit.mjs"),
  join("client", "appearance.ts"), join("client", "appearance-catalog.ts"), join("client", "appearance-assets.ts"), join("client", "appearance-model.ts"), join("client", "mermaid-renderer.ts"),
  join("client", "web-reader-frame.ts"), join("client", "web-viewer.ts"), join("client", "browser-vault.ts"), join("client", "github-vault.ts"),
  join("src", "RonSijm.Slopsidian", "Program.cs"), join("src", "RonSijm.Slopsidian", "Services", "VaultService.AppearanceTheme.cs"), join("src", "RonSijm.Slopsidian", "Services", "AppearanceCssPolicy.cs"),
  ...["appearance", "appearance-watcher", "appearance-catalog", "editor-history-selection", "files", "browser-vault", "github-vault", "web-reader-appearance"].map(name => join("tests", name + ".test.mjs")),
];

const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export async function checkAppearanceThemes(tools) {
  const { directory, evaluate, click, press, wait, report, readRequests } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const preferencesPath = join(directory, ".obsidian", "appearance.json");
  const put = async (path, bytes) => { const full = join(directory, ...path.split("/")); await mkdir(dirname(full), { recursive: true }); await writeFile(full, bytes); };
  const accent = () => evaluate('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()');
  const css = color => `.theme-dark,.theme-light{--text-accent:${color}}\n`;
  const original = await readFile(preferencesPath).catch(() => null);
  const base = JSON.parse((original?.toString("utf8") ?? "{}").replace(/^\ufeff/, "") || "{}");
  const writePreferences = value => writeFile(preferencesPath, "\ufeff" + JSON.stringify({ ...base, ...value }, null, 2));
  const until = (expression, label) => wait(expression, label);
  // Failure diagnostics are an expected, accounted outcome here; each one must match the stated pattern.
  const expectFailure = async (pattern, action, reason) => {
    const before = new Set((await evaluate("slopsidianDiagnostics.current()")).map(record => record.id));
    await action();
    let added = [];
    for (const deadline = Date.now() + 12000; Date.now() < deadline;) {
      added = (await evaluate("slopsidianDiagnostics.current()")).filter(record => !before.has(record.id));
      if (added.length) { break; }
      await delay(100);
    }
    await delay(1200);
    added = (await evaluate("slopsidianDiagnostics.current()")).filter(record => !before.has(record.id));
    assert.ok(added.length >= 1, "Expected a reported failure while " + reason);
    for (const record of added) {
      assert.match(record.error.message, pattern, reason);
      (report.expectedDiagnostics ??= []).push({ id: record.id, source: record.source, message: record.error.message, reason });
    }
  };
  const row = async name => {
    await evaluate(`(()=>{const row=Array.from(document.querySelectorAll("[data-appearance-settings] .setting-item")).find(r=>r.querySelector(".setting-item-name")?.textContent===${JSON.stringify(name)});if(!row)throw new Error("Missing setting row "+${JSON.stringify(name)});row.dataset.smokeThemeRow="";})()`);
    await click("[data-smoke-theme-row]");
    await evaluate('document.querySelectorAll("[data-smoke-theme-row]").forEach(r=>delete r.dataset.smokeThemeRow)');
  };
  const hasRow = name => evaluate(`Array.from(document.querySelectorAll("[data-appearance-settings] .setting-item-name")).some(n=>n.textContent===${JSON.stringify(name)})`);
  const open = async () => { await click("#open-settings"); await click("#appearance-tab"); await wait('document.querySelector("[data-appearance-settings] [data-setting-key=theme] select")', "Appearance controls"); };

  // 1. Nothing downloads at startup.
  assert.deepEqual(readRequests().filter(url => /raw\.githubusercontent\.com|community-css-themes/.test(url)), [], "No theme catalog may be requested at startup");
  pass("No community-theme catalog or theme download request was made at startup.");

  // Editor state that every adoption/failure below must preserve.
  const note = "Theme management note.md", noteText = "Keep this text, selection and undo through theme changes.\n";
  await put(note, noteText);
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await evaluate(`(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(note)});await app.workspace.getLeaf(false).openFile(file);})()`);
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "theme note open");
  await evaluate('(()=>{const leaf=app.workspace.activeLeaf,view=leaf.view,cm=view.editor.cm;cm.dispatch({changes:{from:0,insert:"Unsaved "},selection:{anchor:2,head:9}});globalThis.themeEditor={leaf,view,file:view.file,cm,doc:cm.state.doc.toString()};return true})()');
  const editorPredicates = () => evaluate("(()=>{const {leaf,view,file,cm,doc}=themeEditor,s=cm.state.selection.main;return{workspaceLeaf:leaf.workspace===app.workspace&&app.workspace.leaves().includes(leaf),view:leaf.view===view,file:view.file===file&&app.vault.getFileByPath(file.path)===file,cm:view.editor.cm===cm,connected:cm.dom.isConnected,text:cm.state.doc.toString()===doc,selection:[s.from,s.to],doc:cm.state.doc.toString()}})()");
  const identityHeld = p => p.workspaceLeaf && p.view && p.file && p.cm && p.connected;
  const editorRetained = async () => { const p = await editorPredicates(); return identityHeld(p) && p.text && p.selection[0] === 2 && p.selection[1] === 9; };
  const editorPhases = report.editorPhases = [];
  const recordEditor = async phase => { const p = await editorPredicates(); editorPhases.push({ phase, ...p }); return p; };

  // 2. External theme + preferences adoption.
  await put(".obsidian/themes/Watched/theme.css", css("#112233"));
  await writePreferences({ cssTheme: "Watched", enabledCssSnippets: [], allowLocalResources: false });
  await until('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()==="#112233"', "externally selected theme adopted without reload");
  assert.equal(await editorRetained(), true);
  pass("An external appearance.json theme selection is adopted by the lifecycle-owned watcher without reload, retaining the unsaved editor text, selection and CM instance.");

  // 3. External theme CSS edit and snippet creation.
  await put(".obsidian/themes/Watched/theme.css", css("#445566"));
  const watchedPath = join(directory, ".obsidian", "themes", "Watched", "theme.css");
  try { await until('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()==="#445566"', "externally edited theme CSS re-read"); }
  catch (error) {
    const disk = await stat(watchedPath);
    const state = await evaluate('({accent:getComputedStyle(document.body).getPropertyValue("--text-accent").trim(),hidden:document.hidden,styles:Array.from(document.querySelectorAll("style[data-appearance-style]"),s=>s.dataset.appearanceStyle+":"+s.textContent.length)})');
    throw new Error(`Watcher diagnostic: disk mtime=${disk.mtimeMs} size=${disk.size}; page=${JSON.stringify(state)}; ${error.message}`, { cause: error });
  }
  await put(".obsidian/snippets/Watched snippet.css", "body{--theme-snippet-probe:1}\n");
  await writePreferences({ cssTheme: "Watched", enabledCssSnippets: ["Watched snippet"], allowLocalResources: false });
  await until('getComputedStyle(document.body).getPropertyValue("--theme-snippet-probe").trim()==="1"', "externally enabled snippet adopted");
  assert.equal(await editorRetained(), true);
  pass("External theme-CSS edits and newly enabled snippets are re-read and applied while the editor state is retained.");

  // 4. Invalid external states keep the accepted styles and trusted CSS.
  const accepted = await evaluate('Array.from(document.querySelectorAll("style[data-appearance-style]"),s=>s.textContent)');
  await expectFailure(/./, async () => { await writeFile(preferencesPath, "{ not json"); }, "an external appearance.json is malformed");
  assert.equal(await accent(), "#445566");
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("style[data-appearance-style]"),s=>s.textContent)'), accepted);
  await expectFailure(/import|self-contained|Imports/i, async () => { await put(".obsidian/themes/Watched/theme.css", '@import "https://example.invalid/x.css";'); }, "an external theme CSS becomes unsupported");
  assert.equal(await accent(), "#445566");
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("style[data-appearance-style]"),s=>s.textContent)'), accepted);
  assert.equal(await editorRetained(), true);
  await put(".obsidian/themes/Watched/theme.css", css("#778899"));
  await writePreferences({ cssTheme: "Watched", enabledCssSnippets: ["Watched snippet"], allowLocalResources: false });
  await until('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()==="#778899"', "recovery after valid external files");
  pass("Malformed external appearance.json and unsupported external CSS are reported, retain the exact accepted styles and editor state, and later valid files are adopted.");

  // 5. Reviewed catalog install/update through the real settings UI (fixture transport; no automatic download).
  const manifest = Buffer.from(JSON.stringify({ name: "Reviewed", version: "1.0.0", author: "Fixture", future: { keep: true } }));
  const cssV1 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(css("#0a0b0c").replace("\n", "\r\n"))]), cssV2 = Buffer.from(css("#0d0e0f"));
  await evaluate(`(()=>{
    const files=new Map([["https://raw.githubusercontent.com/fixture/reviewed-theme/HEAD/theme.css",{bytes:"${cssV1.toString("base64")}"}],["https://raw.githubusercontent.com/fixture/reviewed-theme/HEAD/manifest.json",{bytes:"${manifest.toString("base64")}"}],
      ["https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json",{text:JSON.stringify([{name:"Reviewed",author:"Fixture",repo:"fixture/reviewed-theme",modes:["dark","light"]}])}]]);
    globalThis.themeFetches=[];globalThis.themeFiles=files;
    app.appearance.fetcher=async(url,init)=>{themeFetches.push({url,mode:init.mode,credentials:init.credentials});const entry=files.get(url);if(!entry)return new Response("missing",{status:404});
      return new Response(entry.text!==undefined?entry.text:Uint8Array.from(atob(entry.bytes),c=>c.charCodeAt(0)),{status:200})};
    return true})()`);
  await open();
  assert.equal(await evaluate("themeFetches.length"), 0, "Opening Appearance must not download anything");
  assert.equal(await hasRow("Reviewed"), false);
  await row("Browse official community themes");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.includes("Loaded 1 official community themes")', "explicit catalog browse");
  assert.deepEqual(await evaluate("themeFetches.map(f=>[f.url,f.mode,f.credentials])"), [["https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json", "cors", "omit"]]);
  await row("Reviewed");
  await wait('document.querySelector("[data-appearance-reviewed=Reviewed]")', "reviewed theme details");
  const details = await evaluate('document.querySelector("[data-appearance-reviewed=Reviewed]").textContent');
  assert.match(details, new RegExp(sha(cssV1).slice(0, 16)));
  await assert.rejects(readFile(join(directory, ".obsidian", "themes", "Reviewed", "theme.css")), { code: "ENOENT" }, "Review must not install");
  assert.equal(await evaluate('app.appearance.getControlValue("cssTheme")'), "Watched");
  await row("Install Reviewed from the reviewed files");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.startsWith("Installed Reviewed")', "reviewed install result");
  assert.deepEqual(await readFile(join(directory, ".obsidian", "themes", "Reviewed", "theme.css")), cssV1);
  assert.deepEqual(await readFile(join(directory, ".obsidian", "themes", "Reviewed", "manifest.json")), manifest);
  assert.equal(await evaluate('app.appearance.getControlValue("cssTheme")'), "Watched", "Install must not select the theme");
  assert.equal(await accent(), "#778899");
  assert.equal(await editorRetained(), true);
  pass("Browsing and reviewing are explicit; installing writes the exact reviewed BOM/CRLF bytes and manifest, does not select the theme and leaves the active styles and editor untouched.");

  // 6. Update after the local file changed: stale reviews refuse, a fresh review updates.
  const local = Buffer.from(css("#abcdef")), later = Buffer.from(css("#fedcba"));
  await put(".obsidian/themes/Reviewed/theme.css", local);
  await evaluate(`themeFiles.set("https://raw.githubusercontent.com/fixture/reviewed-theme/HEAD/theme.css",{bytes:"${cssV2.toString("base64")}"});true`);
  await row("Reviewed");
  await wait('document.querySelector("[data-appearance-reviewed=Reviewed]")?.textContent.includes("differs from installed")', "review of update");
  await put(".obsidian/themes/Reviewed/theme.css", later);
  await row("Update Reviewed with the reviewed files");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.includes("changed after it was reviewed")', "stale review refusal");
  assert.deepEqual(await readFile(join(directory, ".obsidian", "themes", "Reviewed", "theme.css")), later, "A stale review must not overwrite local edits");
  pass("A stale review is refused by the host version guard and the locally edited theme bytes are retained.");
  await row("Reviewed");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.startsWith("Reviewed Reviewed")', "fresh review of update");
  const editedManifest = Buffer.from('{"name":"Reviewed","editedExternally":true}');
  const manifestPath = join(directory, ".obsidian", "themes", "Reviewed", "manifest.json");
  const manifestBefore = await readFile(manifestPath).catch(() => null);
  await put(".obsidian/themes/Reviewed/manifest.json", editedManifest);
  await row("Update Reviewed with the reviewed files");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.includes("changed after it was reviewed")', "manifest-only change refused");
  assert.deepEqual(await readFile(manifestPath), editedManifest, "A manifest edited after review must not be overwritten");
  assert.deepEqual(await readFile(join(directory, ".obsidian", "themes", "Reviewed", "theme.css")), later, "CSS is retained when the manifest guard refuses");
  pass("An external manifest.json edit after review is refused even though the CSS is unchanged, and every installed byte is retained." + (manifestBefore ? "" : " (No manifest existed at review.)"));
  await row("Reviewed");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.startsWith("Reviewed Reviewed")', "second fresh review of update");
  await row("Update Reviewed with the reviewed files");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.startsWith("Updated Reviewed")', "reviewed update result");
  assert.deepEqual(await readFile(join(directory, ".obsidian", "themes", "Reviewed", "theme.css")), cssV2);
  // Selecting and updating the active theme refreshes it in place.
  await writePreferences({ cssTheme: "Reviewed", enabledCssSnippets: [], allowLocalResources: false });
  await until('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()==="#0d0e0f"', "installed theme selected externally");
  await click(".settings-close");
  assert.equal(await editorRetained(), true);
  pass("A fresh review updates the installed theme to the exact reviewed bytes, and the external selection adopts it without disturbing the editor.");

  // 7. Mermaid is re-themed in place without replacing the document.
  const diagram = "Theme management diagram.md";
  await put(diagram, "# Diagram\n\n```mermaid\nflowchart LR\n  A[Theme] --> B[Done]\n```\n");
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  await evaluate(`(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(diagram)});const leaf=app.workspace.getLeaf("tab");await leaf.openFile(file);await leaf.setViewState({...leaf.getViewState(),state:{...leaf.getViewState().state,mode:"preview"}});globalThis.diagramLeaf=leaf})()`);
  await wait('document.querySelector(".markdown-preview-view [data-mermaid-status=ready] img.mermaid-image")?.naturalWidth>0', "Mermaid diagram ready");
  const shot = () => evaluate('(()=>{const n=document.querySelector(".markdown-preview-view [data-mermaid-status=ready]");const i=n.querySelector("img.mermaid-image");return{container:true,src:i.src,alt:i.alt}})()');
  const dark = await shot();
  await evaluate('globalThis.diagramContainer=document.querySelector(".markdown-preview-view [data-mermaid-status]");true');
  await writePreferences({ theme: "moonstone", cssTheme: "Reviewed", enabledCssSnippets: [], allowLocalResources: false });
  await until('document.body.classList.contains("theme-light")', "external light mode adopted");
  await until(`(()=>{const i=document.querySelector(".markdown-preview-view [data-mermaid-status=ready] img.mermaid-image");return !!i&&i.naturalWidth>0&&i.src!==${JSON.stringify(dark.src)}})()`, "Mermaid image re-rendered for the light theme");
  const light = await shot();
  assert.equal(await evaluate('diagramContainer===document.querySelector(".markdown-preview-view [data-mermaid-status]")'), true, "The diagram container must be retained");
  assert.equal(await evaluate("document.querySelectorAll('.markdown-preview-view [data-mermaid-status=ready]').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.markdown-preview-view svg, .markdown-preview-view iframe').length"), 0, "Engine SVG still never enters the application DOM");
  assert.equal(await editorRetained(), true);
  await writePreferences({ theme: "obsidian", cssTheme: "Reviewed", enabledCssSnippets: [], allowLocalResources: false });
  await until(`(()=>{const i=document.querySelector(".markdown-preview-view [data-mermaid-status=ready] img.mermaid-image");return document.body.classList.contains("theme-dark")&&!!i&&i.naturalWidth>0&&i.src!==${JSON.stringify(light.src)}})()`, "Mermaid re-rendered back to the dark theme");
  pass("Switching the color scheme re-renders an already mounted Mermaid diagram in place (same container, decoded replacement image, no SVG in the application DOM) without touching the editor.");

  // 8. Resource-bearing bundle via the selected-file fallback: exact bytes, opt-in stays off, resource-only changes adopted.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const pngB = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");
  const bundleCss = Buffer.from(".theme-dark,.theme-light{--text-accent:#13579b;--res-probe:url(img/dot.png)}\n");
  const bundleManifest = Buffer.from(JSON.stringify({ name: "Picked", version: "2.0.0", future: { keep: [1] } }));
  const pickedDir = join(directory, ".obsidian", "themes", "Picked");
  const review = (map, name) => evaluate(`(async()=>{const b=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));await app.appearance.reviewFiles(new Map(${JSON.stringify(map)}.map(([k,v])=>[k,b(v)])),${JSON.stringify(name)});return true})()`);
  const status = () => evaluate('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent??""');
  const b64 = bytes => Buffer.from(bytes).toString("base64");
  await open();
  await review([["theme.css", b64(bundleCss)], ["manifest.json", b64(bundleManifest)], ["img/dot.png", b64(png)]], "Picked");
  await assert.rejects(readFile(join(pickedDir, "theme.css")), { code: "ENOENT" }, "Reviewing selected files must not install");
  await row("Install Picked from the reviewed files");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.startsWith("Installed Picked")', "bundle install result");
  assert.deepEqual(await readFile(join(pickedDir, "theme.css")), bundleCss);
  assert.deepEqual(await readFile(join(pickedDir, "manifest.json")), bundleManifest);
  assert.deepEqual(await readFile(join(pickedDir, "img", "dot.png")), png);
  assert.equal(await evaluate('app.appearance.getControlValue("allowLocalResources")'), false, "Installing a resource theme must not enable local resources");
  await click(".settings-close");
  assert.equal(await editorRetained(), true);
  pass("A selected-folder bundle with a relative image installs the exact CSS, manifest (unknown keys) and image bytes without enabling trusted local resources.");

  await expectFailure(/local|resource|url/i, () => writePreferences({ cssTheme: "Picked", enabledCssSnippets: [], allowLocalResources: false }), "a resource theme is selected while trusted local resources are off");
  assert.equal(await evaluate('getComputedStyle(document.body).getPropertyValue("--res-probe").trim()'), "", "Rejected resource CSS must not partially apply");
  await writePreferences({ cssTheme: "Picked", enabledCssSnippets: [], allowLocalResources: true });
  await until('getComputedStyle(document.body).getPropertyValue("--res-probe").includes("data:image/png")', "resource theme adopted with trusted resources");
  const probe = () => evaluate('getComputedStyle(document.body).getPropertyValue("--res-probe")');
  const firstProbe = await probe();
  await put(".obsidian/themes/Picked/img/dot.png", pngB);
  await until(`getComputedStyle(document.body).getPropertyValue("--res-probe")!==${JSON.stringify(firstProbe)}&&getComputedStyle(document.body).getPropertyValue("--res-probe").includes("data:image/png")`, "resource-only external change adopted");
  const secondProbe = await probe();
  assert.equal(await editorRetained(), true);
  await expectFailure(/./, async () => { await rm(join(pickedDir, "img", "dot.png")); }, "a referenced resource is deleted externally");
  assert.equal(await probe(), secondProbe, "Accepted styles are retained after the resource disappears");
  await put(".obsidian/themes/Picked/img/dot.png", png);
  await until(`getComputedStyle(document.body).getPropertyValue("--res-probe")===${JSON.stringify(firstProbe)}`, "restored resource adopted");
  assert.equal(await editorRetained(), true);
  await recordEditor("before activation");
  await evaluate('(()=>{const {leaf,cm}=themeEditor;app.workspace.setActiveLeaf(leaf,{focus:true});cm.focus();return true})()');
  await until("themeEditor.cm.hasFocus&&app.workspace.activeLeaf===themeEditor.leaf", "the original editor leaf is active and focused for undo");
  await recordEditor("after focus");
  await press("z", "KeyZ", 90, 2);
  await until(`themeEditor.cm.state.doc.toString()===${JSON.stringify(noteText)}`, "Ctrl+Z removes exactly the seeded unsaved edit on the retained editor");
  const undone = await recordEditor("after undo");
  await press("y", "KeyY", 89, 2);
  await until(`themeEditor.cm.state.doc.toString()===themeEditor.doc`, "Ctrl+Y restores the snapshot text");
  const redone = await recordEditor("after redo");
  const phaseReport = JSON.stringify(editorPhases);
  // Real CodeMirror history semantics (tests/editor-history-selection.test.mjs): redo reapplies the edit and leaves a caret at the end of the inserted text (8), not the explicit 2-9 range.
  assert.ok(identityHeld(undone) && undone.doc === noteText, `Undo restored the exact original text on the original leaf/view/file/CM: ${phaseReport}`);
  assert.ok(identityHeld(redone) && redone.text && redone.selection[0] === 8 && redone.selection[1] === 8, `Redo restored the exact text with the CodeMirror history caret on the same leaf/view/CM: ${phaseReport}`);
  pass("The original editor leaf, view, file and CodeMirror instance, text and selection were retained through every theme step; real Ctrl+Z removed the seeded edit and Ctrl+Y restored its exact text with CodeMirror's history caret on the same leaf/view/CM.");
  pass("Resource-only external changes are watched and adopted; a deleted resource is reported while the accepted styles and editor are retained; restoring it is adopted again.");

  // 9. Unsupported remote resource stays an explicit refusal; nothing is written.
  await open();
  await review([["theme.css", b64(Buffer.from("body{background:url(https://example.invalid/a.png)}"))], ["manifest.json", b64(Buffer.from('{"name":"Remote","version":"1.0.0"}'))]], "Remote");
  assert.match(await status(), /cannot|remote|url|supported/i);
  assert.equal(await hasRow("Install Remote from the reviewed files"), false);
  await assert.rejects(readFile(join(directory, ".obsidian", "themes", "Remote", "theme.css")), { code: "ENOENT" });
  await click(".settings-close");
  pass("A theme with a remote URL is refused at review with an explicit reason and nothing is written.");

  // 10. Cache-only GitHub vault: install is refused (read-only) and cached blobs stay unchanged.
  const localUrl = await evaluate("location.href");
  const fixture = await mountCachedGitHub(evaluate, "appearance-theme-readonly", [
    ["Remote.md", "# Remote\n"], [".obsidian/core-plugins.json", "[]"], [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&app.vault.readOnly&&!app.changingVault`, "read-only GitHub mount");
  await open();
  await review([["theme.css", b64(bundleCss)], ["manifest.json", b64(bundleManifest)], ["img/dot.png", b64(png)]], "Picked");
  const installable = await evaluate(`(()=>{const r=Array.from(document.querySelectorAll("[data-appearance-settings] .setting-item")).find(x=>x.querySelector(".setting-item-name")?.textContent==="Install Picked from the reviewed files");return r?!r.querySelector("button")?.disabled:false})()`);
  assert.equal(installable, false, "Install must be unavailable on a read-only vault");
  await evaluate("app.appearance.installReviewed().catch(()=>{});true");
  await wait('document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent.includes("read-only")', "read-only install refusal status");
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  assert.deepEqual(await evaluate('(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), { api: 0, raw: 0 });
  await click(".settings-close");
  await tools.command("Page.navigate", { url: localUrl }); await tools.afterReload();
  assert.equal(await evaluate("app.vault.readOnly"), false);
  pass("A read-only GitHub vault refuses theme install (disabled control and host refusal) with unchanged cached blobs and no API/raw requests.");

  // Clean up disposable inputs and restore preferences.
  await evaluate("app.workspace.detachLeavesOfType?.('markdown');true").catch(() => {});
  if (original) { await writeFile(preferencesPath, original); } else { await rm(preferencesPath, { force: true }); }
  for (const path of [".obsidian/themes/Watched", ".obsidian/themes/Reviewed", ".obsidian/themes/Picked", ".obsidian/themes/Remote", ".obsidian/snippets/Watched snippet.css", note, diagram]) { await rm(join(directory, ...path.split("/")), { recursive: true, force: true }); }
}

export async function checkAppearanceWatcher(tools) {
  const { directory, evaluate, wait, report } = tools;
  report.diagnostic = { purpose: "external appearance.json/CSS/resource adoption only", accepted: false, observations: [] };
  const preferencesPath = join(directory, ".obsidian", "appearance.json");
  const themeDirectory = join(directory, ".obsidian", "themes", "DiagnosticWatched");
  const put = async (path, bytes) => { const full = join(themeDirectory, ...path.split("/")); await mkdir(dirname(full), { recursive: true }); await writeFile(full, bytes); };
  const css = color => `.theme-dark,.theme-light{--text-accent:${color}}\n`;
  const original = await readFile(preferencesPath).catch(error => { if (error.code === "ENOENT") { return null; } throw error; });
  const base = JSON.parse((original?.toString("utf8") ?? "{}").replace(/^\ufeff/, "") || "{}");
  const writePreferences = value => writeFile(preferencesPath, "\ufeff" + JSON.stringify({ ...base, ...value }, null, 2));
  const snapshot = async label => {
    const disk = await stat(join(themeDirectory, "theme.css")).catch(error => { if (error.code === "ENOENT") { return null; } throw error; });
    const page = await evaluate('({root:app.vault.rootPath,changing:app.changingVault,hidden:document.hidden,visibility:document.visibilityState,accent:getComputedStyle(document.body).getPropertyValue("--text-accent").trim(),styles:Array.from(document.querySelectorAll("style[data-appearance-style]"),s=>({path:s.dataset.appearanceStyle,length:s.textContent.length}))})');
    const observation = { label, at: new Date().toISOString(), diskMtimeMs: disk?.mtimeMs ?? null, diskSize: disk?.size ?? null, page };
    report.diagnostic.observations.push(observation);
    return observation;
  };
  const adopted = async (expression, label) => {
    try { await wait(expression, label); await snapshot(label + " (adopted)"); }
    catch (error) { const miss = await snapshot(label + " (NOT adopted)"); throw new Error(`Watcher diagnostic miss: ${label}; ${JSON.stringify(miss)}; ${error.message}`, { cause: error }); }
  };
  const accent = color => `getComputedStyle(document.body).getPropertyValue("--text-accent").trim()==="${color}"`;
  try {
    await put("theme.css", css("#112233"));
    await writePreferences({ cssTheme: "DiagnosticWatched", enabledCssSnippets: [], allowLocalResources: false });
    await adopted(accent("#112233"), "external preferences select a theme");
    await put("theme.css", css("#445566"));
    await adopted(accent("#445566"), "same-size CSS edit right after adoption");
    const resource = tail => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([tail])]);
    await put("img/probe.png", resource(0));
    await put("theme.css", `.theme-dark,.theme-light{--text-accent:#667788;--diagnostic-image:url(img/probe.png)}\n`);
    await writePreferences({ cssTheme: "DiagnosticWatched", enabledCssSnippets: [], allowLocalResources: true });
    const embedded = tail => `document.querySelector("style[data-appearance-style]").textContent.includes(${JSON.stringify(resource(tail).toString("base64"))})`;
    await adopted(embedded(0), "trusted resource is inlined");
    await put("img/probe.png", resource(1));
    await adopted(embedded(1), "resource-only same-size change");
    report.diagnostic.accepted = true;
    const message = "Diagnostic: external preferences, an immediate same-size CSS edit and a resource-only change were adopted automatically.";
    report.checks.push(message);
    console.log("PASS " + message);
  } finally {
    if (original) { await writeFile(preferencesPath, original); } else { await rm(preferencesPath, { force: true }); }
    await rm(themeDirectory, { recursive: true, force: true });
  }
}

  export async function checkAppearanceCatalog(tools) {
    const { directory, evaluate, click, wait, report, readRequests } = tools;
    report.diagnostic = { purpose: "reviewed catalog install/update, stale and manifest-only refusal", accepted: false, observations: [] };
    const pass = text => { report.checks.push(text); console.log("PASS " + text); };
    const themeDirectory = join(directory, ".obsidian", "themes", "Reviewed");
    const css = color => `.theme-dark,.theme-light{--text-accent:${color}}\n`;
    const status = '(document.querySelector("[data-appearance-catalog-status] .setting-item-description")?.textContent??"")';
    const waitStatus = async (test, label) => {
      try { await wait(`${status}.${test}`, label); }
      catch (error) {
        const observed = { label, status: await evaluate(status), fetches: await evaluate("globalThis.themeFetches??null"), requests: readRequests().filter(url => /appearance|raw\.githubusercontent/.test(url)).slice(-12) };
        report.diagnostic.observations.push(observed);
        throw new Error("Catalog diagnostic miss: " + JSON.stringify(observed), { cause: error });
      }
    };
    const row = async name => {
      await evaluate(`(()=>{const row=Array.from(document.querySelectorAll("[data-appearance-settings] .setting-item")).find(r=>r.querySelector(".setting-item-name")?.textContent===${JSON.stringify(name)});if(!row)throw new Error("Missing setting row "+${JSON.stringify(name)});row.dataset.smokeThemeRow="";})()`);
      await click("[data-smoke-theme-row]");
      await evaluate('document.querySelectorAll("[data-smoke-theme-row]").forEach(r=>delete r.dataset.smokeThemeRow)');
    };
    const manifest = Buffer.from(JSON.stringify({ name: "Reviewed", version: "1.0.0", future: { keep: true } }));
    const cssV1 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(css("#0a0b0c").replace("\n", "\r\n"))]), cssV2 = Buffer.from(css("#0d0e0f"));
    const errors = [];
    try {
      await evaluate(`(()=>{
        const files=new Map([["https://raw.githubusercontent.com/fixture/reviewed-theme/HEAD/theme.css",{bytes:"${cssV1.toString("base64")}"}],["https://raw.githubusercontent.com/fixture/reviewed-theme/HEAD/manifest.json",{bytes:"${manifest.toString("base64")}"}],
          ["https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json",{text:JSON.stringify([{name:"Reviewed",author:"Fixture",repo:"fixture/reviewed-theme",modes:["dark","light"]}])}]]);
        globalThis.themeFetches=[];globalThis.themeFiles=files;
        app.appearance.fetcher=async(url,init)=>{themeFetches.push({url,mode:init.mode,credentials:init.credentials});const entry=files.get(url);if(!entry)return new Response("missing",{status:404});
          return new Response(entry.text!==undefined?entry.text:Uint8Array.from(atob(entry.bytes),c=>c.charCodeAt(0)),{status:200})};
        return true})()`);
      await click("#open-settings"); await click("#appearance-tab");
      await wait('document.querySelector("[data-appearance-settings] [data-setting-key=theme] select")', "Appearance controls");
      await row("Browse official community themes");
      await waitStatus('includes("Loaded 1 official community themes")', "explicit catalog browse");
      await row("Reviewed");
      await wait('document.querySelector("[data-appearance-reviewed=Reviewed]")', "reviewed theme details");
      await row("Install Reviewed from the reviewed files");
      await waitStatus('startsWith("Installed Reviewed")', "reviewed install result");
      assert.deepEqual(await readFile(join(themeDirectory, "theme.css")), cssV1);
      assert.deepEqual(await readFile(join(themeDirectory, "manifest.json")), manifest);
      pass("Diagnostic: the reviewed install wrote the exact BOM/CRLF CSS and manifest bytes.");
      const later = Buffer.from(css("#fedcba"));
      await evaluate(`themeFiles.set("https://raw.githubusercontent.com/fixture/reviewed-theme/HEAD/theme.css",{bytes:"${cssV2.toString("base64")}"});true`);
      await writeFile(join(themeDirectory, "theme.css"), Buffer.from(css("#abcdef")));
      await row("Reviewed");
      await wait('document.querySelector("[data-appearance-reviewed=Reviewed]")?.textContent.includes("differs from installed")', "review of update");
      await writeFile(join(themeDirectory, "theme.css"), later);
      await row("Update Reviewed with the reviewed files");
      await waitStatus('includes("changed after it was reviewed")', "stale review refusal");
      assert.deepEqual(await readFile(join(themeDirectory, "theme.css")), later);
      await row("Reviewed");
      await waitStatus('startsWith("Reviewed Reviewed")', "fresh review of update");
      const edited = Buffer.from('{"name":"Reviewed","editedExternally":true}');
      await writeFile(join(themeDirectory, "manifest.json"), edited);
      await row("Update Reviewed with the reviewed files");
      await waitStatus('includes("changed after it was reviewed")', "manifest-only change refused");
      assert.deepEqual(await readFile(join(themeDirectory, "manifest.json")), edited);
      assert.deepEqual(await readFile(join(themeDirectory, "theme.css")), later);
      await row("Reviewed");
      await waitStatus('startsWith("Reviewed Reviewed")', "second fresh review of update");
      await row("Update Reviewed with the reviewed files");
      await waitStatus('startsWith("Updated Reviewed")', "reviewed update result");
      assert.deepEqual(await readFile(join(themeDirectory, "theme.css")), cssV2);
      report.diagnostic.accepted = true;
      pass("Diagnostic: reviewed install, stale-CSS refusal, manifest-only refusal and fresh-review update retained every refused byte.");
    } catch (error) { errors.push(error); }
    finally {
      for (const cleanup of [() => click(".settings-close"), () => rm(themeDirectory, { recursive: true, force: true })]) {
        try { await cleanup(); } catch (error) { errors.push(error); }
      }
    }
    if (errors.length === 1) { throw errors[0]; }
    if (errors.length > 1) { throw new AggregateError(errors, "Catalog diagnostic or cleanup failed."); }
  }
