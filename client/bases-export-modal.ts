import type { App } from "./app";
import type { BaseResult } from "./bases-model";
import { Modal } from "./ui";
import { baseExportTable, serializeBaseExport, baseExportFilename, type BaseExportTable, type BaseExportText } from "./bases-export";

/** A review belongs to one exact query/source owner. Clipboard writes cannot be revoked once invoked. */
export class BaseExportModal extends Modal {
  private table: BaseExportTable | null = null;
  private rendered: BaseExportText | null = null;
  private readonly format = document.createElement("select");
  private readonly protect = document.createElement("input");
  private readonly preview = document.createElement("textarea");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly downloads = new Map<string, ReturnType<typeof setTimeout>>();
  private busy = false;
  constructor(app: App, private readonly options: { title: string; current(): boolean; check(): Promise<void>; closed(): void }) {
    super(app); this.setTitle("Export base rows"); this.modalEl.dataset.basesExport = "";
    const help = document.createElement("p"), formatLabel = document.createElement("label"), protectLabel = document.createElement("label"), cancel = document.createElement("button");
    help.textContent = "All matching query rows after filters, search, sort, grouping and view limit are included, across every page and folded group. Display text only: empty/null are blank, links keep visible labels, lists and dates use their displayed text. Preview line breaks are shown as LF; CSV preserves embedded CR/LF. Clipboard line endings may be normalized by your system. Covers, group headings and summaries are excluded. Exports support up to 2,000 rows, 100,000 cells including headings and 2 MiB of serialized UTF-8 text; an incomplete or stale query is refused. No vault files are changed or saved.";
    this.format.setAttribute("aria-label", "Export format"); this.format.dataset.basesExportFormat = "";
    for (const [value, label] of [["csv", "CSV download"], ["tsv", "TSV clipboard"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; this.format.append(option); }
    formatLabel.append("Format ", this.format); this.protect.type = "checkbox"; this.protect.checked = true; this.protect.dataset.basesExportProtect = ""; protectLabel.append(this.protect, " Protect spreadsheet formulas (prefix an apostrophe in text cells and headings)");
    this.preview.readOnly = true; this.preview.rows = 12; this.preview.className = "bases-export-preview"; this.preview.dataset.basesExportPreview = ""; this.preview.setAttribute("aria-label", "Export text preview");
    this.status.dataset.basesExportStatus = ""; this.status.setAttribute("role", "status"); this.error.dataset.basesExportError = ""; this.error.className = "plugin-error"; this.error.setAttribute("role", "alert");
    this.action.type = cancel.type = "button"; this.action.dataset.basesExportPublish = ""; this.action.disabled = true; cancel.dataset.basesExportCancel = ""; cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close()); this.action.addEventListener("click", () => { void this.publish(); });
    for (const node of [this.format, this.protect]) { node.addEventListener("change", () => { if (!this.busy && this.isOpen && this.options.current()) { this.render(); } }); }
    this.contentEl.append(help, formatLabel, protectLabel, this.status, this.preview, this.error, this.action, cancel); this.render();
  }
  setResult(result: BaseResult): void { if (!this.isOpen || !this.options.current()) { return; } this.table = baseExportTable(result); this.render(); }
  fail(issue: unknown): void { if (!this.isOpen || !this.options.current()) { return; } this.table = null; this.rendered = null; this.action.disabled = true; this.preview.value = ""; this.error.textContent = issue instanceof Error ? issue.message : String(issue); }
  private render(): void {
    this.action.textContent = this.format.value === "tsv" ? "Copy TSV" : "Download CSV"; this.error.textContent = ""; this.rendered = null;
    if (!this.table) { this.status.textContent = "Preparing the complete current query…"; this.action.disabled = true; return; }
    try {
      this.rendered = serializeBaseExport(this.table, this.format.value as "csv" | "tsv", this.protect.checked); this.preview.value = this.rendered.text;
      this.status.textContent = `${this.table.rows.length} rows · ${this.table.headers.length} columns · ${this.rendered.bytes} serialized UTF-8 bytes · ${this.rendered.protectedCells} protected cells` + (this.table.matched !== this.table.rows.length ? ` · ${this.table.matched} rows before view limit` : "") + (this.table.warnings.length ? " · Query warnings: " + this.table.warnings.join("; ") : ""); this.action.disabled = false;
    } catch (error) { this.fail(error); }
  }
  private async publish(): Promise<void> {
    const accepted = this.rendered, format = this.format.value, protect = this.protect.checked;
    const owns = (): boolean => this.isOpen && this.containerEl.isConnected && this.options.current() && this.rendered === accepted && this.format.value === format && this.protect.checked === protect;
    if (this.busy || !accepted || !owns()) { return; }
    this.busy = true; this.action.disabled = this.format.disabled = this.protect.disabled = true;
    try {
      await this.options.check(); if (!owns()) { throw new Error("The query or export review changed. Open its current export again."); }
      if (format === "tsv") {
        // Invocation is inside this explicit user action. A later retirement cannot undo the OS write.
        if (!navigator.clipboard?.writeText) { throw new Error("Clipboard access requires the desktop application or a supported secure browser."); }
        await navigator.clipboard.writeText(accepted.text); if (owns()) { this.status.textContent += " · Clipboard write acknowledged; your system may normalize line endings."; }
      } else {
        const url = URL.createObjectURL(new Blob([accepted.text], { type: "text/csv;charset=utf-8" }));
        const timer = setTimeout(() => this.release(url), 1000); this.downloads.set(url, timer);
        try { const link = document.createElement("a"); link.href = url; link.download = baseExportFilename(this.options.title); link.click(); }
        catch (error) { this.release(url); throw error; }
        if (owns()) { this.status.textContent += " · Download requested."; }
      }
    } catch (error) { if (owns()) { this.error.textContent = error instanceof Error ? error.message : String(error); } }
    finally { this.busy = false; this.format.disabled = this.protect.disabled = false; if (owns()) { this.action.disabled = false; } }
  }
  private release(url: string): void { const timer = this.downloads.get(url); if (timer !== undefined) { clearTimeout(timer); this.downloads.delete(url); URL.revokeObjectURL(url); } }
  override onClose(): void { this.table = null; this.rendered = null; for (const url of this.downloads.keys()) { this.release(url); } this.options.closed(); }
}
