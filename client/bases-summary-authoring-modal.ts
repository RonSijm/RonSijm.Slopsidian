import type { App } from "./app";
import { BaseSummaryAuthoringReview, baseSummaryAuthoringLimits, planBaseSummaryChange, readBaseSummaryAuthoringState, type BaseSummaryAuthoringState, type BaseSummaryChange } from "./bases-summary-authoring";
import { builtinSummaryNames } from "./bases-summaries";
import type { BaseViewManagementAuthority } from "./bases-view-management";
import { Modal } from "./ui";
import type { TFile } from "./vault";

export class BaseSummaryAuthoringModal extends Modal {
  private readonly editor = document.createElement("fieldset");
  private readonly section = document.createElement("select");
  private readonly operation = document.createElement("select");
  private readonly existing = document.createElement("select");
  private readonly name = document.createElement("input");
  private readonly expression = document.createElement("textarea");
  private readonly property = document.createElement("select");
  private readonly assignment = document.createElement("select");
  private readonly definitionFields = document.createElement("section");
  private readonly assignmentFields = document.createElement("section");
  private readonly original = document.createElement("pre");
  private readonly uses = document.createElement("ul");
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private readonly state: BaseSummaryAuthoringState;
  private expressionDraft = "";
  private review: BaseSummaryAuthoringReview | null = null;
  private busy = false;
  private terminal = false;
  constructor(app: App, private readonly file: TFile, private readonly source: string, private readonly selected: string, private readonly authority: BaseViewManagementAuthority & { closed(): void }) {
    super(app); app.vault.assertWritable("modify", file.path); this.setTitle("Manage Bases summaries"); this.modalEl.dataset.basesSummaryAuthoring = ""; this.modalEl.classList.add("bases-summary-authoring-modal");
    this.state = readBaseSummaryAuthoringState(source, selected);
  }
  override onOpen(): void {
    const intro = document.createElement("p"), legend = document.createElement("legend"), help = document.createElement("p"), assignmentHelp = document.createElement("p"), actions = document.createElement("div"), cancel = document.createElement("button");
    intro.textContent = "Custom summary definitions belong to this base and are shared by every saved view and embed. Assignments belong to one view and property. Review the exact YAML and every effect before Apply and save. Note files are kept.";
    legend.textContent = "Summary change"; this.section.dataset.basesSummarySection = ""; this.section.add(new Option("Shared custom definitions", "definitions")); this.section.add(new Option("Assignments in “" + this.selected + "”", "assignments"));
    this.operation.dataset.basesSummaryOperation = ""; for (const [value, title] of [["edit", "Edit definition"], ["add", "Add definition"], ["duplicate", "Duplicate definition"], ["rename", "Rename and update proved assignments"], ["remove", "Remove unassigned definition"]]) { this.operation.add(new Option(title, value)); }
    if (!this.state.definitions.length) { this.operation.value = "add"; }
    this.existing.dataset.basesSummaryExisting = ""; for (const item of this.state.definitions) { this.existing.add(new Option(item.name + (item.issue ? " · needs attention" : ""), item.name)); }
    this.name.type = "text"; this.name.maxLength = baseSummaryAuthoringLimits.name; this.name.spellcheck = false; this.name.dataset.basesSummaryAuthorName = "";
    this.expression.rows = 5; this.expression.maxLength = baseSummaryAuthoringLimits.expression; this.expression.spellcheck = false; this.expression.dataset.basesSummaryAuthorExpression = "";
    this.original.dataset.basesSummaryOriginal = ""; this.original.tabIndex = 0; this.uses.dataset.basesSummaryUses = ""; this.uses.setAttribute("aria-label", "Shared definition uses and uncertain references");
    help.textContent = "Expressions use values, for example values.filter(value.isType(\"number\")).sum(). Rename updates all proved native assignments atomically. Remove requires no assignments; clear them explicitly first. Unknown settings mentioning the name, unsupported renderers and ambiguous YAML require Source for name changes. Imported expression text is retained exactly until you explicitly type a replacement. Up to 128 definitions, with 4,096 characters per new or edited expression.";
    this.definitionFields.append(this.wrap("Action", this.operation), this.wrap("Existing definition", this.existing), this.wrap("New summary name", this.name), this.wrap("Expression over values", this.expression), this.original, this.uses, help);
    this.property.dataset.basesSummaryAuthorProperty = ""; for (const item of this.state.assignments) { this.property.add(new Option(item.label + " · " + item.property + (item.displayed ? "" : " (hidden)"), item.property)); }
    this.assignment.dataset.basesSummaryAssignment = "";
    assignmentHelp.textContent = "Assign a built-in or shared custom definition to a displayed property, or inspect and change an existing hidden assignment. None removes only that assignment. Built-in compatibility depends on matching values: numeric, date and checkbox summaries can report visible errors for incompatible types. Hidden property summaries appear when the property is displayed again. A definition with an error remains inspectable and repairable.";
    this.assignmentFields.append(this.wrap("Current-view property", this.property), this.wrap("Assigned summary", this.assignment), assignmentHelp);
    this.status.dataset.basesSummaryAuthorStatus = ""; this.status.id = "bases-summary-author-" + crypto.randomUUID(); this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    for (const input of [this.name, this.expression, this.property, this.assignment]) { input.setAttribute("aria-describedby", this.status.id); }
    this.preview.dataset.basesSummaryAuthorPreview = ""; this.preview.hidden = true;
    this.action.type = this.back.type = cancel.type = "button"; this.action.textContent = "Review change"; this.action.dataset.basesSummaryAuthorReview = ""; this.back.textContent = "Edit draft"; this.back.dataset.basesSummaryAuthorBack = ""; this.back.hidden = true; cancel.textContent = "Cancel"; cancel.dataset.basesSummaryAuthorCancel = "";
    actions.className = "bases-summary-authoring-actions"; actions.append(this.action, this.back, cancel);
    this.section.addEventListener("change", () => this.render()); this.operation.addEventListener("change", () => this.render()); this.existing.addEventListener("change", () => this.render());
    this.name.addEventListener("input", () => this.validate()); this.expression.addEventListener("input", () => { this.expressionDraft = this.expression.value; this.validate(); });
    this.property.addEventListener("change", () => this.loadAssignment()); this.assignment.addEventListener("change", () => this.validate());
    this.action.addEventListener("click", () => { void this.run(); }); this.back.addEventListener("click", () => this.editDraft()); cancel.addEventListener("click", () => this.close());
    this.editor.append(legend, this.wrap("Setting", this.section), this.definitionFields, this.assignmentFields); this.contentEl.append(intro, this.editor, this.preview, actions, this.status); this.render(); this.section.focus();
  }
  private wrap(title: string, input: HTMLElement): HTMLLabelElement { const label = document.createElement("label"); label.append(title, input); input.setAttribute("aria-label", title); return label; }
  private render(): void {
    const definitions = this.section.value === "definitions", operation = this.operation.value, entry = this.state.definitions.find(item => item.name === this.existing.value);
    this.definitionFields.hidden = !definitions; this.assignmentFields.hidden = definitions; this.uses.replaceChildren();
    if (!definitions) { this.assignmentFields.append(this.original, this.uses); this.loadAssignment(); return; }
    this.definitionFields.insertBefore(this.original, this.definitionFields.children[4] ?? null); this.definitionFields.insertBefore(this.uses, this.original.nextSibling);
    const adding = operation === "add", naming = operation === "duplicate" || operation === "rename", editing = operation === "edit";
    this.existing.disabled = adding || !this.state.definitions.length; this.existing.parentElement!.hidden = adding; this.name.parentElement!.hidden = !adding && !naming; this.expression.parentElement!.hidden = !adding && !editing;
    this.name.value = ""; this.expressionDraft = adding ? "" : entry?.expression ?? ""; this.expression.value = this.expressionDraft;
    this.original.textContent = this.state.definitionsIssue || (adding ? "Add one shared definition. Existing assignments stay unchanged until you explicitly assign it to a property." : entry ? "Original definition “" + entry.name + "” · " + (entry.definitionKind === "string" ? "decoded JSON string:\n" + JSON.stringify(entry.expression) : "saved " + entry.definitionKind + " value, not an expression string") + "\nExact original YAML:\n" + entry.definitionSource + (entry.issue ? "\n" + entry.issue : "") : "This base has no custom definitions yet.");
    if (!adding && entry) { this.showUses(entry.name); }
    this.validate();
  }
  private showUses(name: string): void {
    const entry = this.state.definitions.find(item => item.name === name); this.uses.replaceChildren();
    for (const use of entry?.uses ?? []) { const item = document.createElement("li"); item.textContent = (use.uncertain ? "Source review required · " : "Native assignment · ") + use.location + ": " + use.detail; this.uses.append(item); }
    if (entry && !entry.uses.length) { const item = document.createElement("li"); item.textContent = "No native assignment or uncertain reference was found. Review checks again before a name change or removal."; this.uses.append(item); }
  }
  private loadAssignment(): void {
    const entry = this.state.assignments.find(item => item.property === this.property.value); this.assignment.replaceChildren(); this.assignment.add(new Option("None", ""));
    for (const name of builtinSummaryNames) { this.assignment.add(new Option(name + (this.state.definitions.some(item => item.name === name) ? " (overridden by custom)" : " (built-in)"), name)); }
    for (const definition of this.state.definitions) { if (!builtinSummaryNames.has(definition.name)) { this.assignment.add(new Option(definition.name + " (custom" + (definition.issue ? "; needs attention" : "") + ")", definition.name)); } }
    if (entry?.name && !builtinSummaryNames.has(entry.name) && !this.state.definitions.some(item => item.name === entry.name)) { this.assignment.add(new Option(entry.name + " (unknown; retained)", entry.name)); }
    this.assignment.value = entry?.name ?? "";
    const definition = this.state.definitions.find(item => item.name === entry?.name);
    this.original.textContent = this.state.assignmentsIssue || (entry ? "Original assignment in “" + this.selected + "”: " + entry.property + " → " + JSON.stringify(entry.name) + (entry.displayed ? "" : "\nThis property is currently hidden; the assignment is retained.") + (entry.issue ? "\n" + entry.issue : "") + (definition ? "\nShared expression (decoded JSON string): " + JSON.stringify(definition.expression) + "\nExact definition YAML:\n" + definition.definitionSource : "") : "Choose a current-view property.");
    this.showUses(entry?.name ?? ""); this.validate();
  }
  private draft(): BaseSummaryChange {
    if (this.section.value === "assignments") { return { kind: "assign", property: this.property.value, name: this.assignment.value || null }; }
    const kind = this.operation.value;
    if (kind === "add") { return { kind, name: this.name.value, expression: this.expressionDraft }; }
    if (kind === "edit") { return { kind, name: this.existing.value, expression: this.expressionDraft }; }
    if (kind === "duplicate" || kind === "rename") { return { kind, name: this.existing.value, destination: this.name.value }; }
    return { kind: "remove", name: this.existing.value };
  }
  private validate(): void {
    try { const plan = planBaseSummaryChange(this.source, this.selected, this.draft()); this.action.disabled = false; this.status.textContent = plan.warnings.join(" ") || "This summary change can be reviewed."; }
    catch (error) { this.action.disabled = true; this.status.textContent = error instanceof Error ? error.message : String(error); }
  }
  private editDraft(): void {
    if (this.busy || this.terminal || !this.authority.current()) { return; } this.review?.close(); this.review = null; this.editor.hidden = false; this.editor.disabled = false; this.preview.hidden = true; this.preview.replaceChildren(); this.back.hidden = true; this.action.textContent = "Review change"; this.action.removeAttribute("data-bases-summary-author-apply"); this.action.dataset.basesSummaryAuthorReview = ""; this.validate(); this.section.focus();
  }
  private async run(): Promise<void> {
    if (this.busy || this.terminal) { return; }
    try {
      this.app.vault.assertWritable("modify", this.file.path); if (!this.authority.current() || !this.containerEl.isConnected) { throw new Error("This summary owner changed. Cancel and start a fresh review."); }
      if (!this.review) {
        const review = new BaseSummaryAuthoringReview(this.app, this.file, this.source, this.selected, this.draft(), this.authority), description = document.createElement("p"), effects = document.createElement("ul"), source = document.createElement("pre"), ending = document.createElement("p");
        description.textContent = review.plan.description; for (const text of [...review.plan.changes, ...review.plan.warnings]) { const item = document.createElement("li"); item.textContent = text; effects.append(item); } effects.dataset.basesSummaryAuthorEffects = "";
        const styles = new Set(this.source.match(/\r\n|\r|\n/g) ?? []); ending.textContent = "Exact reviewed base text: " + (styles.size > 1 ? "existing mixed" : styles.has("\r\n") ? "CRLF" : styles.has("\r") ? "CR" : "LF") + " line endings; existing UTF-8 BOM is retained. Apply saves only the reviewed base change.";
        source.textContent = review.plan.source; source.dataset.basesSummaryAuthorSource = ""; source.tabIndex = 0; this.preview.replaceChildren(description, effects, ending, source); this.review = review;
        this.editor.hidden = true; this.editor.disabled = true; this.preview.hidden = false; this.back.hidden = false; this.action.textContent = "Apply and save"; this.action.removeAttribute("data-bases-summary-author-review"); this.action.dataset.basesSummaryAuthorApply = ""; this.action.disabled = false; this.status.textContent = "Review every listed effect and the complete exact YAML, then Apply and save or Cancel."; this.action.focus(); return;
      }
      this.busy = true; this.action.disabled = this.back.disabled = true; await this.app.core.run(() => this.review!.apply()); this.close();
    } catch (error) { this.terminal = Boolean(this.review); this.status.textContent = (this.review?.attempted ? "Saving was not confirmed; reviewed unsaved source remains in the pane. Inspect it before another change. " : this.review ? "No summary edit was applied. " : "") + (error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; if (this.review) { this.action.disabled = this.back.disabled = this.terminal; } }
  }
  override onClose(): void { this.review?.close(); this.authority.closed(); }
}
