import { REGEX_SUBSET_MESSAGE, regexSearchValidation } from "./search-pattern";

export const MAX_READING_SEARCH_CHARACTERS = 262_144;
export const MAX_READING_SEARCH_NODES = 4_096;
export const MAX_READING_SEARCH_MATCHES = 10_000;
export const MAX_READING_SEARCH_QUERY = 256;
export const MAX_READING_SELECTION_RANGES = 64;

export interface ReadingSearchOptions { caseSensitive: boolean; wholeWord: boolean; regexp?: boolean }
export interface ReadingSearchMatch { section: number; from: number; to: number }
export interface ReadingSearchPlan { matches: ReadingSearchMatch[]; message: string | null }
interface SearchText { text: string; collapseWhitespace?: boolean }
export interface ReadingSelectionRange { from: number; to: number }
export interface ReadingSelectionCapture { ranges: ReadingSelectionRange[]; message: string | null }

/** Logical offsets concatenate visible sections; matching still never crosses a section boundary. */
export function normalizeReadingSelection(ranges: readonly ReadingSelectionRange[], length: number): ReadingSelectionCapture {
  if (!Number.isSafeInteger(length) || length < 0 || ranges.length > MAX_READING_SELECTION_RANGES * 2 || ranges.some(range => !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to > length || range.to < range.from)) {
    return { ranges: [], message: "Select up to 64 passages inside the current Reading note." };
  }
  const normalized: ReadingSelectionRange[] = [];
  for (const range of ranges.filter(range => range.from < range.to).toSorted((a, b) => a.from - b.from || a.to - b.to)) {
    const previous = normalized.at(-1);
    if (previous && previous.to >= range.from) { previous.to = Math.max(previous.to, range.to); }
    else { normalized.push({ ...range }); }
  }
  if (normalized.length > MAX_READING_SELECTION_RANGES) { return { ranges: [], message: "Select up to 64 passages inside the current Reading note." }; }
  if (normalized.reduce((sum, range) => sum + range.to - range.from, 0) > MAX_READING_SEARCH_CHARACTERS) {
    return { ranges: [], message: "Selected Reading text exceeds the 262,144-character limit." };
  }
  return { ranges: normalized, message: null };
}

const word = /[\p{L}\p{N}\p{M}_]/u;
function before(text: string, offset: number): string {
  const end = offset - 1;
  return end < 0 ? "" : text.slice(end > 0 && /[\uDC00-\uDFFF]/.test(text[end]) ? end - 1 : end, offset);
}
function at(text: string, offset: number): string { const point = text.codePointAt(offset); return point === undefined ? "" : String.fromCodePoint(point); }

function collapsedText(source: string): { text: string; offsets: number[] | null } {
  if (!/[\t\r\n\f]| {2}/.test(source)) { return { text: source, offsets: null }; }
  let text = "";
  const offsets: number[] = [];
  for (let index = 0; index < source.length;) {
    offsets.push(index);
    if (/[ \t\r\n\f]/.test(source[index])) { text += " "; do { index++; } while (index < source.length && /[ \t\r\n\f]/.test(source[index])); }
    else { text += source[index++]; }
  }
  offsets.push(source.length);
  return { text, offsets };
}

/**
 * Bounded literal/regex matching retains original UTF-16 offsets, including case
 * folds. Regex runs per rendered section with Unicode/multiline anchors: prose
 * whitespace collapses, preformatted text stays exact, and selected gaps never
 * join. Only nonempty matches produce ranges or contribute to the count.
 */
export function planReadingSearch(sections: readonly (string | SearchText)[], query: string, options: ReadingSearchOptions, scope: readonly ReadingSelectionRange[] | null = null): ReadingSearchPlan {
  if (!query) { return { matches: [], message: null }; }
  if (options.regexp) {
    const error = regexSearchValidation(query);
    if (error) { return { matches: [], message: error }; }
  }
  if (query.length > MAX_READING_SEARCH_QUERY) { return { matches: [], message: `Find supports up to ${MAX_READING_SEARCH_QUERY} characters.` }; }
  if (sections.length > MAX_READING_SEARCH_NODES || sections.reduce((sum, section) => sum + (typeof section === "string" ? section.length : section.text.length), 0) > MAX_READING_SEARCH_CHARACTERS) {
    return { matches: [], message: "This rendered note exceeds the Reading search limit. Search its source instead." };
  }
  const literal = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.caseSensitive ? "gu" : "giu");
  const exact = options.regexp ? new RegExp(query, options.caseSensitive ? "gmu" : "gimu") : literal(query);
  // Regex syntax is never whitespace-normalized. Only ordinary prose is
  // collapsed; code keeps its original spaces/newlines and every raw offset.
  const prose = options.regexp ? exact : literal(collapsedText(query).text);
  const matches: ReadingSearchMatch[] = [];
  const selected = scope === null ? null : normalizeReadingSelection(scope, sections.reduce((sum, entry) => sum + (typeof entry === "string" ? entry.length : entry.text.length), 0));
  if (selected?.message) { return { matches: [], message: selected.message }; }
  let offset = 0, member = 0;
  for (const [section, entry] of sections.entries()) {
    const source = typeof entry === "string" ? entry : entry.text, collapse = typeof entry === "string" || entry.collapseWhitespace !== false;
    const { text, offsets } = collapse ? collapsedText(source) : { text: source, offsets: null }, pattern = collapse ? prose : exact;
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(text));) {
      const from = match.index, to = from + match[0].length;
      if (from === to) {
        // RegExp.exec does not advance an empty global match. Reading paints
        // text ranges only, so ignore it and advance by one Unicode point.
        if (pattern.lastIndex >= text.length) { break; }
        pattern.lastIndex += at(text, pattern.lastIndex).length || 1;
        continue;
      }
      if (options.wholeWord && (word.test(at(match[0], 0)) && word.test(before(text, from))
        || word.test(before(match[0], match[0].length)) && word.test(at(text, to)))) { continue; }
      const rawFrom = offsets?.[from] ?? from, rawTo = offsets?.[to] ?? to;
      if (selected) {
        while (member < selected.ranges.length && selected.ranges[member].to < offset + rawTo) { member++; }
        const range = selected.ranges[member];
        if (!range || range.from > offset + rawFrom || range.to < offset + rawTo) { continue; }
      }
      if (matches.length >= MAX_READING_SEARCH_MATCHES) { return { matches: [], message: "More than 10,000 Reading matches. Use a longer query." }; }
      matches.push({ section, from: rawFrom, to: rawTo });
    }
    offset += source.length;
  }
  return { matches, message: null };
}

interface TextPart { node: Text; text: string; from: number; to: number }
interface TextSection { element: Element; text: string; parts: TextPart[]; collapseWhitespace: boolean }
export interface ReadingTextSnapshot { sections: TextSection[]; message: string | null }

/** Intersect only searchable text; a native range never imports controls, hidden text or another pane. */
export function captureReadingSelection(root: HTMLElement, snapshot: ReadingTextSnapshot, selection: Selection | null): ReadingSelectionCapture {
  if (snapshot.message || !readingSnapshotCurrent(root, snapshot)) { return { ranges: [], message: "The Reading content changed. Select its text again." }; }
  if (!selection?.rangeCount) { return { ranges: [], message: null }; }
  if (selection.rangeCount > MAX_READING_SELECTION_RANGES) { return { ranges: [], message: "Select up to 64 passages inside the current Reading note." }; }
  const ranges: ReadingSelectionRange[] = [];
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    if (range.collapsed) { continue; }
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) { return { ranges: [], message: null }; }
    let start: number | null = null, end = 0, offset = 0;
    for (const section of snapshot.sections) {
      for (const part of section.parts) {
        if (!range.intersectsNode(part.node)) { continue; }
        const from = range.startContainer === part.node ? range.startOffset : 0, to = range.endContainer === part.node ? range.endOffset : part.text.length;
        if (to <= from) { continue; }
        start ??= offset + part.from + from; end = offset + part.from + to;
      }
      offset += section.text.length;
    }
    if (start !== null && end > start) { ranges.push({ from: start, to: end }); }
  }
  return normalizeReadingSelection(ranges, snapshot.sections.reduce((sum, section) => sum + section.text.length, 0));
}

const excluded = "script,style,template,textarea,input,button,select,svg,math,canvas,audio,video,[hidden],[aria-hidden=true],.footnote-backref,.callout-icon,.math-inline,.math-block,.markdown-embed";
const barriers = "br,img,textarea,input,button,select,svg,math,canvas,audio,video,.footnote-backref,.callout-icon,.math-inline,.math-block,.markdown-embed";
const blocks = "p,h1,h2,h3,h4,h5,h6,li,pre,td,th,summary,blockquote,div";

/** Search visible note text, across inline spans but never across block boundaries. */
export function readingTextSnapshot(root: HTMLElement, includeCollapsedCallout?: (details: HTMLElement) => boolean): ReadingTextSnapshot {
  const sections: TextSection[] = [];
  const view = root.ownerDocument.defaultView;
  let count = 0, characters = 0, limited = false, section: TextSection | undefined;
  const walker = root.ownerDocument.createTreeWalker(root, 5, { acceptNode: node => {
    // Accept the first over-limit node so TreeWalker returns control immediately
    // instead of internally walking the rest of a huge rejected subtree.
    if (++count > MAX_READING_SEARCH_NODES) { limited = true; return 1; }
    if (node.nodeType !== 1) { return 1; }
    const element = node as Element, style = view?.getComputedStyle(element);
    if (element.hasAttribute("hidden") || style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") { return 2; }
    const nested = element.matches(".markdown-preview-view");
    if (element.matches(barriers) || nested) { section = undefined; return 2; }
    if (element.matches(excluded)) { return 2; }
    return 1;
  } });
  for (let node; (node = walker.nextNode());) {
    if (limited) { return { sections: [], message: "This rendered note has too many DOM nodes. Search its source instead." }; }
    if (node.nodeType !== 3) { continue; }
    const parent = node.parentElement, text = node.nodeValue ?? "";
    if (!parent || !text || parent.closest(".markdown-preview-view") !== root) { continue; }
    let visible = true, ancestor: Element | null = parent, depth = 0;
    for (; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      const style = view?.getComputedStyle(ancestor);
      if (++depth > 32 || style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") { visible = false; break; }
      if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open")
        && !(ancestor.firstElementChild?.tagName === "SUMMARY" && ancestor.firstElementChild.contains(parent))
        && !includeCollapsedCallout?.(ancestor as HTMLElement)) { visible = false; break; }
    }
    if (!visible || ancestor !== root) { continue; }
    characters += text.length;
    if (characters > MAX_READING_SEARCH_CHARACTERS) { return { sections: [], message: "This rendered note exceeds the Reading search limit. Search its source instead." }; }
    const element = parent.closest(blocks) ?? root;
    const whitespace = view?.getComputedStyle(parent).whiteSpace ?? "normal", collapseWhitespace = whitespace === "normal" || whitespace === "nowrap";
    if (!section || section.element !== element || section.collapseWhitespace !== collapseWhitespace) { section = { element, text: "", parts: [], collapseWhitespace }; sections.push(section); }
    section.parts.push({ node: node as Text, text, from: section.text.length, to: section.text.length + text.length });
    section.text += text;
  }
  return { sections, message: null };
}

/** Reject obsolete Range endpoints even before an observer callback has run. */
export function readingSnapshotCurrent(root: HTMLElement, snapshot: ReadingTextSnapshot): boolean {
  return root.isConnected && snapshot.sections.every(section => section.parts.every(part => root.contains(part.node) && part.node.data === part.text));
}

function matchRange(document: Document, snapshot: ReadingTextSnapshot, match: ReadingSearchMatch): Range | null {
  const section = snapshot.sections[match.section];
  const start = section?.parts.find(part => part.from <= match.from && part.to > match.from);
  const end = section?.parts.findLast(part => part.from < match.to && part.to >= match.to);
  if (!start || !end) { return null; }
  const range = document.createRange();
  range.setStart(start.node, match.from - start.from); range.setEnd(end.node, match.to - end.from);
  return range;
}

/** Reveal the actual text rectangle inside each owned scrolling ancestor. */
function revealRange(root: HTMLElement, range: Range): void {
  for (let element = range.startContainer.parentElement, depth = 0; element && root.contains(element) && depth++ < 32; element = element.parentElement) {
    const style = root.ownerDocument.defaultView?.getComputedStyle(element), box = element.getBoundingClientRect();
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const top = box.top + element.clientTop, left = box.left + element.clientLeft;
    if (element.clientHeight && element.scrollHeight > element.clientHeight && (element === root || /auto|scroll|overlay/.test(style?.overflowY ?? ""))
      && (rect.top < top || rect.bottom > top + element.clientHeight)) {
      element.scrollTop += rect.top - top - Math.max(0, (element.clientHeight - rect.height) / 2);
    }
    if (element.clientWidth && element.scrollWidth > element.clientWidth && (element === root || /auto|scroll|overlay/.test(style?.overflowX ?? ""))
      && (rect.left < left || rect.right > left + element.clientWidth)) {
      element.scrollLeft += rect.left - left - Math.max(0, (element.clientWidth - rect.width) / 2);
    }
    if (element === root) { break; }
  }
}

interface Paint { ranges: Range[]; active: Range | null }
export interface ReadingSearchCalloutOptions {
  /** Only the owning main Reading render can opt captured callout bodies in. */
  includeCollapsedCallout?: (details: HTMLElement) => boolean;
  reveal?: (element: HTMLElement) => void;
}
interface HighlightHost { CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }; Highlight?: new (...ranges: Range[]) => unknown }
const paints = new WeakMap<Document, Map<object, Paint>>();
function paint(document: Document, owner: object, ranges: Range[] | null, active: Range | null = null): boolean {
  let entries = paints.get(document);
  if (!entries) { entries = new Map(); paints.set(document, entries); }
  if (ranges) { entries.set(owner, { ranges, active }); } else { entries.delete(owner); }
  const host = document.defaultView as HighlightHost | null, registry = host?.CSS?.highlights, Highlight = host?.Highlight;
  if (!registry || !Highlight) { return false; }
  // Registry names are shared by this document, with independently owned ranges
  // for each open pane. Closing one pane never clears another pane's search.
  const all = [...entries.values()].flatMap(entry => entry.ranges).slice(0, MAX_READING_SEARCH_MATCHES);
  const selected = [...entries.values()].flatMap(entry => entry.active ? [entry.active] : []);
  if (all.length) { registry.set("slopsidian-reading-search", new Highlight(...all)); } else { registry.delete("slopsidian-reading-search"); }
  if (selected.length) { registry.set("slopsidian-reading-search-active", new Highlight(...selected)); } else { registry.delete("slopsidian-reading-search-active"); }
  return true;
}

/** One current, main-note Reading renderer. Never changes source or rendered nodes. */
export class ReadingSearch {
  readonly dom: HTMLElement;
  private readonly query: HTMLInputElement;
  private readonly caseSensitive: HTMLInputElement;
  private readonly wholeWord: HTMLInputElement;
  private readonly regexp: HTMLInputElement;
  private readonly inSelection: HTMLInputElement;
  private readonly useSelection: HTMLButtonElement;
  private readonly addSelection: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly observer: MutationObserver;
  private snapshot: ReadingTextSnapshot | null = null;
  private matches: ReadingSearchMatch[] = [];
  private ranges: Range[] = [];
  private selected = -1;
  private dirty = true;
  private closed = false;
  private frame: number | null = null;
  private readonly document: Document;
  private scope: ReadingSelectionRange[] | null = null;
  private scopeStale = false;
  private candidate: { snapshot: ReadingTextSnapshot; ranges: ReadingSelectionRange[] } | null = null;
  private captureError: string | null = null;
  private navigationSelection: Range | null = null;
  private message: string | null = null;
  private highlighted = true;

  constructor(private readonly root: HTMLElement, host: HTMLElement, private readonly current: () => boolean, private readonly onClose: () => void,
    private readonly callouts: ReadingSearchCalloutOptions = {}) {
    const document = root.ownerDocument;
    this.document = document;
    this.dom = document.createElement("div"); this.dom.className = "reading-search-panel"; this.dom.dataset.readingSearch = "true";
    this.dom.setAttribute("role", "search"); this.dom.setAttribute("aria-label", "Find in Reading view");
    const row = document.createElement("div"); row.className = "reading-search-row";
    this.query = document.createElement("input"); this.query.type = "text"; this.query.placeholder = "Find in Reading view";
    this.query.setAttribute("aria-label", "Find in Reading view"); this.query.dataset.readingSearchQuery = "true"; this.query.autocomplete = "off"; this.query.spellcheck = false;
    this.query.addEventListener("input", () => this.update(true));
    const button = (name: string, label: string, action: () => unknown): HTMLButtonElement => {
      const control = document.createElement("button"); control.type = "button"; control.name = name; control.textContent = label;
      control.addEventListener("click", () => { if (this.available()) { action(); } }); return control;
    };
    row.append(this.query, button("previous", "Previous", () => this.previous()), button("next", "Next", () => this.next()), button("close", "Close", () => this.close()));
    const options = document.createElement("div"); options.className = "reading-search-options";
    const checkbox = (name: string, text: string): HTMLInputElement => {
      const label = document.createElement("label"), control = document.createElement("input"); control.type = "checkbox"; control.name = name;
      control.addEventListener("change", () => this.update(true)); label.append(control, document.createTextNode(text)); options.append(label); return control;
    };
    this.caseSensitive = checkbox("case", "Match case"); this.wholeWord = checkbox("word", "Whole word");
    this.regexp = checkbox("regexp", "Regular expression"); this.regexp.dataset.readingSearchRegexp = "true";
    this.regexp.parentElement!.title = REGEX_SUBSET_MESSAGE + " Prose whitespace is collapsed; code whitespace stays exact. Anchors apply within each section. Only nonempty matches are counted.";
    this.inSelection = checkbox("selection", "In selection"); this.inSelection.dataset.readingSearchSelection = "true";
    this.inSelection.addEventListener("change", () => {
      if (!this.available()) { return; }
      if (this.inSelection.checked && (!this.scope || this.scopeStale)) { this.capture(false); }
      else { this.captureError = null; this.update(true); }
    });
    this.status = document.createElement("span"); this.status.className = "reading-search-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    const captures = document.createElement("div"); captures.className = "reading-search-row"; captures.style.marginTop = "6px";
    this.useSelection = button("useSelection", "Use current selection", () => this.capture(false)); this.useSelection.dataset.readingSearchUseSelection = "true";
    this.addSelection = button("addSelection", "Add selection", () => this.capture(true)); this.addSelection.dataset.readingSearchAddSelection = "true";
    // Read the owned native selection before a pointer focuses a panel control.
    for (const control of [this.inSelection, this.useSelection, this.addSelection]) { control.addEventListener("pointerdown", () => this.rememberSelection()); }
    captures.append(this.useSelection, this.addSelection);
    options.append(this.status); this.dom.append(row, options, captures); host.insertBefore(this.dom, root);
    this.dom.addEventListener("keydown", this.keydown);
    root.addEventListener("keydown", this.keydown);
    root.addEventListener("pointerdown", this.selectionIntent);
    root.addEventListener("keydown", this.selectionIntent);
    document.addEventListener("selectionchange", this.selectionChanged);
    const Mutation = document.defaultView!.MutationObserver;
    this.observer = new Mutation(records => { if (this.changedRecords(records)) { this.dirty = true; this.queueUpdate(); } });
    this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"] });
    const selection = document.getSelection();
    if (selection && selection.rangeCount && root.contains(selection.anchorNode) && root.contains(selection.focusNode) && selection.toString().length <= MAX_READING_SEARCH_QUERY) { this.query.value = selection.toString(); }
    this.snapshot = readingTextSnapshot(root, this.callouts.includeCollapsedCallout); this.dirty = false;
    this.rememberSelection(); this.scope = this.candidate?.ranges.map(range => ({ ...range })) ?? null;
    this.update(true);
  }

  private readonly selectionIntent = (event: Event): void => {
    if (event.type === "pointerdown" || event instanceof this.document.defaultView!.KeyboardEvent && (event.shiftKey && /^(?:Arrow|Home|End|Page)/.test(event.key) || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")) { this.navigationSelection = null; }
  };

  private readonly selectionChanged = (): void => { this.rememberSelection(); };

  private rememberSelection(): void {
    if (!this.available() || !this.snapshot || this.dirty || !readingSnapshotCurrent(this.root, this.snapshot)) { this.candidate = null; this.selectionControls(); return; }
    const selection = this.document.getSelection();
    if (this.navigationSelection && selection?.rangeCount === 1) {
      const range = selection.getRangeAt(0), old = this.navigationSelection;
      if (range.startContainer === old.startContainer && range.startOffset === old.startOffset && range.endContainer === old.endContainer && range.endOffset === old.endOffset) { this.selectionControls(); return; }
    }
    const capture = captureReadingSelection(this.root, this.snapshot, selection);
    if (capture.ranges.length) { this.candidate = { snapshot: this.snapshot, ranges: capture.ranges }; this.captureError = null; }
    else {
      const nonempty = selection && selection.rangeCount <= MAX_READING_SELECTION_RANGES && Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)).some(range => !range.collapsed);
      if (capture.message || nonempty || !this.dom.contains(this.document.activeElement)) { this.candidate = null; }
    }
    if (capture.message) { this.captureError = capture.message; }
    this.selectionControls();
  }

  private selectionControls(): void {
    const available = Boolean(this.candidate?.ranges.length && this.candidate.snapshot === this.snapshot && !this.dirty);
    this.useSelection.disabled = !available; this.addSelection.disabled = !available;
    this.inSelection.disabled = !available && !this.scope;
    this.dom.dataset.readingSearchScope = this.inSelection.checked ? this.scopeStale ? "stale" : "selected" : "all";
    this.dom.dataset.readingSearchSelectionRanges = String(this.scope?.length ?? 0);
  }

  private capture(add: boolean): void {
    if (!this.available()) { return; }
    this.update(false);
    const candidate = this.candidate;
    if (!candidate || candidate.snapshot !== this.snapshot || !readingSnapshotCurrent(this.root, candidate.snapshot)) { this.captureError = "Select visible text in this Reading note first."; this.update(true); return; }
    const result = normalizeReadingSelection([...(add && !this.scopeStale ? this.scope ?? [] : []), ...candidate.ranges], this.snapshot!.sections.reduce((sum, section) => sum + section.text.length, 0));
    if (result.message) { this.captureError = result.message; this.update(false); return; }
    this.scope = result.ranges; this.scopeStale = false; this.captureError = null; this.inSelection.checked = true;
    this.update(true);
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !this.available()) { return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
    else if (event.key === "Enter" && event.target === this.query) { event.preventDefault(); event.stopPropagation(); (event.shiftKey ? this.previous() : this.next()); }
  };

  private available(): boolean {
    if (this.closed) { return false; }
    if (!this.current() || !this.root.isConnected || !this.dom.isConnected || this.root.ownerDocument !== this.document) { this.close(false); return false; }
    return true;
  }

  private queueUpdate(): void {
    if (!this.available()) { return; }
    const window = this.document.defaultView;
    if (!this.closed && this.frame === null && window) { this.frame = window.requestAnimationFrame(() => { this.frame = null; this.update(false); }); }
  }

  /** Fold visibility changed synchronously; invalidate captures without scrolling. */
  visibilityChanged(): void { this.dirty = true; this.update(false, false); }

  private changedRecords(records: MutationRecord[]): boolean {
    // Captured callout text stays in this index while closed. Opening it for
    // navigation must not invalidate selected passages or reset the match.
    return records.some(record => record.type !== "attributes" || record.attributeName !== "open"
      || !this.callouts.includeCollapsedCallout?.(record.target as HTMLElement));
  }

  private reveal(range: Range): void {
    const element = range.startContainer.parentElement;
    if (element) { this.callouts.reveal?.(element); }
    revealRange(this.root, range);
  }

  private update(reset: boolean, reveal = true): void {
    if (!this.available()) { return; }
    if (this.changedRecords(this.observer?.takeRecords() ?? [])) { this.dirty = true; }
    const previous = this.matches[this.selected];
    if (this.dirty || !this.snapshot || !readingSnapshotCurrent(this.root, this.snapshot)) {
      if (this.scope) { this.scopeStale = true; }
      this.candidate = null; this.navigationSelection = null;
      this.snapshot = readingTextSnapshot(this.root, this.callouts.includeCollapsedCallout); this.dirty = false; reset = true;
    }
    const stale = this.inSelection.checked && this.scopeStale;
    const result = planReadingSearch(this.snapshot.sections, this.query.value, { caseSensitive: this.caseSensitive.checked, wholeWord: this.wholeWord.checked, regexp: this.regexp.checked }, this.inSelection.checked ? stale ? [] : this.scope ?? [] : null);
    this.matches = result.matches;
    this.ranges = this.matches.flatMap(match => { const range = matchRange(this.root.ownerDocument, this.snapshot!, match); return range ? [range] : []; });
    this.selected = reset || !previous ? this.matches.length ? 0 : -1 : Math.min(this.selected, this.matches.length - 1);
    this.highlighted = paint(this.document, this, this.ranges, this.ranges[this.selected] ?? null);
    this.message = this.snapshot.message ?? this.captureError ?? (stale ? "Selected Reading content changed. Use current selection or turn off In selection." : result.message);
    this.query.setAttribute("aria-invalid", String(Boolean(this.message)));
    this.renderStatus(); this.selectionControls();
    this.dom.dataset.readingSearchCount = String(this.matches.length); this.dom.dataset.readingSearchActive = String(this.selected + 1);
    if (reveal && reset && this.ranges[this.selected]) { this.reveal(this.ranges[this.selected]); }
  }

  private renderStatus(): void {
    this.status.textContent = this.message ?? (!this.query.value ? "Enter text to find." : `${this.selected < 0 ? 0 : this.selected + 1} of ${this.matches.length} matches`
      + (this.inSelection.checked ? " in selection" + ((this.scope?.length ?? 0) > 1 ? ` (${this.scope!.length} ranges)` : "") : "")
      + (!this.highlighted && this.matches.length ? ". Highlighting unavailable; navigation selects the match." : ""));
  }

  focus(): void { if (this.available()) { this.query.focus(); this.query.select(); } }
  next(): boolean { return this.navigate(1); }
  previous(): boolean { return this.navigate(-1); }
  private navigate(direction: number): boolean {
    if (!this.available()) { return false; }
    this.update(false);
    if (!this.matches.length) { return false; }
    this.selected = (this.selected + direction + this.matches.length) % this.matches.length;
    const range = this.ranges[this.selected];
    this.highlighted = paint(this.document, this, this.ranges, range ?? null);
    if (range) {
      this.reveal(range);
      if (!this.highlighted) { this.navigationSelection = range.cloneRange(); const selection = this.root.ownerDocument.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
    }
    this.renderStatus();
    this.dom.dataset.readingSearchActive = String(this.selected + 1);
    return true;
  }

  close(focus = true): void {
    if (this.closed) { return; }
    this.closed = true; this.observer?.disconnect();
    if (this.frame !== null) { this.document.defaultView?.cancelAnimationFrame(this.frame); this.frame = null; }
    this.root.removeEventListener("keydown", this.keydown); this.dom.removeEventListener("keydown", this.keydown);
    this.root.removeEventListener("pointerdown", this.selectionIntent); this.root.removeEventListener("keydown", this.selectionIntent); this.document.removeEventListener("selectionchange", this.selectionChanged);
    paint(this.document, this, null); this.snapshot = null; this.scope = null; this.candidate = null; this.navigationSelection = null; this.matches = []; this.ranges = []; this.dom.remove(); this.onClose();
    if (focus && this.current() && this.root.isConnected) { this.root.focus({ preventScroll: true }); }
  }
}
