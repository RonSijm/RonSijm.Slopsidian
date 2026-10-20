import type { App } from "./app";
import { Modal } from "./ui";
import { graphExportFilename, rasterizeGraphExport, serializeGraphExport, type GraphExportFrame, type GraphExportSettings, type GraphExportSvg } from "./graph-export";

/** A review keeps one captured scene; changes retire it rather than silently replacing its image. */
export class GraphExportModal extends Modal {
  private readonly format = document.createElement("select");
  private readonly scopeChoice = document.createElement("select");
  private readonly background = document.createElement("select");
  private readonly width = document.createElement("input");
  private readonly height = document.createElement("input");
  private readonly preview = document.createElement("img");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly downloads = new Map<string, ReturnType<typeof setTimeout>>();
  private previewUrl: string | null = null;
  private preparation: AbortController | null = null;
  private revision = 0;
  private stale = false;
  private prepared: { svg: GraphExportSvg; blob: Blob; format: "svg" | "png" } | null = null;

  constructor(app: App, readonly frame: GraphExportFrame, private readonly authority: { current(): boolean; closed(): void }) {
    super(app); this.setTitle("Export graph image"); this.modalEl.dataset.graphExport = "";
    const help = document.createElement("p"), limits = document.createElement("p"), provenance = document.createElement("details"), provenanceTitle = document.createElement("summary"), captured = document.createElement("p"), appearance = document.createElement("p"), choices = document.createElement("div"), dimensions = document.createElement("div"), actions = document.createElement("div"), cancel = document.createElement("button");
    help.textContent = "Review a captured graph. Camera frame may crop nodes; whole matching graph fits all matching nodes and labels. Changes make this review stale. No notes are saved or fetched, and graph preferences stay unchanged.";
    limits.textContent = "64–4,096 pixels per side · At most 16,000,000 pixels · Up to 8 MiB each for SVG and PNG";
    limits.className = "graph-export-limits"; provenanceTitle.textContent = "Captured scene and image appearance";
    captured.dataset.graphExportProvenance = ""; captured.textContent = `${this.frame.center === null ? "Global graph" : "Local center: " + this.frame.center} · Filter: ${this.frame.search || "none"} · Captured ${this.frame.capturedAt}`;
    appearance.textContent = "Labels, group colors and opacity are retained with export colors and a system sans-serif font. Other image proportions add space around the 10:7 frame. Font appearance can vary outside this application.";
    provenance.append(provenanceTitle, captured, appearance);
    choices.className = "graph-export-choices"; dimensions.className = "graph-export-dimensions"; actions.className = "graph-export-actions";
    const select = (control: HTMLSelectElement, key: string, title: string, values: readonly (readonly [string, string])[]): void => {
      control.dataset["graphExport" + key] = ""; control.setAttribute("aria-label", title);
      for (const [value, label] of values) { const option = document.createElement("option"); option.value = value; option.textContent = label; control.append(option); }
      const label = document.createElement("label"); label.append(title + " ", control); choices.append(label);
    };
    select(this.format, "Format", "Image format", [["svg", "SVG"], ["png", "PNG"]]);
    select(this.scopeChoice, "Scope", "Captured frame", [["camera", "Camera frame"], ["whole", "Whole matching graph"]]);
    select(this.background, "Background", "Image background", [["white", "White"], ["dark", "Dark"], ["transparent", "Transparent"]]);
    for (const [control, key, title, value] of [[this.width, "Width", "Image width", "1000"], [this.height, "Height", "Image height", "700"]] as const) {
      control.type = "number"; control.min = "64"; control.max = "4096"; control.step = "1"; control.value = value; control.dataset["graphExport" + key] = ""; control.setAttribute("aria-label", title);
      const label = document.createElement("label"); label.append(title + " ", control); dimensions.append(label);
    }
    this.preview.dataset.graphExportPreview = ""; this.preview.className = "graph-export-preview"; this.preview.alt = "Captured graph image preview"; this.preview.draggable = false;
    this.status.dataset.graphExportStatus = ""; this.status.setAttribute("role", "status"); this.error.dataset.graphExportError = ""; this.error.className = "plugin-error"; this.error.setAttribute("role", "alert");
    this.action.type = cancel.type = "button"; this.action.dataset.graphExportDownload = ""; this.action.disabled = true; cancel.dataset.graphExportCancel = ""; cancel.textContent = "Cancel";
    this.action.addEventListener("click", () => this.download()); cancel.addEventListener("click", () => this.close());
    for (const control of [this.format, this.scopeChoice, this.background, this.width, this.height]) { control.addEventListener("change", () => { void this.prepare(); }); }
    actions.append(this.action, cancel); this.contentEl.append(help, limits, choices, dimensions, provenance, this.status, this.preview, this.error, actions);
  }

  override onOpen(): void { void this.prepare(); }
  invalidate(message = "The graph changed. Close this review and export the current graph again."): void {
    if (this.stale) { return; } this.stale = true; this.retire(); this.action.disabled = true; this.status.textContent = "This captured review is stale."; this.error.textContent = message;
  }
  private owns(revision: number): boolean { return this.isOpen && this.containerEl.isConnected && !this.stale && revision === this.revision && this.authority.current(); }
  private async prepare(): Promise<void> {
    if (!this.isOpen || this.stale) { return; }
    this.retire(); const revision = this.revision;
    this.action.disabled = true; this.action.textContent = this.format.value === "png" ? "Download PNG" : "Download SVG"; this.error.textContent = ""; this.status.textContent = "Preparing captured frame…";
    if (!this.owns(revision)) { this.invalidate(); return; }
    try {
      const settings: GraphExportSettings = { scope: this.scopeChoice.value as GraphExportSettings["scope"], background: this.background.value as GraphExportSettings["background"], width: this.width.value.trim() ? Number(this.width.value) : NaN, height: this.height.value.trim() ? Number(this.height.value) : NaN };
      const svg = serializeGraphExport(this.frame, settings), format = this.format.value;
      if (format !== "svg" && format !== "png") { throw new Error("Choose SVG or PNG."); }
      const svgBlob = new Blob([svg.text], { type: "image/svg+xml;charset=utf-8" });
      this.previewUrl = URL.createObjectURL(svgBlob); this.preview.src = this.previewUrl;
      const summary = `${this.frame.nodes.length} matching nodes · ${this.frame.edges.length} links · ${svg.width} × ${svg.height} pixels · ${svg.bytes} SVG UTF-8 bytes · ${settings.scope === "camera" ? "Camera; may crop nodes" : "Whole matching graph"}`;
      this.status.textContent = summary + (format === "png" ? " · Preparing PNG…" : "") + (this.frame.warnings.length ? " · Warnings: " + this.frame.warnings.join("; ") : "");
      const controller = this.preparation = new AbortController();
      const blob = format === "png" ? await rasterizeGraphExport(svg, { document: this.modalEl.ownerDocument, signal: controller.signal, current: () => this.owns(revision) }) : svgBlob;
      if (!this.owns(revision)) { if (!this.stale && this.isOpen) { this.invalidate(); } return; }
      this.prepared = { svg, blob, format }; this.status.textContent = summary + (format === "png" ? ` · ${blob.size} prepared PNG bytes` : "") + (this.frame.warnings.length ? " · Warnings: " + this.frame.warnings.join("; ") : ""); this.action.disabled = false;
    } catch (error) {
      if (this.isOpen && !this.stale && revision === this.revision) { if (!this.authority.current()) { this.invalidate(); } else { this.status.textContent = "Image not prepared."; this.error.textContent = error instanceof Error ? error.message : String(error); } }
    }
  }
  private download(): void {
    const prepared = this.prepared;
    if (!prepared || !this.owns(this.revision)) { this.invalidate(); return; }
    if (prepared.format !== this.format.value || prepared.svg.settings.scope !== this.scopeChoice.value || prepared.svg.settings.background !== this.background.value || prepared.svg.width !== Number(this.width.value) || prepared.svg.height !== Number(this.height.value)) { this.invalidate("Image choices changed before download. Close this review and export again."); return; }
    let url: string | null = null;
    try {
      url = URL.createObjectURL(prepared.blob); const ownedUrl = url;
      this.downloads.set(url, setTimeout(() => this.releaseDownload(ownedUrl), 1000));
      const link = this.modalEl.ownerDocument.createElement("a"); link.href = url; link.download = graphExportFilename(this.frame.title, prepared.format); link.click();
      this.status.textContent += " · Download requested.";
    } catch (error) { if (url !== null) { this.releaseDownload(url); } this.error.textContent = error instanceof Error ? error.message : String(error); }
  }
  private releaseDownload(url: string): void { const timer = this.downloads.get(url); if (timer !== undefined) { clearTimeout(timer); this.downloads.delete(url); URL.revokeObjectURL(url); } }
  private retire(): void {
    this.revision++; this.prepared = null; this.preparation?.abort(); this.preparation = null;
    this.preview.removeAttribute("src"); if (this.previewUrl !== null) { URL.revokeObjectURL(this.previewUrl); this.previewUrl = null; }
    for (const url of this.downloads.keys()) { this.releaseDownload(url); }
  }
  override onClose(): void { this.retire(); this.authority.closed(); }
}
