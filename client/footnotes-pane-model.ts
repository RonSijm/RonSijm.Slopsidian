import { copyViewData } from "./contracts";
import { sourcePositions, type CachedMetadata, type FootnoteDefinition, type FootnoteReference, type Pos } from "./markdown";

export interface FootnotesPaneState { file: string; followActiveFile: boolean; }
export interface FootnoteEntry { id: string; number: number | null; definitions: FootnoteDefinition[]; references: FootnoteReference[]; }

export function footnotesPaneState(value: unknown): FootnotesPaneState {
  const state = copyViewData(value), file = state.file === undefined ? "" : state.file;
  if (typeof file !== "string" || file.length > 4096 || file && (/[\\\x00-\x1f]/.test(file) || file.split("/").some(part => !part || part.startsWith(".")))) {
    throw new Error("Footnotes needs a visible relative vault file path.");
  }
  if (state.followActiveFile !== undefined && typeof state.followActiveFile !== "boolean") { throw new Error("Footnotes followActiveFile must be Boolean."); }
  return { file, followActiveFile: state.followActiveFile !== false };
}

export function footnoteEntries(cache: Pick<CachedMetadata, "footnotes" | "footnoteRefs">, text: string): FootnoteEntry[] {
  const position = sourcePositions(text), entries = new Map<string, FootnoteEntry>();
  const range = (value: Pos): Pos => {
    if (!value || !value.start || !value.end || !Number.isSafeInteger(value.start.offset) || !Number.isSafeInteger(value.end.offset) || value.start.offset < 0 || value.end.offset < value.start.offset || value.end.offset > text.length) {
      throw new Error("Invalid footnote source range.");
    }
    const actual = position(value.start.offset, value.end.offset);
    for (const end of ["start", "end"] as const) {
      if (value[end].line !== actual[end].line || value[end].ch !== actual[end].ch) { throw new Error("Footnote positions do not match the indexed source."); }
    }
    return actual;
  };
  const entry = (id: string): FootnoteEntry => {
    if (typeof id !== "string" || !id || /[\]\r\n]/.test(id)) { throw new Error("Invalid footnote identifier."); }
    let result = entries.get(id);
    if (!result) { result = { id, number: null, definitions: [], references: [] }; entries.set(id, result); }
    return result;
  };
  for (const definition of cache.footnotes) {
    if (typeof definition.content !== "string") { throw new Error("A footnote definition needs Markdown content."); }
    const item = entry(definition.id), label = range(definition.labelPosition), body = range(definition.position);
    if (label.start.offset < body.start.offset || label.end.offset > body.end.offset || !definition.inline && text.slice(label.start.offset, label.end.offset) !== "[^" + definition.id + "]") { throw new Error("The footnote definition no longer matches its source."); }
    item.definitions.push({ ...definition, labelPosition: label, position: body });
  }
  for (const reference of cache.footnoteRefs) {
    const item = entry(reference.id), target = range(reference.position);
    if (text.slice(target.start.offset, target.end.offset) !== "[^" + reference.id + "]") { throw new Error("The footnote reference no longer matches its source."); }
    item.references.push({ id: reference.id, position: target });
  }
  for (const item of entries.values()) {
    item.definitions.sort((a, b) => a.position.start.offset - b.position.start.offset);
    item.references.sort((a, b) => a.position.start.offset - b.position.start.offset);
  }
  const first = (item: FootnoteEntry): number => {
    let result = item.references[0]?.position.start.offset ?? Infinity;
    for (const definition of item.definitions) { if (definition.inline) { result = Math.min(result, definition.position.start.offset); } }
    return result;
  };
  const result = [...entries.values()].sort((a, b) => {
    const defined = Number(Boolean(b.definitions.length)) - Number(Boolean(a.definitions.length));
    if (defined) { return defined; }
    const x = first(a), y = first(b);
    return (x < y ? -1 : x > y ? 1 : 0) || (a.definitions[0]?.position.start.offset ?? 0) - (b.definitions[0]?.position.start.offset ?? 0) || a.id.localeCompare(b.id);
  });
  let number = 0;
  for (const item of result) { if (item.definitions.length) { item.number = ++number; } }
  return result;
}
