import { backlinkGroups, backlinkSorts, backlinkState, mentionContext, mentionKey, remapMentionKey, type BacklinkGroup, type MentionKind } from "./backlink-model";
import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { icon } from "./icons";
import { sourcePositions } from "./markdown";
import { TFile } from "./vault";
import { ItemView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

export class BacklinkPane extends ItemView {
  override icon = "links";
  private options = backlinkState({});
  private readonly sourceRoot: string | null;
  private readonly controls = document.createElement("div");
  private readonly follow = document.createElement("input");
  private readonly extra = document.createElement("input");
  private readonly unlinked = document.createElement("input");
  private readonly filter = document.createElement("input");
  private readonly sort = document.createElement("select");
  private readonly caption = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly resultsEl = document.createElement("div");
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private groups: BacklinkGroup[] = [];
  private sources = new Map<string, TFile>();
  private signature = "";
  private generation = 0;
  private navigationToken = 0;
  private queued = false;
  private message = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf); this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("backlink-workspace"); this.contentEl.dataset.backlinkPane = leaf.id; this.controls.className = "backlink-pane-controls";
    for (const [input, key, label] of [[this.follow, "followActiveFile", "Follow active note"], [this.extra, "extraContext", "Extra context"], [this.unlinked, "showUnlinked", "Unlinked mentions"]] as const) {
      const wrapper = document.createElement("label"); input.type = "checkbox"; input.dataset.backlinkOption = key; wrapper.append(input, label); this.controls.append(wrapper);
    }
    for (const [action, label, glyph] of [["filter", "Filter backlink results", "search"], ["collapse", "Collapse all results", "collapse"], ["expand", "Expand all results", "chevron-down"]]) {
      const button = document.createElement("button"); button.type = "button"; button.className = "clickable-icon"; button.dataset.backlinkAction = action; button.title = label; button.setAttribute("aria-label", label); button.append(icon(glyph)); this.buttons.set(action, button); this.controls.append(button);
    }
    this.filter.type = "search"; this.filter.maxLength = 1024; this.filter.placeholder = "Filter sources and contexts…"; this.filter.dataset.backlinkSearch = "true"; this.filter.setAttribute("aria-label", "Filter backlink sources and contexts");
    this.sort.dataset.backlinkSort = "true"; this.sort.setAttribute("aria-label", "Sort backlink sources");
    for (const [value, text] of Object.entries(backlinkSorts)) { const option = document.createElement("option"); option.value = value; option.textContent = text; this.sort.append(option); }
    this.caption.className = "backlink-pane-caption"; this.caption.dataset.backlinkFile = "true"; this.status.className = "discovery-status"; this.status.dataset.backlinkStatus = "true"; this.status.setAttribute("role", "status");
    this.resultsEl.className = "discovery-results"; this.resultsEl.tabIndex = 0; this.contentEl.append(this.controls, this.filter, this.sort, this.caption, this.resultsEl, this.status);
    this.registerDomEvent(this.controls, "change", event => this.run(() => {
      if (event.target === this.follow) { this.navigationToken++; this.options.followActiveFile = this.follow.checked; this.syncTarget(); }
      if (event.target === this.extra) { this.options.extraContext = this.extra.checked; }
      if (event.target === this.unlinked) { this.options.showUnlinked = this.unlinked.checked; }
      this.save(); this.refresh(true);
    }));
    this.registerDomEvent(this.controls, "click", event => { const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-backlink-action]") : null; if (target) { this.run(() => this.action(target.dataset.backlinkAction!)); } });
    this.registerDomEvent(this.filter, "input", () => this.run(() => { this.options.searchQuery = this.filter.value; this.save(); this.refresh(true); }));
    this.registerDomEvent(this.sort, "change", () => this.run(() => { this.options.sortOrder = backlinkState({ sortOrder: this.sort.value }).sortOrder; this.save(); this.refresh(true); }));
    this.registerDomEvent(this.resultsEl, "click", event => {
      if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) { return; }
      const target = event.target.closest<HTMLElement>("[data-backlink-section],[data-backlink-fold],[data-backlink-open]"); if (!target) { return; }
      const generation = Number(target.dataset.backlinkGeneration);
      this.run(() => {
        if (generation !== this.generation) { return; }
        if (target.dataset.backlinkSection) { const key = target.dataset.backlinkSection === "linked" ? "backlinkCollapsed" : "unlinkedCollapsed"; this.options[key] = !this.options[key]; this.save(); this.refresh(true); }
        else if (target.dataset.backlinkFold) { this.toggle(target.dataset.backlinkFold); }
        else { return this.open(target.dataset.backlinkOpen!, Number(target.dataset.backlinkFrom), Number(target.dataset.backlinkTo), generation, event.ctrlKey || event.metaKey); }
      });
    });
    this.registerEvent(this.app.metadataCache.on("finished", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || typeof oldPath !== "string" || !this.owned()) { return; }
      this.navigationToken++; if (this.options.file === oldPath) { this.options.file = file.path; }
      for (const key of ["foldedGroups", "expandedGroups"] as const) { this.options[key] = this.options[key].map(value => remapMentionKey(value, oldPath, file.path)); }
      this.save(); this.schedule();
    }));
    this.registerEvent(this.app.vault.on("delete", () => { this.navigationToken++; this.schedule(); }));
    this.registerEvent(this.app.core.on("changed", () => { this.updateControls(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-ready", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-change", () => { if (this.follow.disabled === this.interactive()) { this.updateControls(); this.schedule(); } }));
    this.register(() => { this.navigationToken++; this.generation++; this.groups = []; this.sources.clear(); });
  }

  getViewType(): string { return "backlink"; }
  getDisplayText(): string { return "Backlinks"; }
  get file(): TFile | null { return this.app.vault.getFileByPath(this.options.file); }
  setFile(file: TFile): void {
    if (!this.interactive() || !(file instanceof TFile) || this.app.vault.getFileByPath(file.path) !== file) { throw new Error("Set a live Backlinks pane to a file in the selected vault after current operations finish."); }
    this.navigationToken++; this.options.followActiveFile = false; this.target(file.path); this.save(); this.refresh(true);
  }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options, foldedGroups: [...this.options.foldedGroups], expandedGroups: [...this.options.expandedGroups] }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = backlinkState(state); await super.setState(state, result);
    this.navigationToken++; this.options = options; this.signature = ""; this.updateControls(); this.schedule();
  }
  protected override async onOpen(): Promise<void> { this.syncTarget(); this.updateControls(); this.schedule(); }
  override focus(): void { (this.options.showSearch ? this.filter : this.resultsEl).focus(); }
  private owned(): boolean { return this.isLoaded && Boolean(this.sourceRoot) && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean { return this.owned() && !this.app.changingVault && !this.app.core.busy && this.app.core.isEnabled("backlink") && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout; }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    Promise.resolve().then(() => { if (this.interactive()) { this.message = ""; return action(); } }).catch(error => { if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); } reportError(error); });
  }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private schedule(): void { if (this.queued) { return; } this.queued = true; queueMicrotask(() => { this.queued = false; if (this.owned()) { try { this.refresh(); } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); reportError(error); } } }); }
  private target(path: string): void { if (path !== this.options.file) { this.options.file = path; this.options.foldedGroups = []; this.options.expandedGroups = []; this.message = ""; this.signature = ""; } }
  private syncTarget(): void { if (!this.owned() || !this.options.followActiveFile) { return; } const file = this.app.workspace.getActiveFile(); if (file && file.path !== this.options.file) { this.target(file.path); this.save(); } }
  private updateControls(): void {
    const enabled = this.interactive(); for (const input of [this.follow, this.extra, this.unlinked, this.filter, this.sort]) { input.disabled = !enabled; }
    this.follow.checked = this.options.followActiveFile; this.extra.checked = this.options.extraContext; this.unlinked.checked = this.options.showUnlinked; this.filter.hidden = !this.options.showSearch; this.filter.value = this.options.searchQuery; this.sort.value = this.options.sortOrder;
    this.buttons.get("filter")!.setAttribute("aria-pressed", String(this.options.showSearch)); for (const button of this.buttons.values()) { button.disabled = !enabled; }
    this.resultsEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = !enabled; }); this.caption.textContent = this.options.file || "No note selected";
  }
  private refresh(force = false): void {
    this.syncTarget(); this.updateControls(); if (!this.interactive()) { return; }
    const file = this.file;
    if (!file) { this.generation++; this.groups = []; this.sources.clear(); this.resultsEl.replaceChildren(); this.signature = ""; this.status.textContent = this.options.file ? "The target file is missing or unavailable: " + this.options.file : "Open a note to see its backlinks."; return; }
    const documents = this.app.metadataCache.getDocuments().map(entry => ({ path: entry.document.file.path, text: entry.text, cache: entry.cache, outgoing: entry.outgoing, mtime: entry.document.file.stat.mtime, ctime: entry.document.file.stat.ctime }));
    const groups = backlinkGroups(documents, { path: file.path, basename: file.basename, cache: this.app.metadataCache.getFileCache(file) }, this.options), signature = JSON.stringify([file.path, this.options, groups]);
    if (!force && signature === this.signature) { return; }
    this.signature = signature; this.groups = groups; this.sources = new Map(groups.flatMap(group => { const source = this.app.vault.getFileByPath(group.path); return source ? [[group.path, source] as const] : []; })); this.generation++; this.render();
  }
  private action(action: string): void {
    if (action === "filter") { this.options.showSearch = !this.options.showSearch; if (!this.options.showSearch) { this.options.searchQuery = ""; } }
    if (action === "collapse" || action === "expand") { this.options.collapseAll = action === "collapse"; this.options.foldedGroups = []; this.options.expandedGroups = []; }
    this.save(); this.refresh(true); if (action === "filter" && this.options.showSearch) { this.filter.focus(); }
  }
  private folded(key: string): boolean { return this.options.collapseAll ? !this.options.expandedGroups.includes(key) : this.options.foldedGroups.includes(key); }
  private toggle(key: string): void {
    const name = this.options.collapseAll ? "expandedGroups" : "foldedGroups", groups = new Set(this.options[name]);
    if (!groups.has(key) && groups.size >= 4096) { this.status.textContent = "Expand all results before storing more than 4,096 fold exceptions."; return; }
    groups.has(key) ? groups.delete(key) : groups.add(key); this.options[name] = [...groups]; this.save(); this.refresh(true);
    this.resultsEl.querySelector<HTMLElement>(`[data-backlink-fold="${CSS.escape(key)}"]`)?.focus();
  }
  private stale(): void { this.message = "Source text changed; backlink results have been refreshed."; this.app.metadataCache.updateOpenDocuments(); this.refresh(true); }
  private async open(path: string, from: number, to: number, generation: number, tab: boolean): Promise<void> {
    const group = this.groups.find(group => group.path === path), file = this.sources.get(path);
    if (!group || !file || generation !== this.generation || this.app.vault.getFileByPath(path) !== file || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > group.text.length) { this.refresh(true); return; }
    const peer = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).find(view => view instanceof MarkdownView && view.file === file);
    if (this.app.metadataCache.getDocument(path)?.text !== group.text || peer instanceof MarkdownView && peer.editor.getValue() !== group.text) { this.stale(); return; }
    const operation = ++this.navigationToken, leaf = this.app.workspace.getLeaf(tab ? "tab" : false); await leaf.openFile(file);
    if (!this.interactive() || operation !== this.navigationToken || this.app.workspace.activeLeaf !== leaf || !(leaf.view instanceof MarkdownView) || leaf.view.file !== file) { return; }
    if (leaf.view.editor.getValue() !== group.text) { this.stale(); return; }
    leaf.view.setMode("source"); const position = sourcePositions(group.text)(from, to); leaf.view.editor.setSelection(position.start, position.end); leaf.view.editor.scrollIntoView({ from: position.start, to: position.end }, true); leaf.view.focus();
  }
  private button(text: string, data: Record<string, string>): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.dataset.backlinkGeneration = String(this.generation); Object.assign(button.dataset, data); return button; }
  private render(): void {
    const fragment = document.createDocumentFragment(); let displayedFiles = 0, contexts = 0; const counts: Record<MentionKind, number> = { linked: 0, unlinked: 0 };
    for (const kind of ["linked", "unlinked"] as const) {
      if (kind === "unlinked" && !this.options.showUnlinked) { continue; }
      const closed = kind === "linked" ? this.options.backlinkCollapsed : this.options.unlinkedCollapsed, section = document.createElement("section"); section.dataset.backlinkKind = kind;
      const matching = this.groups.filter(group => group[kind].length); counts[kind] = matching.reduce((sum, group) => sum + group[kind].length, 0);
      const label = kind === "linked" ? "Linked mentions" : "Unlinked mentions", title = this.button(label + (kind === "unlinked" && closed ? "" : ` (${counts[kind]})`), { backlinkSection: kind }); title.className = "backlink-section-title"; title.setAttribute("aria-expanded", String(!closed)); section.append(title);
      const content = document.createElement("div"); content.hidden = closed; section.append(content);
      if (!closed) {
        for (const group of matching.slice(0, 200)) {
          displayedFiles++; const article = document.createElement("article"), key = mentionKey(kind, group.path); article.className = "discovery-result-group"; article.dataset.backlinkGroup = key; article.dataset.backlinkPath = group.path;
          const heading = document.createElement("div"); heading.className = "backlink-result-heading";
          const fold = this.button("", { backlinkFold: key }); fold.className = "clickable-icon"; fold.setAttribute("aria-expanded", String(!this.folded(key))); fold.setAttribute("aria-label", (this.folded(key) ? "Expand " : "Collapse ") + group.path); fold.append(icon(this.folded(key) ? "chevron-right" : "chevron-down"));
          const first = group[kind][0], title = this.button(group.path, { backlinkOpen: group.path, backlinkFrom: String(first.from), backlinkTo: String(first.to) }); title.className = "discovery-result-title"; heading.append(fold, title); article.append(heading);
          const details = document.createElement("div"); details.hidden = this.folded(key); details.className = "backlink-group-contexts";
          const positions = sourcePositions(group.text);
          for (const range of group[kind].slice(0, Math.max(0, 1000 - contexts))) {
            const button = this.button("", { backlinkOpen: group.path, backlinkFrom: String(range.from), backlinkTo: String(range.to), backlinkMatch: `${range.from}:${range.to}` }); button.className = "discovery-context";
            const context = mentionContext(group.text, range, this.options.extraContext), mark = document.createElement("mark"); mark.textContent = group.text.slice(range.from, range.to);
            button.append(document.createTextNode(group.text.slice(context.from, range.from)), mark, document.createTextNode(group.text.slice(range.to, context.to))); button.title = `${group.path} - line ${positions(range.from, range.to).start.line + 1}`; details.append(button); contexts++;
          }
          article.append(details); content.append(article);
        }
        if (!matching.length) { const empty = document.createElement("p"); empty.className = "empty-outline"; empty.textContent = "No " + kind + " mentions in the current results."; content.append(empty); }
      }
      fragment.append(section);
    }
    this.resultsEl.replaceChildren(fragment); this.resultsEl.tabIndex = 0;
    this.status.textContent = this.message || `${counts.linked} visible linked mentions` + (this.options.showUnlinked && !this.options.unlinkedCollapsed ? `, ${counts.unlinked} unlinked` : "") + (displayedFiles >= 200 || contexts >= 1000 ? ". Showing up to 200 sources per section and 1,000 contexts; narrow the filter." : ".") + (this.app.vault.lazy ? " Results cover currently indexed notes." : ""); this.updateControls();
  }
}
