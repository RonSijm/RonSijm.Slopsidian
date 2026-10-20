import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { reportError } from "./dom";
import { icon, iconButton } from "./icons";
import { LinkCreationError, newLinkedNotePath, outgoingLinks, resolveSubpath, type OutgoingLink } from "./links";
import { outgoingMentions, sourcePositions } from "./markdown";
import { TFile } from "./vault";

export class OutgoingLinks {
  readonly id = "outgoing-link";
  private panel: HTMLElement | null = null;
  private pinnedFile: string | null = null;
  private linksCollapsed = false;
  private unlinkedCollapsed = true;
  private queued = false;
  private generation = 0;

  constructor(readonly app: App) {}

  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, () => this.activate(), this);
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
    ]);
    const removeView = this.app.sidebars.register(this.id, "Outgoing links", "right", panel, icon("links"));
    const references = [
      this.app.workspace.on("file-open", () => this.requestUpdate()),
      this.app.workspace.on("extensions-changed", () => this.requestUpdate()),
      this.app.metadataCache.on("finished", () => this.requestUpdate()),
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && this.pinnedFile === oldPath) { this.pinnedFile = file.path; this.persist(); this.requestUpdate(); }
      }),
      this.app.vault.on("delete", file => {
        if (file instanceof TFile && this.pinnedFile === file.path) { this.pinnedFile = null; this.persist(); this.requestUpdate(); }
      }),
    ];
    this.render();
    return () => {
      this.generation++;
      references.forEach(reference => reference.emitter.offref(reference));
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

  private render(): void {
    const panel = this.panel;
    if (!panel) {
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
      let unavailable = link.error;
      if (link.destination && !this.app.workspace.viewTypeForExtension(link.destination.extension)) {
        unavailable = `No view is registered for .${link.destination.extension || "(no extension)"} files.`;
      } else if (link.destination && link.destination.extension.toLowerCase() !== "md" && link.target?.subpath) {
        unavailable = "Subpaths are not supported for this attachment view.";
      }
      if (!link.destination && link.target && !unavailable) {
        try {
          row.title = "Create " + newLinkedNotePath(link.target, file.path);
        } catch (error) {
          if (!(error instanceof LinkCreationError)) {
            throw error;
          }
          unavailable = error.message;
        }
      } else {
        row.title = link.destination?.path ?? link.reference.link;
      }
      if (unavailable) {
        row.disabled = true;
        row.title = unavailable;
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
    for (const mention of mentions) {
      for (const match of mention.matches) {
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
        unlinked.content.append(row);
      }
    }
    if (!mentions.length && !this.unlinkedCollapsed) {
      this.message(unlinked.content, "No unlinked mentions.");
    }
    panel.append(linked.section, unlinked.section);
  }

  private async follow(link: OutgoingLink<TFile>, source: string, newTab: boolean): Promise<void> {
    const generation = this.generation;
    const root = this.app.vault.rootPath;
    await this.app.metadataCache.refresh();
    if (generation !== this.generation || root !== this.app.vault.rootPath || !link.target) {
      throw new Error("The outgoing links view changed. Choose the link again.");
    }
    let destination = this.app.metadataCache.resolveReference(link.reference, source)?.file;
    if (!destination) {
      destination = await this.app.vault.create(newLinkedNotePath(link.target, source), "");
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
