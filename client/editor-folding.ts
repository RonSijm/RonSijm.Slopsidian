import { EditorState, Facet, Text, type Extension, type StateEffect } from "@codemirror/state";
import { codeFolding, ensureSyntaxTree, foldable, foldedRanges, foldEffect, foldKeymap, foldService, language, StreamLanguage, syntaxTree, unfoldCode, unfoldEffect } from "@codemirror/language";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { markdownSupport } from "./editor-language";

export interface EditorFoldingPreferences { foldHeading: boolean; foldIndent: boolean }
export type EditorFoldKind = "heading" | "list" | "other" | "unknown";
export const MAX_FOLDING_DOCUMENT = 1_048_576;
const defaultPreferences: Readonly<EditorFoldingPreferences> = Object.freeze({ foldHeading: true, foldIndent: true });
export const editorFoldingPreferences = Facet.define<EditorFoldingPreferences, EditorFoldingPreferences>({ combine: values => values[0] ?? defaultPreferences });
interface MarkdownFolds { state: EditorState; tree: Tree | null; frontmatterTo: number }
const markdownStates = new WeakMap<Text, MarkdownFolds>();

/** One bounded Markdown parse per immutable document, even if a plugin supplies a stream language. */
function markdownFolds(state: EditorState): MarkdownFolds {
  const retained = markdownStates.get(state.doc);
  if (retained) { return retained; }
  const document = state.doc;
  if (document.length > MAX_FOLDING_DOCUMENT) {
    const value = { state, tree: null, frontmatterTo: 0 }; markdownStates.set(document, value); return value;
  }
  let frontmatterTo = 0;
  if (document.line(1).text === "---") {
    const closing = /\n(?:---|\.\.\.)(?=\n|$)/.exec(document.sliceString(0));
    frontmatterTo = closing ? closing.index + closing[0].length : document.length;
  }
  const initial = EditorState.create({ doc: document, extensions: [markdownSupport] });
  const tree = ensureSyntaxTree(initial, document.length, 50);
  const value = { state: tree ? initial.update({}).state : initial, tree, frontmatterTo };
  markdownStates.set(document, value);
  return value;
}

/** Classify the opening line; a fence's apparent # or list markers are never Markdown folds. */
export function editorFoldKind(state: EditorState, from: number): EditorFoldKind {
  if (!Number.isInteger(from) || from < 0 || from > state.doc.length) { return "unknown"; }
  const parsed = markdownFolds(state), line = state.doc.lineAt(from);
  if (!parsed.tree) { return "unknown"; }
  if (line.from <= parsed.frontmatterTo && parsed.frontmatterTo > 0) { return "other"; }
  for (let node = parsed.tree.resolveInner(line.to, -1); node; node = node.parent!) {
    if (node.from < line.from) { break; }
    if (["FencedCode", "CodeBlock", "HTMLBlock", "Table"].includes(node.name)) { return "other"; }
    if (/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) { return "heading"; }
    if (node.name === "ListItem") { return "list"; }
  }
  return "other";
}

export function editorFoldAllowed(state: EditorState, from: number): boolean {
  const preferences = state.facet(editorFoldingPreferences);
  if (preferences.foldHeading !== false && preferences.foldIndent !== false) { return true; }
  const kind = editorFoldKind(state, from);
  return kind === "heading" ? preferences.foldHeading !== false : kind === "list" ? preferences.foldIndent !== false : kind !== "unknown";
}

/** A stream highlighter can replace the syntax tree; vault documents still fold as Markdown. */
export const markdownStreamFolding = foldService.of((state, from, to) => {
  if (!(state.facet(language) instanceof StreamLanguage)) { return null; }
  const parsed = markdownFolds(state);
  return parsed.tree ? foldable(parsed.state, from, to) : null;
});

export function availableEditorFold(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  const range = foldable(state, from, to);
  return range && editorFoldAllowed(state, range.from) ? range : null;
}

function announceFold(state: EditorState, range: { from: number; to: number }, fold = true): StateEffect<string> {
  const from = state.doc.lineAt(range.from).number, to = state.doc.lineAt(range.to).number;
  return EditorView.announce.of(`${state.phrase(fold ? "Folded lines" : "Unfolded lines")} ${from} ${state.phrase("to")} ${to}.`);
}

export function foldEditorCode(view: EditorView): boolean {
  const visited = new Set<number>();
  for (const { head } of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(head);
    if (visited.has(line.from)) { continue; }
    visited.add(line.from);
    const range = availableEditorFold(view.state, line.from, line.to);
    if (range) { view.dispatch({ effects: [foldEffect.of(range), announceFold(view.state, range)] }); return true; }
  }
  return false;
}

/** A disabled outer heading must not make fold-all skip its still-enabled lists/code. */
export function foldAllEditor(view: EditorView): boolean {
  const effects: StateEffect<unknown>[] = [], state = view.state;
  for (let offset = 0; offset < state.doc.length;) {
    const line = state.doc.lineAt(offset), range = availableEditorFold(state, line.from, line.to);
    if (range) { effects.push(foldEffect.of(range)); }
    offset = (range ? state.doc.lineAt(range.to) : line).to + 1;
  }
  if (effects.length) { view.dispatch({ effects }); }
  return effects.length > 0;
}

export const editorFoldKeymap = foldKeymap.map(binding => ({ ...binding,
  run: binding.key === "Ctrl-Shift-[" ? foldEditorCode : binding.key === "Ctrl-Alt-[" ? foldAllEditor : binding.run,
}));

export function toggleEditorFold(view: EditorView): boolean { return unfoldCode(view) || foldEditorCode(view); }

function foldedOnLine(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  foldedRanges(state).between(from, to, (start, end) => {
    if (start >= from && start <= to) { result = { from: start, to: end }; return false; }
  });
  return result;
}

/** Retain the transaction's changes/selection/annotations while removing disabled fold effects. */
const permittedFolds = EditorState.transactionFilter.of(transaction => {
  const state = transaction.state, preferences = state.facet(editorFoldingPreferences);
  if (preferences.foldHeading !== false && preferences.foldIndent !== false) { return transaction; }
  const effects: StateEffect<unknown>[] = transaction.effects.filter(effect => !effect.is(foldEffect) || editorFoldAllowed(state, effect.value.from));
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    if (!editorFoldAllowed(state, from)) { effects.push(unfoldEffect.of({ from, to })); }
  });
  return effects.length === transaction.effects.length && effects.every((effect, index) => effect === transaction.effects[index]) ? transaction : { ...transaction, effects };
});

class EditorFoldMarker extends GutterMarker {
  constructor(private readonly open: boolean, private readonly kind: EditorFoldKind, private readonly line = 0) { super(); }
  override eq(other: EditorFoldMarker): boolean { return this.open === other.open && this.kind === other.kind && this.line === other.line; }
  override toDOM(view: EditorView): HTMLElement {
    const element = view.dom.ownerDocument.createElement("span");
    element.textContent = this.open ? "⌄" : "›";
    element.dataset.editorFoldMarker = this.kind;
    element.dataset.editorFoldOpen = String(this.open);
    element.dataset.editorFoldLine = String(this.line);
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", (this.open ? "Fold " : "Unfold ") + (this.kind === "heading" ? "heading" : this.kind === "list" ? "list" : "section"));
    element.title = element.getAttribute("aria-label")!;
    return element;
  }
}

/** Keep the folding field outside the preference compartment, so changing a toggle retains other folds. */
export const editorFolding: Extension = [
  codeFolding(), permittedFolds,
  gutter({
    class: "cm-foldGutter cm-editor-fold-gutter",
    lineMarker(view, line) {
      const folded = foldedOnLine(view.state, line.from, line.to), range = folded ?? availableEditorFold(view.state, line.from, line.to);
      return range ? new EditorFoldMarker(!folded, editorFoldKind(view.state, range.from), view.state.doc.lineAt(range.from).number) : null;
    },
    initialSpacer: () => new EditorFoldMarker(false, "other"),
    lineMarkerChange: update => update.docChanged || update.startState.facet(editorFoldingPreferences) !== update.state.facet(editorFoldingPreferences)
      || foldedRanges(update.startState) !== foldedRanges(update.state) || syntaxTree(update.startState) !== syntaxTree(update.state),
    domEventHandlers: { click(view, line, event) {
      if ((event as MouseEvent).button !== 0) { return false; }
      const folded = foldedOnLine(view.state, line.from, line.to), range = folded ?? availableEditorFold(view.state, line.from, line.to);
      if (!range) { return false; }
      event.preventDefault();
      view.dispatch({ effects: [folded ? unfoldEffect.of(range) : foldEffect.of(range), announceFold(view.state, range, !folded)] });
      return true;
    } },
  }),
  EditorView.theme({
    ".cm-foldGutter.cm-editor-fold-gutter": { display: "flex !important", minWidth: "1em" },
    ".cm-editor-fold-gutter span": { cursor: "pointer", padding: "0 2px", color: "var(--text-muted)" },
  }),
];
