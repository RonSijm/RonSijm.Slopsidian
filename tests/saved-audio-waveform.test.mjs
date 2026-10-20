import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let temporary, savedAudioLayout, opusPacketFrames, WaveformJob;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); temporary = await mkdtemp(join(root, ".runtime", "saved-audio-tests-"));
  for (const [name, assign] of [["saved-audio-waveform", value => ({ savedAudioLayout, opusPacketFrames } = value)], ["audio-waveform", value => ({ WaveformJob } = value)]]) {
    const entry = join(temporary, name + ".mjs");
    await build({ entryPoints: [join(root, "client", name + ".ts")], outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
    assign(await import(pathToFileURL(entry).href));
  }
});
after(async () => { if (temporary) await rm(temporary, { recursive: true }); });
const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
const box = (type, ...bytes) => { const body = Buffer.concat(bytes); return Buffer.concat([u32(body.length + 8), Buffer.from(type), body]); };
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const deferred = () => { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const audio = (frames = 640, channels = 1) => ({ length: frames, numberOfChannels: channels, sampleRate: 8000, getChannelData: () => Float32Array.from({ length: frames }, (_, frame) => frame % 2 ? -.25 : .75) });

// These finite structural fixtures exercise preflight only. They do not claim native codec acceptance.
function mp4({ packet = Buffer.from([0x98, 0]), count = 4, channels = 1, duration = 960, start = 0, codec = "Opus", movieDuration = 0, trackDuration = 0, mediaDuration = 0, external = false } = {}) {
  const mvhd = Buffer.alloc(24); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(movieDuration, 16);
  const tkhd = Buffer.alloc(24); tkhd.writeUInt32BE(1, 12); tkhd.writeUInt32BE(trackDuration, 20);
  const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(48000, 12); mdhd.writeUInt32BE(mediaDuration, 16);
  const entry = Buffer.alloc(28); entry.writeUInt16BE(1, 6); entry.writeUInt16BE(channels, 16); entry.writeUInt16BE(16, 18); entry.writeUInt32BE(48000 * 65536, 24);
  const dops = Buffer.alloc(11); dops[1] = channels; dops.writeUInt32BE(48000, 4);
  const tables = box("stbl", box("stsc", u32(0), u32(0)), box("stts", u32(0), u32(0)), box("stsz", u32(0), u32(0), u32(0)), box("stco", u32(0), u32(0)), box("stsd", u32(0), u32(1), box(codec, entry, box("dOps", dops))));
  const media = box("mdia", box("mdhd", mdhd), box("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from("soun")])), box("minf", box("smhd", Buffer.alloc(8)), box("dinf", box("dref", u32(0), u32(1), box("url ", u32(external ? 0 : 1)))), tables));
  const movie = box("moov", box("mvhd", mvhd), box("trak", box("tkhd", tkhd), media), box("mvex", box("trex", u32(0), u32(1), u32(1), u32(0), u32(0), u32(0))));
  const samples = Buffer.concat(Array.from({ length: count }, () => Buffer.concat([u32(duration), u32(packet.length)])));
  const fragment = offset => box("moof", box("mfhd", u32(0), u32(1)), box("traf", box("tfhd", u32(0x020000), u32(1)), box("tfdt", u32(0), u32(start)), box("trun", u32(0x301), u32(count), u32(offset), samples)));
  const moof = fragment(0), data = box("mdat", ...Array.from({ length: count }, () => packet));
  return Buffer.concat([box("ftyp", Buffer.from("isom"), u32(0)), movie, fragment(moof.length + 8), data]);
}
function page(packets, { sequence = 0, serial = 7, flags = 0, granule = 0 } = {}) {
  const lacing = packets.flatMap(packet => [...Array(Math.floor(packet.length / 255)).fill(255), packet.length % 255]);
  const bytes = Buffer.concat([Buffer.alloc(27), Buffer.from(lacing), ...packets]); bytes.write("OggS"); bytes[5] = flags;
  bytes.writeBigUInt64LE(BigInt(granule), 6); bytes.writeUInt32LE(serial, 14); bytes.writeUInt32LE(sequence, 18); bytes[26] = lacing.length;
  let crc = 0; for (const value of bytes) { crc ^= value << 24; for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? crc << 1 ^ 0x04c11db7 : crc << 1; }
  bytes.writeUInt32LE(crc >>> 0, 22); return bytes;
}
function ogg({ packet = Buffer.from([0x98, 0]), count = 4, granule = count * 960, channels = 1, serial = 7, lastSequence = 2, flags = 4, vendor = 0, comments = 0 } = {}) {
  const head = Buffer.alloc(19); head.write("OpusHead"); head[8] = 1; head[9] = channels; head.writeUInt32LE(48000, 12);
  const tags = Buffer.alloc(16); tags.write("OpusTags"); tags.writeUInt32LE(vendor, 8); tags.writeUInt32LE(comments, 12);
  return Buffer.concat([page([head], { flags: 2 }), page([tags], { sequence: 1 }), page(Array.from({ length: count }, () => packet), { sequence: lastSequence, serial, flags, granule })]);
}
function jobFixture(t, { bytes = mp4(), metadata = () => .08, decode = async () => audio(), owns = () => true, yieldWork = async () => {} } = {}) {
  let calls = 0, reads = 0;
  const job = new WaveformJob(() => {}, { decode: async data => { calls++; assert.deepEqual(Buffer.from(data), bytes); return decode(); }, yieldWork });
  const blob = { size: bytes.length, type: "audio/mp4", arrayBuffer: async () => { reads++; return buffer(bytes); } };
  job.setSource({ blob, savedAudioDuration: metadata, owns }); t.after(() => job.dispose());
  return { job, blob, get calls() { return calls; }, get reads() { return reads; } };
}

test("Opus packet output bounds follow all TOC duration families and reject zero/overlong frame counts", () => {
  for (const [toc, frames] of [[0, 480], [8, 960], [16, 1920], [24, 2880], [96, 480], [104, 960], [128, 120], [136, 240], [144, 480], [152, 960]]) assert.equal(opusPacketFrames(Uint8Array.of(toc)), frames);
  assert.equal(opusPacketFrames(Uint8Array.of(153)), 1920); assert.equal(opusPacketFrames(Uint8Array.of(155, 6)), 5760);
  for (const packet of [[], [155], [155, 0], [155, 7], [131, 49]]) assert.throws(() => opusPacketFrames(Uint8Array.from(packet)), /Saved compressed waveforms/);
});
test("finite fragmented Opus MP4 and checksummed single-stream Ogg count real packet duration independently of timestamps", () => {
  for (const [bytes, mime, container] of [[mp4(), "audio/mp4", "mp4-opus"], [ogg(), "audio/ogg;codecs=opus", "ogg-opus"]]) {
    assert.deepEqual(savedAudioLayout(buffer(bytes), mime), { container, channels: 1, packets: 4, packetFrames: 3840, duration: .08 });
  }
  assert.equal(savedAudioLayout(buffer(mp4({ channels: 2 })), "audio/mp4").channels, 2);
});
test("container, movie, track, packet and timestamp budgets reject before native decoder admission", () => {
  const rejected = [mp4({ codec: "mp4a" }), mp4({ channels: 3 }), mp4({ duration: 5761 }), mp4({ start: 1 }), mp4({ movieDuration: 31001 }), mp4({ trackDuration: 31001 }), mp4({ mediaDuration: 1488001 }), mp4({ external: true }), mp4({ packet: Buffer.from([155, 7]) }), mp4({ packet: Buffer.from([155, 6]), count: 259, duration: 1 })];
  for (const bytes of rejected) assert.throws(() => savedAudioLayout(buffer(bytes), "audio/mp4"), /Saved compressed waveforms/);
  for (const mime of ["audio/webm", "audio/mpeg", "video/mp4", "audio/wav"]) assert.throws(() => savedAudioLayout(buffer(mp4()), mime), /Saved compressed waveforms/);
  assert.throws(() => savedAudioLayout(new ArrayBuffer(16 * 1024 * 1024 + 1), "audio/mp4"), /Saved compressed waveforms/);
});
test("MP4 overlapping extents, truncated boxes, alternate tracks, nonempty regular sample tables and external references refuse", () => {
  const original = mp4(), index = value => original.indexOf(value);
  const mutations = [bytes => bytes.writeUInt32BE(0xffffffff, 0), bytes => bytes.writeUInt32BE(1, index("stts") + 8), bytes => bytes.write("vide", index("soun")), bytes => bytes.writeUInt32BE(0, index("trun") + 12), bytes => bytes.writeUInt32BE(100000, index("trun") + 20), bytes => bytes.writeUInt32BE(1, index("dOps") + 4), bytes => bytes.writeUInt32BE(0, index("tfhd") + 4)];
  for (const mutate of mutations) { const bytes = Buffer.from(original); mutate(bytes); assert.throws(() => savedAudioLayout(buffer(bytes), "audio/mp4"), /Saved compressed waveforms/); }
  for (let length = 0; length < original.length; length += 7) assert.throws(() => savedAudioLayout(buffer(original.subarray(0, length)), "audio/mp4"), /Saved compressed waveforms/);
  assert.throws(() => savedAudioLayout(buffer(Buffer.concat([original, box("moov")])), "audio/mp4"), /Saved compressed waveforms/);
});
test("Ogg CRC, chain/serial/order/continuation, over-budget packet output, header and final granule refuse", () => {
  const badCrc = ogg(); badCrc[badCrc.length - 1] ^= 1;
  for (const bytes of [badCrc, ogg({ serial: 8 }), ogg({ lastSequence: 9 }), ogg({ flags: 5 }), ogg({ flags: 0 }), ogg({ channels: 3 }), ogg({ granule: 999999 }), ogg({ granule: 0 }), ogg({ vendor: 0xffffffff }), ogg({ comments: 0xffffffff }), ogg({ packet: Buffer.from([155, 6]), count: 259, granule: 1 })]) assert.throws(() => savedAudioLayout(buffer(bytes), "audio/ogg"), /Saved compressed waveforms/);
  assert.throws(() => savedAudioLayout(buffer(Buffer.concat([ogg(), ogg()])), "audio/ogg"), /Saved compressed waveforms/);
});
test("saved job is explicit, validates finite same-player metadata and produces actual supplied bounded PCM peaks", async t => {
  const f = jobFixture(t); assert.equal(f.calls, 0); assert.equal(f.reads, 0); await f.job.request();
  assert.equal(f.calls, 1); assert.equal(f.job.state, "ready"); assert.equal(f.job.result.method, "saved"); assert.equal(f.job.result.peaks.length, 256); assert.ok(f.job.result.peaks.every(value => value === .75));
  for (const value of [0, -1, NaN, Infinity, 30.001]) { const bad = jobFixture(t, { metadata: () => value }); await bad.job.request(); assert.equal(bad.calls, 0); assert.equal(bad.reads, 0); assert.match(bad.job.message, /finite audio metadata.*30 seconds/); }
});
test("unsupported compressed bytes never decode even with short metadata; direct WAV route remains separate", async t => {
  const f = jobFixture(t, { bytes: mp4({ codec: "mp4a" }) }); await f.job.request(); assert.equal(f.calls, 0); assert.match(f.job.message, /Opus.*audio controls remain available/);
  f.job.setSource({ blob: new Blob([mp4()], { type: "audio/mp4" }), owns: () => true }); await f.job.request(); assert.equal(f.calls, 0); assert.match(f.job.message, /PCM WAV/);
});
test("native returned channel/duration disagreements reject before reading channel views", async t => {
  for (const [frames, channels] of [[640, 2], [640, 33], [1441, 1]]) {
    let reads = 0; const f = jobFixture(t, { decode: async () => ({ length: frames, numberOfChannels: channels, sampleRate: 8000, getChannelData() { reads++; throw Error("unbounded"); } }) });
    await f.job.request(); assert.equal(reads, 0); assert.equal(f.job.state, "unavailable"); assert.match(f.job.message, /bounded Opus layout/);
  }
});
test("metadata changing during immutable byte read or native delivery refuses old output", async t => {
  let duration = .08; const held = deferred(), f = jobFixture(t, { metadata: () => duration, decode: () => held.promise });
  const pending = f.job.request(); await settle(); assert.equal(f.calls, 1); duration = .09; held.resolve(audio()); await pending; assert.equal(f.job.result, null); assert.equal(f.job.state, "unavailable");
  const second = jobFixture(t, { metadata: () => duration }); second.blob.arrayBuffer = async () => { duration = .10; return buffer(mp4()); }; await second.job.request(); assert.equal(second.calls, 0); assert.equal(second.job.result, null);
});
test("saved metadata changing during yielded PCM collection is checked again before publication", async t => {
  let duration = 4, yielded = false; const held = deferred(), bytes = mp4({ count: 200 });
  const f = jobFixture(t, { bytes, metadata: () => duration, decode: async () => audio(32000), yieldWork: async () => { yielded = true; await held.promise; } });
  const pending = f.job.request(); await settle(); assert.equal(yielded, true); assert.equal(f.job.result, null); duration = 4.1; held.resolve(); await pending;
  assert.equal(f.job.state, "unavailable"); assert.equal(f.job.result, null); assert.match(f.job.message, /no longer belongs/);
});
test("cancelled saved native decode and current recordings share the same uncancellable global lease", async t => {
  const held = deferred(), f = jobFixture(t, { decode: () => held.promise }), recording = jobFixture(t);
  const pending = f.job.request(); await settle(); f.job.cancel(); recording.job.setSource({ blob: new Blob([mp4()]), recordingDurationMs: 80, owns: () => true });
  await recording.job.request(); assert.equal(recording.calls, 0); assert.match(recording.job.message, /still finishing/);
  held.resolve(audio()); await pending; assert.equal(f.job.state, "idle"); assert.equal(f.job.result, null);
  await recording.job.request(); assert.equal(recording.calls, 1); assert.equal(recording.job.result.method, "recording");
});
test("source replacement, root ownership retirement and disposal discard native saved results without overlap", async t => {
  for (const mode of ["source", "root", "dispose"]) {
    let owns = true; const held = deferred(), f = jobFixture(t, { decode: () => held.promise, owns: () => owns });
    const pending = f.job.request(); await settle(); assert.equal(f.calls, 1);
    if (mode === "source") f.job.setSource({ blob: f.blob, savedAudioDuration: () => .08, owns: () => true });
    else if (mode === "root") owns = false; else f.job.dispose();
    held.resolve(audio()); await pending; assert.equal(f.job.result, null); assert.notEqual(f.job.state, "ready");
  }
});
test("saved decoder errors are a retryable waveform-only failure", async t => {
  let fail = true; const f = jobFixture(t, { decode: async () => { if (fail) throw Error("codec unavailable"); return audio(); } });
  await f.job.request(); assert.equal(f.job.result, null); assert.equal(f.job.source.blob, f.blob); assert.match(f.job.message, /codec unavailable.*audio controls remain available/);
  fail = false; await f.job.request(); assert.equal(f.calls, 2); assert.equal(f.job.state, "ready");
});
