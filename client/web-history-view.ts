import { copyViewData, type ViewStateResult } from "./contracts";
import { ItemView } from "./views";
import type { WorkspaceLeaf } from "./workspace";
import type { WebViewers } from "./web-viewer";
import type { WebHistorySnapshot } from "./web-history";
import { historyUrl, type WebVisit } from "./web-history-model";
import { Menu, type MenuPositionDef } from "./menu";
import { historyDateRange, type WebHistoryDateBounds, type WebHistoryDateRange } from "./web-history-date-range";

interface HistoryRemovalReview { snapshot: WebHistorySnapshot; query: string | null; revision: number; dates: WebHistoryDateBounds }

export class WebHistoryView extends ItemView {
  override icon = "clock";
  private readonly search = document.createElement("input");
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
    description.textContent = "The latest 1,000 visits are saved in this vault. Pausing stops new visits from being saved. Website cookies remain temporary.";
    const controls = document.createElement("div"); controls.className = "web-history-controls";
    this.search.type = "search"; this.search.placeholder = "Search titles and addresses"; this.search.setAttribute("aria-label", "Search web history"); this.search.dataset.webHistorySearch = "";
    this.recording.type = "checkbox"; this.recording.dataset.webHistoryRecording = "";
    const label = document.createElement("label"); label.append(this.recording, " Record visits");
    this.search.maxLength = 1024;
    this.clear = this.button("Clear history…", "clear", () => this.beginRemoval(null));
    this.removeMatching = this.button("Remove matching visits…", "remove-matching", () => this.beginRemoval(this.search.value));
    controls.append(this.search, label, this.button("Refresh", "refresh", () => this.refresh(true)), this.removeMatching, this.clear);
    const dates = document.createElement("div"); dates.className = "web-history-controls";
    dates.setAttribute("role", "group"); dates.setAttribute("aria-label", "Filter visits by local date");
    for (const [input, name, key] of [[this.from, "From", "from"], [this.through, "Through", "through"]] as const) {
      input.type = "date"; input.min = "0001-01-01"; input.max = "9999-12-31";
      input.dataset.webHistoryDate = key; input.setAttribute("aria-label", name + " date, inclusive");
      const label = document.createElement("label"); label.append(name + " ", input); dates.append(label);
      this.registerDomEvent(input, "input", () => { this.cancelReview(); this.render(); if (!this.rangeError.textContent) { this.app.workspace.layoutChanged(); } });
    }
    dates.append(this.button("Reset dates", "reset-dates", () => {
      this.from.value = ""; this.through.value = ""; this.cancelReview(); this.render(); this.app.workspace.layoutChanged();
    }));
    const hint = document.createElement("span"); hint.textContent = "Local dates; Through includes the whole day."; dates.append(hint);
    this.rangeError.className = "plugin-error"; this.rangeError.setAttribute("role", "alert"); this.rangeError.dataset.webHistoryDateError = "";
    this.confirmation.className = "web-history-confirm"; this.confirmation.hidden = true;
    this.confirmation.setAttribute("role", "group"); this.confirmation.setAttribute("aria-label", "Review history removal");
    this.confirmation.append(document.createElement("span"), this.button("Clear saved visits", "confirm-clear", () => this.confirmRemoval()),
      this.button("Cancel", "cancel-clear", () => { this.cancelReview(); this.search.focus(); }));
    this.status.setAttribute("role", "status"); this.status.dataset.webHistoryStatus = "";
    this.error.className = "plugin-error"; this.error.setAttribute("role", "alert"); this.error.dataset.webHistoryError = "";
    this.list.className = "web-history-list"; this.list.dataset.webHistoryList = "";
    this.contentEl.append(heading, description, controls, dates, this.rangeError, this.confirmation, this.status, this.error, this.list);
    this.registerDomEvent(this.search, "input", () => { this.cancelReview(); this.render(); this.app.workspace.layoutChanged(); });
    this.registerDomEvent(this.confirmation, "keydown", event => {
      if ((event as KeyboardEvent).key === "Escape") { event.preventDefault(); event.stopPropagation(); this.cancelReview(); this.search.focus(); }
    });
    this.registerDomEvent(this.recording, "change", () => {
      const recording = this.recording.checked;
      void this.perform(() => this.provider.history.setRecording(recording, () => !this.disposed));
    });
  }
  getViewType(): string { return "webviewer-history"; }
  getDisplayText(): string { return "Web history"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), query: this.search.value, ...this.rangeState }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    const dates = historyDateRange(state);
    this.cancelReview();
    this.search.value = typeof state.query === "string" ? state.query.slice(0, 1024) : "";
    this.from.value = dates.fromDate; this.through.value = dates.throughDate;
    this.rangeState = { fromDate: dates.fromDate, throughDate: dates.throughDate };
    await super.setState(state, result);
    this.render();
  }
  override focus(): void { this.search.focus(); }
  protected override async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("webviewer:update-history", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.visitMenu?.hide()));
    this.registerEvent(this.leaf.on("pinned-change", () => this.visitMenu?.hide()));
    this.register(() => this.visitMenu?.hide());
    await this.refresh();
  }
  protected override async unloadViewContent(): Promise<void> { this.disposed = true; this.visitMenu?.hide(); this.revision++; this.cancelReview(); this.snapshot = null; }
  private reviewCurrent(snapshot: WebHistorySnapshot): boolean {
    return this._loaded && !this.disposed && !this.refreshing && this.leaf.view === this && !this.app.changingVault && !this.app.core.busy
      && this.app.core.isEnabled(this.provider.id) && Boolean(snapshot.document.root) && snapshot.document.root === this.app.vault.rootPath;
  }
  private cancelReview(): void { this.review = null; this.confirmation.hidden = true; }
  private dateRange(): WebHistoryDateBounds {
    if (this.from.validity.badInput || this.through.validity.badInput) { throw new Error("Enter complete dates in From and Through."); }
    return historyDateRange({ fromDate: this.from.value, throughDate: this.through.value });
  }
  private removalCurrent(review: HistoryRemovalReview): boolean {
    const current = this.review === review && this.snapshot === review.snapshot && this.revision === review.revision
      && (review.query === null || review.query === this.search.value) && this.reviewCurrent(review.snapshot);
    if (!current || review.query === null) { return current; }
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
    this.review = { snapshot, query, revision: this.revision, dates };
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
    await this.perform(() => review.query === null
      ? this.provider.history.edit(review.snapshot, null, () => this.removalCurrent(review))
      : this.provider.history.removeMatching(review.snapshot, review.query, () => this.removalCurrent(review), { fromDate: review.dates.fromDate, throughDate: review.dates.throughDate }));
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
    } else if (action === "remove") { await this.perform(() => this.provider.history.edit(snapshot, entry.id, () => this.reviewCurrent(snapshot))); }
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
  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.disposed) { return; }
    this.busy = true; this.error.textContent = ""; this.render();
    try { await action(); }
    catch (error) { this.showError(error); }
    finally {
      this.busy = false; this.cancelReview();
      await this.refresh();
    }
  }
  private async refresh(clearError = false): Promise<void> {
    if (this.disposed) { return; }
    this.cancelReview();
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
    let dates: WebHistoryDateBounds | null = null, entries: WebVisit[] = [];
    try {
      dates = this.dateRange(); this.rangeError.textContent = "";
      this.rangeState = { fromDate: dates.fromDate, throughDate: dates.throughDate };
      entries = snapshot?.history.newest(this.search.value, dates) ?? [];
    } catch (error) { this.rangeError.textContent = error instanceof Error ? error.message : String(error); }
    this.recording.checked = snapshot?.history.recording ?? true;
    this.recording.disabled = !snapshot || this.busy || this.refreshing;
    this.clear.disabled = !snapshot?.history.entries.length || this.busy || this.refreshing;
    this.removeMatching.disabled = !dates || !(this.search.value.trim() || dates.fromDate || dates.throughDate) || this.search.value.length > 1024 || !entries.length || this.busy || this.refreshing;
    this.confirmation.querySelectorAll("button").forEach(button => button.disabled = this.busy || this.refreshing);
    this.status.textContent = this.refreshing ? "Refreshing history…" : !snapshot ? "History unavailable" : !dates ? "Choose a valid date range." : `${entries.length} of ${snapshot.history.entries.length} saved visits${snapshot.history.recording ? "" : " · Recording paused"}`;
    this.list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("li"); row.dataset.webHistoryId = entry.id;
      const open = document.createElement("button"); open.type = "button"; open.className = "web-history-open"; open.dataset.webHistoryUrl = entry.url;
      open.disabled = this.busy || this.refreshing; open.title = entry.url; open.setAttribute("aria-keyshortcuts", "Shift+F10");
      const title = document.createElement("strong"); title.textContent = entry.title || entry.url;
      const address = document.createElement("span"); address.textContent = entry.url;
      const time = document.createElement("time"); time.dateTime = new Date(entry.visitedAt).toISOString(); time.textContent = new Date(entry.visitedAt).toLocaleString();
      open.append(title, address, time);
      // Rebuilt rows own their listeners; do not accumulate component cleanups.
      open.addEventListener("click", () => { void this.provider.openUrl(entry.url, true).catch(error => this.showError(error)); });
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.dataset.webHistoryAction = "remove";
      remove.disabled = this.busy || this.refreshing; remove.setAttribute("aria-label", "Remove visit to " + (entry.title || entry.url));
      remove.addEventListener("click", () => { void this.perform(() => this.provider.history.edit(snapshot!, entry.id, () => !this.disposed)); });
      row.addEventListener("contextmenu", event => {
        event.preventDefault(); event.stopPropagation(); open.focus();
        this.showVisitMenu(snapshot!, entry, { x: event.clientX, y: event.clientY });
      });
      row.addEventListener("keydown", event => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) { return; }
        event.preventDefault(); event.stopPropagation(); open.focus(); open.scrollIntoView({ block: "nearest" });
        const bounds = open.getBoundingClientRect(); this.showVisitMenu(snapshot!, entry, { x: bounds.left, y: bounds.bottom });
      });
      row.append(open, remove); this.list.append(row);
    }
    if (snapshot && !entries.length) {
      const empty = document.createElement("li"); empty.textContent = !dates ? "Choose a valid date range." : this.search.value || dates.fromDate || dates.throughDate ? "No matching visits." : "No saved visits."; this.list.append(empty);
    }
  }
}
