import type { App } from "./app";
import type { VaultDocument } from "./contracts";
import type { CanvasNode } from "./canvas-model";
import { validateCanvas } from "./canvas-model";
import type { TFile } from "./vault";

export const canvasConversionTextLimit = 262_144;
export interface CanvasConversionReceipt { readonly path: string; readonly attempted: boolean; readonly document: VaultDocument | null; readonly converted: boolean }
export interface CanvasConversionAuthority { current(ownedMutation: boolean): boolean; savedSource(): VaultDocument | null; apply(file: TFile, committed: () => void): void }

export function convertedCanvasTextCard(node: CanvasNode, path: string): CanvasNode {
  if (node.type !== "text" || typeof node.text !== "string" || node.text.length > canvasConversionTextLimit) { throw new Error("Choose one text card of at most 262,144 characters."); }
  if (typeof path !== "string" || !path || !/\.md$/i.test(path)) { throw new Error("Conversion requires a Markdown destination."); }
  const next: CanvasNode = { ...node, type: "file", file: path }; delete next.text; delete next.subpath;
  return validateCanvas({ nodes: [next], edges: [] }).nodes[0];
}

/** One reviewed create, with the real acknowledgement retained even if inventory or later checks fail. */
export class CanvasConversionReview {
  readonly root: string;
  readonly sourcePath: string;
  readonly path: string;
  readonly text: string;
  private readonly preferences: string;
  private attempted = false;
  private document: VaultDocument | null = null;
  private converted = false;
  private closed = false;
  private started = false;
  applying = false;

  constructor(private readonly app: App, private readonly source: TFile, readonly name: string, node: CanvasNode, private readonly authority: CanvasConversionAuthority) {
    this.root = app.vault.rootPath ?? ""; this.sourcePath = source.path;
    if (!this.current(false)) { throw new Error("This Canvas is not available for conversion. No file was created."); }
    convertedCanvasTextCard(node, "Review.md"); this.text = node.text as string;
    this.preferences = this.currentPreferences(); this.path = app.fileManager.getNewNotePath(name, this.sourcePath, true);
    this.requireAbsent();
  }
  get receipt(): CanvasConversionReceipt { return Object.freeze({ path: this.path, attempted: this.attempted, document: this.document, converted: this.converted }); }
  close(): void { this.closed = true; }
  private current(ownedMutation: boolean): boolean {
    return !this.closed && Boolean(this.root && this.root === this.app.vault.rootPath && !this.app.vault.readOnly && !this.app.changingVault
      && (ownedMutation || !this.app.workspace.isChangingFiles) && this.source.path === this.sourcePath && this.source.extension.toLowerCase() === "canvas"
      && this.app.vault.getFileByPath(this.sourcePath) === this.source && this.authority.current(ownedMutation));
  }
  private currentPreferences(): string { return JSON.stringify([this.app.vault.getConfig("newFileLocation"), this.app.vault.getConfig("newFileFolderPath")]); }
  private requireAbsent(): void {
    if (this.app.vault.getAbstractFileByPath(this.path)) { throw new Error("The destination already exists. Choose another Markdown name."); }
    const folder = this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "";
    if (folder && !this.app.vault.getFolderByPath(folder)) { throw new Error("Choose an existing folder for the Markdown file."); }
  }
  private guard(ownedMutation: boolean): void {
    this.app.vault.assertWritable("file-management");
    if (!this.current(ownedMutation) || this.preferences !== this.currentPreferences() || this.app.fileManager.getNewNotePath(this.name, this.sourcePath, true) !== this.path) { throw new Error("The Canvas or destination review changed. No card replacement was applied."); }
  }
  private checkedTarget(file: TFile, document: VaultDocument): void {
    const acknowledgement = this.document, content = (document.hasBom ? "\ufeff" : "") + document.content, session = this.app.workspace.sessions.get(this.path);
    if (!acknowledgement || acknowledgement.file.path !== this.path || document.file.path !== this.path || acknowledgement.version !== document.version || content !== this.text
      || this.app.vault.getFileByPath(this.path) !== file || file.path !== this.path || file.extension.toLowerCase() !== "md"
      || session && (session.originRoot !== this.root || session.isReloading || session.dirty || session.isSaving || session.text !== document.content
        || session.document.version !== document.version || session.document.content !== document.content || session.document.hasBom !== document.hasBom)) {
      throw new Error("The created Markdown file changed before the card could be replaced.");
    }
  }
  private async checkedSource(ownedMutation: boolean): Promise<void> {
    this.guard(ownedMutation);
    const saved = this.authority.savedSource();
    if (!saved || saved.file.path !== this.sourcePath) { throw new Error("The Canvas has no current saved-document baseline."); }
    const tuple = { version: saved.version, content: saved.content, hasBom: saved.hasBom };
    const actual = await this.app.vault.readDocument(this.sourcePath);
    this.guard(ownedMutation);
    const current = this.authority.savedSource();
    if (!current || current.file.path !== this.sourcePath || actual.file.path !== this.sourcePath || current.version !== tuple.version || current.content !== tuple.content || current.hasBom !== tuple.hasBom
      || actual.version !== tuple.version || actual.content !== tuple.content || actual.hasBom !== tuple.hasBom) {
      throw new Error("The saved Canvas changed. Its current source must be reviewed before conversion.");
    }
  }
  async createAndConvert(): Promise<void> {
    if (this.started) { throw new Error("This conversion was already attempted. Inspect its receipt before starting a new review."); } this.started = true;
    this.guard(false); this.requireAbsent();
    const created = await this.app.workspace.withFileMutation(async () => {
      this.guard(true); this.requireAbsent();
      await this.checkedSource(true);
      const exists = await this.app.vault.adapter.exists(this.path);
      this.guard(true); this.requireAbsent();
      if (exists) { throw new Error("The destination appeared before creation. No file was created."); }
      this.attempted = true;
      const file = await this.app.vault.create(this.path, this.text, document => { this.document = Object.freeze(structuredClone(document)); });
      this.guard(true);
      const document = await this.app.vault.readDocument(this.path);
      this.guard(true);
      this.checkedTarget(file, document);
      return file;
    });
    this.guard(false);
    // withFileMutation awaits layout cleanup after unlocking the workspace. Its
    // successful action is not a destination lease across that asynchronous gap.
    await this.checkedSource(false);
    const currentDocument = await this.app.vault.readDocument(this.path);
    this.guard(false); this.checkedTarget(created, currentDocument);
    this.applying = true;
    try { this.authority.apply(created, () => { this.converted = true; }); if (!this.converted) { throw new Error("The Canvas did not acknowledge the reviewed card replacement."); } }
    finally { this.applying = false; }
  }
}

export function canvasConversionOutcome(receipt: CanvasConversionReceipt, error?: unknown): string {
  const message = error === undefined ? "" : error instanceof Error ? error.message : String(error);
  const prefix = receipt.converted ? `Created "${receipt.path}" and replaced the text card. Undo restores the card and keeps the created file. Normal Canvas saving still applies.`
    : receipt.document ? `The host confirmed creation of "${receipt.path}". That file was kept; this review did not replace the card.`
    : receipt.attempted ? `Creation of "${receipt.path}" could not be confirmed. The file may exist; inspect that path before starting another review. This review did not replace the card.` : "Creation was not attempted. This review did not replace the card.";
  return prefix + (message ? " " + message : "");
}
