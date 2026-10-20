import DOMPurify from "dompurify";
import { Marked, Renderer, type Token, type Tokens } from "marked";
import type { App } from "./app";
import { getBrowserHost, requestJson, type VaultResource } from "./contracts";
import { reportError } from "./dom";
import { icon } from "./icons";
import { observeCalloutStyles } from "./callout-styles";
import { parseLinktext, resolveLink, resolveSubpath } from "./links";
import { parseMarkdown, validTag } from "./markdown";
import { MAX_MERMAID_BLOCKS } from "./mermaid-policy";
import { mountMermaid } from "./mermaid-renderer";
import { markdownProcessorsVersion, observeMarkdownProcessors, processRenderedMarkdown } from "./markdown-postprocessors";
import { Component, MarkdownRenderChild } from "./plugin";
import type { HoverPopover } from "./hover";
import type { TFile } from "./vault";
import type { WorkspaceLeaf } from "./workspace";

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

const markdown = new Marked({
  gfm: true,
  renderer: {
    image({ href, text, title }) { return imageMarkup(href, text, false, title); },
  },
  extensions: [{
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
  const destination = resolveLink(app.vault.getFiles(), href, sourcePath, !wiki)?.file;
  if (!destination) {
    throw new Error("The linked file does not exist: " + href);
  }
  if (!app.workspace.viewTypeForExtension(destination.extension)) {
    throw new Error(`No view is registered for .${destination.extension || "(no extension)"} files.`);
  }
  if (destination.extension.toLowerCase() !== "md" && target.subpath) {
    throw new Error("Subpaths are not supported for this attachment view.");
  }
  app.metadataCache.updateOpenDocuments();
  const cache = app.metadataCache.getFileCache(destination);
  const position = target.subpath && cache ? resolveSubpath(cache, target.subpath) : null;
  if (target.subpath && !position) {
    throw new Error("The linked heading or block does not exist: " + href);
  }
  if (sourceLeaf) { app.workspace.setActiveLeaf(sourceLeaf, { focus: false }); }
  const leaf = app.workspace.getLeaf(newTab || keepSourceView ? "tab" : false);
  await leaf.openFile(destination);
  if (destination.extension.toLowerCase() === "md") {
    app.markdownView.setMode("preview");
    if (position) { app.markdownView.revealLine(position.start.line); }
  }
}

function headingText(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ");
}

function sourceMarkup(content: string, startLine: number): { html: string; anchors: Map<string, number>; diagrams: Map<string, string> } {
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
  return { html: markdown.parser(tokens, { ...markdown.defaults, renderer }), anchors, diagrams };
}

export class ReadingView {
  private readonly app: App;
  private readonly leaf: WorkspaceLeaf | null;
  private readonly headingPrefix: string;
  private key: string | null = null;
  private generation = 0;
  private sourcePath: string | null = null;
  private readonly urls = new Set<string>();
  private readonly diagrams = new Set<() => void>();
  private processors: ReturnType<typeof processRenderedMarkdown> | null = null;
  private unwatchProcessors: (() => void) | null = null;
  private unwatchCalloutColors: (() => void) | null = null;

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
      if (link && containerEl.contains(link) && event.button <= 1) {
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

  render(content: string, sourcePath: string): void {
    const root = this.app.vault.rootPath;
    const key = JSON.stringify([root, sourcePath, content, markdownProcessorsVersion()]);
    if (this.key === key) {
      return;
    }
    this.clear();
    const generation = this.generation;
    const cache = parseMarkdown(content);
    const start = cache.frontmatterPosition?.end.offset ?? 0;
    const { html, anchors, diagrams } = sourceMarkup(content.slice(start), content.slice(0, start).split(/\r\n|\n|\r/).length - 1);
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
    fragment.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6").forEach((heading, index) => {
      heading.id = `${this.headingPrefix}-heading-${index}`;
    });
    const section = document.createElement("div");
    section.className = "markdown-preview-sizer markdown-preview-section";
    section.appendChild(fragment);
    this.containerEl.replaceChildren(section);
    this.unwatchCalloutColors = observeCalloutStyles(section);
    this.key = key;
    this.sourcePath = sourcePath;
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
    const current = (): boolean => generation === this.generation && root === this.app.vault.rootPath && !this.app.changingVault;
    this.unwatchProcessors = observeMarkdownProcessors(() => {
      queueMicrotask(() => { if (current()) { this.render(content, sourcePath); } });
    });
    this.processors = processRenderedMarkdown(section, sourcePath, content, cache, current, this.leaf !== null, this.component !== undefined);
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

  whenReady(): Promise<void> { return this.processors?.ready ?? Promise.resolve(); }

  focus(): void { this.containerEl.focus({ preventScroll: true }); }

  revealLine(line: number, focus = true): void {
    const blocks = [...this.containerEl.querySelectorAll<HTMLElement>("[data-source-line]")];
    const block = blocks.findLast(entry => Number(entry.dataset.sourceLine) <= line) ?? blocks[0];
    block?.scrollIntoView({ block: "start" });
    if (focus) { this.focus(); }
  }

  revealHeading(subpath: string): void {
    const wanted = headingText(subpath.replace(/^#/, "").replaceAll("-", " "));
    const heading = [...this.containerEl.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")]
      .find(entry => headingText(entry.textContent ?? "").replaceAll("-", " ") === wanted);
    if (!heading) {
      throw new Error("The linked heading does not exist: " + subpath);
    }
    heading.scrollIntoView({ block: "start" });
    this.focus();
  }

  clear(): Promise<void> {
    this.unwatchCalloutColors?.(); this.unwatchCalloutColors = null;
    this.unwatchProcessors?.(); this.unwatchProcessors = null;
    const cleanup = this.processors?.dispose() ?? Promise.resolve();
    cleanup.catch(reportError); this.processors = null;
    this.key = null;
    this.sourcePath = null;
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
