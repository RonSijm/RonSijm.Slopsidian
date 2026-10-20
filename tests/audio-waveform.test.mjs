import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, WaveformJob, AudioFileView, AudioRecorder, pcmWavLayout, pcmWavWaveform, decodedRecordingWaveform, WAVEFORM_BINS, WAVEFORM_SAMPLE_RATE;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "audio-waveform-tests-"));
  const entry = join(temporary, "waveform.mjs");
  await build({ entryPoints: [join(root, "client/audio-waveform.ts")], outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ WaveformJob, pcmWavLayout, pcmWavWaveform, decodedRecordingWaveform, WAVEFORM_BINS, WAVEFORM_SAMPLE_RATE } = await import(pathToFileURL(entry).href));
  const recorder = join(temporary, "recorder.mjs");
  const stubs = {
    "./contracts": "export const requestJson=(...args)=>globalThis.audioWaveformFileTransport(...args)",
    "./dom": "export const element=()=>({append(){}});export const reportError=error=>{throw error}",
    "./icons": "export const iconButton=()=>document.createElement('button')",
    "./ui": "export class Modal {}",
    "./views": "export class FileView {constructor(leaf){this.app=leaf.app;this.file=leaf.file;this.bodyEl=document.createElement('div');this.bodyEl.root=true}registerEvent(){}async onClose(){}}",
    "./workspace": "export class MarkdownView {}",
  };
  await build({ entryPoints: [join(root, "client/audio-recorder.ts")], outfile: recorder, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "audio-waveform-file-environment", setup(builder) {
    builder.onLoad({ filter: /audio-recorder\.ts$/ }, async args => ({ contents: (await readFile(args.path, "utf8")).replace("class AudioFileView extends", "export class AudioFileView extends"), loader: "ts" }));
    builder.onResolve({ filter: /^\.\/(?:contracts|dom|icons|ui|views|workspace)$/ }, args => args.importer.endsWith("audio-recorder.ts") ? { path: args.path, namespace: "audio-file-test-stub" } : null);
    builder.onLoad({ filter: /.*/, namespace: "audio-file-test-stub" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }] });
  ({ AudioFileView, AudioRecorder } = await import(pathToFileURL(recorder).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const arrayBuffer = bytes => Uint8Array.from(bytes).buffer;
function wav({ bits = 16, channels = 1, rate = 8000, samples = [0, -.5, .25, 1], format = 1, dataBytes } = {}) {
  const sampleBytes = bits / 8, length = dataBytes ?? samples.length * sampleBytes, padding = length % 2;
  const bytes = new ArrayBuffer(44 + length + padding), view = new DataView(bytes);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, format, true); view.setUint16(22, channels, true); view.setUint32(24, rate, true); view.setUint32(28, rate * channels * sampleBytes, true);
  view.setUint16(32, channels * sampleBytes, true); view.setUint16(34, bits, true); text(36, "data"); view.setUint32(40, length, true);
  if (dataBytes === undefined) for (let i = 0; i < samples.length; i++) {
    const at = 44 + i * sampleBytes, sample = samples[i];
    if (format === 3) view.setFloat32(at, sample, true);
    else if (bits === 8) view.setUint8(at, Math.min(255, Math.max(0, Math.round(sample * 128 + 128))));
    else if (bits === 16) view.setInt16(at, Math.min(32767, Math.max(-32768, Math.round(sample * 32768))), true);
    else if (bits === 24) { const value = Math.min(8388607, Math.max(-8388608, Math.round(sample * 8388608))); view.setUint8(at, value & 255); view.setUint8(at + 1, value >> 8 & 255); view.setUint8(at + 2, value >> 16 & 255); }
    else view.setInt32(at, Math.min(2147483647, Math.max(-2147483648, Math.round(sample * 2147483648))), true);
  }
  return bytes;
}
function audio({ frames = 800, channels = 1, rate = 8000, amplitude = .5 } = {}) {
  const samples = Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) => (frame % 2 ? -1 : 1) * amplitude / (channel + 1)));
  return { length: frames, numberOfChannels: channels, sampleRate: rate, getChannelData: channel => samples[channel] };
}
function fixture(t, { decode = async () => audio(), yieldWork = async () => {}, changed = () => {} } = {}) {
  let calls = 0, reads = 0;
  const job = new WaveformJob(changed, { decode: async data => { calls++; reads = data.byteLength; return await decode(data); }, yieldWork });
  t.after(() => job.dispose());
  return { job, source(blob = new Blob([arrayBuffer([4, 5, 6])]), duration = 1000, owns = () => true) { job.setSource({ blob, recordingDurationMs: duration, owns }); return blob; }, get calls() { return calls; }, get reads() { return reads; } };
}

for (const [bits, format] of [[8, 1], [16, 1], [24, 1], [32, 1], [32, 3]]) {
  test(`${bits}-bit ${format === 3 ? "float" : "PCM"} WAV peaks are computed from actual signed samples in both channels`, async () => {
    const samples = [0, -.75, .25, 0, -.5, .125, 1, -.25];
    const data = await pcmWavWaveform(wav({ bits, format, channels: 2, samples }));
    assert.equal(data.peaks.length, WAVEFORM_BINS); assert.equal(data.channels, 2); assert.equal(data.frames, 4); assert.equal(data.method, "wav");
    assert.equal(data.duration, 4 / 8000); assert.equal(data.peaks[0], .75); assert.equal(data.peaks[64], .25); assert.equal(data.peaks[128], .5);
    const tolerance = bits === 8 ? 1 / 128 : 1 / 2 ** (bits - 1);
    assert.ok(Math.abs(data.peaks[192] - 1) <= tolerance); assert.equal(data.peaks.filter(value => value > 0).length, 4);
  });
}

test("nonfinite float samples are silence, finite over-range values clamp, and odd PCM data uses the RIFF pad byte", async () => {
  const result = await pcmWavWaveform(wav({ bits: 32, format: 3, samples: [NaN, Infinity, -Infinity, 2, -2, 0] }));
  assert.equal(result.peaks.filter(value => value !== 0).length, 2); assert.equal(Math.max(...result.peaks), 1);
  const odd = wav({ bits: 8, samples: [-.5, 0, .25] }); assert.equal(pcmWavLayout(odd).dataBytes, 3); assert.equal((await pcmWavWaveform(odd)).frames, 3);
});

test("real cached-tone fixture uses strict direct PCM and bounded peaks without any decoder", async t => {
  const bytes = await readFile(join(root, "Example/90 Attachments/Synthetic tone.wav")), f = fixture(t, { decode: async () => { throw Error("Untrusted file reached decoder"); } });
  const blob = new Blob([bytes], { type: "audio/wav" }); f.job.setSource({ blob, owns: () => true });
  assert.equal(f.job.state, "idle"); assert.equal(f.calls, 0); await f.job.request();
  assert.equal(f.job.state, "ready"); assert.equal(f.calls, 0); assert.equal(f.job.result.method, "wav"); assert.equal(f.job.result.peaks.length, 256);
  assert.equal(Math.max(...f.job.result.peaks), 2000 / 32768); assert.ok(f.job.result.duration > 0); assert.ok(f.job.result.duration <= 600);
});

test("malformed WAV lengths, frame alignment, channel counts and codec declarations refuse before sample reads", () => {
  const mutations = [
    data => data.setUint32(4, 0, true), data => data.setUint32(40, 0xffffffff, true), data => data.setUint32(40, 7, true),
    data => data.setUint16(20, 2, true), data => data.setUint16(22, 0, true), data => data.setUint16(22, 33, true),
    data => data.setUint32(24, 0, true), data => data.setUint32(24, 384001, true), data => data.setUint32(28, 1, true),
    data => data.setUint16(32, 0, true), data => data.setUint16(34, 12, true), data => data.setUint32(16, 0xffffffff, true),
    data => data.setUint32(16, 8, true), data => data.setUint8(8, 0), data => data.setUint8(36, 0),
  ];
  for (const mutate of mutations) { const bytes = wav(); mutate(new DataView(bytes)); assert.throws(() => pcmWavLayout(bytes), /WAV|waveform|PCM/); }
  assert.throws(() => pcmWavLayout(new ArrayBuffer(0)), /WAV/);
  assert.throws(() => pcmWavLayout(new ArrayBuffer(16 * 1024 * 1024 + 1)), /WAV/);
  assert.throws(() => pcmWavLayout(wav({ rate: 1, bits: 8, samples: Array(601).fill(0) })), /10 minutes/);
});

test("duplicate fmt/data chunks and excessive zero-sized chunks cannot shift a parser into another byte range", () => {
  const original = new Uint8Array(wav());
  for (const addition of [original.slice(12, 36), original.slice(36)]) {
    const combined = new Uint8Array(original.length + addition.length); combined.set(original); combined.set(addition, original.length);
    new DataView(combined.buffer).setUint32(4, combined.length - 8, true); assert.throws(() => pcmWavLayout(combined.buffer), /WAV|data chunks/);
  }
  const chunks = new Uint8Array(12 + 1025 * 8 + original.length - 12); chunks.set(original.slice(0, 12)); chunks.set(original.slice(12), 12 + 1025 * 8);
  new DataView(chunks.buffer).setUint32(4, chunks.length - 8, true); assert.throws(() => pcmWavLayout(chunks.buffer), /chunk layout/);
});

test("direct PCM work yields between bounded batches and refuses an ownership change", async () => {
  let yields = 0, owns = true;
  const bytes = wav({ bits: 8, dataBytes: 50000 });
  const result = await pcmWavWaveform(bytes, () => true, async () => { yields++; });
  assert.equal(result.frames, 50000); assert.equal(yields, 3); assert.ok(result.peaks.every(value => value === 1));
  await assert.rejects(pcmWavWaveform(bytes, () => owns, async () => { owns = false; }), /no longer belongs/);
});

test("decoded recording bounds are validated before acquiring channel views or inspecting samples", async () => {
  for (const options of [{ frames: 248001 }, { channels: 33 }, { channels: 0 }, { rate: 44100 }, { frames: -1 }, { frames: NaN }]) {
    let reads = 0;
    const invalid = { length: 800, numberOfChannels: 1, sampleRate: 8000, getChannelData() { reads++; throw Error("Unbounded view"); },
      ...(options.frames === undefined ? {} : { length: options.frames }), ...(options.channels === undefined ? {} : { numberOfChannels: options.channels }), ...(options.rate === undefined ? {} : { sampleRate: options.rate }) };
    await assert.rejects(decodedRecordingWaveform(invalid), /PCM budget/); assert.equal(reads, 0);
  }
  const inconsistent = audio(); inconsistent.getChannelData = () => new Float32Array(4); await assert.rejects(decodedRecordingWaveform(inconsistent), /inconsistent PCM/);
  const bounded = await decodedRecordingWaveform(audio({ frames: 248000, channels: 32 }), () => true, async () => {});
  assert.equal(bounded.peaks.length, 256); assert.equal(bounded.frames * bounded.channels * 4, 31744000); assert.equal(bounded.sampleRate, WAVEFORM_SAMPLE_RATE);
});

test("only an explicit current short recording request reaches the native decoder with its actual bytes", async t => {
  const f = fixture(t), blob = f.source(); assert.equal(f.calls, 0); assert.equal(f.job.result, null);
  const request = f.job.request(); assert.equal(f.job.request(), request); await request;
  assert.equal(f.calls, 1); assert.equal(f.reads, blob.size); assert.equal(f.job.state, "ready"); assert.equal(f.job.result.method, "recording");
  assert.ok(f.job.result.peaks.every(value => value === .5)); assert.match(f.job.message, /Playback and seeking use the audio controls/);
});

test("arbitrary compressed vault files never reach the native decoder and retain an explanatory fallback", async t => {
  const f = fixture(t); f.job.setSource({ blob: new Blob([arrayBuffer([1, 2, 3, 4])], { type: "audio/webm" }), owns: () => true });
  await f.job.request(); assert.equal(f.calls, 0); assert.equal(f.job.state, "unavailable"); assert.match(f.job.message, /PCM WAV/); assert.match(f.job.message, /audio controls remain available/);
});

test("long, unknown, zero and oversized recordings are rejected before byte allocation or decoder construction", async t => {
  const f = fixture(t); let reads = 0;
  const blob = { size: 3, arrayBuffer: async () => { reads++; return arrayBuffer([1, 2, 3]); } };
  for (const duration of [0, -1, NaN, Infinity, 30001]) { f.source(blob, duration); await f.job.request(); assert.match(f.job.message, /30 seconds/); }
  f.source({ ...blob, size: 16 * 1024 * 1024 + 1 }); await f.job.request(); assert.match(f.job.message, /16 MiB/);
  f.source({ ...blob, size: 0 }); await f.job.request(); assert.match(f.job.message, /nonempty/);
  f.source(blob, 1000, () => false); await f.job.request(); assert.match(f.job.message, /no longer belongs/);
  assert.equal(reads, 0); assert.equal(f.calls, 0);
});

test("native decode failures keep the source and fall back without altering playback or retrying automatically", async t => {
  const f = fixture(t, { decode: async () => { throw Error("Codec refused"); } }), blob = f.source();
  await f.job.request(); assert.equal(f.calls, 1); assert.equal(f.job.state, "unavailable"); assert.equal(f.job.result, null); assert.equal(f.job.source.blob, blob);
  assert.match(f.job.message, /Codec refused.*audio controls remain available/); await settle(); assert.equal(f.calls, 1);
});

test("cancelled native work holds one lease until settlement; late PCM cannot populate a new clip or owner", async t => {
  const decode = deferred(), first = fixture(t, { decode: () => decode.promise }), second = fixture(t);
  first.source(); const old = first.job.request(); await settle(); assert.equal(first.calls, 1);
  first.job.cancel(); second.source(); await second.job.request(); assert.equal(second.calls, 0); assert.match(second.job.message, /still finishing/);
  decode.resolve(audio({ amplitude: .75 })); await old; assert.equal(first.job.result, null); assert.equal(first.job.state, "idle");
  await second.job.request(); assert.equal(second.calls, 1); assert.equal(second.job.state, "ready"); assert.equal(Math.max(...second.job.result.peaks), .5);
});

test("replacement, removed-root ownership and disposed jobs refuse deferred bytes or decoder results", async t => {
  const data = deferred(), f = fixture(t), oldBlob = { size: 3, arrayBuffer: () => data.promise };
  f.source(oldBlob); const old = f.job.request(); f.source(new Blob([wav()])); data.resolve(arrayBuffer([1, 2, 3])); await old;
  assert.equal(f.calls, 0); assert.equal(f.job.state, "idle"); assert.equal(f.job.result, null);
  const decode = deferred(); let owner = true; const g = fixture(t, { decode: () => decode.promise });
  g.source(undefined, 1000, () => owner); const pending = g.job.request(); await settle(); owner = false; decode.resolve(audio()); await pending;
  assert.equal(g.job.result, null); assert.equal(g.job.state, "unavailable"); assert.match(g.job.message, /no longer belongs/);
  const ending = deferred(), h = fixture(t, { decode: () => ending.promise }); h.source(); const detached = h.job.request(); await settle(); h.job.dispose();
  ending.resolve(audio()); await detached; assert.equal(h.job.result, null); assert.equal(h.job.source, null);
});

test("timeout retires the decoder result and timer while retaining the non-overlapping native lease", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const decode = deferred(), f = fixture(t, { decode: () => decode.promise }), g = fixture(t); f.source();
  const pending = f.job.request(); await settle(); t.mock.timers.tick(15000);
  assert.equal(f.job.state, "unavailable"); assert.match(f.job.message, /timed out/); assert.equal(f.job.timer, null);
  g.source(); await g.job.request(); assert.equal(g.calls, 0); assert.match(g.job.message, /still finishing/);
  decode.resolve(audio()); await pending; assert.equal(f.job.result, null); assert.match(f.job.message, /timed out/);
  await g.job.request(); assert.equal(g.job.state, "ready"); assert.equal(g.calls, 1);
});

test("inconsistent blob bytes refuse before the decoder and release the work lease for a valid source", async t => {
  const f = fixture(t); f.source({ size: 4, arrayBuffer: async () => arrayBuffer([1, 2, 3]) }); await f.job.request();
  assert.equal(f.calls, 0); assert.equal(f.job.state, "unavailable"); assert.match(f.job.message, /source bytes changed/);
  f.source(); await f.job.request(); assert.equal(f.job.state, "ready"); assert.equal(f.calls, 1);
});

class MediaNode {
  constructor(tag) { this.tagName = tag; this.dataset = {}; this.attributes = new Map(); this.children = []; this.src = ""; this.parent = null; this.classList = { add() {}, toggle() {} }; }
  get isConnected() { return Boolean(this.root || this.parent?.isConnected); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); if (name === "src") this.src = ""; }
  toggleAttribute(name, force) { if (force ?? !this.attributes.has(name)) this.attributes.set(name, ""); else this.attributes.delete(name); }
  addEventListener() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  pause() {}
  load() {}
}
function fileEnvironment(t, { extension = "wav", cached = false, changingVault = false } = {}) {
  const original = { document: globalThis.document, window: globalThis.window, transport: globalThis.audioWaveformFileTransport, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const created = [], revoked = [], calls = [], bytes = wav(), file = { path: "Clip." + extension, extension, stat: { size: bytes.byteLength, mtime: 1 } }, rootPath = cached ? "github:immutable" : "local";
  const info = { root: rootPath, file: { path: file.path, stat: { ...file.stat } }, version: cached ? "git:audio-A" : "audio-A" };
  let before = structuredClone(info), after = structuredClone(info), response = { ...structuredClone(info), base64: Buffer.from(bytes).toString("base64") }, infos = 0, hold;
  const app = { changingVault, editorChanged() {}, commands: { install: () => () => {} }, workspace: { registerExtensions: () => () => {} }, registerLeaveGuard: () => () => {}, vault: { rootPath, readOnly: cached, getFileByPath: path => path === file.path ? file : null, on() { return {}; }, async getFileInfo() { return structuredClone(++infos === 1 ? before : after); } } };
  globalThis.document = { createElement: tag => new MediaNode(tag), createElementNS: (_namespace, tag) => new MediaNode(tag) };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
  URL.createObjectURL = blob => { const url = "blob:audio-file-" + created.length; created.push({ url, blob }); return url; }; URL.revokeObjectURL = url => revoked.push(url);
  globalThis.audioWaveformFileTransport = async url => { calls.push(url); if (hold) await hold.promise; return structuredClone(response); };
  let view = new AudioFileView({ app, file }), providerCleanup;
  t.after(async () => { await providerCleanup?.(); await view.onUnloadFile(); view.waveform.dispose(); for (const [name, value] of [["document", original.document], ["window", original.window], ["audioWaveformFileTransport", original.transport]]) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; });
  return { get view() { return view; }, app, file, created, revoked, calls, bytes, before, after, response, setHold(value) { hold = value; }, async activateProvider() {
    let activate;
    const recorder = new AudioRecorder(app);
    recorder.register({ register(_id, factory) { activate = factory; }, async installViews(_id, creators) {
      view.waveform.dispose(); view = creators.audio({ app, file });
      await view.onLoadFile(file);
      return async () => { await view.onUnloadFile(); view.waveform.dispose(); };
    } });
    providerCleanup = await activate();
    return recorder;
  } };
}

test("actual registered AudioFileView restores versioned local and cached audio during setVault and enables waveform only after ready", async t => {
  for (const cached of [false, true]) await t.test(cached ? "cached vault restoration" : "local vault restoration", async sub => {
    const f = fileEnvironment(sub, { cached, changingVault: true });
    const recorder = await f.activateProvider();
    assert.equal(f.app.changingVault, true); assert.equal(recorder.capture.liveTracks, 0); assert.equal(recorder.capture.state, "idle");
    assert.equal(f.created.length, 1); assert.equal(f.calls.length, 1); assert.match(f.calls[0], /^\/api\/binary\?/);
    assert.equal(f.view.status.textContent, f.file.path); assert.equal(f.view.player.src, f.created[0].url); assert.equal(f.view.sourceBlob.type, "audio/wav");
    assert.equal(f.view.sourceVersion, f.before.version); assert.deepEqual(new Uint8Array(await f.view.sourceBlob.arrayBuffer()), new Uint8Array(f.bytes));
    assert.equal(f.view.waveform.job.source.owns(), false);
    await f.view.waveform.job.request(); assert.equal(f.view.waveform.job.result, null); assert.equal(f.view.waveform.job.state, "unavailable");
    f.app.changingVault = false;
    assert.equal(f.view.waveform.job.source.owns(), true); await f.view.waveform.job.request(); assert.equal(f.view.waveform.job.state, "ready");
    assert.equal(f.view.waveform.job.result.method, "wav"); assert.equal(f.view.player.src, f.created[0].url);
    await f.view.onUnloadFile(); assert.deepEqual(f.revoked, [f.created[0].url]); assert.equal(f.view.player.src, ""); assert.equal(f.view.waveform.job.result, null);
  });
});

test("the registered AudioFileView restoration lease expires after provider installation and cannot authorize later loads during a vault change", async t => {
  const f = fileEnvironment(t, { changingVault: true }); await f.activateProvider(); assert.equal(f.created.length, 1);
  await f.view.onLoadFile(f.file);
  assert.equal(f.calls.length, 1); assert.equal(f.created.length, 1); assert.deepEqual(f.revoked, [f.created[0].url]);
  assert.equal(f.view.sourceBlob, null); assert.equal(f.view.player.src, ""); assert.equal(f.view.waveform.job.source, null);
  f.app.changingVault = false; await f.view.onLoadFile(f.file); assert.equal(f.created.length, 2); assert.equal(f.view.player.src, f.created[1].url);
});

test("normal provider installation cannot acquire a restoration lease when a vault change begins during its held audio read", async t => {
  const f = fileEnvironment(t), held = deferred(); f.setHold(held);
  const activating = f.activateProvider(); await settle(); assert.equal(f.calls.length, 1);
  f.app.changingVault = true; held.resolve(); await activating;
  assert.equal(f.created.length, 0); assert.equal(f.view.sourceBlob, null); assert.equal(f.view.waveform.job.source, null); assert.equal(f.view.player.src, "");
});

test("actual AudioFileView refuses pending normal loads once leaving begins and all pending restoration loads whose source ownership changes", async t => {
  for (const restoring of [false, true]) {
    const cases = [
      ["root", f => { f.app.vault.rootPath = "other"; }],
      ["file identity", f => { f.view.file = { ...f.file }; }],
      ["file path", f => { f.file.path = "Other.wav"; }],
      ["file stat", f => { f.file.stat.mtime++; }],
      ["vault file identity", f => { f.app.vault.getFileByPath = () => ({ ...f.file }); }],
      ["unloaded generation", f => f.view.onUnloadFile()],
    ];
    if (!restoring) cases.push(["leaving current vault", f => { f.app.changingVault = true; }]);
    for (const [name, mutate] of cases) await t.test((restoring ? "restoration: " : "normal: ") + name, async sub => {
      const f = fileEnvironment(sub, { changingVault: restoring }), held = deferred(); f.setHold(held);
      const loading = restoring ? f.activateProvider() : f.view.onLoadFile(f.file); await settle(); assert.equal(f.calls.length, 1);
      await mutate(f); held.resolve(); await loading;
      assert.equal(f.created.length, 0); assert.equal(f.view.sourceBlob, null); assert.equal(f.view.waveform.job.source, null); assert.equal(f.view.player.src, "");
    });
  }
});

test("registered AudioFileView restoration still rejects versioned response mismatch before creating a playback URL", async t => {
  const f = fileEnvironment(t, { changingVault: true }); f.response.version = "audio-B";
  await assert.rejects(f.activateProvider(), /changed while loading/); assert.equal(f.created.length, 0); assert.equal(f.view.sourceBlob, null); assert.equal(f.view.waveform.job.source, null);
});

test("actual AudioFileView refuses a held A→B→A same-stat binary response before creating playback or waveform URLs", async t => {
  const f = fileEnvironment(t), held = deferred(); f.setHold(held);
  const loading = f.view.onLoadFile(f.file); await settle(); assert.equal(f.calls.length, 1); assert.match(f.calls[0], /^\/api\/binary\?/);
  // Metadata is A both before and after; held bytes and their immutable response version are B.
  f.response.version = "audio-B"; f.response.base64 = Buffer.from(wav({ samples: [.75, -.25, .5, -1] })).toString("base64");
  held.resolve(); await assert.rejects(loading, /changed while loading/);
  assert.equal(f.before.version, f.after.version); assert.equal(f.response.file.stat.size, f.file.stat.size); assert.equal(f.response.file.stat.mtime, f.file.stat.mtime);
  assert.equal(f.created.length, 0); assert.equal(f.view.sourceBlob, null); assert.equal(f.view.sourceVersion, null); assert.equal(f.view.waveform.job.source, null);
});

test("actual AudioFileView binds unchanged cached PCM bytes/version to one owned Blob and releases its waveform on unload", async t => {
  const f = fileEnvironment(t, { cached: true }); await f.view.onLoadFile(f.file);
  assert.equal(f.created.length, 1); assert.equal(f.calls.length, 1); assert.ok(f.calls.every(url => url.startsWith("/api/binary?")));
  assert.equal(f.view.sourceVersion, "git:audio-A"); assert.equal(f.view.sourceBlob, f.created[0].blob); assert.equal(f.view.waveform.job.source.blob, f.view.sourceBlob);
  assert.deepEqual(new Uint8Array(await f.view.sourceBlob.arrayBuffer()), new Uint8Array(f.bytes)); assert.equal(f.view.sourceBlob.type, "audio/wav");
  await f.view.waveform.job.request(); assert.equal(f.view.waveform.job.state, "ready"); assert.equal(f.view.waveform.job.result.method, "wav");
  await f.view.onUnloadFile(); assert.deepEqual(f.revoked, [f.created[0].url]); assert.equal(f.view.sourceVersion, null); assert.equal(f.view.sourceBlob, null); assert.equal(f.view.waveform.job.result, null); assert.equal(f.view.player.src, "");
});

test("actual AudioFileView validates response root/path/stat, metadata version and exact byte count with no stat fallback", async t => {
  const mutations = [
    f => { f.response.root = "other"; }, f => { f.response.file.path = "Other.wav"; }, f => { f.response.file.stat.size++; }, f => { f.response.file.stat.mtime++; },
    f => { f.after.version = "new"; }, f => { f.before.version = f.after.version = f.response.version = ""; },
    f => { f.response.base64 = Buffer.from(new Uint8Array(4)).toString("base64"); },
  ];
  for (const mutate of mutations) await t.test("reject incompatible binary provenance", async sub => {
    const f = fileEnvironment(sub); mutate(f); await assert.rejects(f.view.onLoadFile(f.file), /changed|bytes do not match/); assert.equal(f.created.length, 0); assert.equal(f.view.waveform.job.source, null);
  });
});

test("AudioFileView preserves the native MIME for every audio extension and legacy audiovisual pane state", async t => {
  for (const [extension, mime] of Object.entries({ m4a: "audio/mp4", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", mp4: "audio/mp4", webm: "audio/webm" })) await t.test(extension, async sub => {
    const f = fileEnvironment(sub, { extension }); await f.view.onLoadFile(f.file); assert.equal(f.view.sourceBlob.type, mime); assert.equal(f.view.sourceVersion, f.before.version); assert.equal(f.created.length, 1);
  });
});

test("saved compressed metadata comes only from the current owned player while the strict WAV route needs no metadata", async t => {
  const f = fileEnvironment(t, { extension: "m4a", cached: true }); await f.view.onLoadFile(f.file);
  const source = f.view.waveform.job.source; assert.equal(source.blob, f.view.sourceBlob); assert.equal(source.owns(), true);
  f.view.player.readyState = 0; f.view.player.duration = .5; assert.ok(Number.isNaN(source.savedAudioDuration()));
  f.view.player.readyState = 1; assert.equal(source.savedAudioDuration(), .5);
  f.view.player.src = "blob:another-player"; assert.ok(Number.isNaN(source.savedAudioDuration())); assert.equal(source.owns(), false);
  f.view.player.src = f.created[0].url; assert.equal(source.owns(), true);
  await f.view.onUnloadFile(); assert.equal(source.owns(), false); assert.ok(Number.isNaN(source.savedAudioDuration()));
});

test("saved metadata readiness does not construct a decoder or read bytes automatically", async t => {
  const f = fileEnvironment(t, { extension: "ogg" }); await f.view.onLoadFile(f.file);
  const source = f.view.waveform.job.source; let reads = 0; source.blob.arrayBuffer = async () => { reads++; throw Error("must remain explicit"); };
  f.view.player.readyState = 1; f.view.player.duration = .5;
  assert.equal(source.savedAudioDuration(), .5); await settle(); assert.equal(reads, 0); assert.equal(f.view.waveform.job.state, "idle");
  f.view.player.readyState = 0; await f.view.waveform.job.request(); assert.equal(reads, 0); assert.match(f.view.waveform.job.message, /finite audio metadata/);
});
