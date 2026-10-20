import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { describeFindings, extensionsOfKind, inspectPdf, mediaFormats, parsePdfSubpath, parseVideoSubpath, pdfLimits, readPdfPage, readPdfZoom, readPlaybackState, sniffMime, type PlaybackState } from "./media-policy";
import { PdfDocumentError, PdfPasswordError, pdfJsRenderer, type PdfRenderHandle, type PdfRenderer } from "./pdf-engine";
import type { TFile } from "./vault";
import { FileView } from "./views";
import type { Workspace, WorkspaceLeaf } from "./workspace";

let pdfRenderer: PdfRenderer = pdfJsRenderer;
// Tests substitute the renderer; the product always uses the local pdf.js engine.
export function setPdfRenderer(renderer: PdfRenderer | null): void { pdfRenderer = renderer ?? pdfJsRenderer; }

export function registerMediaViews(workspace: Workspace): void {
  workspace.registerView("builtin:pdf", "pdf", leaf => new PdfView(leaf));
  workspace.registerExtensions("builtin:pdf", extensionsOfKind("pdf"), "pdf");
  workspace.registerView("builtin:video", "video", leaf => new VideoView(leaf));
  workspace.registerExtensions("builtin:video", extensionsOfKind("video"), "video");
}

function subpathOf(state: Record<string, unknown>): string | null {
  const value = state.subpath;
  if (value === undefined || value === null || value === "") { return null; }
  if (typeof value !== "string") { throw new Error("A link subpath must be text."); }
  return value;
}

abstract class BinaryFileView extends FileView {
  protected readonly status = document.createElement("p");
  protected generation = 0;
  protected abstract readonly attribute: string;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.status.setAttribute("role", "status");
    this.registerEvent(this.app.vault.on("modify", file => { if (this.file && file === this.file) { return this.loadMedia(this.file); } }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (!this.file || file !== this.file) { return; }
      const path = this.file.path;
      this.release();
      this.setStatus("error", "This file was deleted from the vault: " + path, true);
    }));
  }

  protected abstract kind(): "pdf" | "video";
  protected abstract release(): void;
  protected abstract show(file: TFile, bytes: ArrayBuffer, mime: string, current: () => boolean): Promise<void> | void;

  override async onLoadFile(file: TFile): Promise<void> { await this.loadMedia(file); }
  override async onRename(file: TFile): Promise<void> { await this.loadMedia(file); }
  override async onUnloadFile(): Promise<void> { this.release(); }

  protected setStatus(state: string, text: string, error = false): void {
    this.bodyEl.dataset[this.attribute + "Status"] = state;
    this.status.classList.toggle("is-error", error);
    this.status.textContent = text;
  }

  private async loadMedia(file: TFile): Promise<void> {
    const format = mediaFormats.get(file.extension.toLowerCase());
    if (format?.kind !== this.kind()) { throw new Error("This file is not supported by this viewer."); }
    this.release();
    const generation = this.generation, root = this.app.vault.rootPath;
    const current = (): boolean => generation === this.generation && root === this.app.vault.rootPath && this.file === file;
    this.bodyEl.dataset[this.attribute + "File"] = file.path;
    this.setStatus("loading", "Loading " + file.path + "...");
    let bytes: ArrayBuffer;
    try { bytes = await this.app.vault.readBinary(file); }
    catch (error) {
      if (!current()) { return; }
      this.setStatus("error", error instanceof Error ? error.message : String(error), true);
      throw error;
    }
    if (!current()) { return; }
    const sniffed = sniffMime(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 5120)));
    if (format.kind === "pdf" && sniffed !== "application/pdf") {
      this.setStatus("error", "This file does not contain a PDF header: " + file.path, true);
      return;
    }
    const mime = format.kind === "video" && sniffed?.startsWith("video/") ? sniffed : format.mime;
    try { await this.show(file, bytes, mime, current); }
    catch (error) {
      if (!current()) { return; }
      this.setStatus("error", error instanceof Error ? error.message : String(error), true);
    }
  }
}

export class PdfView extends BinaryFileView {
  override icon = "file-text";
  protected readonly attribute = "pdf";
  private readonly viewport = document.createElement("div");
  private readonly pageInput = document.createElement("input");
  private readonly pageCount = document.createElement("output");
  private readonly zoomText = document.createElement("output");
  private readonly password = document.createElement("form");
  private readonly passwordField = document.createElement("input");
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private page = 1;
  private zoom = 1;
  private handle: PdfRenderHandle | null = null;
  private abort: AbortController | null = null;
  private disposal: Promise<void> = Promise.resolve();
  private showing: Promise<void> = Promise.resolve();
  private bytes: ArrayBuffer | null = null;
  private notice = "";
  private pendingTarget: { page: number; zoom?: number } | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.bodyEl.classList.add("image-file-view", "pdf-file-view");
    const toolbar = document.createElement("div");
    toolbar.className = "image-toolbar";
    const control = (action: string, label: string, run: () => void): void => {
      const element = document.createElement("button");
      element.type = "button"; element.textContent = label; element.dataset.pdfAction = action; element.disabled = true;
      this.registerDomEvent(element, "click", run);
      this.buttons.set(action, element);
      toolbar.append(element);
    };
    control("previous", "Previous page", () => this.go(this.page - 1));
    this.pageInput.type = "number"; this.pageInput.min = "1"; this.pageInput.step = "1"; this.pageInput.disabled = true;
    this.pageInput.className = "pdf-page-input"; this.pageInput.setAttribute("aria-label", "PDF page");
    this.registerDomEvent(this.pageInput, "change", () => this.go(Number(this.pageInput.value)));
    toolbar.append(this.pageInput, this.pageCount);
    control("next", "Next page", () => this.go(this.page + 1));
    control("zoom-out", "Zoom out", () => this.setZoom(this.zoom / 1.25));
    control("zoom-reset", "100%", () => this.setZoom(1));
    control("zoom-in", "Zoom in", () => this.setZoom(this.zoom * 1.25));
    this.zoomText.setAttribute("aria-label", "PDF zoom");
    toolbar.append(this.zoomText);
    this.password.className = "pdf-password"; this.password.hidden = true;
    const submit = document.createElement("button");
    this.passwordField.type = "password"; this.passwordField.autocomplete = "off"; this.passwordField.setAttribute("aria-label", "PDF password");
    submit.type = "submit"; submit.textContent = "Open";
    this.password.append(this.passwordField, submit);
    this.registerDomEvent(this.password, "submit", event => {
      event.preventDefault();
      const value = this.passwordField.value; this.passwordField.value = "";
      if (this.file && value) { this.openDocument(this.file, value).catch(reportError); }
    });
    this.status.className = "image-status";
    this.viewport.className = "image-stage pdf-stage";
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute("aria-label", "PDF viewport");
    this.registerDomEvent(this.viewport, "keydown", event => {
      const key = (event as KeyboardEvent).key;
      if (key === "PageDown") { event.preventDefault(); this.go(this.page + 1); }
      else if (key === "PageUp") { event.preventDefault(); this.go(this.page - 1); }
    });
    this.bodyEl.append(toolbar, this.status, this.password, this.viewport);
    this.register(() => this.release());
    this.updateControls();
  }

  getViewType(): string { return "pdf"; }
  protected kind(): "pdf" { return "pdf"; }
  override getDisplayText(): string { return this.file?.name ?? "PDF"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), pdfPage: this.page, pdfZoom: this.zoom }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    const page = readPdfPage(state.pdfPage), zoom = readPdfZoom(state.pdfZoom);
    const saved = { page: this.page, zoom: this.zoom };
    this.page = page; this.zoom = zoom;
    try { await super.setState(state, result); await this.update(); }
    catch (error) { this.page = saved.page; this.zoom = saved.zoom; throw error; }
  }
  override setEphemeralState(value: unknown): void {
    const state = copyViewData(value);
    const subpath = subpathOf(state);
    const target = subpath === null ? null : parsePdfSubpath(subpath);
    delete state.subpath;
    super.setEphemeralState(state);
    if (target) {
      if (this.handle) {
        if (target.page > this.handle.pageCount) { throw new Error(`The link targets page ${target.page}, but this PDF has ${this.handle.pageCount} pages.`); }
        this.page = target.page;
        if (target.zoom !== undefined) { this.zoom = target.zoom; }
        this.update().then(() => this.app.workspace.requestSaveLayout()).catch(reportError);
      } else {
        // Locked or still-loading document: validate against the real page count once it opens.
        this.pendingTarget = target;
      }
    }
  }
  override focus(): void {
    if (this.password.hidden) { this.viewport.focus(); }
    else { this.passwordField.focus(); }
  }

  override async onUnloadFile(): Promise<void> { this.pendingTarget = null; this.release(); await this.disposal; }

  protected release(): void {
    this.generation++;
    this.abort?.abort(); this.abort = null;
    this.bytes = null;
    const handle = this.handle; this.handle = null;
    if (handle) { this.disposal = this.disposal.then(() => handle.dispose()).catch(reportError); }
    this.viewport.replaceChildren();
    this.password.hidden = true;
    this.bodyEl.dataset.pdfStatus = "idle";
    delete this.bodyEl.dataset.pdfBlocked; delete this.bodyEl.dataset.pdfPages; delete this.bodyEl.dataset.pdfPage;
    delete this.bodyEl.dataset.pdfZoom; delete this.bodyEl.dataset.pdfCanvas; delete this.bodyEl.dataset.pdfCapped;
    this.updateControls();
  }

  protected async show(file: TFile, bytes: ArrayBuffer, _mime: string, current: () => boolean): Promise<void> {
    this.bytes = bytes;
    const findings = inspectPdf(new Uint8Array(bytes));
    this.notice = findings.length ? ` - not executed or opened: ${describeFindings(findings)}` : "";
    if (findings.length) { this.bodyEl.dataset.pdfBlocked = describeFindings(findings); }
    await this.openDocument(file, undefined, current);
  }

  private async openDocument(file: TFile, password?: string, stillCurrent: () => boolean = () => this.file === file): Promise<void> {
    const bytes = this.bytes;
    if (!bytes) { return; }
    this.abort?.abort();
    const abort = this.abort = new AbortController(), generation = this.generation;
    const live = (): boolean => stillCurrent() && generation === this.generation && !abort.signal.aborted;
    const previous = this.handle; this.handle = null;
    if (previous) { this.disposal = this.disposal.then(() => previous.dispose()).catch(reportError); }
    await this.disposal;
    if (!live()) { return; }
    this.setStatus("loading", "Rendering " + file.path + "...");
    let handle: PdfRenderHandle;
    try { handle = await pdfRenderer.open(bytes, this.viewport, { password, signal: abort.signal }); }
    catch (error) {
      if (!live()) { return; }
      if (error instanceof PdfPasswordError) {
        this.password.hidden = false;
        this.setStatus("password", (error.incorrect ? "Incorrect password. " : "") + "Enter the password for " + file.path, error.incorrect);
        if (!this.app.changingVault && this.leaf.workspace.activeLeaf === this.leaf && this.password.checkVisibility()) { this.passwordField.focus(); }
        return;
      }
      this.setStatus(error instanceof PdfDocumentError ? error.kind : "error", error instanceof Error ? error.message : String(error), true);
      return;
    }
    if (!live()) { await handle.dispose(); return; }
    this.password.hidden = true;
    this.handle = handle;
    this.bodyEl.dataset.pdfPages = String(handle.pageCount);
    const target = this.pendingTarget; this.pendingTarget = null;
    let targetError = "";
    if (target) {
      if (target.page > handle.pageCount) { targetError = `The link targets page ${target.page}, but this PDF has ${handle.pageCount} pages.`; }
      else { this.page = target.page; if (target.zoom !== undefined) { this.zoom = target.zoom; } }
    }
    this.page = Math.min(this.page, handle.pageCount);
    if (targetError) { this.setStatus("error", targetError, true); }
    else { this.setStatus("ready", `${file.path} - ${handle.pageCount} pages${this.notice}`); }
    await this.update();
  }

  private go(page: number): void {
    if (!this.handle || !Number.isInteger(page) || page < 1 || page > this.handle.pageCount) { this.updateControls(); return; }
    this.page = page;
    this.update().then(() => this.app.workspace.requestSaveLayout()).catch(reportError);
  }

  private setZoom(zoom: number): void {
    this.zoom = Math.min(pdfLimits.maxZoom, Math.max(pdfLimits.minZoom, zoom));
    this.update().then(() => this.app.workspace.requestSaveLayout()).catch(reportError);
  }

  private update(): Promise<void> {
    const run = async (): Promise<void> => {
      const handle = this.handle;
      if (!handle) { this.updateControls(); return; }
      this.page = Math.min(this.page, handle.pageCount);
      this.updateControls();
      const shown = await handle.show(this.page, this.zoom);
      if (!shown || this.handle !== handle) { return; }
      this.bodyEl.dataset.pdfPage = String(shown.page); this.bodyEl.dataset.pdfZoom = String(this.zoom);
      this.bodyEl.dataset.pdfCanvas = `${shown.width}x${shown.height}`;
      this.zoomText.textContent = Math.round((shown.capped ? shown.effectiveZoom : this.zoom) * 100) + "%" + (shown.capped ? " (limited)" : "");
      if (shown.capped) { this.bodyEl.dataset.pdfCapped = "true"; } else { delete this.bodyEl.dataset.pdfCapped; }
    };
    return this.showing = this.showing.then(run, run);
  }

  private updateControls(): void {
    const handle = this.handle, count = handle?.pageCount ?? 0;
    this.pageInput.disabled = !handle; this.pageInput.max = String(count); this.pageInput.value = handle ? String(this.page) : "";
    this.pageCount.textContent = handle ? "/ " + count : "";
    this.buttons.get("previous")!.disabled = !handle || this.page <= 1;
    this.buttons.get("next")!.disabled = !handle || this.page >= count;
    this.buttons.get("zoom-out")!.disabled = !handle || this.zoom <= pdfLimits.minZoom;
    this.buttons.get("zoom-in")!.disabled = !handle || this.zoom >= pdfLimits.maxZoom;
    this.buttons.get("zoom-reset")!.disabled = !handle;
    if (!handle) { this.zoomText.textContent = ""; }
  }
}

export class VideoView extends BinaryFileView {
  override icon = "video";
  protected readonly attribute = "video";
  private readonly video = document.createElement("video");
  private playback: PlaybackState = readPlaybackState({});
  private url: string | null = null;
  private holdPlayback = false;
  private playbackReady = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.bodyEl.classList.add("image-file-view", "video-file-view");
    this.status.className = "image-status";
    this.video.controls = true;
    this.video.preload = "metadata";
    this.video.playsInline = true;
    this.video.disablePictureInPicture = true;
    this.video.disableRemotePlayback = true;
    this.video.setAttribute("controlslist", "nodownload noremoteplayback");
    this.video.setAttribute("aria-label", "Video player");
    const stage = document.createElement("div");
    stage.className = "image-stage video-stage";
    stage.append(this.video);
    this.bodyEl.append(this.status, stage);
    for (const name of ["ratechange", "volumechange", "pause", "seeked"]) { this.registerDomEvent(this.video, name, () => this.remember()); }
    this.register(() => this.release());
  }

  getViewType(): string { return "video"; }
  protected kind(): "video" { return "video"; }
  override getDisplayText(): string { return this.file?.name ?? "Video"; }
  override getState(): Record<string, unknown> {
    this.remember();
    return { ...super.getState(), videoTime: this.playback.time, videoRate: this.playback.rate, videoVolume: this.playback.volume, videoMuted: this.playback.muted };
  }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    const next = readPlaybackState(state);
    // Capture the outgoing file's playback before the incoming state is installed.
    this.remember();
    const saved = this.playback;
    this.holdPlayback = true;
    try { await super.setState(state, result); this.playback = next; this.apply(); }
    catch (error) { this.playback = saved; throw error; }
    finally { this.holdPlayback = false; }
  }
  override setEphemeralState(value: unknown): void {
    const state = copyViewData(value);
    const subpath = subpathOf(state);
    const target = subpath === null ? null : parseVideoSubpath(subpath);
    delete state.subpath;
    super.setEphemeralState(state);
    if (target) { this.playback = { ...this.playback, time: target.time }; this.apply(); }
  }
  override focus(): void { this.video.focus(); }

  // readyState can advance before loadedmetadata runs. Until that handler applies
  // the requested state, a layout snapshot must not adopt the element's defaults.
  private remember(): void {
    if (this.holdPlayback || !this.playbackReady || !this.url || this.video.readyState < 1) { return; }
    this.playback = { time: this.video.currentTime, rate: this.video.playbackRate, volume: this.video.volume, muted: this.video.muted };
  }

  private apply(): void {
    if (!this.url || this.video.readyState < 1) { return; }
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : this.playback.time;
    this.video.currentTime = Math.min(this.playback.time, duration);
    this.video.playbackRate = this.playback.rate;
    this.video.volume = this.playback.volume;
    this.video.muted = this.playback.muted;
  }

  protected release(): void {
    this.remember();
    this.playbackReady = false;
    this.generation++;
    this.video.pause();
    this.video.onloadedmetadata = null; this.video.onerror = null;
    this.video.removeAttribute("src"); this.video.load();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.bodyEl.dataset.videoStatus = "idle";
  }

  protected show(file: TFile, bytes: ArrayBuffer, mime: string, current: () => boolean): void {
    this.video.onloadedmetadata = () => {
      if (!current()) { return; }
      this.apply();
      this.playbackReady = true;
      this.setStatus("ready", `${file.path} - ${this.video.videoWidth} x ${this.video.videoHeight}, ${this.video.duration.toFixed(1)} s`);
    };
    this.video.onerror = () => {
      if (!current()) { return; }
      this.setStatus("error", "This host could not decode the video (its container or codec may be unsupported): " + file.path, true);
    };
    this.url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    this.video.src = this.url;
  }
}
