import { copyViewData } from "./contracts";
import { outgoingMentions, type CachedMetadata, type Pos, type SourceRange, type UnlinkedTarget } from "./markdown";

export const backlinkSorts = {
  alphabetical: "Name A–Z", alphabeticalReverse: "Name Z–A",
  byModifiedTime: "Modified newest first", byModifiedTimeReverse: "Modified oldest first",
  byCreatedTime: "Created newest first", byCreatedTimeReverse: "Created oldest first",
} as const;
export type BacklinkSort = keyof typeof backlinkSorts;
export type MentionKind = "linked" | "unlinked";
export interface BacklinkState {
  file: string; followActiveFile: boolean; collapseAll: boolean; extraContext: boolean; sortOrder: BacklinkSort;
  showSearch: boolean; searchQuery: string; backlinkCollapsed: boolean; unlinkedCollapsed: boolean; showUnlinked: boolean;
  foldedGroups: string[]; expandedGroups: string[];
}
export interface BacklinkDocument {
  path: string; text: string; cache: CachedMetadata; mtime: number; ctime: number;
  outgoing: readonly { destination: { path: string } | null; link: { position: Pos } }[];
}
export interface BacklinkGroup { path: string; text: string; mtime: number; ctime: number; linked: SourceRange[]; unlinked: SourceRange[]; }
function path(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\\\x00-\x1f]/.test(value) && value.split("/").every(part => part && !part.startsWith(".")); }
export function mentionKey(kind: MentionKind, source: string): string { return JSON.stringify([kind, source]); }
export function remapMentionKey(key: string, oldPath: string, newPath: string): string {
  const [kind, source] = JSON.parse(key) as [MentionKind, string]; return mentionKey(kind, source === oldPath ? newPath : source);
}
export function backlinkState(value: unknown): BacklinkState {
  const state = copyViewData(value), file = state.file === undefined ? "" : state.file;
  if (file !== "" && !path(file)) { throw new Error("Backlinks needs a visible relative vault file path."); }
  const bool = (key: string, fallback = false): boolean => { if (state[key] === undefined) { return fallback; } if (typeof state[key] !== "boolean") { throw new Error("Backlinks " + key + " must be Boolean."); } return state[key]; };
  const query = state.searchQuery === undefined ? "" : state.searchQuery, sort = state.sortOrder === undefined ? "alphabetical" : state.sortOrder;
  if (typeof query !== "string" || query.length > 1024) { throw new Error("Backlink filters must be text of at most 1,024 characters."); }
  if (typeof sort !== "string" || !Object.hasOwn(backlinkSorts, sort)) { throw new Error("Unsupported backlink sort order."); }
  const keys = (name: string): string[] => {
    const values = state[name] === undefined ? [] : state[name];
    if (!Array.isArray(values) || values.length > 4096 || values.some(key => {
      if (typeof key !== "string" || key.length > 16384) { return true; }
      try { const value: unknown = JSON.parse(key); return !Array.isArray(value) || value.length !== 2 || !["linked", "unlinked"].includes(value[0]) || !path(value[1]); } catch { return true; }
    })) { throw new Error("Backlinks " + name + " must contain at most 4,096 valid mention-group keys."); }
    return [...new Set(values)];
  };
  return { file: file as string, followActiveFile: bool("followActiveFile", true), collapseAll: bool("collapseAll"), extraContext: bool("extraContext"), sortOrder: sort as BacklinkSort,
    showSearch: bool("showSearch"), searchQuery: query, backlinkCollapsed: bool("backlinkCollapsed"), unlinkedCollapsed: bool("unlinkedCollapsed", true), showUnlinked: bool("showUnlinked", true), foldedGroups: keys("foldedGroups"), expandedGroups: keys("expandedGroups") };
}

export function mentionContext(text: string, range: SourceRange, extra: boolean): SourceRange {
  let from = Math.max(text.lastIndexOf("\n", Math.max(0, range.from - 1)) + 1, range.from - 100), to = text.indexOf("\n", range.to);
  to = Math.min(to < 0 ? text.length : to, range.to + 140);
  if (extra) { from = Math.max(text.lastIndexOf("\n", Math.max(0, from - 2)) + 1, range.from - 500); const next = text.indexOf("\n", to + 1); to = Math.min(next < 0 ? text.length : next, range.to + 500); }
  return { from, to };
}
export function backlinkGroups(documents: readonly BacklinkDocument[], target: UnlinkedTarget, state: BacklinkState): BacklinkGroup[] {
  const query = state.showSearch ? state.searchQuery.trim().toLowerCase() : "", unlinked = state.showUnlinked && !state.unlinkedCollapsed, groups: BacklinkGroup[] = [];
  for (const entry of documents) {
    if (entry.path === target.path) { continue; }
    const matches = (ranges: SourceRange[]): SourceRange[] => ranges.filter(range => {
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to < range.from || range.to > entry.text.length) { return false; }
      if (!query || entry.path.toLowerCase().includes(query)) { return true; } const context = mentionContext(entry.text, range, state.extraContext); return entry.text.slice(context.from, context.to).toLowerCase().includes(query);
    }).sort((a, b) => a.from - b.from || a.to - b.to);
    const linked = matches(entry.outgoing.filter(link => link.destination?.path === target.path).map(link => ({ from: link.link.position.start.offset, to: link.link.position.end.offset })));
    const mentions = unlinked ? matches(outgoingMentions(entry.text, entry.cache, entry.path, [target]).flatMap(result => result.matches)) : [];
    if (linked.length || mentions.length) { groups.push({ path: entry.path, text: entry.text, mtime: entry.mtime, ctime: entry.ctime, linked, unlinked: mentions }); }
  }
  return groups.sort((a, b) => {
    const name = a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (state.sortOrder === "alphabetical" || state.sortOrder === "alphabeticalReverse") { return state.sortOrder === "alphabeticalReverse" ? -name : name; }
    const key = state.sortOrder.startsWith("byModified") ? "mtime" : "ctime", x = Number.isFinite(a[key]) ? a[key] : 0, y = Number.isFinite(b[key]) ? b[key] : 0;
    return x === y ? name : (x > y ? -1 : 1) * (state.sortOrder.endsWith("Reverse") ? -1 : 1);
  });
}
