import { copyViewData, type ViewStateResult } from "./contracts";
import { reportError } from "./dom";
import { outgoingLinks, resolveSubpath, type OutgoingLink } from "./links";
import { outgoingMentions, parseMarkdown, sourcePositions } from "./markdown";
import { outgoingLinkAction, outgoingPaneState } from "./outgoing-pane-model";
import { linkOutgoingMention, outgoingMentionAuthority, outgoingMentionEnvironmentFor, outgoingMentionReview, sameOutgoingMentionAuthority, type OutgoingMentionAuthority, type OutgoingMentionReview } from "./outgoing-mention-authoring";
import { linkOutgoingMentionInSource, outgoingMentionIntentAuthority, outgoingMentionIntentEnvironmentFor, outgoingMentionIntentReview, sameOutgoingMentionIntentAuthority, type OutgoingMentionIntentAuthority, type OutgoingMentionIntentReview } from "./outgoing-mention-intent";
import { applyOutgoingMentionBulk, cancelOutgoingMentionBulk, isOutgoingMentionBulkSourceCandidate, outgoingMentionBulkCandidate, outgoingMentionBulkSourceCandidate, outgoingMentionBulkReviewCurrent, prepareOutgoingMentionBulk, prepareOutgoingMentionBulkInSource, type OutgoingMentionBulkActionCandidate, type OutgoingMentionBulkReview } from "./outgoing-mention-bulk";
import { outgoingMentionBulkReviewPanel } from "./outgoing-mention-bulk-review";
import { openOutgoingNewDestination, type OutgoingNewDestinationModal } from "./outgoing-new-destination-review";
import { newDestinationSourceAvailable } from "./outgoing-new-destination-source";
import { EditorView } from "@codemirror/view";
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
interface MentionTargetSnapshot { file: TFile | null; path: string; text?: string; savedText?: string; version?: string; document?: unknown; cache?: unknown; bom: boolean; unavailable: boolean }

export class OutgoingPaneView extends ItemView {
  override icon = "links";
  private options = outgoingPaneState({});
  private readonly sourceRoot: string | null;
  private readonly follow = document.createElement("input");
  private readonly caption = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly results = document.createElement("div");
  private readonly newDestinationButton = document.createElement("button");
  private snapshot: OutgoingSnapshot | null = null;
  private signature = "";
  private revision = 0;
  private request = 0;
  private navigationToken = 0;
  private queued = false;
  private opening = false;
  private message = "";
  private readonly mentionActions = new Map<string, OutgoingMentionReview | OutgoingMentionIntentReview>();
  private bulkActions = new Map<string, OutgoingMentionBulkActionCandidate>();
  private bulkReview: OutgoingMentionBulkReview | null = null;
  private bulkLease: (() => boolean) | null = null;
  private bulkReviewEl: HTMLElement | null = null;
  private authoringAuthority: OutgoingMentionAuthority | null = null;
  private intentAuthority: OutgoingMentionIntentAuthority | null = null;
  private mentionTargets: MentionTargetSnapshot[] = [];
  private authoringWatch: ReturnType<typeof setTimeout> | null = null;
  private newDestinationModal: OutgoingNewDestinationModal | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf); this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("outgoing-workspace"); this.contentEl.dataset.outgoingPane = leaf.id;
    const controls = document.createElement("div"), label = document.createElement("label");
    controls.className = "discovery-pane-controls"; this.follow.type = "checkbox"; this.follow.dataset.outgoingFollow = "true";
    label.append(this.follow, "Follow active note"); controls.append(label);
    const create = this.newDestinationButton; create.type = "button"; create.textContent = "New destination…"; create.dataset.outgoingNewOpen = "true";
    controls.append(create); this.registerDomEvent(create, "click", () => this.run(() => this.openNewDestination()));
    this.caption.className = "discovery-pane-caption"; this.caption.dataset.outgoingFile = "true";
    this.status.className = "discovery-status"; this.status.dataset.outgoingStatus = "true"; this.status.setAttribute("role", "status");
    this.results.className = "outgoing-pane-results"; this.results.tabIndex = 0;
    this.contentEl.append(controls, this.caption, this.results, this.status);
    this.registerDomEvent(this.follow, "change", () => this.run(() => {
      this.navigationToken++; this.options.followActiveFile = this.follow.checked; this.syncTarget(); this.save(); this.schedule();
    }));
    this.registerDomEvent(this.results, "click", event => {
      if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) { return; }
      const target = event.target.closest<HTMLButtonElement>("[data-outgoing-pane-section],[data-outgoing-pane-link],[data-outgoing-pane-mention],[data-outgoing-mention-link],[data-outgoing-mention-bulk]");
      if (!target || target.disabled || Number(target.dataset.outgoingRevision) !== this.snapshot?.id) { return; }
      this.run(() => {
        if (Number(target.dataset.outgoingRevision) !== this.snapshot?.id) { return; }
        const section = target.dataset.outgoingPaneSection;
        if (section) {
          const key = section === "links" ? "linksCollapsed" : "unlinkedCollapsed";
          this.options[key] = !this.options[key]; this.save(); this.schedule();
        } else if (target.dataset.outgoingMentionBulk !== undefined) {
          return this.reviewBulkMentions(target);
        } else if (target.dataset.outgoingMentionLink !== undefined) {
          return this.linkMention(target);
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
    this.registerEvent(this.app.workspace.on("editor-change", () => this.schedule()));
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
    // Link preferences can change while Reading text and metadata stay equal.
    // Rebind current controls through the accepted configuration lifecycle;
    // retained actions still have to satisfy their original preference lease.
    this.register(this.app.configuration.watch("app", () => { if (this.owned()) { this.schedule(); } }));
    this.register(() => { this.request++; this.navigationToken++; this.newDestinationModal?.close(); this.snapshot = null; this.mentionActions.clear(); this.bulkActions.clear(); this.closeBulkReview(); this.authoringAuthority = null; this.intentAuthority = null; this.mentionTargets = []; this.cancelAuthoringWatch(); });
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
    this.bulkReviewEl?.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = !enabled; });
    const create = this.newDestinationButton;
    if (create) { create.disabled = !enabled || this.app.vault.readOnly || !this.snapshot || !newDestinationSourceAvailable(this.app, this.snapshot.file, this.snapshot.text); }
  }
  private openNewDestination(): void {
    const snapshot = this.snapshot;
    if (!snapshot || !this.interactive() || this.app.vault.readOnly || this.opening) { return; }
    this.closeBulkReview();
    const token = ++this.navigationToken, options = this.options, configuration = JSON.stringify(options), parent = this.leaf.parent, root = this.leaf.getRoot(), pinned = this.leaf.pinned;
    const current = (): boolean => this.owned() && token === this.navigationToken && this.options === options && JSON.stringify(this.options) === configuration
      && this.options.file === snapshot.path && this.leaf.parent === parent && this.leaf.getRoot() === root && this.leaf.pinned === pinned;
    this.opening = true;
    let modal: OutgoingNewDestinationModal | null = null;
    try {
      modal = openOutgoingNewDestination(this.app, snapshot.file, snapshot.text, { current, pane: this.leaf, closed: () => {
        if (this.newDestinationModal === modal) { this.newDestinationModal = null; this.opening = false; this.updateControls(); this.schedule(); }
      } });
      this.newDestinationModal = modal;
      if (!modal) { this.opening = false; }
    } catch (error) { this.opening = false; throw error; }
    this.updateControls();
  }
  private source(file: TFile): MarkdownView | null {
    const views = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.isLoaded && view.getMode() === "source");
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    return active && views.includes(active) ? active : views[0] ?? null;
  }
  private cancelAuthoringWatch(): void { if (this.authoringWatch !== null) { clearTimeout(this.authoringWatch); this.authoringWatch = null; } }
  private authoringState(view: MarkdownView): readonly unknown[] {
    const editor = view.editor, cm = editor.cm, session = view.session;
    return [view.isLoaded, view.file, view.file?.path, view.leaf.view, view.getMode(), view.getEditingMode(), editor, cm, cm.state.doc,
      cm.dom.isConnected, cm.composing, cm.state.readOnly, cm.state.facet(EditorView.editable), session, session?.document, session?.isReloading, session?.isSaving];
  }
  private watchAuthoring(view: MarkdownView | null, authority: OutgoingMentionAuthority | null, intent: OutgoingMentionIntentAuthority | null = null): void {
    this.cancelAuthoringWatch();
    if (!view || authority || intent || this.app.vault.readOnly || this.options.unlinkedCollapsed || !view.session || !view.isLoaded || view.leaf.view !== view
      || !view.editor.cm.dom.isConnected || view.editor.cm.state.readOnly || view.session.originRoot !== this.app.vault.rootPath
      || view.getMode() !== "source" && (view.getMode() !== "preview" || !view.session.isSaving && !view.session.isReloading)
      || this.app.vault.getFileByPath(this.options.file) !== view.file) { return; }
    const initial = this.authoringState(view), deadline = Date.now() + 5_000;
    const inspect = (): void => {
      this.authoringWatch = null;
      if (!this.owned() || this.app.vault.readOnly || !this.app.core.isEnabled("outgoing-link")) { return; }
      const current = this.authoringState(view);
      if (current.some((value, index) => value !== initial[index])) { this.schedule(); return; }
      if (!view.session?.isReloading && !view.session?.isSaving && Date.now() >= deadline) { return; }
      // Reload/facet settlement can leave metadata text and version unchanged,
      // so there need not be another metadata event. This local lifetime watch
      // reads identity/flags only: no source text, parser, save or host request.
      this.authoringWatch = setTimeout(inspect, 100);
    };
    this.authoringWatch = setTimeout(inspect, 100);
  }
  private async refresh(): Promise<void> {
    this.syncTarget(); this.updateControls(); if (!this.interactive()) { return; }
    if (!this.opening && this.bulkReview && (!this.bulkLease || !outgoingMentionBulkReviewCurrent(this.bulkReview, this.bulkLease))) {
      this.closeBulkReview(); this.message = "The note, destination or review changed. Review the current mentions again."; this.status.textContent = this.message;
    }
    const token = ++this.request, path = this.options.file, file = this.file;
    if (!file || file.extension.toLowerCase() !== "md") {
      this.snapshot = null; this.signature = ""; this.mentionActions.clear(); this.bulkActions?.clear(); this.closeBulkReview(); this.authoringAuthority = null; this.intentAuthority = null; this.mentionTargets = []; this.cancelAuthoringWatch(); this.results.replaceChildren();
      this.status.textContent = path ? file ? "Outgoing links are available for Markdown notes." : "This note is missing or unavailable: " + path : "Open a Markdown note to see its outgoing links."; return;
    }
    const indexed = this.app.metadataCache.getDocument(path), text = indexed && !indexed.missing ? indexed.text : await this.app.vault.read(file);
    if (!this.interactive() || token !== this.request || this.options.file !== path || this.app.vault.getFileByPath(path) !== file) { return; }
    const current = this.app.metadataCache.getDocument(path), cache = current && !current.missing && current.text === text ? current.cache : parseMarkdown(text);
    const links = outgoingLinks(cache, (reference, source) => this.app.metadataCache.resolveReference(reference, source), path);
    const mentions = this.options.unlinkedCollapsed ? [] : outgoingMentions(text, cache, path, this.app.vault.getMarkdownFiles().map(target => ({ path: target.path, basename: target.basename, cache: this.app.metadataCache.getFileCache(target) })));
    const source = this.source(file);
    const authority = outgoingMentionAuthority(this.app, file, text, source);
    const intentAuthority = authority ? null : outgoingMentionIntentAuthority(this.app, file, text);
    const targets: MentionTargetSnapshot[] = mentions.map(mention => {
      const target = this.app.vault.getFileByPath(mention.path), entry = this.app.metadataCache.getDocument(mention.path);
      return { file: target, path: mention.path, text: entry?.text, savedText: entry?.document.content, version: entry?.document.version,
        document: entry?.document, cache: entry?.cache, bom: entry?.document.hasBom === true, unavailable: !target || target.extension.toLowerCase() !== "md" || !entry || entry.missing || Boolean(entry.cache.errors.length) };
    });
    const settlingView = source ?? this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
      .find((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === "preview") ?? null;
    this.watchAuthoring(settlingView, authority, intentAuthority);
    const signature = JSON.stringify([path, text, this.options, links.map(link => [link.reference, link.target, link.destination?.path, link.ambiguous, link.occurrences, this.action(link, path)]), mentions,
      this.app.vault.readOnly, source?.leaf.id, source?.getMode(), source?.getEditingMode(), source?.savedDocument?.version, source?.session?.isSaving, source?.session?.isReloading,
      source?.editor.cm.composing, source?.editor.cm.state.readOnly, this.app.vault.getConfig("newLinkFormat"), this.app.vault.getConfig("useMarkdownLinks")]);
    const targetsCurrent = targets.length === this.mentionTargets.length && targets.every((target, index) => {
      const prior = this.mentionTargets[index]; return target.file === prior.file && target.path === prior.path && target.text === prior.text
        && target.savedText === prior.savedText && target.version === prior.version && target.document === prior.document && target.cache === prior.cache && target.bom === prior.bom && target.unavailable === prior.unavailable;
    });
    if (this.snapshot?.file === file && signature === this.signature && sameOutgoingMentionAuthority(authority, this.authoringAuthority)
      && sameOutgoingMentionIntentAuthority(this.intentAuthority, intentAuthority) && targetsCurrent) { return; }
    this.authoringAuthority = authority; this.intentAuthority = intentAuthority; this.mentionTargets = targets;
    this.signature = signature; this.snapshot = { id: ++this.revision, file, path, text, links, destinations: links.map(link => link.destination?.path ?? null), mentions }; this.render();
  }
  private action(link: OutgoingLink<TFile>, path: string): ReturnType<typeof outgoingLinkAction<TFile>> {
    return outgoingLinkAction(link, path, extension => this.app.workspace.viewTypeForExtension(extension), this.app.vault.readOnly,
      (name, source) => this.app.fileManager.getNewNotePath(name, source, true));
  }
  private render(): void {
    const snapshot = this.snapshot; if (!snapshot) { return; }
    if (!this.opening && this.bulkReview && (!this.bulkLease || !outgoingMentionBulkReviewCurrent(this.bulkReview, this.bulkLease))) {
      this.closeBulkReview(); this.message = "The note, destination or review changed. Review the current mentions again.";
    }
    this.mentionActions.clear();
    (this.bulkActions ??= new Map()).clear();
    const environment = outgoingMentionEnvironmentFor(this.authoringAuthority);
    const intentEnvironment = outgoingMentionIntentEnvironmentFor(this.intentAuthority);
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
          snapshot.mentions.forEach((mention, index) => {
            const bulkKey = `mention-bulk:${index}`, bulk = button("Review links", bulkKey), destination = this.app.vault.getFileByPath(mention.path);
            const candidate = outgoingMentionBulkCandidate(environment, destination, mention.matches) ?? outgoingMentionBulkSourceCandidate(intentEnvironment, destination, mention.matches);
            const visible = Boolean(candidate && isOutgoingMentionBulkSourceCandidate(candidate));
            bulk.textContent = visible ? "Review in Source" : "Review links"; bulk.dataset.outgoingMentionBulkMode = visible ? "visible-source" : "current-editor";
            const bulkGroup = document.createElement("div"), bulkLabel = document.createElement("span"); bulkGroup.className = "outgoing-mention-bulk-group"; bulkLabel.textContent = mention.path;
            bulk.dataset.outgoingMentionBulk = mention.path;
            if (candidate && !candidate.unavailable) { this.bulkActions.set(bulkKey, candidate); bulk.title = (visible ? "Open this note visibly in Source, then review all eligible mentions of " : "Review all eligible mentions of ") + mention.path + " before linking them together."; }
            else { bulk.dataset.outgoingUnavailable = candidate?.unavailable ?? (this.app.vault.readOnly ? "This vault is read-only." : "Wait for the current note and supported mentions before reviewing links."); bulk.title = bulk.dataset.outgoingUnavailable; }
            bulkGroup.append(bulkLabel, bulk); section.append(bulkGroup);
            if (candidate?.unavailable) { const limit = document.createElement("p"); limit.className = "discovery-pane-caption"; limit.dataset.outgoingBulkLimit = "true"; limit.textContent = candidate.unavailable; section.append(limit); }
            mention.matches.forEach((match, matchIndex) => {
            const group = document.createElement("div"); group.className = "outgoing-mention-row"; group.dataset.outgoingMentionRow = mention.path;
            const row = button(`${mention.path} - line ${position(match.from, match.to).start.line + 1}: ${snapshot.text.slice(match.from, match.to)}`, `mention:${index}:${matchIndex}`);
            row.className = "outgoing-mention-result"; row.dataset.outgoingPaneMention = String(index); row.dataset.outgoingMatch = String(matchIndex); row.title = "Reveal the exact unlinked mention in Source";
            const key = `mention-link:${index}:${matchIndex}`, link = button("Link mention", key);
            link.dataset.outgoingMentionLink = mention.path; link.dataset.outgoingMatch = String(matchIndex);
            const target = this.app.vault.getFileByPath(mention.path), choice = outgoingMentionReview(environment, target, match) ?? outgoingMentionIntentReview(intentEnvironment, target, match);
            if (choice) {
              this.mentionActions.set(key, choice); const visible = "kind" in choice && choice.kind === "visible-source";
              link.textContent = visible ? "Link in Source" : "Link mention"; link.dataset.outgoingMentionMode = visible ? "visible-source" : "current-editor";
              link.title = (visible ? "Open this note visibly in Source and link this exact occurrence to " : "Link this exact occurrence to ") + mention.path;
            }
            else { link.dataset.outgoingUnavailable = this.app.vault.readOnly ? "This vault is read-only." : "Only current, complete, supported prose mentions can be linked. Wait for note operations to finish."; link.title = link.dataset.outgoingUnavailable; }
            group.append(row, link); section.append(group);
            });
          });
        }
        if (!count) { const empty = document.createElement("p"); empty.className = "empty-outline"; empty.textContent = kind === "links" ? "No outgoing links." : "No unlinked mentions."; section.append(empty); }
      }
      fragment.append(section);
    }
    this.results.replaceChildren(fragment); this.status.textContent = this.message || (this.app.vault.lazy ? "Partial index: unlinked mentions cover only notes opened so far." : this.app.vault.indexComplete ? "Complete index: unlinked mentions cover every cached note." : ""); this.updateControls();
    if (focused) { [...this.results.querySelectorAll<HTMLButtonElement>("button")].find(button => button.dataset.outgoingKey === focused)?.focus(); }
  }
  private stale(): void { this.message = "The note or link targets changed; outgoing links have been refreshed. Choose the result again."; this.signature = ""; this.app.metadataCache.updateOpenDocuments(); this.schedule(); }
  private closeBulkReview(): void {
    if (this.bulkReview) { cancelOutgoingMentionBulk(this.bulkReview); }
    this.bulkReview = null; this.bulkLease = null; this.bulkReviewEl?.remove(); this.bulkReviewEl = null;
  }
  private async reviewBulkMentions(button: HTMLButtonElement): Promise<void> {
    const snapshot = this.snapshot, candidate = this.bulkActions.get(button.dataset.outgoingKey ?? "");
    if (!snapshot || !candidate || candidate.unavailable || this.app.vault.readOnly || !this.results.contains(button)) { return; }
    this.closeBulkReview();
    const operation = ++this.navigationToken, options = this.options, configuration = JSON.stringify(options), parent = this.leaf.parent;
    const stable = (): boolean => this.interactive() && operation === this.navigationToken && this.options === options
      && JSON.stringify(this.options) === configuration && this.leaf.parent === parent && this.options.file === snapshot.path;
    const initial = (): boolean => stable() && this.snapshot === snapshot && this.results.contains(button);
    if (!initial()) { return; }
    const visible = isOutgoingMentionBulkSourceCandidate(candidate), owned = visible ? stable : initial;
    this.opening = true; this.updateControls();
    try {
      const review = await (visible ? prepareOutgoingMentionBulkInSource(candidate, owned) : prepareOutgoingMentionBulk(candidate, owned));
      if (!owned()) { cancelOutgoingMentionBulk(review); return; }
      this.bulkReview = review; this.bulkLease = owned;
      // A freshly shown Source tab can share this pane's tab group. Reveal the
      // literal review after that visible handoff without activateLeaf's save.
      if (visible) { this.app.workspace.setActiveLeaf(this.leaf, { focus: false }); }
      const panel = outgoingMentionBulkReviewPanel(review, () => this.run(() => this.applyBulkMentions(review)), () => this.run(() => {
        if (this.bulkReview !== review || this.bulkReviewEl !== panel || !panel.isConnected) { return; }
        this.navigationToken++; this.closeBulkReview(); this.message = "Review cancelled. No links were inserted."; this.status.textContent = this.message;
        [...this.results.querySelectorAll<HTMLButtonElement>("[data-outgoing-mention-bulk]")].find(node => node.dataset.outgoingMentionBulk === review.candidate.choice.targetPath)?.focus();
      }));
      this.bulkReviewEl = panel; this.contentEl.append(panel); this.message = (visible ? "Source is open. " : "") + "Review every replacement, then link them together or cancel."; this.status.textContent = this.message;
      panel.querySelector<HTMLButtonElement>("[data-outgoing-bulk-cancel]")?.focus();
    } catch (error) { this.message = error instanceof Error ? error.message : String(error); this.status.textContent = this.message; }
    finally { this.opening = false; this.updateControls(); }
  }
  private async applyBulkMentions(review: OutgoingMentionBulkReview): Promise<void> {
    const lease = this.bulkLease;
    if (this.bulkReview !== review || !lease || !this.bulkReviewEl?.isConnected || this.app.vault.readOnly) { return; }
    this.opening = true; this.updateControls();
    try {
      await applyOutgoingMentionBulk(review, () => this.bulkReview === review && Boolean(this.bulkReviewEl?.isConnected) && lease());
      this.message = `Linked ${review.changes.length} mentions. One Undo in the note restores every reviewed occurrence.`;
    } catch (error) { this.message = error instanceof Error ? error.message : String(error); }
    finally { this.closeBulkReview(); this.opening = false; this.signature = ""; this.updateControls(); this.schedule(); }
  }
  private navigationWitness(snapshot: OutgoingSnapshot, button: HTMLButtonElement): () => boolean {
    const options = this.options, configuration = JSON.stringify(options), parent = this.leaf.parent, root = this.app.vault.rootPath;
    const preferences = ["newLinkFormat", "useMarkdownLinks", "newFileLocation", "newFileFolderPath"].map(key => [key, this.app.vault.getConfig(key)] as const);
    const peers = (): MarkdownView[] => this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === snapshot.file);
    const initialPeers = peers().map(view => ({ view, state: this.authoringState(view) })), session = this.app.workspace.sessions.get(snapshot.path);
    const saved = session ? { document: session.document, path: session.document.file.path, version: session.document.version, content: session.document.content, bom: session.document.hasBom === true } : null;
    const capture = (path: string) => {
      const entry = this.app.metadataCache.getDocument(path);
      return entry ? { document: entry.document, cache: entry.cache, text: entry.text, missing: entry.missing, path: entry.document.file.path,
        version: entry.document.version, content: entry.document.content, bom: entry.document.hasBom === true } : null;
    };
    const source = capture(snapshot.path), index = Number(button.dataset.outgoingPaneLink), mention = snapshot.mentions[Number(button.dataset.outgoingPaneMention)];
    const destination = button.dataset.outgoingPaneLink !== undefined ? snapshot.links[index]?.destination ?? null : this.app.vault.getFileByPath(mention?.path ?? "");
    const destinationPath = destination?.path, target = destinationPath ? capture(destinationPath) : null;
    const action = button.dataset.outgoingPaneLink !== undefined && snapshot.links[index] ? JSON.stringify(this.action(snapshot.links[index], snapshot.path)) : null;
    const semantics = (value: OutgoingSnapshot): string => JSON.stringify([value.links.map(link => [link.reference, link.target, link.destination?.path, link.ambiguous, link.occurrences]), value.destinations, value.mentions]);
    const before = semantics(snapshot);
    const currentDocument = (path: string, prior: ReturnType<typeof capture>): boolean => {
      if (!prior) { return true; }
      const current = this.app.metadataCache.getDocument(path);
      // A metadata refresh owns new transport documents, even with unchanged
      // bytes. Its cache and exact values remain the same navigation witness;
      // actual saved-session/editor/CM owners are pinned independently below.
      return Boolean(current && current.cache === prior.cache && current.text === prior.text && current.missing === prior.missing
        && current.document.file.path === prior.path && current.document.version === prior.version && current.document.content === prior.content && (current.document.hasBom === true) === prior.bom
        && prior.document.file.path === prior.path && prior.document.version === prior.version && prior.document.content === prior.content && (prior.document.hasBom === true) === prior.bom);
    };
    return () => {
      const current = this.snapshot, currentPeers = peers();
      return this.interactive() && this.app.vault.rootPath === root && snapshot.file.path === snapshot.path && this.app.vault.getFileByPath(snapshot.path) === snapshot.file
        && this.options === options && JSON.stringify(this.options) === configuration && this.leaf.parent === parent
        && preferences.every(([key, value]) => this.app.vault.getConfig(key) === value) && this.app.workspace.sessions.get(snapshot.path) === session
        && (!saved || session?.document === saved.document && saved.document.file.path === saved.path && saved.document.version === saved.version && saved.document.content === saved.content && (saved.document.hasBom === true) === saved.bom)
        && currentPeers.length === initialPeers.length && initialPeers.every(peer => currentPeers.includes(peer.view)
          && this.authoringState(peer.view).every((value, offset) => value === peer.state[offset]) && peer.view.editor.getValue() === snapshot.text)
        && currentDocument(snapshot.path, source) && (!destination || destination.path === destinationPath && this.app.vault.getFileByPath(destinationPath!) === destination && currentDocument(destinationPath!, target))
        && Boolean(current && current.file === snapshot.file && current.path === snapshot.path && current.text === snapshot.text && semantics(current) === before
          && (action === null || JSON.stringify(this.action(current.links[index], snapshot.path)) === action));
    };
  }
  private async linkMention(button: HTMLButtonElement): Promise<void> {
    const snapshot = this.snapshot, choice = this.mentionActions.get(button.dataset.outgoingKey ?? "");
    if (!snapshot || !choice || this.app.vault.readOnly || !this.results.contains(button)) { return; }
    const operation = ++this.navigationToken; this.opening = true; this.updateControls();
    try {
      if ("kind" in choice) {
        const options = this.options, configuration = JSON.stringify(options), parent = this.leaf.parent;
        await linkOutgoingMentionInSource(choice, () => this.interactive() && operation === this.navigationToken && this.options === options
          && JSON.stringify(this.options) === configuration && this.options.file === snapshot.path && this.leaf.parent === parent);
      } else {
        await linkOutgoingMention(choice, () => this.interactive() && operation === this.navigationToken && this.snapshot === snapshot
          && this.options.file === snapshot.path && this.results.contains(button));
      }
      this.message = "Linked the mention. Undo in the note restores its original text.";
    } catch (error) { this.message = error instanceof Error ? error.message : String(error); }
    finally { this.opening = false; this.signature = ""; this.updateControls(); this.schedule(); }
  }
  private async navigate(button: HTMLButtonElement, tab: boolean): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || Number(button.dataset.outgoingRevision) !== snapshot.id || !this.results.contains(button)) { return; }
    const currentNavigation = this.navigationWitness(snapshot, button);
    const operation = ++this.navigationToken; this.opening = true; this.updateControls();
    try {
      await this.app.metadataCache.refresh();
      if (!this.interactive() || operation !== this.navigationToken) { return; }
      const source = this.app.metadataCache.getDocument(snapshot.path), peer = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).find(view => view instanceof MarkdownView && view.file === snapshot.file);
      if (!currentNavigation() || this.options.file !== snapshot.path || this.app.vault.getFileByPath(snapshot.path) !== snapshot.file || !source || source.missing || source.text !== snapshot.text || peer instanceof MarkdownView && peer.editor.getValue() !== snapshot.text) { this.stale(); return; }
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
    } finally { this.opening = false; this.updateControls(); this.schedule(); }
  }
}
