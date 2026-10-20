import assert from "node:assert/strict";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkRecovery({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const folder = "Recovery workflows", note = folder + "/Recover.md", canvas = folder + "/Board.canvas", base = folder + "/Data.base", lost = folder + "/Lost/Deleted.md";
  const first = "# First version\r\n\r\nSaved λ, 中文 and 😀.\r\n";
  const second = "# Second version\r\n\r\nA newer saved note.\r\n";
  const third = "# External version\r\n\r\nMust be retained before restore.\r\n";
  const canvasText = '{"nodes":[],"edges":[],"future":{"keep":[42,true]}}\r\n';
  const baseText = '# Preserve this base\r\nviews:\r\n  - type: table\r\n    name: Files\r\n    order: [file.name]\r\nfuture: {keep: true}\r\n';
  const settingsPath = join(directory, ".obsidian", "file-recovery.json"), historyPath = join(directory, ".obsidian", "vault-dotnet-recovery.json");
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const api = 'app.core.getEnabledPluginById("file-recovery")';
  const modal = ".recovery-modal", action = name => `${modal} [data-recovery-action="${name}"]`;
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const parsed = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  const exact = async (path, value) => assert.equal(await readFile(join(directory, path), "utf8"), value, path + " exact bytes");
  async function refresh() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function idle() { await evaluate(`${api}.whenIdle()`); await wait(`!document.querySelector('${modal} [data-recovery-status]')?.textContent.includes("Working")`, "recovery operation completed"); }
  async function fill(selector, text) { await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text }); }
  async function toggle(enabled) {
    await click("#open-settings"); await click("#core-plugins-tab");
    if (await evaluate('app.core.isEnabled("file-recovery")') !== enabled) { await click('[data-core-toggle="file-recovery"]'); }
    await wait(`app.core.isEnabled("file-recovery")===${enabled}&&!app.core.busy`, "file recovery lifecycle toggle");
    await click(".settings-close");
  }
  async function settings(interval, keep) {
    await click("#open-settings"); await click("#core-plugins-tab"); await click('[data-core-settings="file-recovery"]');
    await fill('[data-core-field="intervalMinutes"]', String(interval)); await fill('[data-core-field="keepDays"]', String(keep));
    await click('[data-core-save="file-recovery"]');
    await wait(`!app.core.busy&&${api}.options.intervalMinutes===${interval}&&${api}.options.keepDays===${keep}`, "numeric settings persisted through actual controls");
    await click(".settings-close");
  }
  async function open(path) {
    await click(`[data-note-path="${path}"]`);
    await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}`, "actual file tree opens " + path);
  }
  async function history(path = note) {
    await evaluate('app.commands.execute("file-recovery:open")');
    await wait(`Boolean(document.querySelector('${modal}'))`, "history command opens dialog");
    await idle();
    if (path) { await click(`${modal} [data-recovery-path="${path}"]`); await idle(); }
  }
  async function close() { await click(`${modal} .modal-close-button`); await wait(`!document.querySelector('${modal}')`, "history dialog closes"); }
  async function select(id) { await click(`${modal} [data-recovery-id="${id}"]`); await idle(); }
  async function review(id) { await select(id); await click(action("review")); await idle(); }
  async function snapshot(path, content) {
    await wait(`(async()=>{const all=await ${api}.list();return all.some(item=>item.path===${JSON.stringify(path)}&&item.content===${JSON.stringify(content)})})()`, "durable automatic snapshot of " + path);
    return (await parsed()).snapshots.filter(item => item.path === path && item.content === content).at(-1);
  }
  async function restartAndRestore() {
    await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }

  await evaluate("app.workspace.saveAll()"); await toggle(false);
  await mkdir(join(directory, folder, "Lost"), { recursive: true });
  await writeFile(join(directory, note), "\ufeff" + first);
  await writeFile(join(directory, canvas), "\ufeff" + canvasText);
  await writeFile(join(directory, base), "\ufeff" + baseText);
  await writeFile(join(directory, lost), "\ufeffDeleted file, original Unicode λ.\r\n");
  await writeFile(settingsPath, '{"future":{"nativeOption":[true,42]}}\n');
  await writeFile(historyPath, "\ufeff" + JSON.stringify({ version: 1, future: { retained: "opaque" }, snapshots: [{ id: "expired_fixture", path: "Old.md", ts: Date.now() - 8 * 86400000, content: "Expired", hasBom: false, sourceVersion: null, reason: "auto" }] }));
  await refresh(); await toggle(true); await idle();
  await wait(`(async()=>!(await ${api}.list()).some(item=>item.id==="expired_fixture"))()`, "startup retention runs after the vault transition");
  assert.equal((await parsed()).snapshots.some(item => item.id === "expired_fixture"), false, "retention removes an expired fixture on enable");
  assert.equal(await evaluate(`${api}.options.intervalMinutes`), 5);
  assert.equal(await evaluate(`${api}.options.keepDays`), 7);
  await settings(0, 7);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { future: { nativeOption: [true, 42] }, intervalMinutes: 0, keepDays: 7 });
  await open(note);
  const firstSnapshot = await snapshot(note, first);
  assert.equal(firstSnapshot.hasBom, true);
  await history();
  assert.equal(await evaluate(`document.querySelector('${modal} [data-recovery-preview]').value`), first.replace(/\r\n/g, "\n"));
  await click(action("snapshot")); await idle();
  assert.equal((await parsed()).snapshots.filter(item => item.path === note).length, 1, "identical bytes are not duplicated");
  await close();
  await fill(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]", second);
  await press("s", "KeyS", 83, 2);
  await wait("!app.dirty", "real editor save completes");
  await snapshot(note, second); await exact(note, "\ufeff" + second);
  assert.equal(await evaluate('[...document.querySelectorAll(".notice")].some(item=>item.textContent.includes("File recovery is no longer active"))'), false, "normal vault startup does not report a recovery conflict");
  await history(); await fill(`${modal} [data-recovery-search]`, "Recover.md");
  assert.equal(await evaluate(`document.querySelectorAll('${modal} [data-recovery-path]').length`), 1);
  await fill(`${modal} [data-recovery-search]`, "");
  await select(firstSnapshot.id);
  await capture?.();
  pass("Real open/save events record durable saved-text snapshots with exact BOM/CRLF/Unicode, numeric settings, deduplication, searchable versions and history previews; expired history is pruned.");

  await review(firstSnapshot.id);
  assert.equal(await evaluate(`document.querySelector('${modal} [aria-label="Current saved text before restore"]').value`), second.replace(/\r\n/g, "\n"));
  await click(action("cancel")); await idle(); await exact(note, "\ufeff" + second);
  await review(firstSnapshot.id);
  await writeFile(join(directory, note), "\ufeff" + third);
  await click(action("confirm-restore")); await idle();
  assert.match(await evaluate(`document.querySelector('${modal} [data-recovery-status]').textContent`), /changed after the restore review/);
  await exact(note, "\ufeff" + third);
  await close(); await refresh();
  await wait(`app.editor.getValue()===${JSON.stringify(third)}`, "clean editor receives external text");
  await fill(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]", third + "Unsaved draft\r\n");
  await history(); await select(firstSnapshot.id); await click(action("review")); await idle();
  assert.match(await evaluate(`document.querySelector('${modal} [data-recovery-status]').textContent`), /unsaved views/);
  await exact(note, "\ufeff" + third); await close();
  await press("z", "KeyZ", 90, 2); await press("s", "KeyS", 83, 2); await wait("!app.dirty", "dirty restore rejection retains undo and save");
  await history(); await review(firstSnapshot.id); await click(action("confirm-restore")); await idle();
  await exact(note, "\ufeff" + first);
  assert.ok((await parsed()).snapshots.some(item => item.path === note && item.content === third), "previous disk text is durable before replacement");
  assert.equal(await evaluate("app.editor.getValue()"), first);
  pass("Restore review/cancel, stale external-version rejection and dirty-buffer refusal preserve disk and editor text; confirmed restore refreshes the real note and keeps its replaced saved version in history.");

  await close(); await open(canvas); const canvasSnapshot = await snapshot(canvas, canvasText);
  await writeFile(join(directory, canvas), "\ufeff" + canvasText.replace("42", "43")); await refresh();
  await history(canvas); await review(canvasSnapshot.id); await click(action("confirm-restore")); await idle();
  await exact(canvas, "\ufeff" + canvasText); await close();
  await open(base); const baseSnapshot = await snapshot(base, baseText);
  await writeFile(join(directory, base), "\ufeff" + baseText + "# External change\r\n"); await refresh();
  await history(base); await review(baseSnapshot.id); await click(action("confirm-restore")); await idle();
  await exact(base, "\ufeff" + baseText); await close();
  await open(lost); const lostSnapshot = await snapshot(lost, "Deleted file, original Unicode λ.\r\n");
  await open(note);
  await rm(join(directory, lost)); await rmdir(join(directory, folder, "Lost")); await refresh();
  await history(lost); await review(lostSnapshot.id); await click(action("confirm-restore")); await idle();
  await exact(lost, "\ufeffDeleted file, original Unicode λ.\r\n");
  const validHistory = await readFile(historyPath, "utf8");
  await writeFile(historyPath, '{"version":2,"future":"Do not erase incompatible history"}');
  await click(action("reload")); await idle();
  assert.match(await evaluate(`document.querySelector('${modal} [data-recovery-status]').textContent`), /Unsupported or damaged/);
  assert.equal(await readFile(historyPath, "utf8"), '{"version":2,"future":"Do not erase incompatible history"}');
  await writeFile(historyPath, validHistory); await click(action("reload")); await idle(); await close();
  pass("Markdown, Canvas and Bases restore their real saved files; deleted text files recreate missing parents and BOMs, while unsupported recovery-store versions fail visibly without clearing stored data.");

  await restartAndRestore(); await history(note); await select(firstSnapshot.id);
  assert.equal(await evaluate(`document.querySelector('${modal} [data-recovery-preview]').value`), first.replace(/\r\n/g, "\n"));
  await click(action("clear")); await idle();
  await evaluate(`window.staleRecoveryClear=document.querySelector('${action("confirm-clear")}')`);
  await click(action("cancel")); await idle();
  const retainedHistory = await readFile(historyPath, "utf8");
  await evaluate("window.staleRecoveryClear.click()"); await idle();
  assert.equal(await readFile(historyPath, "utf8"), retainedHistory, "cancelled clear action is invalidated");
  await review(firstSnapshot.id);
  await evaluate(`window.staleRecoveryRestore=document.querySelector('${action("confirm-restore")}')`);
  await close(); await toggle(false);
  assert.equal(await evaluate('app.commands.listCommands().some(item=>item.id.startsWith("file-recovery:"))'), false);
  await evaluate("window.staleRecoveryRestore.click()");
  await exact(note, "\ufeff" + first);
  await restartAndRestore(); assert.equal(await evaluate('app.core.isEnabled("file-recovery")'), false);
  assert.equal(await readFile(historyPath, "utf8"), retainedHistory, "disabled restart preserves recovery data");
  await toggle(true); await history(note); await select(firstSnapshot.id);
  await click(action("clear")); await idle(); await click(action("confirm-clear")); await idle();
  assert.deepEqual((await parsed()).snapshots, []);
  assert.deepEqual((await parsed()).future, { retained: "opaque" });
  await exact(note, "\ufeff" + first); await exact(canvas, "\ufeff" + canvasText); await exact(base, "\ufeff" + baseText);
  if (originalWorkspace) { assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace); }
  else { await assert.rejects(readFile(join(directory, ".obsidian", "workspace.json")), { code: "ENOENT" }); }
  await close();
  pass("History, settings and opaque data survive full host restarts/reconnects; disable/re-enable cleans up commands/dialogs, cancelled or detached actions cannot restore/clear, and confirmed clear removes only recovery snapshots.");
  if (report.coreChecks) {
    for (const id of ["file-recovery:restore", "file-recovery:retention", "file-recovery:settings"]) {
      assert.ok(!report.coreChecks.some(check => check.id === id), "Duplicate recovery observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  }
}
