import { readerLink, type ReaderArticle } from "./web-reader-policy";
import { CLIP_MAX_MARKDOWN, CLIP_MAX_SELECTION } from "./web-clip-policy";

export function markdownText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replace(/([\\`*_\[\]{}()#!|~+=\-.$^%])/g, "\\$1").replace(/[\s\u0000-\u001f\u007f]+/g, " ");
}

export function markdownCode(value: string, block = false): string {
  const text = value.replace(/\r\n?/g, "\n").replaceAll("\0", "");
  const length = Math.max(block ? 2 : 0, ...(text.match(/`+/g) ?? []).map(run => run.length)) + 1;
  const fence = "`".repeat(length);
  if (block) { return "\n\n" + fence + "\n" + text.replace(/\n$/, "") + "\n" + fence + "\n\n"; }
  const inline = text.replace(/\n/g, " ");
  return fence + (/^`|`$|^ .* $/.test(inline) && inline.trim() ? " " + inline + " " : inline) + fence;
}

export function markdownUrl(value: string, base: string): string | null {
  const url = readerLink(value, base);
  return url ? "<" + url.replace(/[<>\\]/g, char => encodeURIComponent(char)) + ">" : null;
}

/** Literal selected text with page context; no page markup is imported. */
export function selectionMarkdown(title: string, url: string, text: string): string {
  const source = markdownUrl(url, url);
  if (!source) { throw new Error("This selection has no valid source URL."); }
  if (text.length > CLIP_MAX_SELECTION) { throw new Error("This selection is too large to save. Select at most 200,000 characters."); }
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n").map(line => markdownText(line).trim()).filter(Boolean);
  if (!paragraphs.length) { throw new Error("Select text in the displayed page before using Save selection."); }
  const result = "# " + markdownText(title).trim() + "\n\nSource: [" + markdownText(url) + "](" + source + ")\n\n" + paragraphs.join("\n\n") + "\n";
  if (result.length > CLIP_MAX_MARKDOWN) { throw new Error("This selection is too large to save as Markdown."); }
  return result;
}

/** HTML integer parsing; unsafe counters must not silently become another list. */
function listInteger(value: string | null): number | null {
  const digits = value?.match(/^[\t\n\f\r ]*([+-]?\d+)/)?.[1];
  if (!digits) { return null; }
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) { throw new Error("This ordered-list numbering cannot be preserved as Markdown."); }
  return number;
}

export function orderedListMarkers(start: string | null, reversed: boolean, values: readonly (string | null)[], delimiter: "." | ")" = "."): string[] {
  const first = listInteger(values[0] ?? null) ?? listInteger(start) ?? 1;
  if (reversed || first < 0 || first > 999_999_999) { throw new Error("This ordered-list numbering cannot be preserved as Markdown."); }
  return values.map((value, index) => {
    const ordinal = first + index, explicit = listInteger(value);
    if (explicit !== null && explicit !== ordinal) { throw new Error("This ordered-list numbering cannot be preserved as Markdown."); }
    // CommonMark ignores later marker numbers; keep every marker within nine digits.
    return (ordinal <= 999_999_999 ? ordinal : 1) + delimiter + " ";
  });
}

interface ClipTableCell { markdown: string; columns: number; rows: number }

/** Expand sanitized HTML row groups; Markdown has no merged-cell syntax. */
export function expandClipTable(groups: readonly (readonly (readonly ClipTableCell[])[])[], budget = CLIP_MAX_MARKDOWN): string[][] {
  const result: string[][] = [];
  let width = 0, characters = 0;
  const tooLarge = (): never => { throw new Error("An expanded article table is too large to save as Markdown."); };
  for (const source of groups) {
    let height = source.length;
    if (height + result.length > 1000) { tooLarge(); }
    // Positive spans can imply rows after the last tr. Zero spans cover their
    // whole row group, including those implied rows, but never the next group.
    for (const [y, cells] of source.entries()) {
      if (cells.length > 100) { tooLarge(); }
      for (const cell of cells) {
        if (!Number.isInteger(cell.columns) || cell.columns < 1 || cell.columns > 1000
          || !Number.isInteger(cell.rows) || cell.rows < 0 || cell.rows > 65534) {
          throw new Error("This article table has an invalid cell span.");
        }
        height = Math.max(height, y + cell.rows);
      }
    }
    if (height + result.length > 1000) { tooLarge(); }
    const grid: string[][] = Array.from({ length: height }, () => []);
    for (const [y, cells] of source.entries()) {
      let x = 0;
      for (const cell of cells) {
        while (grid[y][x] !== undefined) { x++; }
        const end = x + cell.columns, bottom = cell.rows === 0 ? height : y + cell.rows;
        if (end > 100) { tooLarge(); }
        characters += cell.markdown.length * cell.columns * (bottom - y);
        if (characters > budget) { tooLarge(); }
        for (let row = y; row < bottom; row++) {
          for (let column = x; column < end; column++) {
            if (grid[row][column] !== undefined) { throw new Error("Overlapping article table cells cannot be preserved as Markdown."); }
            grid[row][column] = cell.markdown;
          }
        }
        width = Math.max(width, end); x = end;
      }
    }
    result.push(...grid);
  }
  if (!width) { return []; }
  // Bound padding/separators as well as repeated content before serializing.
  if (characters + result.length * (width * 3 + 2) + width * 6 > budget) { tooLarge(); }
  return result.map(row => Array.from({ length: width }, (_, column) => row[column] ?? ""));
}

/** Only consumes the sanitized article DOM in the isolated website world. */
export function articleMarkdown(article: ReaderArticle, root: Element): string {
  let listDepth = 0;
  let tableBudget = CLIP_MAX_MARKDOWN;
  const listDelimiters = new Map<number, "." | ")">();
  const children = (node: Node): string => Array.from(node.childNodes, render).reduce((text, part) => {
    if (part.startsWith("\n\n")) { text = text.replace(/[ \t]+$/, ""); }
    if (text.endsWith("\n\n")) { part = part.trim() ? part.replace(/^\n+/, "") : ""; }
    return text + part;
  }, "");
  const firstHeading = root.querySelector("h1");
  const table = (node: Element): string => {
    if (node.querySelector("table")) { throw new Error("Nested article tables cannot be preserved as Markdown."); }
    // The native collection puts thead first and tfoot last, even when their
    // source order differs. Spans use the browser's normalized HTML integers.
    const rowElements = Array.from((node as HTMLTableElement).rows);
    if (rowElements.length > 1000 || rowElements.some(row => row.cells.length > 100)) { throw new Error("An article table is too large to save as Markdown."); }
    const groups: ClipTableCell[][][] = [];
    let parent: Element | null | undefined;
    for (const row of rowElements) {
      if (row.parentElement !== parent) { groups.push([]); parent = row.parentElement; }
      groups[groups.length - 1].push(Array.from(row.cells, cell => ({
        markdown: children(cell).trim().replace(/\n+/g, " ").replace(/(?<!\\)\|/g, "\\|"),
        columns: cell.colSpan, rows: cell.rowSpan,
      })));
    }
    const rows = expandClipTable(groups, tableBudget);
    if (!rows.length) { return ""; }
    const line = (cells: string[]): string => "| " + cells.join(" | ") + " |";
    const caption = (node as HTMLTableElement).caption;
    const markdown = "\n\n" + (caption ? children(caption).trim() + "\n\n" : "") + [line(rows[0]), line(Array(rows[0].length).fill("---")), ...rows.slice(1).map(line)].join("\n") + "\n\n";
    tableBudget -= markdown.length;
    if (tableBudget < 0) { throw new Error("This article has too much table content to save as Markdown."); }
    return markdown;
  };
  const render = (node: Node): string => {
    if (node.nodeType === 3) { return markdownText(node.textContent ?? ""); }
    if (node.nodeType !== 1) { return ""; }
    const el = node as Element, tag = el.tagName.toLowerCase();
    if (el === firstHeading && el.textContent?.trim() === article.title.trim()) { return ""; }
    if (["script", "style", "iframe", "object", "embed", "form", "input", "button", "img", "svg", "math", "template"].includes(tag)) { return ""; }
    if (tag === "pre") { return markdownCode(el.textContent ?? "", true); }
    if (tag === "code" || tag === "kbd") { return markdownCode(el.textContent ?? ""); }
    if (tag === "table") { return table(el); }
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(el.children).filter(child => child.tagName === "LI");
      if (!items.length) { return ""; }
      // Different delimiters prevent adjacent independent lists from merging.
      // Track each nesting depth so a nested list cannot change its parent's delimiter.
      const delimiter = listDelimiters.get(listDepth) === "." ? ")" : ".";
      const markers = tag === "ol" ? orderedListMarkers(el.getAttribute("start"), el.hasAttribute("reversed"), items.map(item => item.getAttribute("value")), delimiter) : items.map(() => "- ");
      if (tag === "ol") { listDelimiters.set(listDepth, delimiter); }
      listDepth++;
      try {
        return "\n\n" + items.map((item, index) => {
          const marker = markers[index], text = children(item).trim();
          return marker + text.replace(/\n/g, "\n" + " ".repeat(marker.length));
        }).join("\n") + "\n\n";
      } finally { listDepth--; }
    }
    const text = children(el);
    if (/^h[1-6]$/.test(tag)) { return "\n\n" + "#".repeat(Number(tag[1])) + " " + text.trim().replace(/\n+/g, " ") + "\n\n"; }
    if (tag === "blockquote") { return "\n\n" + text.trim().split("\n").map(line => "> " + line).join("\n") + "\n\n"; }
    if (tag === "br") { return "  \n"; }
    if (tag === "hr") { return "\n\n---\n\n"; }
    if (tag === "a") {
      const url = markdownUrl(el.getAttribute("data-reader-url") ?? "", article.url);
      return el.hasAttribute("data-reader-url") && url ? "[" + text.trim().replace(/\n+/g, " ") + "](" + url + ")" : text;
    }
    if (tag === "strong" || tag === "b" || tag === "em" || tag === "i") {
      const marker = tag === "strong" || tag === "b" ? "**" : "*";
      return text.trim() ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_match, before: string, content: string, after: string) => before + marker + content + marker + after) : text;
    }
    return ["p", "div", "section", "article", "figure", "figcaption", "dl", "dt", "dd"].includes(tag) ? "\n\n" + text.trim() + "\n\n" : text;
  };
  const source = markdownUrl(article.url, article.url);
  if (!source) { throw new Error("This article has no valid source URL."); }
  // No raw HTML, remote images, frontmatter, active embeds or language-labelled
  // fences are generated from page content. Preview is also displayed as text.
  const result = "# " + markdownText(article.title).trim() + "\n\nSource: [" + markdownText(article.url) + "](" + source + ")\n\n"
    + (article.byline ? "Author: " + markdownText(article.byline).trim() + "\n\n" : "")
    + children(root).trim() + "\n";
  if (result.length > CLIP_MAX_MARKDOWN) { throw new Error("This article is too large to save as Markdown."); }
  return result;
}
