import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import type { TFile } from "./vault";
import { FileView } from "./views";
import { extensionsOfKind, mediaFormats, sniffMime } from "./media-policy";
import { sanitizeSvg, type SanitizedSvg } from "./svg-sanitizer";
import { registerMediaViews } from "./viewer-views";
import type { Workspace, WorkspaceLeaf } from "./workspace";

const imageTypes = new Map(["raster", "svg"].flatMap(kind => extensionsOfKind(kind as "raster" | "svg").map(extension => [extension, mediaFormats.get(extension)!.mime] as const)));
type ImageZoom = "fit" | number;

function readZoom(value: unknown): ImageZoom {
  if (value === undefined || value === "fit") { return "fit"; }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 8) {
    throw new Error("Image zoom must be fit or a number between 0.1 and 8.");
  }
  return value;
}

export function registerImageView(workspace: Workspace): void {
  workspace.registerView("builtin:image", "image", leaf => new ImageView(leaf));
  workspace.registerExtensions("builtin:image", [...imageTypes.keys()], "image");
  registerMediaViews(workspace);
}

export class ImageView extends FileView {
  override icon = "image";
  private readonly image = document.createElement("img");
  private readonly stage = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly scaleText = document.createElement("output");
  private readonly zoomIn = document.createElement("button");
  private readonly zoomOut = document.createElement("button");
  private zoom: ImageZoom = "fit";
  private scale = 1;
  private ready = false;
  private naturalSize = { width: 1, height: 1 };
  private url: string | null = null;
  private generation = 0;
  private resizeFrame: number | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.bodyEl.classList.add("image-file-view");
    const toolbar = document.createElement("div");
    toolbar.className = "image-toolbar";
    const button = (element: HTMLButtonElement, action: string, label: string, value: () => ImageZoom): void => {
      element.type = "button"; element.textContent = label; element.dataset.imageAction = action;
      this.registerDomEvent(element, "click", () => {
        this.zoom = value();
        this.resizeImage();
        this.app.workspace.requestSaveLayout().catch(reportError);
      });
      toolbar.append(element);
    };
    button(document.createElement("button"), "fit", "Fit", () => "fit");
    button(document.createElement("button"), "actual", "Actual size", () => 1);
    button(this.zoomOut, "out", "Zoom out", () => Math.max(0.1, this.scale / 1.25));
    button(this.zoomIn, "in", "Zoom in", () => Math.min(8, Math.max(0.1, this.scale * 1.25)));
    this.scaleText.setAttribute("aria-label", "Image zoom");
    toolbar.append(this.scaleText);
    this.status.className = "image-status";
    this.status.setAttribute("role", "status");
    this.stage.className = "image-stage";
    this.stage.tabIndex = 0;
    this.stage.setAttribute("aria-label", "Image viewport");
    const surface = document.createElement("div");
    surface.className = "image-surface";
    this.image.draggable = false;
    surface.append(this.image); this.stage.append(surface);
    this.bodyEl.append(toolbar, this.status, this.stage);
    const observer = new ResizeObserver(() => {
      if (this.resizeFrame !== null) { return; }
      // Fitting changes scrollbar visibility, so it must run outside the
      // observer's delivery cycle. Coalesce notifications and cancel on unload.
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null;
        if (this.isLoaded) { this.resizeImage(); }
      });
    });
    observer.observe(this.stage);
    this.register(() => {
      observer.disconnect();
      if (this.resizeFrame !== null) { cancelAnimationFrame(this.resizeFrame); this.resizeFrame = null; }
    });
    this.register(() => this.releaseImage());
    this.registerEvent(this.app.vault.on("modify", file => {
      if (this.file && file === this.file) { return this.loadImage(this.file); }
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (!this.file || file !== this.file) { return; }
      const path = this.file.path;
      this.releaseImage();
      this.bodyEl.dataset.imageStatus = "error";
      this.status.classList.add("is-error");
      this.status.textContent = "This file was deleted from the vault: " + path;
    }));
  }

  getViewType(): string { return "image"; }
  override getDisplayText(): string { return this.file?.name ?? "Image"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), imageZoom: this.zoom }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    const zoom = readZoom(state.imageZoom);
    const previous = this.zoom;
    this.zoom = zoom;
    try {
      await super.setState(state, result);
      this.resizeImage();
    } catch (error) {
      this.zoom = previous;
      this.resizeImage();
      throw error;
    }
  }
  override focus(): void { this.stage.focus(); }
  override onResize(): void { this.resizeImage(); }
  override async onLoadFile(file: TFile): Promise<void> { await this.loadImage(file); }
  override async onRename(file: TFile): Promise<void> { await this.loadImage(file); }
  override async onUnloadFile(): Promise<void> { this.releaseImage(); }

  private releaseImage(): void {
    this.generation++;
    this.ready = false;
    this.bodyEl.dataset.imageStatus = "idle";
    delete this.bodyEl.dataset.imageScale; delete this.bodyEl.dataset.imageBlocked;
    this.image.onload = null; this.image.onerror = null;
    this.image.removeAttribute("src");
    this.image.style.removeProperty("width"); this.image.style.removeProperty("height");
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.resizeImage();
  }

  private async loadImage(file: TFile): Promise<void> {
    const type = imageTypes.get(file.extension.toLowerCase());
    if (!type) { throw new Error("This file is not a supported raster image."); }
    this.releaseImage();
    const generation = this.generation, root = this.app.vault.rootPath;
    const current = (): boolean => generation === this.generation && root === this.app.vault.rootPath && this.file === file;
    this.bodyEl.dataset.imageFile = file.path;
    this.bodyEl.dataset.imageStatus = "loading";
    this.status.classList.remove("is-error");
    this.status.textContent = "Loading " + file.path + "...";
    let bytes: ArrayBuffer;
    try { bytes = await this.app.vault.readBinary(file); }
    catch (error) {
      if (!current()) { return; }
      this.bodyEl.dataset.imageStatus = "error";
      this.status.classList.add("is-error");
      this.status.textContent = error instanceof Error ? error.message : String(error);
      throw error;
    }
    if (!current()) { return; }
    let mime = type, sanitized: SanitizedSvg | null = null;
    if (type === "image/svg+xml") {
      try { sanitized = sanitizeSvg(bytes); }
      catch (error) { this.failImage(error instanceof Error ? error.message : String(error), file); return; }
    } else {
      const sniffed = sniffMime(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 5120)));
      if (sniffed?.startsWith("image/") && sniffed !== "image/svg+xml") { mime = sniffed; }
    }
    this.image.onload = () => {
      if (!current()) { return; }
      const width = sanitized?.width ?? this.image.naturalWidth, height = sanitized?.height ?? this.image.naturalHeight;
      if (!width || !height) { this.failImage("The image decoded without a size: " + file.path, file); return; }
      this.naturalSize = { width, height };
      this.ready = true;
      this.bodyEl.dataset.imageStatus = "ready";
      const removed = sanitized?.removed.join(", ") ?? "";
      this.status.textContent = `${file.path} - ${width} x ${height}` + (removed ? ` - removed from display: ${removed}` : "");
      if (removed) { this.bodyEl.dataset.imageBlocked = removed; } else { delete this.bodyEl.dataset.imageBlocked; }
      this.resizeImage();
    };
    this.image.onerror = () => {
      if (!current()) { return; }
      this.ready = false;
      this.bodyEl.dataset.imageStatus = "error";
      this.status.classList.add("is-error");
      this.status.textContent = "This host could not decode the image: " + file.path;
      this.resizeImage();
    };
    this.url = URL.createObjectURL(new Blob([sanitized ? sanitized.markup : bytes], { type: mime }));
    this.image.alt = file.name;
    this.image.src = this.url;
  }

  private failImage(message: string, file: TFile): void {
    this.ready = false;
    this.bodyEl.dataset.imageStatus = "error";
    this.bodyEl.dataset.imageFile = file.path;
    this.status.classList.add("is-error");
    this.status.textContent = message;
    this.resizeImage();
  }

  private resizeImage(): void {
    this.zoomIn.disabled = this.zoomOut.disabled = !this.ready;
    if (!this.ready) { this.scaleText.textContent = ""; return; }
    // clientWidth/clientHeight round fractional CSS pixels. One pixel of
    // headroom beyond the surface's 16px padding keeps Fit from adding a scrollbar.
    const { width, height } = this.naturalSize;
    this.scale = this.zoom === "fit" ? Math.min(1, Math.max(1, this.stage.clientWidth - 33) / width, Math.max(1, this.stage.clientHeight - 33) / height) : this.zoom;
    this.image.style.width = width * this.scale + "px";
    this.image.style.height = height * this.scale + "px";
    this.bodyEl.dataset.imageScale = String(this.scale);
    this.scaleText.textContent = Math.round(this.scale * 100) + "%";
    this.zoomIn.disabled = this.scale >= 8;
    this.zoomOut.disabled = this.scale <= 0.1;
  }
}
