import { EditorSelection, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, language } from "@codemirror/language";
import { EditorView, type Command } from "@codemirror/view";

export const MAX_MARKDOWN_PAIR_DOCUMENT = 262_144;
export const MAX_MARKDOWN_PAIR_NODES = 16_384;
export const MAX_MARKDOWN_PAIR_CONTEXTS = 4_096;
export const MAX_MARKDOWN_PAIR_SELECTIONS = 64;
export const MAX_MARKDOWN_PAIR_SELECTION = 4_096;
export const MAX_MARKDOWN_PAIR_SELECTED = 16_384;
export const MAX_MARKDOWN_GENERATED_PAIRS = 128;
export const MAX_MARKDOWN_PAIR_WIDTH = 3;
const parseMilliseconds = 20;
type Marker = "*" | "_" | "~" | "=";
interface Interval { from: number; to: number }
interface Context { source: string; ignored: Interval[] }
interface Pair { id: number; open: number; close: number; width: number; marker: Marker }
const contexts = new WeakMap<object, { language: unknown; value: Context | null }>();
const protectedNames = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "HTMLTag", "CommentBlock", "Link", "Image", "Autolink", "URL"]);
const word = /[\p{L}\p{N}\p{M}_]/u;
let nextPair = 1;
const addPair = StateEffect.define<Pair>({ map: (value, changes) => ({ ...value, open: changes.mapPos(value.open, 1), close: changes.mapPos(value.close, 1) }) });
const removePairs = StateEffect.define<number[]>();

function escaped(source: string, position: number): boolean {
  let count = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index--) count++;
  return count % 2 === 1;
}
function nextUnescaped(source: string, token: string, from: number, to = source.length): number {
  let index = source.indexOf(token, from);
  while (index >= 0 && index < to) {
    if (!escaped(source, index)) return index;
    index = source.indexOf(token, index + token.length);
  }
  return -1;
}

/** Conservative, cached classification of one immutable Markdown document. */
function context(state: EditorState): Context | null {
  const activeLanguage = state.facet(language);
  if (state.doc.length > MAX_MARKDOWN_PAIR_DOCUMENT || activeLanguage?.name !== "markdown") return null;
  const previous = contexts.get(state.doc);
  if (previous?.language === activeLanguage) return previous.value;
  const retain = (value: Context | null): Context | null => { contexts.set(state.doc, { language: activeLanguage, value }); return value; };
  const tree = ensureSyntaxTree(state, state.doc.length, parseMilliseconds);
  if (!tree || tree.length !== state.doc.length) { return retain(null); }
  const ignored: Interval[] = [], cursor = tree.cursor();
  let nodes = 0;
  do {
    if (++nodes > MAX_MARKDOWN_PAIR_NODES) { return retain(null); }
    if (protectedNames.has(cursor.name)) {
      if (ignored.length >= MAX_MARKDOWN_PAIR_CONTEXTS) return retain(null);
      ignored.push({ from: cursor.from, to: cursor.to });
    }
  } while (cursor.next());
  const source = state.doc.toString();
  if (/[\uD800-\uDFFF]/u.test(source)) return retain(null);
  if (/^\ufeff?---$/.test(state.doc.line(1).text)) {
    const start = state.doc.line(1).to, closing = /\n(?:---|\.\.\.)(?=\n|$)/.exec(source.slice(start));
    ignored.push({ from: 0, to: closing ? start + closing.index + closing[0].length : source.length });
  }
  if (ignored.length > MAX_MARKDOWN_PAIR_CONTEXTS) return retain(null);
  ignored.sort((a, b) => a.from - b.from || b.to - a.to);
  const original = ignored.slice(); let protectedIndex = 0;
  for (let index = 0; index < source.length;) {
    while (original[protectedIndex] && original[protectedIndex].to <= index) protectedIndex++;
    if (original[protectedIndex]?.from <= index) { index = Math.max(index + 1, original[protectedIndex].to); continue; }
    if (source[index] === "\\") { index += 2; continue; }
    let to = index;
    if (source.startsWith("%%", index)) {
      const end = nextUnescaped(source, "%%", index + 2); to = end < 0 ? source.length : end + 2;
    } else if (source.startsWith("$$", index)) {
      const end = nextUnescaped(source, "$$", index + 2); to = end < 0 ? source.length : end + 2;
    } else if (source[index] === "$" && !/[\s\d]/.test(source[index + 1] ?? "x")) {
      const newline = source.indexOf("\n", index), lineEnd = newline < 0 ? source.length : newline;
      const end = nextUnescaped(source, "$", index + 1, lineEnd); to = end < 0 ? lineEnd : end + 1;
    } else if (source.startsWith("[[", index)) {
      const newline = source.indexOf("\n", index), lineEnd = newline < 0 ? source.length : newline;
      const end = nextUnescaped(source, "]]", index + 2, lineEnd); to = end < 0 ? lineEnd : end + 2;
    }
    if (to > index) {
      if (ignored.length >= MAX_MARKDOWN_PAIR_CONTEXTS) { return retain(null); }
      ignored.push({ from: index, to }); index = to;
    } else index++;
  }
  ignored.sort((a, b) => a.from - b.from || a.to - b.to);
  return retain({ source, ignored });
}

function prose(state: EditorState, value: Context, from: number, to: number): boolean {
  const boundary = (position: number): boolean => !(position > 0 && /[\uD800-\uDBFF]/.test(value.source[position - 1]) && /[\uDC00-\uDFFF]/.test(value.source[position] ?? ""));
  if (!boundary(from) || !boundary(to)) return false;
  if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number || state.doc.lineAt(from).length > MAX_MARKDOWN_PAIR_SELECTION) return false;
  if (escaped(value.source, from) || from !== to && escaped(value.source, to)) return false;
  return !value.ignored.some(range => from === to ? range.from <= from && from <= range.to : from < range.to && range.from < to);
}
function character(source: string, position: number, before = false): string {
  return before ? Array.from(source.slice(Math.max(0, position - 2), position)).at(-1) ?? "" : Array.from(source.slice(position, position + 2))[0] ?? "";
}
function doubleMarker(marker: Marker): boolean { return marker === "~" || marker === "="; }
/** Repeated quote/list prefixes remain available for fences and Setext underlines. */
function structuralPrefix(state: EditorState, position: number): boolean {
  const line = state.doc.lineAt(position);
  if (position - line.from > MAX_MARKDOWN_PAIR_SELECTION) return true;
  const prefix = state.doc.sliceString(line.from, position), space = (at: number): boolean => prefix[at] === " " || prefix[at] === "\t";
  let index = 0;
  while (index < prefix.length) {
    while (space(index)) index++;
    if (index === prefix.length) return true;
    if (prefix[index] === ">") { index++; continue; }
    if (prefix[index] === "-" || prefix[index] === "+" || prefix[index] === "*") { index++; }
    else {
      const start = index;
      while (index - start < 9 && prefix[index] >= "0" && prefix[index] <= "9") index++;
      if (index === start || prefix[index] !== "." && prefix[index] !== ")") return false;
      index++;
    }
    if (!space(index)) return false;
  }
  return true;
}
function available(view: EditorView): boolean { return !view.state.readOnly && view.state.facet(EditorView.editable) && !view.composing && !view.compositionStarted; }
function validPair(state: EditorState, pair: Pair): boolean {
  const token = pair.marker.repeat(pair.width);
  return pair.open >= 0 && pair.open + pair.width <= pair.close && pair.close + pair.width <= state.doc.length
    && state.doc.lineAt(pair.open).number === state.doc.lineAt(pair.close).number
    && state.doc.sliceString(pair.open, pair.open + pair.width) === token && state.doc.sliceString(pair.close, pair.close + pair.width) === token;
}
const generated = StateField.define<readonly Pair[]>({
  create: () => [],
  update(value, transaction) {
    if (transaction.state.doc.length > MAX_MARKDOWN_PAIR_DOCUMENT) return [];
    let pairs = transaction.docChanged && !transaction.isUserEvent("input.type") && !transaction.isUserEvent("delete.backward") ? []
      : value.map(pair => ({ ...pair, open: transaction.changes.mapPos(pair.open, 1), close: transaction.changes.mapPos(pair.close, 1) })).filter(pair => validPair(transaction.state, pair));
    for (const effect of transaction.effects) {
      if (effect.is(removePairs)) pairs = pairs.filter(pair => !effect.value.includes(pair.id));
      else if (effect.is(addPair) && validPair(transaction.state, effect.value)) pairs.push(effect.value);
    }
    return pairs.slice(-MAX_MARKDOWN_GENERATED_PAIRS);
  },
});

/** Only owned generated closers overtype; literal existing markup is never inferred as generated. */
const input = EditorView.inputHandler.of((view, from, to, text) => {
  const state = view.state, selection = state.selection;
  if (!available(view) || !state.field(generated, false) || from !== selection.main.from || to !== selection.main.to
    || selection.ranges.length > MAX_MARKDOWN_PAIR_SELECTIONS || text.length > 64 || (text !== "*" && text !== "_" && text !== "~" && text !== "=" && !/^[ \t]+$/.test(text))) return false;
  const parsed = context(state); if (!parsed) return false;
  let selected = 0;
  for (const range of selection.ranges) {
    selected += range.to - range.from;
    if (range.to - range.from > MAX_MARKDOWN_PAIR_SELECTION || selected > MAX_MARKDOWN_PAIR_SELECTED || !prose(state, parsed, range.from, range.to)) return false;
  }
  const marker = text === "*" || text === "_" || text === "~" || text === "=" ? text : null, tracked = state.field(generated);
  let refused = false;
  const changes = state.changeByRange(range => {
    const pair = tracked.find(pair => range.empty && range.head === pair.close && (marker === null || pair.marker === marker));
    if (pair) {
      const empty = pair.open + pair.width === pair.close;
      if (!marker) {
        const markerRun = state.doc.sliceString(pair.open, pair.close) === pair.marker.repeat(pair.close - pair.open);
        if (!empty && !markerRun) { refused = true; return { range }; }
        return { changes: { from: range.head, to: pair.close + pair.width, insert: text }, range: EditorSelection.cursor(range.head + text.length), effects: removePairs.of([pair.id]) };
      }
      if (empty && pair.width < (doubleMarker(marker) ? 2 : MAX_MARKDOWN_PAIR_WIDTH)) {
        return { changes: { from: range.head, insert: marker + marker }, range: EditorSelection.cursor(range.head + 1),
          effects: [removePairs.of([pair.id]), addPair.of({ id: nextPair++, marker, open: pair.open, close: pair.close + 1, width: pair.width + 1 })] };
      }
      if (empty && doubleMarker(marker)) {
        // A third opening tilde/equal is literal punctuation, never a triple pair.
        return { changes: { from: range.head, to: pair.close + pair.width, insert: marker }, range: EditorSelection.cursor(range.head + 1), effects: removePairs.of([pair.id]) };
      }
      const effects: StateEffect<unknown>[] = [removePairs.of([pair.id])];
      if (pair.width > 1) effects.push(addPair.of({ ...pair, close: pair.close + 1, width: pair.width - 1 }));
      return { range: EditorSelection.cursor(range.head + 1), effects };
    }
    if (!marker) { refused = true; return { range }; }
    const before = character(parsed.source, range.from, true), after = character(parsed.source, range.to);
    if (!range.empty) {
      const content = state.doc.sliceString(range.from, range.to);
      if (/^\s|\s$/u.test(content) || (marker === "_" || doubleMarker(marker)) && (word.test(before) || word.test(after))) { refused = true; return { range }; }
      if (doubleMarker(marker)) {
        const enclosing = tracked.find(pair => pair.marker === marker && pair.open + pair.width === range.from && pair.close === range.to);
        if (enclosing?.width === 2 || state.doc.sliceString(Math.max(0, range.from - 2), range.from) === marker + marker
          && state.doc.sliceString(range.to, range.to + 2) === marker + marker) { refused = true; return { range }; }
        if (enclosing) {
          return { changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }], range: EditorSelection.range(range.anchor + 1, range.head + 1),
            effects: [removePairs.of([enclosing.id]), addPair.of({ id: nextPair++, marker, open: enclosing.open, close: range.to + 1, width: 2 })] };
        }
      }
      return { changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }], range: EditorSelection.range(range.anchor + 1, range.head + 1),
        effects: addPair.of({ id: nextPair++, marker, open: range.from, close: range.to + 1, width: 1 }) };
    }
    if (doubleMarker(marker)) {
      const open = range.head - 1, previous = open < 0 ? "" : character(parsed.source, open, true);
      if (before !== marker || word.test(previous) || word.test(after) || previous === marker || after === marker
        || !prose(state, parsed, open, range.to) || structuralPrefix(state, open)) { refused = true; return { range }; }
      return { changes: { from: range.head, insert: marker.repeat(3) }, range: EditorSelection.cursor(range.head + 1),
        effects: addPair.of({ id: nextPair++, marker, open, close: range.head + 1, width: 2 }) };
    }
    if (word.test(before) || word.test(after) || before === marker || after === marker) { refused = true; return { range }; }
    return { changes: { from: range.head, insert: marker + marker }, range: EditorSelection.cursor(range.head + 1),
      effects: addPair.of({ id: nextPair++, marker, open: range.head, close: range.head + 1, width: 1 }) };
  });
  if (refused) return false;
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input.type", annotations: selection.ranges.some(range => !range.empty) ? isolateHistory.of("full") : [] }));
  return true;
});

/** Default-priority binding leaves higher-priority plugin/Markdown Backspace intact. */
export const deleteMarkdownPair: Command = view => {
  const state = view.state, tracked = state.field(generated, false);
  if (!available(view) || !tracked || state.selection.ranges.length > MAX_MARKDOWN_PAIR_SELECTIONS) return false;
  const parsed = context(state); if (!parsed) return false;
  let refused = false;
  const changes = state.changeByRange(range => {
    const pair = tracked.find(pair => range.empty && range.head === pair.close && pair.open + pair.width === pair.close);
    if (!pair || !prose(state, parsed, range.from, range.to)) { refused = true; return { range }; }
    const effects: StateEffect<unknown>[] = [removePairs.of([pair.id])];
    if (pair.width > 1) effects.push(addPair.of({ ...pair, close: pair.close - 1, width: pair.width - 1 }));
    return { changes: { from: range.head - 1, to: range.head + 1 }, range: EditorSelection.cursor(range.head - 1), effects };
  });
  if (refused) return false;
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "delete.backward" })); return true;
};
export const editorMarkdownPairKeymap = [{ key: "Backspace", run: deleteMarkdownPair }];
/** Reusing these field/handler identities preserves tracking across unrelated preference changes. */
export function markdownPairing(): Extension { return [generated, input]; }
