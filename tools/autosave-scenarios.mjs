import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkMarkdownAutosave({ directory, targetDirectory, evaluate, command, click, press, wait, handleDialog, report, restart, afterReload, selectVault, capture, browser = false }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const root = await evaluate("app.vault.rootPath"), originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const activeEditor = '.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]';
  const exact = async (path, value) => {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { assert.deepEqual(await readFile(join(directory, path)), Buffer.from(value)); return; }
      catch (error) { if (Date.now() >= deadline) { throw error; } await delay(100); }
    }
  };
  const open = async (path, tab = false) => {
    await evaluate(`app.openFile(${JSON.stringify(path)},${tab})`);
    await wait(`app.current?.file.path===${JSON.stringify(path)}&&!app.changingVault`, "opened autosave fixture");
    await evaluate('app.markdownView.setEditingMode("source")');
  };
  const type = async text => { await click(activeEditor); await press("End", "End", 35, 2); await command("Input.insertText", { text }); };
  const clean = () => wait('!app.workspace.hasUnsavedChanges&&!app.markdownAutosave.saving', "automatic save acknowledged");
  const restartHost = async () => { if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload(); };
  assert.equal(await evaluate("app.markdownAutosave.enabled"), true, "A vault without an explicit pause starts with autosave enabled");
  assert.equal(await evaluate('document.querySelector("#markdown-autosave-toggle").dataset.enabled'), "true");
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(join(directory, ".obsidian", "app.json"), '\ufeff{"opaqueAutosave":{"keep":[true,"中文"]},"unrelated":"retained"}\r\n');
  const base = "# Autosave exact\r\n\r\nOriginal λ.\r\n";
  await writeFile(join(directory, "Autosave exact.md"), "\ufeff" + base);
  await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh()})()');
  await open("Autosave exact.md"); await type("Typed 中文 😀");
  const first = base + "Typed 中文 😀";
  await exact("Autosave exact.md", "\ufeff" + first); await clean();
  assert.equal(await evaluate('app.workspace.activeLeaf.session.document.hasBom'), true);
  pass("Default-on autosave persists real Source typing without Save/Ctrl+S, preserving exact UTF-8 BOM, CRLF and Unicode.");

  await press("z", "KeyZ", 90, 2); await wait(`app.editor.getValue()===${JSON.stringify(base)}`, "undo survives autosave acknowledgement");
  await exact("Autosave exact.md", "\ufeff" + base); await clean();
  await press("y", "KeyY", 89, 2); await wait(`app.editor.getValue()===${JSON.stringify(first)}`, "redo survives automatic undo save");
  await exact("Autosave exact.md", "\ufeff" + first); await clean();
  pass("Undo and redo remain available after acknowledged autosaves and persist the resulting exact document.");

  await evaluate('(async()=>{const file=app.vault.getFileByPath("Autosave exact.md");globalThis.autosaveSourceLeaf=app.workspace.activeLeaf;await app.workspace.getLeaf("split").openFile(file);app.markdownView.setEditingMode("live-preview")})()');
  await type(" Live Preview edit");
  const splitText = first + " Live Preview edit";
  await wait('(()=>{const panes=app.workspace.getLeavesOfType("markdown").filter(leaf=>leaf.session?.document.file.path==="Autosave exact.md");return panes.length===2&&panes.every(leaf=>leaf.session===app.workspace.activeLeaf.session&&leaf.view.editor.getValue()===app.editor.getValue())})()', "two panes share the actual session and text");
  await exact("Autosave exact.md", "\ufeff" + splitText); await clean();
  pass("Actual Live Preview typing saves through the same shared session as the Source split pane, with both buffers kept in sync.");

  await evaluate('(async()=>{await app.vault.create("Autosave inactive.md","Inactive: ");await app.openFile("Autosave inactive.md",true);app.markdownView.setEditingMode("source");autosaveSourceLeaf.containerEl.dataset.autosaveOther=""})()');
  await type("saved while another pane is active");
  await click('[data-autosave-other] .cm-content[contenteditable=true]');
  assert.equal(await evaluate('app.current.file.path'), "Autosave exact.md");
  await exact("Autosave inactive.md", "Inactive: saved while another pane is active"); await clean();
  pass("Typing in one tab still autosaves after a real pointer action activates another split pane.");

  await evaluate('(async()=>{await app.vault.create("Autosave continuous.md","Continuous: ");await app.openFile("Autosave continuous.md",true);app.markdownView.setEditingMode("source")})()');
  const continuousBefore = await readFile(join(directory, "Autosave continuous.md"));
  let intermediate = null;
  for (let i = 0; i < 16; i++) {
    await type(String(i % 10)); await delay(750);
    const disk = await readFile(join(directory, "Autosave continuous.md"));
    if (!disk.equals(continuousBefore)) { intermediate = disk.toString("utf8"); }
  }
  assert.ok(intermediate?.startsWith("Continuous: "), "The ten-second bound writes while typing is still continuous");
  await exact("Autosave continuous.md", "Continuous: 0123456789012345"); await clean();
  report.autosaveContinuousIntermediate = intermediate;
  pass("Continuous real typing reaches disk before an idle gap; the final keystrokes are then saved after typing stops.");

  await evaluate(`(()=>{const original=app.vault.writeDocument;globalThis.autosaveTrace={calls:[],active:0,maximum:0,original};app.vault.writeDocument=async function(...args){const t=autosaveTrace;t.calls.push(args[1]);t.active++;t.maximum=Math.max(t.maximum,t.active);try{if(t.hold){t.hold=false;await new Promise(resolve=>t.release=resolve)}if(t.fail){t.fail=false;throw new Error("Expected one-time autosave write failure")}return await original.apply(this,args)}finally{t.active--}}})()`);
  await evaluate('autosaveTrace.hold=true'); await type(" held");
  await wait('typeof autosaveTrace.release==="function"', "automatic write in flight"); await type(" late edit");
  await evaluate('globalThis.autosaveManual=[app.saveCurrent(),app.saveCurrent()];autosaveManual.forEach(value=>value.catch(()=>{}));autosaveTrace.release()');
  await evaluate('Promise.all(autosaveManual)'); await clean();
  await exact("Autosave continuous.md", "Continuous: 0123456789012345 held late edit");
  assert.equal(await evaluate('autosaveTrace.maximum'), 1); assert.equal(await evaluate('autosaveTrace.calls.length'), 2);
  pass("An edit during a fixture-held real autosave is drained exactly once; simultaneous explicit saves serialize without duplicate or concurrent document writes.");

  await evaluate('autosaveTrace.fail=true'); await type(" retry me");
  await wait('app.markdownAutosave.errors().length===1&&!document.querySelector("#markdown-autosave-errors").hidden', "persistent failed-save status");
  assert.equal(await evaluate('app.dirty'), true);
  await capture("failure"); await click("#markdown-autosave-errors");
  await click('[data-autosave-retry="Autosave continuous.md"]');
  await wait('document.querySelector("[data-autosave-result]")?.textContent.includes("Saved Autosave continuous.md")', "explicit retry succeeded");
  await press("Escape", "Escape", 27); await clean();
  await exact("Autosave continuous.md", "Continuous: 0123456789012345 held late edit retry me");
  pass("A one-time write rejection retains dirty text, exposes a persistent save issue, and the actual Retry save action persists it after the failure clears.");

  await evaluate('autosaveTrace.fail=true'); await type(" first failed pane"); await wait('app.markdownAutosave.errors().length===1', "first failed pane");
  await evaluate('app.workspace.getLeavesOfType("markdown").find(leaf=>leaf.session?.document.file.path==="Autosave inactive.md").containerEl.dataset.autosaveSecond=""');
  await click('[data-autosave-second] .cm-content[contenteditable=true]');
  await evaluate('autosaveTrace.fail=true'); await type(" second failed pane"); await wait('app.markdownAutosave.errors().length===2', "independent failed notes");
  const beforeOpen = await evaluate('autosaveTrace.calls.length');
  await click("#markdown-autosave-errors"); await click('[data-autosave-open="Autosave continuous.md"]');
  assert.equal(await evaluate('app.current.file.path'), "Autosave continuous.md");
  assert.equal(await evaluate('app.markdownAutosave.errors().length'), 2); assert.equal(await evaluate('autosaveTrace.calls.length'), beforeOpen);
  await click("#markdown-autosave-errors"); await click('[data-autosave-retry="Autosave continuous.md"]');
  await wait('app.markdownAutosave.errors().length===1', "first independent explicit retry");
  await click('[data-autosave-retry="Autosave inactive.md"]'); await wait('app.markdownAutosave.errors().length===0', "second independent explicit retry");
  await press("Escape", "Escape", 27); await clean();
  pass("Two independently failed notes remain accessible through Open note without implicitly retrying the other draft; each explicit Retry clears only its own issue.");

  await type(" local conflict draft");
  const external = "# New external version\nKeep external bytes.\n";
  await writeFile(join(directory, "Autosave continuous.md"), external);
  await wait('app.markdownAutosave.errors().length===1', "external-version conflict refused by autosave");
  const attempts = await evaluate('autosaveTrace.calls.length');
  await type(" more retained text"); await delay(2500);
  assert.equal(await evaluate('autosaveTrace.calls.length'), attempts, "Failed automatic saves do not retry on later typing");
  assert.match(await evaluate('app.editor.getValue()'), /local conflict draft more retained text/);
  assert.equal(await readFile(join(directory, "Autosave continuous.md"), "utf8"), external);
  await click("#markdown-autosave-errors"); assert.match(await evaluate('document.querySelector("[data-markdown-save-status]").textContent'), /changed on disk/);
  await click('[data-autosave-retry="Autosave continuous.md"]'); await wait('document.querySelector("[data-autosave-result]").textContent.includes("Save failed")', "retry also guards external version");
  await capture("conflict"); await press("Escape", "Escape", 27);
  await Promise.all([click("#reload-note"), handleDialog(true)]);
  await wait(`!app.dirty&&app.editor.getValue()===${JSON.stringify(external)}`, "explicit confirmed reload");
  await delay(2200); assert.equal(await readFile(join(directory, "Autosave continuous.md"), "utf8"), external);
  assert.equal(await evaluate('app.markdownAutosave.errors().length'), 0);
  pass("A real external edit is never overwritten: automatic and explicit retries reject stale versions, further typing stays dirty without repeated retries, and confirmed Reload clears the issue without a delayed stale write.");

  const beforePreference = await readFile(join(directory, ".obsidian", "app.json"));
  await evaluate('(()=>{const original=app.configuration.update;app.configuration.update=async function(...args){app.configuration.update=original;throw new Error("Expected one-time preference failure")}})()');
  await click("#markdown-autosave-toggle"); await wait('!app.markdownAutosave.toggling&&!app.markdownAutosave.enabled&&app.markdownAutosave.settingError', "failed preference pauses locally");
  assert.deepEqual(await readFile(join(directory, ".obsidian", "app.json")), beforePreference);
  await wait('document.querySelector("[data-markdown-save-status]")?.textContent.includes("Expected one-time preference failure")', "preference failure opens its explanatory panel");
  await press("Escape", "Escape", 27); await wait('!document.querySelector("[data-markdown-save-status]")', "return from preference error panel to editor");
  await type("Paused text"); await delay(2200); assert.equal(await readFile(join(directory, "Autosave continuous.md"), "utf8"), external);
  await click("#markdown-autosave-errors"); await click("[data-autosave-preference-retry]");
  await wait('document.querySelector("[data-autosave-result]")?.textContent==="Autosave preference saved."', "explicit preference retry");
  await press("Escape", "Escape", 27);
  pass("A one-time preference rejection pauses automatic writes locally, preserves the original settings and dirty note, and exposes an actual preference retry action.");
  const settingsBytes = await readFile(join(directory, ".obsidian", "app.json"));
  assert.deepEqual([...settingsBytes.subarray(0, 3)], [239, 187, 191]);
  assert.deepEqual(JSON.parse(settingsBytes.toString("utf8").replace(/^\ufeff/, "")), { opaqueAutosave: { keep: [true, "中文"] }, unrelated: "retained", markdownAutosave: false });
  await delay(2200); assert.equal(await readFile(join(directory, "Autosave continuous.md"), "utf8"), external);
  assert.match(await evaluate('document.querySelector("#markdown-autosave-toggle").textContent'), /paused.*unsaved/);
  await click("#save-note"); await clean(); await exact("Autosave continuous.md", external + "Paused text");
  await restartHost(); assert.equal(await evaluate('app.markdownAutosave.enabled'), false);
  await open("Autosave continuous.md"); await type(" after restart"); await delay(2200);
  await exact("Autosave continuous.md", external + "Paused text");
  await click("#markdown-autosave-toggle"); await wait('app.markdownAutosave.enabled&&!app.markdownAutosave.toggling', "resume preference persisted");
  await exact("Autosave continuous.md", external + "Paused text after restart"); await clean();
  assert.deepEqual(JSON.parse((await readFile(join(directory, ".obsidian", "app.json"), "utf8")).replace(/^\ufeff/, "")).opaqueAutosave, { keep: [true, "中文"] });
  pass("Pause persists per vault through a full host restart/reconnect, retains unrelated configuration and its BOM, keeps explicit Save working, and Resume saves the pending draft.");

  await evaluate('(async()=>{await app.vault.create("Autosave rename.md","Rename: ");await app.openFile("Autosave rename.md",true);app.markdownView.setEditingMode("source")})()');
  await type("saved during rename λ"); await evaluate('app.fileManager.renameFile(app.vault.getFileByPath("Autosave rename.md"),"Autosave renamed.md",false)');
  await exact("Autosave renamed.md", "Rename: saved during rename λ");
  await assert.rejects(readFile(join(directory, "Autosave rename.md")), { code: "ENOENT" });
  await type(" then autosaved"); await exact("Autosave renamed.md", "Rename: saved during rename λ then autosaved"); await clean();
  await type(" close flush"); await press("w", "KeyW", 87, 2);
  await exact("Autosave renamed.md", "Rename: saved during rename λ then autosaved close flush");
  pass("A dirty rename flushes to the correct path, subsequent autosave follows the renamed session, and tab close saves the last edit before its timer expires.");

  await mkdir(join(targetDirectory, ".obsidian"), { recursive: true });
  await writeFile(join(targetDirectory, ".obsidian", "app.json"), '{"markdownAutosave":false,"targetOpaque":"keep"}\n');
  await writeFile(join(targetDirectory, "Autosave continuous.md"), "Target must remain exact.\n");
  await open("Autosave continuous.md"); await type(" transition flush"); await selectVault(targetDirectory);
  assert.equal(await evaluate('app.markdownAutosave.enabled'), false);
  await exact("Autosave continuous.md", external + "Paused text after restart transition flush");
  await delay(2300); assert.equal(await readFile(join(targetDirectory, "Autosave continuous.md"), "utf8"), "Target must remain exact.\n");
  assert.equal(await readFile(join(targetDirectory, ".obsidian", "app.json"), "utf8"), '{"markdownAutosave":false,"targetOpaque":"keep"}\n');
  await selectVault(directory); await wait(`app.vault.rootPath===${JSON.stringify(root)}&&!app.changingVault`, "source vault restored");
  assert.equal(await evaluate('app.markdownAutosave.enabled'), true);
  await open("Autosave continuous.md"); await type(" close/reconnect flush");
  if (browser) { await clean(); }
  await restartHost();
  await open("Autosave continuous.md"); await clean();
  await exact("Autosave continuous.md", external + "Paused text after restart transition flush close/reconnect flush");
  if (originalWorkspace) { assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace); }
  await capture("saved");
  const hashes = {};
  for (const path of ["Autosave exact.md", "Autosave inactive.md", "Autosave continuous.md", "Autosave renamed.md", ".obsidian/app.json"]) { hashes[path] = createHash("sha256").update(await readFile(join(directory, path))).digest("hex"); }
  report.markdownAutosave = { browser, directory, targetDirectory, hashes, defaultOn: true, automaticDelayMs: 2000, continuousMaximumWaitMs: 10000,
    scope: "Actual typing, exact files, split panes, undo/redo, continuous input, failed-save UI/retry, external conflict, persisted pause/resume, rename, tab close, vault switch and orderly host restart/reconnect. Write hold and one-time rejection are explicitly injected at the existing guarded write boundary. No renderer/OS/power-loss durability or complete plugin/editor parity claim." };
  pass("Vault switching flushes the source draft and isolates the target's identical filename and paused preference; returning restores autosave, and orderly close/reconnect retains the last edit and original workspace bytes.");
}
