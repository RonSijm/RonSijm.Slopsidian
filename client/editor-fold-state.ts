import { Annotation, Transaction, type EditorState, type Text } from "@codemirror/state";
import { foldEffect, foldedRanges, forceParsing, syntaxTree } from "@codemirror/language";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { availableEditorFold, editorFoldingPreferences, MAX_FOLDING_DOCUMENT } from "./editor-folding";
import type { FoldStatePort } from "./fold-state-storage";

export interface EditorSavedFold { from: number; to: number }
export const MAX_EDITOR_SAVED_FOLDS = 512;
const restoredFoldState = Annotation.define<boolean>();

/** Persist offsets only within an exact, separately source-bound document. */
export function readEditorFoldState(value: unknown, length: number): EditorSavedFold[] | null {
  if (!Array.isArray(value) || value.length > MAX_EDITOR_SAVED_FOLDS || !Number.isInteger(length) || length < 0 || length > MAX_FOLDING_DOCUMENT) { return null; }
  const ranges: EditorSavedFold[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.from) || !Number.isInteger(item.to)
      || item.from < 0 || item.to <= item.from || item.to > length) { return null; }
    ranges.push({ from: item.from, to: item.to });
  }
  ranges.sort((left, right) => left.from - right.from || right.to - left.to);
  const ancestors: EditorSavedFold[] = [];
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index], previous = ranges[index - 1];
    if (previous && previous.from === range.from && previous.to === range.to) { return null; }
    while (ancestors.length && range.from >= ancestors[ancestors.length - 1].to) { ancestors.pop(); }
    if (ancestors.length && range.to > ancestors[ancestors.length - 1].to) { return null; }
    ancestors.push(range);
  }
  return ranges;
}

export function captureEditorFoldState(state: EditorState): EditorSavedFold[] | null {
  if (state.doc.length > MAX_FOLDING_DOCUMENT) { return null; }
  const result: EditorSavedFold[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    result.push({ from, to });
    if (result.length > MAX_EDITOR_SAVED_FOLDS) { return false; }
  });
  return readEditorFoldState(result, state.doc.length);
}

/** Passive restoration never conceals any selection or extends a parser's current fold. */
export function restoreEditorFoldState(view: EditorView, value: unknown): boolean {
  let state = view.state;
  const ranges = readEditorFoldState(value, state.doc.length);
  if (!ranges?.length) { return false; }
  // Fresh editors initially parse only the viewport. Publish one bounded syntax
  // pass so folds outside that viewport can be validated against their parser.
  if (syntaxTree(state).length < state.doc.length) {
    const document = state.doc;
    forceParsing(view, document.length, 50);
    state = view.state;
    if (state.doc !== document) { return false; }
  }
  const effects = [];
  for (const range of ranges) {
    const line = state.doc.lineAt(range.from), available = availableEditorFold(state, line.from, line.to);
    if (!available || available.from !== range.from || available.to !== range.to
      || state.selection.ranges.some(selection => selection.empty
        ? selection.head > range.from && selection.head < range.to
        : selection.from < range.to && selection.to > range.from)) { continue; }
    effects.push(foldEffect.of(range));
  }
  if (!effects.length) { return false; }
  view.dispatch({ effects, annotations: [restoredFoldState.of(true), Transaction.addToHistory.of(false)] });
  return true;
}

function sameFolds(left: EditorState, right: EditorState): boolean {
  if (foldedRanges(left) === foldedRanges(right)) { return true; }
  const before = captureEditorFoldState(left), after = captureEditorFoldState(right);
  return before !== null && after !== null && before.length === after.length
    && before.every((range, index) => range.from === after[index].from && range.to === after[index].to);
}

interface BoundDocument { path: string; document: Text }

/** One live view writes only its own changes; an idle or closing peer never overwrites it. */
export class EditorFoldState {
  private bound: BoundDocument | null = null;
  private restoring = false;

  constructor(private readonly view: EditorView, private readonly port: FoldStatePort, private readonly current: (path: string) => boolean) {}

  bind(path: string, source: string, restore = true): boolean {
    this.detach();
    if (!path || source.length > MAX_FOLDING_DOCUMENT || !this.current(path) || this.view.state.sliceDoc() !== source) { return false; }
    this.bound = { path, document: this.view.state.doc };
    if (!restore) { return false; }
    try {
      const saved = this.port.load(path, source);
      if (!this.current(path) || this.bound?.path !== path || this.view.state.sliceDoc() !== source) { this.detach(); return false; }
      this.restoring = true;
      return restoreEditorFoldState(this.view, saved);
    } catch { return false; }
    finally { this.restoring = false; }
  }

  update(update: ViewUpdate): void {
    const bound = this.bound;
    if (!bound || this.restoring || update.transactions.length > 0 && update.transactions.every(transaction => transaction.annotation(restoredFoldState))) { return; }
    if (bound.document !== update.startState.doc || this.view.state !== update.state) { this.detach(); return; }
    bound.document = update.state.doc;
    if (!this.current(bound.path)) { return; }
    const before = update.startState.facet(editorFoldingPreferences), after = update.state.facet(editorFoldingPreferences);
    const preferenceChanged = before.foldHeading !== after.foldHeading || before.foldIndent !== after.foldIndent;
    const changed = !sameFolds(update.startState, update.state);
    const ranges = captureEditorFoldState(update.state);
    if (!ranges || !changed && !preferenceChanged && !(update.docChanged && ranges.length > 0)) { return; }
    const source = update.state.sliceDoc();
    if (source.length > MAX_FOLDING_DOCUMENT || !this.current(bound.path)) { return; }
    try { this.port.save(bound.path, source, ranges); }
    catch { /* A local view preference must never break editing or file navigation. */ }
  }

  /** A peer/external text synchronization refreshes ownership without loading or writing folds. */
  synchronize(source: string): void {
    if (!this.bound) { return; }
    if (source.length > MAX_FOLDING_DOCUMENT || this.view.state.sliceDoc() !== source) { this.detach(); return; }
    this.bound.document = this.view.state.doc;
  }

  detach(): void { this.bound = null; }
}
