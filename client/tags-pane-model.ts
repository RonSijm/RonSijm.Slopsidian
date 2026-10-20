import { copyViewData } from "./contracts";
import { validTag } from "./markdown";

export const tagSorts = { frequency: "Most used", frequencyReverse: "Least used", alphabetical: "A to Z", alphabeticalReverse: "Z to A" } as const;
export type TagSort = keyof typeof tagSorts;
export interface TagsPaneState { sortOrder: TagSort; useHierarchy: boolean; showSearch: boolean; searchQuery: string; foldedTags: string[]; }
export interface TagNode { key: string; tag: string; count: number; depth: number; visible: boolean; parent: TagNode | null; children: TagNode[]; }

function isSort(value: unknown): value is TagSort { return typeof value === "string" && Object.hasOwn(tagSorts, value); }

export function tagsPaneState(value: unknown): TagsPaneState {
  const state = copyViewData(value), sortOrder = state.sortOrder === undefined ? "frequency" : state.sortOrder;
  if (!isSort(sortOrder)) { throw new Error("Unsupported Tags sort order."); }
  for (const key of ["useHierarchy", "showSearch"] as const) {
    if (state[key] !== undefined && typeof state[key] !== "boolean") { throw new Error("Tags " + key + " must be Boolean."); }
  }
  const query = state.searchQuery === undefined ? "" : state.searchQuery, folds = state.foldedTags === undefined ? [] : state.foldedTags;
  if (typeof query !== "string" || query.length > 1024) { throw new Error("The Tags filter must be text of at most 1,024 characters."); }
  if (!Array.isArray(folds) || folds.length > 4096 || folds.some(key => typeof key !== "string" || !key.startsWith("#") || key.length < 2 || key.length > 8192 || !validTag(key.slice(1)))) {
    throw new Error("Tags folds must be at most 4,096 tag names of at most 8,192 characters each.");
  }
  return { sortOrder, useHierarchy: state.useHierarchy !== false, showSearch: state.showSearch === true, searchQuery: query, foldedTags: [...new Set(folds.map(key => key.toLowerCase()))] };
}

export function tagNodes(counts: Readonly<Record<string, number>>, options: Pick<TagsPaneState, "sortOrder" | "useHierarchy" | "searchQuery">): TagNode[] {
  if (!isSort(options.sortOrder)) { throw new Error("Unsupported Tags sort order."); }
  const nodes = new Map<string, TagNode>();
  const get = (tag: string): TagNode => {
    const key = tag.toLowerCase(); let node = nodes.get(key);
    if (!node) { node = { key, tag, count: 0, depth: 1, visible: false, parent: null, children: [] }; nodes.set(key, node); }
    return node;
  };
  for (const [tag, count] of Object.entries(counts)) {
    if (!tag.startsWith("#") || !validTag(tag.slice(1)) || !Number.isSafeInteger(count) || count < 0) { throw new Error("Invalid indexed tag name or count."); }
    const node = get(tag); node.count += count;
    if (!Number.isSafeInteger(node.count)) { throw new Error("Indexed tag counts exceed the supported integer range."); }
  }
  const roots: TagNode[] = [];
  for (const node of nodes.values()) {
    const slash = node.tag.lastIndexOf("/");
    if (options.useHierarchy && slash > 0) {
      const parent = get(node.tag.slice(0, slash)); node.parent = parent; parent.children.push(node);
    } else { roots.push(node); }
  }
  const compare = (a: TagNode, b: TagNode): number => {
    const name = a.tag.localeCompare(b.tag, undefined, { numeric: true, sensitivity: "base" }) || a.tag.localeCompare(b.tag);
    return options.sortOrder === "alphabetical" ? name : options.sortOrder === "alphabeticalReverse" ? -name
      : (options.sortOrder === "frequency" ? b.count - a.count : a.count - b.count) || name;
  };
  roots.sort(compare);
  const result: TagNode[] = [], stack = [...roots].reverse(), query = options.searchQuery.trim().toLowerCase();
  while (stack.length) {
    const node = stack.pop()!; node.depth = node.parent ? node.parent.depth + 1 : 1; node.visible = !query || node.tag.toLowerCase().includes(query); result.push(node);
    node.children.sort(compare);
    for (let index = node.children.length - 1; index >= 0; index--) { stack.push(node.children[index]); }
  }
  for (let index = result.length - 1; index >= 0; index--) { if (result[index].visible && result[index].parent) { result[index].parent!.visible = true; } }
  return result;
}
