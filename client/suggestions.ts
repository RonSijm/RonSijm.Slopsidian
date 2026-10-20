import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import type { Text } from "@codemirror/state";
import type { App } from "./app";
import type { Editor, EditorPosition } from "./editor";
import type { MarkdownView } from "./workspace";
import type { TFile } from "./vault";
import { reportError } from "./dom";
import { Modal, Scope } from "./ui";
import type { EventRef } from "./events";

export interface Instruction { command: string; purpose: string }
export interface SearchResult { score: number; matches: [number, number][] }
export interface FuzzyMatch<T> { item: T; match: SearchResult }
type SuggestionEvent = MouseEvent | KeyboardEvent;

export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
  const needle = query.toLowerCase();
  return text => {
    if (!needle) { return { score: 0, matches: [] }; }
    let folded = "";
    const positions: [number, number][] = [];
    let offset = 0;
    for (const point of text) {
      const lower = point.toLowerCase();
      folded += lower;
      for (let index = 0; index < lower.length; index++) { positions.push([offset, offset + point.length]); }
      offset += point.length;
    }
    const contiguous = folded.indexOf(needle);
    const found: number[] = [];
    let next = 0;
    for (let index = 0; index < needle.length; index++) {
      const position = contiguous >= 0 ? contiguous + index : folded.indexOf(needle[index], next);
      if (position < 0) { return null; }
      found.push(position);
      next = position + 1;
    }
    const matches: [number, number][] = [];
    for (const position of found) {
      const range = positions[position];
      const previous = matches.at(-1);
      if (previous && range[0] <= previous[1]) { previous[1] = Math.max(previous[1], range[1]); }
      else { matches.push([...range]); }
    }
    const gaps = found.at(-1)! - found[0] + 1 - needle.length;
    return { score: 1000 - found[0] * 4 - gaps * 8 - (folded.length - needle.length), matches };
  };
}

function instructions(element: HTMLElement, values: readonly Instruction[]): void {
  element.replaceChildren();
  for (const instruction of values) {
    const row = document.createElement("div");
    const command = document.createElement("span");
    command.className = "prompt-instruction-command";
    command.textContent = instruction.command;
    row.append(command, document.createTextNode(instruction.purpose));
    element.appendChild(row);
  }
  element.hidden = !values.length;
}

class SuggestionList<T> {
  private values: T[] = [];
  private selected = 0;
  private generation = 0;
  private readonly id = `suggestions-${crypto.randomUUID()}`;

  constructor(readonly element: HTMLElement, scope: Scope, private readonly render: (value: T, element: HTMLElement) => void, private readonly choose: (value: T, event: SuggestionEvent) => unknown, private readonly current: () => boolean, private readonly input: HTMLElement | null = null) {
    element.classList.add("suggestion-results");
    element.id = this.id;
    element.setAttribute("role", "listbox");
    for (const [key, direction] of [["ArrowDown", 1], ["ArrowUp", -1]] as const) {
      scope.register([], key, () => {
        if (!this.current() || !this.values.length) { return; }
        this.select((this.selected + direction + this.values.length) % this.values.length);
        return false;
      });
    }
    for (const key of ["Enter", "Tab"]) {
      scope.register([], key, event => {
        if (this.accept(event)) { return false; }
      });
    }
  }

  clear(): void {
    this.generation++;
    this.values = [];
    this.element.replaceChildren();
    this.input?.removeAttribute("aria-activedescendant");
  }

  show(values: T[], limit: number): void {
    if (!Array.isArray(values) || !Number.isInteger(limit) || limit < 0 || limit > 10000) {
      throw new Error("Suggestions require an array and an integer limit between zero and 10000.");
    }
    this.clear();
    this.values = values.slice(0, limit);
    const generation = this.generation;
    this.values.forEach((value, index) => {
      const row = document.createElement("div");
      row.className = "suggestion-item";
      row.dataset.suggestionIndex = String(index);
      row.id = `${this.id}-${index}`;
      row.setAttribute("role", "option");
      this.render(value, row);
      row.addEventListener("mousedown", event => event.preventDefault());
      row.addEventListener("mouseenter", () => {
        if (generation === this.generation && this.current()) { this.select(index); }
      });
      row.addEventListener("click", event => {
        if (generation === this.generation && row.parentElement === this.element && this.current()) {
          this.select(index);
          this.accept(event);
        }
      });
      this.element.appendChild(row);
    });
    this.select(0);
  }

  accept(event: SuggestionEvent): boolean {
    if (!this.current() || !this.values.length) { return false; }
    try { Promise.resolve(this.choose(this.values[this.selected], event)).catch(reportError); }
    catch (error) { reportError(error); }
    return true;
  }

  private select(index: number): void {
    this.selected = index;
    [...this.element.children].forEach((row, rowIndex) => {
      row.classList.toggle("is-selected", rowIndex === index);
      row.setAttribute("aria-selected", String(rowIndex === index));
    });
    const row = this.element.children[index];
    if (row instanceof HTMLElement) {
      this.input?.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    }
  }
}

export abstract class SuggestModal<T> extends Modal {
  limit = 100;
  emptyStateText = "No suggestions found.";
  readonly inputEl = document.createElement("input");
  readonly resultContainerEl = document.createElement("div");
  private readonly instructionsEl = document.createElement("div");
  private readonly list: SuggestionList<T>;
  private revision = 0;
  private root: string | null = null;
  private layout: EventRef | null = null;

  constructor(app: App) {
    super(app);
    this.modalEl.classList.add("suggest-modal");
    this.inputEl.className = "prompt-input";
    this.inputEl.setAttribute("aria-label", "Search suggestions");
    this.inputEl.autocomplete = "off";
    this.instructionsEl.className = "prompt-instructions";
    this.instructionsEl.hidden = true;
    this.contentEl.append(this.inputEl, this.resultContainerEl, this.instructionsEl);
    this.list = new SuggestionList(this.resultContainerEl, this.scope, (value, element) => this.renderSuggestion(value, element), (value, event) => this.selectSuggestion(value, event), () => this.current(), this.inputEl);
    this.inputEl.addEventListener("input", () => { this.refresh().catch(reportError); });
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, element: HTMLElement): void;
  abstract onChooseSuggestion(value: T, event: SuggestionEvent): unknown;
  setPlaceholder(value: string): void { this.inputEl.placeholder = value; }
  setInstructions(values: Instruction[]): void { instructions(this.instructionsEl, values); }
  onNoSuggestion(): void { this.resultContainerEl.textContent = this.emptyStateText; }
  selectActiveSuggestion(event: SuggestionEvent): void { this.list.accept(event); }

  selectSuggestion(value: T, event: SuggestionEvent): void {
    if (!this.current()) { return; }
    this.close();
    Promise.resolve(this.onChooseSuggestion(value, event)).catch(reportError);
  }

  override open(): void {
    if (this.isOpen) { return; }
    this.inputEl.value = "";
    this.root = this.app.vault.rootPath;
    this.layout = this.app.workspace.on("layout-change", () => { if (!this.current()) { this.close(); } });
    super.open();
    this.inputEl.focus();
    this.refresh().catch(reportError);
  }

  override close(): void {
    this.revision++;
    this.list.clear();
    if (this.layout) { this.app.workspace.offref(this.layout); }
    this.layout = null;
    this.root = null;
    super.close();
  }

  private current(): boolean { return this.isOpen && !this.app.changingVault && this.root === this.app.vault.rootPath; }

  private async refresh(): Promise<void> {
    if (!this.isOpen) { return; }
    const revision = ++this.revision;
    const root = this.app.vault.rootPath;
    const query = this.inputEl.value;
    this.list.clear();
    this.resultContainerEl.setAttribute("aria-busy", "true");
    try {
      const values = await this.getSuggestions(query);
      if (!this.isOpen || revision !== this.revision || root !== this.app.vault.rootPath || this.app.changingVault || this.inputEl.value !== query) { return; }
      this.list.show(values, this.limit);
      if (!this.resultContainerEl.children.length) { this.onNoSuggestion(); }
    } catch (error) {
      if (revision === this.revision && this.current()) { this.list.clear(); reportError(error); }
    } finally {
      if (revision === this.revision) { this.resultContainerEl.removeAttribute("aria-busy"); }
    }
  }
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, event: SuggestionEvent): unknown;

  getSuggestions(query: string): FuzzyMatch<T>[] {
    const search = prepareFuzzySearch(query);
    return this.getItems().flatMap(item => {
      const match = search(this.getItemText(item));
      return match ? [{ item, match }] : [];
    }).sort((left, right) => right.match.score - left.match.score);
  }

  renderSuggestion(value: FuzzyMatch<T>, element: HTMLElement): void {
    const text = this.getItemText(value.item);
    let offset = 0;
    for (const [from, to] of value.match.matches) {
      element.append(document.createTextNode(text.slice(offset, from)));
      const highlight = document.createElement("span");
      highlight.className = "suggestion-highlight";
      highlight.textContent = text.slice(from, to);
      element.appendChild(highlight);
      offset = to;
    }
    element.append(document.createTextNode(text.slice(offset)));
  }

  onChooseSuggestion(value: FuzzyMatch<T>, event: SuggestionEvent): unknown { return this.onChooseItem(value.item, event); }
}

export abstract class PopoverSuggest<T> {
  readonly containerEl = document.createElement("div");
  readonly scope: Scope;
  protected readonly resultContainerEl = document.createElement("div");
  protected readonly list: SuggestionList<T>;
  protected revision = 0;
  private events: AbortController | null = null;
  private observer: MutationObserver | null = null;
  private readonly instructionsEl = document.createElement("div");

  constructor(readonly app: App, parentScope?: Scope) {
    this.scope = new Scope(parentScope);
    this.containerEl.className = "suggestion-container suggestion-popover";
    this.containerEl.popover = "manual";
    this.instructionsEl.className = "prompt-instructions";
    this.instructionsEl.hidden = true;
    this.containerEl.append(this.resultContainerEl, this.instructionsEl);
    this.list = new SuggestionList(this.resultContainerEl, this.scope, (value, element) => this.renderSuggestion(value, element), (value, event) => this.choose(value, event), () => this.isOpen && this.isCurrent());
    this.scope.register([], "Escape", () => { this.close(); return false; });
  }

  get isOpen(): boolean { return this.events !== null; }
  abstract renderSuggestion(value: T, element: HTMLElement): void;
  abstract selectSuggestion(value: T, event: SuggestionEvent): unknown;
  onHistoryBack(): void { this.close(); }
  setInstructions(values: Instruction[]): void { instructions(this.instructionsEl, values); }
  protected isCurrent(): boolean { return !this.app.changingVault; }
  protected anchor(): DOMRect | null { return null; }
  protected ownsTarget(target: Node): boolean { return this.containerEl.contains(target); }
  protected choose(value: T, event: SuggestionEvent): unknown { return this.selectSuggestion(value, event); }

  open(): void {
    this.attachPopup();
  }

  private attachPopup(): void {
    if (this.isOpen || !this.isCurrent()) { return; }
    if (!this.anchor()) { throw new Error("A suggestion popover needs a connected input or editor anchor."); }
    const events = new AbortController();
    this.events = events;
    document.body.appendChild(this.containerEl);
    this.containerEl.showPopover();
    window.addEventListener("keydown", event => {
      if (!this.isCurrent()) { this.close(); return; }
      try { this.scope.handle(event); } catch (error) { this.close(); reportError(error); }
    }, { capture: true, signal: events.signal });
    window.addEventListener("pointerdown", event => {
      if (!(event.target instanceof Node) || !this.ownsTarget(event.target)) { this.close(); }
    }, { capture: true, signal: events.signal });
    for (const name of ["resize", "scroll"]) {
      window.addEventListener(name, () => this.position(), { capture: true, signal: events.signal });
    }
    this.observer = new MutationObserver(() => { if (!this.isCurrent()) { this.close(); } });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.position();
  }

  close(): void {
    this.revision++;
    this.events?.abort();
    this.events = null;
    this.observer?.disconnect();
    this.observer = null;
    this.list.clear();
    if (this.containerEl.matches(":popover-open")) { this.containerEl.hidePopover(); }
    this.containerEl.remove();
  }

  protected async populate(get: () => T[] | Promise<T[]>, limit: number, current: () => boolean): Promise<void> {
    const revision = ++this.revision;
    this.list.clear();
    try {
      const values = await get();
      if (revision !== this.revision || !current() || !this.isCurrent()) { return; }
      this.list.show(values, limit);
      if (!this.resultContainerEl.children.length) { this.close(); return; }
      this.attachPopup();
      this.position();
    } catch (error) {
      if (revision === this.revision) { this.close(); reportError(error); }
    }
  }

  private position(): void {
    if (!this.isOpen) { return; }
    const bounds = this.anchor();
    if (!this.isCurrent() || !bounds || bounds.bottom < 0 || bounds.top > innerHeight || bounds.right < 0 || bounds.left > innerWidth) { this.close(); return; }
    const width = this.containerEl.getBoundingClientRect().width;
    const height = this.containerEl.getBoundingClientRect().height;
    this.containerEl.style.left = Math.max(8, Math.min(bounds.left, innerWidth - width - 8)) + "px";
    this.containerEl.style.top = Math.max(8, bounds.bottom + 4 + height <= innerHeight - 8 ? bounds.bottom + 4 : bounds.top - height - 4) + "px";
  }
}

export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
  limit = 100;
  private root: string | null = null;
  private callback: ((value: T, event: SuggestionEvent) => unknown) | null = null;

  constructor(app: App, protected readonly textInputEl: HTMLInputElement | HTMLDivElement) {
    super(app);
    textInputEl.addEventListener("focus", () => this.open());
    textInputEl.addEventListener("input", () => this.open());
    textInputEl.addEventListener("blur", () => this.close());
  }

  protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
  setValue(value: string): void {
    if (this.textInputEl instanceof HTMLInputElement) { this.textInputEl.value = value; }
    else { this.textInputEl.textContent = value; }
  }
  getValue(): string { return this.textInputEl instanceof HTMLInputElement ? this.textInputEl.value : this.textInputEl.textContent ?? ""; }
  onSelect(callback: (value: T, event: SuggestionEvent) => unknown): this { this.callback = callback; return this; }
  selectSuggestion(value: T, event: SuggestionEvent): unknown { return this.callback?.(value, event); }
  protected override anchor(): DOMRect { return this.textInputEl.getBoundingClientRect(); }
  protected override ownsTarget(target: Node): boolean { return super.ownsTarget(target) || this.textInputEl.contains(target); }
  protected override isCurrent(): boolean { return super.isCurrent() && this.textInputEl.isConnected && document.activeElement === this.textInputEl && this.root === this.app.vault.rootPath; }

  override open(): void {
    if (this.limit === 0) { this.close(); return; }
    if (!this.textInputEl.isConnected || document.activeElement !== this.textInputEl || this.app.changingVault) { return; }
    this.root = this.app.vault.rootPath;
    const query = this.getValue();
    this.populate(() => this.getSuggestions(query), this.limit, () => this.getValue() === query).catch(reportError);
  }

  protected override choose(value: T, event: SuggestionEvent): unknown {
    const result = this.selectSuggestion(value, event);
    this.close();
    return result;
  }
}

export interface EditorSuggestTriggerInfo { start: EditorPosition; end: EditorPosition; query: string }
export interface EditorSuggestContext extends EditorSuggestTriggerInfo { editor: Editor; file: TFile }

export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  context: EditorSuggestContext | null = null;
  limit = 100;
  private origin: MarkdownView | null = null;
  private root: string | null = null;
  private path = "";
  private document: Text | null = null;
  private cursor = -1;
  private suppressed: { editor: Editor; document: Text; cursor: number } | null = null;

  abstract onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null;
  abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>;

  trigger(view: MarkdownView): boolean {
    const editor = view.editor;
    const selection = editor.cm.state.selection;
    if (!view.file || !selection.main.empty || selection.ranges.length !== 1 || !editor.cm.hasFocus || this.app.changingVault || this.app.workspace.isChangingFiles) { this.close(); return false; }
    if (this.suppressed?.editor === editor && this.suppressed.document === editor.cm.state.doc && this.suppressed.cursor === selection.main.head) { return false; }
    if (this.context?.editor === editor && this.document === editor.cm.state.doc && this.cursor === selection.main.head && this.isCurrent()) { return true; }
    const trigger = this.onTrigger(editor.getCursor(), editor, view.file);
    if (!trigger) { this.close(); return false; }
    const validPosition = (position: EditorPosition): boolean => Boolean(position && Number.isInteger(position.line) && position.line >= 0 && position.line < editor.lineCount() && Number.isInteger(position.ch) && position.ch >= 0 && position.ch <= editor.getLine(position.line).length);
    if (typeof trigger.query !== "string" || !validPosition(trigger.start) || !validPosition(trigger.end) || editor.posToOffset(trigger.start) > editor.posToOffset(trigger.end)) {
      throw new Error("Editor suggestion triggers require valid ordered source positions and a string query.");
    }
    const context = { start: { ...trigger.start }, end: { ...trigger.end }, query: trigger.query, editor, file: view.file };
    this.context = context;
    this.origin = view;
    this.root = this.app.vault.rootPath;
    this.path = view.file.path;
    this.document = editor.cm.state.doc;
    this.cursor = selection.main.head;
    this.populate(() => this.getSuggestions(context), this.limit, () => this.context === context).catch(reportError);
    return true;
  }

  protected override isCurrent(): boolean {
    const context = this.context;
    return super.isCurrent() && !this.app.workspace.isChangingFiles && Boolean(context && this.origin && this.app.workspace.activeEditor === this.origin && this.origin.file === context.file && context.file.path === this.path && this.root === this.app.vault.rootPath && context.editor.cm.hasFocus && context.editor.cm.state.doc === this.document && context.editor.cm.state.selection.main.head === this.cursor);
  }

  protected override anchor(): DOMRect | null {
    if (!this.context) { return null; }
    const bounds = this.context.editor.cm.coordsAtPos(this.context.editor.posToOffset(this.context.start));
    return bounds ? new DOMRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top) : null;
  }
  protected override ownsTarget(target: Node): boolean { return super.ownsTarget(target) || Boolean(this.origin?.editor.cm.dom.contains(target)); }

  protected override choose(value: T, event: SuggestionEvent): unknown {
    if (!this.isCurrent() || !this.context) { return; }
    const editor = this.context.editor;
    editor.cm.dispatch({ annotations: isolateHistory.of("before") });
    try { return this.selectSuggestion(value, event); }
    finally {
      if (editor.cm.dom.isConnected) { editor.cm.dispatch({ annotations: isolateHistory.of("after") }); }
      this.suppressed = { editor, document: editor.cm.state.doc, cursor: editor.cm.state.selection.main.head };
      this.close();
    }
  }

  override close(): void {
    super.close();
    this.context = null;
    this.origin = null;
    this.document = null;
  }
}

interface RegisteredSuggestion { instance: object; trigger: (view: MarkdownView) => boolean; close: () => void; current: () => boolean }

export class EditorSuggestions {
  private readonly registrations: RegisteredSuggestion[] = [];
  private readonly extensionId = "slopsidian:plugin-suggestions";
  private queued = false;

  constructor(private readonly app: App) {
    for (const name of ["active-leaf-change", "layout-change", "file-open"]) {
      app.workspace.on(name, () => {
        for (const registration of this.registrations) { if (!registration.current()) { registration.close(); } }
      });
    }
  }

  register<T>(owner: string, suggestion: EditorSuggest<T>): () => void {
    if (!(suggestion instanceof EditorSuggest) || suggestion.app !== this.app || this.registrations.some(registration => registration.instance === suggestion)) {
      throw new Error("Register a distinct EditorSuggest from this application's shared API.");
    }
    suggestion.containerEl.dataset.pluginSuggest = owner;
    const registration = { instance: suggestion, trigger: (view: MarkdownView) => suggestion.trigger(view), close: () => suggestion.close(), current: () => Boolean(suggestion.context && this.app.workspace.activeEditor?.editor === suggestion.context.editor) };
    this.registrations.push(registration);
    if (this.registrations.length === 1) {
      this.app.workspace.addEditorExtension(this.extensionId, EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet || update.focusChanged) { this.schedule(); }
      }));
    }
    return () => {
      registration.close();
      const index = this.registrations.indexOf(registration);
      if (index >= 0) { this.registrations.splice(index, 1); }
      if (!this.registrations.length) { this.app.workspace.removeEditorExtensions(this.extensionId); }
    };
  }

  private schedule(): void {
    if (this.queued) { return; }
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const view = this.app.workspace.activeEditor;
      let triggered = false;
      for (const registration of [...this.registrations]) {
        if (!view || triggered) { registration.close(); continue; }
        try { triggered = registration.trigger(view); }
        catch (error) { registration.close(); reportError(error); }
      }
    });
  }
}
