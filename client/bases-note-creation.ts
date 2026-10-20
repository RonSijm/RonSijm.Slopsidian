import type { App } from "./app";
import type { VaultDocument } from "./contracts";
import { parsePropertyValue, propertyName, propertyTypes, type PropertyType } from "./property-types";
import type { TFile } from "./vault";

export const MAX_BASE_NOTE_PROPERTIES = 16;
export const MAX_BASE_NOTE_VALUE = 16_384;
export const MAX_BASE_NOTE_BODY = 131_072;
export const MAX_BASE_NOTE_BYTES = 262_144;
export interface BaseNotePropertyDraft { name: string; type: string; text: string; checked: boolean }
export interface BaseNoteDraft { properties: readonly BaseNotePropertyDraft[]; body: string; lineEnding: "\n" | "\r\n" }
export interface BaseNotePlan { readonly content: string; readonly properties: readonly { readonly name: string; readonly type: string; readonly assigned: string | null }[]; readonly lineEnding: "\n" | "\r\n" }
export interface BaseNoteCreationReceipt { readonly path: string; readonly attempted: boolean; readonly document: VaultDocument | null; readonly completed: boolean }
export interface BaseNoteCreationAuthority { current(ownedMutation: boolean): boolean; savedSource(): VaultDocument | null; refresh(): void | Promise<void> }

function boundedText(value: string, maximum: number, description: string): void {
  if (typeof value !== "string" || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) {
    throw new Error(description + " is too large or contains unsupported control/Unicode characters.");
  }
}
function yamlLiteral(value: unknown): string {
  if (Object.is(value, -0)) { return "-0"; }
  const literal = JSON.stringify(value);
  if (typeof literal !== "string") { throw new Error("Only supported literal property values can be created."); }
  // YAML treats these Unicode separators as breaks even inside quoted strings.
  return literal.replaceAll("\u0085", "\\u0085").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/** New-note values are authored explicitly; filters and formulas are never inferred. */
export function planBaseNote(draft: BaseNoteDraft, assignedWidget: (name: string) => string | null): BaseNotePlan {
  if (!draft || !Array.isArray(draft.properties) || draft.properties.length > MAX_BASE_NOTE_PROPERTIES) { throw new Error("Create a note with at most 16 properties."); }
  if (draft.lineEnding !== "\n" && draft.lineEnding !== "\r\n") { throw new Error("Choose LF or CRLF line endings."); }
  boundedText(draft.body, MAX_BASE_NOTE_BODY, "The new-note body");
  if (draft.body.startsWith("\ufeff")) { throw new Error("The new-note body must not start with a BOM. New notes use UTF-8 without BOM."); }
  const seen = new Set<string>(), bindings: { name: string; type: string; assigned: string | null }[] = [], yaml: string[] = [];
  for (const field of draft.properties) {
    if (!field || typeof field.name !== "string" || typeof field.type !== "string" || typeof field.checked !== "boolean") { throw new Error("Every property needs a name, supported type and value."); }
    const name = propertyName(field.name), identity = name.toLowerCase();
    boundedText(name, 256, "The property name");
    if (["__proto__", "prototype", "constructor", "<<"].includes(identity) || seen.has(identity)) { throw new Error("Choose unique safe property names, including their letter case."); }
    seen.add(identity); boundedText(field.text, MAX_BASE_NOTE_VALUE, "Each property value");
    if (!propertyTypes.includes(field.type as PropertyType)) { throw new Error("Choose a supported property type."); }
    const assigned = assignedWidget(name);
    if (assigned !== null && assigned !== field.type) { throw new Error(`Property "${name}" uses its assigned ${assigned} type. Choose that type before review.`); }
    const value = parsePropertyValue(field.type, field.text, field.checked);
    if (Array.isArray(value) && (value.length > 256 || new Set(value.map(item => String(item).toLowerCase())).size !== value.length)) { throw new Error("Lists support at most 256 distinct items, including their letter case."); }
    yaml.push(yamlLiteral(name) + ": " + yamlLiteral(value)); bindings.push(Object.freeze({ name, type: field.type, assigned }));
  }
  const eol = draft.lineEnding, body = draft.body.replace(/\r\n?/g, "\n").replaceAll("\n", eol);
  const content = (yaml.length ? ["---", ...yaml, "---", ""].join(eol) : "") + body;
  if (new TextEncoder().encode(content).byteLength > MAX_BASE_NOTE_BYTES) { throw new Error("The prepared note exceeds 256 KiB of UTF-8 text. Reduce its properties or body."); }
  return Object.freeze({ content, properties: Object.freeze(bindings), lineEnding: eol });
}

/** A single create-only operation. Its acknowledgement survives every later error. */
export class BaseNoteCreationReview {
  readonly root: string;
  readonly sourcePath: string;
  readonly path: string;
  readonly plan: BaseNotePlan;
  private readonly preferences: string;
  private attempted = false;
  private document: VaultDocument | null = null;
  private completed = false;
  private started = false;
  private closed = false;
  creating = false;

  constructor(private readonly app: App, private readonly source: TFile, readonly name: string, draft: BaseNoteDraft, private readonly authority: BaseNoteCreationAuthority) {
    this.root = app.vault.rootPath ?? ""; this.sourcePath = source.path;
    if (!this.current(false)) { throw new Error("This base is not available for creating notes. No creation was attempted."); }
    boundedText(name, 4096, "The note name or path");
    if (!name.trim()) { throw new Error("Enter a Markdown note name or path."); }
    this.plan = planBaseNote(draft, key => this.app.metadataTypeManager.getAssignedWidget(key));
    this.preferences = this.currentPreferences(); this.path = app.fileManager.getNewNotePath(name, this.sourcePath, true);
    if (!/\.md$/i.test(this.path)) { throw new Error("Choose an absent Markdown destination."); }
    this.requireAbsent();
  }
  get receipt(): BaseNoteCreationReceipt { return Object.freeze({ path: this.path, attempted: this.attempted, document: this.document ? structuredClone(this.document) : null, completed: this.completed }); }
  close(): void { this.closed = true; }
  private current(ownedMutation: boolean): boolean {
    return !this.closed && Boolean(this.root && this.root === this.app.vault.rootPath && !this.app.vault.readOnly && !this.app.changingVault
      && (ownedMutation || !this.app.workspace.isChangingFiles) && this.source.path === this.sourcePath && this.source.extension.toLowerCase() === "base"
      && this.app.vault.getFileByPath(this.sourcePath) === this.source && this.authority.current(ownedMutation));
  }
  private currentPreferences(): string { return JSON.stringify([this.app.vault.getConfig("newFileLocation"), this.app.vault.getConfig("newFileFolderPath")]); }
  private requireAbsent(): void {
    if (this.app.vault.getAbstractFileByPath(this.path) || this.app.vault.getAllLoadedFiles().some(file => file.path.toLowerCase() === this.path.toLowerCase())) { throw new Error("That destination already exists, including a case-only path match. Choose another note name."); }
    const folder = this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "";
    if (folder && !this.app.vault.getFolderByPath(folder)) { throw new Error("Choose an existing folder for the new note."); }
  }
  private guard(ownedMutation: boolean): void {
    this.app.vault.assertWritable("file-management");
    if (!this.current(ownedMutation) || this.preferences !== this.currentPreferences() || this.app.fileManager.getNewNotePath(this.name, this.sourcePath, true) !== this.path
      || this.plan.properties.some(field => this.app.metadataTypeManager.getAssignedWidget(field.name) !== field.assigned)) { throw new Error("The base, query, assigned types, placement or review changed. Start a fresh note review."); }
  }
  private async checkedSource(): Promise<void> {
    this.guard(true);
    const saved = this.authority.savedSource();
    if (!saved || saved.file.path !== this.sourcePath) { throw new Error("This base has no current saved-document baseline."); }
    const tuple = { version: saved.version, content: saved.content, hasBom: saved.hasBom }, actual = await this.app.vault.readDocument(this.sourcePath);
    this.guard(true);
    const current = this.authority.savedSource();
    if (!current || current.file.path !== this.sourcePath || actual.file.path !== this.sourcePath || current.version !== tuple.version || current.content !== tuple.content || current.hasBom !== tuple.hasBom
      || actual.version !== tuple.version || actual.content !== tuple.content || actual.hasBom !== tuple.hasBom) { throw new Error("The saved base changed. Refresh it before reviewing a new note."); }
  }
  async create(): Promise<TFile> {
    if (this.started) { throw new Error("Creation was already reviewed once. Inspect this outcome before starting a new review."); } this.started = true;
    this.guard(false); this.requireAbsent(); this.creating = true;
    try {
      const created = await this.app.workspace.withFileMutation(async () => {
        this.guard(true); this.requireAbsent(); await this.checkedSource();
        const exists = await this.app.vault.adapter.exists(this.path);
        this.guard(true); this.requireAbsent();
        if (exists) { throw new Error("The destination appeared before creation. No file was created."); }
        await this.checkedSource(); this.guard(true); this.requireAbsent();
        this.attempted = true;
        return this.app.vault.create(this.path, this.plan.content, document => { this.document = Object.freeze(structuredClone(document)); });
      });
      if (!this.document || this.document.file.path !== this.path || (this.document.hasBom ? "\ufeff" : "") + this.document.content !== this.plan.content) { throw new Error("The host did not acknowledge the exact reviewed note text."); }
      this.completed = true;
      // Metadata/query refresh is follow-up presentation, never authority for a second write.
      if (!this.closed && this.root === this.app.vault.rootPath && !this.app.changingVault && this.app.vault.getFileByPath(this.sourcePath) === this.source) { await this.authority.refresh(); }
      return created;
    } finally { this.creating = false; }
  }
}

export function baseNoteCreationOutcome(receipt: BaseNoteCreationReceipt, error?: unknown): string {
  const message = error === undefined ? "" : error instanceof Error ? error.message : String(error);
  if (receipt.document && receipt.document.file.path !== receipt.path) {
    return `The host acknowledged "${receipt.document.file.path}", which differs from the reviewed destination "${receipt.path}". Creation of the reviewed destination was not confirmed. Inspect both paths before starting another review.` + (message ? " " + message : "");
  }
  const prefix = receipt.document ? `Created "${receipt.path}". The confirmed file was kept. The base and other notes were not edited by this action.`
    : receipt.attempted ? `Creation of "${receipt.path}" could not be confirmed. The file may exist; inspect that path before starting another review.` : "Creation was not attempted.";
  return prefix + (message ? " " + message : "") + (receipt.document ? " The note may be hidden by this base's filters, search or limit." : "");
}
