import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, api = 'app.core.getEnabledPluginById("audio-recorder")';
const modal = ".audio-recorder-modal", action = name => modal + ' [data-audio-action="' + name + '"]';
const bytes = text => Buffer.from("\ufeff" + text);
const initial = "# Pause and resume λ\r\n\r\nRetain original 😀 bytes.\r\n", dirty = initial + "Earlier unsaved prose Ω.\r\n";
const optionalBytes = path => readFile(path).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
export const audioPauseResumeReadOnlyFixture = { files: [["Cached playback.wav", await readFile(new URL("../Example/90 Attachments/Synthetic tone.wav", import.meta.url))]] };
async function restoreBytes(path, original) { if (original !== null) await writeFile(path, original); else await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }
async function key(command, value, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of [value === "Enter" ? "keyDown" : "rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", {
    type, key: value, code, windowsVirtualKeyCode, modifiers,
    ...(value === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
  });
}
async function fill(tools, selector, text) { await tools.click(selector); await key(tools.command, "a", "KeyA", 65, 2); await tools.command("Input.insertText", { text }); }
async function disabledPointer(tools, selector) {
  const point = await tools.evaluate(`(()=>{const el=document.querySelector(${q(selector)});el.scrollIntoView({block:"center"});const r=Array.from(el.getClientRects()).find(rect=>rect.width>0&&rect.height>0),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,disabled:el.disabled,reachable:hit===el||el.contains(hit)}})()`);
  assert.equal(point.disabled, true); assert.equal(point.reachable, true);
  for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
}

/** Uses real MediaRecorder with the runner's explicitly isolated synthetic microphone. */
export async function checkAudioPauseResume(tools) {
  const { directory, evaluate, wait, click, command, handleDialog, report, restart, afterReload, capture } = tools;
  assert.equal(report.syntheticAudioOnly, true, "Run only with the isolated synthetic-microphone flags");
  assert.equal(report.physicalMicrophoneTested, false);
  const folder = "Audio pause validation", path = folder + "/Source.md", leaf = "audio-pause-note", source = "app.workspace.getLeafById(" + q(leaf) + ").view";
  const editor = '[data-leaf-id="' + leaf + '"] .cm-content';
  const configPath = join(directory, ".obsidian/app.json"), corePath = join(directory, ".obsidian/core-plugins.json");
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("audio-recorder")');
  const configBytes = await optionalBytes(configPath), coreBytes = await optionalBytes(corePath), configuration = configBytes ? JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, "")) : {};
  const workingConfig = Buffer.from(JSON.stringify({ ...configuration, markdownAutosave: false }, null, 2));
  let stage = "fixture", failure, clipBytes, clipPath, finalText;
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const open = async () => { await click('[data-core-ribbon="audio-recorder"]'); await wait(`Boolean(document.querySelector(${q(modal)}))`, "audio recording controls"); };
  const start = async () => { await click(action("start")); await wait(`${api}.capture.state==="recording"&&${api}.capture.liveTracks===1`, "actual synthetic recorder started"); await wait(`${api}.capture.elapsedMs>=550`, "real encoded audio before pause"); };
  const pause = async () => { await click(action("pause")); await wait(`${api}.capture.state==="paused"&&${api}.capture.recorder?.state==="paused"`, "real MediaRecorder acknowledges pause"); };
  const close = async () => { await click(modal + " .modal-close-button"); await wait(`!document.querySelector(${q(modal)})`, "recorder dialog closes"); };
  const waitIdle = () => wait(`!app.core.busy&&!${api}.busy`, "recording operation finished");
  const exactSource = async expected => { assert.equal(await evaluate(source + ".editor.getValue()"), expected); assert.deepEqual(await readFile(join(directory, path)), bytes(initial)); };
  const expectedLayout = { version: 1, main: { id: "audio-pause-main", type: "split", direction: "vertical", children: [{ id: "audio-pause-tabs", type: "tabs", currentTab: 0, children: [{ id: leaf, type: "leaf", state: { type: "markdown", state: { file: path, mode: "source", source: true } } }] }] }, active: leaf };
  try {
    await mkdir(join(directory, folder)); await writeFile(join(directory, path), bytes(initial), { flag: "wx" });
    await writeFile(configPath, workingConfig);
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()');
    if (!enabled) await evaluate('app.core.setEnabled("audio-recorder",true)');
    await evaluate("app.workspace.changeLayout(" + q(expectedLayout) + ")"); await wait(source + "?.editor&&" + source + ".editor.getValue()===" + q(initial), "owned audio source editor");
    await click(editor); await key(command, "End", "End", 35, 2); await command("Input.insertText", { text: "Earlier unsaved prose Ω.\n" });
    await wait(source + ".session.dirty&&" + source + ".editor.getValue()===" + q(dirty), "earlier trusted dirty prose");
    await open();
    await evaluate(`(()=>{const c=${api}.capture,h=c.host;globalThis.audioPauseTrace={capture:c,host:h,acquire:h.acquire,create:h.create,acquisitions:0,encoders:0,events:[],abort:new AbortController()};const t=audioPauseTrace;h.acquire=function(...args){t.acquisitions++;return t.acquire.apply(this,args)};h.create=function(...args){t.encoders++;return t.create.apply(this,args)};for(const type of ["pointerdown","keydown"])document.addEventListener(type,event=>{if(event.target.closest?.(${q(modal)}))t.events.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()`);

    stage = "acknowledged pause and retained live microphone";
    await start(); await evaluate(`audioPauseTrace.encoder=${api}.capture.recorder`); await pause();
    const paused = await evaluate(`(()=>{const c=${api}.capture;return{elapsed:c.elapsedMs,tracks:c.liveTracks,unsaved:${api}.hasUnsavedAudio,pauseHidden:document.querySelector(${q(action("pause"))}).hidden,resumeEnabled:!document.querySelector(${q(action("resume"))}).disabled,stopEnabled:!document.querySelector(${q(action("stop"))}).disabled,saveDisabled:document.querySelector(${q(action("save"))}).disabled,insertDisabled:document.querySelector(${q(action("insert"))}).disabled}})()`);
    assert.equal(paused.tracks, 1); for (const field of ["unsaved", "pauseHidden", "resumeEnabled", "stopEnabled", "saveDisabled", "insertDisabled"]) assert.equal(paused[field], true, field);
    await evaluate("audioPauseTrace.pausedAt=Date.now()"); await wait("Date.now()-audioPauseTrace.pausedAt>=750", "paused active-duration display remains frozen across timer refresh");
    assert.equal(await evaluate(`${api}.capture.elapsedMs`), paused.elapsed); await exactSource(dirty); await capture?.("audio-paused");
    pass("Actual synthetic MediaRecorder pause retains one live microphone and an unsaved clip, freezes acknowledged active duration, exposes Resume/Stop and disables save/insert; earlier dirty BOM/CRLF/Unicode prose and physical bytes stay exact.");

    stage = "paused lifecycle refusals";
    await evaluate("window.audioPauseReloadNonce='keep-paused';window.addEventListener('beforeunload',event=>window.audioPauseUnloadPrevented=event.defaultPrevented,{once:true})");
    await command("Page.reload"); await wait("window.audioPauseUnloadPrevented===true", "paused audio vetoes actual browser reload");
    assert.equal(await evaluate("window.audioPauseReloadNonce"), "keep-paused");
    const refusedClose = click(modal + " .modal-close-button"); await handleDialog(false); await refusedClose;
    const refusedDiscard = click(action("discard")); await handleDialog(false); await refusedDiscard;
    const refusedDisable = evaluate('app.core.setEnabled("audio-recorder",false)').then(() => null, error => error.message); await handleDialog(false); assert.match(await refusedDisable, /retained/);
    assert.equal(await evaluate(`${api}.capture.state`), "paused"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 1); assert.equal(await evaluate('app.core.isEnabled("audio-recorder")'), true); await exactSource(dirty);
    pass("Paused audio vetoes an actual reload and cancelled Close, Discard and core-disable confirmations; the same clip/microphone and earlier dirty source remain intact without a file write.");

    stage = "resume same encoder and stop while paused";
    await click(action("resume")); await wait(`${api}.capture.state==="recording"&&${api}.capture.recorder?.state==="recording"`, "actual MediaRecorder resumes the same clip");
    assert.equal(await evaluate(`${api}.capture.recorder===audioPauseTrace.encoder`), true);
    await wait(`${api}.capture.elapsedMs>=${paused.elapsed + 550}`, "resumed active audio advances its timer");
    await evaluate("document.querySelector(" + q(action("pause")) + ").focus()"); await key(command, "Enter", "Enter", 13);
    await wait(`${api}.capture.state==="paused"&&${api}.capture.recorder?.state==="paused"`, "trusted keyboard pauses the same encoder");
    await click(action("stop")); await wait(`${api}.capture.state==="ready"&&${api}.capture.liveTracks===0`, "Stop finalizes paused audio and releases the microphone");
    await wait(`document.querySelector(${q(modal + " [data-audio-preview]")})?.readyState>=1`, "recorded same-clip preview is decodable");
    clipBytes = Buffer.from(await evaluate(`(async()=>Array.from(new Uint8Array(await ${api}.capture.data.arrayBuffer())))()`)); assert.ok(clipBytes.length > 0);
    assert.deepEqual(await evaluate("({acquisitions:audioPauseTrace.acquisitions,encoders:audioPauseTrace.encoders})"), { acquisitions: 1, encoders: 1 });
    await capture?.("audio-paused-preview"); await exactSource(dirty);
    pass("Trusted Resume and keyboard Pause operate on the original recorder without a second microphone acquisition or encoder. Stop while paused produces one nonempty decodable Blob and releases all tracks.");

    stage = "saved bytes and isolated shared source undo";
    const extension = await evaluate(`${api}.capture.mime.split(";")[0]==="audio/mp4"?"m4a":${api}.capture.mime.split(";")[0]==="audio/ogg"?"ogg":"webm"`);
    clipPath = folder + "/Saved paused clip." + extension; await fill(tools, modal + " [data-audio-path]", clipPath); await click(action("insert")); await waitIdle();
    assert.equal(await evaluate(`${api}.inserted`), true); assert.equal(await evaluate(`${api}.saved.path`), clipPath); assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes);
    const link = await evaluate("app.fileManager.generateMarkdownLink(app.vault.getFileByPath(" + q(clipPath) + ")," + q(path) + ")"); finalText = dirty + "\r\n!" + link + "\r\n";
    await exactSource(finalText); await close(); await click(editor); await key(command, "z", "KeyZ", 90, 2);
    await wait(source + ".editor.getValue()===" + q(dirty), "one source Undo removes only the new recording embed"); await exactSource(dirty);
    await key(command, "y", "KeyY", 89, 2); await wait(source + ".editor.getValue()===" + q(finalText), "source Redo restores exact audio embed");
    await key(command, "z", "KeyZ", 90, 2); await key(command, "z", "KeyZ", 90, 2); await wait(source + ".editor.getValue()===" + q(initial), "second Undo retains earlier body transaction separation");
    await key(command, "y", "KeyY", 89, 2); await key(command, "y", "KeyY", 89, 2); await wait(source + ".editor.getValue()===" + q(finalText), "both original transactions redo");
    await key(command, "s", "KeyS", 83, 2); await wait("!" + source + ".session.dirty&&!" + source + ".session.isSaving", "normal source save persists the audio link");
    assert.deepEqual(await readFile(join(directory, path)), bytes(finalText)); assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes); await capture?.("audio-inserted");
    pass("Saving/inserting the resumed clip writes byte-identical audio and one preferences-correct embed. Shared source Undo/Redo isolates the embed from earlier dirty prose, and normal Ctrl+S retains exact BOM/CRLF/Unicode note bytes.");

    report.audioPauseInputs = await evaluate("audioPauseTrace.events"); assert.ok(report.audioPauseInputs.length >= 10 && report.audioPauseInputs.every(event => event.trusted));
    await evaluate("(()=>{const t=audioPauseTrace;t.host.acquire=t.acquire;t.host.create=t.create;t.abort.abort()})()");
    stage = "restart persisted clip without renewing microphone";
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(source + "?.editor&&" + source + ".editor.getValue()===" + q(finalText), "fresh source owner restores exact saved audio embed");
    assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0); assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes); assert.deepEqual(await readFile(join(directory, path)), bytes(finalText));
    pass("Full native restart or actual-folder browser reconnection restores the exact saved clip and embed with an idle recorder and no live microphone; unsaved-audio crash rescue is not claimed.");

    stage = "accepted paused disable discards only its unsaved clip";
    await open(); await start(); await pause(); await evaluate(`globalThis.audioPauseOldCapture=${api}.capture`);
    assert.equal(await evaluate("app.workspace.hasUnsavedChanges||app.attachments.busy||app.changingVault"), false, "Only paused audio can veto this clean-document reload");
    await evaluate("window.audioPauseOnlyReloadNonce='paused-only';window.addEventListener('beforeunload',event=>window.audioPauseOnlyUnloadPrevented=event.defaultPrevented,{once:true})");
    await command("Page.reload"); await wait("window.audioPauseOnlyUnloadPrevented===true", "paused audio alone vetoes an actual clean-document reload");
    assert.equal(await evaluate("window.audioPauseOnlyReloadNonce"), "paused-only"); assert.equal(await evaluate(`${api}.capture.state`), "paused"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 1);
    const acceptedDisable = evaluate('app.core.setEnabled("audio-recorder",false)'); await handleDialog(true); await acceptedDisable;
    assert.equal(await evaluate("audioPauseOldCapture.liveTracks"), 0); assert.equal(await evaluate("audioPauseOldCapture.state"), "disposed"); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false);
    assert.equal(await evaluate('app.commands.listCommands().some(item=>item.id.startsWith("audio-recorder:"))'), false); assert.equal(await evaluate('Boolean(document.querySelector(\'[data-core-ribbon="audio-recorder"]\'))'), false);
    assert.deepEqual((await readdir(join(directory, folder))).sort(), ["Source.md", clipPath.split("/").at(-1)].sort()); assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes); assert.deepEqual(await readFile(join(directory, path)), bytes(finalText));
    await evaluate('app.core.setEnabled("audio-recorder",true)'); assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
    report.audioPauseResume = { syntheticMicrophoneOnly: true, nativeMediaRecorderPause: true, nativeMediaRecorderResume: true, sameCaptureAndEncoder: true, pausedTracksRetained: true, acknowledgedActiveDuration: true, pausedSaveInsertDisabled: true, pausedUnsavedGuard: true, reloadVeto: true, pausedOnlyReloadVeto: true, closeDiscardDisableVeto: true, keyboardPause: true, stopWhilePaused: true, decodableSingleBlob: true, exactSavedAudio: true, preferencesCorrectEmbed: true, isolatedSourceUndoRedo: true, earlierDirtyProseRetained: true, exactBomCrlfUnicode: true, restartRetainsSavedClip: true, noMicrophoneOnRestart: true, acceptedPausedDisableReleases: true, commandsAndDialogCleaned: true, noExtraAttachment: true, trustedInputs: true };
    pass("Paused audio alone vetoes an actual reload with every note saved and no attachment/vault operation pending. Accepted disable releases its microphone and disposes commands/ribbon/dialog without creating another attachment; re-enabling starts idle and retains the saved clip/note exactly.");
  } catch (error) {
    failure = error; report.audioPauseResumeFailure = { stage, error: String(error?.stack ?? error) };
    try { report.audioPauseResumeFailure.state = await evaluate(`(()=>{const p=${api};return{file:app.workspace.getActiveFile()?.path,dirty:app.dirty,capture:p&&{state:p.capture.state,message:p.capture.message,tracks:p.capture.liveTracks,elapsed:p.capture.elapsedMs,bytes:p.capture.bytes,hasBlob:Boolean(p.capture.data)},status:document.querySelector(${q(modal + " [data-audio-status]")})?.textContent}})()`); await capture?.("audio-pause-precleanup-failure"); } catch {}
    throw error;
  } finally {
    try {
      await evaluate('(()=>{const p=app.core.getPluginById("audio-recorder")?.instance;p?.capture.cancel();p?.modal?.forceClose();if(p)p.modal=null;const t=globalThis.audioPauseTrace;if(t){t.host.acquire=t.acquire;t.host.create=t.create;t.abort.abort()}delete globalThis.audioPauseTrace;delete globalThis.audioPauseOldCapture})()');
      if (await evaluate('app.core.isEnabled("audio-recorder")') !== enabled) await evaluate('app.core.setEnabled("audio-recorder",' + enabled + ')');
      await evaluate("app.saveAll()"); await restoreBytes(corePath, coreBytes); await restoreBytes(configPath, configBytes);
      await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(' + q(layout) + ');await app.workspace.flushLayout()})()');
      assert.deepEqual(await optionalBytes(configPath), configBytes); assert.deepEqual(await optionalBytes(corePath), coreBytes);
    } catch (error) { if (!failure) throw error; report.audioPauseResumeFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** Parent provides the genuine cached mount and audits all cached blobs/network counters. */
export async function checkAudioPauseResumeReadOnly(tools) {
  const { evaluate, report, capture, wait, click, command } = tools;
  const nativeInput = [];
  let beforeInput = null;
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate('app.core.isEnabled("audio-recorder")'), true);
  const before = await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
  await evaluate(`(()=>{const h=${api}.capture.host,t=globalThis.audioPauseReadOnlyTrace={host:h,acquire:h.acquire,calls:0,stage:"recording-refusals",create:URL.createObjectURL,revoke:URL.revokeObjectURL,objects:[]};t.acquireWrapper=function(...args){t.calls++;return t.acquire.apply(this,args)};h.acquire=t.acquireWrapper;t.createWrapper=function(...args){const url=t.create.apply(this,args);t.objects.push({url,blob:args[0],revoked:false});return url};t.revokeWrapper=function(...args){const result=t.revoke.apply(this,args);for(const object of t.objects){if(object.url===args[0])object.revoked=true}return result};URL.createObjectURL=t.createWrapper;URL.revokeObjectURL=t.revokeWrapper})()`);
  try {
    const ribbon = '[data-core-ribbon="audio-recorder"]'; await disabledPointer(tools, ribbon);
    await evaluate("(()=>{const b=document.querySelector(" + q(ribbon) + ");b.disabled=false;b.click();b.disabled=true})()");
    const results = await evaluate(`(async()=>{const p=${api},errors=[];for(const action of [()=>p.open(),()=>p.capture.start(),()=>p.capture.pause(),()=>p.capture.resume()]){try{await action();errors.push(null)}catch(error){errors.push(String(error.message))}}return errors})()`);
    assert.equal(results.length, 4); assert.ok(results.every(error => /read-only/.test(error)));
    assert.equal(await evaluate('app.commands.executeCommandById("audio-recorder:start")'), false);
    assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0); assert.equal(await evaluate("audioPauseReadOnlyTrace.calls"), 0); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false);
    const [[path, expectedBytes]] = audioPauseResumeReadOnlyFixture.files, player = '.audio-file-view audio[data-vault-audio="' + path + '"]';
    await evaluate('audioPauseReadOnlyTrace.stage="opening-cached-audio"');
    if (await evaluate("app.workspace.leftSplit.collapsed")) { await click('[aria-label="Toggle left sidebar"]'); }
    await click('[data-sidebar-view="file-explorer"]');
    await click('[data-note-path="' + path + '"]');
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getViewType()==="audio"&&!app.workspace.isChangingFiles`, "cached read-only audio file opens through its real provider");
    await wait(`(()=>{const a=document.querySelector(${q(player)});return a?.readyState>=1&&Number.isFinite(a.duration)&&a.duration>0})()`, "cached audio metadata decodes");
    const playback = await evaluate(`(async()=>{const a=document.querySelector(${q(player)}),view=app.workspace.activeLeaf.view,t=audioPauseReadOnlyTrace;t.stage="binding-player-blob";const source=a.currentSrc,objects=t.objects.filter(object=>object.url===source);if(objects.length!==1||!(objects[0].blob instanceof Blob)||objects[0].revoked||view.url!==source||view.file?.path!==${q(path)}||URL.createObjectURL!==t.createWrapper||URL.revokeObjectURL!==t.revokeWrapper)throw Error("The cached player is not bound to its current owned Blob URL.");const object=objects[0],bytes=new Uint8Array(await object.blob.arrayBuffer());if(document.querySelector(${q(player)})!==a||app.workspace.activeLeaf.view!==view||a.currentSrc!==source||view.url!==source||object.revoked)throw Error("The cached player or Blob URL changed while reading its bytes.");t.playbackSource=source;t.playbackView=view;t.playbackElement=a;t.playbackObject=object;return{bytes:Array.from(bytes),type:object.blob.type,duration:a.duration,source,boundToCurrentView:true,notRevoked:true}})()`);
    assert.match(playback.source, /^blob:/); assert.equal(playback.boundToCurrentView, true); assert.equal(playback.notRevoked, true); assert.equal(playback.type, "audio/wav"); assert.deepEqual(Buffer.from(playback.bytes), expectedBytes, "the provider's playable blob is the exact cached WAV");
    const point = await evaluate(`(()=>{const a=document.querySelector(${q(player)}),t=audioPauseReadOnlyTrace;t.stage="trusted-native-playback";if(a!==t.playbackElement||app.workspace.activeLeaf.view!==t.playbackView||a.currentSrc!==t.playbackSource||t.playbackView.url!==t.playbackSource||t.playbackObject.revoked)throw Error("The cached player changed before trusted playback.");t.input=[];t.playback=[];t.abort=new AbortController();for(const type of ["pointerdown","click"])a.addEventListener(type,event=>t.input.push({type,trusted:event.isTrusted}),{capture:true,signal:t.abort.signal});for(const type of ["play","playing","timeupdate","ended","error"])a.addEventListener(type,event=>t.playback.push({type,trusted:event.isTrusted,time:a.currentTime}),{signal:t.abort.signal});a.scrollIntoView({block:"center"});const r=a.getBoundingClientRect(),x=r.left+20,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,reachable:hit===a||a.contains(hit),paused:a.paused,currentTime:a.currentTime,source:a.currentSrc,viewUrl:t.playbackView.url}})()`);
    beforeInput = point;
    assert.equal(point.reachable, true, "the native audio control is physically reachable");
    assert.equal(point.paused, true); assert.equal(point.currentTime, 0); assert.equal(point.source, point.viewUrl);
    for (const type of ["mousePressed", "mouseReleased"]) {
      const payload = { type, x: point.x, y: point.y, button: "left", clickCount: 1 }, startedAt = new Date().toISOString();
      const response = await command("Input.dispatchMouseEvent", payload);
      nativeInput.push({ method: "Input.dispatchMouseEvent", payload, startedAt, completedAt: new Date().toISOString(), response: response ?? null });
    }
    assert.deepEqual(nativeInput.map(receipt => receipt.payload.type), ["mousePressed", "mouseReleased"]);
    await wait(`(()=>{const a=document.querySelector(${q(player)}),t=audioPauseReadOnlyTrace;return a===t.playbackElement&&app.workspace.activeLeaf.view===t.playbackView&&a.currentSrc===t.playbackSource&&t.playbackView.url===t.playbackSource&&!t.playbackObject.revoked&&a.currentTime>0&&t.playback.some(event=>event.type==="playing"&&event.trusted)&&t.playback.some(event=>event.type==="timeupdate"&&event.trusted&&event.time>0)})()`, "completed native audio input advances trusted cached playback");
    const afterInput = await evaluate(`(()=>{const a=document.querySelector(${q(player)}),t=audioPauseReadOnlyTrace;return{currentTime:a.currentTime,input:t.input,events:t.playback,source:a.currentSrc,viewUrl:app.workspace.activeLeaf.view.url,boundToCurrentView:a===t.playbackElement&&app.workspace.activeLeaf.view===t.playbackView,notRevoked:!t.playbackObject.revoked}})()`);
    assert.equal(afterInput.boundToCurrentView, true); assert.equal(afterInput.notRevoked, true); assert.equal(afterInput.source, point.source); assert.equal(afterInput.viewUrl, point.viewUrl);
    report.audioPauseResumeReadOnlyPlayback = { path, bytes: expectedBytes.length, sha256: createHash("sha256").update(expectedBytes).digest("hex"), contentType: playback.type, duration: playback.duration, boundToCurrentView: playback.boundToCurrentView, notRevokedAtByteRead: playback.notRevoked,
      nativeInput, beforeInput, afterInput, currentTime: afterInput.currentTime, input: afterInput.input, events: afterInput.events };
    await evaluate(`document.querySelector(${q(player)}).pause()`); await capture?.("audio-pause-readonly");
    assert.equal(await evaluate("audioPauseReadOnlyTrace.calls"), 0); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
    await evaluate('audioPauseReadOnlyTrace.stage="returning-to-source"');
    await click('[data-note-path="Read only.md"]');
    await wait('app.workspace.getActiveFile()?.path==="Read only.md"&&app.workspace.activeLeaf.view.getViewType()==="markdown"&&!app.workspace.isChangingFiles', "trusted file tree returns to the read-only source");
    assert.equal(await evaluate("audioPauseReadOnlyTrace.calls"), 0); assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
    assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'), before);
    assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
    report.audioPauseResumeReadOnly = { genuineCachedReadOnly: true, ribbonDisabled: true, trustedDisabledPointer: true, forcedRibbonRefused: true, openStartPauseResumeRefused: true, zeroMicrophoneAcquisitions: true, noRecorderDialog: true, unchangedDocumentsAndVersions: true, zeroApiRaw: true,
      audioViewOpenedByTrustedFileTree: true, cachedPlaybackBlobBytesExact: true, decodedPlaybackMetadata: true, trustedNativeAudioPlayback: true, zeroMicrophoneDuringPlayback: true, trustedReturnToSource: true };
    const message = "The genuine cached read-only mount keeps recording disabled through trusted and forged controls, with no permission acquisition or draft. Trusted file-tree/native audio controls play an exact cached WAV and return to Source; documents/versions, microphone count and API/raw counters stay exact.";
    report.checks.push(message); console.log("PASS " + message);
  } catch (error) {
    report.audioPauseResumeReadOnlyFailure = { error: String(error?.stack ?? error), nativeInput, beforeInput, ...await evaluate(`(()=>{const t=globalThis.audioPauseReadOnlyTrace,a=document.querySelector(${q('.audio-file-view audio[data-vault-audio="Cached playback.wav"]')}),view=app.workspace.activeLeaf.view,r=a?.getBoundingClientRect(),hit=r?document.elementFromPoint(r.left+20,r.top+r.height/2):null;return{stage:t?.stage,readOnly:app.vault.readOnly,activeFile:app.workspace.getActiveFile()?.path,viewType:view?.getViewType?.(),viewUrl:view?.url,source:a?.currentSrc,readyState:a?.readyState,currentTime:a?.currentTime,duration:a?.duration,playerError:a?.error?.message,bounds:r?{left:r.left,top:r.top,width:r.width,height:r.height}:null,hit:hit?{tag:hit.tagName,className:hit.className}:null,createWrapperOwned:URL.createObjectURL===t?.createWrapper,revokeWrapperOwned:URL.revokeObjectURL===t?.revokeWrapper,objects:t?.objects.map(object=>({url:object.url,revoked:object.revoked,isBlob:object.blob instanceof Blob,size:object.blob?.size,type:object.blob?.type})),input:t?.input,events:t?.playback,microphoneCalls:t?.calls}})()`) };
    throw error;
  } finally { await evaluate(`(()=>{document.querySelector(${q('.audio-file-view audio[data-vault-audio="Cached playback.wav"]')})?.pause();const t=audioPauseReadOnlyTrace;t.abort?.abort();if(t.host.acquire===t.acquireWrapper)t.host.acquire=t.acquire;if(URL.createObjectURL===t.createWrapper)URL.createObjectURL=t.create;if(URL.revokeObjectURL===t.revokeWrapper)URL.revokeObjectURL=t.revoke;delete globalThis.audioPauseReadOnlyTrace})()`); }
}
