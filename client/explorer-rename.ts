import type { App } from "./app";
import type { TFile } from "./vault";

export const MAX_EXPLORER_RENAME = 20;
export interface SelectedNoteRenameOptions { readonly find: string; readonly replace: string; readonly prefix: string; readonly suffix: string }
export interface SelectedNoteRename { readonly file: TFile; readonly from: string; readonly to: string }
export interface SelectedNoteRenamePlan { readonly root: string; readonly options: SelectedNoteRenameOptions; readonly items: readonly SelectedNoteRename[] }
export interface SelectedNoteRenameResult { renamed: SelectedNoteRename[]; remaining: SelectedNoteRename[]; error: string | null }

const safeName = (name: string): boolean => Boolean(name.trim()) && name.length <= 255 && !/[\/\\\x00-\x1f\x7f<>:"|?*]/.test(name)
  && !name.startsWith(".") && !/[ .]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(name)
  && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(name);
const safePath = (path: string): boolean => Boolean(path) && path.length <= 1024 && path.split("/").every(safeName);
const optionKeys = ["find", "replace", "prefix", "suffix"] as const;

function supportedLinkPath(path: string): boolean {
  return path.split("/").every((component, index, parts) => {
    const name = index === parts.length - 1 ? component.slice(0, -3) : component;
    // Existing link rewriting must round-trip through both wiki and Markdown syntax.
    if (name.trim() !== name || /[\]`]/.test(name)) { return false; }
    let depth = 0;
    for (const character of name) {
      if (character === "(") { depth++; }
      else if (character === ")" && --depth < 0) { return false; }
    }
    return depth === 0;
  });
}

function renamedPath(from: string, options: SelectedNoteRenameOptions): string {
  if (!safePath(from) || !/\.md$/i.test(from)) { throw new Error("The selection contains an unsupported Markdown note path."); }
  const slash = from.lastIndexOf("/"), name = from.slice(slash + 1), extension = name.slice(-3), stem = name.slice(0, -3);
  const renamed = options.prefix + (options.find ? stem.split(options.find).join(options.replace) : stem) + options.suffix;
  if (!renamed.trim() || !safeName(renamed + extension)) { throw new Error('The new name for "' + from + '" is empty or unsafe. Use a filename without folders.'); }
  const to = from.slice(0, slash + 1) + renamed + extension;
  if (!safePath(to)) { throw new Error('The new path for "' + from + '" is too long or unsafe.'); }
  if (!supportedLinkPath(to)) { throw new Error('The new path for "' + from + '" has an unsupported link name. Avoid closing brackets, backticks, surrounding spaces and unbalanced parentheses.'); }
  if (to === from) { throw new Error('"' + from + '" would keep its current name. Change the rename fields or selection.'); }
  return to;
}

/** Literal, case-sensitive filename changes stay in each source folder and preserve its Markdown extension. */
export function planSelectedNoteRenames(root: string, files: readonly TFile[], options: SelectedNoteRenameOptions, occupied: readonly string[]): SelectedNoteRenamePlan {
  if (!root || files.length < 1 || files.length > MAX_EXPLORER_RENAME) { throw new Error("Choose 1–20 Markdown notes to rename."); }
  if (!options || optionKeys.some(key => typeof options[key] !== "string" || options[key].length > 256)) { throw new Error("Rename fields must be text no longer than 256 characters each."); }
  if (!options.find && options.replace) { throw new Error("Enter text to find before entering its replacement."); }
  const reviewed = Object.freeze(Object.fromEntries(optionKeys.map(key => [key, options[key]]))) as unknown as SelectedNoteRenameOptions;
  // Sources remain occupied throughout planning: no swaps, chains or temporary generated names.
  const paths = new Set([...occupied, ...files.map(file => file.path)].map(path => path.toLowerCase())), sources = new Set<string>(), destinations = new Set<string>();
  const items = files.map(file => {
    const from = file.path;
    if (sources.has(from.toLowerCase())) { throw new Error("The selection contains a duplicate note."); }
    sources.add(from.toLowerCase());
    const to = renamedPath(from, reviewed);
    if (paths.has(to.toLowerCase()) || destinations.has(to.toLowerCase())) { throw new Error('The destination "' + to + '" is occupied or duplicated. Change the rename fields or selection.'); }
    destinations.add(to.toLowerCase());
    return Object.freeze({ file, from, to });
  });
  return Object.freeze({ root, options: reviewed, items: Object.freeze(items) });
}

/** Use ordinary guarded renames, retaining acknowledged names if a later rename or cleanup fails. */
export async function renameSelectedNotes(app: App, plan: SelectedNoteRenamePlan, updateLinks: boolean, current: () => boolean): Promise<SelectedNoteRenameResult> {
  const renamed: SelectedNoteRename[] = [];
  const valid = (): boolean => current() === true && plan.root === app.vault.rootPath && !app.vault.readOnly && !app.changingVault
    && !app.workspace.isChangingLayout && !app.core.busy && app.core.isEnabled("file-explorer")
    && plan.items.every((item, index) => item.file.vault === app.vault && item.file.path === (index < renamed.length ? item.to : item.from)
      && app.vault.getFileByPath(item.file.path) === item.file)
    && plan.items.slice(renamed.length).every(item => !app.vault.getAbstractFileByPathInsensitive(item.to));
  try {
    if (app.workspace.isChangingFiles || !valid()) { throw new Error("The reviewed selection or Files pane changed. Review the rename again."); }
    for (const item of plan.items) {
      if (!valid()) { throw new Error("The remaining selection or Files pane changed."); }
      try {
        await app.fileManager.renameFile(item.file, item.to, updateLinks, { guard: valid });
        renamed.push(item);
      } catch (error) {
        if (item.file.path === item.to && app.vault.getFileByPath(item.to) === item.file) { renamed.push(item); }
        throw error;
      }
    }
    return { renamed, remaining: [], error: null };
  } catch (error) {
    return { renamed, remaining: plan.items.slice(renamed.length), error: (error instanceof Error ? error.message : String(error)) + " Check the current names before retrying; completed renames were kept." };
  }
}
