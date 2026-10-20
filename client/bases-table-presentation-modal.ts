import type { App } from "./app";
import { BaseTablePresentationReview, readBaseTablePresentationState, validateBaseTablePresentationDraft, type BaseTablePresentationDraft, type BaseTablePresentationState } from "./bases-table-presentation";
import type { BaseViewManagementAuthority } from "./bases-view-management";
import { Modal } from "./ui";
import type { TFile } from "./vault";

export class BaseTablePresentationModal extends Modal {
  private readonly editor = document.createElement("fieldset");
  private readonly height = document.createElement("select");
  private readonly widths: HTMLInputElement[] = [];
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private readonly state: BaseTablePresentationState;
  private review: BaseTablePresentationReview | null = null;
  private busy = false;
  private terminal = false;
  constructor(app: App, private readonly file: TFile, private readonly source: string, private readonly selected: string, private readonly authority: BaseViewManagementAuthority & { closed(): void }) {
    super(app); app.vault.assertWritable("modify", file.path); this.setTitle("Table presentation"); this.modalEl.dataset.basesTableSettings = ""; this.modalEl.classList.add("bases-table-presentation-modal"); this.state = readBaseTablePresentationState(source, selected);
  }
  override onOpen(): void {
    const intro = document.createElement("p"), legend = document.createElement("legend"), heightLabel = document.createElement("label"), rows = document.createElement("div"), hint = document.createElement("p"), reset = document.createElement("button"), actions = document.createElement("div"), cancel = document.createElement("button");
    intro.textContent = "Saved Table “" + this.selected + "”. Review the exact YAML before saving its row height and displayed column widths."; legend.textContent = "Table dimensions";
    this.height.dataset.basesTableSettingsHeight = ""; this.height.setAttribute("aria-label", "Table row height");
    for (const [value, label] of [["", "Short · 30 px"], ["medium", "Medium · 60 px"], ["tall", "Tall · 120 px"], ["extra", "Extra tall · 240 px"]]) { this.height.add(new Option(label, value)); }
    this.height.value = this.state.rowHeight; heightLabel.append("Data row height", this.height); this.height.addEventListener("change", () => this.validate()); rows.dataset.basesTableSettingsWidths = "";
    for (const entry of this.state.widths) {
      const label = document.createElement("label"), name = document.createElement("span"), key = document.createElement("code"), input = document.createElement("input");
      name.textContent = entry.label; key.textContent = entry.property; input.type = "text"; input.inputMode = "decimal"; input.maxLength = 24; input.value = entry.width; input.placeholder = "Automatic"; input.dataset.basesTableSettingsWidth = entry.property; input.setAttribute("aria-label", "Width for " + entry.property + " in pixels"); input.addEventListener("input", () => this.validate());
      label.className = "bases-table-width-field"; label.append(name, key, input); this.widths.push(input); rows.append(label);
    }
    reset.type = "button"; reset.textContent = "Use automatic widths"; reset.dataset.basesTableSettingsReset = ""; reset.addEventListener("click", () => { for (const input of this.widths) { input.value = ""; } this.validate(); this.widths[0]?.focus(); });
    hint.textContent = "Leave widths blank for automatic sizing, or enter 40–2,000 px. With an explicit width, other automatic columns use 180 px. Cells scroll to show their complete values. " + this.state.hiddenWidths + " hidden stored width settings are kept.";
    this.editor.append(legend, heightLabel, rows, reset, hint); this.preview.hidden = true; this.preview.dataset.basesTableSettingsPreview = "";
    this.status.dataset.basesTableSettingsStatus = ""; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.action.type = "button"; this.action.textContent = "Review change"; this.action.dataset.basesTableSettingsReview = ""; this.action.addEventListener("click", () => { void this.run(); });
    this.back.type = "button"; this.back.textContent = "Edit draft"; this.back.hidden = true; this.back.dataset.basesTableSettingsBack = ""; this.back.addEventListener("click", () => this.editDraft());
    cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.basesTableSettingsCancel = ""; cancel.addEventListener("click", () => this.close()); actions.className = "bases-table-presentation-actions"; actions.append(this.action, this.back, cancel);
    this.contentEl.append(intro, this.editor, this.preview, this.status, actions); this.validate(); this.height.focus();
  }
  private draft(): BaseTablePresentationDraft { return { rowHeight: this.height.value, widths: this.state.widths.map((entry, index) => ({ property: entry.property, width: this.widths[index].value })) }; }
  private validate(): void {
    if (this.review || this.busy || this.terminal) { return; }
    this.editor.disabled = Boolean(this.state.issue); if (this.state.issue) { this.action.disabled = true; this.status.textContent = this.state.issue; return; }
    try {
      const draft = this.draft(); validateBaseTablePresentationDraft(draft, this.state.widths.map(entry => entry.property));
      const changed = draft.rowHeight !== this.state.rowHeight || draft.widths.some((entry, index) => Number(entry.width || 0) !== Number(this.state.widths[index].width || 0));
      this.action.disabled = !changed; this.status.textContent = changed ? "Draft dimensions are valid. Review the exact YAML before saving." : "Change a row height or displayed column width before reviewing.";
      for (const input of this.widths) { input.removeAttribute("aria-invalid"); }
    } catch (error) { this.action.disabled = true; this.status.textContent = error instanceof Error ? error.message : String(error); for (const input of this.widths) { input.setAttribute("aria-invalid", String(input.value !== "" && (!/^\d{1,4}(?:\.\d{1,17})?$/.test(input.value) || Number(input.value) < 40 || Number(input.value) > 2000))); } }
  }
  private editDraft(): void {
    if (this.busy || this.terminal || !this.authority.current()) { return; }
    this.review?.close(); this.review = null; this.preview.hidden = true; this.preview.replaceChildren(); this.editor.hidden = false; this.editor.disabled = false;
    this.action.textContent = "Review change"; this.action.removeAttribute("data-bases-table-settings-apply"); this.action.dataset.basesTableSettingsReview = ""; this.back.hidden = true; this.validate(); this.height.focus();
  }
  private async run(): Promise<void> {
    if (this.busy || this.terminal || this.state.issue) { return; }
    try {
      this.app.vault.assertWritable("modify", this.file.path); if (!this.authority.current() || !this.containerEl.isConnected) { throw new Error("This base or presentation owner changed. Cancel and start a fresh review."); }
      if (!this.review) {
        const review = new BaseTablePresentationReview(this.app, this.file, this.source, this.selected, this.draft(), this.authority), description = document.createElement("p"), effects = document.createElement("ul"), warnings = document.createElement("p"), endings = document.createElement("p"), source = document.createElement("pre");
        description.textContent = review.plan.description; effects.dataset.basesTableSettingsEffects = ""; for (const change of review.plan.changes) { const line = document.createElement("li"); line.textContent = change; effects.append(line); }
        warnings.textContent = review.plan.warnings.join(" "); const styles = new Set(this.source.match(/\r\n|\r|\n/g) ?? []);
        endings.textContent = "Complete exact reviewed YAML; " + (styles.size > 1 ? "existing mixed" : styles.has("\r\n") ? "CRLF" : "LF") + " line endings and the saved UTF-8 BOM are retained. Apply saves this base configuration.";
        source.textContent = review.plan.source; source.dataset.basesTableSettingsSource = ""; source.tabIndex = 0; this.preview.replaceChildren(description, effects, warnings, endings, source); this.review = review; this.preview.hidden = false; this.editor.hidden = true; this.editor.disabled = true;
        this.action.textContent = "Apply and save"; this.action.removeAttribute("data-bases-table-settings-review"); this.action.dataset.basesTableSettingsApply = ""; this.back.hidden = false; this.action.disabled = false; this.status.textContent = "Review all changes and the complete YAML, then Apply and save, Edit draft or Cancel."; this.action.focus(); return;
      }
      this.busy = true; this.action.disabled = this.back.disabled = true; await this.app.core.run(() => this.review!.apply()); this.close();
    } catch (error) { this.terminal = Boolean(this.review); this.status.textContent = (this.review?.attempted ? "Saving was not confirmed; the reviewed unsaved source is retained in the pane. Inspect it before another change. " : this.review ? "No Table presentation edit was applied. " : "") + (error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; if (this.review) { this.action.disabled = this.back.disabled = this.terminal; } }
  }
  override onClose(): void { this.review?.close(); this.authority.closed(); }
}
