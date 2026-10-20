import { readingFoldState, type ReadingFoldStateOptions } from "./reading-fold-state";

/** View-only heading folding. It never replaces, wraps or moves rendered blocks. */
export const MAX_READING_FOLD_SOURCE = 1_048_576;
export const MAX_READING_FOLD_BLOCKS = 4_096;
export const MAX_READING_FOLD_HEADINGS = 2_048;
export const MAX_READING_FOLD_LABELS = 65_536;

interface SourceHeading { heading: string; level: number; position: { start: { line: number } } }
export interface ReadingFoldHeading { element: HTMLElement; line: number; level: number; label: string; end: number }
interface ReadingFoldBlock { element: HTMLElement; line: number; headingLevel: number }
export interface ReadingFoldInventory { headings: ReadingFoldHeading[]; blocks: ReadingFoldBlock[]; message: string | null }

/** Inventory only original top-level, source-mapped blocks before plugins run. */
export function captureReadingFolds(section: HTMLElement, sourceLength: number, metadata: readonly SourceHeading[]): ReadingFoldInventory {
  const refuse = (message: string): ReadingFoldInventory => ({ headings: [], blocks: [], message });
  if (sourceLength > MAX_READING_FOLD_SOURCE || section.childElementCount > MAX_READING_FOLD_BLOCKS || metadata.length > MAX_READING_FOLD_HEADINGS) {
    return refuse("This rendered note exceeds the Reading heading-folding limit.");
  }
  let labels = 0;
  for (const heading of metadata) {
    if (heading.heading.length > 1_024 || (labels += heading.heading.length) > MAX_READING_FOLD_LABELS) {
      return refuse("This rendered note has too much heading text for Reading folding.");
    }
  }
  const known = new Map(metadata.map(heading => [heading.position.start.line, heading]));
  const headings: ReadingFoldHeading[] = [], blocks: ReadingFoldBlock[] = [];
  let last = -1;
  for (const child of section.children) {
    const element = child as HTMLElement, raw = element.dataset.sourceLine;
    const line = raw === undefined || !/^\d+$/.test(raw) ? NaN : Number(raw);
    const level = /^H[1-6]$/.test(element.tagName) ? Number(element.tagName.slice(1)) : 0;
    if (level && (!Number.isSafeInteger(line) || known.get(line)?.level !== level)) {
      return refuse("A rendered heading has no matching source heading; Reading folding is unavailable for this render.");
    }
    if (!Number.isSafeInteger(line)) { continue; }
    if (line <= last) { return refuse("Rendered block order is unsupported for Reading folding."); }
    last = line; blocks.push({ element, line, headingLevel: level });
    if (level) { headings.push({ element, line, level, label: known.get(line)!.heading, end: Infinity }); }
  }
  const stack: ReadingFoldHeading[] = [];
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1].level >= heading.level) { stack.pop()!.end = heading.line; }
    stack.push(heading);
  }
  // An empty heading has no control. Its boundary still closes earlier sections.
  const indices = new Map(blocks.map((block, index) => [block.element, index]));
  return { headings: headings.filter(heading => (blocks[indices.get(heading.element)! + 1]?.line ?? Infinity) < heading.end), blocks, message: null };
}

/** Merge nested collapsed intervals before touching any existing elements. */
export function readingFoldIntervals(headings: readonly Pick<ReadingFoldHeading, "line" | "end">[], collapsed: ReadonlySet<number>): { from: number; to: number }[] {
  const intervals: { from: number; to: number }[] = [];
  for (const heading of headings) {
    if (!collapsed.has(heading.line)) { continue; }
    const previous = intervals[intervals.length - 1];
    if (previous && heading.line < previous.to) { continue; }
    intervals.push({ from: heading.line, to: heading.end });
  }
  return intervals;
}

export class ReadingFolding {
  private readonly document: Document;
  private readonly children: Element[];
  private readonly originals: Map<HTMLElement, { index: number; block: ReadingFoldBlock }>;
  private readonly controls = new Map<ReadingFoldHeading, HTMLButtonElement>();
  private readonly collapsed = new Set<number>();
  private readonly intended = new Set<number>();
  private readonly hidden = new Set<HTMLElement>();
  private readonly observer: MutationObserver;
  private disposed = false;

  constructor(private readonly root: HTMLElement, private readonly section: HTMLElement, private readonly inventory: ReadingFoldInventory,
    private readonly current: () => boolean, private readonly changed: () => void, private readonly options: ReadingFoldStateOptions = {}) {
    this.document = root.ownerDocument;
    this.children = section.childElementCount <= MAX_READING_FOLD_BLOCKS ? [...section.children] : [];
    this.originals = new Map(inventory.blocks.map((block, index) => [block.element, { index, block }]));
    this.observer = new this.document.defaultView!.MutationObserver(() => { if (!this.topologyCurrent()) { this.dispose(); } });
    if (!this.mappedBlocksCurrent()) { this.dispose(); return; }
    for (const heading of inventory.headings) {
      if (heading.element.parentElement !== section || heading.element.ownerDocument !== this.document) { this.dispose(); break; }
      const button = this.document.createElement("button"); button.type = "button"; button.className = "reading-fold-toggle";
      button.dataset.readingFoldToggle = String(heading.line);
      button.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        if (!this.available() || button.parentElement !== heading.element) { return; }
        if (this.collapsed.has(heading.line)) { this.collapsed.delete(heading.line); this.intended.delete(heading.line); }
        else { this.collapsed.add(heading.line); this.intended.add(heading.line); }
        this.apply();
        if (!this.disposed && this.current()) {
          // A failed profile write must not prevent view-only folding.
          try { this.options.onUserChange?.(this.snapshot()); } catch { /* Best-effort preference storage. */ }
        }
      });
      this.controls.set(heading, button); this.label(heading, button); heading.element.prepend(button);
    }
    if (!this.disposed) {
      for (const line of readingFoldState(options.initialCollapsed, inventory.headings.map(heading => heading.line))) {
        this.collapsed.add(line); this.intended.add(line);
      }
      this.apply();
      this.observer.observe(section, { childList: true });
      for (const block of inventory.blocks) {
        if (block.element.parentElement !== section) { continue; }
        // Watch only original block mappings and direct heading children. Own
        // button labels and unrelated nested plugin changes are not observed.
        this.observer.observe(block.element, { attributes: true, attributeFilter: ["data-source-line"], ...(block.headingLevel ? { childList: true } : {}) });
      }
    }
  }

  get isDisposed(): boolean { return this.disposed; }

  /** Temporary navigation reveals never replace the explicit user preference. */
  snapshot(): number[] { return [...this.intended].sort((a, b) => a - b); }

  /** Command checks are read-only; stale inventories never acquire new owners. */
  canSetAll(): boolean { return this.controls.size > 0 && !this.disposed && this.current() && this.topologyCurrent(); }

  /** A bulk command is explicit intent, including an empty expanded snapshot. */
  setAll(collapse: boolean): boolean {
    if (!this.canSetAll()) { return false; }
    this.collapsed.clear(); this.intended.clear();
    if (collapse) { for (const heading of this.controls.keys()) { this.collapsed.add(heading.line); this.intended.add(heading.line); } }
    this.apply();
    if (!this.disposed && this.current()) {
      try { this.options.onUserChange?.(this.snapshot()); } catch { /* Best-effort local preference. */ }
    }
    return true;
  }

  private mappedBlocksCurrent(): boolean {
    if (this.section.childElementCount > MAX_READING_FOLD_BLOCKS) { return false; }
    const present = new Set<HTMLElement>();
    let previous = -1;
    for (const element of this.section.children) {
      const original = this.originals.get(element as HTMLElement);
      if (!original) { continue; } // Injected/replacement nodes never acquire folding ownership.
      const { block, index } = original;
      if (index <= previous || block.element.ownerDocument !== this.document || block.element.dataset.sourceLine !== String(block.line)
        || block.headingLevel && block.element.tagName !== "H" + block.headingLevel) { return false; }
      previous = index; present.add(block.element);
    }
    // A replaced paragraph/code block stays outside this inventory. An original
    // heading must remain: it defines the visual boundary of an earlier fold.
    return this.inventory.blocks.every(block => !block.headingLevel || present.has(block.element));
  }

  private topologyCurrent(): boolean {
    return this.root.ownerDocument === this.document && this.section.ownerDocument === this.document
      && this.root.isConnected && this.section.parentElement === this.root && this.section.childElementCount === this.children.length
      && this.children.every((child, index) => this.section.children[index] === child)
      && this.mappedBlocksCurrent()
      && [...this.controls].every(([heading, button]) => button.parentElement === heading.element && button.ownerDocument === this.document);
  }

  private available(): boolean {
    if (this.disposed) { return false; }
    if (!this.current() || !this.topologyCurrent()) { this.dispose(); return false; }
    return true;
  }

  private label(heading: ReadingFoldHeading, button: HTMLButtonElement): void {
    const expanded = !this.collapsed.has(heading.line), action = expanded ? "Collapse" : "Expand";
    button.textContent = expanded ? "▾" : "▸";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", action + " heading " + heading.label); button.title = action + " heading " + heading.label;
  }

  private apply(): void {
    const intervals = readingFoldIntervals(this.inventory.headings, this.collapsed);
    let interval = 0, changed = false;
    for (const block of this.inventory.blocks) {
      if (block.element.parentElement !== this.section) { continue; }
      while (intervals[interval] && block.line >= intervals[interval].to) { interval++; }
      const hide = Boolean(intervals[interval] && block.line > intervals[interval].from && block.line < intervals[interval].to);
      if (hide && !block.element.hasAttribute("hidden")) {
        block.element.setAttribute("hidden", ""); this.hidden.add(block.element); changed = true;
      } else if (!hide && this.hidden.delete(block.element) && block.element.getAttribute("hidden") === "") {
        block.element.removeAttribute("hidden"); changed = true;
      }
    }
    for (const [heading, button] of this.controls) { this.label(heading, button); }
    if (changed) { this.changed(); }
  }

  /** Reveal only collapsed ancestors, leaving the target heading's own state. */
  reveal(element: HTMLElement): void {
    if (!this.available()) { return; }
    let block: HTMLElement | null = element;
    for (let depth = 0; block && block.parentElement !== this.section && depth++ < 64;) { block = block.parentElement; }
    const target = this.inventory.blocks.find(entry => entry.element === block);
    if (!target) { return; }
    let changed = false;
    for (const heading of this.inventory.headings) {
      if (heading.line < target.line && target.line < heading.end && this.collapsed.delete(heading.line)) { changed = true; }
    }
    if (changed) { this.apply(); }
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true; this.observer?.disconnect();
    let changed = false;
    for (const element of this.hidden) {
      if (element.getAttribute("hidden") === "") { element.removeAttribute("hidden"); changed = true; }
    }
    this.hidden.clear(); this.collapsed.clear(); this.intended.clear();
    for (const button of this.controls.values()) { button.remove(); }
    this.controls.clear();
    if (changed) { this.changed(); }
  }
}
