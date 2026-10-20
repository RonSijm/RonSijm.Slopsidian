import { EditorSelection, Transaction, type Text } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type { App } from "./app";
import { attachmentMarkdown, planAttachmentPaths, prepareAttachmentFiles, type ImportSource } from "./attachment-import";
import { directorySourcesFromFiles, planDirectoryPaths, prepareDirectoryAttachments, readDirectoryEntry, type DirectorySource } from "./attachment-directory";
import { nativeDroppedFolder, nativeFolderSourcesAvailable, nativePickedFolder } from "./attachment-native";
import { recordingFolder } from "./audio-paths";
import { element } from "./dom";
import { markdownSaveError } from "./markdown-autosave";
import { Modal, Notice } from "./ui";
import { TFolder } from "./vault";
import { MarkdownView } from "./workspace";

interface ImportContext {
  root: string; path: string; view: MarkdownView; session: NonNullable<MarkdownView["session"]>;
  doc: Text; selection: EditorSelection; insertion: EditorSelection;
}
interface ImportResult {
  root: string; note: string; requested: number; confirmed: { path: string; markdown: string }[];
  uncertain: string | null; inserted: boolean; error: string;
}

export class Attachments {
  private readonly input = document.createElement("input");
  private readonly folderInput = document.createElement("input");
  private readonly folderButton = document.createElement("button");
  private picker: ImportContext | null = null;
  private operation: Promise<void> | null = null;
  private modal: Modal | null = null;
  private last: ImportResult | null = null;
  private readonly button = element("attach-files") as HTMLButtonElement;
  private readonly status = element("attachment-import-status");

  constructor(private readonly app: App) {
    this.input.type = "file"; this.input.multiple = true; this.input.hidden = true; this.input.dataset.attachmentInput = "";
    this.folderInput.type = "file"; this.folderInput.hidden = true; this.folderInput.dataset.attachmentFolderInput = ""; this.folderInput.setAttribute("webkitdirectory", "");
    document.body.append(this.input, this.folderInput);
    // Handled editor/plugin drops stop here themselves. Other local files must not navigate away from the app.
    document.addEventListener("dragover", event => {
      if (!event.defaultPrevented && event.dataTransfer?.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "none"; }
    });
    document.addEventListener("drop", event => {
      if (!event.defaultPrevented && event.dataTransfer?.types.includes("Files")) { event.preventDefault(); new Notice("Drop attachments into a Source or Live Preview editor."); }
    });
    this.folderButton.type = "button"; this.folderButton.id = "attach-folder"; this.folderButton.className = this.button.className; this.folderButton.textContent = "Attach folder";
    this.folderButton.title = "Attach a folder, retaining its structure, to the current note"; this.button.after(this.folderButton);
    this.button.addEventListener("click", () => this.choose());
    this.folderButton.addEventListener("click", () => this.choose(undefined, true));
    this.input.addEventListener("cancel", () => { this.picker = null; });
    this.folderInput.addEventListener("cancel", () => { this.picker = null; });
    this.input.addEventListener("change", () => {
      const context = this.picker; this.picker = null;
      const files = Array.from(this.input.files ?? []); this.input.value = "";
      if (context && files.length) { void this.import(files, context); }
    });
    this.folderInput.addEventListener("change", () => {
      const context = this.picker; this.picker = null;
      const files = Array.from(this.folderInput.files ?? []); this.folderInput.value = "";
      if (!context || !files.length) { return; }
      void this.import(() => nativeFolderSourcesAvailable() ? nativePickedFolder(files) : Promise.resolve(directorySourcesFromFiles(files)), context, true);
    });
    app.commands.install([
      { id: "editor:attach-files", name: "Attach files to current note", checkCallback: checking => { const view = this.active(); if (!view || this.busy) { return false; } if (!checking) { this.choose(view); } return true; } },
      { id: "editor:attach-folder", name: "Attach folder to current note", checkCallback: checking => { const view = this.active(); if (!view || this.busy) { return false; } if (!checking) { this.choose(view, true); } return true; } },
      { id: "editor:review-attachment-import", name: "Review last attachment import", checkCallback: checking => { if (!this.last || this.last.root !== app.vault.rootPath || this.busy) { return false; } if (!checking) { this.review(); } return true; } },
    ]);
    app.registerLeaveGuard(() => {
      if (this.busy) { throw new Error("Wait for the attachment import to finish before leaving this vault."); }
      this.picker = null; this.input.value = ""; this.folderInput.value = ""; this.modal?.close(); this.last = null; this.status.replaceChildren(); this.update();
    });
    this.update();
  }

  get busy(): boolean { return this.operation !== null; }
  private active(): MarkdownView | null {
    if (this.app.vault.readOnly) return null;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file && view.session && view.getMode() === "source" && !this.app.changingVault && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout ? view : null;
  }
  update(): void {
    this.button.disabled = this.folderButton.disabled = this.busy || !this.active(); this.button.setAttribute("aria-busy", String(this.busy)); this.folderButton.setAttribute("aria-busy", String(this.busy));
  }
  private capture(view: MarkdownView, position?: number): ImportContext {
    this.app.vault.assertWritable();
    if (!view.file || !view.session || !this.app.vault.rootPath || view.getMode() !== "source" || this.app.changingVault || this.app.workspace.isChangingFiles || this.app.workspace.isChangingLayout) { throw new Error("Open a note in Source mode or Live Preview before attaching files."); }
    const state = view.editor.cm.state;
    if (state.selection.ranges.length !== 1) { throw new Error("Choose a single insertion range before attaching files."); }
    return { root: this.app.vault.rootPath, path: view.file.path, view, session: view.session, doc: state.doc, selection: state.selection, insertion: position === undefined ? state.selection : EditorSelection.single(position) };
  }
  private validate(context: ImportContext): void {
    const { view } = context;
    if (context.root !== this.app.vault.rootPath || this.app.changingVault || !view.isLoaded || view.getMode() !== "source" || view.session !== context.session
      || view.file?.path !== context.path || this.app.workspace.sessions.get(context.path) !== context.session || !this.app.workspace.leaves().some(leaf => leaf.view === view)
      || view.editor.cm.state.doc !== context.doc || !view.editor.cm.state.selection.eq(context.selection)) {
      throw new Error("The note, selection or vault changed while preparing attachments. Your note was not replaced. Copy any confirmed links from the import review when ready.");
    }
  }
  choose(view = this.active(), directory = false): void {
    if (this.busy) { return; }
    try {
      if (!view) { throw new Error("Open a note in Source mode or Live Preview before attaching files."); }
      this.picker = this.capture(view); const input = directory ? this.folderInput : this.input; this.input.value = ""; this.folderInput.value = ""; input.click();
    } catch (error) { this.problem(error, view); }
  }

  bind(view: MarkdownView): void {
    view.registerDomEvent(view.sourceEl, "dragover", event => {
      if (!(event instanceof DragEvent) || !event.dataTransfer?.types.includes("Files")) { return; }
      event.preventDefault(); event.stopImmediatePropagation(); event.dataTransfer.dropEffect = this.app.vault.readOnly || this.busy || view.getMode() !== "source" ? "none" : "copy";
    }, { capture: true });
    view.registerDomEvent(view.sourceEl, "drop", event => {
      if (!(event instanceof DragEvent) || !event.dataTransfer?.types.includes("Files")) { return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.busy) { new Notice("Wait for the current attachment import to finish."); return; }
      try {
        const items = Array.from(event.dataTransfer.items).filter(item => item.kind === "file");
        // Entries must be captured synchronously; they are invalid once the drop event returns.
        const entries = items.map(item => item.webkitGetAsEntry?.() ?? null);
        const directory = entries.some(entry => entry?.isDirectory);
        if (directory && (entries.length !== 1 || !entries[0]?.isDirectory)) { throw new Error("Drop one folder at a time, without other files."); }
        this.app.workspace.setActiveLeaf(view.leaf, { focus: false });
        const position = view.editor.cm.posAtCoords({ x: event.clientX, y: event.clientY });
        const context = this.capture(view, position ?? undefined);
        if (directory) {
          const entry = entries[0]!, rootFile = event.dataTransfer.files.length === 1 ? event.dataTransfer.files[0] : null;
          void this.import(() => nativeFolderSourcesAvailable() ? (rootFile ? nativeDroppedFolder(rootFile) : Promise.reject(new Error("The dropped folder has no verifiable local path."))) : readDirectoryEntry(entry), context, true);
        }
        else { void this.import(Array.from(event.dataTransfer.files), context); }
      } catch (error) { this.problem(error, view); }
    }, { capture: true });
    view.registerDomEvent(view.sourceEl, "paste", event => {
      if (!(event instanceof ClipboardEvent) || !event.clipboardData) { return; }
      const files = Array.from(event.clipboardData.items).filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => file !== null);
      if (!files.length) { return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.busy) { new Notice("Wait for the current attachment import to finish."); return; }
      try { void this.import(files, this.capture(view)); } catch (error) { this.problem(error, view); }
    }, { capture: true });
  }

  private problem(error: unknown, view?: MarkdownView | null): void {
    const root = this.app.vault.rootPath;
    if (!root) { new Notice(markdownSaveError(error)); return; }
    this.last = { root, note: view?.file?.path ?? "", requested: 0, confirmed: [], uncertain: null, inserted: false, error: markdownSaveError(error) };
    this.review();
  }
  private import(source: readonly ImportSource[] | (() => Promise<DirectorySource[]>), context: ImportContext, directory = false): Promise<void> {
    if (this.operation) { new Notice("Wait for the current attachment import to finish."); return Promise.resolve(); }
    const result: ImportResult = { root: context.root, note: context.path, requested: typeof source === "function" ? 0 : source.length, confirmed: [], uncertain: null, inserted: false, error: "" };
    this.status.textContent = "Preparing attachments…";
    const operation = (async () => {
      try {
        this.validate(context);
        const files = typeof source === "function" ? await source() : source;
        result.requested = files.length;
        this.validate(context);
        const prepared = directory ? await prepareDirectoryAttachments(files as readonly DirectorySource[]) : await prepareAttachmentFiles(files);
        this.validate(context);
        await this.app.workspace.withFileMutation(async () => {
          await this.app.saveAll(); this.validate(context);
          await this.app.vault.refresh(); this.validate(context);
          const folder = recordingFolder(this.app.vault.getConfig("attachmentFolderPath"), context.path);
          const existing = this.app.vault.getAllLoadedFiles().map(file => ({ path: file.path, folder: file instanceof TFolder }));
          const paths = directory ? planDirectoryPaths(prepared.map(file => file.name), folder, existing) : planAttachmentPaths(prepared.map(file => file.name), folder, existing);
          for (let index = 0; index < prepared.length; index++) {
            this.validate(context);
            this.status.textContent = "Importing attachment " + (index + 1) + " of " + prepared.length + "…";
            result.uncertain = paths[index];
            const file = await this.app.vault.createBinary(paths[index], prepared[index].bytes);
            result.confirmed.push({ path: file.path, markdown: attachmentMarkdown(file.path, context.path) }); result.uncertain = null;
          }
          this.validate(context);
          const state = context.view.editor.cm.state, range = context.insertion.main;
          const insert = result.confirmed.map(file => file.markdown).join(state.lineBreak);
          context.view.editor.cm.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from + state.toText(insert).length },
            annotations: [Transaction.userEvent.of("input.attach"), isolateHistory.of("full")] });
          result.inserted = true;
        });
      } catch (error) { result.error = markdownSaveError(error); }
      this.last = result;
    })().finally(() => {
      if (this.operation === operation) { this.operation = null; }
      this.status.replaceChildren(); this.update();
      if (result.root !== this.app.vault.rootPath) { return; }
      if (result.error) {
        const review = document.createElement("button"); review.type = "button"; review.textContent = "Attachment import issue"; review.dataset.attachmentIssue = ""; review.addEventListener("click", () => this.review()); this.status.append(review);
        this.review();
      }
      else { new Notice("Imported " + result.confirmed.length + " attachment(s) into " + context.path + "."); context.view.focus(); }
    });
    this.operation = operation; this.update(); return operation;
  }

  review(): void {
    const result = this.last;
    if (!result || result.root !== this.app.vault.rootPath || this.app.changingVault || this.busy) { return; }
    this.modal?.close();
    const modal = this.modal = new Modal(this.app).setTitle("Attachment import"); modal.containerEl.dataset.attachmentReview = "";
    const paragraph = (text: string): void => { const node = document.createElement("p"); node.textContent = text; modal.contentEl.append(node); };
    paragraph(result.confirmed.length + " of " + result.requested + " files confirmed in this vault.");
    if (result.error) { const error = document.createElement("p"); error.setAttribute("role", "alert"); error.textContent = result.error; modal.contentEl.append(error); }
    paragraph(result.inserted ? "Links were inserted into " + result.note + " as one undo step. Attachment files remain if you undo the links." : "No attachment links were inserted into the note. Any confirmed files listed below remain in the vault; you can copy their links.");
    for (const file of result.confirmed) { paragraph("Imported: " + file.path); }
    if (result.uncertain) { paragraph("Could not confirm: " + result.uncertain + ". This path may already exist or its write may have completed. Check it before retrying. No automatic retry was made."); }
    if (result.confirmed.length) {
      const links = document.createElement("textarea"); links.readOnly = true; links.value = result.confirmed.map(file => file.markdown).join("\n"); links.rows = Math.min(8, Math.max(2, result.confirmed.length)); links.style.width = "100%"; links.setAttribute("aria-label", "Links to confirmed attachments"); links.dataset.attachmentLinks = ""; modal.contentEl.append(links);
    }
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } }; modal.open();
  }
}
