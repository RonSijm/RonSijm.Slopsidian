import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { root, startHost } from "./host.mjs";

let temporary, AudioCapture, microphoneError, audioExtension, recordingFolder, recordingName, attachmentPath, encodeBinary, decodeBinary, MAX_BINARY_BYTES;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "audio-tests-"));
  const entry = join(temporary, "audio.mjs");
  await build({ stdin: { contents: 'export * from "./client/audio-capture"; export * from "./client/audio-paths"; export * from "./client/binary";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ AudioCapture, microphoneError, audioExtension, recordingFolder, recordingName, attachmentPath, encodeBinary, decodeBinary, MAX_BINARY_BYTES } = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { await rm(temporary, { recursive: true }); } });

class Track extends EventTarget {
  readyState = "live"; stopped = 0;
  stop() { this.readyState = "ended"; this.stopped++; }
}
class Encoder extends EventTarget {
  state = "inactive";
  constructor(mimeType = "audio/webm;codecs=opus", options = {}) { super(); this.mimeType = mimeType; this.options = options; }
  start(slice) { assert.equal(slice, 250); if (this.options.startError) { throw new Error("Encoder start failed"); } this.state = "recording"; }
  chunk(data = new Uint8Array([26, 69, 223, 163, 0, 255])) { const event = new Event("dataavailable"); Object.defineProperty(event, "data", { value: new Blob([data]) }); this.dispatchEvent(event); }
  stop() {
    if (this.options.stopError) { throw new Error("Encoder stop failed"); }
    this.state = "inactive";
    queueMicrotask(() => { if (!this.options.empty) { this.chunk(); } this.dispatchEvent(new Event("stop")); });
  }
}
function fixture(options = {}) {
  const track = new Track(), stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const encoder = new Encoder("audio/webm;codecs=opus", options);
  let acquired = 0;
  const host = { acquire: async () => { acquired++; if (options.permissionError) { throw options.permissionError; } return stream; }, supports: type => !options.noCodec && type.startsWith("audio/webm"), create: () => encoder, now: () => 1000 };
  const capture = new AudioCapture(() => {}, host);
  return { capture, host, track, stream, encoder, get acquired() { return acquired; } };
}

test("audio capture acquires only on explicit start, finalizes bytes on stop, releases tracks and never restarts over a draft", async () => {
  const app = fixture(); assert.equal(app.acquired, 0);
  await app.capture.start(); assert.equal(app.acquired, 1); assert.equal(app.capture.state, "recording"); assert.equal(app.capture.liveTracks, 1);
  await assert.rejects(app.capture.start(), /Save or discard/);
  const first = app.capture.stop(), second = app.capture.stop(); assert.equal(first, second); await first;
  assert.equal(app.capture.state, "ready"); assert.equal(app.track.stopped, 1); assert.equal(app.capture.liveTracks, 0);
  assert.deepEqual(new Uint8Array(await app.capture.data.arrayBuffer()), new Uint8Array([26, 69, 223, 163, 0, 255]));
  assert.equal(app.capture.data.type, "audio/webm;codecs=opus");
  app.capture.cancel(); assert.equal(app.capture.state, "idle"); assert.equal(app.capture.data, null);
});

test("late microphone grants after cancellation or disposal stop every returned track without reviving the encoder", async () => {
  for (const dispose of [false, true]) {
    const app = fixture(); let grant;
    app.host.acquire = () => new Promise(resolve => { grant = resolve; });
    const pending = app.capture.start(); assert.equal(app.capture.state, "requesting");
    if (dispose) { app.capture.dispose(); } else { app.capture.cancel(); }
    grant(app.stream); await pending;
    assert.equal(app.track.stopped, 1); assert.equal(app.encoder.state, "inactive"); assert.equal(app.capture.data, null);
    assert.equal(app.capture.state, dispose ? "disposed" : "idle");
  }
});

test("permission/device, codec, encoder and empty-output failures remain explicit and release microphone resources", async () => {
  const noCodec = fixture({ noCodec: true }); await noCodec.capture.start();
  assert.equal(noCodec.acquired, 0); assert.equal(noCodec.capture.state, "error"); assert.match(noCodec.capture.message, /codec/);
  const denied = fixture({ permissionError: new DOMException("Denied", "NotAllowedError") }); await denied.capture.start(); assert.match(denied.capture.message, /permission was denied/);
  assert.match(microphoneError(new DOMException("Missing", "NotFoundError")), /No usable microphone/);
  assert.match(microphoneError(new DOMException("Busy", "NotReadableError")), /could not be opened/);
  for (const options of [{ startError: true }, { empty: true }, { stopError: true }]) {
    const app = fixture(options); await app.capture.start();
    if (app.capture.state === "recording") { await app.capture.stop(); }
    assert.equal(app.capture.state, "error"); assert.equal(app.capture.liveTracks, 0); assert.equal(app.capture.data, null);
  }
});

test("audio constructor fallback retains the actual selected MIME and track-ended/size-limit paths release resources", async () => {
  const app = fixture(); app.host.supports = type => type !== "audio/ogg;codecs=opus";
  app.encoder.mimeType = "";
  app.host.create = (_stream, type) => { if (type === "audio/mp4") { throw new Error("MP4 encoder unavailable"); } return app.encoder; };
  await app.capture.start(); assert.equal(app.capture.mime, "audio/webm;codecs=opus");
  app.track.readyState = "ended"; app.track.dispatchEvent(new Event("ended"));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(app.capture.state, "ready"); assert.equal(app.capture.liveTracks, 0);
  const oversized = fixture(); await oversized.capture.start(); oversized.encoder.chunk(new Uint8Array(MAX_BINARY_BYTES + 1));
  assert.equal(oversized.capture.state, "error"); assert.match(oversized.capture.message, /16 MiB/); assert.equal(oversized.capture.liveTracks, 0);
  oversized.encoder.chunk(); assert.equal(oversized.capture.data, null, "late events cannot resurrect discarded data");
});

test("recording paths honor root/note-relative folders, preserve format extensions and avoid known collisions", () => {
  assert.equal(recordingFolder(undefined, null), ""); assert.equal(recordingFolder(".", null), "");
  assert.equal(recordingFolder("./", "Notes/One.md"), "Notes"); assert.equal(recordingFolder("./Audio", "Notes/One.md"), "Notes/Audio");
  assert.equal(recordingFolder("Assets/Audio/", null), "Assets/Audio");
  assert.throws(() => recordingFolder("./Audio", null), /Open a file/);
  for (const path of ["../Audio", "/Audio", ".obsidian/Audio", "CON.wav", "Audio\\one.wav", "Audio//one.wav"]) { assert.throws(() => attachmentPath(path)); }
  const now = new Date(2026, 9, 21, 12, 34, 56), first = recordingName("Audio", "webm", () => false, now);
  assert.equal(first, "Audio/Recording 20261021123456.webm");
  assert.equal(recordingName("Audio", "webm", path => path === first, now), "Audio/Recording 20261021123456 1.webm");
  assert.throws(() => recordingName("Audio", "webm", () => true, now), /No available/);
  assert.equal(audioExtension("audio/mp4;codecs=mp4a.40.2"), "m4a"); assert.throws(() => audioExtension("text/html"));
});

test("binary transport preserves arbitrary byte patterns and BOMs without text decoding and rejects malformed/noncanonical/oversized Base64", () => {
  const bytes = new Uint8Array([239, 187, 191, 0, 255, 128, 26, 69, 223, 163]);
  assert.deepEqual(decodeBinary(encodeBinary(bytes.buffer)), bytes);
  const large = new Uint8Array(1024 * 1024); large.fill(255); assert.deepEqual(decodeBinary(encodeBinary(large.buffer)), large);
  for (const value of ["=", "====", "AR==", "ABC", "AA==\n", "@@==", "A===", null]) { assert.throws(() => decodeBinary(value)); }
  assert.throws(() => encodeBinary(new ArrayBuffer(MAX_BINARY_BYTES + 1)), /16 MiB/);
});

test("native microphone permissions are bound to the local main frame and audio-only consent, with isolated synthetic permission", async () => {
  const { microphoneOwner, installMicrophonePermission } = createRequire(import.meta.url)(join(root, "desktop", "audio-permissions.cjs"));
  const contents = {}, window = { webContents: contents }, endpoint = "http://127.0.0.1:51332/";
  assert.equal(microphoneOwner(contents, window, endpoint, endpoint, true), true);
  for (const [sender, url, main] of [[{}, endpoint, true], [contents, "https://other.example", true], [contents, endpoint, false], [contents, "http://127.0.0.1:51333", true]]) { assert.equal(microphoneOwner(sender, window, endpoint, url, main), false); }
  let check, request, prompts = 0;
  const session = { setPermissionCheckHandler: callback => { check = callback; }, setPermissionRequestHandler: callback => { request = callback; } };
  installMicrophonePermission(session, window, endpoint, { showMessageBox: async () => { prompts++; return { response: 0 }; } });
  const details = { requestingUrl: endpoint, isMainFrame: true, mediaTypes: ["audio"], mediaType: "audio" };
  assert.equal(check(contents, "media", endpoint, details), false);
  assert.equal(await new Promise(resolve => request(contents, "media", resolve, details)), true); assert.equal(prompts, 1);
  assert.equal(check(contents, "media", endpoint, details), true);
  assert.equal(await new Promise(resolve => request(contents, "media", resolve, { ...details, mediaTypes: ["video"] })), false);
  assert.equal(check(contents, "media", endpoint, { ...details, mediaType: "video" }), false);
});

test("native binary create/read is byte-exact, root/path/collision guarded and persistent across a full host restart", async t => {
  const directory = await mkdtemp(join(temporary, "vault-")); let host = await startHost(directory); t.after(() => host.stop());
  const bytes = Buffer.from([239, 187, 191, 0, 255, 128, 7, 9]), path = "Attachments/recording.webm";
  const result = await host.request("/api/binary", "POST", { root: directory, path, base64: bytes.toString("base64") });
  assert.equal(result.status, 200); const saved = await result.json(); assert.equal(saved.file.path, path);
  assert.deepEqual(await readFile(join(directory, path)), bytes);
  const url = "/api/binary?" + new URLSearchParams({ root: directory, path });
  assert.equal((await (await host.request(url)).json()).base64, bytes.toString("base64"));
  const resource = await (await host.request("/api/resource?" + new URLSearchParams({ root: directory, path }))).json();
  assert.equal(resource.contentType, "audio/webm"); assert.equal(resource.base64, bytes.toString("base64"));
  for (const [root, target, value, status] of [[directory, path, "AA==", 409], ["C:/OtherVault", "New.webm", "AA==", 409], [directory, "../Escape.webm", "AA==", 400], [directory, ".obsidian/Hidden.webm", "AA==", 400], [directory, "Bad.webm", "AR==", 400]]) {
    assert.equal((await host.request("/api/binary", "POST", { root, path: target, base64: value })).status, status);
    assert.deepEqual(await readFile(join(directory, path)), bytes);
  }
  await host.stop(); host = await startHost(directory);
  assert.equal((await (await host.request(url)).json()).version, saved.version);
  await writeFile(join(directory, "Oversized.webm"), Buffer.alloc(MAX_BINARY_BYTES + 1));
  assert.equal((await host.request("/api/binary?" + new URLSearchParams({ root: directory, path: "Oversized.webm" }))).status, 413);
  assert.equal((await host.request("/api/resource?" + new URLSearchParams({ root: directory, path: "Oversized.webm" }))).status, 413);
});
