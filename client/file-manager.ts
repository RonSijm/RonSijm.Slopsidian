import type { App } from "./app";
import { reportError } from "./dom";
import { composerFragment, composerHeading, composerTemplate, insertMarkdown, parseMarkdown, renameFrontmatterProperty, sourcePositions, updateFrontmatter, type SourceRange } from "./markdown";
import { propertyName } from "./property-types";
import { copyViewData, type VaultConfigurationDocument, type VaultDocument, type VaultFileEdit } from "./contracts";
import { normalizePath, TAbstractFile, TFile, TFolder } from "./vault";
import { FileView, TextFileView } from "./views";
import { MarkdownView } from "./workspace";
import { createLinkResolver, fileLinktext, linkTextFormat, relocateMarkdownLinks, resolveSubpath, rewriteFileLinks, rewriteSectionLinks } from "./links";
import { Modal, Notice } from "./ui";
import { rewriteCanvasReferences } from "./canvas-model";
import { Menu } from "./menu";

export interface NoteComposition {
  root: string;
  source: TFile;
  sourcePath: string;
  sourceText: string;
  sourceVersion: string;
  dirty: boolean;
  targetPath: string;
  create: boolean;
  selection: SourceRange | null;
  placement: "append" | "prepend";
  replacement: "link" | "embed" | "none";
  template: string;
}

export class FileManager {
  private readonly operations = new Map<string, Promise<void>>();
  private batch: Promise<void> | null = null;
  private modal: Modal | null = null;

  constructor(readonly app: App) {}

  getNewFileParent(sourcePath: string, newFilePath?: string): TFolder {
    if (typeof sourcePath !== "string" || newFilePath !== undefined && typeof newFilePath !== "string") {
      throw new Error("New-file locations require vault-relative text paths.");
    }
    if (!this.app.vault.rootPath || this.app.changingVault) { throw new Error("Wait for the selected vault to finish loading."); }
    const name = newFilePath?.replaceAll("\\", "/").split("/").at(-1) ?? "";
    const dot = name.lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1 && name.slice(dot + 1).toLowerCase() !== "md") {
      throw new Error("Only Markdown new-file parent selection is supported yet.");
    }
    const location = this.app.vault.getConfig("newFileLocation");
    if (location === "root") { return this.app.vault.getRoot(); }
    if (location === "folder") {
      const folder = this.app.vault.getConfig("newFileFolderPath");
      if (typeof folder !== "string") { throw new Error("The configured new-note folder must be a vault path."); }
      return this.app.vault.getFolderByPath(normalizePath(folder)) ?? this.app.vault.getRoot();
    }
    if (location === "current") {
      const path = normalizePath(sourcePath);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      return this.app.vault.getFolderByPath(parent) ?? this.app.vault.getRoot();
    }
    throw new Error("The configured new-note location must be root, current or folder.");
  }

  private mutate<T>(action: () => Promise<T>, saveOpenFiles = true): Promise<T> {
    try { this.app.vault.assertWritable("file-management"); } catch (error) { return Promise.reject(error); }
    if (this.batch) { return Promise.reject(new Error("Wait for the current file or vault-wide property operation to finish.")); }
    const root = this.app.vault.rootPath;
    let operation: Promise<T>;
    try {
      operation = this.app.workspace.withFileMutation(async () => {
        if (!root || root !== this.app.vault.rootPath || this.app.changingVault) { throw new Error("Wait for the selected vault to finish loading."); }
        this.app.vault.assertWritable("file-management");
        if (saveOpenFiles) { await this.app.saveAll(); }
        else if (this.app.workspace.hasUnsavedChanges) { throw new Error("Save or reload unsaved views before applying a planned Markdown batch. No notes were changed."); }
        await this.app.metadataCache.refresh();
        await this.app.metadataCache.pause();
        let failure: unknown;
        let failed = false;
        try {
          if (root !== this.app.vault.rootPath || this.app.changingVault) { throw new Error("The vault changed before its files could be updated."); }
          return await action();
        } catch (error) {
          failed = true;
          failure = error;
          throw error;
        } finally {
          try {
            if (root === this.app.vault.rootPath && !this.app.changingVault) { await this.app.metadataCache.refresh(); }
          } catch (error) {
            if (failed) { throw new AggregateError([failure, error], "The file operation failed and its refreshed inventory could not be loaded."); }
            throw error;
          } finally {
            if (!this.app.changingVault) { this.app.metadataCache.resume(); }
          }
        }
      });
    } catch (error) { return Promise.reject(error); }
    const batch = operation.then(() => {});
    this.batch = batch;
    const remove = (): void => { if (this.batch === batch) { this.batch = null; } };
    batch.then(remove, remove);
    return operation;
  }

  private requireFile(file: TAbstractFile): asserts file is TFile {
    this.app.vault.assertWritable();
    if (!(file instanceof TFile)) { throw new Error("Folder rename, trash and permanent deletion are not supported yet. Individual files and empty-folder creation are supported."); }
    if (file.vault !== this.app.vault || this.app.vault.getAbstractFileByPath(file.path) !== file) { throw new Error("This file is no longer in the selected vault."); }
  }

  createFolder(path: string): Promise<TFolder> {
    return this.mutate(() => this.app.vault.createDirectory(path.replaceAll("\\", "/")));
  }

  applyMarkdownEdits(root: string, edits: readonly VaultFileEdit[]): Promise<VaultDocument[]> {
    return this.mutate(async () => {
      if (root !== this.app.vault.rootPath) { throw new Error("The selected vault changed after the Markdown batch was planned. No notes were changed."); }
      if (this.app.workspace.hasUnsavedChanges) { throw new Error("An open view changed after the Markdown batch was planned. Its text was retained; no notes were changed."); }
      const documents = await this.app.vault.editDocuments(edits, documents => this.app.workspace.acceptExternalDocuments(documents));
      return documents;
    }, false);
  }

  generateMarkdownLink(file: TFile, sourcePath: string, subpath = "", alias?: string): string {
    if (!(file instanceof TFile) || file.vault !== this.app.vault || this.app.vault.getFileByPath(file.path) !== file) {
      throw new Error("The link's file is not in the selected vault.");
    }
    return this.linkForPath(file.path, sourcePath, this.app.vault.getFiles(), subpath, alias);
  }

  private linkForPath(path: string, sourcePath: string, files: readonly { path: string }[], subpath = "", alias?: string): string {
    const setting = this.app.vault.getConfig("useMarkdownLinks");
    if (setting !== undefined && typeof setting !== "boolean") { throw new Error("The configured Markdown-link preference must be a Boolean."); }
    if (typeof subpath !== "string" || alias !== undefined && typeof alias !== "string") { throw new Error("Link subpaths and aliases must be text."); }
    const markdown = setting === true;
    const link = fileLinktext(files, path, sourcePath, !markdown, linkTextFormat(this.app.vault.getConfig("newLinkFormat")));
    const fragment = subpath.replace(/^#/, "");
    if (markdown) {
      const encode = (value: string): string => encodeURIComponent(value).replace(/[()]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
      const target = path === sourcePath && subpath ? "" : link.split("/").map(encode).join("/");
      const suffix = subpath ? "#" + encode(fragment) : "";
      const name = path.split("/").at(-1)!;
      const label = (alias || (/\.md$/i.test(name) ? name.slice(0, -3) : "")).replace(/([\\[\]])/g, "\\$1");
      return "[" + label + "](" + target + suffix + ")";
    }
    const escape = (value: string): string => value.replace(/([\\|#\]])/g, "\\$1");
    const target = path === sourcePath && subpath ? "" : escape(link);
    const suffix = subpath ? "#" + escape(fragment) : "";
    return "[[" + target + suffix + (alias ? "|" + escape(alias) : "") + "]]";
  }

  composeNote(request: NoteComposition): Promise<TFile> {
    if (request.root !== this.app.vault.rootPath || request.source.path !== request.sourcePath || this.app.vault.getFileByPath(request.sourcePath) !== request.source) {
      return Promise.reject(new Error("The selected vault or source note changed. No composition was applied."));
    }
    const initial = this.app.workspace.sessions.get(request.sourcePath);
    if (initial && (initial.text !== request.sourceText || initial.document.version !== request.sourceVersion)) {
      return Promise.reject(new Error("The source note changed while Note composer was open. Reopen it with the intended text or selection."));
    }
    return this.mutate(async () => {
      this.requireFile(request.source);
      if (request.root !== this.app.vault.rootPath || request.source.path !== request.sourcePath) { throw new Error("The selected vault or source note changed. No composition was applied."); }
      if (!/\.md$/i.test(request.targetPath) || request.targetPath.toLowerCase() === request.sourcePath.toLowerCase()) { throw new Error("Choose a different Markdown target note."); }
      const files = this.app.vault.getFiles().map(file => ({ path: file.path }));
      const source = this.app.metadataCache.getDocument(request.sourcePath);
      if (!source || source.cache.errors.length || source.text !== request.sourceText || !request.dirty && source.document.version !== request.sourceVersion) {
        throw new Error("The source note changed or its properties are invalid. Reopen Note composer; the source was not removed.");
      }
      const occupied = this.app.vault.getAllLoadedFiles().find(file => file.path.toLowerCase() === request.targetPath.toLowerCase());
      if (request.create && occupied || !request.create && (!(occupied instanceof TFile) || occupied.path !== request.targetPath)) {
        throw new Error(request.create ? "A file or folder already exists at the new note path." : "The selected target note no longer exists.");
      }
      const target = request.create ? null : this.app.metadataCache.getDocument(request.targetPath);
      if (!request.create && (!target || target.cache.errors.length)) { throw new Error("Resolve the target note's unreadable data or invalid properties before composing."); }
      const selection = request.selection;
      const selected = selection ? composerFragment(source.text, selection.from, selection.to) : source.text;
      const subpaths = selection ? [
        ...source.cache.headings.filter(heading => {
          const section = composerHeading(source.text, heading.position.start.line, source.cache)!;
          if (resolveSubpath(source.cache, "#" + heading.heading)?.start.offset !== section.from) { return false; }
          return section.from >= selection.from && section.to <= selection.to;
        }).map(heading => "#" + heading.heading),
        ...Object.values(source.cache.blocks).filter(block => block.position.start.offset >= selection.from && block.position.end.offset <= selection.to).map(block => "#^" + block.id),
      ] : null;
      if (!selection || subpaths!.length) {
        const issues = this.app.metadataCache.getIssues();
        if (issues.length) { throw new Error("Resolve unreadable notes/properties before repairing incoming references: " + issues.map(issue => issue.path + ": " + issue.message).join("; ")); }
      }
      const rewrite = (text: string, path: string): string => subpaths
        ? rewriteSectionLinks(text, parseMarkdown(text), files, path, request.sourcePath, request.targetPath, subpaths)
        : rewriteFileLinks(text, parseMarkdown(text), files, path, request.sourcePath, request.targetPath);
      let content = subpaths
        ? rewriteSectionLinks(selected, parseMarkdown(selected), files, request.sourcePath, request.sourcePath, request.targetPath, subpaths, request.targetPath)
        : rewriteFileLinks(selected, parseMarkdown(selected), files, request.sourcePath, request.sourcePath, request.targetPath);
      let template = "";
      if (request.template) {
        const destination = createLinkResolver(this.app.vault.getMarkdownFiles())(request.template, "");
        if (!destination || destination.ambiguous) { throw new Error("The composer template is missing or ambiguous. Use its full vault path."); }
        const entry = this.app.metadataCache.getDocument(destination.file.path);
        if (!entry || entry.cache.errors.length) { throw new Error("The composer template is unreadable or has invalid properties."); }
        template = relocateMarkdownLinks(entry.text, entry.cache, files, destination.file.path, request.targetPath);
      }
      content = composerTemplate(content, template, request.source.basename, request.targetPath.split("/").at(-1)!.slice(0, -3));
      const targetText = insertMarkdown(target ? rewrite(target.text, request.targetPath) : "", content, request.placement);
      const combined = parseMarkdown(targetText);
      const transferred = subpaths ?? [...source.cache.headings.map(heading => "#" + heading.heading), ...Object.keys(source.cache.blocks).map(id => "#^" + id)];
      const templateCache = parseMarkdown(template);
      for (const subpath of new Set(transferred)) {
        if (!resolveSubpath(combined, subpath) || subpath.startsWith("#^") && (target?.cache.blocks[subpath.slice(2)] || templateCache.blocks[subpath.slice(2)]) || !subpath.startsWith("#^") && combined.headings.filter(heading => resolveSubpath({ ...combined, headings: [heading] }, subpath)).length !== 1) {
          throw new Error("A moved heading/block would be missing or ambiguous in the target. Resolve the target/template collision first: " + subpath);
        }
      }
      const edits = new Map<string, VaultFileEdit>();
      if (request.create || targetText !== target?.text) { edits.set(request.targetPath, { path: request.targetPath, version: target?.document.version ?? null, content: targetText, create: request.create }); }
      const plannedFiles = request.create ? [...files, { path: request.targetPath }] : files;
      for (const entry of this.app.metadataCache.getDocuments()) {
        const path = entry.document.file.path;
        if (path === request.targetPath || !selection && path === request.sourcePath) { continue; }
        let text = entry.text;
        if (selection && path === request.sourcePath) {
          const link = this.linkForPath(request.targetPath, request.sourcePath, plannedFiles);
          const replacement = request.replacement === "none" ? "" : (request.replacement === "embed" ? "!" : "") + link;
          text = text.slice(0, selection.from) + replacement + text.slice(selection.to);
        }
        const updated = rewrite(text, path);
        if (updated !== entry.text) { edits.set(path, { path, version: entry.document.version, content: updated }); }
      }
      for (const file of this.app.vault.getFiles().filter(file => file.extension.toLowerCase() === "canvas")) {
        const document = await this.app.vault.readDocument(file.path);
        const updated = rewriteCanvasReferences(document.content, files, file.path, request.sourcePath, request.targetPath, subpaths ?? undefined);
        if (updated !== document.content) { edits.set(file.path, { path: file.path, version: document.version, content: updated }); }
      }
      if (edits.size > 256) { throw new Error("Note composition supports up to 256 affected Markdown/Canvas files. No composition was applied."); }
      if (this.app.workspace.hasUnsavedChanges) { throw new Error("An open view changed during composition planning. Its text was retained; save it before retrying."); }
      if (selection) {
        await this.app.vault.editDocuments([...edits.values()], documents => this.app.workspace.acceptExternalDocuments(documents));
      } else {
        const staged = await this.app.workspace.stageFileTrash(request.source);
        let result;
        try {
          if (this.app.workspace.hasUnsavedChanges) { throw new Error("An open view changed while source panes were closing. No merge was applied."); }
          result = await this.app.vault.trashFile(request.source, source.document.version, [...edits.values()]);
        } catch (error) {
          const errors: unknown[] = [error];
          try { await this.app.vault.refresh(); } catch (refreshError) { errors.push(refreshError); }
          try { await staged.rollback(); } catch (restoreError) { errors.push(restoreError); }
          if (errors.length > 1) { throw new AggregateError(errors, "The merge failed and its file inventory or source views could not all be restored."); }
          throw error;
        }
        staged.commit();
        this.app.workspace.acceptExternalDocuments(result.documents);
        this.app.metadataCache.acceptFileMutation(request.source, request.sourcePath, null);
        this.app.vault.trigger("delete", request.source);
        for (const document of result.documents) {
          const file = this.app.vault.getFileByPath(document.file.path);
          if (!file) { throw new Error("A composed note is missing from the returned inventory."); }
          this.app.vault.notifyFileChanged(edits.get(file.path)?.create ? "create" : "modify", file, document.version);
        }
        this.app.workspace.trigger("file-open", this.app.workspace.getActiveFile());
      }
      const file = this.app.vault.getFileByPath(request.targetPath);
      if (!file) { throw new Error("The composed note is missing from its returned inventory."); }
      await this.app.notifyEditor();
      return file;
    });
  }

  renameFile(file: TAbstractFile, value: string, updateLinks = true): Promise<void> {
    return this.mutate(async () => {
      this.requireFile(file);
      const path = value.replaceAll("\\", "/");
      const oldPath = file.path;
      if (path === oldPath) { return; }
      const occupied = this.app.vault.getAllLoadedFiles().find(entry => entry.path.toLowerCase() === path.toLowerCase());
      if (occupied && occupied !== file) { throw new Error("A file or folder already exists at that path."); }
      const extension = path.split("/").at(-1)?.split(".").slice(1).at(-1)?.toLowerCase() ?? "";
      if (this.app.workspace.leaves().some(leaf => leaf.view instanceof FileView && leaf.view.file === file && !leaf.view.canAcceptExtension(extension))) {
        throw new Error("Close views that do not accept the new file extension before changing it.");
      }
      const info = await this.app.vault.getFileInfo(file);
      const files = this.app.vault.getFiles().map(entry => ({ path: entry.path }));
      const originals = new Map(this.app.metadataCache.getDocuments().map(entry => [entry.document.file.path, entry]));
      if (updateLinks) {
        const issues = this.app.metadataCache.getIssues().filter(issue => !issue.path || issue.path.toLowerCase().endsWith(".md") && (!originals.get(issue.path) || originals.get(issue.path)!.cache.errors.length));
        if (issues.length) { throw new Error("Resolve unreadable Markdown/YAML before updating references, or explicitly turn link updates off: " + issues.map(issue => issue.path + ": " + issue.message).join("; ")); }
        if (file.extension.toLowerCase() === "md" && originals.get(oldPath)?.document.version !== info.version) {
          throw new Error("The source note changed after reference indexing. No files were moved; retry using the refreshed note.");
        }
      }
      const edits = updateLinks ? [...originals.values()].flatMap(entry => {
        const content = rewriteFileLinks(entry.text, entry.cache, files, entry.document.file.path, oldPath, path);
        return content === entry.text ? [] : [{ path: entry.document.file.path, version: entry.document.version, content }];
      }) : [];
      if (updateLinks) {
        for (const canvas of this.app.vault.getFiles().filter(file => file.extension.toLowerCase() === "canvas")) {
          const document = await this.app.vault.readDocument(canvas.path);
          let content: string;
          try { content = rewriteCanvasReferences(document.content, files, canvas.path, oldPath, path); }
          catch (error) { throw new Error("Resolve unreadable Canvas data before updating references, or explicitly turn link updates off: " + canvas.path + ": " + (error instanceof Error ? error.message : String(error))); }
          if (content !== document.content) { edits.push({ path: canvas.path, version: document.version, content }); }
        }
      }
      if (edits.length > 256) { throw new Error("A rename currently supports up to 256 affected Markdown/Canvas files. No files were moved."); }
      if (this.app.workspace.hasUnsavedChanges) { throw new Error("An open view changed during rename planning. Its text was retained; save it before retrying."); }
      const result = await this.app.vault.moveFile(file, path, info.version, edits);
      const entry = result.snapshot.files.find(entry => entry.path === file.path);
      if (!entry) { throw new Error("The moved file is absent from its returned inventory."); }
      this.app.workspace.acceptFileRename(file, oldPath, entry, result.documents);
      this.app.metadataCache.acceptFileMutation(file, oldPath, entry);
      const errors: unknown[] = [];
      for (const leaf of this.app.workspace.leaves()) {
        if (leaf.view instanceof FileView && leaf.view.file === file) {
          try { await leaf.view.onRename(file); }
          catch (error) { errors.push(error); }
        }
      }
      this.app.vault.trigger("rename", file, oldPath);
      for (const document of result.documents) {
        const original = originals.get(document.file.path === file.path ? oldPath : document.file.path);
        if (original?.document.version !== document.version) {
          const changed = this.app.vault.getFileByPath(document.file.path);
          if (!changed) { throw new Error("A rewritten reference file is absent from the vault: " + document.file.path); }
          this.app.vault.notifyFileChanged("modify", changed, document.version);
        }
      }
      this.app.workspace.trigger("file-open", this.app.workspace.getActiveFile());
      await this.app.notifyEditor();
      if (errors.length) { throw new AggregateError(errors, "The file moved successfully, but an open view's rename hook failed."); }
    });
  }

  trashFile(file: TAbstractFile): Promise<void> {
    return this.removeFile(file, false);
  }

  deleteFile(file: TAbstractFile): Promise<void> {
    return this.removeFile(file, true);
  }

  private removeFile(file: TAbstractFile, permanent: boolean): Promise<void> {
    return this.mutate(async () => {
      this.requireFile(file);
      const root = this.app.vault.rootPath;
      const info = await this.app.vault.getFileInfo(file);
      const staged = await this.app.workspace.stageFileTrash(file);
      const finish = async (): Promise<void> => {
        staged.commit();
        this.app.metadataCache.acceptFileMutation(file, file.path, null);
        this.app.vault.trigger("delete", file);
        this.app.workspace.trigger("file-open", this.app.workspace.getActiveFile());
        await this.app.notifyEditor();
      };
      try {
        if (permanent) { await this.app.vault.deleteFile(file, info.version); }
        else { await this.app.vault.trashFile(file, info.version); }
      }
      catch (error) {
        const errors: unknown[] = [error];
        let absent = false;
        try {
          await this.app.vault.refresh();
          absent = root === this.app.vault.rootPath && !this.app.vault.getAbstractFileByPath(file.path);
        }
        catch (refreshError) { errors.push(refreshError); }
        if (absent) {
          try { await finish(); }
          catch (finishError) { errors.push(finishError); }
          throw new AggregateError(errors, "The file is no longer present, but its removal response could not be confirmed. Its closed views were not reopened.");
        }
        try { await staged.rollback(); }
        catch (restoreError) { errors.push(restoreError); }
        if (errors.length > 1) { throw new AggregateError(errors, "File removal failed and its file inventory or some open file views could not be restored."); }
        throw error;
      }
      await finish();
    });
  }

  openContextMenu(path: string, event: MouseEvent): void {
    this.fileMenu(path, Menu.forEvent(event), "file-explorer");
  }

  openActions(path: string): void {
    const anchor = document.getElementById("file-actions")?.getBoundingClientRect();
    this.fileMenu(path, new Menu(), "more-options").showAtPosition({ x: anchor?.left ?? 16, y: anchor?.bottom ?? 16 });
  }

  private fileMenu(path: string, menu: Menu, source: string): Menu {
    if (this.app.changingVault || this.app.workspace.isChangingFiles) { throw new Error("Wait for the current vault operation before opening file actions."); }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) { throw new Error("This vault entry no longer exists: " + path); }
    const root = this.app.vault.rootPath;
    const originalPath = file.path;
    menu.dom.dataset.fileMenu = "actions";
    const add = (label: string, action: "folder" | "rename" | "trash"): void => {
      menu.addItem(item => {
        item.setTitle(label).setSection(action === "trash" ? "danger" : "action").setWarning(action === "trash")
          .onClick(() => {
            if (root !== this.app.vault.rootPath || this.app.changingVault || file.path !== originalPath || this.app.vault.getAbstractFileByPath(file.path) !== file) {
              throw new Error("The selected vault or file changed. Reopen its actions.");
            }
            this.editDialog(action, action === "folder" ? null : file, action === "folder" && file instanceof TFolder && !file.isRoot() ? file.path + "/" : "");
          });
        item.dom.dataset.fileAction = action;
      });
    };
    if (file instanceof TFolder) {
      add("New folder", "folder");
      menu.addItem(item => item.setTitle("Folder rename and trash are not implemented").setIsLabel(true));
    }
    else { add("Rename or move", "rename"); add("Move to vault trash", "trash"); }
    this.app.workspace.trigger("file-menu", menu, file, source);
    return menu;
  }

  editDialog(action: "folder" | "rename" | "trash", file: TAbstractFile | null = null, initial = "", renameSelection?: "all" | "start" | "end"): void {
    if (action !== "folder" && !file) { throw new Error("Choose a file first."); }
    const root = this.app.vault.rootPath;
    const originalPath = file?.path;
    this.modal?.close();
    const modal = new Modal(this.app).setTitle(action === "folder" ? "Create folder" : action === "rename" ? "Rename or move file" : "Move file to vault trash");
    this.modal = modal;
    modal.modalEl.dataset.fileDialog = action;
    const form = document.createElement("form");
    const description = document.createElement("p");
    description.textContent = action === "trash"
      ? `${file!.path} will be moved into this vault's .trash folder, not permanently deleted. Incoming links and bookmarks are retained. Open views must allow closing.`
      : "Enter the complete relative vault path. Existing files and folders will not be overwritten.";
    const input = document.createElement("input");
    input.dataset.fileField = "path";
    input.setAttribute("aria-label", action === "folder" ? "Folder path" : "File path");
    input.value = file?.path ?? initial;
    input.required = true;
    const update = document.createElement("input");
    update.type = "checkbox";
    update.checked = true;
    update.dataset.fileField = "update-links";
    const label = document.createElement("label");
    label.append(update, " Update existing links, including properties and relative outgoing links");
    const error = document.createElement("p");
    error.className = "plugin-error";
    error.setAttribute("role", "alert");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "mod-cta";
    save.dataset.fileAction = action;
    save.textContent = action === "folder" ? "Create folder" : action === "rename" ? "Rename or move" : "Move to vault trash";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.dataset.fileAction = "cancel";
    cancel.addEventListener("click", () => modal.close());
    const close = modal.close.bind(modal);
    modal.close = () => { if (!save.disabled) { close(); } };
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } };
    form.append(description);
    if (action !== "trash") { form.append(input); }
    if (action === "rename") { form.append(label); }
    form.append(error, cancel, save);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (save.disabled) { return; }
      const run = async (): Promise<void> => {
        save.disabled = true;
        cancel.disabled = true;
        error.textContent = "";
        try {
          if (root !== this.app.vault.rootPath || this.app.changingVault || file && (file.path !== originalPath || this.app.vault.getAbstractFileByPath(file.path) !== file)) {
            throw new Error("The selected vault or file changed while this dialog was open. No action was taken.");
          }
          if (action === "folder") { await this.createFolder(input.value); }
          else if (action === "rename") { await this.renameFile(file!, input.value, update.checked); }
          else { await this.trashFile(file!); }
          close();
          if (action === "trash") { new Notice("File moved to this vault's .trash folder."); }
        } catch (issue) {
          error.textContent = issue instanceof Error ? issue.message : String(issue);
        } finally { save.disabled = false; cancel.disabled = false; }
      };
      run().catch(reportError);
    });
    modal.contentEl.append(form);
    modal.open();
    if (action !== "trash") {
      input.focus();
      if (action === "rename" && file instanceof TFile && renameSelection) {
        const start = file.path.lastIndexOf("/") + 1;
        const end = start + file.basename.length;
        input.setSelectionRange(renameSelection === "end" ? end : start, renameSelection === "start" ? start : end);
      } else { input.select(); }
    }
    else { cancel.focus(); }
  }

  cancelPrompts(): void { this.modal?.close(); this.modal = null; }

  processFrontMatter(file: TFile, change: (properties: Record<string, unknown>) => void, options?: { ctime?: number; mtime?: number }): Promise<void> {
    if (this.app.workspace.isChangingFiles) { return Promise.reject(new Error("Wait for the current file operation before editing its properties.")); }
    if (options && Object.keys(options).length) {
      return Promise.reject(new Error("Custom timestamps are not supported for frontmatter writes yet."));
    }
    if (file.extension.toLowerCase() !== "md") {
      return Promise.reject(new Error("Frontmatter can only be edited in Markdown files."));
    }
    const root = this.app.vault.rootPath;
    const key = `${root}\0${file.path}`;
    const action = async (): Promise<void> => {
      if (!root || root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingLayout || this.app.vault.getAbstractFileByPath(file.path) !== file) {
        throw new Error("The note or selected vault changed before its properties could be edited.");
      }
      for (const leaf of this.app.workspace.leaves()) {
        if (leaf.view instanceof TextFileView && !(leaf.view instanceof MarkdownView) && leaf.view.file === file) { await leaf.view.save(); }
      }
      const session = this.app.workspace.sessions.get(file.path);
      if (session) {
        await session.save();
        await session.reload(false);
      }
      const document = session?.document ?? await this.app.vault.readDocument(file.path);
      const content = session?.text ?? document.content;
      const updated = updateFrontmatter(content, properties => {
        const result: unknown = change(properties);
        if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
          Promise.resolve(result).catch(reportError);
          throw new Error("A frontmatter callback must finish synchronously.");
        }
      });
      if (updated === content) { return; }
      if (root !== this.app.vault.rootPath || this.app.changingVault) { throw new Error("The vault changed before its properties could be saved."); }
      if (session) {
        if (this.app.workspace.sessions.get(file.path) !== session || session.text !== content) {
          throw new Error("The note changed or closed while editing its properties. Its current text has been retained.");
        }
        const view = [...session.leaves][0];
        if (!view) { throw new Error("The note closed before its property edit could be applied."); }
        let from = 0;
        while (from < content.length && from < updated.length && content[from] === updated[from]) { from++; }
        let to = content.length;
        let end = updated.length;
        while (to > from && end > from && content[to - 1] === updated[end - 1]) { to--; end--; }
        const position = sourcePositions(content)(from, to);
        view.editor.replaceRange(updated.slice(from, end), position.start, position.end);
        await session.save();
      } else {
        await this.app.vault.writeDocument(file.path, updated, document.version, false);
      }
      await this.app.metadataCache.refresh();
    };
    const prior = Promise.all([this.operations.get(key), this.batch]);
    const operation = prior.then(action);
    this.operations.set(key, operation);
    const remove = (): void => { if (this.operations.get(key) === operation) { this.operations.delete(key); } };
    operation.then(remove, remove);
    return this.app.workspace.track(operation);
  }

  renameProperty(oldValue: string, newValue: string): Promise<void> {
    const oldName = propertyName(oldValue);
    const newName = propertyName(newValue);
    if (this.batch) { return Promise.reject(new Error("Wait for the current vault-wide property rename to finish.")); }
    if (["aliases", "tags", "cssclasses"].includes(oldName.toLowerCase()) || ["aliases", "tags", "cssclasses"].includes(newName.toLowerCase())) {
      return Promise.reject(new Error("Renaming built-in aliases, tags or cssclasses is not supported."));
    }
    const root = this.app.vault.rootPath;
    const prior = Promise.all([...this.operations.values()]);
    const action = async (): Promise<void> => {
      if (!root || root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingLayout) { throw new Error("Wait for the selected vault and workspace to finish loading."); }
      await this.app.saveAll();
      await this.app.metadataCache.refresh();
      const issues = this.app.metadataCache.getIssues().filter(issue => {
        const entry = this.app.metadataCache.getDocument(issue.path);
        return !issue.path || issue.path.toLowerCase().endsWith(".md") && (!entry || entry.missing || entry.cache.errors.length > 0);
      });
      if (issues.length) { throw new Error("Resolve metadata/YAML errors before renaming a property across the vault: " + issues.map(issue => issue.path + ": " + issue.message).join("; ")); }
      const edits = this.app.metadataCache.getDocuments().filter(entry => entry.document.file.extension.toLowerCase() === "md").flatMap(entry => {
        const content = renameFrontmatterProperty(entry.text, oldName, newName);
        return content === entry.text ? [] : [{ path: entry.document.file.path, version: entry.document.version, content }];
      });
      if (!edits.length) { throw new Error("No notes contain this property: " + oldName); }
      if (edits.length > 256) { throw new Error("A property rename currently supports up to 256 affected notes; no notes were changed."); }
      const document = await this.app.configuration.read("types");
      const data = copyViewData(document.data, 256);
      const rawTypes = data.types === undefined ? {} : data.types;
      if (!rawTypes || typeof rawTypes !== "object" || Array.isArray(rawTypes) || Object.values(rawTypes).some(value => typeof value !== "string")) {
        throw new Error("Property type configuration must be an object of type names.");
      }
      const types = copyViewData(rawTypes, 256);
      const sources = Object.keys(types).filter(name => name.toLowerCase() === oldName.toLowerCase());
      const target = Object.keys(types).find(name => name.toLowerCase() === newName.toLowerCase());
      if (target && !sources.includes(target)) { throw new Error("The destination property already has an assigned type: " + newName); }
      const type = sources.length ? types[sources[0]] : undefined;
      sources.forEach(name => { delete types[name]; });
      if (sources.length) { Object.defineProperty(types, newName, { value: type, enumerable: true, writable: true, configurable: true }); }
      data.types = types;
      let written: VaultConfigurationDocument | null = null;
      try {
        if (sources.length) { written = await this.app.configuration.write(document, data); }
        await this.app.vault.editDocuments(edits, documents => this.app.workspace.acceptExternalDocuments(documents));
      } catch (error) {
        if (written) {
          try { await this.app.configuration.write(written, document.data); }
          catch (rollbackError) { throw new AggregateError([error, rollbackError], "The property rename failed and its previous type configuration could not be restored. Newer external configuration was retained."); }
        }
        throw error;
      }
      this.app.metadataTypeManager.accept(written ?? document);
      await this.app.metadataCache.refresh();
    };
    const operation = prior.then(action).finally(() => { if (this.batch === operation) { this.batch = null; } });
    this.batch = operation;
    return this.app.workspace.track(operation);
  }
}
