/** Source-owned task inputs in a current main Reading view. Static/embed inputs stay disabled. */
export const MAX_READING_TASK_SOURCE = 1_048_576;
export const MAX_READING_TASK_ITEMS = 4_096;
export const MAX_READING_TASK_LINES = 65_536;
export const MAX_READING_TASK_LINE = 4_096;
const MAX_TASK_DEPTH = 64;

interface SourceListItem {
  position: { start: { line: number; offset: number }; end: { offset: number } };
  task?: string;
}
interface OriginalList { element: HTMLElement; children: HTMLElement[]; indices: Map<HTMLElement, number> }
export interface ReadingTaskTarget {
  input: HTMLInputElement;
  item: HTMLElement;
  container: HTMLElement;
  path: HTMLElement[];
  line: number;
  from: number;
  checked: boolean;
  label: string;
}
export interface ReadingTaskInventory {
  source: string;
  tasks: ReadingTaskTarget[];
  lists: OriginalList[];
  roots: { element: HTMLElement; line: string | undefined }[];
  mappedItems: { element: HTMLElement; line: number }[];
  message: string | null;
}
export interface ReadingTaskPlan {
  source: string;
  from: number;
  to: number;
  insert: "x" | " ";
  line: number;
  checked: boolean;
  focus: boolean;
}
export interface ReadingTaskContext {
  current(): boolean;
  writable(): boolean;
  commit(plan: ReadingTaskPlan): boolean;
  onError?(error: unknown): void;
}

/** Only ordinary list ancestry is eligible; quoted/callout/footnote/HTML wrappers are excluded. */
function taskPath(item: HTMLElement, section: HTMLElement): HTMLElement[] | null {
  const path: HTMLElement[] = [item];
  let node = item.parentElement;
  for (let depth = 0; node && depth < MAX_TASK_DEPTH; depth++) {
    if (node === section) { return path.length > 1 && ["UL", "OL"].includes(path[path.length - 1].tagName) ? path : null; }
    const previous = path[path.length - 1];
    if (previous.tagName === "LI" ? !["UL", "OL"].includes(node.tagName) : node.tagName !== "LI") { return null; }
    path.push(node); node = node.parentElement;
  }
  return null;
}

function ownListControl(element: Element): boolean { return element.matches("button.reading-list-fold-toggle"); }
function leadingElement(container: HTMLElement): Element | null {
  for (const child of container.children) { if (!ownListControl(child)) { return child; } }
  return null;
}
function inputContainer(input: HTMLInputElement, item: HTMLElement): HTMLElement | null {
  if (input.parentElement === item) { return leadingElement(item) === input ? item : null; }
  const paragraph = input.parentElement;
  return paragraph?.tagName === "P" && paragraph.parentElement === item && leadingElement(item) === paragraph
    && paragraph.firstElementChild === input ? paragraph : null;
}
function nearestItem(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement;
  for (let depth = 0; node && depth < MAX_TASK_DEPTH; depth++, node = node.parentElement) { if (node.tagName === "LI") { return node; } }
  return null;
}

/** Capture original identities and exact raw offsets before any postprocessor runs. */
export function captureReadingTasks(section: HTMLElement, source: string, metadata: readonly SourceListItem[]): ReadingTaskInventory {
  const refuse = (message: string): ReadingTaskInventory => ({ source: "", tasks: [], lists: [], roots: [], mappedItems: [], message });
  if (typeof source !== "string" || source.length > MAX_READING_TASK_SOURCE || metadata.length > MAX_READING_TASK_ITEMS
    || section.childElementCount > MAX_READING_TASK_ITEMS || section.getElementsByTagName("li").length > MAX_READING_TASK_ITEMS || section.getElementsByTagName("input").length > MAX_READING_TASK_ITEMS) {
    return refuse("This note exceeds the Reading task-editing limit.");
  }
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\r" || source[index] === "\n") {
      // The existing metadata line coordinates cover LF/CRLF. Do not borrow a
      // partial line inventory for classic-CR input, whose renderer normalizes it.
      if (source[index] === "\r" && source[index + 1] !== "\n") { return refuse("Reading task editing requires LF or CRLF source lines."); }
      if (source[index] === "\r" && source[index + 1] === "\n") { index++; }
      if (starts.length >= MAX_READING_TASK_LINES) { return refuse("This note has too many source lines for Reading task editing."); }
      starts.push(index + 1);
    }
  }
  const known = new Map<number, SourceListItem | null>();
  for (const entry of metadata) {
    const { line, offset } = entry.position.start, end = entry.position.end.offset;
    if (!Number.isSafeInteger(line) || line < 0 || line >= starts.length || !Number.isSafeInteger(offset) || offset < starts[line]
      || offset >= (starts[line + 1] ?? source.length + 1) || !Number.isSafeInteger(end) || end <= offset || end > source.length) { continue; }
    known.set(line, known.has(line) ? null : entry);
  }
  const mappedItems: ReadingTaskInventory["mappedItems"] = [], byLine = new Map<number, HTMLElement | null>(), paths = new Map<HTMLElement, HTMLElement[]>();
  for (const element of section.getElementsByTagName("li")) {
    const item = element as HTMLElement, raw = item.dataset.sourceLine, line = raw !== undefined && /^(?:0|[1-9]\d*)$/.test(raw) ? Number(raw) : -1;
    const path = taskPath(item, section);
    if (!Number.isSafeInteger(line) || line < 0 || !known.get(line) || !path) { continue; }
    mappedItems.push({ element: item, line }); paths.set(item, path); byLine.set(line, byLine.has(line) ? null : item);
  }
  const lists = new Map<HTMLElement, OriginalList>();
  for (const path of paths.values()) for (const element of path) {
    if (!["UL", "OL"].includes(element.tagName) || lists.has(element)) { continue; }
    const children = [...element.children].filter(child => child.tagName === "LI") as HTMLElement[];
    lists.set(element, { element, children, indices: new Map(children.map((child, index) => [child, index])) });
  }
  const tasks: ReadingTaskTarget[] = [];
  for (const element of section.getElementsByTagName("input")) {
    const input = element as HTMLInputElement;
    if (input.type !== "checkbox" || !input.disabled || input.indeterminate) { continue; }
    const item = nearestItem(input), line = item ? Number(item.dataset.sourceLine) : -1;
    const entry = known.get(line), path = item ? paths.get(item) : null;
    if (!item || byLine.get(line) !== item || !entry || !path) { continue; }
    const container = inputContainer(input, item);
    if (!container) { continue; }
    let ownInputs = 0;
    for (const candidate of item.getElementsByTagName("input")) { if (nearestItem(candidate as HTMLElement) === item) { ownInputs++; } }
    if (ownInputs !== 1) { continue; }
    const start = entry.position.start.offset, end = starts[line + 1] ?? source.length;
    if (end - start > MAX_READING_TASK_LINE || !/^[ \t]*$/.test(source.slice(starts[line], start).replace(line === 0 ? /^\ufeff/ : /$^/, ""))) { continue; }
    const raw = source.slice(start, end).replace(/[\r\n]+$/, ""), match = /^(?:[-+*]|\d{1,9}[.)])[ \t]+\[([ xX])\](?:[ \t]|$)/.exec(raw);
    if (!match || entry.task !== undefined && entry.task !== match[1]) { continue; }
    const from = start + match[0].indexOf("[") + 1, checked = match[1] !== " ";
    if (input.checked !== checked || from + 2 > entry.position.end.offset) { continue; }
    const text = raw.slice(match[0].indexOf("]") + 1).trim(), label = Array.from(text).slice(0, 160).join("");
    tasks.push({ input, item, container, path, line, from, checked, label });
  }
  const roots = [...lists.values()].filter(list => list.element.parentElement === section).map(list => ({ element: list.element, line: list.element.dataset.sourceLine }));
  return { source, tasks, lists: [...lists.values()], roots, mappedItems, message: null };
}

export function planReadingTaskToggle(source: string, target: Pick<ReadingTaskTarget, "from" | "line" | "checked">, checked: boolean, focus = false): ReadingTaskPlan | null {
  if (typeof source !== "string" || source.length > MAX_READING_TASK_SOURCE || typeof checked !== "boolean" || checked === target.checked
    || !Number.isSafeInteger(target.from) || target.from < 1 || target.from + 1 >= source.length || !Number.isSafeInteger(target.line) || target.line < 0
    || source[target.from - 1] !== "[" || source[target.from + 1] !== "]" || !/[ xX]/.test(source[target.from]) || (source[target.from] !== " ") !== target.checked) { return null; }
  return { source, from: target.from, to: target.from + 1, insert: checked ? "x" : " ", line: target.line, checked, focus };
}

/** One render owns each enabled input. A successful source edit retires that render's controls. */
export class ReadingTasks {
  private readonly document: Document;
  private readonly observer: MutationObserver;
  private readonly rootIndices: Map<HTMLElement, number>;
  private readonly active = new Map<number, ReadingTaskTarget>();
  private readonly listeners = new Map<ReadingTaskTarget, EventListener>();
  private readonly originalLabels = new Map<ReadingTaskTarget, string | null>();
  private readonly labels = new Map<ReadingTaskTarget, string>();
  private disposed = false;
  private committing = false;

  constructor(private readonly root: HTMLElement, private readonly section: HTMLElement, private readonly inventory: ReadingTaskInventory, private readonly context: ReadingTaskContext) {
    this.document = root.ownerDocument;
    this.rootIndices = new Map(inventory.roots.map((root, index) => [root.element, index]));
    this.observer = new this.document.defaultView!.MutationObserver(() => { if (!this.topologyCurrent()) { this.dispose(); } });
    if (!this.topologyCurrent()) { this.dispose(); return; }
    for (const task of inventory.tasks) {
      if (!this.targetCurrent(task)) { continue; }
      this.active.set(task.line, task); this.originalLabels.set(task, task.input.getAttribute("aria-label"));
      const label = (task.checked ? "Mark task incomplete" : "Complete task") + (task.label ? ": " + task.label : "");
      this.labels.set(task, label); task.input.setAttribute("aria-label", label); task.input.dataset.readingTaskLine = String(task.line);
      const changed: EventListener = () => { this.setChecked(task.line, task.input.checked, this.document.activeElement === task.input); };
      this.listeners.set(task, changed); task.input.addEventListener("change", changed);
    }
    this.observer.observe(section, { childList: true });
    for (const { element } of inventory.mappedItems) { this.observer.observe(element, { childList: true, attributes: true, attributeFilter: ["data-source-line"] }); }
    for (const { element } of inventory.lists) { this.observer.observe(element, { childList: true, attributes: true, attributeFilter: ["data-source-line"] }); }
    for (const task of this.active.values()) {
      if (task.container !== task.item) { this.observer.observe(task.container, { childList: true }); }
      this.observer.observe(task.input, { attributes: true, attributeFilter: ["type"] });
    }
    this.refresh();
  }

  get isDisposed(): boolean { return this.disposed; }

  private targetCurrent(task: ReadingTaskTarget): boolean {
    return task.input.ownerDocument === this.document && task.item.ownerDocument === this.document && task.input.type === "checkbox"
      && task.item.dataset.sourceLine === String(task.line) && inputContainer(task.input, task.item) === task.container
      && task.path.every((node, index) => node.ownerDocument === this.document && node.parentElement === (task.path[index + 1] ?? this.section));
  }

  private topologyCurrent(): boolean {
    if (this.disposed || this.root.ownerDocument !== this.document || this.section.ownerDocument !== this.document || !this.root.isConnected
      || this.section.parentElement !== this.root || this.section.childElementCount > MAX_READING_TASK_ITEMS || this.section.getElementsByTagName("li").length > MAX_READING_TASK_ITEMS
      || this.section.getElementsByTagName("input").length > MAX_READING_TASK_ITEMS) { return false; }
    let rootIndex = 0;
    for (const child of this.section.children) {
      const index = this.rootIndices.get(child as HTMLElement);
      if (index === undefined) { continue; }
      const original = this.inventory.roots[index];
      if (index !== rootIndex++ || original.element.dataset.sourceLine !== original.line) { return false; }
    }
    if (rootIndex !== this.inventory.roots.length) { return false; }
    for (const { element, line } of this.inventory.mappedItems) {
      if (element.isConnected && this.section.contains(element) && element.dataset.sourceLine !== String(line)) { return false; }
    }
    for (const { element, indices } of this.inventory.lists) {
      if (!this.section.contains(element)) { continue; }
      let previous = -1;
      for (const child of element.children) {
        const index = indices.get(child as HTMLElement);
        if (index === undefined) { continue; }
        if (index <= previous) { return false; }
        previous = index;
      }
    }
    return [...this.active.values()].every(task => this.targetCurrent(task));
  }

  refresh(): void {
    if (!this.topologyCurrent()) { this.dispose(); return; }
    const enabled = this.context.current() && this.context.writable() && !this.committing;
    for (const task of this.active.values()) { task.input.disabled = !enabled; }
  }

  focusTask(line: number): boolean {
    const task = this.active.get(line);
    if (!task || !this.available(task) || task.input.disabled) { return false; }
    task.input.focus({ preventScroll: true }); return this.document.activeElement === task.input;
  }

  private available(task: ReadingTaskTarget): boolean {
    if (!this.topologyCurrent()) { this.dispose(); return false; }
    if (this.committing || !this.context.current() || !this.context.writable() || !task.input.checkVisibility({ checkVisibilityCSS: true })) { return false; }
    const bounds = task.input.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  setChecked(line: number, checked: boolean, focus = false): boolean {
    const task = this.active.get(line);
    if (!task) { return false; }
    const restore = (): void => { task.input.checked = task.checked; };
    if (!this.available(task) || task.input.disabled) { restore(); return false; }
    const plan = planReadingTaskToggle(this.inventory.source, task, checked, focus);
    if (!plan) { restore(); return false; }
    this.committing = true;
    try {
      if (!this.context.commit(plan)) { this.committing = false; restore(); this.refresh(); return false; }
      this.dispose(); return true;
    } catch (error) {
      this.committing = false; restore(); this.refresh();
      if (this.context.onError) { this.context.onError(error); return false; }
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true; this.observer.disconnect();
    for (const task of this.active.values()) {
      const listener = this.listeners.get(task); if (listener) { task.input.removeEventListener("change", listener); }
      task.input.disabled = true; task.input.checked = task.checked;
      if (task.input.dataset.readingTaskLine === String(task.line)) { delete task.input.dataset.readingTaskLine; }
      if (task.input.getAttribute("aria-label") === this.labels.get(task)) {
        const original = this.originalLabels.get(task); if (original === null || original === undefined) { task.input.removeAttribute("aria-label"); } else { task.input.setAttribute("aria-label", original); }
      }
    }
    this.active.clear(); this.listeners.clear(); this.originalLabels.clear(); this.labels.clear();
  }
}
