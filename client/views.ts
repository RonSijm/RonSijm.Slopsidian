import type { App } from "./app";
import { copyViewData, type FileEntry, type VaultDocument, type ViewState, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { iconButton } from "./icons";
import { Component } from "./plugin";
import { TFile } from "./vault";
import type { WorkspaceLeaf } from "./workspace";

export type ViewCreator = (leaf: WorkspaceLeaf) => View;

export abstract class View extends Component {
  readonly app: App;
  readonly containerEl = document.createElement("div");
  readonly headerEl = document.createElement("div");
  readonly actionsEl = document.createElement("div");
  protected readonly bodyEl = document.createElement("div");
  icon = "file";
  navigation = false;
  private state: Record<string, unknown> = {};
  private ephemeralState: Record<string, unknown> = {};
  private opened = false;
  private closePrepared = false;

  constructor(readonly leaf: WorkspaceLeaf) {
    super();
    this.app = leaf.workspace.app;
    this.containerEl.className = "workspace-leaf-content";
    this.headerEl.className = "view-header";
    this.actionsEl.className = "view-actions";
    this.bodyEl.className = "view-content";
    this.bodyEl.tabIndex = -1;
    this.headerEl.append(this.actionsEl);
    this.containerEl.append(this.headerEl, this.bodyEl);
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;
  getIcon(): string { return this.icon; }
  getState(): Record<string, unknown> { return copyViewData(this.state); }
  async setState(state: unknown, _result: ViewStateResult): Promise<void> { this.state = copyViewData(state); }
  getEphemeralState(): Record<string, unknown> { return copyViewData(this.ephemeralState); }
  setEphemeralState(state: unknown): void { this.ephemeralState = copyViewData(state); }
  onResize(): void {}
  focus(): void { this.bodyEl.focus(); }
  protected async onOpen(): Promise<void> {}
  protected async onBeforeClose(): Promise<void> {}
  protected async onClose(): Promise<void> {}
  protected async unloadViewContent(): Promise<void> {}

  async openView(): Promise<void> {
    this.closePrepared = false;
    await this.load();
    this.opened = true;
    await this.onOpen();
  }

  async prepareClose(): Promise<void> {
    if (this.opened && !this.closePrepared) {
      await this.onBeforeClose();
      this.closePrepared = true;
    }
  }

  cancelPreparedClose(): void { this.closePrepared = false; }

  async closeView(): Promise<void> {
    await this.prepareClose();
    const opened = this.opened;
    this.opened = false;
    this.closePrepared = false;
    this.containerEl.remove();
    await this.unloadAndWait();
    if (opened) {
      await this.onClose();
      await this.unloadViewContent();
    }
  }
}

export abstract class ItemView extends View {
  readonly contentEl = this.bodyEl;

  override focus(): void { this.contentEl.focus(); }

  addAction(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    const listener = (event: MouseEvent): void => { Promise.resolve().then(() => callback(event)).catch(reportError); };
    const button = iconButton(icon, title, listener);
    this.actionsEl.append(button);
    this.register(() => { button.removeEventListener("click", listener); button.remove(); });
    return button;
  }
}

export abstract class FileView extends ItemView {
  file: TFile | null = null;
  allowNoFile = false;
  override navigation = true;

  getDisplayText(): string { return this.file?.basename ?? "No file"; }
  override getState(): Record<string, unknown> {
    const state = super.getState();
    delete state.file;
    return this.file ? { ...state, file: this.file.path } : state;
  }

  override setEphemeralState(value: unknown): void {
    const state = copyViewData(value);
    const rename = state.rename;
    if (rename !== undefined && rename !== null && rename !== false) {
      if (rename !== "all" && rename !== "start" && rename !== "end") { throw new Error("A file rename selection must be all, start or end."); }
      if (!this.file) { throw new Error("Open a file before requesting its rename."); }
      this.app.fileManager.editDialog("rename", this.file, "", rename);
    }
    delete state.rename;
    super.setEphemeralState(state);
  }

  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    let file: TFile | null = null;
    if (state.file != null) {
      if (typeof state.file !== "string") {
        throw new Error("A file view needs a relative vault file path.");
      }
      const entry = this.app.vault.getAbstractFileByPath(state.file);
      if (!(entry instanceof TFile)) {
        throw new Error(`The view's file does not exist: ${state.file}`);
      }
      file = entry;
    } else if (!this.allowNoFile) {
      throw new Error(`The ${this.getViewType()} view needs a vault file.`);
    }
    const previous = this.file;
    if (previous !== file) {
      await this.loadFile(file);
      result.history = true;
    }
    await super.setState(state, result);
  }

  async loadFile(file: TFile | null): Promise<boolean> {
    if (file !== null && (!(file instanceof TFile) || file.vault !== this.app.vault || this.app.vault.getAbstractFileByPath(file.path) !== file)) {
      throw new Error("A file view can only load a current file from its own vault.");
    }
    const previous = this.file;
    if (previous === file) { return false; }
    let requested = false;
    try {
      if (previous) {
        await this.onUnloadFile(previous);
      }
      this.file = file;
      requested = true;
      if (file) {
        await this.onLoadFile(file);
      }
    } catch (error) {
      if (requested && file) {
        try {
          await this.onUnloadFile(file);
        } catch (cleanupError) {
          error = new AggregateError([error, cleanupError], "The file view could not load or clean up the requested file.");
        }
      }
      await this.restoreFileAfterFailure(previous, error);
    }
    return true;
  }

  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}
  async onRename(_file: TFile): Promise<void> {}
  canAcceptExtension(extension: string): boolean { return this.leaf.workspace.viewTypeForExtension(extension) === this.getViewType(); }

  protected override async unloadViewContent(): Promise<void> {
    if (this.file) {
      await this.loadFile(null);
    }
  }

  protected override async onClose(): Promise<void> {
    this.contentEl.replaceChildren();
    await this.unloadViewContent();
  }

  protected async restoreFileAfterFailure(file: TFile | null, error: unknown): Promise<never> {
    this.file = file;
    if (file) {
      try {
        await this.onLoadFile(file);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "The file view could not restore its previous file after a failed transition.");
      }
    }
    throw error;
  }

  override async closeView(): Promise<void> {
    await super.closeView();
    this.file = null;
  }
}

export abstract class EditableFileView extends FileView {
  /** True only when this view implements a read-only presentation. */
  get isReadOnly(): boolean { return false; }
}

export abstract class TextFileView extends EditableFileView {
  private contentData = "";
  private document: VaultDocument | null = null;
  private saving: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loading = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.register(() => this.cancelSave());
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file === this.file && this.document && !this.hasUnsavedChanges && !this.isSaving) {
        return this.reload(false);
      }
    }));
  }

  abstract getViewData(): string;
  abstract setViewData(data: string, clear: boolean): void | Promise<void>;
  abstract clear(): void | Promise<void>;

  get data(): string { return this.contentData; }
  set data(value: string) { this.contentData = value; }
  get hasUnsavedChanges(): boolean {
    if (this.loading || !this.document) { return false; }
    const state: unknown = this.isDirty;
    const dirty: unknown = typeof state === "function" ? state.call(this) : state;
    if (typeof dirty !== "boolean") { throw new Error("A text view's dirty state must be Boolean or a method returning Boolean."); }
    return dirty;
  }
  get isDirty(): boolean { return !this.loading && this.document !== null && this.viewData() !== this.document.content; }
  get isSaving(): boolean { return this.saving !== null; }
  get savedDocument(): VaultDocument | null { return this.document; }

  acceptFileRename(file: FileEntry): void {
    if (this.document) { this.document = { ...this.document, file }; }
  }

  readonly requestSave = (): void => {
    if (this.app.vault.readOnly || this.loading || !this.savedDocument) {
      return;
    }
    this.cancelSave();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch(reportError);
    }, 2000);
    this.changed();
  };

  protected cancelSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private viewData(): string {
    const text = this.getViewData();
    if (typeof text !== "string") {
      throw new Error("TextFileView.getViewData() must return a string.");
    }
    return text;
  }

  private changed(): void {
    this.leaf.updateHeader();
    this.leaf.workspace.notifyEditor();
  }

  protected override async onBeforeClose(): Promise<void> {
    await super.onBeforeClose();
    if (this.file && !this.isReadOnly) { await this.save(); }
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.cancelSave();
    this.loading = true;
    try {
      const document = await this.app.vault.readDocument(file.path);
      this.data = document.content;
      await this.setViewData(document.content, true);
      this.document = document;
    } finally {
      this.loading = false;
    }
    this.changed();
  }

  override async onUnloadFile(_file: TFile): Promise<void> {
    this.cancelSave();
    if (this.document && this._loaded && !this.isReadOnly) {
      await this.save(true);
    } else {
      // Close preflight saves before owned unload can dispose the text model.
      await this.clear();
      this.data = "";
      this.document = null;
    }
  }

  protected override async restoreFileAfterFailure(file: TFile | null, error: unknown): Promise<never> {
    if (file === this.file && file?.path === this.savedDocument?.file.path && this.hasUnsavedChanges) {
      throw error;
    }
    return super.restoreFileAfterFailure(file, error);
  }

  async save(clear = false): Promise<void> {
    this.cancelSave();
    const persist = async (): Promise<void> => {
      const file = this.file;
      if (!file || !this.document) {
        throw new Error("Load a text file before saving its view.");
      }
      while (this.viewData() !== this.document.content) {
        this.app.vault.assertWritable("save-view", file.path);
        const text = this.viewData();
        this.data = text;
        this.document = await this.app.vault.writeDocument(file.path, text, this.document.version, false);
      }
      if (clear) {
        const text = this.viewData();
        try {
          await this.clear();
        } catch (error) {
          try {
            await this.setViewData(text, false);
          } catch (restoreError) {
            throw new AggregateError([error, restoreError], "The text view could not clear or restore its saved contents.");
          }
          throw error;
        }
        this.data = "";
        this.document = null;
      }
    };
    const operation = (this.saving ?? Promise.resolve()).then(persist, persist);
    this.saving = operation;
    try {
      await operation;
    } finally {
      if (this.saving === operation) {
        this.saving = null;
      }
      this.changed();
    }
  }

  async reload(discard = true): Promise<void> {
    this.cancelSave();
    if (this.saving) {
      await Promise.allSettled([this.saving]);
    }
    const file = this.file;
    if (!file || !this.document) {
      throw new Error("Load a text file before reloading its view.");
    }
    if (!discard && this.hasUnsavedChanges) {
      return;
    }
    const text = this.viewData();
    const document = await this.app.vault.readDocument(file.path);
    if (this.file !== file || this.viewData() !== text) {
      if (discard) {
        throw new Error("The text view changed while reloading. Its unsaved data is retained.");
      }
      return;
    }
    if (document.version === this.document?.version && !discard) {
      return;
    }
    this.loading = true;
    try {
      try {
        await this.setViewData(document.content, discard);
      } catch (error) {
        try {
          await this.setViewData(text, false);
        } catch (restoreError) {
          throw new AggregateError([error, restoreError], "The text view could not reload or restore its previous contents.");
        }
        throw error;
      }
      this.data = document.content;
      this.document = document;
    } finally {
      this.loading = false;
    }
    this.changed();
  }
}

export class EmptyView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.classList.add("empty-state");
    const heading = document.createElement("h2");
    heading.textContent = "No file is open";
    this.contentEl.append(heading);
    for (const [label, command, shortcut] of [
      ["Create a new note", "workspace:new-file", "Ctrl+N"],
      ["Open a note", "switcher:open", "Ctrl+O"],
      ["Open command palette", "command-palette:open", "Ctrl+P"],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.disabled = command === "workspace:new-file" && leaf.workspace.app.vault.readOnly;
      const hint = document.createElement("kbd");
      hint.textContent = shortcut;
      button.append(hint);
      button.addEventListener("click", () => leaf.workspace.app.commands.executeCommandById(command));
      this.contentEl.append(button);
    }
  }

  getViewType(): string { return "empty"; }
  getDisplayText(): string { return "New tab"; }
}

export class UnavailableView extends ItemView {
  constructor(leaf: WorkspaceLeaf, readonly saved: ViewState, reason: string) {
    super(leaf);
    this.contentEl.classList.add("unavailable-view");
    this.contentEl.setAttribute("role", "status");
    const heading = document.createElement("h2");
    heading.textContent = "View unavailable";
    const message = document.createElement("p");
    message.textContent = reason;
    const detail = document.createElement("p");
    detail.textContent = `Saved view: ${saved.type}. Its state is retained. Enable its plugin to restore it.`;
    this.contentEl.append(heading, message, detail);
  }

  getViewType(): string { return "unavailable"; }
  getDisplayText(): string { return `${this.saved.type} (unavailable)`; }
  override getState(): Record<string, unknown> { return copyViewData(this.saved.state); }
}
