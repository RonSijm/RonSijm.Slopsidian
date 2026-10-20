import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, requestJson, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import { sameValue } from "./markdown";
import { baseQueryFiles, renderBaseValue } from "./base-embed-render";
import { inferPropertyType, parsePropertyValue, propertyTypes } from "./property-types";
import { Modal } from "./ui";
import { TextFileView } from "./views";
import type { WorkspaceLeaf } from "./workspace";
import { webViewerIpc } from "./webviewer-bridge";
import { BaseDocument, baseProperty, supportedBaseView, baseGroupRenderRows, baseListCellVisible, baseListRowVisible, MAX_BASE_LIST_SEPARATOR, type BaseCell, type BaseColumn, type BaseFile, type BaseRequest, type BaseResponse, type BaseResult, type BaseSummaryCell } from "./bases-model";
import { builtinSummaries, summaryName } from "./bases-summaries";
import { BaseGroupFolds, readBaseGroupFoldState, type BaseGroupScope } from "./bases-group-state";
import { BaseCardCoverLease, readBaseCardImage, type BaseCardBinaryImage, type BaseCardCover, type BaseCardsOptions } from "./bases-cards";
import { createLinkResolver } from "./links";
import { BaseExportModal } from "./bases-export-modal";
import { BaseNoteCreationModal } from "./bases-note-creation-modal";
import { BaseViewManagementModal } from "./bases-view-management-modal";
import { BaseViewConfigurationModal } from "./bases-view-configuration-modal";
import { BaseFiltersModal } from "./bases-filters-modal";
import { BaseFormulasLabelsModal } from "./bases-formulas-labels-modal";
import { BaseSummaryAuthoringModal } from "./bases-summary-authoring-modal";
import { BaseGroupOrderModal } from "./bases-group-order-modal";
import { BaseTablePresentationModal } from "./bases-table-presentation-modal";
import { baseTableValueContainer, styleBaseTable } from "./bases-table";
import type { BaseViewManagementAuthority } from "./bases-view-management";

let groupRenderId = 0;

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
        commands = this.app.commands.install([{ id: "bases:new-file", name: "Create new base", checkCallback: checking => {
          const available = !this.app.vault.readOnly && Boolean(this.app.vault.rootPath) && this.app.core.isEnabled(this.id) && !this.app.changingVault;
          if (available && !checking) { core.run(() => this.create()).catch(reportError); }
          return available;
        } }]);
      } catch (error) { extension?.(); commands?.(); await closeViews(); throw error; }
      const ribbon = iconButton("table", "Create new base", () => this.app.commands.execute("bases:new-file").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      ribbon.disabled = this.app.vault.readOnly;
      element("core-ribbon").append(ribbon);
      return async () => { await closeViews(); extension?.(); commands?.(); ribbon.remove(); };
    }, this);
  }
  async create(): Promise<void> {
    this.app.vault.assertWritable("create");
    if (!this.app.vault.rootPath || !this.app.core.isEnabled(this.id) || this.app.changingVault) { throw new Error("This base provider or vault changed."); }
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
  private groupFolds = new BaseGroupFolds();
  private serial = 0;
  private worker: Worker | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private checkingExternal: Promise<void> | null = null;
  private modal: Modal | null = null;
  private cardCovers: BaseCardCoverLease | null = null;
  private readonly views = document.createElement("select");
  private readonly grouping = document.createElement("select");
  private readonly searchInput = document.createElement("input");
  private readonly status = document.createElement("output");
  private readonly error = document.createElement("p");
  private readonly issues = document.createElement("details");
  private readonly table = document.createElement("div");
  private readonly pagination = document.createElement("div");
  private readonly exportButton = document.createElement("button");
  private readonly noteCreationButton = document.createElement("button");
  private readonly viewManagementButton = document.createElement("button");
  private readonly viewConfigurationButton = document.createElement("button");
  private readonly filtersButton = document.createElement("button");
  private readonly formulasLabelsButton = document.createElement("button");
  private readonly summaryAuthoringButton = document.createElement("button");
  private readonly groupOrderButton = document.createElement("button");
  private readonly tablePresentationButton = document.createElement("button");
  private noteCreationReady = false;
  private exportQuery: { request: BaseRequest; epoch: number; serial: number; version: string } | null = null;
  private exportEpoch = 0;
  private exportWorker: Worker | null = null;
  private exportTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, readonly provider: Bases) {
    super(leaf);
    this.slopsidianDraftProvider = "core:bases";
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
    this.exportButton.type = "button"; this.exportButton.textContent = "Export…"; this.exportButton.dataset.basesAction = "export"; this.exportButton.disabled = true;
    this.registerDomEvent(this.exportButton, "click", () => { this.openExport().catch(issue => this.setError(issue)); });
    this.noteCreationButton.type = "button"; this.noteCreationButton.textContent = "Create note…"; this.noteCreationButton.dataset.basesAction = "new-note"; this.noteCreationButton.disabled = true;
    this.registerDomEvent(this.noteCreationButton, "click", () => { try { this.openNoteCreation(); } catch (issue) { this.setError(issue); } });
    this.viewManagementButton.type = "button"; this.viewManagementButton.textContent = "Manage views…"; this.viewManagementButton.dataset.basesAction = "manage-views"; this.viewManagementButton.disabled = true;
    this.registerDomEvent(this.viewManagementButton, "click", () => { try { this.openViewManagement(); } catch (issue) { this.setError(issue); } });
    this.viewConfigurationButton.type = "button"; this.viewConfigurationButton.textContent = "Configure view…"; this.viewConfigurationButton.dataset.basesAction = "configure-view"; this.viewConfigurationButton.disabled = true;
    this.registerDomEvent(this.viewConfigurationButton, "click", () => { try { this.openViewConfiguration(); } catch (issue) { this.setError(issue); } });
    this.filtersButton.type = "button"; this.filtersButton.textContent = "Filters…"; this.filtersButton.dataset.basesAction = "filters"; this.filtersButton.disabled = true;
    this.registerDomEvent(this.filtersButton, "click", () => { try { this.openFilters(); } catch (issue) { this.setError(issue); } });
    this.formulasLabelsButton.type = "button"; this.formulasLabelsButton.textContent = "Formulas and labels…"; this.formulasLabelsButton.dataset.basesAction = "formulas-labels"; this.formulasLabelsButton.disabled = true;
    this.registerDomEvent(this.formulasLabelsButton, "click", () => { try { this.openFormulasLabels(); } catch (issue) { this.setError(issue); } });
    this.summaryAuthoringButton.type = "button"; this.summaryAuthoringButton.textContent = "Manage summaries…"; this.summaryAuthoringButton.dataset.basesAction = "manage-summaries"; this.summaryAuthoringButton.disabled = true;
    this.registerDomEvent(this.summaryAuthoringButton, "click", () => { try { this.openSummaryAuthoring(); } catch (issue) { this.setError(issue); } });
    this.groupOrderButton.type = "button"; this.groupOrderButton.textContent = "Group visibility/order…"; this.groupOrderButton.dataset.basesAction = "group-order"; this.groupOrderButton.disabled = true;
    this.registerDomEvent(this.groupOrderButton, "click", () => { try { this.openGroupOrder(); } catch (issue) { this.setError(issue); } });
    this.tablePresentationButton.type = "button"; this.tablePresentationButton.textContent = "Table presentation…"; this.tablePresentationButton.dataset.basesAction = "table-presentation"; this.tablePresentationButton.disabled = true;
    this.registerDomEvent(this.tablePresentationButton, "click", () => { try { this.openTablePresentation(); } catch (issue) { this.setError(issue); } });
    toolbar.append(viewLabel, groupLabel, this.searchInput,
      this.button("Edit base source", "source", () => this.sourceDialog()),
      this.button("Refresh", "refresh", () => this.refresh()),
      this.button("Reload from disk", "reload", async () => {
        if (!this.isDirty || window.confirm("Discard unsaved base changes and reload its current file?")) { await this.reload(true); }
      }), this.exportButton, this.noteCreationButton, this.viewManagementButton, this.viewConfigurationButton, this.filtersButton, this.formulasLabelsButton, this.summaryAuthoringButton, this.groupOrderButton, this.tablePresentationButton);
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
    this.registerDomEvent(this.grouping, "change", () => this.changeGrouping());
    this.registerEvent(this.app.metadataCache.on("finished", () => { this.schedule(); this.checkExternal(); }));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.schedule()));
    this.registerEvent(this.app.metadataTypeManager.on("changed", () => this.schedule()));
    const available = (): boolean => this.app.core.isEnabled("bases") && !this.app.core.busy && !this.app.changingVault;
    let wasAvailable = available();
    this.registerEvent(this.app.core.on("changed", () => {
      const next = available();
      if (!next) { this.retireExport(); }
      // Restored queries can finish before provider installation or vault readiness.
      if (next && !wasAvailable && this.leaf.view === this && this.file && this.app.vault.getFileByPath(this.file.path) === this.file) { this.schedule(); }
      wasAvailable = next;
    }));
    this.register(() => { this.stop(); this.modal?.close(); });
  }
  getViewType(): string { return "bases"; }
  override get isReadOnly(): boolean { return this.app.vault.readOnly; }
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
    this.viewManagementButton.disabled = true;
    this.viewConfigurationButton.disabled = true;
    this.filtersButton.disabled = true;
    this.formulasLabelsButton.disabled = true;
    this.summaryAuthoringButton.disabled = true;
    this.groupOrderButton.disabled = true;
    this.table.replaceChildren(); this.pagination.replaceChildren(); this.status.textContent = "";
    this.issues.hidden = true; this.issues.replaceChildren();
  }
  override focus(): void { this.table.focus({ preventScroll: true }); }
  override getState(): Record<string, unknown> { return { ...super.getState(), view: this.selected, search: this.search, page: this.page, groupFolds: this.groupFolds.serialize() }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    const groupFolds = state.groupFolds === undefined ? this.groupFolds.serialize() : readBaseGroupFoldState(state.groupFolds);
    if (state.view != null && typeof state.view !== "string" || state.search != null && (typeof state.search !== "string" || state.search.length > 1024)
      || state.page != null && (typeof state.page !== "number" || !Number.isSafeInteger(state.page) || state.page < 0)) { throw new Error("Invalid saved Bases view/search/page state."); }
    await super.setState(state, result);
    if (typeof state.view === "string") { this.selected = this.model?.view(state.view).name ?? state.view; }
    this.search = typeof state.search === "string" ? state.search : "";
    this.page = typeof state.page === "number" ? state.page : 0;
    this.groupFolds = new BaseGroupFolds(groupFolds);
    this.searchInput.value = this.search; this.populateControls(); this.refresh();
  }
  override async save(clear = false): Promise<void> {
    try { await super.save(clear); this.setError(""); }
    catch (error) { this.setError(error); throw error; }
  }
  private button(label: string, action: string, callback: () => unknown): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.dataset.basesAction = action;
    button.disabled = action === "source" && this.isReadOnly;
    if (button.disabled) { button.title = "This vault is read-only. Save a local copy to edit its base."; }
    this.registerDomEvent(button, "click", () => { Promise.resolve().then(callback).catch(error => this.setError(error)); });
    return button;
  }
  private setError(value: unknown): void {
    const message = value instanceof Error ? value.message : String(value);
    this.error.textContent = message; this.error.hidden = !message;
  }
  private populateControls(): void {
    this.views.replaceChildren(); this.grouping.replaceChildren(new Option("None", ""));
    this.viewManagementButton.disabled = this.isReadOnly || !this.model;
    this.viewConfigurationButton.disabled = this.isReadOnly || !this.model;
    this.filtersButton.disabled = this.isReadOnly || !this.model;
    this.formulasLabelsButton.disabled = this.isReadOnly || !this.model;
    this.summaryAuthoringButton.disabled = this.isReadOnly || !this.model;
    this.groupOrderButton.disabled = this.isReadOnly || !this.model;
    this.tablePresentationButton.disabled = this.isReadOnly || !this.model;
    if (!this.model) { this.views.disabled = true; this.grouping.disabled = true; return; }
    this.views.disabled = false;
    for (const view of this.model.views) { this.views.add(new Option(view.name + (!supportedBaseView(view.type) ? " (unsupported " + view.type + ")" : ""), view.name)); }
    this.views.value = this.selected;
    const view = this.model.view(this.selected);
    this.viewConfigurationButton.disabled = this.isReadOnly || !supportedBaseView(view.type);
    this.filtersButton.disabled = this.isReadOnly || !supportedBaseView(view.type);
    this.formulasLabelsButton.disabled = this.isReadOnly || !supportedBaseView(view.type);
    this.summaryAuthoringButton.disabled = this.isReadOnly || !supportedBaseView(view.type);
    this.groupOrderButton.disabled = this.isReadOnly || !supportedBaseView(view.type) || !view.groupBy;
    this.tablePresentationButton.disabled = this.isReadOnly || view.type !== "table";
    this.grouping.disabled = this.isReadOnly || !supportedBaseView(view.type);
    for (const key of [...new Set([...view.order, ...(view.groupBy ? [view.groupBy.property] : [])])]) { this.grouping.add(new Option(this.model.label(key), key)); }
    this.grouping.value = view.groupBy?.property ?? "";
  }
  private changeGrouping(): void {
    if (!this.model) { return; }
    try {
      this.assertEditable();
      this.commit(this.model.setView(this.selected, "groupBy", this.grouping.value ? { property: this.grouping.value, direction: "ASC" } : null));
    } catch (error) { this.populateControls(); this.setError(error); }
  }
  private stop(preservePendingRefresh = false): void {
    this.retireExport();
    this.serial++;
    this.cardCovers?.dispose(); this.cardCovers = null;
    if (!preservePendingRefresh && this.debounce !== null) { clearTimeout(this.debounce); this.debounce = null; }
    if (this.timeout !== null) { clearTimeout(this.timeout); this.timeout = null; }
    this.worker?.terminate(); this.worker = null;
  }
  private schedule(): void {
    if (!this.model || !this.file || !this.isLoaded) { return; }
    this.retireExport();
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
  private snapshot(): BaseFile[] { return baseQueryFiles(this.app); }
  private retireExport(): void {
    this.exportEpoch++; this.exportQuery = null; if (this.exportButton) { this.exportButton.disabled = true; }
    this.noteCreationReady = false; if (this.noteCreationButton) { this.noteCreationButton.disabled = true; }
    this.exportWorker?.terminate(); this.exportWorker = null;
    if (this.exportTimeout !== null) { clearTimeout(this.exportTimeout); this.exportTimeout = null; }
    if (this.modal instanceof BaseExportModal) { this.modal.close(); }
    if (this.modal instanceof BaseNoteCreationModal) { this.modal.invalidate(); }
  }
  private openNoteCreation(): void {
    this.app.vault.assertWritable("file-management");
    const snapshot = this.exportQuery, file = this.file, path = file?.path, root = this.app.vault.rootPath, model = this.model, text = this.text, selected = this.selected, search = this.search;
    const current = (ownedMutation: boolean): boolean => Boolean(snapshot && this.noteCreationReady && this.exportQuery === snapshot && this.exportEpoch === snapshot.epoch && this.serial === snapshot.serial
      && this.file === file && file && file.path === path && this.app.vault.getFileByPath(path!) === file && this.app.vault.rootPath === root && this.model === model && this.text === text
      && this.selected === selected && this.search === search && snapshot.request.text === text && snapshot.request.view === selected && snapshot.request.search === search
      && this.savedDocument?.version === snapshot.version && !this.app.vault.readOnly && !this.isSaving && this.isLoaded && this.leaf.view === this
      && this.containerEl.isConnected && this.containerEl.checkVisibility() && this.app.core.isEnabled("bases") && !this.app.core.busy && !this.app.changingVault
      && (ownedMutation || !this.app.workspace.isChangingFiles) && (!this.app.vault.lazy || this.app.vault.indexComplete));
    if (!current(false) || this.noteCreationButton.disabled) { throw new Error("Wait for a complete supported query before creating a note. Queries with warnings require source review."); }
    this.modal?.close();
    const suggestions = model!.view(selected).order.flatMap(key => { const property = baseProperty(key); return property.kind === "note" ? [property.name] : []; });
    const modal = new BaseNoteCreationModal(this.app, file!, suggestions, text.includes("\r\n") ? "\r\n" : "\n", {
      current: ownedMutation => this.modal === modal && current(ownedMutation), savedSource: () => this.savedDocument,
      refresh: async () => { await this.app.metadataCache.refresh(); if (this.file === file && this.leaf.view === this && this.isLoaded && this.app.vault.rootPath === root && !this.app.changingVault) { this.refresh(); } },
      closed: () => { if (this.modal === modal) { this.modal = null; } },
    });
    this.modal = modal; modal.open();
  }
  private openViewConfiguration(): void { this.openViewManagement(true); }
  private openFilters(): void { this.openViewManagement(false, true); }
  private openFormulasLabels(): void { this.openViewManagement(false, false, true); }
  private openSummaryAuthoring(): void { this.openViewManagement(false, false, false, true); }
  private openGroupOrder(): void { this.openViewManagement(false, false, false, false, true); }
  private openTablePresentation(): void { this.openViewManagement(false, false, false, false, false, true); }
  private openViewManagement(configuration = false, filters = false, formulasLabels = false, summaries = false, groupOrder = false, tablePresentation = false): void {
    this.assertEditable();
    if (!this.model || !this.savedDocument || this.isDirty || this.isSaving || this.checkingExternal || this.app.core.busy) {
      throw new Error("Wait for the current saved base, or save or reload its unsaved source before managing or configuring views.");
    }
    const file = this.file!, path = file.path, root = this.app.vault.rootPath, text = this.text, model = this.model, selected = this.selected, saved = this.savedDocument;
    const current = (): boolean => Boolean(this.file === file && file.path === path && this.app.vault.getFileByPath(path) === file && this.app.vault.rootPath === root
      && this.model === model && this.text === text && this.selected === selected && this.savedDocument?.version === saved.version && this.savedDocument?.content === saved.content
      && Boolean(this.savedDocument?.hasBom) === Boolean(saved.hasBom) && !this.isDirty && !this.isSaving && !this.isReadOnly && this.isLoaded && this.leaf.view === this
      && this.containerEl.isConnected && this.containerEl.checkVisibility() && this.app.core.isEnabled("bases") && !this.app.core.busy && !this.app.changingVault && !this.app.workspace.isChangingFiles);
    if (!current()) { throw new Error("This base or view owner changed. Reopen its current named view."); }
    if (configuration && !supportedBaseView(model.view(selected).type)) { throw new Error("Visual configuration supports Table, List and Cards. This imported view is kept; edit its source explicitly."); }
    if (filters && !supportedBaseView(model.view(selected).type)) { throw new Error("Visual filters support Table, List and Cards. This imported view is kept; edit its source explicitly."); }
    if (formulasLabels && !supportedBaseView(model.view(selected).type)) { throw new Error("Formula and label authoring supports Table, List and Cards. This imported view is kept; edit its source explicitly."); }
    if (summaries && !supportedBaseView(model.view(selected).type)) { throw new Error("Summary authoring supports Table, List and Cards. This imported view is kept; edit its source explicitly."); }
    if (groupOrder && (!supportedBaseView(model.view(selected).type) || !model.view(selected).groupBy)) { throw new Error("Group visibility/order needs a saved Table, List or Cards view with a grouping property. Choose Group by first."); }
    if (tablePresentation && model.view(selected).type !== "table") { throw new Error("Table presentation supports a saved Table view. The current view is kept."); }
    this.modal?.close();
    const authority: BaseViewManagementAuthority & { closed(): void } = {
      current: () => this.modal === modal && current(), savedSource: () => this.savedDocument,
      save: async plan => { if (this.modal !== modal || !current()) { throw new Error("The base or review owner changed before saving."); } this.commitSource(plan.source, plan.selected); await this.save(); this.app.workspace.layoutChanged(); },
      closed: () => { if (this.modal === modal) { this.modal = null; } },
    };
    const suggestions = configuration || filters || formulasLabels ? [...model.view(selected).order, ...model.view(selected).sort.map(item => item.property), ...Object.keys(this.app.metadataCache.getAllPropertyInfos()).map(name => "note." + name), ...[...model.formulas.keys(), ...model.formulaErrors.keys()].map(name => "formula." + name), "file.name", "file.path", "file.folder", "file.ext", "file.size", "file.mtime"] : [];
    const modal: Modal = tablePresentation ? new BaseTablePresentationModal(this.app, file, text, selected, authority) : groupOrder ? new BaseGroupOrderModal(this.app, file, text, selected, authority, this.snapshot()) : summaries ? new BaseSummaryAuthoringModal(this.app, file, text, selected, authority) : formulasLabels ? new BaseFormulasLabelsModal(this.app, file, text, selected, authority, suggestions) : filters ? new BaseFiltersModal(this.app, file, text, selected, authority, suggestions) : configuration ? new BaseViewConfigurationModal(this.app, file, text, selected, authority, suggestions) : new BaseViewManagementModal(this.app, file, text, selected, authority);
    this.modal = modal; modal.open();
  }
  private async openExport(): Promise<void> {
    const snapshot = this.exportQuery, file = this.file, path = file?.path, root = this.app.vault.rootPath, model = this.model, text = this.text, selected = this.selected, search = this.search;
    const current = (): boolean => Boolean(snapshot && this.exportQuery === snapshot && this.exportEpoch === snapshot.epoch && this.serial === snapshot.serial
      && this.file === file && file && file.path === path && this.app.vault.getFileByPath(path!) === file && this.app.vault.rootPath === root && this.model === model && this.text === text
      && this.selected === selected && this.search === search && snapshot.request.search === search && snapshot.request.view === selected && snapshot.request.text === text
      && this.savedDocument?.version === snapshot.version && this.isLoaded && !this.isSaving && this.leaf.view === this && this.containerEl.isConnected && this.containerEl.checkVisibility()
      && this.app.core.isEnabled("bases") && !this.app.core.busy && !this.app.changingVault && (!this.app.vault.lazy || this.app.vault.indexComplete));
    if (!current() || this.exportButton.disabled) { throw new Error("Wait for a complete current query and metadata index before exporting."); }
    this.modal?.close();
    const check = async (): Promise<void> => {
      if (!current()) { throw new Error("The base, query, provider or vault changed. Open its current export again."); }
      const info = await this.app.vault.getFileInfo(file!);
      if (!current() || info.root !== root || info.file.path !== file!.path || info.version !== snapshot!.version) { throw new Error("The saved base changed. Refresh it before exporting its current query."); }
    };
    const modal = new BaseExportModal(this.app, { title: selected, current: () => current() && this.modal === modal,
      check, closed: () => { if (this.modal === modal) { this.modal = null; } this.exportWorker?.terminate(); this.exportWorker = null; if (this.exportTimeout !== null) { clearTimeout(this.exportTimeout); this.exportTimeout = null; } } });
    this.modal = modal; modal.open();
    try {
      await check(); if (!current() || this.modal !== modal || !modal.isOpen) { return; }
      const worker = new Worker(new URL("js/bases-worker.js", document.baseURI), { type: "module" }); this.exportWorker = worker;
      this.exportTimeout = setTimeout(() => { if (this.exportWorker !== worker) { return; } worker.terminate(); this.exportWorker = null; this.exportTimeout = null; modal.fail(new Error("Export exceeded its three-second worker deadline. Narrow the query; no partial export was produced.")); }, 3000);
      const finished = (): boolean => {
        if (this.exportWorker !== worker) { return false; } worker.terminate(); this.exportWorker = null;
        if (this.exportTimeout !== null) { clearTimeout(this.exportTimeout); this.exportTimeout = null; }
        return current() && this.modal === modal && modal.isOpen;
      };
      worker.addEventListener("message", async (event: MessageEvent<BaseResponse>) => {
        if (event.data.serial !== snapshot!.serial || !finished()) { return; }
        try { if ("error" in event.data) { modal.fail(event.data.error); } else { await check(); modal.setResult(event.data.result); } } catch (error) { modal.fail(error); }
      });
      worker.addEventListener("error", event => { if (finished()) { modal.fail("Export worker failed: " + event.message); } });
      worker.postMessage({ ...snapshot!.request, export: true, serial: snapshot!.serial } satisfies BaseRequest);
    } catch (error) { modal.fail(error); }
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
      const epoch = this.exportEpoch;
      const request: BaseRequest = { text: this.text, files, context, view: this.selected, search: this.search, page: this.page, serial, now: Date.now() };
      const worker = new Worker(new URL("js/bases-worker.js", document.baseURI), { type: "module" });
      this.worker = worker;
      this.timeout = setTimeout(() => { if (this.serial === serial) { this.stop(true); this.table.replaceChildren(); this.setError("The base query exceeded its three-second worker deadline. Its source was preserved."); this.status.textContent = "Query stopped"; } }, 3000);
      worker.addEventListener("message", (event: MessageEvent<BaseResponse>) => {
        if (event.data.serial !== this.serial || worker !== this.worker) { return; }
        // An older result must not cancel a search/metadata refresh queued while it ran.
        this.stop(true);
        if ("error" in event.data) { this.table.replaceChildren(); this.pagination.replaceChildren(); this.setError(event.data.error); this.status.textContent = "Query unavailable"; return; }
        this.setError(""); this.render(event.data.result); this.contentEl.dataset.basesComplete = "true";
        if (this.exportEpoch === epoch + 1 && this.debounce === null && this.savedDocument?.version && request.text === this.text && request.search === this.search && request.view === this.selected
          && !event.data.result.errors.length && this.isLoaded && this.leaf.view === this && this.app.core.isEnabled("bases") && !this.app.core.busy && !this.app.changingVault && (!this.app.vault.lazy || this.app.vault.indexComplete)) {
          this.exportQuery = { request, epoch: this.exportEpoch, serial: this.serial, version: this.savedDocument.version }; this.exportButton.disabled = false;
          this.noteCreationReady = supportedBaseView(model.view(this.selected).type) && !event.data.result.warnings.length;
          this.noteCreationButton.disabled = this.isReadOnly || !this.noteCreationReady;
          this.noteCreationButton.title = this.isReadOnly ? "This vault is read-only." : !this.noteCreationReady ? "Creation needs a complete supported query without warnings." : "Review a new Markdown note and its explicit initial properties.";
        }
      });
      worker.addEventListener("error", event => { if (worker === this.worker) { this.stop(true); this.table.replaceChildren(); this.pagination.replaceChildren(); this.setError("Base query worker failed: " + event.message); this.status.textContent = "Query unavailable"; } });
      worker.postMessage(request);
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
    this.table.dataset.basesLayout = this.model?.view(this.selected).type ?? "";
    this.table.dataset.basesRenderSerial = String(this.serial);
    if (this.model?.view(this.selected).type === "list") {
      this.renderList(result, summarized); this.renderPagination(result); return;
    }
    if (this.model?.view(this.selected).type === "cards") {
      this.renderCards(result, summarized); this.renderPagination(result); return;
    }
    const table = document.createElement("table"); table.className = "bases-table";
    const tableOptions = this.model?.view(this.selected).table;
    if (tableOptions) { styleBaseTable(table, tableOptions, result.columns.map(column => column.key)); }
    const head = document.createElement("thead"), header = document.createElement("tr");
    for (const column of result.columns) {
      const cell = document.createElement("th"); cell.scope = "col";
      const sort = this.model?.view(this.selected).sort.find(item => item.property === column.key);
      const button = document.createElement("button"); button.type = "button";
      button.textContent = column.label + (sort ? sort.direction === "ASC" ? " ↑" : " ↓" : "");
      button.dataset.basesSort = column.key; button.title = "Sort by " + column.label;
      button.disabled = this.isReadOnly;
      button.addEventListener("click", () => {
        try { if (this.model) { this.assertEditable(); this.commit(this.model.setView(this.selected, "sort", [{ property: column.key, direction: sort?.direction === "ASC" ? "DESC" : "ASC" }])); } }
        catch (error) { this.setError(error); }
      });
      const summarize = document.createElement("button"); summarize.type = "button"; summarize.textContent = "Σ"; summarize.className = "bases-summary-action";
      summarize.dataset.basesSummarize = column.key; summarize.setAttribute("aria-label", "Summarize " + column.label); summarize.title = "Summarize " + column.label;
      summarize.disabled = this.isReadOnly;
      summarize.addEventListener("click", () => { try { this.summaryDialog(column); } catch (error) { this.setError(error); } });
      cell.append(button, summarize); header.append(cell);
    }
    head.append(header);
    const body = document.createElement("tbody");
    const renderSerial = this.serial, file = this.file, path = file?.path, root = this.app.vault.rootPath, selected = this.selected;
    const current = (): boolean => this.serial === renderSerial && this.file === file && this.file?.path === path && this.selected === selected
      && this.app.vault.rootPath === root && this.isLoaded && this.leaf.view === this && this.app.core.isEnabled("bases") && !this.app.core.busy && !this.app.changingVault;
    const scope: BaseGroupScope | null = path && result.groupProperty ? { file: path, view: selected, property: result.groupProperty } : null;
    const groupUpdates = new Map<string, ((collapsed: boolean) => void)[]>(), rowIdPrefix = "bases-group-row-" + (++groupRenderId) + "-";
    let groupRows: HTMLTableRowElement[] = [], groupCollapsed = false, groupButton: HTMLButtonElement | null = null;
    let group: string | null = null;
    for (const [rowIndex, row] of baseGroupRenderRows(result).entries()) {
      if (row.groupKey && row.groupKey !== group) {
        group = row.groupKey;
        const heading = document.createElement("tr"); heading.className = "bases-group";
        const cell = document.createElement("th"); cell.scope = "rowgroup"; cell.colSpan = result.columns.length;
        const info = result.groups.find(group => group.key === row.groupKey);
        cell.dataset.basesGroupLabel = row.group;
        groupRows = []; const ownedRows = groupRows;
        const identity = info?.identity ?? null;
        groupCollapsed = Boolean(scope && identity && this.groupFolds.has(scope, identity));
        const button = document.createElement("button"); button.type = "button"; button.className = "bases-group-toggle";
        button.dataset.basesGroupFold = info?.key ?? row.groupKey;
        button.disabled = !scope || !identity;
        button.title = button.disabled ? "This group value is too large to retain a fold preference." : "Group rows only; summaries remain visible.";
        const indicator = document.createElement("span"); indicator.setAttribute("aria-hidden", "true");
        const label = document.createElement("span"); label.textContent = row.group + " · " + (info?.count ?? 0);
        button.append(indicator, label); cell.append(button); groupButton = button;
        const update = (collapsed: boolean): void => {
          indicator.textContent = collapsed ? "▸" : "▾"; button.setAttribute("aria-expanded", String(!collapsed));
          button.setAttribute("aria-label", (collapsed ? "Expand" : "Collapse") + " group " + row.group + ", " + (info?.count ?? 0) + " rows");
          for (const line of ownedRows) { line.hidden = collapsed; }
        };
        if (identity) { const updates = groupUpdates.get(identity) ?? []; updates.push(update); groupUpdates.set(identity, updates); }
        update(groupCollapsed);
        button.addEventListener("click", () => {
          if (!scope || !identity || !button.isConnected || !this.table.contains(button) || !current()) { return; }
          try {
            const collapsed = this.groupFolds.toggle(scope, identity);
            for (const update of groupUpdates.get(identity) ?? []) { update(collapsed); }
            this.app.workspace.layoutChanged();
          }
          catch (error) { this.setError(error); }
        });
        heading.append(cell); body.append(heading);
        if (summarized && info?.summaries) { body.append(this.summaryRow(result.columns, info.summaries, info.key, row.group)); }
      }
      if (row.emptyGroup) { continue; }
      const line = document.createElement("tr"); line.dataset.basesRow = row.path;
      if (row.groupKey) {
        line.id = rowIdPrefix + rowIndex;
        line.hidden = groupCollapsed; groupRows.push(line);
        groupButton?.setAttribute("aria-controls", groupRows.map(row => row.id).join(" "));
      }
      for (const [index, value] of row.cells.entries()) {
        const column = result.columns[index], cell = document.createElement("td"); cell.dataset.basesCell = column.key;
        const content = baseTableValueContainer(cell);
        if (value.error) { content.textContent = "#ERROR"; cell.title = value.error; cell.className = "bases-cell-error"; }
        else if (value.link) {
          const button = document.createElement("button"); button.type = "button"; button.className = "bases-file-link"; button.textContent = value.text || value.link;
          button.dataset.basesLink = value.link;
          button.addEventListener("click", () => { this.openTarget(value.link!).catch(error => this.setError(error)); });
          content.append(button);
        } else if (baseProperty(column.key).kind === "note" && /\.md$/i.test(row.path)) {
          const button = document.createElement("button"); button.type = "button"; button.className = "bases-cell-edit";
          button.textContent = value.text || "—"; button.setAttribute("aria-label", "Edit " + column.label + " in " + row.path);
          button.disabled = this.isReadOnly;
          button.addEventListener("click", () => { try { this.editProperty(row.path, baseProperty(column.key).name); } catch (error) { this.setError(error); } });
          content.append(button);
        } else { content.textContent = value.text || "—"; }
        line.append(cell);
      }
      body.append(line);
    }
    if (!result.rows.length) { const row = document.createElement("tr"), cell = document.createElement("td"); cell.colSpan = result.columns.length; cell.textContent = "No files match this view."; row.append(cell); body.append(row); }
    table.append(head, body);
    if (summarized) { const foot = document.createElement("tfoot"); foot.append(this.summaryRow(result.columns, result.summaries, "all", "All rows")); table.append(foot); }
    this.table.append(table);
    this.renderPagination(result);
  }
  private renderOwner(): () => boolean {
    const serial = this.serial, file = this.file, path = file?.path, root = this.app.vault.rootPath, selected = this.selected;
    return () => this.serial === serial && this.file === file && this.file?.path === path && this.selected === selected
      && this.app.vault.rootPath === root && this.isLoaded && this.leaf.view === this && this.app.core.isEnabled("bases") && !this.app.core.busy && !this.app.changingVault;
  }
  private renderPagination(result: BaseResult): void {
    const previous = document.createElement("button"), next = document.createElement("button"), current = this.renderOwner();
    previous.textContent = "Previous page"; next.textContent = "Next page";
    previous.dataset.basesAction = "previous-page"; next.dataset.basesAction = "next-page";
    previous.disabled = this.page === 0; next.disabled = this.page >= result.pages - 1;
    previous.addEventListener("click", () => { if (!previous.disabled && previous.isConnected && this.pagination.contains(previous) && current()) { this.page = result.page - 1; this.refresh(); this.app.workspace.layoutChanged(); } });
    next.addEventListener("click", () => { if (!next.disabled && next.isConnected && this.pagination.contains(next) && current()) { this.page = result.page + 1; this.refresh(); this.app.workspace.layoutChanged(); } });
    this.pagination.append(previous, next);
  }
  private renderList(result: BaseResult, summarized: boolean): void {
    const current = this.renderOwner(), selected = this.selected, file = this.file, options = this.model!.view(selected).list!;
    const active = (button: HTMLButtonElement): boolean => button.isConnected && this.table.contains(button) && current();
    this.renderPropertyControls(result, "List");
    const scope: BaseGroupScope | null = file && result.groupProperty ? { file: file.path, view: selected, property: result.groupProperty } : null;
    const prefix = "bases-list-group-row-" + (++groupRenderId) + "-";
    const groupUpdates = new Map<string, ((folded: boolean) => void)[]>();
    let group: string | null = null, list: HTMLUListElement | HTMLOListElement | null = null, collapsed = false, groupButton: HTMLButtonElement | null = null, groupRows: HTMLLIElement[] = [], displayed = 0;
    for (const [rowIndex, row] of baseGroupRenderRows(result).entries()) {
      if (!row.emptyGroup && !baseListRowVisible(row.cells, options)) { continue; }
      if (!row.emptyGroup) { displayed++; }
      if (!list || row.groupKey !== group) {
        group = row.groupKey; collapsed = false; groupButton = null; groupRows = [];
        const section = document.createElement("section"); section.className = "bases-list-group";
        if (row.groupKey) {
          const info = result.groups.find(value => value.key === row.groupKey), identity = info?.identity ?? null, ownedRows = groupRows;
          collapsed = Boolean(scope && identity && this.groupFolds.has(scope, identity));
          const heading = document.createElement("h3"); heading.className = "bases-group"; heading.dataset.basesGroupLabel = row.group;
          const button = document.createElement("button"); button.type = "button"; button.className = "bases-group-toggle"; button.dataset.basesGroupFold = row.groupKey; button.disabled = !scope || !identity;
          button.title = button.disabled ? "This group value is too large to retain a fold preference." : "Group rows only; summaries remain visible.";
          const indicator = document.createElement("span"); indicator.setAttribute("aria-hidden", "true");
          const label = document.createElement("span"); label.textContent = row.group + " · " + (info?.count ?? 0); button.append(indicator, label); heading.append(button); section.append(heading); groupButton = button;
          const update = (folded: boolean): void => {
            indicator.textContent = folded ? "▸" : "▾"; button.setAttribute("aria-expanded", String(!folded));
            button.setAttribute("aria-label", (folded ? "Expand" : "Collapse") + " group " + row.group + ", " + (info?.count ?? 0) + " rows");
            for (const item of ownedRows) { item.hidden = folded; }
          };
          if (identity) { const updates = groupUpdates.get(identity) ?? []; updates.push(update); groupUpdates.set(identity, updates); }
          update(collapsed);
          button.addEventListener("click", () => {
            if (!scope || !identity || !active(button)) { return; }
            try { const folded = this.groupFolds.toggle(scope, identity); for (const update of groupUpdates.get(identity) ?? []) { update(folded); } this.app.workspace.layoutChanged(); }
            catch (error) { this.setError(error); }
          });
          if (summarized && info?.summaries) { section.append(this.listSummaries(result.columns, info.summaries, info.key, row.group, current)); }
        }
        list = document.createElement(options.markers === "number" ? "ol" : "ul"); list.className = "bases-list"; list.dataset.basesList = ""; list.dataset.basesMarkers = options.markers; list.setAttribute("aria-label", row.groupKey ? row.group + " files" : "Base files"); section.append(list); this.table.append(section);
      }
      if (row.emptyGroup) { continue; }
      const item = document.createElement("li"); item.className = "bases-list-entry"; item.dataset.basesRow = row.path;
      if (options.markers === "number") { item.value = row.listNumber ?? rowIndex + 1; }
      if (row.groupKey) { item.id = prefix + rowIndex; item.hidden = collapsed; groupRows.push(item); groupButton?.setAttribute("aria-controls", groupRows.map(line => line.id).join(" ")); }
      const nested = options.indentProperties ? document.createElement("ul") : null; if (nested) { nested.className = "bases-list-nested"; }
      let primary = true;
      for (const [index, value] of row.cells.entries()) {
        if (!baseListCellVisible(value)) { continue; }
        if (!primary && !nested) { const separator = document.createElement("span"); separator.className = "bases-list-separator"; separator.textContent = options.separator; separator.setAttribute("aria-hidden", "true"); item.append(separator); }
        const column = result.columns[index], cell = document.createElement(nested && !primary ? "li" : "span"); cell.className = "bases-list-value" + (primary ? " bases-list-primary" : ""); cell.dataset.basesCell = column.key; cell.setAttribute("aria-label", column.label);
        this.listValue(cell, column, row.path, value, active); if (nested && !primary) { nested.append(cell); } else { item.append(cell); } primary = false;
      }
      if (nested?.childElementCount) { item.append(nested); }
      list.append(item);
    }
    if (!displayed) { const empty = document.createElement("p"); empty.className = "bases-list-empty"; empty.textContent = result.rows.length ? "No list items have displayable properties on this page." : "No files match this view."; this.table.append(empty); }
    if (displayed < result.rows.length) { this.status.textContent += ` · ${result.rows.length - displayed} rows without displayable list properties on this page`; }
    if (summarized) { this.table.append(this.listSummaries(result.columns, result.summaries, "all", "All rows", current)); }
  }
  private renderPropertyControls(result: BaseResult, layout: "List" | "Cards"): void {
    const current = this.renderOwner(), selected = this.selected;
    const active = (button: HTMLButtonElement): boolean => button.isConnected && this.table.contains(button) && current();
    const controls = document.createElement("div"); controls.className = "bases-list-properties"; controls.setAttribute("role", "group"); controls.setAttribute("aria-label", "List property actions");
    controls.classList.add("bases-" + layout.toLowerCase() + "-properties"); controls.setAttribute("aria-label", layout + " property actions");
    const settings = document.createElement("button"); settings.type = "button"; settings.textContent = layout + " settings"; settings.dataset.basesAction = layout.toLowerCase() + "-settings"; settings.disabled = this.isReadOnly;
    settings.addEventListener("click", () => { if (active(settings)) { try { if (layout === "Cards") { this.cardsSettingsDialog(); } else { this.listSettingsDialog(); } } catch (error) { this.setError(error); } } }); controls.append(settings);
    for (const column of result.columns) {
      const property = document.createElement("span"); property.className = "bases-list-property-actions";
      const sort = this.model?.view(selected).sort.find(item => item.property === column.key);
      const button = document.createElement("button"); button.type = "button";
      button.textContent = column.label + (sort ? sort.direction === "ASC" ? " ↑" : " ↓" : "");
      button.dataset.basesSort = column.key; button.setAttribute("aria-label", "Sort by " + column.label); button.title = "Sort by " + column.label; button.disabled = this.isReadOnly;
      button.addEventListener("click", () => {
        if (!active(button)) { return; }
        try { if (this.model) { this.assertEditable(); this.commit(this.model.setView(selected, "sort", [{ property: column.key, direction: sort?.direction === "ASC" ? "DESC" : "ASC" }])); } }
        catch (error) { this.setError(error); }
      });
      const summarize = document.createElement("button"); summarize.type = "button"; summarize.textContent = "Σ"; summarize.className = "bases-summary-action"; summarize.dataset.basesSummarize = column.key;
      summarize.setAttribute("aria-label", "Summarize " + column.label); summarize.title = "Summarize " + column.label; summarize.disabled = this.isReadOnly;
      summarize.addEventListener("click", () => { if (active(summarize)) { try { this.summaryDialog(column); } catch (error) { this.setError(error); } } });
      property.append(button, summarize); controls.append(property);
    }
    this.table.append(controls);
  }
  private renderCards(result: BaseResult, summarized: boolean): void {
    this.cardCovers?.dispose();
    const current = this.renderOwner(), selected = this.selected, file = this.file, path = file?.path, options = this.model!.view(selected).cards!, serial = this.serial, root = this.app.vault.rootPath;
    const coverCurrent = (): boolean => this.serial === serial && this.file === file && this.file?.path === path && this.selected === selected && this.app.vault.rootPath === root && this.isLoaded && this.leaf.view === this && this.app.core.isEnabled("bases") && !this.app.changingVault;
    const active = (node: HTMLElement): boolean => node.isConnected && this.table.contains(node) && current();
    const coverActive = (node: HTMLElement): boolean => node.isConnected && this.table.contains(node) && coverCurrent();
    const resolve = createLinkResolver(this.app.vault.getFiles());
    const lease = this.cardCovers = new BaseCardCoverLease(async entry => {
      const image = this.app.vault.getFileByPath(entry.path);
      if (!image || image.stat.size !== entry.stat.size || image.stat.mtime !== entry.stat.mtime) { throw new Error("The cover image changed. Refresh this base."); }
      const imageCurrent = (): boolean => coverCurrent() && image.path === entry.path && this.app.vault.getFileByPath(entry.path) === image && image.stat.size === entry.stat.size && image.stat.mtime === entry.stat.mtime;
      return readBaseCardImage(entry, root ?? "", () => this.app.vault.getFileInfo(image),
        () => requestJson<BaseCardBinaryImage>(`/api/binary?path=${encodeURIComponent(entry.path)}&root=${encodeURIComponent(root ?? "")}`), imageCurrent);
    }, coverCurrent);
    this.renderPropertyControls(result, "Cards");
    const scope: BaseGroupScope | null = file && result.groupProperty ? { file: file.path, view: selected, property: result.groupProperty } : null;
    const prefix = "bases-card-group-row-" + (++groupRenderId) + "-", updates = new Map<string, ((folded: boolean) => void)[]>();
    let group: string | null = null, grid: HTMLElement | null = null, collapsed = false, groupButton: HTMLButtonElement | null = null, members: HTMLElement[] = [];
    for (const [rowIndex, row] of baseGroupRenderRows(result).entries()) {
      if (!grid || row.groupKey !== group) {
        group = row.groupKey; collapsed = false; groupButton = null; members = [];
        const section = document.createElement("section"); section.className = "bases-cards-group";
        if (row.groupKey) {
          const info = result.groups.find(value => value.key === row.groupKey), identity = info?.identity ?? null, owned = members;
          collapsed = Boolean(scope && identity && this.groupFolds.has(scope, identity));
          const heading = document.createElement("h3"); heading.className = "bases-group"; heading.dataset.basesGroupLabel = row.group;
          const button = document.createElement("button"); button.type = "button"; button.className = "bases-group-toggle"; button.dataset.basesGroupFold = row.groupKey; button.disabled = !scope || !identity;
          button.title = button.disabled ? "This group value is too large to retain a fold preference." : "Group cards only; summaries remain visible.";
          const indicator = document.createElement("span"), label = document.createElement("span"); indicator.setAttribute("aria-hidden", "true"); label.textContent = row.group + " · " + (info?.count ?? 0); button.append(indicator, label); heading.append(button); section.append(heading); groupButton = button;
          const update = (folded: boolean): void => {
            indicator.textContent = folded ? "▸" : "▾"; button.setAttribute("aria-expanded", String(!folded));
            button.setAttribute("aria-label", (folded ? "Expand" : "Collapse") + " group " + row.group + ", " + (info?.count ?? 0) + " rows");
            for (const item of owned) { item.hidden = folded; }
          };
          if (identity) { const handlers = updates.get(identity) ?? []; handlers.push(update); updates.set(identity, handlers); } update(collapsed);
          button.addEventListener("click", () => {
            if (!scope || !identity || !active(button)) { return; }
            try { const folded = this.groupFolds.toggle(scope, identity); for (const update of updates.get(identity) ?? []) { update(folded); } this.app.workspace.layoutChanged(); }
            catch (error) { this.setError(error); }
          });
          if (summarized && info?.summaries) { section.append(this.listSummaries(result.columns, info.summaries, info.key, row.group, current)); }
        }
        grid = document.createElement("div"); grid.className = "bases-cards-grid"; grid.dataset.basesCards = ""; grid.style.setProperty("--bases-card-size", options.cardSize + "px"); grid.setAttribute("role", "list"); grid.setAttribute("aria-label", row.groupKey ? row.group + " files" : "Base files"); section.append(grid); this.table.append(section);
      }
      if (row.emptyGroup) { continue; }
      const card = document.createElement("article"); card.className = "bases-card"; card.dataset.basesRow = row.path; card.dataset.basesCard = ""; card.tabIndex = 0; card.setAttribute("role", "listitem"); card.setAttribute("aria-label", row.path + "; press Enter to open file");
      if (row.groupKey) { card.id = prefix + rowIndex; card.hidden = collapsed; members.push(card); groupButton?.setAttribute("aria-controls", members.map(item => item.id).join(" ")); }
      if (options.image) {
        const cover = document.createElement("div"); cover.className = "bases-card-cover"; cover.dataset.basesCardCover = ""; cover.style.aspectRatio = String(1 / options.imageAspectRatio); cover.setAttribute("aria-label", "Cover for " + row.path); card.append(cover);
        const fail = (message: string): void => { if (!coverActive(cover)) { return; } cover.dataset.basesCardCoverStatus = "error"; cover.textContent = "Cover unavailable"; cover.title = message; };
        const value: BaseCardCover | null = row.cover ?? null;
        if (!value) { cover.dataset.basesCardCoverStatus = "empty"; cover.textContent = "No cover"; }
        else if (value.kind === "color") { cover.dataset.basesCardCoverStatus = "color"; cover.style.backgroundColor = value.color; }
        else if (value.kind === "error") { cover.dataset.basesCardCoverStatus = "error"; cover.textContent = "Cover unavailable"; cover.title = value.message; }
        else {
          cover.dataset.basesCardCoverStatus = "loading"; cover.textContent = "Loading cover…";
          const destination = this.app.vault.getFileByPath(value.path) ?? resolve(value.path, row.path)?.file;
          if (!destination) { cover.dataset.basesCardCoverStatus = "error"; cover.textContent = "Cover unavailable"; cover.title = "The cover image was not found in this vault: " + value.path; }
          else {
            cover.dataset.basesCardCoverFile = destination.path;
            lease.load(destination).then(url => {
              if (!url || !coverActive(cover)) { return; }
              const image = document.createElement("img"); image.alt = ""; image.style.objectFit = options.imageFit === "contain" ? "contain" : "cover";
              image.addEventListener("load", () => { if (coverActive(cover)) { cover.dataset.basesCardCoverStatus = "ready"; } });
              image.addEventListener("error", () => fail("This host could not decode the cover image: " + destination.path)); image.src = url; cover.replaceChildren(image);
            }).catch(issue => fail(issue instanceof Error ? issue.message : String(issue)));
          }
        }
      }
      const properties = document.createElement("dl"); properties.className = "bases-card-properties";
      for (const [index, value] of row.cells.entries()) {
        const column = result.columns[index], pair = document.createElement("div"), label = document.createElement("dt"), cell = document.createElement("dd");
        pair.className = "bases-card-property" + (index === 0 ? " bases-card-title" : ""); label.textContent = column.label; cell.dataset.basesCell = column.key; cell.setAttribute("aria-label", column.label);
        this.listValue(cell, column, row.path, value, active); pair.append(label, cell); properties.append(pair);
      }
      const open = document.createElement("button"); open.type = "button"; open.className = "bases-card-open"; open.textContent = "Open file"; open.dataset.basesCardOpen = row.path; open.setAttribute("aria-label", "Open " + row.path);
      const navigate = (): void => { if (active(card)) { this.openTarget(row.path).catch(issue => this.setError(issue)); } }; open.addEventListener("click", navigate);
      card.addEventListener("click", event => {
        if (!active(card) || event.defaultPrevented || (event.target as Element).closest("button,a,input,textarea,select")) { return; }
        if (window.getSelection()?.toString()) { return; } navigate();
      });
      card.addEventListener("keydown", event => { if (event.target === card && event.key === "Enter") { event.preventDefault(); navigate(); } });
      card.append(properties, open); grid.append(card);
    }
    if (!result.rows.length) { const empty = document.createElement("p"); empty.textContent = "No files match this view."; this.table.append(empty); }
    if (summarized) { this.table.append(this.listSummaries(result.columns, result.summaries, "all", "All rows", current)); }
  }
  private cardsSettingsDialog(): void {
    this.assertEditable();
    const model = this.model, selected = this.selected, file = this.file, root = this.app.vault.rootPath, original = this.text, options = model?.view(selected).cards;
    if (!model || !options) { throw new Error("Choose a Cards view to change its presentation."); }
    const modal = this.dialog("Cards settings"), form = document.createElement("form"), sizeLabel = document.createElement("label"), size = document.createElement("input"), imageLabel = document.createElement("label"), image = document.createElement("select"), fitLabel = document.createElement("label"), fit = document.createElement("select"), ratioLabel = document.createElement("label"), ratio = document.createElement("input");
    size.type = "number"; size.min = "50"; size.max = "800"; size.step = "any"; size.value = String(options.cardSize); size.dataset.basesCardsSize = ""; sizeLabel.append("Card size (50–800 px)", size);
    image.dataset.basesCardsImage = ""; image.add(new Option("None", "")); image.add(new Option("File itself", "file.file"));
    const keys = new Set([...model.view(selected).order.filter(key => baseProperty(key).kind !== "file"), ...Object.values(this.app.metadataTypeManager.getAllProperties()).slice(0, 256).map(property => "note." + property.name), ...[...model.formulas.keys()].map(key => "formula." + key)]);
    if (options.image && options.image !== "file.file") { keys.add(options.image); }
    for (const key of keys) { image.add(new Option(model.label(key), key)); } image.value = options.image; imageLabel.append("Image property", image);
    fit.dataset.basesCardsFit = ""; fit.add(new Option("Cover", "")); fit.add(new Option("Contain", "contain")); fit.value = options.imageFit; fitLabel.append("Image fit", fit);
    ratio.type = "number"; ratio.min = "0.25"; ratio.max = "2.5"; ratio.step = "any"; ratio.value = String(options.imageAspectRatio); ratio.dataset.basesCardsRatio = ""; ratioLabel.append("Image height / width (0.25–2.5)", ratio);
    const update = (): void => { fitLabel.hidden = ratioLabel.hidden = !image.value; }; image.addEventListener("change", update); update();
    const hint = document.createElement("p"); hint.textContent = "Covers use the first list value: a PNG, JPEG, GIF, WebP or AVIF file in this vault, a link, or a #RRGGBB color. Images support 4 MiB each and 16 MiB per page.";
    const error = document.createElement("p"); error.className = "plugin-error"; error.dataset.basesDialogError = ""; error.setAttribute("role", "alert");
    const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "Apply cards settings"; apply.dataset.basesAction = "apply-cards-settings";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.basesAction = "cancel-cards-settings"; cancel.addEventListener("click", () => modal.close());
    form.addEventListener("submit", event => {
      event.preventDefault(); form.inert = true;
      this.app.core.run(async () => {
        this.assertEditable();
        if (this.modal !== modal || !modal.containerEl.isConnected || this.model !== model || this.text !== original || this.selected !== selected || this.file !== file || this.app.vault.rootPath !== root) { throw new Error("The base, view or Cards settings dialog changed. Reopen its current settings."); }
        if (!size.value.trim() || !ratio.value.trim()) { throw new Error("Enter a card size and image ratio within the displayed ranges."); }
        const next: BaseCardsOptions = { cardSize: Number(size.value), image: image.value, imageFit: fit.value as BaseCardsOptions["imageFit"], imageAspectRatio: Number(ratio.value) };
        this.commit(model.setCardsOptions(selected, next)); await this.save(); modal.close();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); }).finally(() => { form.inert = false; });
    });
    form.append(sizeLabel, imageLabel, fitLabel, ratioLabel, hint, error, apply, cancel); modal.contentEl.append(form); modal.open(); size.focus();
  }
  private listSettingsDialog(): void {
    this.assertEditable();
    const model = this.model, selected = this.selected, file = this.file, root = this.app.vault.rootPath, original = this.text;
    const options = model?.view(selected).list;
    if (!model || !options) { throw new Error("Choose a List view to change its presentation."); }
    const modal = this.dialog("List settings"), form = document.createElement("form"), markersLabel = document.createElement("label"), markers = document.createElement("select"), indentLabel = document.createElement("label"), indent = document.createElement("input"), separatorLabel = document.createElement("label"), separator = document.createElement("input");
    markersLabel.textContent = "Markers "; markers.dataset.basesListMarkers = ""; markers.setAttribute("aria-label", "List markers"); for (const [key, label] of [["bullet", "Bullets"], ["number", "Numbers"], ["none", "None"]]) { markers.add(new Option(label, key)); } markers.value = options.markers; markersLabel.append(markers);
    indent.type = "checkbox"; indent.dataset.basesListIndent = ""; indent.checked = options.indentProperties; indentLabel.append(indent, "Indent properties");
    separatorLabel.textContent = "Property separator "; separator.dataset.basesListSeparator = ""; separator.maxLength = MAX_BASE_LIST_SEPARATOR; separator.value = options.separator; separatorLabel.append(separator);
    const update = (): void => { separatorLabel.hidden = indent.checked; }; indent.addEventListener("change", update); update();
    const hint = document.createElement("p"); hint.textContent = "Empty values are omitted. Indented lists require a value for the first property. Use a table view to edit an empty property.";
    const error = document.createElement("p"); error.className = "plugin-error"; error.dataset.basesDialogError = ""; error.setAttribute("role", "alert");
    const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "Apply list settings"; apply.dataset.basesAction = "apply-list-settings";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.dataset.basesAction = "cancel-list-settings"; cancel.addEventListener("click", () => modal.close());
    form.addEventListener("submit", event => {
      event.preventDefault(); form.inert = true;
      this.app.core.run(async () => {
        this.assertEditable();
        if (this.modal !== modal || !modal.containerEl.isConnected || this.model !== model || this.text !== original || this.selected !== selected || this.file !== file || this.app.vault.rootPath !== root) { throw new Error("The base, view or List settings dialog changed. Reopen its current settings."); }
        if (!["bullet", "number", "none"].includes(markers.value)) { throw new Error("Choose bullets, numbers or no markers."); }
        const next = model.setListOptions(selected, { markers: markers.value as "bullet" | "number" | "none", indentProperties: indent.checked, separator: separator.value }); this.commit(next); await this.save(); modal.close();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); }).finally(() => { form.inert = false; });
    });
    form.append(markersLabel, indentLabel, separatorLabel, hint, error, apply, cancel); modal.contentEl.append(form); modal.open(); markers.focus();
  }
  private listValue(cell: HTMLElement, column: BaseColumn, path: string, value: BaseCell, active: (button: HTMLButtonElement) => boolean): void {
    renderBaseValue(cell, column, path, value, {
      current: active, readOnly: this.isReadOnly,
      open: link => { this.openTarget(link).catch(error => this.setError(error)); },
      edit: (path, property) => { try { this.editProperty(path, property); } catch (error) { this.setError(error); } },
    });
  }
  private listSummaries(columns: BaseColumn[], values: (BaseSummaryCell | null)[], scope: string, label: string, current: () => boolean): HTMLElement {
    const section = document.createElement("section"); section.className = "bases-list-summaries"; section.dataset.basesSummaryRow = scope; section.setAttribute("aria-label", label + " summaries");
    const heading = document.createElement("h4"); heading.textContent = label + " summaries"; section.append(heading);
    const list = document.createElement("dl");
    for (const [index, column] of columns.entries()) {
      const value = values[index]; if (!value) { continue; }
      const pair = document.createElement("div"), term = document.createElement("dt"), definition = document.createElement("dd"), button = document.createElement("button");
      pair.dataset.basesSummary = column.key; pair.dataset.basesSummaryScope = scope; term.textContent = column.label;
      button.type = "button"; button.className = "bases-summary-button"; button.disabled = this.isReadOnly;
      button.setAttribute("aria-label", `Summarize ${column.label}: ${label}, ${value.name}: ${value.text}`);
      const name = document.createElement("span"); name.className = "bases-summary-name"; name.textContent = value.name;
      const result = document.createElement("span"); result.dataset.basesSummaryValue = ""; result.textContent = value.text; button.append(name, result);
      if (value.error) { pair.classList.add("bases-cell-error"); button.title = value.error; }
      button.addEventListener("click", () => { if (button.isConnected && this.table.contains(button) && current()) { try { this.summaryDialog(column); } catch (error) { this.setError(error); } } });
      definition.append(button); pair.append(term, definition); list.append(pair);
    }
    section.append(list); return section;
  }
  private summaryRow(columns: BaseColumn[], values: (BaseSummaryCell | null)[], scope: string, label: string): HTMLTableRowElement {
    const row = document.createElement("tr"); row.className = "bases-summary-row"; row.dataset.basesSummaryRow = scope;
    row.setAttribute("aria-label", label + " summaries");
    for (const [index, column] of columns.entries()) {
      const value = values[index], cell = document.createElement("td"), button = document.createElement("button");
      cell.dataset.basesSummary = column.key; cell.dataset.basesSummaryScope = scope;
      button.type = "button"; button.className = "bases-summary-button";
      button.disabled = this.isReadOnly;
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
    this.assertEditable();
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
        this.assertEditable();
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
  private assertEditable(): void {
    this.app.vault.assertWritable("modify", this.file?.path);
    if (!this.file || !this.isLoaded || this.leaf.view !== this || !this.app.core.isEnabled("bases") || this.app.changingVault) { throw new Error("This base provider or vault changed."); }
    if (this.isReadOnlyForMutation) { throw new Error("Vault files are being changed. Wait for it to finish before editing this base."); }
  }
  private commit(text: string, selected = this.selected): void {
    this.commitSource(this.normalizeSource(text), selected);
  }
  private commitSource(text: string, selected = this.selected): void {
    this.assertEditable();
    const model = new BaseDocument(text);
    this.text = text; this.model = model; this.selected = model.view(selected).name; this.page = 0;
    this.populateControls(); this.setError(""); this.requestSave(); this.refresh();
  }
  private normalizeSource(text: string): string { return text.replace(/\r?\n/g, this.text.includes("\r\n") ? "\r\n" : "\n"); }
  private dialog(title: string): Modal {
    this.assertEditable();
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
        this.assertEditable();
        const draft = this.normalizeSource(input.value);
        if (this.modal !== modal || !modal.containerEl.isConnected || this.text !== original && this.text !== draft) { throw new Error("The base or source dialog changed. Reopen its current source."); }
        this.commit(draft); await this.save(); modal.close();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); }).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form); modal.open(); input.focus();
  }
  private editProperty(path: string, key: string): void {
    this.assertEditable();
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
        const guard = (): void => {
          this.assertEditable();
          if (this.modal !== modal || !modal.containerEl.isConnected || root !== this.app.vault.rootPath || this.app.vault.getFileByPath(path) !== file) { throw new Error("The property dialog, note, provider or vault changed."); }
        };
        guard();
        const currentType = this.app.metadataTypeManager.getAssignedWidget(key);
        if (currentType && currentType !== type.value) { throw new Error("This property's assigned type changed. Reopen it before saving."); }
        const next = parsePropertyValue(type.value, input.value, checked.checked);
        await this.app.fileManager.processFrontMatter(file, properties => {
          guard();
          if (Object.hasOwn(properties, key) !== existed || !sameValue(properties[key], prior)) { throw new Error("The property changed while this dialog was open. Reopen its current value."); }
          Object.defineProperty(properties, key, { value: next, enumerable: true, configurable: true, writable: true });
        }, undefined, guard);
        modal.close(); this.refresh();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); }).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form); modal.open(); (kind === "checkbox" ? checked : input).focus();
  }
}
