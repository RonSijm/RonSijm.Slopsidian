import type { App } from "./app";
import type { CorePluginInstance, CorePlugins } from "./core-plugins";
import { requestJson, type VaultFileInfo, type VaultResource } from "./contracts";
import { AudioCapture, audioExtension } from "./audio-capture";
import { attachmentPath, recordingFolder, recordingName } from "./audio-paths";
import { decodeBinary } from "./binary";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import { Modal } from "./ui";
import { FileView } from "./views";
import type { TFile } from "./vault";

interface SavedRecording { root: string; path: string; version: string }

export class AudioRecorder implements CorePluginInstance {
  readonly id = "audio-recorder";
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }
  capture = new AudioCapture(() => this.render());
  saved: SavedRecording | null = null;
  inserted = false;
  private active = false;
  private root: string | null = null;
  private modal: RecorderModal | null = null;
  private ribbon: HTMLButtonElement | null = null;
  private saving: Promise<void> | null = null;
  private folder: string | null = null;
  private folderFailure = "";

  constructor(readonly app: App) {}
  get hasUnsavedAudio(): boolean { return !this.saved && ["recording", "stopping", "ready"].includes(this.capture.state); }
  get busy(): boolean { return this.saving !== null; }

  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      this.root = this.app.vault.rootPath; this.active = true;
      this.capture = new AudioCapture(() => this.render());
      const closeViews = await core.installViews(this.id, { audio: leaf => new AudioFileView(leaf) });
      let extensions: (() => void) | undefined;
      let commands: (() => void) | undefined;
      try {
        extensions = this.app.workspace.registerExtensions("core:audio-recorder", ["m4a", "webm", "ogg", "mp3", "wav", "mp4"], "audio");
        commands = this.app.commands.install([
          { id: "audio-recorder:start", name: "Start audio recording", checkCallback: checking => {
            const available = this.active && (["idle", "error"].includes(this.capture.state) || this.capture.state === "ready" && Boolean(this.saved)) && !this.busy;
            if (available && !checking) { if (this.saved) { this.discard(); } this.open(); this.capture.start().catch(reportError); }
            return available;
          } },
          { id: "audio-recorder:stop", name: "Stop audio recording", checkCallback: checking => {
            const available = this.capture.state === "recording";
            if (available && !checking) { this.capture.stop().catch(reportError); }
            return available;
          } },
        ]);
      } catch (error) { extensions?.(); commands?.(); await closeViews(); this.active = false; throw error; }
      this.ribbon = iconButton("mic", "Audio recorder", () => this.open());
      this.ribbon.dataset.coreRibbon = this.id;
      element("core-ribbon").append(this.ribbon);
      const beforeUnload = (event: BeforeUnloadEvent): void => { if (this.hasUnsavedAudio || this.busy) { event.preventDefault(); event.returnValue = ""; } };
      window.addEventListener("beforeunload", beforeUnload);
      const removeGuard = this.app.registerLeaveGuard(() => this.prepareLeave());
      return async () => {
        if (this.saving) { await this.saving; }
        this.prepareLeave();
        await closeViews();
        this.active = false;
        this.modal?.forceClose(); this.modal = null;
        this.capture.dispose(); this.saved = null; this.inserted = false;
        this.ribbon?.remove(); this.ribbon = null;
        extensions?.(); commands?.(); removeGuard();
        window.removeEventListener("beforeunload", beforeUnload);
        this.root = null;
      };
    }, this);
  }

  private guard(): void {
    if (!this.active || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault) { throw new Error("Audio recorder is no longer active in the selected vault."); }
  }
  prepareLeave(): void {
    if (this.busy) { throw new Error("Wait for the audio attachment to finish saving before leaving."); }
    if (this.hasUnsavedAudio && !window.confirm("Discard the unsaved audio recording before leaving? Save it first to retain it.")) { throw new Error("Audio recording was retained. Save or discard it before leaving."); }
    this.capture.cancel();
    this.modal?.forceClose(); this.modal = null;
    this.saved = null; this.inserted = false;
  }
  open(): void {
    this.guard();
    if (this.modal?.containerEl.isConnected) { this.modal.contentEl.focus(); return; }
    this.folder = null; this.folderFailure = "";
    const modal = new RecorderModal(this.app, this);
    this.modal = modal; modal.open(); this.render();
    const source = this.app.workspace.getActiveFile()?.path ?? null;
    this.app.configuration.read("app").then(document => {
      if (this.modal !== modal || !modal.containerEl.isConnected) { return; }
      this.guard(); this.folder = recordingFolder(document.data.attachmentFolderPath, source); this.render();
    }).catch(error => {
      if (this.modal === modal && modal.containerEl.isConnected) { this.folderFailure = error instanceof Error ? error.message : String(error); this.render(); }
    });
  }
  close(): boolean {
    if (this.busy) { return false; }
    if (this.hasUnsavedAudio && !window.confirm("Discard this unsaved audio recording?")) { return false; }
    if (!this.saved) { this.capture.cancel(); this.inserted = false; }
    this.modal?.forceClose(); this.modal = null;
    return true;
  }
  discard(): void {
    if (this.busy) { throw new Error("Wait for the recording to finish saving."); }
    if (this.hasUnsavedAudio && !window.confirm("Discard this unsaved audio recording?")) { return; }
    this.capture.cancel(); this.saved = null; this.inserted = false;
    this.modal?.reset(); this.render();
  }
  private render(): void {
    this.ribbon?.classList.toggle("is-active", ["requesting", "recording", "stopping"].includes(this.capture.state));
    this.modal?.render(this.folder, this.folderFailure);
    this.app.editorChanged();
  }
  save(pathValue: string, insert: boolean, isCurrent: () => boolean): Promise<void> {
    if (this.saving) { return Promise.reject(new Error("Wait for the current audio save to finish.")); }
    const operation = this.app.core.run(() => this.app.workspace.withFileMutation(async () => {
      const check = (): void => { this.guard(); if (!isCurrent()) { throw new Error("This recording dialog is no longer active."); } };
      check();
      const blob = this.capture.data;
      if (!blob || this.capture.state !== "ready") { throw new Error("Stop a recording before saving it."); }
      const path = attachmentPath(pathValue.trim());
      if (!path.toLowerCase().endsWith("." + audioExtension(this.capture.mime))) { throw new Error("The filename extension must match the recording format: ." + audioExtension(this.capture.mime)); }
      const view = insert ? this.app.workspace.activeEditor : null;
      const session = view?.session;
      if (insert && (!view?.file || !session || view.getMode() !== "source" || session.isSaving)) { throw new Error("Activate a Markdown source editor before inserting the recording. You can still save the attachment separately."); }
      const text = view?.editor.getValue(), sourcePath = view?.file?.path, version = session?.document.version;
      const from = view?.editor.getCursor("from"), to = view?.editor.getCursor("to");
      const verifyNote = async (): Promise<void> => {
        if (!insert) { return; }
        const info = await requestJson<VaultFileInfo>(`/api/files/info?root=${encodeURIComponent(this.root!)}&path=${encodeURIComponent(sourcePath!)}`);
        check();
        if (info.version !== version) { throw new Error("The note changed on disk. The audio is retained; reload the intended note before inserting it."); }
      };
      await verifyNote();
      if (!this.saved) {
        const data = await blob.arrayBuffer(); check();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), byte => byte.toString(16).padStart(2, "0")).join("");
        check();
        const file = await this.app.vault.createBinary(path, data);
        this.saved = { root: this.root!, path: file.path, version: hash };
      }
      check();
      const saved = this.saved;
      const info = await requestJson<VaultFileInfo>(`/api/files/info?root=${encodeURIComponent(saved.root)}&path=${encodeURIComponent(saved.path)}`);
      check();
      if (info.root !== saved.root || info.version !== saved.version) { throw new Error("The saved audio file was replaced externally. Its current bytes were retained; no embed was inserted."); }
      if (insert) {
        await verifyNote();
        if (!view?.file || !session || !from || !to || sourcePath !== view.file.path || view.session !== session || this.app.workspace.activeEditor !== view || view.getMode() !== "source" || view.editor.getValue() !== text || session.document.version !== version || JSON.stringify(view.editor.getCursor("from")) !== JSON.stringify(from) || JSON.stringify(view.editor.getCursor("to")) !== JSON.stringify(to)) { throw new Error("The note or selection changed while saving. The recording was saved; activate the intended editor and insert it again."); }
        const file = this.app.vault.getFileByPath(saved.path);
        if (!file) { throw new Error("The saved audio attachment is missing from the vault inventory."); }
        const newline = text?.includes("\r\n") ? "\r\n" : "\n";
        const link = this.app.fileManager.generateMarkdownLink(file, sourcePath!);
        view.editor.replaceRange(newline + "!" + link + newline, from, to);
        this.inserted = true;
      }
    }));
    this.saving = operation;
    this.render();
    return operation.finally(() => { this.saving = null; this.render(); });
  }
}

class RecorderModal extends Modal {
  private readonly status = document.createElement("p");
  private readonly details = document.createElement("output");
  private readonly path = document.createElement("input");
  private readonly player = document.createElement("audio");
  private readonly start: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private readonly save: HTMLButtonElement;
  private readonly insert: HTMLButtonElement;
  private readonly discard: HTMLButtonElement;
  private url: string | null = null;
  private blob: Blob | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private failure = "";
  private attachmentFolder: string | null = null;
  private attachmentFailure = "";

  constructor(app: App, private readonly recorder: AudioRecorder) {
    super(app); this.setTitle("Audio recorder"); this.modalEl.classList.add("audio-recorder-modal"); this.modalEl.setAttribute("aria-label", "Audio recorder");
    this.contentEl.dataset.audioRecorder = "";
    const hint = document.createElement("p"); hint.className = "muted";
    hint.textContent = "Start explicitly requests microphone access. Stop to preview, then save a vault attachment. Recordings are limited to 10 minutes / 16 MiB.";
    this.status.dataset.audioStatus = ""; this.status.setAttribute("role", "status");
    this.details.dataset.audioDetails = "";
    this.player.controls = true; this.player.preload = "metadata"; this.player.dataset.audioPreview = "";
    this.player.onerror = () => { this.failure = "This host could not decode the recording preview. The recorded bytes are retained for saving."; this.render(); };
    const label = document.createElement("label"); label.textContent = "Vault attachment path";
    this.path.dataset.audioPath = ""; this.path.setAttribute("aria-label", "Vault attachment path"); this.path.maxLength = 4096; label.append(this.path);
    const actions = document.createElement("div"); actions.className = "audio-recorder-actions";
    this.start = this.button("Start recording", "start", () => this.recorder.capture.start());
    this.stop = this.button("Stop recording", "stop", () => this.recorder.capture.stop());
    this.save = this.button("Save recording", "save", () => this.recorder.save(this.path.value, false, () => this.containerEl.isConnected));
    this.insert = this.button("Save and insert into note", "insert", () => this.recorder.save(this.path.value, true, () => this.containerEl.isConnected));
    this.discard = this.button("Discard recording", "discard", async () => this.recorder.discard());
    actions.append(this.start, this.stop, this.save, this.insert, this.discard);
    this.contentEl.append(hint, this.status, this.details, this.player, label, actions);
  }
  override onOpen(): void { this.tick = setInterval(() => this.render(), 500); this.start.focus(); }
  override close(): void { this.recorder.close(); }
  forceClose(): void { super.close(); }
  override onClose(): void {
    if (this.tick !== null) { clearInterval(this.tick); this.tick = null; }
    this.player.pause(); this.player.removeAttribute("src"); this.player.load();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; } this.blob = null;
  }
  reset(): void { this.path.value = ""; this.failure = ""; }
  private button(text: string, name: string, callback: () => Promise<void>): HTMLButtonElement {
    const result = document.createElement("button"); result.textContent = text; result.dataset.audioAction = name;
    result.addEventListener("click", () => { if (!this.containerEl.isConnected) { return; } this.failure = ""; callback().catch(error => { if (this.containerEl.isConnected) { this.failure = error instanceof Error ? error.message : String(error); this.render(); } }); });
    return result;
  }
  render(folder: string | null = this.attachmentFolder, folderFailure = this.attachmentFailure): void {
    this.attachmentFolder = folder; this.attachmentFailure = folderFailure;
    const capture = this.recorder.capture, saved = this.recorder.saved;
    this.contentEl.dataset.audioState = capture.state;
    this.status.textContent = this.failure || folderFailure || (saved ? `Saved ${saved.path}. ` + (this.recorder.inserted ? "Embed inserted. Save your note to persist the edit." : "The attachment is ready; you can insert it into a source note.") : capture.message);
    this.status.classList.toggle("plugin-error", Boolean(this.failure || folderFailure || capture.state === "error"));
    this.details.textContent = `${Math.floor(capture.elapsedMs / 60000)}:${String(Math.floor(capture.elapsedMs / 1000) % 60).padStart(2, "0")} · ${capture.bytes} bytes${capture.mime ? " · " + capture.mime : ""}`;
    if (capture.data !== this.blob) {
      this.player.pause(); this.player.removeAttribute("src"); this.player.load();
      if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
      this.blob = capture.data;
      if (this.blob) { this.url = URL.createObjectURL(this.blob); this.player.src = this.url; }
    }
    if (capture.data && !this.path.value && folder !== null) { this.path.value = recordingName(folder, audioExtension(capture.mime), path => Boolean(this.app.vault.getAbstractFileByPath(path))); }
    if (saved) { this.path.value = saved.path; }
    this.path.readOnly = Boolean(saved); this.path.disabled = this.recorder.busy;
    this.player.hidden = !capture.data;
    this.start.disabled = this.recorder.busy || !["idle", "error"].includes(capture.state);
    this.stop.disabled = capture.state !== "recording";
    this.save.disabled = this.recorder.busy || capture.state !== "ready" || Boolean(saved);
    this.insert.textContent = saved ? "Insert saved recording into note" : "Save and insert into note";
    this.insert.disabled = this.recorder.busy || capture.state !== "ready" || this.recorder.inserted;
    this.discard.textContent = saved ? "New recording" : "Discard recording";
    this.discard.disabled = this.recorder.busy || capture.state === "idle";
  }
}

class AudioFileView extends FileView {
  override icon = "mic";
  private readonly player = document.createElement("audio");
  private readonly status = document.createElement("p");
  private url: string | null = null;
  private generation = 0;
  constructor(...args: ConstructorParameters<typeof FileView>) {
    super(...args); this.bodyEl.classList.add("audio-file-view");
    this.player.controls = true; this.player.preload = "metadata"; this.player.dataset.vaultAudio = "";
    this.player.onerror = () => { this.status.textContent = "This host cannot decode this audio file."; };
    this.bodyEl.append(this.status, this.player);
  }
  getViewType(): string { return "audio"; }
  getDisplayText(): string { return this.file?.name ?? "Audio"; }
  override async onLoadFile(file: TFile): Promise<void> {
    const generation = ++this.generation, root = this.app.vault.rootPath;
    this.status.textContent = "Loading " + file.path + "…";
    const resource = await requestJson<VaultResource>(`/api/resource?root=${encodeURIComponent(root ?? "")}&path=${encodeURIComponent(file.path)}`);
    if (generation !== this.generation || root !== this.app.vault.rootPath || this.file !== file) { return; }
    if (!resource.contentType.startsWith("audio/")) { throw new Error("This is not a supported audio resource."); }
    const bytes = decodeBinary(resource.base64);
    this.url = URL.createObjectURL(new Blob([bytes], { type: resource.contentType }));
    this.player.src = this.url; this.player.dataset.vaultAudio = file.path; this.status.textContent = file.path;
  }
  override async onUnloadFile(): Promise<void> {
    this.generation++; this.player.pause(); this.player.removeAttribute("src"); this.player.load();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }
}
