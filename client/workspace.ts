import { Transaction, type Extension } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type CodeMirror from "codemirror";
import type { App } from "./app";
import { copyViewData, requestJson, validateViewType, writeJson, type FileEntry, type LeafLayout, type MarkdownEditingMode, type MarkdownMode, type SidebarLayout, type SplitLayout, type TabsLayout, type VaultDocument, type ViewState, type ViewStateResult, type WorkspaceLayout } from "./contracts";
import { element, reportError } from "./dom";
import { Editor } from "./editor";
import { Events } from "./events";
import { icon, iconButton } from "./icons";
import { TAbstractFile, TFile } from "./vault";
import { ReadingView } from "./reading";
import { parseLinktext, resolveLink, resolveSubpath } from "./links";
import { EmptyView, FileView, TextFileView, UnavailableView, View, type ViewCreator } from "./views";
import type { HoverLinkSource } from "./hover";
import { Menu } from "./menu";
import { livePreview } from "./live-preview";
import { MetadataEditor } from "./properties";
import { syncWorkspaceChildren } from "./workspace-dom";
import { WorkspaceTabDrag } from "./workspace-tab-drag";
import { WorkspacePaneResize } from "./workspace-pane-resize";
import { paneDimensions, resizedPaneDimensions } from "./workspace-pane-size";
import { prepareOriginalWorkspace, readOriginalWorkspace, startupWorkspace } from "./workspace-startup";
import { Notice } from "./ui";
import { RecentFiles, type RecentFilesOptions } from "./recent-files";

export type SplitDirection = "vertical" | "horizontal";
export type PaneType = boolean | "tab" | "split" | "window";

export interface MarkdownFileInfo {
  readonly app: App;
  readonly file: TFile | null;
  readonly editor: Editor;
}

class DocumentSession {
  readonly leaves = new Set<MarkdownView>();
  readonly originRoot: string | null;
  text: string;
  dirty = false;
  private saving: Promise<void> | null = null;
  private reloadDepth = 0;

  constructor(private readonly workspace: Workspace, public document: VaultDocument) {
    this.originRoot = workspace.app.vault.rootPath;
    this.text = document.content;
  }

  get isSaving(): boolean { return this.saving !== null; }
  get isReloading(): boolean { return this.reloadDepth > 0; }

  edit(origin: MarkdownView): void {
    this.text = origin.editor.getValue();
    this.dirty = this.text !== this.document.content;
    for (const leaf of this.leaves) {
      if (leaf !== origin) {
        leaf.editor.syncValue(this.text);
      }
      leaf.leaf.updateHeader();
    }
    this.workspace.trigger("editor-change", origin.editor, origin);
    this.workspace.notifyEditor();
    this.workspace.app.markdownAutosave?.changed(this);
  }

  async save(automatic = false): Promise<void> {
    this.workspace.app.markdownAutosave?.cancel(this);
    while (this.saving) {
      await this.saving;
    }
    if (!this.dirty) {
      return;
    }
    const operation = this.persist(automatic);
    this.saving = operation;
    this.workspace.app.markdownAutosave?.notify();
    try {
      await operation;
      this.workspace.app.markdownAutosave?.saved(this);
    } catch (error) {
      this.workspace.app.markdownAutosave?.failed(this, error);
      throw error;
    } finally {
      if (this.saving === operation) { this.saving = null; }
      if (!this.leaves.size && !this.dirty && this.workspace.sessions.get(this.document.file.path) === this) { this.workspace.sessions.delete(this.document.file.path); }
      this.workspace.app.markdownAutosave?.changed(this);
    }
  }

  private async persist(automatic: boolean): Promise<void> {
    while (this.dirty) {
      if (this.originRoot !== this.workspace.app.vault.rootPath || this.workspace.sessions.get(this.document.file.path) !== this) {
        throw new Error("This note no longer belongs to the selected workspace. Its unsaved text was retained.");
      }
      if (automatic && !this.workspace.app.markdownAutosave?.allows(this)) { return; }
      const text = this.text;
      const saved = await this.workspace.app.vault.writeDocument(this.document.file.path, text, this.document.version, false);
      this.document = { ...saved, hasBom: saved.hasBom ?? this.document.hasBom ?? false };
      this.dirty = this.text !== text;
      for (const leaf of this.leaves) {
        leaf.leaf.updateHeader();
      }
      this.workspace.notifyEditor();
    }
  }

  async reload(discard: boolean): Promise<void> {
    this.reloadDepth++;
    this.workspace.app.markdownAutosave?.cancel(this);
    try {
      if (this.saving) {
        await this.saving;
      }
      const version = this.document.version;
      const text = this.text;
      const document = await this.workspace.app.vault.readDocument(this.document.file.path);
      if (this.workspace.sessions.get(this.document.file.path) !== this) {
        return;
      }
      if (this.text !== text || (!discard && (this.dirty || this.document.version !== version))) {
        if (discard) {
          throw new Error("The note was edited while reloading. Your unsaved text is retained; reload again when ready.");
        }
        return;
      }
      if (!discard && document.version === this.document.version && document.content === this.text) {
        this.document = document;
        return;
      }
      this.document = document;
      this.text = document.content;
      this.dirty = false;
      for (const leaf of this.leaves) {
        leaf.editor.setDocument(this.text, !this.workspace.app.changingVault && leaf.getMode() === "source");
        leaf.leaf.updateHeader();
      }
      this.workspace.notifyEditor();
    } finally {
      this.reloadDepth--;
      this.workspace.app.markdownAutosave?.changed(this);
    }
  }

  acceptDocument(document: VaultDocument): void {
    if (this.dirty || this.isSaving) {
      throw new Error("Save the open note before replacing its document.");
    }
    this.document = document;
    this.text = document.content;
    for (const leaf of this.leaves) {
      leaf.editor.syncValue(this.text);
      leaf.leaf.updateHeader();
    }
    this.workspace.app.markdownAutosave?.changed(this);
  }
}

export class MarkdownView extends TextFileView {
  readonly editor: Editor;
  readonly sourceEl = document.createElement("div");
  readonly previewEl = document.createElement("div");
  readonly metadataEditor: MetadataEditor;
  private readonly inlineTitle = document.createElement("div");
  private readonly contextMenus = new Set<Menu>();
  session: DocumentSession | null = null;
  private mode: MarkdownMode = "source";
  private sourceEditing = true;
  private previewKey = "";
  private readonly reading: ReadingView;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.classList.add("markdown-view-content");
    this.inlineTitle.className = "inline-title";
    this.sourceEl.className = "markdown-source-view mod-cm6";
    this.metadataEditor = new MetadataEditor(this.app.properties, () => this.file);
    this.contentEl.append(this.inlineTitle, this.metadataEditor.contentEl, this.sourceEl, this.previewEl);
    this.reading = new ReadingView(leaf, this.previewEl);
    this.editor = new Editor(this.sourceEl, () => {
      if (!this.session) {
        reportError(new Error("Open a Markdown file before editing."));
        return;
      }
      this.session.edit(this);
    }, () => leaf.workspace.saveAll(), () => {
      if (this.session && this.getMode() === "source") {
        leaf.workspace.trigger("editor-selection-change", this.editor, this);
        if (leaf.workspace.activeLeaf === leaf) { leaf.workspace.notifyEditor(); }
      }
    }, this);
    this.app.attachments?.bind(this);
    this.registerDomEvent(this.contentEl, "scroll", () => {
      if (this.file) {
        leaf.workspace.trigger("markdown-scroll", this);
        if (leaf.workspace.activeLeaf === leaf) { leaf.workspace.notifyEditor(); }
      }
    });
    this.registerDomEvent(this.sourceEl, "contextmenu", event => {
      if (!(event instanceof MouseEvent) || !this.file || this.getMode() !== "source" || this.app.changingVault || this.leaf.workspace.isChangingFiles) { return; }
      const menu = Menu.forEvent(event);
      this.contextMenus.add(menu);
      menu.onHide(() => { this.contextMenus.delete(menu); });
      menu.dom.dataset.editorMenu = this.file.path;
      for (const action of ["cut", "copy", "paste"] as const) {
        menu.addItem(item => item.setTitle(action[0].toUpperCase() + action.slice(1)).setSection("clipboard")
          .onClick(() => this.editClipboard(action)).setDisabled(action !== "paste" && !this.editor.getSelection()));
      }
      menu.addItem(item => item.setTitle("Select all").setSection("selection").onClick(() => {
        this.editor.setSelection({ line: 0, ch: 0 }, { line: this.editor.lastLine(), ch: this.editor.getLine(this.editor.lastLine()).length });
        this.editor.focus();
      }));
      this.app.workspace.trigger("editor-menu", menu, this.editor, this);
    });
    this.register(() => this.dismissMenus());
    for (const name of ["create", "modify", "delete", "rename"]) {
      this.registerEvent(this.app.vault.on(name, () => {
        if (!this.sourceEditing && this.mode === "source") {
          this.previewKey = "";
          this.configureLivePreview();
        }
      }));
    }
    for (const reference of [
      this.app.metadataCache.on("changed", file => { if (file === this.file) { this.updateMetadata(); } }),
      this.app.metadataTypeManager.on("changed", () => this.metadataEditor.render(true)),
      this.app.workspace.on("editor-change", (_editor, view) => { if (view === this) { this.updateMetadata(); } }),
      this.app.core.on("changed", () => this.updateMetadata()),
    ]) { this.registerEvent(reference); }
    for (const [plugin, extensions] of leaf.workspace.editorExtensions) {
      this.editor.addExtension(plugin, extensions);
    }
  }

  getViewType(): string { return "markdown"; }
  private dismissMenus(): void {
    for (const menu of this.contextMenus) { menu.hide(); }
    this.contextMenus.clear();
  }

  private async editClipboard(action: "copy" | "cut" | "paste"): Promise<void> {
    if (!this.file || !this.isLoaded || this.getMode() !== "source" || this.app.changingVault || this.leaf.workspace.isChangingFiles
      || !this.leaf.workspace.leaves().some(leaf => leaf.view === this)) {
      throw new Error("This source editor is no longer available for clipboard actions.");
    }
    const selection = this.editor.cm.state.selection;
    if (selection.ranges.length !== 1) { throw new Error("Clipboard actions with multiple selections are not supported. Select a single range first."); }
    const clipboard = navigator.clipboard;
    if (!clipboard) { throw new Error("Clipboard access requires a supported secure browser or the desktop application."); }
    const file = this.file;
    const root = this.app.vault.rootPath;
    const text = this.editor.getValue();
    let insertion = "";
    if (action === "paste") { insertion = await clipboard.readText(); }
    else {
      await clipboard.writeText(this.editor.getSelection());
      if (action === "copy") { return; }
    }
    if (!this.isLoaded || this.file !== file || this.app.vault.rootPath !== root || this.getMode() !== "source" || this.app.changingVault || this.leaf.workspace.isChangingFiles
      || !this.leaf.workspace.leaves().some(leaf => leaf.view === this) || this.editor.getValue() !== text || !this.editor.cm.state.selection.eq(selection)) {
      throw new Error("The editor or selection changed during clipboard access. No text was replaced.");
    }
    if (action !== "paste" || insertion) {
      this.editor.cm.dispatch(this.editor.cm.state.replaceSelection(insertion.replace(/\r\n?|\n/g, this.editor.cm.state.lineBreak)), {
        annotations: [Transaction.userEvent.of(action === "paste" ? "input.paste" : "delete.cut"), isolateHistory.of("full")],
      });
    }
    this.editor.focus();
  }

  override get data(): string { return this.session?.text ?? ""; }
  override set data(value: string) { this.setViewData(value); }
  override get hasUnsavedChanges(): boolean { return this.session?.dirty ?? false; }
  override get isDirty(): boolean { return this.hasUnsavedChanges; }
  override get isSaving(): boolean { return this.session?.isSaving ?? false; }
  override get savedDocument(): VaultDocument | null { return this.session?.document ?? null; }
  override getDisplayText(): string { return this.file?.basename ?? "New tab"; }
  getViewData(): string { return this.editor.getValue(); }
  override getState(): Record<string, unknown> { return this.file ? { ...super.getState(), mode: this.mode, source: this.sourceEditing } : {}; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value);
    if (state.mode != null && state.mode !== "source" && state.mode !== "preview") {
      throw new Error("A Markdown view mode must be source or preview.");
    }
    if (state.source != null && typeof state.source !== "boolean") {
      throw new Error("A Markdown view's source flag must be Boolean.");
    }
    const file = typeof state.file === "string" ? this.app.vault.getAbstractFileByPath(state.file) : null;
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
      throw new Error(`Unknown Markdown file: ${String(state.file)}`);
    }
    let source = this.sourceEditing;
    if (typeof state.source === "boolean") {
      source = state.source;
    } else if (!this.file) {
      source = (await this.app.configuration.read("app")).data.livePreview !== true;
    }
    this.cancelSave();
    result.history = await this.leaf.workspace.loadMarkdownView(this, file);
    await super.setState(state, result);
    this.sourceEditing = source;
    this.setMode(state.mode ?? (this.app.vault.readOnly ? "preview" : "source"), false);
  }
  getMode(): MarkdownMode { return this.mode; }
  get currentMode(): Editor | ReadingView { return this.mode === "source" ? this.editor : this.reading; }
  get isSourceMode(): boolean { return this.sourceEditing; }
  getEditingMode(): MarkdownEditingMode { return this.mode === "preview" ? "preview" : this.sourceEditing ? "source" : "live-preview"; }
  setEditingMode(mode: MarkdownEditingMode, focus = true): void {
    if (!["source", "preview", "live-preview"].includes(mode)) { throw new Error("Choose Source mode, Live Preview or Reading view."); }
    if (!this.file) { throw new Error("Open a note before changing its editing mode."); }
    if (mode !== "preview") { this.sourceEditing = mode === "source"; }
    this.setMode(mode === "preview" ? "preview" : "source", focus);
  }
  setMode(mode: MarkdownMode, focus = true): void {
    if (mode !== "source" && mode !== "preview") {
      throw new Error("A Markdown view mode must be source or preview.");
    }
    if (!this.file) {
      throw new Error("Open a note before changing its view mode.");
    }
    this.dismissMenus();
    if (mode === "preview") {
      this.reading.render(this.editor.getValue(), this.file.path);
    }
    this.mode = mode;
    this.editor.setEditable(mode === "source" && !this.app.changingVault);
    this.leaf.updateHeader();
    this.leaf.workspace.layoutChanged();
    this.leaf.workspace.notifyEditor();
    this.app.pluginsChanged().catch(reportError);
    if (focus) {
      this.focus();
    }
  }
  toggleMode(): void { this.setMode(this.mode === "source" ? "preview" : "source"); }
  override focus(): void { this.mode === "preview" ? this.reading.focus() : this.editor.focus(); }
  override onResize(): void { this.editor.cm.requestMeasure(); }
  revealLine(line: number): void {
    this.editor.setCursor({ line, ch: 0 });
    if (this.mode === "preview") {
      this.reading.revealLine(line);
    } else {
      this.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      this.editor.focus();
    }
  }
  revealHeading(subpath: string): void { this.reading.revealHeading(subpath); }
  refreshReading(): void {
    const file = this.file;
    if (file && this.mode === "preview") {
      this.reading.render(this.editor.getValue(), file.path);
    } else {
      this.reading.clear();
    }
  }
  updateChrome(): void {
    const preview = this.mode === "preview";
    this.inlineTitle.textContent = this.getDisplayText();
    this.inlineTitle.hidden = !this.file || this.app.configuration.get("app", "showInlineTitle") === false;
    this.sourceEl.hidden = !this.file || preview;
    this.previewEl.hidden = !this.file || !preview;
    this.sourceEl.classList.toggle("is-live-preview", !this.sourceEditing && !preview);
    this.updateMetadata();
    this.leaf.containerEl.dataset.editorMode = this.getEditingMode();
    this.configureLivePreview();
    this.refreshReading();
  }
  private updateMetadata(): void {
    this.metadataEditor.render();
    this.metadataEditor.contentEl.hidden = !this.file || this.getEditingMode() === "source" || !this.app.core.isEnabled("properties");
  }
  resetLivePreview(): void {
    this.previewKey = "";
    this.editor.setLivePreview([]);
  }
  private configureLivePreview(): void {
    const path = this.file?.path, root = this.app.vault.rootPath;
    const enabled = Boolean(path && root && !this.sourceEditing && this.mode === "source");
    const key = enabled ? JSON.stringify([root, path]) : "off";
    if (this.previewKey === key) { return; }
    this.previewKey = key;
    this.editor.setLivePreview(enabled && path && root ? livePreview({
      leaf: this.leaf, path, root,
      isCurrent: () => this.isLoaded && this.leaf.view === this && this.file?.path === path && this.app.vault.rootPath === root
        && this.mode === "source" && !this.sourceEditing && !this.app.changingVault && !this.leaf.workspace.isChangingFiles,
    }) : []);
  }
  override async onUnloadFile(_file: TFile): Promise<void> { this.cancelSave(); await this.session?.save(); }
  override async save(clear = false): Promise<void> { this.cancelSave(); await this.session?.save(); if (clear) { this.clear(); } }
  override async reload(discard = true): Promise<void> {
    if (!this.session) {
      throw new Error("Open a Markdown file before reloading its view.");
    }
    await this.session.reload(discard);
  }
  clear(): void { this.editor.setDocument("", false); }
  override async onLoadFile(file: TFile): Promise<void> {
    await this.leaf.workspace.loadMarkdownView(this, file);
    this.updateChrome();
    this.contentEl.scrollTop = 0;
  }
  override onunload(): void {
    this.leaf.workspace.releaseMarkdownView(this);
    this.reading.clear();
    this.editor.destroy();
  }
  setViewData(content: string): void {
    if (!this.file) {
      throw new Error("Open a Markdown file before setting its content.");
    }
    this.editor.setValue(content);
  }
}

export class WorkspaceLeaf extends Events {
  readonly app: App;
  readonly workspace: Workspace;
  parent: WorkspaceTabs;
  readonly containerEl = document.createElement("div");
  readonly tabHeaderEl = document.createElement("div");
  readonly tabHeaderInnerIconEl = document.createElement("span");
  view: View;
  pinned = false;
  private readonly titleEl = document.createElement("span");
  private readonly dirtyEl = document.createElement("span");
  private readonly pinEl = icon("pin");
  private readonly breadcrumb = document.createElement("div");
  private readonly navigation = document.createElement("div");
  private readonly optionsButton: HTMLButtonElement;
  private readonly readingButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly forwardButton: HTMLButtonElement;
  readonly history: ViewState[] = [];
  historyIndex = -1;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(appOrWorkspace: App | Workspace, parent?: WorkspaceTabs, readonly id: string = crypto.randomUUID()) {
    super();
    const workspace = appOrWorkspace instanceof Workspace ? appOrWorkspace : appOrWorkspace.workspace;
    this.app = workspace.app;
    this.workspace = workspace;
    this.parent = parent ?? new WorkspaceTabs(workspace, new WorkspaceSplit(workspace, null));
    if (this.parent.workspace !== workspace) { throw new Error("A workspace leaf and its parent must belong to the same workspace."); }
    this.containerEl.className = "workspace-leaf";
    this.containerEl.dataset.leafId = id;
    this.containerEl.addEventListener("pointerdown", () => workspace.setActiveLeaf(this, { focus: false }));
    this.tabHeaderEl.className = "workspace-tab-header";
    this.tabHeaderEl.dataset.tabId = id;
    this.tabHeaderEl.setAttribute("role", "tab");
    this.tabHeaderEl.addEventListener("click", () => workspace.activateLeaf(this).catch(reportError));
    this.tabHeaderEl.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        workspace.activateLeaf(this).catch(reportError);
      }
    });
    this.tabHeaderEl.addEventListener("auxclick", event => {
      if (event.button === 1) {
        event.preventDefault();
        workspace.closeLeaf(this).catch(reportError);
      }
    });
    this.titleEl.className = "workspace-tab-header-inner-title";
    this.dirtyEl.className = "workspace-tab-dirty";
    this.dirtyEl.textContent = "*";
    const close = iconButton("close", "Close tab (Ctrl+W)", () => workspace.closeLeaf(this).catch(reportError));
    close.classList.add("workspace-tab-header-inner-close-button");
    close.addEventListener("click", event => event.stopPropagation());
    this.pinEl.classList.add("workspace-tab-pin");
    this.tabHeaderInnerIconEl.className = "workspace-tab-header-inner-icon";
    this.tabHeaderInnerIconEl.append(icon("file"));
    this.tabHeaderEl.append(this.tabHeaderInnerIconEl, this.pinEl, this.titleEl, this.dirtyEl, close);
    workspace.tabDrag.installLeaf(this);

    this.navigation.className = "view-header-nav-buttons";
    this.backButton = iconButton("arrow-left", "Back (Alt+Left)", () => workspace.navigate(this, -1).catch(reportError));
    this.forwardButton = iconButton("arrow-right", "Forward (Alt+Right)", () => workspace.navigate(this, 1).catch(reportError));
    this.navigation.append(this.backButton, this.forwardButton);
    this.breadcrumb.className = "view-header-title";
    this.optionsButton = iconButton("more", "Pane options", () => workspace.app.commands.executeCommandById("workspace:pane-options"));
    this.optionsButton.dataset.workspaceAction = "pane-options";
    this.readingButton = iconButton("book", "Reading view (Ctrl+E)", () => {
      workspace.setActiveLeaf(this, { focus: false });
      workspace.app.commands.executeCommandById("markdown:toggle-preview");
    });
    this.readingButton.dataset.workspaceAction = "toggle-reading-view";
    this.view = new EmptyView(this);
    this.mountView();
    this.updateHeader();
  }

  get session(): DocumentSession | null { return this.view instanceof MarkdownView ? this.view.session : null; }
  get tabHeaderInnerTitleEl(): HTMLElement { return this.titleEl; }
  get isDeferred(): boolean { return this.view instanceof UnavailableView; }
  getRoot(): WorkspaceSplit {
    return this.parent.getRoot();
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(() => {}, () => {});
    return this.workspace.track(result);
  }

  mountView(): void {
    this.view.headerEl.prepend(this.navigation, this.breadcrumb, this.readingButton, this.optionsButton);
    const current = this.containerEl.querySelector(":scope > .workspace-leaf-content");
    if (current) {
      current.replaceWith(this.view.containerEl);
    } else {
      this.containerEl.prepend(this.view.containerEl);
    }
  }

  async openFile(file: TFile, state?: { active?: boolean }): Promise<void> {
    await this.workspace.openInLeaf(this, file, state?.active !== false);
  }

  getViewState(): LeafLayout["state"] {
    const type = this.view instanceof UnavailableView ? this.view.saved.type : this.view.getViewType();
    return { type, state: copyViewData(this.view.getState()), pinned: this.pinned };
  }

  async setViewState(state: ViewState): Promise<void> { await this.workspace.setLeafState(this, state); }
  getEphemeralState(): Record<string, unknown> { return this.view.getEphemeralState(); }
  setEphemeralState(state: unknown): void { this.view.setEphemeralState(state); }

  async loadIfDeferred(): Promise<void> {
    if (this.isDeferred) {
      await this.workspace.setLeafState(this, this.getViewState());
    }
  }
  getDisplayText(): string { return this.view.getDisplayText(); }
  getIcon(): string { return this.view.getIcon(); }
  onResize(): void {
    try {
      this.view.onResize();
    } catch (error) {
      reportError(error);
    }
  }
  togglePinned(): void { this.setPinned(!this.pinned); }
  setPinned(pinned: boolean): void {
    this.pinned = pinned;
    this.updateHeader();
    this.trigger("pinned-change", pinned);
    this.workspace.layoutChanged();
  }
  detach(): void { this.workspace.closeLeaf(this).catch(reportError); }
  serialize(): LeafLayout { return { id: this.id, type: "leaf", state: this.getViewState() }; }

  updateHeader(): void {
    const path = this.view instanceof FileView ? this.view.file?.path : null;
    this.titleEl.textContent = this.getDisplayText();
    this.pinEl.classList.toggle("is-pinned", this.pinned);
    this.tabHeaderEl.title = path ?? "New tab";
    this.tabHeaderEl.dataset.tabPath = path ?? "";
    this.dirtyEl.hidden = !(this.session?.dirty || this.view instanceof TextFileView && !this.view.isReadOnly && this.view.hasUnsavedChanges);
    this.breadcrumb.textContent = path?.replace(/\.md$/i, "").replaceAll("/", " / ") ?? this.getDisplayText();
    this.backButton.disabled = this.historyIndex <= 0;
    this.forwardButton.disabled = this.historyIndex >= this.history.length - 1;
    const markdown = this.view instanceof MarkdownView ? this.view : null;
    const preview = markdown?.getMode() === "preview";
    this.containerEl.dataset.viewType = this.view.getViewType();
    this.view.containerEl.dataset.type = this.view.getViewType();
    if (markdown) {
      this.containerEl.dataset.mode = markdown.getMode();
      markdown.updateChrome();
    } else {
      delete this.containerEl.dataset.mode;
    }
    this.readingButton.hidden = !markdown;
    this.readingButton.disabled = !markdown?.file || this.workspace.app.changingVault;
    const label = preview ? "Editing view (Ctrl+E)" : "Reading view (Ctrl+E)";
    this.readingButton.title = label;
    this.readingButton.setAttribute("aria-label", label);
    this.readingButton.setAttribute("aria-pressed", String(preview));
    this.readingButton.replaceChildren(icon(preview ? "edit" : "book"));
  }
}

export class WorkspaceTabs {
  dimension?: number;
  readonly containerEl = document.createElement("div");
  readonly headerEl = document.createElement("div");
  readonly children: WorkspaceLeaf[] = [];
  currentTab = 0;
  private readonly contentEl = document.createElement("div");
  private readonly newTabButton: HTMLButtonElement;

  constructor(readonly workspace: Workspace, public parent: WorkspaceSplit, readonly id: string = crypto.randomUUID()) {
    this.containerEl.className = "workspace-tabs";
    this.containerEl.dataset.tabGroupId = id;
    this.headerEl.className = "workspace-tab-header-container";
    this.headerEl.setAttribute("role", "tablist");
    this.headerEl.setAttribute("aria-label", "Open notes");
    this.contentEl.className = "workspace-tab-container";
    this.newTabButton = iconButton("plus", "New tab (Ctrl+T)", () => {
      const leaf = workspace.createTab(this);
      workspace.setActiveLeaf(leaf);
    });
    this.newTabButton.dataset.workspaceAction = "new-tab";
    this.containerEl.append(this.headerEl, this.contentEl);
    workspace.tabDrag.installGroup(this);
  }

  getRoot(): WorkspaceSplit { return this.parent.getRoot(); }

  render(): void {
    syncWorkspaceChildren(this.headerEl, [...this.children.map(leaf => leaf.tabHeaderEl), this.newTabButton]);
    syncWorkspaceChildren(this.contentEl, this.children.map(leaf => leaf.containerEl));
    this.select();
  }

  select(): void {
    for (const [index, leaf] of this.children.entries()) {
      const selected = index === this.currentTab;
      leaf.tabHeaderEl.draggable = leaf.getRoot() === this.workspace.rootSplit;
      if (leaf.tabHeaderEl.draggable) { leaf.tabHeaderEl.setAttribute("aria-keyshortcuts", "Control+Shift+PageUp Control+Shift+PageDown"); }
      else { leaf.tabHeaderEl.removeAttribute("aria-keyshortcuts"); }
      leaf.containerEl.hidden = !selected;
      leaf.tabHeaderEl.classList.toggle("is-active", selected);
      leaf.tabHeaderEl.setAttribute("aria-selected", String(selected));
      leaf.tabHeaderEl.tabIndex = selected ? 0 : -1;
      leaf.onResize();
    }
    this.containerEl.classList.toggle("mod-active", this.children.includes(this.workspace.activeLeaf));
  }

  serialize(): TabsLayout {
    return { id: this.id, type: "tabs", ...(this.dimension !== undefined ? { dimension: this.dimension } : {}), children: this.children.map(leaf => leaf.serialize()), currentTab: this.currentTab };
  }
}

export class WorkspaceSplit {
  dimension?: number;
  readonly containerEl = document.createElement("div");
  readonly children: (WorkspaceSplit | WorkspaceTabs)[] = [];
  parent: WorkspaceSplit | null;
  direction: SplitDirection;

  constructor(readonly workspace: Workspace, parentOrDirection: WorkspaceSplit | SplitDirection | null, direction: SplitDirection = "vertical", public id: string = crypto.randomUUID()) {
    this.parent = typeof parentOrDirection === "string" ? null : parentOrDirection;
    this.direction = typeof parentOrDirection === "string" ? parentOrDirection : direction;
    this.containerEl.className = "workspace-split";
    this.containerEl.dataset.splitId = id;
    this.containerEl.dataset.direction = this.direction;
  }

  getRoot(): WorkspaceSplit {
    let root: WorkspaceSplit = this;
    while (root.parent) { root = root.parent; }
    return root;
  }

  insertChild(index: number, child: WorkspaceSplit | WorkspaceTabs | WorkspaceLeaf): void {
    if (!Number.isInteger(index) || index < 0 || index > this.children.length || child.workspace !== this.workspace) {
      throw new Error("Insert a child from the same workspace at an existing split position.");
    }
    for (let parent: WorkspaceSplit | null = this; parent; parent = parent.parent) {
      if (parent === child) { throw new Error("A workspace split cannot contain itself or its ancestor."); }
    }
    const previous = child.parent;
    const connected = this.containerEl.isConnected || previous?.containerEl.isConnected;
    let entry: WorkspaceSplit | WorkspaceTabs;
    if (child instanceof WorkspaceLeaf) {
      const oldIndex = child.parent.children.indexOf(child);
      if (oldIndex >= 0) { child.parent.children.splice(oldIndex, 1); }
      child.parent.currentTab = Math.max(0, Math.min(child.parent.currentTab, child.parent.children.length - 1));
      entry = new WorkspaceTabs(this.workspace, this);
      entry.children.push(child);
      child.parent = entry;
    } else {
      if (previous instanceof WorkspaceSplit) {
        const oldIndex = previous.children.indexOf(child);
        if (oldIndex >= 0) {
          previous.children.splice(oldIndex, 1);
          if (previous === this && oldIndex < index) { index--; }
        }
      }
      entry = child;
      entry.parent = this;
    }
    this.children.splice(index, 0, entry);
    previous?.render();
    this.render();
    if (connected) { this.workspace.layoutChanged(); }
  }

  render(): void {
    this.containerEl.dataset.direction = this.direction;
    // A newly inserted split may adopt an existing live group. Reparent its
    // descendants before removing the old wrappers that still contain them.
    const children = this.workspace.paneResize?.elements(this) ?? this.children.map(child => child.containerEl);
    syncWorkspaceChildren(this.containerEl, children, false);
    for (const child of this.children) {
      child.render();
    }
    syncWorkspaceChildren(this.containerEl, children);
  }

  serialize(): SplitLayout {
    return { id: this.id, type: "split", ...(this.dimension !== undefined ? { dimension: this.dimension } : {}), direction: this.direction, children: this.children.map(child => child.serialize()) };
  }
}

export class WorkspaceSidedock extends WorkspaceSplit {
  collapsed: boolean;
  width = 260;
  private removePanel: (() => void) | null = null;

  constructor(workspace: Workspace, readonly side: "left" | "right") {
    super(workspace, null, "horizontal");
    this.containerEl.classList.add("workspace-sidedock-root");
    this.collapsed = side === "right";
    this.apply();
  }
  toggle(): void { this.collapsed ? this.expand() : this.collapse(); }
  expand(): void { this.collapsed = false; this.apply(); this.workspace.layoutChanged(); }
  collapse(): void { this.collapsed = true; this.apply(); this.workspace.layoutChanged(); }
  setWidth(width: number, persist = true): void {
    this.width = Math.max(160, Math.min(600, width));
    this.apply();
    if (persist) {
      this.workspace.layoutChanged();
    }
  }
  restore(state: SidebarLayout | null | undefined): void {
    this.width = state?.width ?? 260;
    this.collapsed = state?.collapsed ?? this.side === "right";
    this.apply();
  }
  syncPanel(): void {
    this.render();
    if (this.children.length && !this.removePanel) {
      this.removePanel = this.workspace.app.sidebars.register(`workspace-${this.side}`, "Workspace views", this.side, this.containerEl, icon("file"));
    } else if (!this.children.length && this.removePanel) {
      this.removePanel();
      this.removePanel = null;
    }
  }
  reset(): void {
    this.removePanel?.();
    this.removePanel = null;
    this.children.length = 0;
  }
  serializeSidebar(): SidebarLayout {
    return {
      width: this.width, collapsed: this.collapsed,
      ...(this.children.length ? { root: this.serialize() } : {}),
    };
  }
  private apply(): void {
    const shell = element("desktop-shell");
    shell.classList.toggle(`${this.side}-collapsed`, this.collapsed);
    shell.style.setProperty(`--${this.side}-sidebar-width`, `${this.width}px`);
  }
}

export class Workspace extends Events {
  readonly tabDrag: WorkspaceTabDrag;
  readonly paneResize: WorkspacePaneResize;
  readonly hoverLinkSources: Record<string, HoverLinkSource> = Object.assign(Object.create(null), {
    search: { display: "Search", defaultMod: true },
    preview: { display: "Reading view", defaultMod: false },
    editor: { display: "Editor", defaultMod: true },
    "tab-header": { display: "Tab headers", defaultMod: true },
  });
  rootSplit: WorkspaceSplit;
  activeLeaf: WorkspaceLeaf;
  readonly leftSplit: WorkspaceSidedock;
  readonly rightSplit: WorkspaceSidedock;
  readonly editorExtensions = new Map<string, Extension[]>();
  readonly sessions = new Map<string, DocumentSession>();
  private readonly viewOptions = new Map<string, Record<string, unknown>>();
  private readonly viewCreators = new Map<string, { owner: string; create: ViewCreator; closing: boolean }>();
  private readonly extensions = new Map<string, { owner: string; type: string }>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly fileViewTypes = new Set(["markdown"]);
  private readonly recentLeaves: WorkspaceLeaf[] = [];
  private readonly recentFiles = new RecentFiles();
  private recentFilesRoot: string | null = null;
  private recentFilesState: Record<string, unknown> = {};
  private lastFile: string | null = null;
  private lastNotifiedFile: TFile | null = null;
  private activeEditorOverride: MarkdownFileInfo | null = null;
  layoutReady = false;
  private restoring = false;
  private changingViews = 0;
  private layoutWrite: Promise<void> = Promise.resolve();
  private notification: number | null = null;
  private restorationFailed = false;
  private importedWorkspaceRoot: string | null = null;
  private changingLayout = false;
  private changingFiles = false;
  get isChangingLayout(): boolean { return this.changingLayout; }
  get isChangingFiles(): boolean { return this.changingFiles; }

  constructor(readonly app: App, readonly containerEl: HTMLElement) {
    super();
    this.tabDrag = new WorkspaceTabDrag(this);
    this.paneResize = new WorkspacePaneResize(this);
    this.rootSplit = new WorkspaceSplit(this, null);
    const tabs = new WorkspaceTabs(this, this.rootSplit);
    this.rootSplit.children.push(tabs);
    this.activeLeaf = new WorkspaceLeaf(this, tabs);
    tabs.children.push(this.activeLeaf);
    this.leftSplit = new WorkspaceSidedock(this, "left");
    this.rightSplit = new WorkspaceSidedock(this, "right");
    this.render();
    this.on("resize", () => this.leaves().forEach(leaf => leaf.onResize()));
    this.app.vault.on("create", file => {
      if (file instanceof TFile && this.canRecordRecentFiles()) { this.addRecentFile(file); }
    });
    this.app.vault.on("rename", (file, oldPath) => {
      if (!this.canRecordRecentFiles()) { return; }
      if (!(file instanceof TAbstractFile) || typeof oldPath !== "string" || file.vault !== this.app.vault ||
        this.app.vault.getAbstractFileByPath(file.path) !== file) { throw new Error("A vault rename needs its live file and original path."); }
      if (this.recentFiles.rename(oldPath, file.path)) { this.recentFilesChanged(); }
    });
    window.addEventListener("resize", () => { this.trigger("resize"); this.updateCaptionSpacing(); });
  }

  get editorSuggest(): App["editorSuggestions"] { return this.app.editorSuggestions; }

  get activeEditor(): MarkdownFileInfo | null {
    if (this.activeEditorOverride) {
      if (this.activeEditorOverride.file && this.activeEditorOverride.editor.cm.dom.isConnected) { return this.activeEditorOverride; }
      this.activeEditorOverride = null;
    }
    const view = this.activeLeaf.view;
    return view instanceof MarkdownView && view.file && view.getMode() === "source" ? view : null;
  }
  set activeEditor(editor: MarkdownFileInfo | null) {
    if (!(editor instanceof MarkdownView)) { this.activeEditorOverride = editor; }
  }
  unsetActiveEditor(editor?: MarkdownFileInfo): void {
    if (!editor || this.activeEditorOverride === editor) { this.activeEditorOverride = null; }
  }
  getActiveFile(): TFile | null {
    const view = this.getActiveFileView();
    const file = view instanceof FileView ? view.file : this.lastFile ? this.app.vault.getAbstractFileByPath(this.lastFile) : null;
    return file instanceof TFile ? file : null;
  }
  getActiveFileView(): FileView | null {
    let view = this.activeLeaf.view;
    if (!view.navigation) {
      const leaves = this.leaves(), recent = [...this.recentLeaves].reverse().find(leaf => leaves.includes(leaf) && leaf.view.navigation) ?? leaves.find(leaf => leaf.view.navigation);
      if (!recent) { return null; }
      view = recent.view;
    }
    return view instanceof FileView ? view : null;
  }
  get registeredViewCreators(): Readonly<Record<string, ViewCreator>> {
    return Object.freeze(Object.fromEntries([...this.viewCreators].map(([type, registration]) => [type, registration.create])));
  }
  private notifyActiveFile(): void {
    const file = this.getActiveFile();
    if (file !== this.lastNotifiedFile) {
      const previous = this.lastNotifiedFile;
      this.lastNotifiedFile = file;
      if (previous && this.canRecordRecentFiles() && this.app.vault.getFileByPath(previous.path) === previous) { this.addRecentFile(previous); }
      this.trigger("file-open", file);
    }
  }
  private canRecordRecentFiles(): boolean {
    return this.layoutReady && !this.restoring && !this.restorationFailed && !this.app.changingVault &&
      Boolean(this.recentFilesRoot && this.recentFilesRoot === this.app.vault.rootPath);
  }
  getRecentFiles(options?: RecentFilesOptions): string[] {
    const paths = this.recentFiles.getRecentFiles(options);
    return this.recentFilesRoot === this.app.vault.rootPath && !this.app.changingVault ? paths : [];
  }
  getLastOpenFiles(): string[] { return this.getRecentFiles({ showImages: true, showNonImageAttachments: true }); }
  addRecentFile(file: TFile): void {
    if (!(file instanceof TFile) || file.vault !== this.app.vault || this.app.vault.getFileByPath(file.path) !== file) {
      throw new Error("Only a live file in the current vault can be added to recent files.");
    }
    if (!this.canRecordRecentFiles()) { throw new Error("Wait for the vault workspace to finish loading before changing recent files."); }
    if (this.recentFiles.collect(file.path)) { this.recentFilesChanged(); }
  }
  private recentFilesChanged(): void {
    this.trigger("recent-files-changed");
    this.requestSaveLayout().catch(reportError);
  }
  getActiveViewOfType<T extends View>(kind: abstract new (...args: never[]) => T): T | null {
    const view = this.activeLeaf.view;
    return view instanceof kind ? view : null;
  }
  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return this.leaves().filter(leaf => leaf.view instanceof UnavailableView
      ? leaf.view.saved.type === type && this.viewCreators.has(type) && !this.viewCreators.get(type)!.closing
      : leaf.view.getViewType() === type);
  }
  registerHoverLinkSource(id: string, info: HoverLinkSource): void {
    if (!id.trim() || id.length > 256 || id.includes("\0") || !info || typeof info.display !== "string" || typeof info.defaultMod !== "boolean") {
      throw new Error("A hover source needs a valid identifier, display name and modifier rule.");
    }
    this.hoverLinkSources[id] = info;
    this.app.core?.trigger("changed");
  }
  unregisterHoverLinkSource(id: string): void {
    delete this.hoverLinkSources[id];
    this.app.core?.trigger("changed");
  }
  getLeafById(id: string): WorkspaceLeaf | null { return this.leaves().find(leaf => leaf.id === id) ?? null; }
  getMostRecentLeaf(root: WorkspaceSplit = this.rootSplit): WorkspaceLeaf | null {
    const leaves = this.groups(root).flatMap(group => group.children);
    return [...this.recentLeaves].reverse().find(leaf => leaves.includes(leaf)) ?? leaves[0] ?? null;
  }
  iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void { this.groups(this.rootSplit).flatMap(group => group.children).forEach(callback); }
  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void { this.leaves().forEach(callback); }
  iterateCodeMirrors(callback: (editor: CodeMirror.Editor) => unknown): void {
    const constructor: unknown = Reflect.get(window, "CodeMirror");
    const isClassicEditor = (editor: unknown): editor is CodeMirror.Editor => typeof constructor === "function" && editor instanceof constructor;
    const seen = new Set<CodeMirror.Editor>();
    for (const leaf of this.leaves()) {
      for (const wrapper of leaf.view.containerEl.querySelectorAll<HTMLElement>(".CodeMirror")) {
        const editor: unknown = Reflect.get(wrapper, "CodeMirror");
        if (isClassicEditor(editor) && !seen.has(editor)) {
          seen.add(editor);
          callback(editor);
        }
      }
    }
  }
  detachLeavesOfType(type: string): void { this.getLeavesOfType(type).forEach(leaf => leaf.detach()); }
  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    await leaf.loadIfDeferred();
    await this.activateLeaf(leaf);
  }
  onLayoutReady(callback: () => unknown): void {
    if (this.layoutReady) {
      Promise.resolve().then(callback).catch(reportError);
    } else {
      const reference = this.on("layout-ready", () => {
        this.offref(reference);
        Promise.resolve().then(callback).catch(reportError);
      });
    }
  }

  track<T>(operation: Promise<T>): Promise<T> {
    this.tasks.add(operation);
    const remove = (): void => { this.tasks.delete(operation); };
    operation.then(remove, remove);
    return operation;
  }

  registerView(owner: string, type: string, create: ViewCreator): () => Promise<void> {
    validateViewType(type);
    if (["markdown", "empty", "unavailable"].includes(type) || this.viewCreators.has(type) || typeof create !== "function") {
      throw new Error(`View type is already registered, reserved, or has no creator: ${type}`);
    }
    const registration = { owner, create, closing: false };
    this.viewCreators.set(type, registration);
    return async () => {
      if (this.viewCreators.get(type) !== registration) {
        return;
      }
      for (const leaf of this.getLeavesOfType(type)) {
        if (!(leaf.view instanceof UnavailableView)) {
          await leaf.run(() => this.applyLeafState(leaf, { ...leaf.getViewState(), active: false }, true, false, `The plugin providing ${type} is disabled.`));
        }
      }
      this.viewCreators.delete(type);
      let removed = false;
      for (const [extension, value] of this.extensions) {
        if (value.owner === owner && value.type === type) {
          this.extensions.delete(extension);
          removed = true;
        }
      }
      if (removed) { this.trigger("extensions-changed"); }
    };
  }

  registerExtensions(owner: string, extensions: string[], type: string): () => void {
    const registration = this.viewCreators.get(type);
    if (!registration || registration.owner !== owner || !Array.isArray(extensions) || !extensions.length) {
      throw new Error("Register a plugin-owned view before assigning its file extensions.");
    }
    const names = extensions.map(extension => typeof extension === "string" ? extension.toLowerCase() : "");
    if (new Set(names).size !== names.length || names.some(extension => !/^[a-z0-9][a-z0-9_-]*$/.test(extension) || extension === "md" || this.extensions.has(extension))) {
      throw new Error("File extensions must be unique, unregistered names without dots. The built-in Markdown extension is reserved.");
    }
    const binding = { owner, type };
    names.forEach(extension => this.extensions.set(extension, binding));
    this.trigger("extensions-changed");
    return () => {
      let removed = false;
      names.forEach(extension => { if (this.extensions.get(extension) === binding) { this.extensions.delete(extension); removed = true; } });
      if (removed) { this.trigger("extensions-changed"); }
    };
  }

  viewTypeForExtension(extension: string): string | null {
    const name = extension.toLowerCase();
    return name === "md" ? "markdown" : this.extensions.get(name)?.type ?? null;
  }

  async restoreRegisteredViews(owner: string): Promise<void> {
    for (const leaf of this.leaves()) {
      if (leaf.view instanceof UnavailableView && this.viewCreators.get(leaf.view.saved.type)?.owner === owner) {
        await leaf.run(() => this.applyLeafState(leaf, { ...leaf.getViewState(), active: false }));
      }
    }
  }

  async closeOwnerViews(owner: string): Promise<void> {
    const prepared: View[] = [];
    const closed: { leaf: WorkspaceLeaf; state: ViewState; ephemeral: Record<string, unknown> }[] = [];
    const registrations = [...this.viewCreators.values()].filter(registration => registration.owner === owner);
    try {
      for (const leaf of this.leaves()) {
        if (!(leaf.view instanceof UnavailableView) && this.viewCreators.get(leaf.view.getViewType())?.owner === owner) {
          await leaf.view.prepareClose();
          prepared.push(leaf.view);
        }
      }
      registrations.forEach(registration => { registration.closing = true; });
      for (const [type, registration] of this.viewCreators) {
        if (registration.owner === owner) {
          for (const leaf of this.getLeavesOfType(type)) {
            if (!(leaf.view instanceof UnavailableView)) {
              const state = leaf.getViewState();
              const ephemeral = leaf.view.getEphemeralState();
              await leaf.run(() => this.applyLeafState(leaf, { ...state, active: false }, true, false, `The plugin providing ${type} is disabled.`));
              closed.push({ leaf, state, ephemeral });
            }
          }
        }
      }
    } catch (error) {
      registrations.forEach(registration => { registration.closing = false; });
      prepared.forEach(view => view.cancelPreparedClose());
      const errors: unknown[] = [error];
      for (const { leaf, state, ephemeral } of closed) {
        try {
          await leaf.run(async () => {
            await this.applyLeafState(leaf, { ...state, active: false }, false, false);
            leaf.view.setEphemeralState(ephemeral);
          });
        } catch (restoreError) {
          errors.push(restoreError);
        }
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, "The plugin could not close all of its views or restore previously closed views.");
      }
      throw error;
    }
  }

  acceptExternalDocuments(documents: readonly VaultDocument[]): void {
    for (const document of documents) {
      const session = this.sessions.get(document.file.path);
      if (session && !session.dirty && !session.isSaving && session.document.version !== document.version) {
        session.acceptDocument(document);
      }
    }
  }

  withFileMutation<T>(action: () => Promise<T>): Promise<T> {
    this.requireInteractive();
    this.changingFiles = true;
    const root = this.app.vault.rootPath;
    const shell = element("desktop-shell");
    const previousInert = shell.inert;
    const pending = Promise.all([...this.tasks, this.layoutWrite, this.app.markdownAutosave?.whenIdle()]);
    shell.inert = true;
    this.leaves().forEach(leaf => { if (leaf.view instanceof MarkdownView) { leaf.view.editor.setEditable(false); } });
    const operation = pending.then(action).finally(async () => {
      this.changingFiles = false;
      shell.inert = previousInert;
      this.leaves().forEach(leaf => {
        if (leaf.view instanceof MarkdownView) { leaf.view.editor.setEditable(leaf.view.getMode() === "source" && !this.app.changingVault); }
      });
      this.layoutChanged();
      if (root === this.app.vault.rootPath && !this.app.changingVault) { await this.requestSaveLayout(); }
    });
    return this.track(operation);
  }

  acceptFileRename(file: TFile, oldPath: string, entry: FileEntry, documents: readonly VaultDocument[]): void {
    const session = this.sessions.get(oldPath);
    if (session) {
      this.sessions.delete(oldPath);
      session.document = { ...session.document, file: entry };
      this.sessions.set(file.path, session);
    }
    if (this.lastFile === oldPath) { this.lastFile = file.path; }
    for (const leaf of this.leaves()) {
      for (const state of leaf.history) {
        if (this.fileViewTypes.has(state.type) && state.state?.file === oldPath) { state.state.file = file.path; }
      }
      if (leaf.view instanceof UnavailableView && this.fileViewTypes.has(leaf.view.saved.type) && leaf.view.saved.state?.file === oldPath) { leaf.view.saved.state.file = file.path; }
      if (leaf.view instanceof TextFileView && leaf.view.file === file) { leaf.view.acceptFileRename(entry); }
    }
    this.acceptExternalDocuments(documents);
    this.leaves().forEach(leaf => leaf.updateHeader());
  }

  async stageFileTrash(file: TFile): Promise<{ commit(): void; rollback(): Promise<void> }> {
    const closed: { leaf: WorkspaceLeaf; state: ViewState; ephemeral: Record<string, unknown> }[] = [];
    const prepared: View[] = [];
    const rollback = async (): Promise<void> => {
      const errors: unknown[] = [];
      for (const { leaf, state, ephemeral } of [...closed].reverse()) {
        try {
          await leaf.run(() => this.applyLeafState(leaf, { ...state, active: false }, true, false));
          leaf.view.setEphemeralState(ephemeral);
        } catch (error) { errors.push(error); }
      }
      if (errors.length) { throw new AggregateError(errors, "Some views could not be reopened after the file operation failed."); }
    };
    try {
      const leaves = this.leaves().filter(leaf => leaf.view instanceof FileView && leaf.view.file === file
        || leaf.view instanceof UnavailableView && this.fileViewTypes.has(leaf.view.saved.type) && leaf.view.saved.state?.file === file.path);
      for (const leaf of leaves) { await leaf.view.prepareClose(); prepared.push(leaf.view); }
      for (const leaf of leaves) {
        const state = leaf.getViewState();
        const ephemeral = leaf.view.getEphemeralState();
        await leaf.run(() => this.applyLeafState(leaf, { type: "empty", active: false }, false, false));
        closed.push({ leaf, state, ephemeral });
      }
    } catch (error) {
      prepared.forEach(view => view.cancelPreparedClose());
      try { await rollback(); }
      catch (restoreError) { throw new AggregateError([error, restoreError], "File trash was cancelled, but its previously closed views could not all be restored."); }
      throw error;
    }
    return {
      rollback,
      commit: () => {
        if (this.lastFile === file.path) { this.lastFile = null; }
        for (const leaf of this.leaves()) {
          for (let index = leaf.history.length - 1; index >= 0; index--) {
            const state = leaf.history[index];
            if (this.fileViewTypes.has(state.type) && state.state?.file === file.path) {
              leaf.history.splice(index, 1);
              if (index <= leaf.historyIndex) { leaf.historyIndex--; }
            }
          }
          leaf.updateHeader();
        }
      },
    };
  }

  leaves(): WorkspaceLeaf[] { return this.groups().flatMap(group => group.children); }
  private groups(split?: WorkspaceSplit): WorkspaceTabs[] {
    if (!split) {
      return [this.rootSplit, this.leftSplit, this.rightSplit].flatMap(root => this.groups(root));
    }
    return split.children.flatMap(child => child instanceof WorkspaceTabs ? [child] : this.groups(child));
  }

  createTab(parent = (this.getMostRecentLeaf() ?? this.activeLeaf).parent, id?: string): WorkspaceLeaf {
    this.requireInteractive();
    const leaf = new WorkspaceLeaf(this, parent, id);
    parent.children.push(leaf);
    parent.render();
    const root = leaf.getRoot();
    if (root instanceof WorkspaceSidedock) {
      root.syncPanel();
    }
    this.layoutChanged();
    return leaf;
  }

  canMoveLeaf(leaf: WorkspaceLeaf, parent: WorkspaceTabs, index: number): boolean {
    return Boolean(this.app.vault.rootPath) && !this.app.changingVault && !this.restoring && !this.changingLayout
      && !this.changingFiles && !this.changingViews && !this.tasks.size && !this.paneResize?.active
      && leaf instanceof WorkspaceLeaf && parent instanceof WorkspaceTabs && leaf.workspace === this && parent.workspace === this
      && this.groups(this.rootSplit).includes(parent) && this.groups(this.rootSplit).includes(leaf.parent)
      && leaf.parent.children.includes(leaf) && Number.isInteger(index) && index >= 0 && index <= parent.children.length;
  }

  canResizeSplit(split: WorkspaceSplit, index: number): boolean {
    const contains = (node: WorkspaceSplit): boolean => node === split || node.children.some(child => child instanceof WorkspaceSplit && contains(child));
    return Boolean(this.app.vault.rootPath) && !this.app.changingVault && !this.restoring && !this.changingLayout
      && !this.changingFiles && !this.changingViews && !this.tasks.size
      && split instanceof WorkspaceSplit && split.workspace === this && contains(this.rootSplit)
      && Number.isInteger(index) && index >= 0 && index + 1 < split.children.length;
  }

  resizeSplit(split: WorkspaceSplit, index: number, fraction: number): boolean {
    this.requireInteractive();
    if (!this.canResizeSplit(split, index)) { throw new Error("Resize adjacent live main panes after workspace operations finish."); }
    const before = paneDimensions(split.children), visible = this.paneResize?.dimensions(split) ?? before, after = resizedPaneDimensions(visible, index, fraction);
    if (Math.abs(visible[index] / (visible[index] + visible[index + 1]) - fraction) < 1e-7) { return false; }
    if (after.every((value, index) => Math.abs(value - before[index]) < 1e-7)) { return false; }
    split.children.forEach((child, index) => { child.dimension = after[index]; });
    this.paneResize?.update(split);
    this.trigger("resize");
    this.layoutChanged();
    return true;
  }

  tabDestination(leaf: WorkspaceLeaf, direction: -1 | 1, pane = false): { parent: WorkspaceTabs; index: number } | null {
    if (direction !== -1 && direction !== 1 || !this.canMoveLeaf(leaf, leaf.parent, 0)) { return null; }
    if (pane) {
      const groups = this.groups(this.rootSplit), parent = groups[groups.indexOf(leaf.parent) + direction];
      return parent ? { parent, index: parent.children.length } : null;
    }
    const index = leaf.parent.children.indexOf(leaf);
    return index + direction < 0 || index + direction >= leaf.parent.children.length ? null
      : { parent: leaf.parent, index: index + (direction > 0 ? 2 : -1) };
  }

  /** Move an existing main-workspace leaf to an insertion gap; never save or reload its view. */
  moveLeaf(leaf: WorkspaceLeaf, parent: WorkspaceTabs, index: number): boolean {
    if (!this.canMoveLeaf(leaf, parent, index)) { throw new Error("Move a live tab between existing main panes after workspace operations finish."); }
    const previous = leaf.parent, oldIndex = previous.children.indexOf(leaf);
    const destination = previous === parent && oldIndex < index ? index - 1 : index;
    if (previous === parent && oldIndex === destination) { return false; }
    const selected = previous.children[previous.currentTab], active = this.activeLeaf;
    previous.children.splice(oldIndex, 1);
    previous.currentTab = selected !== leaf ? Math.max(0, previous.children.indexOf(selected)) : Math.min(oldIndex, previous.children.length - 1);
    parent.children.splice(destination, 0, leaf);
    leaf.parent = parent;
    parent.currentTab = destination;
    // Move connected nodes into the destination before removing their old group.
    parent.render();
    if (previous !== parent) {
      if (previous.children.length) { previous.render(); }
      else {
        const split = previous.parent;
        split.children.splice(split.children.indexOf(previous), 1);
        this.compact(split);
        this.render();
      }
    }
    this.setActiveLeaf(leaf, { focus: false });
    if (active === leaf) { this.layoutChanged(); }
    return true;
  }

  getLeaf(newLeaf: PaneType = false, direction: SplitDirection = "vertical"): WorkspaceLeaf {
    this.requireInteractive();
    if (newLeaf === "window") {
      throw new Error("Popout windows are not implemented yet.");
    }
    const current = this.getMostRecentLeaf() ?? this.activeLeaf;
    if (newLeaf === "split") {
      return this.createLeafBySplit(current, direction);
    }
    if (newLeaf === true || newLeaf === "tab") {
      return this.createTab();
    }
    if (!current.pinned && (current.view.navigation || current.view instanceof EmptyView)) {
      return current;
    }
    const available = [...this.recentLeaves].reverse().find(leaf => leaf.getRoot() === this.rootSplit && this.leaves().includes(leaf) && !leaf.pinned && leaf.view.navigation);
    return available ?? this.createTab(current.parent);
  }

  getLeftLeaf(split = false): WorkspaceLeaf { return this.createSideLeaf(this.leftSplit, split); }
  getRightLeaf(split = false): WorkspaceLeaf { return this.createSideLeaf(this.rightSplit, split); }

  private createSideLeaf(dock: WorkspaceSidedock, split: boolean): WorkspaceLeaf {
    this.requireInteractive();
    let group = split ? undefined : this.groups(dock)[0];
    if (!group) {
      group = new WorkspaceTabs(this, dock);
      dock.children.push(group);
    }
    const leaf = this.createTab(group);
    dock.syncPanel();
    return leaf;
  }

  async ensureSideLeaf(type: string, side: "left" | "right", options: { active?: boolean; split?: boolean; reveal?: boolean; state?: Record<string, unknown> } = {}): Promise<WorkspaceLeaf> {
    const dock = side === "left" ? this.leftSplit : this.rightSplit;
    const leaf = this.getLeavesOfType(type).find(leaf => leaf.getRoot() === dock) ?? this.createSideLeaf(dock, options.split ?? false);
    await leaf.setViewState({ type, state: options.state ?? leaf.getViewState().state, active: options.active ?? false });
    if (options.reveal !== false) {
      this.app.sidebars.show(`workspace-${side}`);
    }
    return leaf;
  }

  createLeafBySplit(leaf: WorkspaceLeaf, direction: SplitDirection = "vertical", before = false): WorkspaceLeaf {
    this.requireInteractive();
    const group = leaf.parent;
    let split = group.parent;
    if (split.direction !== direction) {
      const nested = new WorkspaceSplit(this, split, direction);
      nested.dimension = group.dimension;
      split.children.splice(split.children.indexOf(group), 1, nested);
      nested.children.push(group);
      group.parent = nested;
      split = nested;
    }
    const dimensions = paneDimensions(split.children), groupIndex = split.children.indexOf(group);
    split.children.forEach((child, index) => { child.dimension = dimensions[index]; });
    group.dimension = dimensions[groupIndex] / 2;
    const tabs = new WorkspaceTabs(this, split);
    tabs.dimension = group.dimension;
    split.children.splice(split.children.indexOf(group) + (before ? 0 : 1), 0, tabs);
    const created = new WorkspaceLeaf(this, tabs);
    tabs.children.push(created);
    this.render();
    this.layoutChanged();
    return created;
  }

  splitActiveLeaf(direction: SplitDirection = "vertical"): WorkspaceLeaf { return this.getLeaf("split", direction); }
  async duplicateLeaf(leaf: WorkspaceLeaf, mode: PaneType = "split", direction: SplitDirection = "vertical"): Promise<WorkspaceLeaf> {
    await leaf.session?.save();
    if (leaf.view instanceof TextFileView && !(leaf.view instanceof MarkdownView) && leaf.view.file) {
      await leaf.view.save();
    }
    const created = mode === "split" ? this.createLeafBySplit(leaf, direction) : this.getLeaf(mode);
    await created.setViewState({ ...leaf.getViewState(), pinned: false, active: true });
    return created;
  }

  setActiveLeaf(leaf: WorkspaceLeaf, options: { focus?: boolean } = {}): void {
    if (!this.leaves().includes(leaf)) {
      throw new Error("Cannot activate a leaf outside this workspace.");
    }
    const changed = this.activeLeaf !== leaf;
    if (changed) { this.unsetActiveEditor(); }
    this.activeLeaf = leaf;
    const recent = this.recentLeaves.indexOf(leaf);
    if (recent >= 0) {
      this.recentLeaves.splice(recent, 1);
    }
    this.recentLeaves.push(leaf);
    if (leaf.view instanceof FileView && leaf.view.navigation && leaf.view.file) {
      this.lastFile = leaf.view.file.path;
    }
    leaf.parent.currentTab = leaf.parent.children.indexOf(leaf);
    for (const group of this.groups()) {
      group.select();
    }
    const root = leaf.getRoot();
    if (root instanceof WorkspaceSidedock && !this.restoring) {
      this.app.sidebars.show(`workspace-${root.side}`);
    }
    if (options.focus !== false) {
      leaf.view.focus();
    }
    if (changed) {
      this.trigger("active-leaf-change", leaf);
      this.notifyActiveFile();
      this.layoutChanged();
    }
    this.notifyEditor();
  }

  async activateLeaf(leaf: WorkspaceLeaf): Promise<void> {
    this.requireInteractive();
    await this.activeLeaf.session?.save();
    this.setActiveLeaf(leaf);
  }

  async openInLeaf(leaf: WorkspaceLeaf, file: TFile, active = true): Promise<void> {
    this.requireInteractive();
    if (file.vault !== this.app.vault || this.app.vault.getAbstractFileByPath(file.path) !== file) {
      throw new Error("Only files in the current vault can be opened in this workspace.");
    }
    const type = leaf.view instanceof FileView && leaf.view.canAcceptExtension(file.extension) ? leaf.view.getViewType() : this.viewTypeForExtension(file.extension);
    if (!type) {
      throw new Error(`No view is registered for .${file.extension || "(no extension)"} files.`);
    }
    const state = { file: file.path, ...(type === "markdown" && leaf.view instanceof MarkdownView ? { mode: leaf.view.getMode(), source: leaf.view.isSourceMode } : {}) };
    await leaf.setViewState({ type, state, active });
  }

  async loadMarkdownView(view: MarkdownView, file: TFile): Promise<boolean> {
    if (view.session?.document.file.path === file.path) {
      return false;
    }
    const existing = this.sessions.get(file.path);
    const document = existing?.document ?? await this.app.vault.readDocument(file.path);
    await view.session?.save();
    const session = this.sessions.get(file.path) ?? existing ?? new DocumentSession(this, document);
    this.releaseMarkdownView(view);
    this.sessions.set(file.path, session);
    view.session = session;
    view.file = file;
    session.leaves.add(view);
    view.resetLivePreview();
    view.editor.setDocument(session.text, !this.app.changingVault && view.getMode() === "source");
    return true;
  }

  async setLeafState(leaf: WorkspaceLeaf, state: ViewState): Promise<void> {
    this.requireInteractive();
    validateViewType(state.type);
    const snapshot = { ...state, state: copyViewData(state.state) };
    const root = this.app.vault.rootPath;
    const requireFile = this.fileViewTypes.has(snapshot.type) || [...this.extensions.values()].some(binding => binding.type === snapshot.type);
    const file = requireFile && typeof snapshot.state.file === "string" ? this.app.vault.getFileByPath(snapshot.state.file) : null;
    await leaf.run(() => {
      if (this.app.vault.rootPath !== root || file && this.app.vault.getFileByPath(file.path) !== file) {
        throw new Error("The selected vault or requested file changed before its view could open.");
      }
      return this.applyLeafState(leaf, snapshot, false, true, undefined, requireFile);
    });
  }

  private async applyLeafState(leaf: WorkspaceLeaf, state: ViewState, allowUnavailable = false, history = true, unavailableReason?: string, requireFile = false): Promise<void> {
    if (!this.leaves().includes(leaf)) {
      throw new Error("Cannot change a leaf outside this workspace.");
    }
    validateViewType(state.type);
    if (state.active !== undefined && typeof state.active !== "boolean" || state.pinned !== undefined && typeof state.pinned !== "boolean") {
      throw new Error("A view's active and pinned flags must be Boolean.");
    }
    const data = copyViewData(state.state);
    if (state.type === "markdown" && !unavailableReason) {
      const file = typeof data.file === "string" ? this.app.vault.getAbstractFileByPath(data.file) : null;
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md" || data.mode != null && data.mode !== "source" && data.mode !== "preview") {
        throw new Error("A Markdown view needs an existing Markdown file and a source or preview mode.");
      }
      if (data.source != null && typeof data.source !== "boolean") { throw new Error("A Markdown view's source flag must be Boolean."); }
    } else if (state.type === "empty" && (data.file != null || data.mode != null && data.mode !== "source")) {
      throw new Error("An empty view cannot contain a file or a reading view.");
    }
    const previous = leaf.view;
    const previousState = leaf.getViewState();
    const previousEphemeral = previous.getEphemeralState();
    const result: ViewStateResult = { history: false };
    const replace = Boolean(unavailableReason) || !previous._loaded || previous instanceof UnavailableView || previous.getViewType() !== state.type;
    this.changingViews++;
    try {
      if (previous._loaded && (replace || !(previous instanceof MarkdownView) || state.type !== "markdown" || data.file !== previous.file?.path)) {
        await leaf.session?.save();
      }
      if (previous._loaded && previous instanceof TextFileView && !(previous instanceof MarkdownView) && previous.file) {
        await previous.save();
      }
      if (replace) {
        let next: View | undefined;
        try {
          await previous.prepareClose();
          if (unavailableReason) {
            next = new UnavailableView(leaf, { type: state.type, state: data }, unavailableReason);
          } else if (state.type === "markdown") {
            next = new MarkdownView(leaf);
          } else if (state.type === "empty") {
            next = new EmptyView(leaf);
          } else {
            const registration = this.viewCreators.get(state.type);
            if (registration) {
              next = registration.create(leaf);
            } else if (allowUnavailable) {
              next = new UnavailableView(leaf, { type: state.type, state: data }, `No enabled plugin has registered the ${state.type} view.`);
            } else {
              throw new Error(`No enabled plugin has registered the ${state.type} view.`);
            }
          }
          if (!(next instanceof View) || next.leaf !== leaf || next === previous || !(next instanceof UnavailableView) && next.getViewType() !== state.type) {
            throw new Error(`The ${state.type} creator must return a new shared View of that type for the requested leaf.`);
          }
          if (requireFile && !(next instanceof FileView)) {
            throw new Error(`The registered ${state.type} view does not extend FileView.`);
          }
          if (next instanceof FileView) { this.fileViewTypes.add(next.getViewType()); }
          leaf.view = next;
          leaf.mountView();
          await next.openView();
          if (!(next instanceof UnavailableView)) {
            await next.setState(data, result);
          }
          copyViewData(next.getState());
          leaf.updateHeader();
          await previous.closeView();
        } catch (error) {
          if (next instanceof View && next !== previous && next.leaf === leaf) {
            try {
              await next.closeView();
            } catch (cleanupError) {
              await next.unloadAndWait();
              next.containerEl.remove();
              error = new AggregateError([error, cleanupError], "The view could not open and its close hook also failed.");
            }
          }
          previous.cancelPreparedClose();
          try {
            if (previous._loaded) {
              leaf.view = previous;
              leaf.mountView();
              leaf.updateHeader();
            } else {
              await this.restoreClosedView(leaf, previousState, previousEphemeral);
            }
          } catch (restoreError) {
            throw new AggregateError([error, restoreError], "The view transition failed after teardown and its previous saved state could not be restored.");
          }
          throw error;
        }
      } else {
        if (requireFile && !(previous instanceof FileView)) {
          throw new Error(`The registered ${state.type} view does not extend FileView.`);
        }
        await previous.setState(data, result);
        copyViewData(previous.getState());
      }
      if (state.pinned !== undefined) {
        leaf.pinned = state.pinned;
      }
      leaf.updateHeader();
      if (history && (replace || result.history || leaf.historyIndex < 0)) {
        if (leaf.historyIndex >= 0) {
          leaf.history[leaf.historyIndex] = { type: previousState.type, state: previousState.state };
        }
        leaf.history.splice(leaf.historyIndex + 1);
        const current = leaf.getViewState();
        leaf.history.push({ type: current.type, state: current.state });
        leaf.historyIndex = leaf.history.length - 1;
        leaf.updateHeader();
      }
      if (state.active !== false) {
        this.setActiveLeaf(leaf);
      }
      if (leaf.view instanceof FileView && leaf.view.file) {
        if (leaf === this.activeLeaf || this.lastFile === null) {
          this.lastFile = leaf.view.file.path;
        }
      }
      this.notifyActiveFile();
    } finally {
      this.changingViews--;
      this.layoutChanged();
      this.notifyEditor();
    }
    await this.app.notifyEditor();
    await this.app.pluginsChanged();
  }

  async openLinkText(linktext: string, sourcePath: string, mode: PaneType = false): Promise<void> {
    const reference = linktext.replace(/^\[\[|\]\]$/g, "").split(/(?<!\\)\|/)[0];
    const target = parseLinktext(reference);
    const file = resolveLink(this.app.vault.getFiles(), reference, sourcePath)?.file;
    if (!file) {
      throw new Error(`The linked file does not exist: ${linktext}`);
    }
    this.app.metadataCache.updateOpenDocuments();
    const cache = this.app.metadataCache.getFileCache(file);
    const position = target.subpath && cache ? resolveSubpath(cache, target.subpath) : null;
    if (target.subpath && !position) {
      throw new Error(`The linked heading or block does not exist: ${linktext}`);
    }
    const leaf = this.getLeaf(mode);
    await leaf.openFile(file);
    if (position && leaf.view instanceof MarkdownView) { leaf.view.revealLine(position.start.line); }
  }

  async navigate(leaf: WorkspaceLeaf, direction: -1 | 1): Promise<void> {
    this.requireInteractive();
    await leaf.run(async () => {
      const index = leaf.historyIndex + direction;
      const state = leaf.history[index];
      if (!state) {
        return;
      }
      const current = leaf.getViewState();
      leaf.history[leaf.historyIndex] = { type: current.type, state: current.state };
      await this.applyLeafState(leaf, state, false, false);
      leaf.historyIndex = index;
      leaf.updateHeader();
    });
  }

  async clearLeaf(leaf: WorkspaceLeaf): Promise<void> {
    this.requireInteractive();
    await leaf.run(() => this.applyLeafState(leaf, { type: "empty", active: false }));
  }

  private async restoreClosedView(leaf: WorkspaceLeaf, state: ViewState, ephemeral: Record<string, unknown>): Promise<void> {
    leaf.view = new EmptyView(leaf);
    leaf.mountView();
    await leaf.view.openView();
    await this.applyLeafState(leaf, { ...state, active: false }, true, false);
    leaf.view.setEphemeralState(ephemeral);
  }

  async closeLeaf(leaf: WorkspaceLeaf): Promise<void> {
    await leaf.run(async () => {
      if (!this.leaves().includes(leaf)) {
        return;
      }
      await leaf.session?.save();
      const group = leaf.parent;
      const index = group.children.indexOf(leaf);
      const previous = leaf.view;
      const recentFile = leaf === this.activeLeaf && previous instanceof FileView && previous.navigation ? previous.file : null;
      const state = leaf.getViewState();
      const ephemeral = previous.getEphemeralState();
      try { await previous.closeView(); }
      catch (error) {
        previous.cancelPreparedClose();
        if (!previous._loaded) {
          try { await this.restoreClosedView(leaf, state, ephemeral); }
          catch (restoreError) { throw new AggregateError([error, restoreError], "The pane could not close and its previous saved state could not be restored."); }
        }
        throw error;
      }
      group.children.splice(index, 1);
      if (recentFile && this.canRecordRecentFiles() && this.app.vault.getFileByPath(recentFile.path) === recentFile) { this.addRecentFile(recentFile); }
      const recent = this.recentLeaves.indexOf(leaf);
      if (recent >= 0) {
        this.recentLeaves.splice(recent, 1);
      }
      if (!group.children.length) {
        if (leaf.getRoot() === this.rootSplit && this.groups(this.rootSplit).length === 1) {
          group.children.push(new WorkspaceLeaf(this, group));
        } else {
          const split = group.parent;
          split.children.splice(split.children.indexOf(group), 1);
          this.compact(split);
        }
      }
      group.currentTab = Math.max(0, Math.min(group.currentTab, group.children.length - 1));
      if (this.activeLeaf === leaf) {
        this.activeLeaf = group.children[Math.min(index, group.children.length - 1)] ?? this.leaves()[0];
      }
      this.render();
      this.setActiveLeaf(this.activeLeaf);
      this.trigger("active-leaf-change", this.activeLeaf);
      this.notifyActiveFile();
      this.layoutChanged();
      await this.app.notifyEditor();
      await this.app.pluginsChanged();
    });
  }

  private compact(split: WorkspaceSplit): void {
    if (split.parent && !split.children.length) {
      const parent = split.parent;
      parent.children.splice(parent.children.indexOf(split), 1);
      this.compact(parent);
    } else if (split.parent && split.children.length === 1) {
      const child = split.children[0];
      child.dimension = split.dimension;
      child.parent = split.parent;
      split.parent.children.splice(split.parent.children.indexOf(split), 1, child);
      this.compact(split.parent);
    } else if (!split.parent && split.children.length === 1 && split.children[0] instanceof WorkspaceSplit) {
      const child = split.children[0];
      split.direction = child.direction;
      split.children.splice(0, 1, ...child.children);
      split.children.forEach(entry => { entry.parent = split; });
    }
    if ((!split.parent || split.parent.children.includes(split)) && split.children.some(child => child.dimension !== undefined)) {
      const dimensions = paneDimensions(split.children);
      split.children.forEach((child, index) => { child.dimension = dimensions[index]; });
    }
  }

  releaseMarkdownView(view: MarkdownView): void {
    const session = view.session;
    session?.leaves.delete(view);
    if (session && !session.leaves.size && !session.dirty && !session.isSaving) {
      this.app.markdownAutosave?.cancel(session);
      this.sessions.delete(session.document.file.path);
    }
    view.session = null;
    view.file = null;
  }

  async saveAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.save();
    }
    for (const leaf of this.leaves()) {
      if (leaf.view instanceof TextFileView && !(leaf.view instanceof MarkdownView) && leaf.view.file) {
        if (!leaf.view.isReadOnly) { await leaf.view.save(); }
      }
    }
    await this.app.notifyEditor();
  }

  get hasUnsavedChanges(): boolean {
    return [...this.sessions.values()].some(session => session.dirty || session.isSaving)
      || this.leaves().some(leaf => leaf.view instanceof TextFileView && !leaf.view.isReadOnly && (leaf.view.hasUnsavedChanges || leaf.view.isSaving));
  }

  async whenIdle(): Promise<void> {
    while (this.tasks.size) {
      await Promise.all([...this.tasks]);
    }
    await this.app.markdownAutosave?.whenIdle();
  }

  async reloadCurrent(discard = true): Promise<void> {
    if (this.activeLeaf.view instanceof TextFileView) {
      await this.activeLeaf.view.reload(discard);
      await this.app.notifyEditor();
      return;
    }
    const session = this.activeLeaf.session;
    if (!session) {
      throw new Error("Open a note first.");
    }
    await session.reload(discard);
    await this.app.notifyEditor();
  }

  addEditorExtension(id: string, extension: Extension): void {
    const extensions = this.editorExtensions.get(id) ?? [];
    extensions.push(extension);
    this.editorExtensions.set(id, extensions);
    this.leaves().forEach(leaf => {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.editor.addExtension(id, extension);
      }
    });
  }
  removeEditorExtensions(id: string): void {
    this.editorExtensions.delete(id);
    this.leaves().forEach(leaf => {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.editor.removeExtensions(id);
      }
    });
  }

  updateOptions(): void {
    for (const leaf of this.leaves()) {
      if (leaf.view instanceof MarkdownView) { leaf.view.editor.updateOptions(); }
    }
  }

  getLayout(): WorkspaceLayout {
    return {
      version: 1, main: this.rootSplit.serialize(), active: this.activeLeaf.id,
      left: this.leftSplit.serializeSidebar(),
      right: this.rightSplit.serializeSidebar(),
      views: {
        ...Object.fromEntries(this.viewOptions),
        "workspace-navigation": {
          ...this.getViewOptions("workspace-navigation"),
          lastMainLeaf: this.getMostRecentLeaf()?.id ?? null,
          lastFile: this.lastFile,
        },
      },
    };
  }

  getViewOptions(id: string): Record<string, unknown> {
    return structuredClone(this.viewOptions.get(id) ?? {});
  }

  setViewOptions(id: string, values: Record<string, unknown>): void {
    if (id === "workspace-recent-files") { throw new Error("Recent-file history belongs to the automatic workspace, not a view or named profile."); }
    this.viewOptions.set(id, { ...this.getViewOptions(id), ...structuredClone(values) });
    this.layoutChanged();
  }

  requestSaveLayout(): Promise<void> {
    // Core/plugin cleanup can run after the host selected the next vault.
    // Keep draining existing writes, but never enqueue an old-root snapshot then.
    return this.app.changingVault ? this.layoutWrite : this.writeCurrentLayout();
  }

  private writeCurrentLayout(): Promise<void> {
    if (this.restoring || this.changingViews || this.changingFiles || !this.app.vault.rootPath) {
      return Promise.resolve();
    }
    if (this.restorationFailed) {
      return Promise.reject(new Error("The saved workspace could not be restored. Run 'Reset workspace layout' to replace it; the unreadable layout has been retained."));
    }
    const layout = this.getLayout();
    const root = this.app.vault.rootPath;
    if (root !== this.recentFilesRoot) { return Promise.reject(new Error("Recent files belong to a different vault workspace.")); }
    layout.views = { ...layout.views, "workspace-recent-files": { ...copyViewData(this.recentFilesState), paths: this.recentFiles.serialize() } };
    const write = () => writeJson(`/api/workspace?root=${encodeURIComponent(root)}`, layout);
    this.layoutWrite = this.layoutWrite.then(write, write);
    return this.layoutWrite;
  }

  async flushLayout(): Promise<void> {
    await this.whenIdle();
    await this.requestSaveLayout();
  }

  /** The transition owner calls this before asking the host to change vaults. */
  async saveLayoutBeforeVaultChange(): Promise<void> {
    if (!this.app.changingVault) { throw new Error("Prepare a vault change before saving its final layout."); }
    await this.whenIdle();
    await this.layoutWrite;
    await this.writeCurrentLayout();
  }

  async resetLayout(): Promise<void> {
    await this.saveAll();
    this.restorationFailed = false;
    if (this.recentFilesRoot !== this.app.vault.rootPath) {
      this.recentFiles.load();
      this.recentFilesState = {};
      this.recentFilesRoot = this.app.vault.rootPath;
    }
    for (const leaf of this.leaves()) {
      await this.closeLeaf(leaf);
    }
    await this.flushLayout();
  }

  async importObsidianWorkspace(): Promise<void> {
    this.requireInteractive();
    const root = this.app.vault.rootPath;
    if (!root) { throw new Error("Open a vault before importing a workspace."); }
    const source = await readOriginalWorkspace(root), selected = prepareOriginalWorkspace(root, source);
    if (!selected.layout) { throw new Error("This vault has no .obsidian/workspace.json to import."); }
    if (!window.confirm("Save open documents and replace this application's layout with Obsidian's active workspace? The original workspace.json is retained."
      + (selected.warnings.length ? "\n\n" + selected.warnings.join("\n") : ""))) { return; }
    const changed = () => new Error("The vault or original workspace changed after review. No layout was imported; review it again.");
    if (this.app.vault.rootPath !== root) { throw changed(); }
    const current = await readOriginalWorkspace(root);
    if (this.app.vault.rootPath !== root || current.root !== root || current.id !== "workspace" || current.version !== source.version) {
      throw changed();
    }
    await this.changeLayout(selected.layout);
  }

  async checkpointImportedWorkspace(): Promise<void> {
    if (!this.importedWorkspaceRoot || this.app.changingVault) { return; }
    if (this.importedWorkspaceRoot !== this.app.vault.rootPath) { this.importedWorkspaceRoot = null; return; }
    const root = this.importedWorkspaceRoot;
    await this.whenIdle();
    if (this.app.changingVault || this.importedWorkspaceRoot !== root || this.app.vault.rootPath !== root) { return; }
    await this.requestSaveLayout();
    if (this.importedWorkspaceRoot === root) { this.importedWorkspaceRoot = null; }
  }

  private requireInteractive(): void {
    if (this.app.changingVault) {
      throw new Error("The workspace is changing vaults. Wait for it to finish.");
    }
    if (this.changingLayout) {
      throw new Error("The workspace is applying a saved layout. Wait for it to finish.");
    }
    if (this.changingFiles) {
      throw new Error("The workspace is changing vault files. Wait for it to finish.");
    }
    this.paneResize?.cancel();
  }

  private makeLayoutTree(node: SplitLayout | TabsLayout, parent: WorkspaceSplit | null): WorkspaceSplit | WorkspaceTabs {
    if (node.type === "split") {
      const split = new WorkspaceSplit(this, parent, node.direction, node.id);
      if (node.dimension != null) { split.dimension = node.dimension; }
      split.children.push(...node.children.map(child => this.makeLayoutTree(child, split)));
      return split;
    }
    if (!parent) { throw new Error("A tab group requires a parent split."); }
    const tabs = new WorkspaceTabs(this, parent, node.id);
    if (node.dimension != null) { tabs.dimension = node.dimension; }
    for (const state of node.children) {
      const leaf = new WorkspaceLeaf(this, tabs, state.id);
      leaf.pinned = state.state.pinned ?? false;
      tabs.children.push(leaf);
    }
    tabs.currentTab = node.currentTab;
    return tabs;
  }

  async changeLayout(value: unknown): Promise<void> {
    this.requireInteractive();
    if (this.restoring) { throw new Error("Wait for workspace restoration to finish."); }
    this.changingLayout = true;
    const idle = Promise.all([...this.tasks, this.layoutWrite]);
    const operation = idle.then(() => this.applyLayout(value)).finally(() => { this.changingLayout = false; });
    return this.track(operation);
  }

  private async applyLayout(value: unknown): Promise<void> {
    const root = this.app.vault.rootPath;
    const oldLeaves = this.leaves();
    const oldRoot = this.rootSplit;
    const oldActive = this.activeLeaf;
    const oldRecent = [...this.recentLeaves];
    const oldFile = this.lastFile;
    const previousFile = this.getActiveFile();
    const oldOptions = new Map(this.viewOptions);
    const oldFailed = this.restorationFailed;
    const oldDocks = [this.leftSplit, this.rightSplit].map(dock => ({
      dock, children: [...dock.children], state: dock.serializeSidebar(), direction: dock.direction, id: dock.id,
    }));
    const oldFocus = document.activeElement;
    const shell = element("desktop-shell");
    const oldInert = shell.inert;
    const closed: { leaf: WorkspaceLeaf; state: ViewState; ephemeral: Record<string, unknown> }[] = [];
    let candidate: WorkspaceLeaf[] = [];
    let succeeded = false;
    try {
      shell.inert = true;
      await this.saveAll();
      await this.layoutWrite;
      const state = await requestJson<WorkspaceLayout>(`/api/workspace/validate?root=${encodeURIComponent(root ?? "")}`, "POST", value);
      if (root !== this.app.vault.rootPath || this.app.changingVault) { throw new Error("The vault changed before its layout could be applied."); }
      const main = this.makeLayoutTree(state.main, null);
      if (!(main instanceof WorkspaceSplit)) { throw new Error("A workspace needs a root split."); }
      const sides = [state.left, state.right].map(saved => {
        const split = saved?.root ? this.makeLayoutTree(saved.root, null) : null;
        if (split && !(split instanceof WorkspaceSplit)) { throw new Error("A sidedock needs a root split."); }
        return split;
      });
      this.restoring = true;
      this.layoutReady = false;
      oldLeaves.forEach(leaf => {
        leaf.containerEl.inert = true;
        if (leaf.view instanceof MarkdownView) { leaf.view.editor.setEditable(false); }
      });
      this.rootSplit = main;
      for (const [index, { dock }] of oldDocks.entries()) {
        const side = sides[index];
        dock.children.splice(0, dock.children.length, ...(side?.children ?? []));
        dock.children.forEach(child => { child.parent = dock; });
        if (side instanceof WorkspaceSplit) { dock.direction = side.direction; dock.id = side.id; }
        dock.restore(index === 0 ? state.left : state.right);
      }
      this.viewOptions.clear();
      for (const [id, values] of Object.entries(state.views ?? {})) {
        if (id !== "workspace-recent-files") { this.viewOptions.set(id, copyViewData(values)); }
      }
      this.recentLeaves.length = 0;
      this.lastFile = null;
      this.activeLeaf = this.getLeafById(state.active) ?? this.leaves()[0];
      candidate = this.leaves();
      candidate.forEach(leaf => { leaf.containerEl.inert = true; });
      this.render();
      this.app.sidebars.restore();
      const load = async (node: SplitLayout | TabsLayout): Promise<void> => {
        for (const child of node.children) {
          if (child.type !== "leaf") { await load(child); continue; }
          const leaf = this.getLeafById(child.id);
          if (!leaf) { throw new Error("A validated layout lost one of its leaves."); }
          await this.applyLeafState(leaf, { ...child.state, active: false }, true, false);
        }
      };
      await load(state.main);
      if (state.left?.root) { await load(state.left.root); }
      if (state.right?.root) { await load(state.right.root); }
      const navigation = this.getViewOptions("workspace-navigation");
      const recent = typeof navigation.lastMainLeaf === "string" ? this.getLeafById(navigation.lastMainLeaf) : null;
      if (recent?.getRoot() === main) { this.recentLeaves.push(recent); }
      if (typeof navigation.lastFile === "string" && this.app.vault.getAbstractFileByPath(navigation.lastFile) instanceof TFile) { this.lastFile = navigation.lastFile; }
      for (const leaf of oldLeaves) { await leaf.view.prepareClose(); }
      for (const leaf of oldLeaves) {
        const state = leaf.getViewState();
        const ephemeral = leaf.view.getEphemeralState();
        closed.push({ leaf, state, ephemeral });
        await leaf.view.closeView();
      }
      this.restorationFailed = false;
      succeeded = true;
    } catch (error) {
      const errors: unknown[] = [error];
      for (const leaf of candidate) {
        try { await leaf.view.closeView(); }
        catch (cleanupError) {
          errors.push(cleanupError);
          await leaf.view.unloadAndWait();
          leaf.view.containerEl.remove();
        }
      }
      this.rootSplit = oldRoot;
      this.activeLeaf = oldActive;
      this.recentLeaves.splice(0, this.recentLeaves.length, ...oldRecent);
      this.lastFile = oldFile;
      this.viewOptions.clear();
      oldOptions.forEach((value, key) => this.viewOptions.set(key, value));
      this.restorationFailed = oldFailed;
      for (const { dock, children, state, direction, id } of oldDocks) {
        dock.children.splice(0, dock.children.length, ...children);
        dock.direction = direction;
        dock.id = id;
        dock.restore(state);
      }
      oldLeaves.forEach(leaf => leaf.view.cancelPreparedClose());
      this.render();
      this.app.sidebars.restore();
      for (const { leaf, state, ephemeral } of closed) {
        try {
          if (!leaf.view._loaded) { await this.restoreClosedView(leaf, state, ephemeral); }
        } catch (restoreError) { errors.push(restoreError); }
      }
      if (errors.length > 1) { throw new AggregateError(errors, "The saved layout could not be applied or completely rolled back."); }
      throw error;
    } finally {
      shell.inert = oldInert;
      this.restoring = false;
      this.layoutReady = true;
      for (const leaf of this.leaves()) {
        leaf.containerEl.inert = this.app.changingVault;
        if (leaf.view instanceof MarkdownView) { leaf.view.editor.setEditable(leaf.view.getMode() === "source" && !this.app.changingVault); }
      }
      if (succeeded) {
        this.setActiveLeaf(this.activeLeaf);
        if (previousFile && previousFile !== this.getActiveFile() && this.canRecordRecentFiles() &&
          this.app.vault.getFileByPath(previousFile.path) === previousFile) { this.addRecentFile(previousFile); }
        this.trigger("layout-ready"); this.layoutChanged();
      }
      else if (oldFocus instanceof HTMLElement && oldFocus.isConnected) { oldFocus.focus({ preventScroll: true }); }
      this.notifyEditor();
    }
    await this.requestSaveLayout();
  }

  async restore(): Promise<boolean> {
    await this.whenIdle();
    this.importedWorkspaceRoot = null;
    this.restoring = true;
    this.layoutReady = false;
    this.recentFilesRoot = null;
    this.recentFilesState = {};
    this.recentFiles.load();
    try {
      for (const leaf of this.leaves()) {
        await leaf.view.closeView();
      }
      this.leftSplit.reset();
      this.rightSplit.reset();
      this.sessions.clear();
      this.viewOptions.clear();
      this.recentLeaves.length = 0;
      this.lastFile = null;
      this.rootSplit = new WorkspaceSplit(this, null);
      const initialTabs = new WorkspaceTabs(this, this.rootSplit);
      this.activeLeaf = new WorkspaceLeaf(this, initialTabs);
      initialTabs.children.push(this.activeLeaf);
      this.rootSplit.children.push(initialTabs);
      this.leftSplit.restore(null);
      this.rightSplit.restore(null);
      this.render();
      this.restorationFailed = false;
      if (!this.app.vault.rootPath) {
        return false;
      }
      this.restorationFailed = true;
      const initial = await startupWorkspace(this.app.vault.rootPath);
      if (initial.error) { reportError(initial.error); new Notice(initial.error.message, 15000); }
      const layout = initial.layout;
      const empty: WorkspaceLayout = {
        version: 1, active: "", main: { id: crypto.randomUUID(), type: "split", direction: "vertical", children: [
          { id: crypto.randomUUID(), type: "tabs", currentTab: 0, children: [
            { id: crypto.randomUUID(), type: "leaf", state: { type: "empty", pinned: false } },
          ] },
        ] },
      };
      const state = layout ?? empty;
      this.recentFilesState = copyViewData(state.views?.["workspace-recent-files"] ?? {});
      this.recentFiles.load(this.recentFilesState.paths);
      this.recentFilesRoot = this.app.vault.rootPath;
      for (const [id, values] of Object.entries(state.views ?? {})) {
        if (id !== "workspace-recent-files") { this.viewOptions.set(id, structuredClone(values)); }
      }
      for (const leaf of this.leaves()) {
        await leaf.view.closeView();
      }
      const root = this.makeLayoutTree(state.main, null);
      if (!(root instanceof WorkspaceSplit)) {
        throw new Error("A saved workspace requires a root split.");
      }
      this.rootSplit = root;
      for (const [dock, saved] of [[this.leftSplit, state.left], [this.rightSplit, state.right]] as const) {
        if (saved?.root) {
          const sideRoot = this.makeLayoutTree(saved.root, null);
          if (!(sideRoot instanceof WorkspaceSplit)) {
            throw new Error("A saved sidedock requires a root split.");
          }
          dock.id = sideRoot.id;
          dock.direction = sideRoot.direction;
          dock.children.push(...sideRoot.children);
          dock.children.forEach(child => { child.parent = dock; });
        }
      }
      const navigation = this.getViewOptions("workspace-navigation");
      if (navigation.lastMainLeaf != null && typeof navigation.lastMainLeaf !== "string" || navigation.lastFile != null && typeof navigation.lastFile !== "string") {
        throw new Error("Saved workspace navigation context must contain leaf identifiers and file paths as text.");
      }
      const mainLeaf = typeof navigation.lastMainLeaf === "string" ? this.getLeafById(navigation.lastMainLeaf) : null;
      if (mainLeaf?.getRoot() === this.rootSplit) {
        this.recentLeaves.push(mainLeaf);
      }
      if (typeof navigation.lastFile === "string" && this.app.vault.getAbstractFileByPath(navigation.lastFile) instanceof TFile) {
        this.lastFile = navigation.lastFile;
      }
      this.activeLeaf = this.getLeafById(state.active) ?? this.leaves()[0];
      this.leftSplit.restore(state.left);
      this.rightSplit.restore(state.right);
      this.render();
      const load = async (node: SplitLayout | TabsLayout): Promise<void> => {
        for (const child of node.children) {
          if (child.type !== "leaf") {
            await load(child);
            continue;
          }
          const leaf = this.getLeafById(child.id);
          if (leaf) {
            const path = child.state.type === "markdown" ? child.state.state?.file : null;
            let reason: string | undefined;
            if (typeof path === "string") {
              const file = this.app.vault.getAbstractFileByPath(path);
              if (!(file instanceof TFile)) {
                reason = `The saved workspace note no longer exists: ${path}.`;
                reportError(new Error(reason));
              }
            }
            await this.applyLeafState(leaf, { ...child.state, active: false }, true, false, reason);
          }
        }
      };
      await load(state.main);
      if (state.left?.root) {
        await load(state.left.root);
      }
      if (state.right?.root) {
        await load(state.right.root);
      }
      this.setActiveLeaf(this.activeLeaf, { focus: false });
      this.restorationFailed = false;
      if (initial.source === "obsidian") {
        this.importedWorkspaceRoot = this.app.vault.rootPath;
        new Notice("Imported Obsidian's saved workspace." + (initial.warnings.length ? " " + initial.warnings.join(" ") : ""), 10000);
      }
      return layout !== null;
    } finally {
      this.restoring = false;
      this.layoutReady = true;
      this.trigger("layout-ready");
      this.notifyEditor();
    }
  }

  layoutChanged(): void {
    if (!this.restoring && !this.changingViews) {
      this.trigger("layout-change");
      this.requestSaveLayout().catch(reportError);
    }
    this.updateCaptionSpacing();
  }

  notifyEditor(): void {
    if (this.notification !== null) {
      window.clearTimeout(this.notification);
    }
    this.notification = window.setTimeout(() => {
      this.notification = null;
      this.app.notifyEditor().catch(reportError);
    }, 60);
  }

  private render(): void {
    this.paneResize?.cancel();
    syncWorkspaceChildren(this.containerEl, [this.rootSplit.containerEl], false);
    this.rootSplit.render();
    syncWorkspaceChildren(this.containerEl, [this.rootSplit.containerEl]);
    this.leftSplit.syncPanel();
    this.rightSplit.syncPanel();
    this.paneResize?.refresh();
    this.updateCaptionSpacing();
  }

  private updateCaptionSpacing(): void {
    requestAnimationFrame(() => {
      for (const group of this.groups()) {
        const bounds = group.headerEl.getBoundingClientRect();
        group.headerEl.classList.toggle("has-window-controls", bounds.top < 2 && bounds.right >= window.innerWidth - 2);
      }
    });
  }
}
