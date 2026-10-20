import type { App } from "./app";
import { BaseGroupOrderReview, baseGroupOrderCandidates, describeBaseGroupOrderValue, MAX_BASE_GROUP_ORDER, planBaseGroupOrder, readBaseGroupOrderState, type BaseGroupOrderDraft, type BaseGroupOrderState, type BaseGroupOrderValue } from "./bases-group-order";
import { baseGroupOrderIdentity, readBaseGroupOrderValues } from "./bases-group-order-values";
import type { BaseFile } from "./bases-model";
import type { BaseViewManagementAuthority } from "./bases-view-management";
import { Modal } from "./ui";
import type { TFile } from "./vault";

export class BaseGroupOrderModal extends Modal {
  private readonly editor = document.createElement("fieldset");
  private readonly rows = document.createElement("ol");
  private readonly modeLabel = document.createElement("p");
  private readonly type = document.createElement("select");
  private readonly value = document.createElement("textarea");
  private readonly preview = document.createElement("section");
  private readonly status = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly back = document.createElement("button");
  private readonly state: BaseGroupOrderState;
  private entries: { value: BaseGroupOrderValue; shown: boolean }[] = [];
  private automatic = true;
  private issue = "";
  private review: BaseGroupOrderReview | null = null;
  private busy = false;
  private terminal = false;
  constructor(app: App, private readonly file: TFile, private readonly source: string, private readonly selected: string, private readonly authority: BaseViewManagementAuthority & { closed(): void }, files: BaseFile[]) {
    super(app); app.vault.assertWritable("modify", file.path); this.setTitle("Group visibility/order"); this.modalEl.dataset.basesGroupOrder = ""; this.modalEl.classList.add("bases-group-order-modal");
    this.state = readBaseGroupOrderState(source, selected); this.automatic = this.state.values === null; this.issue = this.state.issue ?? "";
    const seen = new Set<string>();
    for (const value of this.state.values ?? []) { seen.add(baseGroupOrderIdentity(value)!); this.entries.push({ value, shown: true }); }
    if (!this.issue) {
      try {
        const context = files.find(item => item.path === file.path); if (!context) { throw new Error("The current base is unavailable for group discovery."); }
        for (const value of baseGroupOrderCandidates(source, selected, files, context)) { if (!seen.has(baseGroupOrderIdentity(value)!)) { seen.add(baseGroupOrderIdentity(value)!); this.entries.push({ value, shown: this.automatic }); } }
        if (this.entries.length > MAX_BASE_GROUP_ORDER) { throw new Error("This view has more than 128 configured and matching groups. Edit groupOrder in Source."); }
      } catch (error) { this.issue = error instanceof Error ? error.message : String(error); }
    }
  }
  override onOpen(): void {
    const intro = document.createElement("p"), legend = document.createElement("legend"), tools = document.createElement("div"), addFields = document.createElement("section"), help = document.createElement("p"), actions = document.createElement("div"), cancel = document.createElement("button");
    intro.textContent = "Saved view “" + this.selected + "” groups by " + this.state.property + ". Manual order shows only checked typed values. Unlisted and future values stay hidden. Review the complete exact YAML before saving this base.";
    legend.textContent = "Visible groups and order"; this.rows.dataset.basesGroupOrderRows = ""; this.rows.setAttribute("aria-label", "Typed group visibility and order"); this.modeLabel.dataset.basesGroupOrderMode = "";
    for (const [key, label, fn] of [["show-all", "Show all current groups", () => { this.automatic = false; this.entries.forEach(entry => entry.shown = true); }], ["hide-all", "Hide all groups", () => { this.automatic = false; this.entries.forEach(entry => entry.shown = false); }], ["automatic", "Restore automatic " + this.state.direction, () => { this.automatic = true; }]] as const) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.dataset.basesGroupOrderCommand = key; button.addEventListener("click", () => { fn(); this.render(); }); tools.append(button);
    }
    for (const type of ["string", "number", "boolean", "null"]) { this.type.add(new Option(type === "null" ? "null (missing / no value)" : type, type)); }
    this.type.dataset.basesGroupOrderType = ""; this.value.dataset.basesGroupOrderValue = ""; this.value.rows = 2; this.value.maxLength = 4096; this.value.spellcheck = false;
    this.type.addEventListener("change", () => { this.value.disabled = this.type.value === "null"; });
    const add = document.createElement("button"); add.type = "button"; add.textContent = "Add empty group"; add.dataset.basesGroupOrderCommand = "add";
    add.addEventListener("click", () => {
      try {
        const raw = this.value.value, type = this.type.value;
        const value = type === "null" ? null : type === "string" ? raw : type === "boolean" ? raw === "true" ? true : raw === "false" ? false : undefined : /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(raw) ? Number(raw) : undefined;
        readBaseGroupOrderValues([value]);
        const existing = this.entries.find(entry => baseGroupOrderIdentity(entry.value) === baseGroupOrderIdentity(value));
        if (existing?.shown && !this.automatic) { throw new Error("That exact typed group is already visible. Move it with Up or Down."); }
        if (existing) { existing.shown = true; } else { if (this.entries.length >= MAX_BASE_GROUP_ORDER) { throw new Error("Use at most 128 groups."); } this.entries.push({ value: value as BaseGroupOrderValue, shown: true }); }
        this.automatic = false; this.value.value = ""; this.render();
      } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); }
    });
    help.textContent = "Values come from the saved view's filters before search and row limit. A string is literal text: “false”, “0” and “No value” differ from boolean false, number 0 and null. Add a typed value to retain an empty group. Numbers must be finite and safe; use true or false for booleans. At most 128 groups. Automatic mode also shows new groups and follows groupBy " + this.state.direction + ".";
    addFields.append(this.wrap("Empty group type", this.type), this.wrap("Value (strings use the exact text; numbers and booleans use their JSON spelling)", this.value), add, help);
    this.status.dataset.basesGroupOrderStatus = ""; this.status.id = "bases-group-order-" + crypto.randomUUID(); this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite"); this.value.setAttribute("aria-describedby", this.status.id);
    this.preview.dataset.basesGroupOrderPreview = ""; this.preview.hidden = true;
    this.action.type = this.back.type = cancel.type = "button"; this.action.textContent = "Review change"; this.action.dataset.basesGroupOrderReview = ""; this.back.textContent = "Edit draft"; this.back.dataset.basesGroupOrderBack = ""; this.back.hidden = true; cancel.textContent = "Cancel"; cancel.dataset.basesGroupOrderCancel = "";
    this.action.addEventListener("click", () => { void this.run(); }); this.back.addEventListener("click", () => this.editDraft()); cancel.addEventListener("click", () => this.close());
    actions.className = "bases-group-order-actions"; actions.append(this.action, this.back, cancel); this.editor.append(legend, this.modeLabel, tools, this.rows, addFields); this.contentEl.append(intro, this.editor, this.preview, actions, this.status); this.render();
    if (this.issue) { this.editor.disabled = true; this.action.disabled = true; this.status.textContent = "Source only: " + this.issue; } else { this.rows.querySelector<HTMLInputElement>("input")?.focus(); }
  }
  private wrap(text: string, input: HTMLElement): HTMLLabelElement { const label = document.createElement("label"); label.append(text, input); input.setAttribute("aria-label", text); return label; }
  private draft(): BaseGroupOrderDraft { return this.automatic ? { mode: "automatic" } : { mode: "manual", values: this.entries.filter(entry => entry.shown).map(entry => entry.value) }; }
  private render(): void {
    this.modeLabel.textContent = this.automatic ? "Automatic " + this.state.direction + ": every matching group, including future values." : "Manual: only checked typed values, in the order below. Future values stay hidden."; this.rows.replaceChildren();
    for (const [index, entry] of this.entries.entries()) {
      const row = document.createElement("li"), checkbox = document.createElement("input"), label = describeBaseGroupOrderValue(entry.value);
      row.dataset.basesGroupOrderRow = String(index); checkbox.type = "checkbox"; checkbox.checked = this.automatic || entry.shown; checkbox.dataset.basesGroupOrderShown = String(index); checkbox.setAttribute("aria-label", "Show " + label);
      checkbox.addEventListener("change", () => { if (this.automatic) { this.entries.forEach(item => item.shown = true); } this.automatic = false; entry.shown = checkbox.checked; this.render(); }); row.append(this.wrap(label, checkbox));
      for (const [direction, name] of [[-1, "Up"], [1, "Down"]] as const) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = name; button.dataset.basesGroupOrderMove = String(direction); button.setAttribute("aria-label", "Move " + label + " " + name.toLowerCase()); button.disabled = index + direction < 0 || index + direction >= this.entries.length;
        button.addEventListener("click", () => { if (button.disabled) { return; } if (this.automatic) { this.entries.forEach(item => item.shown = true); } this.automatic = false; const next = index + direction; [this.entries[index], this.entries[next]] = [this.entries[next], this.entries[index]]; this.render(); this.rows.querySelector<HTMLElement>('[data-bases-group-order-row="' + next + '"] button')?.focus(); }); row.append(button);
      }
      this.rows.append(row);
    }
    if (!this.entries.length) { const empty = document.createElement("li"); empty.textContent = "No matching groups. Add a typed empty group, or save Hide all to keep future values hidden."; this.rows.append(empty); }
    this.validate();
  }
  private validate(): void { try { if (this.issue) { throw new Error("Source only: " + this.issue); } planBaseGroupOrder(this.source, this.selected, this.draft()); this.action.disabled = false; this.status.textContent = "Group visibility/order is ready to review."; } catch (error) { this.action.disabled = true; this.status.textContent = error instanceof Error ? error.message : String(error); } }
  private editDraft(): void { if (this.busy || this.terminal || !this.authority.current()) { return; } this.review?.close(); this.review = null; this.editor.hidden = false; this.editor.disabled = false; this.preview.hidden = true; this.preview.replaceChildren(); this.back.hidden = true; this.action.textContent = "Review change"; this.action.removeAttribute("data-bases-group-order-apply"); this.action.dataset.basesGroupOrderReview = ""; this.validate(); }
  private async run(): Promise<void> {
    if (this.busy || this.terminal) { return; }
    try {
      this.app.vault.assertWritable("modify", this.file.path); if (!this.authority.current() || !this.containerEl.isConnected) { throw new Error("This group-order owner changed. Cancel and start a fresh review."); }
      if (this.issue) { throw new Error("Source only: " + this.issue); }
      if (!this.review) {
        const review = new BaseGroupOrderReview(this.app, this.file, this.source, this.selected, this.draft(), this.authority), description = document.createElement("p"), effects = document.createElement("ul"), source = document.createElement("pre"), ending = document.createElement("p");
        description.textContent = review.plan.description; effects.dataset.basesGroupOrderEffects = "";
        for (const text of [...review.plan.changes, ...review.plan.warnings]) { const item = document.createElement("li"); item.textContent = text; effects.append(item); }
        ending.textContent = "Exact reviewed base text. Existing BOM, line endings, unknown fields and precision are retained. Apply saves only this base change.";
        source.textContent = review.plan.source; source.dataset.basesGroupOrderSource = ""; source.tabIndex = 0; this.preview.replaceChildren(description, effects, ending, source); this.review = review;
        this.editor.hidden = true; this.editor.disabled = true; this.preview.hidden = false; this.back.hidden = false; this.action.textContent = "Apply and save"; this.action.removeAttribute("data-bases-group-order-review"); this.action.dataset.basesGroupOrderApply = ""; this.action.disabled = false; this.status.textContent = "Review the typed effects and complete exact YAML, then Apply and save or Cancel."; this.action.focus(); return;
      }
      this.busy = true; this.action.disabled = this.back.disabled = true; await this.app.core.run(() => this.review!.apply()); this.close();
    } catch (error) { this.terminal = Boolean(this.review); this.status.textContent = (this.review?.attempted ? "Saving was not confirmed; reviewed unsaved source remains in the pane. Inspect it before another change. " : this.review ? "No group-order edit was applied. " : "") + (error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; if (this.review) { this.action.disabled = this.back.disabled = this.terminal; } }
  }
  override onClose(): void { this.review?.close(); this.authority.closed(); }
}
