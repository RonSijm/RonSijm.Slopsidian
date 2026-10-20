import type { App, Command } from "./app";
import type { CorePlugins } from "./core-plugins";
import { element, reportError } from "./dom";
import { icon, iconButton } from "./icons";
import { outgoingMentions, sourcePositions, type Pos, type SourceRange } from "./markdown";
import type { IndexedDocument } from "./metadata";
import type { SearchRequest, SearchResponse, SearchResult } from "./search";
import { TFile } from "./vault";
import { MarkdownView } from "./workspace";

function textOption(state: Record<string, unknown>, key: string, fallback = ""): string {
  const value = state[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`Saved discovery option must be text: ${key}`);
  }
  return value;
}

function boolOption(state: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = state[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Saved discovery option must be a boolean: ${key}`);
  }
  return value;
}

function listOption(state: Record<string, unknown>, key: string): string[] {
  const value = state[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some(entry => typeof entry !== "string")) {
    throw new Error(`Saved discovery option must be a list of text: ${key}`);
  }
  return value;
}

function message(parent: HTMLElement, text: string): void {
  const node = document.createElement("p");
  node.className = "empty-outline";
  node.textContent = text;
  parent.append(node);
}

function checkbox(parent: HTMLElement, label: string, value: boolean, change: (value: boolean) => void): HTMLInputElement {
  const wrapper = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => change(input.checked));
  wrapper.append(input, document.createTextNode(label));
  parent.append(wrapper);
  return input;
}

async function reveal(app: App, path: string, position: Pos): Promise<void> {
  await app.openFile(path);
  app.markdownView.setMode("source");
  app.editor.setSelection(position.start, position.end);
  app.editor.scrollIntoView({ from: position.start, to: position.end }, true);
  app.editor.focus();
}

abstract class DiscoverySidebar {
  protected panel: HTMLElement | null = null;
  private queued = false;
  protected generation = 0;

  constructor(readonly app: App, readonly id: string, readonly viewType: string, readonly title: string, private readonly side: "left" | "right", private readonly symbol: string) {}

  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }
  getViewType(): string { return this.viewType; }
  getDisplayText(): string { return this.title; }

  register(core: CorePlugins): void {
    core.register(this.id, () => this.activate(), this);
  }

  initLeaf(): void {
    if (!this.app.core.isEnabled(this.id)) {
      throw new Error(`Enable ${this.title} before opening its view.`);
    }
    this.app.sidebars.show(this.viewType);
  }

  protected commands(): Command[] {
    return [{ id: `${this.id}:open`, name: `Show ${this.title.toLowerCase()}`, callback: () => this.app.core.run(() => this.initLeaf()) }];
  }

  protected abstract build(state: Record<string, unknown>): void;
  protected abstract refresh(): void;
  protected close(): void {}
  protected renamed(_file: TFile, _oldPath: string): void {}
  protected deleted(_file: TFile): void {}
  protected watchSettings(): boolean { return false; }

  protected persist(state: Record<string, unknown>): void {
    this.app.workspace.setViewOptions(this.viewType, state);
  }

  protected update = (): void => {
    if (this.queued) {
      return;
    }
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.panel) {
        this.refresh();
      }
    });
  };

  private activate(): () => void {
    const panel = document.createElement("section");
    panel.className = "core-discovery-pane";
    panel.dataset.discoveryView = this.viewType;
    this.panel = panel;
    this.build(this.app.workspace.getViewOptions(this.viewType));
    const commands = this.app.commands.install(this.commands());
    const view = this.app.sidebars.register(this.viewType, this.title, this.side, panel, icon(this.symbol));
    const refs = [
      this.app.metadataCache.on("finished", this.update),
      this.app.workspace.on("file-open", this.update),
      this.app.vault.on("rename", (file, oldPath) => { if (file instanceof TFile && typeof oldPath === "string") { this.renamed(file, oldPath); this.update(); } }),
      this.app.vault.on("delete", file => { if (file instanceof TFile) { this.deleted(file); this.update(); } }),
    ];
    if (this.watchSettings()) {
      refs.push(this.app.core.on("changed", this.update), this.app.workspace.on("layout-change", this.update));
    }
    this.refresh();
    return () => {
      this.generation++;
      refs.forEach(ref => ref.emitter.offref(ref));
      this.close();
      view();
      commands();
      this.panel = null;
    };
  }
}

export class GlobalSearch extends DiscoverySidebar {
  private input!: HTMLInputElement;
  private status!: HTMLElement;
  private resultsEl!: HTMLElement;
  private matchCase = false;
  private collapsed = new Set<string>();
  private results: SearchResult[] = [];
  private worker: Worker | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private serial = 0;

  constructor(app: App) { super(app, "global-search", "search", "Search", "left", "search"); }

  getGlobalSearchQuery(): string { return this.input?.value ?? ""; }

  openGlobalSearch(query?: string | null): void {
    this.initLeaf();
    if (query !== undefined && query !== null) {
      this.input.value = query;
      this.save();
      this.refresh();
    }
    this.input.focus();
    this.input.select();
  }

  protected commands(): Command[] {
    return [{
      id: "global-search:open", name: "Search in all files",
      callback: () => this.app.core.run(() => {
        const selected = this.app.workspace.activeEditor?.editor.getSelection();
        this.openGlobalSearch(selected ? JSON.stringify(selected) : undefined);
      }),
    }];
  }

  protected build(state: Record<string, unknown>): void {
    this.matchCase = boolOption(state, "matchCase");
    this.collapsed = new Set(listOption(state, "collapsedFiles"));
    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.placeholder = "Search notes...";
    this.input.setAttribute("aria-label", "Search in all files");
    this.input.dataset.searchQuery = "true";
    this.input.value = textOption(state, "query");
    this.input.addEventListener("input", () => {
      this.save();
      this.cancel();
      this.debounce = setTimeout(() => { this.debounce = null; this.refresh(); }, 150);
    });
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.refresh();
      }
    });
    const controls = document.createElement("div");
    controls.className = "discovery-controls";
    checkbox(controls, "Match case", this.matchCase, value => { this.matchCase = value; this.save(); this.refresh(); }).dataset.searchMatchCase = "true";
    this.status = document.createElement("div");
    this.status.className = "discovery-status";
    this.status.setAttribute("role", "status");
    this.status.dataset.searchStatus = "true";
    this.resultsEl = document.createElement("div");
    this.resultsEl.className = "discovery-results";
    this.panel!.append(this.input, controls, this.status, this.resultsEl);
  }

  private save(): void {
    this.persist({ query: this.input.value, matchCase: this.matchCase, collapsedFiles: [...this.collapsed] });
  }

  private cancel(): void {
    this.serial++;
    this.worker?.terminate();
    this.worker = null;
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.debounce !== null) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  protected close(): void { this.cancel(); this.results = []; }

  protected refresh(): void {
    this.cancel();
    const query = this.input.value;
    this.results = [];
    this.resultsEl.replaceChildren();
    this.status.classList.remove("is-error");
    this.status.dataset.searchComplete = "false";
    delete this.status.dataset.completedQuery;
    if (!query.trim()) {
      this.status.textContent = "Type a query to search this vault.";
      this.status.dataset.searchComplete = "true";
      this.status.dataset.completedQuery = query;
      return;
    }
    this.status.textContent = "Searching...";
    const id = this.serial;
    const root = this.app.vault.rootPath;
    const failure = (message: string): void => {
      if (id !== this.serial || root !== this.app.vault.rootPath || !this.panel) {
        return;
      }
      this.cancel();
      this.status.textContent = message;
      this.status.classList.add("is-error");
      this.status.dataset.searchComplete = "true";
      this.status.dataset.completedQuery = query;
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL("js/search-worker.js", document.baseURI), { type: "module" });
    } catch (error) {
      failure("Search engine could not start: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
    this.worker = worker;
    this.timeout = setTimeout(() => failure("Search engine did not become ready within ten seconds. Retry the query."), 10000);
    worker.onerror = event => { event.preventDefault(); failure("Search engine failed: " + event.message); };
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      if (id !== this.serial || root !== this.app.vault.rootPath || !this.panel) {
        return;
      }
      if ("ready" in event.data) {
        if (this.timeout !== null) { clearTimeout(this.timeout); }
        this.timeout = setTimeout(() => failure("Search exceeded the two-second limit. Simplify the query."), 2000);
        try {
          worker.postMessage(request);
        } catch (error) {
          failure("Search engine could not accept the query: " + (error instanceof Error ? error.message : String(error)));
        }
        return;
      }
      if (event.data.id !== id) {
        return;
      }
      if (event.data.error !== undefined) {
        failure(event.data.error);
        return;
      }
      if (!event.data.results) {
        failure("The search engine returned no results collection.");
        return;
      }
      const results = event.data.results;
      this.cancel();
      this.results = results;
      this.renderResults();
    };
    const request: SearchRequest = {
      id, query, options: { matchCase: this.matchCase },
      documents: this.app.metadataCache.getDocuments().map(entry => ({ path: entry.document.file.path, text: entry.text, cache: entry.cache })),
    };
  }

  private renderResults(): void {
    this.status.textContent = `${this.results.length} matching file${this.results.length === 1 ? "" : "s"}`;
    this.status.dataset.searchComplete = "true";
    this.status.dataset.completedQuery = this.input.value;
    this.resultsEl.replaceChildren();
    for (const result of this.results) {
      const entry = this.app.metadataCache.getDocument(result.path);
      if (!entry) {
        continue;
      }
      const group = document.createElement("article");
      group.className = "discovery-result-group";
      group.dataset.searchFile = result.path;
      const title = document.createElement("button");
      title.className = "discovery-result-title";
      title.textContent = result.path;
      const position = sourcePositions(entry.text);
      const first = result.matches[0] ?? { from: 0, to: 0 };
      title.addEventListener("click", () => this.app.core.run(() => reveal(this.app, result.path, position(first.from, first.to))).catch(reportError));
      group.append(title);
      const details = document.createElement("details");
      details.open = !this.collapsed.has(result.path);
      const summary = document.createElement("summary");
      summary.textContent = `${result.matches.length} matching context${result.matches.length === 1 ? "" : "s"}`;
      summary.addEventListener("click", event => {
        event.preventDefault();
        details.open = !details.open;
        if (details.open) {
          this.collapsed.delete(result.path);
        } else {
          this.collapsed.add(result.path);
        }
        this.save();
      });
      details.append(summary);
      for (const range of result.matches) {
        const button = contextButton(entry.text, range, result.path);
        button.dataset.searchMatch = `${range.from}:${range.to}`;
        button.addEventListener("click", () => this.app.core.run(() => reveal(this.app, result.path, position(range.from, range.to))).catch(reportError));
        details.append(button);
      }
      group.append(details);
      this.resultsEl.append(group);
    }
  }
}

function contextButton(text: string, range: SourceRange, path: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "discovery-context";
  const start = Math.max(text.lastIndexOf("\n", Math.max(0, range.from - 1)) + 1, range.from - 100);
  const ending = text.indexOf("\n", range.to);
  const end = Math.min(ending < 0 ? text.length : ending, range.to + 140);
  const before = document.createTextNode(text.slice(start, range.from));
  const highlight = document.createElement("mark");
  highlight.textContent = text.slice(range.from, range.to);
  button.append(before, highlight, document.createTextNode(text.slice(range.to, end)));
  button.title = `${path} - line ${sourcePositions(text)(range.from, range.to).start.line + 1}`;
  return button;
}

export class TagsView extends DiscoverySidebar {
  private results!: HTMLElement;
  private filter!: HTMLInputElement;
  private hierarchy = true;
  private sortOrder = "frequency";
  private folded = new Set<string>();

  constructor(app: App, private readonly search: GlobalSearch) { super(app, "tag-pane", "tag", "Tags", "right", "tag"); }

  protected build(state: Record<string, unknown>): void {
    this.hierarchy = boolOption(state, "useHierarchy", true);
    this.sortOrder = textOption(state, "sortOrder", "frequency");
    if (!["frequency", "frequencyReverse", "alphabetical", "alphabeticalReverse"].includes(this.sortOrder)) {
      throw new Error("Unknown saved tag sort order: " + this.sortOrder);
    }
    this.folded = new Set(listOption(state, "folded"));
    const controls = document.createElement("div");
    controls.className = "discovery-controls";
    checkbox(controls, "Nested tags", this.hierarchy, value => { this.hierarchy = value; this.save(); this.refresh(); }).dataset.tagsHierarchy = "true";
    const sort = document.createElement("select");
    sort.setAttribute("aria-label", "Sort tags");
    sort.dataset.tagsSort = "true";
    for (const [value, label] of [["frequency", "Most used"], ["frequencyReverse", "Least used"], ["alphabetical", "A to Z"], ["alphabeticalReverse", "Z to A"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      sort.append(option);
    }
    sort.value = this.sortOrder;
    sort.addEventListener("change", () => { this.sortOrder = sort.value; this.save(); this.refresh(); });
    this.filter = document.createElement("input");
    this.filter.type = "search";
    this.filter.placeholder = "Filter tags...";
    this.filter.setAttribute("aria-label", "Filter tags");
    this.filter.value = textOption(state, "filter");
    this.filter.addEventListener("input", () => { this.save(); this.refresh(); });
    this.results = document.createElement("div");
    this.results.className = "discovery-results";
    this.panel!.append(controls, sort, this.filter, this.results);
  }

  private save(): void {
    this.persist({ useHierarchy: this.hierarchy, sortOrder: this.sortOrder, folded: [...this.folded], filter: this.filter.value });
  }

  protected refresh(): void {
    this.results.replaceChildren();
    const tags = Object.entries(this.app.metadataCache.getTags());
    const compare = (left: [string, number], right: [string, number]): number => {
      const name = left[0].localeCompare(right[0]);
      if (this.sortOrder === "alphabetical") { return name; }
      if (this.sortOrder === "alphabeticalReverse") { return -name; }
      return (this.sortOrder === "frequency" ? right[1] - left[1] : left[1] - right[1]) || name;
    };
    const query = this.filter.value.toLocaleLowerCase();
    const append = (parent: string | null, depth: number): void => {
      for (const [tag, count] of tags.filter(([tag]) => !this.hierarchy || (tag.includes("/") ? tag.slice(0, tag.lastIndexOf("/")) : null) === parent).sort(compare)) {
        const matches = tag.toLocaleLowerCase().includes(query) || this.hierarchy && tags.some(([child]) => child.startsWith(tag + "/") && child.toLocaleLowerCase().includes(query));
        if (!matches) {
          continue;
        }
        const row = document.createElement("div");
        row.className = "discovery-tag-row";
        row.style.paddingLeft = `${depth * 14}px`;
        const children = this.hierarchy && tags.some(([child]) => child.startsWith(tag + "/"));
        if (children) {
          const toggle = iconButton(this.folded.has(tag) ? "chevron-right" : "chevron-down", `Toggle ${tag}`, () => {
            if (this.folded.has(tag)) { this.folded.delete(tag); } else { this.folded.add(tag); }
            this.save();
            this.refresh();
          });
          toggle.dataset.tagToggle = tag;
          toggle.setAttribute("aria-expanded", String(!this.folded.has(tag)));
          row.append(toggle);
        } else {
          const spacer = document.createElement("span");
          spacer.className = "tag-toggle-spacer";
          row.append(spacer);
        }
        const button = document.createElement("button");
        button.className = "discovery-tag";
        button.dataset.tag = tag;
        button.textContent = this.hierarchy && tag.includes("/") ? tag.slice(tag.lastIndexOf("/") + 1) : tag;
        const badge = document.createElement("span");
        badge.className = "outgoing-count";
        badge.dataset.tagCount = tag;
        badge.textContent = String(count);
        button.append(badge);
        button.addEventListener("click", event => this.app.core.run(() => {
          if (!this.app.core.isEnabled("global-search")) {
            throw new Error("Enable Search to open tag results.");
          }
          const term = "tag:" + tag;
          const current = this.search.getGlobalSearchQuery();
          const combined = event.ctrlKey || event.metaKey
            ? current.split(/\s+/).includes(term) ? current.split(/\s+/).filter(value => value !== term).join(" ") : `${current} ${term}`.trim()
            : term;
          this.search.openGlobalSearch(combined);
        }).catch(reportError));
        row.append(button);
        this.results.append(row);
        if (children && (!this.folded.has(tag) || query)) {
          append(tag, depth + 1);
        }
      }
    };
    append(null, 0);
    if (!this.results.childElementCount) {
      message(this.results, "No tags found.");
    }
  }
}

abstract class NoteDiscovery extends DiscoverySidebar {
  protected file: TFile | null = null;
  protected contents!: HTMLElement;
  private source!: HTMLElement;
  private pin!: HTMLButtonElement;
  private pinned: string | null = null;

  protected override renamed(file: TFile, oldPath: string): void {
    if (this.pinned === oldPath) { this.pinned = file.path; this.persist({ pinned: true, file: file.path }); }
  }
  protected override deleted(file: TFile): void {
    if (this.pinned === file.path) { this.pinned = null; this.persist({ pinned: false, file: "" }); }
  }

  protected pinCurrent(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error(`Open a note before pinning ${this.title.toLowerCase()}.`);
    }
    this.pinned = file.path;
    this.persist({ pinned: true, file: file.path });
    this.initLeaf();
    this.refresh();
  }

  protected build(state: Record<string, unknown>): void {
    const pinned = boolOption(state, "pinned");
    const path = textOption(state, "file");
    if (pinned && !path) {
      throw new Error(`A pinned ${this.title} view requires a file path.`);
    }
    this.pinned = pinned ? path : null;
    const header = document.createElement("div");
    header.className = "outgoing-header";
    const title = document.createElement("strong");
    title.textContent = this.title;
    this.pin = iconButton("pin", "Pin to this note", () => this.app.core.run(() => {
      this.pinned = this.pinned ? null : this.app.workspace.getActiveFile()?.path ?? null;
      this.persist({ pinned: this.pinned !== null, file: this.pinned ?? "" });
      this.refresh();
    }).catch(reportError));
    this.pin.dataset.discoveryPin = this.id;
    header.append(title, this.pin);
    this.source = document.createElement("div");
    this.source.className = "outgoing-source";
    this.contents = document.createElement("div");
    this.contents.className = "discovery-results";
    this.panel!.append(header, this.source, this.contents);
  }

  protected refresh(): void {
    const path = this.pinned ?? this.app.workspace.getActiveFile()?.path ?? "";
    const file = this.app.vault.getAbstractFileByPath(path);
    this.file = file instanceof TFile ? file : null;
    this.source.textContent = path || "No active note";
    this.source.dataset.discoverySource = path;
    this.pin.disabled = !path;
    this.pin.setAttribute("aria-pressed", String(this.pinned !== null));
    this.pin.title = this.pinned ? "Follow active note" : "Pin to this note";
    this.contents.replaceChildren();
    this.renderNote();
  }

  protected abstract renderNote(): void;
}

export class BacklinksView extends NoteDiscovery {
  private showUnlinked = false;
  private readonly inline = new Map<string, HTMLElement>();
  private status: HTMLElement | null = null;

  constructor(app: App) { super(app, "backlink", "backlink", "Backlinks", "right", "links"); }

  protected watchSettings(): boolean { return true; }

  protected commands(): Command[] {
    return [
      ...super.commands(),
      {
        id: "backlink:open-backlinks", name: "Open backlinks for the current file",
        checkCallback: checking => {
          if (!this.app.workspace.getActiveFile()) { return false; }
          if (!checking) {
            this.app.core.run(() => this.pinCurrent()).catch(reportError);
          }
          return true;
        },
      },
      {
        id: "backlink:toggle-backlinks-in-document", name: "Toggle backlinks in document",
        callback: () => this.app.core.saveSettings(this.id, { backlinkInDocument: this.options.backlinkInDocument !== true }),
      },
    ];
  }

  protected build(state: Record<string, unknown>): void {
    super.build(state);
    this.showUnlinked = boolOption(state, "showUnlinked");
    const controls = document.createElement("div");
    controls.className = "discovery-controls";
    checkbox(controls, "Unlinked mentions", this.showUnlinked, value => {
      this.showUnlinked = value;
      this.persist({ showUnlinked: value });
      this.refresh();
    }).dataset.backlinksUnlinked = "true";
    this.panel!.insertBefore(controls, this.contents);
    this.status = document.createElement("button");
    this.status.className = "backlink-status";
    this.status.dataset.coreStatus = this.id;
    this.status.addEventListener("click", () => this.app.core.run(() => this.initLeaf()).catch(reportError));
    element("plugin-status-bar").append(this.status);
  }

  protected renderNote(): void {
    if (this.file) {
      this.renderReferences(this.contents, this.file, this.showUnlinked);
    } else {
      message(this.contents, "Open a note to see its backlinks.");
    }
    const active = this.app.workspace.getActiveFile();
    const count = active ? this.references(active).reduce((sum, entry) => sum + entry.links.length, 0) : 0;
    if (this.status) {
      this.status.textContent = active ? `${count} backlink${count === 1 ? "" : "s"}` : "";
      this.status.hidden = !active;
    }
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const [id, node] of this.inline) {
      if (!leaves.some(leaf => leaf.id === id) || this.options.backlinkInDocument !== true) {
        node.remove();
        this.inline.delete(id);
      }
    }
    if (this.options.backlinkInDocument === true) {
      for (const leaf of leaves) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || !view.file) {
          continue;
        }
        let node = this.inline.get(leaf.id);
        if (!node) {
          node = document.createElement("section");
          node.className = "inline-backlinks";
          node.dataset.inlineBacklinks = leaf.id;
          leaf.containerEl.append(node);
          this.inline.set(leaf.id, node);
        }
        node.replaceChildren();
        const heading = document.createElement("h3");
        heading.textContent = "Backlinks";
        node.append(heading);
        this.renderReferences(node, view.file, false);
      }
    }
  }

  private references(file: TFile): { entry: IndexedDocument; links: Pos[] }[] {
    return this.app.metadataCache.getDocuments().filter(entry => entry.document.file.path !== file.path)
      .map(entry => ({ entry, links: entry.outgoing.filter(link => link.destination?.path === file.path).map(link => link.link.position) }))
      .filter(result => result.links.length > 0);
  }

  private renderReferences(parent: HTMLElement, file: TFile, unlinked: boolean): void {
    const references = this.references(file);
    for (const { entry, links } of references) {
      const path = entry.document.file.path;
      const heading = document.createElement("h4");
      heading.textContent = path;
      parent.append(heading);
      for (const position of links) {
        const button = contextButton(entry.text, { from: position.start.offset, to: position.end.offset }, path);
        button.dataset.backlinkSource = path;
        button.dataset.backlinkOffset = String(position.start.offset);
        button.addEventListener("click", () => this.app.core.run(() => reveal(this.app, path, position)).catch(reportError));
        parent.append(button);
      }
    }
    if (!references.length) {
      message(parent, "No linked mentions.");
    }
    if (unlinked) {
      const heading = document.createElement("h3");
      heading.textContent = "Unlinked mentions";
      parent.append(heading);
      let count = 0;
      for (const entry of this.app.metadataCache.getDocuments()) {
        for (const mention of outgoingMentions(entry.text, entry.cache, entry.document.file.path, [{ path: file.path, basename: file.basename, cache: this.app.metadataCache.getFileCache(file) }])) {
          for (const match of mention.matches) {
            const path = entry.document.file.path;
            const button = contextButton(entry.text, match, path);
            button.dataset.backlinkUnlinked = path;
            button.addEventListener("click", () => this.app.core.run(() => reveal(this.app, path, sourcePositions(entry.text)(match.from, match.to))).catch(reportError));
            parent.append(button);
            count++;
          }
        }
      }
      if (!count) {
        message(parent, "No unlinked mentions.");
      }
    }
  }

  protected close(): void {
    this.inline.forEach(node => node.remove());
    this.inline.clear();
    this.status?.remove();
    this.status = null;
  }
}

export class FootnotesView extends NoteDiscovery {
  constructor(app: App) { super(app, "footnotes", "footnotes", "Footnotes", "right", "file"); }

  protected renderNote(): void {
    const entry = this.file ? this.app.metadataCache.getDocument(this.file.path) : null;
    if (!entry || !this.file) {
      message(this.contents, "Open a Markdown note to see its footnotes.");
      return;
    }
    const path = this.file.path;
    const ids = new Set([...entry.cache.footnotes.map(note => note.id), ...entry.cache.footnoteRefs.map(reference => reference.id)]);
    for (const id of ids) {
      const definition = entry.cache.footnotes.find(note => note.id === id);
      const group = document.createElement("article");
      group.className = "discovery-result-group";
      group.dataset.footnote = id;
      const title = document.createElement("button");
      title.className = "discovery-result-title";
      title.dataset.footnoteDefinition = id;
      title.textContent = `[^${id}]: ${definition?.content ?? "Missing definition"}`;
      title.disabled = !definition;
      if (definition) {
        title.addEventListener("click", () => this.app.core.run(() => reveal(this.app, path, definition.labelPosition)).catch(reportError));
      }
      group.append(title);
      for (const [index, reference] of entry.cache.footnoteRefs.filter(reference => reference.id === id).entries()) {
        const button = document.createElement("button");
        button.className = "discovery-context";
        button.dataset.footnoteReference = id;
        button.textContent = `Reference ${index + 1} - line ${reference.position.start.line + 1}`;
        button.addEventListener("click", () => this.app.core.run(() => reveal(this.app, path, reference.position)).catch(reportError));
        group.append(button);
      }
      this.contents.append(group);
    }
    if (!ids.size) {
      message(this.contents, "No footnotes in this note.");
    }
  }
}

export function registerDiscoveryViews(app: App): void {
  const search = new GlobalSearch(app);
  for (const view of [search, new TagsView(app, search), new BacklinksView(app), new FootnotesView(app)]) {
    view.register(app.core);
  }
}
