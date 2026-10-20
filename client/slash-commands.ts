import { closeCompletion, currentCompletions, pickedCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { reportError } from "./dom";
import { parseMarkdown, type CachedMetadata } from "./markdown";
import { MarkdownView } from "./workspace";

export class SlashCommands {
  readonly id = "slash-command";
  private readonly caches = new WeakMap<Text, CachedMetadata>();
  private readonly completions = new WeakSet<Completion>();

  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    const owner = `core:${this.id}`;
    core.register(this.id, () => {
      this.app.workspace.addEditorExtension(owner, EditorState.languageData.of(() => [{ autocomplete: this.complete }]));
      return () => {
        for (const leaf of this.app.workspace.leaves()) {
          if (leaf.view instanceof MarkdownView && currentCompletions(leaf.view.editor.cm.state).some(completion => this.completions.has(completion))) {
            closeCompletion(leaf.view.editor.cm);
          }
        }
        this.app.workspace.removeEditorExtensions(owner);
      };
    }, this);
  }

  private readonly complete = (context: CompletionContext): CompletionResult | null => {
    if (!context.view || !context.view.hasFocus || this.app.changingVault
      || this.app.workspace.activeEditor?.editor.cm !== context.view
      || context.state.selection.ranges.length !== 1 || !context.state.selection.main.empty) {
      return null;
    }
    const line = context.state.doc.lineAt(context.pos);
    const match = /(^|\s)\/([^\s/]*)$/.exec(context.state.sliceDoc(line.from, context.pos));
    if (!match) { return null; }
    let cache = this.caches.get(context.state.doc);
    if (!cache) {
      cache = parseMarkdown(context.state.doc.toString());
      this.caches.set(context.state.doc, cache);
    }
    const slash = line.from + match.index + match[1].length;
    if (cache.ignored.some(range => range.from <= slash && slash < range.to)) { return null; }
    const pinned = this.app.core.state("command-palette").settings.pinned;
    const options = this.app.commands.status().filter(command => command.enabled).map(command => {
      const completion: Completion = {
        label: command.name,
        type: "function",
        ...(Array.isArray(pinned) && pinned.includes(command.id) ? { boost: 80, detail: "Pinned" } : {}),
        apply: (view, chosen, from, to) => { this.execute(view, chosen, from, to, command.id).catch(reportError); },
      };
      this.completions.add(completion);
      return completion;
    });
    return {
      from: slash + 1, to: context.pos, options,
      validFor: (text, from, _to, state) => from > 0 && state.sliceDoc(from - 1, from) === "/" && /^[^\s/]*$/.test(text),
    };
  };

  private async execute(view: EditorView, completion: Completion, from: number, to: number, id: string): Promise<void> {
    if (!this.app.core.isEnabled(this.id) || this.app.changingVault || this.app.workspace.activeEditor?.editor.cm !== view) {
      throw new Error("The slash-command editor is no longer active. Its text was retained.");
    }
    if (!this.app.commands.status().some(command => command.id === id && command.enabled)) {
      throw new Error("This slash command is no longer available. Its query was retained.");
    }
    if (from < 1 || view.state.sliceDoc(from - 1, from) !== "/") {
      throw new Error("The slash-command query changed before selection. Its text was retained.");
    }
    view.dispatch({
      changes: { from: from - 1, to, insert: "" },
      selection: { anchor: from - 1 },
      annotations: [pickedCompletion.of(completion), isolateHistory.of("full")],
      userEvent: "input.complete",
    });
    await this.app.commands.execute(id);
  }
}
