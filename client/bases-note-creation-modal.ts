import type { App } from "./app";
import { BaseNoteCreationReview, baseNoteCreationOutcome, MAX_BASE_NOTE_BODY, MAX_BASE_NOTE_PROPERTIES, MAX_BASE_NOTE_VALUE, type BaseNoteCreationAuthority, type BaseNoteDraft } from "./bases-note-creation";
import { propertyTypes } from "./property-types";
import { Modal, Notice } from "./ui";
import type { TFile } from "./vault";

interface PropertyControls { root: HTMLElement; name: HTMLInputElement; type: HTMLSelectElement; value: HTMLTextAreaElement; checked: HTMLInputElement; assigned: HTMLOutputElement }

export class BaseNoteCreationModal extends Modal {
  private readonly name = document.createElement("input");
  private readonly body = document.createElement("textarea");
  private readonly editor = document.createElement("fieldset");
  private readonly rows = document.createElement("div");
  private readonly count = document.createElement("output");
  private readonly add = document.createElement("button");
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private readonly controls: PropertyControls[] = [];
  private readonly refs: ReturnType<App["core"]["on"]>[] = [];
  private review: BaseNoteCreationReview | null = null;
  private busy = false;
  private terminal = false;
  private stale = false;

  constructor(app: App, private readonly source: TFile, private readonly suggestions: readonly string[], private readonly lineEnding: "\n" | "\r\n", private readonly authority: BaseNoteCreationAuthority & { closed(): void }) {
    super(app); this.setTitle("Create note from base"); this.modalEl.dataset.basesNoteCreation = ""; this.modalEl.classList.add("bases-note-creation-modal");
    this.name.type = "text"; this.name.value = "New note"; this.name.maxLength = 4096; this.name.spellcheck = false; this.name.dataset.basesNoteName = "";
    this.body.rows = 4; this.body.maxLength = MAX_BASE_NOTE_BODY; this.body.dataset.basesNoteBody = "";
    this.status.dataset.basesNoteStatus = ""; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.count.dataset.basesNoteCount = ""; this.rows.dataset.basesNoteProperties = ""; this.preview.dataset.basesNotePreview = ""; this.preview.hidden = true;
  }
  override onOpen(): void {
    const intro = document.createElement("p"), nameLabel = document.createElement("label"), bodyLabel = document.createElement("label"), legend = document.createElement("legend"), actions = document.createElement("div"), cancel = document.createElement("button"), endings = document.createElement("p");
    intro.textContent = "Create one Markdown note with the properties you enter. Filters and formulas do not fill values automatically; the new note may be hidden by this view's filters, search or limit. The base and your other notes are kept as they are.";
    legend.textContent = "New Markdown note"; nameLabel.append("Note name or path in an existing folder", this.name); bodyLabel.append("Note body (optional)", this.body);
    this.add.type = "button"; this.add.textContent = "Add property"; this.add.dataset.basesNoteAdd = ""; this.add.addEventListener("click", () => this.addProperty());
    endings.textContent = "New file: UTF-8 without BOM, " + (this.lineEnding === "\r\n" ? "CRLF" : "LF") + " line endings. Review the exact note text before creation.";
    this.editor.append(legend, nameLabel, this.rows, this.count, this.add, bodyLabel, endings);
    this.action.type = this.back.type = cancel.type = "button"; this.action.textContent = "Review note"; this.action.dataset.basesNoteReview = ""; this.action.addEventListener("click", () => { void this.run(); });
    this.back.textContent = "Edit draft"; this.back.dataset.basesNoteBack = ""; this.back.hidden = true; this.back.addEventListener("click", () => this.editDraft());
    cancel.textContent = "Cancel"; cancel.dataset.basesNoteCancel = ""; cancel.addEventListener("click", () => this.close()); actions.className = "bases-note-actions"; actions.append(this.action, this.back, cancel);
    this.contentEl.append(intro, this.editor, this.preview, actions, this.status);
    this.refs.push(this.app.core.on("changed", () => { if (!this.authority.current(false)) { this.invalidate(); } })); this.updateCount(); this.lock(); this.name.focus();
  }
  private addProperty(): void {
    if (this.busy || this.review || !this.current() || this.controls.length >= MAX_BASE_NOTE_PROPERTIES) { return; }
    const row = document.createElement("section"), name = document.createElement("input"), type = document.createElement("select"), value = document.createElement("textarea"), checked = document.createElement("input"), assigned = document.createElement("output"), remove = document.createElement("button"), nameLabel = document.createElement("label"), typeLabel = document.createElement("label"), valueLabel = document.createElement("label"), checkedLabel = document.createElement("label"), choices = document.createElement("datalist");
    row.className = "bases-note-property"; row.dataset.basesNoteProperty = "";
    name.type = "text"; name.maxLength = 256; name.dataset.basesNotePropertyName = ""; choices.id = "bases-note-keys-" + crypto.randomUUID(); name.setAttribute("list", choices.id);
    for (const suggestion of this.suggestions) { choices.append(new Option(suggestion, suggestion)); }
    name.value = this.suggestions.find(suggestion => !this.controls.some(control => control.name.value.toLowerCase() === suggestion.toLowerCase())) ?? "";
    type.dataset.basesNotePropertyType = ""; for (const widget of propertyTypes) { type.add(new Option(widget, widget)); }
    value.rows = 2; value.maxLength = MAX_BASE_NOTE_VALUE; value.dataset.basesNotePropertyValue = ""; checked.type = "checkbox"; checked.dataset.basesNotePropertyChecked = "";
    assigned.dataset.basesNotePropertyAssigned = ""; nameLabel.append("Property name", name, choices); typeLabel.append("Property type", type); valueLabel.append("Value (one item per line for lists)", value); checkedLabel.append(checked, "Checked"); checkedLabel.className = "bases-note-checkbox";
    remove.type = "button"; remove.textContent = "Remove property"; remove.dataset.basesNotePropertyRemove = "";
    const control = { root: row, name, type, value, checked, assigned }; this.controls.push(control);
    const sync = (): void => {
      try {
        const widget = name.value ? this.app.metadataTypeManager.getAssignedWidget(name.value) : null;
        if (widget !== null) { if (![...type.options].some(option => option.value === widget)) { type.add(new Option(widget + " (unsupported)", widget)); } type.value = widget; }
        type.disabled = widget !== null; assigned.textContent = widget !== null ? "Assigned type: " + widget : "Type applies to this new value; the vault's type registry is unchanged.";
        checkedLabel.hidden = type.value !== "checkbox"; valueLabel.hidden = type.value === "checkbox";
      } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); }
    };
    name.addEventListener("input", sync); type.addEventListener("change", sync);
    remove.addEventListener("click", () => { if (this.busy || this.review || !this.current()) { return; } const index = this.controls.indexOf(control); if (index >= 0) { this.controls.splice(index, 1); row.remove(); this.updateCount(); this.add.focus(); } });
    row.append(nameLabel, typeLabel, assigned, valueLabel, checkedLabel, remove); this.rows.append(row); sync(); this.updateCount(); name.focus();
  }
  private updateCount(): void { this.count.textContent = this.controls.length + " of 16 properties"; this.add.disabled = this.controls.length >= MAX_BASE_NOTE_PROPERTIES; }
  private draft(): BaseNoteDraft { return { body: this.body.value, lineEnding: this.lineEnding, properties: this.controls.map(row => ({ name: row.name.value, type: row.type.value, text: row.value.value, checked: row.checked.checked })) }; }
  private current(): boolean { return this.isOpen && this.containerEl.isConnected && !this.stale && !this.app.vault.readOnly && this.authority.current(false); }
  invalidate(): void {
    if (this.review?.creating || this.terminal) { return; }
    this.stale = true; this.status.textContent = this.review ? baseNoteCreationOutcome(this.review.receipt, "The base or its query changed. Close and review again.") : "The base or its query changed. Close and review again. No creation was attempted."; this.lock();
  }
  private lock(): void { this.editor.disabled = this.busy || this.terminal || this.stale || Boolean(this.review); this.action.disabled = this.busy || this.terminal || !this.current(); this.back.disabled = this.busy || this.terminal || !this.current(); }
  private editDraft(): void {
    if (this.busy || this.terminal || !this.current()) { return; }
    this.review?.close(); this.review = null; this.preview.replaceChildren(); this.preview.hidden = true; this.editor.hidden = false; this.back.hidden = true; this.action.removeAttribute("data-bases-note-create"); this.action.dataset.basesNoteReview = ""; this.action.textContent = "Review note"; this.status.textContent = "The note remains a draft. Nothing has been created."; this.lock(); this.name.focus();
  }
  private async run(): Promise<void> {
    if (this.busy || this.terminal || !this.current()) { return; } this.busy = true; this.lock();
    try {
      if (!this.review) {
        this.review = new BaseNoteCreationReview(this.app, this.source, this.name.value, this.draft(), { current: owned => this.isOpen && this.containerEl.isConnected && !this.stale && this.authority.current(owned), savedSource: () => this.authority.savedSource(), refresh: () => this.authority.refresh() });
        const path = document.createElement("strong"), text = document.createElement("pre"), description = document.createElement("p"); path.dataset.basesNotePath = ""; path.textContent = this.review.path; text.dataset.basesNoteText = ""; text.textContent = this.review.plan.content || "(empty note)";
        description.textContent = "Create this exact note once. Cancel writes nothing. A confirmed file is kept if the query refresh fails or you close the dialog. This is a new file; Undo in the base does not delete it.";
        this.preview.replaceChildren(path, description, text); this.preview.hidden = false; this.editor.hidden = true; this.back.hidden = false; this.action.removeAttribute("data-bases-note-review"); this.action.dataset.basesNoteCreate = ""; this.action.textContent = "Create note"; this.status.textContent = "Review the full destination and exact text before creating the note.";
      } else {
        await this.review.create(); this.terminal = true; this.action.textContent = "Note created";
        const message = baseNoteCreationOutcome(this.review.receipt); if (this.isOpen) { this.status.textContent = message; } else { new Notice(message, 20_000); }
      }
    } catch (error) {
      const message = this.review ? baseNoteCreationOutcome(this.review.receipt, error) : error instanceof Error ? error.message : String(error);
      if (this.review) { this.terminal = true; const receipt = this.review.receipt; this.action.textContent = receipt.document ? receipt.document.file.path === receipt.path ? "Note created" : "Check creation outcome" : receipt.attempted ? "Creation unconfirmed" : "Creation refused"; }
      if (this.isOpen) { this.status.textContent = message; } else if (this.review?.receipt.attempted) { new Notice(message, 20_000); }
    } finally { this.busy = false; if (this.isOpen) { this.lock(); } }
  }
  override onClose(): void { this.review?.close(); this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.authority.closed(); }
}
