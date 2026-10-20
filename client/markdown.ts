import { markdownLanguage } from "@codemirror/lang-markdown";
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Document, type YAMLMap } from "yaml";

export interface SourceRange { from: number; to: number }
export interface Loc { line: number; ch: number; offset: number }
export interface Pos { start: Loc; end: Loc }
export interface HeadingCache { heading: string; level: number; position: Pos }
export interface TagCache { tag: string; position: Pos }
export interface BlockCache { id: string; position: Pos; idPosition: Pos }
export interface LinkCache {
  link: string;
  original: string;
  displayText?: string;
  position: Pos;
  targetPosition?: Pos;
  kind: "wiki" | "markdown" | "reference" | "frontmatter";
  propertyPath?: (string | number)[];
}
export interface FootnoteReference { id: string; position: Pos }
export interface FootnoteDefinition { id: string; content: string; position: Pos; labelPosition: Pos; inline?: boolean }
export interface CachedMetadata {
  headings: HeadingCache[];
  links: LinkCache[];
  embeds: LinkCache[];
  tags: TagCache[];
  blocks: Record<string, BlockCache>;
  frontmatter?: Record<string, unknown>;
  frontmatterPosition?: Pos;
  frontmatterLinks: LinkCache[];
  footnotes: FootnoteDefinition[];
  footnoteRefs: FootnoteReference[];
  sections: { type: string; position: Pos }[];
  listItems: { position: Pos; parent: number; task?: string }[];
  ignored: SourceRange[];
  errors: string[];
}

interface Frontmatter {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  doc: Document.Parsed;
  error?: string;
}

const individualWordCharacter = /[\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u4e00-\u9fd5]/u;
const wordPattern = new RegExp(`[0-9]+(?:[.,][0-9]+)*|(?:(?!${individualWordCharacter.source})(?=[\\u0000-\\uffff])\\p{L}|[-'\\u2019\\u0b80-\\u0bff])+|${individualWordCharacter.source}`, "gu");

export function countWords(content: string): number {
  let count = 0;
  for (const _word of content.matchAll(wordPattern)) { count++; }
  return count;
}

export function sourcePositions(content: string): (from: number, to: number) => Pos {
  const lines = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") {
      lines.push(index + 1);
    }
  }
  const location = (offset: number): Loc => {
    let low = 0;
    let high = lines.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lines[middle] <= offset) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return { line: low, ch: offset - lines[low], offset };
  };
  return (from, to) => ({ start: location(from), end: location(to) });
}

function frontmatter(content: string): Frontmatter | null {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(content);
  if (!opening) {
    return null;
  }
  const closing = /^---[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const end = closing.exec(content);
  const bodyTo = end?.index ?? content.length;
  const doc = parseDocument(content.slice(opening[0].length, bodyTo), { keepSourceTokens: true, uniqueKeys: true });
  const error = end ? doc.errors.map(issue => issue.message).join("\n") : "Frontmatter has no closing --- delimiter.";
  return { from: 0, to: end ? end.index + end[0].length : content.length, bodyFrom: opening[0].length, bodyTo, doc, error: error || undefined };
}

export function getFrontMatterInfo(content: string): { exists: boolean; frontmatter: string; from: number; to: number; contentStart: number } {
  const opening = /^---\r?\n/.exec(content);
  const closing = opening ? /^---(?:\r?\n|$)/m.exec(content.slice(opening[0].length)) : null;
  if (!opening || !closing) { return { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 }; }
  const from = opening[0].length, to = from + closing.index;
  return { exists: true, frontmatter: content.slice(from, to), from, to, contentStart: to + closing[0].length };
}

export function markdownSlides(content: string): string[] {
  const body = content.slice(frontmatter(content)?.to ?? 0);
  const rules: SourceRange[] = [];
  const definitions: string[] = [];
  for (let node = markdownLanguage.parser.parse(body).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "HorizontalRule") { rules.push({ from: node.from, to: node.to }); }
    else if (node.name === "LinkReference") { definitions.push(body.slice(node.from, node.to)); }
  }

  let start = 0;
  const slides: string[] = [];
  for (const rule of rules) {
    slides.push(body.slice(start, rule.from));
    start = rule.to;
  }
  slides.push(body.slice(start));
  const populated = slides.filter(slide => slide.trim());
  const references = definitions.length ? "\n\n" + definitions.join("\n") : "";
  return populated.length ? populated.map(slide => slide + references) : [""];
}

export function composerHeading(content: string, line: number, cache: Pick<CachedMetadata, "headings"> = parseMarkdown(content)): { heading: string; from: number; to: number } | null {
  const headings = cache.headings;
  const index = headings.findIndex(heading => heading.position.start.line === line);
  if (index < 0) { return null; }
  const heading = headings[index];
  const next = headings.slice(index + 1).find(candidate => candidate.level <= heading.level);
  const from = heading.position.start.offset;
  let to = next?.position.start.offset ?? content.length;
  if (next) { to -= /(?:\r?\n[ \t]*)+$/.exec(content.slice(from, to))?.[0].length ?? 0; }
  return { heading: heading.heading.trim(), from, to };
}

export function composerTemplate(content: string, template: string, fromTitle: string, newTitle: string): string {
  if (!template) { return content; }
  const format = template.includes("{{content}}") ? template : template + "\n\n{{content}}";
  const header = frontmatter(content);
  const variables: Record<string, string> = { fromTitle, newTitle, content: content.slice(header?.to ?? 0) };
  const rendered = format.replace(/\{\{(fromTitle|newTitle|content)\}\}/g, (_literal, key: string) => variables[key]);
  return header ? insertMarkdown(content.slice(0, header.to), rendered) : rendered;
}

function composerDefinitions(content: string): Map<string, { from: number; to: number; text: string }> {
  const definitions = new Map<string, { from: number; to: number; text: string }>();
  const ignored = parseMarkdown(content).ignored;
  markdownLanguage.parser.parse(content).iterate({ enter(node) {
    if (node.name !== "LinkReference" || overlaps(ignored, node.from, node.to)) { return; }
    const label = node.node.getChild("LinkLabel");
    if (!label) { return; }
    const key = content.slice(label.from + 1, label.to - 1).trim().toLowerCase().replace(/\s+/g, " ");
    if (!key.startsWith("^")) { definitions.set(key, { from: node.from, to: node.to, text: content.slice(node.from, node.to) }); }
  } });
  return definitions;
}

export function composerFragment(content: string, from: number, to: number): string {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > content.length) {
    throw new Error("Choose a nonempty selection within the source note.");
  }
  const cache = parseMarkdown(content);
  const definitions = composerDefinitions(content);
  const references = [...cache.links, ...cache.embeds].filter(reference => reference.kind === "reference");
  const ranges: SourceRange[] = [{ from, to }];
  const additions = new Set<string>();
  const contains = (range: SourceRange, position: Pos): boolean => position.start.offset >= range.from && position.end.offset <= range.to;
  const include = (range: SourceRange): void => {
    if (ranges.some(included => range.from >= included.from && range.to <= included.to)) { return; }
    additions.add(content.slice(range.from, range.to));
    ranges.push(range);
  };
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    for (const reference of references.filter(reference => contains(range, reference.position))) {
      const position = reference.targetPosition;
      if (!position || ranges.some(included => contains(included, position))) { continue; }
      const definition = [...definitions.values()].find(entry => position.start.offset >= entry.from && position.end.offset <= entry.to);
      if (!definition) { throw new Error("A selected reference link has no transferable definition."); }
      include(definition);
    }
    for (const reference of cache.footnoteRefs.filter(reference => contains(range, reference.position))) {
      const definitions = cache.footnotes.filter(definition => definition.id === reference.id);
      if (definitions.length !== 1) { throw new Error("Resolve missing or duplicate footnote definitions before extracting: " + reference.id); }
      const definition = definitions[0];
      if (!definition.inline) { include({ from: definition.position.start.offset, to: definition.position.end.offset }); }
    }
  }
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return content.slice(from, to) + (additions.size ? newline + newline + [...additions].join(newline + newline) : "");
}

export function insertMarkdown(target: string, insertion: string, placement: "append" | "prepend" = "append"): string {
  const bom = target.startsWith("\ufeff") ? "\ufeff" : "";
  const destination = target.replace(/^\ufeff/, "");
  const incoming = insertion.replace(/^\ufeff/, "");
  const original = frontmatter(destination);
  const added = frontmatter(incoming);
  if (original) { frontmatterValue(original); }
  if (added) { frontmatterValue(added); }
  const definitions = composerDefinitions(destination);
  for (const [key, definition] of composerDefinitions(incoming)) {
    const previous = definitions.get(key);
    if (previous && previous.text !== definition.text) { throw new Error("Resolve conflicting reference-link definitions before combining notes: " + key); }
  }
  const footnotes = parseMarkdown(destination).footnotes;
  for (const definition of parseMarkdown(incoming).footnotes.filter(definition => !definition.inline)) {
    const previous = footnotes.find(note => note.id === definition.id && !note.inline);
    if (previous && previous.content !== definition.content) { throw new Error("Resolve conflicting footnote definitions before combining notes: " + definition.id); }
  }
  const newline = destination.includes("\r\n") || !destination && incoming.includes("\r\n") ? "\r\n" : "\n";
  let prefix = original ? destination.slice(0, original.to) : "";
  if (added && isMap(added.doc.contents) && added.doc.contents.items.length) {
    visit(added.doc, (_key, node) => {
      if (isAlias(node) || isNode(node) && "anchor" in node && node.anchor) {
        throw new Error("Resolve YAML aliases/anchors in inserted metadata before combining notes; the original notes were retained.");
      }
    });
    const doc: Document = original?.doc ?? parseDocument("{}");
    if (doc.contents === null) { doc.contents = doc.createNode({}); }
    if (!isMap(doc.contents)) { throw new Error("Note properties must be a YAML mapping."); }
    mergeComposerProperties(doc.contents, added.doc.contents);
    doc.contents.flow = false;
    retainNumericLexemes(doc);
    doc.toJS({ maxAliasCount: 50 });
    const serialized = serializeFrontmatter(destination, original, doc, newline);
    const header = frontmatter(serialized);
    if (!header) { throw new Error("The combined note properties could not be serialized."); }
    frontmatterValue(header);
    prefix = serialized.slice(0, header.to);
  }
  const body = destination.slice(original?.to ?? 0);
  const fragment = incoming.slice(added?.to ?? 0).replace(/\r?\n/g, newline);
  const first = placement === "prepend" ? fragment : body;
  const last = placement === "prepend" ? body : fragment;
  let separator = "";
  if (first && last && !first.endsWith(newline + newline) && !last.startsWith(newline + newline)) {
    const boundaries = Number(first.endsWith(newline)) + Number(last.startsWith(newline));
    separator = newline.repeat(2 - boundaries);
  }
  return bom + prefix + first + separator + last;
}

function mergeComposerProperties(target: YAMLMap, incoming: YAMLMap): void {
  for (const pair of incoming.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") { throw new Error("Note properties must use text keys."); }
    const key = pair.key.value;
    const previous = target.get(key, true);
    const previousValue = isScalar(previous) ? previous.value : previous;
    if ((pair.value === null || isScalar(pair.value) && pair.value.value === null) && previousValue) { continue; }
    if (isMap(previous) && isMap(pair.value)) {
      mergeComposerProperties(previous, pair.value);
    } else if (isSeq(previous) && isSeq(pair.value)) {
      for (const value of pair.value.items) {
        const exists = previous.items.some(prior => {
          if (!isScalar(prior) || !isScalar(value)) { return prior === null && value === null; }
          return Object.is(prior.value, value.value) && (typeof prior.value !== "number" || prior.source === value.source);
        });
        if (!exists) { previous.items.push(isNode(value) ? value.clone() : value); }
      }
    } else {
      if (isMap(previous) && isSeq(pair.value) || isSeq(previous) && isMap(pair.value)) { throw new Error("Resolve incompatible list/mapping property types before combining notes: " + key); }
      target.set(key, isNode(pair.value) ? pair.value.clone() : pair.value);
    }
  }
}

export const markdownFormatConversions = [
  "roam-tags", "roam-highlights", "roam-todos", "bear-highlights",
  "zettelkasten-links", "zettelkasten-aliases", "frontmatter",
] as const;
export type MarkdownFormatConversion = typeof markdownFormatConversions[number];

export function convertMarkdownFormats(content: string, formats: readonly MarkdownFormatConversion[], resolve: (id: string) => { link: string; title: string } | null = () => null): { content: string; replacements: number } {
  if (formats.some(format => !markdownFormatConversions.includes(format))) {
    throw new Error("An unknown Markdown conversion was selected.");
  }
  const selected = new Set(formats);
  let replacements = 0;
  const replacement = (before: string, after: string): string => {
    if (before !== after) { replacements++; }
    return after;
  };
  if (selected.has("roam-tags")) {
    content = content.replace(/(^|\s)#([^\s#]+)/g, (original: string, prefix: string, rest: string) => {
      let tag = "";
      for (const character of rest) {
        const point = character.codePointAt(0)!;
        if (point < 128 ? !/[A-Za-z0-9_/-]/.test(character) : point >= 0x2000 && point <= 0x206f || point >= 0x2e00 && point <= 0x2e7f) { break; }
        tag += character;
      }
      return tag && !/^\d+$/.test(tag) ? replacement(original, prefix + "[[" + tag + "]]" + rest.slice(tag.length)) : original;
    });
    content = content.replace(/#\[\[([\w \t]*)\]\]/g, (original: string, title: string, offset: number, source: string) =>
      offset > 0 && /\w/.test(source[offset - 1]) ? original : replacement(original, "[[" + title + "]]"));
  }
  if (selected.has("roam-highlights")) {
    content = content.replace(/\^\^(\S(?:[^\r\n]*?\S)?)\^\^/g, (original: string, text: string) => replacement(original, "==" + text + "=="));
  }
  if (selected.has("roam-todos")) {
    content = content.replace(/\{\{\[\[(TODO|DONE)\]\]\}\}/g, (original: string, task: string) => replacement(original, task === "TODO" ? "[ ]" : "[x]"));
  }
  if (selected.has("bear-highlights")) {
    content = content.replace(/::(\S(?:[^\r\n]*?\S)?)::/g, (original: string, text: string) => replacement(original, "==" + text + "=="));
  }
  for (const format of ["zettelkasten-links", "zettelkasten-aliases"] as const) {
    if (!selected.has(format)) { continue; }
    content = content.replace(/\[\[(\d+)\]\]/g, (original: string, id: string) => {
      const destination = resolve(id);
      if (!destination) { return original; }
      const alias = destination.title.replace(id, "").trim();
      if (!destination.link || /[#^[\]|\r\n]/.test(destination.link) || format === "zettelkasten-aliases" && /[[\]|\r\n]/.test(alias)) {
        throw new Error("The numeric-link destination cannot be represented safely as a wiki link: " + destination.link);
      }
      return replacement(original, "[[" + destination.link + (format === "zettelkasten-aliases" ? "|" + alias : "") + "]]");
    });
  }
  if (selected.has("frontmatter") && frontmatter(content)) {
    for (const [singular, plural] of [["alias", "aliases"], ["tag", "tags"], ["cssclass", "cssclasses"]]) {
      const properties = frontmatterValue(frontmatter(content)!);
      const sources = Object.keys(properties).filter(key => key.toLowerCase() === singular);
      const targets = Object.keys(properties).filter(key => key.toLowerCase() === plural);
      if (sources.length > 1 || targets.length > 1) { throw new Error("Resolve case-ambiguous frontmatter before converting " + plural + "."); }
      let key = targets[0];
      if (!key && sources.length) {
        key = plural;
        content = renameFrontmatterProperty(content, sources[0], key);
        replacements++;
      }
      const value = key ? frontmatterValue(frontmatter(content)!)[key] : undefined;
      if (typeof value === "string") {
        const values = value.split(plural === "aliases" ? /[,\n]/ : /[ ,\n]/).map(value => value.trim()).filter(Boolean);
        content = updateFrontmatter(content, data => { data[key] = values; });
        replacements++;
      }
    }
  }
  return { content, replacements };
}

function propertyObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function frontmatterValue(header: Frontmatter): Record<string, unknown> {
  if (header.error) {
    throw new Error(header.error);
  }
  if (header.doc.contents !== null && !isMap(header.doc.contents)) {
    throw new Error("Frontmatter must be a mapping of property names to values.");
  }
  const value: unknown = header.doc.toJS({ maxAliasCount: 50 });
  if (value === null) {
    return {};
  }
  if (!propertyObject(value)) {
    throw new Error("Frontmatter must be a mapping of property names to values.");
  }
  return value;
}

export function sameValue(left: unknown, right: unknown, seen = new WeakMap<object, Set<object>>()): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    const matches = seen.get(left) ?? new Set<object>();
    if (matches.has(right)) {
      return true;
    }
    matches.add(right);
    seen.set(left, matches);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index], seen));
  }
  if (propertyObject(left) && propertyObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key], seen));
  }
  return false;
}

export function updateFrontmatter(content: string, change: (properties: Record<string, unknown>) => void): string {
  const header = frontmatter(content);
  const original = header ? frontmatterValue(header) : {};
  const properties = structuredClone(original);
  change(properties);
  if (sameValue(original, properties)) {
    return content;
  }
  const doc = header?.doc ?? parseDocument("{}");
  retainNumericLexemes(doc);
  for (const key of Object.keys(original)) {
    if (!Object.hasOwn(properties, key)) {
      doc.delete(key);
    }
  }
  for (const [key, value] of Object.entries(properties)) {
    if (!sameValue(original[key], value) || !Object.hasOwn(original, key)) {
      if (value === undefined || typeof value === "function" || typeof value === "symbol") {
        throw new Error(`Property "${key}" is not a YAML value.`);
      }
      doc.set(key, editYamlNode(doc, doc.get(key, true), original[key], value));
    }
  }
  if (isMap(doc.contents)) {
    doc.contents.flow = false;
  }
  if (!sameValue(doc.toJS({ maxAliasCount: 50 }), properties)) {
    throw new Error("This property edit would also change YAML aliases or unsupported values. Edit the source to control those changes explicitly.");
  }
  return serializeFrontmatter(content, header, doc);
}

function serializeFrontmatter(content: string, header: Frontmatter | null, doc: Document, newline = content.includes("\r\n") ? "\r\n" : "\n"): string {
  const yaml = doc.toString({ lineWidth: 0 }).replaceAll("\n", newline);
  if (!header) {
    return `---${newline}${yaml}---${newline}${content}`;
  }
  return content.slice(0, header.bodyFrom) + yaml + content.slice(header.bodyTo);
}

function editYamlNode(doc: Document, node: unknown, original: unknown, value: unknown, edited = new WeakSet<object>()): unknown {
  if (sameValue(original, value) && isNode(node)) { return node; }
  if (isNode(node)) {
    if (edited.has(node)) { return node; }
    edited.add(node);
  }
  if (isAlias(node)) {
    const target = node.resolve(doc);
    if (!target || editYamlNode(doc, target, original, value, edited) !== target) { throw new Error("Change aliased YAML value types in the source editor."); }
    return node;
  }
  if (isMap(node) && propertyObject(original) && propertyObject(value)) {
    for (const key of Object.keys(original)) { if (!Object.hasOwn(value, key)) { node.delete(key); } }
    for (const [key, entry] of Object.entries(value)) {
      if (!Object.hasOwn(original, key) || !sameValue(original[key], entry)) { node.set(key, editYamlNode(doc, node.get(key, true), original[key], entry, edited)); }
    }
    return node;
  }
  if (isSeq(node) && Array.isArray(original) && Array.isArray(value)) {
    const items = node.items.slice();
    const used = new Set<number>();
    const matches = value.map((entry, index) => {
      if (index < original.length && sameValue(original[index], entry)) { used.add(index); return index; }
      return -1;
    });
    for (let index = 0; index < value.length; index++) {
      if (matches[index] >= 0) { continue; }
      matches[index] = original.findIndex((entry, prior) => !used.has(prior) && sameValue(entry, value[index]));
      if (matches[index] >= 0) { used.add(matches[index]); }
    }
    node.items = value.map((entry, index) => {
      if (matches[index] >= 0) { return items[matches[index]]; }
      if (index < original.length && !used.has(index)) { used.add(index); return editYamlNode(doc, items[index], original[index], entry, edited); }
      return doc.createNode(entry);
    });
    return node;
  }
  if (isScalar(node) && (value === null || ["string", "boolean", "number"].includes(typeof value))) {
    if (node.tag && typeof node.value !== typeof value) { throw new Error("Change explicitly tagged YAML value types in the source editor."); }
    node.value = value;
    return node;
  }
  const replacement = doc.createNode(value);
  if (isNode(node)) {
    replacement.commentBefore = node.commentBefore;
    replacement.comment = node.comment;
    replacement.spaceBefore = node.spaceBefore;
  }
  return replacement;
}

function retainNumericLexemes(doc: Document): void {
  const sources = new WeakMap<object, { value: unknown; source: string }>();
  visit(doc, { Scalar(_key, node) {
    if (typeof node.value === "number" && node.source !== undefined) { sources.set(node, { value: node.value, source: node.source }); }
  } });
  const schema = doc.schema.clone();
  schema.tags = schema.tags.map(tag => {
    const stringify = tag.stringify;
    if (!["tag:yaml.org,2002:int", "tag:yaml.org,2002:float"].includes(tag.tag) || !stringify) { return tag; }
    return { ...tag, stringify(item, context, onComment, onChompKeep) {
      const original = sources.get(item);
      if (original && Object.is(item.value, original.value)) { return original.source; }
      return stringify(item, context, onComment, onChompKeep);
    } };
  });
  doc.schema = schema;
}

export function renameFrontmatterProperty(content: string, oldName: string, newName: string): string {
  const header = frontmatter(content);
  if (!header) { return content; }
  const original = frontmatterValue(header);
  if (!isMap(header.doc.contents)) { return content; }
  const matches = header.doc.contents.items.filter(pair => isScalar(pair.key) && typeof pair.key.value === "string" && pair.key.value.toLowerCase() === oldName.toLowerCase());
  if (!matches.length) { return content; }
  if (matches.length > 1) { throw new Error("This note contains multiple case variants of the property; resolve them before renaming it."); }
  const target = header.doc.contents.items.find(pair => isScalar(pair.key) && typeof pair.key.value === "string" && pair.key.value.toLowerCase() === newName.toLowerCase());
  if (target && target !== matches[0]) { throw new Error("The destination property already exists in this note: " + newName); }
  const key = matches[0].key;
  if (!isScalar(key)) { throw new Error("Only text property names can be renamed."); }
  if (key.value === newName) { return content; }
  const properties = { ...original };
  delete properties[String(key.value)];
  Object.defineProperty(properties, newName, { value: original[String(key.value)], enumerable: true, writable: true, configurable: true });
  retainNumericLexemes(header.doc);
  key.value = newName;
  if (!sameValue(header.doc.toJS({ maxAliasCount: 50 }), properties)) {
    throw new Error("This property rename would also change YAML aliases. Edit the source to control those changes explicitly.");
  }
  return serializeFrontmatter(content, header, header.doc);
}

export function isEscaped(content: string, offset: number): boolean {
  let slashes = 0;
  while (offset > 0 && content[--offset] === "\\") {
    slashes++;
  }
  return slashes % 2 === 1;
}

export function mergeRanges(ranges: SourceRange[]): SourceRange[] {
  const result: SourceRange[] = [];
  for (const range of ranges.sort((left, right) => left.from - right.from || left.to - right.to)) {
    const last = result.at(-1);
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
    } else {
      result.push({ ...range });
    }
  }
  return result;
}

export function overlaps(ranges: readonly SourceRange[], from: number, to = from + 1): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle].to <= from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < ranges.length && ranges[low].from < to;
}

export function parseFrontMatterEntry(frontmatter: unknown, key: string | RegExp): unknown {
  if (!frontmatter || typeof frontmatter !== "object") { return null; }
  if (typeof key === "string") {
    return Object.hasOwn(frontmatter, key) ? Reflect.get(frontmatter, key) : null;
  }
  for (const name of Object.keys(frontmatter)) {
    if (key.test(name)) { return Reflect.get(frontmatter, name); }
  }
  return null;
}

export function parseFrontMatterStringArray(frontmatter: unknown, key: string | RegExp): string[] | null {
  const value = parseFrontMatterEntry(frontmatter, key);
  if (!value) { return null; }
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!values) { return null; }
  return values.filter((entry): entry is string => typeof entry === "string").map(entry => entry.trim());
}

export function parseFrontMatterAliases(frontmatter: unknown): string[] | null {
  const aliases = parseFrontMatterStringArray(frontmatter, /^aliases$/i);
  return aliases?.filter(alias => alias.length > 0) ?? null;
}

export function parseFrontMatterTags(frontmatter: unknown): string[] | null {
  const tags = parseFrontMatterStringArray(frontmatter, /^tags$/i);
  if (!tags) { return null; }
  return tags.filter(tag => tag.length > 0 && !tag.includes(" ")).map(tag => tag.startsWith("#") ? tag : "#" + tag);
}

export function allTags(cache: CachedMetadata): string[] {
  const result = cache.tags.map(entry => entry.tag);
  const tags = cache.frontmatter?.tags;
  const values = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[,\s]+/) : [];
  for (const value of values) {
    if (typeof value === "string") {
      const tag = value.replace(/^#/, "");
      if (validTag(tag)) {
        result.push("#" + tag);
      }
    }
  }
  return result;
}

export interface UnlinkedTarget {
  path: string;
  basename: string;
  cache: CachedMetadata | null;
}

export function outgoingMentions(text: string, cache: CachedMetadata, sourcePath: string, files: readonly UnlinkedTarget[]): { path: string; matches: SourceRange[] }[] {
  const excluded = mergeRanges([
    ...cache.ignored,
    ...[...cache.links, ...cache.embeds].map(link => ({ from: link.position.start.offset, to: link.position.end.offset })),
  ]);
  const result: { path: string; matches: SourceRange[] }[] = [];
  for (const file of files) {
    if (file.path === sourcePath) {
      continue;
    }
    const aliases = file.cache?.frontmatter?.aliases;
    const names = [file.basename, ...(Array.isArray(aliases) ? aliases : typeof aliases === "string" ? [aliases] : [])]
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
    const matches = new Map<string, SourceRange>();
    for (const name of new Set(names.map(name => name.trim()))) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expression = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
      for (const match of text.matchAll(expression)) {
        const from = match.index;
        const to = from + match[0].length;
        if (!overlaps(excluded, from, to) && !isEscaped(text, from)) {
          matches.set(`${from}:${to}`, { from, to });
        }
      }
    }
    if (matches.size) {
      result.push({ path: file.path, matches: mergeRanges([...matches.values()]) });
    }
  }
  return result;
}

export function plainMarkdown(text: string): string {
  return text.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_original: string, link: string, alias?: string) => alias ?? link)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_[\]{}()#+.!|>~-])/g, "$1")
    .replace(/[*_`~]/g, "").replace(/<[^>]*>/g, "").trim();
}

export function validTag(tag: string): boolean {
  return /^[\p{L}\p{N}_/-]+$/u.test(tag) && /[\p{L}_-]/u.test(tag);
}

function externalLink(link: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link);
}

function markdownTarget(value: string): string {
  return value.replace(/^<([\s\S]*)>$/, "$1").replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
    .replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, entity => {
      const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
      if (Object.hasOwn(named, entity.toLowerCase())) {
        return named[entity.toLowerCase()];
      }
      const number = entity.slice(2, -1);
      const code = number[0].toLowerCase() === "x" ? Number.parseInt(number.slice(1), 16) : Number.parseInt(number, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
    });
}

function wikiTarget(value: string): { target: string; alias?: string } {
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "|" && !isEscaped(value, index)) {
      return { target: value.slice(0, index), alias: value.slice(index + 1).replace(/\\([|\\])/g, "$1") };
    }
  }
  return { target: value };
}

function readFootnotes(content: string, position: (from: number, to: number) => Pos, excluded: readonly SourceRange[]): FootnoteDefinition[] {
  const result: FootnoteDefinition[] = [];
  const definitions = /^[ \t]{0,3}\[\^([^\]\r\n]+)\]:[ \t]*(.*)\r?$/gm;
  for (const match of content.matchAll(definitions)) {
    if (overlaps(excluded, match.index) || isEscaped(content, match.index)) {
      continue;
    }
    let end = match.index + match[0].replace(/\r$/, "").length;
    let cursor = content.indexOf("\n", end);
    const body = [match[2].replace(/\r$/, "")];
    while (cursor >= 0 && cursor < content.length - 1) {
      const nextLine = cursor + 1;
      const nextEnd = content.indexOf("\n", nextLine);
      const text = content.slice(nextLine, nextEnd < 0 ? content.length : nextEnd).replace(/\r$/, "");
      if (/^(?: {4}|\t)/.test(text)) {
        body.push(text.replace(/^(?: {4}|\t)/, ""));
        end = nextLine + text.length;
        cursor = nextEnd;
      } else if (!text.trim() && nextEnd >= 0 && /^(?: {4}|\t)/.test(content.slice(nextEnd + 1))) {
        body.push("");
        cursor = nextEnd;
      } else {
        break;
      }
    }
    const labelFrom = match.index + match[0].indexOf("[^");
    result.push({ id: match[1], content: body.join("\n"), position: position(match.index, end), labelPosition: position(labelFrom, labelFrom + match[1].length + 3) });
  }
  return result;
}

export function parseMarkdown(content: string): CachedMetadata {
  const position = sourcePositions(content);
  const cache: CachedMetadata = { headings: [], links: [], embeds: [], tags: [], blocks: Object.create(null), frontmatterLinks: [], footnotes: [], footnoteRefs: [], sections: [], listItems: [], ignored: [], errors: [] };
  const header = frontmatter(content);
  const excluded: SourceRange[] = header ? [{ from: header.from, to: header.to }] : [];
  for (const comment of content.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
    excluded.push({ from: comment.index, to: comment.index + comment[0].length });
  }
  if (header) {
    cache.frontmatterPosition = position(header.from, header.to);
    try {
      cache.frontmatter = frontmatterValue(header);
    } catch (error) {
      cache.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const source = header ? content.slice(0, header.to).replace(/[^\r\n]/g, " ") + content.slice(header.to) : content;
  const tree = markdownLanguage.parser.parse(source);
  const code: SourceRange[] = [];
  tree.iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "HTMLTag", "CommentBlock"].includes(node.name)) {
        code.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  const initial = mergeRanges([...excluded, ...code.filter(range => !/^[ \t]/.test(content.slice(range.from, range.to)))]);
  cache.footnotes = readFootnotes(content, position, initial);
  for (const range of code) {
    const lineStart = content.lastIndexOf("\n", range.from - 1) + 1;
    const indentation = content.slice(lineStart, range.from);
    const continuation = /^(?: {4}|\t)$/.test(indentation) && cache.footnotes.some(note => note.position.start.offset < range.from && note.position.end.offset >= range.to - 1);
    if (!continuation) {
      excluded.push(range);
    }
  }
  cache.ignored = mergeRanges(excluded);
  const definitions = new Map<string, { link: string; range: SourceRange }>();
  const labelKey = (value: string): string => value.replace(/^\[|\]$/g, "").trim().replace(/\s+/g, " ").toLowerCase();
  tree.iterate({
    enter(node) {
      if (node.name === "LinkReference" && !overlaps(cache.ignored, node.from) && !/^[ \t]*\[\^/.test(content.slice(node.from, node.to))) {
        const label = node.node.getChild("LinkLabel");
        const url = node.node.getChild("URL");
        if (label && url) {
          definitions.set(labelKey(content.slice(label.from, label.to)), { link: markdownTarget(content.slice(url.from, url.to)), range: { from: url.from, to: url.to } });
        }
      }
    },
  });
  const wikiRanges: SourceRange[] = [];
  for (const match of content.matchAll(/(!?)\[\[([^\]\r\n]+)\]\]/g)) {
    if (isEscaped(content, match.index) || overlaps(cache.ignored, match.index, match.index + match[0].length)) {
      continue;
    }
    const { target, alias } = wikiTarget(match[2]);
    if (!target.trim() || externalLink(target)) {
      continue;
    }
    const from = match.index + match[1].length + 2;
    const entry: LinkCache = {
      kind: "wiki", link: target.trim(), original: match[0], displayText: alias,
      position: position(match.index, match.index + match[0].length), targetPosition: position(from, from + target.length),
    };
    (match[1] ? cache.embeds : cache.links).push(entry);
    wikiRanges.push({ from: match.index, to: match.index + match[0].length });
  }
  const wikiIgnored = mergeRanges(wikiRanges);
  tree.iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock"].includes(node.name) && node.from >= (header?.to ?? 0)) {
        cache.sections.push({ type: "code", position: position(node.from, node.to) });
      }
      if (overlaps(cache.ignored, node.from)) {
        return;
      }
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        const text = content.slice(node.from, node.to).replace(/\r$/, "");
        const value = node.name.startsWith("ATX")
          ? text.replace(/^#{1,6}[ \t]*/, "").replace(/[ \t]+#+[ \t]*$/, "").trim()
          : text.replace(/\r?\n[=-]+[ \t]*$/, "").replace(/\r?\n/g, " ").trim();
        cache.headings.push({ heading: value, level: Number(heading[1]), position: position(node.from, node.to) });
      }
      if (["Paragraph", "FencedCode", "CodeBlock", "Blockquote", "BulletList", "OrderedList"].includes(node.name) || heading) {
        cache.sections.push({ type: heading ? "heading" : node.name === "Paragraph" ? "paragraph" : node.name.endsWith("Code") || node.name === "CodeBlock" ? "code" : node.name.toLowerCase(), position: position(node.from, node.to) });
      }
      if (node.name === "ListItem") {
        const task = /^[*+-][ \t]+\[([ xX])\]/.exec(content.slice(node.from, node.to));
        let parent = node.node.parent;
        while (parent && parent.name !== "ListItem") {
          parent = parent.parent;
        }
        cache.listItems.push({ position: position(node.from, node.to), parent: parent?.from ?? -1, task: task?.[1] });
      }
      if (node.name !== "Link" && node.name !== "Image") {
        return;
      }
      if (overlaps(wikiIgnored, node.from, node.to)) {
        return;
      }
      const raw = content.slice(node.from, node.to);
      if (/^\[\^/.test(raw)) {
        return;
      }
      const url = node.node.getChild("URL");
      let link: string | undefined;
      let range: SourceRange | undefined;
      let kind: LinkCache["kind"] = "markdown";
      if (url) {
        link = markdownTarget(content.slice(url.from, url.to));
        range = { from: url.from, to: url.to };
      } else {
        const label = node.node.getChild("LinkLabel");
        const target = label ? content.slice(label.from, label.to) : /^\[([^\]]+)\]/.exec(raw)?.[1];
        const definition = target === undefined ? undefined : definitions.get(labelKey(target));
        if (definition) {
          link = definition.link;
          range = definition.range;
          kind = "reference";
        }
      }
      if (!link || !range || externalLink(link)) {
        return;
      }
      if (content[range.from] === "<" && content[range.to - 1] === ">") {
        range = { from: range.from + 1, to: range.to - 1 };
      }
      const entry: LinkCache = {
        kind, link, original: raw, displayText: /^!?\[([^\]]*)\]/.exec(raw)?.[1],
        position: position(node.from, node.to), targetPosition: position(range.from, range.to),
      };
      (node.name === "Image" ? cache.embeds : cache.links).push(entry);
    },
  });
  for (const match of content.matchAll(/#[\p{L}\p{N}_/-]+/gu)) {
    const previous = Array.from(content.slice(Math.max(0, match.index - 2), match.index)).at(-1) ?? "";
    if (validTag(match[0].slice(1)) && !/[\p{L}\p{N}_/#(]/u.test(previous) && !isEscaped(content, match.index) && !overlaps(cache.ignored, match.index, match.index + match[0].length)) {
      const inLink = [...cache.links, ...cache.embeds].some(link => match.index >= link.position.start.offset && match.index < link.position.end.offset);
      if (!inLink) {
        cache.tags.push({ tag: match[0], position: position(match.index, match.index + match[0].length) });
      }
    }
  }
  for (const match of content.matchAll(/(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*\r?$/gm)) {
    const from = match.index + match[0].indexOf("^");
    if (overlaps(cache.ignored, from) || isEscaped(content, from)) {
      continue;
    }
    const lineStart = content.lastIndexOf("\n", from - 1) + 1;
    const ownLine = !content.slice(lineStart, from).trim();
    const section = cache.sections.filter(entry => ownLine ? entry.position.end.offset <= lineStart : entry.position.start.offset <= from && entry.position.end.offset >= from).at(-1);
    const start = section?.position.start.offset ?? lineStart;
    const end = section?.position.end.offset ?? from;
    cache.blocks[match[1]] = { id: match[1], position: position(start, end), idPosition: position(from, from + match[1].length + 1) };
  }
  for (const match of content.matchAll(/\[\^([^\]\r\n]+)\]/g)) {
    if (!isEscaped(content, match.index) && !overlaps(cache.ignored, match.index, match.index + match[0].length) && !cache.footnotes.some(note => note.labelPosition.start.offset === match.index)) {
      cache.footnoteRefs.push({ id: match[1], position: position(match.index, match.index + match[0].length) });
    }
  }
  if (header && cache.frontmatter) {
    const visited = new WeakSet<object>();
    const collect = (value: unknown, path: (string | number)[]): void => {
      if (value !== null && typeof value === "object") {
        if (visited.has(value)) {
          return;
        }
        visited.add(value);
      }
      if (typeof value === "string") {
        const node = header.doc.getIn(path, true);
        const range = isScalar(node) ? node.range : undefined;
        const from = header.bodyFrom + (range?.[0] ?? 0);
        const to = header.bodyFrom + (range?.[1] ?? header.bodyTo - header.bodyFrom);
        for (const match of value.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
          const { target, alias } = wikiTarget(match[1]);
          if (!target.trim() || externalLink(target)) {
            continue;
          }
          const found = content.indexOf(match[0], from);
          const exact = found >= from && found + match[0].length <= to;
          cache.frontmatterLinks.push({
            kind: "frontmatter", link: target.trim(), original: match[0], displayText: alias, propertyPath: path,
            position: exact ? position(found, found + match[0].length) : position(from, to),
          });
        }
      } else if (Array.isArray(value)) {
        value.forEach((entry, index) => collect(entry, [...path, index]));
      } else if (propertyObject(value)) {
        Object.entries(value).forEach(([key, entry]) => collect(entry, [...path, key]));
      }
    };
    Object.entries(cache.frontmatter).forEach(([key, value]) => collect(value, [key]));
  }
  cache.links.sort((left, right) => left.position.start.offset - right.position.start.offset);
  cache.embeds.sort((left, right) => left.position.start.offset - right.position.start.offset);
  return cache;
}
