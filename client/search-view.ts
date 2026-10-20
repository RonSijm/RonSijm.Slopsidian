import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { icon } from "./icons";
import { sourcePositions, type SourceRange } from "./markdown";
import type { IndexedDocument } from "./metadata";
import { searchPaneState, searchSorts, sortedSearchResults, type SearchPaneState } from "./search-pane-model";
import { SearchTask } from "./search-task";
import type { SearchResult } from "./search";
import { TFile } from "./vault";
import { ItemView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

export class SearchView extends ItemView {
  override icon = "search";
  readonly inputEl = document.createElement("input");
  private options: SearchPaneState = searchPaneState({});
  private readonly sourceRoot: string | null;
  private readonly task = new SearchTask();
  private readonly controls = document.createElement("div");
  private readonly checks = new Map<string, HTMLInputElement>();
  private readonly sort = document.createElement("select");
  private readonly fold = document.createElement("button");
  private readonly explanation = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly resultsEl = document.createElement("div");
  private results: SearchResult[] = [];
  private documents = new Map<string, { text: string; file: TFile; stat: TFile["stat"] }>();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private queued = false;
  private searching = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf); this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("search-workspace"); this.contentEl.dataset.searchPane = leaf.id;
    this.inputEl.type = "search"; this.inputEl.maxLength = 16384; this.inputEl.placeholder = "Search notes…";
    this.inputEl.dataset.searchQuery = "true"; this.inputEl.setAttribute("aria-label", "Search in all files");
    this.controls.className = "discovery-controls";
    for (const [key, text] of [["matchingCase", "Match case"], ["extraContext", "Extra context"], ["explainSearch", "Search syntax"]] as const) {
      const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.dataset.searchOption = key;
      label.append(input, text); this.checks.set(key, input); this.controls.append(label);
    }
    this.fold.type = "button"; this.fold.dataset.searchCollapseAll = "true"; this.fold.append(icon("collapse")); this.fold.className = "clickable-icon";
    this.controls.append(this.fold); this.sort.dataset.searchSort = "true"; this.sort.setAttribute("aria-label", "Sort search results");
    for (const [value, text] of Object.entries(searchSorts)) { const option = document.createElement("option"); option.value = value; option.textContent = text; this.sort.append(option); }
    this.explanation.className = "search-syntax";
    this.explanation.textContent = 'Combine terms with AND, OR, NOT or parentheses. Use path:, file:, tag:, [property:value], "phrases" or /regular expressions/. Searches use indexed notes, including current unsaved text.';
    this.status.className = "discovery-status"; this.status.dataset.searchStatus = "true"; this.status.setAttribute("role", "status");
    this.resultsEl.className = "discovery-results"; this.resultsEl.dataset.searchResults = "true";
    this.contentEl.append(this.inputEl, this.controls, this.sort, this.explanation, this.status, this.resultsEl);
    this.registerDomEvent(this.inputEl, "input", () => this.run(() => { this.options.query = this.inputEl.value; this.save(); this.schedule(150); }));
    this.registerDomEvent(this.inputEl, "keydown", event => { if (event instanceof KeyboardEvent && event.key === "Enter" && !event.isComposing) { event.preventDefault(); this.run(() => this.refresh()); } });
    this.registerDomEvent(this.controls, "change", event => this.run(() => {
      const input = event.target; if (!(input instanceof HTMLInputElement)) { return; }
      const key = input.dataset.searchOption;
      if (key !== "matchingCase" && key !== "extraContext" && key !== "explainSearch") { return; }
      this.options[key] = input.checked; this.save();
      if (key === "matchingCase") { this.refresh(); } else { this.updateControls(); this.renderResults(); }
    }));
    this.registerDomEvent(this.fold, "click", () => this.run(() => {
      this.options.collapseAll = !this.options.collapseAll; this.options.collapsedFiles = []; this.options.expandedFiles = [];
      this.save(); this.updateControls(); this.renderResults();
    }));
    this.registerDomEvent(this.sort, "change", () => this.run(() => { this.options.sortOrder = searchPaneState({ sortOrder: this.sort.value }).sortOrder; this.save(); this.renderResults(); }));
    this.registerDomEvent(this.resultsEl, "click", event => {
      if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) { return; }
      const fold = event.target.closest<HTMLElement>("[data-search-fold]");
      if (fold) { this.run(() => this.toggle(fold.dataset.searchFold!)); return; }
      const target = event.target.closest<HTMLElement>("[data-search-open]");
      if (target) { this.run(() => this.open(target.dataset.searchOpen!, Number(target.dataset.searchFrom), Number(target.dataset.searchTo), event.ctrlKey || event.metaKey)); }
    });
    this.registerEvent(this.app.metadataCache.on("finished", () => this.schedule(150)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && typeof oldPath === "string" && this.owned()) {
        for (const key of ["collapsedFiles", "expandedFiles"] as const) { this.options[key] = this.options[key].map(path => path === oldPath ? file.path : path); }
        this.save();
      }
    }));
    this.registerEvent(this.app.core.on("changed", () => { this.updateControls(); this.schedule(0); }));
    this.registerEvent(this.app.workspace.on("layout-ready", () => this.schedule(0)));
    this.registerEvent(this.app.workspace.on("layout-change", () => { if (this.inputEl.disabled === this.interactive()) { this.updateControls(); this.schedule(0); } }));
    this.register(() => { this.cancel(); this.documents.clear(); this.results = []; });
  }

  getViewType(): string { return "search"; }
  getDisplayText(): string { return "Search"; }
  getQuery(): string { return this.options.query; }
  setQuery(query: string): void {
    const options = searchPaneState({ ...this.options, query });
    if (!this.interactive()) { throw new Error("Set a query on a live Search pane after vault/core operations finish."); }
    this.options = options; this.inputEl.value = query; this.save(); this.refresh();
  }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options, collapsedFiles: [...this.options.collapsedFiles], expandedFiles: [...this.options.expandedFiles] }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = searchPaneState(state); await super.setState(state, result);
    this.cancel(); this.options = options; this.inputEl.value = options.query; this.updateControls(); this.schedule(0);
  }
  protected override async onOpen(): Promise<void> { this.updateControls(); this.schedule(0); }
  override focus(): void { this.inputEl.focus(); }

  private owned(): boolean { return this.isLoaded && Boolean(this.sourceRoot) && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean { return this.owned() && !this.app.changingVault && !this.app.core.busy && this.app.core.isEnabled("global-search") && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout; }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    Promise.resolve().then(() => { if (this.interactive()) { return action(); } }).catch(error => { if (this.owned()) { this.finish(error instanceof Error ? error.message : String(error), true); } reportError(error); });
  }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private cancel(): void { this.task.cancel(); if (this.debounce !== null) { clearTimeout(this.debounce); this.debounce = null; } }
  private schedule(delay: number): void {
    this.cancel();
    if (this.owned() && this.options.query.trim()) { this.searching = true; this.results = []; this.documents.clear(); this.resultsEl.replaceChildren(); this.status.textContent = "Searching…"; this.status.dataset.searchComplete = "false"; delete this.status.dataset.completedQuery; }
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => {
      this.queued = false; if (!this.owned()) { return; } this.updateControls();
      if (this.interactive()) { this.debounce = setTimeout(() => { this.debounce = null; this.refresh(); }, delay); }
    });
  }
  private updateControls(): void {
    const enabled = this.interactive(); this.inputEl.disabled = !enabled; this.sort.disabled = !enabled; this.fold.disabled = !enabled;
    this.sort.value = this.options.sortOrder; this.explanation.hidden = !this.options.explainSearch;
    this.fold.title = this.options.collapseAll ? "Expand all results" : "Collapse all results"; this.fold.setAttribute("aria-label", this.fold.title); this.fold.setAttribute("aria-pressed", String(this.options.collapseAll));
    for (const [key, input] of this.checks) { input.disabled = !enabled; input.checked = this.options[key as "matchingCase" | "explainSearch" | "extraContext"]; }
    this.resultsEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = !enabled; });
  }
  private finish(text: string, error = false): void {
    this.status.textContent = text; this.status.classList.toggle("is-error", error); this.status.dataset.searchComplete = "true"; this.status.dataset.completedQuery = this.options.query;
  }
  private refresh(): void {
    this.cancel(); if (!this.interactive()) { return; }
    this.results = []; this.documents.clear(); this.resultsEl.replaceChildren(); this.status.classList.remove("is-error");
    this.status.dataset.searchComplete = "false"; delete this.status.dataset.completedQuery;
    const query = this.options.query;
    this.searching = Boolean(query.trim());
    if (!query.trim()) { this.finish("Type a query to search this vault."); return; }
    this.status.textContent = "Searching…";
    const entries: IndexedDocument[] = this.app.metadataCache.getDocuments();
    for (const entry of entries) {
      const file = this.app.vault.getFileByPath(entry.document.file.path); if (file) { this.documents.set(file.path, { text: entry.text, file, stat: { ...file.stat } }); }
    }
    this.task.run({ query, options: { matchCase: this.options.matchingCase }, documents: entries.map(entry => ({ path: entry.document.file.path, text: entry.text, cache: entry.cache })) },
      () => this.interactive() && this.options.query === query,
      results => { this.searching = false; this.results = results; this.renderResults(); }, error => { this.searching = false; this.finish(error, true); });
  }
  private folded(path: string): boolean { return this.options.collapseAll ? !this.options.expandedFiles.includes(path) : this.options.collapsedFiles.includes(path); }
  private toggle(path: string): void {
    const key = this.options.collapseAll ? "expandedFiles" : "collapsedFiles", paths = new Set(this.options[key]);
    if (!paths.has(path) && paths.size >= 4096) { this.finish("Clear result folds before storing more than 4,096 exceptions."); return; }
    paths.has(path) ? paths.delete(path) : paths.add(path); this.options[key] = [...paths]; this.save();
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.searchFold : null;
    this.renderResults(); if (focus) { this.resultsEl.querySelector<HTMLElement>(`[data-search-fold="${CSS.escape(focus)}"]`)?.focus(); }
  }
  private async open(path: string, from: number, to: number, tab: boolean): Promise<void> {
    const entry = this.documents.get(path), file = this.app.vault.getFileByPath(path);
    if (!entry || file !== entry.file || this.app.metadataCache.getDocument(path)?.text !== entry.text || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > entry.text.length) {
      this.schedule(0); return;
    }
    const leaf = this.app.workspace.getLeaf(tab ? "tab" : false); await leaf.openFile(file);
    if (!this.owned() || this.app.changingVault || !(leaf.view instanceof MarkdownView) || leaf.view.file !== file) { return; }
    const view = leaf.view as MarkdownView;
    if (view.editor.getValue() !== entry.text) { this.schedule(0); return; }
    view.setMode("source"); const position = sourcePositions(entry.text)(from, to);
    view.editor.setSelection(position.start, position.end); view.editor.scrollIntoView({ from: position.start, to: position.end }, true); view.focus();
  }
  private renderResults(): void {
    if (this.searching || this.status.classList.contains("is-error")) { this.updateControls(); return; }
    const fragment = document.createDocumentFragment(), sorted = sortedSearchResults(this.results, this.options.sortOrder, path => this.documents.get(path)?.stat);
    let contexts = 0;
    for (const result of sorted.slice(0, 200)) {
      const entry = this.documents.get(result.path); if (!entry) { continue; } const position = sourcePositions(entry.text);
      const group = document.createElement("article"); group.className = "discovery-result-group"; group.dataset.searchFile = result.path;
      const heading = document.createElement("div"); heading.className = "search-result-heading";
      const folded = this.folded(result.path), fold = document.createElement("button"); fold.type = "button"; fold.dataset.searchFold = result.path; fold.className = "clickable-icon";
      fold.setAttribute("aria-label", (folded ? "Expand " : "Collapse ") + result.path); fold.setAttribute("aria-expanded", String(!folded)); fold.append(icon(folded ? "chevron-right" : "chevron-down"));
      const first = result.matches[0] ?? { from: 0, to: 0 }, title = this.openButton(result.path, first); title.className = "discovery-result-title"; title.textContent = result.path;
      heading.append(fold, title); group.append(heading); const content = document.createElement("div"); content.hidden = folded; content.className = "search-result-contexts";
      if (!result.matches.length) { const note = document.createElement("p"); note.textContent = "Matched file path or properties."; content.append(note); }
      for (const range of result.matches.slice(0, Math.max(0, 1000 - contexts))) {
        const button = this.openButton(result.path, range); button.className = "discovery-context"; button.dataset.searchMatch = `${range.from}:${range.to}`;
        let start = Math.max(entry.text.lastIndexOf("\n", Math.max(0, range.from - 1)) + 1, range.from - 100), end = entry.text.indexOf("\n", range.to);
        end = Math.min(end < 0 ? entry.text.length : end, range.to + 140);
        if (this.options.extraContext) { start = Math.max(entry.text.lastIndexOf("\n", Math.max(0, start - 2)) + 1, range.from - 500); const next = entry.text.indexOf("\n", end + 1); end = Math.min(next < 0 ? entry.text.length : next, range.to + 500); }
        const mark = document.createElement("mark"); mark.textContent = entry.text.slice(range.from, range.to);
        button.append(document.createTextNode(entry.text.slice(start, range.from)), mark, document.createTextNode(entry.text.slice(range.to, end)));
        button.title = `${result.path} - line ${position(range.from, range.to).start.line + 1}`; content.append(button); contexts++;
      }
      group.append(content); fragment.append(group);
    }
    this.resultsEl.replaceChildren(fragment); this.updateControls();
    this.finish(`${this.results.length} matching file${this.results.length === 1 ? "" : "s"}` + (this.results.length > 200 || contexts >= 1000 ? ". Showing up to 200 files and 1,000 contexts; narrow the query for more." : ".") + (this.app.vault.lazy ? " Searches cover currently indexed notes." : ""));
  }
  private openButton(path: string, range: SourceRange): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.dataset.searchOpen = path; button.dataset.searchFrom = String(range.from); button.dataset.searchTo = String(range.to); return button;
  }
}
