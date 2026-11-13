import type { App, Command } from "./app";
import type { Editor } from "./editor";
import { MarkdownView } from "./workspace";

/** Search remains available in read-only notes; only replacement needs write access. */
export function registerEditorSearchCommands(app: App): () => void {
  const active = (): MarkdownView | null => {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file && !app.changingVault && !app.workspace.isChangingFiles
      && app.vault.getFileByPath(view.file.path) === view.file ? view : null;
  };
  type Surface = Pick<Editor, "showSearch" | "searchIsOpen" | "findNext" | "findPrevious" | "closeSearch">;
  const find = (id: string, name: string, action: (surface: Surface) => unknown, open = false): Command => ({
    id, name,
    checkCallback: checking => {
      const surface = active()?.currentMode;
      if (!surface || open && !surface.searchIsOpen()) { return false; }
      if (!checking) { action(surface); }
      return true;
    },
  });
  const replace = (id: string, name: string, action: (editor: Editor) => unknown, open = false): Command => ({
    id, name,
    checkCallback: checking => {
      const view = active(), editor = view?.getMode() === "source" ? view.editor : null;
      if (!editor || !editor.canReplace() || open && !editor.searchIsOpen()) { return false; }
      if (!checking) { action(editor); }
      return true;
    },
  });
  return app.commands.install([
    find("editor:open-search", "Find in current note", surface => surface.showSearch()),
    replace("editor:open-search-replace", "Find and replace in current note", editor => editor.showSearch(true)),
    find("editor:find-next", "Find next match", surface => surface.findNext()),
    find("editor:find-previous", "Find previous match", surface => surface.findPrevious()),
    replace("editor:replace-next", "Replace next match", editor => editor.replaceNext(), true),
    replace("editor:replace-all", "Replace all matches in current note", editor => editor.replaceAll(), true),
    find("editor:close-search", "Close note search", surface => surface.closeSearch(), true),
  ]);
}
