import type { App } from "./app";
import { Modal } from "./ui";
import { historyVisitLimit } from "./web-history-limit";

export class WebHistoryLimitModal extends Modal {
  private readonly input = document.createElement("input");
  private readonly error = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly save = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private valid = true;
  busy = false;
  get available(): boolean { return this.isOpen && this.valid; }

  constructor(app: App, review: { limit: number; count: number }, private readonly actions: {
    save: (value: number) => Promise<void>; closed: () => void;
  }) {
    super(app); this.setTitle("History visit limit"); this.modalEl.setAttribute("aria-label", "History visit limit");
    this.contentEl.dataset.webHistoryLimit = "";
    this.contentEl.style.display = "grid"; this.contentEl.style.gap = "14px";
    this.status.dataset.webHistoryLimitStatus = ""; this.status.setAttribute("role", "status");
    this.status.textContent = "This vault has " + review.count + " saved visits. Current limit: " + historyVisitLimit(review.limit) + ".";
    const hint = document.createElement("p");
    hint.textContent = "Saving changes only this vault's policy and keeps existing visits. The next new recorded visit applies the count limit after the age limit. Raising the limit cannot restore visits already removed.";
    const label = document.createElement("label"); label.textContent = "Maximum saved visits (1–1,000)";
    label.style.display = "grid"; label.style.gap = "8px";
    this.input.type = "number"; this.input.min = "1"; this.input.max = "1000"; this.input.step = "1"; this.input.required = true;
    this.input.value = String(review.limit); this.input.dataset.webHistoryLimitInput = ""; this.input.setAttribute("aria-label", "Maximum saved visits");
    this.input.addEventListener("input", () => this.update(true));
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void this.saveLimit(); }
    });
    label.append(this.input);
    this.error.className = "plugin-error"; this.error.dataset.webHistoryLimitError = ""; this.error.setAttribute("role", "alert"); this.error.hidden = true;
    const buttons = document.createElement("div"); buttons.className = "modal-button-container";
    this.save.type = this.cancel.type = "button"; this.save.textContent = "Save visit limit"; this.save.className = "mod-cta"; this.save.dataset.webHistoryLimitAction = "save";
    this.cancel.textContent = "Cancel"; this.cancel.dataset.webHistoryLimitAction = "cancel";
    this.save.addEventListener("click", () => { void this.saveLimit(); }); this.cancel.addEventListener("click", () => this.close());
    buttons.append(this.cancel, this.save); this.contentEl.append(this.status, hint, label, this.error, buttons); this.update();
  }
  override onOpen(): void { this.input.focus(); this.input.select(); }
  private value(): number {
    if (!this.input.value || this.input.validity.badInput) { throw new Error("Use a whole-number visit limit from 1 to 1,000."); }
    return historyVisitLimit(this.input.valueAsNumber);
  }
  private update(showValidation = false): void {
    let validInput = false;
    if (this.valid) {
      try { this.value(); validInput = true; this.input.removeAttribute("aria-invalid"); if (showValidation) { this.error.hidden = true; } }
      catch (error) { this.input.setAttribute("aria-invalid", "true"); if (showValidation) { this.showError(error); } }
    }
    this.input.disabled = this.busy || !this.valid; this.save.disabled = this.busy || !this.valid || !validInput; this.cancel.disabled = this.busy;
  }
  private showError(issue: unknown): void { this.error.textContent = issue instanceof Error ? issue.message : String(issue); this.error.hidden = false; }
  private async saveLimit(): Promise<void> {
    if (this.busy || !this.available) { return; }
    let value: number; try { value = this.value(); } catch (error) { this.showError(error); this.update(); return; }
    this.busy = true; this.error.hidden = true; this.update(); let saved = false;
    try { await this.actions.save(value); saved = true; }
    catch (error) { if (this.isOpen) { this.showError(error); } }
    finally { this.busy = false; this.update(); }
    if (saved) { this.forceClose(); }
  }
  invalidate(): void {
    if (!this.isOpen) { return; }
    this.valid = false; this.status.textContent = "History review expired";
    this.showError(new Error("History changed. Close this review and open Visit limit again.")); this.update();
  }
  override close(): void { if (!this.busy) { this.forceClose(); } }
  forceClose(): void { super.close(); }
  override onClose(): void { this.valid = false; this.actions.closed(); }
}
