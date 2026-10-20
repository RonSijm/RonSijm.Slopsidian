import type { CaptureInputSelection } from "./audio-capture";

export const MAX_AUDIO_INPUTS = 64;
export const AUDIO_INPUT_REFRESH_MS = 8000;
export interface AudioInputChoice { readonly id: string; readonly label: string }
export interface AudioInputEnvironment {
  enumerate(): Promise<readonly MediaDeviceInfo[]>;
  listen(callback: () => void): () => void;
}
function environment(): AudioInputEnvironment {
  return {
    enumerate: () => {
      if (!navigator.mediaDevices?.enumerateDevices) { throw new Error("Microphone selection requires a supported browser over HTTPS/localhost. System default can still be tried."); }
      return navigator.mediaDevices.enumerateDevices();
    },
    listen: callback => {
      const devices = navigator.mediaDevices;
      devices?.addEventListener("devicechange", callback);
      return () => devices?.removeEventListener("devicechange", callback);
    },
  };
}

/** Dialog-only identifiers: listing never asks for permission, captures media, or persists device IDs. */
export class AudioInputs {
  choices: readonly AudioInputChoice[] = [];
  selected = "";
  selectedLabel = "";
  valid = true;
  state: "idle" | "loading" | "ready" | "error" | "disposed" = "idle";
  message = "System default is selected. Refresh lists inputs the browser exposes without requesting microphone access. Names may stay hidden until permission is granted.";
  private generation = 0;
  private pending: { promise: Promise<void>; settle: () => void } | null = null;
  private unlisten: () => void;

  constructor(private readonly changed: () => void = () => {}, private readonly host = environment(), private readonly authorize: () => void = () => {}, private readonly locked: () => boolean = () => false) {
    this.unlisten = host.listen(() => this.invalidate());
  }
  get refreshing(): boolean { return this.pending !== null; }
  get canStart(): boolean { return this.state !== "disposed" && this.state !== "loading" && this.valid; }
  private check(): void {
    this.authorize();
    if (this.state === "disposed") { throw new Error("This microphone chooser is no longer active."); }
  }
  private checkEditable(): void {
    this.check();
    if (this.locked()) { throw new Error("Stop and save or discard the current recording before changing microphone inputs."); }
  }
  select(id: string): void {
    this.checkEditable();
    if (this.state === "loading") { throw new Error("Wait for the microphone list to finish refreshing."); }
    const choice = id ? this.choices.find(entry => entry.id === id) : undefined;
    if (id && !choice) { throw new Error("That microphone is no longer listed. Refresh and select an available input."); }
    this.selected = id; this.selectedLabel = choice?.label ?? ""; this.valid = true;
    this.changed();
  }
  selectionForCapture(): CaptureInputSelection {
    this.checkEditable();
    if (!this.canStart) { throw new Error("Refresh the microphone list and select an available input, or explicitly choose System default."); }
    const generation = this.generation, selected = this.selected;
    return { deviceId: selected || undefined, validate: () => {
      this.check();
      if (generation !== this.generation || this.selected !== selected || !this.valid) { throw new Error("Microphone inputs changed while access was pending. Refresh and choose the intended input before starting again."); }
    } };
  }
  refresh(): Promise<void> {
    this.checkEditable();
    if (this.pending) { return this.pending.promise; }
    const generation = ++this.generation;
    let resolve!: () => void, settled = false;
    const promise = new Promise<void>(done => { resolve = done; });
    const timer = setTimeout(() => {
      if (generation !== this.generation || this.state === "disposed") { return; }
      this.generation++;
      this.state = "error"; this.valid = !this.selected;
      this.message = "The browser did not finish listing microphones. Refresh to retry, or explicitly choose System default. No microphone was opened.";
      operation.settle(); if (this.pending === operation) { this.pending = null; } this.changed();
    }, AUDIO_INPUT_REFRESH_MS);
    const operation = { promise, settle: (): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } } };
    this.pending = operation;
    this.state = "loading"; this.valid = !this.selected;
    this.message = "Refreshing microphone inputs without opening a microphone…"; this.changed();
    const finish = (): void => { operation.settle(); if (this.pending === operation) { this.pending = null; if (this.state !== "disposed") { this.changed(); } } };
    try {
      // checkEditable was called before this browser boundary; completions must pass the same owner check.
      Promise.resolve(this.host.enumerate()).then(devices => {
        if (generation !== this.generation || this.state === "disposed") { return; }
        this.check();
        const choices: AudioInputChoice[] = [], seen = new Set<string>();
        for (const device of devices.slice(0, 256)) {
          // Default/communications are moving aliases, represented by the explicit System default choice.
          if (device.kind !== "audioinput" || !device.deviceId || device.deviceId.length > 1024 || ["default", "communications"].includes(device.deviceId) || seen.has(device.deviceId)) { continue; }
          seen.add(device.deviceId);
          choices.push({ id: device.deviceId, label: device.label.trim().slice(0, 160) || `Microphone ${choices.length + 1} (name unavailable)` });
          if (choices.length >= MAX_AUDIO_INPUTS) { break; }
        }
        this.choices = choices;
        const selected = choices.find(entry => entry.id === this.selected);
        this.valid = !this.selected || Boolean(selected);
        if (selected) { this.selectedLabel = selected.label; }
        this.state = "ready";
        this.message = this.valid ? `${choices.length} selectable microphone${choices.length === 1 ? "" : "s"} exposed by the browser${choices.length >= MAX_AUDIO_INPUTS ? " (list limited to 64)" : ""}. Names may be hidden until Start grants access; Refresh never requests access.` : "The selected microphone is unavailable. Select another listed input or explicitly choose System default. No fallback will be used.";
        this.changed();
      }).catch(error => {
        if (generation !== this.generation || this.state === "disposed") { return; }
        // Owner changes must not show device information or errors in a replacement dialog/vault.
        try { this.check(); } catch { this.invalidate(false); return; }
        this.choices = []; this.valid = !this.selected; this.state = "error";
        this.message = error instanceof Error ? error.message : "The browser could not list microphones. No microphone was opened.";
        this.changed();
      }).finally(finish);
    } catch (error) {
      this.choices = []; this.valid = !this.selected; this.state = "error";
      this.message = error instanceof Error ? error.message : "The browser could not list microphones. No microphone was opened.";
      finish(); this.changed();
    }
    return promise;
  }
  private invalidate(notify = true): void {
    if (this.state === "disposed") { return; }
    this.generation++; const pending = this.pending; this.pending = null; pending?.settle(); this.choices = []; this.valid = !this.selected;
    this.state = "idle";
    this.message = "Microphone inputs changed. Refresh before selecting a device. An active recording keeps its current microphone; a selected input will never silently fall back.";
    if (notify) { this.changed(); }
  }
  dispose(): void {
    if (this.state === "disposed") { return; }
    this.generation++; this.unlisten(); this.pending?.settle(); this.pending = null;
    this.choices = []; this.selected = ""; this.selectedLabel = ""; this.valid = false; this.state = "disposed";
  }
}
