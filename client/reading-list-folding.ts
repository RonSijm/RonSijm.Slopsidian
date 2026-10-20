import { readingFoldState, type ReadingFoldStateOptions } from "./reading-fold-state";

/** View-only Reading list folds retain every original list, item and task node. */
export const MAX_READING_LIST_FOLD_SOURCE = 1_048_576;
export const MAX_READING_LIST_FOLD_ITEMS = 2_048;
export const MAX_READING_LIST_FOLD_BLOCKS = 4_096;
export const MAX_READING_LIST_FOLD_NODES = 8_192;
export const MAX_READING_LIST_FOLD_DEPTH = 32;
export const MAX_READING_LIST_FOLD_LINES = 65_536;
export const MAX_READING_LIST_FOLD_LABEL = 1_024;
export const MAX_READING_LIST_FOLD_LABELS = 65_536;

interface SourceListItem {
  position: { start: { line: number; offset: number }; end: { line: number; offset: number } };
  parent: number;
}
interface ReadingListFoldList { element: HTMLElement; parent: HTMLElement; line: number; tag: string; items: HTMLElement[] }
export interface ReadingListFoldItem {
  element: HTMLElement;
  parent: HTMLElement;
  line: number;
  label: string;
  /** Only original direct child lists are hidden; continuation prose is retained. */
  bodies: HTMLElement[];
  children: Element[];
}
export interface ReadingListFoldInventory {
  roots: HTMLElement[];
  lists: ReadingListFoldList[];
  items: ReadingListFoldItem[];
  message: string | null;
}

const listTag = (element: Element): boolean => element.tagName === "UL" || element.tagName === "OL";
const sourceLine = (element: HTMLElement): number => {
  const value = element.dataset.sourceLine;
  return value !== undefined && /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : -1;
};

/** Capture original mapped list identities before Markdown postprocessors run. */
export function captureReadingListFolds(section: HTMLElement, source: string, metadata: readonly SourceListItem[]): ReadingListFoldInventory {
  const refuse = (message = "This rendered note exceeds the Reading list-folding limits."): ReadingListFoldInventory => ({ roots: [], lists: [], items: [], message });
  if (source.length > MAX_READING_LIST_FOLD_SOURCE || metadata.length > MAX_READING_LIST_FOLD_ITEMS
    || section.childElementCount > MAX_READING_LIST_FOLD_BLOCKS) { return refuse(); }
  const lines = source.split(/\r\n|\n|\r/, MAX_READING_LIST_FOLD_LINES + 1);
  if (lines.length > MAX_READING_LIST_FOLD_LINES) { return refuse(); }
  let labels = 0;
  for (const item of metadata) {
    const { start, end } = item.position;
    if (!Number.isSafeInteger(start.line) || start.line < 0 || start.line >= lines.length || !Number.isSafeInteger(end.line) || end.line < start.line || end.line >= lines.length
      || !Number.isSafeInteger(start.offset) || !Number.isSafeInteger(end.offset) || start.offset < 0 || end.offset < start.offset || end.offset > source.length
      || !Number.isSafeInteger(item.parent) || lines[start.line].length > MAX_READING_LIST_FOLD_LABEL
      || (labels += lines[start.line].length) > MAX_READING_LIST_FOLD_LABELS) { return refuse(); }
  }
  const known = new Map<number, SourceListItem>();
  for (const item of metadata) {
    if (known.has(item.position.start.line)) { return refuse("List source mappings are ambiguous; Reading list folding is unavailable for this render."); }
    known.set(item.position.start.line, item);
  }
  const roots: HTMLElement[] = [], lists: ReadingListFoldList[] = [], items: ReadingListFoldItem[] = [];
  const seen = new Set<number>(); let nodes = 0, invalid = false, previousRoot = -1;
  const capture = (element: HTMLElement, parent: HTMLElement, expectedParent: number, depth: number): void => {
    if (invalid) { return; }
    if (depth > MAX_READING_LIST_FOLD_DEPTH || ++nodes > MAX_READING_LIST_FOLD_NODES
      || element.childElementCount > MAX_READING_LIST_FOLD_ITEMS) { invalid = true; return; }
    const line = sourceLine(element), direct: HTMLElement[] = [];
    let previous = -1;
    for (const child of element.children) {
      if (++nodes > MAX_READING_LIST_FOLD_NODES || child.tagName !== "LI") { invalid = true; return; }
      const li = child as HTMLElement, at = sourceLine(li), item = known.get(at);
      if (!item || seen.has(at) || at <= previous || item.parent !== expectedParent || li.childElementCount > MAX_READING_LIST_FOLD_NODES
        || (nodes += li.childElementCount) > MAX_READING_LIST_FOLD_NODES) { invalid = true; return; }
      const first = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.*)$/.exec(lines[at]);
      if (!first) { invalid = true; return; }
      seen.add(at); previous = at; direct.push(li);
      const bodies: HTMLElement[] = [], children = [...li.children];
      const record = { element: li, parent: element, line: at, label: first[1].trim() || "List item at line " + (at + 1), bodies, children };
      items.push(record);
      for (const child of children) {
        if (!listTag(child)) { continue; }
        const body = child as HTMLElement, childLine = sourceLine(body);
        if (childLine <= at || childLine > item.position.end.line) { invalid = true; return; }
        bodies.push(body); capture(body, li, item.position.start.offset, depth + 1);
      }
    }
    if (!direct.length || line !== sourceLine(direct[0])) { invalid = true; return; }
    lists.push({ element, parent, line, tag: element.tagName, items: direct });
  };
  for (const child of section.children) {
    if (!listTag(child)) { continue; }
    const element = child as HTMLElement;
    // A root list must be a direct original mapped block. Quoted/callout/embed
    // lists never enter this walk; postprocessor replacements are not captured.
    const line = sourceLine(element);
    if (line < 0) { continue; }
    if (line <= previousRoot) { invalid = true; break; }
    previousRoot = line;
    roots.push(element); capture(element, section, -1, 1);
  }
  if (invalid) { return refuse("A rendered list has an unsupported source mapping or structure; Reading list folding is unavailable for this render."); }
  return { roots, lists, items, message: null };
}

export class ReadingListFolding {
  private readonly document: Document;
  private readonly sectionChildren: Element[];
  private readonly controls = new Map<ReadingListFoldItem, HTMLButtonElement>();
  private readonly childIndices = new Map<HTMLElement, ReadonlyMap<Element, number>>();
  private readonly rootIndices: ReadonlyMap<Element, number>;
  private readonly collapsed = new Set<ReadingListFoldItem>();
  private readonly intended = new Set<number>();
  private readonly hidden = new Set<HTMLElement>();
  private readonly observer: MutationObserver;
  private disposed = false;

  constructor(private readonly root: HTMLElement, private readonly section: HTMLElement, private readonly inventory: ReadingListFoldInventory,
    private readonly current: () => boolean, private readonly changed: () => void, private readonly options: ReadingFoldStateOptions = {}) {
    this.document = root.ownerDocument;
    this.sectionChildren = section.childElementCount <= MAX_READING_LIST_FOLD_BLOCKS ? [...section.children] : [];
    this.rootIndices = new Map(inventory.roots.map((element, index) => [element, index]));
    for (const list of inventory.lists) { this.childIndices.set(list.element, new Map(list.items.map((item, index) => [item, index]))); }
    for (const item of inventory.items) { this.childIndices.set(item.element, new Map(item.children.map((child, index) => [child, index]))); }
    this.observer = new this.document.defaultView!.MutationObserver(() => { if (!this.topologyCurrent()) { this.dispose(); } });
    if (inventory.message || !this.topologyCurrent()) { this.dispose(); return; }
    for (const item of inventory.items) {
      if (!item.bodies.length) { continue; }
      const button = this.document.createElement("button"); button.type = "button"; button.className = "reading-list-fold-toggle";
      button.dataset.readingListFoldToggle = String(item.line);
      button.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        if (!this.available()) { return; }
        if (this.collapsed.delete(item)) { this.intended.delete(item.line); }
        else { this.collapsed.add(item); this.intended.add(item.line); }
        this.apply();
        if (!this.disposed && this.current()) {
          // Storage denial/quota leaves ordinary nonmutating folding available.
          try { this.options.onUserChange?.(this.snapshot()); } catch { /* Best-effort preference storage. */ }
        }
      });
      this.controls.set(item, button); this.label(item, button); item.element.prepend(button);
    }
    for (const line of readingFoldState(options.initialCollapsed, [...this.controls.keys()].map(item => item.line))) { this.intended.add(line); }
    for (const item of this.controls.keys()) { if (this.intended.has(item.line)) { this.collapsed.add(item); } }
    this.apply();
    this.observer.observe(section, { childList: true });
    for (const list of inventory.lists) { this.observer.observe(list.element, { childList: true, attributes: true, attributeFilter: ["data-source-line"] }); }
    for (const item of inventory.items) { this.observer.observe(item.element, { childList: true, attributes: true, attributeFilter: ["data-source-line"] }); }
  }

  get isDisposed(): boolean { return this.disposed; }

  /** Persist explicit choices even after navigation temporarily opens an owner. */
  snapshot(): number[] { return [...this.intended].sort((a, b) => a - b); }

  /** Availability checks cannot change rendered state or local preferences. */
  canSetAll(): boolean { return this.controls.size > 0 && !this.disposed && this.current() && this.topologyCurrent(); }

  /** Change only captured direct child lists, retaining prose/tasks and nodes. */
  setAll(collapse: boolean): boolean {
    if (!this.canSetAll()) { return false; }
    this.collapsed.clear(); this.intended.clear();
    if (collapse) { for (const item of this.controls.keys()) { this.collapsed.add(item); this.intended.add(item.line); } }
    this.apply();
    if (!this.disposed && this.current()) {
      try { this.options.onUserChange?.(this.snapshot()); } catch { /* Best-effort local preference. */ }
    }
    return true;
  }

  private topologyCurrent(): boolean {
    if (this.root.ownerDocument !== this.document || this.section.ownerDocument !== this.document || !this.root.isConnected || this.section.parentElement !== this.root
      || this.section.childElementCount !== this.sectionChildren.length || this.sectionChildren.some((child, index) => this.section.children[index] !== child)) { return false; }
    let nextRoot = 0;
    for (const child of this.section.children) {
      const index = this.rootIndices.get(child);
      if (index !== undefined && index !== nextRoot++) { return false; }
    }
    if (nextRoot !== this.inventory.roots.length) { return false; }
    // A previously accepted inventory may itself fill the original-node budget;
    // owned controls are the only bounded addition made by this view layer.
    let nodes = 0; const allowance = MAX_READING_LIST_FOLD_NODES + this.controls.size;
    for (const list of this.inventory.lists) {
      if (list.element.parentElement !== list.parent || list.element.ownerDocument !== this.document || list.element.tagName !== list.tag
        || sourceLine(list.element) !== list.line || list.element.childElementCount !== list.items.length
        || (nodes += 1 + list.element.childElementCount) > allowance) { return false; }
      let next = 0;
      for (const child of list.element.children) {
        if (this.childIndices.get(list.element)!.get(child) !== next++) { return false; }
      }
      if (next !== list.items.length) { return false; }
    }
    for (const item of this.inventory.items) {
      if (item.element.parentElement !== item.parent || item.element.ownerDocument !== this.document || item.element.tagName !== "LI"
        || sourceLine(item.element) !== item.line || (nodes += item.element.childElementCount) > allowance) { return false; }
      let next = 0;
      for (const child of item.element.children) {
        const index = this.childIndices.get(item.element)!.get(child);
        if (index !== undefined && index !== next++) { return false; }
      }
      if (next !== item.children.length) { return false; }
    }
    return [...this.controls].every(([item, button]) => button.parentElement === item.element && button.ownerDocument === this.document);
  }

  private available(): boolean {
    if (this.disposed) { return false; }
    if (!this.current() || !this.topologyCurrent()) { this.dispose(); return false; }
    return true;
  }

  private label(item: ReadingListFoldItem, button: HTMLButtonElement): void {
    const expanded = !this.collapsed.has(item), action = expanded ? "Collapse" : "Expand";
    button.textContent = expanded ? "▾" : "▸"; button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", action + " list item " + item.label); button.title = action + " list item " + item.label;
  }

  private apply(): void {
    let changed = false;
    for (const item of this.inventory.items) for (const body of item.bodies) {
      if (this.collapsed.has(item) && !body.hasAttribute("hidden")) { body.setAttribute("hidden", ""); this.hidden.add(body); changed = true; }
      else if (!this.collapsed.has(item) && this.hidden.delete(body) && body.getAttribute("hidden") === "") { body.removeAttribute("hidden"); changed = true; }
    }
    for (const [item, button] of this.controls) { this.label(item, button); }
    if (changed) { this.changed(); }
  }

  /** Expand owning bodies containing the target, preserving the header's own fold. */
  reveal(element: HTMLElement): void {
    if (!this.available()) { return; }
    let changed = false;
    for (const item of this.inventory.items) {
      if (this.collapsed.has(item) && item.bodies.some(body => body === element || body.contains(element))) { this.collapsed.delete(item); changed = true; }
    }
    if (changed) { this.apply(); }
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true; this.observer.disconnect();
    let changed = false;
    for (const body of this.hidden) if (body.getAttribute("hidden") === "") { body.removeAttribute("hidden"); changed = true; }
    this.hidden.clear(); this.collapsed.clear(); this.intended.clear();
    for (const button of this.controls.values()) { button.remove(); }
    this.controls.clear();
    if (changed) { this.changed(); }
  }
}
