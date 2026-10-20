import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { ExplorerSelection, MAX_EXPLORER_OPEN, MAX_EXPLORER_SELECTION, explorerSorts, explorerState, explorerTree, type ExplorerOpenSelection, type ExplorerSelectionItem, type ExplorerState, type ExplorerNode } from "./file-explorer-model";
import { icon } from "./icons";
import { Menu } from "./menu";
import { ExplorerMoveModal } from "./explorer-move-modal";
import { ExplorerRenameModal } from "./explorer-rename-modal";
import { ExplorerTrashModal } from "./explorer-trash-modal";
import { ExplorerTrashRecoveryModal } from "./explorer-trash-recovery-modal";
import { currentExplorerNoteDrag, publishExplorerNoteDrag, retireExplorerNoteDrag, type ExplorerNoteDrag } from "./explorer-note-drag";
import { TAbstractFile, TFile, TFolder } from "./vault";
import { ItemView } from "./views";
import type { WorkspaceLeaf } from "./workspace";

interface ExplorerItem { file: TAbstractFile; titleEl: HTMLButtonElement; titleInnerEl: HTMLSpanElement; selfEl: HTMLButtonElement; innerEl: HTMLSpanElement; }
export const EXPLORER_NOTE_DRAG = "application/x-slopsidian-selected-notes";
export const EXPLORER_DRAG_EXPAND_DELAY = 750;

export class FileExplorerView extends ItemView {
  override icon = "folder";
  /** Materialized, live-vault rows, retained across folding/filtering up to the render budget. */
  readonly fileItems: Record<string, ExplorerItem> = Object.create(null);
  private options: ExplorerState = explorerState({});
  private readonly sourceRoot: string | null;
  private readonly toolbar = document.createElement("div");
  private readonly more = document.createElement("details");
  private readonly moreActions = document.createElement("div");
  private readonly selectionControls = document.createElement("div");
  private readonly sort = document.createElement("select");
  private readonly search = document.createElement("input");
  private readonly tree = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly filteredCollapsed = new Set<string>();
  private focusPath = "";
  private queued = false;
  private settlingLayout: object | null = null;
  private refreshing = false;
  private message = "";
  private context: Menu | null = null;
  private selectionMode = false;
  private readonly selection = new ExplorerSelection<TFile>();
  private openingSelection: object | null = null;
  private mutatingSelection: object | null = null;
  private selectionModal: ExplorerMoveModal | ExplorerRenameModal | ExplorerTrashModal | ExplorerTrashRecoveryModal | null = null;
  private noteDrag: ExplorerNoteDrag | null = null;
  private noteDragHover: { drag: ExplorerNoteDrag; row: HTMLElement; folder: TFolder; timer: ReturnType<typeof setTimeout> | null; cleanup: () => void } | null = null;
  private renderRevision = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("file-explorer-workspace");
    this.contentEl.dataset.fileExplorer = leaf.id;
    this.toolbar.className = "file-explorer-controls";
    this.more.className = "file-explorer-options";
    this.more.dataset.explorerOptions = "true";
    const moreSummary = document.createElement("summary");
    moreSummary.textContent = "More file options";
    moreSummary.className = "file-explorer-options-toggle";
    moreSummary.prepend(icon("chevron-right"));
    this.moreActions.className = "file-explorer-options-actions";
    this.selectionControls.className = "file-explorer-selection-controls";
    this.selectionControls.setAttribute("role", "group");
    this.selectionControls.setAttribute("aria-label", "Selected note actions");
    const primary = new Set(["new-note", "new-folder", "search", "auto-reveal", "collapse"]);
    for (const [action, title, glyph] of [
      ["new-note", "New note", "new-note"], ["new-folder", "New folder", "folder-plus"],
      ["search", "Filter files", "search"], ["reveal", "Reveal active file", "arrow-right"],
      ["auto-reveal", "Automatically reveal active file", "pin"],
      ["expand", "Expand all folders", "chevron-down"], ["collapse", "Collapse all folders", "collapse"],
      ["refresh", "Refresh files", "refresh"],
      ["recover-trash", "Recover trash notes", "trash"],
      ["select-notes", "Select notes", "check"], ["open-selected", "Open selected notes", "files"], ["move-selected", "Move selected notes", "folder"], ["rename-selected", "Rename selected notes", "edit"], ["trash-selected", "Remove selected notes", "trash"], ["clear-selection", "Clear note selection", "close"],
    ]) {
      const button = document.createElement("button"); button.type = "button";
      const selectionAction = action.endsWith("-selected") || action === "clear-selection";
      button.className = primary.has(action) ? "clickable-icon" : "file-explorer-option"; button.dataset.explorerAction = action; button.title = title;
      button.setAttribute("aria-label", title);
      button.append(icon(glyph));
      if (!primary.has(action)) { const label = document.createElement("span"); label.textContent = title; button.append(label); }
      this.buttons.set(action, button);
      if (primary.has(action)) { this.toolbar.append(button); }
      else if (selectionAction) { button.hidden = true; this.selectionControls.append(button); }
      else { this.moreActions.append(button); }
    }
    this.sort.setAttribute("aria-label", "Sort files"); this.sort.dataset.explorerSort = "true";
    for (const [value, title] of Object.entries(explorerSorts)) { const option = document.createElement("option"); option.value = value; option.textContent = title; this.sort.append(option); }
    const sortLabel = document.createElement("label");
    sortLabel.textContent = "Sort files"; sortLabel.className = "file-explorer-sort"; sortLabel.append(this.sort);
    const morePanel = document.createElement("div");
    morePanel.className = "file-explorer-options-panel"; morePanel.append(sortLabel, this.moreActions);
    this.more.append(moreSummary, morePanel);
    this.search.type = "search"; this.search.maxLength = 1024; this.search.placeholder = "Filter files…";
    this.search.setAttribute("aria-label", "Filter vault files"); this.search.dataset.explorerSearch = "true";
    this.tree.className = "file-explorer-tree nav-files-container"; this.tree.tabIndex = 0;
    this.tree.setAttribute("role", "tree"); this.tree.setAttribute("aria-label", "Vault files");
    this.status.className = "file-explorer-status"; this.status.setAttribute("role", "status");
    this.contentEl.append(this.toolbar, this.more, this.search, this.selectionControls, this.tree, this.status);
    for (const controls of [this.toolbar, this.moreActions, this.selectionControls]) {
      this.registerDomEvent(controls, "click", event => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-explorer-action]") : null;
        if (!target || this.buttons.get(target.dataset.explorerAction!) !== target) { return; }
        const disclosed = this.moreActions.contains(target);
        this.run(async () => {
          await this.action(target.dataset.explorerAction!);
          if (disclosed) {
            const returnFocus = this.more.contains(this.more.ownerDocument.activeElement);
            this.more.open = false;
            if (returnFocus && this.owned()) { moreSummary.focus(); }
          }
        });
      });
    }
    this.registerDomEvent(this.sort, "change", () => this.run(() => { this.options.sortOrder = explorerState({ sortOrder: this.sort.value }).sortOrder; this.save(); this.render(); }));
    this.registerDomEvent(this.search, "input", () => this.run(() => { this.options.searchQuery = this.search.value; this.filteredCollapsed.clear(); this.save(); this.render(); }));
    this.registerDomEvent(this.tree, "click", event => {
      const row = this.row(event.target);
      if (row && event instanceof MouseEvent) {
        this.run(() => {
          if (this.rowFile(row)) {
            return this.selectionMode ? this.selectRow(row, event.ctrlKey || event.metaKey, event.shiftKey) : this.activate(row.dataset.explorerPath!, event.ctrlKey || event.metaKey);
          }
        });
      }
    });
    this.registerDomEvent(this.tree, "keydown", event => {
      if (event instanceof KeyboardEvent) {
        if (this.cancelNoteDragKey(event)) { return; }
        this.key(event);
      }
    });
    this.registerDomEvent(this.tree, "dragstart", event => {
      const row = this.row(event.target), transfer = (event as DragEvent).dataTransfer;
      if (!row || !transfer || !this.beginNoteDrag(row, transfer)) { event.preventDefault(); }
    });
    this.registerDomEvent(this.tree, "dragover", event => {
      const transfer = (event as DragEvent).dataTransfer;
      if (!transfer?.types.includes(EXPLORER_NOTE_DRAG)) { return; }
      event.preventDefault();
      const row = this.row(event.target), folder = row && this.noteDropFolder(row);
      transfer.dropEffect = folder ? "move" : "none";
      if (folder && row) { this.hoverNoteDropFolder(row, folder); } else { this.clearNoteDropTarget(); }
    });
    this.registerDomEvent(this.tree, "dragleave", event => {
      const row = this.row(event.target), related = (event as DragEvent).relatedTarget;
      if (row && (!(related instanceof Node) || !row.contains(related))) { this.clearNoteDropTarget(); }
    });
    this.registerDomEvent(this.tree, "drop", event => {
      const transfer = (event as DragEvent).dataTransfer;
      if (!transfer?.types.includes(EXPLORER_NOTE_DRAG)) { return; }
      event.preventDefault(); event.stopPropagation();
      const row = this.row(event.target); if (row) { this.dropNotes(row, transfer); } else { retireExplorerNoteDrag(this.app); this.clearNoteDropTarget(); }
    });
    this.registerDomEvent(this.tree, "dragend", () => this.clearNoteDrag());
    this.registerDomEvent(this.containerEl.ownerDocument, "keydown", event => {
      if (event instanceof KeyboardEvent && this.cancelNoteDragKey(event)) { event.stopPropagation(); }
    }, true);
    const ownerWindow = this.containerEl.ownerDocument.defaultView;
    if (ownerWindow) { this.registerDomEvent(ownerWindow, "blur", () => this.clearNoteDrag()); }
    this.registerDomEvent(this.containerEl.ownerDocument, "visibilitychange", () => { if (this.containerEl.ownerDocument.hidden) { this.clearNoteDrag(); } });
    this.registerDomEvent(this.tree, "focusin", event => { const row = this.row(event.target); if (row) { this.focusPath = row.dataset.explorerPath!; this.roving(); } });
    this.registerDomEvent(this.tree, "contextmenu", event => { if (event instanceof MouseEvent) { this.menu(event); } });
    for (const name of ["snapshot-changed", "create", "modify"] as const) { this.registerEvent(this.app.vault.on(name, () => this.schedule())); }
    this.registerEvent(this.app.vault.on("rename", (file, old) => {
      if (file instanceof TAbstractFile && typeof old === "string") {
        const remap = (path: string): string => path === old ? file.path : path.startsWith(old + "/") ? file.path + path.slice(old.length) : path;
        this.options.collapsedFolders = this.options.collapsedFolders.map(remap); this.focusPath = remap(this.focusPath);
        this.save(); this.schedule();
      }
    }));
    this.registerEvent(this.app.vault.on("delete", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("extensions-changed", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("layout-ready", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      // Activating a pane happens on pointer-down. Keep its rows in place until
      // the matching click; only an interactivity change needs a layout redraw.
      if (this.sort.disabled === this.interactive()) { this.schedule(); }
    }));
    this.registerEvent(this.app.core.on("changed", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      const file = this.app.workspace.getActiveFile();
      if (this.options.autoReveal && file) { this.expandParents(file); }
      this.schedule();
    }));
    this.register(() => { this.clearNoteDrag(); this.context?.hide(); this.context = null; this.settlingLayout = null; this.selection.clear(); this.selectionMode = false; this.openingSelection = null; this.mutatingSelection = null; this.selectionModal?.dispose(); this.selectionModal = null; for (const path of Object.keys(this.fileItems)) { delete this.fileItems[path]; } });
  }

  getViewType(): string { return "file-explorer"; }
  getDisplayText(): string { return "Files"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options, collapsedFolders: [...this.options.collapsedFolders] }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    this.clearNoteDrag();
    this.mutatingSelection = null; this.selectionModal?.dispose(); this.selectionModal = null;
    const state = copyViewData(value), options = explorerState(state);
    await super.setState(state, result); this.options = options; this.filteredCollapsed.clear(); this.selection.clear(); this.selectionMode = false; this.render();
  }
  protected override async onOpen(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (this.options.autoReveal && file) { this.expandParents(file); }
    this.render();
  }
  override focus(): void { (this.rows().find(row => row.dataset.explorerPath === this.focusPath) ?? this.tree).focus(); }

  private owned(): boolean { return this.isLoaded && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private available(): boolean {
    return Boolean(this.sourceRoot) && this.owned() && !this.app.changingVault && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout
      && this.app.core.isEnabled("file-explorer") && !this.app.core.busy && !this.refreshing;
  }
  private interactive(): boolean { return this.available() && !this.openingSelection && !this.mutatingSelection; }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    Promise.resolve().then(() => { if (this.interactive()) { this.message = ""; return action(); } }).catch(error => {
      if (this.owned()) { this.say(error instanceof Error ? error.message : String(error)); }
      reportError(error);
    });
  }
  private say(message: string): void { this.message = message; this.status.textContent = message; }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private schedule(): void {
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.owned()) { return; }
      this.render();
      // layout-ready is emitted before changeLayout's final write and flag
      // release. A quiet cached vault may produce no later inventory event.
      if (this.app.workspace.isChangingLayout) { this.afterLayoutSettles(); }
    });
  }
  private afterLayoutSettles(): void {
    if (this.settlingLayout) { return; }
    const token = {}; this.settlingLayout = token;
    const finish = (): void => {
      if (this.settlingLayout !== token) { return; }
      this.settlingLayout = null;
      // Keep rows stable if another real update already refreshed availability.
      if (this.owned() && this.sort.disabled === this.interactive()) { this.schedule(); }
    };
    // The transition caller owns its failure. Both successful and rolled-back
    // layouts must release surviving controls, without reporting that error twice.
    this.app.workspace.whenIdle().then(finish, finish);
  }
  private row(target: EventTarget | null): HTMLElement | null { return target instanceof Element ? target.closest<HTMLElement>("[data-explorer-path]") : null; }
  private rows(): HTMLElement[] { return Array.from(this.tree.querySelectorAll<HTMLElement>("[data-explorer-path]")); }
  private rowFile(row: HTMLElement): TAbstractFile | null {
    const path = row.dataset.explorerPath!, item = this.fileItems[path];
    return row.parentElement === this.tree && item?.titleEl === row && this.app.vault.getAbstractFileByPath(path) === item.file ? item.file : null;
  }
  private selectable(file: TAbstractFile): file is TFile {
    return file instanceof TFile && file.vault === this.app.vault && file.extension.toLowerCase() === "md" && this.app.workspace.viewTypeForExtension(file.extension) === "markdown";
  }
  private visibleNotes(): ExplorerSelectionItem<TFile>[] {
    return this.rows().flatMap(row => { const file = this.rowFile(row); return file && this.selectable(file) ? [{ path: file.path, file }] : []; });
  }
  private selectRow(row: HTMLElement, toggle = false, range = false): void {
    if (!this.interactive() || !this.selectionMode) { return; }
    const file = this.rowFile(row); if (!file) { return; }
    if (file instanceof TFolder) { if (file.children.length) { this.toggle(file.path); } return; }
    if (!this.selectable(file)) { this.say("Select Markdown notes; folders and attachments keep their ordinary browsing controls."); return; }
    this.focusPath = file.path;
    const message = this.selection.choose(this.visibleNotes(), { path: file.path, file }, toggle, range);
    this.message = message ?? ""; this.render();
  }
  private selectionCurrent(token: object, plan: ExplorerOpenSelection<TFile>): boolean {
    return this.available() && this.openingSelection === token && this.selectionMode && this.selection.current(plan, this.visibleNotes());
  }
  private async openSelected(): Promise<void> {
    if (!this.interactive() || !this.selectionMode) { return; }
    const plan = this.selection.plan(this.visibleNotes());
    if (typeof plan === "string") { this.message = plan; this.render(); return; }
    const token = {}; this.openingSelection = token; this.render();
    let opened = 0;
    try {
      for (const item of plan.items) {
        // Recheck the entire reviewed group before each asynchronous open. A
        // removed/recreated/hidden note or a disposed owner stops the remainder.
        if (!this.selectionCurrent(token, plan)) { this.say(`Opening stopped after ${opened} notes because this pane or its selection changed.`); return; }
        await this.app.workspace.getLeaf("tab").openFile(item.file);
        opened++;
      }
      this.selection.clear(); this.say(`Opened ${opened} Markdown notes in new tabs.`);
    } catch (error) {
      this.say(`Opened ${opened} notes; the remaining notes were not opened. ${error instanceof Error ? error.message : String(error)}`);
      reportError(error);
    } finally {
      if (this.openingSelection === token) { this.openingSelection = null; if (this.owned()) { this.render(); } }
    }
  }
  private clearNoteDropTarget(): void {
    const hover = this.noteDragHover; this.noteDragHover = null;
    if (hover) { if (hover.timer !== null) { clearTimeout(hover.timer); } hover.drag.cleanups.delete(hover.cleanup); }
    for (const row of this.rows()) { row.classList.remove("is-note-drop-target"); }
  }
  private cancelNoteDragKey(event: KeyboardEvent): boolean {
    if (event.key !== "Escape" || event.isComposing || !currentExplorerNoteDrag(this.app)) { return false; }
    event.preventDefault(); retireExplorerNoteDrag(this.app); return true;
  }
  private clearNoteDrag(): void {
    const drag = this.noteDrag, hover = this.noteDragHover; this.noteDrag = null;
    if (drag) { retireExplorerNoteDrag(this.app, drag); }
    else if (hover) { retireExplorerNoteDrag(this.app, hover.drag); }
    this.clearNoteDropTarget();
    for (const row of this.rows()) { row.classList.remove("is-note-dragging"); }
  }
  private draggedSelectionCurrent(plan: ExplorerOpenSelection<TFile>): boolean {
    return this.interactive() && this.selectionMode && !this.app.vault.readOnly && this.selection.current(plan, this.visibleNotes());
  }
  private currentNoteDrag(): boolean {
    return Boolean(this.noteDrag && this.draggedSelectionCurrent(this.noteDrag.plan));
  }
  private beginNoteDrag(row: HTMLElement, transfer: DataTransfer): boolean {
    this.clearNoteDrag();
    const file = this.rowFile(row);
    if (!this.interactive() || this.app.vault.readOnly || !this.selectionMode || !file || !this.selectable(file) || !this.selection.has(file.path, file)) { return false; }
    const plan = this.selection.plan(this.visibleNotes());
    if (typeof plan === "string") { this.say(plan); return false; }
    const token = crypto.randomUUID();
    transfer.effectAllowed = "move"; transfer.setData(EXPLORER_NOTE_DRAG, token);
    const drag: ExplorerNoteDrag = { source: this, root: this.sourceRoot!, plan, token, cleanups: new Set(),
      current: () => this.noteDrag === drag && this.currentNoteDrag(),
      review: (folder, destinationCurrent) => {
        if (!destinationCurrent() || !this.draggedSelectionCurrent(plan)) { this.say("The dragged notes or destination changed. Select the notes and review the move again."); return; }
        this.mutateSelected("move", folder, plan, destinationCurrent);
      } };
    drag.cleanups.add(() => { if (this.noteDrag === drag) { this.clearNoteDrag(); } }); publishExplorerNoteDrag(this.app, drag); this.noteDrag = drag;
    for (const item of plan.items) { this.fileItems[item.path]?.titleEl.classList.add("is-note-dragging"); }
    return true;
  }
  private noteDropFolder(row: HTMLElement): TFolder | null {
    const drag = currentExplorerNoteDrag(this.app), file = this.rowFile(row);
    return drag && drag.root === this.sourceRoot && this.interactive() && !this.app.vault.readOnly
      && file instanceof TFolder && file.vault === this.app.vault && !file.isRoot() ? file : null;
  }
  private hoverNoteDropFolder(row: HTMLElement, folder: TFolder): void {
    const drag = currentExplorerNoteDrag(this.app);
    if (!drag || this.noteDropFolder(row) !== folder) { this.clearNoteDropTarget(); return; }
    if (this.noteDragHover?.drag === drag && this.noteDragHover.row === row && this.noteDragHover.folder === folder) { return; }
    this.clearNoteDropTarget();
    const hover = { drag, row, folder, timer: null as ReturnType<typeof setTimeout> | null, cleanup: () => { if (this.noteDragHover === hover) { this.clearNoteDropTarget(); } } };
    this.noteDragHover = hover; drag.cleanups.add(hover.cleanup); row.classList.add("is-note-drop-target");
    if (!this.collapsed(folder.path) || !folder.children.length) { return; }
    hover.timer = setTimeout(() => {
      hover.timer = null;
      if (this.noteDragHover !== hover || currentExplorerNoteDrag(this.app) !== drag || this.noteDropFolder(row) !== folder || !this.collapsed(folder.path)) { return; }
      // Only this exact hover intent may keep a gesture through its own redraw.
      // The incremental render leaves the native drag source DOM attached.
      if (this.options.showSearch && this.options.searchQuery.trim()) { this.filteredCollapsed.delete(folder.path); }
      else { this.options.collapsedFolders = this.options.collapsedFolders.filter(path => path !== folder.path); }
      this.render(drag); this.save();
      if (currentExplorerNoteDrag(this.app) === drag && this.noteDropFolder(row) === folder) { row.classList.add("is-note-drop-target"); }
    }, EXPLORER_DRAG_EXPAND_DELAY);
  }
  private dropNotes(row: HTMLElement, transfer: DataTransfer): boolean {
    const drag = currentExplorerNoteDrag(this.app), folder = this.noteDropFolder(row), revision = this.renderRevision;
    const accepted = Boolean(drag && folder && transfer.getData(EXPLORER_NOTE_DRAG) === drag.token);
    retireExplorerNoteDrag(this.app); this.clearNoteDropTarget();
    if (!accepted || !drag || !folder) { return false; }
    // A drop selects a review destination. It never directly moves a file.
    this.run(() => {
      if (revision !== this.renderRevision || this.rowFile(row) !== folder || this.app.vault.getFolderByPath(folder.path) !== folder) {
        this.say("The dragged notes or destination changed. Select the notes and review the move again."); return;
      }
      drag.review(folder, () => this.owned() && !this.app.changingVault && !this.app.workspace.isChangingLayout && !this.app.core.busy
        && this.app.core.isEnabled("file-explorer") && !this.app.vault.readOnly && this.app.vault.getFolderByPath(folder.path) === folder);
    });
    return true;
  }
  private mutateSelected(kind: "move" | "rename" | "trash", initialFolder?: TFolder, dragged?: ExplorerOpenSelection<TFile>, dropOwner: () => boolean = () => true): void {
    if (!this.interactive() || !this.selectionMode || this.app.vault.readOnly) { return; }
    if (dragged && !this.selection.current(dragged, this.visibleNotes())) { this.say("The dragged selection changed. Select the notes and review the move again."); return; }
    if (initialFolder && (initialFolder.vault !== this.app.vault || this.app.vault.getFolderByPath(initialFolder.path) !== initialFolder)) {
      this.say("The dropped folder changed. Select the notes and review the move again."); return;
    }
    const plan = this.selection.plan(this.visibleNotes());
    if (typeof plan === "string") { this.say(plan); return; }
    const token = {}; this.mutatingSelection = token;
    const current = (): boolean => dropOwner() && this.owned() && this.mutatingSelection === token && this.selectionMode
      && !this.app.changingVault && !this.app.workspace.isChangingLayout && !this.app.core.busy && this.app.core.isEnabled("file-explorer");
    const finished = (message: string): void => { if (this.mutatingSelection === token && this.owned()) { this.selection.clear(); this.say(message); } };
    const files = plan.items.map(item => item.file);
    try {
      const modal = this.selectionModal = kind === "move" ? new ExplorerMoveModal(this.app, files, current, finished, initialFolder)
        : kind === "rename" ? new ExplorerRenameModal(this.app, files, current, finished) : new ExplorerTrashModal(this.app, files, current, finished);
      modal.onClose = () => { if (this.selectionModal === modal) { this.selectionModal = null; } if (this.mutatingSelection === token) { this.mutatingSelection = null; if (this.owned()) { this.render(); } } };
      this.render(); modal.open();
    } catch (error) { this.mutatingSelection = null; this.selectionModal = null; this.render(); throw error; }
  }
  private roving(): void {
    const rows = this.rows(), selected = rows.find(row => row.dataset.explorerPath === this.focusPath) ?? rows[0];
    this.tree.tabIndex = rows.length ? -1 : 0; rows.forEach(row => { row.tabIndex = row === selected ? 0 : -1; });
  }
  private collapsed(path: string): boolean { return this.options.showSearch && this.options.searchQuery.trim() ? this.filteredCollapsed.has(path) : this.options.collapsedFolders.includes(path); }
  private toggle(path: string): void {
    if (this.options.showSearch && this.options.searchQuery.trim()) {
      this.filteredCollapsed.has(path) ? this.filteredCollapsed.delete(path) : this.filteredCollapsed.add(path);
    } else {
      const folders = new Set(this.options.collapsedFolders);
      if (!folders.has(path) && folders.size >= 4096) { this.say("Expand a folder before folding more than 4,096 folders."); return; }
      folders.has(path) ? folders.delete(path) : folders.add(path);
      this.options.collapsedFolders = [...folders]; this.save();
    }
    this.focusPath = path; this.render();
  }
  private expandParents(file: TAbstractFile): void {
    const parents = new Set<string>(); let path = file.path;
    while (path.includes("/")) { path = path.slice(0, path.lastIndexOf("/")); parents.add(path); }
    if (file instanceof TFolder && !file.isRoot()) { parents.add(file.path); }
    const before = this.options.collapsedFolders.length;
    this.options.collapsedFolders = this.options.collapsedFolders.filter(path => !parents.has(path));
    parents.forEach(path => this.filteredCollapsed.delete(path));
    if (before !== this.options.collapsedFolders.length) { this.save(); }
    this.focusPath = file.path;
  }
  revealInFolder(file: TAbstractFile): void {
    if (!this.interactive() || this.app.vault.getAbstractFileByPath(file.path) !== file) { throw new Error("Reveal requires a live Files pane and an entry in the selected vault."); }
    this.options.searchQuery = ""; this.search.value = ""; this.expandParents(file); this.save(); this.render();
    const row = this.rows().find(row => row.dataset.explorerPath === file.path); row?.scrollIntoView({ block: "nearest" }); (row ?? this.tree).focus();
  }
  private async activate(path: string, newTab = false): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || file.vault !== this.app.vault) { return; }
    if (file instanceof TFolder) { if (file.children.length) { this.toggle(path); } return; }
    if (!(file instanceof TFile) || !this.app.workspace.viewTypeForExtension(file.extension)) {
      this.say("Enable a compatible view plugin to open this file type."); return;
    }
    this.focusPath = path;
    await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
  }
  private async action(action: string): Promise<void> {
    if (!this.interactive()) { return; }
    if (action === "recover-trash") {
      if (this.app.vault.readOnly) return;
      const token = {}; this.mutatingSelection = token;
      const current = (): boolean => this.owned() && this.mutatingSelection === token && !this.app.changingVault && !this.app.workspace.isChangingLayout && !this.app.core.busy && this.app.core.isEnabled("file-explorer");
      const modal = this.selectionModal = new ExplorerTrashRecoveryModal(this.app, current, message => { if (current()) this.say(message); });
      modal.onClose = () => { if (this.selectionModal === modal) this.selectionModal = null; if (this.mutatingSelection === token) { this.mutatingSelection = null; if (this.owned()) this.render(); } };
      this.render(); modal.open(); return;
    }
    if (action === "select-notes") { this.selectionMode = !this.selectionMode; this.selection.clear(); this.render(); return; }
    if (action === "clear-selection") { this.selection.clear(); this.render(); return; }
    if (action === "open-selected") { await this.openSelected(); return; }
    if (action === "move-selected" || action === "rename-selected" || action === "trash-selected") { this.mutateSelected(action === "move-selected" ? "move" : action === "rename-selected" ? "rename" : "trash"); return; }
    if (action === "new-note") { if (!this.app.vault.readOnly) { await this.app.commands.execute("file-explorer:new-file"); } return; }
    if (action === "new-folder") {
      if (!this.app.vault.readOnly) { const file = this.app.vault.getAbstractFileByPath(this.focusPath); const folder = file instanceof TFolder ? file : file?.parent;
        this.app.fileManager.editDialog("folder", null, folder && !folder.isRoot() ? folder.path + "/" : ""); }
      return;
    }
    if (action === "search") { this.options.showSearch = !this.options.showSearch; if (!this.options.showSearch) { this.options.searchQuery = ""; } this.filteredCollapsed.clear(); }
    if (action === "auto-reveal") { this.options.autoReveal = !this.options.autoReveal; if (this.options.autoReveal) { const file = this.app.workspace.getActiveFile(); if (file) { this.expandParents(file); } } }
    if (action === "reveal") { const file = this.app.workspace.getActiveFile(); if (file) { this.revealInFolder(file); } return; }
    if (action === "expand") { this.options.collapsedFolders = []; this.filteredCollapsed.clear(); }
    if (action === "collapse") {
      const folders = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder && !file.isRoot() && file.children.length).map(file => file.path);
      if (this.options.showSearch && this.options.searchQuery.trim()) { folders.forEach(path => this.filteredCollapsed.add(path)); }
      else {
        if (folders.length > 4096) { this.say("Collapse all supports up to 4,096 nonempty folders. Filter the list to fold matching folders instead."); return; }
        this.options.collapsedFolders = folders;
      }
    }
    if (action === "refresh") {
      this.refreshing = true; this.render();
      try { await this.app.vault.refresh(); } finally { this.refreshing = false; this.schedule(); }
      return;
    }
    this.save(); this.render(); if (action === "search" && this.options.showSearch) { this.search.focus(); }
  }
  private key(event: KeyboardEvent): void {
    if (!this.interactive() || event.altKey || event.isComposing || event.keyCode === 229 || !this.selectionMode && (event.metaKey || event.ctrlKey)) { return; }
    const row = this.row(event.target), rows = this.rows(), index = row ? rows.indexOf(row) : -1;
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") { target = rows[Math.min(index + 1, rows.length - 1)]; }
    else if (event.key === "ArrowUp") { target = rows[Math.max(0, index - 1)]; }
    else if (event.key === "Home") { target = rows[0]; } else if (event.key === "End") { target = rows.at(-1); }
    else if (row && event.key === "ArrowRight") {
      if (row.getAttribute("aria-expanded") === "false") { this.toggle(row.dataset.explorerPath!); }
      else if (row.getAttribute("aria-expanded") === "true" && Number(rows[index + 1]?.getAttribute("aria-level")) > Number(row.getAttribute("aria-level"))) { target = rows[index + 1]; }
    } else if (row && event.key === "ArrowLeft") {
      if (row.getAttribute("aria-expanded") === "true") { this.toggle(row.dataset.explorerPath!); }
      else { const path = row.dataset.explorerPath!, slash = path.lastIndexOf("/"); if (slash >= 0) { target = rows.find(row => row.dataset.explorerPath === path.slice(0, slash)); } }
    } else if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault(); this.run(() => this.selectionMode ? this.selectRow(row, event.ctrlKey || event.metaKey || event.key === " " && !event.shiftKey, event.shiftKey) : this.activate(row.dataset.explorerPath!)); return;
    }
    else if (this.selectionMode && event.key === "Escape") {
      event.preventDefault(); if (this.selection.size) { this.selection.clear(); } else { this.selectionMode = false; } this.message = ""; this.render(); return;
    }
    else if (row && event.key === "F10" && event.shiftKey) { event.preventDefault(); this.menu(new MouseEvent("contextmenu", { bubbles: true, clientX: row.getBoundingClientRect().left, clientY: row.getBoundingClientRect().bottom }), row); return; }
    else { return; }
    event.preventDefault();
    if (target && this.selectionMode && event.shiftKey && this.rowFile(target) instanceof TFile) { this.selectRow(target, event.ctrlKey || event.metaKey, true); }
    target?.focus();
  }
  private menu(event: MouseEvent, row = this.row(event.target)): void {
    if (!this.interactive() || !row) { return; }
    const file = this.app.vault.getAbstractFileByPath(row.dataset.explorerPath!); if (!file) { return; }
    this.focusPath = file.path; const menu = Menu.forEvent(event); this.context = menu;
    if (file instanceof TFile && this.app.workspace.viewTypeForExtension(file.extension)) {
      for (const [label, tab] of [["Open", false], ["Open in new tab", true]] as const) {
        menu.addItem(item => item.setTitle(label).setIcon(tab ? "file-plus" : "file").setSection("open")
          .onClick(() => { if (this.interactive() && this.app.vault.getAbstractFileByPath(file.path) === file) { return this.activate(file.path, tab); } }));
      }
    }
    if (!this.app.vault.readOnly) { this.app.fileManager.openContextMenu(file.path, event); }
    else { this.app.workspace.trigger("file-menu", menu, file, "file-explorer"); }
  }
  private render(preserveDrag?: ExplorerNoteDrag): void {
    if (!preserveDrag || currentExplorerNoteDrag(this.app) !== preserveDrag) {
      if (this.noteDragHover) { retireExplorerNoteDrag(this.app, this.noteDragHover.drag); }
      this.clearNoteDrag(); this.clearNoteDropTarget();
      preserveDrag = undefined;
    }
    this.renderRevision++;
    this.sort.value = this.options.sortOrder; this.search.hidden = !this.options.showSearch; this.search.value = this.options.searchQuery;
    const enabled = this.interactive(); this.sort.disabled = !enabled; this.search.disabled = !enabled;
    for (const [action, button] of this.buttons) { button.disabled = !enabled || this.app.vault.readOnly && ["new-note", "new-folder", "recover-trash"].includes(action); }
    this.buttons.get("search")!.setAttribute("aria-pressed", String(this.options.showSearch));
    this.buttons.get("auto-reveal")!.setAttribute("aria-pressed", String(this.options.autoReveal));
    this.buttons.get("select-notes")!.setAttribute("aria-pressed", String(this.selectionMode));
    this.tree.setAttribute("aria-multiselectable", String(this.selectionMode));
    const focus = this.tree.contains(document.activeElement), active = this.app.workspace.getActiveFile()?.path;
    const model = explorerTree(this.app.vault.getAllLoadedFiles().map(file => ({ path: file.path, folder: file instanceof TFolder,
      ...(file instanceof TFile ? { mtime: file.stat.mtime, ctime: file.stat.ctime } : {}) })), this.options.sortOrder, this.options.showSearch ? this.options.searchQuery : "");
    const fragment = document.createDocumentFragment(), rendered: HTMLElement[] = [], pending: { node: ExplorerNode; depth: number; position: number; size: number }[] = [];
    const materialized = new Set<string>();
    for (const [path, item] of Object.entries(this.fileItems)) {
      if (this.app.vault.getAbstractFileByPath(path) !== item.file) { delete this.fileItems[path]; }
    }
    const push = (nodes: ExplorerNode[], depth: number): void => {
      const visible = nodes.filter(node => node.visible);
      for (let index = visible.length - 1; index >= 0; index--) { pending.push({ node: visible[index], depth, position: index + 1, size: visible.length }); }
    };
    push(model.roots, 1);
    let count = 0;
    while (pending.length && count < 5000) {
        const current = pending.pop()!, node = current.node, file = this.app.vault.getAbstractFileByPath(node.path); if (!file) { continue; } count++;
        let item = this.fileItems[node.path];
        if (!item) {
          const row = document.createElement("button"), label = document.createElement("span"); row.type = "button";
          row.className = node.folder ? "nav-folder-title" : "nav-file-title"; label.className = node.folder ? "nav-folder-title-content" : "nav-file-title-content";
          const glyph = icon(node.folder ? "chevron-right" : "file"); if (node.folder) { glyph.classList.add("file-explorer-chevron"); }
          row.append(glyph, label); item = { file, titleEl: row, titleInnerEl: label, selfEl: row, innerEl: label }; this.fileItems[node.path] = item;
        }
        materialized.add(node.path); const row = item.titleEl;
        row.dataset.explorerPath = node.path; row.dataset.path = node.path; row.removeAttribute("aria-expanded");
        if (node.folder) { row.dataset.folderPath = node.path; if (node.children.some(child => child.visible)) { row.setAttribute("aria-expanded", String(!this.collapsed(node.path))); } }
        else { row.dataset.notePath = node.path; }
        row.title = node.path; row.setAttribute("role", "treeitem"); row.setAttribute("aria-level", String(current.depth));
        row.setAttribute("aria-setsize", String(current.size)); row.setAttribute("aria-posinset", String(current.position));
        row.disabled = !enabled;
        row.style.setProperty("--explorer-depth", String(current.depth - 1));
        const chevron = row.querySelector<SVGSVGElement>(".file-explorer-chevron"); if (chevron) { chevron.style.visibility = node.children.some(child => child.visible) ? "" : "hidden"; }
        item.titleInnerEl.textContent = file instanceof TFile && file.extension.toLowerCase() === "md" ? file.basename : node.name;
        const unavailable = file instanceof TFile && !this.app.workspace.viewTypeForExtension(file.extension);
        row.classList.toggle("is-unavailable", unavailable); if (unavailable) { row.setAttribute("aria-disabled", "true"); } else { row.removeAttribute("aria-disabled"); }
        if (preserveDrag) { rendered.push(row); } else { fragment.append(row); }
        if (node.folder && !this.collapsed(node.path) && node.children.some(child => child.visible)) {
          push(node.children, current.depth + 1);
        }
    }
    let cached = Object.keys(this.fileItems).length;
    for (const path of Object.keys(this.fileItems)) {
      if (cached <= 5000) { break; } if (!materialized.has(path)) { delete this.fileItems[path]; cached--; }
    }
    if (preserveDrag) {
      let cursor = this.tree.firstChild;
      for (const row of rendered) {
        if (row === cursor) { cursor = cursor.nextSibling; } else { this.tree.insertBefore(row, cursor); }
      }
      while (cursor) { const next = cursor.nextSibling; this.tree.removeChild(cursor); cursor = next; }
    } else { this.tree.replaceChildren(fragment); }
    this.selection.reconcile(this.visibleNotes());
    for (const row of this.rows()) {
      const file = this.rowFile(row), selected = this.selectionMode ? file instanceof TFile && this.selection.has(file.path, file) : row.dataset.explorerPath === active;
      row.draggable = enabled && !this.app.vault.readOnly && this.selectionMode && this.selection.size > 0 && this.selection.size <= MAX_EXPLORER_OPEN
        && file instanceof TFile && this.selectable(file) && this.selection.has(file.path, file);
      row.setAttribute("aria-selected", String(selected)); row.classList.toggle("is-active", selected);
      row.classList.toggle("is-selected", this.selectionMode && selected); row.dataset.explorerSelected = String(this.selectionMode && selected);
    }
    this.buttons.get("open-selected")!.disabled = !enabled || !this.selectionMode || !this.selection.size || this.selection.size > MAX_EXPLORER_OPEN;
    for (const action of ["move-selected", "rename-selected", "trash-selected"]) {
      this.buttons.get(action)!.disabled = !enabled || this.app.vault.readOnly || !this.selectionMode || !this.selection.size || this.selection.size > MAX_EXPLORER_OPEN;
      this.buttons.get(action)!.hidden = !this.selectionMode;
    }
    this.buttons.get("clear-selection")!.disabled = !enabled || !this.selectionMode || !this.selection.size;
    this.buttons.get("open-selected")!.hidden = !this.selectionMode; this.buttons.get("clear-selection")!.hidden = !this.selectionMode;
    this.status.textContent = this.message || (this.selectionMode ? `${this.selection.size} Markdown notes selected (up to ${MAX_EXPLORER_SELECTION}). Click selects; Ctrl/⌘ or Space toggles; Shift selects a visible range. Open selected notes opens 1–${MAX_EXPLORER_OPEN} in new tabs; move, rename and removal each require a separate review. Removal defaults to vault trash; permanent deletion requires acknowledgement. Drag selected notes onto a visible folder in any Files pane to review a move; pause over a folded folder to expand it.` : `${model.files} files, ${model.folders} folders` + (count >= 5000 ? ". Showing the first 5,000 entries; filter to narrow the list." : "."));
    if (preserveDrag && currentExplorerNoteDrag(this.app) !== preserveDrag) { this.clearNoteDropTarget(); }
    this.roving(); if (focus) { this.focus(); }
  }
}
