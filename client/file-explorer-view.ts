import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { explorerSorts, explorerState, explorerTree, type ExplorerState, type ExplorerNode } from "./file-explorer-model";
import { icon } from "./icons";
import { Menu } from "./menu";
import { TAbstractFile, TFile, TFolder } from "./vault";
import { ItemView } from "./views";
import type { WorkspaceLeaf } from "./workspace";

interface ExplorerItem { file: TAbstractFile; titleEl: HTMLButtonElement; titleInnerEl: HTMLSpanElement; selfEl: HTMLButtonElement; innerEl: HTMLSpanElement; }

export class FileExplorerView extends ItemView {
  override icon = "folder";
  /** Materialized, live-vault rows, retained across folding/filtering up to the render budget. */
  readonly fileItems: Record<string, ExplorerItem> = Object.create(null);
  private options: ExplorerState = explorerState({});
  private readonly sourceRoot: string | null;
  private readonly toolbar = document.createElement("div");
  private readonly sort = document.createElement("select");
  private readonly search = document.createElement("input");
  private readonly tree = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly filteredCollapsed = new Set<string>();
  private focusPath = "";
  private queued = false;
  private refreshing = false;
  private message = "";
  private context: Menu | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("file-explorer-workspace");
    this.contentEl.dataset.fileExplorer = leaf.id;
    this.toolbar.className = "file-explorer-controls";
    for (const [action, title, glyph] of [
      ["new-note", "New note", "new-note"], ["new-folder", "New folder", "folder"],
      ["search", "Filter files", "search"], ["reveal", "Reveal active file", "arrow-right"],
      ["auto-reveal", "Automatically reveal active file", "pin"],
      ["expand", "Expand all folders", "chevron-down"], ["collapse", "Collapse all folders", "collapse"],
      ["refresh", "Refresh files", "refresh"],
    ]) {
      const button = document.createElement("button"); button.type = "button";
      button.className = "clickable-icon"; button.dataset.explorerAction = action; button.title = title;
      button.setAttribute("aria-label", title); button.append(icon(glyph)); this.buttons.set(action, button); this.toolbar.append(button);
    }
    this.sort.setAttribute("aria-label", "Sort files"); this.sort.dataset.explorerSort = "true";
    for (const [value, title] of Object.entries(explorerSorts)) { const option = document.createElement("option"); option.value = value; option.textContent = title; this.sort.append(option); }
    this.search.type = "search"; this.search.maxLength = 1024; this.search.placeholder = "Filter files…";
    this.search.setAttribute("aria-label", "Filter vault files"); this.search.dataset.explorerSearch = "true";
    this.tree.className = "file-explorer-tree nav-files-container"; this.tree.tabIndex = 0;
    this.tree.setAttribute("role", "tree"); this.tree.setAttribute("aria-label", "Vault files");
    this.status.className = "file-explorer-status"; this.status.setAttribute("role", "status");
    this.contentEl.append(this.toolbar, this.sort, this.search, this.tree, this.status);
    this.registerDomEvent(this.toolbar, "click", event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-explorer-action]") : null;
      if (target) { this.run(() => this.action(target.dataset.explorerAction!)); }
    });
    this.registerDomEvent(this.sort, "change", () => this.run(() => { this.options.sortOrder = explorerState({ sortOrder: this.sort.value }).sortOrder; this.save(); this.render(); }));
    this.registerDomEvent(this.search, "input", () => this.run(() => { this.options.searchQuery = this.search.value; this.filteredCollapsed.clear(); this.save(); this.render(); }));
    this.registerDomEvent(this.tree, "click", event => {
      const row = this.row(event.target); if (row && event instanceof MouseEvent) { this.run(() => this.activate(row.dataset.explorerPath!, event.ctrlKey || event.metaKey)); }
    });
    this.registerDomEvent(this.tree, "keydown", event => { if (event instanceof KeyboardEvent) { this.key(event); } });
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
    this.register(() => { this.context?.hide(); this.context = null; for (const path of Object.keys(this.fileItems)) { delete this.fileItems[path]; } });
  }

  getViewType(): string { return "file-explorer"; }
  getDisplayText(): string { return "Files"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options, collapsedFolders: [...this.options.collapsedFolders] }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = explorerState(state);
    await super.setState(state, result); this.options = options; this.filteredCollapsed.clear(); this.render();
  }
  protected override async onOpen(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (this.options.autoReveal && file) { this.expandParents(file); }
    this.render();
  }
  override focus(): void { (this.rows().find(row => row.dataset.explorerPath === this.focusPath) ?? this.tree).focus(); }

  private owned(): boolean { return this.isLoaded && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean {
    return Boolean(this.sourceRoot) && this.owned() && !this.app.changingVault && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout
      && this.app.core.isEnabled("file-explorer") && !this.app.core.busy && !this.refreshing;
  }
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
    queueMicrotask(() => { this.queued = false; if (this.owned()) { this.render(); } });
  }
  private row(target: EventTarget | null): HTMLElement | null { return target instanceof Element ? target.closest<HTMLElement>("[data-explorer-path]") : null; }
  private rows(): HTMLElement[] { return Array.from(this.tree.querySelectorAll<HTMLElement>("[data-explorer-path]")); }
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
    if (!this.interactive() || event.altKey || event.metaKey || event.ctrlKey) { return; }
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
    } else if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); this.run(() => this.activate(row.dataset.explorerPath!)); return; }
    else if (row && event.key === "F10" && event.shiftKey) { event.preventDefault(); this.menu(new MouseEvent("contextmenu", { bubbles: true, clientX: row.getBoundingClientRect().left, clientY: row.getBoundingClientRect().bottom }), row); return; }
    else { return; }
    event.preventDefault(); target?.focus();
  }
  private menu(event: MouseEvent, row = this.row(event.target)): void {
    if (!this.interactive() || !row) { return; }
    const file = this.app.vault.getAbstractFileByPath(row.dataset.explorerPath!); if (!file) { return; }
    this.focusPath = file.path; const menu = Menu.forEvent(event); this.context = menu;
    if (file instanceof TFile && this.app.workspace.viewTypeForExtension(file.extension)) {
      for (const [label, tab] of [["Open", false], ["Open in new tab", true]] as const) {
        menu.addItem(item => item.setTitle(label).onClick(() => { if (this.interactive() && this.app.vault.getAbstractFileByPath(file.path) === file) { return this.activate(file.path, tab); } }));
      }
    }
    if (!this.app.vault.readOnly) { this.app.fileManager.openContextMenu(file.path, event); }
    else { this.app.workspace.trigger("file-menu", menu, file, "file-explorer"); }
  }
  private render(): void {
    this.sort.value = this.options.sortOrder; this.search.hidden = !this.options.showSearch; this.search.value = this.options.searchQuery;
    const enabled = this.interactive(); this.sort.disabled = !enabled; this.search.disabled = !enabled;
    for (const [action, button] of this.buttons) { button.disabled = !enabled || this.app.vault.readOnly && ["new-note", "new-folder"].includes(action); }
    this.buttons.get("search")!.setAttribute("aria-pressed", String(this.options.showSearch));
    this.buttons.get("auto-reveal")!.setAttribute("aria-pressed", String(this.options.autoReveal));
    const focus = this.tree.contains(document.activeElement), active = this.app.workspace.getActiveFile()?.path;
    const model = explorerTree(this.app.vault.getAllLoadedFiles().map(file => ({ path: file.path, folder: file instanceof TFolder,
      ...(file instanceof TFile ? { mtime: file.stat.mtime, ctime: file.stat.ctime } : {}) })), this.options.sortOrder, this.options.showSearch ? this.options.searchQuery : "");
    const fragment = document.createDocumentFragment(), pending: { node: ExplorerNode; depth: number; position: number; size: number }[] = [];
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
        row.setAttribute("aria-selected", String(node.path === active)); row.classList.toggle("is-active", node.path === active); row.disabled = !enabled;
        row.style.setProperty("--explorer-depth", String(current.depth - 1));
        const chevron = row.querySelector<SVGSVGElement>(".file-explorer-chevron"); if (chevron) { chevron.style.visibility = node.children.some(child => child.visible) ? "" : "hidden"; }
        item.titleInnerEl.textContent = file instanceof TFile && file.extension.toLowerCase() === "md" ? file.basename : node.name;
        const unavailable = file instanceof TFile && !this.app.workspace.viewTypeForExtension(file.extension);
        row.classList.toggle("is-unavailable", unavailable); if (unavailable) { row.setAttribute("aria-disabled", "true"); } else { row.removeAttribute("aria-disabled"); }
        fragment.append(row);
        if (node.folder && !this.collapsed(node.path) && node.children.some(child => child.visible)) {
          push(node.children, current.depth + 1);
        }
    }
    let cached = Object.keys(this.fileItems).length;
    for (const path of Object.keys(this.fileItems)) {
      if (cached <= 5000) { break; } if (!materialized.has(path)) { delete this.fileItems[path]; cached--; }
    }
    this.tree.replaceChildren(fragment); this.status.textContent = this.message || `${model.files} files, ${model.folders} folders` + (count >= 5000 ? ". Showing the first 5,000 entries; filter to narrow the list." : ".");
    this.roving(); if (focus) { this.focus(); }
  }
}
