import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { Annotation, EditorSelection, EditorState, Prec, StateEffect, StateField, Text, type ChangeDesc, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state";
import { closeSearchPanel as closeNativeSearchPanel, findNext as nextMatch, findPrevious as previousMatch, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchPanelOpen, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorView, keymap, runScopeHandlers, type Panel, type ViewUpdate } from "@codemirror/view";

import { REGEX_SUBSET_MESSAGE, regexSearchValidation } from "./search-pattern";
export { MAX_REGEX_SOURCE, regexSearchValidation } from "./search-pattern";

const replaceMode = StateEffect.define<boolean>();
const replaceModeField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) { for (const effect of transaction.effects) { if (effect.is(replaceMode)) { value = effect.value; } } return value; },
});

export const MAX_SELECTION_SEARCH_RANGES = 64;
export const MAX_SELECTION_SEARCH_CHARACTERS = 262_144;
export const MAX_SELECTION_SEARCH_SOURCE = 1_048_576;
export interface SelectionSearchRange { readonly from: number; readonly to: number }
export interface SelectionSearchScope {
  readonly from: number;
  readonly to: number;
  readonly enabled: boolean;
  readonly stale: boolean;
  /** Omitted for the original single-range shape; bounds alone are never a multi-range union. */
  readonly ranges?: readonly SelectionSearchRange[];
}

export function selectionSearchRanges(scope: SelectionSearchScope): readonly SelectionSearchRange[] { return scope.ranges ?? [{ from: scope.from, to: scope.to }]; }

/** Adjacent or overlapping selections describe one contiguous source region. Empty carets do not add text. */
function normalizedRanges(ranges: readonly SelectionSearchRange[]): SelectionSearchRange[] {
  const result: { from: number; to: number }[] = [];
  for (const range of [...ranges].filter(range => range.from < range.to).sort((left, right) => left.from - right.from || left.to - right.to)) {
    const previous = result.at(-1);
    if (previous && range.from <= previous.to) { previous.to = Math.max(previous.to, range.to); }
    else { result.push({ from: range.from, to: range.to }); }
  }
  return result;
}

function scopeWithRanges(scope: SelectionSearchScope, ranges: readonly SelectionSearchRange[]): SelectionSearchScope {
  const normalized = normalizedRanges(ranges), fallback = Math.min(ranges[0]?.from ?? scope.from, ranges[0]?.to ?? scope.from);
  return { from: normalized[0]?.from ?? fallback, to: normalized.at(-1)?.to ?? fallback, enabled: scope.enabled,
    stale: scope.stale || !normalized.length, ...(normalized.length > 1 || scope.ranges ? { ranges: normalized } : {}) };
}

function mappedScope(scope: SelectionSearchScope, changes: ChangeDesc, owned: boolean): SelectionSearchScope {
  return scopeWithRanges(scope, selectionSearchRanges(scope).map(range => ({ from: changes.mapPos(range.from, owned ? -1 : 1), to: changes.mapPos(range.to, owned ? 1 : -1) })));
}

function scopeOverLimit(scope: SelectionSearchScope, sourceLength: number): boolean {
  const ranges = selectionSearchRanges(scope);
  return sourceLength > MAX_SELECTION_SEARCH_SOURCE || ranges.length > MAX_SELECTION_SEARCH_RANGES
    || ranges.reduce((total, range) => total + range.to - range.from, 0) > MAX_SELECTION_SEARCH_CHARACTERS;
}

function containsMatch(scope: SelectionSearchScope, from: number, to: number): boolean {
  if (!scope.ranges) { return scope.from <= from && scope.to >= to; }
  let low = 0, high = scope.ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (scope.ranges[middle].from <= from) { low = middle + 1; } else { high = middle; }
  }
  const range = scope.ranges[low - 1];
  return Boolean(range && to <= range.to);
}
interface SelectionScopeRecord { scope: SelectionSearchScope | null; session: number }
let selectionScopeSession = 0;
const captureSelectionScope = StateEffect.define<SelectionScopeRecord>();
const enableSelectionScope = StateEffect.define<{ enabled: boolean; session: number }>();
const restoreSelectionScope = StateEffect.define<SelectionScopeRecord>({
  map: (record, changes) => record.scope ? { ...record, scope: mappedScope(record.scope, changes, true) } : record,
});
const scopedReplacement = Annotation.define<boolean>();

function updateSelectionScope(record: SelectionScopeRecord, transaction: Transaction): SelectionScopeRecord {
  let { scope, session } = record;
  if (scope && transaction.docChanged) {
    let touched = false;
    transaction.changes.iterChangedRanges((from, to) => {
      if (selectionSearchRanges(scope!).some(range => from === to ? from > range.from && from < range.to : from < range.to && to > range.from)) { touched = true; }
    });
    const owned = transaction.annotation(scopedReplacement) === true;
    scope = mappedScope({ ...scope, stale: scope.stale || touched && !owned }, transaction.changes, owned);
  }
  for (const effect of transaction.effects) {
    if (effect.is(captureSelectionScope)) { scope = effect.value.scope; session = effect.value.session; }
    // Closing Find or explicitly capturing another selection revokes older
    // history capabilities. Undo must never resurrect that hidden old range.
    else if (effect.is(restoreSelectionScope) && effect.value.session === session) { scope = effect.value.scope; }
    else if (effect.is(enableSelectionScope) && scope) { scope = { ...scope, enabled: effect.value.enabled }; session = effect.value.session; }
  }
  if (scope && scopeOverLimit(scope, transaction.newDoc.length)) { scope = { ...scope, stale: true }; }
  return scope === record.scope && session === record.session ? record : { scope, session };
}

const selectionScopeField = StateField.define<SelectionScopeRecord>({
  create: () => ({ scope: null, session: 0 }),
  update: updateSelectionScope,
});
// Undo restores the scope that belonged to the restored source, including after
// an ordinary edit invalidated it. Navigation selections never become the scope.
const selectionScopeHistory = invertedEffects.of(transaction => transaction.docChanged && transaction.startState.field(selectionScopeField, false)?.scope
  ? [restoreSelectionScope.of(transaction.startState.field(selectionScopeField))] : []);

export function searchSelectionScope(state: EditorState): SelectionSearchScope | null { return state.field(selectionScopeField, false)?.scope ?? null; }
function captureScopeEffect(scope: SelectionSearchScope | null): StateEffect<SelectionScopeRecord> { return captureSelectionScope.of({ scope, session: ++selectionScopeSession }); }
function selectedScope(state: EditorState, enabled: boolean): SelectionSearchScope | null {
  if (selectionScopeRefusal(state)) { return null; }
  const ranges = normalizedRanges(state.selection.ranges);
  return ranges.length ? { from: ranges[0].from, to: ranges.at(-1)!.to, enabled, stale: false, ...(ranges.length > 1 ? { ranges } : {}) } : null;
}
function selectionScopeRefusal(state: EditorState): string | null {
  if (!state.selection.ranges.some(range => !range.empty)) { return null; }
  if (state.selection.ranges.length > MAX_SELECTION_SEARCH_RANGES) { return `In selection supports up to ${MAX_SELECTION_SEARCH_RANGES} source ranges.`; }
  if (state.doc.length > MAX_SELECTION_SEARCH_SOURCE) { return "In selection supports notes up to 1,048,576 source characters."; }
  if (state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0) > MAX_SELECTION_SEARCH_CHARACTERS) { return "In selection supports up to 262,144 selected source characters."; }
  return null;
}
/** Explicitly capture the source-selection union; query navigation never recaptures it. */
export function captureSearchSelection(view: EditorView, enabled = true): boolean {
  const scope = selectedScope(view.state, enabled);
  if (!scope) { return false; }
  view.dispatch({ effects: captureScopeEffect(scope) }); return true;
}
export function setSearchSelectionEnabled(view: EditorView, enabled: boolean): boolean {
  const scope = searchSelectionScope(view.state);
  if (!scope || enabled && (scope.stale || scope.from >= scope.to)) { return false; }
  view.dispatch({ effects: enableSelectionScope.of({ enabled, session: ++selectionScopeSession }) }); return true;
}

const MAX_COUNTED_MATCHES = 10_000;
export const MAX_REPLACE_MATCHES = 100_000;
/** Retains rejected input for the panel while exposing an invalid empty query to CodeMirror's matcher. */
export class EditorSearchQuery extends SearchQuery {
  readonly input: SearchQuery;
  readonly validationMessage: string | null;
  constructor(config: ConstructorParameters<typeof SearchQuery>[0] | SearchQuery, scope: SelectionSearchScope | null = null) {
    const input = config instanceof EditorSearchQuery ? config.input : config instanceof SearchQuery ? config : new SearchQuery(config);
    const message = (input.regexp ? regexSearchValidation(input.search) : null) || (scope?.enabled && scope.stale
      ? "The selected source changed or exceeded its search limits. Use current selection to choose new ranges, or turn off In selection." : null);
    const test = scope?.enabled ? (match: string, state: EditorState, from: number, to: number): boolean => {
      const current = searchSelectionScope(state);
      return Boolean(current?.enabled && !current.stale && containsMatch(current, from, to) && (!input.test || input.test(match, state, from, to)));
    } : input.test;
    super(message ? { ...input, search: "", regexp: false } : { ...input, test });
    this.input = input; this.validationMessage = message;
  }
}

function searchInput(state: EditorState): SearchQuery {
  const query = getSearchQuery(state);
  return query instanceof EditorSearchQuery ? query.input : query;
}

// Extenders run even for filter:false transactions. The guarded query is the final
// setSearchQuery effect, so native decoration/count cursors never receive rejected input.
const validateSearchQueries = Prec.highest(EditorState.transactionExtender.of(transaction => {
  let last: SearchQuery | null = null;
  for (const effect of transaction.effects) { if (effect.is(setSearchQuery)) { last = effect.value; } }
  const oldScope = transaction.startState.field(selectionScopeField), scope = updateSelectionScope(oldScope, transaction);
  return last || oldScope !== scope ? { effects: setSearchQuery.of(new EditorSearchQuery(last ?? getSearchQuery(transaction.startState), scope.scope)) } : null;
}));

export function findNext(view: EditorView): boolean {
  return getSearchQuery(view.state).valid ? nextMatch(view) : searchPanelOpen(view.state) ? false : showEditorSearch(view);
}
export function findPrevious(view: EditorView): boolean {
  return getSearchQuery(view.state).valid ? previousMatch(view) : searchPanelOpen(view.state) ? false : showEditorSearch(view);
}

export function canReplaceInEditor(view: EditorView, allowed: () => boolean = () => true): boolean {
  return !view.composing && !view.state.readOnly && view.state.facet(EditorView.editable) && allowed();
}

/** Normalize inserted line separators and make each explicit replace action one isolated Undo step. */
export function searchReplacement(state: EditorState, spec: TransactionSpec): TransactionSpec {
  const original = state.changes(spec.changes), edits: { from: number; to: number; insert: Text }[] = [];
  original.iterChanges((from, to, _newFrom, _newTo, insert) => {
    edits.push({ from, to, insert: Text.of(insert.toString().split(/\r\n?|\n/)) });
  });
  const changes = state.changes(edits), mapping = original.invertedDesc.composeDesc(changes.desc);
  const selection = spec.selection instanceof EditorSelection ? spec.selection : spec.selection
    ? EditorSelection.single(spec.selection.anchor, spec.selection.head ?? spec.selection.anchor) : undefined;
  const effects = spec.effects ? Array.isArray(spec.effects) ? spec.effects : [spec.effects] : [];
  const annotations = spec.annotations ? Array.isArray(spec.annotations) ? spec.annotations : [spec.annotations] : [];
  return {
    ...spec, changes,
    ...(selection ? { selection: selection.map(mapping) } : {}),
    effects: StateEffect.mapEffects(effects, mapping),
    annotations: [...annotations, isolateHistory.of("full")],
  };
}

/** Uses CodeMirror's matching/replacement grammar, with the application's write and line-ending policy. */
export function replaceEditorMatch(view: EditorView, all = false, allowed: () => boolean = () => true): boolean {
  if (!canReplaceInEditor(view, allowed)) { return false; }
  const query = getSearchQuery(view.state);
  if (!query.valid) { return false; }
  if (all) {
    const cursor = query.getCursor(view.state);
    for (let count = 0; !cursor.next().done; count++) { if (count >= MAX_REPLACE_MATCHES) { return false; } }
  }
  // Commands remain synchronous and use the actual view for every operation.
  // Only their change specification is adapted, before the real view dispatch.
  let refused = false;
  const target = new Proxy(view, {
    get(original, property) {
      if (property === "dispatch") { return (spec: TransactionSpec) => {
        const replacement = searchReplacement(original.state, spec), scope = searchSelectionScope(original.state);
        if (scope?.enabled) {
          let contained = !scope.stale;
          const changes = original.state.changes(replacement.changes);
          changes.iterChangedRanges((from, to) => { if (!containsMatch(scope, from, to)) { contained = false; } });
          if (!contained || scopeOverLimit(mappedScope(scope, changes, true), changes.newLength)) { refused = true; return; }
          const annotations = replacement.annotations ? Array.isArray(replacement.annotations) ? replacement.annotations : [replacement.annotations] : [];
          replacement.annotations = [...annotations, scopedReplacement.of(true)];
        }
        original.dispatch(replacement);
      }; }
      const value: unknown = Reflect.get(original, property, original);
      return typeof value === "function" ? value.bind(original) : value;
    },
  });
  return (all ? replaceAll : replaceNext)(target) && !refused;
}

function selectedQuery(view: EditorView): SearchQuery | null {
  const selected = view.state.selection.main;
  if (view.state.selection.ranges.length !== 1 || selected.empty || selected.to - selected.from > 1000) { return null; }
  const previous = searchInput(view.state);
  const value = view.state.doc.sliceString(selected.from, selected.to, "\n");
  return new EditorSearchQuery({
    search: value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t"),
    replace: previous.replace, caseSensitive: previous.caseSensitive, wholeWord: previous.wholeWord, literal: false, regexp: false,
  });
}

export function showEditorSearch(view: EditorView, replace = false): boolean {
  // CodeMirror's native panel seeds from selection.main. A union has no single
  // query string, so explicitly retain the prior query after opening that panel.
  const query = selectedQuery(view) ?? (view.state.selection.ranges.length > 1 ? searchInput(view.state) : null);
  const capture = !searchPanelOpen(view.state), scope = selectedScope(view.state, false);
  openSearchPanel(view);
  view.dispatch({ effects: [...(query ? [setSearchQuery.of(query)] : []), ...(capture ? [captureScopeEffect(scope)] : []), replaceMode.of(replace)] });
  const field = view.dom.querySelector<HTMLInputElement>(replace ? "[data-editor-search-replace]" : "[data-editor-search-query]");
  if (field && !field.disabled) { field.focus(); field.select(); }
  return true;
}

export function closeSearchPanel(view: EditorView): boolean {
  const closed = closeNativeSearchPanel(view);
  if (closed && searchSelectionScope(view.state)) { view.dispatch({ effects: captureScopeEffect(null) }); }
  return closed;
}

class EditorSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private readonly query: HTMLInputElement;
  private readonly replacement: HTMLInputElement;
  private readonly caseSensitive: HTMLInputElement;
  private readonly regexp: HTMLInputElement;
  private readonly wholeWord: HTMLInputElement;
  private readonly inSelection: HTMLInputElement;
  private readonly captureSelection: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly replacementRow: HTMLElement;
  private readonly replaceToggle: HTMLButtonElement;
  private readonly replaceButton: HTMLButtonElement;
  private readonly replaceAllButton: HTMLButtonElement;
  private current: SearchQuery;

  constructor(private readonly view: EditorView, private readonly allowed: () => boolean) {
    const doc = view.dom.ownerDocument;
    this.current = searchInput(view.state);
    this.dom = doc.createElement("div"); this.dom.className = "cm-search slopsidian-editor-search"; this.dom.dataset.editorSearch = "true";
    this.dom.setAttribute("role", "search"); this.dom.setAttribute("aria-label", "Find in current note");
    const input = (name: string, placeholder: string): HTMLInputElement => {
      const field = doc.createElement("input"); field.type = "text"; field.name = name; field.placeholder = placeholder;
      field.className = "cm-textfield"; field.setAttribute("aria-label", placeholder); field.autocomplete = "off"; field.spellcheck = false;
      field.addEventListener("input", () => this.commit()); return field;
    };
    const button = (name: string, text: string, action: () => unknown): HTMLButtonElement => {
      const control = doc.createElement("button"); control.type = "button"; control.name = name; control.className = "cm-button";
      control.textContent = text; control.addEventListener("click", () => { if (this.dom.isConnected) { action(); } }); return control;
    };
    const checkbox = (name: string, labelText: string): HTMLInputElement => {
      const field = doc.createElement("input"), label = doc.createElement("label"); field.type = "checkbox"; field.name = name;
      field.addEventListener("change", () => this.commit()); label.append(field, doc.createTextNode(labelText)); options.append(label); return field;
    };
    const firstRow = doc.createElement("div"); firstRow.className = "editor-search-row";
    this.query = input("search", "Find in note"); this.query.dataset.editorSearchQuery = "true"; this.query.setAttribute("main-field", "true");
    this.replaceToggle = button("show-replace", "Replace", () => this.view.dispatch({ effects: replaceMode.of(!this.view.state.field(replaceModeField)) }));
    firstRow.append(this.query, button("previous", "Previous", () => findPrevious(view)), button("next", "Next", () => findNext(view)), this.replaceToggle,
      button("close", "Close", () => closeSearchPanel(view)));
    const options = doc.createElement("div"); options.className = "editor-search-options";
    this.caseSensitive = checkbox("case", "Match case"); this.regexp = checkbox("regexp", "Fixed-width regex"); this.wholeWord = checkbox("word", "Whole word");
    this.regexp.title = REGEX_SUBSET_MESSAGE;
    this.inSelection = doc.createElement("input"); this.inSelection.type = "checkbox"; this.inSelection.name = "in-selection";
    this.inSelection.dataset.editorSearchSelection = "true";
    this.inSelection.title = "Search the union of source ranges selected when Find opened. Use current selection explicitly captures another union; empty carets are ignored.";
    this.inSelection.addEventListener("change", () => {
      if (this.dom.isConnected) { setSearchSelectionEnabled(view, this.inSelection.checked); this.sync(); }
    });
    const selectionLabel = doc.createElement("label"); selectionLabel.append(this.inSelection, doc.createTextNode("In selection"));
    this.captureSelection = button("capture-selection", "Use current selection", () => captureSearchSelection(view));
    this.captureSelection.dataset.editorSearchCaptureSelection = "true";
    options.append(selectionLabel, this.captureSelection);
    this.status = doc.createElement("span"); this.status.className = "editor-search-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    options.append(this.status);
    this.replacementRow = doc.createElement("div"); this.replacementRow.className = "editor-search-row editor-search-replacement";
    this.replacement = input("replace", "Replace with"); this.replacement.dataset.editorSearchReplace = "true";
    this.replacement.title = "Use \\n for a line break, \\t for a tab, and \\\\ for a literal backslash. Regular expression replacements also support $1 and $&.";
    this.replaceButton = button("replace", "Replace next", () => replaceEditorMatch(view, false, allowed));
    this.replaceAllButton = button("replaceAll", "Replace all", () => {
      if (!replaceEditorMatch(view, true, allowed) && getSearchQuery(view.state).valid && canReplaceInEditor(view, allowed)) {
        this.status.textContent = "No replacements made. Check the search scope and replacement limits (up to 100,000 matches).";
      }
    });
    this.replacementRow.append(this.replacement, this.replaceButton, this.replaceAllButton);
    this.dom.append(firstRow, options, this.replacementRow);
    this.dom.addEventListener("keydown", event => {
      if (event.isComposing || !this.dom.isConnected) { return; }
      if (runScopeHandlers(view, event, "search-panel")) { event.preventDefault(); event.stopPropagation(); }
      else if (event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        if (event.target === this.replacement) { replaceEditorMatch(view, false, allowed); }
        else { (event.shiftKey ? findPrevious : findNext)(view); }
      }
    });
    this.sync();
  }

  private commit(): void {
    if (!this.dom.isConnected) { return; }
    const query = new EditorSearchQuery({ search: this.query.value, replace: this.replacement.value, caseSensitive: this.caseSensitive.checked, regexp: this.regexp.checked, wholeWord: this.wholeWord.checked });
    if (!query.input.eq(searchInput(this.view.state))) { this.view.dispatch({ effects: setSearchQuery.of(query) }); }
  }

  update(_update: ViewUpdate): void { this.sync(); }
  mount(): void { this.query.focus(); this.query.select(); }

  private sync(): void {
    const state = this.view.state, query = getSearchQuery(state), input = searchInput(state);
    if (!input.eq(this.current) || this.query.value !== input.search || this.replacement.value !== input.replace) {
      this.current = input; this.query.value = input.search; this.replacement.value = input.replace;
    }
    this.caseSensitive.checked = input.caseSensitive; this.regexp.checked = input.regexp; this.wholeWord.checked = input.wholeWord;
    const scope = searchSelectionScope(state);
    this.inSelection.checked = Boolean(scope?.enabled);
    this.inSelection.disabled = !scope || scope.stale && !scope.enabled;
    const refusal = selectionScopeRefusal(state);
    this.captureSelection.disabled = !selectedScope(state, true);
    this.captureSelection.title = refusal ?? "Capture up to 64 nonempty source ranges; overlapping or touching ranges are merged.";
    const writable = canReplaceInEditor(this.view, this.allowed), expanded = state.field(replaceModeField);
    this.replacementRow.hidden = !expanded; this.replaceToggle.setAttribute("aria-expanded", String(expanded));
    this.replacement.disabled = !writable; this.replaceButton.disabled = !writable || !query.valid; this.replaceAllButton.disabled = !writable || !query.valid;
    this.query.setAttribute("aria-invalid", String(Boolean(input.search && !query.valid)));
    if (query instanceof EditorSearchQuery && query.validationMessage) { this.status.textContent = query.validationMessage; return; }
    if (!scope && refusal) { this.status.textContent = refusal; return; }
    if (!input.search) { this.status.textContent = "Enter text to find. Use \\n for a line break."; return; }
    if (!query.valid) { this.status.textContent = "Invalid regular expression."; return; }
    const cursor = query.getCursor(state); let count = 0, selected = 0;
    for (let result = cursor.next(); !result.done; result = cursor.next()) {
      count++;
      if (result.value.from === state.selection.main.from && result.value.to === state.selection.main.to) { selected = count; }
      if (count > MAX_COUNTED_MATCHES) { break; }
    }
    const matches = count > MAX_COUNTED_MATCHES ? "10,000+ matches" : count === 1 ? "1 match" : `${count} matches`;
    this.status.textContent = (selected ? `${selected} of ${matches}` : matches) + (scope?.enabled ? " in selection" + (selectionSearchRanges(scope).length > 1 ? ` (${selectionSearchRanges(scope).length} ranges)` : "") : "")
      + (expanded && !writable ? ". Replacements unavailable while this note is read-only or busy." : "");
  }
}

export function editorSearch(allowed: () => boolean = () => true, options: { managed?: boolean } = {}): Extension {
  const ignoreFallback = (): true => true;
  // Application-owned editors use HotkeyManager's capture handler. Suppress
  // basicSetup's lower-priority fixed keys when an override disables/remaps one.
  const bindings = options.managed ? [
    { key: "Mod-f", run: ignoreFallback }, { key: "Mod-h", run: ignoreFallback }, { key: "Mod-Alt-f", run: ignoreFallback },
    { key: "F3", run: ignoreFallback, shift: ignoreFallback }, { key: "Mod-g", run: ignoreFallback, shift: ignoreFallback },
  ] : [
    { key: "Mod-f", run: (view: EditorView) => showEditorSearch(view) },
    { key: "Mod-h", mac: "Mod-Alt-f", run: (view: EditorView) => showEditorSearch(view, true) },
    { key: "F3", run: findNext, shift: findPrevious },
  ];
  return [replaceModeField, selectionScopeField, selectionScopeHistory, validateSearchQueries, search({ top: true, createPanel: view => new EditorSearchPanel(view, allowed) }), Prec.highest(keymap.of([
    ...bindings.map(binding => ({ ...binding, scope: "editor search-panel", preventDefault: true })),
    { key: "Escape", run: closeSearchPanel, scope: "editor search-panel" },
  ]))];
}

export { searchPanelOpen };
