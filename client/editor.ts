import { basicSetup } from "codemirror6";
import { Compartment, EditorSelection, EditorState, Facet, StateField, Text, type ChangeSpec, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { cursorCharLeft, cursorCharRight, cursorDocEnd, cursorDocStart, cursorGroupLeft, cursorGroupRight, cursorLineDown, cursorLineUp, deleteLine, indentLess, indentMore, insertNewlineAndIndent, isolateHistory, moveLineDown, moveLineUp, redo, undo } from "@codemirror/commands";
import { MutationLock } from "./editor-barrier";
import { defaultHighlightStyle, ensureSyntaxTree, foldable, foldedRanges, foldEffect, foldService, foldAll, foldCode, HighlightStyle, language, StreamLanguage, syntaxHighlighting, unfoldAll, unfoldCode, unfoldEffect } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { EditorChange, EditorCommandName, EditorSelectionOrCaret, EditorTransaction } from "obsidian";
import { reportError } from "./dom";
import { sourcePositions } from "./markdown";
import { markdownSupport } from "./editor-language";
import { markdownTags } from "./live-preview";
import type { MarkdownView } from "./workspace";

const editorContext = Facet.define<MarkdownView | null, MarkdownView | null>({ combine: values => values[0] ?? null });
const codeFont = syntaxHighlighting(HighlightStyle.define([...defaultHighlightStyle.specs, { tag: tags.monospace, fontFamily: "var(--font-monospace)" }]), { fallback: true });
const editorCommands: Record<EditorCommandName, (view: EditorView) => boolean> = {
  goUp: cursorLineUp, goDown: cursorLineDown, goLeft: cursorCharLeft, goRight: cursorCharRight,
  goStart: cursorDocStart, goEnd: cursorDocEnd, goWordLeft: cursorGroupLeft, goWordRight: cursorGroupRight,
  indentMore, indentLess, newlineAndIndent: insertNewlineAndIndent, swapLineUp: moveLineUp, swapLineDown: moveLineDown,
  deleteLine, toggleFold: view => unfoldCode(view) || foldCode(view), foldAll, unfoldAll,
};
export const editorEditorField = StateField.define<EditorView | null>({
  create: () => null,
  update: value => value,
});
export const editorInfoField = StateField.define<MarkdownView | null>({
  create: state => state.facet(editorContext),
  update: (_value, transaction) => transaction.state.facet(editorContext),
});
export const editorLivePreviewField = StateField.define<boolean>({
  create: state => state.field(editorInfoField)?.getEditingMode() === "live-preview",
  update: (_value, transaction) => transaction.state.field(editorInfoField)?.getEditingMode() === "live-preview",
});

export interface EditorPosition {
  line: number;
  ch: number;
}

export interface EditorFoldInfo {
  folds: { from: number; to: number }[];
  lines: number;
}

// A stream highlighter can replace the syntax tree, but vault documents still fold as Markdown.
const foldingStates = new WeakMap<Text, EditorState>();
const markdownFolding = foldService.of((state, from, to) => {
  if (!(state.facet(language) instanceof StreamLanguage)) { return null; }
  let folding = foldingStates.get(state.doc) ?? EditorState.create({ doc: state.doc, extensions: [markdownSupport] });
  const tree = ensureSyntaxTree(folding, state.doc.length, 50);
  folding = folding.update({}).state;
  foldingStates.set(state.doc, folding);
  return tree ? foldable(folding, from, to) : null;
});

function positionOffset(document: Text, position: EditorPosition): number {
  const line = document.line(position.line + 1);
  return line.from + Math.max(0, Math.min(position.ch, line.length));
}

function editorTheme(dark: boolean): Extension {
  return EditorView.theme({
    "&": { color: "var(--text-normal)", backgroundColor: "var(--background-primary)" },
    ".cm-scroller": { fontFamily: "var(--font-text)", lineHeight: "1.5" },
    ".cm-gutters": { backgroundColor: "var(--background-primary)", color: "var(--text-muted)", border: "none" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--text-normal)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--text-selection)" },
  }, { dark });
}

export class Editor {
  static readonly commands: Record<string, (editor: Editor) => unknown> = { save: editor => editor.onSave() };
  readonly cm: EditorView;
  private readonly pluginCompartment = new Compartment();
  private readonly editableCompartment = new Compartment();
  private readonly lineSeparatorCompartment = new Compartment();
  private readonly previewCompartment = new Compartment();
  private readonly themeCompartment = new Compartment();
  private darkMode = !document.body.classList.contains("theme-light");
  private previewExtension: Extension = [];
  private readonly plugins = new Map<string, Extension[]>();
  private synchronizing = false;
  private readonly mutationLock = new MutationLock();

  constructor(parent: HTMLElement, private readonly onChange: (update: ViewUpdate) => void, private readonly onSave: () => Promise<void>, private readonly onSelectionChange: () => void, private readonly owner?: MarkdownView) {
    this.cm = new EditorView({ parent });
    try { this.cm.setState(this.state("", false)); }
    catch (error) { this.cm.destroy(); throw error; }
  }

  get editorComponent(): MarkdownView | null { return this.owner ?? null; }

  /** Re-home CodeMirror's observers and styles after its DOM moved into another window; selection and undo are untouched. */
  moveToDocument(doc: Document): void {
    if (this.cm.root === doc) { return; }
    const focused = this.cm.hasFocus;
    this.cm.setRoot(doc);
    this.cm.requestMeasure();
    if (focused) { this.cm.focus(); }
  }

  private state(content: string, editable: boolean): EditorState {
    const lineSeparator = content.includes("\r\n") ? "\r\n" : "\n";
    return EditorState.create({
      doc: content,
      extensions: [
        // Only the first fallback highlighter is used; plugin highlighters still take precedence.
        codeFont,
        basicSetup,
        editorEditorField.init(() => this.cm),
        editorContext.of(this.owner ?? null),
        editorInfoField,
        editorLivePreviewField,
        markdownSupport,
        this.owner ? markdownTags(this.owner) : [],
        markdownFolding,
        EditorView.lineWrapping,
        this.lineSeparatorCompartment.of(EditorState.lineSeparator.of(lineSeparator)),
        this.editableCompartment.of(EditorView.editable.of(editable && !this.owner?.app.vault.readOnly)),
        EditorState.transactionFilter.of(transaction => this.owner?.app.vault.readOnly && transaction.docChanged && !this.synchronizing ? [] : transaction),
        this.mutationLock.extension(),
        this.previewCompartment.of(this.previewExtension),
        EditorView.contentAttributes.of({ "aria-label": "Markdown editor" }),
        this.themeCompartment.of(editorTheme(this.darkMode)),
        keymap.of([{ key: "Mod-s", run: () => { Promise.resolve(Editor.commands.save(this)).catch(reportError); return true; } }]),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !this.synchronizing) {
            this.onChange(update);
          }
          if (update.selectionSet && !this.synchronizing) {
            this.onSelectionChange();
          }
        }),
        this.pluginCompartment.of(this.extensions()),
      ],
    });
  }

  setDocument(content: string, editable = true): void {
    this.cm.setState(this.state(content, editable));
  }

  /** Reinstates a previously stashed state (with its undo history) and refreshes the settings that may have changed meanwhile. */
  restoreState(state: EditorState, editable: boolean): void {
    this.cm.setState(state);
    this.cm.dispatch({ effects: [
      this.editableCompartment.reconfigure(EditorView.editable.of(editable && !this.owner?.app.vault.readOnly)),
      this.mutationLock.set(this.mutationLock.locked),
      this.themeCompartment.reconfigure(editorTheme(this.darkMode)),
      this.pluginCompartment.reconfigure(this.extensions()),
      this.previewCompartment.reconfigure(this.previewExtension),
    ] });
  }

  /** Refuses user input and Undo/Redo while a workspace file mutation runs, without touching content or history. */
  setMutationLock(locked: boolean): void { this.cm.dispatch({ effects: this.mutationLock.set(locked) }); }

  setEditable(editable: boolean): void {
    this.cm.dispatch({ effects: this.editableCompartment.reconfigure(EditorView.editable.of(editable && !this.owner?.app.vault.readOnly)) });
  }

  setDarkMode(dark: boolean): void {
    if (dark === this.darkMode) { return; }
    this.darkMode = dark;
    this.cm.dispatch({ effects: this.themeCompartment.reconfigure(editorTheme(dark)) });
  }

  setLivePreview(extension: Extension): void {
    this.previewExtension = extension;
    this.cm.dispatch({ effects: this.previewCompartment.reconfigure(extension) });
  }

  getValue(): string {
    return this.cm.state.sliceDoc();
  }

  setValue(content: string): void {
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: Text.of(content.split(/\r\n?|\n/)) } });
  }

  syncValue(content: string): void {
    const original = this.getValue();
    if (content === original) {
      return;
    }
    const selection = this.cm.state.selection.main;
    const separator = content.includes("\r\n") ? "\r\n" : "\n";
    const sameSeparator = separator === (original.includes("\r\n") ? "\r\n" : "\n");
    let from = 0;
    let to = original.length;
    let end = content.length;
    if (sameSeparator) {
      while (from < to && from < end && original[from] === content[from]) { from++; }
      while (to > from && end > from && original[to - 1] === content[end - 1]) { to--; end--; }
    }
    const range = sourcePositions(original)(from, to);
    const insert = Text.of(content.slice(from, end).split(separator));
    const scroller = this.owner?.contentEl ?? this.cm.scrollDOM;
    const scroll = scroller.scrollTop;
    this.synchronizing = true;
    try {
      this.cm.dispatch({
        effects: this.lineSeparatorCompartment.reconfigure(EditorState.lineSeparator.of(separator)),
        changes: { from: this.posToOffset(range.start), to: this.posToOffset(range.end), insert },
        ...(!sameSeparator ? { selection: { anchor: Math.min(selection.anchor, insert.length), head: Math.min(selection.head, insert.length) } } : {}),
      });
      scroller.scrollTop = scroll;
    } finally {
      this.synchronizing = false;
    }
  }

  destroy(): void { this.cm.destroy(); }

  refresh(): void { this.cm.requestMeasure(); }

  scrollIntoView(range: { from: EditorPosition; to: EditorPosition }, center = false): void {
    const selection = EditorSelection.range(this.posToOffset(range.from), this.posToOffset(range.to));
    this.cm.dispatch({ effects: EditorView.scrollIntoView(selection, { y: center ? "center" : "nearest" }) });
  }

  private get scrollElement(): HTMLElement { return this.owner?.contentEl ?? this.cm.scrollDOM; }

  getScrollInfo(): { top: number; left: number } {
    return { top: this.scrollElement.scrollTop, left: this.scrollElement.scrollLeft };
  }

  scrollTo(x?: number | null, y?: number | null): void {
    if (x != null) { this.scrollElement.scrollLeft = x; }
    if (y != null) { this.scrollElement.scrollTop = y; }
  }

  getSelection(): string {
    const { from, to } = this.cm.state.selection.main;
    return this.cm.state.sliceDoc(from, to);
  }

  somethingSelected(): boolean { return this.getSelection().length > 0; }

  getDoc(): Editor { return this; }

  listSelections(): { anchor: EditorPosition; head: EditorPosition }[] {
    return this.cm.state.selection.ranges.map(range => ({ anchor: this.offsetToPos(range.anchor), head: this.offsetToPos(range.head) }));
  }

  replaceSelection(content: string, origin?: string): void {
    this.cm.dispatch({ ...this.cm.state.replaceSelection(Text.of(content.split(/\r\n?|\n/))), userEvent: origin });
  }

  replaceRange(content: string, from: EditorPosition, to = from, origin?: string): void {
    this.cm.dispatch({ changes: { from: this.posToOffset(from), to: this.posToOffset(to), insert: Text.of(content.split(/\r\n?|\n/)) }, userEvent: origin, scrollIntoView: true });
  }

  /** Replaces one string-offset range as a single isolated undo step, only while the document still equals `expected`. */
  replaceExpected(expected: string, from: number, to: number, insert: string): void {
    const original = this.getValue();
    if (original !== expected || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > original.length) {
      throw new Error("The note changed; no text was moved.");
    }
    const range = sourcePositions(original)(from, to), lineBreak = this.cm.state.lineBreak;
    this.cm.dispatch({
      changes: { from: this.posToOffset(range.start), to: this.posToOffset(range.end), insert: Text.of(insert.split(lineBreak)) },
      annotations: isolateHistory.of("full"), userEvent: "move.outline",
    });
  }

  getCursor(which: "from" | "to" | "anchor" | "head" = "head"): EditorPosition {
    return this.offsetToPos(this.cm.state.selection.main[which]);
  }

  setCursor(position: EditorPosition | number, ch = 0): void {
    const cursor = typeof position === "number" ? { line: position, ch } : position;
    this.setSelection(cursor);
  }

  setSelection(anchor: EditorPosition, head = anchor): void {
    this.cm.dispatch({ selection: { anchor: this.posToOffset(anchor), head: this.posToOffset(head) }, scrollIntoView: true });
  }

  setSelections(ranges: EditorSelectionOrCaret[], main = 0, scrollIntoView = true): void {
    const selection = EditorSelection.create(ranges.map(range =>
      EditorSelection.range(this.posToOffset(range.anchor), this.posToOffset(range.head ?? range.anchor))), main);
    this.cm.dispatch(scrollIntoView ? { selection, scrollIntoView } : { selection });
  }

  transaction(transaction: EditorTransaction, origin?: string): void {
    if (!transaction || typeof transaction !== "object" || Array.isArray(transaction) || origin !== undefined && typeof origin !== "string") {
      throw new Error("An editor transaction requires a change object and an optional string origin.");
    }
    const state = this.cm.state;
    const replacement = transaction.replaceSelection === undefined ? undefined
      : state.replaceSelection(Text.of(transaction.replaceSelection.split(/\r\n?|\n/)));
    const edits: ChangeSpec[] = [];
    if (replacement?.changes) { edits.push(replacement.changes); }
    for (const change of transaction.changes ?? []) {
      edits.push({
        from: positionOffset(state.doc, change.from), to: positionOffset(state.doc, change.to ?? change.from),
        insert: Text.of(change.text.split(/\r\n?|\n/)),
      });
    }
    const changes = state.changes(edits);
    const document = changes.apply(state.doc);
    const ranges = transaction.selections ?? (transaction.selection ? [transaction.selection] : undefined);
    const selection = ranges ? EditorSelection.create(ranges.map(range =>
      EditorSelection.range(positionOffset(document, range.from), positionOffset(document, range.to ?? range.from)))) : undefined;
    this.cm.dispatch({
      ...replacement, changes, ...(selection ? { selection } : {}), userEvent: origin, scrollIntoView: true,
      // Keep an automatic plugin batch with its preceding action, not the next typed edit.
      annotations: origin === undefined ? isolateHistory.of("after") : undefined,
    });
  }

  getFoldInfo(): EditorFoldInfo {
    const document = this.cm.state.doc;
    const folds: EditorFoldInfo["folds"] = [];
    foldedRanges(this.cm.state).between(0, document.length, (from, to) => {
      folds.push({ from: document.lineAt(from).number - 1, to: document.lineAt(to).number - 1 });
    });
    return { folds, lines: document.lines };
  }

  applyFoldInfo(info: EditorFoldInfo | null): void {
    if (info && (!Number.isInteger(info.lines) || info.lines < 1 || !Array.isArray(info.folds)
      || info.folds.some(fold => !Number.isInteger(fold.from) || !Number.isInteger(fold.to) || fold.from < 0 || fold.from >= info.lines || fold.to < fold.from))) {
      throw new Error("A source fold snapshot requires valid line ranges and a line count.");
    }
    const state = this.cm.state, document = state.doc;
    if (info && info.lines !== document.lines) { return; }
    const effects: StateEffect<unknown>[] = [];
    foldedRanges(state).between(0, document.length, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
    for (const fold of [...info?.folds ?? []].sort((left, right) => left.from - right.from || left.to - right.to)) {
      const start = document.line(fold.from + 1), end = document.line(Math.min(fold.to + 1, document.lines));
      const range = foldable(state, start.from, start.to);
      if (range) { effects.push(foldEffect.of({ from: range.from, to: Math.max(range.to, end.to) })); }
    }
    if (effects.length) { this.cm.dispatch({ effects }); }
  }

  getRange(from: EditorPosition, to: EditorPosition): string {
    return this.cm.state.sliceDoc(this.posToOffset(from), this.posToOffset(to));
  }

  getLine(line: number): string {
    return this.cm.state.doc.line(line + 1).text;
  }

  setLine(line: number, text: string): void {
    this.replaceRange(text, { line, ch: 0 }, { line, ch: this.getLine(line).length });
  }

  processLines<T>(read: (line: number, lineText: string) => T | null, write: (line: number, lineText: string, value: T | null) => EditorChange | void, ignoreEmpty = true): void {
    const document = this.cm.state.doc, selections = this.listSelections(), selected = new Set<number>();
    for (const range of selections) {
      for (let line = Math.min(range.anchor.line, range.head.line); line <= Math.max(range.anchor.line, range.head.line); line++) { selected.add(line); }
    }
    const lines = [...selected].sort((left, right) => left - right);
    const values = lines.map(line => {
      const text = document.line(line + 1).text;
      return ignoreEmpty && lines.length > 1 && !text.trim() ? null : read(line, text);
    });
    const changes: EditorChange[] = [];
    for (let index = 0; index < lines.length; index++) {
      if (ignoreEmpty && values[index] === null) { continue; }
      const line = lines[index], change = write(line, document.line(line + 1).text, values[index]);
      if (change) { changes.push(change); }
    }
    if (this.cm.state.doc !== document) { throw new Error("The note changed while selected lines were processed."); }
    if (!changes.length) { return; }
    const first = changes[0], primary = selections[0];
    // A prefix inserted at a lone column-zero caret should leave the caret after that prefix.
    const caret = selections.length === 1 && primary.anchor.line === primary.head.line && primary.anchor.ch === 0 && primary.head.ch === 0 && primary.anchor.line === first.from.line
      ? { line: primary.anchor.line, ch: Math.max(0, first.text.length - ((first.to?.ch ?? first.from.ch) - first.from.ch)) } : undefined;
    this.transaction({ changes, ...(caret ? { selection: { from: caret } } : {}) });
  }

  wordAt(position: EditorPosition): { from: EditorPosition; to: EditorPosition } | null {
    const word = this.cm.state.wordAt(this.posToOffset(position));
    return word ? { from: this.offsetToPos(word.from), to: this.offsetToPos(word.to) } : null;
  }

  lineCount(): number {
    return this.cm.state.doc.lines;
  }

  lastLine(): number {
    return this.lineCount() - 1;
  }

  posToOffset(position: EditorPosition): number {
    return positionOffset(this.cm.state.doc, position);
  }

  offsetToPos(offset: number): EditorPosition {
    const clipped = Math.max(0, Math.min(offset, this.cm.state.doc.length));
    const line = this.cm.state.doc.lineAt(clipped);
    return { line: line.number - 1, ch: clipped - line.from };
  }

  focus(): void {
    this.cm.focus();
  }

  blur(): void { this.cm.contentDOM.blur(); }

  hasFocus(): boolean { return this.cm.hasFocus; }

  undo(): void { if (!this.owner?.app.vault.readOnly) { undo(this.cm); } }

  redo(): void { if (!this.owner?.app.vault.readOnly) { redo(this.cm); } }

  exec(command: EditorCommandName): void {
    const action = Object.hasOwn(editorCommands, command) ? editorCommands[command] : undefined;
    if (!action) { throw new Error(`Unknown editor command: ${command}`); }
    action(this.cm);
  }

  addExtension(id: string, extension: Extension): void {
    const extensions = this.plugins.get(id) ?? [];
    extensions.push(extension);
    this.plugins.set(id, extensions);
    this.updateOptions();
  }

  removeExtensions(id: string): void {
    this.plugins.delete(id);
    this.updateOptions();
  }

  private extensions(): Extension[] {
    const result: Extension[] = [];
    for (const extensions of this.plugins.values()) {
      result.push(...extensions);
    }
    return result;
  }

  updateOptions(): void {
    this.cm.dispatch({ effects: this.pluginCompartment.reconfigure(this.extensions()) });
  }
}
