import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// This suite is launched only with Chromium's synthetic microphone flags.
// Fault injections below exercise failures; successful clips use real MediaRecorder.
export async function checkAudio({ directory, evaluate, command, click, press, wait, handleDialog, afterReload, restart, capture, report }) {
  const folder = "Audio workflows", note = folder + "/Capture.md";
  const initial = "# Audio capture\r\n\r\nKeep Unicode λ, 中文 and 😀.\r\n";
  const external = "# Newer external note\r\n\r\nRetain these changed bytes.\r\n";
  const api = 'app.core.getEnabledPluginById("audio-recorder")';
  const modal = ".audio-recorder-modal", action = name => `${modal} [data-audio-action="${name}"]`;
  const editor = ".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .cm-content[contenteditable=true]";
  const ribbon = '[data-core-ribbon="audio-recorder"]';
  const workspacePath = join(directory, ".obsidian", "workspace.json");
  const originalWorkspace = await readFile(workspacePath).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const settingsPath = join(directory, ".obsidian", "audio-recorder.json");
  const settings = '{"future":{"nativeOption":[true,42]}}\r\n';
  const appSettingsPath = join(directory, ".obsidian", "app.json");
  const oldAppSettings = JSON.parse((await readFile(appSettingsPath, "utf8").catch(error => { if (error.code !== "ENOENT") { throw error; } return "{}"; })).replace(/^\ufeff/, ""));
  const appSettings = JSON.stringify({ ...oldAppSettings, attachmentFolderPath: "./Audio", futureAudioFixture: { keep: [42, true] } }) + "\r\n";
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate audio observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  async function refresh() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function fill(selector, text) { await click(selector); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text }); }
  async function toggle(enabled) {
    await click("#open-settings"); await click("#core-plugins-tab");
    assert.equal(await evaluate('Boolean(document.querySelector(\'[data-core-settings="audio-recorder"]\'))'), false, "reference recorder has no settings page");
    if (await evaluate('app.core.isEnabled("audio-recorder")') !== enabled) { await click('[data-core-toggle="audio-recorder"]'); }
    await wait(`app.core.isEnabled("audio-recorder")===${enabled}&&!app.core.busy`, "audio lifecycle toggle");
    await click(".settings-close");
  }
  async function open(path) {
    await click(`[data-note-path="${path}"]`);
    await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}`, "file tree opens " + path);
  }
  async function source() {
    await open(note);
    if (await evaluate('app.workspace.activeLeaf.view.getMode()') !== "source") { await press("e", "KeyE", 69, 2); }
    await click(editor); await press("End", "End", 35, 2);
  }
  async function show() { await click(ribbon); await wait(`Boolean(document.querySelector('${modal}'))`, "recorder dialog"); }
  async function close() { await click(`${modal} .modal-close-button`); await wait(`!document.querySelector('${modal}')`, "recorder closes"); }
  async function start() {
    await click(action("start"));
    await wait(`${api}.capture.state==="recording"&&${api}.capture.liveTracks===1`, "actual synthetic MediaRecorder acquisition");
    await wait(`${api}.capture.elapsedMs>=1000`, "record a playable synthetic clip");
  }
  async function stop() {
    await click(action("stop"));
    await wait(`${api}.capture.state==="ready"&&${api}.capture.liveTracks===0`, "finalized recording releases microphone");
    await wait(`document.querySelector('${modal} [data-audio-preview]').readyState>=1`, "browser decodes recorded preview");
    return Buffer.from(await evaluate(`(async()=>Array.from(new Uint8Array(await ${api}.capture.data.arrayBuffer())))()`));
  }
  async function idle() { await wait(`!${api}.busy&&!app.core.busy`, "audio save finished"); }
  async function play(selector) {
    await wait(`document.querySelector(${JSON.stringify(selector)})?.readyState>=1`, "audio metadata loaded");
    const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});window.audioPlaybackController=new AbortController();window.audioPlaybackProbe={events:[]};for(const name of ["click","play","playing","timeupdate","pause","ended","error"]){el.addEventListener(name,event=>window.audioPlaybackProbe.events.push({type:event.type,trusted:event.isTrusted,time:el.currentTime,paused:el.paused}),{signal:window.audioPlaybackController.signal})}el.scrollIntoView({block:"center"});const b=el.getBoundingClientRect();return{x:b.left+20,y:b.top+b.height/2}})()`);
    try {
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
      await wait(`(()=>{const a=document.querySelector(${JSON.stringify(selector)});return a&&!a.paused&&a.currentTime>0})()`, "native audio controls play saved bytes");
    } catch (error) {
      const diagnostic = await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(selector)}),hit=document.elementFromPoint(${point.x},${point.y});return{...window.audioPlaybackProbe,ready:a?.readyState,network:a?.networkState,time:a?.currentTime,paused:a?.paused,ended:a?.ended,error:a?.error?.message,rectangle:a?.getBoundingClientRect().toJSON(),hit:{tag:hit?.tagName,className:hit?.className},visibility:document.visibilityState}})()`);
      throw new Error(`${error.message}\nAudio playback: ${JSON.stringify({ point, ...diagnostic })}`, { cause: error });
    } finally {
      await evaluate(`document.querySelector(${JSON.stringify(selector)})?.pause();window.audioPlaybackController.abort()`);
    }
  }
  async function saveNote() {
    await click(editor); await press("s", "KeyS", 83, 2); await wait("!app.dirty", "save note through real editor");
    const value = await evaluate("app.editor.getValue()");
    assert.equal(await readFile(join(directory, note), "utf8"), "\ufeff" + value, "BOM and source bytes remain exact");
    assert.ok(!value.replace(/\r\n/g, "").includes("\n"), "insertion retains CRLF");
    return value;
  }
  async function restartAndRestore() {
    await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }

  await evaluate("app.workspace.saveAll()");
  if (await evaluate("app.workspace.leftSplit.collapsed")) { await click('[aria-label="Toggle left sidebar"]'); }
  await click('[data-sidebar-view="file-explorer"]');
  await toggle(false);
  await mkdir(join(directory, folder), { recursive: true });
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(join(directory, note), "\ufeff" + initial);
  await writeFile(settingsPath, settings); await writeFile(appSettingsPath, appSettings);
  await refresh(); await toggle(true); await source(); await show();
  assert.equal(await evaluate(`${api}.capture.state`), "idle");
  assert.equal(await evaluate(`${api}.capture.liveTracks`), 0, "opening a dialog does not request microphone access");
  await start(); const firstBytes = await stop();
  assert.ok(firstBytes.length > 0);
  await wait(`document.querySelector('${modal} [data-audio-path]').value.startsWith("${folder}/Audio/Recording ")`, "note-relative attachment preference");
  const firstPath = await evaluate(`document.querySelector('${modal} [data-audio-path]').value`);
  await capture?.();
  await click(action("insert")); await idle();
  assert.equal(await evaluate(`${api}.inserted`), true);
  assert.equal(await evaluate(`${api}.saved.path`), firstPath);
  assert.deepEqual(await readFile(join(directory, firstPath)), firstBytes, "recorded binary attachment is byte-exact");
  assert.equal(await readFile(join(directory, note), "utf8"), "\ufeff" + initial, "insertion remains an editor edit until saved");
  await close(); const firstNote = await saveNote();
  assert.ok(firstNote.startsWith(initial)); assert.match(firstNote, /!\[\[/);
  await press("e", "KeyE", 69, 2);
  await play(`[data-vault-audio="${firstPath}"]`);
  await open(firstPath); await wait('app.workspace.activeLeaf.view.getViewType()==="audio"', "attachment provider opens an audio pane");
  await play(`.audio-file-view [data-vault-audio="${firstPath}"]`);
  pass("Explicit synthetic microphone start/stop releases tracks; real preview decoding, note-relative attachment saving, exact binary bytes, guarded CRLF/BOM/Unicode note insertion and both Reading/file-pane playback work.");

  await source(); await show(); await click(action("discard")); await close();
  await writeFile(appSettingsPath, JSON.stringify({ ...oldAppSettings, attachmentFolderPath: "../outside" }));
  await show();
  await wait(`document.querySelector('${modal} [data-audio-status]').textContent.includes("valid relative attachment path")`, "invalid attachment preference is visible");
  await evaluate("window.audioConfigCheckStarted=Date.now()");
  await wait(`Date.now()-window.audioConfigCheckStarted>=650&&document.querySelector('${modal} [data-audio-status]').textContent.includes("valid relative attachment path")`, "timer retains attachment-setting errors");
  await close(); await writeFile(appSettingsPath, appSettings); await show();
  await evaluate(`window.audioOriginalSupports=${api}.capture.host.supports;${api}.capture.host.supports=()=>false`);
  await click(action("start")); await wait(`${api}.capture.state==="error"`, "unsupported codec error");
  assert.match(await evaluate(`document.querySelector('${modal} [data-audio-status]').textContent`), /no supported/);
  assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
  await evaluate(`${api}.capture.host.supports=window.audioOriginalSupports;window.audioOriginalAcquire=${api}.capture.host.acquire;${api}.capture.host.acquire=async()=>{throw new DOMException("Denied fixture","NotAllowedError")}`);
  await click(action("start")); await wait(`${api}.capture.state==="error"`, "permission-denied error");
  assert.match(await evaluate(`document.querySelector('${modal} [data-audio-status]').textContent`), /permission was denied/);
  await evaluate(`${api}.capture.host.acquire=window.audioOriginalAcquire`);
  await start(); const secondBytes = await stop();
  await fill(`${modal} [data-audio-path]`, firstPath); await click(action("save")); await idle();
  assert.match(await evaluate(`document.querySelector('${modal} [data-audio-status]').textContent`), /exist|overwrite|collision/i);
  assert.equal(await evaluate(`${api}.saved`), null); assert.equal(await evaluate(`${api}.capture.data.size`), secondBytes.length);
  assert.deepEqual(await readFile(join(directory, firstPath)), firstBytes);
  const secondPath = firstPath.replace(/\.(m4a|webm|ogg)$/, " retry.$1");
  await fill(`${modal} [data-audio-path]`, secondPath);
  await evaluate('window.audioOriginalCreate=app.vault.createBinary.bind(app.vault);app.vault.createBinary=async(...args)=>{const file=await window.audioOriginalCreate(...args);window.audioSavePaused=true;await new Promise(resolve=>window.audioResumeSave=resolve);return file}');
  await click(action("insert")); await wait("window.audioSavePaused===true", "pause after real binary creation");
  await writeFile(join(directory, note), "\ufeff" + external);
  await evaluate("window.audioResumeSave();app.vault.createBinary=window.audioOriginalCreate"); await idle();
  assert.equal(await evaluate(`${api}.inserted`), false);
  assert.match(await evaluate(`document.querySelector('${modal} [data-audio-status]').textContent`), /note changed|note or selection changed/);
  assert.deepEqual(await readFile(join(directory, secondPath)), secondBytes);
  assert.equal(await readFile(join(directory, note), "utf8"), "\ufeff" + external);
  await close(); await refresh(); await source();
  await wait(`app.editor.getValue()===${JSON.stringify(external)}`, "external note is current before retry");
  await show(); assert.equal(await evaluate(`document.querySelector('${modal} [data-audio-path]').value`), secondPath);
  await click(action("insert")); await idle(); assert.equal(await evaluate(`${api}.inserted`), true);
  await close(); const secondNote = await saveNote(); assert.ok(secondNote.startsWith(external));
  assert.deepEqual((await readdir(join(directory, folder, "Audio"))).sort(), [firstPath.split("/").at(-1), secondPath.split("/").at(-1)].sort(), "retry reuses the already-saved asset");
  pass("Codec/permission failures are visible without live tracks; collision saves retain both existing bytes and the new draft, and a concurrent note edit keeps the saved clip for a safe insertion retry without duplicate attachments.");

  await show(); await click(action("discard")); await start();
  await evaluate("window.audioReloadToken='recording-must-survive';window.addEventListener('beforeunload',event=>window.audioUnloadPrevented=event.defaultPrevented,{once:true})");
  // Electron emits will-prevent-unload instead of Chrome's beforeunload dialog.
  await command("Page.reload");
  await wait("window.audioUnloadPrevented===true", "actual reload invokes the unsaved-audio guard");
  assert.equal(await evaluate("window.audioReloadToken"), "recording-must-survive");
  assert.equal(await evaluate(`${api}.capture.liveTracks`), 1);
  await stop();
  const cancelledClose = click(`${modal} .modal-close-button`); await handleDialog(false); await cancelledClose;
  await wait(`Boolean(document.querySelector('${modal}'))&&${api}.capture.state==="ready"`, "cancel keeps unsaved clip");
  const acceptedClose = close(); await handleDialog(true); await acceptedClose;
  await evaluate(`window.audioStaleStart=null`); await show();
  await evaluate(`window.audioStaleStart=document.querySelector('${action("start")}')`);
  await close(); await evaluate("window.audioStaleStart.click()");
  assert.equal(await evaluate(`${api}.capture.state`), "idle");
  await show(); await start(); await evaluate(`window.audioOldCapture=${api}.capture`);
  const refusedDisable = evaluate('app.core.setEnabled("audio-recorder",false)').then(() => null, error => error.message);
  await handleDialog(false); assert.match(await refusedDisable, /retained/);
  assert.equal(await evaluate('app.core.isEnabled("audio-recorder")'), true);
  const acceptedDisable = evaluate('app.core.setEnabled("audio-recorder",false)'); await handleDialog(true); await acceptedDisable;
  assert.equal(await evaluate("window.audioOldCapture.liveTracks"), 0);
  assert.equal(await evaluate(`Boolean(document.querySelector('${modal}'))`), false);
  assert.equal(await evaluate('app.commands.listCommands().some(item=>item.id.startsWith("audio-recorder:"))'), false);
  assert.equal(await evaluate(`Boolean(document.querySelector('${ribbon}'))`), false);
  assert.deepEqual((await readdir(join(directory, folder, "Audio"))).sort(), [firstPath.split("/").at(-1), secondPath.split("/").at(-1)].sort());
  accept("audio-recorder:record");
  pass("Actual reload and discard confirmations can retain a live/unsaved clip; accepted discard creates no file, detached controls cannot reacquire the microphone, and disabling is vetoable before complete track/command/ribbon/dialog cleanup.");

  await toggle(true); await open(secondPath);
  await evaluate('(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({...leaf.getViewState(),state:{...leaf.view.getState(),future:{retained:[true,42]}}});await app.workspace.flushLayout()})()');
  await restartAndRestore();
  await wait('app.workspace.activeLeaf.view.getViewType()==="audio"', "audio pane restores after full restart/reconnect");
  assert.deepEqual(await evaluate("app.workspace.activeLeaf.view.getState().future"), { retained: [true, 42] });
  assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
  await play(`.audio-file-view [data-vault-audio="${secondPath}"]`);
  await toggle(false); assert.equal(await evaluate("app.workspace.activeLeaf.view.getViewType()"), "unavailable");
  await restartAndRestore(); assert.equal(await evaluate('app.core.isEnabled("audio-recorder")'), false);
  await toggle(true); await wait('app.workspace.activeLeaf.view.getViewType()==="audio"', "re-enabled provider restores saved pane");
  await play(`.audio-file-view [data-vault-audio="${secondPath}"]`);
  assert.deepEqual(await evaluate("app.workspace.activeLeaf.view.getState().future"), { retained: [true, 42] });
  assert.deepEqual(await readFile(join(directory, firstPath)), firstBytes); assert.deepEqual(await readFile(join(directory, secondPath)), secondBytes);
  assert.equal(await readFile(join(directory, note), "utf8"), "\ufeff" + secondNote);
  assert.equal(await readFile(settingsPath, "utf8"), settings); assert.equal(await readFile(appSettingsPath, "utf8"), appSettings);
  if (originalWorkspace) { assert.deepEqual(await readFile(workspacePath), originalWorkspace); }
  else { await assert.rejects(readFile(workspacePath), { code: "ENOENT" }); }
  accept("audio-recorder:settings");
  pass("Full host restarts/reconnects retain playable attachments, opaque pane state and disabled-provider restoration without microphone acquisition; unknown module/app configuration and the original workspace stay unchanged.");
  report.syntheticAudioOnly = true;
  report.physicalMicrophoneTested = false;
}
