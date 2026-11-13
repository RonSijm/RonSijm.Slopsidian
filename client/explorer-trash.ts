import type { App } from "./app";
import type { TFile } from "./vault";

export const MAX_EXPLORER_TRASH = 20;
export type SelectedNoteRemovalMode = "vault" | "system" | "permanent";
export interface SelectedNoteTrash { readonly file: TFile; readonly path: string; readonly version: string }
export interface SelectedNoteTrashPlan { readonly root: string; readonly mode: SelectedNoteRemovalMode; readonly items: readonly SelectedNoteTrash[] }
export interface SelectedNoteTrashResult { trashed: SelectedNoteTrash[]; remaining: SelectedNoteTrash[]; error: string | null }

function ready(app: App, root: string, owner: () => boolean): boolean {
  return owner() === true && app.vault.rootPath === root && !app.vault.readOnly && !app.changingVault
    && !app.workspace.isChangingLayout && !app.core.busy && app.core.isEnabled("file-explorer");
}
function selected(app: App, file: TFile, path: string): boolean {
  const session = app.workspace.sessions.get(path);
  return file.vault === app.vault && file.path === path && app.vault.getFileByPath(path) === file
    && !session?.dirty && !session?.isSaving && !session?.isReloading;
}

function supportedMode(app: App, mode: SelectedNoteRemovalMode): boolean {
  return mode === "vault" || mode === "permanent" || mode === "system" && app.vault.supportsSystemTrash;
}

/** Read current versions without saving a draft or moving anything. */
export async function reviewSelectedNoteTrash(app: App, files: readonly TFile[], owner: () => boolean, mode: SelectedNoteRemovalMode = "vault"): Promise<SelectedNoteTrashPlan> {
  const root = app.vault.rootPath, seen = new Set<string>();
  if (!root || files.length < 1 || files.length > MAX_EXPLORER_TRASH) { throw new Error("Select 1–20 Markdown notes for removal."); }
  if (!supportedMode(app, mode)) { throw new Error("This removal method is unavailable. System trash requires a supported native host."); }
  const paths = files.map(file => file.path);
  const valid = (): boolean => ready(app, root, owner) && supportedMode(app, mode) && !app.workspace.isChangingFiles && files.every((file, index) => selected(app, file, paths[index]));
  for (const path of paths) {
    if (!path || path.length > 1024 || /[\\\x00-\x1f<>:"|?*]/.test(path) || !/\.md$/i.test(path)
      || path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".") || /[ .]$/.test(part))
      || seen.has(path.toLowerCase())) { throw new Error("The selection contains an unsafe, unsupported or duplicate note."); }
    seen.add(path.toLowerCase());
  }
  if (!valid()) { throw new Error("Save the selected notes and wait for the current pane or vault operation before reviewing trash."); }
  const items: SelectedNoteTrash[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index], path = paths[index], info = await app.vault.getFileInfo(file);
    const cached = app.metadataCache.getDocument(path), session = app.workspace.sessions.get(path);
    if (!valid() || !info.version || cached && cached.document.version !== info.version || session && session.document.version !== info.version) {
      throw new Error('"' + path + '" changed on disk. Refresh or reload it before reviewing trash.');
    }
    items.push(Object.freeze({ file, path, version: info.version }));
  }
  return Object.freeze({ root, mode, items: Object.freeze(items) });
}

/** Explicit reviewed modes use ordinary versioned removal and keep acknowledged results. */
export async function trashSelectedNotes(app: App, plan: SelectedNoteTrashPlan, owner: () => boolean, permanentAcknowledged = false): Promise<SelectedNoteTrashResult> {
  const trashed: SelectedNoteTrash[] = [];
  const valid = (): boolean => ready(app, plan.root, owner) && supportedMode(app, plan.mode) && (plan.mode !== "permanent" || permanentAcknowledged === true)
    && plan.items.every((item, index) => index < trashed.length ? !app.vault.getAbstractFileByPathInsensitive(item.path) : selected(app, item.file, item.path));
  try {
    if (plan.mode === "permanent" && permanentAcknowledged !== true) { throw new Error("Acknowledge that permanent deletion cannot be undone before removing these notes."); }
    if (app.workspace.isChangingFiles || !valid()) { throw new Error("The reviewed selection, removal method or Files pane changed. Review removal again."); }
    for (const item of plan.items) {
      if (!valid()) { throw new Error("The remaining selection or Files pane changed."); }
      let acknowledged = false;
      try {
        const review = { guard: valid, version: item.version, removed: () => { acknowledged = true; } };
        if (plan.mode === "permanent") { await app.fileManager.deleteFile(item.file, review); }
        else { await app.fileManager.trashFile(item.file, plan.mode === "system", review); }
        if (!acknowledged) { throw new Error("The removal response could not be confirmed."); }
        trashed.push(item);
      } catch (error) {
        if (acknowledged) { trashed.push(item); }
        throw error;
      }
    }
    return { trashed, remaining: [], error: null };
  } catch (error) {
    return { trashed, remaining: plan.items.slice(trashed.length), error: (error instanceof Error ? error.message : String(error))
      + (plan.mode === "vault" ? " Check the current vault and .trash folder" : plan.mode === "system" ? " Check the current vault and system trash" : " Check the current vault")
      + " before retrying; completed removals were kept." };
  }
}
