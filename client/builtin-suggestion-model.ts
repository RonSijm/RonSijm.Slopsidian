import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { isEscaped, parseMarkdown, type CachedMetadata } from "./markdown";
import { newLinkedNotePath, resolveSubpath, subpathIdentity } from "./links";
import { createCompletionRanker, MAX_COMPLETION_RANK_VALUE } from "./completion-ranking";
export { createCompletionRanker, MAX_COMPLETION_FUZZY_CHARACTERS, MAX_COMPLETION_FUZZY_STEPS, MAX_COMPLETION_FUZZY_WINDOW, MAX_COMPLETION_RANK_QUERY, MAX_COMPLETION_RANK_VALUE } from "./completion-ranking";

export const MAX_COMPLETION_SOURCE = 262_144;
export const MAX_COMPLETION_CANDIDATES = 10_000;
export const MAX_COMPLETION_KEYS = 2_048;
export const MAX_COMPLETION_RESULTS = 40;
export const MAX_COMPLETION_SUBPATHS = 2_048;
export const MAX_COMPLETION_HEADING_DEPTH = 6;
export const MAX_COMPLETION_VALUE_DOCUMENTS = 2_000;
export const MAX_COMPLETION_VALUES = 2_048;
export const MAX_COMPLETION_VALUE_LENGTH = 1_024;
export const MAX_COMPLETION_VALUE_CHARACTERS = 65_536;
export const MAX_COMPLETION_GLOBAL_DOCUMENTS = 2_000;
export const MAX_COMPLETION_GLOBAL_HEADINGS = 8_192;
export const MAX_COMPLETION_GLOBAL_CHARACTERS = 262_144;

export interface BuiltinCompletionTrigger {
  kind: "link" | "property" | "property-value" | "heading" | "global-heading" | "block";
  from: number;
  to: number;
  query: string;
  existingKeys?: string[];
  property?: string;
  existingValues?: string[];
  linkpath?: string;
  headingParents?: readonly string[];
}
export interface LinkCompletionSource { path: string; aliases?: readonly string[] }
export interface LinkCompletion { kind: "link"; path: string; alias?: string }
export interface CreateNoteCompletion { kind: "create-note"; path: string; name: string }
export interface PropertyCompletion { kind: "property"; name: string }
export interface PropertyValueCompletion { kind: "property-value"; property: string; value: string }
export interface HeadingCompletion { kind: "heading"; path: string; heading: string; from: number; to: number; parents?: readonly string[] }
export interface GlobalHeadingCompletion { kind: "global-heading"; path: string; heading: string; from: number; to: number }
export interface GlobalHeadingSource { path: string; text: string; cache: CachedMetadata }
export interface BlockCompletion { kind: "block"; path: string; id: string; preview: string; from: number; to: number }
export type SubpathCompletion = HeadingCompletion | BlockCompletion;
export type BuiltinCompletion = LinkCompletion | PropertyCompletion | PropertyValueCompletion | SubpathCompletion | GlobalHeadingCompletion;

function header(content: string): { from: number; to: number } | null {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(content);
  if (!opening) { return null; }
  const closing = /^---[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const end = closing.exec(content);
  return end ? { from: opening[0].length, to: end.index } : null;
}

function propertyTrigger(content: string, cursor: number, from: number, to: number): BuiltinCompletionTrigger | null {
  const region = header(content);
  if (!region || from < region.from || to > region.to) { return null; }
  const line = content.slice(from, to), query = content.slice(from, cursor);
  // New top-level keys only. Existing key/value rows and nested YAML are deliberately left alone.
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(line) || !query.trim() || query.length > 256) { return null; }
  const body = content.slice(region.from, from) + "#" + " ".repeat(line.length - 1) + content.slice(to, region.to);
  const parsed = parseDocument(body, { uniqueKeys: true });
  if (parsed.errors.length || parsed.contents && (!isMap(parsed.contents) || parsed.contents.flow)) { return null; }
  const keys: string[] = [];
  if (isMap(parsed.contents)) {
    for (const pair of parsed.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string" || keys.length >= MAX_COMPLETION_KEYS) { return null; }
      keys.push(pair.key.value);
      // A source-looking line inside a multiline YAML scalar is not a new property.
      const range = isScalar(pair.value) ? pair.value.range : null;
      if (range && range[0] < from - region.from && range[1] > from - region.from) { return null; }
    }
  }
  return { kind: "property", from, to, query, existingKeys: keys };
}

/** Only complete existing, single-line scalar slots in an otherwise valid YAML map. */
function propertyValueTrigger(content: string, cursor: number, lineFrom: number, lineTo: number): BuiltinCompletionTrigger | null {
  const region = header(content);
  if (!region || lineFrom < region.from || lineTo > region.to) { return null; }
  const parsed = parseDocument(content.slice(region.from, region.to), { uniqueKeys: true });
  if (parsed.errors.length || !isMap(parsed.contents) || parsed.contents.flow || parsed.contents.items.length > MAX_COMPLETION_KEYS) { return null; }
  for (const pair of parsed.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string" || !pair.key.value || pair.key.value.length > 256) { continue; }
    const values = isSeq(pair.value) ? pair.value.items : [pair.value];
    if (values.length > MAX_COMPLETION_VALUES || isSeq(pair.value) && values.some(item => !isScalar(item) || typeof item.value !== "string" && item.value !== null)) { continue; }
    for (const item of values) {
      if (!isScalar(item) || item.anchor || item.tag || !item.range || !["PLAIN", "QUOTE_SINGLE", "QUOTE_DOUBLE"].includes(item.type ?? "")) { continue; }
      let from = region.from + item.range[0], to = region.from + item.range[1];
      if (from < lineFrom || to > lineTo || from > cursor) { continue; }
      let query: string;
      if (item.value === null && from === to && cursor <= lineTo && /^[ \t]*$/.test(content.slice(from, cursor))) {
        // YAML puts an empty scalar just after its colon/dash. Retain any spacing
        // already typed and insert exactly at the cursor instead of moving it.
        from = to = cursor; query = "";
      } else {
        if (typeof item.value !== "string" || cursor > to) { continue; }
        const source = content.slice(from, to);
        if (item.type === "PLAIN") { query = content.slice(from, cursor); }
        else {
          if (cursor <= from || cursor > to) { continue; }
          const quote = item.type === "QUOTE_SINGLE" ? "'" : '"';
          const prefix = cursor >= to - 1 ? source : content.slice(from, cursor) + quote;
          const decoded = parseDocument(prefix);
          if (decoded.errors.length || !isScalar(decoded.contents) || typeof decoded.contents.value !== "string") { continue; }
          query = decoded.contents.value;
        }
      }
      if (query.length > 256 || /[\x00-\x1f\x7f]/.test(query)) { continue; }
      const existingValues = isSeq(pair.value) ? values.flatMap(other => other !== item && isScalar(other) && typeof other.value === "string" ? [other.value] : []) : [];
      return { kind: "property-value", from, to, query, property: pair.key.value, existingValues };
    }
  }
  return null;
}

/** Bounded source context shared by popup triggering and the final edit guard. UTF-16 offsets retain CRLF. */
export function builtinCompletionTrigger(content: string, cursor: number): BuiltinCompletionTrigger | null {
  if (content.length > MAX_COMPLETION_SOURCE || !Number.isInteger(cursor) || cursor < 0 || cursor > content.length) { return null; }
  const from = content.lastIndexOf("\n", cursor - 1) + 1;
  const newline = content.indexOf("\n", cursor), to = newline < 0 ? content.length : newline > 0 && content[newline - 1] === "\r" ? newline - 1 : newline;
  if (cursor > to) { return null; }
  const property = propertyTrigger(content, cursor, from, to);
  if (property) { return property; }
  const propertyValue = propertyValueTrigger(content, cursor, from, to);
  if (propertyValue) { return propertyValue; }
  const before = content.slice(from, cursor), opening = before.lastIndexOf("[[");
  if (opening < 0 || opening > 0 && before[opening - 1] === "[" || isEscaped(content, from + opening)) { return null; }
  const input = before.slice(opening + 2);
  if (input.length > 256 || /[\[\]|\\\x00-\x1f]/.test(input)) { return null; }
  const hash = input.indexOf("#");
  const globalHeading = input.startsWith("##");
  if (globalHeading && input.indexOf("#", 2) >= 0) { return null; }
  const linkpath = !globalHeading && hash >= 0 ? input.slice(0, hash) : undefined;
  const subpath = hash >= 0 ? input.slice(hash + 1) : "";
  const kind = globalHeading ? "global-heading" : hash < 0 ? "link" : subpath.startsWith("^") ? "block" : "heading";
  const headingParts = kind === "heading" ? subpath.split("#") : [];
  const headingParents = headingParts.length > 1 ? headingParts.slice(0, -1) : undefined;
  if (kind === "block" && subpath.includes("#") || headingParts.length > MAX_COMPLETION_HEADING_DEPTH
    || headingParents?.some(value => !safeLinkText(value) || value.startsWith("^"))) { return null; }
  const query = globalHeading ? input.slice(2) : hash < 0 ? input : kind === "block" ? subpath.slice(1) : headingParts.at(-1)!;
  const tail = content.slice(cursor, to), closing = tail.indexOf("]]");
  const suffix = closing >= 0 ? tail.slice(0, closing) : "";
  if (/[\[\]#|\\\x00-\x1f]/.test(suffix) || closing < 0 && /^[\p{L}\p{N}_/-]/u.test(tail)) { return null; }
  const start = from + opening, end = closing >= 0 ? cursor + closing + 2 : cursor;
  const cache = parseMarkdown(content);
  if (cache.ignored.some(range => range.from <= start && range.to > start)
    || cache.links.some(link => link.kind !== "wiki" && link.position.start.offset <= start && link.position.end.offset > start)) { return null; }
  let percentComment = false, protectedIndex = 0, brackets = 0;
  for (let index = 0; index < start; index++) {
    while (protectedIndex < cache.ignored.length && cache.ignored[protectedIndex].to <= index) { protectedIndex++; }
    const range = cache.ignored[protectedIndex];
    if (!percentComment && range && range.from <= index) { index = range.to - 1; continue; }
    if (content[index] === "\\") { index++; }
    else if (content[index] === "%" && content[index + 1] === "%") { percentComment = !percentComment; index++; }
    else if (!percentComment && index >= from && content[index] === "[") { brackets++; }
    else if (!percentComment && index >= from && content[index] === "]" && brackets) { brackets--; }
  }
  if (percentComment || brackets) { return null; }
  return { kind, from: start, to: end, query, ...(linkpath === undefined ? {} : { linkpath }), ...(headingParents ? { headingParents } : {}) };
}

function literalScore(query: string, value: string): number {
  const offset = value.toLowerCase().indexOf(query.toLowerCase());
  return offset < 0 ? -1 : (offset === 0 ? 10_000 : 1_000 - offset) - value.length;
}
function safeLinkText(value: string): boolean { return value.length <= 1_024 && Boolean(value.trim()) && !/[\[\]#|\\\x00-\x1f]/.test(value); }

/** An explicit action for a fully typed note path; destination placement belongs to FileManager. */
export function createNoteCompletion(content: string, cursor: number, trigger: BuiltinCompletionTrigger, path: string, sourcePath: string): CreateNoteCompletion | null {
  if (trigger.kind !== "link" || !trigger.query.trim() || trigger.query.length > 256 || !safeLinkText(trigger.query)
    || /[\uD800-\uDFFF]/u.test(trigger.query) || !safeLinkText(path) || /[\uD800-\uDFFF]/u.test(path)
    || /(?:\/|(?:^|\/)\.{1,2})$/.test(trigger.query.trim())
    || content.slice(trigger.from, cursor) !== "[[" + trigger.query || !["", "]]"].includes(content.slice(cursor, trigger.to))) { return null; }
  try {
    if (newLinkedNotePath({ path, subpath: "" }, "") !== path) { return null; }
    // Validate the typed spelling separately: a safe destination must not turn
    // an unsupported attachment, URL or escaping path into a create action.
    newLinkedNotePath({ path: trigger.query.trim(), subpath: "" }, sourcePath);
  } catch { return null; }
  return { kind: "create-note", path, name: trigger.query.trim() };
}

/** Called only after create-only success and destination-resolution verification. */
export function planCreateNoteCompletion(content: string, cursor: number, expected: BuiltinCompletionTrigger, value: CreateNoteCompletion, insert: string, sourcePath: string): { from: number; to: number; insert: string; text: string; cursor: number } {
  const current = builtinCompletionTrigger(content, cursor), choice = current && createNoteCompletion(content, cursor, current, value.path, sourcePath);
  if (!current || current.from !== expected.from || current.to !== expected.to || current.query !== expected.query
    || !choice || choice.name !== value.name) { throw new Error("The note-creation source changed."); }
  const cache = parseMarkdown(insert), link = cache.links[0];
  if (!link || cache.links.length !== 1 || cache.embeds.length || !["wiki", "markdown"].includes(link.kind)
    || link.position.start.offset !== 0 || link.position.end.offset !== insert.length) { throw new Error("The created note has no supported link."); }
  return { from: current.from, to: current.to, insert, text: content.slice(0, current.from) + insert + content.slice(current.to), cursor: current.from + insert.length };
}

/** Safe canonical heading chain; every segment retains its own delimiter boundary. */
export function headingCompletionSubpath(value: HeadingCompletion | GlobalHeadingCompletion): string {
  const parents = value.kind === "heading" ? value.parents ?? [] : [];
  if (!Array.isArray(parents) || parents.length >= MAX_COMPLETION_HEADING_DEPTH
    || [...parents, value.heading].some(part => typeof part !== "string" || !safeLinkText(part) || part.startsWith("^"))) { throw new Error("This heading path cannot be completed safely."); }
  const path = [...parents, value.heading].join("#");
  if (path.length > 1_024) { throw new Error("This heading path cannot be completed safely."); }
  return path;
}

/** Known Markdown notes only: no unresolved or create-note entries. */
export function linkCompletions(query: string, files: Iterable<LinkCompletionSource>): LinkCompletion[] {
  const found: { value: LinkCompletion; score: number }[] = [];
  const ranker = createCompletionRanker(query);
  let inspected = 0;
  for (const file of files) {
    if (++inspected > MAX_COMPLETION_CANDIDATES) { break; }
    if (!safeLinkText(file.path) || !/\.md$/i.test(file.path)) { continue; }
    const path = file.path.slice(0, -3), basename = path.slice(path.lastIndexOf("/") + 1);
    const direct = Math.max(ranker.score(basename), ranker.score(path));
    if (direct >= 0) { found.push({ value: { kind: "link", path: file.path }, score: direct }); }
    for (const alias of (file.aliases ?? []).slice(0, 32)) {
      if (typeof alias !== "string" || !safeLinkText(alias) || alias === basename) { continue; }
      const rank = ranker.score(alias);
      if (rank >= 0 && !found.some(item => item.value.path === file.path && item.value.alias === alias)) { found.push({ value: { kind: "link", path: file.path, alias }, score: rank }); }
    }
    // Retain only a bounded best set rather than materializing every matching file/alias.
    if (found.length > MAX_COMPLETION_RESULTS * 2) { found.sort(compare); found.length = MAX_COMPLETION_RESULTS; }
  }
  return found.sort(compare).slice(0, MAX_COMPLETION_RESULTS).map(item => item.value);
}
function compare(left: { value: LinkCompletion; score: number }, right: { value: LinkCompletion; score: number }): number {
  return right.score - left.score || left.value.path.localeCompare(right.value.path) || (left.value.alias ?? "").localeCompare(right.value.alias ?? "");
}

/** Existing addressable metadata only: never invent block IDs or ambiguous heading targets. */
export function subpathCompletions(trigger: BuiltinCompletionTrigger, path: string, text: string, cache?: CachedMetadata): SubpathCompletion[] {
  if ((trigger.kind !== "heading" && trigger.kind !== "block") || text.length > MAX_COMPLETION_SOURCE || !safeLinkText(path) || !/\.md$/i.test(path)) { return []; }
  cache ??= parseMarkdown(text);
  const ranker = createCompletionRanker(trigger.query);
  const values: { value: SubpathCompletion; score: number }[] = [];
  const range = (from: number, to: number): boolean => Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to <= text.length;
  const keep = (value: SubpathCompletion, rank: number): void => {
    if (rank < 0) { return; }
    values.push({ value, score: rank });
    if (values.length > MAX_COMPLETION_RESULTS * 2) { values.sort(order); values.length = MAX_COMPLETION_RESULTS; }
  };
  const order = (left: typeof values[number], right: typeof values[number]): number => right.score - left.score || left.value.from - right.value.from;
  let inspected = 0;
  if (trigger.kind === "heading") {
    if (trigger.headingParents?.length) {
      const parents = trigger.headingParents;
      if (parents.length >= MAX_COMPLETION_HEADING_DEPTH || parents.some(parent => !safeLinkText(parent) || parent.startsWith("^"))) { return []; }
      // A hierarchical result must round-trip through the complete resolver.
      // Refuse excessive heading inventories rather than validate against a
      // truncated cache that might hide an older literal-# destination.
      const headings: CachedMetadata["headings"] = [];
      let characters = 0;
      for (const heading of cache.headings) {
        if (headings.length >= MAX_COMPLETION_SUBPATHS) { return []; }
        if ((characters += heading.heading.length) > MAX_COMPLETION_SOURCE) { return []; }
        headings.push(heading);
      }
      const flatNames = new Set(headings.map(heading => subpathIdentity(heading.heading)));
      let start = 0, end = headings.length, level = 0;
      const canonical: string[] = [];
      for (const parent of parents) {
        let index = start;
        for (; index < end; index++) {
          const heading = headings[index];
          if (heading.level > level && subpathIdentity(heading.heading) === subpathIdentity(parent)) { break; }
        }
        if (index === end) { return []; }
        const heading = headings[index];
        if (!Number.isInteger(heading.level) || heading.level < 1 || heading.level > 6 || !safeLinkText(heading.heading) || heading.heading.startsWith("^") || !range(heading.position.start.offset, heading.position.end.offset)) { return []; }
        canonical.push(heading.heading); level = heading.level; start = index + 1;
        for (let boundary = start; boundary < end; boundary++) { if (headings[boundary].level <= level) { end = boundary; break; } }
      }
      const seen = new Set<string>();
      for (let index = start; index < end; index++) {
        const heading = headings[index], name = heading.heading, identity = subpathIdentity(name), from = heading.position.start.offset, to = heading.position.end.offset;
        const duplicate = seen.has(identity); seen.add(identity);
        if (!Number.isInteger(heading.level) || heading.level <= level || heading.level > 6 || !identity || duplicate || !safeLinkText(name) || name.startsWith("^") || !range(from, to)) { continue; }
        const chain = [...canonical, name].join("#");
        if (chain.length > 1_024 || flatNames.has(subpathIdentity(chain))) { continue; }
        keep({ kind: "heading", path, heading: name, parents: canonical, from, to }, ranker.score(name));
      }
      return values.sort(order).slice(0, MAX_COMPLETION_RESULTS).flatMap(({ value }) => {
        if (value.kind !== "heading") { return []; }
        const resolved = resolveSubpath(cache!, "#" + headingCompletionSubpath(value));
        return resolved?.type === "heading" && resolved.start.offset === value.from && resolved.end.offset === value.to ? [value] : [];
      });
    }
    const seen = new Set<string>();
    let characters = 0;
    for (const heading of cache.headings) {
      if (++inspected > MAX_COMPLETION_SUBPATHS) { break; }
      if ((characters += heading.heading.length) > MAX_COMPLETION_SOURCE) { break; }
      const name = heading.heading, identity = subpathIdentity(name), from = heading.position.start.offset, to = heading.position.end.offset;
      const duplicate = seen.has(identity);
      seen.add(identity);
      // Shared navigation chooses the first normalized heading. Later duplicates
      // cannot be linked independently by the current resolver.
      if (!safeLinkText(name) || name.startsWith("^") || !identity || duplicate || !range(from, to)) { continue; }
      keep({ kind: "heading", path, heading: name, from, to }, ranker.score(name));
    }
  } else {
    for (const id in cache.blocks) {
      if (!Object.hasOwn(cache.blocks, id)) { continue; }
      if (++inspected > MAX_COMPLETION_SUBPATHS) { break; }
      const block = cache.blocks[id], from = block.position.start.offset, to = block.position.end.offset;
      if (id.length > MAX_COMPLETION_RANK_VALUE || !/^[A-Za-z0-9-]+$/.test(id) || block.id !== id || !range(from, to) || !range(block.idPosition.start.offset, block.idPosition.end.offset) || text.slice(block.idPosition.start.offset, block.idPosition.end.offset) !== "^" + id) { continue; }
      const preview = text.slice(from, Math.min(to, from + 160)).replace(/\s+/g, " ").trim();
      const idRank = ranker.score(id), previewRank = ranker.score(preview);
      keep({ kind: "block", path, id, preview, from, to }, Math.max(idRank >= 0 ? idRank + 1_000 : -1, previewRank));
    }
  }
  return values.sort(order).slice(0, MAX_COMPLETION_RESULTS).map(({ value }) => value);
}

/** Global queries inspect cached headings, preserving the resolver's first normalized identity per note. */
export function globalHeadingCompletions(trigger: BuiltinCompletionTrigger, sources: Iterable<GlobalHeadingSource>): GlobalHeadingCompletion[] {
  if (trigger.kind !== "global-heading") { return []; }
  const ranker = createCompletionRanker(trigger.query);
  const found: { value: GlobalHeadingCompletion; score: number }[] = [];
  const order = (left: typeof found[number], right: typeof found[number]): number => right.score - left.score
    || left.value.path.localeCompare(right.value.path) || left.value.from - right.value.from;
  let documents = 0, inspected = 0, characters = 0;
  scan: for (const { path, text, cache } of sources) {
    if (++documents > MAX_COMPLETION_GLOBAL_DOCUMENTS) { break; }
    if (text.length > MAX_COMPLETION_SOURCE || !safeLinkText(path) || !/\.md$/i.test(path)) { continue; }
    const seen = new Set<string>();
    for (const heading of cache.headings) {
      if (++inspected > MAX_COMPLETION_GLOBAL_HEADINGS) { break scan; }
      const name = heading.heading;
      // Rejected names also consume the character budget before normalization.
      characters += name.length;
      if (characters > MAX_COMPLETION_GLOBAL_CHARACTERS) { break scan; }
      const identity = subpathIdentity(name), duplicate = seen.has(identity);
      seen.add(identity);
      const from = heading.position.start.offset, to = heading.position.end.offset;
      if (!safeLinkText(name) || name.startsWith("^") || !identity || duplicate
        || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > text.length) { continue; }
      const rank = ranker.score(name);
      if (rank < 0) { continue; }
      found.push({ value: { kind: "global-heading", path, heading: name, from, to }, score: rank });
      if (found.length > MAX_COMPLETION_RESULTS * 2) { found.sort(order); found.length = MAX_COMPLETION_RESULTS; }
    }
  }
  return found.sort(order).slice(0, MAX_COMPLETION_RESULTS).map(({ value }) => value);
}

export function propertyCompletions(query: string, knownKeys: Iterable<string>, existingKeys: readonly string[]): PropertyCompletion[] {
  const existing = new Set(existingKeys.map(key => key.toLowerCase())), seen = new Set<string>();
  const values: { name: string; score: number }[] = [];
  let inspected = 0;
  for (const name of knownKeys) {
    if (++inspected > MAX_COMPLETION_KEYS) { break; }
    if (typeof name !== "string" || !name.trim() || name.length > 256 || /[\x00-\x1f\x7f]/.test(name)) { continue; }
    const folded = name.toLowerCase(), rank = literalScore(query, name);
    if (!existing.has(folded) && !seen.has(folded) && rank >= 0) { seen.add(folded); values.push({ name, score: rank }); }
  }
  return values.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)).slice(0, MAX_COMPLETION_RESULTS).map(({ name }) => ({ kind: "property", name }));
}

export function propertyKeySource(name: string): string {
  // Prefer the ordinary spelling only if YAML confirms it is exactly the same string key.
  if (/^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(name)) {
    const parsed = parseDocument(name + ": null");
    if (!parsed.errors.length && isMap(parsed.contents) && isScalar(parsed.contents.items[0]?.key) && parsed.contents.items[0].key.value === name) { return name; }
  }
  return JSON.stringify(name);
}

/** Text values only; numbers, booleans, objects and nested arrays are not coerced. */
export function propertyValueCompletions(trigger: BuiltinCompletionTrigger, values: Iterable<unknown>): PropertyValueCompletion[] {
  if (trigger.kind !== "property-value" || !trigger.property) { return []; }
  const existing = new Set(trigger.existingValues ?? []), seen = new Set<string>();
  const found: { value: string; score: number }[] = [];
  let inspected = 0, characters = 0;
  for (const value of values) {
    if (++inspected > MAX_COMPLETION_VALUES) { break; }
    if (typeof value !== "string" || !value || value.length > MAX_COMPLETION_VALUE_LENGTH || /[\x00-\x1f\x7f]/.test(value) || existing.has(value) || seen.has(value)) { continue; }
    if (characters + value.length > MAX_COMPLETION_VALUE_CHARACTERS) { break; }
    characters += value.length;
    seen.add(value);
    const rank = literalScore(trigger.query, value);
    if (rank >= 0) { found.push({ value, score: rank }); }
  }
  return found.sort((left, right) => right.score - left.score || left.value.localeCompare(right.value)).slice(0, MAX_COMPLETION_RESULTS).map(({ value }) => ({ kind: "property-value", property: trigger.property!, value }));
}

export function planBuiltinCompletion(content: string, cursor: number, expected: BuiltinCompletionTrigger, value: BuiltinCompletion, linktext?: string): { from: number; to: number; insert: string; text: string; cursor: number } {
  const current = builtinCompletionTrigger(content, cursor);
  if (!current || current.kind !== expected.kind || value.kind !== current.kind || current.from !== expected.from || current.to !== expected.to || current.query !== expected.query || current.linkpath !== expected.linkpath || current.property !== expected.property
    || JSON.stringify(current.headingParents ?? []) !== JSON.stringify(expected.headingParents ?? [])) { throw new Error("The completion source changed."); }
  let insert: string;
  if (value.kind === "link") {
    if (!linktext || !safeLinkText(linktext) || value.alias !== undefined && !safeLinkText(value.alias)) { throw new Error("This link cannot be completed safely."); }
    insert = "[[" + linktext + (value.alias ? "|" + value.alias : "") + "]]";
  } else if (value.kind === "heading" || value.kind === "global-heading" || value.kind === "block") {
    if (linktext === undefined || linktext !== "" && !safeLinkText(linktext) || linktext === "" && current.linkpath !== "") { throw new Error("This link cannot be completed safely."); }
    const subpath = value.kind !== "block" ? headingCompletionSubpath(value) : "^" + value.id;
    if (value.kind === "heading" && (value.parents?.length ?? 0) !== (current.headingParents?.length ?? 0)
      || value.kind === "heading" && value.parents?.some((part, index) => subpathIdentity(part) !== subpathIdentity(current.headingParents![index]))
      || value.kind === "block" && !/^[A-Za-z0-9-]+$/.test(value.id)) { throw new Error("This subpath cannot be completed safely."); }
    insert = "[[" + linktext + "#" + subpath + "]]";
  } else if (value.kind === "property-value") {
    if (value.property !== current.property || !propertyValueCompletions(current, [value.value]).length) { throw new Error("This value is already present or no longer matches."); }
    // JSON string syntax is a YAML double-quoted scalar, retaining exact string
    // identity even for `true`, dates, colons, hashes, quotes and link-looking text.
    insert = JSON.stringify(value.value);
  } else {
    if (!propertyCompletions(current.query, [value.name], current.existingKeys ?? []).length) { throw new Error("This property is already present or no longer matches."); }
    insert = propertyKeySource(value.name) + ": ";
  }
  return { from: current.from, to: current.to, insert, text: content.slice(0, current.from) + insert + content.slice(current.to), cursor: current.from + insert.length };
}
