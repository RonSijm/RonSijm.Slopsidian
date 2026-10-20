import { MAX_BINARY_BYTES } from "./binary";

export type CaptureState = "idle" | "requesting" | "recording" | "stopping" | "ready" | "error" | "disposed";
export const MAX_RECORDING_MS = 10 * 60 * 1000;
export const AUDIO_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"] as const;
export interface CaptureEnvironment {
  acquire(): Promise<MediaStream>;
  supports(type: string): boolean;
  create(stream: MediaStream, type: string): MediaRecorder;
  now(): number;
}
function environment(): CaptureEnvironment {
  return {
    acquire: () => {
      if (!navigator.mediaDevices?.getUserMedia) { throw new Error("Microphone capture requires a supported browser over HTTPS/localhost."); }
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    },
    supports: type => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
    create: (stream, mimeType) => new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 }),
    now: () => Date.now(),
  };
}
export function audioExtension(type: string): "m4a" | "webm" | "ogg" {
  switch (type.split(";")[0].trim().toLowerCase()) {
    case "audio/mp4": return "m4a";
    case "audio/webm": return "webm";
    case "audio/ogg": return "ogg";
    default: throw new Error("The recorder returned an unsupported audio format.");
  }
}
export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") { return "Microphone permission was denied. Allow microphone access in the browser/OS and try again."; }
  if (name === "NotFoundError" || name === "OverconstrainedError") { return "No usable microphone was found. Connect or select an audio input device and try again."; }
  if (name === "NotReadableError" || name === "AbortError") { return "The microphone could not be opened. Check whether another application or the OS is blocking it."; }
  return error instanceof Error ? error.message : String(error);
}

/** Owns microphone tracks and encoder callbacks, including late permission results. */
export class AudioCapture {
  state: CaptureState = "idle";
  message = "Ready. Start recording to request microphone access.";
  data: Blob | null = null;
  mime = "";
  bytes = 0;
  durationMs = 0;
  private epoch = 0;
  private started = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private stopDeadline: ReturnType<typeof setTimeout> | null = null;
  private stopResult: { promise: Promise<void>; resolve: () => void } | null = null;
  private listeners: (() => void)[] = [];

  constructor(private readonly changed: () => void = () => {}, private readonly host = environment()) {}
  get elapsedMs(): number { return this.state === "recording" ? Math.max(0, this.host.now() - this.started) : this.durationMs; }
  get liveTracks(): number { return this.stream?.getTracks().filter(track => track.readyState !== "ended").length ?? 0; }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "error") { throw new Error("Save or discard the current recording before starting another."); }
    const epoch = ++this.epoch;
    this.data = null; this.bytes = 0; this.durationMs = 0; this.chunks = [];
    this.state = "requesting"; this.message = "Waiting for microphone permission…"; this.changed();
    try {
      const formats = AUDIO_TYPES.filter(type => this.host.supports(type));
      if (!formats.length) { throw new Error("This host has no supported M4A, WebM/Opus or Ogg/Opus recording codec."); }
      const stream = await this.host.acquire();
      if (epoch !== this.epoch || this.state !== "requesting") { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      if (!stream.getAudioTracks().some(track => track.readyState !== "ended")) { throw new Error("The microphone returned no active audio track."); }
      let recorder: MediaRecorder | null = null;
      let selectedFormat = formats[0];
      let failure: unknown;
      for (const format of formats) {
        try { recorder = this.host.create(stream, format); selectedFormat = format; break; } catch (error) { failure = error; }
      }
      if (!recorder) { throw failure ?? new Error("The supported audio encoder could not be created."); }
      this.mime = recorder.mimeType || selectedFormat;
      audioExtension(this.mime);
      this.recorder = recorder;
      const listen = (target: EventTarget, name: string, callback: EventListener): void => {
        target.addEventListener(name, callback);
        this.listeners.push(() => target.removeEventListener(name, callback));
      };
      listen(recorder, "dataavailable", event => {
        if (epoch !== this.epoch) { return; }
        const blob = (event as BlobEvent).data;
        if (!(blob instanceof Blob) || !blob.size) { return; }
        if (this.bytes + blob.size > MAX_BINARY_BYTES) { this.fail(new Error("Recording exceeded 16 MiB. Record a shorter clip.")); return; }
        this.chunks.push(blob); this.bytes += blob.size; this.changed();
      });
      listen(recorder, "error", event => { if (epoch === this.epoch) { this.fail((event as Event & { error?: Error }).error ?? new Error("The audio encoder failed. Try another input device or browser.")); } });
      listen(recorder, "stop", () => {
        if (epoch !== this.epoch) { return; }
        this.durationMs = Math.max(0, this.host.now() - this.started);
        const blob = new Blob(this.chunks, { type: this.mime });
        this.release();
        if (!blob.size) { this.fail(new Error("No audio was recorded. Try again with a working microphone.")); return; }
        this.data = blob; this.state = "ready";
        this.message = "Recording stopped. Preview it, then save or insert it into a note.";
        this.changed();
      });
      for (const track of stream.getAudioTracks()) { listen(track, "ended", () => { if (epoch === this.epoch && this.state === "recording") { this.stop().catch(error => this.fail(error)); } }); }
      recorder.start(250);
      this.started = this.host.now(); this.state = "recording"; this.message = "Recording microphone audio…";
      this.deadline = setTimeout(() => this.stop().catch(error => this.fail(error)), MAX_RECORDING_MS);
      this.changed();
    } catch (error) { if (epoch === this.epoch) { this.fail(error); } }
  }

  stop(): Promise<void> {
    if (this.state === "stopping" && this.stopResult) { return this.stopResult.promise; }
    if (this.state !== "recording" || !this.recorder) { return Promise.reject(new Error("There is no active recording to stop.")); }
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    this.stopResult = { promise, resolve };
    this.state = "stopping"; this.message = "Finishing the recording…"; this.changed();
    this.stopDeadline = setTimeout(() => this.fail(new Error("The audio encoder did not finish. The microphone has been released.")), 8000);
    try { this.recorder.stop(); } catch (error) { this.fail(error); }
    return promise;
  }
  cancel(): void {
    if (this.state === "disposed") { return; }
    this.epoch++; this.release(); this.data = null; this.bytes = 0; this.durationMs = 0;
    this.state = "idle"; this.message = "Recording discarded. No attachment was created."; this.changed();
  }
  dispose(): void { this.cancel(); this.state = "disposed"; }
  private fail(error: unknown): void {
    this.epoch++; this.release(); this.data = null; this.bytes = 0;
    this.state = "error"; this.message = microphoneError(error); this.changed();
  }
  private release(): void {
    this.listeners.splice(0).forEach(remove => remove());
    if (this.deadline !== null) { clearTimeout(this.deadline); this.deadline = null; }
    if (this.stopDeadline !== null) { clearTimeout(this.stopDeadline); this.stopDeadline = null; }
    const recorder = this.recorder; this.recorder = null;
    if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch { /* Tracks are still stopped below. */ } }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.chunks = [];
    this.stopResult?.resolve(); this.stopResult = null;
  }
}
