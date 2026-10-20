import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, api = 'app.core.getEnabledPluginById("audio-recorder")';
const modal = ".audio-recorder-modal", action = name => modal + ' [data-audio-action="' + name + '"]';
const wave = modal + " [data-audio-waveform]", show = wave + ' [data-waveform-action="show"]';
const toneBytes = await readFile(new URL("../Example/90 Attachments/Synthetic tone.wav", import.meta.url));
export const audioWaveformReadOnlyFixture = { files: [["Cached waveform.wav", toneBytes]] };
const optionalBytes = path => readFile(path).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
async function restore(path, bytes) { if (bytes !== null) await writeFile(path, bytes); else await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }
async function key(command, value, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of [value === "Enter" ? "keyDown" : "rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode, modifiers,
    ...(value === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
}
async function fill(tools, selector, value) { await tools.click(selector); await key(tools.command, "a", "KeyA", 65, 2); await tools.command("Input.insertText", { text: value }); }
async function files(tools, targetPath) {
  if (await tools.evaluate("app.workspace.leftSplit.collapsed")) await tools.click('[aria-label="Toggle left sidebar"]');
  await tools.click('[data-sidebar-view="file-explorer"]');
  const parts = targetPath.split("/");
  for (let depth = 1; depth < parts.length; depth++) {
    const folder = parts.slice(0, depth).join("/"), selector = '#file-explorer-view details[data-folder-path=' + q(folder) + ']';
    await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "legacy file tree renders the target folder");
    if (!await tools.evaluate(`document.querySelector(${q(selector)}).open`)) {
      await tools.click(selector + " > summary");
      await tools.wait(`document.querySelector(${q(selector)}).open===true`, "trusted folder summary expands the target ancestor");
    }
  }
}
function expectedTonePeaks(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF"); assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(34), 16);
  const frames = bytes.readUInt32LE(40) / 2, result = [];
  for (let bin = 0; bin < 256; bin++) {
    let peak = 0;
    for (let frame = Math.ceil(bin * frames / 256); frame < Math.ceil((bin + 1) * frames / 256); frame++) peak = Math.max(peak, Math.abs(bytes.readInt16LE(44 + frame * 2)) / 32768);
    result.push(peak);
  }
  return result;
}

async function nativePlay(tools, selector, trace = "audioWaveformTrace") {
  const { evaluate, command, wait } = tools, receipts = [];
  const point = await evaluate(`(()=>{const a=document.querySelector(${q(selector)}),t=${trace};t.playAbort?.abort();t.playAbort=new AbortController();t.playEvents=[];for(const type of ["pointerdown","click","play","playing","timeupdate","error"])a.addEventListener(type,event=>t.playEvents.push({type,trusted:event.isTrusted,time:a.currentTime}),{signal:t.playAbort.signal});a.scrollIntoView({block:"center"});const r=a.getBoundingClientRect(),x=r.left+20,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return{x,y,reachable:h===a||a.contains(h),source:a.currentSrc,paused:a.paused,currentTime:a.currentTime}})()`);
  assert.equal(point.reachable, true); assert.equal(point.paused, true);
  for (const type of ["mousePressed", "mouseReleased"]) {
    const payload = { type, x: point.x, y: point.y, button: "left", clickCount: 1 };
    const response = await command("Input.dispatchMouseEvent", payload); receipts.push({ method: "Input.dispatchMouseEvent", payload, response: response ?? null });
  }
  await wait(`(()=>{const a=document.querySelector(${q(selector)}),t=${trace};return a.currentSrc===${q(point.source)}&&a.currentTime>${point.currentTime}&&t.playEvents.some(event=>event.type==="playing"&&event.trusted)&&t.playEvents.some(event=>event.type==="timeupdate"&&event.trusted&&event.time>0)})()`, "trusted native playback advances the exact waveform source");
  const observed = await evaluate(`(()=>{const a=document.querySelector(${q(selector)}),t=${trace};return{source:a.currentSrc,currentTime:a.currentTime,events:t.playEvents}})()`);
  await evaluate(`document.querySelector(${q(selector)}).pause()`);
  return { before: point, nativeInput: receipts, after: observed };
}

/** Successful short captures and decoding are real; only failure/delivery-delay boundaries are injected. */
export async function checkAudioWaveform(tools) {
  const { directory, evaluate, wait, click, command, handleDialog, report, capture } = tools;
  assert.equal(report.syntheticAudioOnly, true); assert.equal(report.physicalMicrophoneTested, false);
  const folder = "Audio waveform validation", path = folder + "/Source.md", local = folder + "/Local waveform.wav", leaf = "audio-waveform-note";
  const source = "app.workspace.getLeafById(" + q(leaf) + ").view", editor = '[data-leaf-id="' + leaf + '"] .cm-content';
  const initial = "# Waveform λ\r\n\r\nKeep original 😀 audio bytes.\r\n", dirty = initial + "Earlier unsaved prose Ω.\r\n";
  const configPath = join(directory, ".obsidian/app.json"), corePath = join(directory, ".obsidian/core-plugins.json");
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("audio-recorder")');
  const configBytes = await optionalBytes(configPath), coreBytes = await optionalBytes(corePath), config = configBytes ? JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, "")) : {};
  let stage = "fixtures", failure, clipPath, clipBytes, finalText;
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const ready = () => wait(`${api}.capture.state==="ready"&&${api}.capture.liveTracks===0`, "short recording is finalized with no live microphone");
  const shortClip = async () => {
    await click(action("start")); await wait(`${api}.capture.state==="recording"&&${api}.capture.liveTracks===1`, "real isolated synthetic microphone starts");
    await wait(`${api}.capture.elapsedMs>=650`, "real encoded short recording"); await click(action("stop")); await ready();
    await wait(`document.querySelector(${q(modal + " [data-audio-preview]")})?.readyState>=1`, "recorded preview metadata is playable");
  };
  const waveformReady = selector => wait(`document.querySelector(${q(selector)})?.dataset.waveformState==="ready"`, "actual current-clip waveform appears");
  const assertDecoded = async () => {
    const proof = await evaluate(`(()=>{const p=${api},m=p.modal,j=m.waveform.job,t=audioWaveformTrace,c=t.decodes.at(-1),a=c.audio,result=j.result;const expected=[];for(let bin=0;bin<256;bin++){let peak=0;for(let channel=0;channel<a.numberOfChannels;channel++){const samples=a.getChannelData(channel);for(let frame=Math.ceil(bin*a.length/256);frame<Math.ceil((bin+1)*a.length/256);frame++)peak=Math.max(peak,Math.min(1,Math.abs(samples[frame])))}expected.push(peak)}const object=t.objects.find(object=>object.url===m.url);return{state:j.state,method:result?.method,peaks:result?.peaks,expected,frames:result?.frames,channels:result?.channels,sampleRate:result?.sampleRate,sourceIsCurrent:j.source.blob===p.capture.data&&j.source.blob===m.blob&&c.blob===p.capture.data&&object?.blob===p.capture.data,currentRoot:c.root===app.vault.rootPath,currentURL:m.url===m.player.src&&!object.revoked,context:t.contexts.at(-1),decoderBytes:c.bytes,graphBars:m.waveform.element.querySelectorAll("svg rect").length,accessible:m.waveform.element.querySelector("svg").getAttribute("aria-label"),captureRequests:t.acquisitions,decodeCalls:t.decodes.length,paused:m.player.paused,currentTime:m.player.currentTime}})()`);
    assert.equal(proof.state, "ready"); assert.equal(proof.method, "recording"); assert.deepEqual(proof.peaks, proof.expected); assert.equal(proof.peaks.length, 256); assert.ok(Math.max(...proof.peaks) > 0);
    for (const field of ["sourceIsCurrent", "currentRoot", "currentURL", "paused"]) assert.equal(proof[field], true, field);
    assert.deepEqual(proof.context, [1, 1, 8000]); assert.equal(proof.sampleRate, 8000); assert.equal(proof.graphBars, 256); assert.match(proof.accessible, /Audio waveform.*Playback and seeking use the audio controls/);
    assert.equal(proof.currentTime, 0); return proof;
  };
  try {
    await mkdir(join(directory, folder)); await writeFile(join(directory, path), Buffer.from("\ufeff" + initial), { flag: "wx" }); await writeFile(join(directory, local), toneBytes, { flag: "wx" });
    await writeFile(configPath, Buffer.from(JSON.stringify({ ...config, markdownAutosave: false }, null, 2)));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()');
    if (!enabled) await evaluate('app.core.setEnabled("audio-recorder",true)');
    await evaluate("app.workspace.changeLayout(" + q({ version: 1, main: { id: "audio-waveform-main", type: "split", direction: "vertical", children: [{ id: "audio-waveform-tabs", type: "tabs", currentTab: 0, children: [{ id: leaf, type: "leaf", state: { type: "markdown", state: { file: path, mode: "source", source: true } } }] }] }, active: leaf }) + ")");
    await wait(source + "?.editor&&" + source + ".editor.getValue()===" + q(initial), "owned waveform source editor");
    await click(editor); await key(command, "End", "End", 35, 2); await command("Input.insertText", { text: "Earlier unsaved prose Ω.\n" });
    await wait(source + ".editor.getValue()===" + q(dirty), "trusted earlier dirty prose retained");
    await evaluate(`(()=>{const h=${api}.capture.host,t=globalThis.audioWaveformTrace={host:h,acquire:h.acquire,acquisitions:0,Real:globalThis.OfflineAudioContext,create:URL.createObjectURL,revoke:URL.revokeObjectURL,objects:[],contexts:[],decodes:[],mode:"normal",input:[],abort:new AbortController()};t.acquireWrapper=function(...args){t.acquisitions++;return t.acquire.apply(this,args)};h.acquire=t.acquireWrapper;globalThis.OfflineAudioContext=class extends t.Real{constructor(...args){super(...args);t.contexts.push(args)}decodeAudioData(data,...args){const c={bytes:Array.from(new Uint8Array(data)),blob:${api}.capture.data,root:app.vault.rootPath,mode:t.mode};t.decodes.push(c);return super.decodeAudioData(data,...args).then(audio=>{c.audio=audio;c.realResolved=true;if(c.mode==="fail")throw Error("Simulated waveform decode failure after real decoder success");if(c.mode==="defer")return new Promise(resolve=>{t.release=()=>{c.released=true;resolve(audio)}});return audio})}};t.createWrapper=function(blob){const url=t.create.call(URL,blob);t.objects.push({url,blob,revoked:false});return url};t.revokeWrapper=function(url){for(const object of t.objects)if(object.url===url)object.revoked=true;return t.revoke.call(URL,url)};URL.createObjectURL=t.createWrapper;URL.revokeObjectURL=t.revokeWrapper;for(const type of ["pointerdown","keydown"])document.addEventListener(type,event=>{if(event.target.closest?.("[data-audio-waveform]"))t.input.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal})})()`);

    stage = "real recorded-clip waveform";
    await click('[data-core-ribbon="audio-recorder"]'); await wait(`Boolean(document.querySelector(${q(modal)}))`, "recorder opens without acquisition or decoding");
    assert.deepEqual(await evaluate("({captures:audioWaveformTrace.acquisitions,contexts:audioWaveformTrace.contexts.length})"), { captures: 0, contexts: 0 });
    await shortClip(); clipBytes = Buffer.from(await evaluate(`(async()=>Array.from(new Uint8Array(await ${api}.capture.data.arrayBuffer())))()`));
    assert.equal(await evaluate("audioWaveformTrace.contexts.length"), 0); assert.equal(await evaluate(`document.querySelector(${q(wave)}).dataset.waveformState`), "idle");
    await click(show); await waveformReady(wave); const recorded = await assertDecoded();
    assert.deepEqual(Buffer.from(recorded.decoderBytes), clipBytes); assert.equal(recorded.captureRequests, 1);
    const playback = await nativePlay(tools, modal + " [data-audio-preview]"); await capture?.("audio-waveform-preview");
    pass("Explicit trusted Show waveform decodes the actual current short MediaRecorder Blob at 8 kHz, matches all 256 peaks to the actual native PCM, preserves one capture and the owned preview URL, exposes a labelled noninteractive SVG, and keeps trusted native playback working.");

    stage = "exact save and isolated insertion Undo";
    clipPath = await evaluate(`(()=>{const p=${api}.modal.path.value;return ${q(folder + "/Waveform recording")}+p.slice(p.lastIndexOf("."))})()`);
    await fill(tools, modal + " [data-audio-path]", clipPath); await click(action("insert"));
    await wait(`${api}.saved?.path===${q(clipPath)}&&${api}.inserted&&!${api}.busy&&!app.core.busy`, "waveform source is saved and embedded");
    assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes); finalText = await evaluate(source + ".editor.getValue()"); assert.ok(finalText.startsWith(dirty)); assert.ok(finalText.includes("![[") || finalText.includes("![]("));
    await click(modal + " .modal-close-button"); await wait(`!document.querySelector(${q(modal)})`, "saved waveform dialog closes");
    await click(editor); await key(command, "z", "KeyZ", 90, 2); await wait(source + ".editor.getValue()===" + q(dirty), "one Undo removes only the embed");
    assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + initial));
    await key(command, "y", "KeyY", 89, 2); await wait(source + ".editor.getValue()===" + q(finalText), "Redo restores only the embed"); await key(command, "s", "KeyS", 83, 2); await wait(source + ".session.dirty===false", "source saves after explicit Ctrl+S");
    assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + finalText)); assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes);
    pass("Waveform analysis retains byte-exact recorded attachment saving and one isolated embed Undo/Redo, including earlier dirty prose and exact BOM/CRLF/Unicode note bytes; ordinary Ctrl+S saves the note separately.");

    stage = "declared decode failure and deferred delivery";
    await click('[data-core-ribbon="audio-recorder"]'); await wait(`Boolean(document.querySelector(${q(modal)}))`, "saved recorder reopens");
    await click(action("discard")); await shortClip(); await evaluate('audioWaveformTrace.mode="fail"'); await click(show);
    await wait(`document.querySelector(${q(wave)}).dataset.waveformState==="unavailable"`, "declared decoder failure produces a waveform-only message");
    assert.match(await evaluate(`document.querySelector(${q(wave)}).textContent`), /Simulated waveform decode failure.*audio controls remain available/);
    assert.equal(await evaluate(`Boolean(${api}.capture.data)&&!document.querySelector(${q(action("save"))}).disabled&&${api}.modal.waveform.job.result===null`), true);
    const failurePlayback = await nativePlay(tools, modal + " [data-audio-preview]"); await capture?.("audio-waveform-decode-fallback");
    await evaluate(`document.querySelector(${q(modal + " [data-audio-preview]")}).currentTime=0;audioWaveformTrace.mode="defer";document.querySelector(${q(show)}).focus()`); await key(command, "Enter", "Enter", 13);
    await wait('audioWaveformTrace.decodes.at(-1)?.realResolved&&Boolean(audioWaveformTrace.release)', "actual native decode is held only at its declared delivery boundary");
    await evaluate(`audioWaveformTrace.oldJob=${api}.modal.waveform.job;audioWaveformTrace.oldBlob=${api}.capture.data;audioWaveformTrace.oldUrl=${api}.modal.url`);
    const discard = click(action("discard")); await handleDialog(true); await discard;
    assert.equal(await evaluate(`${api}.capture.data===null&&${api}.modal.waveform.job.result===null&&${api}.modal.waveform.element.hidden&&audioWaveformTrace.objects.find(object=>object.url===audioWaveformTrace.oldUrl).revoked`), true);
    await shortClip(); await click(show); await wait(`document.querySelector(${q(wave)}).dataset.waveformState==="unavailable"`, "uncancellable retired decode keeps the single global lease");
    assert.match(await evaluate(`document.querySelector(${q(wave)}).textContent`), /still finishing/);
    await evaluate('audioWaveformTrace.release();audioWaveformTrace.mode="normal"');
    await wait("audioWaveformTrace.decodes.at(-1).released===true", "retired decoder delivery settles");
    assert.equal(await evaluate(`${api}.capture.data!==audioWaveformTrace.oldBlob&&${api}.modal.waveform.job.result===null`), true);
    await click(show); await waveformReady(wave); const replacement = await assertDecoded(); assert.equal(replacement.captureRequests, 3);
    await evaluate(`audioWaveformTrace.finalJob=${api}.modal.waveform.job;audioWaveformTrace.detachedButton=document.querySelector(${q(show)})`);
    const close = click(modal + " .modal-close-button"); await handleDialog(true); await close; await wait(`!document.querySelector(${q(modal)})`, "discarded replacement dialog tears down");
    const beforeDetached = await evaluate("audioWaveformTrace.decodes.length");
    await evaluate("audioWaveformTrace.detachedButton.disabled=false;audioWaveformTrace.detachedButton.click()");
    assert.equal(await evaluate("audioWaveformTrace.decodes.length"), beforeDetached);
    assert.equal(await evaluate("audioWaveformTrace.finalJob.source===null&&audioWaveformTrace.finalJob.result===null&&audioWaveformTrace.finalJob.timer===null"), true);
    assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
    pass("A declared post-native decode failure leaves real playback and saving intact. A held actual decoder result cannot repopulate a discarded clip or replacement recording; its lease prevents overlap until settlement, keyboard retry builds only the new current clip, and detached/closed controls cannot decode or retain PCM.");

    stage = "direct local PCM and stale file version";
    await files(tools, local); await click('[data-note-path="' + local + '"]'); await wait(`app.workspace.activeLeaf.view.getViewType()==="audio"&&app.workspace.getActiveFile()?.path===${q(local)}&&!app.workspace.isChangingFiles`, "trusted tree opens local WAV provider");
    const fileWave = '.audio-file-view [data-audio-waveform]', fileShow = fileWave + ' [data-waveform-action="show"]';
    await wait(`app.workspace.activeLeaf.view.sourceBlob&&document.querySelector('.audio-file-view audio')?.readyState>=1`, "current local WAV Blob is loaded");
    const calls = await evaluate("audioWaveformTrace.decodes.length");
    await evaluate(`(()=>{const v=app.workspace.activeLeaf.view,b=v.sourceBlob,read=b.arrayBuffer.bind(b),t=audioWaveformTrace;t.localView=v;t.localVersion=v.sourceVersion;t.localUrl=v.url;b.arrayBuffer=async()=>{const bytes=await read();return await new Promise(resolve=>{t.fileRelease=()=>resolve(bytes)})}})()`);
    await click(fileShow); await wait("Boolean(audioWaveformTrace.fileRelease)", "actual WAV bytes held at their declared delivery boundary");
    const modifiedTone = Buffer.from(toneBytes); modifiedTone.writeInt16LE(16000, 44); await writeFile(join(directory, local), modifiedTone);
    await evaluate("app.vault.refresh()"); await wait("audioWaveformTrace.localView.sourceVersion!==audioWaveformTrace.localVersion&&Boolean(audioWaveformTrace.localView.sourceBlob)", "file modification reloads a fresh version and Blob URL");
    await evaluate("audioWaveformTrace.fileRelease()");
    await wait(`document.querySelector(${q(fileWave)}).dataset.waveformState==="idle"`, "old WAV completion cannot populate the new version");
    await click(fileShow); await waveformReady(fileWave);
    const localResult = await evaluate("(()=>{const v=app.workspace.activeLeaf.view,j=v.waveform.job,o=audioWaveformTrace.objects.find(object=>object.url===v.url);return{peaks:j.result.peaks,method:j.result.method,current:j.source.blob===v.sourceBlob&&o.blob===v.sourceBlob&&!o.revoked&&v.player.src===v.url,version:v.sourceVersion,oldRevoked:audioWaveformTrace.objects.find(object=>object.url===audioWaveformTrace.localUrl).revoked}})()");
    assert.deepEqual(localResult.peaks, expectedTonePeaks(modifiedTone)); assert.equal(localResult.method, "wav"); assert.equal(localResult.current, true); assert.equal(localResult.oldRevoked, true); assert.equal(await evaluate("audioWaveformTrace.decodes.length"), calls);
    await capture?.("audio-waveform-file"); await click('[data-note-path="' + path + '"]'); await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getViewType()==="markdown"`, "file tree returns to source");
    assert.equal(await evaluate("audioWaveformTrace.objects.every(object=>object.revoked)"), true);
    assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes); assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + finalText));
    report.audioWaveform = { syntheticMicrophoneOnly: true, explicitTrustedShow: true, noAutomaticDecode: true, realCurrentCaptureBlob: true, realOfflineDecoder8k: true, actualPcmPeaks: true, bounded256Bars: true, accessibleNoninteractiveSVG: true, nativePlayback: true,
      exactSavedAudio: true, isolatedSourceUndoRedo: true, earlierDirtyProseRetained: true, exactBomCrlfUnicode: true, simulatedPostNativeDecodeFailure: true, simulatedNativeDeliveryDelay: true, noOverlappingNativeDecodes: true, lateDiscardedClipRefused: true,
      keyboardRetry: true, detachedControlsRefused: true, directLocalPCM: true, exactModifiedFilePeaks: true, lateFileVersionRefused: true, ownedURLsRevoked: true, ownedTimersAndPCMReleased: true, noExtraCapture: replacement.captureRequests === 3,
      nativePlaybackAfterDecodeFailure: true };
    report.audioWaveformProof = { clipPath, clipBytes: clipBytes.length, clipSha256: createHash("sha256").update(clipBytes).digest("hex"), frames: recorded.frames, channels: recorded.channels, sampleRate: recorded.sampleRate, playback, failurePlayback,
      recordedPeaks: recorded.peaks, replacementPeaks: replacement.peaks, localPeaks: localResult.peaks, modifiedLocalVersion: localResult.version,
      trustedInputs: await evaluate("audioWaveformTrace.input"), limits: { recordedActiveSeconds: 30, encodedMiB: 16, acceptedPcmMiB: 32, pcmChannels: 32, directWavMinutes: 10, nativeConcurrentJobs: 1 }, physicalMicrophoneTested: false };
    assert.ok(report.audioWaveformProof.trustedInputs.some(event => event.type === "pointerdown" && event.trusted)); assert.ok(report.audioWaveformProof.trustedInputs.some(event => event.type === "keydown" && event.key === "Enter" && event.trusted));
    pass("Local WAV waveforms use strict direct PCM with no native decoder. A deferred old-file read cannot populate a changed version; exact new-byte peaks appear after explicit Show, old/current player URLs are revoked on replacement/unload, and saved recording/note bytes remain exact.");
  } catch (error) {
    failure = error; report.audioWaveformFailure = { stage, error: String(error?.stack ?? error) };
    try { report.audioWaveformFailure.state = await evaluate(`(()=>{const p=${api},v=app.workspace.activeLeaf.view,t=globalThis.audioWaveformTrace;return{capture:p&&{state:p.capture.state,tracks:p.capture.liveTracks,duration:p.capture.durationMs,bytes:p.capture.bytes},status:document.querySelector(${q(wave)})?.textContent,waveform:p?.modal?.waveform.job.state,file:v.file?.path,fileWaveform:v.waveform?.job.state,contexts:t?.contexts,decodes:t?.decodes.map(c=>({bytes:c.bytes.length,mode:c.mode,realResolved:c.realResolved,released:c.released,frames:c.audio?.length,channels:c.audio?.numberOfChannels,rate:c.audio?.sampleRate})),objects:t?.objects.map(o=>({url:o.url,revoked:o.revoked,size:o.blob?.size}))}})()`); await capture?.("audio-waveform-precleanup-failure"); } catch {}
    throw error;
  } finally {
    try {
      await evaluate(`(()=>{const t=globalThis.audioWaveformTrace,p=app.core.getPluginById("audio-recorder")?.instance;t?.release?.();t?.fileRelease?.();p?.capture.cancel();p?.modal?.forceClose();if(p)p.modal=null;if(t){t.host.acquire=t.acquire;globalThis.OfflineAudioContext=t.Real;URL.createObjectURL=t.create;URL.revokeObjectURL=t.revoke;t.abort.abort();t.playAbort?.abort()}delete globalThis.audioWaveformTrace})()`);
      if (await evaluate('app.core.isEnabled("audio-recorder")') !== enabled) await evaluate('app.core.setEnabled("audio-recorder",' + enabled + ')');
      await evaluate("app.saveAll()"); await restore(corePath, coreBytes); await restore(configPath, configBytes);
      await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(' + q(layout) + ');await app.workspace.flushLayout()})()');
      assert.deepEqual(await optionalBytes(configPath), configBytes); assert.deepEqual(await optionalBytes(corePath), coreBytes);
    } catch (error) { if (!failure) throw error; report.audioWaveformFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** Parent supplies the real cached GitHub mount and checks every cached blob and API/raw counter. */
export async function checkAudioWaveformReadOnly(tools) {
  const { evaluate, wait, click, report, capture } = tools, path = audioWaveformReadOnlyFixture.files[0][0];
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate('app.core.isEnabled("audio-recorder")'), true);
  const source = await evaluate("({path:app.workspace.getActiveFile()?.path,leaf:app.workspace.activeLeaf.id,type:app.workspace.activeLeaf.view.getViewType()})");
  const documents = await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
  const selector = '.audio-file-view audio[data-vault-audio="' + path + '"]', figure = ".audio-file-view [data-audio-waveform]";
  let stage = "binding cached source";
  await evaluate(`(()=>{const h=${api}.capture.host,t=globalThis.audioWaveformReadOnlyTrace={host:h,acquire:h.acquire,captures:0,Real:globalThis.OfflineAudioContext,contexts:0,create:URL.createObjectURL,revoke:URL.revokeObjectURL,objects:[]};h.acquire=function(...args){t.captures++;return t.acquire.apply(this,args)};globalThis.OfflineAudioContext=class extends t.Real{constructor(...args){super(...args);t.contexts++}};URL.createObjectURL=function(blob){const url=t.create.call(URL,blob);t.objects.push({url,blob,revoked:false});return url};URL.revokeObjectURL=function(url){for(const object of t.objects)if(object.url===url)object.revoked=true;return t.revoke.call(URL,url)}})()`);
  try {
    await files(tools, path); await click('[data-note-path="' + path + '"]');
    await wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getViewType()==="audio"&&!app.workspace.isChangingFiles`, "cached WAV opens through its actual provider");
    await wait(`document.querySelector(${q(selector)})?.readyState>=1&&Boolean(app.workspace.activeLeaf.view.sourceBlob)`, "cached native WAV metadata loads");
    const binding = await evaluate(`(async()=>{const v=app.workspace.activeLeaf.view,b=v.sourceBlob,t=audioWaveformReadOnlyTrace,o=t.objects.find(object=>object.url===v.url),bytes=Array.from(new Uint8Array(await b.arrayBuffer()));if(app.workspace.activeLeaf.view!==v||v.sourceBlob!==b||o?.revoked||o?.blob!==b||v.player.src!==v.url)throw Error("Cached waveform player changed during byte binding");return{bytes,version:v.sourceVersion,url:v.url,type:b.type,paused:v.player.paused,currentTime:v.player.currentTime,contexts:t.contexts,captures:t.captures,state:v.waveform.job.state}})()`);
    assert.deepEqual(Buffer.from(binding.bytes), toneBytes); assert.equal(binding.type, "audio/wav"); assert.match(binding.version, /^git:/); assert.equal(binding.contexts, 0); assert.equal(binding.captures, 0); assert.equal(binding.state, "idle");
    stage = "trusted direct PCM waveform"; await click(figure + ' [data-waveform-action="show"]');
    await wait(`document.querySelector(${q(figure)}).dataset.waveformState==="ready"`, "cached strict PCM waveform appears without native decode");
    const proof = await evaluate(`(()=>{const v=app.workspace.activeLeaf.view,j=v.waveform.job,t=audioWaveformReadOnlyTrace,o=t.objects.find(object=>object.url===v.url),svg=v.waveform.element.querySelector("svg");return{method:j.result.method,peaks:j.result.peaks,current:j.source.blob===v.sourceBlob&&o.blob===v.sourceBlob&&!o.revoked&&v.url===${q(binding.url)}&&v.player.src===v.url,version:v.sourceVersion,paused:v.player.paused,currentTime:v.player.currentTime,bars:svg.querySelectorAll("rect").length,accessible:svg.getAttribute("aria-label"),contexts:t.contexts,captures:t.captures}})()`);
    assert.equal(proof.method, "wav"); assert.deepEqual(proof.peaks, expectedTonePeaks(toneBytes)); assert.equal(proof.current, true); assert.equal(proof.version, binding.version); assert.equal(proof.paused, binding.paused); assert.equal(proof.currentTime, binding.currentTime);
    assert.equal(proof.bars, 256); assert.match(proof.accessible, /Audio waveform.*Playback and seeking use the audio controls/); assert.equal(proof.contexts, 0); assert.equal(proof.captures, 0);
    const playback = await nativePlay(tools, selector, "audioWaveformReadOnlyTrace"); await capture?.("audio-waveform-readonly");
    stage = "returning to cached source";
    await click('[data-note-path="' + source.path + '"]'); await wait(`app.workspace.getActiveFile()?.path===${q(source.path)}&&app.workspace.activeLeaf.view.getViewType()==="markdown"`, "trusted tree returns to cached Markdown source");
    assert.equal(await evaluate("app.workspace.activeLeaf.id"), source.leaf);
    assert.equal(await evaluate("audioWaveformReadOnlyTrace.objects.every(object=>object.revoked)"), true); assert.equal(await evaluate("audioWaveformReadOnlyTrace.captures"), 0); assert.equal(await evaluate("audioWaveformReadOnlyTrace.contexts"), 0);
    assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'), documents);
    report.audioWaveformReadOnly = { genuineCachedMount: true, exactCachedWav: true, directPCMOnly: true, actualPcmPeaks: true, bounded256Bars: true, accessibleNoninteractiveSVG: true, currentBlobVersionAndURL: true, noNativeDecoder: true, noCapture: true, trustedNativePlayback: true, returnToSource: true, ownedURLRevoked: true, documentsAndVersionsUnchanged: true };
    report.audioWaveformReadOnlyProof = { bytes: toneBytes.length, sha256: createHash("sha256").update(toneBytes).digest("hex"), version: binding.version, peaks: proof.peaks, playback, returnSource: source };
    const message = "The genuine cached read-only WAV builds exact 256-bin PCM peaks through trusted Show without native decoding, microphone access or a new resource request; its version/current Blob stays bound, trusted native playback advances, and returning to Source revokes the player URL while documents and versions stay exact.";
    report.checks.push(message); console.log("PASS " + message);
  } catch (error) {
    report.audioWaveformReadOnlyFailure = { stage, error: String(error?.stack ?? error) }; try { await capture?.("audio-waveform-readonly-precleanup-failure"); } catch {} throw error;
  } finally {
    await evaluate("(()=>{const t=globalThis.audioWaveformReadOnlyTrace;if(t){t.host.acquire=t.acquire;globalThis.OfflineAudioContext=t.Real;URL.createObjectURL=t.create;URL.revokeObjectURL=t.revoke;t.playAbort?.abort()}delete globalThis.audioWaveformReadOnlyTrace})()");
  }
}
