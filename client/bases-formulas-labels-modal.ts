import type { App } from "./app";
import { BaseFormulaLabelReview, baseFormulaAuthoringLimits, planBaseFormulaLabelChange, readBaseFormulaLabelState, type BaseFormulaLabelChange, type BaseFormulaLabelState } from "./bases-formulas-labels";
import type { BaseViewManagementAuthority } from "./bases-view-management";
import { Modal } from "./ui";
import type { TFile } from "./vault";
import { baseProperty } from "./bases-model";

export class BaseFormulasLabelsModal extends Modal {
  private readonly editor = document.createElement("fieldset");
  private readonly section = document.createElement("select");
  private readonly operation = document.createElement("select");
  private readonly existing = document.createElement("select");
  private readonly name = document.createElement("input");
  private readonly expression = document.createElement("textarea");
  private readonly property = document.createElement("input");
  private readonly label = document.createElement("input");
  private readonly removeLabel = document.createElement("input");
  private readonly formulaFields = document.createElement("section");
  private readonly labelFields = document.createElement("section");
  private readonly original = document.createElement("pre");
  private readonly references = document.createElement("ul");
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private readonly state: BaseFormulaLabelState;
  private expressionDraft = "";
  private labelDraft = "";
  private review: BaseFormulaLabelReview | null = null;
  private busy = false;
  private terminal = false;
  private readonly suggestionsId = "bases-formula-label-" + crypto.randomUUID();

  constructor(app: App, private readonly file: TFile, private readonly source: string, private readonly selected: string,
    private readonly authority: BaseViewManagementAuthority & { closed(): void }, private readonly suggestions: readonly string[] = []) {
    super(app); this.setTitle("Formulas and display labels"); this.modalEl.dataset.basesFormulasLabels = ""; this.modalEl.classList.add("bases-formulas-labels-modal");
    this.state = readBaseFormulaLabelState(source, selected);
  }
  override onOpen(): void {
    const intro = document.createElement("p"), legend = document.createElement("legend"), actions = document.createElement("div"), cancel = document.createElement("button"), data = document.createElement("datalist"), labelHelp = document.createElement("p"), help = document.createElement("p");
    intro.textContent = "Formulas and property display labels belong to this base and affect every saved view and embed. Add formulas to displayed properties through Configure view. Note files are kept. Review the exact YAML before Apply and save.";
    legend.textContent = "Global base setting"; this.section.dataset.basesFormulaSection = ""; this.section.add(new Option("Formulas", "formulas")); this.section.add(new Option("Display labels", "labels"));
    this.operation.dataset.basesFormulaOperation = ""; for (const [value, title] of [["edit", "Edit formula"], ["add", "Add formula"], ["duplicate", "Duplicate formula"], ["rename", "Rename unreferenced formula"], ["remove", "Remove unreferenced formula"]]) { this.operation.add(new Option(title, value)); }
    if (!this.state.formulas.length) { this.operation.value = "add"; }
    this.existing.dataset.basesFormulaExisting = ""; for (const formula of this.state.formulas) { this.existing.add(new Option(formula.name + (formula.issue ? " · needs attention" : ""), formula.name)); }
    this.name.type = "text"; this.name.maxLength = baseFormulaAuthoringLimits.name; this.name.spellcheck = false; this.name.dataset.basesFormulaName = "";
    this.expression.rows = 5; this.expression.maxLength = baseFormulaAuthoringLimits.expression; this.expression.spellcheck = false; this.expression.dataset.basesFormulaExpression = "";
    this.original.dataset.basesFormulaOriginal = ""; this.original.tabIndex = 0; this.references.dataset.basesFormulaReferences = ""; this.references.setAttribute("aria-label", "Formula dependencies and affected references");
    help.textContent = "Expressions use the existing Bases language. Static dependencies are checked for missing/invalid formulas and cycles. Dynamic access is listed explicitly and may still fail during row evaluation. Rename and Remove retain references by refusing when a use cannot be proved absent. Edit those references explicitly in source first. Unchanged imported expression text is kept, including its line endings; typing a replacement is an explicit edit. Up to 128 formulas, with 4,096 characters per new/edited expression.";
    this.formulaFields.append(this.wrap("Action", this.operation), this.wrap("Existing formula", this.existing), this.wrap("New formula name", this.name), this.wrap("Expression", this.expression), this.original, this.references, help);
    this.property.type = "text"; this.property.maxLength = 264; this.property.spellcheck = false; this.property.dataset.basesFormulaProperty = ""; this.property.setAttribute("list", this.suggestionsId);
    this.label.type = "text"; this.label.maxLength = baseFormulaAuthoringLimits.label; this.label.spellcheck = false; this.label.dataset.basesFormulaLabel = "";
    this.removeLabel.type = "checkbox"; this.removeLabel.dataset.basesFormulaRemoveLabel = ""; this.removeLabel.setAttribute("aria-label", "Remove display label and use the property name");
    const remove = document.createElement("label"); remove.className = "bases-formulas-label-choice"; remove.append(this.removeLabel, " Remove label · use the property name");
    labelHelp.textContent = "Use note.name (or its bare spelling), file.name or formula.name. Display labels affect all views and embeds using this identifier. Other property settings are retained. Repeated canonical aliases stay Source-only. Imported multiline/oversized labels are kept until you explicitly replace or remove them; the complete original is shown below.";
    this.labelFields.append(this.wrap("Property identifier", this.property), this.wrap("Display label", this.label), remove, labelHelp);
    data.id = this.suggestionsId; for (const property of [...new Set([...this.suggestions, ...this.state.labels.map(label => label.property)])].slice(0, 256)) { const option = document.createElement("option"); option.value = property; data.append(option); }
    this.status.dataset.basesFormulaStatus = ""; this.status.id = this.suggestionsId + "-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    for (const input of [this.name, this.expression, this.property, this.label]) { input.setAttribute("aria-describedby", this.status.id); }
    this.preview.dataset.basesFormulaPreview = ""; this.preview.hidden = true;
    this.action.type = this.back.type = cancel.type = "button"; this.action.textContent = "Review change"; this.action.dataset.basesFormulaReview = ""; this.back.textContent = "Edit draft"; this.back.dataset.basesFormulaBack = ""; this.back.hidden = true; cancel.textContent = "Cancel"; cancel.dataset.basesFormulaCancel = "";
    actions.className = "bases-formulas-labels-actions"; actions.append(this.action, this.back, cancel);
    this.section.addEventListener("change", () => this.render()); this.operation.addEventListener("change", () => this.render()); this.existing.addEventListener("change", () => this.render());
    this.name.addEventListener("input", () => this.validate()); this.expression.addEventListener("input", () => { this.expressionDraft = this.expression.value; this.validate(); });
    this.property.addEventListener("input", () => this.loadLabel()); this.property.addEventListener("change", () => this.loadLabel()); this.label.addEventListener("input", () => { this.labelDraft = this.label.value; this.validate(); }); this.removeLabel.addEventListener("change", () => { this.label.disabled = this.removeLabel.checked; this.validate(); });
    this.action.addEventListener("click", () => { void this.run(); }); this.back.addEventListener("click", () => this.editDraft()); cancel.addEventListener("click", () => this.close());
    this.editor.append(legend, this.wrap("Setting", this.section), this.formulaFields, this.labelFields, data); this.contentEl.append(intro, this.editor, this.preview, actions, this.status); this.render(); this.section.focus();
  }
  private wrap(title: string, input: HTMLElement): HTMLLabelElement { const label = document.createElement("label"); label.append(title, input); input.setAttribute("aria-label", title); return label; }
  private render(): void {
    const formula = this.section.value === "formulas", operation = this.operation.value, entry = this.state.formulas.find(item => item.name === this.existing.value);
    this.formulaFields.hidden = !formula; this.labelFields.hidden = formula; this.original.hidden = false; this.references.replaceChildren();
    if (!formula) { if (!this.property.value) { this.property.value = this.state.labels[0]?.property ?? this.suggestions[0] ?? "file.name"; } this.labelFields.append(this.original); this.loadLabel(); return; }
    this.formulaFields.insertBefore(this.original, this.references);
    const adding = operation === "add", copying = operation === "duplicate" || operation === "rename", editing = operation === "edit";
    this.existing.disabled = adding || !this.state.formulas.length; this.existing.parentElement!.hidden = adding; this.name.parentElement!.hidden = !adding && !copying; this.expression.parentElement!.hidden = !adding && !editing;
    this.name.value = ""; this.expressionDraft = adding ? "" : entry?.expression ?? ""; this.expression.value = this.expressionDraft;
    this.original.textContent = this.state.formulasIssue || (adding ? "Add one new formula. Existing definitions are kept; static dependencies and name collisions are checked before review." : entry ? "Original formula “" + entry.name + "” · " + (entry.definitionKind === "string" ? "decoded JSON string:\n" + JSON.stringify(entry.expression) : "saved " + entry.definitionKind + " value, not an expression string") + "\nExact original YAML:\n" + entry.definitionSource + (entry.issue ? "\n" + entry.issue : "") : "This base has no formula definitions yet.");
    for (const reference of adding ? [] : entry?.references ?? []) { const item = document.createElement("li"); item.textContent = reference.location + ": " + reference.detail; this.references.append(item); }
    if (!adding && entry && !entry.references.length) { const item = document.createElement("li"); item.textContent = "No declared static reference or unresolved formula access was found. Rename/removal will check again during review."; this.references.append(item); }
    this.validate();
  }
  private loadLabel(): void {
    const entry = this.state.labels.find(entry => { try { const first = baseProperty(entry.property), second = baseProperty(this.property.value); return first.kind === second.kind && first.name === second.name; } catch { return false; } });
    this.labelDraft = entry?.label ?? ""; this.label.value = this.labelDraft; this.removeLabel.checked = false; this.label.disabled = false;
    this.original.textContent = this.state.labelsIssue || (entry ? "Original label (decoded JSON string): " + JSON.stringify(entry.label) + (entry.issue ? "\n" + entry.issue : "") : "No display label is configured for this identifier. The normal property name is used."); this.validate();
  }
  private draft(): BaseFormulaLabelChange {
    if (this.section.value === "labels") { return { kind: "label", property: this.property.value, label: this.removeLabel.checked ? null : this.labelDraft }; }
    const kind = this.operation.value;
    if (kind === "add") { return { kind, name: this.name.value, expression: this.expressionDraft }; }
    if (kind === "edit") { return { kind, name: this.existing.value, expression: this.expressionDraft }; }
    if (kind === "duplicate" || kind === "rename") { return { kind, name: this.existing.value, destination: this.name.value }; }
    return { kind: "remove", name: this.existing.value };
  }
  private validate(): void {
    try { const plan = planBaseFormulaLabelChange(this.source, this.selected, this.draft()); this.action.disabled = false; this.status.textContent = plan.warnings.length ? plan.warnings.join(" ") : "This setting can be reviewed. Syntax/dependency checks do not guarantee all rows have the required value types."; }
    catch (error) { this.action.disabled = true; this.status.textContent = error instanceof Error ? error.message : String(error); }
  }
  private editDraft(): void {
    if (this.busy || this.terminal || !this.authority.current()) { return; } this.review?.close(); this.review = null; this.editor.hidden = false; this.editor.disabled = false; this.preview.hidden = true; this.preview.replaceChildren(); this.back.hidden = true; this.action.textContent = "Review change"; this.action.removeAttribute("data-bases-formula-apply"); this.action.dataset.basesFormulaReview = ""; this.validate(); this.section.focus();
  }
  private async run(): Promise<void> {
    if (this.busy || this.terminal) { return; }
    try {
      this.app.vault.assertWritable("modify", this.file.path); if (!this.authority.current() || !this.containerEl.isConnected) { throw new Error("This formula/label owner changed. Cancel and start a fresh review."); }
      if (!this.review) {
        const review = new BaseFormulaLabelReview(this.app, this.file, this.source, this.selected, this.draft(), this.authority), description = document.createElement("p"), effects = document.createElement("ul"), source = document.createElement("pre"), ending = document.createElement("p");
        description.textContent = review.plan.description; for (const text of [...review.plan.changes, ...review.plan.warnings]) { const item = document.createElement("li"); item.textContent = text; effects.append(item); } effects.dataset.basesFormulaEffects = "";
        const styles = new Set(this.source.match(/\r\n|\r|\n/g) ?? []); ending.textContent = "Exact reviewed base text: " + (styles.size > 1 ? "existing mixed" : styles.has("\r\n") ? "CRLF" : styles.has("\r") ? "CR" : "LF") + " line endings; existing UTF-8 BOM is retained. This Apply saves only the reviewed base change.";
        source.textContent = review.plan.source; source.dataset.basesFormulaSource = ""; source.tabIndex = 0; this.preview.replaceChildren(description, effects, ending, source); this.review = review;
        this.editor.hidden = true; this.editor.disabled = true; this.preview.hidden = false; this.back.hidden = false; this.action.textContent = "Apply and save"; this.action.removeAttribute("data-bases-formula-review"); this.action.dataset.basesFormulaApply = ""; this.action.disabled = false; this.status.textContent = "Review the effects and the complete exact YAML, then Apply and save or Cancel."; this.action.focus(); return;
      }
      this.busy = true; this.action.disabled = this.back.disabled = true; await this.app.core.run(() => this.review!.apply()); this.close();
    } catch (error) { this.terminal = Boolean(this.review); this.status.textContent = (this.review?.attempted ? "Saving was not confirmed; reviewed unsaved source remains in the pane. Inspect it before another change. " : this.review ? "No formula or label edit was applied. " : "") + (error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; if (this.review) { this.action.disabled = this.back.disabled = this.terminal; } }
  }
  override onClose(): void { this.review?.close(); this.authority.closed(); }
}
