import { copyViewData, type ViewStateResult } from "./contracts";
import { ItemView } from "./views";
import type { WorkspaceLeaf } from "./workspace";
import type { WebViewers } from "./web-viewer";
import type { WebHistorySnapshot, WebHistoryUndoReview } from "./web-history";
import { historyUrl, type WebVisit } from "./web-history-model";
import { Menu, type MenuPositionDef } from "./menu";
import { historyDateRange, type WebHistoryDateBounds, type WebHistoryDateRange } from "./web-history-date-range";
import { WebHistoryArchiveModal } from "./web-history-archive-modal";
import { historyOrder, WEB_HISTORY_ORDERS, type WebHistoryOrder } from "./web-history-order";
import { historyRetentionDays, WEB_HISTORY_RETENTION_DAYS } from "./web-history-retention";
import { WebHistoryLimitModal } from "./web-history-limit-modal";
import { setIcon } from "./icons";
import { historyOpenReview, WEB_HISTORY_OPEN_LIMIT } from "./web-history-open";
import { WebHistoryOpenModal } from "./web-history-open-modal";

interface HistoryRemovalReview { snapshot: WebHistorySnapshot; query: string | null; revision: number; dates: WebHistoryDateBounds; ids?: string[]; redo?: WebHistoryUndoReview; orderRevision?: number }

export class WebHistoryView extends ItemView {
  override icon = "clock";
  private readonly search = document.createElement("input");
  private readonly orderSelect = document.createElement("select");
  private readonly retentionSelect = document.createElement("select");
  private sortOrder: WebHistoryOrder = "newest";
  private orderRevision = 0;
  private readonly from = document.createElement("input");
  private readonly through = document.createElement("input");
  private readonly rangeError = document.createElement("p");
  private rangeState: WebHistoryDateRange = { fromDate: "", throughDate: "" };
  private readonly recording = document.createElement("input");
  private readonly status = document.createElement("output");
  private readonly error = document.createElement("p");
  private readonly list = document.createElement("ol");
  private readonly confirmation = document.createElement("div");
  private readonly clear: HTMLButtonElement;
  private readonly removeMatching: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly archiveButton: HTMLButtonElement;
  private readonly limitButton: HTMLButtonElement;
  private readonly clearIcons: HTMLButtonElement;
  private limitPreview: WebHistoryLimitModal | null = null;
  private archivePreview: WebHistoryArchiveModal | null = null;
  private openPreview: WebHistoryOpenModal | null = null;
  private readonly selectAll: HTMLButtonElement;
  private readonly clearSelected: HTMLButtonElement;
  private readonly removeSelected: HTMLButtonElement;
  private readonly saveSelected: HTMLButtonElement;
  private readonly openSelected: HTMLButtonElement;
  private readonly selectionStatus = document.createElement("output");
  private readonly selected = new Set<string>();
  private snapshot: WebHistorySnapshot | null = null;
  private review: HistoryRemovalReview | null = null;
  private disposed = false;
  private busy = false;
  private refreshing = false;
  private revision = 0;
  private copySequence = 0;
  private visitMenu: Menu | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly provider: WebViewers) {
    super(leaf);
    this.headerEl.hidden = true;
    this.contentEl.classList.add("web-history");
    this.contentEl.dataset.webHistory = "";
    const heading = document.createElement("h2"); heading.textContent = "Web history";
    const description = document.createElement("p");
    description.textContent = "Up to 1,000 visits are saved in this vault. Pausing stops new visits from being saved. Website cookies remain temporary.";
    const controls = document.createElement("div"); controls.className = "web-history-controls";
    this.search.type = "search"; this.search.placeholder = "Search titles and addresses"; this.search.setAttribute("aria-label", "Search web history"); this.search.dataset.webHistorySearch = "";
    this.recording.type = "checkbox"; this.recording.dataset.webHistoryRecording = "";
    const label = document.createElement("label"); label.append(this.recording, " Record visits");
    const orderLabel = document.createElement("label"); orderLabel.append("Order ");
    this.orderSelect.dataset.webHistoryOrder = ""; this.orderSelect.setAttribute("aria-label", "History order");
    for (const [value, title] of WEB_HISTORY_ORDERS) {
      const option = document.createElement("option"); option.value = value; option.textContent = title; this.orderSelect.append(option);
    }
    orderLabel.append(this.orderSelect);
    this.registerDomEvent(this.orderSelect, "change", () => {
      try { this.changeOrder(this.orderSelect.value); }
      catch (error) { this.orderSelect.value = this.order(); this.showError(error); }
    });
    this.search.maxLength = 1024;
    this.clear = this.button("Clear history…", "clear", () => this.beginRemoval(null));
    this.removeMatching = this.button("Remove matching visits…", "remove-matching", () => this.beginRemoval(this.search.value));
    this.undoButton = this.button("Undo removal", "undo", () => this.undoRemoval());
    this.redoButton = this.button("Redo removal", "redo", () => this.beginRedoRemoval());
    this.archiveButton = this.button("Save shown visits…", "archive", () => this.beginArchive());
    controls.append(this.search, orderLabel, label, this.button("Refresh", "refresh", () => this.refresh(true)), this.archiveButton, this.removeMatching, this.clear, this.undoButton, this.redoButton);
    this.clearIcons = this.button("Clear icons", "clear-icons", () => {
      if (!this._loaded || this.disposed || this.app.changingVault || this.app.core.busy || !this.app.core.isEnabled(this.provider.id)) { return; }
      this.provider.favicons.clear(); this.status.textContent = "Cached site icons cleared.";
    });
    this.clearIcons.setAttribute("aria-label", "Clear cached site icons"); controls.append(this.clearIcons);
    this.clearIcons.title = "Clear this vault's cached site icons and cancel pending captures.";
    const retention = document.createElement("div"); retention.className = "web-history-controls";
    retention.setAttribute("role", "group"); retention.setAttribute("aria-label", "History retention policies");
    const retentionLabel = document.createElement("label"); retentionLabel.append("Age limit ");
    this.retentionSelect.dataset.webHistoryRetention = ""; this.retentionSelect.setAttribute("aria-label", "History age limit");
    for (const days of WEB_HISTORY_RETENTION_DAYS) {
      const option = document.createElement("option"); option.value = String(days); option.textContent = days ? days + " days" : "No age limit";
      this.retentionSelect.append(option);
    }
    retentionLabel.append(this.retentionSelect);
    const retentionHint = document.createElement("span");
    retentionHint.textContent = "Older visits are removed on the next new recorded visit. Changing this limit leaves existing visits in place.";
    this.limitButton = this.button("Visit limit… (1000)", "visit-limit", () => this.beginLimit());
    retention.append(retentionLabel, this.limitButton, retentionHint);
    this.registerDomEvent(this.retentionSelect, "change", () => {
      const value = this.retentionSelect.value;
      if (!WEB_HISTORY_RETENTION_DAYS.some(days => String(days) === value)) {
        this.showError(new Error("Choose a supported history age limit.")); this.render(); return;
      }
      void this.changeRetention(Number(value)).catch(error => { this.showError(error); this.render(); });
    });
    const dates = document.createElement("div"); dates.className = "web-history-controls";
    dates.setAttribute("role", "group"); dates.setAttribute("aria-label", "Filter visits by local date");
    for (const [input, name, key] of [[this.from, "From", "from"], [this.through, "Through", "through"]] as const) {
      input.type = "date"; input.min = "0001-01-01"; input.max = "9999-12-31";
      input.dataset.webHistoryDate = key; input.setAttribute("aria-label", name + " date, inclusive");
      const label = document.createElement("label"); label.append(name + " ", input); dates.append(label);
      this.registerDomEvent(input, "input", () => { this.resetSelection(); this.render(); if (!this.rangeError.textContent) { this.app.workspace.layoutChanged(); } });
    }
    dates.append(this.button("Reset dates", "reset-dates", () => {
      this.from.value = ""; this.through.value = ""; this.resetSelection(); this.render(); this.app.workspace.layoutChanged();
    }));
    const hint = document.createElement("span"); hint.textContent = "Local dates; Through includes the whole day."; dates.append(hint);
    this.rangeError.className = "plugin-error"; this.rangeError.setAttribute("role", "alert"); this.rangeError.dataset.webHistoryDateError = "";
    const selection = document.createElement("div"); selection.className = "web-history-controls";
    selection.setAttribute("role", "group"); selection.setAttribute("aria-label", "Select saved visits");
    this.selectAll = this.button("Select shown", "select-shown", () => this.selectShown());
    this.clearSelected = this.button("Clear selection", "clear-selection", () => { this.resetSelection(); this.syncSelection(); this.search.focus(); });
    this.removeSelected = this.button("Remove selected visits…", "remove-selected", () => this.beginSelectedRemoval());
    this.saveSelected = this.button("Save selected visits…", "archive-selected", () => this.beginArchive(true));
    this.openSelected = this.button("Open selected visits…", "open-selected", () => this.beginOpenSelected());
    this.openSelected.title = "Review 1–20 checked visits before opening new tabs.";
    this.selectionStatus.setAttribute("role", "status"); this.selectionStatus.dataset.webHistorySelection = "";
    selection.append(this.selectAll, this.clearSelected, this.removeSelected, this.saveSelected, this.openSelected, this.selectionStatus);
    this.confirmation.className = "web-history-confirm"; this.confirmation.hidden = true;
    this.confirmation.setAttribute("role", "group"); this.confirmation.setAttribute("aria-label", "Review history removal");
    this.confirmation.append(document.createElement("span"), this.button("Clear saved visits", "confirm-clear", () => this.confirmRemoval()),
      this.button("Cancel", "cancel-clear", () => this.cancelRemoval()));
    this.status.setAttribute("role", "status"); this.status.dataset.webHistoryStatus = "";
    this.error.className = "plugin-error"; this.error.setAttribute("role", "alert"); this.error.dataset.webHistoryError = "";
    this.list.className = "web-history-list"; this.list.dataset.webHistoryList = "";
    this.contentEl.append(heading, description, controls, retention, dates, this.rangeError, selection, this.confirmation, this.status, this.error, this.list);
    this.registerDomEvent(this.search, "input", () => { this.resetSelection(); this.render(); this.app.workspace.layoutChanged(); });
    this.registerDomEvent(this.confirmation, "keydown", event => {
      if ((event as KeyboardEvent).key === "Escape") { event.preventDefault(); event.stopPropagation(); this.cancelRemoval(); }
    });
    this.registerDomEvent(this.recording, "change", () => {
      const recording = this.recording.checked;
      void this.perform(() => this.provider.history.setRecording(recording, () => !this.disposed));
    });
  }
  getViewType(): string { return "webviewer-history"; }
  getDisplayText(): string { return "Web history"; }
  override getState(): Record<string, unknown> {
    const state = super.getState(); delete state.sortOrder;
    const order = this.order();
    return { ...state, query: this.search.value, ...this.rangeState, ...(order !== "newest" ? { sortOrder: order } : {}) };
  }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    const dates = historyDateRange(state), order = historyOrder(state.sortOrder);
    this.resetSelection();
    if (this.order() !== order) { this.orderRevision = (this.orderRevision ?? 0) + 1; }
    this.sortOrder = order;
    this.search.value = typeof state.query === "string" ? state.query.slice(0, 1024) : "";
    this.from.value = dates.fromDate; this.through.value = dates.throughDate;
    this.rangeState = { fromDate: dates.fromDate, throughDate: dates.throughDate };
    await super.setState(state, result);
    this.render();
  }
  override focus(): void { this.search.focus(); }
  protected override async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("webviewer:update-history", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("webviewer:update-favicons", () => this.updateFavicons()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.visitMenu?.hide()));
    this.registerEvent(this.leaf.on("pinned-change", () => this.visitMenu?.hide()));
    this.register(() => this.visitMenu?.hide());
    await this.refresh();
  }
  protected override async unloadViewContent(): Promise<void> { this.disposed = true; this.archivePreview?.forceClose(); this.limitPreview?.forceClose(); this.openPreview?.forceClose(); this.visitMenu?.hide(); this.revision++; this.resetSelection(); this.snapshot = null; }
  private reviewCurrent(snapshot: WebHistorySnapshot): boolean {
    return this._loaded && !this.disposed && !this.refreshing && this.leaf.view === this && !this.app.changingVault && !this.app.core.busy
      && this.app.core.isEnabled(this.provider.id) && Boolean(snapshot.document.root) && snapshot.document.root === this.app.vault.rootPath;
  }
  private cancelReview(): void { this.review = null; this.confirmation.hidden = true; }
  private cancelRemoval(): void {
    const target = this.review?.redo ? this.redoButton : this.review?.ids ? this.removeSelected : this.search;
    this.cancelReview(); target.focus();
  }
  private resetSelection(): void { this.archivePreview?.invalidate(); this.limitPreview?.invalidate(); this.openPreview?.invalidate(); this.selected.clear(); this.cancelReview(); }
  private beginOpenSelected(): void {
    const snapshot = this.snapshot, revision = this.revision, orderRevision = this.orderRevision ?? 0;
    if (this.busy || !snapshot || !this.reviewCurrent(snapshot)) { throw new Error("This selected-visit review is no longer available."); }
    if (this.openPreview?.isOpen) { this.openPreview.modalEl.focus(); return; }
    const selection = { query: this.search.value, ids: [...this.selected], dates: this.dateRange(), order: this.order() };
    const review = historyOpenReview(snapshot.history.data, selection);
    this.cancelReview();
    const current = (): boolean => this.snapshot === snapshot && this.revision === revision && (this.orderRevision ?? 0) === orderRevision
      && this.reviewCurrent(snapshot) && this.search.value === selection.query && this.from.value === selection.dates.fromDate && this.through.value === selection.dates.throughDate
      && this.selected.size === selection.ids.length && selection.ids.every(id => this.selected.has(id)) && this.openPreview === modal && modal.available;
    const modal = new WebHistoryOpenModal(this.app, review, {
      open: () => this.provider.history.openSelected(snapshot, selection, current, url => this.provider.openUrl(url, true)),
      closed: () => { if (this.openPreview === modal) { this.openPreview = null; } },
    });
    this.openPreview = modal; modal.open();
  }
  private beginLimit(): void {
    const snapshot = this.snapshot, revision = this.revision, orderRevision = this.orderRevision ?? 0;
    if (this.busy || !snapshot || !this.reviewCurrent(snapshot)) { throw new Error("This history visit-limit review is no longer available."); }
    if (this.limitPreview?.isOpen) { this.limitPreview.modalEl.focus(); return; }
    this.cancelReview();
    const current = (): boolean => this.snapshot === snapshot && this.revision === revision && (this.orderRevision ?? 0) === orderRevision
      && this.reviewCurrent(snapshot) && this.limitPreview === modal && modal.available;
    const modal = new WebHistoryLimitModal(this.app, { limit: snapshot.history.visitLimit, count: snapshot.history.entries.length }, {
      save: async value => {
        try { await this.provider.history.setVisitLimit(snapshot, value, current); }
        catch (error) { void this.refresh(); throw error; }
      },
      closed: () => { if (this.limitPreview === modal) { this.limitPreview = null; } },
    });
    this.limitPreview = modal; modal.open();
  }
  private order(): WebHistoryOrder { return historyOrder(this.sortOrder); }
  private async changeRetention(value: unknown): Promise<void> {
    const days = historyRetentionDays(value), snapshot = this.snapshot, revision = this.revision;
    if (this.busy || !snapshot || !this.reviewCurrent(snapshot)) { throw new Error("This history pane is no longer active."); }
    await this.perform(() => this.provider.history.setRetention(snapshot, days,
      () => this.snapshot === snapshot && this.revision === revision && this.reviewCurrent(snapshot)));
  }
  private changeOrder(value: unknown): void {
    const order = historyOrder(value);
    if (order === this.order()) { return; }
    this.sortOrder = order; this.orderRevision = (this.orderRevision ?? 0) + 1; this.copySequence++;
    this.resetSelection(); this.render(); this.app.workspace.layoutChanged();
  }
  private beginArchive(selection = false): void {
    const snapshot = this.snapshot, revision = this.revision, orderRevision = this.orderRevision ?? 0, order = this.order();
    if (this.busy || !snapshot || !this.reviewCurrent(snapshot)) { throw new Error("This history archive is no longer available."); }
    if (this.archivePreview?.isOpen) { this.archivePreview.modalEl.focus(); return; }
    const ids = selection ? [...this.selected] : null, dates = this.dateRange();
    const review = { ...(ids ? snapshot.history.archiveSelected(this.search.value, ids, dates, order) : snapshot.history.archive(this.search.value, dates, order)), selection, order };
    this.cancelReview();
    const current = (): boolean => this.snapshot === snapshot && this.revision === revision && (this.orderRevision ?? 0) === orderRevision && this.reviewCurrent(snapshot)
      && (!ids || this.selected.size === ids.length && ids.every(id => this.selected.has(id)));
    const modal = new WebHistoryArchiveModal(this.app, review, {
      guard: () => { if (!current() || this.archivePreview !== modal) { throw new Error("This history archive is no longer available. Review the shown visits again."); } },
      create: (path, markdown) => this.provider.history.archive(snapshot, () => current() && modal.available && this.archivePreview === modal,
        async () => { await this.app.vault.create(path, markdown); }),
      closed: () => { if (this.archivePreview === modal) { this.archivePreview = null; } },
    });
    this.archivePreview = modal; modal.open();
  }
  private syncSelection(): void {
    const disabled = this.busy || this.refreshing || !this.snapshot || Boolean(this.rangeError.textContent);
    const inputs = this.list.querySelectorAll<HTMLInputElement>("[data-web-history-select]");
    for (const input of inputs) { input.checked = this.selected.has(input.dataset.webHistorySelect!); input.disabled = disabled; }
    this.selectAll.disabled = disabled || !inputs.length;
    this.clearSelected.disabled = this.busy || this.refreshing || !this.selected.size;
    this.removeSelected.disabled = disabled || !this.selected.size;
    this.saveSelected.disabled = disabled || !this.selected.size;
    if (this.openSelected) { this.openSelected.disabled = disabled || !this.selected.size || this.selected.size > WEB_HISTORY_OPEN_LIMIT; }
    this.selectionStatus.textContent = `${this.selected.size} selected`;
  }
  private setSelected(snapshot: WebHistorySnapshot, id: string, checked: boolean): void {
    if (this.busy || snapshot !== this.snapshot || !this.reviewCurrent(snapshot)
      || !snapshot.history.ordered(this.search.value, this.dateRange(), this.order()).some(entry => entry.id === id)) {
      throw new Error("This visit selection is no longer active. Select the shown visits again.");
    }
    this.archivePreview?.invalidate(); this.openPreview?.invalidate(); this.cancelReview();
    if (checked) { this.selected.add(id); } else { this.selected.delete(id); }
    this.syncSelection();
  }
  private selectShown(): void {
    const snapshot = this.snapshot;
    if (this.busy || !snapshot || !this.reviewCurrent(snapshot)) { return; }
    const entries = snapshot.history.ordered(this.search.value, this.dateRange(), this.order());
    this.resetSelection(); for (const entry of entries) { this.selected.add(entry.id); } this.syncSelection();
  }
  private beginSelectedRemoval(): void {
    this.cancelReview();
    const snapshot = this.snapshot;
    if (this.busy || !snapshot || !this.reviewCurrent(snapshot)) { return; }
    const dates = this.dateRange(), ids = snapshot.history.ordered(this.search.value, dates, this.order()).filter(entry => this.selected.has(entry.id)).map(entry => entry.id);
    if (!ids.length) { return; }
    if (ids.length !== this.selected.size) { throw new Error("This visit selection is no longer active. Select the shown visits again."); }
    this.review = { snapshot, query: this.search.value, revision: this.revision, dates, ids, orderRevision: this.orderRevision ?? 0 };
    this.confirmation.querySelector("span")!.textContent = `Remove ${ids.length} selected ${ids.length === 1 ? "visit" : "visits"}? Other visits will be kept. `;
    const confirm = this.confirmation.querySelector("button")!; confirm.textContent = "Remove selected visits";
    this.confirmation.hidden = false; confirm.focus();
  }
  private dateRange(): WebHistoryDateBounds {
    if (this.from.validity.badInput || this.through.validity.badInput) { throw new Error("Enter complete dates in From and Through."); }
    return historyDateRange({ fromDate: this.from.value, throughDate: this.through.value });
  }
  private removalCurrent(review: HistoryRemovalReview): boolean {
    const current = this.review === review && this.snapshot === review.snapshot && this.revision === review.revision
      && (review.orderRevision ?? 0) === (this.orderRevision ?? 0)
      && (review.query === null || review.query === this.search.value) && this.reviewCurrent(review.snapshot);
    if (!current) { return false; }
    if (review.redo) {
      const available = this.provider.history.getRedo(review.snapshot);
      return available?.id === review.redo.id && available.count === review.redo.count;
    }
    if (review.query === null) { return true; }
    if (review.ids && (this.selected.size !== review.ids.length || review.ids.some(id => !this.selected.has(id)))) { return false; }
    try {
      const dates = this.dateRange();
      return dates.fromDate === review.dates.fromDate && dates.throughDate === review.dates.throughDate
        && dates.start === review.dates.start && dates.end === review.dates.end;
    } catch { return false; }
  }
  private beginRemoval(query: string | null): void {
    this.cancelReview();
    const snapshot = this.snapshot;
    if (this.busy || !snapshot || !this.reviewCurrent(snapshot)) { return; }
    const dates = query === null ? historyDateRange() : this.dateRange();
    const filtered = query !== null && query.length <= 1024 && Boolean(query.trim() || dates.fromDate || dates.throughDate);
    const count = query === null ? snapshot.history.entries.length : filtered ? snapshot.history.newest(query, dates).length : 0;
    if (!count) { return; }
    this.review = { snapshot, query, revision: this.revision, dates, orderRevision: this.orderRevision ?? 0 };
    const bounds = (dates.fromDate ? ` from ${dates.fromDate}` : "") + (dates.throughDate ? ` through ${dates.throughDate}` : "");
    this.confirmation.querySelector("span")!.textContent = query === null ? `Clear all ${count} saved visits? `
      : `Remove ${count} matching ${count === 1 ? "visit" : "visits"}${query.trim() ? ` for “${query}”` : ""}${bounds}? Other visits will be kept. `;
    const confirm = this.confirmation.querySelector("button")!;
    confirm.textContent = query === null ? "Clear saved visits" : "Remove matching visits";
    this.confirmation.hidden = false; confirm.focus();
  }
  private async confirmRemoval(): Promise<void> {
    const review = this.review;
    if (!review || !this.removalCurrent(review)) { this.cancelReview(); throw new Error("This history review is no longer active. Review the visits again."); }
    const success = await this.perform(() => review.redo ? this.provider.history.redo(review.snapshot, review.redo, () => this.removalCurrent(review))
      : review.ids ? this.provider.history.removeSelected(review.snapshot, review.ids, () => this.removalCurrent(review)) : review.query === null
      ? this.provider.history.edit(review.snapshot, null, () => this.removalCurrent(review))
      : this.provider.history.removeMatching(review.snapshot, review.query, () => this.removalCurrent(review), { fromDate: review.dates.fromDate, throughDate: review.dates.throughDate }));
    if (review.redo && success && this.snapshot && this.reviewCurrent(this.snapshot)) {
      this.status.textContent = `Removed ${review.redo.count} ${review.redo.count === 1 ? "visit" : "visits"} again.`;
    }
  }
  private beginRedoRemoval(): void {
    this.cancelReview();
    const snapshot = this.snapshot, redo = snapshot ? this.provider.history.getRedo(snapshot) : null;
    if (this.busy || !snapshot || !redo || !this.reviewCurrent(snapshot)) { throw new Error("This history redo is no longer available."); }
    this.review = { snapshot, redo, query: null, dates: historyDateRange(), revision: this.revision, orderRevision: this.orderRevision ?? 0 };
    this.confirmation.querySelector("span")!.textContent = `Remove the ${redo.count} ${redo.count === 1 ? "visit" : "visits"} restored by Undo again? Other visits will be kept. `;
    const confirm = this.confirmation.querySelector("button")!; confirm.textContent = "Redo removal";
    this.confirmation.hidden = false; confirm.focus();
  }
  private async undoRemoval(): Promise<void> {
    const snapshot = this.snapshot, revision = this.revision, orderRevision = this.orderRevision ?? 0;
    const review = snapshot ? this.provider.history.getUndo(snapshot) : null;
    if (this.busy || !snapshot || !review || !this.reviewCurrent(snapshot)) { throw new Error("This history undo is no longer available."); }
    const success = await this.perform(() => this.provider.history.undo(snapshot, review,
      () => this.snapshot === snapshot && this.revision === revision && (this.orderRevision ?? 0) === orderRevision && this.reviewCurrent(snapshot)));
    if (success && this.snapshot && this.reviewCurrent(this.snapshot)) {
      this.status.textContent = `Restored ${review.count} ${review.count === 1 ? "visit" : "visits"}.`;
    }
  }
  private async invokeVisit(snapshot: WebHistorySnapshot, entry: WebVisit, action: "tab" | "here" | "copy" | "remove"): Promise<void> {
    if (!this.reviewCurrent(snapshot) || this.busy) { throw new Error("This history pane is no longer active. Reopen its visit menu."); }
    const url = historyUrl(entry.url);
    if (action === "tab") { await this.provider.openUrl(url, true); }
    else if (action === "here") {
      if (this.leaf.pinned) { throw new Error("Unpin this history tab before opening a visit here."); }
      await this.leaf.setViewState({ type: "webviewer", state: { url }, active: true });
    } else if (action === "copy") {
      const clipboard = navigator.clipboard, revision = this.revision, sequence = ++this.copySequence;
      if (!clipboard?.writeText) {
        this.status.textContent = "Link address was not copied.";
        throw new Error("Clipboard access is unavailable. Use a supported desktop application or secure browser.");
      }
      const current = (): boolean => this.reviewCurrent(snapshot) && !this.busy && revision === this.revision && sequence === this.copySequence;
      this.status.textContent = "Copying link address…";
      try { await clipboard.writeText(url); }
      catch (error) { if (current()) { this.status.textContent = "Link address was not copied."; throw error; } return; }
      if (current()) {
        this.error.textContent = ""; this.status.textContent = "Link address copied.";
      }
    } else if (action === "remove") {
      const orderRevision = this.orderRevision ?? 0;
      await this.perform(() => this.provider.history.edit(snapshot, entry.id, () => (this.orderRevision ?? 0) === orderRevision && this.reviewCurrent(snapshot)));
    }
    else { throw new Error("Unknown history visit action."); }
  }
  private showVisitMenu(snapshot: WebHistorySnapshot, entry: WebVisit, position: MenuPositionDef): void {
    if (!this.reviewCurrent(snapshot) || this.busy) { return; }
    this.visitMenu?.hide();
    const menu = new Menu(), selected = { ...entry };
    menu.dom.dataset.webHistoryMenu = entry.id;
    const invoke = (action: "tab" | "here" | "copy" | "remove"): Promise<void> => this.invokeVisit(snapshot, selected, action).catch(error => this.showError(error));
    menu.addItem(item => item.setTitle("Open in new tab").onClick(() => invoke("tab")));
    menu.addItem(item => item.setTitle("Open in this tab").setDisabled(this.leaf.pinned).onClick(() => invoke("here")));
    menu.addItem(item => item.setTitle("Copy link address").onClick(() => invoke("copy")));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Remove visit").setWarning(true).onClick(() => invoke("remove")));
    menu.onHide(() => { if (this.visitMenu === menu) { this.visitMenu = null; } });
    this.visitMenu = menu;
    menu.showAtPosition(position);
  }
  private button(label: string, action: string, callback: () => unknown): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.dataset.webHistoryAction = action;
    this.registerDomEvent(button, "click", () => { void Promise.resolve().then(callback).catch(error => this.showError(error)); });
    return button;
  }
  private showError(error: unknown): void { if (!this.disposed) { this.error.textContent = error instanceof Error ? error.message : String(error); } }
  private updateFavicons(): void {
    if (this.disposed) { return; }
    for (const holder of this.list.querySelectorAll<HTMLElement>("[data-web-history-icon]")) {
      this.renderFavicon(holder, holder.dataset.webHistoryIcon!);
    }
    this.clearIcons.disabled = !this.provider.favicons.canClear;
  }
  private renderFavicon(holder: HTMLElement, url: string): void {
    const fallback = document.createElement("span"); setIcon(fallback, "globe"); fallback.setAttribute("aria-hidden", "true");
    fallback.style.display = "flex"; fallback.style.width = fallback.style.height = "16px";
    const data = this.provider.favicons.get(url);
    holder.replaceChildren(fallback);
    if (!data) { return; }
    const image = document.createElement("img"); image.alt = ""; image.setAttribute("aria-hidden", "true"); image.width = image.height = 16;
    image.style.objectFit = "contain"; image.dataset.webHistoryFavicon = ""; image.decoding = "async";
    fallback.hidden = true; fallback.style.display = "none";
    image.addEventListener("error", () => { image.remove(); fallback.hidden = false; fallback.style.display = "flex"; });
    image.src = data; holder.prepend(image);
  }
  private async perform(action: () => Promise<void>): Promise<boolean> {
    if (this.busy || this.disposed) { return false; }
    this.busy = true; this.error.textContent = ""; this.render();
    let success = false;
    try { await action(); success = true; }
    catch (error) { this.showError(error); }
    finally {
      this.busy = false; this.cancelReview();
      await this.refresh();
    }
    return success;
  }
  private async refresh(clearError = false): Promise<void> {
    if (this.disposed) { return; }
    this.resetSelection();
    if (clearError) { this.error.textContent = ""; }
    const revision = ++this.revision;
    this.refreshing = true; this.render();
    try {
      const snapshot = await this.provider.history.read();
      if (this.disposed || revision !== this.revision) { return; }
      this.snapshot = snapshot;
      if (this.provider.history.error) { this.showError(this.provider.history.error); }
    } catch (error) {
      if (this.disposed || revision !== this.revision) { return; }
      this.snapshot = null; this.showError(error);
    } finally {
      if (!this.disposed && revision === this.revision) { this.refreshing = false; this.render(); }
    }
  }
  private render(): void {
    if (this.disposed) { return; }
    this.visitMenu?.hide();
    const snapshot = this.snapshot;
    this.orderSelect.value = this.order(); this.orderSelect.disabled = this.busy || this.refreshing || !snapshot;
    this.retentionSelect.value = String(snapshot?.history.retentionDays ?? 0);
    this.retentionSelect.disabled = this.busy || this.refreshing || !snapshot;
    this.limitButton.disabled = this.busy || this.refreshing || !snapshot;
    this.limitButton.textContent = "Visit limit… (" + (snapshot?.history.visitLimit ?? 1000) + ")";
    this.clearIcons.disabled = !this.provider.favicons.canClear;
    let dates: WebHistoryDateBounds | null = null, entries: WebVisit[] = [];
    try {
      dates = this.dateRange(); this.rangeError.textContent = "";
      this.rangeState = { fromDate: dates.fromDate, throughDate: dates.throughDate };
      entries = snapshot?.history.ordered(this.search.value, dates, this.order()) ?? [];
    } catch (error) { this.rangeError.textContent = error instanceof Error ? error.message : String(error); }
    const shown = new Set(entries.map(entry => entry.id));
    if (Array.from(this.selected).some(id => !shown.has(id))) { this.resetSelection(); }
    this.recording.checked = snapshot?.history.recording ?? true;
    this.recording.disabled = !snapshot || this.busy || this.refreshing;
    this.clear.disabled = !snapshot?.history.entries.length || this.busy || this.refreshing;
    const undo = snapshot ? this.provider.history.getUndo(snapshot) : null;
    this.undoButton.disabled = this.busy || this.refreshing || !undo;
    this.undoButton.textContent = undo ? `Undo removal (${undo.count})` : "Undo removal";
    this.undoButton.dataset.webHistoryUndoCount = String(undo?.count ?? 0);
    this.undoButton.title = undo ? `Restore the last ${undo.count} removed ${undo.count === 1 ? "visit" : "visits"}.` : "No removal is available to undo.";
    const redo = snapshot ? this.provider.history.getRedo(snapshot) : null;
    this.redoButton.disabled = this.busy || this.refreshing || !redo;
    this.redoButton.textContent = redo ? `Redo removal (${redo.count})` : "Redo removal";
    this.redoButton.dataset.webHistoryRedoCount = String(redo?.count ?? 0);
    this.redoButton.title = redo ? `Remove the ${redo.count} ${redo.count === 1 ? "visit" : "visits"} restored by Undo again.` : "No removal is available to redo.";
    this.removeMatching.disabled = !dates || !(this.search.value.trim() || dates.fromDate || dates.throughDate) || this.search.value.length > 1024 || !entries.length || this.busy || this.refreshing;
    this.archiveButton.disabled = !dates || !entries.length || this.search.value.length > 1024 || this.busy || this.refreshing;
    this.confirmation.querySelectorAll("button").forEach(button => button.disabled = this.busy || this.refreshing);
    this.status.textContent = this.refreshing ? "Refreshing history…" : !snapshot ? "History unavailable" : !dates ? "Choose a valid date range." : `${entries.length} of ${snapshot.history.entries.length} saved visits${snapshot.history.recording ? "" : " · Recording paused"}`;
    this.list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("li"); row.dataset.webHistoryId = entry.id;
      const select = document.createElement("input"); select.type = "checkbox"; select.dataset.webHistorySelect = entry.id;
      select.setAttribute("aria-label", "Select visit to " + (entry.title || entry.url));
      select.addEventListener("change", () => {
        try { this.setSelected(snapshot!, entry.id, select.checked); }
        catch (error) { select.checked = this.selected.has(entry.id); this.showError(error); }
      });
      const open = document.createElement("button"); open.type = "button"; open.className = "web-history-open"; open.dataset.webHistoryUrl = entry.url;
      open.disabled = this.busy || this.refreshing; open.title = entry.url; open.setAttribute("aria-keyshortcuts", "Shift+F10");
      const title = document.createElement("strong"); title.textContent = entry.title || entry.url;
      const heading = document.createElement("div"); heading.style.display = "flex"; heading.style.alignItems = "center"; heading.style.gap = "8px";
      const favicon = document.createElement("span"); favicon.dataset.webHistoryIcon = entry.url;
      favicon.style.display = "inline-flex"; favicon.style.width = favicon.style.height = "16px"; favicon.style.flex = "0 0 16px";
      this.renderFavicon(favicon, entry.url); heading.append(favicon, title);
      const address = document.createElement("span"); address.textContent = entry.url;
      const time = document.createElement("time"); time.dateTime = new Date(entry.visitedAt).toISOString(); time.textContent = new Date(entry.visitedAt).toLocaleString();
      open.append(heading, address, time);
      // Rebuilt rows own their listeners; do not accumulate component cleanups.
      open.addEventListener("click", () => { void this.provider.openUrl(entry.url, true).catch(error => this.showError(error)); });
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.dataset.webHistoryAction = "remove";
      const orderRevision = this.orderRevision ?? 0;
      remove.disabled = this.busy || this.refreshing; remove.setAttribute("aria-label", "Remove visit to " + (entry.title || entry.url));
      remove.addEventListener("click", () => { void this.perform(() => this.provider.history.edit(snapshot!, entry.id,
        () => (this.orderRevision ?? 0) === orderRevision && this.snapshot === snapshot && this.reviewCurrent(snapshot!))); });
      row.addEventListener("contextmenu", event => {
        event.preventDefault(); event.stopPropagation(); open.focus();
        this.showVisitMenu(snapshot!, entry, { x: event.clientX, y: event.clientY });
      });
      row.addEventListener("keydown", event => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) { return; }
        event.preventDefault(); event.stopPropagation(); open.focus(); open.scrollIntoView({ block: "nearest" });
        const bounds = open.getBoundingClientRect(); this.showVisitMenu(snapshot!, entry, { x: bounds.left, y: bounds.bottom });
      });
      row.append(select, open, remove); this.list.append(row);
    }
    if (snapshot && !entries.length) {
      const empty = document.createElement("li"); empty.textContent = !dates ? "Choose a valid date range." : this.search.value || dates.fromDate || dates.throughDate ? "No matching visits." : "No saved visits."; this.list.append(empty);
    }
    this.syncSelection();
  }
}
