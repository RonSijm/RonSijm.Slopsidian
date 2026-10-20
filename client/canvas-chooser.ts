import type { App } from "./app";
import type { TFile } from "./vault";
import { canvasFileChoices, canvasSubpathChoices, type CanvasFileKind } from "./canvas-interaction-model";

export interface CanvasChosenFile { file: TFile; subpath: string }

/** An explicit existing-file review; shares completion ranking and exact subpath rules. */
export class CanvasFileChooser {
  readonly dialog = document.createElement("dialog");
  private readonly events = new AbortController();
  private readonly search = document.createElement("input");
  private readonly files = document.createElement("select");
  private readonly subpaths = document.createElement("select");
  private readonly subpathSearch = document.createElement("input");
  private readonly problem = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly review = document.createElement("p");
  private readonly submit = document.createElement("button");
  private target: { file: TFile; path: string; text: string | null } | null = null;
  private closed = false;

  constructor(private readonly options: {
    app: App; action: "note" | "media" | "replace"; kind: CanvasFileKind; title: string;
    current(): boolean; apply(value: CanvasChosenFile): void; close(): void;
  }) {
    const { action, title } = options, owned = { signal: this.events.signal };
    this.dialog.className = "canvas-create-dialog canvas-file-chooser";
    this.dialog.dataset.canvasCreateDialog = action;
    this.dialog.dataset.canvasFileChooser = action;
    const heading = document.createElement("h3"); heading.textContent = title;
    const explanation = document.createElement("p");
    explanation.textContent = "Choose an existing file and, for an indexed Markdown note, a heading or block. Only this Canvas changes when you confirm.";
    const limits = document.createElement("p"); limits.textContent = "The section list offers up to 40 matching headings and 40 blocks. Refine the section search to find another target.";
    const label = (text: string, input: HTMLElement): HTMLLabelElement => { const label = document.createElement("label"); label.textContent = text; label.append(input); return label; };
    this.search.type = "search"; this.search.maxLength = 256; this.search.dataset.canvasFileSearch = "";
    this.search.setAttribute("aria-label", "Search existing vault files"); this.search.placeholder = "Search existing vault files";
    this.files.dataset.canvasCreateInput = action; this.files.size = 7; this.files.setAttribute("aria-label", "Existing vault file");
    this.subpathSearch.type = "search"; this.subpathSearch.maxLength = 256; this.subpathSearch.dataset.canvasSubpathSearch = "";
    this.subpathSearch.setAttribute("aria-label", "Search headings and blocks");
    this.subpaths.dataset.canvasSubpath = ""; this.subpaths.setAttribute("aria-label", "Whole note, heading or block");
    this.problem.className = "canvas-error"; this.problem.setAttribute("role", "alert");
    this.status.dataset.canvasChooserStatus = ""; this.status.setAttribute("role", "status");
    this.review.dataset.canvasChooserReview = "";
    const form = document.createElement("form"), cancel = document.createElement("button"), actions = document.createElement("div");
    this.submit.type = "submit"; this.submit.textContent = action === "replace" ? "Replace file reference" : "Add to Canvas"; this.submit.dataset.canvasCreateSubmit = "";
    cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.canvasCreateCancel = "";
    actions.className = "dialog-actions"; actions.append(cancel, this.submit);
    form.append(heading, explanation, label("Search files", this.search), label("Existing vault file", this.files), label("Search headings and blocks", this.subpathSearch), label("Preview target", this.subpaths), this.review, limits, this.status, this.problem, actions);
    this.dialog.append(form);
    this.search.addEventListener("input", () => this.refreshFiles(), owned);
    this.files.addEventListener("change", () => this.selectFile(), owned);
    this.subpathSearch.addEventListener("input", () => this.refreshSubpaths(), owned);
    this.subpaths.addEventListener("change", () => this.updateReview(), owned);
    cancel.addEventListener("click", () => this.close(), owned);
    this.dialog.addEventListener("close", () => this.close(), owned);
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); }, owned);
    form.addEventListener("submit", event => { event.preventDefault(); this.accept(); }, owned);
    document.body.append(this.dialog); this.dialog.showModal(); this.refreshFiles(); this.search.focus();
  }

  private guard(): void {
    if (this.closed || !this.dialog.isConnected || !this.dialog.open || !this.options.current()
      || this.options.app.vault.readOnly || this.options.app.workspace.isChangingFiles) { throw new Error("This Canvas review is no longer current or writable. Cancel and review again."); }
  }

  private refreshFiles(): void {
    try {
      this.guard(); this.problem.textContent = "";
      const selected = this.files.value;
      const result = canvasFileChoices(this.options.app.vault.getFiles(), this.options.kind, this.search.value);
      this.files.replaceChildren();
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Choose an existing file"; this.files.append(placeholder);
      for (const file of result.values) { const item = document.createElement("option"); item.value = item.textContent = file.path; this.files.append(item); }
      this.files.value = result.values.some(file => file.path === selected) ? selected : "";
      this.status.textContent = result.total > result.values.length ? "Showing the first 100 of " + result.total + " matches. Refine the search." : result.total + " matching files.";
      this.selectFile();
    } catch (error) { this.refuse(error); }
  }

  private selectFile(): void {
    try {
      this.guard(); this.target = null; this.subpathSearch.value = ""; this.subpaths.value = "";
      const file = this.options.app.vault.getFileByPath(this.files.value);
      if (file) {
        this.options.app.metadataCache.updateOpenDocuments();
        const indexed = this.options.app.metadataCache.getDocument(file.path);
        this.target = { file, path: file.path, text: file.extension.toLowerCase() === "md" && indexed && !indexed.missing ? indexed.text : null };
      }
      this.submit.disabled = !this.target;
      this.refreshSubpaths();
    } catch (error) { this.refuse(error); }
  }

  private refreshSubpaths(): void {
    try {
      this.guard(); const previous = this.subpaths.value;
      this.subpaths.replaceChildren();
      const whole = document.createElement("option"); whole.value = ""; whole.textContent = "Whole file"; this.subpaths.append(whole);
      const target = this.target;
      if (target?.text !== null && target?.text !== undefined) {
        for (const choice of canvasSubpathChoices(target.path, target.text, this.subpathSearch.value)) { const item = document.createElement("option"); item.value = choice.subpath; item.textContent = choice.label; this.subpaths.append(item); }
      }
      this.subpaths.value = Array.from(this.subpaths.options).some(item => item.value === previous) ? previous : "";
      this.subpathSearch.disabled = !target || target.text === null;
      this.subpaths.disabled = !target || target.text === null;
      this.updateReview();
    } catch (error) { this.refuse(error); }
  }

  private accept(): void {
    try {
      this.guard(); const target = this.target;
      if (!target || target.path !== this.files.value || target.file.path !== target.path || this.options.app.vault.getFileByPath(target.path) !== target.file) { throw new Error("The selected file changed. Choose it again."); }
      const subpath = this.subpaths.value;
      if (subpath) {
        this.options.app.metadataCache.updateOpenDocuments();
        const indexed = this.options.app.metadataCache.getDocument(target.path);
        if (!indexed || indexed.missing || indexed.text !== target.text || !canvasSubpathChoices(target.path, indexed.text, this.subpathSearch.value).some(choice => choice.subpath === subpath)) { throw new Error("The heading or block changed. Choose the file and target again."); }
      }
      this.options.apply({ file: target.file, subpath }); this.close();
    } catch (error) { this.refuse(error); }
  }

  private updateReview(): void {
    this.review.textContent = this.target ? "Reviewed target: " + this.target.path + (this.subpaths.value || " (whole file)") : "No file selected.";
  }

  private refuse(error: unknown): void { this.problem.textContent = error instanceof Error ? error.message : String(error); this.submit.disabled = true; }
  close(): void {
    if (this.closed) { return; }
    this.closed = true; this.events.abort(); this.target = null; this.dialog.close(); this.dialog.remove(); this.options.close();
  }
}
