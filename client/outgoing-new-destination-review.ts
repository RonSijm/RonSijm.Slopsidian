import type { App } from "./app";
import { outgoingMentionBulkReviewPanel } from "./outgoing-mention-bulk-review";
import { sourcePositions } from "./markdown";
import { applyOutgoingNewDestination, cancelOutgoingNewDestination, createOutgoingNewDestination, outgoingNewDestinationCandidate, outgoingNewDestinationReceipt, prepareOutgoingNewDestination, type NewDestinationLinks, type NewDestinationReview } from "./outgoing-new-destination";
import { newDestinationInteractive, newDestinationSourceAvailable } from "./outgoing-new-destination-source";
import { Modal, Notice } from "./ui";
import type { TFile } from "./vault";
import type { WorkspaceLeaf } from "./workspace";

export interface OutgoingNewDestinationHost { current: () => boolean; closed: () => void; pane?: WorkspaceLeaf }

/** One shared dialog/controller for real workspace panes and the legacy sidebar. */
export class OutgoingNewDestinationModal extends Modal {
  private readonly name = document.createElement("input");
  private readonly status = document.createElement("p");
  private readonly stageIntro = document.createElement("p");
  private review: NewDestinationReview | null = null;
  private links: NewDestinationLinks | null = null;
  private busy = false;
  private terminal = false;
  private readonly refs: ReturnType<App["workspace"]["on"]>[] = [];

  constructor(app: App, private readonly file: TFile, private readonly sourceText: string, private readonly host: OutgoingNewDestinationHost) {
    super(app); this.setTitle("New outgoing destination"); this.modalEl.classList.add("outgoing-new-destination"); this.modalEl.dataset.outgoingNewDestination = "true";
    this.stageIntro.dataset.outgoingNewStageIntro = "true";
    this.status.className = "discovery-status"; this.status.dataset.outgoingNewStatus = "true"; this.status.setAttribute("role", "status");
    this.name.type = "text"; this.name.maxLength = 4096; this.name.spellcheck = false; this.name.dataset.outgoingNewName = "true";
    this.name.setAttribute("aria-label", "New Markdown destination name or existing-folder path");
  }
  override onOpen(): void {
    const label = document.createElement("label"), help = document.createElement("p"), review = document.createElement("button"), cancel = document.createElement("button"), controls = document.createElement("div");
    label.append("New Markdown note name or path", this.name);
    help.textContent = "Review literal mentions of this new note's basename. Use an existing folder. The next step shows normal Source and exact ranges before any note is created. At most 32 supported mentions; code, links and comments stay literal.";
    review.type = cancel.type = "button"; review.textContent = "Review new destination"; review.dataset.outgoingNewReview = "true";
    cancel.textContent = "Cancel"; cancel.dataset.outgoingNewCancel = "true"; controls.className = "outgoing-new-controls"; controls.append(review, cancel);
    review.addEventListener("click", () => { void this.run(() => this.prepare()); }); cancel.addEventListener("click", () => this.close());
    this.contentEl.append(label, help, controls, this.status); this.name.focus();
    this.refs.push(this.app.core.on("changed", () => this.lock()), this.app.workspace.on("layout-change", () => this.lock()), this.app.workspace.on("file-open", () => this.lock()));
    this.lock();
  }
  override onClose(): void {
    if (this.review) { cancelOutgoingNewDestination(this.review); }
    this.refs.splice(0).forEach(ref => ref.emitter.offref(ref)); this.host.closed();
  }
  private current(): boolean { return this.isOpen && this.host.current() && newDestinationInteractive(this.app); }
  private lock(): void {
    const unavailable = this.busy || !this.current();
    this.name.disabled = unavailable || Boolean(this.review);
    this.contentEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = button.dataset.outgoingNewCancel === undefined && (unavailable || this.terminal); });
  }
  private failure(error: unknown): void {
    const receipt = this.review ? outgoingNewDestinationReceipt(this.review) : null, path = this.review?.candidate.path ?? "";
    const prefix = receipt?.document ? `The host confirmed creation of "${receipt.document.file.path}". That note was kept. `
      : receipt?.attempted ? `Creation of "${path}" could not be confirmed. It may exist; inspect the destination before starting a new review. ` : "";
    const text = prefix + (error instanceof Error ? error.message : String(error));
    if (this.isOpen) {
      if (this.review) {
        this.stageIntro.textContent = prefix.trim() || "Creation was not attempted by this review. Close this dialog and review the current source again.";
        const create = this.contentEl.querySelector<HTMLButtonElement>("[data-outgoing-new-create]");
        if (create && receipt?.document) { create.textContent = "Note created"; }
        else if (create && receipt?.attempted) { create.textContent = "Creation unconfirmed"; }
      }
      this.status.textContent = text; this.terminal = Boolean(this.review);
    }
    else if (receipt?.attempted) { new Notice(text, 20_000); }
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.terminal || !this.current()) { return; }
    this.busy = true; this.lock();
    try { await action(); } catch (error) { this.failure(error); }
    finally { this.busy = false; if (this.isOpen) { this.lock(); } }
  }
  private async prepare(): Promise<void> {
    if (!this.current()) { return; }
    const candidate = outgoingNewDestinationCandidate(this.app, this.file, this.sourceText, this.name.value);
    if (!candidate) { throw new Error("The original note is not currently eligible. Close this dialog and choose the current source again."); }
    const review = await prepareOutgoingNewDestination(candidate, () => this.isOpen && this.host.current(), this.host.pane);
    this.review = review;
    if (!this.current()) { cancelOutgoingNewDestination(review); return; }
    const path = document.createElement("strong"), preferences = document.createElement("p"), list = document.createElement("ol"), controls = document.createElement("div"), create = document.createElement("button"), cancel = document.createElement("button");
    path.textContent = candidate.path; path.dataset.outgoingNewPath = "true";
    this.stageIntro.textContent = `Create one empty Markdown note, then separately review links for ${candidate.ranges.length} eligible mentions in ${this.file.path}. `
      + (candidate.omitted ? `${candidate.omitted} unsupported matches stay literal. ` : "") + "Opening this review does not create the note or change Source. Source stays open; opening this review did not save it.";
    const settings = new Map(candidate.preferences);
    preferences.textContent = `New-note placement: ${String(settings.get("newFileLocation") ?? "root")}. Link style: ${settings.get("useMarkdownLinks") === true ? "Markdown" : "wiki"}; path format: ${String(settings.get("newLinkFormat") ?? "shortest")}. Exact replacements are reviewed after the real note is created.`;
    const position = sourcePositions(this.sourceText);
    for (const range of candidate.ranges) { const item = document.createElement("li"), code = document.createElement("code"), point = position(range.from, range.to); item.dataset.outgoingNewRange = `${range.from}:${range.to}`; item.append(`Line ${point.start.line + 1}, column ${point.start.ch + 1}: `); code.textContent = this.sourceText.slice(range.from, range.to); item.append(code); list.append(item); }
    create.type = cancel.type = "button"; create.textContent = "Create note and review links"; create.dataset.outgoingNewCreate = "true";
    cancel.textContent = "Cancel"; cancel.dataset.outgoingNewCancel = "true"; controls.className = "outgoing-new-controls"; controls.append(create, cancel);
    create.addEventListener("click", () => { void this.run(() => this.create()); }); cancel.addEventListener("click", () => this.close());
    this.status.textContent = "Normal Source is visible. Review the new path and every literal range before creating the note.";
    this.contentEl.replaceChildren(path, this.stageIntro, preferences, list, controls, this.status);
  }
  private async create(): Promise<void> {
    if (!this.review || !this.current()) { return; }
    const links = await createOutgoingNewDestination(this.review); this.links = links;
    if (!this.current()) { cancelOutgoingNewDestination(links.review); this.failure(new Error("The view closed or changed before link review. No link transaction was started.")); return; }
    this.stageIntro.dataset.outgoingNewReceipt = "true";
    this.stageIntro.textContent = `Created "${links.created.path}". This empty note is kept if you cancel or a later check fails. Source has not been saved or linked by this creation. Review the actual replacements below.`;
    const panel = outgoingMentionBulkReviewPanel(links.bulk, () => { void this.run(() => this.apply()); }, () => this.close());
    const cancel = panel.querySelector<HTMLButtonElement>("[data-outgoing-bulk-cancel]")!; cancel.textContent = "Keep note and cancel"; cancel.dataset.outgoingNewCancel = "true";
    this.status.textContent = "The note exists. Only Link mentions changes Source; one Undo restores the reviewed text and keeps the new note.";
    this.contentEl.replaceChildren(this.stageIntro, panel, this.status);
  }
  private async apply(): Promise<void> {
    if (!this.links || !this.current()) { return; }
    const links = this.links; await applyOutgoingNewDestination(links); this.terminal = true;
    this.status.textContent = `Linked ${links.bulk.changes.length} mentions. One Undo restores those mentions and keeps the new destination. Saving follows your normal note settings.`;
    this.contentEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { if (button.dataset.outgoingNewCancel !== undefined) { button.textContent = "Close"; } });
  }
}

/** Read-only and foreign handlers refuse before constructing a modal or doing IO. */
export function openOutgoingNewDestination(app: App, file: TFile, text: string, host: OutgoingNewDestinationHost): OutgoingNewDestinationModal | null {
  if (!host.current() || !newDestinationInteractive(app) || !newDestinationSourceAvailable(app, file, text)) { return null; }
  const modal = new OutgoingNewDestinationModal(app, file, text, host); modal.open(); return modal;
}
