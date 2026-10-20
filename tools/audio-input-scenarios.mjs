import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, api = 'app.core.getEnabledPluginById("audio-recorder")';
const modal = ".audio-recorder-modal", action = name => modal + ' [data-audio-action="' + name + '"]';
const selector = modal + " [data-audio-input]", refresh = action("refresh-inputs");
const bytes = text => Buffer.from("\ufeff" + text), initial = "# Microphone inputs λ\r\n\r\nRetain original 😀 bytes.\r\n", dirty = initial + "Earlier unsaved prose Ω.\r\n";
const optionalBytes = path => readFile(path).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
async function restoreBytes(path, original) { if (original !== null) await writeFile(path, original); else await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }
export const audioInputsReadOnlyFixture = { files: [] };
async function key(command, value, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of [value === "Enter" ? "keyDown" : "rawKeyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode, modifiers, ...(value === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
}
async function fill(tools, target, text) { await tools.click(target); await key(tools.command, "a", "KeyA", 65, 2); await tools.command("Input.insertText", { text }); }
async function choose(tools, position) {
  await tools.evaluate(`document.querySelector(${q(selector)}).focus()`);
  await key(tools.command, "Home", "Home", 36);
  if (position === "last") await key(tools.command, "End", "End", 35);
  else if (position === "first-input") await key(tools.command, "ArrowDown", "ArrowDown", 40);
}
async function disabledPointer(tools, target) {
  const point = await tools.evaluate(`(()=>{const el=document.querySelector(${q(target)});el.scrollIntoView({block:"center"});const r=Array.from(el.getClientRects()).find(rect=>rect.width>0&&rect.height>0),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,disabled:el.disabled,reachable:hit===el||el.contains(hit)}})()`);
  assert.equal(point.disabled, true); assert.equal(point.reachable, true);
  for (const type of ["mousePressed", "mouseReleased"]) await tools.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
}

/** All acquired media is the runner's isolated synthetic microphone. Simulated list entries never supply media. */
export async function checkAudioInputs(tools) {
  const { directory, evaluate, wait, click, command, handleDialog, report, capture } = tools;
  assert.equal(report.syntheticAudioOnly, true); assert.equal(report.physicalMicrophoneTested, false);
  await evaluate("(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), enabled = await evaluate('app.core.isEnabled("audio-recorder")');
  const configPath = join(directory, ".obsidian/app.json"), corePath = join(directory, ".obsidian/core-plugins.json"), configBytes = await optionalBytes(configPath), coreBytes = await optionalBytes(corePath);
  const config = configBytes ? JSON.parse(configBytes.toString("utf8").replace(/^\ufeff/, "")) : {};
  const folder = "Audio input validation", path = folder + "/Source.md", leaf = "audio-input-note", source = "app.workspace.getLeafById(" + q(leaf) + ").view", editor = '[data-leaf-id="' + leaf + '"] .cm-content';
  const workLayout = { version: 1, main: { id: "audio-input-main", type: "split", direction: "vertical", children: [{ id: "audio-input-tabs", type: "tabs", currentTab: 0, children: [{ id: leaf, type: "leaf", state: { type: "markdown", state: { file: path, mode: "source", source: true } } }] }] }, active: leaf };
  let stage = "fixture", failure, clipPath, clipBytes, finalText;
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const open = async () => { await click('[data-core-ribbon="audio-recorder"]'); await wait(`Boolean(document.querySelector(${q(modal)}))`, "microphone chooser opens"); };
  const close = async () => { await click(modal + " .modal-close-button"); await wait(`!document.querySelector(${q(modal)})`, "microphone chooser closes"); };
  const idle = () => wait(`!app.core.busy&&!${api}.busy`, "current recorder/Core operation completes");
  const refreshList = async () => { await click(refresh); await wait(`${api}.modal.inputs.state==="ready"&&!${api}.modal.inputs.refreshing`, "explicit microphone enumeration completes"); };
  const start = async () => { await click(action("start")); await wait(`${api}.capture.state==="recording"&&${api}.capture.liveTracks===1`, "real synthetic microphone starts"); await wait(`${api}.capture.elapsedMs>=500`, "real encoded microphone data"); };
  const stop = async () => { await click(action("stop")); await wait(`${api}.capture.state==="ready"&&${api}.capture.liveTracks===0`, "real recorder finalizes and releases microphone"); };
  const exactSource = async expected => { assert.equal(await evaluate(source + ".editor.getValue()"), expected); assert.deepEqual(await readFile(join(directory, path)), bytes(initial)); };
  try {
    await mkdir(join(directory, folder)); await writeFile(join(directory, path), bytes(initial), { flag: "wx" });
    await writeFile(configPath, Buffer.from(JSON.stringify({ ...config, markdownAutosave: false }, null, 2)));
    await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()');
    if (!enabled) await evaluate('app.core.setEnabled("audio-recorder",true)');
    await evaluate("app.workspace.changeLayout(" + q(workLayout) + ")"); await wait(source + "?.editor&&" + source + ".editor.getValue()===" + q(initial), "owned microphone-test source editor");
    await click(editor); await key(command, "End", "End", 35, 2); await command("Input.insertText", { text: "Earlier unsaved prose Ω.\n" }); await wait(source + ".session.dirty&&" + source + ".editor.getValue()===" + q(dirty), "earlier trusted dirty source");
    await evaluate(`(()=>{const p=${api},m=navigator.mediaDevices,h=p.capture.host,t=globalThis.audioInputTrace={devices:m,enumerate:m.enumerateDevices,getUserMedia:m.getUserMedia,host:h,acquire:h.acquire,create:h.create,enumerations:0,requests:[],encoders:0,events:[],abort:new AbortController(),simulatedList:false,holdList:false,holdGrant:false};t.enumerateWrapper=async function(...args){t.enumerations++;let devices=await t.enumerate.apply(this,args);t.nativeAudioInputs=devices.filter(device=>device.kind==="audioinput"&&device.deviceId&&!["default","communications"].includes(device.deviceId)).length;if(t.simulatedList)devices=[...devices,{kind:"audioinput",deviceId:"synthetic-missing-validation-input",label:"Simulated unavailable microphone"},{kind:"videoinput",deviceId:"synthetic-private-camera",label:"Simulated camera must stay hidden"},{kind:"audiooutput",deviceId:"synthetic-private-speaker",label:"Simulated speaker must stay hidden"}];if(t.holdList)return new Promise(resolve=>{t.listRelease=()=>resolve(devices);t.listHeld=true});return devices};t.permissionWrapper=function(...args){t.requests.push(args[0]);return t.getUserMedia.apply(this,args)};t.acquireWrapper=async function(...args){const stream=await t.acquire.apply(this,args);if(t.holdGrant)return new Promise(resolve=>{t.heldStream=stream;t.grantRelease=()=>resolve(stream);t.grantHeld=true});return stream};t.createWrapper=function(...args){t.encoders++;return t.create.apply(this,args)};m.enumerateDevices=t.enumerateWrapper;m.getUserMedia=t.permissionWrapper;h.acquire=t.acquireWrapper;h.create=t.createWrapper;for(const name of ["pointerdown","keydown","change"])document.addEventListener(name,event=>{if(event.target.closest?.(${q(modal)}))t.events.push({type:name,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});})()`);

    await evaluate(`(()=>{const t=audioInputTrace;document.addEventListener("click",event=>{const action=event.target.closest?.("[data-audio-action]");if(action?.closest(${q(modal)}))t.events.push({type:"click",action:action.dataset.audioAction,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal})})()`);
    stage = "explicit listing only"; await open();
    assert.deepEqual(await evaluate("({lists:audioInputTrace.enumerations,requests:audioInputTrace.requests.length})"), { lists: 0, requests: 0 });
    assert.deepEqual(await evaluate(`Array.from(document.querySelector(${q(selector)}).options,option=>option.textContent)`), ["System default"]); await refreshList();
    assert.ok(await evaluate(`${api}.modal.inputs.choices.length>=1`), "synthetic host exposes at least one named/unnamed audio input"); assert.equal(await evaluate("audioInputTrace.enumerations"), 1); assert.equal(await evaluate("audioInputTrace.requests.length"), 0);
    await choose(tools, "first-input"); await wait(`${api}.modal.inputs.selected===${api}.modal.inputs.choices[0].id`, "trusted keyboard selects an explicit listed input");
    assert.equal(await evaluate('audioInputTrace.events.some(event=>event.type==="change"&&event.trusted)'), true); await exactSource(dirty); await capture?.("audio-input-selected");
    pass("Opening the transient microphone chooser makes no enumeration or permission request. Trusted Refresh lists browser-exposed audio inputs without capture; trusted keyboard selection chooses a specific input while earlier dirty BOM/CRLF/Unicode source stays exact.");

    stage = "same selected microphone through pause"; await start();
    assert.equal(await evaluate(`audioInputTrace.requests.length===1&&audioInputTrace.requests[0].video===false&&audioInputTrace.requests[0].audio.deviceId.exact===${api}.modal.inputs.selected`), true);
    await click(action("pause")); await wait(`${api}.capture.state==="paused"`, "real selected microphone pauses"); await evaluate(`audioInputTrace.encoder=${api}.capture.recorder;audioInputTrace.chosen=${api}.modal.inputs.selected`);
    await disabledPointer(tools, selector); await disabledPointer(tools, refresh);
    const refusals = await evaluate(`(async()=>{const p=${api},errors=[];for(const fn of [()=>p.modal.inputs.select(""),()=>p.modal.inputs.refresh()]){try{await fn();errors.push(null)}catch(error){errors.push(error.message)}}return errors})()`); assert.ok(refusals.every(error => /Stop and save/.test(error)));
    await evaluate('navigator.mediaDevices.dispatchEvent(new Event("devicechange"))');
    assert.equal(await evaluate(`${api}.capture.state`), "paused"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 1); assert.equal(await evaluate(`${api}.modal.inputs.selected===audioInputTrace.chosen&&!${api}.modal.inputs.valid`), true); assert.equal(await evaluate("audioInputTrace.enumerations"), 1);
    await click(action("resume")); await wait(`${api}.capture.state==="recording"`, "real selected microphone resumes after simulated list change"); assert.equal(await evaluate(`${api}.capture.recorder===audioInputTrace.encoder`), true); await wait(`${api}.capture.elapsedMs>=1050`, "resumed same-clip audio advances"); await stop();
    assert.equal(await evaluate("audioInputTrace.requests.length"), 1); assert.equal(await evaluate("audioInputTrace.encoders"), 1); await wait(`document.querySelector(${q(modal + " [data-audio-preview]")})?.readyState>=1`, "selected-microphone clip decodes"); await capture?.("audio-input-paused-preview");
    pass("An exact selected input powers one real synthetic MediaRecorder through Start/Pause/Resume/Stop. Disabled pointer and forged chooser/Refresh actions cannot change capture. A simulated devicechange invalidates the future selection while the current live stream and encoder remain unchanged and produce a decodable clip.");

    stage = "exact recording bytes and source history";
    clipBytes = Buffer.from(await evaluate(`(async()=>Array.from(new Uint8Array(await ${api}.capture.data.arrayBuffer())))()`)); assert.ok(clipBytes.length > 0);
    const extension = await evaluate(`${api}.capture.mime.split(";")[0]==="audio/mp4"?"m4a":${api}.capture.mime.split(";")[0]==="audio/ogg"?"ogg":"webm"`); clipPath = folder + "/Selected input clip." + extension;
    await fill(tools, modal + " [data-audio-path]", clipPath); await click(action("insert")); await idle(); assert.equal(await evaluate(`${api}.inserted`), true); assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes);
    const link = await evaluate("app.fileManager.generateMarkdownLink(app.vault.getFileByPath(" + q(clipPath) + ")," + q(path) + ")"); finalText = dirty + "\r\n!" + link + "\r\n"; await exactSource(finalText); await close();
    await click(editor); await key(command, "z", "KeyZ", 90, 2); await wait(source + ".editor.getValue()===" + q(dirty), "one Undo removes only selected-input embed"); await exactSource(dirty);
    await key(command, "y", "KeyY", 89, 2); await wait(source + ".editor.getValue()===" + q(finalText), "Redo restores exact selected-input embed"); await key(command, "s", "KeyS", 83, 2); await wait("!" + source + ".session.dirty&&!" + source + ".session.isSaving", "normal source save completes");
    assert.deepEqual(await readFile(join(directory, path)), bytes(finalText)); assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes);
    pass("Save and insert persists the exact recorded Blob and inserts one preferences-correct embed as a separate shared Undo transaction. Undo retains earlier dirty prose, Redo restores the embed, and normal Save preserves exact BOM/CRLF/Unicode note bytes.");

    stage = "simulated missing input uses no fallback"; await open(); await click(action("discard"));
    await evaluate("audioInputTrace.simulatedList=true"); await refreshList();
    assert.equal(await evaluate(`Array.from(document.querySelector(${q(selector)}).options,option=>option.textContent).some(text=>/camera|speaker/i.test(text))`), false);
    await choose(tools, "last"); await wait(`${api}.modal.inputs.selected==="synthetic-missing-validation-input"`, "trusted keyboard chooses simulated unavailable inventory entry");
    const beforeMissing = await evaluate("({requests:audioInputTrace.requests.length,encoders:audioInputTrace.encoders})"); await click(action("start")); await wait(`${api}.capture.state==="error"&&${api}.capture.liveTracks===0`, "real capture refuses missing exact input");
    assert.equal(await evaluate("audioInputTrace.requests.length"), beforeMissing.requests + 1); assert.equal(await evaluate("audioInputTrace.encoders"), beforeMissing.encoders); assert.deepEqual(await evaluate("audioInputTrace.requests.at(-1)"), { audio: { deviceId: { exact: "synthetic-missing-validation-input" } }, video: false });
    await capture?.("audio-input-missing");
    pass("A clearly simulated inventory entry exercises a real required-device capture failure: the exact unavailable ID is requested once, no replacement encoder starts, all tracks are released and no System default retry occurs. Simulated camera/speaker entries never reach the audio chooser.");

    stage = "removed choice requires deliberate default"; await evaluate("audioInputTrace.simulatedList=false"); await refreshList();
    assert.equal(await evaluate(`${api}.modal.inputs.selected==="synthetic-missing-validation-input"&&!${api}.modal.inputs.valid`), true); await disabledPointer(tools, action("start"));
    const beforeRefusal = await evaluate("audioInputTrace.requests.length"); const refused = await evaluate(`(async()=>{try{await ${api}.capture.start();return null}catch(error){return error.message}})()`); assert.match(refused, /Refresh/); assert.equal(await evaluate("audioInputTrace.requests.length"), beforeRefusal);
    await choose(tools, "default"); await wait(`${api}.modal.inputs.selected===""&&${api}.modal.inputs.valid`, "trusted keyboard explicitly chooses System default"); await start(); assert.deepEqual(await evaluate("audioInputTrace.requests.at(-1)"), { audio: true, video: false }); await stop();
    const discard = click(action("discard")); await handleDialog(true); await discard; await wait(`${api}.capture.state==="idle"`, "unsaved default clip is deliberately discarded");
    pass("Removing a previously selected input on Refresh preserves its invalid selection and disables Start, including forged capture calls with zero permission work. A trusted explicit System default choice restores default-only capture; its unsaved clip is discarded without an attachment.");

    stage = "late enumeration belongs to closed dialog"; await evaluate(`audioInputTrace.holdList=true;audioInputTrace.oldInputs=${api}.modal.inputs`); await click(refresh); await wait("audioInputTrace.listHeld===true", "device enumeration held at controlled async boundary");
    const lists = await evaluate("audioInputTrace.enumerations"); assert.equal(await evaluate(`${api}.modal.inputs.refresh()===${api}.modal.inputs.pending.promise`), true); assert.equal(await evaluate("audioInputTrace.enumerations"), lists);
    await close(); await open(); assert.equal(await evaluate(`${api}.modal.inputs.state`), "idle"); await evaluate("audioInputTrace.holdList=false;audioInputTrace.listRelease()"); await wait("audioInputTrace.oldInputs.state===\"disposed\"&&audioInputTrace.oldInputs.refreshing===false", "late enumeration leaves old chooser disposed");
    assert.deepEqual(await evaluate(`${api}.modal.inputs.choices`), []); assert.equal(await evaluate(`${api}.modal.inputs.selected`), ""); assert.equal(await evaluate("audioInputTrace.enumerations"), lists);
    pass("An intentionally delayed enumeration is deduplicated. Closing/reopening destroys the old chooser and clears identifiers; its late result cannot populate the replacement dialog, cause another list request or request microphone permission.");

    stage = "late permission grant belongs to cancelled capture"; await evaluate("audioInputTrace.holdGrant=true"); const encoderCount = await evaluate("audioInputTrace.encoders"); await click(action("start")); await wait(`audioInputTrace.grantHeld===true&&${api}.capture.state==="requesting"`, "actual synthetic stream held behind controlled permission-response latency");
    await disabledPointer(tools, selector); await disabledPointer(tools, refresh); await close(); await open(); await evaluate("audioInputTrace.holdGrant=false;audioInputTrace.grantRelease()");
    await wait("audioInputTrace.heldStream.getTracks().every(track=>track.readyState===\"ended\")", "cancelled capture releases every late-granted track"); assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0); assert.equal(await evaluate("audioInputTrace.encoders"), encoderCount); assert.deepEqual(await evaluate(`${api}.modal.inputs.choices`), []);
    pass("A real synthetic stream delayed behind a controlled permission-response boundary is cancelled by Close. The late grant releases every track without creating an encoder or retargeting the replacement chooser; inputs remain disabled during the pending request.");

    stage = "dialog and Core lifecycle cleanup"; await refreshList(); await choose(tools, "first-input"); const listCount = await evaluate("audioInputTrace.enumerations"); await close(); await open();
    assert.equal(await evaluate(`${api}.modal.inputs.selected`), ""); assert.deepEqual(await evaluate(`${api}.modal.inputs.choices`), []); assert.equal(await evaluate("audioInputTrace.enumerations"), listCount); await close();
    assert.deepEqual(await readFile(join(directory, clipPath)), clipBytes); assert.deepEqual(await readFile(join(directory, path)), bytes(finalText)); assert.deepEqual((await readdir(join(directory, folder))).sort(), ["Source.md", clipPath.split("/").at(-1)].sort());
    report.audioInputsInputs = await evaluate("audioInputTrace.events.slice()"); assert.ok(report.audioInputsInputs.length > 20 && report.audioInputsInputs.every(event => event.trusted));
    for (const expected of ["start", "pause", "resume", "stop", "insert", "refresh-inputs"]) assert.ok(report.audioInputsInputs.some(event => event.type === "click" && event.action === expected), "trusted actual recorder action: " + expected);
    assert.ok(report.audioInputsInputs.some(event => event.type === "change"));
    await evaluate('(()=>{const t=audioInputTrace;if(t.devices.enumerateDevices===t.enumerateWrapper)t.devices.enumerateDevices=t.enumerate;if(t.devices.getUserMedia===t.permissionWrapper)t.devices.getUserMedia=t.getUserMedia;if(t.host.acquire===t.acquireWrapper)t.host.acquire=t.acquire;if(t.host.create===t.createWrapper)t.host.create=t.create;t.abort.abort()})()');
    await evaluate(`globalThis.audioInputOldCapture=${api}.capture`); await evaluate('app.core.setEnabled("audio-recorder",false)'); await evaluate("app.core.whenIdle()");
    assert.equal(await evaluate("audioInputOldCapture.state"), "disposed"); assert.equal(await evaluate("audioInputOldCapture.liveTracks"), 0); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false); assert.equal(await evaluate('app.commands.listCommands().some(item=>item.id.startsWith("audio-recorder:"))'), false);
    await evaluate('app.core.setEnabled("audio-recorder",true)'); await evaluate("app.core.whenIdle()"); assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0);
    await capture?.("audio-input-cleanup");
    report.audioInputs = { syntheticMicrophoneOnly: true, physicalDeviceSelectionTested: false, realMediaRecorder: true, realExactConstraint: true, trustedKeyboardSelection: true, noCaptureForRefresh: true, noAutomaticListing: true, deduplicatedAsyncEnumeration: true, privateAudioOnlyInventory: true, simulatedMissingInventory: true, realMissingExactCaptureFailure: true, noFallback: true, invalidChoiceRetained: true, explicitDefaultRequired: true, simulatedDeviceChangeKeepsActiveStream: true, exactBlobAndBomCrlfUnicode: true, isolatedUndoRedo: true, lateEnumerationOwner: true, delayedRealGrantReleased: true, chooserIdentifiersTransient: true, coreLifecycleDisposed: true, savedBytes: clipBytes.length, savedSha256: createHash("sha256").update(clipBytes).digest("hex") };
    pass("Chooser selections and inventory are transient across dialog instances, without automatic enumeration. Core disable disposes the old capture, removes recording commands/dialog, releases every track, and re-enable starts idle. Exactly one saved clip and exact saved source remain in the isolated validation folder.");
  } catch (error) {
    failure = error; report.audioInputsFailure = { stage, error: String(error?.stack ?? error) };
    try { report.audioInputsFailure.state = await evaluate(`(()=>{const p=${api},t=globalThis.audioInputTrace;return{capture:p&&{state:p.capture.state,message:p.capture.message,tracks:p.capture.liveTracks,bytes:p.capture.bytes},inputs:p?.modal&&{state:p.modal.inputs.state,valid:p.modal.inputs.valid,selectedDefault:!p.modal.inputs.selected,choices:p.modal.inputs.choices.length,message:p.modal.inputs.message},lists:t?.enumerations,requests:t?.requests.length,encoders:t?.encoders,listHeld:t?.listHeld,grantHeld:t?.grantHeld,status:document.querySelector(${q(modal + " [data-audio-status]")})?.textContent}})()`); await capture?.("audio-input-precleanup-failure"); } catch {}
    throw error;
  } finally {
    try {
      await evaluate('(()=>{const p=app.core.getPluginById("audio-recorder")?.instance;p?.capture.cancel();p?.modal?.forceClose();if(p)p.modal=null;const t=globalThis.audioInputTrace;if(t){t.listRelease?.();t.grantRelease?.();t.heldStream?.getTracks().forEach(track=>track.stop());if(t.devices.enumerateDevices===t.enumerateWrapper)t.devices.enumerateDevices=t.enumerate;if(t.devices.getUserMedia===t.permissionWrapper)t.devices.getUserMedia=t.getUserMedia;if(t.host.acquire===t.acquireWrapper)t.host.acquire=t.acquire;if(t.host.create===t.createWrapper)t.host.create=t.create;t.abort.abort()}delete globalThis.audioInputTrace;delete globalThis.audioInputOldCapture})()');
      await evaluate("app.core.whenIdle()"); if (await evaluate('app.core.isEnabled("audio-recorder")') !== enabled) await evaluate('app.core.setEnabled("audio-recorder",' + enabled + ')');
      await evaluate("(async()=>{await app.core.whenIdle();await app.saveAll()})()"); await restoreBytes(corePath, coreBytes); await restoreBytes(configPath, configBytes);
      await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.workspace.changeLayout(' + q(layout) + ');await app.workspace.flushLayout();await app.core.whenIdle()})()');
      assert.deepEqual(await optionalBytes(configPath), configBytes); assert.deepEqual(await optionalBytes(corePath), coreBytes);
    } catch (error) { if (!failure) throw error; report.audioInputsFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** The parent mounts the actual cached read-only provider and audits complete cached bytes/counters. */
export async function checkAudioInputsReadOnly(tools) {
  const { evaluate, report, capture } = tools;
  assert.equal(await evaluate("app.vault.readOnly"), true); assert.equal(await evaluate('app.core.isEnabled("audio-recorder")'), true);
  const documents = await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))');
  await evaluate(`(()=>{const m=navigator.mediaDevices,h=${api}.capture.host,t=globalThis.audioInputReadOnlyTrace={devices:m,enumerate:m.enumerateDevices,host:h,acquire:h.acquire,enumerations:0,acquisitions:0};t.enumerateWrapper=function(...args){t.enumerations++;return t.enumerate.apply(this,args)};t.acquireWrapper=function(...args){t.acquisitions++;return t.acquire.apply(this,args)};m.enumerateDevices=t.enumerateWrapper;h.acquire=t.acquireWrapper})()`);
  try {
    const ribbon = '[data-core-ribbon="audio-recorder"]'; await disabledPointer(tools, ribbon);
    await evaluate('(()=>{const b=document.querySelector(\'[data-core-ribbon="audio-recorder"]\');b.disabled=false;b.click();b.disabled=true})()');
    const errors = await evaluate(`(async()=>{const p=${api},errors=[];for(const fn of [()=>p.open(),()=>p.capture.start(),()=>p.authorizeInput({containerEl:{isConnected:true}})]){try{await fn();errors.push(null)}catch(error){errors.push(error.message)}}return errors})()`); assert.ok(errors.every(error => /read-only/.test(error)));
    assert.equal(await evaluate('app.commands.executeCommandById("audio-recorder:start")'), false); assert.equal(await evaluate(`Boolean(document.querySelector(${q(modal)}))`), false); assert.equal(await evaluate(`${api}.capture.state`), "idle"); assert.equal(await evaluate(`${api}.capture.liveTracks`), 0); assert.deepEqual(await evaluate("({lists:audioInputReadOnlyTrace.enumerations,capture:audioInputReadOnlyTrace.acquisitions})"), { lists: 0, capture: 0 });
    assert.deepEqual(await evaluate('app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))'), documents); assert.deepEqual(await evaluate("(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()"), { api: 0, raw: 0 });
    await capture?.("audio-input-readonly"); report.audioInputsReadOnly = { genuineCachedReadOnly: true, disabledPointer: true, forgedRibbonRefused: true, forgedOwnerRefused: true, startCommandRefused: true, zeroEnumerations: true, zeroPermissionAcquisitions: true, unchangedDocumentsAndVersions: true, zeroApiRaw: true };
    const message = "The genuine cached read-only mount refuses trusted disabled and forged recorder/owner/Start actions before device enumeration or microphone acquisition, opens no chooser, and preserves every document/version and zero API/raw counters."; report.checks.push(message); console.log("PASS " + message);
  } finally { await evaluate('(()=>{const t=audioInputReadOnlyTrace;if(t.devices.enumerateDevices===t.enumerateWrapper)t.devices.enumerateDevices=t.enumerate;if(t.host.acquire===t.acquireWrapper)t.host.acquire=t.acquire;delete globalThis.audioInputReadOnlyTrace})()'); }
}
