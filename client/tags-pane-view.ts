import { copyViewData, type ViewStateResult } from "./contracts";
import type { GlobalSearch } from "./discovery-views";
import { reportError } from "./dom";
import { icon } from "./icons";
import { mergeSearchQuery } from "./search-pane-model";
import { SearchView } from "./search-view";
import { tagNodes, tagSorts, tagsPaneState, type TagNode } from "./tags-pane-model";
import { ItemView } from "./views";
import type { WorkspaceLeaf } from "./workspace";

export class TagsPaneView extends ItemView {
  override icon = "tag";
  private options = tagsPaneState({});
  private readonly sourceRoot: string | null;
  private readonly controls = document.createElement("div");
  private readonly hierarchy = document.createElement("input");
  private readonly sort = document.createElement("select");
  private readonly filter = document.createElement("input");
  private readonly tree = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly actions = new Map<string, HTMLButtonElement>();
  private readonly filteredFolds = new Set<string>();
  private nodes: TagNode[] = [];
  private revision = 0;
  private queued = false;
  private focusKey = "";
  private message = "";

  constructor(leaf: WorkspaceLeaf, private readonly search: GlobalSearch) {
    super(leaf); this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("tags-workspace"); this.contentEl.dataset.tagsPane = leaf.id;
    this.controls.className = "discovery-pane-controls";
    const label = document.createElement("label"); this.hierarchy.type = "checkbox"; this.hierarchy.dataset.tagsPaneHierarchy = "true"; label.append(this.hierarchy, "Nested tags"); this.controls.append(label);
    this.sort.dataset.tagsPaneSort = "true"; this.sort.setAttribute("aria-label", "Sort tags");
    for (const [value, text] of Object.entries(tagSorts)) { const option = document.createElement("option"); option.value = value; option.textContent = text; this.sort.append(option); }
    this.controls.append(this.sort);
    for (const [action, title, glyph] of [["filter", "Filter tags", "search"], ["collapse", "Collapse all tags", "collapse"], ["expand", "Expand all tags", "chevron-down"]]) {
      const button = document.createElement("button"); button.type = "button"; button.className = "clickable-icon"; button.dataset.tagsPaneAction = action; button.title = title; button.setAttribute("aria-label", title); button.append(icon(glyph)); this.actions.set(action, button); this.controls.append(button);
    }
    this.filter.type = "search"; this.filter.maxLength = 1024; this.filter.placeholder = "Filter tags..."; this.filter.setAttribute("aria-label", "Filter tags"); this.filter.dataset.tagsPaneSearch = "true";
    this.tree.className = "tags-pane-tree"; this.tree.setAttribute("role", "tree"); this.tree.setAttribute("aria-label", "Vault tags"); this.tree.tabIndex = 0;
    this.status.className = "discovery-status"; this.status.setAttribute("role", "status"); this.status.dataset.tagsPaneStatus = "true";
    this.contentEl.append(this.controls, this.filter, this.tree, this.status);
    this.registerDomEvent(this.hierarchy, "change", () => this.run(() => { this.options.useHierarchy = this.hierarchy.checked; this.save(); this.render(); }));
    this.registerDomEvent(this.sort, "change", () => this.run(() => { this.options.sortOrder = tagsPaneState({ sortOrder: this.sort.value }).sortOrder; this.save(); this.render(); }));
    this.registerDomEvent(this.filter, "input", () => this.run(() => { this.options.searchQuery = this.filter.value; this.filteredFolds.clear(); this.save(); this.render(); }));
    this.registerDomEvent(this.controls, "click", event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tags-pane-action]") : null;
      if (button) { this.run(() => this.action(button.dataset.tagsPaneAction!)); }
    });
    this.registerDomEvent(this.tree, "focusin", event => { const row = this.row(event.target); if (row) { this.focusKey = row.dataset.tagKey!; this.roving(); } });
    this.registerDomEvent(this.tree, "click", event => {
      const row = this.row(event.target); if (!row || !(event instanceof MouseEvent) || !(event.target instanceof Element)) { return; }
      const key = row.dataset.tagKey!, revision = Number(row.dataset.tagsGeneration), fold = Boolean(event.target.closest("[data-tags-pane-fold]"));
      this.run(() => { if (revision === this.revision) { return fold ? this.toggle(key) : this.open(key, event.ctrlKey || event.metaKey); } });
    });
    this.registerDomEvent(this.tree, "keydown", event => { if (event instanceof KeyboardEvent) { this.key(event); } });
    this.registerEvent(this.app.metadataCache.on("finished", () => this.schedule()));
    this.registerEvent(this.app.core.on("changed", () => { this.updateControls(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-ready", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("layout-change", () => { if (this.sort.disabled === this.interactive()) { this.updateControls(); this.schedule(); } }));
    this.register(() => { this.revision++; this.nodes = []; this.filteredFolds.clear(); });
  }

  getViewType(): string { return "tag"; }
  getDisplayText(): string { return "Tags"; }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options, foldedTags: [...this.options.foldedTags] }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = tagsPaneState(state);
    if (!this.owned()) { throw new Error("Set state on a current Tags workspace view."); }
    await super.setState(state, result); this.options = options; this.filteredFolds.clear(); this.updateControls(); this.schedule();
  }
  showSearch(): void {
    if (!this.interactive()) { throw new Error("Show the filter on a live Tags pane after current operations finish."); }
    this.options.showSearch = true; this.updateControls(); this.save(); this.filter.focus();
  }
  protected override async onOpen(): Promise<void> { this.updateControls(); this.schedule(); }
  override focus(): void { (this.rows().find(row => row.dataset.tagKey === this.focusKey) ?? this.rows()[0] ?? this.tree).focus(); }

  private owned(): boolean { return this.isLoaded && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean { return this.owned() && Boolean(this.sourceRoot) && !this.app.changingVault && !this.app.core.busy && this.app.core.isEnabled("tag-pane") && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout; }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    Promise.resolve().then(() => { if (this.interactive()) { this.message = ""; return action(); } }).catch(error => {
      if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); } reportError(error);
    });
  }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private schedule(): void {
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => { this.queued = false; if (this.owned()) { this.run(() => this.render()); } });
  }
  private updateControls(): void {
    const enabled = this.interactive(); this.hierarchy.disabled = this.sort.disabled = this.filter.disabled = !enabled;
    this.hierarchy.checked = this.options.useHierarchy; this.sort.value = this.options.sortOrder; this.filter.hidden = !this.options.showSearch; this.filter.value = this.options.searchQuery;
    for (const [action, button] of this.actions) { button.disabled = !enabled || action !== "filter" && !this.options.useHierarchy; }
    this.actions.get("filter")!.setAttribute("aria-pressed", String(this.options.showSearch));
    this.tree.setAttribute("aria-disabled", String(!enabled)); this.tree.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = !enabled; });
  }
  private row(target: EventTarget | null): HTMLElement | null { return target instanceof Element ? target.closest<HTMLElement>("[data-tag-key]") : null; }
  private rows(): HTMLElement[] { return [...this.tree.querySelectorAll<HTMLElement>("[data-tag-key]")]; }
  private roving(): void {
    const rows = this.rows(), selected = rows.find(row => row.dataset.tagKey === this.focusKey) ?? rows[0]; this.tree.tabIndex = rows.length ? -1 : 0;
    rows.forEach(row => { row.tabIndex = row === selected ? 0 : -1; });
  }
  private filtered(): boolean { return Boolean(this.options.searchQuery.trim()); }
  private folded(key: string): boolean { return this.filtered() ? this.filteredFolds.has(key) : this.options.foldedTags.includes(key); }
  private toggle(key: string): void {
    if (!this.nodes.some(node => node.key === key && node.children.some(child => child.visible))) { return; }
    const folds = this.filtered() ? this.filteredFolds : new Set(this.options.foldedTags);
    if (!folds.has(key) && (folds.size >= 4096 || key.length > 8192)) { this.status.textContent = "Expand tags before storing more folds; long tag names cannot be persisted."; return; }
    folds.has(key) ? folds.delete(key) : folds.add(key);
    if (!this.filtered()) { this.options.foldedTags = [...folds]; this.save(); }
    this.focusKey = key; this.render();
  }
  private action(action: string): void {
    if (action === "filter") { this.options.showSearch = !this.options.showSearch; if (!this.options.showSearch) { this.options.searchQuery = ""; } this.filteredFolds.clear(); }
    if (action === "expand") { if (this.filtered()) { this.filteredFolds.clear(); } else { this.options.foldedTags = []; } }
    if (action === "collapse") {
      const keys = this.nodes.filter(node => node.children.some(child => child.visible)).map(node => node.key);
      if (keys.length > 4096 || keys.some(key => key.length > 8192)) { this.status.textContent = "Collapse all exceeds saved fold limits. Filter the tag list first."; return; }
      if (this.filtered()) { keys.forEach(key => this.filteredFolds.add(key)); } else { this.options.foldedTags = keys; }
    }
    this.save(); this.updateControls(); this.render(); if (action === "filter" && this.options.showSearch) { this.filter.focus(); }
  }
  private async open(key: string, modified: boolean): Promise<void> {
    const node = this.nodes.find(node => node.key === key); if (!node) { return; }
    if (this.app.core.getEnabledPluginById("global-search") !== this.search) { throw new Error("Enable Search to open tag results."); }
    this.app.metadataCache.updateOpenDocuments();
    if (!Object.keys(this.app.metadataCache.getTags()).some(tag => tag.toLowerCase() === key || tag.toLowerCase().startsWith(key + "/"))) { this.message = "This tag changed; the list has been refreshed."; this.render(); return; }
    const workspace = this.app.workspace, leaves = workspace.getLeavesOfType("search").filter(leaf => leaf.view instanceof SearchView);
    let leaf = leaves.find(leaf => leaf.getRoot() === workspace.leftSplit && leaf.parent.children[leaf.parent.currentTab] === leaf) ?? leaves[0];
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: "search", state: { query: mergeSearchQuery(this.search.getGlobalSearchQuery(), "tag:" + node.tag, modified) }, active: false });
    } else {
      const view = leaf.view; if (!(view instanceof SearchView)) { throw new Error("The selected Search provider changed."); }
      view.setQuery(mergeSearchQuery(view.getQuery(), "tag:" + node.tag, modified));
    }
    if (!this.interactive() || !(leaf.view instanceof SearchView)) { return; }
    const view = leaf.view; await workspace.revealLeaf(leaf);
    if (!this.interactive() || leaf.view !== view || this.app.core.getEnabledPluginById("global-search") !== this.search) { return; }
    if (leaf.getRoot() === workspace.leftSplit) { this.app.sidebars.show("workspace-left"); }
    view.focus();
  }
  private render(): void {
    if (!this.interactive()) { this.updateControls(); return; }
    const hadFocus = this.tree.contains(document.activeElement); this.nodes = tagNodes(this.app.metadataCache.getTags(), this.options); this.revision++;
    const fragment = document.createDocumentFragment(), hidden = new Set<string>(); let count = 0;
    for (const node of this.nodes) {
      if (!node.visible) { continue; }
      if (node.parent && (hidden.has(node.parent.key) || this.folded(node.parent.key))) { hidden.add(node.key); continue; }
      if (count++ >= 3000) { break; }
      const row = document.createElement("div"); row.className = "tags-pane-row"; row.dataset.tagKey = node.key; row.dataset.tagsGeneration = String(this.revision); row.setAttribute("role", "treeitem"); row.setAttribute("aria-level", String(node.depth)); row.style.setProperty("--tag-depth", String(node.depth - 1));
      const children = node.children.some(child => child.visible), fold = document.createElement("button"); fold.type = "button"; fold.tabIndex = -1; fold.className = "clickable-icon"; fold.dataset.tagsPaneFold = node.key; fold.setAttribute("aria-label", "Toggle child tags: " + node.tag); fold.append(icon(this.folded(node.key) ? "chevron-right" : "chevron-down"));
      if (children) { row.setAttribute("aria-expanded", String(!this.folded(node.key))); } else { fold.style.visibility = "hidden"; }
      const title = document.createElement("button"); title.type = "button"; title.tabIndex = -1; title.className = "tag-pane-tag-text"; title.dataset.paneTag = node.tag; title.title = node.tag;
      const name = node.tag.slice(1), slash = name.lastIndexOf("/");
      if (!this.options.useHierarchy && slash >= 0) { const parent = document.createElement("span"); parent.className = "tag-pane-tag-parent"; parent.textContent = name.slice(0, slash + 1); title.append(parent); }
      title.append(document.createTextNode(slash >= 0 ? name.slice(slash + 1) : name));
      const badge = document.createElement("span"); badge.className = "tag-pane-tag-count"; badge.dataset.paneTagCount = node.tag; badge.textContent = String(node.count); badge.setAttribute("aria-label", node.count + " indexed occurrences");
      row.append(fold, title, badge); fragment.append(row);
    }
    this.tree.replaceChildren(fragment); this.status.textContent = this.message || (this.nodes.some(node => node.visible) ? `${this.nodes.filter(node => node.visible).length} tags.` + (count > 3000 ? " Showing the first 3,000 visible tags; filter to narrow the list." : "") : this.nodes.length ? "No tags match this filter." : "No tags found.");
    this.updateControls(); this.roving(); if (hadFocus) { this.focus(); }
  }
  private key(event: KeyboardEvent): void {
    if (!this.interactive() || event.altKey || (event.ctrlKey || event.metaKey) && event.key !== "Enter") { return; }
    const row = this.row(event.target), rows = this.rows(), index = row ? rows.indexOf(row) : -1, node = this.nodes.find(node => node.key === row?.dataset.tagKey); let target: HTMLElement | undefined;
    if (row && Number(row.dataset.tagsGeneration) !== this.revision) { return; }
    if (event.key === "ArrowDown") { target = rows[Math.min(index + 1, rows.length - 1)]; }
    else if (event.key === "ArrowUp") { target = rows[Math.max(index - 1, 0)]; }
    else if (event.key === "Home") { target = rows[0]; }
    else if (event.key === "End") { target = rows.at(-1); }
    else if (node && event.key === "ArrowLeft") { if (node.children.some(child => child.visible) && !this.folded(node.key)) { this.run(() => this.toggle(node.key)); } else { target = rows.find(row => row.dataset.tagKey === node.parent?.key); } }
    else if (node && event.key === "ArrowRight") { if (node.children.some(child => child.visible) && this.folded(node.key)) { this.run(() => this.toggle(node.key)); } else { target = rows.find(row => row.dataset.tagKey === node.children.find(child => child.visible)?.key); } }
    else if (node && (event.key === "Enter" || event.key === " ")) { this.run(() => this.open(node.key, event.ctrlKey || event.metaKey)); }
    else { return; }
    event.preventDefault(); event.stopPropagation(); if (target) { this.focusKey = target.dataset.tagKey!; this.roving(); target.focus(); }
  }
}
