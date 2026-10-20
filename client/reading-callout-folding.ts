/** Original-main Reading callout folds never change note text or rendered owners. */
export const MAX_READING_CALLOUT_SOURCE = 1_048_576;
export const MAX_READING_CALLOUT_NODES = 8_192;
export const MAX_READING_CALLOUTS = 512;
export const MAX_READING_CALLOUT_DEPTH = 32;

interface CalloutAncestor { element: HTMLElement; parent: HTMLElement; line: string | undefined }
export interface ReadingCalloutFold {
  element: HTMLDetailsElement; summary: HTMLElement; body: HTMLElement; line: number; type: string; defaultOpen: boolean;
  ancestors: CalloutAncestor[];
}
export interface ReadingCalloutInventory { entries: ReadingCalloutFold[]; message: string | null }
export interface ReadingCalloutOptions {
  initialCollapsed?: unknown;
  onUserChange?: (lines: readonly number[]) => void;
}

/** Missing or malformed preferences keep the Markdown +/- defaults. */
export function readingCalloutState(value: unknown, allowed: readonly number[]): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_READING_CALLOUTS || allowed.length > MAX_READING_CALLOUTS
    || value.some(line => !Number.isSafeInteger(line) || line < 0 || line > MAX_READING_CALLOUT_SOURCE)
    || new Set(value).size !== value.length) { return null; }
  const known = new Set(allowed);
  return value.filter(line => known.has(line)).sort((a, b) => a - b);
}

/** Capture only renderer-mapped details, before any postprocessor or embed runs. */
export function captureReadingCallouts(section: HTMLElement, source: string): ReadingCalloutInventory {
  const refuse = (message = "This rendered note exceeds the Reading callout-folding limits."): ReadingCalloutInventory => ({ entries: [], message });
  if (source.length > MAX_READING_CALLOUT_SOURCE || section.childElementCount > MAX_READING_CALLOUT_NODES) { return refuse(); }
  const lines = source.split(/\r\n|\n|\r/), entries: ReadingCalloutFold[] = [], seen = new Set<number>();
  const walker = section.ownerDocument.createTreeWalker(section, 1);
  let nodes = 0;
  for (let node; (node = walker.nextNode());) {
    if (++nodes > MAX_READING_CALLOUT_NODES) { return refuse(); }
    const element = node as HTMLElement;
    if (element.tagName !== "DETAILS" || !element.classList.contains("callout") || !element.classList.contains("is-collapsible")
      || element.dataset.sourceLine === undefined || element.closest(".footnotes,.markdown-embed,.markdown-renderer-fragment")) { continue; }
    const raw = element.dataset.sourceLine, line = /^(?:0|[1-9]\d*)$/.test(raw) ? Number(raw) : -1;
    const header = /^ {0,3}(?:>[ \t]*)+\[!([a-z][a-z0-9_-]*)\]([+-])(?:[ \t]|$)/i.exec(lines[line] ?? "");
    const summary = element.children[0] as HTMLElement | undefined, body = element.children[1] as HTMLElement | undefined;
    if (!Number.isSafeInteger(line) || line < 0 || seen.has(line) || !header || element.dataset.callout !== header[1].toLowerCase()
      || element.childElementCount !== 2 || summary?.tagName !== "SUMMARY" || !summary.classList.contains("callout-title")
      || !body?.classList.contains("callout-content") || entries.length >= MAX_READING_CALLOUTS) { return refuse("A rendered callout has an unsupported or ambiguous source mapping."); }
    const ancestors: CalloutAncestor[] = [];
    for (let parent: HTMLElement | null = element; parent && parent !== section; parent = parent.parentElement) {
      if (ancestors.length >= MAX_READING_CALLOUT_DEPTH || !parent.parentElement) { return refuse(); }
      ancestors.push({ element: parent, parent: parent.parentElement, line: parent.dataset.sourceLine });
    }
    if (ancestors.at(-1)?.parent !== section) { return refuse("A rendered callout is outside its original section."); }
    seen.add(line); entries.push({ element: element as HTMLDetailsElement, summary, body, line, type: header[1].toLowerCase(), defaultOpen: header[2] === "+", ancestors });
  }
  return { entries, message: null };
}

export class ReadingCalloutFolding {
  private readonly document: Document;
  private readonly observer: MutationObserver;
  private readonly listeners: (() => void)[] = [];
  private readonly intended = new Set<number>();
  private disposed = false;

  constructor(private readonly root: HTMLElement, private readonly section: HTMLElement, private readonly inventory: ReadingCalloutInventory,
    private readonly current: () => boolean, private readonly changed: () => void, private readonly options: ReadingCalloutOptions = {}) {
    this.document = root.ownerDocument;
    this.observer = new this.document.defaultView!.MutationObserver(() => { if (!this.topologyCurrent()) { this.dispose(); } });
    if (inventory.message || !this.topologyCurrent()) { this.dispose(); return; }
    const initial = readingCalloutState(options.initialCollapsed, inventory.entries.map(entry => entry.line));
    for (const entry of inventory.entries) {
      const collapsed = initial === null ? !entry.defaultOpen : initial.includes(entry.line);
      if (collapsed) { this.intended.add(entry.line); }
      entry.element.open = !collapsed;
      entry.summary.dataset.readingCalloutToggle = String(entry.line);
      const click = (event: MouseEvent): void => {
        const target = event.target as Element | null;
        if (event.button !== 0 || event.defaultPrevented || !target || target.closest("a,button,input,select,textarea,[contenteditable=true]")) { return; }
        // Own the native details activation. A stale held summary must not
        // change a newer view, and .click()/toggle events are not user intent.
        event.preventDefault();
        if (!event.isTrusted || !this.available()) { return; }
        entry.element.open = !entry.element.open;
        if (entry.element.open) { this.intended.delete(entry.line); } else { this.intended.add(entry.line); }
        this.changed();
        if (!this.disposed && this.current()) {
          try { this.options.onUserChange?.(this.snapshot()); } catch { /* Preference failure cannot prevent view-only folding. */ }
        }
      };
      const toggle = (): void => { if (this.available()) { this.changed(); } };
      entry.summary.addEventListener("click", click); entry.element.addEventListener("toggle", toggle);
      this.listeners.push(() => { entry.summary.removeEventListener("click", click); entry.element.removeEventListener("toggle", toggle); });
      this.observer.observe(entry.element, { childList: true, attributes: true, attributeFilter: ["data-source-line", "data-callout", "class"] });
      for (const ancestor of entry.ancestors) { this.observer.observe(ancestor.parent, { childList: true }); }
    }
  }

  get isDisposed(): boolean { return this.disposed; }
  snapshot(): number[] { return [...this.intended].sort((a, b) => a - b); }

  /** Command checks never toggle native details or persist a preference. */
  canSetAll(): boolean { return this.inventory.entries.length > 0 && !this.disposed && this.current() && this.topologyCurrent(); }

  /** Explicitly expand even Markdown-minus defaults using a complete snapshot. */
  setAll(collapse: boolean): boolean {
    if (!this.canSetAll()) { return false; }
    this.intended.clear();
    for (const entry of this.inventory.entries) {
      entry.element.open = !collapse;
      if (collapse) { this.intended.add(entry.line); }
    }
    this.changed();
    if (!this.disposed && this.current()) {
      try { this.options.onUserChange?.(this.snapshot()); } catch { /* Best-effort local preference. */ }
    }
    return true;
  }

  private topologyCurrent(): boolean {
    return this.root.ownerDocument === this.document && this.section.ownerDocument === this.document && this.root.isConnected
      && this.section.parentElement === this.root && this.inventory.entries.every(entry => entry.element.ownerDocument === this.document
        && entry.element.tagName === "DETAILS" && entry.element.classList.contains("callout") && entry.element.classList.contains("is-collapsible")
        && entry.element.dataset.sourceLine === String(entry.line) && entry.element.dataset.callout === entry.type
        && entry.element.children[0] === entry.summary && entry.element.children[1] === entry.body
        && entry.element.childElementCount === 2 && entry.summary.tagName === "SUMMARY" && entry.summary.classList.contains("callout-title")
        && entry.body.classList.contains("callout-content") && entry.ancestors.every(ancestor => ancestor.element.parentElement === ancestor.parent
          && ancestor.element.ownerDocument === this.document && ancestor.element.dataset.sourceLine === ancestor.line));
  }

  private available(): boolean {
    if (this.disposed) { return false; }
    if (!this.current() || !this.topologyCurrent()) { this.dispose(); return false; }
    return true;
  }

  /** Search may inspect only these still-owned original callout bodies. */
  includes(details: HTMLElement): boolean { return this.available() && this.inventory.entries.some(entry => entry.element === details); }

  /** Navigation reveals owning bodies temporarily, preserving every explicit choice. */
  reveal(element: HTMLElement): void {
    if (!this.available()) { return; }
    let changed = false;
    for (const entry of this.inventory.entries) {
      if (!entry.element.open && (entry.element === element || entry.body === element || entry.body.contains(element))) { entry.element.open = true; changed = true; }
    }
    if (changed) { this.changed(); }
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true; this.observer.disconnect();
    for (const remove of this.listeners) { remove(); }
    this.listeners.length = 0;
    for (const entry of this.inventory.entries) {
      delete entry.summary.dataset.readingCalloutToggle;
      if (entry.element.open !== entry.defaultOpen) { entry.element.open = entry.defaultOpen; }
    }
    this.intended.clear();
  }
}
