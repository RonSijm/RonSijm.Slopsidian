import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Actual app/core configuration lifecycle on one host: external JSON edits are detected by the lifecycle-owned
// poll while subscribed, focused drafts keep their baseline, stale/missing versions are refused, setters and new
// creators use the saved preferences without resetting a live editor, and cache-only GitHub vaults stay read-only.
export async function checkConfigurationLifecycle({ directory, evaluate, command, click, press, wait, report, restart, afterReload, capture }) {
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const appPath = join(directory, ".obsidian", "app.json"), templatesPath = join(directory, ".obsidian", "templates.json");
  const folder = "Config lifecycle", source = folder + "/Source.md", inbox = "Config inbox";
  const browser = await evaluate('document.body.classList.contains("is-browser")');
  const encode = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  const decode = async path => JSON.parse((await readFile(path, "utf8")).replace(/^\ufeff/, ""));
  const baseApp = { markdownAutosave: false, newFileLocation: "root", newFileFolderPath: "/", newLinkFormat: "shortest", useMarkdownLinks: false, attachmentFolderPath: "/", futureFilesSetting: { keep: [true, 42] } };
  const control = key => `[data-file-settings] [data-setting-key="${key}"]`;
  const fill = async (selector, text) => {
    await wait(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return input&&!input.disabled&&!input.readOnly})()`, "editable control");
    await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text });
  };
  const openFiles = async () => {
    await click("#open-settings"); await click("#files-links-tab");
    await wait('document.querySelector("[data-file-settings] [data-setting-key=newFileLocation] select")', "Files and links page");
  };
  const openTemplates = async () => {
    await click("#open-settings"); await click("#core-plugins-tab"); await click('[data-core-settings="templates"]');
    await wait('document.querySelector(\'[data-core-form="templates"] [data-core-field="folder"]\')', "Templates settings page");
  };
  const closeSettings = async () => { await click(".settings-close"); await wait('!document.querySelector("#settings-dialog").open', "settings closed"); };
  const refused = async (action, reason) => {
    const before = new Set((await evaluate("slopsidianDiagnostics.current()")).map(record => record.id));
    await action();
    await sleep(800);
    const added = (await evaluate("slopsidianDiagnostics.current()")).filter(record => !before.has(record.id));
    assert.ok(added.length >= 1, "No explicit failure was recorded while " + reason);
    for (const record of added) {
      assert.match(record.error.message, /changed on disk/, reason);
      (report.expectedDiagnostics ??= []).push({ id: record.id, source: record.source, message: record.error.message, reason });
    }
  };
  const field = '[data-core-form="templates"] [data-core-field="folder"]';

  await evaluate("app.saveAll()");
  await mkdir(join(directory, folder), { recursive: true }); await mkdir(join(directory, inbox), { recursive: true });
  const sourceBytes = Buffer.from("\ufeff# Config lifecycle\r\n\r\nExisting note bytes must never change.\r\n");
  await writeFile(join(directory, source), sourceBytes);
  await writeFile(appPath, encode(baseApp));
  await writeFile(templatesPath, encode({ folder: "Templates", futureSetting: { keep: "templates" } }));
  await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh();app.configuration.pollMilliseconds=250;await app.configuration.read('app')})()");
  await click("#open-settings"); await click("#core-plugins-tab");
  if (!await evaluate('app.core.isEnabled("templates")')) { await click('[data-core-toggle="templates"]'); }
  await wait('app.core.isEnabled("templates")&&!app.core.busy', "Templates core plugin enabled");
  await closeSettings();

  // Files and links: external detection, focused baseline, conflict, reload.
  await openFiles();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control("newLinkFormat") + " select")}).value`), "shortest");
  const external = encode({ ...baseApp, newLinkFormat: "relative", externalUnknown: { n: 1 } });
  await writeFile(appPath, external);
  await wait(`document.querySelector(${JSON.stringify(control("newLinkFormat") + " select")}).value==="relative"&&app.vault.getConfig("newLinkFormat")==="relative"`, "external app.json adopted by the subscribed page without a manual refresh");
  assert.deepEqual(await readFile(appPath), external, "adopting an external change must not write");
  pass("An external app.json edit is detected by the lifecycle-owned poll and reaches the open Files and links controls and vault.getConfig without a manual Reload or any write.");

  await evaluate(`document.querySelector(${JSON.stringify(control("attachmentFolderPath") + " input")}).focus()`);
  const conflicting = encode({ ...baseApp, newLinkFormat: "absolute", externalUnknown: { n: 2 } });
  await writeFile(appPath, conflicting);
  await wait('app.vault.getConfig("newLinkFormat")==="absolute"', "shared cache adopted the newer external version");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control("newLinkFormat") + " select")}).value`), "relative", "a focused page keeps its original baseline");
  await refused(async () => {
    await click(control("useMarkdownLinks") + " [role=switch]");
    await wait(`document.querySelector(${JSON.stringify(control("useMarkdownLinks") + " [role=alert]")})?.textContent.includes("changed on disk")`, "pending write from the original baseline refused");
  }, "a focused Files and links draft writes from its original baseline");
  assert.deepEqual(await readFile(appPath), conflicting, "the refused write left the external file untouched");
  await click("[data-file-settings] [role=button]");
  await wait(`document.querySelector(${JSON.stringify(control("newLinkFormat") + " select")}).value==="absolute"`, "explicit Reload rebases the page");
  await click(control("useMarkdownLinks") + " [role=switch]");
  await wait('app.vault.getConfig("useMarkdownLinks")===true', "rebased write saved");
  const rebased = await decode(appPath);
  assert.deepEqual(rebased.externalUnknown, { n: 2 }); assert.deepEqual(rebased.futureFilesSetting, { keep: [true, 42] });
  assert.ok((await readFile(appPath, "utf8")).startsWith("\ufeff"), "BOM preserved");
  await capture("files-and-links"); await closeSettings();
  pass("A focused Files and links control keeps its original conflict baseline when an external edit lands: the pending write is refused with an explicit 409, the external file is untouched, and only explicit Reload rebases. Unknown keys and the BOM survive the rebased write.");

  // Core settings page: adoption, draft retention, stale refusal.
  await openTemplates();
  await writeFile(templatesPath, encode({ folder: "External A", futureSetting: { keep: "templates" } }));
  await wait(`document.querySelector(${JSON.stringify(field)})?.value==="External A"`, "external core JSON adopted by the subscribed settings page");
  await fill(field, "My draft");
  const externalB = encode({ folder: "External B", futureSetting: { keep: "templates" }, extra: true });
  await writeFile(templatesPath, externalB);
  await wait("document.querySelector('[data-core-stale]')", "stale notice instead of a rebuild");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(field)}).value`), "My draft", "live draft was not reset");
  await refused(async () => {
    await click('[data-core-save="templates"]');
    await wait('document.querySelector("#core-settings-error")?.textContent.includes("changed on disk")', "stale core save refused");
  }, "a stale core-settings draft is saved");
  assert.deepEqual(await readFile(templatesPath), externalB, "the refused core write left disk untouched");
  await wait(`document.querySelector(${JSON.stringify(field)})?.value==="External B"`, "page shows the external value after the refusal");
  await fill(field, "Final"); await click('[data-core-save="templates"]');
  await wait('app.core.state("templates").settings.folder==="Final"&&!app.core.busy', "versioned core save");
  const saved = await decode(templatesPath);
  assert.equal(saved.folder, "Final"); assert.equal(saved.extra, true); assert.deepEqual(saved.futureSetting, { keep: "templates" });
  assert.ok((await readFile(templatesPath, "utf8")).startsWith("\ufeff"), "BOM preserved");
  await capture("core-settings"); await closeSettings();
  pass("Core settings: external JSON edits are adopted while subscribed, a focused draft is kept with a stale notice, its stale save is refused without touching disk, and the next versioned save preserves unknown keys and the BOM.");

  // Stale and missing versions.
  const stale = await evaluate('app.core.saveSettings("templates",{folder:"Nope"},"0".repeat(64)).then(()=>"saved",error=>error.message)');
  assert.match(stale, /changed on disk/); assert.equal((await decode(templatesPath)).folder, "Final");
  const coreVersion = await evaluate('app.core.state("templates").settingsVersion');
  assert.match(coreVersion, /^[0-9a-f]{64}$/);
  if (!browser) {
    assert.equal(coreVersion, createHash("sha256").update(await readFile(templatesPath)).digest("hex"));
    const status = await evaluate(`(async()=>({core:(await fetch("/api/core/templates/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({root:app.vault.rootPath,values:{folder:"Nope"}})})).status,config:(await fetch("/api/configuration/app",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({root:app.vault.rootPath,data:{}})})).status}))()`);
    assert.deepEqual(status, { core: 428, config: 428 }, "a missing version is never an unconditional write");
  }
  const before = await readFile(appPath);
  const staleConfig = await evaluate('(async()=>{const d=await app.configuration.read("app");return app.configuration.write({...d,version:"0".repeat(64)},{...d.data,x:1}).then(()=>"saved",error=>error.message)})()');
  assert.match(staleConfig, /409|changed on disk/i); assert.deepEqual(await readFile(appPath), before);
  report.configurationWireVersion = { staleCore: true, staleConfiguration: true, missingVersionOverWire: browser ? "covered-by-browser-host-tests" : true };
  pass("A stale core or configuration version is refused with an explicit error; a missing version is refused (428) on the desktop wire; disk bytes are unchanged.");

  // Held work across same-root clear/re-entry.
  const held = await evaluate(`(async()=>{const c=app.configuration,out=[];
    let p=c.update("app",d=>{d.heldProbe="queued"});c.clear();try{await p;out.push("applied")}catch(e){out.push(e.message)}
    await c.read("app");
    p=c.update("app",d=>{d.heldProbe="reading"});await new Promise(r=>setTimeout(r,0));c.clear();try{await p;out.push("applied")}catch(e){out.push(e.message)}
    await c.read("app");
    await Promise.all([c.update("app",d=>{d.orderA=1}),c.update("app",d=>{d.orderB=(d.orderA??0)+1})]);
    return out})()`);
  assert.equal(held.length, 2); for (const message of held) { assert.match(message, /not applied|changed while reading|reset before/i, message); }
  const afterHeld = await decode(appPath);
  assert.equal(afterHeld.heldProbe, undefined, "a request held across clear/re-entry never writes under the new generation");
  assert.equal(afterHeld.orderA, 1); assert.equal(afterHeld.orderB, 2, "queued writes before and after re-entry run in order and none is dropped");
  await evaluate('app.configuration.watch("app",()=>{});true');
  pass("Held queued and mid-read updates are rejected explicitly after same-root clear/re-entry (never replayed under the new generation) while ordinary queued writes still all apply in order.");

  // Setters, new creators and the live editor.
  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(source)});app.workspace.activeLeaf.view.setMode("source")})()`);
  await wait('document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]")', "live source editor");
  const focusEditor = () => evaluate('document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]").focus()');
  await focusEditor(); await command("Input.insertText", { text: "LIVE-DRAFT " });
  await evaluate("globalThis.liveEditor=app.workspace.activeLeaf.view.editor;globalThis.liveText=liveEditor.getValue();true");
  assert.match(await evaluate("liveText"), /LIVE-DRAFT/);
  await evaluate(`(async()=>{await app.vault.setConfigAsync("newFileLocation","folder");await app.vault.setConfigAsync("newFileFolderPath",${JSON.stringify(inbox)})})()`);
  const rejected = await evaluate(`(async()=>{const out=[];for(const [k,v] of [["newLinkFormat","bogus"],["notAFilesSetting",1],["useMarkdownLinks","yes"]]){out.push(await app.vault.setConfigAsync(k,v).then(()=>"saved",e=>e.message))}return out})()`);
  for (const message of rejected) { assert.notEqual(message, "saved"); }
  await writeFile(appPath, encode({ ...(await decode(appPath)), newLinkFormat: "shortest", externalAfterSetter: true }));
  await wait('app.vault.getConfig("newLinkFormat")==="shortest"&&app.vault.getConfig("newFileLocation")==="folder"', "external change and setter values coexist in the live cache");
  assert.equal(await evaluate("app.workspace.activeLeaf.view.editor===liveEditor&&liveEditor.getValue()===liveText"), true, "the live editor was not reset or replaced");
  assert.deepEqual(await readFile(join(directory, source)), sourceBytes, "existing note bytes unchanged");
  await focusEditor(); await press("z", "KeyZ", 90, 2);
  await wait('!app.workspace.activeLeaf.view.editor.getValue().includes("LIVE-DRAFT")', "undo history survived the configuration changes");
  const setterDisk = await decode(appPath);
  assert.equal(setterDisk.newFileLocation, "folder"); assert.equal(setterDisk.newFileFolderPath, inbox); assert.equal(setterDisk.externalAfterSetter, true);
  assert.deepEqual(setterDisk.futureFilesSetting, { keep: [true, 42] });
  assert.ok((await readFile(appPath, "utf8")).startsWith("\ufeff"), "BOM preserved by setters");
  await press("n", "KeyN", 78, 2); await wait('document.querySelector("#new-note-dialog").open', "New note dialog");
  await fill("#new-note-name", "Created by preference"); await click("#create-note");
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(inbox + "/Created by preference.md")}`, "new note uses the configured location");
  assert.deepEqual(await readFile(join(directory, source)), sourceBytes);
  pass("vault.setConfigAsync writes supported keys and rejects unsupported or invalid ones; the saved preference drives the real New note creator while a live editor keeps its identity, text and undo history and existing notes are not rewritten.");

  // Restart.
  await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  assert.equal(await evaluate('app.vault.getConfig("newFileLocation")'), "folder");
  assert.equal(await evaluate('app.core.state("templates").settings.folder'), "Final");
  assert.deepEqual(await evaluate('app.vault.getConfig("externalUnknown")'), { n: 2 });
  assert.equal(await evaluate('app.core.state("templates").settingsVersion'), coreVersion);
  pass("App and core configuration, their versions and unknown data survive a full " + (browser ? "page reload/reconnect" : "desktop restart") + ".");

  // Cache-only GitHub overlay.
  const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href");
  const fixture = await mountCachedGitHub(evaluate, "configuration-lifecycle", [
    ["Folder/Source.md", "# Remote note\n"], [".obsidian/core-plugins.json", '["backlink"]'], [".obsidian/community-plugins.json", "[]"],
    [".obsidian/app.json", '{"useMarkdownLinks":false,"futureRemote":{"keep":true}}'], [".obsidian/backlink.json", '{"backlinkInDocument":false,"futureRemote":{"keep":true}}'],
  ]);
  await wait("app.vault.readOnly", "cache-only read-only GitHub vault");
  await wait("app.core.state('backlink').settings.futureRemote&&!app.core.busy", "cached Backlinks settings loaded in the cache-only GitHub vault");
  const counters = () => evaluate('(()=>{const s=app.githubVaults.state();return{api:s.counters.api,raw:s.counters.raw}})()');
  await openFiles(); await click(control("useMarkdownLinks") + " [role=switch]");
  await wait('app.vault.getConfig("useMarkdownLinks")===true', "local overlay write"); await closeSettings();
  await sleep(1200);
  const overlayVersion = await evaluate('app.core.state("backlink").settingsVersion');
  const overlayStale = await evaluate('app.core.saveSettings("backlink",{backlinkInDocument:true},"0".repeat(64)).then(()=>"saved",error=>error.message)');
  assert.match(overlayStale, /changed/);
  await evaluate('app.core.saveSettings("backlink",{backlinkInDocument:true})');
  await wait('app.core.state("backlink").settings.backlinkInDocument===true&&!app.core.busy', "versioned overlay core save");
  assert.notEqual(await evaluate('app.core.state("backlink").settingsVersion'), overlayVersion);
  assert.deepEqual(await counters(), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await evaluate("app.workspace.flushLayout()"); await command("Page.reload");
  if (browser) { await wait(`document.querySelector("main[data-ready=true]")&&app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&app.workspace.layoutReady&&!app.changingVault`, "cache-only GitHub vault reopens offline"); } else { await afterReload(); }
  if (await evaluate("app.vault.rootPath") !== fixture.mount.id) {
    await evaluate(`app.githubVaults.open({url:${JSON.stringify(fixture.mount.repository)},cached:true})`);
    await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault`, "cached overlay reopens");
  }
  assert.equal(await evaluate('app.vault.getConfig("useMarkdownLinks")'), true);
  assert.equal(await evaluate('app.core.state("backlink").settings.backlinkInDocument'), true);
  assert.deepEqual(await counters(), { api: 0, raw: 0 });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  await capture("readonly");
  pass("Cache-only GitHub vaults poll and write only the local overlay: stale versions are refused, versioned overlay saves persist across reload, there are zero API/raw requests and cached repository blobs are unchanged.");
  await command("Page.navigate", { url: pageUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal(await evaluate("app.vault.readOnly"), false);
  report.configurationLifecycle = { host: browser ? "browser" : "desktop", polledExternalApp: true, polledExternalCore: true, focusedDraftBaseline: true, staleRefused: true, heldWork: true, setters: true, liveEditorUndo: true, restart: true, readOnlyOverlay: true };
}
