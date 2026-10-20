import type { App } from "./app";
import type { TFile, TFolder } from "./vault";

export const MAX_EXPLORER_MOVE = 20;
export interface SelectedNoteMove { readonly file: TFile; readonly from: string; readonly to: string }
export interface SelectedNoteMovePlan { readonly root: string; readonly folder: TFolder; readonly folderPath: string; readonly items: readonly SelectedNoteMove[] }
export interface SelectedNoteMoveResult { moved: SelectedNoteMove[]; remaining: SelectedNoteMove[]; error: string | null }

const safe = (path: string): boolean => Boolean(path) && path.length <= 1024 && !/[\\\x00-\x1f<>:"|?*]/.test(path)
  && path.split("/").every(part => Boolean(part) && part !== "." && part !== ".." && !part.startsWith(".") && !/[ .]$/.test(part));

/** Review exact destinations before any move; collisions never acquire generated names. */
export function planSelectedNoteMoves(root: string, files: readonly TFile[], folder: TFolder, occupied: readonly string[]): SelectedNoteMovePlan {
  const folderPath = folder.isRoot() ? "" : folder.path;
  if (!root || files.length < 1 || files.length > MAX_EXPLORER_MOVE || folderPath && !safe(folderPath)) { throw new Error("Choose 1–20 Markdown notes and an existing vault folder."); }
  const paths = new Set(occupied.map(path => path.toLowerCase())), destinations = new Set<string>(), sources = new Set<string>();
  const items = files.map(file => {
    const from = file.path, to = (folderPath ? folderPath + "/" : "") + from.split("/").at(-1);
    if (!safe(from) || !/\.md$/i.test(from) || sources.has(from.toLowerCase())) { throw new Error("The selection contains an unsupported or duplicate note."); }
    sources.add(from.toLowerCase());
    if (from === to) { throw new Error('"' + from + '" is already in that folder.'); }
    if (!safe(to) || paths.has(to.toLowerCase()) || destinations.has(to.toLowerCase())) { throw new Error('The destination "' + to + '" is occupied or duplicated. Choose another folder.'); }
    destinations.add(to.toLowerCase());
    return Object.freeze({ file, from, to });
  });
  return Object.freeze({ root, folder, folderPath, items: Object.freeze(items) });
}

/** Sequential normal renames retain successful moves if a later item fails. */
export async function moveSelectedNotes(app: App, plan: SelectedNoteMovePlan, updateLinks: boolean, current: () => boolean): Promise<SelectedNoteMoveResult> {
  const moved: SelectedNoteMove[] = [];
  const valid = (): boolean => current() === true && plan.root === app.vault.rootPath && !app.vault.readOnly && !app.changingVault
    && !app.workspace.isChangingLayout && !app.core.busy && app.core.isEnabled("file-explorer")
    && (plan.folder.isRoot() ? app.vault.getRoot() === plan.folder : plan.folder.path === plan.folderPath && app.vault.getFolderByPath(plan.folderPath) === plan.folder)
    && plan.items.every((item, index) => item.file.vault === app.vault && item.file.path === (index < moved.length ? item.to : item.from)
      && app.vault.getFileByPath(item.file.path) === item.file)
    && plan.items.slice(moved.length).every(item => !app.vault.getAbstractFileByPathInsensitive(item.to));
  try {
    if (app.workspace.isChangingFiles || !valid()) { throw new Error("The reviewed selection, folder or Files pane changed. Review the move again."); }
    for (const item of plan.items) {
      if (!valid()) { throw new Error("The remaining selection, folder or Files pane changed."); }
      try {
        await app.fileManager.renameFile(item.file, item.to, updateLinks, { guard: valid });
        moved.push(item);
      } catch (error) {
        // A plugin/cleanup error can follow an acknowledged rename. Report its
        // observed destination, never attempt to roll another user's data back.
        if (item.file.path === item.to && app.vault.getFileByPath(item.to) === item.file) { moved.push(item); }
        throw error;
      }
    }
    return { moved, remaining: [], error: null };
  } catch (error) {
    return { moved, remaining: plan.items.slice(moved.length), error: (error instanceof Error ? error.message : String(error)) + " Check the current locations before retrying; completed moves were kept." };
  }
}
