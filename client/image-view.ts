import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import type { TFile } from "./vault";
import { FileView } from "./views";
import type { Workspace, WorkspaceLeaf } from "./workspace";

const imageTypes = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
  ["gif", "image/gif"], ["webp", "image/webp"], ["avif", "image/avif"],
]);
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
  private url: string | null = null;
  private generation = 0;

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
    const observer = new ResizeObserver(() => this.resizeImage());
    observer.observe(this.stage);
    this.register(() => observer.disconnect());
    this.register(() => this.releaseImage());
    this.registerEvent(this.app.vault.on("modify", file => {
      if (this.file && file === this.file) { return this.loadImage(this.file); }
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
    delete this.bodyEl.dataset.imageScale;
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
    this.image.onload = () => {
      if (!current()) { return; }
      this.ready = true;
      this.bodyEl.dataset.imageStatus = "ready";
      this.status.textContent = `${file.path} - ${this.image.naturalWidth} x ${this.image.naturalHeight}`;
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
    this.url = URL.createObjectURL(new Blob([bytes], { type }));
    this.image.alt = file.name;
    this.image.src = this.url;
  }

  private resizeImage(): void {
    this.zoomIn.disabled = this.zoomOut.disabled = !this.ready;
    if (!this.ready) { this.scaleText.textContent = ""; return; }
    this.scale = this.zoom === "fit" ? Math.min(1, Math.max(1, this.stage.clientWidth - 32) / this.image.naturalWidth, Math.max(1, this.stage.clientHeight - 32) / this.image.naturalHeight) : this.zoom;
    this.image.style.width = this.image.naturalWidth * this.scale + "px";
    this.image.style.height = this.image.naturalHeight * this.scale + "px";
    this.bodyEl.dataset.imageScale = String(this.scale);
    this.scaleText.textContent = Math.round(this.scale * 100) + "%";
    this.zoomIn.disabled = this.scale >= 8;
    this.zoomOut.disabled = this.scale <= 0.1;
  }
}
