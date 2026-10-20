import { Facet, Prec, type Extension } from "@codemirror/state";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { insertNewlineContinueMarkup, markdownKeymap } from "@codemirror/lang-markdown";
import { keymap, type EditorView, type Command } from "@codemirror/view";
import { markdownPairing } from "./editor-markdown-pairing";

export interface EditorTypingPreferences { autoPairBrackets: boolean; autoPairMarkdown: boolean; smartIndentList: boolean }
const defaults: Readonly<EditorTypingPreferences> = Object.freeze({ autoPairBrackets: true, autoPairMarkdown: true, smartIndentList: true });
export const editorTypingPreferences = Facet.define<EditorTypingPreferences, EditorTypingPreferences>({ combine: values => values[0] ?? defaults });

function available(view: EditorView): boolean { return !view.state.readOnly && !view.composing && !view.compositionStarted; }

/** Fall through to the ordinary Enter binding when continuation is off or unsupported by the active language. */
export const smartMarkdownEnter: Command = view => available(view) && view.state.facet(editorTypingPreferences).smartIndentList !== false
  ? insertNewlineContinueMarkup(view) : false;

/** Keep Markdown's existing markup-aware Backspace independent of the Enter preference. */
const markdownBindings = markdownKeymap.map(binding => ({ ...binding, run: binding.key === "Enter" ? smartMarkdownEnter
  : binding.run ? ((view: EditorView) => available(view) && binding.run!(view)) : undefined }));

/** Keep paired deletion at its former default priority, before generic Backspace and after plugin high-priority bindings. */
export const editorBracketKeymap = closeBracketsKeymap.map(binding => ({ ...binding, run: (view: EditorView) => available(view)
  && view.state.facet(editorTypingPreferences).autoPairBrackets !== false && Boolean(binding.run?.(view)) }));

/** Reconfigure only these input handlers/keymaps; document, history and plugin fields stay outside the compartment. */
export function editorTyping(preferences: EditorTypingPreferences): Extension {
  const values = { autoPairBrackets: preferences.autoPairBrackets !== false, autoPairMarkdown: preferences.autoPairMarkdown !== false, smartIndentList: preferences.smartIndentList !== false };
  return [
    editorTypingPreferences.of(values),
    values.autoPairBrackets ? closeBrackets() : [],
    values.autoPairMarkdown ? markdownPairing() : [],
    // Markdown's former high-priority keymap keeps its precedence. Pair deletion
    // stays in the base keymap so a plugin's high-priority Backspace still wins.
    Prec.high(keymap.of(markdownBindings)),
  ];
}
