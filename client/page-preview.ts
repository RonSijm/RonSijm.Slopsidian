import type { Text } from "@codemirror/state";
import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { parseLinktext, resolveLink, resolveSubpath } from "./links";
import { parseMarkdown, type LinkCache } from "./markdown";
import { Component } from "./plugin";
import { HoverPopover, type HoverLinkEvent, type HoverParent } from "./hover";
import { ReadingView } from "./reading";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";
import { reportError } from "./dom";

function modifier(event: MouseEvent | KeyboardEvent): boolean {
  return navigator.platform.startsWith("Mac") ? event.metaKey : event.ctrlKey;
}

function isHoverParent(value: unknown): value is HoverParent {
  if (!value || typeof value !== "object") { return false; }
  if (!("hoverPopover" in value) || value.hoverPopover === undefined) { Object.assign(value, { hoverPopover: null }); }
  return "hoverPopover" in value && (value.hoverPopover === null || value.hoverPopover instanceof HoverPopover);
}

class PagePreview extends HoverPopover {
  private readonly content = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly reading: ReadingView;
  private generation = 0;
  private rendered = "";

  constructor(private readonly app: App, readonly hover: HoverLinkEvent, leaf: WorkspaceLeaf) {
    super(hover.hoverParent, hover.targetEl, 300, hover.targetEl ? null : { x: hover.event.clientX, y: hover.event.clientY });
    this.hoverEl.classList.add("page-preview-popover");
    this.hoverEl.setAttribute("aria-label", "Page preview");
    const title = document.createElement("div");
    title.className = "page-preview-title";
    title.textContent = hover.linktext;
    this.status.className = "page-preview-status";
    this.status.setAttribute("role", "status");
    this.content.className = "page-preview-content";
    this.hoverEl.append(title, this.status, this.content);
    this.reading = new ReadingView(leaf, this.content, true);
    this.register(() => { this.generation++; this.reading.clear(); });
    this.registerDomEvent(this.hoverEl, "hover-shown", () => this.reveal());
    for (const name of ["changed", "resolved", "deleted"]) {
      this.registerEvent(app.metadataCache.on(name, () => this.refresh()));
    }
    this.refresh();
  }

  private refresh(): void {
    const generation = ++this.generation;
    const root = this.app.vault.rootPath;
    this.render(generation, root).catch(error => {
      if (generation === this.generation && root === this.app.vault.rootPath) { this.fail(error); }
    });
  }

  private fail(error: unknown): void {
    if (this.state === "hidden") { return; }
    this.reading.clear();
    this.rendered = "";
    this.status.textContent = error instanceof Error ? error.message : String(error);
    this.status.classList.add("is-error");
    this.hoverEl.dataset.previewState = "error";
    this.position();
  }

  private async render(generation: number, root: string | null): Promise<void> {
    if (this.state === "hidden") { return; }
    const parsed = parseLinktext(this.hover.linktext);
    const file = resolveLink(this.app.vault.getFiles(), this.hover.linktext, this.hover.sourcePath ?? "")?.file;
    if (!file) { throw new Error("The linked note does not exist: " + this.hover.linktext); }
    if (file.extension.toLowerCase() !== "md") { throw new Error("Page preview currently supports Markdown notes only: " + file.path); }
    this.app.metadataCache.updateOpenDocuments();
    const document = this.app.metadataCache.getDocument(file.path);
    const text = document && !document.missing ? document.text : await this.app.vault.cachedRead(file);
    if (generation !== this.generation || root !== this.app.vault.rootPath || this.state === "hidden") { return; }
    if (parsed.subpath && !resolveSubpath(parseMarkdown(text), parsed.subpath)) { throw new Error("The linked heading or block does not exist: " + parsed.subpath); }
    const key = JSON.stringify([file.path, text, parsed.subpath]);
    if (key === this.rendered) { return; }
    this.reading.render(text, file.path);
    this.rendered = key;
    this.status.textContent = "";
    this.status.classList.remove("is-error");
    this.hoverEl.dataset.previewPath = file.path;
    this.hoverEl.dataset.previewState = "ready";
    this.reveal();
    this.position();
  }

  private reveal(): void {
    if (this.state !== "shown" || this.hoverEl.dataset.previewState !== "ready") { return; }
    const path = this.hoverEl.dataset.previewPath!;
    const text = this.app.metadataCache.getDocument(path)?.text;
    const subpath = parseLinktext(this.hover.linktext).subpath;
    if (text !== undefined && subpath) {
      const position = resolveSubpath(parseMarkdown(text), subpath);
      if (position) { this.reading.revealLine(position.start.line, false); }
    }
  }
}

export class PagePreviews {
  readonly id = "page-preview";
  private readonly parents = new WeakMap<object, HoverParent>();
  private readonly links = new WeakMap<Text, LinkCache[]>();
  private readonly popovers = new Set<PagePreview>();
  private pending: HoverLinkEvent | null = null;
  private active = false;

  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    core.register(this.id, () => this.activate(), this);
  }

  private activate(): () => Promise<void> {
    this.active = true;
    const scope = new Component();
    scope.registerEvent(this.app.workspace.on("hover-link", value => this.onHover(value)));
    scope.registerDomEvent(document, "pointermove", event => {
      if (!(event instanceof MouseEvent)) { return; }
      let candidate: HoverLinkEvent | null;
      try { candidate = this.detect(event); } catch (error) {
        if (!(error instanceof URIError)) { throw error; }
        this.pending = null;
        reportError(error);
        return;
      }
      if (candidate) {
        this.pending = candidate;
        this.app.workspace.trigger("hover-link", candidate);
      } else if (!(event.target instanceof Node) || !this.pending?.targetEl?.contains(event.target)) {
        this.pending = null;
      }
    });
    scope.registerDomEvent(document, "keydown", event => {
      if (event instanceof KeyboardEvent && modifier(event) && this.pending && (event.key === "Control" || event.key === "Meta")) { this.show(this.pending); }
    });
    const dismiss = async (): Promise<void> => {
      this.pending = null;
      await Promise.all([...this.popovers].map(popover => popover.unload()));
    };
    scope.registerEvent(this.app.workspace.on("file-open", dismiss));
    scope.registerEvent(this.app.workspace.on("layout-change", () => {
      if (this.app.workspace.isChangingLayout) { return dismiss(); }
    }));
    return async () => { this.active = false; await scope.unload(); await dismiss(); };
  }

  private parent(owner: object): HoverParent {
    let parent = this.parents.get(owner);
    if (!parent) { parent = { hoverPopover: null }; this.parents.set(owner, parent); }
    return parent;
  }

  private detect(event: MouseEvent): HoverLinkEvent | null {
    const target = event.target;
    if (!(target instanceof Element) || document.querySelector("dialog[open]")) { return null; }
    const link = target.closest<HTMLAnchorElement>("a");
    const reading = link ? ReadingView.fromElement(link) : null;
    if (link?.classList.contains("tag")) { return null; }
    if (link && reading?.context) {
      const wiki = link.dataset.slopsidianLink;
      const href = wiki ?? link.getAttribute("href");
      if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) { return null; }
      const parsed = parseLinktext(href, wiki === undefined);
      const file = resolveLink(this.app.vault.getFiles(), href, reading.context.sourcePath, wiki === undefined)?.file;
      return this.candidate(event, "preview", this.parent(reading), link, file ? file.path + parsed.subpath : href, reading.context.sourcePath);
    }
    const source = target.closest<HTMLElement>(".workspace-leaf");
    const leaf = source?.dataset.leafId ? this.app.workspace.getLeafById(source.dataset.leafId) : null;
    if (leaf?.view instanceof MarkdownView && leaf.view.file && target.closest(".cm-content")) {
      const editor = leaf.view.editor.cm;
      const offset = editor.posAtCoords({ x: event.clientX, y: event.clientY });
      if (offset === null) { return null; }
      let links = this.links.get(editor.state.doc);
      if (!links) {
        const cache = parseMarkdown(editor.state.doc.toString());
        links = [...cache.links, ...cache.embeds, ...cache.frontmatterLinks];
        this.links.set(editor.state.doc, links);
      }
      const found = links.find(link => link.position.start.offset <= offset && offset < link.position.end.offset);
      if (found && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(found.link)) {
        const parsed = parseLinktext(found.link, found.kind === "markdown" || found.kind === "reference");
        const file = resolveLink(this.app.vault.getFiles(), found.link, leaf.view.file.path, found.kind === "markdown" || found.kind === "reference")?.file;
        return this.candidate(event, "editor", this.parent(leaf.view), target, file ? file.path + parsed.subpath : found.link, leaf.view.file.path);
      }
    }
    const tab = target.closest<HTMLElement>("[data-tab-id]");
    const tabLeaf = tab?.dataset.tabId ? this.app.workspace.getLeafById(tab.dataset.tabId) : null;
    if (tab && tabLeaf?.view instanceof MarkdownView && tabLeaf.view.file && !target.closest("button")) {
      return this.candidate(event, "tab-header", this.parent(tabLeaf), tab, tabLeaf.view.file.path, "");
    }
    const graphNode = target.closest<SVGElement>("[data-graph-node]");
    if (graphNode?.dataset.graphPath && graphNode.dataset.graphKind !== "tag" && leaf) {
      return this.candidate(event, "graph", this.parent(leaf.view), graphNode, graphNode.dataset.graphPath, "");
    }
    const file = target.closest<HTMLElement>("[data-note-path]");
    if (file?.dataset.notePath) {
      return this.candidate(event, "file-explorer", this.parent(file), file, file.dataset.notePath, "");
    }
    const result = target.closest<HTMLElement>("[data-search-file]");
    if (result?.dataset.searchFile && target.closest("button")) {
      return this.candidate(event, "search", this.parent(result), result, result.dataset.searchFile, "");
    }
    const outline = target.closest<HTMLElement>("[data-outline-line]");
    const active = this.app.workspace.getActiveFile();
    if (outline && active) {
      const heading = this.app.metadataCache.getFileCache(active)?.headings.find(heading => heading.position.start.line === Number(outline.dataset.outlineLine));
      if (heading) { return this.candidate(event, "outline", this.parent(outline), outline, active.path + "#" + heading.heading, ""); }
    }
    return null;
  }

  private candidate(event: MouseEvent, source: string, hoverParent: HoverParent, targetEl: Element, linktext: string, sourcePath: string): HoverLinkEvent {
    return { event, source, hoverParent, targetEl, linktext, sourcePath };
  }

  private onHover(value: unknown): void {
    if (!this.active || !value || typeof value !== "object" || !("event" in value) || !(value.event instanceof MouseEvent)
      || !("source" in value) || typeof value.source !== "string" || !("hoverParent" in value) || !isHoverParent(value.hoverParent)
      || !("targetEl" in value) || value.targetEl !== null && !(value.targetEl instanceof Element)
      || !("linktext" in value) || typeof value.linktext !== "string"
      || "sourcePath" in value && value.sourcePath !== undefined && typeof value.sourcePath !== "string") {
      if (this.active) { reportError(new Error("Invalid hover-link event.")); }
      return;
    }
    const hover: HoverLinkEvent = {
      event: value.event, source: value.source, hoverParent: value.hoverParent,
      targetEl: value.targetEl, linktext: value.linktext, sourcePath: "sourcePath" in value && typeof value.sourcePath === "string" ? value.sourcePath : undefined,
    };
    this.pending = hover;
    const required = Object.hasOwn(this.options, hover.source) ? this.options[hover.source] : this.app.workspace.hoverLinkSources[hover.source]?.defaultMod ?? true;
    if (typeof required !== "boolean") { reportError(new Error("A hover modifier override must be Boolean: " + hover.source)); return; }
    if (!required || modifier(hover.event)) { this.show(hover); }
  }

  private show(hover: HoverLinkEvent): void {
    if (!this.active || this.app.changingVault || hover.targetEl && !hover.targetEl.isConnected) { return; }
    const current = hover.hoverParent.hoverPopover;
    if (current instanceof PagePreview && current.state !== "hidden" && current.hover.linktext === hover.linktext && current.hover.sourcePath === hover.sourcePath && current.targetEl === hover.targetEl) { return; }
    const source = hover.targetEl?.closest<HTMLElement>("[data-leaf-id]")?.dataset.leafId;
    const leaf = source ? this.app.workspace.getLeafById(source) : this.app.workspace.getMostRecentLeaf();
    if (!leaf) { reportError(new Error("Page preview needs an open workspace pane.")); return; }
    const popover = new PagePreview(this.app, hover, leaf);
    this.popovers.add(popover);
    popover.register(() => this.popovers.delete(popover));
  }
}
