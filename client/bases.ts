import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import { allTags, sameValue } from "./markdown";
import { inferPropertyType, parsePropertyValue, propertyTypes } from "./property-types";
import { Modal } from "./ui";
import { TextFileView } from "./views";
import type { WorkspaceLeaf } from "./workspace";
import { webViewerIpc } from "./webviewer-bridge";
import { BaseDocument, baseProperty, type BaseColumn, type BaseFile, type BaseRequest, type BaseResponse, type BaseResult, type BaseSummaryCell } from "./bases-model";
import { builtinSummaries, summaryName } from "./bases-summaries";

export class Bases {
  readonly id = "bases";
  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }
  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      const closeViews = await core.installViews(this.id, { bases: leaf => new BasesView(leaf, this) });
      let extension: (() => void) | undefined;
      let commands: (() => void) | undefined;
      try {
        extension = this.app.workspace.registerExtensions("core:bases", ["base"], "bases");
        commands = this.app.commands.install([{ id: "bases:new-file", name: "Create new base", callback: () => core.run(() => this.create()) }]);
      } catch (error) { extension?.(); commands?.(); await closeViews(); throw error; }
      const ribbon = iconButton("table", "Create new base", () => this.app.commands.execute("bases:new-file").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      element("core-ribbon").append(ribbon);
      return async () => { await closeViews(); extension?.(); commands?.(); ribbon.remove(); };
    }, this);
  }
  async create(): Promise<void> {
    let path = "";
    for (let index = 0; index < 1000; index++) {
      const candidate = "Untitled" + (index ? " " + index : "") + ".base";
      if (!this.app.vault.getAbstractFileByPath(candidate)) { path = candidate; break; }
    }
    if (!path) { throw new Error("No free Untitled base filename was found."); }
    const file = await this.app.vault.create(path, "views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n");
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
}

export class BasesView extends TextFileView {
  override icon = "table";
  private text = "";
  private model: BaseDocument | null = null;
  private selected = "";
  private search = "";
  private page = 0;
  private serial = 0;
  private worker: Worker | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private checkingExternal: Promise<void> | null = null;
  private modal: Modal | null = null;
  private readonly views = document.createElement("select");
  private readonly grouping = document.createElement("select");
  private readonly searchInput = document.createElement("input");
  private readonly status = document.createElement("output");
  private readonly error = document.createElement("p");
  private readonly issues = document.createElement("details");
  private readonly table = document.createElement("div");
  private readonly pagination = document.createElement("div");

  constructor(leaf: WorkspaceLeaf, readonly provider: Bases) {
    super(leaf);
    this.headerEl.hidden = true;
    this.contentEl.classList.add("bases-view");
    this.contentEl.dataset.basesView = leaf.id;
    const toolbar = document.createElement("div");
    toolbar.className = "bases-toolbar";
    const viewLabel = document.createElement("label"); viewLabel.textContent = "View ";
    this.views.dataset.basesSelect = ""; this.views.setAttribute("aria-label", "Base view"); viewLabel.append(this.views);
    const groupLabel = document.createElement("label"); groupLabel.textContent = "Group by ";
    this.grouping.dataset.basesGroup = ""; this.grouping.setAttribute("aria-label", "Group rows by property"); groupLabel.append(this.grouping);
    this.searchInput.placeholder = "Search displayed values"; this.searchInput.setAttribute("aria-label", "Search base rows");
    this.searchInput.dataset.basesSearch = ""; this.searchInput.maxLength = 1024;
    toolbar.append(viewLabel, groupLabel, this.searchInput,
      this.button("Edit base source", "source", () => this.sourceDialog()),
      this.button("Refresh", "refresh", () => this.refresh()),
      this.button("Reload from disk", "reload", async () => {
        if (!this.isDirty || window.confirm("Discard unsaved base changes and reload its current file?")) { await this.reload(true); }
      }));
    this.status.className = "bases-status"; this.status.setAttribute("role", "status"); this.status.dataset.basesStatus = "";
    this.error.className = "plugin-error bases-error"; this.error.setAttribute("role", "alert"); this.error.dataset.basesError = ""; this.error.hidden = true;
    this.issues.className = "bases-issues"; this.issues.hidden = true; this.issues.dataset.basesIssues = "";
    this.table.className = "bases-table-container"; this.table.tabIndex = 0;
    this.pagination.className = "bases-pagination";
    this.contentEl.append(toolbar, this.status, this.error, this.issues, this.table, this.pagination);
    this.registerDomEvent(this.views, "change", () => {
      this.selected = this.views.value; this.page = 0; this.populateControls(); this.refresh(); this.app.workspace.layoutChanged();
    });
    this.registerDomEvent(this.searchInput, "input", () => {
      this.search = this.searchInput.value; this.page = 0; this.schedule(); this.app.workspace.layoutChanged();
    });
    this.registerDomEvent(this.grouping, "change", () => {
      if (!this.model) { return; }
      this.commit(this.model.setView(this.selected, "groupBy", this.grouping.value ? { property: this.grouping.value, direction: "ASC" } : null));
    });
    this.registerEvent(this.app.metadataCache.on("finished", () => { this.schedule(); this.checkExternal(); }));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.schedule()));
    this.registerEvent(this.app.metadataTypeManager.on("changed", () => this.schedule()));
    this.register(() => { this.stop(); this.modal?.close(); });
  }
  getViewType(): string { return "bases"; }
  override canAcceptExtension(extension: string): boolean { return extension.toLowerCase() === "base"; }
  getViewData(): string { return this.text; }
  setViewData(data: string, _clear: boolean): void {
    this.stop(); this.text = data;
    try { this.model = new BaseDocument(data); this.selected = this.model.view(this.selected).name; this.setError(""); }
    catch (error) { this.model = null; this.setError(error); }
    this.populateControls(); this.refresh();
  }
  clear(): void {
    this.stop(); this.modal?.close(); this.text = ""; this.model = null;
    this.table.replaceChildren(); this.pagination.replaceChildren(); this.status.textContent = "";
    this.issues.hidden = true; this.issues.replaceChildren();
  }
  override focus(): void { this.table.focus({ preventScroll: true }); }
  override getState(): Record<string, unknown> { return { ...super.getState(), view: this.selected, search: this.search, page: this.page }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    if (state.view != null && typeof state.view !== "string" || state.search != null && (typeof state.search !== "string" || state.search.length > 1024)
      || state.page != null && (typeof state.page !== "number" || !Number.isSafeInteger(state.page) || state.page < 0)) { throw new Error("Invalid saved Bases view/search/page state."); }
    await super.setState(state, result);
    if (typeof state.view === "string") { this.selected = this.model?.view(state.view).name ?? state.view; }
    this.search = typeof state.search === "string" ? state.search : "";
    this.page = typeof state.page === "number" ? state.page : 0;
    this.searchInput.value = this.search; this.populateControls(); this.refresh();
  }
  override async save(clear = false): Promise<void> {
    try { await super.save(clear); this.setError(""); }
    catch (error) { this.setError(error); throw error; }
  }
  private button(label: string, action: string, callback: () => unknown): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.dataset.basesAction = action;
    this.registerDomEvent(button, "click", () => { Promise.resolve().then(callback).catch(error => this.setError(error)); });
    return button;
  }
  private setError(value: unknown): void {
    const message = value instanceof Error ? value.message : String(value);
    this.error.textContent = message; this.error.hidden = !message;
  }
  private populateControls(): void {
    this.views.replaceChildren(); this.grouping.replaceChildren(new Option("None", ""));
    if (!this.model) { this.views.disabled = true; this.grouping.disabled = true; return; }
    this.views.disabled = false;
    for (const view of this.model.views) { this.views.add(new Option(view.name + (view.type !== "table" ? " (unsupported " + view.type + ")" : ""), view.name)); }
    this.views.value = this.selected;
    const view = this.model.view(this.selected);
    this.grouping.disabled = view.type !== "table";
    for (const key of [...new Set([...view.order, ...(view.groupBy ? [view.groupBy.property] : [])])]) { this.grouping.add(new Option(this.model.label(key), key)); }
    this.grouping.value = view.groupBy?.property ?? "";
  }
  private stop(preservePendingRefresh = false): void {
    this.serial++;
    if (!preservePendingRefresh && this.debounce !== null) { clearTimeout(this.debounce); this.debounce = null; }
    if (this.timeout !== null) { clearTimeout(this.timeout); this.timeout = null; }
    this.worker?.terminate(); this.worker = null;
  }
  private schedule(): void {
    if (!this.model || !this.file || !this.isLoaded) { return; }
    if (this.debounce !== null) { clearTimeout(this.debounce); }
    this.debounce = setTimeout(() => { this.debounce = null; this.refresh(); }, 100);
  }
  private checkExternal(): void {
    if (this.checkingExternal || !this.file || !this.savedDocument || !this.isLoaded || this.isDirty || this.isSaving || this.app.changingVault) { return; }
    // The Markdown index does not provide content-version observations for .base files.
    const operation = this.reload(false).catch(error => this.setError(error)).finally(() => {
      if (this.checkingExternal === operation) { this.checkingExternal = null; }
    });
    this.checkingExternal = operation;
  }
  private snapshot(): BaseFile[] {
    const files = this.app.vault.getFiles();
    if (files.length > 10000) { throw new Error("Bases currently supports at most 10,000 files per query."); }
    let remaining = 8 * 1024 * 1024;
    return files.map(file => {
      const indexed = this.app.metadataCache.getDocument(file.path);
      const original = indexed?.cache.frontmatter ?? {};
      const properties: Record<string, unknown> = Object.create(null);
      let propertyBudget = 4096;
      const copy = (value: unknown, depth = 0): unknown => {
        remaining -= 16;
        if (remaining < 0) { throw new Error("Bases metadata exceeds the supported 8 MiB query input limit."); }
        if (--propertyBudget < 0 || depth > 24) { throw new Error("A note's properties exceed the supported size/nesting limit."); }
        if (typeof value === "string") { remaining -= value.length * 2; if (value.length > 65536) { throw new Error("A property string exceeds 65,536 characters."); } }
        if (Array.isArray(value)) { if (value.length > 1024) { throw new Error("A property list exceeds 1,024 values."); } return value.map(item => copy(item, depth + 1)); }
        if (value && typeof value === "object") { return Object.fromEntries(Object.entries(value).map(([key, item]) => { remaining -= key.length * 2 + 16; return [key, copy(item, depth + 1)]; })); }
        return value;
      };
      let metadataError = indexed?.cache.errors.join("\n") || (file.extension.toLowerCase() === "md" && !indexed ? "The Markdown file has not been indexed." : "");
      try { for (const [key, value] of Object.entries(original)) { remaining -= key.length * 2 + 32; properties[key] = copy(value); } }
      catch (error) { metadataError = error instanceof Error ? error.message : String(error); }
      const tags = indexed ? allTags(indexed.cache) : [];
      const links = indexed?.outgoing.flatMap(reference => reference.destination ? [reference.destination.path] : []) ?? [];
      remaining -= file.path.length * 2 + 128 + [...tags, ...links].reduce((size, value) => size + value.length * 2 + 16, 0);
      if (remaining < 0) { throw new Error("Bases metadata exceeds the supported 8 MiB query input limit."); }
      const localTypes = Object.fromEntries(Object.keys(properties).map(key => [key.toLowerCase(), this.app.metadataTypeManager.getAssignedWidget(key) ?? inferPropertyType(properties[key])]));
      return {
        path: file.path, name: file.name, basename: file.basename, extension: file.extension, stat: { ...file.stat },
        properties, types: localTypes, tags, links,
        ...(metadataError ? { metadataError } : {}),
      };
    });
  }
  private refresh(): void {
    this.stop();
    const model = this.model, file = this.file;
    if (!model || !file || !this.isLoaded) { this.table.replaceChildren(); return; }
    this.status.textContent = "Updating base…"; this.contentEl.dataset.basesComplete = "false";
    try {
      const files = this.snapshot();
      const context = files.find(entry => entry.path === file.path);
      if (!context) { throw new Error("This base is no longer present in the selected vault."); }
      const serial = this.serial;
      const worker = new Worker(new URL("js/bases-worker.js", document.baseURI), { type: "module" });
      this.worker = worker;
      this.timeout = setTimeout(() => { if (this.serial === serial) { this.stop(true); this.table.replaceChildren(); this.setError("The base query exceeded its three-second worker deadline. Its source was preserved."); this.status.textContent = "Query stopped"; } }, 3000);
      worker.addEventListener("message", (event: MessageEvent<BaseResponse>) => {
        if (event.data.serial !== this.serial || worker !== this.worker) { return; }
        // An older result must not cancel a search/metadata refresh queued while it ran.
        this.stop(true);
        if ("error" in event.data) { this.table.replaceChildren(); this.pagination.replaceChildren(); this.setError(event.data.error); this.status.textContent = "Query unavailable"; return; }
        this.setError(""); this.render(event.data.result); this.contentEl.dataset.basesComplete = "true";
      });
      worker.addEventListener("error", event => { if (worker === this.worker) { this.stop(true); this.table.replaceChildren(); this.pagination.replaceChildren(); this.setError("Base query worker failed: " + event.message); this.status.textContent = "Query unavailable"; } });
      worker.postMessage({ text: this.text, files, context, view: this.selected, search: this.search, page: this.page, serial } satisfies BaseRequest);
    } catch (error) { this.stop(); this.table.replaceChildren(); this.pagination.replaceChildren(); this.setError(error); this.status.textContent = "Query unavailable"; }
  }
  private render(result: BaseResult): void {
    this.page = result.page;
    this.table.replaceChildren(); this.pagination.replaceChildren(); this.issues.replaceChildren();
    const messages = [...result.warnings, ...result.errors];
    this.issues.hidden = !messages.length;
    if (messages.length) {
      const summary = document.createElement("summary"); summary.textContent = `${messages.length} query warning${messages.length === 1 ? "" : "s"} or error${messages.length === 1 ? "" : "s"}`;
      const list = document.createElement("ul");
      for (const message of messages) { const item = document.createElement("li"); item.textContent = message; list.append(item); }
      this.issues.append(summary, list);
    }
    const summarized = result.summaries.some(value => value !== null);
    this.status.textContent = `${result.total} rows` + (result.total !== result.matched ? ` (${result.matched} before limit)` : "") + ` · Page ${result.page + 1} of ${result.pages}` + (summarized ? ` · Summaries cover all ${result.total} rows` : "");
    const table = document.createElement("table"); table.className = "bases-table";
    const head = document.createElement("thead"), header = document.createElement("tr");
    for (const column of result.columns) {
      const cell = document.createElement("th"); cell.scope = "col";
      const sort = this.model?.view(this.selected).sort.find(item => item.property === column.key);
      const button = document.createElement("button"); button.type = "button";
      button.textContent = column.label + (sort ? sort.direction === "ASC" ? " ↑" : " ↓" : "");
      button.dataset.basesSort = column.key; button.title = "Sort by " + column.label;
      button.addEventListener("click", () => {
        try { if (this.model) { this.commit(this.model.setView(this.selected, "sort", [{ property: column.key, direction: sort?.direction === "ASC" ? "DESC" : "ASC" }])); } }
        catch (error) { this.setError(error); }
      });
      const summarize = document.createElement("button"); summarize.type = "button"; summarize.textContent = "Σ"; summarize.className = "bases-summary-action";
      summarize.dataset.basesSummarize = column.key; summarize.setAttribute("aria-label", "Summarize " + column.label); summarize.title = "Summarize " + column.label;
      summarize.addEventListener("click", () => { try { this.summaryDialog(column); } catch (error) { this.setError(error); } });
      cell.append(button, summarize); header.append(cell);
    }
    head.append(header);
    const body = document.createElement("tbody");
    let group: string | null = null;
    for (const row of result.rows) {
      if (row.groupKey && row.groupKey !== group) {
        group = row.groupKey;
        const heading = document.createElement("tr"); heading.className = "bases-group";
        const cell = document.createElement("th"); cell.scope = "rowgroup"; cell.colSpan = result.columns.length;
        const info = result.groups.find(group => group.key === row.groupKey);
        cell.textContent = row.group + " · " + (info?.count ?? 0); cell.dataset.basesGroupLabel = row.group;
        heading.append(cell); body.append(heading);
        if (summarized && info?.summaries) { body.append(this.summaryRow(result.columns, info.summaries, info.key, row.group)); }
      }
      const line = document.createElement("tr"); line.dataset.basesRow = row.path;
      for (const [index, value] of row.cells.entries()) {
        const column = result.columns[index], cell = document.createElement("td"); cell.dataset.basesCell = column.key;
        if (value.error) { cell.textContent = "#ERROR"; cell.title = value.error; cell.className = "bases-cell-error"; }
        else if (value.link) {
          const button = document.createElement("button"); button.type = "button"; button.className = "bases-file-link"; button.textContent = value.text || value.link;
          button.dataset.basesLink = value.link;
          button.addEventListener("click", () => { this.openTarget(value.link!).catch(error => this.setError(error)); });
          cell.append(button);
        } else if (baseProperty(column.key).kind === "note" && /\.md$/i.test(row.path)) {
          const button = document.createElement("button"); button.type = "button"; button.className = "bases-cell-edit";
          button.textContent = value.text || "—"; button.setAttribute("aria-label", "Edit " + column.label + " in " + row.path);
          button.addEventListener("click", () => { try { this.editProperty(row.path, baseProperty(column.key).name); } catch (error) { this.setError(error); } });
          cell.append(button);
        } else { cell.textContent = value.text || "—"; }
        line.append(cell);
      }
      body.append(line);
    }
    if (!result.rows.length) { const row = document.createElement("tr"), cell = document.createElement("td"); cell.colSpan = result.columns.length; cell.textContent = "No files match this view."; row.append(cell); body.append(row); }
    table.append(head, body);
    if (summarized) { const foot = document.createElement("tfoot"); foot.append(this.summaryRow(result.columns, result.summaries, "all", "All rows")); table.append(foot); }
    this.table.append(table);
    const previous = document.createElement("button"), next = document.createElement("button");
    previous.textContent = "Previous page"; next.textContent = "Next page";
    previous.dataset.basesAction = "previous-page"; next.dataset.basesAction = "next-page";
    previous.disabled = this.page === 0; next.disabled = this.page >= result.pages - 1;
    previous.addEventListener("click", () => { this.page--; this.refresh(); this.app.workspace.layoutChanged(); });
    next.addEventListener("click", () => { this.page++; this.refresh(); this.app.workspace.layoutChanged(); });
    this.pagination.append(previous, next);
  }
  private summaryRow(columns: BaseColumn[], values: (BaseSummaryCell | null)[], scope: string, label: string): HTMLTableRowElement {
    const row = document.createElement("tr"); row.className = "bases-summary-row"; row.dataset.basesSummaryRow = scope;
    row.setAttribute("aria-label", label + " summaries");
    for (const [index, column] of columns.entries()) {
      const value = values[index], cell = document.createElement("td"), button = document.createElement("button");
      cell.dataset.basesSummary = column.key; cell.dataset.basesSummaryScope = scope;
      button.type = "button"; button.className = "bases-summary-button";
      button.setAttribute("aria-label", `Summarize ${column.label}: ${label}, ${value ? value.name + ": " + value.text : "no summary"}`);
      const name = document.createElement("span"); name.className = "bases-summary-name"; name.textContent = value?.name ?? "Summarize…";
      button.append(name);
      if (value) {
        const result = document.createElement("span"); result.dataset.basesSummaryValue = ""; result.textContent = value.text; button.append(result);
        if (value.error) { cell.classList.add("bases-cell-error"); button.title = value.error; }
      }
      button.addEventListener("click", () => { try { this.summaryDialog(column); } catch (error) { this.setError(error); } });
      cell.append(button); row.append(cell);
    }
    return row;
  }
  private summaryDialog(column: BaseColumn): void {
    const model = this.model;
    if (!model) { throw new Error("Wait for this base to finish loading."); }
    const selected = this.selected, original = this.text, root = this.app.vault.rootPath, file = this.file;
    const modal = this.dialog("Summarize " + column.label);
    const form = document.createElement("form"), label = document.createElement("label"), select = document.createElement("select");
    label.textContent = "Summary"; select.dataset.basesSummaryFunction = ""; select.add(new Option("None", ""));
    const choices = new Set([...builtinSummaries(column.summaryKind).keys(), ...model.summaryFormulas.keys(), ...model.summaryErrors.keys()]);
    const current = model.summary(selected, column.key);
    if (current) { choices.add(current); }
    for (const name of choices) { select.add(new Option(name + (model.summaryFormulas.has(name) || model.summaryErrors.has(name) ? " (custom)" : ""), name)); }
    select.value = current ?? ""; label.append(select);
    const hint = document.createElement("p"); hint.dataset.basesSummaryHint = "";
    const customLabel = document.createElement("label"), custom = document.createElement("input");
    custom.type = "checkbox"; custom.dataset.basesSummaryCustom = ""; customLabel.className = "bases-summary-custom"; customLabel.append(custom, "Create a custom summary");
    const fields = document.createElement("div"), nameLabel = document.createElement("label"), name = document.createElement("input"), formulaLabel = document.createElement("label"), formula = document.createElement("textarea"), scope = document.createElement("p");
    fields.hidden = true; fields.dataset.basesSummaryFields = "";
    name.maxLength = 128; name.dataset.basesSummaryName = ""; nameLabel.append("New summary name", name);
    formula.dataset.basesSummaryFormula = ""; formula.spellcheck = false; formula.value = "values.mean().round(3)"; formulaLabel.append("Formula over this column's values", formula);
    scope.textContent = "The formula will be available in every view of this base. Edit existing shared formulas in the base source.";
    fields.append(nameLabel, formulaLabel, scope);
    const explain = (): void => {
      hint.textContent = custom.checked || model.summaryFormulas.has(select.value) || model.summaryErrors.has(select.value) ? ""
        : select.value === "Average" ? "Average divides the numeric sum by all rows, including missing values. A custom filtered mean can exclude them."
        : select.value === "Empty" || select.value === "Filled" ? "Empty counts missing or null values. Empty text and lists count as filled."
        : select.value === "Range" && column.summaryKind === "date" ? "Date ranges are reported in milliseconds." : "";
      hint.hidden = !hint.textContent;
    };
    select.addEventListener("change", explain);
    custom.addEventListener("change", () => { fields.hidden = !custom.checked; select.disabled = custom.checked; explain(); if (custom.checked) { name.focus(); } });
    explain();
    const error = document.createElement("p"); error.className = "plugin-error"; error.setAttribute("role", "alert"); error.dataset.basesDialogError = "";
    const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "Apply summary"; apply.dataset.basesAction = "apply-summary";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.basesAction = "cancel-summary"; cancel.addEventListener("click", () => modal.close());
    form.append(label, hint, customLabel, fields, error, apply, cancel);
    form.addEventListener("submit", event => {
      event.preventDefault(); form.inert = true;
      this.app.core.run(async () => {
        if (this.modal !== modal || !modal.containerEl.isConnected || this.text !== original || this.selected !== selected || this.file !== file || this.app.vault.rootPath !== root || !this.app.core.isEnabled("bases") || !this.isLoaded) {
          throw new Error("The base, view or summary dialog changed. Reopen the current column's summary.");
        }
        const definition = custom.checked ? { name: summaryName(name.value.trim()), formula: formula.value } : undefined;
        const next = model.setSummary(selected, column.key, definition?.name ?? (select.value || null), definition);
        this.commit(next); await this.save(); modal.close();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); }).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form); modal.open(); select.focus();
  }
  private async openTarget(path: string): Promise<void> {
    if (/^https?:\/\//i.test(path)) {
      const viewer = this.app.core.getEnabledPluginById("webviewer");
      if (viewer?.options.openExternalURLs === true && "openUrl" in viewer && typeof viewer.openUrl === "function") { await viewer.openUrl(path, true); }
      else if (webViewerIpc()) { await require("electron").shell.openExternal(path); }
      else { window.open(path, "_blank", "noopener,noreferrer"); }
      return;
    }
    await this.app.workspace.openLinkText(path, this.file?.path ?? "", true);
  }
  private commit(text: string): void {
    if (!this.file || !this.app.core.isEnabled("bases") || this.app.changingVault) { throw new Error("This base provider or vault changed."); }
    text = this.normalizeSource(text);
    const model = new BaseDocument(text);
    this.text = text; this.model = model; this.selected = model.view(this.selected).name; this.page = 0;
    this.populateControls(); this.setError(""); this.requestSave(); this.refresh();
  }
  private normalizeSource(text: string): string { return text.replace(/\r?\n/g, this.text.includes("\r\n") ? "\r\n" : "\n"); }
  private dialog(title: string): Modal {
    if (!this.file || !this.app.core.isEnabled("bases") || this.app.core.busy || this.app.changingVault) { throw new Error("Wait for this base to finish loading."); }
    this.modal?.close();
    const modal = new Modal(this.app).setTitle(title);
    modal.modalEl.dataset.coreDialog = "bases";
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } };
    this.modal = modal;
    return modal;
  }
  private sourceDialog(): void {
    const modal = this.dialog("Edit base source"), original = this.text;
    const form = document.createElement("form"), label = document.createElement("label"), input = document.createElement("textarea"), error = document.createElement("p");
    label.textContent = "Base YAML"; input.value = original; input.dataset.basesSource = ""; input.className = "bases-source-input"; input.spellcheck = false; label.append(input);
    error.className = "plugin-error"; error.setAttribute("role", "alert"); error.dataset.basesDialogError = "";
    const save = document.createElement("button"); save.type = "submit"; save.textContent = "Apply and save"; save.dataset.basesAction = "apply-source";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.basesAction = "cancel-source"; cancel.addEventListener("click", () => modal.close());
    form.append(label, error, save, cancel);
    form.addEventListener("submit", event => {
      event.preventDefault(); form.inert = true;
      this.app.core.run(async () => {
        const draft = this.normalizeSource(input.value);
        if (this.modal !== modal || !modal.containerEl.isConnected || this.text !== original && this.text !== draft) { throw new Error("The base or source dialog changed. Reopen its current source."); }
        this.commit(draft); await this.save(); modal.close();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); }).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form); modal.open(); input.focus();
  }
  private editProperty(path: string, key: string): void {
    const file = this.app.vault.getFileByPath(path), indexed = this.app.metadataCache.getDocument(path);
    if (!file || !indexed || indexed.cache.errors.length) { throw new Error("This note's properties are unavailable or its YAML needs correction."); }
    const values = indexed.cache.frontmatter ?? {}, prior = structuredClone(values[key]), existed = Object.hasOwn(values, key);
    const assigned = this.app.metadataTypeManager.getAssignedWidget(key), kind = assigned ?? inferPropertyType(prior);
    const supported = prior == null || ["string", "boolean", "number"].includes(typeof prior) || Array.isArray(prior) && prior.every(value => typeof value === "string");
    if (!supported || typeof prior === "number" && (!Number.isFinite(prior) || Number.isInteger(prior) && !Number.isSafeInteger(prior))) { throw new Error("This structured or imprecise value is retained; edit it in the note's source."); }
    const modal = this.dialog("Edit " + key + " in " + file.name), root = this.app.vault.rootPath;
    const form = document.createElement("form"), typeLabel = document.createElement("label"), type = document.createElement("select"), valueLabel = document.createElement("label"), input = document.createElement("textarea"), checkLabel = document.createElement("label"), checked = document.createElement("input"), error = document.createElement("p");
    typeLabel.textContent = "Property type"; type.dataset.basesPropertyType = "";
    for (const value of propertyTypes) { type.add(new Option(value, value)); } type.value = kind; type.disabled = assigned !== null; typeLabel.append(type);
    valueLabel.textContent = "Value (one item per line for lists)"; input.dataset.basesPropertyValue = ""; input.value = Array.isArray(prior) ? prior.join("\n") : prior == null ? "" : String(prior); valueLabel.append(input);
    checkLabel.textContent = "Checked "; checked.type = "checkbox"; checked.checked = prior === true; checked.dataset.basesPropertyChecked = ""; checkLabel.append(checked);
    const update = (): void => { valueLabel.hidden = type.value === "checkbox"; checkLabel.hidden = type.value !== "checkbox"; };
    type.addEventListener("change", update); update();
    error.className = "plugin-error"; error.setAttribute("role", "alert"); error.dataset.basesDialogError = "";
    const save = document.createElement("button"); save.type = "submit"; save.textContent = "Save property"; save.dataset.basesAction = "save-property";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.basesAction = "cancel-property"; cancel.addEventListener("click", () => modal.close());
    form.append(typeLabel, valueLabel, checkLabel, error, save, cancel);
    form.addEventListener("submit", event => {
      event.preventDefault(); form.inert = true;
      this.app.core.run(async () => {
        if (this.modal !== modal || !modal.containerEl.isConnected || root !== this.app.vault.rootPath || !this.app.core.isEnabled("bases")) { throw new Error("The property dialog, provider or vault changed."); }
        const currentType = this.app.metadataTypeManager.getAssignedWidget(key);
        if (currentType && currentType !== type.value) { throw new Error("This property's assigned type changed. Reopen it before saving."); }
        const next = parsePropertyValue(type.value, input.value, checked.checked);
        await this.app.fileManager.processFrontMatter(file, properties => {
          if (Object.hasOwn(properties, key) !== existed || !sameValue(properties[key], prior)) { throw new Error("The property changed while this dialog was open. Reopen its current value."); }
          Object.defineProperty(properties, key, { value: next, enumerable: true, configurable: true, writable: true });
        });
        modal.close(); this.refresh();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); }).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form); modal.open(); (kind === "checkbox" ? checked : input).focus();
  }
}
