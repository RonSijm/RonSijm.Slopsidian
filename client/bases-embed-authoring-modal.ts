import type { App } from "./app";
import { applyEmbeddedProperty, cancelEmbeddedPropertyReview, embeddedPropertyCurrent, embeddedPropertyDraft, embeddedPropertyHasSource, embeddedPropertyOutcome, MAX_BASE_PROPERTY_TEXT, planEmbeddedPropertyEdit, showEmbeddedPropertySource, type EmbeddedPropertyReview } from "./bases-embed-authoring";
import { propertyTypes } from "./property-types";
import { Modal, Notice } from "./ui";

/** A draft belongs to the captured embedded result, not a synthetic Bases leaf. */
export class EmbeddedPropertyModal extends Modal {
  private readonly type = document.createElement("select");
  private readonly value = document.createElement("textarea");
  private readonly checked = document.createElement("input");
  private readonly preview = document.createElement("pre");
  private readonly status = document.createElement("p");
  private readonly source = document.createElement("button");
  private readonly apply = document.createElement("button");
  private busy = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly refs: ReturnType<App["workspace"]["on"]>[] = [];
  private unwatch = (): void => {};

  constructor(app: App, private readonly review: EmbeddedPropertyReview, private readonly closed: () => void) {
    super(app); this.setTitle("Edit " + review.key + " in " + review.file.name);
    this.modalEl.classList.add("bases-embed-property-modal"); this.modalEl.dataset.basesEmbedPropertyModal = "true";
  }
  get settled(): Promise<void> { return this.pending; }
  override onOpen(): void {
    const typeLabel = document.createElement("label"), valueLabel = document.createElement("label"), checkLabel = document.createElement("label"), hint = document.createElement("p"), actions = document.createElement("div"), cancel = document.createElement("button");
    typeLabel.append("Property type ", this.type); this.type.dataset.basesEmbedPropertyType = "true";
    for (const kind of propertyTypes) { const option = document.createElement("option"); option.value = kind; option.textContent = kind; this.type.append(option); }
    this.type.value = this.review.kind;
    valueLabel.append("Value (one item per line for lists)", this.value); this.value.dataset.basesEmbedPropertyValue = "true"; this.value.maxLength = MAX_BASE_PROPERTY_TEXT; this.value.rows = 4;
    this.value.value = Array.isArray(this.review.prior) ? this.review.prior.join("\n") : this.review.prior == null ? "" : Object.is(this.review.prior, -0) ? "-0" : String(this.review.prior);
    this.checked.type = "checkbox"; this.checked.checked = this.review.prior === true; this.checked.dataset.basesEmbedPropertyChecked = "true"; checkLabel.append(this.checked, " Checked");
    this.preview.dataset.basesEmbedPropertyPreview = "true"; this.preview.className = "bases-embed-property-preview";
    hint.textContent = "Review in Source shows the real target note beside this containing note. Apply changes only the reviewed property in one Undo step. Source stays open after Cancel. Saving follows the note's normal settings; the base configuration and containing note are not saved by this action.";
    this.source.type = this.apply.type = cancel.type = "button"; this.source.textContent = "Review in Source"; this.source.dataset.basesEmbedPropertySource = "true";
    this.apply.textContent = "Apply property"; this.apply.dataset.basesEmbedPropertyApply = "true"; cancel.textContent = "Cancel"; cancel.dataset.basesEmbedPropertyCancel = "true";
    actions.className = "bases-embed-property-actions"; actions.append(this.source, this.apply, cancel);
    this.status.dataset.basesEmbedPropertyStatus = "true"; this.status.setAttribute("role", "status");
    this.contentEl.append(typeLabel, valueLabel, checkLabel, this.preview, hint, actions, this.status);
    const update = (): void => {
      valueLabel.hidden = this.type.value === "checkbox"; checkLabel.hidden = this.type.value !== "checkbox";
      try { const next = embeddedPropertyDraft(this.review, this.type.value, this.value.value, this.checked.checked); planEmbeddedPropertyEdit(this.review.text, this.review.key, this.review.prior, next);
        this.preview.textContent = this.review.path + "\n" + this.review.key + ": " + display(this.review.prior) + " → " + display(next); }
      catch (error) { this.preview.textContent = error instanceof Error ? error.message : String(error); }
      this.lock();
    };
    this.type.addEventListener("change", update); this.value.addEventListener("input", update); this.checked.addEventListener("change", update);
    this.source.addEventListener("click", () => { this.run(async () => { await showEmbeddedPropertySource(this.review); this.status.textContent = "Normal Source is visible. Review the exact value above, then Apply property or Cancel."; }); });
    this.apply.addEventListener("click", () => { this.run(async () => {
      const result = await applyEmbeddedProperty(this.review, this.type.value, this.value.value, this.checked.checked);
      this.close(); new Notice(result.changed ? "Applied " + result.key + " in " + result.path + ". Undo is in its Source; saving follows normal note settings." : "The property value was unchanged.");
    }); });
    cancel.addEventListener("click", () => this.close());
    this.refs.push(this.app.core.on("changed", () => this.lock()), this.app.workspace.on("layout-change", () => this.lock()), this.app.workspace.on("editor-change", () => this.lock()));
    this.unwatch = this.app.configuration.watch("types", () => { cancelEmbeddedPropertyReview(this.review); this.lock(); }, () => { cancelEmbeddedPropertyReview(this.review); this.lock(); });
    this.status.textContent = "Review a typed value, then choose Review in Source. No property has been applied."; update(); this.value.focus();
  }
  private lock(): void {
    const current = this.isOpen && embeddedPropertyCurrent(this.review);
    this.type.disabled = this.busy || !current || this.review.assigned !== null; this.value.readOnly = this.busy || !current; this.checked.disabled = this.busy || !current;
    this.source.disabled = this.busy || !current || embeddedPropertyHasSource(this.review); this.apply.disabled = this.busy || !current || !embeddedPropertyHasSource(this.review);
    if (!current && !this.busy && this.isOpen && !embeddedPropertyOutcome(this.review)) { this.status.textContent = "This property review is stale. Cancel and choose the current embedded result; no property was applied by this draft."; }
  }
  private run(action: () => Promise<void>): void {
    if (this.busy || !this.isOpen || !embeddedPropertyCurrent(this.review)) { return; }
    this.busy = true; this.lock();
    this.pending = action().catch(error => { if (this.isOpen) { const outcome = embeddedPropertyOutcome(this.review);
      this.status.textContent = (outcome ? outcome.changed ? "The property was applied in " + outcome.path + ". Source and its Undo were kept. " : "The property was unchanged. " : "") + (error instanceof Error ? error.message : String(error)); } })
      .finally(() => { this.busy = false; if (this.isOpen) { this.lock(); } });
  }
  override onClose(): void { cancelEmbeddedPropertyReview(this.review); this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.unwatch(); this.closed(); }
}

function display(value: unknown): string { return value === undefined ? "(missing)" : Object.is(value, -0) ? "-0" : JSON.stringify(value); }
