import { EditorState, type Extension } from "@codemirror/state";
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import type { App } from "./app";
import type { Editor } from "./editor";
import type { MarkdownView } from "./workspace";
import { editorFolding, editorFoldingPreferences, editorFoldKeymap } from "./editor-folding";
import { editorBracketKeymap, editorTyping } from "./editor-typing";
import { editorMarkdownPairKeymap } from "./editor-markdown-pairing";

export interface EditorPreferences {
  showLineNumber: boolean;
  lineWrap: boolean;
  readableLineLength: boolean;
  tabSize: number;
  useTab: boolean;
  foldHeading: boolean;
  foldIndent: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  smartIndentList: boolean;
}

/** Preserve existing visual defaults; invalid stored values use these bounded defaults. */
export const EDITOR_PREFERENCE_DEFAULTS: Readonly<EditorPreferences> = Object.freeze({
  showLineNumber: false, lineWrap: true, readableLineLength: true, tabSize: 4, useTab: false, foldHeading: true, foldIndent: true, autoPairBrackets: true, autoPairMarkdown: true, smartIndentList: true,
});
export const EDITOR_PREFERENCE_KEYS = Object.freeze(Object.keys(EDITOR_PREFERENCE_DEFAULTS) as (keyof EditorPreferences)[]);

export function isEditorPreference(key: string): key is keyof EditorPreferences {
  return Object.hasOwn(EDITOR_PREFERENCE_DEFAULTS, key);
}

export function editorPreference<K extends keyof EditorPreferences>(key: K, value: unknown): { value: EditorPreferences[K]; valid: boolean } {
  const valid = value === undefined || (key === "tabSize" ? Number.isInteger(value) && (value as number) >= 2 && (value as number) <= 8 : typeof value === "boolean");
  return { value: valid && value !== undefined ? value as EditorPreferences[K] : EDITOR_PREFERENCE_DEFAULTS[key], valid };
}

export function validateEditorPreference(key: string, value: unknown): void {
  if (!isEditorPreference(key)) { throw new Error("Editor preferences require a supported Boolean control or integer tab size."); }
  if (key === "tabSize") {
    if (!Number.isInteger(value) || (value as number) < 2 || (value as number) > 8) { throw new Error("Tab size must be an integer from 2 to 8."); }
  } else if (typeof value !== "boolean") { throw new Error("This editor preference must be Boolean."); }
}

export function readEditorPreferences(editor: Editor): EditorPreferences {
  const configuration = editor.editorComponent?.app.configuration;
  const read = <K extends keyof EditorPreferences>(key: K): EditorPreferences[K] => {
    try { return editorPreference(key, configuration?.get("app", key)).value; }
    catch { return EDITOR_PREFERENCE_DEFAULTS[key]; }
  };
  return { showLineNumber: read("showLineNumber"), lineWrap: read("lineWrap"), readableLineLength: read("readableLineLength"), tabSize: read("tabSize"), useTab: read("useTab"), foldHeading: read("foldHeading"), foldIndent: read("foldIndent"), autoPairBrackets: read("autoPairBrackets"), autoPairMarkdown: read("autoPairMarkdown"), smartIndentList: read("smartIndentList") };
}

/** Explicit basic editor setup keeps optional line-number extensions in their own compartment. */
export const editorBaseSetup: Extension = [
  highlightSpecialChars(), history(), editorFolding, drawSelection(), dropCursor(),
  EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(), autocompletion(), rectangularSelection(), crosshairCursor(), highlightActiveLine(),
  highlightSelectionMatches(), keymap.of([...editorMarkdownPairKeymap, ...editorBracketKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...editorFoldKeymap, ...completionKeymap, ...lintKeymap]),
];

/** Reconfiguration preserves the document, selection, plugin extensions and existing history field. */
export function editorPreferences(preferences: EditorPreferences): Extension {
  return [
    preferences.showLineNumber ? [lineNumbers(), highlightActiveLineGutter()] : [],
    preferences.lineWrap ? EditorView.lineWrapping : [],
    EditorState.tabSize.of(preferences.tabSize), indentUnit.of(preferences.useTab ? "\t" : " ".repeat(preferences.tabSize)),
    editorFoldingPreferences.of({ foldHeading: preferences.foldHeading !== false, foldIndent: preferences.foldIndent !== false }),
    editorTyping(preferences),
    EditorView.editorAttributes.of({ "data-editor-line-numbers": String(preferences.showLineNumber), "data-editor-line-wrap": String(preferences.lineWrap),
      "data-editor-readable-width": String(preferences.readableLineLength), "data-editor-tab-size": String(preferences.tabSize), "data-editor-use-tabs": String(preferences.useTab),
      "data-editor-fold-headings": String(preferences.foldHeading !== false), "data-editor-fold-lists": String(preferences.foldIndent !== false),
      "data-editor-auto-pairs": String(preferences.autoPairBrackets !== false), "data-editor-markdown-pairs": String(preferences.autoPairMarkdown !== false), "data-editor-smart-lists": String(preferences.smartIndentList !== false) }),
    EditorView.theme({ ".cm-content": { maxWidth: preferences.readableLineLength ? "var(--file-line-width)" : "none" } }),
  ];
}

export function refreshEditorPreferences(app: App): void {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    (leaf.view as MarkdownView).editor?.refreshPreferences();
  }
}
