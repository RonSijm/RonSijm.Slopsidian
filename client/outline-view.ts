import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { icon } from "./icons";
import { parseMarkdown, type HeadingCache } from "./markdown";
import { outlineNodes, outlineState, type OutlineNode } from "./outline-model";
import { TFile } from "./vault";
import { ItemView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

interface OutlineSnapshot { id: number; path: string; file: TFile; text: string; headings: readonly HeadingCache[]; }

export class OutlineView extends ItemView {
  override icon = "outline";
  private options = outlineState({});
  private readonly sourceRoot: string | null;
  private readonly controls = document.createElement("div");
  private readonly follow = document.createElement("input");
  private readonly cursor = document.createElement("input");
  private readonly filter = document.createElement("input");
  private readonly caption = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly tree = document.createElement("div");
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly filteredFolds = new Set<string>();
  private nodes: OutlineNode[] = [];
  private snapshot: OutlineSnapshot | null = null;
  private noteView: MarkdownView | null = null;
  private request = 0;
  private revision = 0;
  private queued = false;
  private focusKey = "";
  private activeKey = "";
  private message = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf); this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("outline-workspace"); this.contentEl.dataset.outlinePane = leaf.id;
    this.controls.className = "outline-pane-controls";
    for (const [input, key, text] of [[this.follow, "followActiveFile", "Follow active note"], [this.cursor, "followCursor", "Scroll to active heading"]] as const) {
      const label = document.createElement("label"); input.type = "checkbox"; input.dataset.outlineOption = key; label.append(input, text); this.controls.append(label);
    }
    for (const [action, title, glyph] of [["filter", "Filter headings", "search"], ["collapse", "Collapse all headings", "collapse"], ["expand", "Expand all headings", "chevron-down"]]) {
      const button = document.createElement("button"); button.type = "button"; button.className = "clickable-icon"; button.dataset.outlineAction = action; button.title = title; button.setAttribute("aria-label", title); button.append(icon(glyph)); this.buttons.set(action, button); this.controls.append(button);
    }
    this.filter.type = "search"; this.filter.maxLength = 1024; this.filter.placeholder = "Filter headings…"; this.filter.setAttribute("aria-label", "Filter outline headings"); this.filter.dataset.outlineSearch = "true";
    this.caption.className = "outline-pane-caption"; this.caption.dataset.outlineFile = "true";
    this.status.className = "outline-pane-status"; this.status.setAttribute("role", "status"); this.status.dataset.outlineStatus = "true";
    this.tree.className = "outline-pane-tree"; this.tree.setAttribute("role", "tree"); this.tree.setAttribute("aria-label", "Note headings"); this.tree.tabIndex = 0;
    this.contentEl.append(this.controls, this.filter, this.caption, this.tree, this.status);
    this.registerDomEvent(this.controls, "change", event => this.run(() => {
      if (!(event.target instanceof HTMLInputElement)) { return; }
      if (event.target === this.follow) { this.options.followActiveFile = this.follow.checked; this.syncTarget(); this.save(); this.schedule(); }
      else if (event.target === this.cursor) { this.options.followCursor = this.cursor.checked; if (this.cursor.checked) { this.activeKey = ""; } this.save(); this.highlight(); }
    }));
    this.registerDomEvent(this.controls, "click", event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-outline-action]") : null;
      if (target) { this.run(() => this.action(target.dataset.outlineAction!)); }
    });
    this.registerDomEvent(this.filter, "input", () => this.run(() => { this.options.searchQuery = this.filter.value; this.filteredFolds.clear(); this.save(); this.renderTree(); }));
    this.registerDomEvent(this.tree, "focusin", event => { const row = this.row(event.target); if (row) { this.focusKey = row.dataset.outlineNode!; this.roving(); } });
    this.registerDomEvent(this.tree, "click", event => {
      const row = this.row(event.target); if (!row || !(event instanceof MouseEvent) || !(event.target instanceof Element)) { return; }
      const key = row.dataset.outlineNode!, generation = Number(row.dataset.outlineGeneration);
      this.run(() => { if (this.snapshot?.id === generation) { return event.target instanceof Element && event.target.closest("[data-outline-fold]") ? this.toggle(key) : this.navigate(key, generation, event.ctrlKey || event.metaKey); } });
    });
    this.registerDomEvent(this.tree, "keydown", event => { if (event instanceof KeyboardEvent) { this.key(event); } });
    this.registerEvent(this.app.metadataCache.on("finished", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      if (leaf && typeof leaf === "object" && "view" in leaf && leaf.view instanceof MarkdownView) { this.remember(leaf.view); }
      this.syncTarget(); this.schedule();
    }));
    for (const event of ["editor-selection-change", "markdown-scroll"] as const) {
      this.registerEvent(this.app.workspace.on(event, (...args) => { const view = args.find(arg => arg instanceof MarkdownView); if (view instanceof MarkdownView && view.file === this.file) { this.remember(view); this.highlight(); } }));
    }
    this.registerEvent(this.app.vault.on("rename", (file, old) => {
      if (file instanceof TFile && old === this.options.file && this.owned()) { this.options.file = file.path; this.save(); this.schedule(); }
    }));
    this.registerEvent(this.app.vault.on("delete", () => this.schedule()));
    this.registerEvent(this.app.core.on("changed", () => { this.updateControls(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-ready", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-change", () => { if (this.follow.disabled === this.interactive()) { this.updateControls(); this.schedule(); } }));
    this.register(() => { this.request++; this.snapshot = null; this.nodes = []; this.noteView = null; });
  }

  getViewType(): string { return "outline"; }
  getDisplayText(): string { return "Outline"; }
  get file(): TFile | null { return this.app.vault.getFileByPath(this.options.file); }
  async setFile(file: TFile): Promise<void> {
    if (!this.interactive() || !(file instanceof TFile) || this.app.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== "md") { throw new Error("Set a live Outline pane to a Markdown file in the selected vault after current operations finish."); }
    this.options.followActiveFile = false; this.target(file.path); this.save(); await this.refresh();
  }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options, foldedHeadings: [...this.options.foldedHeadings] }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = outlineState(state); await super.setState(state, result);
    this.request++; this.options = options; this.snapshot = null; this.noteView = null; this.filteredFolds.clear(); this.updateControls(); this.schedule();
  }
  protected override async onOpen(): Promise<void> { this.syncTarget(); this.updateControls(); this.schedule(); }
  override focus(): void { (this.rows().find(row => row.dataset.outlineNode === this.focusKey) ?? this.tree).focus(); }

  private owned(): boolean { return this.isLoaded && Boolean(this.sourceRoot) && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean { return this.owned() && !this.app.changingVault && !this.app.core.busy && this.app.core.isEnabled("outline") && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout; }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    Promise.resolve().then(() => { if (this.interactive()) { this.message = ""; return action(); } }).catch(error => {
      if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); } reportError(error);
    });
  }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private schedule(): void {
    this.request++;
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => { this.queued = false; if (this.owned()) { this.refresh().catch(error => { if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); reportError(error); } }); } });
  }
  private remember(view: MarkdownView): void { if (view.file?.path === this.options.file && (this.app.workspace.activeLeaf === view.leaf || !this.noteView || !this.noteView.isLoaded)) { this.noteView = view; } }
  private target(path: string): void {
    if (path === this.options.file) { return; }
    this.options.file = path; this.options.foldedHeadings = []; this.filteredFolds.clear(); this.snapshot = null; this.noteView = null; this.focusKey = ""; this.activeKey = ""; this.message = ""; this.request++;
    this.nodes = []; this.tree.replaceChildren(); this.status.textContent = "Loading outline…"; this.roving();
  }
  private syncTarget(): void {
    if (!this.owned() || !this.options.followActiveFile) { return; }
    const file = this.app.workspace.getActiveFile(); if (!file || file.extension.toLowerCase() !== "md") { return; }
    const changed = file.path !== this.options.file; this.target(file.path);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (view) { this.remember(view); }
    if (changed) { this.save(); }
  }
  private views(): MarkdownView[] { return this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === this.file && view.isLoaded); }
  private source(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView); if (active?.file === this.file) { return active; }
    const views = this.views(); return this.noteView && views.includes(this.noteView) ? this.noteView : views[0] ?? null;
  }
  private updateControls(): void {
    const enabled = this.interactive(); this.follow.disabled = this.cursor.disabled = this.filter.disabled = !enabled;
    this.follow.checked = this.options.followActiveFile; this.cursor.checked = this.options.followCursor; this.filter.hidden = !this.options.showSearch; this.filter.value = this.options.searchQuery;
    for (const button of this.buttons.values()) { button.disabled = !enabled; }
    this.buttons.get("filter")!.setAttribute("aria-pressed", String(this.options.showSearch));
    this.tree.setAttribute("aria-disabled", String(!enabled)); this.tree.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = !enabled; });
    this.caption.textContent = this.options.file || "No note selected";
  }
  private async refresh(): Promise<void> {
    this.syncTarget(); const token = ++this.request; this.updateControls(); if (!this.interactive()) { return; }
    const path = this.options.file, file = this.file;
    if (!file || file.extension.toLowerCase() !== "md") {
      this.snapshot = null; this.nodes = []; this.tree.replaceChildren(); this.status.textContent = path ? "This Markdown note is missing or unavailable: " + path : "Open a Markdown note to see its outline."; this.roving(); return;
    }
    const entry = this.app.metadataCache.getDocument(path);
    const text = entry && !entry.missing ? entry.text : await this.app.vault.read(file);
    if (!this.interactive() || token !== this.request || this.options.file !== path || this.app.vault.getFileByPath(path) !== file) { return; }
    const current = this.app.metadataCache.getDocument(path), headings = current && !current.missing && current.text === text ? current.cache.headings : parseMarkdown(text).headings;
    if (this.snapshot?.file === file && this.snapshot.path === path && this.snapshot.text === text) { this.highlight(); return; }
    this.snapshot = { id: ++this.revision, path, file, text, headings }; this.renderTree();
  }
  private row(target: EventTarget | null): HTMLElement | null { return target instanceof Element ? target.closest<HTMLElement>("[data-outline-node]") : null; }
  private rows(): HTMLElement[] { return Array.from(this.tree.querySelectorAll<HTMLElement>("[data-outline-node]")); }
  private roving(): void { const rows = this.rows(), selected = rows.find(row => row.dataset.outlineNode === this.focusKey) ?? rows[0]; this.tree.tabIndex = rows.length ? -1 : 0; rows.forEach(row => { row.tabIndex = row === selected ? 0 : -1; }); }
  private filtered(): boolean { return this.options.showSearch && Boolean(this.options.searchQuery.trim()); }
  private folded(key: string): boolean { return this.filtered() ? this.filteredFolds.has(key) : this.options.foldedHeadings.includes(key); }
  private toggle(key: string): void {
    if (!this.nodes.some(node => node.key === key && node.children.some(child => child.visible))) { return; }
    const folds = this.filtered() ? this.filteredFolds : new Set(this.options.foldedHeadings);
    if (!folds.has(key) && (folds.size >= 4096 || key.length > 8192)) { this.status.textContent = "Expand headings before storing more folds; long heading keys cannot be persisted."; return; }
    folds.has(key) ? folds.delete(key) : folds.add(key);
    if (!this.filtered()) { this.options.foldedHeadings = [...folds]; this.save(); }
    this.focusKey = key; this.renderTree();
  }
  private action(action: string): void {
    if (action === "filter") { this.options.showSearch = !this.options.showSearch; if (!this.options.showSearch) { this.options.searchQuery = ""; } this.filteredFolds.clear(); }
    if (action === "expand") { if (this.filtered()) { this.filteredFolds.clear(); } else { this.options.foldedHeadings = []; } }
    if (action === "collapse") {
      const keys = this.nodes.filter(node => node.children.some(child => child.visible)).map(node => node.key);
      if (keys.length > 4096 || keys.some(key => key.length > 8192)) { this.status.textContent = "Collapse all exceeds the saved fold limits. Filter the headings to narrow the list."; return; }
      if (this.filtered()) { keys.forEach(key => this.filteredFolds.add(key)); } else { this.options.foldedHeadings = keys; }
    }
    this.save(); this.updateControls(); this.renderTree(); if (action === "filter" && this.options.showSearch) { this.filter.focus(); }
  }
  private async navigate(key: string, generation: number, tab = false): Promise<void> {
    const snapshot = this.snapshot, node = this.nodes.find(node => node.key === key);
    if (!snapshot || generation !== snapshot.id || !node || this.file !== snapshot.file) { this.schedule(); return; }
    let view = !tab ? this.source() : null;
    if (view && view.editor.getValue() !== snapshot.text) { this.message = "The note changed; the outline has been refreshed."; this.app.metadataCache.updateOpenDocuments(); this.schedule(); return; }
    if (!view) { const leaf = this.app.workspace.getLeaf(tab ? "tab" : false); await leaf.openFile(snapshot.file); view = leaf.view instanceof MarkdownView ? leaf.view : null; }
    if (!this.interactive() || this.snapshot?.id !== snapshot.id || !view || view.file !== snapshot.file) { return; }
    if (view.editor.getValue() !== snapshot.text) { this.message = "The note changed; the outline has been refreshed."; this.app.metadataCache.updateOpenDocuments(); this.schedule(); return; }
    this.noteView = view; this.app.workspace.setActiveLeaf(view.leaf, { focus: false }); view.revealLine(node.heading.position.start.line); this.highlight();
  }
  private highlight(): void {
    const snapshot = this.snapshot, view = this.source(); let line = view?.editor.getCursor().line ?? -1;
    if (view?.getMode() === "preview" && view.containerEl.checkVisibility()) {
      const top = view.contentEl.getBoundingClientRect().top + 32, headings = [...view.previewEl.querySelectorAll<HTMLElement>("h1[data-source-line],h2[data-source-line],h3[data-source-line],h4[data-source-line],h5[data-source-line],h6[data-source-line]")];
      const visible = headings.findLast(heading => heading.getBoundingClientRect().top <= top) ?? headings[0]; line = visible ? Number(visible.dataset.sourceLine) : -1;
    }
    const active = snapshot?.headings.findLast(heading => heading.position.start.line <= line), key = active ? this.nodes.find(node => node.heading === active)?.key ?? "" : "", changed = key !== this.activeKey; this.activeKey = key;
    for (const row of this.rows()) { const selected = row.dataset.outlineNode === key; row.classList.toggle("is-active", selected); row.setAttribute("aria-selected", String(selected)); if (selected) { row.setAttribute("aria-current", "location"); } else { row.removeAttribute("aria-current"); } }
    if (changed && this.options.followCursor && view?.containerEl.checkVisibility() && view.editor.getValue() === snapshot?.text) {
      let node = this.nodes.find(node => node.key === key); const rows = this.rows(); let row: HTMLElement | undefined;
      while (node && !(row = rows.find(row => row.dataset.outlineNode === node!.key))) { node = node.parent ?? undefined; } row?.scrollIntoView({ block: "nearest" });
    }
  }
  private renderTree(): void {
    const snapshot = this.snapshot; if (!snapshot) { return; }
    const hadFocus = this.tree.contains(document.activeElement); this.nodes = outlineNodes(snapshot.headings, this.filtered() ? this.options.searchQuery : "");
    const fragment = document.createDocumentFragment(), hidden = new Set<string>(); let count = 0;
    for (const node of this.nodes) {
      if (!node.visible) { continue; }
      if (node.parent && (hidden.has(node.parent.key) || this.folded(node.parent.key))) { hidden.add(node.key); continue; }
      if (count++ >= 3000) { break; }
      const row = document.createElement("div"); row.className = "outline-pane-row"; row.dataset.outlineNode = node.key; row.dataset.outlineGeneration = String(snapshot.id); row.setAttribute("role", "treeitem"); row.setAttribute("aria-level", String(node.depth)); row.style.setProperty("--outline-depth", String(node.depth - 1));
      const children = node.children.some(child => child.visible), fold = document.createElement("button"); fold.type = "button"; fold.tabIndex = -1; fold.className = "clickable-icon"; fold.dataset.outlineFold = node.key; fold.setAttribute("aria-label", "Toggle child headings: " + node.heading.heading); fold.append(icon(this.folded(node.key) ? "chevron-right" : "chevron-down")); if (!children) { fold.style.visibility = "hidden"; } else { row.setAttribute("aria-expanded", String(!this.folded(node.key))); }
      const title = document.createElement("button"); title.type = "button"; title.tabIndex = -1; title.className = "outline-heading"; title.dataset.outlineLine = String(node.heading.position.start.line); title.textContent = node.heading.heading || "(Untitled heading)";
      row.append(fold, title); fragment.append(row);
    }
    this.tree.replaceChildren(fragment); this.status.textContent = this.message || (this.nodes.length ? `${this.nodes.filter(node => node.visible).length} headings` + (count > 3000 ? ". Showing the first 3,000 visible headings; filter to narrow the list." : ".") : "No headings found.");
    this.updateControls(); this.roving(); this.highlight(); if (hadFocus) { this.focus(); }
  }
  private key(event: KeyboardEvent): void {
    if (!this.interactive() || event.altKey || event.metaKey) { return; }
    const row = this.row(event.target), rows = this.rows(), index = row ? rows.indexOf(row) : -1, node = this.nodes.find(node => node.key === row?.dataset.outlineNode); let target: HTMLElement | undefined;
    if (row && Number(row.dataset.outlineGeneration) !== this.snapshot?.id) { return; }
    if (event.ctrlKey && event.key !== "Enter") { return; }
    if (event.key === "ArrowDown") { target = rows[Math.min(index + 1, rows.length - 1)]; } else if (event.key === "ArrowUp") { target = rows[Math.max(0, index - 1)]; }
    else if (event.key === "Home") { target = rows[0]; } else if (event.key === "End") { target = rows.at(-1); }
    else if (node && event.key === "ArrowRight") { if (node.children.some(child => child.visible) && this.folded(node.key)) { this.toggle(node.key); } else if (Number(rows[index + 1]?.getAttribute("aria-level")) > node.depth) { target = rows[index + 1]; } }
    else if (node && event.key === "ArrowLeft") { if (node.children.some(child => child.visible) && !this.folded(node.key)) { this.toggle(node.key); } else { target = rows.find(row => row.dataset.outlineNode === node.parent?.key); } }
    else if (node && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); this.run(() => this.navigate(node.key, Number(row!.dataset.outlineGeneration), event.ctrlKey)); return; }
    else { return; }
    event.preventDefault(); target?.focus();
  }
}
