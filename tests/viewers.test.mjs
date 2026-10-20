import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { root } from "./host.mjs";

let directory, policy, Workspace, registerImageView, PdfView, VideoView, setPdfRenderer, PdfPasswordError;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "viewer-tests-"));
  const output = join(directory, "viewers.cjs");
  await build({ stdin: { contents: 'export * from "./client/media-policy"; export { Workspace } from "./client/workspace"; export { registerImageView } from "./client/image-view"; export { PdfView, VideoView, setPdfRenderer } from "./client/viewer-views"; export { PdfPasswordError } from "./client/pdf-engine";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ Workspace, registerImageView, PdfView, VideoView, setPdfRenderer, PdfPasswordError, ...policy } = createRequire(import.meta.url)(output));
});
after(async () => { if (directory) { await rm(directory, { recursive: true }); } });

const bytes = (...parts) => Uint8Array.from(parts.flatMap(part => typeof part === "string" ? [...part].map(character => character.charCodeAt(0)) : Array.isArray(part) ? part : [part]));
function png() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return c >>> 0; });
  const crc = data => { let c = 0xffffffff; for (const b of data) { c = crcTable[(c ^ b) & 255] ^ (c >>> 8); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))]));
}

test("content sniffing recognises every supported raster, vector, document and video container", () => {
  assert.equal(policy.sniffMime(png()), "image/png");
  assert.equal(policy.sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16)), "image/jpeg");
  assert.equal(policy.sniffMime(bytes("GIF89a", 1, 0, 1, 0)), "image/gif");
  assert.equal(policy.sniffMime(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")), "image/webp");
  assert.equal(policy.sniffMime(bytes(0, 0, 0, 24, "ftypavif", 0, 0, 0, 0)), "image/avif");
  assert.equal(policy.sniffMime(bytes(0, 0, 0, 24, "ftypisom", 0, 0, 0, 0)), "video/mp4");
  assert.equal(policy.sniffMime(bytes(0, 0, 0, 20, "ftypqt  ", 0, 0, 0, 0)), "video/quicktime");
  assert.equal(policy.sniffMime(bytes(0x1a, 0x45, 0xdf, 0xa3, 1, 0)), "video/webm");
  assert.equal(policy.sniffMime(bytes("OggS", 0, 2)), "video/ogg");
  assert.equal(policy.sniffMime(bytes("junk\n%PDF-1.7\n")), "application/pdf");
  assert.equal(policy.sniffMime(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), "image/svg+xml");
  assert.equal(policy.sniffMime(bytes("plain text")), null);
});

test("PDF inspection reports active content without treating plain documents as hostile", () => {
  assert.deepEqual(policy.inspectPdf(bytes("%PDF-1.4\n1 0 obj<</Type/Page>>endobj\n")), []);
  const hostile = bytes("%PDF-1.4\n<</S/JavaScript/JS(app.alert(1))>><</S/Launch>><</S/URI/URI(http://x)>><</Type/EmbeddedFile>>");
  assert.deepEqual(policy.inspectPdf(hostile).map(finding => finding.kind).sort(), ["pdf-embedded-file", "pdf-javascript", "pdf-launch", "pdf-uri"]);
});

test("a background or restoring locked PDF cannot steal focus from the selected view", async () => {
  const file = { path: "Locked.pdf" }, leaf = { workspace: { activeLeaf: null } }, focused = [];
  const view = Object.assign(Object.create(PdfView.prototype), {
    file, leaf, app: { changingVault: false }, generation: 0, bytes: new ArrayBuffer(4), disposal: Promise.resolve(),
    password: { hidden: true, checkVisibility: () => true },
    passwordField: { focus: () => focused.push("password") },
    viewport: { focus: () => focused.push("viewport") },
    setStatus() {},
  });
  setPdfRenderer({ open: async () => { throw new PdfPasswordError(false); } });
  try {
    await view.openDocument(file);
    assert.deepEqual(focused, []);
    assert.equal(view.password.hidden, false);
    leaf.workspace.activeLeaf = leaf;
    view.app.changingVault = true;
    await view.openDocument(file);
    assert.deepEqual(focused, []);
    view.app.changingVault = false;
    await view.openDocument(file);
    assert.deepEqual(focused, ["password"]);
    view.focus();
    view.password.hidden = true;
    view.focus();
    assert.deepEqual(focused, ["password", "password", "viewport"]);
  } finally {
    setPdfRenderer(null);
  }
});

test("video snapshots preserve incoming playback until metadata applies it, then retain real user controls across release", () => {
  const video = {
    readyState: 0, currentTime: 0, playbackRate: 1, volume: 1, muted: false,
    duration: 3, videoWidth: 64, videoHeight: 48,
    pause() {}, removeAttribute() {}, load() {},
  };
  const requested = { time: 0.25, rate: 0.5, volume: 0.9, muted: true };
  const view = Object.assign(Object.create(VideoView.prototype), {
    state: {}, file: null, video, playback: { ...requested }, playbackReady: false,
    url: null, holdPlayback: false, generation: 0, bodyEl: { dataset: {} },
    setStatus(state) { this.bodyEl.dataset.videoStatus = state; },
  });
  const state = () => {
    const value = view.getState();
    return { time: value.videoTime, rate: value.videoRate, volume: value.videoVolume, muted: value.videoMuted };
  };
  try {
    view.show({ path: "Incoming.webm" }, new ArrayBuffer(0), "video/webm", () => true);
    video.readyState = 1; // Chromium has metadata; its queued handler has not run.
    assert.deepEqual(state(), requested);
    video.onloadedmetadata();
    assert.equal(view.bodyEl.dataset.videoStatus, "ready");
    assert.deepEqual(state(), requested);
    assert.equal(video.playbackRate, 0.5); assert.equal(video.volume, 0.9); assert.equal(video.muted, true);
    Object.assign(video, { currentTime: 0.75, playbackRate: 2, volume: 0.2, muted: false });
    const user = { time: 0.75, rate: 2, volume: 0.2, muted: false };
    assert.deepEqual(state(), user);
    view.release();
    Object.assign(video, { currentTime: 0, playbackRate: 1, volume: 1, muted: true });
    assert.deepEqual(state(), user);
  } finally { if (view.url) { URL.revokeObjectURL(view.url); } }
});

test("viewer state validation rejects out-of-range or mistyped values", () => {
  assert.deepEqual({ ...policy.readPlaybackState({ videoTime: 12.5, videoRate: 2, videoMuted: true, videoVolume: 0.5 }) }, { time: 12.5, rate: 2, muted: true, volume: 0.5 });
  assert.equal(policy.readPlaybackState({}).rate, 1);
  for (const bad of [{ videoTime: -1 }, { videoRate: 9 }, { videoVolume: 2 }, { videoTime: "1" }, { videoMuted: "yes" }]) { assert.throws(() => policy.readPlaybackState(bad)); }
  assert.equal(policy.readPdfPage(undefined), 1);
  assert.equal(policy.readPdfPage(7), 7);
  for (const bad of [0, 1.5, "2", 1e9]) { assert.throws(() => policy.readPdfPage(bad)); }
});

test("built-in registration owns raster, SVG, PDF and video extensions and keeps plugins from replacing them", () => {
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, { viewCreators: new Map(), extensions: new Map(), trigger() {} });
  registerImageView(workspace);
  const expected = { image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"], pdf: ["pdf"], video: ["mp4", "m4v", "webm", "ogv", "mov"] };
  for (const [type, extensions] of Object.entries(expected)) {
    for (const extension of extensions) { assert.equal(workspace.viewTypeForExtension(extension), type, extension); }
  }
  assert.equal(workspace.viewTypeForExtension("SVG"), "image");
  workspace.registerView("plugin:a", "plugin-svg", () => ({}));
  assert.throws(() => workspace.registerExtensions("plugin:a", ["svg"], "plugin-svg"), /unregistered/);
  assert.equal(workspace.viewTypeForExtension("svg"), "image");
  assert.equal(workspace.viewTypeForExtension("md"), "markdown");
});

test("recorder audio registration coexists with video, releases only its own extensions and can be re-enabled", () => {
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, { viewCreators: new Map(), extensions: new Map(), trigger() {} });
  registerImageView(workspace);
  workspace.registerView("core:audio-recorder", "audio", () => ({}));
  const enable = () => workspace.registerExtensions("core:audio-recorder", [...policy.audioFileExtensions], "audio");
  let disable = enable();
  for (const extension of ["mp4", "webm", "mov"]) assert.equal(workspace.viewTypeForExtension(extension), "video");
  for (const extension of ["m4a", "ogg", "mp3", "wav"]) assert.equal(workspace.viewTypeForExtension(extension), "audio");
  disable();
  for (const extension of ["mp4", "webm"]) assert.equal(workspace.viewTypeForExtension(extension), "video");
  assert.equal(workspace.viewTypeForExtension("m4a"), null);
  disable = enable();
  assert.equal(workspace.viewTypeForExtension("m4a"), "audio");
  disable();
});

test("PDF canvas planning keeps every canvas inside the pixel and side budgets", () => {
  const small = policy.planPdfCanvas(612, 792, 1, 1);
  assert.deepEqual({ w: small.width, h: small.height, capped: small.capped }, { w: 612, h: 792, capped: false });
  assert.equal(policy.planPdfCanvas(612, 792, 1, 3).outputScale, 2);
  const big = policy.planPdfCanvas(612, 792, 5, 2);
  assert.equal(big.outputScale, 1);
  assert.ok(big.width * big.height <= policy.pdfLimits.maxCanvasPixels);
  const huge = policy.planPdfCanvas(14400, 14400, 5, 1);
  assert.equal(huge.capped, true);
  assert.ok(huge.width * huge.height <= policy.pdfLimits.maxCanvasPixels && Math.max(huge.width, huge.height) <= policy.pdfLimits.maxCanvasSide);
  for (const [w, h, z] of [[0, 1, 1], [1, NaN, 1], [1, 1, 0.1], [1, 1, 9], [Infinity, 1, 1]]) { assert.throws(() => policy.planPdfCanvas(w, h, z, 1), RangeError); }
});

test("link subpaths are parsed strictly", () => {
  assert.deepEqual({ ...policy.parsePdfSubpath("#page=3") }, { page: 3 });
  assert.deepEqual({ ...policy.parsePdfSubpath("#page=2&zoom=150") }, { page: 2, zoom: 1.5 });
  for (const bad of ["#page=0", "#page=1&page=2", "#zoom=100", "#page=1&x=2", "#page=-1", "#page=1&zoom=1", "", "#page=1;"]) { assert.throws(() => policy.parsePdfSubpath(bad), undefined, bad); }
  assert.equal(policy.parseVideoSubpath("#t=90").time, 90);
  assert.equal(policy.parseVideoSubpath("#t=1:30.5").time, 90.5);
  assert.equal(policy.parseVideoSubpath("#t=1:02:03").time, 3723);
  for (const bad of ["#t=", "#t=-1", "#t=1:99", "t=5", "#t=5s", "#t=99999999"]) { assert.throws(() => policy.parseVideoSubpath(bad), undefined, bad); }
  assert.equal(policy.mediaSubpathKind("PDF"), "pdf");
  assert.equal(policy.mediaSubpathKind("webm"), "video");
  assert.equal(policy.mediaSubpathKind("png"), null);
});
test("PDF inspection scans valid files up to the transport limit in bounded memory, including chunk boundaries", () => {
  const size = 16 * 1024 * 1024, big = new Uint8Array(size).fill(32);
  big.set(bytes("%PDF-1.7"), 0);
  assert.deepEqual(policy.inspectPdf(big), []);
  const boundary = bytes("/JavaScript"), at = (1 << 20) - 4;
  big.set(boundary, at);
  big.set(bytes("/URI "), size - 8);
  if (global.gc) { global.gc(); }
  const before = process.memoryUsage().heapUsed, started = performance.now();
  const kinds = policy.inspectPdf(big).map(item => item.kind).sort();
  const elapsed = performance.now() - started, grown = process.memoryUsage().heapUsed - before;
  assert.deepEqual(kinds, ["pdf-javascript", "pdf-uri"]);
  assert.ok(grown < 64 * 1024 * 1024, "heap growth " + grown);
  assert.ok(elapsed < 1500, "scan took " + elapsed + " ms");
  const small = new Uint8Array(size / 4).fill(32), t0 = performance.now(); policy.inspectPdf(small); const smallMs = performance.now() - t0;
  assert.ok(elapsed < Math.max(300, smallMs * 8), "scan time scales roughly linearly: " + smallMs + " -> " + elapsed);
});
