import type { App, Command } from "./app";
import { MarkdownView } from "./workspace";

/** Folding is a local view preference and remains available in read-only notes. */
export function registerEditorFoldCommands(app: App): () => void {
  const active = (): MarkdownView | null => {
    const leaf = app.workspace.activeLeaf, view = app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file && view.isLoaded && leaf?.view === view && !app.changingVault && !app.workspace.isChangingFiles
      && !app.workspace.isChangingLayout && app.vault.getFileByPath(view.file.path) === view.file ? view : null;
  };
  const fold = (collapse: boolean): Command => ({
    id: collapse ? "editor:fold-all" : "editor:unfold-all", name: collapse ? "Fold all" : "Unfold all",
    checkCallback: checking => {
      const view = active();
      if (!view) { return false; }
      if (view.getMode() === "preview") {
        const reading = view.currentMode;
        if (!("canFoldAll" in reading) || !reading.canFoldAll()) { return false; }
        return checking || (collapse ? reading.foldAll() : reading.unfoldAll());
      }
      const editor = view.editor;
      if (view.currentMode !== editor || !editor.cm.dom.isConnected || !editor.cm.dom.getClientRects().length
        || editor.cm.composing || editor.cm.compositionStarted) { return false; }
      if (!checking) { editor.exec(collapse ? "foldAll" : "unfoldAll"); }
      return true;
    },
  });
  return app.commands.install([fold(true), fold(false)]);
}
