import { MAX_BINARY_BYTES } from "./binary";

/** A deliberately small, inspected subset, not a general media demuxer or a decoder sandbox. */
export const SAVED_WAVEFORM_SECONDS = 30;
export const SAVED_WAVEFORM_CHANNELS = 2;
const MAX_SAMPLES = 31 * 48000; // Includes encoder pre-skip / final packet framing.
const MAX_PACKETS = 12400;
const MAX_STRUCTURES = 4096;
const unsupported = (): Error => new Error("Saved compressed waveforms support short mono/stereo Opus in fragmented MP4/M4A or single-stream Ogg. PCM WAV is also supported. The audio controls remain available.");
const invalid = (): never => { throw unsupported(); };
const text = (data: DataView, offset: number, length: number): string => Array.from({ length }, (_, index) => String.fromCharCode(data.getUint8(offset + index))).join("");

export interface SavedAudioLayout {
  readonly container: "mp4-opus" | "ogg-opus";
  readonly channels: number;
  readonly packets: number;
  /** Total codec packet output before pre-skip, independent of container timestamps. */
  readonly packetFrames: number;
  readonly duration: number;
}

/** RFC 6716 section 3: packet duration from TOC, never from a filename or duration tag. */
export function opusPacketFrames(data: Uint8Array): number {
  if (data.length < 1 || data.length > 65536) { return invalid(); }
  const toc = data[0]!, config = toc >> 3, code = toc & 3;
  const perFrame = config < 12 ? [480, 960, 1920, 2880][config & 3]! : config < 16 ? [480, 960][config & 1]! : [120, 240, 480, 960][config & 3]!;
  const count = code === 0 ? 1 : code !== 3 ? 2 : data.length >= 2 ? data[1]! & 63 : 0;
  const frames = count * perFrame;
  if (!count || count > 48 || frames > 5760) { return invalid(); }
  return frames;
}

interface Box { readonly type: string; readonly start: number; readonly data: number; readonly end: number; }
function mp4Layout(bytes: ArrayBuffer): SavedAudioLayout {
  const data = new DataView(bytes), raw = new Uint8Array(bytes);
  let structures = 0;
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    while (start < end) {
      if (++structures > MAX_STRUCTURES || start + 8 > end) { return invalid(); }
      const size = data.getUint32(start);
      // Extended/implicit lengths and external offsets are outside this finite subset.
      if (size < 8 || start + size > end) { return invalid(); }
      result.push({ type: text(data, start + 4, 4), start, data: start + 8, end: start + size }); start += size;
    }
    return result;
  };
  const children = (box: Box, types: readonly string[]): Box[] => {
    const list = boxes(box.data, box.end);
    if (list.some(child => !types.includes(child.type))) { return invalid(); }
    return list;
  };
  const one = (list: readonly Box[], type: string): Box => { const found = list.filter(box => box.type === type); return found.length === 1 ? found[0]! : invalid(); };
  const length = (box: Box, size: number): void => { if (box.end - box.data !== size) { invalid(); } };
  const top = boxes(0, bytes.byteLength);
  if (top.length < 4 || top[0]?.type !== "ftyp" || top[1]?.type !== "moov" || top[0].end - top[0].data < 8 || top.length % 2 !== 0) { return invalid(); }
  const moov = children(top[1]!, ["mvhd", "trak", "mvex"]), movie = one(moov, "mvhd");
  if (movie.end - movie.data < 24 || data.getUint8(movie.data) > 1) { return invalid(); }
  const movieVersion = data.getUint8(movie.data);
  if (movieVersion && movie.end - movie.data < 36) { return invalid(); }
  const movieScale = data.getUint32(movie.data + (movieVersion ? 20 : 12));
  const movieFrames = movieVersion ? Number(data.getBigUint64(movie.data + 24)) : data.getUint32(movie.data + 16);
  if (!movieScale || movieScale > 384000 || !Number.isSafeInteger(movieFrames) || movieFrames > 31 * movieScale) { return invalid(); }
  const track = children(one(moov, "trak"), ["tkhd", "mdia"]), tkhd = one(track, "tkhd");
  if (tkhd.end - tkhd.data < 24 || data.getUint8(tkhd.data) > 1) { return invalid(); }
  const id = data.getUint32(tkhd.data + (data.getUint8(tkhd.data) ? 20 : 12));
  if (!id) { return invalid(); }
  const trackVersion = data.getUint8(tkhd.data);
  if (trackVersion && tkhd.end - tkhd.data < 36) { return invalid(); }
  const trackFrames = trackVersion ? Number(data.getBigUint64(tkhd.data + 28)) : data.getUint32(tkhd.data + 20);
  if (!Number.isSafeInteger(trackFrames) || trackFrames > 31 * movieScale) { return invalid(); }
  const media = children(one(track, "mdia"), ["mdhd", "hdlr", "minf"]), mdhd = one(media, "mdhd"), handler = one(media, "hdlr");
  if (handler.end - handler.data < 12 || text(data, handler.data + 8, 4) !== "soun" || mdhd.end - mdhd.data < 24 || data.getUint8(mdhd.data) > 1) { return invalid(); }
  const version = data.getUint8(mdhd.data), scale = data.getUint32(mdhd.data + (version ? 20 : 12));
  if (scale !== 48000 || (version && mdhd.end - mdhd.data < 36)) { return invalid(); }
  const declared = version ? Number(data.getBigUint64(mdhd.data + 24)) : data.getUint32(mdhd.data + 16);
  if (!Number.isSafeInteger(declared) || declared > MAX_SAMPLES) { return invalid(); }
  const minf = children(one(media, "minf"), ["smhd", "dinf", "stbl"]);
  one(minf, "smhd");
  const references = one(children(one(minf, "dinf"), ["dref"]), "dref");
  if (references.end - references.data < 8 || data.getUint32(references.data) || data.getUint32(references.data + 4) !== 1) { return invalid(); }
  const urls = boxes(references.data + 8, references.end), url = one(urls, "url ");
  if (urls.length !== 1 || url.end - url.data < 4 || url.end - url.data > 5 || data.getUint32(url.data) !== 1 || (url.end - url.data === 5 && data.getUint8(url.data + 4))) { return invalid(); }
  const tables = children(one(minf, "stbl"), ["stsd", "stts", "stsc", "stsz", "stco"]);
  for (const type of ["stts", "stsc", "stco"]) { const box = one(tables, type); length(box, 8); if (data.getUint32(box.data) || data.getUint32(box.data + 4)) { return invalid(); } }
  const sizes = one(tables, "stsz"); length(sizes, 12); if (data.getUint32(sizes.data) || data.getUint32(sizes.data + 4) || data.getUint32(sizes.data + 8)) { return invalid(); }
  const stsd = one(tables, "stsd");
  if (stsd.end - stsd.data < 16 || data.getUint32(stsd.data) || data.getUint32(stsd.data + 4) !== 1) { return invalid(); }
  const entries = boxes(stsd.data + 8, stsd.end), entry = one(entries, "Opus");
  if (entries.length !== 1 || entry.end - entry.data < 28 || data.getUint16(entry.data + 6) !== 1 || data.getUint32(entry.data + 8) || data.getUint32(entry.data + 12)) { return invalid(); }
  const channels = data.getUint16(entry.data + 16);
  if (channels < 1 || channels > SAVED_WAVEFORM_CHANNELS || data.getUint32(entry.data + 24) !== 48000 * 65536) { return invalid(); }
  const config = boxes(entry.data + 28, entry.end);
  if (config.some(box => !["btrt", "dOps"].includes(box.type))) { return invalid(); }
  const dops = one(config, "dOps"); length(dops, 11);
  if (data.getUint8(dops.data) || data.getUint8(dops.data + 1) !== channels || data.getUint8(dops.data + 10) || data.getUint16(dops.data + 2) > 48000) { return invalid(); }
  const trex = one(children(one(moov, "mvex"), ["trex"]), "trex"); length(trex, 24);
  if (data.getUint32(trex.data) || data.getUint32(trex.data + 4) !== id || data.getUint32(trex.data + 8) !== 1) { return invalid(); }
  let packetFrames = 0, packets = 0, endTime = 0;
  for (let index = 2; index < top.length; index += 2) {
    const moof = top[index]!, mdat = top[index + 1]!;
    if (moof.type !== "moof" || mdat.type !== "mdat") { return invalid(); }
    const fragment = children(moof, ["mfhd", "traf"]); one(fragment, "mfhd");
    const traf = children(one(fragment, "traf"), ["tfhd", "tfdt", "trun"]), tfhd = one(traf, "tfhd"), tfdt = one(traf, "tfdt");
    if (tfhd.end - tfhd.data < 8 || data.getUint8(tfhd.data) || data.getUint32(tfhd.data + 4) !== id) { return invalid(); }
    const flags = data.getUint32(tfhd.data) & 0xffffff;
    if (!(flags & 0x020000) || flags & ~0x020038) { return invalid(); }
    let at = tfhd.data + 8, defaultDuration = data.getUint32(trex.data + 12), defaultSize = data.getUint32(trex.data + 16);
    if (flags & 8) { if (at + 4 > tfhd.end) { return invalid(); } defaultDuration = data.getUint32(at); at += 4; }
    if (flags & 16) { if (at + 4 > tfhd.end) { return invalid(); } defaultSize = data.getUint32(at); at += 4; }
    if (flags & 32) { at += 4; }
    if (at !== tfhd.end || tfdt.end - tfdt.data < 8 || data.getUint8(tfdt.data) > 1) { return invalid(); }
    const longTime = data.getUint8(tfdt.data) === 1; length(tfdt, longTime ? 12 : 8);
    let time = longTime ? Number(data.getBigUint64(tfdt.data + 4)) : data.getUint32(tfdt.data + 4);
    if (!Number.isSafeInteger(time) || time < endTime || time > MAX_SAMPLES || (!packets && time !== 0)) { return invalid(); }
    let used = mdat.data;
    const runs = traf.filter(box => box.type === "trun"); if (!runs.length) { return invalid(); }
    for (const run of runs) {
      if (run.end - run.data < 12 || data.getUint8(run.data) > 1) { return invalid(); }
      const mask = data.getUint32(run.data) & 0xffffff, count = data.getUint32(run.data + 4);
      if (!(mask & 1) || mask & ~0x000705 || !count || packets + count > MAX_PACKETS) { return invalid(); }
      let offset = run.data + 12;
      if (moof.start + data.getInt32(run.data + 8) !== used) { return invalid(); }
      if (mask & 4) { offset += 4; }
      const width = ((mask & 0x100 ? 1 : 0) + (mask & 0x200 ? 1 : 0) + (mask & 0x400 ? 1 : 0)) * 4;
      if (offset + count * width !== run.end) { return invalid(); }
      for (let sample = 0; sample < count; sample++) {
        const duration = mask & 0x100 ? data.getUint32(offset) : defaultDuration; if (mask & 0x100) { offset += 4; }
        const size = mask & 0x200 ? data.getUint32(offset) : defaultSize; if (mask & 0x200) { offset += 4; }
        if (mask & 0x400) { offset += 4; }
        if (!duration || duration > 5760 || !size || size > 65536 || used + size > mdat.end) { return invalid(); }
        packetFrames += opusPacketFrames(raw.subarray(used, used + size)); packets++; used += size; time += duration;
        if (packetFrames > MAX_SAMPLES || time > MAX_SAMPLES) { return invalid(); }
      }
    }
    if (used !== mdat.end) { return invalid(); } endTime = time;
  }
  if (!packets || !packetFrames || !endTime) { return invalid(); }
  return { container: "mp4-opus", channels, packets, packetFrames, duration: endTime / 48000 };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value << 24;
  for (let bit = 0; bit < 8; bit++) { crc = crc & 0x80000000 ? crc << 1 ^ 0x04c11db7 : crc << 1; }
  return crc >>> 0;
});

function oggLayout(bytes: ArrayBuffer): SavedAudioLayout {
  const data = new DataView(bytes), raw = new Uint8Array(bytes);
  let offset = 0, pages = 0, serial = -1, sequence = 0, count = 0, channels = 0, preSkip = 0, packetFrames = 0, granule = 0, ended = false;
  let packetStart = -1, packetSize = 0;
  while (offset < raw.length) {
    if (++pages > MAX_STRUCTURES || ended || offset + 27 > raw.length || text(data, offset, 4) !== "OggS" || data.getUint8(offset + 4)) { return invalid(); }
    const flags = data.getUint8(offset + 5), segments = data.getUint8(offset + 26), payload = offset + 27 + segments;
    if (flags & ~7 || payload > raw.length || flags & 1 || packetSize || (pages === 1 ? flags !== 2 : Boolean(flags & 2))) { return invalid(); }
    const stream = data.getUint32(offset + 14, true), number = data.getUint32(offset + 18, true);
    if (serial === -1) { serial = stream; } if (stream !== serial || number !== sequence++) { return invalid(); }
    const position = data.getBigUint64(offset + 6, true);
    if (position > BigInt(MAX_SAMPLES)) { return invalid(); }
    granule = Number(position);
    let end = payload; for (let index = 0; index < segments; index++) { end += raw[offset + 27 + index]!; }
    if (end > raw.length) { return invalid(); }
    // Verify CRC without copying or accepting unvalidated alternate page payloads.
    let crc = 0;
    for (let index = offset; index < end; index++) {
      const value = index >= offset + 22 && index < offset + 26 ? 0 : raw[index]!;
      crc = crc << 8 ^ crcTable[(crc >>> 24 ^ value) & 255]!;
    }
    if ((crc >>> 0) !== data.getUint32(offset + 22, true)) { return invalid(); }
    let cursor = payload;
    for (let index = 0; index < segments; index++) {
      const size = raw[offset + 27 + index]!; if (packetStart < 0) { packetStart = cursor; }
      packetSize += size; cursor += size;
      if (packetSize > 65536) { return invalid(); }
      if (size < 255) {
        const packet = raw.subarray(packetStart, cursor);
        if (count === 0) {
          if (packetSize !== 19 || text(data, packetStart, 8) !== "OpusHead" || packet[8] !== 1 || packet[18] !== 0 || (packet[9] !== 1 && packet[9] !== 2)) { return invalid(); }
          channels = packet[9]!; preSkip = data.getUint16(packetStart + 10, true); if (preSkip > 48000 || granule) { return invalid(); }
        } else if (count === 1) {
          if (packetSize < 16 || text(data, packetStart, 8) !== "OpusTags") { return invalid(); }
          let at = packetStart + 12 + data.getUint32(packetStart + 8, true);
          if (at + 4 > cursor) { return invalid(); }
          const comments = data.getUint32(at, true); at += 4;
          if (comments > 1024) { return invalid(); }
          for (let comment = 0; comment < comments; comment++) {
            if (at + 4 > cursor) { return invalid(); }
            const length = data.getUint32(at, true); at += 4 + length;
            if (at > cursor) { return invalid(); }
          }
        } else {
          packetFrames += opusPacketFrames(packet); if (packetFrames > MAX_SAMPLES || count - 1 > MAX_PACKETS) { return invalid(); }
        }
        count++; packetStart = -1; packetSize = 0;
      }
    }
    // Cross-page continuation, chained streams and sparse timestamps are deliberately excluded.
    if (packetSize || granule > packetFrames || (count <= 2 && granule)) { return invalid(); }
    ended = Boolean(flags & 4); offset = end;
  }
  if (!ended || count < 3 || granule <= preSkip) { return invalid(); }
  return { container: "ogg-opus", channels, packets: count - 2, packetFrames, duration: (granule - preSkip) / 48000 };
}

/** Inspect every packet and timestamp before the explicit native decode. Does not allocate PCM. */
export function savedAudioLayout(bytes: ArrayBuffer, mime: string): SavedAudioLayout {
  if (!bytes.byteLength || bytes.byteLength > MAX_BINARY_BYTES) { return invalid(); }
  const type = mime.split(";", 1)[0]?.trim().toLowerCase();
  try {
    if (type === "audio/mp4") { return mp4Layout(bytes); }
    if (type === "audio/ogg") { return oggLayout(bytes); }
  } catch (error) { if (error instanceof RangeError) { return invalid(); } throw error; }
  return invalid();
}
