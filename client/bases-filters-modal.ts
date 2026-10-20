import type { App } from "./app";
import { BaseFilterReview, baseFilterDraftValue, baseFilterLimits, baseFilterPredicateExpression, baseFilterStructure, planBaseFilters, readBaseFilterState, type BaseFilterChanges, type BaseFilterDraft, type BaseFilterPredicate, type BaseFilterScope, type BaseFilterState } from "./bases-filters";
import type { BaseViewManagementAuthority } from "./bases-view-management";
import { Modal } from "./ui";
import type { TFile } from "./vault";

export class BaseFiltersModal extends Modal {
  private readonly editor = document.createElement("fieldset");
  private readonly sections = document.createElement("div");
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private readonly state: BaseFilterState;
  private readonly values: Record<BaseFilterScope, BaseFilterDraft | null>;
  private readonly suggestionsId = "bases-filter-" + crypto.randomUUID();
  private review: BaseFilterReview | null = null;
  private busy = false;
  private terminal = false;

  constructor(app: App, private readonly file: TFile, private readonly source: string, private readonly selected: string,
    private readonly authority: BaseViewManagementAuthority & { closed(): void }, private readonly suggestions: readonly string[] = []) {
    super(app); this.setTitle("Edit base filters"); this.modalEl.dataset.basesFilters = ""; this.modalEl.classList.add("bases-filters-modal");
    this.state = readBaseFilterState(source, selected); this.values = { global: this.state.global.draft, view: this.state.view.draft };
  }
  override onOpen(): void {
    const intro = document.createElement("p"), legend = document.createElement("legend"), help = document.createElement("p"), data = document.createElement("datalist"), actions = document.createElement("div"), cancel = document.createElement("button");
    intro.textContent = `Edit global filters for every view and filters for “${this.selected}”. A row must pass both scopes. Review exact changes and the complete YAML before Apply and save.`;
    legend.textContent = "Filter draft"; help.textContent = "All requires every condition; Any requires at least one; None rejects a row when any condition matches. Empty All and None groups pass every row; empty Any groups pass no rows. No filter passes every row in that scope. Expressions use the existing Bases language; syntax validation cannot guarantee every row has the requested value type. The visual editor supports 64 entries and eight nested group levels per scope.";
    data.id = this.suggestionsId; for (const property of [...new Set(this.suggestions)].slice(0, 256)) { const option = document.createElement("option"); option.value = property; data.append(option); }
    this.status.dataset.basesFilterStatus = ""; this.status.id = this.suggestionsId + "-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.editor.append(legend, this.sections, help, data); this.preview.hidden = true; this.preview.dataset.basesFilterPreview = "";
    this.action.type = this.back.type = cancel.type = "button"; this.action.textContent = "Review filters"; this.action.dataset.basesFilterReview = "";
    this.back.textContent = "Edit draft"; this.back.hidden = true; this.back.dataset.basesFilterBack = ""; cancel.textContent = "Cancel"; cancel.dataset.basesFilterCancel = "";
    actions.className = "bases-filters-actions"; actions.append(this.action, this.back, cancel);
    this.action.addEventListener("click", () => { void this.run(); }); this.back.addEventListener("click", () => this.editDraft()); cancel.addEventListener("click", () => this.close());
    this.contentEl.append(intro, this.editor, this.preview, actions, this.status); this.render(); this.validate(); this.sections.querySelector<HTMLElement>("input,select,button")?.focus();
  }
  private button(title: string, action: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.textContent = title; button.dataset.basesFilterAction = action; button.addEventListener("click", callback); return button;
  }
  private render(): void {
    this.sections.replaceChildren();
    for (const scope of ["global", "view"] as const) {
      const section = document.createElement("section"), title = document.createElement("h3"), summary = document.createElement("p");
      section.dataset.basesFilterScope = scope; title.textContent = scope === "global" ? "Global · every view" : "Current view · “" + this.selected + "”";
      summary.textContent = scope === "global" ? "Changing these filters affects all saved views and embeds of this base." : "These filters are combined with the global filters for this view.";
      section.append(title, summary);
      if (!this.state[scope].editable) {
        const issue = document.createElement("p"), source = document.createElement("pre"); issue.textContent = this.state[scope].issue; source.textContent = this.state[scope].source; source.tabIndex = 0; source.dataset.basesFilterSourceOnly = scope; section.append(issue, source);
      } else {
        const node = this.values[scope];
        if (node) { section.append(this.renderNode(scope, node, [], value => { this.values[scope] = value; })); }
        else {
          const none = document.createElement("p"), controls = document.createElement("div"); none.textContent = "No filter · all rows pass this scope."; none.dataset.basesFilterNone = "";
          controls.className = "bases-filters-row-actions"; controls.append(this.button("Add expression", "add-expression", () => { this.values[scope] = { kind: "expression", expression: "true" }; this.render(); this.validate(); }), this.button("Add group", "add-group", () => { this.values[scope] = { kind: "group", operator: "and", children: [] }; this.render(); this.validate(); })); section.append(none, controls);
        }
      }
      this.sections.append(section);
    }
  }
  private renderNode(scope: BaseFilterScope, node: BaseFilterDraft, path: readonly number[], replace: (value: BaseFilterDraft | null) => void): HTMLElement {
    const row = document.createElement("section"), controls = document.createElement("div"), label = scope + " filter " + (path.length ? path.map(index => index + 1).join(".") : "root");
    row.className = "bases-filters-node"; row.dataset.basesFilterNode = node.kind; row.dataset.basesFilterPath = JSON.stringify(path); controls.className = "bases-filters-row-actions";
    const remove = this.button(path.length ? "Remove condition" : "Clear filter", "remove", () => { replace(null); this.render(); this.validate(); }); remove.setAttribute("aria-label", (path.length ? "Remove " : "Clear ") + label);
    if (node.kind === "expression") {
      const expressionLabel = document.createElement("label"), expression = document.createElement("textarea");
      expression.rows = 2; expression.maxLength = baseFilterLimits.expression; expression.spellcheck = false; expression.value = node.expression; expression.dataset.basesFilterExpression = ""; expression.setAttribute("aria-describedby", this.status.id); expression.setAttribute("aria-label", "Expression for " + label); expressionLabel.append("Expression", expression);
      expression.addEventListener("input", () => { node.expression = expression.value; this.validate(); });
      const wrap = this.button("Wrap in group", "wrap", () => { if (!this.canAdd(scope, path.length + 1)) { return; } replace({ kind: "group", operator: "and", children: [node] }); this.render(); this.validate(); }); this.boundAdd(wrap, scope, path.length + 1); controls.append(wrap, remove);
      row.append(expressionLabel, this.predicateBuilder(node, expression, label), controls);
    } else {
      const operatorLabel = document.createElement("label"), operator = document.createElement("select"), children = document.createElement("div"), count = document.createElement("output");
      operator.add(new Option("All match (AND)", "and")); operator.add(new Option("Any match (OR)", "or")); operator.add(new Option("None match (NOT any)", "not")); operator.value = node.operator; operator.dataset.basesFilterOperator = ""; operator.setAttribute("aria-label", "Group rule for " + label);
      operator.addEventListener("change", () => { node.operator = operator.value as "and" | "or" | "not"; this.validate(); }); operatorLabel.append("Group rule", operator); count.textContent = node.children.length + " conditions"; children.className = "bases-filters-children";
      node.children.forEach((child, index) => children.append(this.renderNode(scope, child, [...path, index], value => { if (value === null) { node.children.splice(index, 1); } else { node.children[index] = value; } })));
      const addExpression = this.button("Add expression", "add-expression", () => { if (!this.canAdd(scope, path.length + 1)) { return; } node.children.push({ kind: "expression", expression: "true" }); this.render(); this.validate(); }), addGroup = this.button("Add group", "add-group", () => { if (!this.canAdd(scope, path.length + 1)) { return; } node.children.push({ kind: "group", operator: "and", children: [] }); this.render(); this.validate(); });
      this.boundAdd(addExpression, scope, path.length + 1); this.boundAdd(addGroup, scope, path.length + 1); controls.append(addExpression, addGroup, remove);
      row.append(operatorLabel, count, children, controls);
    }
    return row;
  }
  private canAdd(scope: BaseFilterScope, depth: number): boolean { const structure = baseFilterStructure(this.values[scope]); return structure.nodes < baseFilterLimits.nodes && depth <= baseFilterLimits.depth; }
  private boundAdd(button: HTMLButtonElement, scope: BaseFilterScope, depth: number): void { button.disabled = !this.canAdd(scope, depth); if (button.disabled) { button.title = "Keep at most 64 entries and eight nested group levels in this scope. Remove a condition or edit larger filters in Source."; } }
  private predicateBuilder(node: Extract<BaseFilterDraft, { kind: "expression" }>, expression: HTMLTextAreaElement, label: string): HTMLElement {
    const details = document.createElement("details"), summary = document.createElement("summary"), fields = document.createElement("div"), property = document.createElement("input"), operator = document.createElement("select"), type = document.createElement("select"), value = document.createElement("input"), preview = document.createElement("output"), issue = document.createElement("p");
    details.dataset.basesFilterBuilder = ""; summary.textContent = "Build a property comparison"; fields.className = "bases-filters-predicate";
    property.type = "text"; property.maxLength = 264; property.setAttribute("list", this.suggestionsId); property.dataset.basesFilterProperty = ""; property.spellcheck = false;
    for (const [key, name] of [["==", "Equals"], ["!=", "Does not equal"], ["<", "Less than"], ["<=", "At most"], [">", "Greater than"], [">=", "At least"], ["contains", "Contains (text or list)"], ["startsWith", "Starts with"], ["endsWith", "Ends with"], ["empty", "Is empty"], ["not-empty", "Is not empty"]]) { operator.add(new Option(name, key)); }
    for (const [key, name] of [["text", "Text"], ["number", "Number"], ["boolean", "Checkbox (true / false)"], ["null", "Null (missing value)"]]) { type.add(new Option(name, key)); }
    operator.dataset.basesFilterComparison = ""; type.dataset.basesFilterValueType = ""; value.dataset.basesFilterValue = ""; value.type = "text"; value.maxLength = 2048; preview.dataset.basesFilterGenerated = ""; issue.setAttribute("role", "status");
    const use = this.button("Use comparison", "use-comparison", () => { try { node.expression = generated(); expression.value = node.expression; this.validate(); expression.focus(); } catch (error) { issue.textContent = error instanceof Error ? error.message : String(error); } });
    const generated = (): string => baseFilterPredicateExpression({ property: property.value, operator: operator.value as BaseFilterPredicate["operator"], type: type.value as BaseFilterPredicate["type"], value: value.value });
    const validate = (): void => {
      const empty = ["empty", "not-empty"].includes(operator.value); type.disabled = empty; value.disabled = empty || type.value === "null";
      value.placeholder = type.value === "boolean" ? "true or false" : type.value === "number" ? "e.g. 10" : "Exact text, including spaces";
      try { preview.textContent = generated(); use.disabled = false; issue.textContent = "Use comparison replaces this row's expression. Other conditions stay as entered."; } catch (error) { preview.textContent = ""; use.disabled = true; issue.textContent = error instanceof Error ? error.message : String(error); }
    };
    for (const [name, input] of [["Property", property], ["Comparison", operator], ["Value type", type], ["Value", value]] as const) { const wrapper = document.createElement("label"); wrapper.append(name, input); input.setAttribute("aria-label", name + " for " + label); input.addEventListener(input instanceof HTMLSelectElement ? "change" : "input", validate); fields.append(wrapper); }
    details.append(summary, fields, preview, use, issue); validate(); return details;
  }
  private draft(): BaseFilterChanges { const draft: BaseFilterChanges = {}; for (const scope of ["global", "view"] as const) { if (this.state[scope].editable) { draft[scope] = this.values[scope]; } } return draft; }
  private validate(): void {
    try {
      for (const scope of ["global", "view"] as const) { if (this.state[scope].editable) { baseFilterDraftValue(this.values[scope]); } }
      planBaseFilters(this.source, this.selected, this.draft()); this.action.disabled = false; this.status.textContent = "Filter syntax is valid. Review affected scopes and the exact YAML before saving. Row evaluation may still report type or function errors.";
    } catch (error) { this.action.disabled = true; this.status.textContent = error instanceof Error ? error.message : String(error); }
  }
  private editDraft(): void {
    if (this.busy || this.terminal || !this.authority.current()) { return; }
    this.review?.close(); this.review = null; this.preview.hidden = true; this.preview.replaceChildren(); this.editor.hidden = false; this.editor.disabled = false;
    this.action.textContent = "Review filters"; this.action.removeAttribute("data-bases-filter-apply"); this.action.dataset.basesFilterReview = ""; this.back.hidden = true; this.validate(); this.sections.querySelector<HTMLElement>("input,select,button")?.focus();
  }
  private async run(): Promise<void> {
    if (this.busy || this.terminal) { return; }
    try {
      this.app.vault.assertWritable("modify", this.file.path);
      if (!this.authority.current() || !this.containerEl.isConnected) { throw new Error("This base or filter owner changed. Cancel and start a fresh review."); }
      if (!this.review) {
        const review = new BaseFilterReview(this.app, this.file, this.source, this.selected, this.draft(), this.authority), description = document.createElement("p"), effects = document.createElement("dl"), source = document.createElement("pre"), endings = document.createElement("p");
        description.textContent = review.plan.description; effects.dataset.basesFilterEffects = "";
        for (const change of review.plan.changes) { const title = document.createElement("dt"), before = document.createElement("dd"), after = document.createElement("dd"); title.textContent = change.scope === "global" ? "Global · affects every view" : "Current view · “" + this.selected + "”"; before.textContent = "Before: " + change.before; after.textContent = "After: " + change.after; effects.append(title, before, after); }
        const styles = new Set(this.source.match(/\r\n|\r|\n/g) ?? []); endings.textContent = "Exact reviewed base text: " + (styles.size > 1 ? "existing mixed" : styles.has("\r\n") ? "CRLF" : styles.has("\r") ? "CR" : "LF") + " line endings; the saved file's existing UTF-8 BOM is retained. Apply saves only the reviewed filter changes.";
        source.textContent = review.plan.source; source.dataset.basesFilterSource = ""; source.tabIndex = 0; this.preview.replaceChildren(description, effects, endings, source);
        this.review = review; this.preview.hidden = false; this.editor.hidden = true; this.editor.disabled = true; this.action.textContent = "Apply and save"; this.action.removeAttribute("data-bases-filter-review"); this.action.dataset.basesFilterApply = ""; this.back.hidden = false; this.action.disabled = false; this.status.textContent = "Review both scopes and the complete YAML, then Apply and save or Cancel."; this.action.focus(); return;
      }
      this.busy = true; this.action.disabled = this.back.disabled = true; await this.app.core.run(() => this.review!.apply()); this.close();
    } catch (error) {
      this.terminal = Boolean(this.review); this.status.textContent = (this.review?.attempted ? "Saving was not confirmed; the reviewed unsaved source is retained in the pane. Inspect it before another change. " : this.review ? "No filter edit was applied. " : "") + (error instanceof Error ? error.message : String(error));
    } finally { this.busy = false; if (this.review) { this.action.disabled = this.back.disabled = this.terminal; } }
  }
  override onClose(): void { this.review?.close(); this.authority.closed(); }
}
