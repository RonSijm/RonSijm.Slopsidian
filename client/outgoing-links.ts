import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { reportError } from "./dom";
import { icon, iconButton } from "./icons";
import { outgoingLinks, resolveSubpath, type OutgoingLink } from "./links";
import { outgoingMentions, sourcePositions } from "./markdown";
import { outgoingLinkAction } from "./outgoing-pane-model";
import { OutgoingPaneView } from "./outgoing-pane-view";
import { linkOutgoingMention, outgoingMentionEnvironment, outgoingMentionReview } from "./outgoing-mention-authoring";
import { linkOutgoingMentionInSource, outgoingMentionIntentAuthority, outgoingMentionIntentEnvironmentFor, outgoingMentionIntentReview } from "./outgoing-mention-intent";
import { applyOutgoingMentionBulk, cancelOutgoingMentionBulk, isOutgoingMentionBulkSourceCandidate, outgoingMentionBulkCandidate, outgoingMentionBulkSourceCandidate, outgoingMentionBulkReviewCurrent, prepareOutgoingMentionBulk, prepareOutgoingMentionBulkInSource, type OutgoingMentionBulkActionCandidate, type OutgoingMentionBulkReview } from "./outgoing-mention-bulk";
import { outgoingMentionBulkReviewPanel } from "./outgoing-mention-bulk-review";
import { openOutgoingNewDestination, type OutgoingNewDestinationModal } from "./outgoing-new-destination-review";
import { newDestinationSourceAvailable } from "./outgoing-new-destination-source";
import { TFile } from "./vault";
import type { ViewCreator } from "./views";
import { MarkdownView } from "./workspace";

export class OutgoingLinks {
  readonly id = "outgoing-link";
  private panel: HTMLElement | null = null;
  private pinnedFile: string | null = null;
  private linksCollapsed = false;
  private unlinkedCollapsed = true;
  private queued = false;
  private generation = 0;
  private revision = 0;
  private linking = false;
  private mentionMessage = "";
  private intentRevision = 0;
  private authoringWatch: ReturnType<typeof setTimeout> | null = null;
  private bulkReview: OutgoingMentionBulkReview | null = null;
  private bulkLease: (() => boolean) | null = null;
  private bulkReviewEl: HTMLElement | null = null;
  private bulkToken = 0;
  private newDestinationModal: OutgoingNewDestinationModal | null = null;

  constructor(readonly app: App) {}

  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    const views: Readonly<Record<string, ViewCreator>> = { "outgoing-link": leaf => new OutgoingPaneView(leaf) };
    core.register(this.id, async () => {
      const cleanup = this.activate();
      try {
        const close = await core.installViews(this.id, views);
        return async () => { await close(); cleanup(); };
      } catch (error) { cleanup(); throw error; }
    }, this, views);
  }

  private activate(): () => void {
    const state = this.app.workspace.getViewOptions(this.id);
    for (const key of ["linksCollapsed", "unlinkedCollapsed", "pinned"]) {
      if (state[key] !== undefined && typeof state[key] !== "boolean") {
        throw new Error(`Saved outgoing links option must be a boolean: ${key}`);
      }
    }
    if (state.file !== undefined && state.file !== null && typeof state.file !== "string" || state.pinned === true && (typeof state.file !== "string" || !state.file.trim())) {
      throw new Error("A pinned outgoing links view requires a saved file path.");
    }
    this.linksCollapsed = state.linksCollapsed === true;
    this.unlinkedCollapsed = state.unlinkedCollapsed !== false;
    this.pinnedFile = state.pinned === true && typeof state.file === "string" ? state.file : null;
    const panel = document.createElement("section");
    panel.className = "outgoing-link-pane";
    this.panel = panel;
    const removeCommands = this.app.commands.install([
      { id: "outgoing-links:open", name: "Show outgoing links", callback: () => this.app.core.run(() => this.initLeaf()) },
      { id: "outgoing-links:open-for-current", name: "Pin outgoing links for current file", checkCallback: checking => this.openForCurrentFile(checking) },
      { id: "outgoing-links:open-view", name: "Open Outgoing links in a tab", callback: () => this.app.core.run(async () => {
        await this.app.workspace.getLeaf("tab").setViewState({ type: "outgoing-link", state: {}, active: true });
      }) },
    ]);
    const removeView = this.app.sidebars.register(this.id, "Outgoing links", "right", panel, icon("links"));
    const references = [
      this.app.core.on("changed", () => this.requestUpdate()),
      this.app.workspace.on("file-open", () => this.requestUpdate()),
      this.app.workspace.on("extensions-changed", () => this.requestUpdate()),
      this.app.workspace.on("editor-change", () => this.requestUpdate()),
      this.app.workspace.on("layout-change", () => this.requestUpdate()),
      this.app.metadataCache.on("finished", () => this.requestUpdate()),
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && this.pinnedFile === oldPath) { this.pinnedFile = file.path; this.persist(); this.requestUpdate(); }
      }),
      this.app.vault.on("delete", file => {
        if (file instanceof TFile && this.pinnedFile === file.path) { this.pinnedFile = null; this.persist(); this.requestUpdate(); }
      }),
    ];
    const root = this.app.vault.rootPath, generation = this.generation;
    const unwatch = this.app.configuration.watch("app", () => {
      if (this.panel === panel && panel.isConnected && root === this.app.vault.rootPath && generation === this.generation) { this.requestUpdate(); }
    });
    this.render();
    return () => {
      this.generation++;
      this.newDestinationModal?.close();
      this.bulkToken++; this.closeBulkReview();
      this.cancelAuthoringWatch();
      references.forEach(reference => reference.emitter.offref(reference));
      unwatch();
      removeView();
      removeCommands();
      this.panel = null;
    };
  }

  initLeaf(): void {
    if (!this.app.core.isEnabled(this.id)) {
      throw new Error("Enable Outgoing links before opening its view.");
    }
    this.app.sidebars.show(this.id);
  }

  openForCurrentFile(checking: boolean): boolean {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return false;
    }
    if (!checking) {
      if (this.app.core.busy || !this.app.core.isEnabled(this.id)) {
        throw new Error("Wait for Outgoing links to finish loading.");
      }
      this.pinnedFile = file.path;
      this.persist();
      this.render();
      this.initLeaf();
    }
    return true;
  }

  private persist(): void {
    this.intentRevision++;
    this.app.workspace.setViewOptions(this.id, {
      linksCollapsed: this.linksCollapsed,
      unlinkedCollapsed: this.unlinkedCollapsed,
      pinned: this.pinnedFile !== null,
      file: this.pinnedFile,
    });
  }

  private requestUpdate(): void {
    if (this.queued) {
      return;
    }
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.render();
    });
  }

  private section(label: string, collapsed: boolean, count: number, change: (collapsed: boolean) => void): { section: HTMLDetailsElement; content: HTMLElement } {
    const section = document.createElement("details");
    section.className = "outgoing-section";
    section.open = !collapsed;
    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = label;
    const total = document.createElement("span");
    total.className = "outgoing-count";
    total.textContent = String(count);
    summary.append(title, total);
    const content = document.createElement("div");
    content.className = "outgoing-results";
    section.append(summary, content);
    // Native toggle events can arrive after a metadata refresh has replaced the section.
    summary.addEventListener("click", event => {
      event.preventDefault();
      const focused = document.activeElement === summary;
      this.app.core.run(() => {
        change(!collapsed);
        this.persist();
        this.render();
        if (focused) {
          this.panel?.querySelector<HTMLElement>(`[data-outgoing-section="${section.dataset.outgoingSection}"] > summary`)?.focus();
        }
      }).catch(reportError);
    });
    return { section, content };
  }

  private message(parent: HTMLElement, text: string): void {
    const message = document.createElement("p");
    message.className = "empty-outline";
    message.textContent = text;
    parent.append(message);
  }

  private cancelAuthoringWatch(): void { if (this.authoringWatch !== null) { clearTimeout(this.authoringWatch); this.authoringWatch = null; } }
  private watchReadingSettlement(view: MarkdownView | null, ready: boolean): void {
    if (ready || !view?.session || this.app.vault.readOnly || this.unlinkedCollapsed || view.getMode() !== "preview" || !view.isLoaded || view.leaf.view !== view
      || !view.editor.cm.dom.isConnected || view.editor.cm.state.readOnly || view.session.originRoot !== this.app.vault.rootPath
      || !view.session.isSaving && !view.session.isReloading || !this.panel?.isConnected) { return; }
    const panel = this.panel, root = this.app.vault.rootPath, generation = this.generation, path = view.file?.path;
    const state = (): readonly unknown[] => [view.isLoaded, view.file, view.leaf.view, view.getMode(), view.editor, view.editor.cm, view.editor.cm.state.doc,
      view.editor.cm.dom.isConnected, view.editor.cm.state.readOnly, view.session, view.session?.document, view.session?.isSaving, view.session?.isReloading];
    const initial = state();
    const inspect = (): void => {
      this.authoringWatch = null;
      if (this.panel !== panel || !panel.isConnected || root !== this.app.vault.rootPath || generation !== this.generation || this.app.vault.readOnly
        || !this.app.core.isEnabled(this.id) || this.unlinkedCollapsed || (this.pinnedFile ?? this.app.workspace.getActiveFile()?.path) !== path) { return; }
      if (state().some((value, index) => value !== initial[index])) { this.requestUpdate(); return; }
      // Only an actual busy Reading session is watched. No source snapshots,
      // parsing or transport occurs while waiting for its owner flags to settle.
      this.authoringWatch = setTimeout(inspect, 100);
    };
    this.authoringWatch = setTimeout(inspect, 100);
  }

  private render(): void {
    this.cancelAuthoringWatch();
    const panel = this.panel;
    if (!panel) {
      return;
    }
    if (!this.linking && this.bulkReview && (!this.bulkLease || !outgoingMentionBulkReviewCurrent(this.bulkReview, this.bulkLease))) {
      this.closeBulkReview(); this.mentionMessage = "The note, destination or review changed. Review the current mentions again.";
    }
    const revision = ++this.revision, generation = this.generation, root = this.app.vault.rootPath;
    if (this.app.changingVault || !this.app.vault.rootPath) {
      panel.replaceChildren();
      this.message(panel, "Wait for the selected vault to finish loading.");
      return;
    }
    const path = this.pinnedFile ?? this.app.workspace.getActiveFile()?.path;
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    const header = document.createElement("div");
    header.className = "outgoing-header";
    const title = document.createElement("strong");
    title.textContent = "Outgoing links";
    const pin = iconButton("pin", this.pinnedFile ? "Follow active note" : "Pin outgoing links to this note", () => {
      this.app.core.run(() => {
        this.pinnedFile = this.pinnedFile ? null : this.app.workspace.getActiveFile()?.path ?? null;
        this.persist();
        this.render();
      }).catch(reportError);
    });
    pin.dataset.outgoingPin = "true";
    pin.setAttribute("aria-pressed", String(this.pinnedFile !== null));
    pin.disabled = !path;
    header.append(title, pin);
    const source = document.createElement("div");
    source.className = "outgoing-source";
    source.textContent = path ?? "No active note";
    source.title = path ?? "";
    source.dataset.outgoingSource = path ?? "";
    panel.replaceChildren(header, source);
    if (!(file instanceof TFile)) {
      this.message(panel, path ? "This note no longer exists. Unpin the view to follow the active note." : "Open a Markdown note to see its outgoing links.");
      return;
    }
    const entry = this.app.metadataCache.getDocument(file.path);
    if (!entry) {
      this.message(panel, "Metadata is unavailable for this note. Check the metadata status for errors.");
      return;
    }
    const create = document.createElement("button"); create.type = "button"; create.textContent = "New destination…"; create.dataset.outgoingNewOpen = "true";
    create.disabled = this.linking || this.app.vault.readOnly || !newDestinationSourceAvailable(this.app, file, entry.text);
    create.addEventListener("click", () => {
      if (create.disabled || this.linking || this.app.vault.readOnly || this.panel !== panel || this.revision !== revision || !panel.contains(create)) { return; }
      this.closeBulkReview();
      const token = ++this.bulkToken, intent = this.intentRevision, pinned = this.pinnedFile, links = this.linksCollapsed, unlinked = this.unlinkedCollapsed;
      const current = (): boolean => this.panel === panel && panel.isConnected && generation === this.generation && root === this.app.vault.rootPath && token === this.bulkToken
        && intent === this.intentRevision && pinned === this.pinnedFile && links === this.linksCollapsed && unlinked === this.unlinkedCollapsed
        && (this.pinnedFile ?? this.app.workspace.getActiveFile()?.path) === file.path;
      this.linking = true;
      let modal: OutgoingNewDestinationModal | null = null;
      try {
        modal = openOutgoingNewDestination(this.app, file, entry.text, { current, closed: () => {
          if (this.newDestinationModal === modal) { this.newDestinationModal = null; this.linking = false; this.render(); }
        } });
        this.newDestinationModal = modal; if (!modal) { this.linking = false; }
      } catch (error) { this.linking = false; this.mentionMessage = error instanceof Error ? error.message : String(error); }
      this.render();
    });
    header.append(create);
    const links = outgoingLinks(entry.cache, (reference, source) => this.app.metadataCache.resolveReference(reference, source), file.path);
    const linked = this.section("Links", this.linksCollapsed, links.length, collapsed => { this.linksCollapsed = collapsed; });
    linked.section.dataset.outgoingSection = "links";
    for (const link of links) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "outgoing-link-result";
      row.classList.toggle("is-unresolved", !link.destination);
      row.dataset.outgoingLink = link.reference.link;
      row.dataset.outgoingDestination = link.destination?.path ?? "";
      const label = document.createElement("span");
      label.textContent = (link.destination?.basename ?? link.target?.path ?? link.reference.link) + (link.target?.subpath ?? "");
      const count = document.createElement("span");
      count.className = "outgoing-count";
      count.textContent = link.occurrences > 1 ? String(link.occurrences) : "";
      row.append(label, count);
      const action = this.action(link, file.path);
      row.title = action.createPath ? "Create " + action.createPath : link.destination?.path ?? link.reference.link;
      if (action.reason) {
        row.disabled = true;
        row.title = action.reason;
      } else if (link.ambiguous) {
        row.title += " (multiple matching notes; using the closest path)";
      }
      row.addEventListener("click", event => this.app.core.run(() => this.follow(link, file.path, event.ctrlKey || event.metaKey)).catch(reportError));
      linked.content.append(row);
    }
    if (!links.length) {
      this.message(linked.content, "No outgoing links.");
    }
    const mentions = this.unlinkedCollapsed ? [] : outgoingMentions(entry.text, entry.cache, file.path, this.app.vault.getMarkdownFiles().map(target => ({
      path: target.path, basename: target.basename, cache: this.app.metadataCache.getFileCache(target),
    })));
    const unlinked = this.section("Unlinked mentions", this.unlinkedCollapsed, mentions.reduce((count, result) => count + result.matches.length, 0), collapsed => { this.unlinkedCollapsed = collapsed; });
    unlinked.section.dataset.outgoingSection = "unlinked";
    const position = sourcePositions(entry.text);
    const sourceViews = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView && view.isLoaded && view.file === file);
    const sourceView = sourceViews.find(view => view.getMode() === "source") ?? null;
    const environment = outgoingMentionEnvironment(this.app, file, entry.text, sourceView);
    const intentEnvironment = environment ? null : outgoingMentionIntentEnvironmentFor(outgoingMentionIntentAuthority(this.app, file, entry.text));
    this.watchReadingSettlement(sourceViews.find(view => view.getMode() === "preview") ?? null, Boolean(environment || intentEnvironment));
    for (const mention of mentions) {
      const target = this.app.vault.getFileByPath(mention.path), candidate = outgoingMentionBulkCandidate(environment, target, mention.matches) ?? outgoingMentionBulkSourceCandidate(intentEnvironment, target, mention.matches);
      const visible = Boolean(candidate && isOutgoingMentionBulkSourceCandidate(candidate));
      const bulkGroup = document.createElement("div"), bulkLabel = document.createElement("span"), bulk = document.createElement("button");
      bulkGroup.className = "outgoing-mention-bulk-group"; bulkLabel.textContent = mention.path; bulk.type = "button"; bulk.textContent = visible ? "Review in Source" : "Review links"; bulk.dataset.outgoingMentionBulk = mention.path; bulk.dataset.outgoingMentionBulkMode = visible ? "visible-source" : "current-editor";
      bulk.disabled = !candidate || Boolean(candidate.unavailable) || this.linking;
      bulk.title = candidate?.unavailable ?? (candidate ? (visible ? "Open this note visibly in Source, then review all eligible mentions of " : "Review all eligible mentions of ") + mention.path + " before linking them together." : this.app.vault.readOnly ? "This vault is read-only." : "Wait for the current note and supported mentions before reviewing links.");
      bulk.addEventListener("click", () => {
        if (!candidate || bulk.disabled || this.linking || this.app.vault.readOnly) { return; }
        this.app.core.run(() => this.reviewBulkMentions(candidate, bulk, panel, revision, generation, root, file.path)).catch(error => {
          this.mentionMessage = error instanceof Error ? error.message : String(error); this.render();
        });
      });
      bulkGroup.append(bulkLabel, bulk); unlinked.content.append(bulkGroup);
      if (candidate?.unavailable) { const limit = document.createElement("p"); limit.className = "discovery-pane-caption"; limit.dataset.outgoingBulkLimit = "true"; limit.textContent = candidate.unavailable; unlinked.content.append(limit); }
      for (const match of mention.matches) {
        const group = document.createElement("div"); group.className = "outgoing-mention-row"; group.dataset.outgoingMentionRow = mention.path;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "outgoing-mention-result";
        row.dataset.outgoingMention = mention.path;
        row.textContent = `${mention.path} - line ${position(match.from, match.to).start.line + 1}: ${entry.text.slice(match.from, match.to)}`;
        row.title = "Go to the unlinked mention in this note";
        row.addEventListener("click", () => this.app.core.run(async () => {
          await this.app.openFile(file.path);
          this.app.markdownView.setMode("source");
          this.app.editor.setSelection(position(match.from, match.to).start, position(match.from, match.to).end);
          this.app.editor.focus();
        }).catch(reportError));
        const link = document.createElement("button"); link.type = "button"; link.textContent = "Link mention"; link.dataset.outgoingMentionLink = mention.path;
        const choice = outgoingMentionReview(environment, target, match) ?? outgoingMentionIntentReview(intentEnvironment, target, match);
        const visible = choice && "kind" in choice && choice.kind === "visible-source";
        link.textContent = visible ? "Link in Source" : "Link mention"; link.dataset.outgoingMentionMode = visible ? "visible-source" : "current-editor";
        link.disabled = !choice || this.linking;
        link.title = choice ? (visible ? "Open this note visibly in Source and link this exact occurrence to " : "Link this exact occurrence to ") + mention.path : this.app.vault.readOnly ? "This vault is read-only." : "Only current, complete, supported prose mentions can be linked. Wait for note operations to finish.";
        link.addEventListener("click", () => {
          if (link.disabled || !choice || this.linking || this.app.vault.readOnly) { return; }
          this.linking = true;
          panel.querySelectorAll<HTMLButtonElement>("[data-outgoing-mention-link]").forEach(button => { button.disabled = true; });
          this.app.core.run(async () => {
            const initial = (): boolean => this.panel === panel && panel.isConnected && panel.contains(link) && this.revision === revision
              && generation === this.generation && root === this.app.vault.rootPath && (this.pinnedFile ?? this.app.workspace.getActiveFile()?.path) === file.path;
            if (!initial()) { return; }
            if ("kind" in choice) {
              const intentRevision = this.intentRevision, pinned = this.pinnedFile, linked = this.linksCollapsed, unlinked = this.unlinkedCollapsed;
              await linkOutgoingMentionInSource(choice, () => this.panel === panel && panel.isConnected && generation === this.generation
                && root === this.app.vault.rootPath && intentRevision === this.intentRevision && pinned === this.pinnedFile && linked === this.linksCollapsed
                && unlinked === this.unlinkedCollapsed && (this.pinnedFile ?? this.app.workspace.getActiveFile()?.path) === file.path);
            } else { await linkOutgoingMention(choice, initial); }
            this.mentionMessage = "Linked the mention. Undo in the note restores its original text.";
          }).catch(error => { this.mentionMessage = error instanceof Error ? error.message : String(error); })
            .finally(() => { this.linking = false; this.render(); });
        });
        group.append(row, link); unlinked.content.append(group);
      }
    }
    if (!mentions.length && !this.unlinkedCollapsed) {
      this.message(unlinked.content, "No unlinked mentions.");
    }
    panel.append(linked.section, unlinked.section);
    this.appendBulkReview(panel);
    const status = document.createElement("p"); status.className = "discovery-status"; status.dataset.outgoingMentionStatus = "true"; status.setAttribute("role", "status"); status.textContent = this.mentionMessage; panel.append(status);
  }

  private closeBulkReview(): void {
    if (this.bulkReview) { cancelOutgoingMentionBulk(this.bulkReview); }
    this.bulkReview = null; this.bulkLease = null; this.bulkReviewEl?.remove(); this.bulkReviewEl = null;
  }
  private appendBulkReview(panel: HTMLElement): void {
    const review = this.bulkReview;
    if (!review) { return; }
    const section = outgoingMentionBulkReviewPanel(review, () => {
      if (this.linking || this.bulkReview !== review || this.bulkReviewEl !== section || !panel.contains(section) || this.app.vault.readOnly) { return; }
      this.app.core.run(async () => {
        const lease = this.bulkLease;
        if (!lease || this.bulkReview !== review || !panel.contains(section)) { return; }
        this.linking = true; section.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
        try {
          await applyOutgoingMentionBulk(review, () => this.bulkReview === review && this.bulkReviewEl === section && panel.contains(section) && lease());
          this.mentionMessage = `Linked ${review.changes.length} mentions. One Undo in the note restores every reviewed occurrence.`;
        } catch (error) { this.mentionMessage = error instanceof Error ? error.message : String(error); }
        finally { this.closeBulkReview(); this.linking = false; this.render(); }
      }).catch(reportError);
    }, () => {
      if (this.linking || this.bulkReview !== review || this.bulkReviewEl !== section || !panel.contains(section)) { return; }
      this.bulkToken++; this.closeBulkReview(); this.mentionMessage = "Review cancelled. No links were inserted."; this.render();
    });
    this.bulkReviewEl = section; panel.append(section);
  }
  private async reviewBulkMentions(candidate: OutgoingMentionBulkActionCandidate, button: HTMLButtonElement, panel: HTMLElement, revision: number, generation: number, root: string | null, path: string): Promise<void> {
    if (this.linking || this.app.vault.readOnly) { return; }
    this.closeBulkReview();
    const token = ++this.bulkToken, intent = this.intentRevision, pinned = this.pinnedFile, linked = this.linksCollapsed, unlinked = this.unlinkedCollapsed;
    const owned = (): boolean => this.panel === panel && panel.isConnected && generation === this.generation && root === this.app.vault.rootPath && token === this.bulkToken
      && intent === this.intentRevision && pinned === this.pinnedFile && linked === this.linksCollapsed && unlinked === this.unlinkedCollapsed
      && (this.pinnedFile ?? this.app.workspace.getActiveFile()?.path) === path;
    const initial = (): boolean => owned() && this.revision === revision && panel.contains(button);
    if (!initial()) { return; }
    const visible = isOutgoingMentionBulkSourceCandidate(candidate), lease = visible ? owned : initial;
    this.linking = true; panel.querySelectorAll<HTMLButtonElement>("[data-outgoing-mention-link],[data-outgoing-mention-bulk]").forEach(control => { control.disabled = true; });
    try {
      const review = await (visible ? prepareOutgoingMentionBulkInSource(candidate, lease) : prepareOutgoingMentionBulk(candidate, lease));
      if (!lease()) { cancelOutgoingMentionBulk(review); return; }
      this.bulkReview = review; this.bulkLease = owned; this.mentionMessage = (visible ? "Source is open. " : "") + "Review every replacement, then link them together or cancel.";
    } catch (error) { this.mentionMessage = error instanceof Error ? error.message : String(error); }
    finally { this.linking = false; this.render(); this.bulkReviewEl?.querySelector<HTMLButtonElement>("[data-outgoing-bulk-cancel]")?.focus(); }
  }

  private action(link: OutgoingLink<TFile>, source: string): ReturnType<typeof outgoingLinkAction<TFile>> {
    return outgoingLinkAction(link, source, extension => this.app.workspace.viewTypeForExtension(extension), this.app.vault.readOnly,
      (name, source) => this.app.fileManager.getNewNotePath(name, source, true));
  }

  private async follow(link: OutgoingLink<TFile>, source: string, newTab: boolean): Promise<void> {
    const generation = this.generation;
    const root = this.app.vault.rootPath;
    await this.app.metadataCache.refresh();
    if (generation !== this.generation || root !== this.app.vault.rootPath || !link.target) {
      throw new Error("The outgoing links view changed. Choose the link again.");
    }
    let destination = this.app.metadataCache.resolveReference(link.reference, source)?.file;
    const action = this.action({ ...link, destination: destination ?? null }, source);
    if (action.reason) { throw new Error(action.reason); }
    if (!destination) {
      if (!action.createPath) { throw new Error("This outgoing link has no supported note destination."); }
      destination = await this.app.vault.create(action.createPath, "");
      await this.app.metadataCache.refresh();
    }
    if (!this.app.workspace.viewTypeForExtension(destination.extension)) {
      throw new Error(`No view is registered for .${destination.extension || "(no extension)"} files.`);
    }
    if (destination.extension.toLowerCase() !== "md" && link.target.subpath) {
      throw new Error("Subpaths are not supported for this attachment view.");
    }
    const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
    await leaf.openFile(destination);
    if (link.target.subpath) {
      const cache = this.app.metadataCache.getFileCache(destination);
      const location = cache ? resolveSubpath(cache, link.target.subpath) : null;
      if (!location) {
        throw new Error("The linked heading or block does not exist: " + link.target.subpath);
      }
      if (link.target.subpath.startsWith("#^")) {
        this.app.markdownView.setMode("source");
      }
      this.app.markdownView.revealLine(location.start.line);
    }
  }
}
