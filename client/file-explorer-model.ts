import { copyViewData } from "./contracts";

export const explorerSorts = {
  alphabetical: "Name A–Z", alphabeticalReverse: "Name Z–A",
  byModifiedTime: "Modified newest first", byModifiedTimeReverse: "Modified oldest first",
  byCreatedTime: "Created newest first", byCreatedTimeReverse: "Created oldest first",
} as const;
export type ExplorerSort = keyof typeof explorerSorts;
export interface ExplorerState {
  sortOrder: ExplorerSort; autoReveal: boolean; showSearch: boolean; searchQuery: string; collapsedFolders: string[];
}
export interface ExplorerEntry { path: string; folder: boolean; mtime?: number; ctime?: number; }
export interface ExplorerNode extends ExplorerEntry { name: string; children: ExplorerNode[]; visible: boolean; matchingFiles: number; }

export const MAX_EXPLORER_SELECTION = 64;
export const MAX_EXPLORER_OPEN = 20;
export interface ExplorerSelectionItem<T extends object> { path: string; file: T }
export interface ExplorerOpenSelection<T extends object> { revision: number; items: readonly ExplorerSelectionItem<T>[] }

/** Transient visible-note selection. Paths alone never authorize a recreated file. */
export class ExplorerSelection<T extends object> {
  private readonly selected = new Map<string, T>();
  private anchor: ExplorerSelectionItem<T> | null = null;
  private revision = 0;
  get size(): number { return this.selected.size; }
  has(path: string, file: T): boolean { return this.selected.get(path) === file; }
  clear(): void {
    if (this.selected.size || this.anchor) { this.selected.clear(); this.anchor = null; this.revision++; }
  }
  reconcile(visible: readonly ExplorerSelectionItem<T>[]): void {
    const current = new Map(visible.map(item => [item.path, item.file]));
    let changed = false;
    for (const [path, file] of this.selected) { if (current.get(path) !== file) { this.selected.delete(path); changed = true; } }
    if (this.anchor && current.get(this.anchor.path) !== this.anchor.file) { this.anchor = null; changed = true; }
    if (changed) { this.revision++; }
  }
  choose(visible: readonly ExplorerSelectionItem<T>[], item: ExplorerSelectionItem<T>, toggle = false, range = false): string | null {
    this.reconcile(visible);
    const index = visible.findIndex(current => current.path === item.path && current.file === item.file);
    if (index < 0) { return "Select a visible Markdown note in this Files pane."; }
    const next = toggle ? new Map(this.selected) : new Map<string, T>();
    if (range) {
      const anchor = this.anchor ? visible.findIndex(current => current.path === this.anchor!.path && current.file === this.anchor!.file) : -1;
      for (const current of visible.slice(Math.min(anchor < 0 ? index : anchor, index), Math.max(anchor < 0 ? index : anchor, index) + 1)) { next.set(current.path, current.file); }
    } else if (toggle && next.get(item.path) === item.file) { next.delete(item.path); }
    else { next.set(item.path, item.file); }
    if (next.size > MAX_EXPLORER_SELECTION) { return `Select up to ${MAX_EXPLORER_SELECTION} visible Markdown notes.`; }
    this.selected.clear(); for (const [path, file] of next) { this.selected.set(path, file); }
    if (!range || !this.anchor) { this.anchor = { ...item }; }
    this.revision++; return null;
  }
  plan(visible: readonly ExplorerSelectionItem<T>[]): ExplorerOpenSelection<T> | string {
    const revision = this.revision;
    this.reconcile(visible);
    if (revision !== this.revision) { return "The selected notes changed. Review the visible selection before opening."; }
    if (!this.size || this.size > MAX_EXPLORER_OPEN) { return `Choose 1–${MAX_EXPLORER_OPEN} visible Markdown notes to open in new tabs.`; }
    return { revision: this.revision, items: visible.filter(item => this.has(item.path, item.file)).map(item => ({ ...item })) };
  }
  current(plan: ExplorerOpenSelection<T>, visible: readonly ExplorerSelectionItem<T>[]): boolean {
    if (plan.revision !== this.revision || plan.items.length !== this.size) { return false; }
    const items = visible.filter(item => this.has(item.path, item.file));
    return items.length === plan.items.length && items.every((item, index) => item.path === plan.items[index].path && item.file === plan.items[index].file);
  }
}

function relativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    && !/[\\\x00-\x1f]/.test(value) && value.split("/").every(part => part.length > 0 && !part.startsWith("."));
}

export function explorerState(value: unknown): ExplorerState {
  const state = copyViewData(value);
  const sortOrder = state.sortOrder === undefined ? "alphabetical" : state.sortOrder;
  if (typeof sortOrder !== "string" || !Object.hasOwn(explorerSorts, sortOrder)) { throw new Error("Unsupported file explorer sort order."); }
  for (const key of ["autoReveal", "showSearch"] as const) {
    if (state[key] !== undefined && typeof state[key] !== "boolean") { throw new Error("File explorer " + key + " must be Boolean."); }
  }
  if (state.searchQuery !== undefined && (typeof state.searchQuery !== "string" || state.searchQuery.length > 1024)) { throw new Error("File explorer search must be text of at most 1,024 characters."); }
  const collapsed = state.collapsedFolders === undefined ? [] : state.collapsedFolders;
  if (!Array.isArray(collapsed) || collapsed.length > 4096 || !collapsed.every(relativePath)) { throw new Error("Collapsed folders must be at most 4,096 visible relative vault paths."); }
  return { sortOrder: sortOrder as ExplorerSort, autoReveal: state.autoReveal === true, showSearch: state.showSearch === true,
    searchQuery: state.searchQuery as string ?? "", collapsedFolders: [...new Set(collapsed)] };
}

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function compare(sort: ExplorerSort, a: ExplorerNode, b: ExplorerNode): number {
  if (a.folder !== b.folder) { return a.folder ? -1 : 1; }
  const name = names.compare(a.name, b.name) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (a.folder || sort === "alphabetical" || sort === "alphabeticalReverse") { return sort === "alphabeticalReverse" ? -name : name; }
  const key = sort.startsWith("byModified") ? "mtime" : "ctime";
  const time = (node: ExplorerNode): number => Number.isFinite(node[key]) ? node[key]! : 0;
  const first = time(a), second = time(b);
  return first === second ? name : (first > second ? -1 : 1) * (sort.endsWith("Reverse") ? -1 : 1);
}

/** Build/filter bottom-up so deeply nested vault paths cannot exhaust the call stack. */
export function explorerTree(entries: readonly ExplorerEntry[], sort: ExplorerSort, query: string): { roots: ExplorerNode[]; files: number; folders: number } {
  if (!Object.hasOwn(explorerSorts, sort)) { throw new Error("Unsupported file explorer sort order."); }
  const nodes = new Map<string, ExplorerNode>(), explicit = new Set<string>();
  const folder = (path: string): ExplorerNode => {
    let node = nodes.get(path);
    if (node && !node.folder) { throw new Error("A vault file cannot also contain children: " + path); }
    if (!node) { node = { path, name: path.split("/").at(-1)!, folder: true, children: [], visible: false, matchingFiles: 0 }; nodes.set(path, node); }
    return node;
  };
  for (const entry of entries) {
    if (entry.path === "/") { continue; }
    if (!relativePath(entry.path) || explicit.has(entry.path)) { throw new Error("File explorer entries need unique visible relative vault paths."); }
    explicit.add(entry.path);
    if (entry.folder) { folder(entry.path); }
    else {
      if (nodes.has(entry.path)) { throw new Error("A vault entry cannot be both a folder and a file: " + entry.path); }
      nodes.set(entry.path, { ...entry, name: entry.path.split("/").at(-1)!, children: [], visible: false, matchingFiles: 0 });
    }
    let parent = entry.path;
    while (parent.includes("/")) { parent = parent.slice(0, parent.lastIndexOf("/")); folder(parent); }
  }
  const roots: ExplorerNode[] = [], needle = query.trim().toLowerCase();
  for (const node of nodes.values()) {
    const slash = node.path.lastIndexOf("/");
    (slash < 0 ? roots : folder(node.path.slice(0, slash)).children).push(node);
  }
  let files = 0, folders = 0;
  for (const node of [...nodes.values()].sort((a, b) => b.path.split("/").length - a.path.split("/").length)) {
    const match = !needle || node.path.toLowerCase().includes(needle);
    node.matchingFiles = node.children.reduce((sum, child) => sum + child.matchingFiles, 0) + (!node.folder && match ? 1 : 0);
    node.visible = match || node.children.some(child => child.visible);
    node.children.sort((a, b) => compare(sort, a, b));
    if (node.visible) { node.folder ? folders++ : files++; }
  }
  roots.sort((a, b) => compare(sort, a, b));
  return { roots, files, folders };
}
