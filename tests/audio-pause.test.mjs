import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, AudioCapture, AudioRecorder, MAX_RECORDING_MS, MAX_BINARY_BYTES;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "audio-pause-tests-"));
  const entry = join(temporary, "capture.mjs"), recorder = join(temporary, "recorder.mjs");
  await build({ stdin: { contents: 'export * from "./client/audio-capture"; export * from "./client/binary";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ AudioCapture, MAX_RECORDING_MS, MAX_BINARY_BYTES } = await import(pathToFileURL(entry).href));
  const stubs = {
    "./contracts": "export const requestJson=()=>{throw Error('Unexpected transport')}",
    "./dom": "export const element=()=>({append(){}});export const reportError=error=>{throw error}",
    "./icons": "export const iconButton=(icon,label,callback)=>({disabled:false,dataset:{},classList:{toggle(){}},remove(){},callback})",
    "./ui": "export class Modal {}",
    "./views": "export class FileView {}",
    "./workspace": "export class MarkdownView {}",
  };
  await build({ entryPoints: [join(root, "client/audio-recorder.ts")], outfile: recorder, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "recorder-lifecycle-environment", setup(builder) {
    builder.onResolve({ filter: /^\.\/(?:contracts|dom|icons|ui|views|workspace)$/ }, args => args.importer.endsWith("audio-recorder.ts") ? { path: args.path, namespace: "audio-test-stub" } : null);
    builder.onLoad({ filter: /.*/, namespace: "audio-test-stub" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }] });
  ({ AudioRecorder } = await import(pathToFileURL(recorder).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

class Track extends EventTarget {
  readyState = "live"; stops = 0;
  stop() { this.readyState = "ended"; this.stops++; }
}
class Encoder extends EventTarget {
  state = "inactive"; mimeType = "audio/webm;codecs=opus";
  pauses = 0; resumes = 0; stops = 0; starts = 0;
  constructor(options = {}) { super(); this.options = options; }
  start() { this.starts++; this.state = "recording"; }
  pause() { this.pauses++; if (this.options.pauseError) throw Error("Pause failed"); }
  resume() { this.resumes++; if (this.options.resumeError) throw Error("Resume failed"); }
  acknowledge(kind) { if (this.state !== "inactive") this.state = kind === "pause" ? "paused" : "recording"; this.dispatchEvent(new Event(kind)); }
  chunk(bytes) { const event = new Event("dataavailable"); Object.defineProperty(event, "data", { value: new Blob([bytes]) }); this.dispatchEvent(event); }
  stop() {
    if (this.state === "inactive") return; // The standard makes redundant Stop a no-op.
    this.stops++; this.state = "inactive";
    if (this.options.noStop) return;
    queueMicrotask(() => { this.chunk(new Uint8Array([255, 0, 26])); this.dispatchEvent(new Event("stop")); });
  }
}
function fixture(t, options = {}) {
  const track = new Track(), encoder = new Encoder(options), stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let now = 1000, acquired = 0, created = 0, authorize = () => {};
  const host = { acquire: async () => { acquired++; return stream; }, supports: type => type.startsWith("audio/webm"), create: () => { created++; return encoder; }, now: () => now };
  const capture = new AudioCapture(() => {}, host, () => authorize()); t.after(() => capture.dispose());
  return { capture, host, track, encoder, stream, at(value) { now = value; }, authorize(callback) { authorize = callback; }, get acquired() { return acquired; }, get created() { return created; } };
}
async function pause(app) { const pending = app.capture.pause(); assert.equal(app.capture.state, "pausing"); app.encoder.acknowledge("pause"); await pending; }
async function resume(app) { const pending = app.capture.resume(); assert.equal(app.capture.state, "resuming"); app.encoder.acknowledge("resume"); await pending; }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("pause and resume retain one encoder and all owed chunks while the active timer excludes acknowledged pauses", async t => {
  const app = fixture(t); await app.capture.start(); app.encoder.chunk(new Uint8Array([1, 2]));
  app.at(2000); const pending = app.capture.pause(); app.at(2200);
  assert.equal(app.capture.elapsedMs, 1200); assert.equal(app.capture.state, "pausing");
  app.encoder.acknowledge("pause"); await pending;
  app.at(12200); assert.equal(app.capture.elapsedMs, 1200); assert.equal(app.capture.liveTracks, 1);
  app.encoder.chunk(new Uint8Array([3])); // Owed pre-pause data is not discarded.
  const resumed = app.capture.resume(); app.at(12500); assert.equal(app.capture.elapsedMs, 1200);
  app.encoder.acknowledge("resume"); await resumed;
  app.at(13500); assert.equal(app.capture.elapsedMs, 2200); app.encoder.chunk(new Uint8Array([4, 5]));
  await app.capture.stop(); app.at(20000);
  assert.equal(app.capture.elapsedMs, 2200); assert.equal(app.capture.durationMs, 2200);
  assert.equal(app.capture.state, "ready"); assert.equal(app.capture.liveTracks, 0);
  assert.equal(app.acquired, 1); assert.equal(app.created, 1); assert.equal(app.encoder.starts, 1);
  assert.equal(app.encoder.pauses, 1); assert.equal(app.encoder.resumes, 1); assert.equal(app.encoder.stops, 1);
  assert.equal(app.capture.data.type, app.encoder.mimeType);
  assert.deepEqual(new Uint8Array(await app.capture.data.arrayBuffer()), new Uint8Array([1, 2, 3, 4, 5, 255, 0, 26]));
});

test("repeated pending presses share acknowledgement promises and opposite or stale actions cannot advance capture", async t => {
  const app = fixture(t); await app.capture.start();
  const paused = app.capture.pause(); assert.equal(app.capture.pause(), paused); assert.equal(app.encoder.pauses, 1);
  await assert.rejects(app.capture.resume(), /no paused/); app.encoder.acknowledge("resume"); assert.equal(app.capture.state, "pausing");
  app.encoder.acknowledge("pause"); await paused; await assert.rejects(app.capture.pause(), /no active/);
  const resumed = app.capture.resume(); assert.equal(app.capture.resume(), resumed); assert.equal(app.encoder.resumes, 1);
  await assert.rejects(app.capture.pause(), /no active/); app.encoder.acknowledge("pause"); assert.equal(app.capture.state, "resuming");
  app.encoder.acknowledge("resume"); await resumed;
  await app.capture.stop(); await assert.rejects(app.capture.resume(), /no paused/); await assert.rejects(app.capture.pause(), /no active/);
});

for (const state of ["pausing", "paused", "resuming"]) {
  test(`Stop supersedes ${state} without waiting for an acknowledgement or losing final data`, async t => {
    const app = fixture(t); await app.capture.start(); app.at(2500); app.encoder.chunk(new Uint8Array([7]));
    let transition;
    if (state === "pausing") transition = app.capture.pause();
    else { await pause(app); if (state === "resuming") transition = app.capture.resume(); }
    assert.equal(app.capture.state, state); assert.equal(app.capture.canStop, true);
    const stopped = app.capture.stop(); assert.equal(app.capture.stop(), stopped); await transition; await stopped;
    app.encoder.acknowledge("pause"); app.encoder.acknowledge("resume");
    assert.equal(app.capture.state, "ready"); assert.equal(app.capture.canStop, false); assert.equal(app.track.stops, 1);
    assert.deepEqual(new Uint8Array(await app.capture.data.arrayBuffer()), new Uint8Array([7, 255, 0, 26]));
  });
}

for (const state of ["pausing", "paused", "resuming"]) {
  test(`an ended microphone while ${state} finalizes the same clip and releases resources`, async t => {
    const app = fixture(t); await app.capture.start();
    let transition;
    if (state === "pausing") transition = app.capture.pause();
    else { await pause(app); if (state === "resuming") transition = app.capture.resume(); }
    app.track.readyState = "ended"; app.track.dispatchEvent(new Event("ended")); await transition; await flush();
    assert.equal(app.capture.state, "ready"); assert.equal(app.capture.liveTracks, 0); assert.equal(app.encoder.stops, 1);
  });
}

test("the fixed ten-minute wall-clock lease still stops a paused recorder and is not renewed by resume", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture(t); await app.capture.start(); app.at(2000); await pause(app);
  t.mock.timers.tick(MAX_RECORDING_MS - 1); assert.equal(app.capture.state, "paused");
  await resume(app); await pause(app); t.mock.timers.tick(1); await flush();
  assert.equal(app.capture.state, "ready"); assert.equal(app.capture.liveTracks, 0); assert.equal(app.encoder.stops, 1);
  assert.equal(app.capture.durationMs, 1000);
});

for (const kind of ["pause", "resume"]) {
  test(`a missing ${kind} acknowledgement times out with released tracks and no resurrectable data`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const app = fixture(t); await app.capture.start(); if (kind === "resume") await pause(app);
    const pending = app.capture[kind](); t.mock.timers.tick(8000); await pending;
    assert.equal(app.capture.state, "error"); assert.match(app.capture.message, new RegExp("did not " + kind)); assert.equal(app.capture.liveTracks, 0);
    app.encoder.acknowledge(kind); app.encoder.chunk(new Uint8Array([99])); await flush();
    assert.equal(app.capture.state, "error"); assert.equal(app.capture.data, null); assert.equal(app.capture.bytes, 0);
  });
  test(`a thrown ${kind} failure releases the microphone and settles its pending operation`, async t => {
    const app = fixture(t, { [kind + "Error"]: true }); await app.capture.start(); if (kind === "resume") await pause(app);
    await app.capture[kind](); assert.equal(app.capture.state, "error"); assert.match(app.capture.message, /failed/); assert.equal(app.capture.liveTracks, 0);
  });
}

test("Stop clears the pending pause deadline instead of later turning a valid ready clip into an error", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture(t); await app.capture.start(); const pending = app.capture.pause(); await app.capture.stop(); await pending;
  const data = app.capture.data; t.mock.timers.tick(MAX_RECORDING_MS + 9000); await flush();
  assert.equal(app.capture.state, "ready"); assert.equal(app.capture.data, data);
});

test("an already-inactive encoder retains owed final data and Stop acknowledgement in every live phase", async t => {
  for (const state of ["recording", "pausing", "paused", "resuming"]) {
    const app = fixture(t); await app.capture.start(); app.encoder.chunk(new Uint8Array([42]));
    let transition;
    if (state === "pausing") transition = app.capture.pause();
    else if (state === "paused" || state === "resuming") { await pause(app); if (state === "resuming") transition = app.capture.resume(); }
    app.encoder.state = "inactive"; // Native recorder inactivates before its asynchronous final events.
    const stopped = app.capture.stop(); await transition;
    assert.equal(app.capture.state, "stopping"); assert.equal(app.encoder.stops, 0, "inactive raw Stop must not restart finalization");
    app.encoder.chunk(new Uint8Array([7, 0, 255])); app.encoder.dispatchEvent(new Event("stop")); await stopped;
    assert.equal(app.capture.state, "ready", state); assert.equal(app.capture.liveTracks, 0); assert.equal(app.track.stops, 1);
    assert.deepEqual(new Uint8Array(await app.capture.data.arrayBuffer()), new Uint8Array([42, 7, 0, 255]));
  }
});

test("an inactive encoder with missing final events still expires its finishing deadline and ignores late data", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const state of ["recording", "pausing", "paused", "resuming"]) {
    const app = fixture(t); await app.capture.start();
    let transition;
    if (state === "pausing") transition = app.capture.pause();
    else if (state === "paused" || state === "resuming") { await pause(app); if (state === "resuming") transition = app.capture.resume(); }
    app.encoder.state = "inactive"; const stopped = app.capture.stop(); await transition;
    t.mock.timers.tick(8000); await stopped;
    assert.equal(app.capture.state, "error", state); assert.match(app.capture.message, /did not finish/); assert.equal(app.capture.liveTracks, 0);
    app.encoder.chunk(new Uint8Array([42])); app.encoder.dispatchEvent(new Event("stop"));
    assert.equal(app.capture.state, "error"); assert.equal(app.capture.data, null);
  }
});

for (const state of ["pausing", "paused", "resuming"]) {
  test(`discard during ${state} settles pending work and ignores late pause/resume/chunk/stop callbacks`, async t => {
    const app = fixture(t); await app.capture.start();
    let transition;
    if (state === "pausing") transition = app.capture.pause();
    else { await pause(app); if (state === "resuming") transition = app.capture.resume(); }
    app.capture.cancel(); await transition; app.encoder.acknowledge("pause"); app.encoder.acknowledge("resume"); app.encoder.chunk(new Uint8Array([1])); await flush();
    assert.equal(app.capture.state, "idle"); assert.equal(app.capture.liveTracks, 0); assert.equal(app.capture.data, null); assert.equal(app.capture.bytes, 0); assert.equal(app.capture.elapsedMs, 0);
  });
}

test("data already owed during pause remains subject to the same 16 MiB cap", async t => {
  const app = fixture(t); await app.capture.start(); await pause(app); app.encoder.chunk(new Uint8Array(MAX_BINARY_BYTES + 1));
  assert.equal(app.capture.state, "error"); assert.match(app.capture.message, /16 MiB/); assert.equal(app.capture.liveTracks, 0);
});

test("capture authorization refuses permission before acquisition and rechecks a delayed grant", async t => {
  const app = fixture(t); let allowed = false;
  app.authorize(() => { if (!allowed) throw Error("Read-only owner"); });
  await assert.rejects(app.capture.start(), /Read-only/); assert.equal(app.acquired, 0); assert.equal(app.capture.state, "idle");
  allowed = true; let grant; app.host.acquire = () => new Promise(resolve => grant = resolve);
  const pending = app.capture.start(); allowed = false; grant(app.stream); await pending;
  assert.equal(app.capture.state, "error"); assert.equal(app.created, 0); assert.equal(app.track.stops, 1); assert.equal(app.capture.liveTracks, 0);
});

test("pause and resume recheck capture authority before invoking the encoder", async t => {
  const app = fixture(t); await app.capture.start(); let allowed = false;
  app.authorize(() => { if (!allowed) throw Error("Owner changed"); });
  await assert.rejects(app.capture.pause(), /Owner changed/); assert.equal(app.encoder.pauses, 0); assert.equal(app.capture.state, "recording");
  allowed = true; await pause(app); allowed = false;
  await assert.rejects(app.capture.resume(), /Owner changed/); assert.equal(app.encoder.resumes, 0); assert.equal(app.capture.state, "paused");
  await app.capture.stop(); assert.equal(app.capture.state, "ready", "Stop must remain available to release the old lease");
});

function recorderEnvironment(t) {
  const previous = globalThis.window, window = new EventTarget(); window.confirm = () => false; globalThis.window = window;
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const commands = [], app = { vault: { rootPath: "vault", readOnly: false }, changingVault: false, editorChanged() {}, workspace: { registerExtensions: () => () => {} }, commands: { install(items) { commands.push(...items); return () => {}; } }, registerLeaveGuard: () => () => {} };
  const recorder = new AudioRecorder(app); let activate;
  const core = { register(id, factory) { assert.equal(id, "audio-recorder"); activate = factory; }, installViews: async () => async () => {} }; app.core = core;
  recorder.register(core);
  return { recorder, app, window, commands, activate: () => activate() };
}

for (const state of ["pausing", "paused", "resuming"]) {
  test(`${state} audio is unsaved for close, discard, leave and actual beforeunload listeners`, async t => {
    const env = recorderEnvironment(t); await env.activate(); let cancelled = 0;
    env.recorder.capture = { state, cancel() { cancelled++; }, dispose() {} };
    assert.equal(env.recorder.hasUnsavedAudio, true);
    assert.equal(env.recorder.close(), false); env.recorder.discard(); assert.throws(() => env.recorder.prepareLeave(), /retained/); assert.equal(cancelled, 0);
    const event = new Event("beforeunload", { cancelable: true }); env.window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    env.window.confirm = () => true; env.recorder.prepareLeave(); assert.equal(cancelled, 1);
  });
}

test("read-only recorder open, start command, capture and forged ribbon handlers never request a microphone", async t => {
  const env = recorderEnvironment(t); env.app.vault.readOnly = true; await env.activate();
  assert.equal(env.recorder.ribbon.disabled, true); env.recorder.ribbon.disabled = false; env.recorder.ribbon.callback();
  assert.throws(() => env.recorder.open(), /read-only/);
  assert.equal(env.commands.find(item => item.id === "audio-recorder:start").checkCallback(false), false);
  await assert.rejects(env.recorder.capture.start(), /read-only/); assert.equal(env.recorder.capture.state, "idle"); assert.equal(env.recorder.capture.liveTracks, 0);
  assert.equal(env.recorder.modal, null);
});

test("pause/resume command checks follow acknowledged states and Stop stays available during every transition", async t => {
  const env = recorderEnvironment(t); await env.activate();
  const check = kind => env.commands.find(item => item.id === "audio-recorder:" + kind).checkCallback(true);
  for (const state of ["recording", "pausing", "paused", "resuming", "stopping", "ready"]) {
    env.recorder.capture.state = state;
    // Keep the real canStop getter's actual encoder ownership requirement.
    env.recorder.capture.recorder = state === "ready" ? null : {};
    assert.equal(check("pause"), state === "recording"); assert.equal(check("resume"), state === "paused");
    assert.equal(check("stop"), ["recording", "pausing", "paused", "resuming"].includes(state));
  }
});
