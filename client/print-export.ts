import type { App } from "./app";
import { getBrowserHost } from "./contracts";
import { reportError } from "./dom";
import type { EventRef } from "./events";
import { Component } from "./plugin";
import { createMarkdownRenderer } from "./reading";
import { Modal } from "./ui";
import { MarkdownView } from "./workspace";
import { DEFAULT_PRINT_OPTIONS, MAX_PRINT_SOURCE, PRINT_PAGE_SIZES, printPageRule, validatePrintOptions, type PrintExportOptions } from "./print-export-model";

const bridgeKey = Symbol.for("slopsidian.print-export");
type PrintBridge = { isCurrent(id: string): boolean };
const bridgeScope = globalThis as typeof globalThis & { [bridgeKey]?: PrintBridge };
const nativeHost = (): boolean => !getBrowserHost() && typeof require === "function";

const printStyles = `
.print-export-modal { width: min(1000px, 90vw); max-width: 90vw; }
.print-export-options { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin:12px 0; }
.print-export-options label { display:inline-flex; align-items:center; gap:6px; }
.print-export-preview-container { max-height:55vh; overflow:auto; padding:8px; background:#ddd; border:1px solid var(--background-modifier-border); }
.print-export-document { box-sizing:border-box; width:100%; max-width:210mm; padding:16px; margin:0 auto; background:white; color:#222; font-size:11pt; line-height:1.5; overflow-wrap:anywhere;
  --text-normal:#222; --text-muted:#555; --text-faint:#666; --text-accent:#285b9d; --text-error:#a11; --background-primary:white; --background-secondary:#f5f5f5; --background-modifier-border:#bbb;
  --code-comment:#626970; --code-keyword:#783aa2; --code-string:#386b29; --code-value:#965100; --code-function:#285b9d; --code-tag:#a52a32; --code-property:#795500; }
.print-export-document .markdown-preview-view { color:#222; background:white; overflow:visible; height:auto; max-height:none; padding:0; }
.print-export-document .markdown-preview-sizer { max-width:none; width:auto; margin:0; padding:0; }
.print-export-document .print-export-title { margin:0 0 1em; }
.print-export-document pre { white-space:pre-wrap; overflow-wrap:anywhere; }
.print-export-document pre code { white-space:pre-wrap; }
.print-export-document img, .print-export-document svg { max-width:100%; }
.print-export-document .mermaid-diagram[data-mermaid-status=ready] > details { display:none; }
@media screen { body > [data-print-export-document] { position:fixed; left:-100000px; top:0; width:210mm; pointer-events:none; } }
@media print {
  html:has(body[data-print-export-active]), body[data-print-export-active] { display:block !important; overflow:visible !important; height:auto !important; min-height:0 !important; margin:0 !important; padding:0 !important; background:white !important; }
  body[data-print-export-active] > :not([data-print-export-document]) { display:none !important; }
  body[data-print-export-active] > [data-print-export-document] { display:block !important; position:static !important; inset:auto !important; width:auto !important; max-width:none !important; min-height:0 !important; height:auto !important; margin:0 !important; padding:0 !important; border:0 !important; box-shadow:none !important; overflow:visible !important; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
  [data-print-export-document] .markdown-preview-view, [data-print-export-document] .markdown-preview-sizer { display:block !important; width:auto !important; max-width:none !important; height:auto !important; max-height:none !important; overflow:visible !important; padding:0 !important; }
  [data-print-export-document] :is(h1,h2,h3,h4,h5,h6) { break-after:avoid; }
  [data-print-export-document] :is(img,svg,figure,.math-display,.mermaid-diagram) { break-inside:avoid; }
  [data-print-export-document] table { display:table; width:auto; max-width:100%; }
  [data-print-export-document] thead { display:table-header-group; }
  [data-print-export-document] tr { break-inside:avoid; }
}
`;

function activeNote(app: App): MarkdownView | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  return view?.isLoaded && view.file && view.session && view.contentEl.ownerDocument === document
    && !app.changingVault && !app.workspace.isChangingFiles && !app.workspace.isChangingLayout
    && app.vault.getFileByPath(view.file.path) === view.file ? view : null;
}

function snapshot(app: App, view: MarkdownView): { source: string; path: string; title: string; current(): boolean } {
  const file = view.file!, session = view.session!, root = app.vault.rootPath, source = session.text, path = file.path;
  return { source, path, title: file.basename,
    current: () => activeNote(app) === view && app.vault.rootPath === root && view.session === session && view.file === file
      && file.path === path && session.originRoot === root && session.text === source };
}

async function readyAssets(root: HTMLElement, current: () => boolean, signal: AbortSignal): Promise<void> {
  const deadline = performance.now() + 20_000;
  const check = (): void => {
    if (signal.aborted) { throw new DOMException("Print preview was closed.", "AbortError"); }
    if (!current()) { throw new Error("The note changed. Close this preview and export it again."); }
    if (performance.now() > deadline) { throw new Error("Some images or diagrams did not finish rendering. Close this preview and try again."); }
  };
  while (true) {
    check();
    const pending = root.querySelector('[data-mermaid-status="pending"]')
      || [...root.querySelectorAll("img")].some(image => !image.getAttribute("src") || !image.complete);
    if (!pending) { break; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  if (document.fonts) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = (): void => { rejectAbort(new DOMException("Print preview was closed.", "AbortError")); };
    let rejectAbort!: (reason: unknown) => void;
    const canceled = new Promise((_, reject) => { rejectAbort = reject; signal.addEventListener("abort", aborted, { once: true }); });
    try { await Promise.race([document.fonts.ready, canceled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fonts did not finish loading for printing.")), Math.max(1, deadline - performance.now())); })]); }
    finally { signal.removeEventListener("abort", aborted); if (timer !== undefined) { clearTimeout(timer); } }
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check();
}

/** A snapshot is rendered once; exporting never calls Save or changes the source editor. */
export class PrintExportModal extends Modal {
  private readonly owner = new Component();
  private readonly abort = new AbortController();
  private readonly previewHost = document.createElement("div");
  private readonly preview = document.createElement("article");
  private readonly title = document.createElement("h1");
  private readonly pageStyle = document.createElement("style");
  private readonly styles = document.createElement("style");
  private readonly status = document.createElement("p");
  private readonly printButton = document.createElement("button");
  private readonly pdfButton = document.createElement("button");
  private readonly source: ReturnType<typeof snapshot>;
  private readonly options: PrintExportOptions = { ...DEFAULT_PRINT_OPTIONS };
  private readonly jobId = crypto.randomUUID();
  private readonly references: EventRef[] = [];
  private state: "preparing" | "ready" | "stale" | "error" | "closed" = "preparing";
  private busy = false;
  private submission: Promise<void> = Promise.resolve();
  private disposing: Promise<void> = Promise.resolve();
  private finishBrowser: (() => void) | null = null;

  constructor(app: App, view: MarkdownView, private readonly closed: () => void) {
    super(app); this.source = snapshot(app, view);
    this.setTitle(nativeHost() ? "Print / export note to PDF" : "Print / save note as PDF");
    this.modalEl.classList.add("print-export-modal"); this.modalEl.dataset.printExportDialog = "true";
    const summary = document.createElement("p"); summary.textContent = this.source.path + " — preview of the current text, including unsaved edits.";
    const options = document.createElement("div"); options.className = "print-export-options";
    const select = (labelText: string, name: string, choices: readonly [string, string][], value: string, changed: (value: string) => void): void => {
      const label = document.createElement("label"), field = document.createElement("select");
      label.append(document.createTextNode(labelText)); field.dataset.printExportOption = name;
      for (const [value, text] of choices) { const option = document.createElement("option"); option.value = value; option.textContent = text; field.append(option); }
      field.value = value; field.addEventListener("change", () => { if (!this.busy && this.state !== "closed") { changed(field.value); this.applyOptions(); } }, { signal: this.abort.signal });
      label.append(field); options.append(label);
    };
    select("Paper", "pageSize", PRINT_PAGE_SIZES.map(value => [value, value]), this.options.pageSize, value => { this.options.pageSize = value as PrintExportOptions["pageSize"]; });
    select("Orientation", "orientation", [["portrait", "Portrait"], ["landscape", "Landscape"]], "portrait", value => { this.options.landscape = value === "landscape"; });
    select("Margins", "margin", [["normal", "Normal"], ["minimal", "Minimal"], ["none", "None"]], this.options.margin, value => { this.options.margin = value as PrintExportOptions["margin"]; });
    const label = document.createElement("label"), include = document.createElement("input"); include.type = "checkbox"; include.checked = true; include.dataset.printExportOption = "includeName";
    include.addEventListener("change", () => { if (!this.busy) { this.options.includeName = include.checked; this.applyOptions(); } }, { signal: this.abort.signal });
    label.append(include, document.createTextNode("Include file name")); options.append(label);
    this.title.textContent = this.source.title; this.title.className = "print-export-title";
    this.preview.className = "print-export-document"; this.preview.dataset.printExportDocument = "true"; this.preview.dataset.printExportJob = this.jobId; this.preview.dataset.printExportState = "preparing";
    this.preview.setAttribute("role", "document"); this.preview.setAttribute("aria-label", "Printable note preview");
    this.preview.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true, signal: this.abort.signal });
    this.preview.append(this.title); this.previewHost.className = "print-export-preview-container"; this.previewHost.append(this.preview);
    this.status.dataset.printExportStatus = "true"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite"); this.status.textContent = "Preparing note preview…";
    const actions = document.createElement("div"); actions.className = "modal-button-container";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Close"; cancel.dataset.printExportAction = "close"; cancel.addEventListener("click", () => this.close(), { signal: this.abort.signal });
    this.printButton.type = "button"; this.printButton.textContent = nativeHost() ? "Print…" : "Print / save as PDF…"; this.printButton.dataset.printExportAction = "print";
    this.pdfButton.type = "button"; this.pdfButton.textContent = "Export PDF…"; this.pdfButton.dataset.printExportAction = "pdf"; this.pdfButton.hidden = !nativeHost();
    this.printButton.addEventListener("click", () => this.startSubmit(false), { signal: this.abort.signal });
    this.pdfButton.addEventListener("click", () => this.startSubmit(true), { signal: this.abort.signal });
    actions.append(cancel, this.printButton, this.pdfButton);
    if (!nativeHost()) { const hint = document.createElement("p"); hint.textContent = "Your browser opens its print dialog. Choose Save as PDF there; printer and final PDF settings are controlled by the browser."; this.contentEl.append(hint); }
    this.contentEl.append(summary, options, this.status, this.previewHost, actions);
    this.styles.textContent = printStyles; this.applyOptions(); this.syncControls();
  }

  override onOpen(): void {
    document.head.append(this.styles, this.pageStyle);
    for (const name of ["editor-change", "file-open", "active-leaf-change"]) {
      const reference = this.app.workspace.on(name, () => { if (this.state === "ready" && !this.source.current()) { this.invalidate(); } });
      this.references.push(reference);
    }
    void this.prepare();
  }

  private applyOptions(): void {
    this.pageStyle.textContent = printPageRule(this.options); this.title.hidden = !this.options.includeName;
    this.preview.style.maxWidth = this.options.landscape ? "297mm" : "210mm";
  }
  private syncControls(): void {
    this.printButton.disabled = this.pdfButton.disabled = this.busy || this.state !== "ready";
    for (const input of this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-print-export-option]")) { input.disabled = this.busy || this.state === "closed"; }
    this.modalEl.setAttribute("aria-busy", String(this.state === "preparing" || this.busy));
  }
  private invalidate(): void {
    this.state = "stale"; this.preview.dataset.printExportState = "stale";
    this.status.textContent = "The note changed. Close this preview and export it again."; this.syncControls();
  }
  private current = (): boolean => this.isOpen && this.state !== "closed" && this.source.current() && this.owner.isLoaded;

  private async prepare(): Promise<void> {
    try {
      if (this.source.source.length > MAX_PRINT_SOURCE) { throw new Error("Print preview supports notes up to 1,048,576 UTF-16 code units."); }
      await this.owner.load();
      if (!this.current()) { throw new Error("The note changed before print preparation."); }
      await createMarkdownRenderer(this.app).render(this.app, this.source.source, this.preview, this.source.path, this.owner);
      await readyAssets(this.preview, this.current, this.abort.signal);
      if (!this.current()) { throw new Error("The note changed before print preparation."); }
      // App-only navigation is not a useful exported PDF destination. Footnote anchors remain local.
      this.preview.querySelectorAll<HTMLAnchorElement>("a.internal-link,a.tag").forEach(link => link.removeAttribute("href"));
      this.preview.querySelectorAll<HTMLDetailsElement>("details.callout").forEach(detail => { detail.open = true; });
      this.state = "ready"; this.preview.dataset.printExportState = "ready";
      this.status.textContent = this.preview.querySelector(".reading-embed-error,.mermaid-status.is-error") ? "Preview ready. Unavailable embeds will be printed with the visible error text." : "Preview ready. The original note is unchanged.";
    } catch (error) {
      if (this.state !== "closed") { this.state = "error"; this.preview.dataset.printExportState = "error"; this.status.textContent = error instanceof Error ? error.message : String(error); }
    } finally { this.syncControls(); }
  }

  private startSubmit(pdf: boolean): void {
    if (!this.busy && this.state === "ready" && this.isOpen) { this.submission = this.submit(pdf); }
  }
  private async submit(pdf: boolean): Promise<void> {
    if (this.busy || this.state !== "ready" || !this.isOpen) { return; }
    if (!this.current()) { this.invalidate(); return; }
    if (bridgeScope[bridgeKey]) { this.status.textContent = "Finish the current print request before starting another."; return; }
    this.busy = true; this.syncControls();
    delete this.status.dataset.printExportSaved;
    const bridge: PrintBridge = { isCurrent: id => id === this.jobId && this.current() && this.state === "ready" && this.preview.parentElement === document.body };
    bridgeScope[bridgeKey] = bridge;
    document.body.append(this.preview); document.body.dataset.printExportActive = this.jobId;
    try {
      this.applyOptions();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!bridge.isCurrent(this.jobId)) { throw new Error("The note or print preview changed. Nothing was exported."); }
      if (pdf) {
        if (!nativeHost()) { throw new Error("Use the browser's Print / save as PDF action."); }
        this.status.textContent = "Choose a PDF destination in the Save dialog…";
        const options = validatePrintOptions(this.options);
        const result: unknown = await require("electron").ipcRenderer.invoke("vault:print-export", { jobId: this.jobId, title: this.source.title, pageSize: options.pageSize, landscape: options.landscape, margin: options.margin });
        if (!result || typeof result !== "object" || !("canceled" in result) || typeof result.canceled !== "boolean") { throw new Error("The desktop returned an invalid PDF export result."); }
        if (!this.isOpen) { return; }
        if (result.canceled) { this.status.textContent = "PDF export canceled. The note is unchanged."; }
        else if ("filePath" in result && typeof result.filePath === "string") { this.status.textContent = "PDF saved to " + result.filePath; this.status.dataset.printExportSaved = result.filePath; }
        else { throw new Error("The desktop did not confirm the saved PDF."); }
      } else {
        this.status.textContent = "Finish the browser's print dialog, or close this preview to cancel the print request.";
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const done = (): void => { if (finished) { return; } finished = true; window.removeEventListener("afterprint", done); this.finishBrowser = null; resolve(); };
          this.finishBrowser = done; window.addEventListener("afterprint", done, { once: true });
          try { window.print(); } catch (error) { window.removeEventListener("afterprint", done); this.finishBrowser = null; reject(error); }
        });
        if (this.isOpen) { this.status.textContent = "Print dialog closed. Saving a PDF or printing is controlled by your browser."; }
      }
    } catch (error) {
      if (this.isOpen) { this.status.textContent = error instanceof Error ? error.message : String(error); }
    } finally {
      if (bridgeScope[bridgeKey] === bridge) { delete bridgeScope[bridgeKey]; }
      if (document.body.dataset.printExportActive === this.jobId) { delete document.body.dataset.printExportActive; }
      if (this.isOpen) { this.previewHost.append(this.preview); }
      this.busy = false;
      if (this.isOpen && !this.source.current()) { this.invalidate(); } else { this.syncControls(); }
    }
  }

  override onClose(): void {
    this.state = "closed"; this.preview.dataset.printExportState = "closed"; this.abort.abort(); this.finishBrowser?.();
    for (const reference of this.references) { reference.emitter.offref(reference); } this.references.length = 0;
    if (document.body.dataset.printExportActive === this.jobId) { delete document.body.dataset.printExportActive; delete bridgeScope[bridgeKey]; }
    this.preview.remove(); this.styles.remove(); this.pageStyle.remove();
    // Keep owned resources alive until native generation returns, even when its
    // UI has already closed. The invalidated bridge refuses late publication.
    this.disposing = this.submission.then(() => this.owner.unloadAndWait()); this.disposing.catch(reportError); this.closed();
  }
  async dispose(): Promise<void> { this.close(); await this.disposing; }
}

/** Main-window export is available in Source, Live Preview and Reading, including read-only vaults. */
export function registerPrintExportCommands(app: App): () => Promise<void> {
  let modal: PrintExportModal | null = null;
  const draining = new Set<PrintExportModal>();
  const show = (checking: boolean): boolean => {
    const view = activeNote(app); if (!view) { return false; }
    if (!checking) {
      if (modal?.isOpen) { return true; }
      const next = new PrintExportModal(app, view, () => {
        if (modal === next) { modal = null; }
        void next.dispose().then(() => { draining.delete(next); }, reportError);
      });
      draining.add(next); modal = next; modal.open();
    }
    return true;
  };
  const removeCommands = app.commands.install([
    { id: "workspace:export-pdf", name: "Export current note to PDF", checkCallback: show },
    { id: "workspace:print", name: "Print current note", checkCallback: show },
  ]);
  const leave = app.registerLeaveGuard(async () => { await Promise.all([...draining].map(dialog => dialog.dispose())); });
  return async () => { removeCommands(); try { await Promise.all([...draining].map(dialog => dialog.dispose())); } finally { leave(); } };
}
