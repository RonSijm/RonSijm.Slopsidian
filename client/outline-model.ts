import { copyViewData } from "./contracts";
import type { HeadingCache } from "./markdown";

export interface OutlineState { file: string; followActiveFile: boolean; followCursor: boolean; showSearch: boolean; searchQuery: string; foldedHeadings: string[]; }
export interface OutlineNode { key: string; heading: HeadingCache; parent: OutlineNode | null; children: OutlineNode[]; depth: number; visible: boolean; }

export function outlineState(value: unknown): OutlineState {
  const state = copyViewData(value), file = state.file === undefined ? "" : state.file;
  if (typeof file !== "string" || file.length > 4096 || file && (/[\\\x00-\x1f]/.test(file) || file.split("/").some(part => !part || part.startsWith(".")))) { throw new Error("Outline needs a visible relative vault file path."); }
  for (const key of ["followActiveFile", "followCursor", "showSearch"] as const) { if (state[key] !== undefined && typeof state[key] !== "boolean") { throw new Error("Outline " + key + " must be Boolean."); } }
  const query = state.searchQuery === undefined ? "" : state.searchQuery;
  if (typeof query !== "string" || query.length > 1024) { throw new Error("Outline filters must be text of at most 1,024 characters."); }
  const folds = state.foldedHeadings === undefined ? [] : state.foldedHeadings;
  if (!Array.isArray(folds) || folds.length > 4096 || folds.some(key => typeof key !== "string" || !key || key.length > 8192)) { throw new Error("Outline folds must contain at most 4,096 keys of up to 8,192 characters."); }
  return { file, followActiveFile: state.followActiveFile !== false, followCursor: state.followCursor === true, showSearch: state.showSearch === true, searchQuery: query, foldedHeadings: [...new Set(folds)] };
}

/** Heading identity follows text/level/occurrence, so edits before a heading retain its fold. */
export function outlineNodes(headings: readonly HeadingCache[], query: string): OutlineNode[] {
  const nodes: OutlineNode[] = [], stack: OutlineNode[] = [], occurrences = new Map<string, number>();
  let prior = -1;
  for (const heading of headings) {
    if (typeof heading.heading !== "string" || !Number.isInteger(heading.level) || heading.level < 1 || heading.level > 6
      || !Number.isInteger(heading.position.start.offset) || heading.position.start.offset <= prior || !Number.isInteger(heading.position.start.line) || heading.position.start.line < 0) { throw new Error("Outline metadata needs ordered Markdown headings with valid levels and positions."); }
    prior = heading.position.start.offset;
    while (stack.length && stack.at(-1)!.heading.level >= heading.level) { stack.pop(); }
    const identity = JSON.stringify([heading.level, heading.heading]), occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
    const parent = stack.at(-1) ?? null, node: OutlineNode = { key: JSON.stringify([heading.level, heading.heading, occurrence]), heading, parent, children: [], depth: stack.length + 1, visible: false };
    parent?.children.push(node); nodes.push(node); stack.push(node);
  }
  const needle = query.trim().toLowerCase();
  for (let index = nodes.length - 1; index >= 0; index--) { const node = nodes[index]; node.visible = !needle || node.heading.heading.toLowerCase().includes(needle) || node.children.some(child => child.visible); }
  return nodes;
}
