import DOMPurify from "dompurify";
import { Marked, Renderer, type Token, type Tokens } from "marked";
import type { App } from "./app";
import { getBrowserHost, requestJson, type VaultResource } from "./contracts";
import { reportError } from "./dom";
import { icon } from "./icons";
import { observeCalloutStyles } from "./callout-styles";
import { parseLinktext, resolveLink, resolveSubpath } from "./links";
import { mediaSubpathKind, parsePdfSubpath, parseVideoSubpath } from "./media-policy";
import { parseMarkdown, validTag } from "./markdown";
import { planFootnoteRendering } from "./footnote-render-model";
import { MAX_MERMAID_BLOCKS } from "./mermaid-policy";
import { mountMath } from "./math";
import { matchBlockMath, matchInlineMath, MAX_MATH_PER_VIEW } from "./math-syntax";
import { mountMermaid } from "./mermaid-renderer";
import { NoteEmbed, newEmbedScope, type EmbedScope } from "./note-embed";
import { BaseEmbed } from "./base-embed";
import { baseCodeBlocks, type BaseCodeBlock } from "./base-code-blocks";
import { captureCodeHighlightTargets, highlightCodeTargets } from "./code-highlighting";
import { ReadingSearch } from "./reading-search";
import { captureReadingFolds, MAX_READING_FOLD_BLOCKS, ReadingFolding, type ReadingFoldInventory } from "./reading-folding";
import { captureReadingListFolds, ReadingListFolding } from "./reading-list-folding";
import { captureReadingCallouts, ReadingCalloutFolding } from "./reading-callout-folding";
import { captureReadingTasks, ReadingTasks, type ReadingTaskPlan } from "./reading-tasks";
import { foldStatePort, type FoldStatePort } from "./fold-state-storage";
import type { Editor } from "./editor";
import { markdownProcessorsVersion, observeMarkdownProcessors, processRenderedMarkdown } from "./markdown-postprocessors";
import { Component, MarkdownRenderChild } from "./plugin";
import type { HoverPopover } from "./hover";
import type { TFile } from "./vault";
import type { MarkdownView, WorkspaceLeaf } from "./workspace";

function imageMarkup(path: string, text: string, wiki = false, title?: string | null): string {
  const image = document.createElement("img");
  image.alt = text;
  image.dataset.slopsidianSrc = path;
  if (wiki) {
    image.dataset.wiki = "true";
  }
  if (title) {
    image.title = title;
  }
  if (wiki) {
    const embed = document.createElement("span");
    embed.className = "internal-embed";
    embed.appendChild(image);
    return embed.outerHTML;
  }
  return image.outerHTML;
}

let markSource: ((html: string, token: object) => string) | null = null;

function mathMarkup(tag: "div" | "span", display: boolean, block: boolean, raw: string, tex: string, token: object): string {
  const element = document.createElement(tag);
  element.className = "math " + (block ? "math-block" : display ? "math-display" : "math-inline");
  element.dataset.slopsidianMath = display ? "display" : "inline";
  element.dataset.slopsidianTex = tex;
  element.textContent = raw;
  const html = element.outerHTML + (block ? "\n" : "");
  return block && markSource ? markSource(html, token) : html;
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    image({ href, text, title }) { return imageMarkup(href, text, false, title); },
  },
  extensions: [{
    name: "mathBlock",
    level: "block",
    start(source) {
      const index = source.search(/(?:^|\n) {0,3}\$\$/);
      return index < 0 ? undefined : source[index] === "\n" ? index + 1 : index;
    },
    tokenizer(source) {
      const match = matchBlockMath(source);
      if (match) { return { type: "mathBlock", raw: match.raw, text: match.tex }; }
    },
    renderer(token) {
      if (typeof token.text !== "string") { throw new Error("Invalid math token in rendered Markdown."); }
      return mathMarkup("div", true, true, token.raw, token.text, token);
    },
  }, {
    name: "mathInline",
    level: "inline",
    start(source) { return source.indexOf("$"); },
    tokenizer(source) {
      const match = matchInlineMath(source);
      if (match) { return { type: "mathInline", raw: match.raw, text: match.tex, display: match.display }; }
    },
    renderer(token) {
      if (typeof token.text !== "string") { throw new Error("Invalid math token in rendered Markdown."); }
      return mathMarkup("span", token.display === true, false, token.raw, token.text, token);
    },
  }, {
    name: "tag",
    level: "inline",
    start(source) { return source.indexOf("#"); },
    tokenizer(source, tokens) {
      const previous = tokens.at(-1);
      if (previous && !/\s$/.test(previous.raw)) { return; }
      const match = /^#([\p{L}\p{N}_/-]+)/u.exec(source);
      if (match && validTag(match[1])) { return { type: "tag", raw: match[0], text: match[0] }; }
    },
    renderer(token) {
      if (typeof token.text !== "string") { throw new Error("Invalid tag token in rendered Markdown."); }
      const link = document.createElement("a");
      link.className = "tag";
      link.setAttribute("href", token.text);
      link.setAttribute("rel", "noopener nofollow");
      link.textContent = token.text;
      return link.outerHTML;
    },
  }, {
    name: "highlight",
    level: "inline",
    start(source) { return source.indexOf("=="); },
    tokenizer(source) {
      const match = /^==(\S(?:[^\r\n]*?\S)?)==/.exec(source);
      if (match) { return { type: "highlight", raw: match[0], tokens: this.lexer.inlineTokens(match[1]) }; }
    },
    renderer(token) {
      if (!Array.isArray(token.tokens)) { throw new Error("Invalid highlight token in rendered Markdown."); }
      return "<mark>" + this.parser.parseInline(token.tokens) + "</mark>";
    },
  }, {
    name: "wikilink",
    level: "inline",
    start(source) {
      const index = source.indexOf("[[");
      return index > 0 && source[index - 1] === "!" ? index - 1 : index;
    },
    tokenizer(source) {
      const match = /^(!?)\[\[([^\]\r\n]+)\]\]/.exec(source);
      if (match) {
        const separator = match[2].indexOf("|");
        return {
          type: "wikilink", raw: match[0], embed: Boolean(match[1]),
          href: separator < 0 ? match[2] : match[2].slice(0, separator),
          text: separator < 0 ? match[2] : match[2].slice(separator + 1),
        };
      }
    },
    renderer(token) {
      if (typeof token.href !== "string" || typeof token.text !== "string") {
        throw new Error("Invalid wiki-link token in rendered Markdown.");
      }
      if (token.embed) {
        return imageMarkup(token.href, token.text, true);
      }
      const link = document.createElement("a");
      link.href = "#";
      link.dataset.slopsidianLink = token.href;
      link.textContent = token.text;
      link.className = "internal-link";
      return link.outerHTML;
    },
  }],
});
const readingViews = new WeakMap<HTMLElement, ReadingView>();

export async function openTagSearch(app: App, tag: string): Promise<void> {
  if (!validTag(tag.replace(/^#/, ""))) { throw new Error("This is not a valid tag: " + tag); }
  await app.core.run(() => {
    const search = app.core.getEnabledPluginById("global-search");
    if (!search || !("openGlobalSearch" in search) || typeof search.openGlobalSearch !== "function") {
      throw new Error("Enable Search to open tag results.");
    }
    search.openGlobalSearch("tag:" + tag);
  });
}

export async function openMarkdownLink(origin: WorkspaceLeaf | App, sourcePath: string, href: string, wiki: boolean, newTab = false, keepSourceView = false): Promise<void> {
  const app = origin.workspace.app;
  const sourceLeaf = "getViewState" in origin ? origin : null;
  if (!wiki && /^(?:https?:|mailto:|\/\/)/i.test(href)) {
    const url = new URL(href, document.baseURI).href;
    const viewer = app.core.getEnabledPluginById("webviewer");
    if (/^https?:\/\//i.test(url) && viewer?.options.openExternalURLs === true && "openUrl" in viewer && typeof viewer.openUrl === "function") {
      await viewer.openUrl(url, true);
      return;
    }
    if (!getBrowserHost() && typeof require === "function") {
      await require("electron").shell.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return;
  }
  const target = parseLinktext(href, !wiki);
  let destination = resolveLink(app.vault.getFiles(), href, sourcePath, !wiki)?.file;
  if (!destination) {
    if (target.subpath) { throw new Error("The linked file does not exist: " + href); }
    destination = await app.fileManager.createLinkedNote(target.path, sourcePath);
  }
  if (!app.workspace.viewTypeForExtension(destination.extension)) {
    throw new Error(`No view is registered for .${destination.extension || "(no extension)"} files.`);
  }
  const mediaKind = mediaSubpathKind(destination.extension);
  if (destination.extension.toLowerCase() !== "md" && target.subpath && !mediaKind) {
    throw new Error("Subpaths are not supported for this attachment view.");
  }
  if (mediaKind && target.subpath) { (mediaKind === "pdf" ? parsePdfSubpath : parseVideoSubpath)(target.subpath); }
  app.metadataCache.updateOpenDocuments();
  const cache = app.metadataCache.getFileCache(destination);
  const position = target.subpath && cache && !mediaKind ? resolveSubpath(cache, target.subpath) : null;
  if (target.subpath && !position && !mediaKind) {
    throw new Error("The linked heading or block does not exist: " + href);
  }
  if (sourceLeaf) { app.workspace.setActiveLeaf(sourceLeaf, { focus: false }); }
  const leaf = app.workspace.getLeaf(newTab || keepSourceView ? "tab" : false);
  await leaf.openFile(destination);
  if (mediaKind && target.subpath) { leaf.view.setEphemeralState({ subpath: target.subpath }); }
  if (destination.extension.toLowerCase() === "md") {
    app.markdownView.setMode("preview");
    if (position) { app.markdownView.revealLine(position.start.line); }
  }
}

function decodeLinktext(href: string): string {
  try { return decodeURIComponent(href); } catch { return href; }
}

function headingText(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ");
}

const taskLabelInlineTags = new Set(["A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "CODE", "DEL", "EM", "I", "IMG", "KBD", "MARK", "Q", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "WBR"]);

/** Isolate completion styling on original inline labels before processors run. */
export function decorateReadingTaskLabel(input: HTMLInputElement, item: HTMLElement): void {
  const container = input.parentElement;
  if (!container || container !== item && (container.tagName !== "P" || container.parentElement !== item) || container.firstElementChild !== input) { return; }
  let label: HTMLElement | null = null;
  for (let node: ChildNode | null = input.nextSibling; node;) {
    const next = node.nextSibling;
    if (node.nodeType === 1) {
      const element = node as HTMLElement;
      // Nested/continuation blocks remain original direct children. Note embeds
      // keep their own text styling even when their anchor was inline Markdown.
      if (!taskLabelInlineTags.has(element.tagName)) { break; }
      if (element.classList.contains("reading-task-label") || element.classList.contains("internal-embed")
        || element.tagName === "IMG" && element.dataset.slopsidianSrc !== undefined
        || element.querySelector("input,ul,ol,blockquote,pre,table,div,.internal-embed,img[data-slopsidian-src]")) { label = null; node = next; continue; }
    } else if (node.nodeType !== 3) { label = null; node = next; continue; }
    if (!label && node.nodeType === 3 && !node.textContent?.trim()) { node = next; continue; }
    if (!label) {
      label = input.ownerDocument.createElement("span"); label.className = "reading-task-label";
      container.insertBefore(label, node);
    }
    label.appendChild(node); node = next;
  }
}

function sourceMarkup(content: string, startLine: number, baseBlocks = new Map<number, BaseCodeBlock>()): { html: string; anchors: Map<string, number>; diagrams: Map<string, string>; bases: Map<string, BaseCodeBlock> } {
  const positions = new WeakMap<object, number>();
  const lines = (value: string): number => value.split("\n").length - 1;
  const isList = (token: Token): token is Tokens.List => token.type === "list";
  const isQuote = (token: Token): token is Tokens.Blockquote => token.type === "blockquote";
  const locate = (tokens: Token[], start: number): void => {
    let line = start;
    for (const token of tokens) {
      positions.set(token, line);
      if (isQuote(token)) {
        locate(token.tokens, line);
      } else if (isList(token)) {
        let offset = 0;
        for (const item of token.items) {
          const index = token.raw.indexOf(item.raw, offset);
          if (index >= 0) {
            const itemLine = line + lines(token.raw.slice(0, index));
            positions.set(item, itemLine);
            locate(item.tokens, itemLine);
            offset = index + item.raw.length;
          }
        }
      }
      line += lines(token.raw);
    }
  };
  const tokens = markdown.lexer(content.replace(/\r\n|\r/g, "\n"));
  locate(tokens, startLine);
  const anchors = new Map<string, number>();
  const diagrams = new Map<string, string>();
  const bases = new Map<string, BaseCodeBlock>();
  const mark = (html: string, token: object): string => {
    const line = positions.get(token);
    if (line === undefined) { return html; }
    const id = crypto.randomUUID();
    anchors.set(id, line);
    return html.replace(/^<([a-z][a-z0-9]*)\b/i, `<$1 data-slopsidian-source="${id}"`);
  };
  const renderer = new Renderer();
  const heading = renderer.heading.bind(renderer);
  const paragraph = renderer.paragraph.bind(renderer);
  const quote = renderer.blockquote.bind(renderer);
  const list = renderer.list.bind(renderer);
  const item = renderer.listitem.bind(renderer);
  const table = renderer.table.bind(renderer);
  const rule = renderer.hr.bind(renderer);
  renderer.heading = token => mark(heading(token), token);
  renderer.paragraph = token => mark(paragraph(token), token);
  renderer.code = token => {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    const language = token.lang?.trim().split(/\s+/)[0];
    if (language) { code.classList.add("language-" + language); }
    code.textContent = token.text + "\n";
    pre.appendChild(code);
    const html = mark(pre.outerHTML + "\n", token);
    const block = baseBlocks.get(positions.get(token) ?? -1);
    if (block && token.lang?.trim().toLowerCase() === "base"
      && token.raw.replace(/\r\n|\r/g, "\n").replace(/^ {0,3}(?=[`~])/, "").replace(/\n+$/, "") === block.source.replace(/\r\n|\r/g, "\n").replace(/\n+$/, "")) {
      const id = crypto.randomUUID(); bases.set(id, block);
      return html.replace(/^<pre\b/, `<pre data-slopsidian-base="${id}"`);
    }
    if (token.lang?.trim().split(/\s+/)[0].toLowerCase() !== "mermaid") { return html; }
    const id = crypto.randomUUID(); diagrams.set(id, token.text);
    return html.replace(/^<pre\b/, `<pre data-slopsidian-mermaid="${id}"`);
  };
  renderer.blockquote = token => {
    const html = quote(token);
    const callout = /^\[!([a-z][a-z0-9_-]*)\]([+-])?(?:[ \t]|\n|$)/i.exec(token.text);
    const heading = /^<blockquote>\n<p(?:\s[^>]*)?>\[![a-z][a-z0-9_-]*\][+-]?[ \t]*(.*?)(\n|<\/p>)/i.exec(html);
    if (!callout || !heading) { return mark(html, token); }
    const type = callout[1].toLowerCase();
    const title = heading[1] || type[0].toUpperCase() + type.slice(1);
    const body = (heading[2] === "\n" ? "<p>" : "") + html.slice(heading[0].length).replace(/<\/blockquote>\n?$/, "");
    const titleMarkup = `<span class="callout-title-inner">${title}</span>`;
    const content = `<div class="callout-content">${body}</div>`;
    return mark(callout[2]
      ? `<details class="callout is-collapsible" data-callout="${type}"${callout[2] === "+" ? " open" : ""}><summary class="callout-title">${titleMarkup}</summary>${content}</details>`
      : `<div class="callout" data-callout="${type}"><div class="callout-title">${titleMarkup}</div>${content}</div>`, token);
  };
  renderer.list = token => mark(list(token), token);
  renderer.listitem = token => mark(item(token), token);
  renderer.table = token => mark(table(token), token);
  renderer.hr = token => mark(rule(token), token);
  renderer.image = ({ href, text, title }) => imageMarkup(href, text, false, title);
  markSource = mark;
  try { return { html: markdown.parser(tokens, { ...markdown.defaults, renderer }), anchors, diagrams, bases }; }
  finally { markSource = null; }
}

export class ReadingView {
  private readonly app: App;
  private readonly leaf: WorkspaceLeaf | null;
  private readonly headingPrefix: string;
  private footnoteLinks = new WeakMap<HTMLAnchorElement, HTMLElement>();
  private headingNames = new WeakMap<HTMLElement, string>();
  private key: string | null = null;
  private generation = 0;
  private sourcePath: string | null = null;
  private readonly urls = new Set<string>();
  private readonly diagrams = new Set<() => void>();
  private processors: ReturnType<typeof processRenderedMarkdown> | null = null;
  private unwatchProcessors: (() => void) | null = null;
  private unwatchCalloutColors: (() => void) | null = null;
  private readonly embeds = new Set<NoteEmbed | BaseEmbed>();
  private missingWatch: Component | null = null;
  private embedsReady: Promise<void> = Promise.resolve();
  private search: ReadingSearch | null = null;
  private folding: ReadingFolding | null = null;
  private listFolding: ReadingListFolding | null = null;
  private calloutFolding: ReadingCalloutFolding | null = null;
  private tasks: ReadingTasks | null = null;
  private taskFocusCleanup: (() => void) | null = null;
  private foldingContext: { section: HTMLElement; inventory: ReadingFoldInventory; lists: ReturnType<typeof captureReadingListFolds>; callouts: ReturnType<typeof captureReadingCallouts>; tasks: ReturnType<typeof captureReadingTasks>;
    path: string; source: string; headingState: FoldStatePort; listState: FoldStatePort; calloutState: FoldStatePort;
    owned: () => boolean; current: () => boolean; writable: () => boolean; commit: (plan: ReadingTaskPlan) => boolean;
    document: Document; children: Element[] | null; ready: boolean } | null = null;
  private unwatchFolding: (() => void) | null = null;
  /** Set by an owning embed so nested renders share ancestry and limits. */
  embedScope: EmbedScope = newEmbedScope();
  /** Live Preview's separately mounted widgets share one containing-note budget. */
  shareEmbedBudget = false;

  constructor(origin: WorkspaceLeaf | App, readonly containerEl: HTMLElement, private readonly keepSourceView = false, private readonly component?: Component) {
    this.app = origin.workspace.app;
    this.leaf = "getViewState" in origin ? origin : null;
    this.headingPrefix = this.leaf?.id ?? crypto.randomUUID();
    component?.register(() => this.clear());
    readingViews.set(containerEl, this);
    containerEl.classList.add("markdown-preview-view", "markdown-rendered", this.leaf ? "view-content" : "markdown-renderer-fragment");
    if (this.leaf) {
      containerEl.tabIndex = 0;
      containerEl.setAttribute("role", "document");
      containerEl.setAttribute("aria-label", "Markdown reading view");
    }
    const follow = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (link && containerEl.contains(link) && link.closest(".markdown-preview-view") === containerEl && event.button <= 1) {
        event.preventDefault();
        this.follow(link, event.ctrlKey || event.metaKey || event.button === 1).catch(reportError);
      }
    };
    containerEl.addEventListener("click", follow);
    containerEl.addEventListener("auxclick", follow);
  }

  static fromElement(element: Element): ReadingView | null {
    const container = element.closest<HTMLElement>(".markdown-preview-view");
    return container ? readingViews.get(container) ?? null : null;
  }

  get context(): { leaf: WorkspaceLeaf | null; sourcePath: string } | null {
    return this.sourcePath === null ? null : { leaf: this.leaf, sourcePath: this.sourcePath };
  }

  showSearch(): boolean {
    const leaf = this.leaf, path = this.sourcePath, root = this.app.vault.rootPath, generation = this.generation;
    const file = path === null ? null : this.app.vault.getFileByPath(path);
    const current = (): boolean => Boolean(leaf && file && generation === this.generation && root === this.app.vault.rootPath
      && this.sourcePath === path && this.app.vault.getFileByPath(file.path) === file && !this.app.changingVault && !leaf.workspace.isChangingFiles
      && leaf.view.isLoaded && (leaf.view as { currentMode?: unknown }).currentMode === this && (leaf.view as { file?: TFile }).file === file);
    if (!current() || !this.containerEl.parentElement) { return false; }
    this.search ??= new ReadingSearch(this.containerEl, this.containerEl.parentElement, current, () => { this.search = null; }, {
      includeCollapsedCallout: details => this.calloutFolding?.includes(details) ?? false,
      reveal: element => this.calloutFolding?.reveal(element),
    });
    this.search.focus(); return true;
  }
  searchIsOpen(): boolean { return this.search !== null; }
  findNext(): boolean { return this.search ? this.search.next() : this.showSearch(); }
  findPrevious(): boolean { return this.search ? this.search.previous() : this.showSearch(); }
  closeSearch(focus = true): boolean { if (!this.search) { return false; } this.search.close(focus); return true; }

  /** Only this active, visible original-main render may receive bulk commands. */
  private bulkFoldTargets(): (ReadingFolding | ReadingListFolding | ReadingCalloutFolding)[] {
    const context = this.foldingContext, leaf = this.leaf;
    if (!context?.ready || !leaf || leaf.workspace.activeLeaf !== leaf || leaf.workspace.isChangingLayout || !context.current()
      || context.document !== this.containerEl.ownerDocument || context.children?.length !== context.section.childElementCount
      || !context.children.every((child, index) => context.section.children[index] === child)) { return []; }
    const targets: (ReadingFolding | ReadingListFolding | ReadingCalloutFolding)[] = [];
    if (this.app.configuration.get("app", "foldHeading") !== false && context.inventory.headings.length) {
      if (!this.folding?.canSetAll()) { return []; } targets.push(this.folding);
    }
    if (this.app.configuration.get("app", "foldIndent") !== false && context.lists.items.some(item => item.bodies.length)) {
      if (!this.listFolding?.canSetAll()) { return []; } targets.push(this.listFolding);
    }
    if (context.callouts.entries.length) {
      if (!this.calloutFolding?.canSetAll()) { return []; } targets.push(this.calloutFolding);
    }
    return targets;
  }

  canFoldAll(): boolean { return this.bulkFoldTargets().length > 0; }
  foldAll(): boolean { return this.setAllFolds(true); }
  unfoldAll(): boolean { return this.setAllFolds(false); }

  private setAllFolds(collapse: boolean): boolean {
    const targets = this.bulkFoldTargets();
    if (!targets.length) { return false; }
    for (const target of targets) { if (!target.setAll(collapse)) { return false; } }
    return true;
  }

  /** Independent view controls share this render's ownership, never its source. */
  refreshFolding(): void {
    const context = this.foldingContext;
    if (!context || !context.owned() || context.document !== this.containerEl.ownerDocument) {
      this.retireInteractions(); return;
    }
    // A same-content refresh can arrive while processors/embeds are finishing.
    // This render already retired its old controls. Keep its pending task focus
    // request until readiness; new owners and later user input still cancel it.
    if (!context.ready) { return; }
    if (context.children?.length !== context.section.childElementCount || !context.children.every((child, index) => context.section.children[index] === child)) {
      this.retireInteractions(); return;
    }
    // Passive installation must work while a saved Reading pane is restoring;
    // action availability still requires its loaded, current Reading mode.
    const changed = (): void => this.search?.visibilityChanged();
    if (this.app.configuration.get("app", "foldHeading") === false || !context.inventory.headings.length) {
      this.folding?.dispose(); this.folding = null;
    } else if (!this.folding || this.folding.isDisposed) {
      this.folding = new ReadingFolding(this.containerEl, context.section, context.inventory, context.current, changed, {
        initialCollapsed: context.headingState.load(context.path, context.source),
        onUserChange: lines => { if (context.current()) { context.headingState.save(context.path, context.source, lines); } },
      });
    }
    if (this.app.configuration.get("app", "foldIndent") === false) {
      this.listFolding?.dispose(); this.listFolding = null;
    } else if (!this.listFolding || this.listFolding.isDisposed) {
      this.listFolding = new ReadingListFolding(this.containerEl, context.section, context.lists, context.current, changed, {
        initialCollapsed: context.listState.load(context.path, context.source),
        onUserChange: lines => { if (context.current()) { context.listState.save(context.path, context.source, lines); } },
      });
    }
    if (!this.tasks || this.tasks.isDisposed) {
      this.tasks = new ReadingTasks(this.containerEl, context.section, context.tasks, {
        current: context.current, writable: context.writable, commit: context.commit, onError: reportError,
      });
    }
    if (!this.calloutFolding || this.calloutFolding.isDisposed) {
      this.calloutFolding = new ReadingCalloutFolding(this.containerEl, context.section, context.callouts, context.current, () => {}, {
        initialCollapsed: context.calloutState.load(context.path, context.source),
        onUserChange: lines => { if (context.current()) { context.calloutState.save(context.path, context.source, lines); } },
      });
    }
    this.tasks.refresh();
  }

  private retireInteractions(): void {
    this.taskFocusCleanup?.(); this.taskFocusCleanup = null;
    this.tasks?.dispose(); this.tasks = null;
    this.listFolding?.dispose(); this.listFolding = null;
    this.calloutFolding?.dispose(); this.calloutFolding = null;
    this.folding?.dispose(); this.folding = null;
  }

  render(content: string, sourcePath: string): void {
    const root = this.app.vault.rootPath;
    const key = JSON.stringify([root, sourcePath, content, markdownProcessorsVersion()]);
    if (this.key === key) {
      queueMicrotask(() => { if (this.key === key) { this.refreshFolding(); } });
      return;
    }
    this.clear();
    const generation = this.generation;
    const cache = parseMarkdown(content);
    const start = cache.frontmatterPosition?.end.offset ?? 0;
    const footnotes = planFootnoteRendering(content, cache, crypto.randomUUID());
    const markup = sourceMarkup(footnotes.source.slice(start), content.slice(0, start).split(/\r\n|\n|\r/).length - 1,
      new Map(baseCodeBlocks(content).map(block => [block.line, block])));
    let html = markup.html;
    const { anchors, diagrams, bases } = markup;
    if (footnotes.notes.length) {
      html += '<section class="footnotes" role="doc-endnotes" aria-label="Footnotes"><hr><ol>';
      for (const note of footnotes.notes) {
        const body = sourceMarkup(note.source, note.definition.position.start.line);
        for (const [key, line] of body.anchors) { anchors.set(key, line); }
        for (const [key, source] of body.diagrams) { diagrams.set(key, source); }
        html += '<li data-slopsidian-footnote-note="' + note.token + '" value="' + note.number + '">' + body.html + "</li>";
      }
      html += "</ol></section>";
    }
    const fragment = DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "button", "textarea", "select", "audio", "video", "base", "link", "meta"],
      FORBID_ATTR: ["style", "src", "srcset", "srcdoc", "autofocus", "id", "name"],
    });
    for (const input of fragment.querySelectorAll("input")) {
      if (input.type === "checkbox") {
        input.disabled = true;
        const item = input.parentElement?.tagName === "LI" ? input.parentElement : input.parentElement?.parentElement?.tagName === "LI" ? input.parentElement.parentElement : null;
        item?.classList.add("task-list-item");
        item?.classList.toggle("is-checked", input.checked);
        if (item) { decorateReadingTaskLabel(input, item); }
      } else {
        input.remove();
      }
    }
    for (const title of fragment.querySelectorAll(".callout-title")) {
      const glyph = document.createElement("span");
      glyph.className = "callout-icon";
      glyph.dataset.slopsidianCalloutIcon = "edit";
      glyph.setAttribute("aria-hidden", "true");
      glyph.append(icon("edit"));
      title.prepend(glyph);
    }
    for (const image of fragment.querySelectorAll<HTMLImageElement>('span.internal-embed > img[data-wiki="true"][data-slopsidian-src]')) {
      const embed = image.parentElement;
      if (embed) {
        embed.setAttribute("src", image.dataset.slopsidianSrc ?? "");
        embed.setAttribute("alt", image.alt);
      }
    }
    for (const node of fragment.querySelectorAll<HTMLElement>("[data-source-line]")) {
      delete node.dataset.sourceLine;
    }
    for (const node of fragment.querySelectorAll<HTMLElement>("[data-slopsidian-source]")) {
      const line = anchors.get(node.dataset.slopsidianSource ?? "");
      delete node.dataset.slopsidianSource;
      if (line !== undefined) { node.dataset.sourceLine = String(line); }
    }
    const headingNames = new Map(cache.headings.map(heading => [heading.position.start.line, heading.heading]));
    fragment.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6").forEach((heading, index) => {
      heading.id = `${this.headingPrefix}-heading-${index}`;
      const name = headingNames.get(Number(heading.dataset.sourceLine));
      if (name !== undefined) { this.headingNames.set(heading, name); }
    });
    const notes = new Map(footnotes.notes.map(note => [note.token, note]));
    const noteElements = new Map<string, HTMLElement>();
    for (const node of fragment.querySelectorAll<HTMLElement>("[data-slopsidian-footnote-note]")) {
      const token = node.dataset.slopsidianFootnoteNote!, note = notes.get(token); delete node.dataset.slopsidianFootnoteNote;
      if (!note || node.tagName !== "LI") { continue; }
      node.id = `${this.headingPrefix}-footnote-${note.number}`; node.tabIndex = -1; node.dataset.footnoteNumber = String(note.number);
      node.setAttribute("aria-label", "Footnote " + note.number); noteElements.set(token, node);
    }
    const references = new Map(footnotes.references.map(reference => [reference.token, reference]));
    const counts = new Map<string, number>();
    for (const node of fragment.querySelectorAll<HTMLElement>("[data-slopsidian-footnote-ref]")) {
      const token = node.dataset.slopsidianFootnoteRef!, reference = references.get(token); delete node.dataset.slopsidianFootnoteRef;
      const destination = reference && noteElements.get(reference.note);
      if (!reference || !destination || node.tagName !== "SPAN") { continue; }
      const sup = document.createElement("sup"), link = document.createElement("a"), back = document.createElement("a");
      const index = (counts.get(reference.note) ?? 0) + 1; counts.set(reference.note, index);
      sup.className = "footnote-ref"; sup.dataset.footnoteReference = String(reference.number);
      link.id = `${this.headingPrefix}-${token}`; link.href = "#" + destination.id; link.textContent = String(reference.number);
      link.setAttribute("aria-label", "Footnote " + reference.number); link.setAttribute("role", "doc-noteref");
      back.className = "footnote-backref"; back.href = "#" + link.id; back.textContent = index === 1 ? "↩" : "↩" + index;
      back.setAttribute("aria-label", "Back to reference " + index + " for footnote " + reference.number);
      this.footnoteLinks.set(link, destination); this.footnoteLinks.set(back, link);
      sup.append(link); node.replaceWith(sup); destination.append(document.createTextNode(" "), back);
    }
    const section = document.createElement("div");
    section.className = "markdown-preview-sizer markdown-preview-section";
    section.appendChild(fragment);
    this.containerEl.replaceChildren(section);
    this.unwatchCalloutColors = observeCalloutStyles(section);
    this.key = key;
    this.sourcePath = sourcePath;
    let mathCount = 0;
    for (const node of this.containerEl.querySelectorAll<HTMLElement>("[data-slopsidian-math]")) {
      const tex = node.dataset.slopsidianTex ?? "", label = node.textContent ?? "";
      if (++mathCount > MAX_MATH_PER_VIEW) {
        const message = document.createElement("span");
        message.className = "math-error reading-embed-error"; message.setAttribute("role", "status");
        message.textContent = `Only the first ${MAX_MATH_PER_VIEW} math expressions in a view are rendered.`;
        node.replaceChildren(message, document.createTextNode(" " + label)); node.classList.add("is-error");
        continue;
      }
      mountMath(node, tex, node.dataset.slopsidianMath === "display", label);
    }
    const scope: EmbedScope = {
      depth: this.embedScope.depth,
      chain: this.embedScope.chain.includes(sourcePath) ? this.embedScope.chain : [...this.embedScope.chain, sourcePath],
      budget: this.embedScope.depth === 0 && !this.shareEmbedBudget ? { used: 0 } : this.embedScope.budget,
    };
    const inlineBases: { host: HTMLElement; block: BaseCodeBlock }[] = [];
    for (const node of section.querySelectorAll<HTMLElement>("[data-slopsidian-base]")) {
      const block = bases.get(node.dataset.slopsidianBase ?? ""); delete node.dataset.slopsidianBase;
      if (!block || node.tagName !== "PRE") { continue; }
      const host = document.createElement("div"); host.className = "internal-embed bases-code-block";
      if (node.dataset.sourceLine !== undefined) { host.dataset.sourceLine = node.dataset.sourceLine; }
      node.replaceWith(host); inlineBases.push({ host, block });
    }
    const noteEmbeds: { host: HTMLElement; file: TFile; linktext: string; uri: boolean }[] = [];
    let hasMissing = false;
    for (const image of this.containerEl.querySelectorAll<HTMLImageElement>("img[data-slopsidian-src]")) {
      const href = image.dataset.slopsidianSrc ?? "";
      if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) { continue; }
      const wiki = image.dataset.wiki === "true";
      let file: TFile | undefined;
      try { file = resolveLink(this.app.vault.getFiles(), href, sourcePath, !wiki)?.file; } catch (error) { if (error instanceof URIError) { continue; } throw error; }
      if (!file && /^(?:|md|base)$/i.test(href.split("#")[0].split("/").pop()?.match(/\.([^.]+)$/)?.[1] ?? "")) {
        const missing = document.createElement("div");
        missing.className = "internal-embed markdown-embed is-unresolved";
        missing.dataset.slopsidianEmbedState = "missing";
        const message = document.createElement("p");
        message.className = "markdown-embed-error reading-embed-error"; message.setAttribute("role", "status");
        message.textContent = "The embedded file does not exist in this vault: " + (wiki ? href : decodeLinktext(href));
        missing.append(message);
        const parent = image.parentElement;
        (wiki && parent?.classList.contains("internal-embed") ? parent : image).replaceWith(missing);
        hasMissing = true;
        continue;
      }
      if (!file || !/^(?:md|base)$/i.test(file.extension)) { continue; }
      const host = document.createElement("div");
      host.className = "internal-embed";
      host.setAttribute("src", href);
      host.setAttribute("alt", image.alt);
      const parent = image.parentElement;
      (wiki && parent?.classList.contains("internal-embed") ? parent : image).replaceWith(host);
      noteEmbeds.push({ host, file, linktext: href, uri: !wiki });
    }
    const owned = (): boolean => generation === this.generation && root === this.app.vault.rootPath;
    const current = (): boolean => owned() && !this.app.changingVault;
    if (hasMissing) {
      const watch = this.missingWatch = new Component();
      watch.load();
      const retry = (): void => { queueMicrotask(() => { if (current()) { this.key = null; this.render(content, sourcePath); } }); };
      watch.registerEvent(this.app.vault.on("create", retry));
      watch.registerEvent(this.app.vault.on("rename", retry));
    }
    for (const image of this.containerEl.querySelectorAll("img")) {
      this.loadImage(image, sourcePath, root, generation).catch(error => this.imageError(image, error instanceof Error ? error.message : String(error), generation));
    }
    let diagramCount = 0;
    for (const node of this.containerEl.querySelectorAll<HTMLElement>("[data-slopsidian-mermaid]")) {
      const source = diagrams.get(node.dataset.slopsidianMermaid ?? ""); delete node.dataset.slopsidianMermaid;
      if (source === undefined || node.tagName !== "PRE") { continue; }
      const block = document.createElement("div");
      if (node.dataset.sourceLine !== undefined) { block.dataset.sourceLine = node.dataset.sourceLine; }
      if (++diagramCount > MAX_MERMAID_BLOCKS) {
        const message = document.createElement("p"); message.className = "mermaid-status is-error"; message.setAttribute("role", "status"); message.textContent = "Only the first 32 Mermaid diagrams in a view are rendered.";
        node.before(message); continue;
      }
      node.replaceWith(block); this.diagrams.add(mountMermaid(block, source));
    }
    this.unwatchProcessors = observeMarkdownProcessors(() => {
      queueMicrotask(() => { if (current()) { this.render(content, sourcePath); } });
    });
    const codeHighlights = captureCodeHighlightTargets(section);
    const callouts = this.leaf ? captureReadingCallouts(section, content) : null;
    if (this.leaf && (cache.headings.length || cache.listItems.length || callouts?.entries.length)) {
      const leaf = this.leaf, file = this.app.vault.getFileByPath(sourcePath);
      const view = leaf.view as typeof leaf.view & { file?: TFile; reading?: ReadingView; editor?: Editor; currentMode?: unknown };
      const foldOwned = (): boolean => owned() && this.sourcePath === sourcePath && section.parentElement === this.containerEl
        && leaf.view === view && view.reading === this && view.file === file && Boolean(file) && this.app.vault.getFileByPath(sourcePath) === file
        && view.editor?.getValue() === content;
      const foldCurrent = (): boolean => foldOwned() && view.isLoaded && view.currentMode === this && !this.app.changingVault && !leaf.workspace.isChangingFiles
        && leaf.workspace.getLeafById(leaf.id) === leaf && this.containerEl.getClientRects().length > 0;
      const writable = (): boolean => foldCurrent() && !this.app.vault.readOnly && Boolean(view.editor) && !view.editor!.cm.state.readOnly
        && !view.editor!.cm.composing && !view.editor!.cm.compositionStarted;
      const commit = (plan: ReadingTaskPlan): boolean => {
        if (!writable() || plan.source !== content || !Number.isInteger(plan.from) || plan.to !== plan.from + 1
          || plan.from < 1 || plan.to >= content.length || content[plan.from - 1] !== "[" || content[plan.to] !== "]"
          || !/[ xX]/.test(content[plan.from]) || plan.insert !== "x" && plan.insert !== " ") { return false; }
        const next = content.slice(0, plan.from) + plan.insert + content.slice(plan.to);
        if (next === content) { return false; }
        const scroll = this.containerEl.scrollTop, left = this.containerEl.scrollLeft, parent = this.containerEl.parentElement;
        const parentScroll = parent?.scrollTop ?? 0;
        view.editor!.replaceExpected(content, plan.from, plan.to, plan.insert, "input.reading-task");
        if (view.editor!.getValue() !== next) { return false; }
        // The shared editor normally renders synchronously; an explicit render
        // also binds focus restoration when its notification is deferred.
        this.render(next, sourcePath);
        const committedGeneration = this.generation, document = this.containerEl.ownerDocument;
        let restore = true;
        const events = ["wheel", "pointerdown", "touchstart", "keydown"];
        const cancel = (): void => {
          restore = false;
          for (const event of events) { document.removeEventListener(event, cancel, true); }
          if (this.taskFocusCleanup === cancel) { this.taskFocusCleanup = null; }
        };
        this.taskFocusCleanup = cancel;
        for (const event of events) { document.addEventListener(event, cancel, true); }
        this.containerEl.scrollTop = scroll; this.containerEl.scrollLeft = left;
        if (parent && this.containerEl.parentElement === parent) { parent.scrollTop = parentScroll; }
        void this.whenReady().then(() => {
          if (!restore || committedGeneration !== this.generation || document !== this.containerEl.ownerDocument || root !== this.app.vault.rootPath
            || leaf.view !== view || view.file !== file || !view.isLoaded || view.currentMode !== this || view.editor?.getValue() !== next
            || this.app.vault.getFileByPath(sourcePath) !== file || this.app.changingVault || leaf.workspace.isChangingFiles || this.search
            || !document.hasFocus() || document.activeElement !== document.body && document.activeElement !== this.containerEl) { return; }
          this.containerEl.scrollTop = scroll; this.containerEl.scrollLeft = left;
          if (parent && this.containerEl.parentElement === parent) { parent.scrollTop = parentScroll; }
          if (plan.focus) { this.tasks?.focusTask(plan.line); }
        }).catch(reportError).finally(cancel);
        return true;
      };
      this.foldingContext = { section, inventory: captureReadingFolds(section, content.length, cache.headings),
        path: sourcePath, source: content, headingState: foldStatePort(this.app, "reading-headings"), listState: foldStatePort(this.app, "reading-lists"), calloutState: foldStatePort(this.app, "reading-callouts"),
        lists: captureReadingListFolds(section, content, cache.listItems), callouts: callouts!, tasks: captureReadingTasks(section, content, cache.listItems),
        owned: foldOwned, current: foldCurrent, writable, commit, document: this.containerEl.ownerDocument, children: null, ready: false };
      const refresh = (): void => {
        if (!foldOwned() || view.isLoaded && view.currentMode !== this) { this.retireInteractions(); }
        else { this.refreshFolding(); }
      };
      const changes = leaf.workspace.on("layout-change", refresh), ready = leaf.workspace.on("layout-ready", refresh);
      this.unwatchFolding = () => { leaf.workspace.offref(changes); leaf.workspace.offref(ready); };
    }
    this.processors = processRenderedMarkdown(section, sourcePath, content, cache, current, this.leaf !== null, this.component !== undefined);
    const mountEmbeds = (): Promise<void> => {
      if (!owned()) { return Promise.resolve(); }
      let inlineMounted: Promise<void>[] = [];
      if (inlineBases.length) {
        const leafView = this.leaf?.view as MarkdownView | undefined, session = leafView?.session;
        const parentFile = this.app.vault.getFileByPath(sourcePath), cachedParent = inlineBases.length && !this.leaf ? this.app.metadataCache.getDocument(sourcePath) : undefined;
        const parentText = this.leaf ? session?.text : cachedParent?.text;
        const offset = parentText === content ? 0 : typeof parentText === "string" ? parentText.indexOf(content) : -1;
        const exact = typeof parentText === "string" && offset >= 0 && (parentText === content || parentText.indexOf(content, offset + 1) < 0);
        const inlineOwned = (): boolean => owned() && exact && section.parentElement === this.containerEl && this.sourcePath === sourcePath
          && Boolean(parentFile) && parentFile!.path === sourcePath && this.app.vault.getFileByPath(sourcePath) === parentFile
          && (this.leaf ? this.leaf.view === leafView && leafView!.file === parentFile && Boolean(session) && leafView!.session === session
            && session!.originRoot === root && session!.text === parentText && leafView!.editor.getValue() === parentText
            : this.app.metadataCache.getDocument(sourcePath)?.text === parentText);
        inlineMounted = inlineBases.map(({ host, block }) => {
          if (!exact) {
            host.dataset.slopsidianEmbedState = "error"; host.textContent = "This inline base needs an exact current containing note. Open the note to preview it."; return Promise.resolve();
          }
          const active = (): boolean => current() && inlineOwned() && (!leafView || leafView.isLoaded && !session?.isReloading
            && (this.keepSourceView || leafView.currentMode === this) && !this.leaf!.workspace.isChangingFiles);
          const reveal = this.leaf && leafView && !this.app.vault.readOnly ? (): void => {
            if (!active()) { return; }
            leafView.setEditingMode("source");
            leafView.revealLine(parentText!.slice(0, offset + block.from).split(/\r\n|\n|\r/).length - 1);
          } : undefined;
          const embed = new BaseEmbed({ app: this.app, host, sourcePath, scope, owned: inlineOwned, active,
            inline: { text: block.configuration, from: offset + block.from, to: offset + block.to, source: block.source,
              current: () => inlineOwned() && parentText!.slice(offset + block.from, offset + block.to) === block.source, reveal },
            relink: () => { queueMicrotask(() => { if (owned()) { this.key = null; this.render(leafView?.session?.text ?? content, sourcePath); } }); } });
          this.embeds.add(embed); return embed.ready;
        });
      }
      const mounted = noteEmbeds.map(({ host, file, linktext, uri }) => {
        const relink = (): void => { queueMicrotask(() => { if (current()) { this.key = null; this.render(content, sourcePath); } }); };
        if (file.extension.toLowerCase() === "base") {
          // Bases can mount during layout restoration; their owner resumes reading
          // only after the provider and selected vault become available.
          const leafView = this.leaf?.view;
          const active = (): boolean => {
            if (!current() || this.leaf && this.leaf.view !== leafView) { return false; }
            const state = leafView?.getState();
            if (host.closest(".cm-live-widget")) { return state?.mode === "source" && state.source === false; }
            return this.keepSourceView || !this.leaf || state?.mode === "preview";
          };
          const embed = new BaseEmbed({ app: this.app, host, file, sourcePath, linktext, uri, scope, owned, active, relink });
          this.embeds.add(embed); return embed.ready;
        }
        if (!current()) { return Promise.resolve(); }
        const embed = new NoteEmbed({
          app: this.app, host, file, linktext, uri, scope,
          createView: (contentEl, childScope) => { const view = new ReadingView(this.app, contentEl, true); view.embedScope = childScope; return view; },
          relink,
        });
        this.embeds.add(embed);
        return embed.ready;
      });
      return Promise.all([...inlineMounted, ...mounted]).then(() => {});
    };
    // Nested notes run their own processors; mount them only after this view's processors have finished.
    const finishRender = (): Promise<void> => {
      // Passive decoration can finish during startup restoration. Waiting for the
      // interactive guard here would permanently skip a cached same-content render.
      highlightCodeTargets(section, codeHighlights, owned);
      return mountEmbeds();
    };
    this.embedsReady = this.processors.ready.then(finishRender, finishRender).then(() => {
      if (owned() && this.foldingContext?.section === section) {
        this.foldingContext.children = section.childElementCount <= MAX_READING_FOLD_BLOCKS ? [...section.children] : [];
        this.foldingContext.ready = true; this.refreshFolding();
      }
    });
    this.embedsReady.catch(reportError);
    this.processors.ready.catch(error => {
      if (!current()) { return; }
      reportError(error);
      const message = document.createElement("p");
      message.className = "reading-embed-error";
      message.setAttribute("role", "status");
      message.textContent = "Markdown postprocessor failed: " + (error instanceof Error ? error.message : String(error));
      section.appendChild(message);
    });
  }

  private owns(element: Element): boolean { return element.closest(".markdown-preview-view") === this.containerEl; }

  whenReady(): Promise<void> { return Promise.all([this.processors?.ready ?? Promise.resolve(), this.embedsReady]).then(() => {}); }

  focus(): void { this.containerEl.focus({ preventScroll: true }); }

  revealLine(line: number, focus = true): void {
    const blocks = [...this.containerEl.querySelectorAll<HTMLElement>("[data-source-line]")].filter(entry => this.owns(entry));
    const block = blocks.findLast(entry => Number(entry.dataset.sourceLine) <= line) ?? blocks[0];
    if (block) { this.folding?.reveal(block); this.listFolding?.reveal(block); this.calloutFolding?.reveal(block); }
    block?.scrollIntoView({ block: "start" });
    if (focus) { this.focus(); }
  }

  revealHeading(subpath: string): void {
    const wanted = headingText(subpath.replace(/^#/, "").replaceAll("-", " "));
    const heading = [...this.containerEl.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")]
      .filter(entry => this.owns(entry)).find(entry => headingText(entry.textContent ?? "").replaceAll("-", " ") === wanted
        || headingText(this.headingNames.get(entry) ?? "").replaceAll("-", " ") === wanted);
    if (!heading) {
      throw new Error("The linked heading does not exist: " + subpath);
    }
    this.folding?.reveal(heading);
    this.listFolding?.reveal(heading);
    this.calloutFolding?.reveal(heading);
    heading.scrollIntoView({ block: "start" });
    this.focus();
  }

  clear(): Promise<void> {
    this.closeSearch(false);
    this.unwatchFolding?.(); this.unwatchFolding = null;
    this.retireInteractions(); this.foldingContext = null;
    this.unwatchCalloutColors?.(); this.unwatchCalloutColors = null;
    this.unwatchProcessors?.(); this.unwatchProcessors = null;
    this.missingWatch?.unload(); this.missingWatch = null;
    const embeds = [...this.embeds].map(embed => embed.dispose()); this.embeds.clear(); this.embedsReady = Promise.resolve();
    const cleanup = Promise.all([this.processors?.dispose() ?? Promise.resolve(), ...embeds]).then(() => {});
    cleanup.catch(reportError); this.processors = null;
    this.key = null;
    this.sourcePath = null;
    this.footnoteLinks = new WeakMap(); this.headingNames = new WeakMap();
    this.generation++;
    for (const dispose of this.diagrams) { dispose(); } this.diagrams.clear();
    this.containerEl.querySelectorAll("audio").forEach(audio => { audio.pause(); audio.removeAttribute("src"); audio.load(); });
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
    this.containerEl.replaceChildren();
    return cleanup;
  }

  private async follow(link: HTMLAnchorElement, newTab: boolean): Promise<void> {
    const footnote = this.footnoteLinks.get(link);
    if (footnote && this.containerEl.contains(footnote) && this.owns(footnote)) {
      this.folding?.reveal(footnote);
      this.listFolding?.reveal(footnote);
      this.calloutFolding?.reveal(footnote);
      footnote.scrollIntoView({ block: "center" }); footnote.focus({ preventScroll: true }); return;
    }
    const wiki = link.dataset.slopsidianLink;
    const href = wiki ?? link.getAttribute("href");
    if (!href || this.sourcePath === null) {
      return;
    }
    if (link.classList.contains("tag")) {
      await openTagSearch(this.app, href);
      return;
    }
    await openMarkdownLink(this.leaf ?? this.app, this.sourcePath, href, wiki !== undefined, newTab, this.keepSourceView);
  }

  private async loadImage(image: HTMLImageElement, sourcePath: string, root: string | null, generation: number): Promise<void> {
    const href = image.dataset.slopsidianSrc;
    if (!href || !root) {
      throw new Error("Use Markdown image syntax to display a vault image.");
    }
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
      throw new Error("External images are not loaded automatically.");
    }
    const app = this.app;
    const file = resolveLink(app.vault.getFiles(), href, sourcePath, image.dataset.wiki !== "true")?.file;
    if (!file) {
      throw new Error("The image does not exist in this vault: " + href);
    }
    const resource = await requestJson<VaultResource>(`/api/resource?path=${encodeURIComponent(file.path)}&root=${encodeURIComponent(root)}`);
    if (generation !== this.generation || app.vault.rootPath !== root || !this.containerEl.contains(image)) {
      return;
    }
    const bytes = Uint8Array.from(atob(resource.base64), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: resource.contentType }));
    this.urls.add(url);
    if (resource.contentType.startsWith("audio/")) {
      const player = document.createElement("audio");
      player.controls = true; player.preload = "metadata";
      player.dataset.vaultAudio = file.path; player.setAttribute("aria-label", image.alt || file.name);
      player.onerror = () => {
        if (generation !== this.generation) { return; }
        const error = document.createElement("span"); error.className = "reading-embed-error"; error.setAttribute("role", "status");
        error.textContent = `${file.name}: This host could not decode the audio file.`; player.replaceWith(error);
      };
      player.src = url; image.replaceWith(player); return;
    }
    image.onerror = () => this.imageError(image, "The image could not be decoded.", generation);
    image.src = url;
  }

  private imageError(image: HTMLImageElement, message: string, generation: number): void {
    if (generation !== this.generation || !this.containerEl.contains(image)) {
      return;
    }
    const error = document.createElement("span");
    error.className = "reading-embed-error";
    error.setAttribute("role", "status");
    error.textContent = `${image.alt || "Image"}: ${message}`;
    image.replaceWith(error);
  }
}

export function createMarkdownRenderer(hostApp: App) {
  abstract class MarkdownRenderer extends MarkdownRenderChild {
    app = hostApp;
    hoverPopover: HoverPopover | null = null;
    abstract get file(): TFile;

    static renderMarkdown(markdown: string, element: HTMLElement, sourcePath: string, component: Component): Promise<void> {
      return MarkdownRenderer.render(hostApp, markdown, element, sourcePath, component);
    }

    static async render(app: App, markdown: string, element: HTMLElement, sourcePath: string, component: Component): Promise<void> {
      if (typeof markdown !== "string" || typeof sourcePath !== "string" || !(element instanceof HTMLElement) || !(component instanceof Component)) {
        throw new Error("Markdown rendering requires text, a source path, an HTML element and an owning Component.");
      }
      const container = document.createElement("div");
      element.appendChild(container);
      const child = new MarkdownRenderChild(container);
      const reading = new ReadingView(app, container, true, child);
      const observer = new MutationObserver(() => {
        if (!element.contains(container)) {
          observer.disconnect();
          component.removeChild(child);
        }
      });
      child.register(() => observer.disconnect());
      observer.observe(element, { childList: true, subtree: true });
      component.addChild(child);
      reading.render(markdown, sourcePath);
      await reading.whenReady();
    }
  }
  return MarkdownRenderer;
}
