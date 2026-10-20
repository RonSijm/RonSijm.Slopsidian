import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { reportError } from "./dom";
import type { NoteComposition } from "./file-manager";
import { createLinkResolver, newLinkedNotePath } from "./links";
import { composerHeading, sourcePositions, type SourceRange } from "./markdown";
import { Modal } from "./ui";
import { MarkdownView } from "./workspace";
import { Menu } from "./menu";
import { TFile } from "./vault";

type CompositionKind = "merge" | "selection" | "heading";
interface ComposerContext {
  view: MarkdownView | null;
  request: Omit<NoteComposition, "targetPath" | "create" | "placement" | "replacement" | "template">;
}

export class NoteComposer {
  readonly id = "note-composer";
  private modal: Modal | null = null;
  private busy = false;
  private readonly menus = new Set<Menu>();

  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, () => {
      const commands = [
        { id: "merge-file", name: "Merge current file with another file", kind: "merge" },
        { id: "split-file", name: "Extract current selection", kind: "selection" },
        { id: "extract-heading", name: "Extract this heading", kind: "heading" },
      ] as const;
      const remove = this.app.commands.install(commands.map(command => ({
        id: this.id + ":" + command.id, name: command.name,
        checkCallback: checking => {
          const context = this.context(command.kind);
          if (!context) { return false; }
          if (!checking) { this.open(command.kind, context); }
          return true;
        },
      })));
      const fileMenu = this.app.workspace.on("file-menu", (menu, file, source) => {
        if (!(menu instanceof Menu) || !(file instanceof TFile) || file.extension.toLowerCase() !== "md" || source === "link-context-menu") { return; }
        this.ownMenu(menu);
        menu.addItem(item => item.setTitle("Merge file with...").setIcon("links").setSection("action").onClick(() => {
          const context = this.app.core.isEnabled(this.id) ? this.context("merge", file) : null;
          if (!context) { throw new Error("The selected Markdown file is no longer available for merging."); }
          this.open("merge", context);
        }));
      });
      const editorMenu = this.app.workspace.on("editor-menu", (menu, editor, info) => {
        if (!(menu instanceof Menu) || !(info instanceof MarkdownView) || !info.file || editor !== info.editor) { return; }
        for (const command of commands.filter(command => command.kind !== "merge")) {
          if (!this.context(command.kind, info.file, info)) { continue; }
          this.ownMenu(menu);
          menu.addItem(item => item.setTitle(command.name).setIcon("file").setSection("selection").onClick(() => {
            const context = this.app.core.isEnabled(this.id) && info.file ? this.context(command.kind, info.file, info) : null;
            if (!context) { throw new Error("The source editor context changed before extraction could start."); }
            this.open(command.kind, context);
          }));
        }
      });
      return () => {
        remove();
        this.app.workspace.offref(fileMenu);
        this.app.workspace.offref(editorMenu);
        for (const menu of this.menus) { menu.hide(); }
        this.menus.clear();
        this.busy = false;
        this.modal?.close();
      };
    }, this);
  }

  private ownMenu(menu: Menu): void {
    if (this.menus.has(menu)) { return; }
    this.menus.add(menu);
    menu.onHide(() => { this.menus.delete(menu); });
  }

  private context(kind: CompositionKind, selectedFile?: TFile, editorView?: MarkdownView): ComposerContext | null {
    if (this.busy || this.app.core.busy || this.app.changingVault || this.app.workspace.isChangingFiles || !this.app.vault.rootPath) { return null; }
    const view = editorView ?? this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = selectedFile ?? (kind === "merge" ? this.app.workspace.getActiveFile() : view?.file);
    if (!(file instanceof TFile) || this.app.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== "md") { return null; }
    const session = this.app.workspace.sessions.get(file.path);
    const document = session?.document ?? this.app.metadataCache.getDocument(file.path)?.document;
    if (!document) { return null; }
    const text = session?.text ?? document.content;
    let selection: SourceRange | null = null;
    if (kind !== "merge") {
      if (!view || !view.isLoaded || view.file !== file || view.getMode() !== "source") { return null; }
      if (kind === "selection") {
        const start = { line: 0, ch: 0 };
        const editor = view.editor;
        selection = { from: editor.getRange(start, editor.getCursor("from")).length, to: editor.getRange(start, editor.getCursor("to")).length };
        if (selection.from === selection.to) { return null; }
      } else {
        selection = composerHeading(text, view.editor.getCursor().line);
        if (!selection) { return null; }
      }
    }
    return { view: view?.file === file ? view : null, request: {
      root: this.app.vault.rootPath, source: file, sourcePath: file.path,
      sourceText: text, sourceVersion: document.version, dirty: session?.dirty ?? false, selection,
    } };
  }

  private open(kind: CompositionKind, context: ComposerContext): void {
    const { replacementText, template, askBeforeMerging } = this.options;
    if (replacementText !== "link" && replacementText !== "embed" && replacementText !== "none" || typeof template !== "string" || typeof askBeforeMerging !== "boolean") {
      throw new Error("Correct the Note composer replacement, template and confirmation settings before composing notes.");
    }
    this.modal?.close();
    const view = context.view;
    const focusBefore = document.activeElement;
    const title = kind === "merge" ? "Merge note" : kind === "heading" ? "Extract heading" : "Extract selection";
    const modal = new Modal(this.app).setTitle(title);
    this.modal = modal;
    modal.modalEl.dataset.coreDialog = this.id;
    modal.modalEl.dataset.composerKind = kind;
    modal.modalEl.setAttribute("aria-label", title);
    const listeners = new AbortController();
    const form = document.createElement("form");
    const fields = document.createElement("fieldset");
    const summary = document.createElement("p");
    summary.textContent = kind === "merge"
      ? "Combine " + context.request.sourcePath + " with another Markdown note, repair incoming links and move the source to vault trash. Cancel leaves files unchanged."
      : "Move the selected text from " + context.request.sourcePath + " into another Markdown note. The source remains open; its replacement is " + replacementText + ".";
    const label = (text: string, control: HTMLElement): void => {
      const item = document.createElement("label");
      item.className = "core-setting-field";
      const name = document.createElement("span");
      name.textContent = text;
      item.append(name, control);
      fields.append(item);
    };
    const target = document.createElement("input");
    target.type = "text";
    target.required = true;
    target.placeholder = "Folder/Note.md";
    target.dataset.composerTarget = "";
    target.setAttribute("aria-label", "Target note");
    const suggestions = document.createElement("datalist");
    suggestions.id = "note-composer-targets";
    target.setAttribute("list", suggestions.id);
    for (const file of this.app.vault.getMarkdownFiles().filter(file => file !== context.request.source).sort((left, right) => left.path.localeCompare(right.path))) {
      const option = document.createElement("option");
      option.value = file.path;
      suggestions.append(option);
    }
    label("Target note", target);
    const create = document.createElement("input");
    create.type = "checkbox";
    create.dataset.composerCreate = "";
    label("Create a new note (Ctrl+Enter)", create);
    const placement = document.createElement("select");
    placement.dataset.composerPlacement = "";
    for (const [value, text] of [["append", "Append to target"], ["prepend", "Prepend to target (Shift+Enter)"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      placement.append(option);
    }
    label("Placement", placement);
    const confirmation = document.createElement("label");
    const confirm = document.createElement("input");
    confirm.type = "checkbox";
    confirm.dataset.composerConfirm = "";
    confirmation.append(confirm, " Combine these notes and move " + context.request.sourcePath + " to vault trash.");
    confirmation.hidden = kind !== "merge" || !askBeforeMerging;
    fields.append(confirmation);
    const help = document.createElement("p");
    help.textContent = "Choose an existing note or enter a new vault path. Ctrl+Enter creates a new target; Shift+Enter prepends. Configured templates and reference repairs are validated before the combined file operation.";
    const error = document.createElement("p");
    error.className = "plugin-error";
    error.setAttribute("role", "alert");
    error.dataset.composerError = "";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "modal-button-container";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.dataset.composerAction = "cancel";
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.textContent = kind === "merge" ? "Merge notes" : "Extract";
    apply.dataset.composerAction = "apply";
    actions.append(cancel, apply);
    let applied = false;
    const update = (): void => {
      fields.disabled = this.busy || applied;
      cancel.disabled = this.busy;
      cancel.textContent = applied ? "Close" : "Cancel";
      apply.disabled = this.busy || applied || !target.value.trim() || !confirmation.hidden && !confirm.checked;
      status.textContent = this.busy ? "Composing notes..." : applied ? "The file operation completed." : "";
    };
    const close = modal.close.bind(modal);
    modal.close = () => { if (!this.busy) { close(); } };
    modal.onClose = () => {
      listeners.abort();
      if (this.modal === modal) { this.modal = null; }
      if (this.app.vault.rootPath === context.request.root && view && this.app.workspace.leaves().some(leaf => leaf.view === view) && view.getMode() === "source") { view.editor.focus(); }
      else if (focusBefore instanceof HTMLElement && focusBefore.isConnected) { focusBefore.focus(); }
    };
    cancel.addEventListener("click", () => modal.close(), { signal: listeners.signal });
    form.addEventListener("input", update, { signal: listeners.signal });
    form.addEventListener("change", update, { signal: listeners.signal });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (apply.disabled) { return; }
      this.busy = true;
      error.textContent = "";
      update();
      this.app.core.run(async () => {
        if (this.modal !== modal || !this.app.core.isEnabled(this.id)) { throw new Error("This Note composer dialog is no longer active. No composition was applied."); }
        if (kind !== "merge" && (!view || !view.isLoaded || view.file !== context.request.source || view.getMode() !== "source" || !this.app.workspace.leaves().some(leaf => leaf.view === view))) {
          throw new Error("The source editor changed. Reopen Note composer with the intended selection.");
        }
        const value = target.value.trim().replaceAll("\\", "/");
        let targetPath: string;
        if (create.checked) {
          targetPath = newLinkedNotePath({ path: value, subpath: "" }, context.request.sourcePath);
        } else {
          const destination = createLinkResolver(this.app.vault.getMarkdownFiles())(value, context.request.sourcePath);
          if (!destination || destination.ambiguous) { throw new Error("Choose an unambiguous existing Markdown note or select Create a new note."); }
          targetPath = destination.file.path;
        }
        if (placement.value !== "append" && placement.value !== "prepend") { throw new Error("Choose Append or Prepend."); }
        const file = await this.app.fileManager.composeNote({
          ...context.request, targetPath, create: create.checked, placement: placement.value,
          replacement: replacementText, template,
        });
        applied = true;
        if (this.app.workspace.hasUnsavedChanges) {
          throw new Error("The files were composed, but an open editor changed during the write. Its unsaved text was retained; resolve it before saving.");
        }
        if (kind === "merge") {
          try { await this.app.openFile(file.path); }
          catch (issue) { throw new Error("The notes were merged, but the target could not be opened: " + (issue instanceof Error ? issue.message : String(issue))); }
        } else if (view) {
          view.editor.setCursor(view.editor.getCursor("to"));
        }
        this.busy = false;
        modal.close();
      }).catch(issue => {
        if (this.modal === modal) { error.textContent = issue instanceof Error ? issue.message : String(issue); }
        else { reportError(issue); }
      }).finally(() => { this.busy = false; update(); }).catch(reportError);
    }, { signal: listeners.signal });
    modal.modalEl.addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey || event.shiftKey)) {
        event.preventDefault();
        if (this.busy || applied) { return; }
        if (event.ctrlKey || event.metaKey) { create.checked = true; }
        if (event.shiftKey) { placement.value = "prepend"; }
        update();
        if (!apply.disabled) { form.requestSubmit(apply); }
        else if (!confirmation.hidden && !confirm.checked) { confirm.focus(); }
      } else if (event.key === "Tab") {
        const focusable = [...modal.modalEl.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter(control => control.getClientRects().length);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }, { signal: listeners.signal });
    form.append(fields, suggestions, help, error, status, actions);
    modal.contentEl.append(summary, form);
    if (kind === "heading" && context.request.selection && view) {
      const range = sourcePositions(context.request.sourceText)(context.request.selection.from, context.request.selection.to);
      view.editor.setSelection(range.start, range.end);
    }
    update();
    modal.open();
    target.focus();
  }
}
