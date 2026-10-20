import type { App } from "./app";
import { Modal } from "./ui";
import type { WebFilters } from "./web-filters";
import { WEB_FILTER_COUNT_LIMIT, type WebFilterReview, type WebFilterSubscription } from "./web-filters-model";

const number = (value: number): string => value.toLocaleString("en-US");
const size = (bytes: number): string => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MiB" : Math.max(1, Math.round(bytes / 1024)) + " KiB";

export class WebFiltersModal extends Modal {
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly options = document.createElement("div");
  private readonly list = document.createElement("div");
  private readonly add = document.createElement("form");
  private readonly address = document.createElement("input");
  private readonly download = document.createElement("button");
  private readonly reviewPanel = document.createElement("div");
  private pending: { review: WebFilterReview; id: string | null } | null = null;
  private busy = false;
  private rendering = 0;
  private stale = false;

  constructor(app: App, private readonly filters: WebFilters, private readonly closed: () => void) {
    super(app); this.setTitle("Ad filter subscriptions"); this.modalEl.setAttribute("aria-label", "Ad filter subscriptions");
    this.contentEl.dataset.webFilters = ""; this.contentEl.style.display = "grid"; this.contentEl.style.gap = "14px";
    this.status.dataset.webFiltersStatus = ""; this.status.setAttribute("role", "status");
    this.error.className = "plugin-error"; this.error.dataset.webFiltersError = ""; this.error.setAttribute("role", "alert"); this.error.hidden = true;
    this.options.dataset.webFiltersOptions = ""; this.list.dataset.webFiltersList = ""; this.list.style.display = "grid"; this.list.style.gap = "8px";
    this.address.type = "url"; this.address.required = true; this.address.maxLength = 2048; this.address.placeholder = "https://example.com/filters.txt";
    this.address.setAttribute("aria-label", "Filter list address"); this.address.dataset.webFiltersAddress = "";
    this.download.type = "submit"; this.download.textContent = "Download for review"; this.download.dataset.webFiltersAction = "download";
    this.add.style.display = "flex"; this.add.style.gap = "8px"; this.address.style.flex = "1";
    this.add.append(this.address, this.download);
    this.add.addEventListener("submit", event => { event.preventDefault(); void this.downloadList(null, this.address.value); });
    this.reviewPanel.dataset.webFiltersReview = ""; this.reviewPanel.hidden = true; this.reviewPanel.style.display = "none";
    const note = document.createElement("p");
    note.textContent = "Lists are downloaded only when you press Download or Update, and are never changed until you accept a review. Network and static hide rules are used; scripts, scriptlets and extended selectors in lists are never run. Reload pages after accepting a change to apply it to resources already loaded.";
    this.contentEl.append(this.status, this.error, this.options, this.list, this.add, this.reviewPanel, note);
    this.ref = this.app.workspace.on("webviewer:update-filters", () => { void this.render(); });
  }
  private readonly ref: ReturnType<App["workspace"]["on"]>;
  private notice = "";
  override onOpen(): void { void this.render(); this.address.focus(); }
  override onClose(): void { this.stale = true; this.app.workspace.offref(this.ref); this.closed(); }
  invalidate(): void {
    if (!this.isOpen) { return; }
    this.stale = true; this.pending = null; this.showError(new Error("The vault or Web viewer changed. Close and reopen Ad filters.")); this.setBusy(true);
  }
  private showError(issue: unknown): void { this.error.textContent = issue instanceof Error ? issue.message : String(issue); this.error.hidden = false; }
  private setBusy(value: boolean): void {
    this.busy = value;
    for (const control of this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) { control.disabled = value; }
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.stale) { return; }
    this.error.hidden = true; this.notice = ""; this.setBusy(true);
    try { await action(); } catch (error) { if (this.isOpen) { this.showError(error); } }
    finally { if (!this.stale) { this.setBusy(false); } }
    if (this.isOpen && !this.stale) { await this.render(); }
  }
  private button(label: string, action: string, click: () => void, cta = false): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.dataset.webFiltersAction = action;
    if (cta) { button.className = "mod-cta"; }
    button.addEventListener("click", click); return button;
  }
  private check(label: string, checked: boolean, change: (value: boolean) => Promise<unknown>, action: string): HTMLLabelElement {
    const wrap = document.createElement("label"); wrap.style.display = "flex"; wrap.style.gap = "8px"; wrap.style.alignItems = "center";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked; input.dataset.webFiltersAction = action;
    input.addEventListener("change", () => { void this.run(async () => { await change(input.checked); }); });
    wrap.append(input, label); return wrap;
  }
  private summary(item: WebFilterReview): string {
    const { stats } = item;
    return `${number(stats.network)} blocking, ${number(stats.exceptions)} exception and ${number(stats.cosmetic)} hide rules · ${size(item.bytes)}`
      + (stats.unsupported ? ` · ${number(stats.unsupported)} script or extended-selector rules not supported and never run` : "")
      + (stats.ignored ? ` · ${number(stats.ignored)} unsupported or invalid lines ignored` : "");
  }
  async render(): Promise<void> {
    const token = ++this.rendering;
    if (!this.isOpen || this.stale) { return; }
    let snapshot;
    try { snapshot = await this.filters.read(); }
    catch (error) { if (token === this.rendering && this.isOpen) { this.showError(error); this.status.textContent = "Ad filter settings are unavailable."; } return; }
    if (token !== this.rendering || !this.isOpen || this.stale) { return; }
    const { model } = snapshot, applied = this.filters.applied;
    this.status.textContent = (this.filters.error ? "The previous filter engine remains active. " + this.filters.error
      : applied ? `Active filter set ${applied.generation}: ${applied.bundled ? "bundled EasyList" : "no bundled list"} + ${applied.lists.length} custom list${applied.lists.length === 1 ? "" : "s"}.` : "Filters are being prepared.")
      + (this.notice ? " " + this.notice : "");
    this.options.replaceChildren(
      this.check("Use the bundled EasyList snapshot", model.bundled, value => this.filters.setOption("bundled", value), "bundled"),
      this.check("Hide ad elements with static cosmetic rules", model.cosmetic, value => this.filters.setOption("cosmetic", value), "cosmetic"));
    this.list.replaceChildren(...(model.subscriptions.length ? model.subscriptions.map(item => this.row(item)) : [Object.assign(document.createElement("p"), { textContent: "No custom subscriptions. Add a list address below." })]));
    if (!this.busy) { this.setBusy(false); }
    this.download.disabled = this.busy || model.subscriptions.length >= WEB_FILTER_COUNT_LIMIT;
  }
  private row(item: WebFilterSubscription): HTMLElement {
    const row = document.createElement("div"); row.dataset.webFiltersItem = item.id; row.style.display = "grid"; row.style.gap = "4px";
    const title = document.createElement("strong"); title.textContent = item.name;
    const detail = document.createElement("span"); detail.textContent = `${item.url} · ${this.summary(item)} · updated ${item.retrievedAt.slice(0, 10)}${item.version ? " · version " + item.version : ""}`;
    detail.style.overflowWrap = "anywhere";
    const controls = document.createElement("div"); controls.style.display = "flex"; controls.style.gap = "8px"; controls.style.flexWrap = "wrap";
    controls.append(this.check("Enabled", item.enabled, value => this.filters.setEnabled(item.id, value), "enable"),
      this.button("Update", "update", () => { void this.downloadList(item.id, item.url); }),
      this.button("Remove", "remove", () => { void this.run(async () => { await this.filters.remove(item.id); this.pending = null; this.showReview(); }); }));
    row.append(title, detail, controls); return row;
  }
  private async downloadList(id: string | null, address: string): Promise<void> {
    await this.run(async () => {
      this.pending = null; this.showReview();
      const review = await this.filters.review(address);
      const existing = id ? (await this.filters.read()).model.find(id) : undefined;
      this.pending = { review, id }; this.showReview(existing);
    });
  }
  private showReview(existing?: WebFilterSubscription): void {
    this.reviewPanel.replaceChildren();
    if (!this.pending) { this.reviewPanel.hidden = true; this.reviewPanel.style.display = "none"; return; }
    const { review, id } = this.pending;
    this.reviewPanel.hidden = false; this.reviewPanel.style.display = "grid"; this.reviewPanel.style.gap = "8px";
    const heading = document.createElement("strong"); heading.textContent = "Review: " + (review.title || review.url);
    const summary = document.createElement("p"); summary.dataset.webFiltersReviewSummary = "";
    const unchanged = existing?.sha256 === review.sha256;
    summary.textContent = `${review.url} · ${this.summary(review)} · SHA-256 ${review.sha256.slice(0, 16)}…`
      + (existing ? unchanged ? " · identical to the accepted list" : ` · replaces ${number(existing.stats.network + existing.stats.exceptions + existing.stats.cosmetic)} accepted rules` : "");
    const buttons = document.createElement("div"); buttons.className = "modal-button-container";
    buttons.append(this.button("Discard", "discard", () => { this.pending = null; this.showReview(); }),
      this.button(unchanged ? "Keep current list" : id ? "Accept update" : "Accept and apply", "accept", () => {
        void this.run(async () => {
          const result = await this.filters.accept(review, id, "");
          this.pending = null; this.showReview();
          this.notice = result.changed ? "Accepted and applied." : "Already up to date.";
        });
      }, true));
    this.reviewPanel.append(heading, summary, buttons);
  }
}
