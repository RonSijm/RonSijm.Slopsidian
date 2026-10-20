import { StateField, Transaction, type EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Tree } from "@lezer/common";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { isEscaped, parseMarkdown, type CachedMetadata, type SourceRange } from "./markdown";
import { openMarkdownLink, openTagSearch, ReadingView } from "./reading";
import { reportError } from "./dom";
import type { MarkdownView, WorkspaceLeaf } from "./workspace";

export interface LivePreviewContext {
  readonly leaf: WorkspaceLeaf;
  readonly path: string;
  readonly root: string;
  readonly isCurrent: () => boolean;
}

const metadata = new WeakMap<Text, CachedMetadata>();
const markdownTrees = new WeakMap<Text, Tree>();
const inlineStyles: Readonly<Record<string, string>> = { StrongEmphasis: "cm-live-strong", Emphasis: "cm-live-emphasis", Strikethrough: "cm-live-strike" };
// CodeMirror can replace equivalent widget instances while retaining their DOM.
const widgetCleanups = new WeakMap<HTMLElement, () => void>();

function destroyWidget(dom: HTMLElement): void {
  const cleanup = widgetCleanups.get(dom);
  widgetCleanups.delete(dom);
  cleanup?.();
}

function cacheFor(state: EditorState): CachedMetadata {
  let cache = metadata.get(state.doc);
  if (!cache) {
    cache = parseMarkdown(state.doc.toString());
    metadata.set(state.doc, cache);
  }
  return cache;
}

export function markdownTagDecorations(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  for (const { tag, position } of cacheFor(state).tags) {
    const from = position.start.offset, to = position.end.offset;
    // Native editor tags require whitespace; Reading also tokenizes nested inline labels.
    if (from > 0 && !/\s/u.test(text[from - 1])) { continue; }
    const attributes = { "data-markdown-tag": tag, spellcheck: "false" };
    const tagClass = "cm-tag-" + tag.slice(1).replace(/[^\w-]/g, "");
    ranges.push(Decoration.mark({
      class: "cm-formatting cm-formatting-hashtag cm-hashtag cm-hashtag-begin cm-meta " + tagClass, attributes,
    }).range(from, from + 1));
    ranges.push(Decoration.mark({ class: "cm-hashtag cm-hashtag-end cm-meta " + tagClass, attributes }).range(from + 1, to));
  }
  return Decoration.set(ranges, true);
}

export function markdownTags(owner: MarkdownView): Extension {
  const field = StateField.define<DecorationSet>({
    create: markdownTagDecorations,
    update: (value, transaction) => transaction.docChanged ? markdownTagDecorations(transaction.state) : value,
    provide: field => EditorView.decorations.from(field),
  });
  const follow = (event: MouseEvent): boolean => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-markdown-tag]") : null;
    if (!target || event.button > 1 || !(owner.getEditingMode() === "live-preview" || event.ctrlKey || event.metaKey || event.button === 1)) { return false; }
    const tag = target.dataset.markdownTag;
    if (!tag) { return false; }
    event.preventDefault();
    openTagSearch(owner.leaf.app, tag).catch(reportError);
    return true;
  };
  return [field, EditorView.domEventHandlers({
    mousedown(event) {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-markdown-tag]") : null;
      if (!target || event.button > 1 || !(owner.getEditingMode() === "live-preview" || event.ctrlKey || event.metaKey || event.button === 1)) { return false; }
      // Keep CodeMirror from moving the caret/reflowing hidden source between
      // pointer down and the tag's click, especially after restoring a note.
      event.preventDefault();
      return true;
    },
    click: follow, auxclick: follow,
  })];
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "cm-live-bullet";
    bullet.textContent = "\u2022";
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
  override eq(other: BulletWidget): boolean { return other instanceof BulletWidget; }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, private readonly context: LivePreviewContext) { super(); }
  override eq(other: TaskWidget): boolean { return this.checked === other.checked && this.context === other.context; }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-live-task";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Complete task");
    const events = new AbortController();
    widgetCleanups.set(input, () => events.abort());
    input.addEventListener("mousedown", event => event.preventDefault(), { signal: events.signal });
    input.addEventListener("change", () => {
      if (!this.context.isCurrent() || !view.state.facet(EditorView.editable)) {
        input.checked = this.checked;
        return;
      }
      const from = view.posAtDOM(input);
      const marker = view.state.sliceDoc(from, from + 3);
      if (!/^\[[ xX]\]$/.test(marker)) {
        input.checked = this.checked;
        reportError(new Error("The task changed before its checkbox could be applied. No text was replaced."));
        return;
      }
      view.dispatch({
        changes: { from: from + 1, to: from + 2, insert: input.checked ? "x" : " " },
        annotations: Transaction.userEvent.of("input"),
      });
      view.focus();
    }, { signal: events.signal });
    return input;
  }
  override destroy(dom: HTMLElement): void { destroyWidget(dom); }
}

class MarkdownWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly to: number, readonly block: boolean, private readonly context: LivePreviewContext) { super(); }
  override eq(other: MarkdownWidget): boolean {
    return this.source === other.source && this.from === other.from && this.to === other.to && this.block === other.block && this.context === other.context;
  }
  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = this.block ? "cm-live-widget cm-live-block" : "cm-live-widget cm-live-embed";
    container.dataset.livePreviewWidget = this.block ? "block" : "embed";
    const content = document.createElement("div");
    const reading = new ReadingView(this.context.leaf, content, true);
    reading.render(this.source, this.context.path);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-live-edit";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", "Edit previewed Markdown");
    const events = new AbortController();
    widgetCleanups.set(container, () => { events.abort(); reading.clear(); });
    const reveal = (): void => {
      if (!this.context.isCurrent() || !view.state.facet(EditorView.editable)) { return; }
      if (view.state.doc.sliceString(this.from, this.to) !== this.source) {
        reportError(new Error("This preview no longer matches its source. No selection was changed."));
        return;
      }
      view.dispatch({ selection: { anchor: this.from }, effects: EditorView.scrollIntoView(this.from, { y: "nearest" }) });
      view.focus();
    };
    edit.addEventListener("mousedown", event => event.preventDefault(), { signal: events.signal });
    edit.addEventListener("click", reveal, { signal: events.signal });
    content.addEventListener("mousedown", event => {
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("a,input,button,audio,video")) { return; }
      event.preventDefault();
      event.stopPropagation();
      reveal();
    }, { signal: events.signal });
    container.append(content, edit);
    return container;
  }
  override destroy(dom: HTMLElement): void { destroyWidget(dom); }
}

export function livePreviewDecorations(state: EditorState, context: LivePreviewContext): DecorationSet {
  const text = state.doc.toString();
  const cache = cacheFor(state);
  const ranges: Range<Decoration>[] = [];
  const widgets: SourceRange[] = [];
  const links: SourceRange[] = [];
  const editing = (from: number, to: number): boolean => state.selection.ranges.some(range => range.from <= to && range.to >= from);
  const overlaps = (items: readonly SourceRange[], from: number, to: number): boolean => items.some(item => item.from < to && item.to > from);
  const hide = (from: number, to: number): void => { if (to > from) { ranges.push(Decoration.replace({}).range(from, to)); } };
  const mark = (from: number, to: number, className: string): void => {
    if (to > from) { ranges.push(Decoration.mark({ class: className }).range(from, to)); }
  };
  const line = (from: number, className: string): void => {
    ranges.push(Decoration.line({ class: className }).range(state.doc.lineAt(from).from));
  };
  const widget = (from: number, to: number, block: boolean): void => {
    ranges.push(Decoration.replace({ widget: new MarkdownWidget(text.slice(from, to), from, to, block, context), block }).range(from, to));
    widgets.push({ from, to });
  };
  const link = (from: number, to: number, labelFrom: number, labelTo: number, href: string, wiki: boolean): void => {
    links.push({ from, to });
    if (labelTo <= labelFrom) { return; }
    ranges.push(Decoration.mark({
      class: "cm-live-link internal-link",
      attributes: { "data-live-link": href, "data-live-wiki": String(wiki) },
    }).range(labelFrom, labelTo));
    if (!editing(from, to)) { hide(from, labelFrom); hide(labelTo, to); }
  };
  const frontmatterEnd = cache.frontmatterPosition?.end.offset;
  if (frontmatterEnd && !cache.errors.length && context.leaf?.app.core.isEnabled("properties") === true) {
    // The separate properties editor owns this range in Live Preview. Keep its
    // bytes in the document so Source mode and undo retain the original YAML.
    const to = frontmatterEnd > 0 && text[frontmatterEnd - 1] === "\n" ? frontmatterEnd - 1 : frontmatterEnd;
    ranges.push(Decoration.replace({ block: true }).range(0, to));
    widgets.push({ from: 0, to: frontmatterEnd });
  }
  for (const embed of cache.embeds) {
    const from = embed.position.start.offset, to = embed.position.end.offset;
    if (embed.kind !== "reference" && !editing(from, to)) { widget(from, to, false); }
  }
  for (const entry of cache.links.filter(entry => entry.kind === "wiki")) {
    const from = entry.position.start.offset, to = entry.position.end.offset;
    const separator = entry.original.indexOf("|");
    link(from, to, separator < 0 ? from + 2 : from + separator + 1, to - 2, entry.link, true);
  }
  let tree = syntaxTree(state);
  if (!markdownLanguage.isActiveAt(state, 0)) {
    let parsed = markdownTrees.get(state.doc);
    if (!parsed) { parsed = markdownLanguage.parser.parse(text); markdownTrees.set(state.doc, parsed); }
    tree = parsed;
  }
  tree.iterate({ enter(node) {
    if (node.name === "Document") { return; }
    if (node.from < (cache.frontmatterPosition?.end.offset ?? 0) || widgets.some(range => range.from <= node.from && range.to >= node.to)) { return false; }
    if (node.name === "FencedCode" || node.name === "CodeBlock") {
      const info = node.node.getChild("CodeInfo");
      if (node.node.parent?.name === "Document" && info && /^mermaid(?:\s|$)/i.test(text.slice(info.from, info.to)) && !editing(node.from, node.to)) {
        widget(node.from, node.to, true);
      } else {
        for (let number = state.doc.lineAt(node.from).number; number <= state.doc.lineAt(node.to).number; number++) {
          line(state.doc.line(number).from, "cm-live-code-line");
        }
        if (!editing(node.from, node.to)) {
          for (const marker of node.node.getChildren("CodeMark")) { hide(marker.from, marker.to); }
          if (info) { hide(info.from, info.to); }
        }
      }
      return false;
    }
    if (node.name === "InlineCode") {
      const markers = node.node.getChildren("CodeMark");
      if (markers.length === 2) {
        mark(markers[0].to, markers[1].from, "cm-live-inline-code");
        if (!editing(node.from, node.to)) { hide(markers[0].from, markers[0].to); hide(markers[1].from, markers[1].to); }
      }
      return false;
    }
    if (cache.ignored.some(range => range.from <= node.from && range.to >= node.to) || node.name === "Image") { return false; }
    if (node.name === "Table" && node.node.parent?.name === "Document" && !editing(node.from, node.to)) {
      widget(node.from, node.to, true);
      return false;
    }
    const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
    if (heading) {
      line(node.from, "cm-live-heading cm-live-heading-" + heading[1]);
      if (!editing(node.from, node.to)) {
        for (const marker of node.node.getChildren("HeaderMark")) {
          hide(marker.from, marker.to + (text[marker.to] === " " ? 1 : 0));
        }
      }
    }
    const style = inlineStyles[node.name];
    if (style) {
      const markers = node.node.getChildren(node.name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark");
      if (markers.length === 2) {
        mark(markers[0].to, markers[1].from, style);
        if (!editing(node.from, node.to)) { hide(markers[0].from, markers[0].to); hide(markers[1].from, markers[1].to); }
      }
    }
    if (node.name === "QuoteMark" && !editing(node.from, state.doc.lineAt(node.to).to)) {
      line(node.from, "cm-live-quote");
      hide(node.from, node.to + (text[node.to] === " " ? 1 : 0));
    }
    if (node.name === "ListMark" && /^[*+-]$/.test(text.slice(node.from, node.to)) && !editing(node.from, node.to)) {
      ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
    }
    if (node.name === "TaskMarker" && !editing(node.from, node.to)) {
      const checked = text[node.from + 1].toLowerCase() === "x";
      ranges.push(Decoration.replace({ widget: new TaskWidget(checked, context) }).range(node.from, node.to));
      if (checked) { mark(node.to, node.node.parent?.to ?? node.to, "cm-live-task-done"); }
    }
    if (node.name === "Link" && !overlaps(links, node.from, node.to)) {
      const markers = node.node.getChildren("LinkMark");
      const entry = cache.links.find(entry => entry.position.start.offset === node.from);
      const url = node.node.getChild("URL");
      const href = entry?.link ?? (url ? text.slice(url.from, url.to).replace(/^<|>$/g, "") : "");
      if (markers.length >= 2 && href) { link(node.from, node.to, markers[0].to, markers[1].from, href, false); }
    }
  } });
  for (const match of text.matchAll(/==(\S(?:[^\n]*?\S)?)==/g)) {
    const from = match.index, to = from + match[0].length;
    if (overlaps(cache.ignored, from, to) || overlaps(widgets, from, to) || overlaps(links, from, to) || isEscaped(text, from)) { continue; }
    mark(from + 2, to - 2, "cm-live-highlight");
    if (!editing(from, to)) { hide(from, from + 2); hide(to - 2, to); }
  }
  return Decoration.set(ranges, true);
}

export function livePreview(context: LivePreviewContext): Extension {
  const field = StateField.define<DecorationSet>({
    create: state => livePreviewDecorations(state, context),
    update: (value, transaction) => transaction.docChanged || transaction.selection || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? livePreviewDecorations(transaction.state, context) : value,
    provide: field => EditorView.decorations.from(field),
  });
  return [field, EditorView.domEventHandlers({
    mousedown(event) {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-live-link]") : null;
      if (!target || !(event.ctrlKey || event.metaKey || event.button === 1)) { return false; }
      if (!context.isCurrent()) { return false; }
      event.preventDefault();
      const href = target.dataset.liveLink;
      if (href) { openMarkdownLink(context.leaf, context.path, href, target.dataset.liveWiki === "true", true).catch(reportError); }
      return true;
    },
  })];
}
