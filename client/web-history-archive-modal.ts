import type { App } from "./app";
import { Modal } from "./ui";
import { clipName, clipPath } from "./web-clip-policy";
import { historyArchiveStyle } from "./web-history-archive-style";
import { historyOrder, historyOrderLabel, type WebHistoryOrder } from "./web-history-order";

export class WebHistoryArchiveModal extends Modal {
  private readonly path = document.createElement("input");
  private readonly preview = document.createElement("textarea");
  private readonly error = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly save = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private markdown: string | null;
  private valid = true;
  busy = false;
  get available(): boolean { return this.isOpen && this.valid; }

  constructor(app: App, review: { markdown: string; count: number; selection?: boolean; order?: WebHistoryOrder }, private readonly actions: {
    guard: () => void; create: (path: string, markdown: string) => Promise<void>; closed: () => void;
  }) {
    super(app); this.markdown = review.markdown;
    const style = document.createElement("style"); style.textContent = historyArchiveStyle; this.containerEl.prepend(style);
    const order = historyOrder(review.order), selected = review.selection === true, title = selected ? "Save selected history to a note" : "Save shown history to a note";
    this.setTitle(title); this.modalEl.classList.add("web-history-archive-modal");
    this.modalEl.setAttribute("aria-label", title); this.contentEl.dataset.webHistoryArchive = ""; this.contentEl.dataset.webHistoryArchiveScope = selected ? "selected" : "shown";
    this.contentEl.dataset.webHistoryArchiveOrder = order;
    const hint = document.createElement("p");
    hint.textContent = "Review these " + (selected ? "selected" : "shown") + " visits and choose a new Markdown note path. Saving keeps history unchanged and creates any missing parent folders. This readable snapshot contains titles, addresses and UTC visit times.";
    this.status.textContent = review.count + " " + (selected ? "selected" : "shown") + (review.count === 1 ? " visit" : " visits") + " · " + historyOrderLabel(order);
    this.status.dataset.webHistoryArchiveStatus = ""; this.status.setAttribute("role", "status");
    this.error.className = "plugin-error"; this.error.dataset.webHistoryArchiveError = ""; this.error.setAttribute("role", "alert"); this.error.hidden = true;
    const pathLabel = document.createElement("label"); pathLabel.textContent = "New note path";
    this.path.dataset.webHistoryArchivePath = ""; this.path.setAttribute("aria-label", "New note path"); this.path.maxLength = 4096;
    this.path.addEventListener("input", () => this.update()); pathLabel.append(this.path);
    const occupied = new Set(app.vault.getAllLoadedFiles().map(file => file.path.toLowerCase()));
    this.path.value = clipName("Web history " + (selected ? "selection " : "") + new Date().toISOString().slice(0, 10), "", path => occupied.has(path.toLowerCase()));
    const previewLabel = document.createElement("label"); previewLabel.textContent = "Markdown preview";
    this.preview.dataset.webHistoryArchivePreview = ""; this.preview.setAttribute("aria-label", "History Markdown preview");
    this.preview.readOnly = true; this.preview.spellcheck = false; this.preview.value = this.markdown; previewLabel.append(this.preview);
    const scroll = document.createElement("div"); scroll.className = "web-history-archive-scroll"; scroll.append(hint, this.status, this.error, pathLabel, previewLabel);
    const buttons = document.createElement("div"); buttons.className = "modal-button-container";
    this.save.type = this.cancel.type = "button";
    this.save.textContent = "Save note"; this.save.className = "mod-cta"; this.save.dataset.webHistoryArchiveAction = "save";
    this.cancel.textContent = "Cancel"; this.cancel.dataset.webHistoryArchiveAction = "cancel";
    this.save.addEventListener("click", () => { void this.saveNote(); }); this.cancel.addEventListener("click", () => this.close());
    buttons.append(this.cancel, this.save); this.contentEl.append(scroll, buttons); this.update();
  }
  override onOpen(): void { this.path.focus(); this.path.select(); }
  private update(): void {
    this.save.disabled = this.busy || !this.valid || !this.markdown || !this.path.value;
    this.path.disabled = this.busy || !this.valid; this.cancel.disabled = this.busy;
  }
  private guard(): void {
    if (!this.isOpen || !this.valid || !this.markdown) { throw new Error("This history archive preview is no longer available. Review the shown visits again."); }
    this.actions.guard();
  }
  private showError(issue: unknown): void { this.error.textContent = issue instanceof Error ? issue.message : String(issue); this.error.hidden = false; }
  private async saveNote(): Promise<void> {
    if (this.busy || !this.isOpen || !this.valid || !this.markdown) { return; }
    this.busy = true; this.error.hidden = true; this.update(); let savedPath: string | null = null;
    try {
      const path = clipPath(this.path.value), markdown = this.markdown;
      await this.app.core.run(() => this.app.workspace.withFileMutation(async () => {
        this.guard(); await this.actions.create(path, markdown); savedPath = path;
      }));
    } catch (issue) { if (this.isOpen) { this.showError(issue); } }
    finally { this.busy = false; this.update(); }
    if (savedPath) {
      const file = this.app.vault.getFileByPath(savedPath); this.forceClose();
      if (file) { await this.app.workspace.getLeaf("tab").openFile(file).catch(issue => { console.error("The history note was saved but could not be opened:", issue); }); }
    }
  }
  invalidate(): void {
    if (!this.isOpen) { return; }
    this.valid = false; this.status.textContent = "History review expired";
    this.showError(new Error("The history pane or its shown visits changed. Close this preview and review Save shown visits again.")); this.update();
  }
  override close(): void { if (!this.busy) { this.forceClose(); } }
  forceClose(): void { super.close(); }
  override onClose(): void { this.valid = false; this.markdown = null; this.preview.value = ""; this.actions.closed(); }
}
