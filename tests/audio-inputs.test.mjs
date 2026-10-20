import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, AudioCapture, AudioInputs, audioInputConstraints, AUDIO_INPUT_REFRESH_MS, MAX_AUDIO_INPUTS;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "audio-input-tests-"));
  const output = join(temporary, "inputs.mjs");
  await build({ stdin: { contents: 'export * from "./client/audio-capture"; export * from "./client/audio-inputs";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ AudioCapture, AudioInputs, audioInputConstraints, AUDIO_INPUT_REFRESH_MS, MAX_AUDIO_INPUTS } = await import(pathToFileURL(output).href));
});
after(async () => { if (temporary) await rm(temporary, { recursive: true }); });
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
const microphone = (deviceId, label = "") => ({ deviceId, label, kind: "audioinput", groupId: "never expose group" });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Track extends EventTarget {
  readyState = "live"; stops = 0;
  constructor(id) { super(); this.id = id; }
  getSettings() { return { deviceId: this.id }; }
  stop() { this.readyState = "ended"; this.stops++; }
}
class Encoder extends EventTarget {
  static all = [];
  static isTypeSupported(type) { return type.startsWith("audio/webm"); }
  state = "inactive"; starts = 0; pauses = 0; resumes = 0;
  constructor(stream, options) { super(); this.stream = stream; this.mimeType = options.mimeType; Encoder.all.push(this); }
  start() { this.starts++; this.state = "recording"; }
  pause() { this.pauses++; this.state = "paused"; queueMicrotask(() => this.dispatchEvent(new Event("pause"))); }
  resume() { this.resumes++; this.state = "recording"; queueMicrotask(() => this.dispatchEvent(new Event("resume"))); }
  stop() { if (this.state === "inactive") return; this.state = "inactive"; queueMicrotask(() => { const data = new Event("dataavailable"); Object.defineProperty(data, "data", { value: new Blob([new Uint8Array([1, 2, 255])]) }); this.dispatchEvent(data); this.dispatchEvent(new Event("stop")); }); }
}
class Devices extends EventTarget {
  enumerations = 0; requests = []; streams = []; listeners = 0;
  items = [microphone("input-a", "Desk microphone"), microphone("input-b", "Headset")];
  getSupportedConstraints() { return { deviceId: true }; }
  async enumerateDevices() { this.enumerations++; return this.items; }
  async getUserMedia(constraints) {
    this.requests.push(constraints);
    const id = constraints.audio?.deviceId?.exact ?? "input-a";
    if (!this.items.some(device => device.kind === "audioinput" && device.deviceId === id)) throw new DOMException("Unavailable", "OverconstrainedError");
    const track = new Track(id), stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    this.streams.push(stream); return stream;
  }
  addEventListener(name, callback, options) { if (name === "devicechange") this.listeners++; super.addEventListener(name, callback, options); }
  removeEventListener(name, callback, options) { if (name === "devicechange") this.listeners--; super.removeEventListener(name, callback, options); }
  change() { this.dispatchEvent(new Event("devicechange")); }
}
function fixture(t) {
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), recorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder"), devices = new Devices();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: devices } });
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Encoder }); Encoder.all = [];
  let allowed = true, locked = false, changes = 0;
  const authorize = () => { if (!allowed) throw Error("Read-only or changed dialog/vault"); };
  const inputs = new AudioInputs(() => changes++, undefined, authorize, () => locked);
  const capture = new AudioCapture(() => {}, undefined, authorize, () => inputs.selectionForCapture());
  t.after(() => { capture.dispose(); inputs.dispose(); if (navigator) Object.defineProperty(globalThis, "navigator", navigator); else delete globalThis.navigator; if (recorder) Object.defineProperty(globalThis, "MediaRecorder", recorder); else delete globalThis.MediaRecorder; });
  return { devices, inputs, capture, authorize(value) { allowed = value; }, lock(value) { locked = value; }, get changes() { return changes; } };
}

test("creating and disposing a chooser never enumerates, requests permission, or retains device IDs", t => {
  const app = fixture(t); assert.equal(app.devices.enumerations, 0); assert.deepEqual(app.devices.requests, []); assert.equal(app.devices.listeners, 1);
  assert.equal(app.inputs.selected, ""); assert.equal(app.inputs.canStart, true);
  app.inputs.dispose(); assert.equal(app.devices.listeners, 0); assert.deepEqual(app.inputs.choices, []); assert.equal(app.inputs.selected, "");
  assert.throws(() => app.inputs.refresh(), /no longer active/); assert.throws(() => app.inputs.select(""), /no longer active/);
});
test("System default opens only audio and only on Start without requiring enumeration", async t => {
  const app = fixture(t); await app.capture.start(); assert.deepEqual(app.devices.requests, [{ audio: true, video: false }]); assert.equal(app.devices.enumerations, 0);
  assert.equal(app.capture.state, "recording"); await app.capture.stop(); assert.equal(app.capture.liveTracks, 0);
  assert.deepEqual([...new Uint8Array(await app.capture.data.arrayBuffer())], [1, 2, 255]);
  assert.deepEqual(audioInputConstraints("input-b"), { audio: { deviceId: { exact: "input-b" } }, video: false });
});
test("Refresh exposes only deduplicated physical audio inputs and labels already supplied by the browser", async t => {
  const app = fixture(t); app.devices.items = [microphone("default", "Default alias"), microphone("communications", "Communications alias"), microphone("input-a", "  Desk microphone  "), microphone("input-a", "Duplicate"), { deviceId: "camera-private", kind: "videoinput", label: "Private camera" }, { deviceId: "speaker-private", kind: "audiooutput", label: "Private speaker" }, microphone("input-b"), microphone("")];
  await app.inputs.refresh(); assert.deepEqual(app.inputs.choices, [{ id: "input-a", label: "Desk microphone" }, { id: "input-b", label: "Microphone 2 (name unavailable)" }]);
  assert.equal(app.devices.requests.length, 0); assert.equal(app.devices.enumerations, 1); assert.doesNotMatch(JSON.stringify(app.inputs.choices), /camera|speaker|never expose group/);
});
test("enumeration work and displayed device labels are bounded", async t => {
  const app = fixture(t); app.devices.items = [microphone("x".repeat(1025), "Ignored"), ...Array.from({ length: 1000 }, (_, index) => microphone("id-" + index, "Long ".repeat(100)))];
  await app.inputs.refresh(); assert.equal(app.inputs.choices.length, MAX_AUDIO_INPUTS); assert.equal(app.inputs.choices[0].label.length, 160); assert.match(app.inputs.message, /limited to 64/);
});
test("selecting a listed device uses an exact constraint and the same acquired device through Pause and Resume", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); await app.capture.start();
  assert.deepEqual(app.devices.requests, [{ audio: { deviceId: { exact: "input-b" } }, video: false }]); assert.equal(app.capture.state, "recording");
  const encoder = Encoder.all[0]; await app.capture.pause(); await app.capture.resume(); await app.capture.stop();
  assert.equal(Encoder.all.length, 1); assert.equal(encoder.stream.getAudioTracks()[0].getSettings().deviceId, "input-b"); assert.equal(app.devices.requests.length, 1); assert.equal(app.capture.state, "ready");
});
for (const name of ["NotFoundError", "OverconstrainedError", "NotAllowedError", "NotReadableError"]) {
  test(`${name} for an explicitly selected input never retries System default`, async t => {
    const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b");
    app.devices.getUserMedia = async constraints => { app.devices.requests.push(constraints); throw new DOMException("Unavailable", name); };
    await app.capture.start(); assert.equal(app.capture.state, "error"); assert.equal(app.devices.requests.length, 1); assert.deepEqual(app.devices.requests[0].audio, { deviceId: { exact: "input-b" } }); assert.equal(Encoder.all.length, 0); assert.equal(app.capture.liveTracks, 0);
  });
}
test("a host without required deviceId support refuses explicit capture before permission acquisition", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); app.devices.getSupportedConstraints = () => ({});
  await app.capture.start(); assert.equal(app.capture.state, "error"); assert.match(app.capture.message, /cannot require a specific/); assert.equal(app.devices.requests.length, 0);
  app.inputs.select(""); await app.capture.start(); assert.equal(app.capture.state, "recording"); assert.deepEqual(app.devices.requests, [{ audio: true, video: false }]);
});
for (const reported of ["input-a", undefined]) {
  test(`an unexpected acquired device identity (${reported}) releases all tracks without creating an encoder`, async t => {
    const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b");
    const track = new Track(reported); app.devices.getUserMedia = async constraints => { app.devices.requests.push(constraints); return { getTracks: () => [track], getAudioTracks: () => [track] }; };
    await app.capture.start(); assert.equal(app.capture.state, "error"); assert.match(app.capture.message, /could not verify/); assert.equal(track.stops, 1); assert.equal(Encoder.all.length, 0);
  });
}
test("all device-list and selection handlers authorize before the browser boundary", async t => {
  const app = fixture(t); app.authorize(false);
  assert.throws(() => app.inputs.refresh(), /Read-only/); assert.throws(() => app.inputs.select(""), /Read-only/); assert.throws(() => app.inputs.selectionForCapture(), /Read-only/); await assert.rejects(app.capture.start(), /Read-only/);
  assert.equal(app.devices.enumerations, 0); assert.equal(app.devices.requests.length, 0); assert.equal(app.capture.state, "idle");
});
test("requesting, recording, transitions, finalization and save locks reject forged selection and Refresh handlers", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b");
  for (const phase of ["requesting", "recording", "pausing", "paused", "resuming", "stopping", "saving", "ready"]) {
    app.lock(true); assert.throws(() => app.inputs.refresh(), /Stop and save/); assert.throws(() => app.inputs.select(""), /Stop and save/); assert.throws(() => app.inputs.selectionForCapture(), /Stop and save/, phase);
  }
  assert.equal(app.devices.enumerations, 1); assert.equal(app.devices.requests.length, 0); assert.equal(app.inputs.selected, "input-b");
});
test("duplicate refreshes share one request and selection/Start stay disabled while the browser is pending", async t => {
  const app = fixture(t), list = deferred(); app.devices.enumerateDevices = () => { app.devices.enumerations++; return list.promise; };
  const first = app.inputs.refresh(); assert.equal(app.inputs.refresh(), first); assert.equal(app.devices.enumerations, 1); assert.equal(app.inputs.canStart, false); assert.equal(app.inputs.refreshing, true);
  assert.throws(() => app.inputs.select(""), /Wait/); await assert.rejects(app.capture.start(), /Refresh/); assert.equal(app.devices.requests.length, 0);
  list.resolve(app.devices.items); await first; assert.equal(app.inputs.canStart, true); assert.equal(app.inputs.refreshing, false);
});
test("a delayed enumeration cannot expose device information after its dialog/vault loses authority", async t => {
  const app = fixture(t), list = deferred(); app.devices.enumerateDevices = () => list.promise;
  const first = app.inputs.refresh(); app.authorize(false); list.resolve(app.devices.items); await first;
  assert.deepEqual(app.inputs.choices, []); assert.equal(app.inputs.state, "idle"); assert.doesNotMatch(app.inputs.message, /Desk|Headset/); assert.equal(app.devices.requests.length, 0);
});
test("device-list requests expire and a fresh explicit refresh succeeds while the old browser request never settles", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const app = fixture(t), list = deferred();
  app.devices.enumerateDevices = () => { app.devices.enumerations++; return list.promise; };
  const first = app.inputs.refresh(); t.mock.timers.tick(AUDIO_INPUT_REFRESH_MS); await first;
  assert.equal(app.inputs.state, "error"); assert.equal(app.inputs.refreshing, false); assert.equal(app.devices.enumerations, 1);
  app.devices.enumerateDevices = async () => { app.devices.enumerations++; return [microphone("fresh", "Fresh microphone")]; };
  const second = app.inputs.refresh(); assert.notEqual(second, first); await second; assert.equal(app.devices.enumerations, 2); assert.deepEqual(app.inputs.choices, [{ id: "fresh", label: "Fresh microphone" }]);
  list.resolve(app.devices.items); await flush(); assert.deepEqual(app.inputs.choices, [{ id: "fresh", label: "Fresh microphone" }]); assert.equal(app.inputs.refreshing, false); assert.equal(app.inputs.state, "ready");
});
test("a selected device disappearing during Refresh stays selected and invalid instead of falling back", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); app.devices.items = [microphone("input-a", "Desk")]; await app.inputs.refresh();
  assert.equal(app.inputs.selected, "input-b"); assert.equal(app.inputs.valid, false); assert.equal(app.inputs.canStart, false); await assert.rejects(app.capture.start(), /Refresh/); assert.equal(app.devices.requests.length, 0);
  app.inputs.select("input-a"); await app.capture.start(); assert.deepEqual(app.devices.requests[0].audio, { deviceId: { exact: "input-a" } });
});
test("devicechange invalidates a pending list and allows a fresh refresh without waiting for a stuck browser request", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); const list = deferred(); app.devices.enumerateDevices = () => { app.devices.enumerations++; return list.promise; };
  const pending = app.inputs.refresh(); app.devices.change(); await pending; assert.deepEqual(app.inputs.choices, []); assert.equal(app.inputs.selected, "input-b"); assert.equal(app.inputs.canStart, false); assert.equal(app.devices.enumerations, 2);
  const secondList = deferred(); app.devices.enumerateDevices = () => { app.devices.enumerations++; return secondList.promise; };
  const second = app.inputs.refresh(); assert.notEqual(second, pending); list.resolve(app.devices.items); await flush(); assert.equal(app.inputs.refreshing, true, "old finally cannot clear the newer request");
  secondList.resolve([microphone("input-a", "Fresh desk")]); await second; assert.deepEqual(app.inputs.choices, [{ id: "input-a", label: "Fresh desk" }]); assert.equal(app.inputs.valid, false);
  app.inputs.select(""); await app.capture.start(); assert.deepEqual(app.devices.requests, [{ audio: true, video: false }]);
});
test("devicechange during a microphone permission request releases the late grant rather than retargeting capture", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); const permission = deferred(), track = new Track("input-b");
  app.devices.getUserMedia = constraints => { app.devices.requests.push(constraints); return permission.promise; };
  const pending = app.capture.start(); app.devices.change(); permission.resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); await pending;
  assert.equal(app.capture.state, "error"); assert.match(app.capture.message, /inputs changed/); assert.equal(track.stops, 1); assert.equal(Encoder.all.length, 0); assert.equal(app.devices.requests.length, 1);
});
test("a device-list change during a live or paused clip never replaces its stream or encoder", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); await app.capture.start(); const encoder = Encoder.all[0]; await app.capture.pause(); app.devices.change();
  assert.equal(app.capture.state, "paused"); assert.equal(app.capture.liveTracks, 1); assert.equal(app.devices.enumerations, 1); await app.capture.resume(); await app.capture.stop();
  assert.equal(Encoder.all.length, 1); assert.equal(Encoder.all[0], encoder); assert.equal(app.devices.requests.length, 1); assert.deepEqual([...new Uint8Array(await app.capture.data.arrayBuffer())], [1, 2, 255]);
});
test("disposal settles pending enumeration, detaches devicechange, clears IDs, and ignores late lists", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); const list = deferred(); app.devices.enumerateDevices = () => list.promise;
  const pending = app.inputs.refresh(); app.inputs.dispose(); await pending; const changes = app.changes; list.resolve(app.devices.items); await flush(); app.devices.change();
  assert.equal(app.changes, changes); assert.equal(app.inputs.state, "disposed"); assert.equal(app.inputs.selected, ""); assert.deepEqual(app.inputs.choices, []); assert.equal(app.devices.listeners, 0);
});
test("disposing a dialog during permission acquisition stops its late stream and cannot revive replacement controls", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); const permission = deferred(), track = new Track("input-b"); app.devices.getUserMedia = () => permission.promise;
  const pending = app.capture.start(); app.inputs.dispose(); app.capture.cancel(); permission.resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); await pending;
  assert.equal(app.capture.state, "idle"); assert.equal(track.stops, 1); assert.equal(Encoder.all.length, 0); assert.equal(app.capture.data, null);
});
test("authority lost during a microphone request releases the grant before recording", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); const permission = deferred(), track = new Track("input-b"); app.devices.getUserMedia = () => permission.promise;
  const pending = app.capture.start(); app.authorize(false); permission.resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); await pending;
  assert.equal(app.capture.state, "error"); assert.equal(track.stops, 1); assert.equal(Encoder.all.length, 0);
});
test("a rejected or synchronous enumeration fails without opening a microphone and keeps a selected ID invalid", async t => {
  const app = fixture(t); await app.inputs.refresh(); app.inputs.select("input-b"); app.devices.enumerateDevices = () => { throw new DOMException("Listing unavailable", "NotAllowedError"); };
  await app.inputs.refresh(); assert.equal(app.inputs.state, "error"); assert.equal(app.inputs.selected, "input-b"); assert.equal(app.inputs.valid, false); assert.deepEqual(app.inputs.choices, []); assert.equal(app.devices.requests.length, 0);
  app.inputs.select(""); assert.equal(app.inputs.canStart, true);
});
