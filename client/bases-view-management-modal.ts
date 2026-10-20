import type { App } from "./app";
import { BaseDocument } from "./bases-model";
import { BaseViewManagementReview, MAX_BASE_VIEW_NAME, type BaseManagedViewType, type BaseViewChange, type BaseViewManagementAuthority } from "./bases-view-management";
import { Modal } from "./ui";
import type { TFile } from "./vault";

export class BaseViewManagementModal extends Modal {
  private readonly editor = document.createElement("fieldset");
  private readonly operation = document.createElement("select");
  private readonly name = document.createElement("input");
  private readonly type = document.createElement("select");
  private readonly nameLabel = document.createElement("label");
  private readonly typeLabel = document.createElement("label");
  private readonly hint = document.createElement("p");
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private review: BaseViewManagementReview | null = null;
  private busy = false;
  private terminal = false;
  private generatedName = "";
  private priorOperation = "";

  constructor(app: App, private readonly file: TFile, private readonly source: string, private readonly selected: string, private readonly authority: BaseViewManagementAuthority & { closed(): void }) {
    super(app); this.setTitle("Manage base views"); this.modalEl.dataset.basesViewManagement = ""; this.modalEl.classList.add("bases-view-management-modal");
  }
  override onOpen(): void {
    const model = new BaseDocument(this.source), current = model.views.findIndex(view => view.name === this.selected);
    const intro = document.createElement("p"), legend = document.createElement("legend"), operationLabel = document.createElement("label"), actions = document.createElement("div"), cancel = document.createElement("button");
    intro.textContent = `Current view: “${this.selected}” (${model.views[current]?.type ?? "unknown"}). Review the exact base YAML before saving one view change. Note contents are kept.`;
    legend.textContent = "View change"; operationLabel.append("Operation", this.operation); this.operation.dataset.basesViewOperation = "";
    for (const [value, label] of [["add", "Add view"], ["duplicate", "Duplicate current view"], ["rename", "Rename current view"], ["earlier", "Move earlier"], ["later", "Move later"], ["remove", "Remove current view"]]) {
      const option = new Option(label, value);
      option.disabled = value === "earlier" && current === 0 || value === "later" && current === model.views.length - 1 || value === "remove" && model.views.length === 1
        || (value === "add" || value === "duplicate") && model.views.length >= 64;
      this.operation.add(option);
    }
    if (model.views.length >= 64) { this.operation.value = "rename"; }
    this.name.type = "text"; this.name.maxLength = MAX_BASE_VIEW_NAME; this.name.spellcheck = false; this.name.dataset.basesViewName = "";
    this.type.dataset.basesViewType = ""; for (const [value, label] of [["table", "Table"], ["list", "List"], ["cards", "Cards"]]) { this.type.add(new Option(label, value)); }
    this.nameLabel.append("New view name", this.name); this.typeLabel.append("New view type", this.type); this.hint.dataset.basesViewHint = "";
    const last = document.createElement("p"); last.dataset.basesViewLastGuard = ""; last.hidden = model.views.length !== 1; last.textContent = "Keep at least one view. Add a view before removing this last view.";
    this.editor.append(legend, operationLabel, this.nameLabel, this.typeLabel, this.hint, last);
    this.preview.hidden = true; this.preview.dataset.basesViewPreview = "";
    this.status.dataset.basesViewStatus = ""; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.action.type = this.back.type = cancel.type = "button"; this.action.dataset.basesViewReview = ""; this.action.textContent = "Review change";
    this.back.dataset.basesViewBack = ""; this.back.textContent = "Edit draft"; this.back.hidden = true;
    cancel.dataset.basesViewCancel = ""; cancel.textContent = "Cancel"; actions.className = "bases-view-management-actions"; actions.append(this.action, this.back, cancel);
    this.action.addEventListener("click", () => { void this.run(); }); this.back.addEventListener("click", () => this.editDraft()); cancel.addEventListener("click", () => this.close());
    this.operation.addEventListener("change", () => this.updateDraft(model)); this.type.addEventListener("change", () => this.updateDraft(model));
    this.contentEl.append(intro, this.editor, this.preview, actions, this.status); this.updateDraft(model); this.operation.focus();
  }
  private updateDraft(model: BaseDocument): void {
    const operation = this.operation.value, named = ["add", "duplicate", "rename"].includes(operation);
    const changed = operation !== this.priorOperation; this.priorOperation = operation;
    this.nameLabel.hidden = !named; this.typeLabel.hidden = operation !== "add";
    if (operation === "rename" && changed) { this.name.value = this.selected; }
    else if (operation !== "rename" && named && (changed || !this.name.value || this.name.value === this.generatedName)) {
      const prefix = operation === "duplicate" ? this.selected + " copy" : this.type.options[this.type.selectedIndex].text;
      let candidate = prefix.slice(0, MAX_BASE_VIEW_NAME);
      for (let number = 2; model.views.some(view => view.name.normalize("NFKC").toLowerCase() === candidate.normalize("NFKC").toLowerCase()); number++) {
        const suffix = " " + number; candidate = prefix.slice(0, MAX_BASE_VIEW_NAME - suffix.length) + suffix;
      }
      this.name.value = candidate; this.generatedName = candidate;
    }
    this.hint.textContent = operation === "add" ? "A new view starts with an explicit file.name column and the chosen type. Shared base settings still apply. Choose Duplicate to retain a view's complete configuration."
      : operation === "duplicate" ? "Duplicate retains the current type and complete configuration, including unknown settings and unsupported renderer types. The new copy appears immediately after the current view."
      : operation === "rename" ? "Existing links or embeds using the old name and local folds under that name are kept. Review those destinations separately."
      : operation === "remove" ? "Only this named view's configuration is removed. Matching notes, shared settings, links and embeds are kept."
      : "Move this view one adjacent position while retaining its complete configuration.";
    this.status.textContent = "";
  }
  private change(): BaseViewChange {
    switch (this.operation.value) {
      case "add": return { kind: "add", name: this.name.value, type: this.type.value as BaseManagedViewType };
      case "duplicate": case "rename": return { kind: this.operation.value, name: this.name.value };
      case "earlier": return { kind: "move", direction: -1 };
      case "later": return { kind: "move", direction: 1 };
      case "remove": return { kind: "remove" };
      default: throw new Error("Choose a view-management operation.");
    }
  }
  private editDraft(): void {
    if (this.busy || this.terminal || !this.authority.current()) { return; }
    this.review?.close(); this.review = null; this.preview.hidden = true; this.preview.replaceChildren(); this.editor.hidden = false; this.editor.disabled = false;
    this.action.textContent = "Review change"; this.action.removeAttribute("data-bases-view-apply"); this.action.dataset.basesViewReview = ""; this.back.hidden = true; this.status.textContent = ""; this.operation.focus();
  }
  private async run(): Promise<void> {
    if (this.busy || this.terminal) { return; }
    try {
      this.app.vault.assertWritable("modify", this.file.path);
      if (!this.authority.current() || !this.containerEl.isConnected) { throw new Error("This base or view owner changed. Cancel and start a fresh review."); }
      if (!this.review) {
        const review = new BaseViewManagementReview(this.app, this.file, this.source, this.selected, this.change(), this.authority);
        const description = document.createElement("p"), order = document.createElement("output"), source = document.createElement("pre"), endings = document.createElement("p");
        description.textContent = review.plan.description; description.dataset.basesViewEffect = "";
        order.textContent = review.plan.names.join(" → "); order.dataset.basesViewOrder = "";
        source.textContent = review.plan.source; source.dataset.basesViewSource = ""; source.tabIndex = 0;
        const breaks = this.source.match(/\r\n|\r|\n/g) ?? [], styles = new Set(breaks);
        endings.textContent = "Exact reviewed base text: " + (styles.size > 1 ? "existing mixed" : styles.has("\r\n") ? "CRLF" : styles.has("\r") ? "CR" : "LF") + " line endings; the saved file's existing UTF-8 BOM is retained. Apply saves this reviewed base change.";
        this.preview.replaceChildren(description, order, endings, source); this.review = review; this.preview.hidden = false; this.editor.hidden = true; this.editor.disabled = true;
        this.action.textContent = "Apply and save"; this.action.removeAttribute("data-bases-view-review"); this.action.dataset.basesViewApply = ""; this.back.hidden = false; this.status.textContent = "Review the complete YAML, then Apply and save or Cancel."; this.action.focus(); return;
      }
      this.busy = true; this.action.disabled = true; this.back.disabled = true;
      await this.app.core.run(() => this.review!.apply()); this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.terminal = Boolean(this.review);
      this.status.textContent = (this.review?.attempted ? "The reviewed edit reached the base save pipeline; saving was not confirmed. Its unsaved source is retained in the pane. Inspect it before another change. "
        : this.review ? "No view edit was applied. " : "") + message;
    } finally {
      this.busy = false; this.action.disabled = this.terminal; this.back.disabled = this.terminal;
    }
  }
  override onClose(): void { this.review?.close(); this.authority.closed(); }
}
