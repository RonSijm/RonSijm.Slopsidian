import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { outgoingLinks, resolveSubpath, type OutgoingLink } from "./links";
import { outgoingMentions, parseMarkdown, sourcePositions } from "./markdown";
import { outgoingLinkAction, outgoingPaneState } from "./outgoing-pane-model";
import { TFile } from "./vault";
import { ItemView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

interface OutgoingSnapshot {
  id: number;
  file: TFile;
  path: string;
  text: string;
  links: OutgoingLink<TFile>[];
  destinations: (string | null)[];
  mentions: ReturnType<typeof outgoingMentions>;
}

export class OutgoingPaneView extends ItemView {
  override icon = "links";
  private options = outgoingPaneState({});
  private readonly sourceRoot: string | null;
  private readonly follow = document.createElement("input");
  private readonly caption = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly results = document.createElement("div");
  private snapshot: OutgoingSnapshot | null = null;
  private signature = "";
  private revision = 0;
  private request = 0;
  private navigationToken = 0;
  private queued = false;
  private opening = false;
  private message = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf); this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("outgoing-workspace"); this.contentEl.dataset.outgoingPane = leaf.id;
    const controls = document.createElement("div"), label = document.createElement("label");
    controls.className = "discovery-pane-controls"; this.follow.type = "checkbox"; this.follow.dataset.outgoingFollow = "true";
    label.append(this.follow, "Follow active note"); controls.append(label);
    this.caption.className = "discovery-pane-caption"; this.caption.dataset.outgoingFile = "true";
    this.status.className = "discovery-status"; this.status.dataset.outgoingStatus = "true"; this.status.setAttribute("role", "status");
    this.results.className = "outgoing-pane-results"; this.results.tabIndex = 0;
    this.contentEl.append(controls, this.caption, this.results, this.status);
    this.registerDomEvent(this.follow, "change", () => this.run(() => {
      this.navigationToken++; this.options.followActiveFile = this.follow.checked; this.syncTarget(); this.save(); this.schedule();
    }));
    this.registerDomEvent(this.results, "click", event => {
      if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) { return; }
      const target = event.target.closest<HTMLButtonElement>("[data-outgoing-pane-section],[data-outgoing-pane-link],[data-outgoing-pane-mention]");
      if (!target || target.disabled || Number(target.dataset.outgoingRevision) !== this.snapshot?.id) { return; }
      this.run(() => {
        if (Number(target.dataset.outgoingRevision) !== this.snapshot?.id) { return; }
        const section = target.dataset.outgoingPaneSection;
        if (section) {
          const key = section === "links" ? "linksCollapsed" : "unlinkedCollapsed";
          this.options[key] = !this.options[key]; this.save(); this.schedule();
        } else {
          return this.navigate(target, event.ctrlKey || event.metaKey);
        }
      });
    });
    this.registerDomEvent(this.results, "keydown", event => {
      if (!(event instanceof KeyboardEvent) || !this.interactive() || this.opening || event.altKey || event.ctrlKey || event.metaKey) { return; }
      const buttons = [...this.results.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")], index = buttons.findIndex(button => button === event.target);
      if (index < 0) { return; }
      const next = event.key === "ArrowDown" ? buttons[Math.min(index + 1, buttons.length - 1)] : event.key === "ArrowUp" ? buttons[Math.max(index - 1, 0)] : event.key === "Home" ? buttons[0] : event.key === "End" ? buttons.at(-1) : null;
      if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); }
    });
    this.registerEvent(this.app.metadataCache.on("finished", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("extensions-changed", () => this.schedule()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || !this.owned()) { return; }
      this.navigationToken++;
      if (this.options.file === oldPath) { this.options.file = file.path; this.save(); }
      this.schedule();
    }));
    this.registerEvent(this.app.vault.on("delete", () => { this.navigationToken++; this.schedule(); }));
    this.registerEvent(this.app.core.on("changed", () => { this.updateControls(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-ready", () => { this.syncTarget(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on("layout-change", () => { this.updateControls(); this.schedule(); }));
    this.register(() => { this.request++; this.navigationToken++; this.snapshot = null; });
  }

  getViewType(): string { return "outgoing-link"; }
  getDisplayText(): string { return "Outgoing links"; }
  get file(): TFile | null { return this.app.vault.getFileByPath(this.options.file); }
  setFile(file: TFile): void {
    if (!this.interactive() || this.opening || !(file instanceof TFile) || this.app.vault.getFileByPath(file.path) !== file) {
      throw new Error("Set a live Outgoing links pane to a current file after current operations finish.");
    }
    this.navigationToken++; this.options.followActiveFile = false; this.options.file = file.path; this.signature = ""; this.save(); this.schedule();
  }
  override getState(): Record<string, unknown> { return { ...super.getState(), ...this.options }; }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = outgoingPaneState(state);
    if (!this.owned()) { throw new Error("Set state on a current Outgoing links workspace view."); }
    await super.setState(state, result);
    this.navigationToken++; this.options = options; this.signature = ""; this.message = ""; this.updateControls(); this.schedule();
  }
  protected override async onOpen(): Promise<void> { this.syncTarget(); this.updateControls(); this.schedule(); }
  override focus(): void { this.results.focus(); }

  private owned(): boolean { return this.isLoaded && Boolean(this.sourceRoot) && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(): boolean { return this.owned() && !this.app.changingVault && !this.app.core.busy && this.app.core.isEnabled("outgoing-link") && !this.app.workspace.isChangingFiles && !this.app.workspace.isChangingLayout; }
  private run(action: () => unknown): void {
    if (!this.interactive() || this.opening) { return; }
    this.app.core.run(() => { if (this.interactive() && !this.opening) { this.message = ""; return action(); } }).catch(error => {
      if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); } reportError(error);
    });
  }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private syncTarget(): void {
    if (!this.owned() || !this.options.followActiveFile) { return; }
    const file = this.app.workspace.getActiveFile();
    if (file && this.app.vault.getFileByPath(file.path) === file && file.path !== this.options.file) {
      this.options.file = file.path; this.message = ""; this.save();
    }
  }
  private schedule(): void {
    this.request++;
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.owned()) { this.refresh().catch(error => { if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); reportError(error); } }); }
    });
  }
  private updateControls(): void {
    const enabled = this.interactive() && !this.opening;
    this.follow.disabled = !enabled; this.follow.checked = this.options.followActiveFile; this.caption.textContent = this.options.file || "No note selected";
    this.results.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = !enabled || Boolean(button.dataset.outgoingUnavailable); });
  }
  private async refresh(): Promise<void> {
    this.syncTarget(); this.updateControls(); if (!this.interactive()) { return; }
    const token = ++this.request, path = this.options.file, file = this.file;
    if (!file || file.extension.toLowerCase() !== "md") {
      this.snapshot = null; this.signature = ""; this.results.replaceChildren();
      this.status.textContent = path ? file ? "Outgoing links are available for Markdown notes." : "This note is missing or unavailable: " + path : "Open a Markdown note to see its outgoing links."; return;
    }
    const indexed = this.app.metadataCache.getDocument(path), text = indexed && !indexed.missing ? indexed.text : await this.app.vault.read(file);
    if (!this.interactive() || token !== this.request || this.options.file !== path || this.app.vault.getFileByPath(path) !== file) { return; }
    const current = this.app.metadataCache.getDocument(path), cache = current && !current.missing && current.text === text ? current.cache : parseMarkdown(text);
    const links = outgoingLinks(cache, (reference, source) => this.app.metadataCache.resolveReference(reference, source), path);
    const mentions = this.options.unlinkedCollapsed ? [] : outgoingMentions(text, cache, path, this.app.vault.getMarkdownFiles().map(target => ({ path: target.path, basename: target.basename, cache: this.app.metadataCache.getFileCache(target) })));
    const signature = JSON.stringify([path, text, this.options, links.map(link => [link.reference, link.target, link.destination?.path, link.ambiguous, link.occurrences, this.action(link, path)]), mentions]);
    if (this.snapshot?.file === file && signature === this.signature) { return; }
    this.signature = signature; this.snapshot = { id: ++this.revision, file, path, text, links, destinations: links.map(link => link.destination?.path ?? null), mentions }; this.render();
  }
  private action(link: OutgoingLink<TFile>, path: string): ReturnType<typeof outgoingLinkAction<TFile>> {
    return outgoingLinkAction(link, path, extension => this.app.workspace.viewTypeForExtension(extension), this.app.vault.readOnly,
      (name, source) => this.app.fileManager.getNewNotePath(name, source, true));
  }
  private render(): void {
    const snapshot = this.snapshot; if (!snapshot) { return; }
    const focused = this.results.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement.dataset.outgoingKey : undefined;
    const fragment = document.createDocumentFragment(), position = sourcePositions(snapshot.text);
    const button = (text: string, key: string): HTMLButtonElement => {
      const node = document.createElement("button"); node.type = "button"; node.textContent = text; node.dataset.outgoingRevision = String(snapshot.id); node.dataset.outgoingKey = key; return node;
    };
    for (const kind of ["links", "unlinked"] as const) {
      const collapsed = kind === "links" ? this.options.linksCollapsed : this.options.unlinkedCollapsed, section = document.createElement("section");
      section.className = "outgoing-section"; section.dataset.outgoingPaneKind = kind;
      const count = kind === "links" ? snapshot.links.length : snapshot.mentions.reduce((sum, item) => sum + item.matches.length, 0);
      const title = button((kind === "links" ? "Links" : "Unlinked mentions") + (kind === "unlinked" && collapsed ? "" : ` (${count})`), kind);
      title.className = "outgoing-pane-section-title"; title.dataset.outgoingPaneSection = kind; title.setAttribute("aria-expanded", String(!collapsed)); section.append(title);
      if (!collapsed) {
        if (kind === "links") {
          snapshot.links.forEach((link, index) => {
            const action = this.action(link, snapshot.path), row = button("", "link:" + index);
            row.className = "outgoing-link-result"; row.classList.toggle("is-unresolved", !link.destination);
            row.dataset.outgoingPaneLink = String(index); row.dataset.outgoingReference = link.reference.link; row.dataset.outgoingTarget = link.destination?.path ?? "";
            const label = document.createElement("span"), total = document.createElement("span"); label.textContent = (link.destination?.basename ?? link.target?.path ?? link.reference.link) + (link.target?.subpath ?? "");
            total.className = "outgoing-count"; total.textContent = link.occurrences > 1 ? String(link.occurrences) : ""; row.append(label, total);
            row.title = action.reason ?? (action.createPath ? "Create " + action.createPath : link.destination?.path ?? link.reference.link) + (link.ambiguous ? " (multiple matching notes; using the closest path)" : "");
            if (action.reason) { row.dataset.outgoingUnavailable = action.reason; }
            section.append(row);
          });
        } else {
          snapshot.mentions.forEach((mention, index) => mention.matches.forEach((match, matchIndex) => {
            const row = button(`${mention.path} - line ${position(match.from, match.to).start.line + 1}: ${snapshot.text.slice(match.from, match.to)}`, `mention:${index}:${matchIndex}`);
            row.className = "outgoing-mention-result"; row.dataset.outgoingPaneMention = String(index); row.dataset.outgoingMatch = String(matchIndex); row.title = "Reveal the exact unlinked mention in Source"; section.append(row);
          }));
        }
        if (!count) { const empty = document.createElement("p"); empty.className = "empty-outline"; empty.textContent = kind === "links" ? "No outgoing links." : "No unlinked mentions."; section.append(empty); }
      }
      fragment.append(section);
    }
    this.results.replaceChildren(fragment); this.status.textContent = this.message || (this.app.vault.lazy ? "Partial index: unlinked mentions cover only notes opened so far." : this.app.vault.indexComplete ? "Complete index: unlinked mentions cover every cached note." : ""); this.updateControls();
    if (focused) { [...this.results.querySelectorAll<HTMLButtonElement>("button")].find(button => button.dataset.outgoingKey === focused)?.focus(); }
  }
  private stale(): void { this.message = "The note or link targets changed; outgoing links have been refreshed. Choose the result again."; this.signature = ""; this.app.metadataCache.updateOpenDocuments(); this.schedule(); }
  private async navigate(button: HTMLButtonElement, tab: boolean): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || Number(button.dataset.outgoingRevision) !== snapshot.id) { return; }
    const operation = ++this.navigationToken; this.opening = true; this.updateControls();
    try {
      await this.app.metadataCache.refresh();
      if (!this.interactive() || operation !== this.navigationToken) { return; }
      const source = this.app.metadataCache.getDocument(snapshot.path), peer = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).find(view => view instanceof MarkdownView && view.file === snapshot.file);
      if (this.snapshot !== snapshot || this.options.file !== snapshot.path || this.app.vault.getFileByPath(snapshot.path) !== snapshot.file || !source || source.missing || source.text !== snapshot.text || peer instanceof MarkdownView && peer.editor.getValue() !== snapshot.text) { this.stale(); return; }
      const index = Number(button.dataset.outgoingPaneLink);
      let destination: TFile, subpath = "", range: { from: number; to: number } | undefined;
      if (button.dataset.outgoingPaneLink !== undefined) {
        const link = snapshot.links[index]; if (!link?.target) { return; }
        const current = this.app.metadataCache.resolveReference(link.reference, snapshot.path)?.file ?? null;
        if (current !== link.destination || (current?.path ?? null) !== snapshot.destinations[index]) { this.stale(); return; }
        const action = this.action(link, snapshot.path);
        if (action.reason) { this.status.textContent = action.reason; return; }
        subpath = link.target.subpath;
        if (current) { destination = current; }
        else if (action.createPath) {
          destination = await this.app.vault.create(action.createPath, "");
          await this.app.metadataCache.refresh();
          if (!this.interactive() || operation !== this.navigationToken) { throw new Error("Created " + destination.path + ", but the pane changed before navigation finished."); }
        } else { return; }
      } else {
        const mention = snapshot.mentions[Number(button.dataset.outgoingPaneMention)]; range = mention?.matches[Number(button.dataset.outgoingMatch)];
        if (!range) { return; } destination = snapshot.file;
      }
      const leaf = this.app.workspace.getLeaf(tab ? "tab" : false); await leaf.openFile(destination);
      if (!this.interactive() || operation !== this.navigationToken || this.app.workspace.activeLeaf !== leaf || this.app.vault.getFileByPath(destination.path) !== destination) { return; }
      const view = leaf.view;
      if (range && view instanceof MarkdownView && view.file === snapshot.file) {
        if (view.editor.getValue() !== snapshot.text) { this.stale(); return; }
        const position = sourcePositions(snapshot.text)(range.from, range.to); view.setMode("source"); view.editor.setSelection(position.start, position.end); view.editor.scrollIntoView({ from: position.start, to: position.end }, true); view.focus();
      } else if (subpath && view instanceof MarkdownView && view.file === destination) {
        const location = resolveSubpath(parseMarkdown(view.editor.getValue()), subpath);
        if (!location) { throw new Error("The linked heading or block does not exist: " + subpath); }
        if (subpath.startsWith("#^")) { view.setMode("source"); }
        view.revealLine(location.start.line);
      }
    } finally { this.opening = false; this.updateControls(); }
  }
}
