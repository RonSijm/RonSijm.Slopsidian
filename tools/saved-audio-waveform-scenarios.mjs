import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";

const q = JSON.stringify, api = 'app.core.getEnabledPluginById("audio-recorder")', trace = "savedAudioTrace";
const modal = ".audio-recorder-modal", action = name => modal + ' [data-audio-action="' + name + '"]';
const activeAudio = ".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .audio-file-view";
const figure = activeAudio + " [data-audio-waveform]", show = figure + ' [data-waveform-action="show"]', player = activeAudio + " audio[data-vault-audio]";
const tone = await readFile(new URL("../Example/90 Attachments/Synthetic tone.wav", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const optionalBytes = path => readFile(path).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
async function restore(path, bytes) { if (bytes !== null) await writeFile(path, bytes); else await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }
async function key(command, value, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of [value === "Enter" ? "keyDown" : "rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode, modifiers,
    ...(value === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
}
async function files(tools, path) {
  if (await tools.evaluate("app.workspace.leftSplit.collapsed")) await tools.click('[aria-label="Toggle left sidebar"]');
  await tools.click('[data-sidebar-view="file-explorer"]');
  const parts = path.split("/");
  for (let depth = 1; depth < parts.length; depth++) {
    const selector = '#file-explorer-view details[data-folder-path=' + q(parts.slice(0, depth).join("/")) + ']';
    await tools.wait(`Boolean(document.querySelector(${q(selector)}))`, "saved-audio folder is rendered");
    if (!await tools.evaluate(`document.querySelector(${q(selector)}).open`)) await tools.click(selector + " > summary");
  }
}
async function openAudio(tools, path) {
  await files(tools, path); await tools.click('[data-note-path="' + path + '"]', 2);
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getViewType()==="audio"&&!app.workspace.isChangingFiles`, "trusted Ctrl-click opens a separate audio tab");
  await tools.wait(`Boolean(app.workspace.activeLeaf.view.sourceBlob)&&document.querySelector(${q(player)})?.readyState>=1`, "saved native player has actual metadata");
  return tools.evaluate("app.workspace.activeLeaf.id");
}
async function closeAudio(tools, leaf) {
  if (!await tools.evaluate(`Boolean(app.workspace.getLeafById(${q(leaf)}))`)) return;
  await tools.click('[data-tab-id="' + leaf + '"] .workspace-tab-header-inner-close-button');
  await tools.wait(`!app.workspace.getLeafById(${q(leaf)})`, "trusted close retires the temporary audio tab");
}
async function nativePlay(tools) {
  const point = await tools.evaluate(`(()=>{const a=document.querySelector(${q(player)}),t=${trace};t.playAbort?.abort();t.playAbort=new AbortController();t.playEvents=[];for(const type of ["pointerdown","click","playing","timeupdate"])a.addEventListener(type,event=>t.playEvents.push({type,trusted:event.isTrusted,time:a.currentTime}),{signal:t.playAbort.signal});a.scrollIntoView({block:"center"});const r=a.getBoundingClientRect(),x=r.left+20,y=r.top+r.height/2;return{x,y,reachable:document.elementFromPoint(x,y)===a,source:a.currentSrc,paused:a.paused,time:a.currentTime}})()`);
  assert.equal(point.reachable, true); assert.equal(point.paused, true);
  const input = [];
  for (const type of ["mousePressed", "mouseReleased"]) { const payload = { type, x: point.x, y: point.y, button: "left", clickCount: 1 }; input.push({ payload, response: await tools.command("Input.dispatchMouseEvent", payload) ?? null }); }
  await tools.wait(`(()=>{const a=document.querySelector(${q(player)}),t=${trace};return a.currentSrc===${q(point.source)}&&a.currentTime>${point.time}&&t.playEvents.some(e=>e.type==="playing"&&e.trusted)&&t.playEvents.some(e=>e.type==="timeupdate"&&e.trusted&&e.time>0)})()`, "trusted native playback advances the owned saved audio");
  const observed = await tools.evaluate(`({time:document.querySelector(${q(player)}).currentTime,events:${trace}.playEvents})`);
  await tools.evaluate(`document.querySelector(${q(player)}).pause()`); return { before: point, nativeInput: input, after: observed };
}
async function installTrace(tools) {
  await tools.evaluate(`(()=>{const h=${api}.capture.host,m=navigator.mediaDevices,t=globalThis.${trace}={host:h,acquire:h.acquire,devices:m,enumerate:m.enumerateDevices,captures:0,enumerations:0,Real:globalThis.OfflineAudioContext,create:URL.createObjectURL,revoke:URL.revokeObjectURL,objects:[],contexts:[],decodes:[],mode:"normal",closed:false,releases:[],inputs:[],abort:new AbortController(),anchor:app.workspace.activeLeaf,anchorView:app.workspace.activeLeaf.view,anchorEditor:app.workspace.activeLeaf.view.editor,anchorState:app.workspace.activeLeaf.view.editor?.cm?.state};h.acquire=function(...args){t.captures++;return t.acquire.apply(this,args)};m.enumerateDevices=function(...args){t.enumerations++;return t.enumerate.apply(this,args)};globalThis.OfflineAudioContext=class extends t.Real{constructor(...args){super(...args);t.contexts.push(args)}decodeAudioData(data,...args){const v=app.workspace.activeLeaf.view,c={bytes:Array.from(new Uint8Array(data)),root:app.vault.rootPath,view:v,blob:v.sourceBlob,version:v.sourceVersion,url:v.url,mode:t.mode};t.decodes.push(c);return super.decodeAudioData(data,...args).then(audio=>{c.audio=audio;c.nativeResolved=true;if(t.closed)return audio;if(c.mode==="fail")throw Error("Simulated saved waveform failure after actual native success");if(c.mode==="hold")return new Promise(resolve=>{const release=()=>{c.released=true;resolve(audio)};t.releases.push(release);t.release=release});return audio})}};URL.createObjectURL=function(blob){const url=t.create.call(URL,blob);t.objects.push({url,blob,revoked:false});return url};URL.revokeObjectURL=function(url){for(const item of t.objects)if(item.url===url)item.revoked=true;return t.revoke.call(URL,url)};for(const type of ["pointerdown","keydown"])document.addEventListener(type,event=>{if(event.target.closest?.("[data-audio-waveform]"))t.inputs.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal})})()`);
}
async function cleanupTrace(tools) {
  await tools.evaluate(`(()=>{const t=globalThis.${trace};if(!t)return;t.closed=true;for(const release of t.releases)release();t.host.acquire=t.acquire;t.devices.enumerateDevices=t.enumerate;globalThis.OfflineAudioContext=t.Real;URL.createObjectURL=t.create;URL.revokeObjectURL=t.revoke;t.abort.abort();t.playAbort?.abort();delete globalThis.${trace}})()`);
}
async function binding(tools) {
  return tools.evaluate(`(async()=>{const v=app.workspace.activeLeaf.view,b=v.sourceBlob,t=${trace},o=t.objects.find(o=>o.url===v.url);return{bytes:Array.from(new Uint8Array(await b.arrayBuffer())),mime:b.type,version:v.sourceVersion,url:v.url,duration:v.player.duration,paused:v.player.paused,time:v.player.currentTime,idle:v.waveform.job.state==="idle",owned:o?.blob===b&&!o.revoked&&v.player.src===v.url,captures:t.captures,contexts:t.contexts.length}})()`);
}
async function decoded(tools, bytes) {
  const proof = await tools.evaluate(`(()=>{const v=app.workspace.activeLeaf.view,j=v.waveform.job,t=${trace},c=t.decodes.at(-1),a=c.audio,expected=[];for(let bin=0;bin<256;bin++){let peak=0;for(let channel=0;channel<a.numberOfChannels;channel++){const samples=a.getChannelData(channel);for(let frame=Math.ceil(bin*a.length/256);frame<Math.ceil((bin+1)*a.length/256);frame++)peak=Math.max(peak,Math.min(1,Math.abs(samples[frame])))}expected.push(peak)}const o=t.objects.find(o=>o.url===v.url),svg=v.waveform.element.querySelector("svg");return{state:j.state,method:j.result?.method,peaks:j.result?.peaks,expected,frames:j.result?.frames,channels:j.result?.channels,rate:j.result?.sampleRate,owned:j.source.blob===v.sourceBlob&&c.blob===v.sourceBlob&&o?.blob===v.sourceBlob&&!o.revoked&&c.url===v.url&&v.player.src===v.url&&c.version===v.sourceVersion&&c.root===app.vault.rootPath,bytes:c.bytes,version:v.sourceVersion,bars:svg.querySelectorAll("rect").length,accessible:svg.getAttribute("aria-label"),context:t.contexts.at(-1),paused:v.player.paused,time:v.player.currentTime}})()`);
  assert.equal(proof.state, "ready"); assert.equal(proof.method, "saved"); assert.deepEqual(proof.peaks, proof.expected); assert.equal(proof.peaks.length, 256);
  assert.equal(proof.owned, true); assert.deepEqual(Buffer.from(proof.bytes), bytes); assert.equal(proof.bars, 256); assert.deepEqual(proof.context, [1, 1, 8000]);
  assert.equal(proof.rate, 8000); assert.match(proof.accessible, /Audio waveform.*Playback and seeking use the audio controls/); assert.equal(proof.paused, true); assert.equal(proof.time, 0);
  proof.compressed = await tools.evaluate("app.workspace.activeLeaf.view.waveform.job.result.compressed");
  assert.ok(["mp4-opus", "ogg-opus"].includes(proof.compressed.container)); assert.ok(proof.compressed.packets > 0); assert.ok(proof.compressed.packetFrames <= 31 * 48000);
  return proof;
}
const ready = tools => tools.wait(`document.querySelector(${q(figure)})?.dataset.waveformState==="ready"`, "explicit saved waveform is ready");
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };

/** Real MediaRecorder bytes/native decoder. Only declared failure/late-delivery boundaries are injected. */
export async function checkSavedAudioWaveform(tools) {
  const { directory, evaluate, wait, click, command, report, capture, host, restart, afterReload } = tools;
  assert.ok(["desktop", "web"].includes(host)); assert.equal(report.syntheticAudioOnly, true); assert.equal(report.physicalMicrophoneTested, false);
  const folder = "Saved audio waveform validation", corePath = join(directory, ".obsidian/core-plugins.json"), coreBytes = await optionalBytes(corePath);
  const enabled = await evaluate('app.core.isEnabled("audio-recorder")'), anchor = await evaluate("({id:app.workspace.activeLeaf.id,path:app.workspace.getActiveFile()?.path,text:app.workspace.activeLeaf.view.editor?.getValue()??null})");
  let stage = "fixtures", leaf, failure, clipPath, clipBytes, replacementBytes;
  const record = async (name, muted = false) => {
    await click('[data-core-ribbon="audio-recorder"]'); await wait(`Boolean(document.querySelector(${q(modal)}))`, "trusted recorder dialog opens");
    if (await evaluate(`Boolean(${api}.saved)`)) await click(action("discard"));
    await click(action("start")); await wait(`${api}.capture.state==="recording"&&${api}.capture.liveTracks===1`, "real synthetic microphone recording starts");
    if (muted) await evaluate(`${api}.capture.stream.getAudioTracks().forEach(track=>track.enabled=false)`);
    await wait(`${api}.capture.elapsedMs>=${muted ? 1100 : 650}`, "real native encoder produces a short clip"); await click(action("stop"));
    await wait(`${api}.capture.state==="ready"&&${api}.capture.liveTracks===0`, "native recording finishes and releases its microphone");
    const output = await evaluate(`(async()=>{const p=${api},suffix=p.modal.path.value.slice(p.modal.path.value.lastIndexOf("."));return{path:${q(folder + "/" + name)}+suffix,mime:p.capture.mime,bytes:Array.from(new Uint8Array(await p.capture.data.arrayBuffer()))}})()`);
    // This acceptance path intentionally requires a format supported by the narrow preflight.
    assert.ok(["audio/mp4", "audio/ogg"].includes(output.mime.split(";", 1)[0]), "Host's native recorder must produce this slice's supported compressed subset");
    await click(modal + " [data-audio-path]"); await key(command, "a", "KeyA", 65, 2); await command("Input.insertText", { text: output.path }); await click(action("save"));
    await wait(`${api}.saved?.path===${q(output.path)}&&!${api}.busy&&!app.core.busy`, "trusted Save retains the exact native recording");
    const bytes = Buffer.from(output.bytes); assert.deepEqual(await readFile(join(directory, output.path)), bytes);
    await click(modal + " .modal-close-button"); await wait(`!document.querySelector(${q(modal)})`, "saved recorder closes without another capture"); return { ...output, bytes };
  };
  try {
    await mkdir(join(directory, folder)); if (!enabled) await evaluate('app.core.setEnabled("audio-recorder",true)');
    await installTrace(tools);
    const clip = await record("Native saved clip"); clipPath = clip.path; clipBytes = clip.bytes;
    assert.equal(await evaluate(`${trace}.contexts.length`), 0);
    const privateDirectory = resolve(process.env.SLOPSIDIAN_SAVED_AUDIO_EVIDENCE_DIR ?? ".runtime/roadmap-inline-structure-audio-2026-11-19");
    const withinRuntime = relative(resolve(".runtime"), privateDirectory);
    assert.ok(!isAbsolute(withinRuntime) && withinRuntime !== ".." && !withinRuntime.startsWith(".." + (process.platform === "win32" ? "\\" : "/")), "Saved-audio test evidence stays in this repository's runtime directory");
    await mkdir(privateDirectory, { recursive: true });
    const privatePath = join(privateDirectory, "saved-audio-" + host + "." + clipPath.split(".").at(-1)); await writeFile(privatePath, clipBytes);
    const fixture = { path: "Cached saved recording." + clipPath.split(".").at(-1), base64: clipBytes.toString("base64"), bytes: clipBytes.length, sha256: sha256(clipBytes), mime: clip.mime, sourcePath: clipPath, privatePath };
    report.savedAudioWaveformProof = { fixture, physicalMicrophoneTested: false };

    stage = "explicit current saved file"; leaf = await openAudio(tools, clipPath); const bound = await binding(tools);
    assert.deepEqual(Buffer.from(bound.bytes), clipBytes); assert.equal(bound.idle, true); assert.equal(bound.contexts, 0); assert.equal(bound.owned, true); assert.ok(bound.duration > 0 && bound.duration <= 30);
    await click(show); await ready(tools); const initial = await decoded(tools, clipBytes); assert.ok(Math.max(...initial.peaks) > 0);
    Object.assign(fixture, { container: initial.compressed.container, duration: bound.duration, packetFrames: initial.compressed.packetFrames, packets: initial.compressed.packets });
    const playback = await nativePlay(tools); await capture?.("saved-audio-file");
    pass(report, "Trusted Show builds 256 actual native-PCM peaks from the same versioned saved Opus Blob and playback URL; no automatic decode/capture occurs, and trusted native playback still advances.");

    stage = "waveform-only failure and keyboard retry"; await closeAudio(tools, leaf); leaf = await openAudio(tools, clipPath); await evaluate(`${trace}.mode="fail"`); await click(show);
    await wait(`document.querySelector(${q(figure)})?.dataset.waveformState==="unavailable"`, "declared post-native failure leaves playback available");
    assert.match(await evaluate(`document.querySelector(${q(figure)}).textContent`), /Simulated saved waveform failure.*audio controls remain available/);
    const failurePlayback = await nativePlay(tools); await capture?.("saved-audio-fallback");
    await evaluate(`document.querySelector(${q(player)}).currentTime=0;${trace}.mode="normal";document.querySelector(${q(show)}).focus()`); await key(command, "Enter", "Enter", 13); await ready(tools); await decoded(tools, clipBytes);

    stage = "actual changed recording and held old decode"; await closeAudio(tools, leaf); leaf = await openAudio(tools, clipPath);
    await evaluate(`${trace}.mode="hold";${trace}.oldView=app.workspace.activeLeaf.view;${trace}.oldVersion=app.workspace.activeLeaf.view.sourceVersion;${trace}.oldUrl=app.workspace.activeLeaf.view.url`); await click(show);
    await wait(`${trace}.decodes.at(-1)?.nativeResolved&&Boolean(${trace}.release)`, "actual saved native result is held only at delivery");
    const replacement = await record("Muted native replacement", true); replacementBytes = replacement.bytes;
    assert.notDeepEqual(replacementBytes, clipBytes); await writeFile(join(directory, clipPath), replacementBytes); await evaluate("app.vault.refresh()");
    await wait(`${trace}.oldView.sourceVersion!==${trace}.oldVersion&&Boolean(${trace}.oldView.sourceBlob)`, "changed binary content reloads a new immutable version");
    await wait(`document.querySelector(${q(player)})?.readyState>=1`, "changed exact native recording metadata loads");
    assert.equal(await evaluate(`${trace}.objects.find(o=>o.url===${trace}.oldUrl).revoked`), true);
    await click(show); await wait(`document.querySelector(${q(figure)})?.dataset.waveformState==="unavailable"`, "retired native decoder retains the single lease");
    assert.match(await evaluate(`document.querySelector(${q(figure)}).textContent`), /still finishing/);
    await evaluate(`${trace}.release();${trace}.mode="normal"`); await wait(`${trace}.decodes.at(-1).released===true`, "retired old native delivery settles");
    assert.equal(await evaluate("app.workspace.activeLeaf.view.waveform.job.result===null"), true); await click(show); await ready(tools); const changed = await decoded(tools, replacementBytes);
    assert.notEqual(changed.version, initial.version); assert.notEqual(changed.frames, initial.frames); assert.notDeepEqual(changed.peaks, initial.peaks); await capture?.("saved-audio-changed-file");
    pass(report, "A second actual native recording with its synthetic input deliberately muted changes exact file bytes, version, PCM frames and peaks; held old delivery cannot repaint it, its URL is revoked, and the shared decoder lease requires explicit retry.");

    stage = "disabled provider late result"; await closeAudio(tools, leaf); leaf = await openAudio(tools, clipPath);
    await evaluate(`${trace}.mode="hold";${trace}.release=null;${trace}.disabledView=app.workspace.activeLeaf.view;${trace}.disabledUrl=app.workspace.activeLeaf.view.url`); await click(show);
    await wait(`${trace}.decodes.at(-1)?.nativeResolved&&Boolean(${trace}.release)`, "second actual native delivery is held for provider teardown");
    await evaluate('app.core.setEnabled("audio-recorder",false)');
    assert.equal(await evaluate(`${trace}.disabledView.waveform.job.result===null&&${trace}.disabledView.waveform.job.source===null&&${trace}.disabledView.waveform.job.timer===null&&${trace}.objects.find(o=>o.url===${trace}.disabledUrl).revoked`), true);
    await evaluate(`${trace}.release();${trace}.mode="normal"`); await wait(`${trace}.decodes.at(-1).released===true`, "disabled provider's late native delivery settles");
    assert.equal(await evaluate(`${trace}.disabledView.waveform.job.result===null`), true); await closeAudio(tools, leaf); leaf = null;
    await evaluate('app.core.setEnabled("audio-recorder",true)');
    assert.equal(await evaluate(`${trace}.anchor===app.workspace.getLeafById(${q(anchor.id)})&&${trace}.anchorView===${trace}.anchor.view&&${trace}.anchorEditor===${trace}.anchor.view.editor`), true);
    assert.equal(await evaluate(`app.workspace.getLeafById(${q(anchor.id)}).view.editor?.getValue()??null`), anchor.text);
    const inputs = await evaluate(`${trace}.inputs`); assert.ok(inputs.some(input => input.type === "pointerdown" && input.trusted)); assert.ok(inputs.some(input => input.key === "Enter" && input.trusted));
    assert.equal(await evaluate(`${trace}.captures`), 2); assert.equal(await evaluate(`${trace}.enumerations`), 0); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
    assert.equal(await evaluate(`${trace}.objects.every(o=>o.revoked)`), true);
    report.savedAudioWaveform = { syntheticMicrophoneOnly: true, realSavedCompressedFixture: true, explicitTrustedShow: true, noAutomaticDecode: true, sameVersionBlobAndURL: true, actualNativePCM: true, bounded256Bars: true, accessibleNoninteractiveSVG: true, trustedNativePlayback: true,
      declaredPostNativeFailure: true, playbackAfterFailure: true, trustedKeyboardRetry: true, declaredHeldNativeDelivery: true, realMutedReplacementRecording: true, changedBytesVersionFramesAndPeaks: true, oldURLRevoked: true, lateModifiedResultRefused: true, sharedNonoverlappingLease: true,
      disabledProviderDisposes: true, lateDisabledResultRefused: true, anchorObjectsAndTextRetained: true, ownedURLsReleased: true, noExtraCaptureOrEnumeration: true };
    Object.assign(report.savedAudioWaveformProof, { binding: bound, initial, changed, playback, failurePlayback, trustedInputs: inputs,
      replacement: { path: replacement.path, bytes: replacementBytes.length, sha256: sha256(replacementBytes), deliberatelyMutedSyntheticTrack: true },
      limits: { supported: ["fragmented MP4 Opus", "single-stream noncontinued Ogg Opus", "strict direct PCM/float WAV"], finitePlayerMetadataSeconds: 30, packetAndTimestampSecondsWithFraming: 31, encodedMiB: 16, compressedChannels: 2, sampleRate: 8000, acceptedCompressedPcmMiB: 2, nativeConcurrentJobs: 1, deadlineSeconds: 15, internalNativeDecoderAllocationBounded: false } });
    pass(report, "Declared post-native failure retains playback and keyboard retry. Provider disable releases the saved source, timer, PCM and URL before held delivery settles; the original Source leaf/editor objects and text stay live, with no extra capture or device enumeration.");

    stage = "real host restart or actual-folder reconnection";
    await writeFile(join(directory, clipPath), clipBytes); await evaluate("app.vault.refresh()");
    leaf = await openAudio(tools, clipPath); const beforeRestart = await binding(tools), restartRoot = await evaluate("app.vault.rootPath");
    assert.deepEqual(Buffer.from(beforeRestart.bytes), clipBytes);
    const nonce = "saved-audio-" + host + "-" + Date.now(); await evaluate(`globalThis.savedAudioRestartGeneration=${q(nonce)}`);
    // No decoder/URL/capture wrappers cross the real generation boundary.
    await cleanupTrace(tools);
    await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout();await app.core.whenIdle()})()");
    if (restart) await restart(); else await command("Page.reload"); await afterReload();
    await wait(`app.vault.rootPath===${q(restartRoot)}&&!app.changingVault&&app.workspace.activeLeaf.id===${q(leaf)}&&app.workspace.activeLeaf.view.getViewType()==="audio"&&Boolean(app.workspace.activeLeaf.view.sourceBlob)&&document.querySelector(${q(player)})?.readyState>=1`, "new host generation restores its owned saved-audio player");
    assert.equal(await evaluate("typeof globalThis.savedAudioRestartGeneration"), "undefined");
    assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
    assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes);
    await installTrace(tools);
    // Startup loaded this Blob before trace installation. Adopt its exact existing binding
    // for teardown observation, rather than claiming its creation was instrumented.
    await evaluate(`(()=>{const v=app.workspace.activeLeaf.view;${trace}.objects.push({url:v.url,blob:v.sourceBlob,revoked:false,adoptedAfterStartup:true})})()`);
    const afterRestart = await binding(tools); assert.equal(afterRestart.idle, true); assert.equal(afterRestart.owned, true); assert.notEqual(afterRestart.url, beforeRestart.url);
    assert.deepEqual(Buffer.from(afterRestart.bytes), clipBytes); assert.equal(afterRestart.contexts, 0); assert.equal(afterRestart.captures, 0);
    await click(show); await ready(tools); const rebuilt = await decoded(tools, clipBytes); assert.deepEqual(rebuilt.peaks, initial.peaks);
    await capture?.("saved-audio-restart"); await closeAudio(tools, leaf); leaf = null;
    assert.equal(await evaluate(`${trace}.captures===0&&${trace}.enumerations===0&&${trace}.objects.every(o=>o.revoked)`), true);
    report.savedAudioWaveformRestart = { actualHostRoundTrip: true, freshRealm: true, exactRetainedRecording: true, restoredAudioProvider: true, distinctPlayerURL: true, currentNewGenerationBlobVersionAndURL: true, explicitTrustedRebuild: true, exactNativePcmPeaks: true, noCaptureOrEnumeration: true, ownedURLReleased: true };
    report.savedAudioWaveformRestartProof = { host, boundary: restart ? "desktop process restart" : "browser reload and actual-folder reconnect", before: beforeRestart, after: afterRestart, rebuilt, startupBindingAdoptedAfterTrace: true, earlierSameOwnerProofLimitedToBeforeRestart: true };
    pass(report, "An actual desktop restart or browser reload/folder reconnection restores byte-exact saved audio in a fresh realm and distinct player URL. Explicit Show rebuilds the same real native PCM peaks with the new version/Blob/URL owner and no microphone access; closing releases that new URL.");
  } catch (error) {
    failure = error; report.savedAudioWaveformFailure = { stage, error: String(error?.stack ?? error) };
    try { report.savedAudioWaveformFailure.state = await evaluate(`(()=>{const t=globalThis.${trace},v=app.workspace.activeLeaf.view;return{file:v.file?.path,type:v.getViewType(),wave:v.waveform?.job.state,message:v.waveform?.job.message,duration:v.player?.duration,decodes:t?.decodes.map(c=>({mode:c.mode,resolved:c.nativeResolved,released:c.released,bytes:c.bytes.length,frames:c.audio?.length})),contexts:t?.contexts,captures:t?.captures}})()`); await capture?.("saved-audio-precleanup-failure"); } catch {} throw error;
  } finally {
    try {
      await evaluate(`(()=>{const t=globalThis.${trace};if(t){t.closed=true;for(const release of t.releases)release()}const p=app.core.getPluginById("audio-recorder")?.instance;if(p){p.capture.cancel();p.modal?.forceClose();p.modal=null}})()`);
      if (leaf) await closeAudio(tools, leaf);
      if (clipPath && clipBytes) await writeFile(join(directory, clipPath), clipBytes);
      if (await evaluate('app.core.isEnabled("audio-recorder")') !== enabled) await evaluate('app.core.setEnabled("audio-recorder",' + enabled + ')');
      await cleanupTrace(tools); await restore(corePath, coreBytes); await evaluate("app.vault.refresh()");
      await evaluate(`(()=>{const leaf=app.workspace.getLeafById(${q(anchor.id)});if(leaf)app.workspace.setActiveLeaf(leaf)})()`);
      assert.deepEqual(await optionalBytes(corePath), coreBytes);
    } catch (error) { if (!failure) throw error; report.savedAudioWaveformFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** Exact bytes from this host's accepted real native recording; no fake compressed fixture. */
export function savedAudioWaveformReadOnlyFixture(report) {
  const fixture = report.savedAudioWaveformProof?.fixture; assert.ok(fixture, "Run the real saved waveform workflow before mounting its cached fixture");
  const bytes = Buffer.from(fixture.base64, "base64"); assert.equal(bytes.length, fixture.bytes); assert.equal(sha256(bytes), fixture.sha256);
  return { files: [[fixture.path, bytes], ["Cached saved PCM.wav", tone]], sourceAddition: "\n\n![[" + fixture.path + "]]\n![[Cached saved PCM.wav]]\n" };
}

/** Parent supplies the genuine cached mount, then verifies cached blobs and API/raw counters. */
export async function checkSavedAudioWaveformReadOnly(tools) {
  const { evaluate, wait, click, report, capture } = tools, fixture = report.savedAudioWaveformProof.fixture, bytes = Buffer.from(fixture.base64, "base64");
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate("app.workspace.activeLeaf.id"), "readonly-inline-structure-audio");
  const documents = await evaluate('app.metadataCache.getDocuments().map(e=>({path:e.document.file.path,text:e.text,version:e.document.version,hasBom:e.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
  let leaf, stage = "cached immutable compressed bytes";
  await installTrace(tools);
  try {
    leaf = await openAudio(tools, fixture.path); const bound = await binding(tools);
    assert.deepEqual(Buffer.from(bound.bytes), bytes); assert.match(bound.version, /^git:/); assert.equal(bound.contexts, 0); assert.equal(bound.captures, 0); assert.equal(bound.idle, true); assert.equal(bound.owned, true);
    await click(show); await ready(tools); const compressed = await decoded(tools, bytes); assert.deepEqual(compressed.peaks, report.savedAudioWaveformProof.initial.peaks);
    const playback = await nativePlay(tools); await capture?.("saved-audio-readonly"); await closeAudio(tools, leaf); leaf = null;
    stage = "cached strict PCM regression"; leaf = await openAudio(tools, "Cached saved PCM.wav"); const before = await evaluate(`${trace}.contexts.length`);
    await click(show); await ready(tools);
    const pcm = await evaluate("({method:app.workspace.activeLeaf.view.waveform.job.result.method,peaks:app.workspace.activeLeaf.view.waveform.job.result.peaks,frames:app.workspace.activeLeaf.view.waveform.job.result.frames})");
    const frames = tone.readUInt32LE(40) / 2, expected = Array.from({ length: 256 }, (_, bin) => { let peak = 0; for (let frame = Math.ceil(bin * frames / 256); frame < Math.ceil((bin + 1) * frames / 256); frame++) peak = Math.max(peak, Math.abs(tone.readInt16LE(44 + frame * 2)) / 32768); return peak; });
    assert.equal(pcm.method, "wav"); assert.deepEqual(pcm.peaks, expected); assert.equal(await evaluate(`${trace}.contexts.length`), before); await closeAudio(tools, leaf); leaf = null;
    stage = "read-only authoring refusal";
    const refusal = await evaluate(`(async()=>{try{await ${api}.capture.start();return "unexpected success"}catch(error){return String(error.message)}})()`);
    assert.match(refusal, /read.only/i); assert.equal(await evaluate(`${trace}.captures`), 0); assert.equal(await evaluate(`${trace}.enumerations`), 0);
    assert.equal(await evaluate(`${trace}.objects.every(o=>o.revoked)`), true);
    assert.equal(await evaluate(`${trace}.anchor===app.workspace.getLeafById("readonly-inline-structure-audio")&&${trace}.anchorView===${trace}.anchor.view&&${trace}.anchorEditor===${trace}.anchor.view.editor`), true);
    assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(e=>({path:e.document.file.path,text:e.text,version:e.document.version,hasBom:e.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'), documents);
    report.savedAudioWaveformReadOnly = { genuineCachedMount: true, exactRealCompressedBytes: true, explicitTrustedShow: true, sameCachedVersionBlobAndURL: true, actualNativePCM: true, bounded256Bars: true, trustedNativePlayback: true, noCaptureOrEnumeration: true, cachedDirectPCMRegression: true, noDecoderForWav: true, readOnlyCaptureGuard: true, anchorObjectsRetained: true, ownedURLsReleased: true, documentsAndVersionsUnchanged: true };
    report.savedAudioWaveformReadOnlyProof = { fixture: { path: fixture.path, bytes: fixture.bytes, sha256: fixture.sha256, mime: fixture.mime }, binding: bound, compressed, pcm, playback, refusal };
    pass(report, "The genuine cached read-only mount decodes only the exact host-produced short Opus fixture after trusted Show, preserves its version/Blob/URL and 256 exact peaks, retains native playback, keeps strict PCM WAV direct, refuses capture before hardware access, and releases all player URLs without changing Source or cached documents.");
  } catch (error) { report.savedAudioWaveformReadOnlyFailure = { stage, error: String(error?.stack ?? error) }; try { await capture?.("saved-audio-readonly-precleanup-failure"); } catch {} throw error; }
  finally { if (leaf) await closeAudio(tools, leaf); await cleanupTrace(tools); }
}
