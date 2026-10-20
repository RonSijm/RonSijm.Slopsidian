import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { createCompletionRanker, MAX_COMPLETION_RANK_VALUE } from "./completion-ranking";
import { markdownParseSource, parseMarkdown, type SourceRange } from "./markdown";
import { resolveSubpath } from "./links";

export const MAX_BLOCK_AUTHORING_SOURCE = 262_144;
export const MAX_BLOCK_AUTHORING_BLOCKS = 2_048;
/** Retained for callers of the original paragraph-only authoring API. */
export const MAX_BLOCK_AUTHORING_PARAGRAPHS = MAX_BLOCK_AUTHORING_BLOCKS;
export const MAX_BLOCK_AUTHORING_RESULTS = 40;
export const MAX_BLOCK_ID_ATTEMPTS = 16;

export interface BlockAuthoringChoice {
  kind: "create-block";
  path: string;
  from: number;
  to: number;
  preview: string;
  body: string;
  blockKind?: "paragraph" | "bullet-list" | "ordered-list" | "quote" | "callout" | "fenced-code" | "table";
}
export interface BlockAuthoringOptions { exclude?: SourceRange }
export interface BlockIdPlan { id: string; from: number; to: number; insert: string; text: string }

const loneSurrogate = /[\uD800-\uDFFF]/u;
const idPattern = /^[a-z0-9]{6}$/;
const overlaps = (from: number, to: number, range: SourceRange): boolean => from < range.to && to > range.from;
const validSource = (text: unknown): text is string => typeof text === "string" && text.length <= MAX_BLOCK_AUTHORING_SOURCE
  && !loneSurrogate.test(text) && !/\r(?!\n)/.test(text);
const validPath = (path: unknown): path is string => typeof path === "string" && path.length > 0 && path.length <= 1_024
  && /\.md$/i.test(path) && !/[\[\]#|\\\x00-\x1f]/.test(path) && !path.startsWith("/")
  && path.split("/").every(part => Boolean(part) && part !== "." && part !== "..");

type BlockKind = NonNullable<BlockAuthoringChoice["blockKind"]>;
const blockKinds: Record<string, BlockKind> = { Paragraph: "paragraph", BulletList: "bullet-list", OrderedList: "ordered-list", Blockquote: "quote", FencedCode: "fenced-code" };

/** Match the callout syntax supported by the current Reading renderer. */
function calloutHeader(raw: string): boolean {
  const first = raw.slice(0, raw.indexOf("\n") < 0 ? raw.length : raw.indexOf("\n")).replace(/\r$/, "");
  return /^ {0,3}>[ \t]*\[![a-z][a-z0-9_-]*\][+-]?(?:[ \t]+[^\r\n]*)?$/i.test(first);
}

function supportedCallout(node: SyntaxNode, text: string, raw: string): boolean {
  // Explicit quote prefixes make the complete owner unambiguous. Ordinary
  // nested quotes/lists are retained; independent nested callouts are refused.
  // Quoted multiline math is not a raw-source math span, so decline its
  // delimiters explicitly as well as the ordinary ignored ranges below.
  if (raw.includes("$$") || !raw.split(/\r?\n/).every(line => /^ {0,3}>/.test(line))) { return false; }
  const pending: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) { pending.push(child); }
  while (pending.length) {
    const child = pending.pop()!;
    if (child.name === "Blockquote" && /^>[ \t]*\[!/.test(text.slice(child.from, child.to))) { return false; }
    for (let nested = child.firstChild; nested; nested = nested.nextSibling) { pending.push(nested); }
  }
  return true;
}

function closedFence(node: SyntaxNode, text: string, to: number): boolean {
  const marks = node.getChildren("CodeMark");
  if (marks.length !== 2) { return false; }
  const [opening, closing] = marks, marker = text.slice(opening.from, opening.to), end = text.slice(closing.from, closing.to);
  const line = text.lastIndexOf("\n", closing.from - 1) + 1;
  return /^(?:`{3,}|~{3,})$/.test(marker) && end.length >= marker.length && [...end].every(character => character === marker[0])
    && closing.from > opening.to && /^ {0,3}$/.test(text.slice(line, closing.from)) && /^[ \t]*$/.test(text.slice(closing.to, to));
}

/** Rectangular GFM rows with at least one body row; escaped pipes remain cell text. */
function supportedTable(raw: string): boolean {
  const rows = raw.split(/\r?\n/).map(line => {
    const cells: string[] = []; let start = 0, escaped = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === "|" && !escaped) { cells.push(line.slice(start, index).trim()); start = index + 1; }
      escaped = character === "\\" ? !escaped : false;
    }
    cells.push(line.slice(start).trim());
    if (cells[0] === "" && line.trimStart().startsWith("|")) { cells.shift(); }
    if (cells.at(-1) === "" && line.trimEnd().endsWith("|")) { cells.pop(); }
    return cells;
  });
  return rows.length >= 3 && rows[0].length > 0 && rows.every(row => row.length === rows[0].length
    && row.every(cell => !/(?:^|\s)\^\S*[ \t]*$/.test(cell)))
    && rows[1].every(cell => /^:?-{3,}:?$/.test(cell));
}

/** Whole supported top-level blocks; never independent nested children. */
function authorableBlocks(path: string, text: string, options: BlockAuthoringOptions = {}): { choice: BlockAuthoringChoice; display: string }[] {
  if (!validPath(path) || !validSource(text)) { return []; }
  // The shared parser treats a leading BOM without frontmatter as prose. A
  // structural first line could then split one intended list/quote into owners.
  if (/^\ufeff[ \t]*(?:>|[*+-][ \t]|\d+[.)][ \t]|`{3,}|~{3,}|\|)/.test(text)) { return []; }
  const exclude = options.exclude;
  if (exclude && (!Number.isInteger(exclude.from) || !Number.isInteger(exclude.to) || exclude.from < 0 || exclude.to < exclude.from || exclude.to > text.length)) { return []; }
  const cache = parseMarkdown(text);
  if (cache.errors.length) { return []; }
  const forbidden = [...cache.ignored, ...cache.footnotes.map(note => ({ from: note.position.start.offset, to: note.position.end.offset }))];
  const blocks = Object.values(cache.blocks);
  const values: { choice: BlockAuthoringChoice; display: string }[] = [];
  const tables = cache.sections.filter(section => section.type === "table").map(section => ({ from: section.position.start.offset, to: section.position.end.offset }));
  const overlapsTable = (from: number, to: number): boolean => {
    let low = 0, high = tables.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tables[middle].to <= from) { low = middle + 1; } else { high = middle; }
    }
    return low < tables.length && tables[low].from < to;
  };
  const candidates: { from: number; to: number; fullTo: number; blockKind: BlockKind; closed: boolean }[] = [];
  markdownLanguage.parser.parse(markdownParseSource(text)).iterate({ enter(node) {
    let blockKind = blockKinds[node.name];
    if (!blockKind || node.node.parent?.name !== "Document") { return; }
    const from = node.from, to = node.to - (text[node.to - 1] === "\r" ? 1 : 0);
    const raw = text.slice(from, to);
    if (blockKind === "quote" && calloutHeader(raw)) { blockKind = "callout"; }
    if (blockKind !== "paragraph" || !overlapsTable(from, to)) {
      const closed = blockKind === "fenced-code" ? closedFence(node.node, text, to) : blockKind !== "callout" || supportedCallout(node.node, text, raw);
      candidates.push({ from, to, fullTo: node.to, blockKind, closed });
    }
    return false;
  } });
  for (const table of tables) { candidates.push({ from: table.from, to: table.to - (text[table.to - 1] === "\r" ? 1 : 0), fullTo: table.to, blockKind: "table", closed: true }); }
  if (candidates.length > MAX_BLOCK_AUTHORING_BLOCKS) { return []; }
  for (const { from, to, fullTo, blockKind, closed } of candidates.sort((left, right) => left.from - right.from)) {
    if (to <= from || from < (cache.frontmatterPosition?.end.offset ?? 0) || exclude && overlaps(from, to, exclude)
      || !closed || forbidden.some(range => overlaps(from, to, range) && !(blockKind === "fenced-code" && range.from === from && range.to === fullTo))
      || blocks.some(block => overlaps(from, to, { from: block.position.start.offset, to: block.position.end.offset })
        || overlaps(from, to, { from: block.idPosition.start.offset, to: block.idPosition.end.offset }))) { continue; }
    const raw = text.slice(from, to);
    const nestedSource = blockKind === "callout" ? raw.slice(raw.indexOf("\n") < 0 ? raw.length : raw.indexOf("\n") + 1) : raw;
    // Every line belongs to a compound candidate. A child marker, attempted ID,
    // callout or footnote definition must not be relabelled as its outer block.
    if (/(?:^|\s)\^\S*[ \t]*$/.test(raw) || blockKind !== "paragraph" && (
      /(?:^|\s)\^\S*[ \t]*(?=\r?$)/m.test(raw)
      || blockKind !== "fenced-code" && /^[ \t]*(?:(?:[*+-]|\d+[.)])[ \t]+)?(?:>[ \t]*)+\[!/m.test(nestedSource)
      || blockKind !== "fenced-code" && /\[\^[^\]\r\n]+\]:/.test(raw)
      || cache.footnoteRefs.some(note => overlaps(from, to, { from: note.position.start.offset, to: note.position.end.offset }))
    ) || blockKind === "table" && !supportedTable(raw)) { continue; }
    const display = raw.replace(/\s+/g, " ").trim();
    if (!display || display.length > MAX_COMPLETION_RANK_VALUE) { continue; }
    const preview = Array.from(display).slice(0, 160).join("");
    values.push({ choice: { kind: "create-block", path, from, to, preview, body: raw,
      ...(blockKind === "paragraph" ? {} : { blockKind }) }, display });
  }
  return values;
}

/** Explicit authoring rows are separate from existing-ID navigation choices. */
export function blockAuthoringCompletions(query: string, path: string, text: string, options: BlockAuthoringOptions = {}): BlockAuthoringChoice[] {
  const ranker = createCompletionRanker(query);
  return authorableBlocks(path, text, options).flatMap(value => {
    const rank = ranker.score(value.display);
    return rank < 0 ? [] : [{ ...value, rank }];
  }).sort((left, right) => right.rank - left.rank || left.choice.from - right.choice.from)
    .slice(0, MAX_BLOCK_AUTHORING_RESULTS).map(value => value.choice);
}

function lexicalIds(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(/\^([A-Za-z0-9-]+)/g), match => match[1].toLowerCase()));
}

/** Six-character local identifiers are not secrets. Generation is bounded and collision checked. */
export function newBlockId(text: string, random?: () => string): string | null {
  if (!validSource(text)) { return null; }
  const used = lexicalIds(text), alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let attempt = 0; attempt < MAX_BLOCK_ID_ATTEMPTS; attempt++) {
    let id: string;
    try {
      id = random ? random() : Array.from(crypto.getRandomValues(new Uint8Array(6)), value => alphabet[value % alphabet.length]).join("");
    } catch { return null; }
    if (typeof id === "string" && idPattern.test(id) && !used.has(id)) { return id; }
  }
  return null;
}

/** Use the target's adjacent line ending without rewriting any existing source. */
function lineEnding(text: string, offset: number): string {
  if (text.startsWith("\r\n", offset)) { return "\r\n"; }
  if (text[offset] === "\n") { return "\n"; }
  const prior = text.lastIndexOf("\n", offset - 1);
  return prior > 0 && text[prior - 1] === "\r" ? "\r\n" : "\n";
}

/** Re-derive the complete chosen block and verify its actual metadata destination before any host write. */
export function planBlockId(text: string, choice: BlockAuthoringChoice, id: string): BlockIdPlan {
  const actual = choice && choice.kind === "create-block" && idPattern.test(id) && validSource(text) && !lexicalIds(text).has(id)
    ? authorableBlocks(choice.path, text).find(value => value.choice.from === choice.from && value.choice.to === choice.to
      && value.choice.preview === choice.preview && value.choice.body === choice.body
      && (choice.blockKind === undefined || choice.blockKind === (value.choice.blockKind ?? "paragraph")))?.choice : undefined;
  if (!actual) {
    throw new Error("The block or block identifier changed. No block ID was added.");
  }
  const compound = actual.blockKind !== undefined && actual.blockKind !== "paragraph", newline = lineEnding(text, choice.to);
  const insert = compound ? newline + newline + "^" + id + (text.startsWith(newline + newline, choice.to) ? "" : newline) : " ^" + id;
  const updated = text.slice(0, choice.to) + insert + text.slice(choice.to), cache = parseMarkdown(updated);
  const resolved = resolveSubpath(cache, "#^" + id), block = cache.blocks[id];
  const markerFrom = choice.to + insert.indexOf("^"), end = resolved?.end.offset ?? 0;
  const bodyTo = end - (updated[end - 1] === "\r" ? 1 : 0);
  if (cache.errors.length || !block || resolved?.type !== "block" || resolved.start.offset !== choice.from
    || bodyTo !== choice.to + (compound ? 0 : insert.length)
    || updated.slice(resolved.start.offset, bodyTo) !== choice.body + (compound ? "" : insert)
    || block.idPosition.start.offset !== markerFrom || block.idPosition.end.offset !== markerFrom + id.length + 1) {
    throw new Error("The complete block cannot be addressed by that block identifier. No block ID was added.");
  }
  return { id, from: choice.to, to: choice.to, insert, text: updated };
}
