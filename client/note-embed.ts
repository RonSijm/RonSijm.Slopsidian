import type { App } from "./app";
import { Component } from "./plugin";
import { parseMarkdown } from "./markdown";
import type { TFile } from "./vault";
import { cycleMessage, embeddedMarkdown, MAX_EMBED_CHARACTERS, MAX_EMBED_DEPTH, MAX_EMBEDS_PER_VIEW } from "./note-embed-section";
import { parseLinktext } from "./links";

/** Limits and ancestry shared by every embed under one root render. */
export interface EmbedScope { depth: number; chain: readonly string[]; budget: { used: number } }

export interface EmbedChildView {
  render(content: string, sourcePath: string): void;
  clear(): Promise<void>;
  whenReady(): Promise<void>;
}

export interface NoteEmbedOptions {
  app: App;
  host: HTMLElement;
  file: TFile;
  linktext: string;
  /** True when linktext is a Markdown-link URI (percent-encoded) rather than a wiki link target. */
  uri?: boolean;
  scope: EmbedScope;
  createView(contentEl: HTMLElement, scope: EmbedScope): EmbedChildView;
  /** Called when the target was renamed or deleted, so the owner can re-resolve all links. */
  relink(): void;
}

export function newEmbedScope(): EmbedScope { return { depth: 0, chain: [], budget: { used: 0 } }; }

/** One mounted note/heading/block embed. Owns its nested view, event subscriptions and refresh generation. */
export class NoteEmbed {
  private readonly owner = new Component();
  private readonly contentEl: HTMLElement;
  private readonly child: EmbedChildView | null = null;
  private readonly root: string | null;
  private readonly subpath: string;
  private generation = 0;
  private key = "";
  private closed = false;
  private pending = false;
  private acquired = false;
  ready: Promise<void> = Promise.resolve();

  constructor(private readonly options: NoteEmbedOptions) {
    const { app, host, file, scope } = options;
    this.root = app.vault.rootPath;
    this.subpath = parseLinktext(options.linktext, options.uri === true).subpath;
    const doc = host.ownerDocument;
    host.classList.add("markdown-embed");
    host.dataset.slopsidianEmbed = "note";
    const title = doc.createElement("div");
    title.className = "markdown-embed-title";
    title.textContent = file.basename + (this.subpath ? " > " + this.subpath.replace(/^#/, "") : "");
    const open = doc.createElement("a");
    open.className = "markdown-embed-link internal-link";
    if (options.uri) { open.setAttribute("href", options.linktext); } else { open.href = "#"; open.dataset.slopsidianLink = options.linktext; }
    open.setAttribute("aria-label", "Open " + file.path);
    open.textContent = "Open";
    this.contentEl = doc.createElement("div");
    this.contentEl.className = "markdown-embed-content";
    host.replaceChildren(title, open, this.contentEl);
    if (scope.chain.includes(file.path)) { this.fail(cycleMessage(scope.chain, file.path)); return; }
    if (scope.depth >= MAX_EMBED_DEPTH) { this.fail(`Embedded notes are limited to ${MAX_EMBED_DEPTH} levels: ${file.path}`); return; }
    if (scope.budget.used >= MAX_EMBEDS_PER_VIEW) { this.fail(`Only the first ${MAX_EMBEDS_PER_VIEW} embedded notes in a view are rendered.`); return; }
    scope.budget.used++;
    this.acquired = true;
    this.child = options.createView(this.contentEl, { depth: scope.depth + 1, chain: [...scope.chain, file.path], budget: scope.budget });
    this.owner.load();
    const changed = (target: unknown): void => { if (target === file) { this.schedule(); } };
    this.owner.registerEvent(app.metadataCache.on("changed", changed));
    this.owner.registerEvent(app.vault.on("modify", changed));
    this.owner.registerEvent(app.vault.on("delete", target => { if (target === file) { this.options.relink(); } }));
    this.owner.registerEvent(app.vault.on("rename", target => { if (target === file) { this.options.relink(); } }));
    this.owner.registerEvent(app.workspace.on("active-leaf-change", () => this.schedule()));
    this.ready = this.refresh();
  }

  private current(generation: number): boolean {
    return !this.closed && generation === this.generation && this.root === this.options.app.vault.rootPath && !this.options.app.changingVault;
  }

  private fail(message: string): void {
    const error = this.contentEl.ownerDocument.createElement("p");
    error.className = "markdown-embed-error reading-embed-error";
    error.setAttribute("role", "status");
    error.textContent = message;
    this.contentEl.replaceChildren(error);
    this.options.host.classList.add("is-error");
    this.options.host.dataset.slopsidianEmbedState = "error";
  }

  private schedule(): void {
    if (this.pending || this.closed) { return; }
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (!this.closed) { this.ready = this.refresh(); this.ready.catch(() => {}); }
    });
  }

  private async refresh(): Promise<void> {
    const { app, file } = this.options;
    const generation = ++this.generation;
    try {
      app.metadataCache.updateOpenDocuments();
      const document = app.metadataCache.getDocument(file.path);
      const text = document && !document.missing ? document.text : await app.vault.cachedRead(file);
      if (!this.current(generation)) { return; }
      const section = embeddedMarkdown(text, this.subpath, parseMarkdown(text));
      if (section.length > MAX_EMBED_CHARACTERS) { throw new Error(`The embedded content exceeds ${MAX_EMBED_CHARACTERS.toLocaleString("en-US")} characters.`); }
      const key = JSON.stringify([file.path, section]);
      if (key === this.key && !this.options.host.classList.contains("is-error")) { return; }
      this.options.host.classList.remove("is-error");
      delete this.options.host.dataset.slopsidianEmbedState;
      this.key = key;
      this.child!.render(section, file.path);
      await this.child!.whenReady();
      if (this.current(generation)) { this.options.host.dataset.slopsidianEmbedState = "ready"; }
    } catch (error) {
      if (!this.current(generation)) { return; }
      await this.child?.clear();
      if (!this.current(generation)) { return; }
      this.key = "";
      this.fail((error instanceof Error ? error.message : String(error)));
    }
  }

  dispose(): Promise<void> {
    if (this.closed) { return Promise.resolve(); }
    this.closed = true;
    this.generation++;
    if (this.acquired) { this.acquired = false; this.options.scope.budget.used--; }
    this.owner.unload();
    return this.child?.clear() ?? Promise.resolve();
  }
}
