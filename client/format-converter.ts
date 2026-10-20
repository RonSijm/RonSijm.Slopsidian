import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import type { VaultFileEdit } from "./contracts";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import { convertMarkdownFormats, type MarkdownFormatConversion } from "./markdown";
import { Modal, Setting } from "./ui";

const conversions: readonly { id: MarkdownFormatConversion; name: string; description: string }[] = [
  { id: "roam-tags", name: "Roam tags", description: "Change #tag and #[[Tag name]] into wiki links; numeric hashtags remain unchanged." },
  { id: "roam-highlights", name: "Roam highlights", description: "Change ^^highlight^^ into ==highlight==." },
  { id: "roam-todos", name: "Roam tasks", description: "Change {{[[TODO]]}} and {{[[DONE]]}} into unchecked and checked task markers." },
  { id: "bear-highlights", name: "Bear highlights", description: "Change ::highlight:: into ==highlight==." },
  { id: "zettelkasten-links", name: "Numeric Zettelkasten links", description: "Resolve [[numeric ID]] to a matching file name. Ambiguous IDs are refused." },
  { id: "zettelkasten-aliases", name: "Numeric links with readable aliases", description: "Resolve numeric links and use the destination name without its ID as the caption." },
  { id: "frontmatter", name: "Legacy frontmatter", description: "Migrate alias/tag/cssclass names and string values to aliases/tags/cssclasses lists, preserving other data." },
];

interface ConversionChange extends VaultFileEdit { before: string; replacements: number }
interface ConversionPlan { root: string; processed: number; changes: ConversionChange[] }

export class FormatConverter {
  readonly id = "markdown-importer";
  private modal: Modal | null = null;
  private busy = false;

  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, () => {
      const remove = this.app.commands.install([{
        id: "markdown-importer:open", name: "Open format converter", callback: () => core.run(() => this.open()),
      }]);
      const ribbon = iconButton("file", "Open format converter", () => this.app.commands.execute("markdown-importer:open").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      element("core-ribbon").append(ribbon);
      return () => {
        remove();
        ribbon.remove();
        this.busy = false;
        this.modal?.close();
      };
    }, this);
  }

  private async prepare(formats: readonly MarkdownFormatConversion[]): Promise<ConversionPlan> {
    const root = this.app.vault.rootPath;
    if (!root || !formats.length) { throw new Error("Select at least one conversion in an open vault."); }
    if (this.app.workspace.hasUnsavedChanges) { throw new Error("Save or reload unsaved views before previewing a vault-wide conversion. No notes were changed."); }
    await this.app.metadataCache.refresh();
    if (root !== this.app.vault.rootPath || this.app.changingVault || !this.app.core.isEnabled(this.id)) { throw new Error("The vault or converter changed before its preview was ready."); }
    const documents = this.app.metadataCache.getDocuments();
    const known = new Set(documents.map(entry => entry.document.file.path));
    const issues = this.app.metadataCache.getIssues().filter(issue => !issue.path || !known.has(issue.path) || formats.includes("frontmatter") && this.app.metadataCache.getDocument(issue.path)?.cache.errors.length);
    if (issues.length) { throw new Error("Resolve unreadable notes or invalid frontmatter before converting: " + issues.map(issue => issue.path + ": " + issue.message).join("; ")); }
    const files = this.app.vault.getFiles();
    const changes: ConversionChange[] = [];
    for (const entry of documents) {
      const converted = convertMarkdownFormats(entry.text, formats, id => {
        const matches = files.filter(file => file.basename.includes(id));
        if (matches.length > 1) { throw new Error("More than one file contains numeric ID " + id + ". Resolve the ambiguous target before converting."); }
        const file = matches[0];
        return file ? { link: this.app.metadataCache.fileToLinktext(file, entry.document.file.path), title: file.basename } : null;
      });
      if (converted.content !== entry.text) {
        changes.push({ path: entry.document.file.path, version: entry.document.version, content: converted.content, before: entry.text, replacements: converted.replacements });
      }
    }
    if (changes.length > 256) { throw new Error("A guarded conversion supports up to 256 changed notes per batch. No notes were changed."); }
    return { root, processed: documents.length, changes };
  }

  private open(): void {
    if (this.busy) { throw new Error("Wait for the current format conversion to finish."); }
    this.modal?.close();
    const modal = new Modal(this.app).setTitle("Format converter");
    this.modal = modal;
    const listeners = new AbortController();
    modal.modalEl.dataset.coreDialog = this.id;
    const warning = document.createElement("p");
    warning.textContent = "Back up your vault first. Selected conversions apply to raw text throughout all Markdown files, including matching code/comments. Preview does not write notes. Applying rewrites the original files; conflicts reject the whole planned batch.";
    const choices = document.createElement("fieldset");
    const selected = new Map<MarkdownFormatConversion, HTMLInputElement>();
    for (const conversion of conversions) {
      const setting = new Setting(choices).setName(conversion.name).setDesc(conversion.description);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.formatOption = conversion.id;
      checkbox.setAttribute("aria-label", conversion.name);
      setting.controlEl.append(checkbox);
      selected.set(conversion.id, checkbox);
    }
    const error = document.createElement("p");
    error.className = "plugin-error";
    error.setAttribute("role", "alert");
    error.dataset.formatError = "";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.dataset.formatStatus = "options";
    const preview = document.createElement("div");
    preview.dataset.formatPreview = "";
    const confirmation = document.createElement("label");
    const confirm = document.createElement("input");
    confirm.type = "checkbox";
    confirm.dataset.formatConfirm = "";
    confirmation.append(confirm, " Apply the previewed changes to the original vault files.");
    confirmation.hidden = true;
    const actions = document.createElement("div");
    actions.className = "modal-button-container";
    const button = (action: string, label: string): HTMLButtonElement => {
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.formatAction = action;
      control.textContent = label;
      actions.append(control);
      return control;
    };
    const cancel = button("cancel", "Cancel");
    const prepare = button("preview", "Preview changes");
    const apply = button("apply", "Apply conversion");
    const undo = button("undo", "Undo conversion");
    apply.className = "mod-warning";
    apply.hidden = true;
    undo.hidden = true;
    let plan: ConversionPlan | null = null;
    let inverse: { root: string; edits: VaultFileEdit[] } | null = null;
    const update = (): void => {
      choices.disabled = this.busy || inverse !== null;
      cancel.disabled = this.busy;
      prepare.disabled = this.busy || inverse !== null || ![...selected.values()].some(input => input.checked);
      apply.disabled = this.busy || !plan?.changes.length || !confirm.checked;
      undo.disabled = this.busy || !inverse;
      confirm.disabled = this.busy;
    };
    const close = modal.close.bind(modal);
    modal.close = () => { if (!this.busy) { close(); } };
    modal.onClose = () => { listeners.abort(); if (this.modal === modal) { this.modal = null; } };
    cancel.addEventListener("click", () => modal.close(), { signal: listeners.signal });
    confirm.addEventListener("change", update, { signal: listeners.signal });
    choices.addEventListener("change", () => {
      plan = null;
      confirm.checked = false;
      confirmation.hidden = true;
      apply.hidden = true;
      status.dataset.formatStatus = "options";
      preview.replaceChildren();
      update();
    }, { signal: listeners.signal });
    const run = (action: () => Promise<void>): void => {
      if (this.busy) { return; }
      this.busy = true;
      error.textContent = "";
      update();
      this.app.core.run(async () => {
        if (this.modal !== modal || !this.app.core.isEnabled(this.id)) { throw new Error("This format-converter dialog is no longer active. No notes were changed."); }
        await action();
      }).catch(issue => {
        if (this.modal === modal) { error.textContent = issue instanceof Error ? issue.message : String(issue); }
        else { reportError(issue); }
      }).finally(() => { this.busy = false; update(); }).catch(reportError);
    };
    prepare.addEventListener("click", () => run(async () => {
      plan = null;
      inverse = null;
      undo.hidden = true;
      apply.hidden = true;
      confirmation.hidden = true;
      preview.replaceChildren();
      const formats = [...selected].filter(([, input]) => input.checked).map(([id]) => id);
      const prepared = await this.prepare(formats);
      plan = prepared;
      confirm.checked = false;
      confirmation.hidden = !prepared.changes.length;
      apply.hidden = !prepared.changes.length;
      apply.textContent = "Apply to " + prepared.changes.length + " notes";
      status.dataset.formatStatus = "preview";
      status.dataset.formatModified = String(prepared.changes.length);
      status.textContent = `${prepared.processed} Markdown files inspected; ${prepared.changes.length} would change (${prepared.changes.reduce((count, change) => count + change.replacements, 0)} replacements/property changes).`;
      for (const change of prepared.changes) {
        const details = document.createElement("details");
        details.dataset.formatPath = change.path;
        const summary = document.createElement("summary");
        summary.textContent = change.path;
        const before = document.createElement("pre");
        before.textContent = change.before;
        before.setAttribute("aria-label", "Original " + change.path);
        const after = document.createElement("pre");
        after.textContent = change.content;
        after.setAttribute("aria-label", "Converted " + change.path);
        details.append(summary, before, after);
        preview.append(details);
      }
    }), { signal: listeners.signal });
    apply.addEventListener("click", () => run(async () => {
      if (!plan || !confirm.checked) { throw new Error("Preview and confirm the selected changes first."); }
      const prepared = plan;
      const originals = new Map(prepared.changes.map(change => [change.path, change.before]));
      const documents = await this.app.fileManager.applyMarkdownEdits(prepared.root, prepared.changes.map(({ path, version, content }) => ({ path, version, content })));
      inverse = { root: prepared.root, edits: documents.map(document => {
        const content = originals.get(document.file.path);
        if (content === undefined) { throw new Error("A converted file was missing from its preview: " + document.file.path); }
        return { path: document.file.path, version: document.version, content };
      }) };
      plan = null;
      apply.hidden = true;
      confirmation.hidden = true;
      undo.hidden = false;
      status.dataset.formatStatus = "applied";
      status.textContent = `${documents.length} notes converted. Undo is available while this dialog stays open and refuses newer external or unsaved changes.`;
    }), { signal: listeners.signal });
    undo.addEventListener("click", () => run(async () => {
      if (!inverse) { throw new Error("No completed conversion is available to undo."); }
      await this.app.fileManager.applyMarkdownEdits(inverse.root, inverse.edits);
      inverse = null;
      undo.hidden = true;
      status.dataset.formatStatus = "undone";
      status.textContent = "The original note contents were restored; BOM and line-ending formats were retained.";
    }), { signal: listeners.signal });
    modal.contentEl.append(warning, choices, error, status, preview, confirmation, actions);
    update();
    modal.open();
  }
}
