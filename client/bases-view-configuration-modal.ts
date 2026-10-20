import type { App } from "./app";
import { BaseDocument, type BaseSort } from "./bases-model";
import { BaseViewConfigurationReview, MAX_BASE_CONFIG_COLUMNS, MAX_BASE_CONFIG_SORTS, assertBaseViewSortOwnership, validateBaseViewConfiguration, type BaseViewConfiguration, type BaseViewConfigurationDraft } from "./bases-view-configuration";
import type { BaseViewManagementAuthority } from "./bases-view-management";
import { Modal } from "./ui";
import type { TFile } from "./vault";

type RowKind = "column" | "sort";
export class BaseViewConfigurationModal extends Modal {
  private readonly editor = document.createElement("fieldset");
  private readonly columns = document.createElement("div");
  private readonly sorts = document.createElement("div");
  private readonly columnCount = document.createElement("output");
  private readonly sortCount = document.createElement("output");
  private readonly addColumn = document.createElement("button");
  private readonly addSort = document.createElement("button");
  private readonly limit = document.createElement("input");
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private readonly suggestionsId = "bases-config-" + crypto.randomUUID();
  private readonly order: string[];
  private readonly sort: BaseSort[];
  private readonly initial: BaseViewConfigurationDraft;
  private readonly baseline: BaseViewConfiguration;
  private review: BaseViewConfigurationReview | null = null;
  private busy = false;
  private terminal = false;

  constructor(app: App, private readonly file: TFile, private readonly source: string, private readonly selected: string,
    private readonly authority: BaseViewManagementAuthority & { closed(): void }, private readonly suggestions: readonly string[] = []) {
    super(app); this.setTitle("Configure base view"); this.modalEl.dataset.basesConfiguration = ""; this.modalEl.classList.add("bases-view-configuration-modal");
    const current = new BaseDocument(source).view(selected);
    assertBaseViewSortOwnership(current.sort);
    this.order = [...current.order]; this.sort = current.sort.map(item => ({ ...item }));
    this.baseline = { order: [...this.order], sort: this.sort.map(item => ({ ...item })), limit: current.limit };
    this.initial = { order: [...this.order], sort: this.sort.map(item => ({ ...item })), limit: current.limit === null ? "" : String(current.limit) };
  }
  override onOpen(): void {
    const intro = document.createElement("p"), legend = document.createElement("legend"), columns = document.createElement("section"), sorts = document.createElement("section"), columnTitle = document.createElement("h3"), sortTitle = document.createElement("h3"), hint = document.createElement("p"), limitLabel = document.createElement("label"), data = document.createElement("datalist"), actions = document.createElement("div"), cancel = document.createElement("button");
    intro.textContent = `Configure the saved “${this.selected}” view. Review precise field changes and the complete YAML before Apply and save. Matching note contents are kept.`;
    legend.textContent = "View configuration"; columnTitle.textContent = "Displayed properties, in order"; sortTitle.textContent = "Sort keys, highest priority first";
    this.columns.dataset.basesConfigColumns = ""; this.sorts.dataset.basesConfigSorts = "";
    this.addColumn.type = this.addSort.type = "button"; this.addColumn.textContent = "Add property"; this.addSort.textContent = "Add sort key";
    this.addColumn.dataset.basesConfigAddColumn = ""; this.addSort.dataset.basesConfigAddSort = "";
    this.addColumn.addEventListener("click", () => { if (this.order.length < MAX_BASE_CONFIG_COLUMNS) { this.order.push(""); this.renderRows("column", this.order.length - 1); this.validate(); } });
    this.addSort.addEventListener("click", () => { if (this.sort.length < MAX_BASE_CONFIG_SORTS) { this.sort.push({ property: "", direction: "ASC" }); this.renderRows("sort", this.sort.length - 1); this.validate(); } });
    columns.append(columnTitle, this.columnCount, this.columns, this.addColumn); sorts.append(sortTitle, this.sortCount, this.sorts, this.addSort);
    hint.textContent = "Enter exact note, file or formula identifiers, including spaces and Unicode. Unqualified properties mean note properties. Suggestions are optional. Sort keys may be hidden columns; no sort keys uses the existing file-path tie break. Use Move earlier/later or Alt+↑/↓ on a row. Grouping, display labels, summaries and view presentation stay as configured. Commented or aliased fields may require source editing.";
    data.id = this.suggestionsId;
    for (const key of [...new Set([...this.order, ...this.sort.map(item => item.property), ...this.suggestions])].slice(0, 256)) { const option = document.createElement("option"); option.value = key; data.append(option); }
    this.limit.type = "text"; this.limit.inputMode = "numeric"; this.limit.maxLength = 5; this.limit.placeholder = "No limit"; this.limit.value = this.initial.limit; this.limit.dataset.basesConfigLimit = "";
    limitLabel.className = "bases-view-configuration-limit"; limitLabel.append("View limit (blank: no limit; 0: no rows; maximum: 10,000)", this.limit); this.limit.addEventListener("input", () => this.validate());
    this.editor.append(legend, columns, sorts, limitLabel, hint, data);
    this.preview.hidden = true; this.preview.dataset.basesConfigPreview = "";
    this.status.dataset.basesConfigStatus = ""; this.status.id = this.suggestionsId + "-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.limit.setAttribute("aria-describedby", this.status.id);
    this.action.type = this.back.type = cancel.type = "button"; this.action.textContent = "Review configuration"; this.action.dataset.basesConfigReview = "";
    this.back.textContent = "Edit draft"; this.back.dataset.basesConfigBack = ""; this.back.hidden = true; cancel.textContent = "Cancel"; cancel.dataset.basesConfigCancel = "";
    actions.className = "bases-view-configuration-actions"; actions.append(this.action, this.back, cancel);
    this.action.addEventListener("click", () => { void this.run(); }); this.back.addEventListener("click", () => this.editDraft()); cancel.addEventListener("click", () => this.close());
    this.contentEl.append(intro, this.editor, this.preview, actions, this.status); this.renderRows("column"); this.renderRows("sort"); this.validate(); this.columns.querySelector("input")?.focus();
  }
  private renderRows(kind: RowKind, focus?: number): void {
    const host = kind === "column" ? this.columns : this.sorts, length = kind === "column" ? this.order.length : this.sort.length; host.replaceChildren();
    for (let at = 0; at < length; at++) {
      const row = document.createElement("div"), label = document.createElement("label"), key = document.createElement("input"), actions = document.createElement("div");
      row.className = "bases-view-configuration-row"; row.dataset.basesConfigRow = kind; row.dataset.basesConfigIndex = String(at);
      key.type = "text"; key.maxLength = 264; key.spellcheck = false; key.value = kind === "column" ? this.order[at] : this.sort[at].property; key.setAttribute("list", this.suggestionsId); key.setAttribute("aria-describedby", this.status.id); key.dataset.basesConfigProperty = kind;
      label.append((kind === "column" ? "Property " : "Sort key ") + (at + 1), key); row.append(label);
      key.addEventListener("input", () => { if (kind === "column") { this.order[at] = key.value; } else { this.sort[at].property = key.value; } this.validate(); });
      if (kind === "sort") {
        const directionLabel = document.createElement("label"), direction = document.createElement("select"); direction.add(new Option("Ascending", "ASC")); direction.add(new Option("Descending", "DESC")); direction.value = this.sort[at].direction; direction.dataset.basesConfigDirection = ""; direction.setAttribute("aria-label", "Direction for sort key " + (at + 1));
        direction.addEventListener("change", () => { this.sort[at].direction = direction.value as BaseSort["direction"]; this.validate(); }); directionLabel.append("Direction", direction); row.append(directionLabel);
      }
      const move = (step: -1 | 1): void => {
        if (at + step < 0 || at + step >= length) { return; }
        if (kind === "column") { [this.order[at], this.order[at + step]] = [this.order[at + step], this.order[at]]; }
        else { [this.sort[at], this.sort[at + step]] = [this.sort[at + step], this.sort[at]]; }
        this.renderRows(kind, at + step); this.validate();
      };
      actions.className = "bases-view-configuration-row-actions";
      for (const [name, title, step] of [["earlier", "Move earlier", -1], ["later", "Move later", 1]] as const) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = title; button.dataset.basesConfigMove = name; button.setAttribute("aria-label", title + " " + (kind === "column" ? "property " : "sort key ") + (at + 1)); button.disabled = at + step < 0 || at + step >= length; button.addEventListener("click", () => move(step)); actions.append(button);
      }
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.dataset.basesConfigRemove = ""; remove.setAttribute("aria-label", "Remove " + (kind === "column" ? "property " : "sort key ") + (at + 1)); remove.disabled = kind === "column" && length === 1;
      remove.addEventListener("click", () => { if (kind === "column") { if (this.order.length === 1) { return; } this.order.splice(at, 1); } else { this.sort.splice(at, 1); } this.renderRows(kind, Math.max(0, at - 1)); this.validate(); }); actions.append(remove); row.append(actions);
      row.addEventListener("keydown", event => { if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); move(event.key === "ArrowUp" ? -1 : 1); } });
      host.append(row);
    }
    if (focus !== undefined) { (host.children[focus]?.querySelector("input") as HTMLInputElement | null)?.focus(); }
  }
  private draft(): BaseViewConfigurationDraft { return { order: [...this.order], sort: this.sort.map(item => ({ ...item })), limit: this.limit.value }; }
  private validate(): void {
    this.columnCount.textContent = `${this.order.length} of 64 displayed properties`; this.sortCount.textContent = `${this.sort.length} of 16 sort keys`;
    this.addColumn.disabled = this.order.length >= MAX_BASE_CONFIG_COLUMNS; this.addSort.disabled = this.sort.length >= MAX_BASE_CONFIG_SORTS;
    try {
      const draft = this.draft(), values = validateBaseViewConfiguration(draft);
      if (JSON.stringify(values) === JSON.stringify(this.baseline)) { this.action.disabled = true; this.status.textContent = "Change a displayed property, sort key or limit before reviewing."; }
      else { this.action.disabled = false; this.status.textContent = "Draft values are valid. Review the exact YAML before saving."; }
      this.limit.removeAttribute("aria-invalid");
    } catch (error) { this.action.disabled = true; this.status.textContent = error instanceof Error ? error.message : String(error); this.limit.setAttribute("aria-invalid", String(!/^(?:\d{1,5})?$/.test(this.limit.value) || Number(this.limit.value) > 10000)); }
  }
  private editDraft(): void {
    if (this.busy || this.terminal || !this.authority.current()) { return; }
    this.review?.close(); this.review = null; this.preview.hidden = true; this.preview.replaceChildren(); this.editor.hidden = false; this.editor.disabled = false;
    this.action.textContent = "Review configuration"; this.action.removeAttribute("data-bases-config-apply"); this.action.dataset.basesConfigReview = ""; this.back.hidden = true; this.validate(); this.columns.querySelector("input")?.focus();
  }
  private async run(): Promise<void> {
    if (this.busy || this.terminal) { return; }
    try {
      this.app.vault.assertWritable("modify", this.file.path);
      if (!this.authority.current() || !this.containerEl.isConnected) { throw new Error("This base or configuration owner changed. Cancel and start a fresh review."); }
      if (!this.review) {
        const review = new BaseViewConfigurationReview(this.app, this.file, this.source, this.selected, this.draft(), this.authority), description = document.createElement("p"), effects = document.createElement("dl"), endings = document.createElement("p"), source = document.createElement("pre");
        description.textContent = review.plan.description; effects.dataset.basesConfigEffects = "";
        for (const change of review.plan.changes) { const title = document.createElement("dt"), before = document.createElement("dd"), after = document.createElement("dd"); title.textContent = change.field === "order" ? "Displayed properties" : change.field === "sort" ? "Sort priority" : "View limit"; before.textContent = "Before: " + change.before; after.textContent = "After: " + change.after; effects.append(title, before, after); }
        const styles = new Set(this.source.match(/\r\n|\r|\n/g) ?? []);
        endings.textContent = "Exact reviewed base text: " + (styles.size > 1 ? "existing mixed" : styles.has("\r\n") ? "CRLF" : styles.has("\r") ? "CR" : "LF") + " line endings; the saved file's UTF-8 BOM is retained. Apply saves only this reviewed base configuration.";
        source.textContent = review.plan.source; source.dataset.basesConfigSource = ""; source.tabIndex = 0;
        this.preview.replaceChildren(description, effects, endings, source); this.review = review; this.preview.hidden = false; this.editor.hidden = true; this.editor.disabled = true;
        this.action.textContent = "Apply and save"; this.action.removeAttribute("data-bases-config-review"); this.action.dataset.basesConfigApply = ""; this.back.hidden = false; this.action.disabled = false; this.status.textContent = "Review all changes and the complete YAML, then Apply and save or Cancel."; this.action.focus(); return;
      }
      this.busy = true; this.action.disabled = this.back.disabled = true; await this.app.core.run(() => this.review!.apply()); this.close();
    } catch (error) {
      this.terminal = Boolean(this.review); this.status.textContent = (this.review?.attempted ? "Saving was not confirmed; the reviewed unsaved source is retained in the pane. Inspect it before another change. " : this.review ? "No configuration edit was applied. " : "") + (error instanceof Error ? error.message : String(error));
    } finally { this.busy = false; if (this.review) { this.action.disabled = this.back.disabled = this.terminal; } }
  }
  override onClose(): void { this.review?.close(); this.authority.closed(); }
}
