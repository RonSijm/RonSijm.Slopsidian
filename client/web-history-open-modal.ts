import type { App } from "./app";
import { Modal } from "./ui";
import type { HistoryOpenReview } from "./web-history-open";
import { historyOrderLabel } from "./web-history-order";

export class WebHistoryOpenModal extends Modal {
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly confirm = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private valid = true;
  private attempted = false;
  busy = false;
  get available(): boolean { return this.isOpen && this.valid; }

  constructor(app: App, review: HistoryOpenReview, private readonly actions: { open: () => Promise<number>; closed: () => void }) {
    super(app); this.setTitle("Open selected history visits"); this.modalEl.setAttribute("aria-label", "Open selected history visits");
    this.contentEl.dataset.webHistoryOpen = "review";
    this.modalEl.style.width = "min(780px, 94vw)"; this.modalEl.style.maxHeight = "92vh";
    this.modalEl.style.display = "flex"; this.modalEl.style.flexDirection = "column";
    this.contentEl.style.cssText = "display:flex;flex-direction:column;gap:12px;min-height:0;overflow:hidden";
    const scroll = document.createElement("div"); scroll.style.cssText = "overflow-y:auto;min-height:0;overflow-wrap:anywhere";
    const hint = document.createElement("p");
    hint.textContent = "Open these checked visits in new Web viewer tabs, in the order shown below. Repeated addresses open once per checked visit. Up to 20 tabs can be opened at a time. Pages may make network requests and normal visit recording applies. Existing tabs and the history pane are kept.";
    this.status.dataset.webHistoryOpenStatus = ""; this.status.setAttribute("role", "status");
    this.status.textContent = review.entries.length + " selected " + (review.entries.length === 1 ? "visit" : "visits") + " · " + historyOrderLabel(review.order);
    const scope = document.createElement("p"); scope.dataset.webHistoryOpenScope = "";
    scope.textContent = "Search: " + (review.query || "(any)") + " · From: " + (review.fromDate || "(any)") + " · Through: " + (review.throughDate || "(any)");
    const list = document.createElement("ol"); list.dataset.webHistoryOpenVisits = "";
    for (const entry of review.entries) {
      const row = document.createElement("li"), title = document.createElement("strong"), address = document.createElement("div"), time = document.createElement("time");
      title.textContent = entry.title || entry.url; address.textContent = entry.url;
      time.dateTime = new Date(entry.visitedAt).toISOString(); time.textContent = time.dateTime;
      row.style.marginBottom = "12px"; row.append(title, address, time); list.append(row);
    }
    this.error.className = "plugin-error"; this.error.dataset.webHistoryOpenError = ""; this.error.setAttribute("role", "alert"); this.error.hidden = true;
    scroll.append(hint, this.status, scope, list, this.error);
    const buttons = document.createElement("div"); buttons.className = "modal-button-container"; buttons.style.flexShrink = "0";
    this.confirm.type = this.cancel.type = "button";
    this.confirm.textContent = "Open " + review.entries.length + (review.entries.length === 1 ? " tab" : " tabs");
    this.confirm.className = "mod-cta"; this.confirm.dataset.webHistoryOpenAction = "open";
    this.cancel.textContent = "Cancel"; this.cancel.dataset.webHistoryOpenAction = "cancel";
    this.confirm.addEventListener("click", () => { void this.openVisits(); }); this.cancel.addEventListener("click", () => this.close());
    buttons.append(this.cancel, this.confirm); this.contentEl.append(scroll, buttons);
  }
  override onOpen(): void { this.cancel.focus(); }
  private update(): void { this.confirm.disabled = this.busy || this.attempted || !this.valid; this.cancel.disabled = this.busy; }
  private async openVisits(): Promise<void> {
    if (!this.available || this.busy || this.attempted) { return; }
    this.busy = true; this.attempted = true; this.contentEl.dataset.webHistoryOpen = "opening";
    this.status.textContent = "Opening reviewed tabs…"; this.error.hidden = true; this.update();
    try {
      let opened = 0;
      await this.app.core.run(async () => { opened = await this.actions.open(); });
      if (this.isOpen) { this.status.textContent = "Opened " + opened + (opened === 1 ? " tab" : " tabs") + ". Pages may still be loading."; this.contentEl.dataset.webHistoryOpen = "complete"; }
    } catch (issue) {
      if (this.isOpen) {
        this.status.textContent = "Opening stopped. Already opened tabs are kept; review the remaining visits before trying again.";
        this.error.textContent = issue instanceof Error ? issue.message : String(issue); this.error.hidden = false; this.contentEl.dataset.webHistoryOpen = "stopped";
      }
    } finally { this.busy = false; this.cancel.textContent = "Done"; this.update(); }
  }
  invalidate(): void {
    if (!this.isOpen) { return; }
    this.valid = false;
    if (!this.attempted) {
      this.contentEl.dataset.webHistoryOpen = "expired"; this.status.textContent = "History review expired";
      this.error.textContent = "The history pane or its selected visits changed. Close this review and select the visits again."; this.error.hidden = false;
    }
    this.update();
  }
  override close(): void { if (!this.busy) { this.forceClose(); } }
  forceClose(): void { super.close(); }
  override onClose(): void { this.valid = false; this.actions.closed(); }
}
