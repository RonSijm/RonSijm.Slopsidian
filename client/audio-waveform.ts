import { MAX_BINARY_BYTES } from "./binary";
import { savedAudioLayout, SAVED_WAVEFORM_CHANNELS, SAVED_WAVEFORM_SECONDS, type SavedAudioLayout } from "./saved-audio-waveform";

export const WAVEFORM_BINS = 256;
export const WAVEFORM_RECORDING_SECONDS = 30;
export const WAVEFORM_SAMPLE_RATE = 8000;
export const WAVEFORM_MAX_CHANNELS = 32;
export const WAVEFORM_MAX_PCM_BYTES = 32 * 1024 * 1024;
export const WAVEFORM_MAX_WAV_SECONDS = 10 * 60;
const DECODE_SECONDS = WAVEFORM_RECORDING_SECONDS + 1; // Encoder framing may extend a short clip slightly.
const WORK_FRAMES = 16384;
const WORK_TIMEOUT_MS = 15000;

export interface WaveformData {
  readonly peaks: readonly number[];
  readonly duration: number;
  readonly channels: number;
  readonly frames: number;
  readonly sampleRate: number;
  readonly method: "wav" | "recording" | "saved";
  readonly compressed?: SavedAudioLayout;
}
export interface WaveformSource {
  readonly blob: Blob;
  /** Current browser MediaRecorder output has a separately bounded active capture duration. */
  readonly recordingDurationMs?: number;
  /** Saved compressed files additionally need finite metadata from this same owned native player. */
  readonly savedAudioDuration?: () => number;
  readonly owns: () => boolean;
}
export interface DecodedWaveformAudio {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}
export interface WaveformEnvironment {
  decode(data: ArrayBuffer): Promise<DecodedWaveformAudio>;
  yieldWork(): Promise<void>;
}
export interface PcmWavLayout {
  readonly format: 1 | 3;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bits: number;
  readonly blockAlign: number;
  readonly dataOffset: number;
  readonly dataBytes: number;
  readonly frames: number;
}

const unavailableWav = "Waveforms for saved files support uncompressed PCM WAV (8, 16, 24 or 32 bit) and 32-bit float WAV. The audio controls remain available.";
const stale = (): Error => new Error("This waveform no longer belongs to the current audio clip.");
const fourCC = (data: DataView, offset: number): string => String.fromCharCode(data.getUint8(offset), data.getUint8(offset + 1), data.getUint8(offset + 2), data.getUint8(offset + 3));
// A retired native decode cannot be aborted. Keep its single global lease until it actually settles.
let activeWork: symbol | null = null;

function environment(): WaveformEnvironment {
  return {
    async decode(data) {
      if (typeof OfflineAudioContext !== "function") { throw new Error("This host cannot build a decoded audio waveform. The audio controls remain available."); }
      // No device, microphone, output connection or rendering is started. decodeAudioData resamples to 8 kHz.
      const context = new OfflineAudioContext(1, 1, WAVEFORM_SAMPLE_RATE);
      return await context.decodeAudioData(data);
    },
    yieldWork: () => new Promise(resolve => setTimeout(resolve, 0)),
  };
}

/** Parse bounded RIFF PCM directly; never give an arbitrary vault file to a native PCM-expanding decoder. */
export function pcmWavLayout(bytes: ArrayBuffer): PcmWavLayout {
  if (bytes.byteLength > MAX_BINARY_BYTES || bytes.byteLength < 44) { throw new Error(unavailableWav); }
  const data = new DataView(bytes);
  if (fourCC(data, 0) !== "RIFF" || fourCC(data, 8) !== "WAVE" || data.getUint32(4, true) !== bytes.byteLength - 8) { throw new Error(unavailableWav); }
  let position = 12, chunks = 0, format: PcmWavLayout["format"] | undefined;
  let channels = 0, sampleRate = 0, bits = 0, blockAlign = 0, dataOffset = 0, dataBytes = 0;
  while (position < bytes.byteLength) {
    if (++chunks > 1024 || position + 8 > bytes.byteLength) { throw new Error("The WAV chunk layout is invalid or exceeds the waveform limit. Playback remains available."); }
    const id = fourCC(data, position), size = data.getUint32(position + 4, true), offset = position + 8, end = offset + size;
    if (end > bytes.byteLength || end + (size & 1) > bytes.byteLength) { throw new Error("The WAV chunk extends past its recorded bytes. Playback remains available."); }
    if (id === "fmt ") {
      if (format !== undefined || size < 16) { throw new Error(unavailableWav); }
      const kind = data.getUint16(offset, true);
      channels = data.getUint16(offset + 2, true); sampleRate = data.getUint32(offset + 4, true);
      blockAlign = data.getUint16(offset + 12, true); bits = data.getUint16(offset + 14, true);
      if ((kind !== 1 && kind !== 3) || channels < 1 || channels > WAVEFORM_MAX_CHANNELS || sampleRate < 1 || sampleRate > 384000 ||
          (kind === 1 ? ![8, 16, 24, 32].includes(bits) : bits !== 32) || blockAlign !== channels * bits / 8 || data.getUint32(offset + 8, true) !== sampleRate * blockAlign) { throw new Error(unavailableWav); }
      format = kind;
    } else if (id === "data") {
      if (dataOffset !== 0) { throw new Error("Multiple WAV data chunks are outside the waveform subset. Playback remains available."); }
      dataOffset = offset; dataBytes = size;
    }
    position = end + (size & 1);
  }
  if (format === undefined || !dataOffset || !dataBytes || dataBytes % blockAlign !== 0) { throw new Error(unavailableWav); }
  const frames = dataBytes / blockAlign;
  if (frames / sampleRate > WAVEFORM_MAX_WAV_SECONDS) { throw new Error("WAV waveforms are limited to 10 minutes and 16 MiB. The audio controls remain available."); }
  return { format, channels, sampleRate, bits, blockAlign, dataOffset, dataBytes, frames };
}

async function collectPeaks(frames: number, channels: number, read: (frame: number, channel: number) => number,
  current: () => boolean, yieldWork: () => Promise<void>): Promise<readonly number[]> {
  const peaks = Array<number>(WAVEFORM_BINS).fill(0);
  for (let start = 0; start < frames; start += WORK_FRAMES) {
    if (!current()) { throw stale(); }
    const end = Math.min(frames, start + WORK_FRAMES);
    for (let frame = start; frame < end; frame++) {
      const bin = Math.min(WAVEFORM_BINS - 1, Math.floor(frame * WAVEFORM_BINS / frames));
      for (let channel = 0; channel < channels; channel++) {
        const value = read(frame, channel), magnitude = Number.isFinite(value) ? Math.min(1, Math.abs(value)) : 0;
        if (magnitude > peaks[bin]!) { peaks[bin] = magnitude; }
      }
    }
    if (end < frames) { await yieldWork(); }
  }
  if (!current()) { throw stale(); }
  return peaks;
}

export async function pcmWavWaveform(bytes: ArrayBuffer, current: () => boolean = () => true,
  yieldWork: () => Promise<void> = environment().yieldWork): Promise<WaveformData> {
  const layout = pcmWavLayout(bytes), data = new DataView(bytes), sampleBytes = layout.bits / 8;
  const read = (frame: number, channel: number): number => {
    const offset = layout.dataOffset + frame * layout.blockAlign + channel * sampleBytes;
    if (layout.format === 3) { return data.getFloat32(offset, true); }
    switch (layout.bits) {
      case 8: return (data.getUint8(offset) - 128) / 128;
      case 16: return data.getInt16(offset, true) / 32768;
      case 24: return ((data.getUint8(offset) | data.getUint8(offset + 1) << 8 | data.getUint8(offset + 2) << 16) << 8 >> 8) / 8388608;
      default: return data.getInt32(offset, true) / 2147483648;
    }
  };
  const peaks = await collectPeaks(layout.frames, layout.channels, read, current, yieldWork);
  return { peaks, duration: layout.frames / layout.sampleRate, frames: layout.frames, channels: layout.channels, sampleRate: layout.sampleRate, method: "wav" };
}

export async function decodedRecordingWaveform(audio: DecodedWaveformAudio, current: () => boolean = () => true,
  yieldWork: () => Promise<void> = environment().yieldWork, method: "recording" | "saved" = "recording"): Promise<WaveformData> {
  if (!current()) { throw stale(); }
  const frames = audio.length, channels = audio.numberOfChannels, sampleRate = audio.sampleRate;
  if (!Number.isInteger(frames) || frames < 1 || frames > DECODE_SECONDS * WAVEFORM_SAMPLE_RATE || !Number.isInteger(channels) || channels < 1 || channels > WAVEFORM_MAX_CHANNELS ||
      sampleRate !== WAVEFORM_SAMPLE_RATE || frames * channels * 4 > WAVEFORM_MAX_PCM_BYTES) { throw new Error("The decoded recording exceeds the waveform PCM budget. The audio controls remain available."); }
  // These are views over the already bounded native buffer, not copied PCM arrays.
  const samples = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
  if (samples.some(channel => channel.length !== frames)) { throw new Error("The decoded waveform has an inconsistent PCM layout. Playback remains available."); }
  const peaks = await collectPeaks(frames, channels, (frame, channel) => samples[channel]![frame]!, current, yieldWork);
  return { peaks, duration: frames / sampleRate, channels, frames, sampleRate, method };
}

export class WaveformJob {
  state: "empty" | "idle" | "loading" | "ready" | "unavailable" = "empty";
  message = "";
  result: WaveformData | null = null;
  private source: WaveformSource | null = null;
  private generation = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;

  constructor(private readonly changed: () => void = () => {}, private readonly host = environment()) {}

  setSource(source: WaveformSource | null): void {
    if (this.disposed) { return; }
    this.retire(); this.source = source; this.result = null;
    this.state = source ? "idle" : "empty";
    this.message = source ? "Show a waveform of this clip. Playback and seeking use the audio controls." : "";
    this.changed();
  }
  cancel(): void {
    if (this.disposed) { return; }
    this.retire(); this.result = null; this.state = this.source ? "idle" : "empty";
    this.message = this.source ? "Waveform cancelled. The audio controls remain available." : ""; this.changed();
  }
  dispose(): void { this.retire(); this.disposed = true; this.source = null; this.result = null; this.state = "empty"; this.message = ""; }

  request(): Promise<void> {
    if (this.pending) { return this.pending; }
    const source = this.source;
    if (this.disposed || !source) { return Promise.resolve(); }
    const generation = ++this.generation;
    const current = (): boolean => !this.disposed && generation === this.generation && this.source === source && source.owns();
    const reject = (message: string): Promise<void> => { this.result = null; this.state = "unavailable"; this.message = message; this.changed(); return Promise.resolve(); };
    if (!current()) { return reject(stale().message); }
    if (source.blob.size < 1 || source.blob.size > MAX_BINARY_BYTES) { return reject("Waveforms are limited to nonempty audio clips up to 16 MiB. The audio controls remain available."); }
    if (source.recordingDurationMs !== undefined && (!Number.isFinite(source.recordingDurationMs) || source.recordingDurationMs <= 0 || source.recordingDurationMs > WAVEFORM_RECORDING_SECONDS * 1000)) {
      return reject("Recorded-clip waveforms are limited to 30 seconds of active recording. The full clip remains playable and saveable.");
    }
    let savedDuration: number | undefined;
    if (source.savedAudioDuration) {
      try { savedDuration = source.savedAudioDuration(); } catch { savedDuration = NaN; }
      if (source.recordingDurationMs !== undefined || !Number.isFinite(savedDuration) || savedDuration <= 0 || savedDuration > SAVED_WAVEFORM_SECONDS) {
        return reject("Saved compressed waveforms need loaded, finite audio metadata of at most 30 seconds. The audio controls remain available.");
      }
    }
    if (activeWork !== null) { return reject("Another waveform is still finishing. Try Show waveform again shortly; the audio controls remain available."); }
    const lease = Symbol("waveform"); activeWork = lease;
    this.state = "loading"; this.message = "Building waveform… Playback remains available."; this.result = null; this.changed();
    this.timer = setTimeout(() => {
      if (!current()) { return; }
      this.retire(); this.state = "unavailable"; this.message = "Waveform generation timed out. The audio controls remain available."; this.changed();
    }, WORK_TIMEOUT_MS);
    const operation = (async (): Promise<void> => {
      try {
        const bytes = await source.blob.arrayBuffer();
        if (!current()) { return; }
        if (bytes.byteLength !== source.blob.size || bytes.byteLength > MAX_BINARY_BYTES) { throw new Error("The waveform source bytes changed or exceed 16 MiB. Playback remains available."); }
        let result: WaveformData;
        if (source.savedAudioDuration) {
          const layout = savedAudioLayout(bytes, source.blob.type);
          if (!current()) { return; }
          if (source.savedAudioDuration() !== savedDuration) { throw stale(); }
          // Packet output and timestamp bounds are checked before native work. A native decoder's
          // internal allocation is not controlled by OfflineAudioContext; returned PCM is checked too.
          const decoded = await this.host.decode(bytes);
          if (!current()) { return; }
          if (source.savedAudioDuration() !== savedDuration) { throw stale(); }
          if (decoded.numberOfChannels !== layout.channels || decoded.numberOfChannels > SAVED_WAVEFORM_CHANNELS ||
              decoded.length > Math.ceil(layout.packetFrames * WAVEFORM_SAMPLE_RATE / 48000) + WAVEFORM_SAMPLE_RATE / 10) {
            throw new Error("The decoded saved audio does not match its bounded Opus layout. The audio controls remain available.");
          }
          result = { ...await decodedRecordingWaveform(decoded, current, this.host.yieldWork, "saved"), compressed: layout };
        } else if (source.recordingDurationMs === undefined) { result = await pcmWavWaveform(bytes, current, this.host.yieldWork); }
        else {
          const decoded = await this.host.decode(bytes);
          if (!current()) { return; }
          result = await decodedRecordingWaveform(decoded, current, this.host.yieldWork);
        }
        if (!current()) { return; }
        if (source.savedAudioDuration && source.savedAudioDuration() !== savedDuration) { throw stale(); }
        this.result = result; this.state = "ready";
        this.message = `Audio waveform · ${result.duration.toFixed(2)} seconds · ${result.channels} ${result.channels === 1 ? "channel" : "channels"}. Playback and seeking use the audio controls.`;
      } catch (error) {
        if (!current()) { return; }
        this.state = "unavailable";
        const reason = error instanceof Error ? error.message.slice(0, 400) : "The waveform could not be decoded.";
        this.message = /audio controls|playback remains/i.test(reason) ? reason : reason + " The audio controls remain available.";
      } finally {
        if (activeWork === lease) { activeWork = null; }
        if (generation === this.generation) {
          this.clearTimer(); this.pending = null;
          if (!source.owns()) { this.result = null; this.state = "unavailable"; this.message = stale().message; }
          this.changed();
        }
      }
    })();
    this.pending = operation;
    return operation;
  }

  private clearTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
  private retire(): void { this.generation++; this.clearTimer(); this.pending = null; }
}

/** A noninteractive visual beside the native player; it never changes playback, source URLs or capture. */
export class AudioWaveform {
  readonly element = document.createElement("figure");
  readonly job = new WaveformJob(() => this.render());
  private readonly show = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private readonly caption = document.createElement("figcaption");
  private readonly graph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private readonly listeners = new AbortController();
  private drawn: WaveformData | null = null;

  constructor() {
    this.element.className = "audio-waveform"; this.element.dataset.audioWaveform = ""; this.element.hidden = true;
    this.show.type = "button"; this.show.textContent = "Show waveform"; this.show.dataset.waveformAction = "show";
    this.cancel.type = "button"; this.cancel.textContent = "Cancel waveform"; this.cancel.dataset.waveformAction = "cancel"; this.cancel.hidden = true;
    this.caption.className = "audio-waveform-status muted"; this.caption.setAttribute("role", "status");
    this.graph.classList.add("audio-waveform-graph"); this.graph.setAttribute("viewBox", `0 0 ${WAVEFORM_BINS * 3} 100`);
    this.graph.setAttribute("role", "img"); this.graph.setAttribute("aria-label", "Audio waveform"); this.graph.setAttribute("hidden", "");
    this.show.addEventListener("click", () => { if (this.element.isConnected) { void this.job.request(); } }, { signal: this.listeners.signal });
    this.cancel.addEventListener("click", () => { if (this.element.isConnected) { this.job.cancel(); } }, { signal: this.listeners.signal });
    const actions = document.createElement("div"); actions.className = "audio-waveform-actions"; actions.append(this.show, this.cancel);
    this.element.append(actions, this.caption, this.graph);
  }
  setSource(source: WaveformSource | null): void { this.job.setSource(source); }
  dispose(): void { this.listeners.abort(); this.job.dispose(); this.drawn = null; this.graph.replaceChildren(); }

  private render(): void {
    const job = this.job;
    this.element.hidden = job.state === "empty";
    this.element.dataset.waveformState = job.state;
    this.element.setAttribute("aria-busy", String(job.state === "loading"));
    this.show.disabled = job.state === "loading" || job.state === "ready";
    this.cancel.hidden = job.state !== "loading"; this.caption.textContent = job.message;
    this.graph.toggleAttribute("hidden", job.state !== "ready");
    if (job.result !== this.drawn) {
      this.drawn = job.result; this.graph.replaceChildren();
      if (job.result) {
        for (let bin = 0; bin < job.result.peaks.length; bin++) {
          const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect"), height = Math.max(1, job.result.peaks[bin]! * 96);
          bar.setAttribute("x", String(bin * 3)); bar.setAttribute("y", String(50 - height / 2)); bar.setAttribute("width", "2"); bar.setAttribute("height", String(height));
          this.graph.append(bar);
        }
        this.graph.dataset.waveformBins = String(job.result.peaks.length);
        this.graph.setAttribute("aria-label", `Audio waveform, ${job.result.duration.toFixed(2)} seconds, ${job.result.channels} ${job.result.channels === 1 ? "channel" : "channels"}. Playback and seeking use the audio controls.`);
      } else { delete this.graph.dataset.waveformBins; }
    }
  }
}
