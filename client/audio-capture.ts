import { MAX_BINARY_BYTES } from "./binary";

export type CaptureState = "idle" | "requesting" | "recording" | "pausing" | "paused" | "resuming" | "stopping" | "ready" | "error" | "disposed";
export const MAX_RECORDING_MS = 10 * 60 * 1000;
export const AUDIO_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"] as const;
export interface CaptureInputSelection { readonly deviceId?: string; readonly validate?: () => void }
export interface CaptureEnvironment {
  acquire(deviceId?: string): Promise<MediaStream>;
  supports(type: string): boolean;
  create(stream: MediaStream, type: string): MediaRecorder;
  now(): number;
}
export function audioInputConstraints(deviceId?: string): MediaStreamConstraints {
  return { audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false };
}
function environment(): CaptureEnvironment {
  return {
    acquire: deviceId => {
      if (!navigator.mediaDevices?.getUserMedia) { throw new Error("Microphone capture requires a supported browser over HTTPS/localhost."); }
      if (deviceId && !navigator.mediaDevices.getSupportedConstraints?.().deviceId) { throw new Error("This host cannot require a specific microphone. Explicitly choose System default to record."); }
      return navigator.mediaDevices.getUserMedia(audioInputConstraints(deviceId));
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
  private activeStarted: number | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private stopDeadline: ReturnType<typeof setTimeout> | null = null;
  private stopResult: { promise: Promise<void>; resolve: () => void } | null = null;
  private transitionDeadline: ReturnType<typeof setTimeout> | null = null;
  private transitionResult: { kind: "pause" | "resume"; promise: Promise<void>; resolve: () => void } | null = null;
  private listeners: (() => void)[] = [];

  constructor(private readonly changed: () => void = () => {}, private readonly host = environment(), private readonly authorizeCapture: () => void = () => {}, private readonly selectInput: () => CaptureInputSelection = () => ({})) {}
  /** Acknowledged active recording time. The wall-clock microphone lease also includes pauses. */
  get elapsedMs(): number { return this.durationMs + (this.activeStarted === null ? 0 : Math.max(0, this.host.now() - this.activeStarted)); }
  get liveTracks(): number { return this.stream?.getTracks().filter(track => track.readyState !== "ended").length ?? 0; }
  get canStop(): boolean { return this.recorder !== null && ["recording", "pausing", "paused", "resuming"].includes(this.state); }

  async start(): Promise<void> {
    this.authorizeCapture();
    if (this.state !== "idle" && this.state !== "error") { throw new Error("Save or discard the current recording before starting another."); }
    const selected = this.selectInput();
    const epoch = ++this.epoch;
    this.data = null; this.bytes = 0; this.durationMs = 0; this.activeStarted = null; this.chunks = [];
    this.state = "requesting"; this.message = "Waiting for microphone permission…"; this.changed();
    try {
      const formats = AUDIO_TYPES.filter(type => this.host.supports(type));
      if (!formats.length) { throw new Error("This host has no supported M4A, WebM/Opus or Ogg/Opus recording codec."); }
      const stream = await this.host.acquire(selected.deviceId);
      if (epoch !== this.epoch || this.state !== "requesting") { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.authorizeCapture();
      selected.validate?.();
      if (!stream.getAudioTracks().some(track => track.readyState !== "ended")) { throw new Error("The microphone returned no active audio track."); }
      if (selected.deviceId && stream.getAudioTracks().some(track => track.getSettings?.().deviceId !== selected.deviceId)) { throw new Error("This host could not verify the selected microphone. No recording was started. Refresh and select an input, or explicitly choose System default."); }
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
      for (const kind of ["pause", "resume"] as const) {
        listen(recorder, kind, () => {
          if (epoch !== this.epoch || this.recorder !== recorder || this.transitionResult?.kind !== kind || this.state !== (kind === "pause" ? "pausing" : "resuming")) { return; }
          if (kind === "pause") {
            this.freezeDuration(); this.state = "paused";
            this.message = "Recording paused. The microphone remains connected. Resume or stop to finish the clip.";
          } else {
            this.activeStarted = this.host.now(); this.state = "recording"; this.message = "Recording microphone audio…";
          }
          this.finishTransition(); this.changed();
        });
      }
      listen(recorder, "stop", () => {
        if (epoch !== this.epoch) { return; }
        this.freezeDuration();
        const blob = new Blob(this.chunks, { type: this.mime });
        this.release();
        if (!blob.size) { this.fail(new Error("No audio was recorded. Try again with a working microphone.")); return; }
        this.data = blob; this.state = "ready";
        this.message = "Recording stopped. Preview it, then save or insert it into a note.";
        this.changed();
      });
      for (const track of stream.getAudioTracks()) { listen(track, "ended", () => { if (epoch === this.epoch && this.canStop) { this.stop().catch(error => { if (epoch === this.epoch) { this.fail(error); } }); } }); }
      recorder.start(250);
      this.started = this.host.now(); this.activeStarted = this.started; this.state = "recording"; this.message = "Recording microphone audio…";
      // Pausing never resets this wall-clock safety lease or releases microphone tracks.
      this.deadline = setTimeout(() => { if (epoch === this.epoch && this.canStop) { this.stop().catch(error => { if (epoch === this.epoch) { this.fail(error); } }); } }, MAX_RECORDING_MS);
      this.changed();
    } catch (error) { if (epoch === this.epoch) { this.fail(error); } }
  }

  pause(): Promise<void> { return this.transition("pause"); }
  resume(): Promise<void> { return this.transition("resume"); }
  private transition(kind: "pause" | "resume"): Promise<void> {
    try { this.authorizeCapture(); } catch (error) { return Promise.reject(error); }
    if (this.transitionResult?.kind === kind) { return this.transitionResult.promise; }
    if (!this.recorder || this.state !== (kind === "pause" ? "recording" : "paused")) { return Promise.reject(new Error(kind === "pause" ? "There is no active recording to pause." : "There is no paused recording to resume.")); }
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; }), epoch = this.epoch;
    this.transitionResult = { kind, promise, resolve };
    this.state = kind === "pause" ? "pausing" : "resuming";
    this.message = kind === "pause" ? "Pausing the recording…" : "Resuming the recording…";
    this.transitionDeadline = setTimeout(() => { if (epoch === this.epoch && this.transitionResult?.promise === promise) { this.fail(new Error(`The audio encoder did not ${kind}. The microphone has been released.`)); } }, 8000);
    this.changed();
    try { this.recorder[kind](); } catch (error) { this.fail(error); }
    return promise;
  }
  stop(): Promise<void> {
    if (this.state === "stopping" && this.stopResult) { return this.stopResult.promise; }
    if (!this.canStop || !this.recorder) { return Promise.reject(new Error("There is no active recording to stop.")); }
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    this.stopResult = { promise, resolve };
    this.freezeDuration(); this.finishTransition();
    this.state = "stopping"; this.message = "Finishing the recording…"; this.changed();
    const epoch = this.epoch;
    this.stopDeadline = setTimeout(() => { if (epoch === this.epoch && this.stopResult?.promise === promise) { this.fail(new Error("The audio encoder did not finish. The microphone has been released.")); } }, 8000);
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
    this.freezeDuration(); this.finishTransition();
    this.listeners.splice(0).forEach(remove => remove());
    if (this.deadline !== null) { clearTimeout(this.deadline); this.deadline = null; }
    if (this.stopDeadline !== null) { clearTimeout(this.stopDeadline); this.stopDeadline = null; }
    const recorder = this.recorder; this.recorder = null;
    if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch { /* Tracks are still stopped below. */ } }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.chunks = [];
    this.stopResult?.resolve(); this.stopResult = null;
  }
  private freezeDuration(): void {
    if (this.activeStarted !== null) { this.durationMs += Math.max(0, this.host.now() - this.activeStarted); this.activeStarted = null; }
  }
  private finishTransition(): void {
    if (this.transitionDeadline !== null) { clearTimeout(this.transitionDeadline); this.transitionDeadline = null; }
    const result = this.transitionResult; this.transitionResult = null; result?.resolve();
  }
}
