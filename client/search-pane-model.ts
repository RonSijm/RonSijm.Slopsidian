import { copyViewData } from "./contracts";
import type { SearchResult } from "./search";

export const searchSorts = {
  alphabetical: "Name A–Z", alphabeticalReverse: "Name Z–A",
  byModifiedTime: "Modified newest first", byModifiedTimeReverse: "Modified oldest first",
  byCreatedTime: "Created newest first", byCreatedTimeReverse: "Created oldest first",
} as const;
export type SearchSort = keyof typeof searchSorts;
export interface SearchPaneState {
  query: string; matchingCase: boolean; explainSearch: boolean; collapseAll: boolean; extraContext: boolean;
  sortOrder: SearchSort; collapsedFiles: string[]; expandedFiles: string[];
}

export function mergeSearchQuery(current: string, fragment: string, modified: boolean): string {
  return !modified || !current ? fragment : current.includes(fragment) ? current.replace(fragment, "").trim() : `${current.trim()} ${fragment}`;
}

export function searchPaneState(value: unknown): SearchPaneState {
  const state = copyViewData(value), query = state.query === undefined ? "" : state.query;
  if (typeof query !== "string" || query.length > 16384) { throw new Error("Search queries must be text of at most 16,384 characters."); }
  for (const key of ["matchingCase", "explainSearch", "collapseAll", "extraContext"] as const) {
    if (state[key] !== undefined && typeof state[key] !== "boolean") { throw new Error("Search " + key + " must be Boolean."); }
  }
  const sort = state.sortOrder === undefined ? "alphabetical" : state.sortOrder;
  if (typeof sort !== "string" || !Object.hasOwn(searchSorts, sort)) { throw new Error("Unsupported search sort order."); }
  const paths = (key: string): string[] => {
    const paths = state[key] === undefined ? [] : state[key];
    if (!Array.isArray(paths) || paths.length > 4096 || paths.some(path => typeof path !== "string" || !path || path.length > 4096
      || /[\\\x00-\x1f]/.test(path) || path.split("/").some(part => !part || part.startsWith(".")))) { throw new Error("Search " + key + " must be at most 4,096 visible relative vault paths."); }
    return [...new Set(paths)];
  };
  return { query, matchingCase: state.matchingCase === true, explainSearch: state.explainSearch === true, collapseAll: state.collapseAll === true,
    extraContext: state.extraContext === true, sortOrder: sort as SearchSort, collapsedFiles: paths("collapsedFiles"), expandedFiles: paths("expandedFiles") };
}

export function sortedSearchResults(results: readonly SearchResult[], sort: SearchSort, stat: (path: string) => { mtime: number; ctime: number } | undefined): SearchResult[] {
  if (!Object.hasOwn(searchSorts, sort)) { throw new Error("Unsupported search sort order."); }
  return [...results].sort((a, b) => {
    const name = a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (sort === "alphabetical" || sort === "alphabeticalReverse") { return sort === "alphabeticalReverse" ? -name : name; }
    const key = sort.startsWith("byModified") ? "mtime" : "ctime", x = stat(a.path)?.[key], y = stat(b.path)?.[key];
    const first = Number.isFinite(x) ? x! : 0, second = Number.isFinite(y) ? y! : 0;
    return first === second ? name : (first > second ? -1 : 1) * (sort.endsWith("Reverse") ? -1 : 1);
  });
}
