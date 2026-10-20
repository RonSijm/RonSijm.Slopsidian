import type { App } from "./app";
import { Modal } from "./ui";
import { canvasExportFilename, canvasJpegQuality, canvasWebpQuality, rasterizeCanvasExport, serializeCanvasExport, type CanvasExportFrame, type CanvasExportSettings, type CanvasExportSvg } from "./canvas-export";
import { prepareCanvasLocalContent, type CanvasExportSource, type CanvasLocalContentReview } from "./canvas-local-content-export";

export class CanvasExportModal extends Modal {
  private readonly format = document.createElement("select");
  private readonly scopeChoice = document.createElement("select");
  private readonly background = document.createElement("select");
  private readonly width = document.createElement("input");
  private readonly height = document.createElement("input");
  private readonly localContent = document.createElement("input");
  private readonly groupBackgrounds = document.createElement("input");
  private readonly formattedMarkdown = document.createElement("input");
  private readonly jpegQuality = document.createElement("input");
  private readonly jpegQualityLabel = document.createElement("label");
  private readonly webpQuality = document.createElement("input");
  private readonly webpQualityLabel = document.createElement("label");
  private readonly sources = document.createElement("ul");
  private readonly markdownSources = document.createElement("ul");
  private readonly preview = document.createElement("img");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly downloads = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly refs: ReturnType<App["core"]["on"]>[] = [];
  private previewUrl: string | null = null;
  private preparation: AbortController | null = null;
  private revision = 0;
  private stale = false;
  private prepared: { svg: CanvasExportSvg; blob: Blob; format: "svg" | "png" | "jpeg" | "webp"; quality?: number } | null = null;
  private localReview: CanvasLocalContentReview | null = null;

  constructor(app: App, readonly frame: CanvasExportFrame, private readonly authority: { current(): boolean; closed(): void; source?: CanvasExportSource }) {
    super(app); this.setTitle("Export Canvas image"); this.modalEl.dataset.canvasExport = "";
    const help = document.createElement("p"), limits = document.createElement("p"), provenance = document.createElement("p"), choices = document.createElement("div"), dimensions = document.createElement("div"), actions = document.createElement("div"), cancel = document.createElement("button");
    help.textContent = "Review the current board, including unsaved Canvas edits. By default, text stays literal and file cards and group backgrounds use path placeholders. Opt in independently to local note/image cards or static local group backgrounds. An already-open dirty note uses its live unsaved text; the list identifies it and its saved disk version is still checked. Other notes use saved text. Separately choose supported Markdown formatting for text cards and included notes. Websites, HTML and SVG sources stay excluded. Text and images are clipped to card geometry. Exporting does not save any source.";
    limits.textContent = "64–4,096 pixels per side · At most 16,000,000 pixels · Up to 8 MiB each for SVG, PNG, JPEG and WebP. JPEG requires an explicit White or Dark background. WebP also supports transparency. JPEG/WebP quality changes compression and may lose fine detail; preview shows the actual encoded image."; limits.className = "canvas-export-limits";
    provenance.textContent = `Captured ${frame.capturedAt} · ${frame.nodes.length} cards · ${frame.selection.length} selected · System sans-serif font`;
    choices.className = "canvas-export-choices"; dimensions.className = "canvas-export-dimensions"; actions.className = "canvas-export-actions";
    const select = (control: HTMLSelectElement, key: string, title: string, values: readonly (readonly [string, string])[]): void => {
      control.dataset["canvasExport" + key] = ""; control.setAttribute("aria-label", title);
      for (const [value, label] of values) { const option = document.createElement("option"); option.value = value; option.textContent = label; if (value === "selection" && !frame.selection.length) { option.disabled = true; } control.append(option); }
      const label = document.createElement("label"); label.append(title + " ", control); choices.append(label);
    };
    select(this.format, "Format", "Image format", [["svg", "SVG"], ["png", "PNG"], ["jpeg", "JPEG (.jpg)"], ["webp", "WebP"]]);
    select(this.scopeChoice, "Scope", "Captured cards", [["whole", "Whole Canvas"], ["selection", "Selected cards"]]);
    select(this.background, "Background", "Image background", [["white", "White"], ["dark", "Dark"], ["transparent", "Transparent"]]);
    this.jpegQuality.type = "number"; this.jpegQuality.min = "10"; this.jpegQuality.max = "100"; this.jpegQuality.step = "1"; this.jpegQuality.value = "90"; this.jpegQuality.dataset.canvasExportJpegQuality = ""; this.jpegQuality.setAttribute("aria-label", "JPEG quality percentage");
    this.jpegQualityLabel.className = "canvas-export-jpeg-quality"; this.jpegQualityLabel.dataset.canvasExportJpegQualityLabel = ""; this.jpegQualityLabel.append("JPEG quality (10–100%) ", this.jpegQuality); this.jpegQualityLabel.hidden = true; this.jpegQuality.disabled = true;
    this.webpQuality.type = "number"; this.webpQuality.min = "10"; this.webpQuality.max = "100"; this.webpQuality.step = "1"; this.webpQuality.value = "90"; this.webpQuality.dataset.canvasExportWebpQuality = ""; this.webpQuality.setAttribute("aria-label", "WebP quality percentage");
    this.webpQualityLabel.className = "canvas-export-jpeg-quality"; this.webpQualityLabel.dataset.canvasExportWebpQualityLabel = ""; this.webpQualityLabel.append("WebP quality (10–100%) ", this.webpQuality); this.webpQualityLabel.hidden = true; this.webpQuality.disabled = true;
    this.localContent.type = "checkbox"; this.localContent.dataset.canvasExportLocalContent = ""; this.localContent.setAttribute("aria-label", "Include local file-card content"); this.localContent.disabled = !authority.source;
    const localLabel = document.createElement("label"); localLabel.className = "canvas-export-local-choice"; localLabel.append(this.localContent, " Include local note text and static local images");
    this.groupBackgrounds.type = "checkbox"; this.groupBackgrounds.dataset.canvasExportGroupBackgrounds = ""; this.groupBackgrounds.setAttribute("aria-label", "Include static local group backgrounds"); this.groupBackgrounds.disabled = !authority.source;
    const groupLabel = document.createElement("label"); groupLabel.className = "canvas-export-local-choice"; groupLabel.append(this.groupBackgrounds, " Include static local group backgrounds");
    const groupLimits = document.createElement("p"); groupLimits.className = "canvas-export-limits"; groupLimits.textContent = "Group backgrounds: existing PNG/JPEG/WebP only, using native cover (center crop), ratio (contain) or repeat (intrinsic-size tiles). Images are clipped behind labels and other cards at 30% opacity. Repeat allows 65,536 tiles per group / 262,144 total. Unknown styles, remote, missing and unsupported sources are explicitly omitted. Each group in this scope with a background is reviewed; selecting a group does not select its contained cards.";
    const localLimits = document.createElement("p"); localLimits.className = "canvas-export-limits"; localLimits.textContent = "Shared local content/background budget: up to 64 file cards and group backgrounds combined / 32 distinct sources · 262,144 characters per note / 524,288 total · 2 MiB per raster / 4 MiB total · Static images up to 4,096 per side and 16,000,000 pixels · Five seconds per preparation/check. Missing and unsupported sources are listed explicitly. A failed read stops preparation.";
    this.formattedMarkdown.type = "checkbox"; this.formattedMarkdown.dataset.canvasExportFormattedMarkdown = ""; this.formattedMarkdown.setAttribute("aria-label", "Format supported Markdown");
    const markdownLabel = document.createElement("label"); markdownLabel.className = "canvas-export-local-choice"; markdownLabel.append(this.formattedMarkdown, " Format supported Markdown");
    const markdownLimits = document.createElement("p"); markdownLimits.className = "canvas-export-limits"; markdownLimits.textContent = "Formatting: headings, emphasis, strong/struck text, inline/fenced code, simple lists/tasks, quotes, inert link labels and supported pipe tables. Tables use equal-width aligned columns: up to eight per card, eight columns, 32 rows including header, 256 cells and 16 wrapped lines per cell. Escaped pipes and pipes in matched code spans stay in their cell. Malformed, unsupported, oversized or too-narrow tables stay literal with a reason. HTML, images, wiki links/embeds, math, callouts and indented code stay literal. No plugin rendering or external resources. Approximate system-font wrapping; tabs become four spaces. Up to 64 text/note cards · First 16,384 source characters / 512 lines per card · 524,288 characters / 8,192 inline pieces total. Each card reports fallbacks, replacements and clipping below.";
    this.sources.dataset.canvasExportSources = ""; this.sources.className = "canvas-export-sources"; this.sources.setAttribute("aria-label", "Included and omitted local file cards and group backgrounds"); this.sources.hidden = true;
    this.markdownSources.dataset.canvasExportMarkdownSources = ""; this.markdownSources.className = "canvas-export-sources canvas-export-markdown-sources"; this.markdownSources.setAttribute("aria-label", "Formatted Markdown and literal fallback review"); this.markdownSources.hidden = true;
    for (const [control, key, title, value] of [[this.width, "Width", "Image width", "1000"], [this.height, "Height", "Image height", "700"]] as const) {
      control.type = "number"; control.min = "64"; control.max = "4096"; control.step = "1"; control.value = value; control.dataset["canvasExport" + key] = ""; control.setAttribute("aria-label", title);
      const label = document.createElement("label"); label.append(title + " ", control); dimensions.append(label);
    }
    this.preview.dataset.canvasExportPreview = ""; this.preview.className = "canvas-export-preview"; this.preview.alt = "Literal Canvas cards and connections image preview"; this.preview.draggable = false; this.preview.hidden = true;
    this.status.dataset.canvasExportStatus = ""; this.status.setAttribute("role", "status"); this.error.dataset.canvasExportError = ""; this.error.className = "plugin-error"; this.error.setAttribute("role", "alert");
    this.action.type = cancel.type = "button"; this.action.dataset.canvasExportDownload = ""; this.action.disabled = true; cancel.dataset.canvasExportCancel = ""; cancel.textContent = "Cancel";
    this.action.addEventListener("click", () => { void this.download(); }); cancel.addEventListener("click", () => this.close());
    for (const control of [this.format, this.scopeChoice, this.background, this.width, this.height, this.localContent, this.groupBackgrounds, this.formattedMarkdown, this.jpegQuality, this.webpQuality]) { control.addEventListener("change", () => { void this.prepare(); }); }
    actions.append(this.action, cancel); this.contentEl.append(help, limits, choices, dimensions, this.jpegQualityLabel, this.webpQualityLabel, localLabel, groupLabel, localLimits, groupLimits, markdownLabel, markdownLimits, provenance, this.status, this.sources, this.markdownSources, this.preview, this.error, actions);
  }
  override onOpen(): void {
    this.refs.push(this.app.core.on("changed", () => { if (!this.authority.current()) { this.invalidate(); } }));
    void this.prepare();
  }
  invalidate(message = "The Canvas changed. Close this review and export its current cards again."): void {
    if (this.stale) { return; } this.stale = true; this.retire(); this.action.disabled = true; this.status.textContent = "This captured review is stale."; this.error.textContent = message;
  }
  private owns(revision: number): boolean { return this.isOpen && this.containerEl.isConnected && !this.stale && revision === this.revision && this.authority.current(); }
  private async prepare(): Promise<void> {
    if (!this.isOpen || this.stale) { return; } this.retire(); const revision = this.revision;
    this.action.disabled = true; this.action.textContent = this.format.value === "webp" ? "Download WebP" : this.format.value === "jpeg" ? "Download JPEG" : this.format.value === "png" ? "Download PNG" : "Download SVG"; this.error.textContent = ""; this.status.textContent = "Preparing captured Canvas…";
    this.jpegQualityLabel.hidden = this.format.value !== "jpeg"; this.jpegQuality.disabled = this.jpegQualityLabel.hidden;
    this.webpQualityLabel.hidden = this.format.value !== "webp"; this.webpQuality.disabled = this.webpQualityLabel.hidden;
    if (!this.owns(revision)) { this.invalidate(); return; }
    try {
      const controller = this.preparation = new AbortController();
      const settings: CanvasExportSettings = { scope: this.scopeChoice.value as CanvasExportSettings["scope"], background: this.background.value as CanvasExportSettings["background"], width: this.width.value.trim() ? Number(this.width.value) : NaN, height: this.height.value.trim() ? Number(this.height.value) : NaN, ...(this.localContent.checked ? { localContent: true } : {}), ...(this.groupBackgrounds.checked ? { groupBackgrounds: true } : {}), ...(this.formattedMarkdown.checked ? { formattedMarkdown: true } : {}) };
      const format = this.format.value;
      if (format !== "svg" && format !== "png" && format !== "jpeg" && format !== "webp") { throw new Error("Choose SVG, PNG, JPEG or WebP."); }
      const qualityInput = format === "webp" ? this.webpQuality : this.jpegQuality;
      const quality = format === "jpeg" || format === "webp" ? qualityInput.value.trim() ? Number(qualityInput.value) : NaN : undefined;
      if (format === "jpeg") { canvasJpegQuality(quality!); if (settings.background === "transparent") { throw new Error("JPEG has no transparency. Explicitly choose White or Dark background before preparing JPEG."); } }
      if (format === "webp") { canvasWebpQuality(quality!); }
      if (settings.localContent || settings.groupBackgrounds) {
        if (!this.authority.source) { throw new Error("Local content needs its current Canvas source owner."); }
        this.status.textContent = "Reading and checking local file cards and group backgrounds…";
        const review = await prepareCanvasLocalContent(this.app, this.frame, settings, this.authority.source, { signal: controller.signal, current: () => this.owns(revision) });
        if (!this.owns(revision)) { review.dispose(); return; } this.localReview = review;
        this.sources.hidden = false;
        for (const text of review.rows) { const row = document.createElement("li"); row.textContent = text; this.sources.append(row); }
        if (!review.rows.length) { const row = document.createElement("li"); row.textContent = "This scope has no opted-in file cards or group backgrounds. Websites remain excluded."; this.sources.append(row); }
      }
      const localReview = this.localReview, svg = serializeCanvasExport(this.frame, settings, localReview?.content);
      if (svg.markdown) { this.markdownSources.hidden = false; for (const text of svg.markdown.rows) { const row = document.createElement("li"); row.textContent = text; this.markdownSources.append(row); } }
      this.preview.alt = settings.groupBackgrounds ? "Canvas cards with reviewed local group backgrounds image preview" : settings.formattedMarkdown ? "Canvas cards with supported Markdown formatting image preview" : "Literal Canvas cards and connections image preview";
      if (localReview) { await localReview.verify(); } if (!this.owns(revision)) { return; }
      const svgBlob = new Blob([svg.text], { type: "image/svg+xml;charset=utf-8" }); this.previewUrl = URL.createObjectURL(svgBlob); this.preview.src = this.previewUrl; this.preview.hidden = false;
      const summary = `${svg.cards} cards · ${svg.edges} connections · ${svg.width} × ${svg.height} pixels · ${svg.bytes} SVG UTF-8 bytes · ${svg.clippedCards} cards with clipped text` + (svg.localContent ? ` · Included ${svg.localContent.notes} note cards / ${svg.localContent.images} images · Omitted ${svg.localContent.omitted} file cards (reasons above)` : " · Literal file placeholders") + (svg.groupBackgrounds ? ` · Included ${svg.groupBackgrounds.images} group backgrounds / omitted ${svg.groupBackgrounds.omitted} (styles and reasons above)` : "") + (svg.markdown ? ` · ${svg.markdown.cards} text/note cards with supported Markdown formatting (fallbacks and clipping below)` : "");
      const label = format === "webp" ? "WebP" : format === "jpeg" ? "JPEG" : "PNG", qualitySummary = format === "jpeg" ? ` · JPEG quality ${quality}% · Opaque ${settings.background} background · Lossy compression` : format === "webp" ? ` · WebP quality ${quality}% · ${settings.background === "transparent" ? "Transparent" : "Opaque " + settings.background} background · Lossy compression` : "";
      this.status.textContent = summary + qualitySummary + (format !== "svg" ? " · Preparing " + label + "…" : "");
      const blob = format !== "svg" ? await rasterizeCanvasExport(svg, { document: this.modalEl.ownerDocument, signal: controller.signal, current: () => this.owns(revision), ...(format === "jpeg" || format === "webp" ? { format, quality } : {}) }) : svgBlob;
      if (localReview) { await localReview.verify(); }
      if (!this.owns(revision)) { if (!this.stale && this.isOpen) { this.invalidate(); } return; }
      if (format === "jpeg" || format === "webp") { if (this.previewUrl !== null) { URL.revokeObjectURL(this.previewUrl); } this.previewUrl = URL.createObjectURL(blob); this.preview.src = this.previewUrl; this.preview.alt = "Prepared " + label + " with reviewed quality and " + settings.background + " background"; }
      this.prepared = { svg, blob, format, ...(format === "jpeg" || format === "webp" ? { quality } : {}) }; this.status.textContent = summary + qualitySummary + (format !== "svg" ? ` · ${blob.size} prepared ${label} bytes` : ""); this.action.disabled = false;
    } catch (error) {
      if (this.isOpen && !this.stale && revision === this.revision) { if (!this.authority.current()) { this.invalidate(); } else { this.retire(); this.status.textContent = "Image not prepared. Disable local content and group backgrounds to use literal export, choose SVG/PNG if encoding is unavailable, or close and review the current sources again."; this.error.textContent = error instanceof Error ? error.message : String(error); } }
    }
  }
  private async download(): Promise<void> {
    const prepared = this.prepared, revision = this.revision, localReview = this.localReview;
    if (!prepared || !this.owns(this.revision)) { this.invalidate(); return; }
    if (prepared.format !== this.format.value || prepared.format === "jpeg" && prepared.quality !== Number(this.jpegQuality.value) || prepared.format === "webp" && prepared.quality !== Number(this.webpQuality.value) || prepared.svg.settings.scope !== this.scopeChoice.value || prepared.svg.settings.background !== this.background.value || prepared.svg.width !== Number(this.width.value) || prepared.svg.height !== Number(this.height.value) || Boolean(prepared.svg.settings.localContent) !== this.localContent.checked || Boolean(prepared.svg.settings.groupBackgrounds) !== this.groupBackgrounds.checked || Boolean(prepared.svg.settings.formattedMarkdown) !== this.formattedMarkdown.checked) { this.invalidate("Image choices changed before download. Close this review and export again."); return; }
    let url: string | null = null;
    try {
      if (localReview) { this.action.disabled = true; this.status.textContent = "Checking exact local source versions before download…"; await localReview.verify(); }
      if (!this.owns(revision) || prepared !== this.prepared) { return; }
      url = URL.createObjectURL(prepared.blob); const ownedUrl = url; this.downloads.set(url, setTimeout(() => this.releaseDownload(ownedUrl), 1000));
      const link = this.modalEl.ownerDocument.createElement("a"); link.href = url; link.download = canvasExportFilename(this.frame.title, prepared.format); link.click(); this.status.textContent += " · Download requested.";
      this.action.disabled = false;
    } catch (error) { if (url !== null) { this.releaseDownload(url); } if (this.owns(revision)) { this.invalidate(error instanceof Error ? error.message : String(error)); } }
  }
  private releaseDownload(url: string): void { const timer = this.downloads.get(url); if (timer !== undefined) { clearTimeout(timer); this.downloads.delete(url); URL.revokeObjectURL(url); } }
  private retire(): void { this.revision++; this.prepared = null; this.preparation?.abort(); this.preparation = null; this.localReview?.dispose(); this.localReview = null; if (this.sources) { this.sources.replaceChildren(); this.sources.hidden = true; } if (this.markdownSources) { this.markdownSources.replaceChildren(); this.markdownSources.hidden = true; } this.preview.hidden = true; this.preview.removeAttribute("src"); if (this.previewUrl !== null) { URL.revokeObjectURL(this.previewUrl); this.previewUrl = null; } for (const url of this.downloads.keys()) { this.releaseDownload(url); } }
  override onClose(): void { this.retire(); this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.authority.closed(); }
}
