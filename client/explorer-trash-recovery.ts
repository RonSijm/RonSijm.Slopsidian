import type { App } from "./app";
import type { VaultTrashEntry, VaultTrashRestoreItem, VaultTrashRestoreReview } from "./contracts";
import { TFolder } from "./vault";

export const MAX_TRASH_RESTORE = 20;
export interface TrashRecoveryPlan { readonly root: string; readonly folder: TFolder; readonly entries: readonly VaultTrashEntry[]; readonly review: VaultTrashRestoreReview }
export interface TrashRecoveryResult { restored: VaultTrashRestoreItem[]; remaining: VaultTrashRestoreItem[]; error: string | null }
function current(app: App, root: string, folder: TFolder, owner: () => boolean): boolean {
  return owner() === true && root === app.vault.rootPath && !app.vault.readOnly && !app.changingVault && !app.workspace.isChangingLayout
    && !app.core.busy && app.core.isEnabled("file-explorer") && folder.vault === app.vault && app.vault.getFolderByPath(folder.path) === folder;
}
export async function reviewTrashRecovery(app: App, entries: readonly VaultTrashEntry[], folder: TFolder, owner: () => boolean): Promise<TrashRecoveryPlan> {
  const root = app.vault.rootPath;
  if (!root || entries.length < 1 || entries.length > MAX_TRASH_RESTORE || new Set(entries.map(entry => entry.path.toLowerCase())).size !== entries.length) throw new Error("Select 1–20 distinct listed Markdown trash notes.");
  if (!current(app, root, folder, owner) || app.workspace.isChangingFiles || app.workspace.hasUnsavedChanges) throw new Error("Save or reload open notes and wait for the current local Files pane before reviewing recovery.");
  const review = await app.vault.reviewTrashRestore(entries, folder);
  if (!current(app, root, folder, owner) || app.workspace.isChangingFiles || app.workspace.hasUnsavedChanges) throw new Error("The recovery selection, folder or Files pane changed while reviewing. Nothing was restored.");
  return Object.freeze({ root, folder, entries: Object.freeze([...entries]), review: Object.freeze({ ...review, items: Object.freeze(review.items.map(item => Object.freeze({ ...item }))) as unknown as VaultTrashRestoreItem[] }) });
}
export async function restoreTrashRecovery(app: App, plan: TrashRecoveryPlan, owner: () => boolean): Promise<TrashRecoveryResult> {
  const restored: VaultTrashRestoreItem[] = [];
  const valid = (): boolean => current(app, plan.root, plan.folder, owner);
  try {
    if (!valid() || app.workspace.isChangingFiles) throw new Error("The reviewed recovery owner changed. Review vault trash again.");
    for (const item of plan.review.items) {
      if (!valid()) throw new Error("The remaining recovery selection or folder changed.");
      let acknowledged = false;
      try { await app.fileManager.restoreTrashFile(plan.review, item, valid, () => { acknowledged = true; }); if (!acknowledged) throw new Error("The restored note response could not be confirmed."); restored.push(item); }
      catch (error) { if (acknowledged) restored.push(item); throw error; }
    }
    return { restored, remaining: [], error: null };
  } catch (error) { return { restored, remaining: plan.review.items.slice(restored.length), error: (error instanceof Error ? error.message : String(error)) + " Inspect the destination and .trash before retrying. Confirmed restores were kept; this review cannot replay consumed entries." }; }
}
