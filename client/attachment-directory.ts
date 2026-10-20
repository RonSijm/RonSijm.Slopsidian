import { attachmentPath } from "./audio-paths";
import { ATTACHMENT_IMPORT_LIMITS, planAttachmentPaths, prepareAttachmentFiles, validName, type AttachmentDestination, type ImportSource, type PreparedAttachment } from "./attachment-import";

/** One regular file from a user-selected folder; `name` is its path below, and including, the selected root. */
export interface DirectorySource extends ImportSource { readonly name: string; }
export const DIRECTORY_IMPORT_LIMITS = Object.freeze({ depth: 12, entries: 1000 });

interface EntryLike { readonly isFile: boolean; readonly isDirectory: boolean; readonly name: string; }
interface FileEntryLike extends EntryLike { file(success: (file: File) => void, failure: (error: unknown) => void): void; }
interface DirectoryReaderLike { readEntries(success: (entries: EntryLike[]) => void, failure: (error: unknown) => void): void; }
interface DirectoryEntryLike extends EntryLike { createReader(): DirectoryReaderLike; }

function validatePath(path: string): string[] {
  if (typeof path !== "string") { throw new Error("The selected folder contains an invalid path."); }
  const parts = path.split("/");
  if (parts.length < 2 || parts.length > DIRECTORY_IMPORT_LIMITS.depth + 1) { throw new Error("Folder imports support files at most " + DIRECTORY_IMPORT_LIMITS.depth + " levels below the selected folder: " + path); }
  parts.forEach(validName);
  attachmentPath(path);
  return parts;
}

/** Folder paths must be a single selected root and cannot alias by case or by file/directory role. */
export function validateDirectoryPaths(paths: readonly string[]): void {
  const roots = new Set<string>(), files = new Set<string>(), directories = new Set<string>(), spellings = new Map<string, string>();
  for (const path of paths) {
    const parts = validatePath(path);
    roots.add(parts[0]);
    const key = path.toLowerCase();
    if (files.has(key) || directories.has(key)) { throw new Error("The selected folder contains names that differ only by case or role: " + path); }
    files.add(key);
    for (let end = 2; end < parts.length; end++) {
      const spelled = parts.slice(0, end).join("/"), directory = spelled.toLowerCase();
      if (files.has(directory)) { throw new Error("The selected folder contains a file and folder with the same name: " + spelled); }
      const known = spellings.get(directory);
      if (known !== undefined && known !== spelled) { throw new Error("The selected folder contains directories that differ only by case: " + known + " and " + spelled); }
      spellings.set(directory, spelled);
      directories.add(directory);
    }
  }
  for (const directory of directories) {
    if (files.has(directory)) { throw new Error("The selected folder contains a file and folder with the same name: " + directory); }
  }
  if (roots.size !== 1) { throw new Error("Import one folder at a time."); }
}

/** Convert a webkitdirectory selection; every file must carry the selected root in its relative path. */
export function directorySourcesFromFiles(files: readonly File[]): DirectorySource[] {
  return files.map(file => {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!path) { throw new Error("The browser did not provide the selected folder hierarchy for: " + file.name); }
    return { name: path, size: file.size, arrayBuffer: () => file.arrayBuffer() };
  });
}

function entryFile(entry: FileEntryLike): Promise<File> { return new Promise((resolve, reject) => entry.file(resolve, reject)); }
function readEntries(reader: DirectoryReaderLike): Promise<EntryLike[]> { return new Promise((resolve, reject) => reader.readEntries(resolve, reject)); }

/**
 * Walk a dropped directory handle supplied by the browser. Only entries beneath that handle are visited,
 * unreadable or oversized trees stop the whole walk, and nothing is skipped silently.
 */
export async function readDirectoryEntry(root: EntryLike): Promise<DirectorySource[]> {
  if (!root.isDirectory) { throw new Error("Drop a folder, not a file, for folder import."); }
  const sources: DirectorySource[] = []; let visited = 0;
  const walk = async (directory: DirectoryEntryLike, prefix: string, depth: number): Promise<void> => {
    if (depth > DIRECTORY_IMPORT_LIMITS.depth) { throw new Error("Folder imports support at most " + DIRECTORY_IMPORT_LIMITS.depth + " nested folder levels."); }
    const reader = directory.createReader();
    for (;;) {
      const batch = await readEntries(reader);
      if (!batch.length) { return; }
      for (const entry of batch) {
        if (++visited > DIRECTORY_IMPORT_LIMITS.entries) { throw new Error("The dropped folder contains more than " + DIRECTORY_IMPORT_LIMITS.entries + " entries."); }
        validName(entry.name);
        const path = prefix + "/" + entry.name;
        if (entry.isDirectory) { await walk(entry as DirectoryEntryLike, path, depth + 1); }
        else if (entry.isFile) {
          if (sources.length >= ATTACHMENT_IMPORT_LIMITS.files) { throw new Error("Choose between 1 and 20 files to attach."); }
          const file = await entryFile(entry as FileEntryLike);
          sources.push({ name: path, size: file.size, arrayBuffer: () => file.arrayBuffer() });
        } else { throw new Error("The dropped folder contains an unsupported entry: " + path); }
      }
    }
  };
  validName(root.name);
  await walk(root as DirectoryEntryLike, root.name, 0);
  if (!sources.length) { throw new Error("The folder contains no files to attach. Empty folders are not imported."); }
  return sources;
}

/** Read and validate the whole folder selection, with the same limits as individual file imports. */
export async function prepareDirectoryAttachments(files: readonly DirectorySource[]): Promise<PreparedAttachment[]> {
  validateDirectoryPaths(files.map(file => file.name));
  return prepareAttachmentFiles(files, name => { validatePath(name); });
}

/** Reserve a fresh create-only root folder, then retain the selected relative hierarchy beneath it. */
export function planDirectoryPaths(paths: readonly string[], folder: string, existing: readonly AttachmentDestination[]): string[] {
  validateDirectoryPaths(paths);
  const root = paths[0].split("/")[0];
  const [reserved] = planAttachmentPaths([root], folder, existing);
  return paths.map(path => attachmentPath(reserved + path.slice(root.length)));
}
