import type { App } from "./app";
import type { CanvasNode } from "./canvas-model";
import { CanvasConversionReview, canvasConversionOutcome, type CanvasConversionAuthority } from "./canvas-convert";
import { Modal, Notice } from "./ui";
import type { TFile } from "./vault";

export class CanvasConvertModal extends Modal {
  private readonly name = document.createElement("input");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly stageIntro = document.createElement("p");
  private readonly refs: ReturnType<App["core"]["on"]>[] = [];
  private review: CanvasConversionReview | null = null;
  private busy = false;
  private terminal = false;
  private stale = false;

  constructor(app: App, private readonly source: TFile, private readonly node: CanvasNode, private readonly authority: CanvasConversionAuthority & { closed(): void }) {
    super(app); this.setTitle("Convert text card to Markdown"); this.modalEl.dataset.canvasConvert = "";
    this.name.type = "text"; this.name.maxLength = 4096; this.name.spellcheck = false; this.name.value = "Untitled"; this.name.dataset.canvasConvertName = ""; this.name.setAttribute("aria-label", "New Markdown note name or existing-folder path");
    this.status.dataset.canvasConvertStatus = ""; this.status.setAttribute("role", "status");
    this.stageIntro.dataset.canvasConvertStageIntro = "";
  }
  override onOpen(): void {
    const help = document.createElement("p"), label = document.createElement("label"), controls = document.createElement("div"), cancel = document.createElement("button");
    help.textContent = "Review an absent Markdown destination and this card's exact text. Creating it replaces this card with a whole-file card in one Canvas Undo step, retaining its identity, geometry and connections. Undo keeps the created file. The Canvas is saved using its normal settings.";
    label.append("New Markdown note name or path", this.name); this.action.type = cancel.type = "button"; this.action.textContent = "Review conversion"; this.action.dataset.canvasConvertReview = "";
    cancel.textContent = "Cancel"; cancel.dataset.canvasConvertCancel = ""; controls.className = "canvas-convert-actions"; controls.append(this.action, cancel);
    this.action.addEventListener("click", () => { void this.run(); }); cancel.addEventListener("click", () => this.close()); this.contentEl.append(help, label, controls, this.status);
    this.refs.push(this.app.core.on("changed", () => { if (!this.authority.current(false) && !this.review?.applying) { this.invalidate(); } })); this.name.focus(); this.lock();
  }
  invalidate(): void {
    if (this.review?.applying || this.terminal) { return; }
    this.stale = true; if (this.review) { this.stageIntro.textContent = canvasConversionOutcome(this.review.receipt); } this.status.textContent = this.review ? canvasConversionOutcome(this.review.receipt, new Error("The Canvas changed. Close and review its current card again.")) : "The Canvas changed. Close and review its current text card again. No file was created."; this.lock();
  }
  private current(): boolean { return this.isOpen && this.containerEl.isConnected && !this.stale && this.authority.current(false); }
  private lock(): void { this.name.disabled = this.busy || this.terminal || this.stale || Boolean(this.review); this.action.disabled = this.busy || this.terminal || !this.current(); }
  private async run(): Promise<void> {
    if (this.busy || this.terminal || !this.current()) { return; } this.busy = true; this.lock();
    try {
      if (!this.review) {
        this.review = new CanvasConversionReview(this.app, this.source, this.name.value, this.node, { current: owned => this.isOpen && this.containerEl.isConnected && !this.stale && this.authority.current(owned), savedSource: () => this.authority.savedSource(), apply: (file, committed) => this.authority.apply(file, committed) });
        const path = document.createElement("strong"), text = document.createElement("pre");
        path.dataset.canvasConvertPath = ""; path.textContent = this.review.path; text.dataset.canvasConvertText = ""; text.textContent = this.review.text;
        this.stageIntro.textContent = "The next action creates this exact UTF-8 text once and then replaces the reviewed card. Cancel writes nothing. A confirmed file is kept if any later check fails or this dialog closes.";
        this.action.removeAttribute("data-canvas-convert-review"); this.action.dataset.canvasConvertCreate = ""; this.action.textContent = "Create note and replace card";
        this.contentEl.querySelector("label")?.replaceWith(path, this.stageIntro, text); this.status.textContent = "Review the full destination and exact card text before creating the note.";
      } else {
        await this.review.createAndConvert(); this.terminal = true;
        this.action.textContent = "Card converted";
        const message = canvasConversionOutcome(this.review.receipt); if (this.isOpen) { this.stageIntro.textContent = message; this.status.textContent = message; } else { new Notice(message, 20_000); }
      }
    } catch (error) {
      const message = this.review ? canvasConversionOutcome(this.review.receipt, error) : error instanceof Error ? error.message : String(error);
      if (this.review) { this.terminal = true; const receipt = this.review.receipt; this.stageIntro.textContent = canvasConversionOutcome(receipt); this.action.textContent = receipt.converted ? "Card converted" : receipt.document ? "Note created" : receipt.attempted ? "Creation unconfirmed" : "Conversion refused"; }
      if (this.isOpen) { this.status.textContent = message; } else if (this.review?.receipt.attempted) { new Notice(message, 20_000); }
    } finally { this.busy = false; if (this.isOpen) { this.lock(); } }
  }
  override onClose(): void { this.review?.close(); this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.authority.closed(); }
}
